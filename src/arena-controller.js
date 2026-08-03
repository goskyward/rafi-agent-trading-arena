import { DurableObject } from "cloudflare:workers";
import { ARENA_CONFIG, SERVICE, VERSION, executionModel, maximumQuoteAgeSeconds } from "./config.js";
import { OpportunityEngineMarketProvider } from "./market-provider.js";
import { calculateScores } from "./scoring.js";
import { calculateBuyExecution, calculateSellExecution, classifyTrade, conservativeLiquidationValue, weightedAverageEntry } from "./execution-math.js";
import { ArenaError, finite, iso, roundMoney } from "./utils.js";
import { campaignView, deriveRound, reconcileState } from "./clocks.js";
import { AGENT_REGISTRY, validateAgentDecision } from "./strategies.js";

const STATE_KEY = "arena-state-v1";
const AGENT_CADENCE_MS = 15000;

export class ArenaController extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.env = env;
    this.ctx.blockConcurrencyWhile(async () => {
      if (!(await this.ctx.storage.get(STATE_KEY))) await this.ctx.storage.put(STATE_KEY, createInitialState());
    });
  }

  async health() { return { available: true, objectId: this.ctx.id.toString(), storage: "sqlite" }; }
  async getArena() { return this.buildArenaPayload(await this.loadAndReconcile(), true); }
  async getScoreboard() { const state = await this.markState(await this.loadAndReconcile(), true); return scoreboardPayload(state); }
  async getAgents() { const state = await this.markState(await this.loadAndReconcile(), true); return { ok: true, serverTime: new Date().toISOString(), agents: state.agents }; }
  async getPositions() { const state = await this.markState(await this.loadAndReconcile(), true); return { ok: true, serverTime: new Date().toISOString(), positions: Object.fromEntries(ARENA_CONFIG.agents.map(id => [id, Object.values(state.agents[id].positions)])) }; }
  async getTrades() { const state = await this.loadAndReconcile(); return { ok: true, serverTime: new Date().toISOString(), count: state.trades.length, trades: [...state.trades].reverse() }; }

  async startCampaign() {
    const now = Date.now();
    const state = await this.ctx.storage.transaction(async txn => {
      const current = reconcileState((await txn.get(STATE_KEY)) || createInitialState(), now);
      if (current.campaign.status === "ACTIVE") throw new ArenaError("CAMPAIGN_ALREADY_ACTIVE", "The arena campaign is already active.", 409);
      const next = createInitialState();
      next.campaign = { id: `campaign-${crypto.randomUUID()}`, status: "ACTIVE", startedAt: iso(now), endsAt: iso(now + ARENA_CONFIG.campaignDurationSeconds * 1000), completedAt: null, durationSeconds: ARENA_CONFIG.campaignDurationSeconds, maximumRounds: ARENA_CONFIG.maximumRounds };
      next.round = deriveRound(next.campaign, now); await txn.put(STATE_KEY, next); return next;
    });
    await this.ctx.storage.setAlarm(now + 1000);
    return this.buildArenaPayload(state, false);
  }

  async resetCampaign(confirmation) {
    if (confirmation !== "RESET_ARENA") throw new ArenaError("INVALID_CONFIRMATION", "Reset requires confirm: RESET_ARENA.");
    const state = createInitialState(); state.resetAt = new Date().toISOString(); await this.ctx.storage.put(STATE_KEY, state); await this.ctx.storage.deleteAlarm();
    return { ok: true, resetAt: state.resetAt, campaign: state.campaign };
  }

  async alarm() {
    const now=Date.now();
    try {
      let state=await this.loadAndReconcile();
      if(state.campaign.status!=="ACTIVE")return;
      const assets=await new OpportunityEngineMarketProvider(this.env).getMarketContext();
      state=await this.updateMarketAndActivities(state,assets,now);
      for(const agentId of ARENA_CONFIG.agents)await this.runAgentDecision(agentId,assets,now);
    } catch(error) {
      await this.recordOrchestratorFailure(error,now);
      console.error(JSON.stringify({event:"arena_agent_cycle_error",message:error instanceof Error?error.message:"Unknown error"}));
    } finally {
      const latest=await this.ctx.storage.get(STATE_KEY);
      if(latest?.campaign?.status==="ACTIVE")await this.ctx.storage.setAlarm(Date.now()+AGENT_CADENCE_MS);
    }
  }

  async settle() { const state = await this.markState(await this.loadAndReconcile(), true); return this.buildArenaPayload(state, false); }

  async submitOrder(input, requestId) {
    validateOrderShape(input);
    const initial = await this.loadAndReconcile(); assertActive(initial); const fingerprint=orderFingerprint(input); if(initial.idempotency[input.idempotencyKey])return resolveIdempotency(initial.idempotency[input.idempotencyKey],fingerprint);
    const quote = await new OpportunityEngineMarketProvider(this.env).getMarketQuote(input.productId);
    return this.executeOrderWithQuote(input,quote,requestId);
  }

  async executeOrderWithQuote(input,quote,requestId) {
    validateOrderShape(input);
    const fingerprint=orderFingerprint(input),model=executionModel(this.env),now=Date.now();
    return this.ctx.storage.transaction(async txn => {
      const state = reconcileState((await txn.get(STATE_KEY)) || createInitialState(), now); assertActive(state);
      if (state.idempotency[input.idempotencyKey]) return resolveIdempotency(state.idempotency[input.idempotencyKey], fingerprint);
      assertQuoteFresh(quote, maximumQuoteAgeSeconds(this.env));
      const account = state.agents[input.agentId], orderNumber = state.sequence.nextOrderNumber++, orderId = `order-${String(orderNumber).padStart(8, "0")}`;
      const result = input.side === "BUY" ? executeBuy(state, account, input, quote, model, orderId, now) : executeSell(state, account, input, quote, model, orderId, now);
      state.idempotency[input.idempotencyKey] = { fingerprint, result };
      await txn.put(STATE_KEY, state);
      console.log(JSON.stringify({ event: "arena_order", requestId, campaignId: state.campaign.id, agent: input.agentId, orderId, tradeId: result.trade?.tradeId || null, outcome: "FILLED" }));
      return result;
    });
  }

  async updateMarketAndActivities(state,assets,now){
    const previous=state.market?.assets||{},bounded={};
    for(const [id,asset] of Object.entries(assets)){const series=[...(previous[id]?.recentPrices||[]),asset.price].slice(-24);bounded[id]={price:asset.price,changePercent:asset.changePercent,updatedAt:asset.sourceTimestamp,recentPrices:series};}
    state.market={status:"live",updatedAt:new Date(now).toISOString(),source:"RA-FI Opportunity Engine",assets:bounded};
    for(const id of ARENA_CONFIG.agents)state.agents[id].activity={...(state.agents[id].activity||defaultActivity()),status:"EVALUATING ASSET",message:"Reviewing shared live market context",updatedAt:new Date(now).toISOString()};
    await this.ctx.storage.put(STATE_KEY,state);return state;
  }

  async runAgentDecision(agentId,assets,now){
    let state=await this.loadAndReconcile();if(state.campaign.status!=="ACTIVE")return;
    const bucket=Math.floor(now/AGENT_CADENCE_MS),decisionId=`${state.campaign.id}:${state.round.number}:${bucket}:${agentId}`,activity=state.agents[agentId].activity||defaultActivity();
    if(activity.decisionSequenceId===decisionId)return;
    const decision=validateAgentDecision(AGENT_REGISTRY[agentId].decide({agent:state.agents[agentId],assets,round:state.round,campaign:state.campaign,uatMode:this.env.ARENA_UAT_MODE==="true"}));
    activity.decisionSequenceId=decisionId;activity.decision=decision;activity.confidence=decision.confidence;activity.allocationPercent=decision.allocationPercent;activity.selectedProductId=decision.productId;activity.updatedAt=new Date(now).toISOString();activity.message=decision.reasonCode;
    if(decision.action==="HOLD"){activity.status=Object.keys(state.agents[agentId].positions).length?"MONITORING POSITION":"SCANNING MARKET";state.agents[agentId].activity=activity;await this.ctx.storage.put(STATE_KEY,state);return;}
    activity.status=decision.action==="BUY"?"PREPARING ORDER":"EXECUTING SELL";state.agents[agentId].activity=activity;await this.ctx.storage.put(STATE_KEY,state);
    const asset=assets[decision.productId];if(!asset)return;
    const input={agentId,side:decision.action,productId:decision.productId,idempotencyKey:`agent-${decisionId.replace(/[^A-Za-z0-9._:-]/g,"-")}`,...(decision.action==="BUY"?{allocationPercent:decision.allocationPercent}:{positionPercent:decision.positionPercent})};
    try{const result=await this.executeOrderWithQuote(input,{productId:decision.productId,price:asset.price,observedAt:new Date(now).toISOString(),sourceTimestamp:asset.sourceTimestamp,ageSeconds:Math.max(0,(now-Date.parse(asset.sourceTimestamp))/1000),source:"RA-FI Opportunity Engine",stale:false,endpoint:asset.endpoint},decisionId);state=await this.loadAndReconcile();const next=state.agents[agentId].activity||activity;next.status=decision.action==="BUY"?"POSITION OPEN":"TRADE CLOSED";next.message=decision.action==="BUY"?"Worker accepted autonomous market buy":"Worker accepted autonomous market sell";next.activeOrderId=result.order.orderId;next.updatedAt=new Date().toISOString();state.agents[agentId].activity=next;await this.ctx.storage.put(STATE_KEY,state);}catch(error){state=await this.loadAndReconcile();const next=state.agents[agentId].activity||activity;next.status="ORDER REVIEW";next.message=error instanceof Error?error.message:"Order rejected";next.updatedAt=new Date().toISOString();state.agents[agentId].activity=next;await this.ctx.storage.put(STATE_KEY,state);}
  }

  async recordOrchestratorFailure(error,now){const state=await this.loadAndReconcile(),detail=error instanceof Error?error.message:"Unknown market-context error";state.market={...(state.market||{}),status:"degraded",errorCode:error?.code||"MARKET_CONTEXT_ERROR"};for(const id of ARENA_CONFIG.agents){const activity=state.agents[id].activity||defaultActivity();activity.status=Object.keys(state.agents[id].positions).length?"MONITORING POSITION":"SCANNING MARKET";activity.message=`Market intelligence unavailable: ${detail}`;activity.updatedAt=new Date(now).toISOString();state.agents[id].activity=activity;}await this.ctx.storage.put(STATE_KEY,state);}

  async loadAndReconcile() {
    const stored = (await this.ctx.storage.get(STATE_KEY)) || createInitialState(), state = reconcileState(stored, Date.now());
    if (JSON.stringify(stored.campaign) !== JSON.stringify(state.campaign) || JSON.stringify(stored.round) !== JSON.stringify(state.round)) await this.ctx.storage.put(STATE_KEY, state);
    return state;
  }

  async markState(state, persist = false) {
    const provider = new OpportunityEngineMarketProvider(this.env), model = executionModel(this.env), symbols = [...new Set(ARENA_CONFIG.agents.flatMap(id => Object.keys(state.agents[id].positions)))];
    let degraded = false, newest = null;
    const quotes = new Map();
    await Promise.all(symbols.map(async symbol => { try { const quote = await provider.getMarketQuote(symbol); quotes.set(symbol, quote); newest = quote.observedAt; } catch { degraded = true; } }));
    for (const id of ARENA_CONFIG.agents) {
      const account = state.agents[id]; let positionValue = 0, unrealized = 0;
      for (const position of Object.values(account.positions)) {
        const quote = quotes.get(position.symbol), price = quote?.price || position.lastMarkPrice || position.averageEntryPrice;
        position.lastMarkPrice = price; position.lastUpdatedAt = quote?.observedAt || position.lastUpdatedAt;
        const value = conservativeLiquidationValue(price, position.quantity, model); positionValue += value; unrealized += value - position.totalCostBasisUsd;
      }
      account.metrics.unrealizedNetProfitUsd = roundMoney(unrealized); account.accountEquityUsd = roundMoney(account.cashUsd + positionValue);
      if (account.accountEquityUsd <= ARENA_CONFIG.wipeoutThresholdUsd && !account.wipedOut) { account.wipedOut = true; account.metrics.wipeouts++; }
    }
    calculateScores(state.agents); state.market = { ...state.market, status: degraded ? "degraded" : "live", updatedAt: newest||state.market?.updatedAt||null, source: "RA-FI Opportunity Engine" };
    if (persist) await this.ctx.storage.put(STATE_KEY, state); return state;
  }

  async buildArenaPayload(state, mark) {
    if (mark) state = await this.markState(state, true);
    return { ok: true, service: SERVICE, version: VERSION, simulation: true, serverTime: new Date().toISOString(), campaign: campaignView(state.campaign), round: state.round, scoreboard: scoreboardPayload(state), agents: state.agents, recentTrades: state.trades.slice(-ARENA_CONFIG.recentTradeLimit).reverse(), market: state.market, executionModel: executionModel(this.env) };
  }
}

function createInitialState() {
  return { campaign: { id: null, status: "NOT_STARTED", startedAt: null, endsAt: null, completedAt: null, durationSeconds: ARENA_CONFIG.campaignDurationSeconds, maximumRounds: ARENA_CONFIG.maximumRounds }, round: { number: 0, startedAt: null, endsAt: null, durationSeconds: ARENA_CONFIG.roundDurationSeconds, status: "PENDING", remainingSeconds: ARENA_CONFIG.roundDurationSeconds, progressPercent: 0 }, agents: Object.fromEntries(ARENA_CONFIG.agents.map(id => [id, createAgent(id)])), trades: [], idempotency: {}, sequence: { nextOrderNumber: 1, nextTradeNumber: 1 }, market: { status: "unavailable", updatedAt: null, source: "RA-FI Opportunity Engine" } };
}
function createAgent(id) { return { id, startingBalanceUsd: ARENA_CONFIG.startingBalanceUsd, cashUsd: ARENA_CONFIG.startingBalanceUsd, accountEquityUsd: ARENA_CONFIG.startingBalanceUsd, positions: {}, wipedOut: false, activity: defaultActivity(), metrics: { completedTrades: 0, winningTrades: 0, losingTrades: 0, breakEvenTrades: 0, grossProfitUsd: 0, grossLossUsd: 0, realizedNetProfitUsd: 0, unrealizedNetProfitUsd: 0, winRatePercent: 0, successfulTrades: 0, profitableUniqueAssets: [], biggestSingleWinnerPercent: 0, biggestSingleWinnerTradeId: null, wipeouts: 0 }, score: { total: 50, netProfit: 25, winRate: 10, successfulTrades: 7.5, marketIntelligence: 3.75, biggestSingleWinner: 3.75 } }; }
function defaultActivity(){return {status:"SCANNING MARKET",message:"Awaiting active campaign",selectedProductId:"BTC-USD",decision:null,confidence:0,allocationPercent:null,updatedAt:null,activeOrderId:null,decisionSequenceId:null};}

function assertActive(state) { if (state.campaign.status !== "ACTIVE") throw new ArenaError("CAMPAIGN_NOT_ACTIVE", "The arena campaign is not active.", 409); if (state.round.status !== "ACTIVE") throw new ArenaError("ROUND_NOT_ACTIVE", "The current round is not active.", 409); }
function validateOrderShape(input) { if (!input || typeof input !== "object") throw new ArenaError("INVALID_AMOUNT", "Order body is required."); if (!ARENA_CONFIG.agents.includes(input.agentId)) throw new ArenaError("INVALID_AGENT", "Supported agents are CODY and ATLAS."); if (!ARENA_CONFIG.supportedProducts.includes(input.productId)) throw new ArenaError("INVALID_PRODUCT", "The requested product is unsupported."); if (!['BUY','SELL'].includes(input.side)) throw new ArenaError("INVALID_SIDE", "Side must be BUY or SELL."); if (typeof input.idempotencyKey !== "string" || !/^[A-Za-z0-9._:-]{8,128}$/.test(input.idempotencyKey)) throw new ArenaError("INVALID_IDEMPOTENCY_KEY", "A valid idempotency key is required."); const buyInputs = [input.allocationPercent, input.amountUsd].filter(v => v !== undefined); if (input.side === "BUY" && buyInputs.length !== 1) throw new ArenaError("INVALID_AMOUNT", "BUY requires exactly one allocationPercent or amountUsd."); if (input.side === "SELL" && (input.positionPercent === undefined || input.allocationPercent !== undefined || input.amountUsd !== undefined)) throw new ArenaError("INVALID_AMOUNT", "SELL requires positionPercent only."); }

function executeBuy(state, account, input, quote, model, orderId, now) {
  if (account.wipedOut) throw new ArenaError("AGENT_WIPED_OUT", `${account.id} is not eligible for additional buys during this campaign.`, 409);
  const feeRate = model.feeRateBps / 10000, percent = Number(input.allocationPercent), requested = input.amountUsd !== undefined ? Number(input.amountUsd) : account.cashUsd * percent / 100 / (1 + feeRate);
  if (!finite(requested) || requested <= 0 || (input.allocationPercent !== undefined && (!finite(percent) || percent <= 0 || percent > 100))) throw new ArenaError("INVALID_AMOUNT", "Buy amount is invalid.");
  const execution = calculateBuyExecution(quote.price, requested, model), { fillPrice, feeUsd: fee, totalCashDebitUsd: debit, quantity } = execution;
  if (debit > account.cashUsd + 1e-8) throw new ArenaError("INSUFFICIENT_CASH", `${account.id} does not have enough available cash for this order.`, 409);
  const existing = account.positions[input.productId], oldQty = existing?.quantity || 0;
  const position = existing || { symbol: input.productId, quantity: 0, averageEntryPrice: 0, totalCostBasisUsd: 0, totalEntryFeesUsd: 0, openedAt: iso(now), lastUpdatedAt: iso(now), lastMarkPrice: quote.price };
  position.quantity = roundMoney(oldQty + quantity); position.averageEntryPrice = roundMoney(weightedAverageEntry(oldQty, existing?.averageEntryPrice || 0, quantity, requested)); position.totalCostBasisUsd = roundMoney(position.totalCostBasisUsd + requested + fee); position.totalEntryFeesUsd = roundMoney(position.totalEntryFeesUsd + fee); position.lastUpdatedAt = iso(now); position.lastMarkPrice = quote.price;
  account.cashUsd = roundMoney(account.cashUsd - debit); account.positions[input.productId] = position; account.accountEquityUsd = roundMoney(account.cashUsd + Object.values(account.positions).reduce((sum, p) => sum + conservativeLiquidationValue(p.lastMarkPrice || p.averageEntryPrice, p.quantity, model), 0)); calculateScores(state.agents);
  return { ok: true, order: { orderId, status: "FILLED", agentId: account.id, side: "BUY", productId: input.productId, referencePrice: quote.price, fillPrice, grossNotionalUsd: requested, feeUsd: fee, quantity, filledAt: iso(now), quote, executionModel: model }, trade: null, agent: account, scoreboard: scoreboardPayload(state) };
}
function executeSell(state, account, input, quote, model, orderId, now) {
  const percent = Number(input.positionPercent), position = account.positions[input.productId];
  if (!finite(percent) || percent <= 0 || percent > 100) throw new ArenaError("INVALID_AMOUNT", "Position percentage must be greater than zero and at most 100.");
  if (!position || position.quantity <= 0) throw new ArenaError("INSUFFICIENT_POSITION", `${account.id} has no ${input.productId} position to sell.`, 409);
  const quantity = position.quantity * percent / 100;
  if (quantity > position.quantity + 1e-12) throw new ArenaError("INSUFFICIENT_POSITION", `${account.id} cannot sell more than the current position.`, 409);
  const execution = calculateSellExecution(quote.price, quantity, model), { fillPrice, grossProceedsUsd: gross, feeUsd: fee, netProceedsUsd: net } = execution, ratio = quantity / position.quantity, allocatedCost = position.totalCostBasisUsd * ratio, entryFees = position.totalEntryFeesUsd * ratio, entryNotional = allocatedCost - entryFees, realized = net - allocatedCost, returnPercent = allocatedCost > 0 ? realized / allocatedCost * 100 : 0;
  const tradeId = `trade-${String(state.sequence.nextTradeNumber++).padStart(8, "0")}`, classification = classifyTrade(realized);
  const trade = { tradeId, orderId, campaignId: state.campaign.id, roundNumber: state.round.number, agentId: account.id, productId: input.productId, entryPrice: entryNotional / quantity, exitPrice: fillPrice, quantity, entryNotionalUsd: entryNotional, exitNotionalUsd: gross, entryFeesUsd: entryFees, exitFeesUsd: fee, totalFeesUsd: entryFees + fee, realizedNetProfitUsd: realized, realizedNetReturnPercent: returnPercent, openedAt: position.openedAt, closedAt: iso(now), holdingSeconds: Math.max(0, Math.floor((now - Date.parse(position.openedAt)) / 1000)), classification, quoteSource: quote.source, executionModelVersion: model.version };
  account.cashUsd = roundMoney(account.cashUsd + net); position.quantity = roundMoney(position.quantity - quantity); position.totalCostBasisUsd = roundMoney(position.totalCostBasisUsd - allocatedCost); position.totalEntryFeesUsd = roundMoney(position.totalEntryFeesUsd - entryFees); position.lastUpdatedAt = iso(now); position.lastMarkPrice = quote.price;
  if (position.quantity <= 1e-10) delete account.positions[input.productId];
  updateMetrics(account.metrics, trade); state.trades.push(trade); account.accountEquityUsd = roundMoney(account.cashUsd + Object.values(account.positions).reduce((sum, p) => sum + conservativeLiquidationValue(p.lastMarkPrice || p.averageEntryPrice, p.quantity, model), 0)); calculateScores(state.agents);
  return { ok: true, order: { orderId, status: "FILLED", agentId: account.id, side: "SELL", productId: input.productId, referencePrice: quote.price, fillPrice, grossNotionalUsd: gross, feeUsd: fee, quantity, filledAt: iso(now), quote, executionModel: model }, trade, agent: account, scoreboard: scoreboardPayload(state) };
}
function updateMetrics(metrics, trade) { metrics.completedTrades++; if (trade.classification === "WIN") { metrics.winningTrades++; metrics.grossProfitUsd = roundMoney(metrics.grossProfitUsd + trade.realizedNetProfitUsd); if (!metrics.profitableUniqueAssets.includes(trade.productId)) metrics.profitableUniqueAssets.push(trade.productId); if (trade.realizedNetReturnPercent > metrics.biggestSingleWinnerPercent) { metrics.biggestSingleWinnerPercent = trade.realizedNetReturnPercent; metrics.biggestSingleWinnerTradeId = trade.tradeId; } } else if (trade.classification === "LOSS") { metrics.losingTrades++; metrics.grossLossUsd = roundMoney(metrics.grossLossUsd + Math.abs(trade.realizedNetProfitUsd)); } else metrics.breakEvenTrades++; metrics.successfulTrades = metrics.winningTrades + metrics.breakEvenTrades; metrics.realizedNetProfitUsd = roundMoney(metrics.grossProfitUsd - metrics.grossLossUsd); metrics.winRatePercent = metrics.completedTrades ? metrics.winningTrades / metrics.completedTrades * 100 : 0; }
function scoreboardPayload(state) { calculateScores(state.agents); const point = value => Math.round(value * 10) / 10, agents = Object.fromEntries(ARENA_CONFIG.agents.map(id => { const a = state.agents[id], m = a.metrics; return [id, { totalPoints: point(a.score.total), balanceUsd: a.accountEquityUsd, trades: m.completedTrades, profitsUsd: m.grossProfitUsd, lossesUsd: m.grossLossUsd, wipeouts: m.wipeouts, categories: { netProfit: point(a.score.netProfit), winRate: point(a.score.winRate), successfulTrades: point(a.score.successfulTrades), marketIntelligence: point(a.score.marketIntelligence), biggestSingleWinner: point(a.score.biggestSingleWinner) } }]; })); return { ok: true, serverTime: new Date().toISOString(), scoringVersion: "1.0.0", maximumPoints: 100, agents, leader: state.agents.CODY.score.total === state.agents.ATLAS.score.total ? "TIE" : state.agents.CODY.score.total > state.agents.ATLAS.score.total ? "CODY" : "ATLAS" }; }

function orderFingerprint(input) {
  return JSON.stringify({ agentId: input.agentId, side: input.side, productId: input.productId, allocationPercent: input.allocationPercent ?? null, amountUsd: input.amountUsd ?? null, positionPercent: input.positionPercent ?? null });
}
function resolveIdempotency(record, fingerprint) {
  if (record && record.fingerprint) {
    if (record.fingerprint !== fingerprint) throw new ArenaError("IDEMPOTENCY_KEY_REUSED", "The idempotency key was already used for a different order.", 409);
    return record.result;
  }
  return record;
}
function assertQuoteFresh(quote, maximumAgeSeconds) {
  const sourceTime = Date.parse(quote?.sourceTimestamp || "");
  if (!Number.isFinite(sourceTime)) throw new ArenaError("PRICE_UNAVAILABLE", "The quote has no valid source timestamp.", 503);
  const ageSeconds = Math.max(0, (Date.now() - sourceTime) / 1000);
  if (ageSeconds > maximumAgeSeconds) throw new ArenaError("STALE_QUOTE", `The quote became stale before execution (${Math.round(ageSeconds)} seconds old).`, 409);
}

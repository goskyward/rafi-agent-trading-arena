import { DurableObject } from "cloudflare:workers";
import { ARENA_CONFIG, SERVICE, VERSION, executionModel, maximumQuoteAgeSeconds } from "./config.js";
import { OpportunityEngineMarketProvider } from "./market-provider.js";
import { calculateScores } from "./scoring.js";
import { calculateBuyExecution, calculateSellExecution, classifyTrade, conservativeLiquidationValue, weightedAverageEntry } from "./execution-math.js";
import { ArenaError, finite, iso, roundMoney } from "./utils.js";
import { campaignView, deriveRound, reconcileState } from "./clocks.js";
import { AGENT_REGISTRY, STRATEGY_VERSIONS, validateAgentDecision } from "./strategies.js";
import { boardAuthorizesBuys, finalizeResolvableBoard, findActiveOpportunity, isExactCoinbaseUsdProduct } from "./opportunity-contract.js";

const STATE_KEY = "arena-state-v1";
const AGENT_CADENCE_MS = 15000;

export class ArenaController extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.env = env;
    this.ctx.blockConcurrencyWhile(async () => {
      initializeAuditSchema(this.ctx.storage.sql);
      if (!(await this.ctx.storage.get(STATE_KEY))) await this.ctx.storage.put(STATE_KEY, createInitialState());
    });
  }

  async health() { return { available: true, objectId: this.ctx.id.toString(), storage: "sqlite" }; }
  async getArena() { return this.buildArenaPayload(await this.loadAndReconcile(), true); }
  async getScoreboard() { const state = await this.markState(await this.loadAndReconcile(), true); return scoreboardPayload(state); }
  async getAgents() { const state = await this.markState(await this.loadAndReconcile(), true); return { ok: true, serverTime: new Date().toISOString(), agents: publicAgents(state.agents) }; }
  async getPositions() { const state = await this.markState(await this.loadAndReconcile(), true); return { ok: true, serverTime: new Date().toISOString(), positions: Object.fromEntries(ARENA_CONFIG.agents.map(id => [id, Object.values(state.agents[id].positions).map(publicPosition)])) }; }
  async getTrades() { const state = await this.loadAndReconcile(); return { ok: true, serverTime: new Date().toISOString(), count: state.trades.length, trades: [...state.trades].reverse().map(publicTrade) }; }
  async getAuditSummary(){const counts={};for(const table of ["opportunity_scans","opportunity_records","agent_decisions","decision_outcomes"]){counts[table]=this.ctx.storage.sql.exec(`SELECT COUNT(*) AS count FROM ${table}`).one().count;}const decisions=Object.fromEntries(this.ctx.storage.sql.exec("SELECT decision, COUNT(*) AS count FROM agent_decisions GROUP BY decision").toArray().map(row=>[row.decision,row.count]));return {ok:true,counts,decisions};}

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
      const provider=new OpportunityEngineMarketProvider(this.env);
      const heldProducts=ARENA_CONFIG.agents.flatMap(id=>Object.keys(state.agents[id].positions));
      let accepted,assets;
      try{const candidate=await provider.getOpportunityBoard();assets=await provider.getMarketContext(candidate.board,heldProducts);accepted=await this.acceptOpportunityBoard({...candidate,...await finalizeResolvableBoard(candidate.board,assets,candidate.rejectionCodes)},now);}catch(error){const retained=state.opportunity?.activeBoard;if(!retained)throw error;accepted={board:retained,rejectionCodes:[]};assets=await provider.getMarketContext(retained,heldProducts);}
      state=await this.loadAndReconcile();
      state=await this.updateMarketAndActivities(state,assets,accepted.board,now);
      for(const agentId of ARENA_CONFIG.agents)await this.runAgentDecision(agentId,assets,accepted.board,now);
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
      const account = state.agents[input.agentId];
      if(input.side==="BUY"){
        if(Object.keys(account.positions).length)throw new ArenaError("POSITION_ALREADY_OPEN","One open position per agent is allowed.",409);
        const opportunity=findActiveOpportunity(state.opportunity?.activeBoard,input.opportunityId,input.productId,now);
        if(!opportunity)throw new ArenaError("OPPORTUNITY_NOT_ACTIVE","BUY requires an active, unexpired, tradable opportunity.",409);
      }
      const orderNumber = state.sequence.nextOrderNumber++, orderId = `order-${String(orderNumber).padStart(8, "0")}`;
      const result = input.side === "BUY" ? executeBuy(state, account, input, quote, model, orderId, now) : executeSell(state, account, input, quote, model, orderId, now);
      state.idempotency[input.idempotencyKey] = { fingerprint, result };
      await txn.put(STATE_KEY, state);
      console.log(JSON.stringify({ event: "arena_order", requestId, campaignId: state.campaign.id, agent: input.agentId, orderId, tradeId: result.trade?.tradeId || null, outcome: "FILLED" }));
      return result;
    });
  }

  async acceptOpportunityBoard(result,now){
    const {board,rejectionCodes,raw}=result;
    const receivedAt=iso(now);
    this.ctx.storage.sql.exec(`INSERT OR IGNORE INTO opportunity_scans
      (scan_cycle_id,contract_version,engine_version,generated_at,received_at,expires_at,board_status,board_hash,source,evaluated_asset_count,qualified_asset_count,accepted_opportunity_count,rejected_opportunity_count,validation_result,normalized_board_snapshot,raw_validated_snapshot,scoring_mode,scoring_notice,cache_state,stale_state,rejection_codes)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,board.scanCycleId,board.contractVersion,board.engineVersion,board.generatedAt,receivedAt,board.expiresAt,board.boardStatus,board.boardHash,board.source,board.evaluatedAssetCount,board.qualifiedAssetCount,board.opportunities.length,rejectionCodes.length,"ACCEPTED",JSON.stringify(board),JSON.stringify(raw),board.scoringMode,board.scoringNotice,board.cacheState,board.staleState?1:0,JSON.stringify(rejectionCodes.slice(0,50)));
    for(const item of board.opportunities)this.ctx.storage.sql.exec(`INSERT OR IGNORE INTO opportunity_records
      (opportunity_id,scan_cycle_id,board_hash,product_id,venue,rank,opportunity_score,confidence,reference_price,reference_price_observed_at,generated_at,expires_at,intended_horizon_seconds,tradability,market_direction,signal,signals,risk_flags,qualified,engine_version,raw_accepted_fields)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,item.opportunityId,item.scanCycleId,board.boardHash,item.productId,item.venue,item.rank,item.opportunityScore,item.confidence,item.referencePrice,item.referencePriceObservedAt,item.generatedAt,item.expiresAt,item.intendedHorizonSeconds,item.tradability,item.marketDirection,item.signal,JSON.stringify(item.signals),JSON.stringify(item.riskFlags),item.qualified?1:0,item.engineVersion,JSON.stringify(item));
    const state=await this.loadAndReconcile();
    if(board.boardStatus==="INVALID")throw new ArenaError("INVALID_OPPORTUNITY_BOARD","INVALID boards cannot become active.",502);
    if(board.boardStatus==="STALE"){state.opportunity={...(state.opportunity||{}),lastInspectionBoard:board,lastError:"STALE_BOARD"};}
    else state.opportunity={activeBoard:board,lastAcceptedAt:receivedAt,lastError:null};
    await this.ctx.storage.put(STATE_KEY,state);
    return {board,rejectionCodes};
  }

  async updateMarketAndActivities(state,assets,board,now){
    const previous=state.market?.assets||{},bounded={};
    for(const [id,asset] of Object.entries(assets)){const series=[...(previous[id]?.recentPrices||[]),asset.price].slice(-24);bounded[id]={price:asset.price,changePercent:asset.changePercent,updatedAt:asset.sourceTimestamp,recentPrices:series};}
    state.market={status:"live",updatedAt:new Date(now).toISOString(),source:"RA-FI Opportunity Engine",assets:bounded,boardStatus:board.boardStatus};
    for(const id of ARENA_CONFIG.agents)state.agents[id].activity={...(state.agents[id].activity||defaultActivity()),status:"EVALUATING ASSET",message:"Reviewing shared live market context",updatedAt:new Date(now).toISOString()};
    await this.ctx.storage.put(STATE_KEY,state);return state;
  }

  async runAgentDecision(agentId,assets,board,now){
    let state=await this.loadAndReconcile();if(state.campaign.status!=="ACTIVE")return;
    const bucket=Math.floor(now/AGENT_CADENCE_MS),sequenceId=`${state.campaign.id}:${state.round.number}:${bucket}:${agentId}`,activity=state.agents[agentId].activity||defaultActivity();
    if(activity.decisionSequenceId===sequenceId)return;
    const evaluated=board.opportunities.map(item=>item.opportunityId);
    let decision;
    if(!boardAuthorizesBuys(board,now)&&!Object.keys(state.agents[agentId].positions).length)decision={decision:"PASS",productId:null,selectedOpportunityId:null,allocation:null,reasonCode:`BOARD_${board.boardStatus}`,confidence:100};
    else decision=validateAgentDecision(AGENT_REGISTRY[agentId].decide({agent:state.agents[agentId],opportunities:board.opportunities,assets,round:state.round,campaign:state.campaign,uatMode:this.env.ARENA_UAT_MODE==="true"}));
    const decisionId=`decision-${crypto.randomUUID()}`,record={decisionId,campaignId:state.campaign.id,roundNumber:state.round.number,agentId,strategyVersion:STRATEGY_VERSIONS[agentId],scanCycleId:board.scanCycleId,boardHash:board.boardHash,evaluatedOpportunityIds:evaluated,selectedOpportunityId:decision.selectedOpportunityId,decision:decision.decision,allocation:decision.allocation,agentConfidence:decision.confidence,reasonCode:decision.reasonCode,reasonDetail:null,decidedAt:iso(now),executionStatus:"NOT_REQUESTED",orderId:null};
    this.storeDecision(record);
    activity.decisionSequenceId=sequenceId;activity.decision={decision:decision.decision,productId:decision.productId};activity.confidence=decision.confidence;activity.allocationPercent=decision.allocation?.value??null;activity.selectedProductId=decision.productId;activity.updatedAt=iso(now);activity.message=decision.reasonCode;
    if(["PASS","MANAGE_POSITION"].includes(decision.decision)){this.storeNoExecutionOutcome(record);activity.status=decision.decision==="MANAGE_POSITION"?"MONITORING POSITION":"SCANNING MARKET";state.agents[agentId].activity=activity;await this.ctx.storage.put(STATE_KEY,state);return;}
    activity.status=decision.decision==="TRADE"?"PREPARING ORDER":"EXECUTING SELL";state.agents[agentId].activity=activity;await this.ctx.storage.put(STATE_KEY,state);
    const asset=assets[decision.productId];if(!asset){this.updateDecisionExecution(decisionId,"QUOTE_UNAVAILABLE",null);return;}
    const input={agentId,side:decision.decision==="TRADE"?"BUY":"SELL",productId:decision.productId,opportunityId:decision.selectedOpportunityId,scanCycleId:board.scanCycleId,boardHash:board.boardHash,decisionId,strategyVersion:STRATEGY_VERSIONS[agentId],idempotencyKey:`agent-${sequenceId.replace(/[^A-Za-z0-9._:-]/g,"-")}`,...(decision.decision==="TRADE"?{allocationPercent:decision.allocation.value}:{positionPercent:decision.positionPercent})};
    try{const result=await this.executeOrderWithQuote(input,asset,decisionId);this.updateDecisionExecution(decisionId,"FILLED",result.order.orderId);if(result.trade)this.storeOutcome(result.trade);else this.storePendingOutcome(result.order,input);state=await this.loadAndReconcile();const next=state.agents[agentId].activity||activity;next.status=input.side==="BUY"?"POSITION OPEN":"TRADE CLOSED";next.message=input.side==="BUY"?"Worker accepted autonomous market buy":"Worker accepted autonomous market sell";next.activeOrderId=result.order.orderId;next.updatedAt=new Date().toISOString();state.agents[agentId].activity=next;await this.ctx.storage.put(STATE_KEY,state);}catch(error){this.updateDecisionExecution(decisionId,`REJECTED:${error?.code||"ERROR"}`,null);state=await this.loadAndReconcile();const next=state.agents[agentId].activity||activity;next.status="ORDER REVIEW";next.message=error instanceof Error?error.message:"Order rejected";next.updatedAt=new Date().toISOString();state.agents[agentId].activity=next;await this.ctx.storage.put(STATE_KEY,state);}
  }

  storeDecision(record){this.ctx.storage.sql.exec(`INSERT INTO agent_decisions (decision_id,campaign_id,round_number,agent_id,strategy_version,scan_cycle_id,board_hash,evaluated_opportunity_ids,selected_opportunity_id,decision,allocation,agent_confidence,reason_code,reason_detail,decided_at,execution_status,order_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,record.decisionId,record.campaignId,record.roundNumber,record.agentId,record.strategyVersion,record.scanCycleId,record.boardHash,JSON.stringify(record.evaluatedOpportunityIds),record.selectedOpportunityId,record.decision,record.allocation?JSON.stringify(record.allocation):null,record.agentConfidence,record.reasonCode,record.reasonDetail,record.decidedAt,record.executionStatus,record.orderId);}
  updateDecisionExecution(decisionId,status,orderId){this.ctx.storage.sql.exec("UPDATE agent_decisions SET execution_status = ?, order_id = ? WHERE decision_id = ?",status,orderId,decisionId);}
  storePendingOutcome(order,input){this.ctx.storage.sql.exec(`INSERT OR REPLACE INTO decision_outcomes (decision_id,opportunity_id,order_id,trade_id,entry_timestamp,entry_quote,quantity,gross_entry,fees,spread,slippage,classification,execution_model_version,close_reason) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,input.decisionId,input.opportunityId,order.orderId,null,order.filledAt,order.fillPrice,order.quantity,order.grossNotionalUsd,order.feeUsd,executionModel(this.env).syntheticSpreadBps,executionModel(this.env).slippageBps,"N_A",executionModel(this.env).version,"POSITION_OPEN");}
  storeNoExecutionOutcome(record){this.ctx.storage.sql.exec(`INSERT OR REPLACE INTO decision_outcomes (decision_id,opportunity_id,classification,execution_model_version,close_reason) VALUES (?,?,?,?,?)`,record.decisionId,record.selectedOpportunityId,"N_A",executionModel(this.env).version,record.decision);}
  storeOutcome(trade){this.ctx.storage.sql.exec(`INSERT OR REPLACE INTO decision_outcomes (decision_id,opportunity_id,order_id,trade_id,entry_timestamp,exit_timestamp,entry_quote,exit_quote,quantity,gross_entry,gross_exit,fees,spread,slippage,realized_net_pnl,realized_return,holding_duration_seconds,classification,execution_model_version,close_reason) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,trade.decisionId,trade.opportunityId,trade.orderId,trade.tradeId,trade.openedAt,trade.closedAt,trade.entryPrice,trade.exitPrice,trade.quantity,trade.entryNotionalUsd,trade.exitNotionalUsd,trade.totalFeesUsd,executionModel(this.env).syntheticSpreadBps,executionModel(this.env).slippageBps,trade.realizedNetProfitUsd,trade.realizedNetReturnPercent,trade.holdingSeconds,trade.classification,trade.executionModelVersion,"AGENT_SELL");}

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
    return { ok: true, service: SERVICE, version: VERSION, simulation: true, serverTime: new Date().toISOString(), campaign: campaignView(state.campaign), round: state.round, scoreboard: scoreboardPayload(state), agents: publicAgents(state.agents), recentTrades: state.trades.slice(-ARENA_CONFIG.recentTradeLimit).reverse().map(publicTrade), market: state.market, executionModel: executionModel(this.env) };
  }
}

function createInitialState() {
  return { campaign: { id: null, status: "NOT_STARTED", startedAt: null, endsAt: null, completedAt: null, durationSeconds: ARENA_CONFIG.campaignDurationSeconds, maximumRounds: ARENA_CONFIG.maximumRounds }, round: { number: 0, startedAt: null, endsAt: null, durationSeconds: ARENA_CONFIG.roundDurationSeconds, status: "PENDING", remainingSeconds: ARENA_CONFIG.roundDurationSeconds, progressPercent: 0 }, agents: Object.fromEntries(ARENA_CONFIG.agents.map(id => [id, createAgent(id)])), trades: [], idempotency: {}, sequence: { nextOrderNumber: 1, nextTradeNumber: 1 }, market: { status: "unavailable", updatedAt: null, source: "RA-FI Opportunity Engine" }, opportunity:{activeBoard:null,lastAcceptedAt:null,lastError:null} };
}
function createAgent(id) { return { id, startingBalanceUsd: ARENA_CONFIG.startingBalanceUsd, cashUsd: ARENA_CONFIG.startingBalanceUsd, accountEquityUsd: ARENA_CONFIG.startingBalanceUsd, positions: {}, wipedOut: false, activity: defaultActivity(), metrics: { completedTrades: 0, winningTrades: 0, losingTrades: 0, breakEvenTrades: 0, grossProfitUsd: 0, grossLossUsd: 0, realizedNetProfitUsd: 0, unrealizedNetProfitUsd: 0, winRatePercent: 0, successfulTrades: 0, profitableUniqueAssets: [], biggestSingleWinnerPercent: 0, biggestSingleWinnerTradeId: null, wipeouts: 0 }, score: { total: 50, netProfit: 25, winRate: 10, successfulTrades: 7.5, marketIntelligence: 3.75, biggestSingleWinner: 3.75 } }; }
function defaultActivity(){return {status:"SCANNING MARKET",message:"Awaiting active campaign",selectedProductId:null,decision:null,confidence:0,allocationPercent:null,updatedAt:null,activeOrderId:null,decisionSequenceId:null};}

function assertActive(state) { if (state.campaign.status !== "ACTIVE") throw new ArenaError("CAMPAIGN_NOT_ACTIVE", "The arena campaign is not active.", 409); if (state.round.status !== "ACTIVE") throw new ArenaError("ROUND_NOT_ACTIVE", "The current round is not active.", 409); }
function validateOrderShape(input) { if (!input || typeof input !== "object") throw new ArenaError("INVALID_AMOUNT", "Order body is required."); if (!ARENA_CONFIG.agents.includes(input.agentId)) throw new ArenaError("INVALID_AGENT", "Supported agents are CODY and ATLAS."); if (!isExactCoinbaseUsdProduct(input.productId)) throw new ArenaError("INVALID_PRODUCT", "The requested product must be an exact Coinbase USD spot product."); if (!['BUY','SELL'].includes(input.side)) throw new ArenaError("INVALID_SIDE", "Side must be BUY or SELL."); if (typeof input.idempotencyKey !== "string" || !/^[A-Za-z0-9._:-]{8,128}$/.test(input.idempotencyKey)) throw new ArenaError("INVALID_IDEMPOTENCY_KEY", "A valid idempotency key is required."); const buyInputs = [input.allocationPercent, input.amountUsd].filter(v => v !== undefined); if (input.side === "BUY" && (buyInputs.length !== 1 || typeof input.opportunityId !== "string")) throw new ArenaError("INVALID_AMOUNT", "BUY requires an opportunityId and exactly one allocationPercent or amountUsd."); if (input.side === "SELL" && (input.positionPercent === undefined || input.allocationPercent !== undefined || input.amountUsd !== undefined)) throw new ArenaError("INVALID_AMOUNT", "SELL requires positionPercent only."); }

function executeBuy(state, account, input, quote, model, orderId, now) {
  if (account.wipedOut) throw new ArenaError("AGENT_WIPED_OUT", `${account.id} is not eligible for additional buys during this campaign.`, 409);
  const feeRate = model.feeRateBps / 10000, percent = Number(input.allocationPercent), requested = input.amountUsd !== undefined ? Number(input.amountUsd) : account.cashUsd * percent / 100 / (1 + feeRate);
  if (!finite(requested) || requested <= 0 || (input.allocationPercent !== undefined && (!finite(percent) || percent <= 0 || percent > 100))) throw new ArenaError("INVALID_AMOUNT", "Buy amount is invalid.");
  const execution = calculateBuyExecution(quote.price, requested, model), { fillPrice, feeUsd: fee, totalCashDebitUsd: debit, quantity } = execution;
  if (debit > account.cashUsd + 1e-8) throw new ArenaError("INSUFFICIENT_CASH", `${account.id} does not have enough available cash for this order.`, 409);
  const existing = account.positions[input.productId], oldQty = existing?.quantity || 0;
  const provenance={opportunityId:input.opportunityId,scanCycleId:input.scanCycleId,boardHash:input.boardHash,decisionId:input.decisionId,strategyVersion:input.strategyVersion,executionModelVersion:model.version};
  const position = existing || { symbol: input.productId, quantity: 0, averageEntryPrice: 0, totalCostBasisUsd: 0, totalEntryFeesUsd: 0, openedAt: iso(now), lastUpdatedAt: iso(now), lastMarkPrice: quote.price, ...provenance };
  position.quantity = roundMoney(oldQty + quantity); position.averageEntryPrice = roundMoney(weightedAverageEntry(oldQty, existing?.averageEntryPrice || 0, quantity, requested)); position.totalCostBasisUsd = roundMoney(position.totalCostBasisUsd + requested + fee); position.totalEntryFeesUsd = roundMoney(position.totalEntryFeesUsd + fee); position.lastUpdatedAt = iso(now); position.lastMarkPrice = quote.price;
  account.cashUsd = roundMoney(account.cashUsd - debit); account.positions[input.productId] = position; account.accountEquityUsd = roundMoney(account.cashUsd + Object.values(account.positions).reduce((sum, p) => sum + conservativeLiquidationValue(p.lastMarkPrice || p.averageEntryPrice, p.quantity, model), 0)); calculateScores(state.agents);
  return { ok: true, order: { orderId, status: "FILLED", agentId: account.id, side: "BUY", productId: input.productId, referencePrice: quote.price, fillPrice, grossNotionalUsd: requested, feeUsd: fee, quantity, filledAt: iso(now), quote, executionModel: model, ...provenance }, trade: null, agent: account, scoreboard: scoreboardPayload(state) };
}
function executeSell(state, account, input, quote, model, orderId, now) {
  const percent = Number(input.positionPercent), position = account.positions[input.productId];
  if (!finite(percent) || percent <= 0 || percent > 100) throw new ArenaError("INVALID_AMOUNT", "Position percentage must be greater than zero and at most 100.");
  if (!position || position.quantity <= 0) throw new ArenaError("INSUFFICIENT_POSITION", `${account.id} has no ${input.productId} position to sell.`, 409);
  const quantity = position.quantity * percent / 100;
  if (quantity > position.quantity + 1e-12) throw new ArenaError("INSUFFICIENT_POSITION", `${account.id} cannot sell more than the current position.`, 409);
  const execution = calculateSellExecution(quote.price, quantity, model), { fillPrice, grossProceedsUsd: gross, feeUsd: fee, netProceedsUsd: net } = execution, ratio = quantity / position.quantity, allocatedCost = position.totalCostBasisUsd * ratio, entryFees = position.totalEntryFeesUsd * ratio, entryNotional = allocatedCost - entryFees, realized = net - allocatedCost, returnPercent = allocatedCost > 0 ? realized / allocatedCost * 100 : 0;
  const tradeId = `trade-${String(state.sequence.nextTradeNumber++).padStart(8, "0")}`, classification = classifyTrade(realized);
  const provenance={opportunityId:position.opportunityId,scanCycleId:position.scanCycleId,boardHash:position.boardHash,decisionId:position.decisionId,closeDecisionId:input.decisionId||null,strategyVersion:position.strategyVersion,executionModelVersion:model.version};
  const trade = { tradeId, orderId, campaignId: state.campaign.id, roundNumber: state.round.number, agentId: account.id, productId: input.productId, entryPrice: entryNotional / quantity, exitPrice: fillPrice, quantity, entryNotionalUsd: entryNotional, exitNotionalUsd: gross, entryFeesUsd: entryFees, exitFeesUsd: fee, totalFeesUsd: entryFees + fee, realizedNetProfitUsd: realized, realizedNetReturnPercent: returnPercent, openedAt: position.openedAt, closedAt: iso(now), holdingSeconds: Math.max(0, Math.floor((now - Date.parse(position.openedAt)) / 1000)), classification, quoteSource: quote.source, ...provenance };
  account.cashUsd = roundMoney(account.cashUsd + net); position.quantity = roundMoney(position.quantity - quantity); position.totalCostBasisUsd = roundMoney(position.totalCostBasisUsd - allocatedCost); position.totalEntryFeesUsd = roundMoney(position.totalEntryFeesUsd - entryFees); position.lastUpdatedAt = iso(now); position.lastMarkPrice = quote.price;
  if (position.quantity <= 1e-10) delete account.positions[input.productId];
  updateMetrics(account.metrics, trade); state.trades.push(trade); account.accountEquityUsd = roundMoney(account.cashUsd + Object.values(account.positions).reduce((sum, p) => sum + conservativeLiquidationValue(p.lastMarkPrice || p.averageEntryPrice, p.quantity, model), 0)); calculateScores(state.agents);
  return { ok: true, order: { orderId, status: "FILLED", agentId: account.id, side: "SELL", productId: input.productId, referencePrice: quote.price, fillPrice, grossNotionalUsd: gross, feeUsd: fee, quantity, filledAt: iso(now), quote, executionModel: model, ...provenance }, trade, agent: account, scoreboard: scoreboardPayload(state) };
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

function initializeAuditSchema(sql){
  sql.exec(`CREATE TABLE IF NOT EXISTS opportunity_scans (scan_cycle_id TEXT PRIMARY KEY,contract_version TEXT NOT NULL,engine_version TEXT NOT NULL,generated_at TEXT NOT NULL,received_at TEXT NOT NULL,expires_at TEXT NOT NULL,board_status TEXT NOT NULL,board_hash TEXT NOT NULL,source TEXT NOT NULL,evaluated_asset_count INTEGER NOT NULL,qualified_asset_count INTEGER NOT NULL,accepted_opportunity_count INTEGER NOT NULL,rejected_opportunity_count INTEGER NOT NULL,validation_result TEXT NOT NULL,normalized_board_snapshot TEXT NOT NULL,raw_validated_snapshot TEXT NOT NULL,scoring_mode TEXT,scoring_notice TEXT,cache_state TEXT,stale_state INTEGER NOT NULL,rejection_codes TEXT NOT NULL)`);
  sql.exec(`CREATE TABLE IF NOT EXISTS opportunity_records (opportunity_id TEXT PRIMARY KEY,scan_cycle_id TEXT NOT NULL,board_hash TEXT NOT NULL,product_id TEXT NOT NULL,venue TEXT NOT NULL,rank INTEGER NOT NULL,opportunity_score REAL NOT NULL,confidence REAL NOT NULL,reference_price REAL NOT NULL,reference_price_observed_at TEXT NOT NULL,generated_at TEXT NOT NULL,expires_at TEXT NOT NULL,intended_horizon_seconds INTEGER,tradability TEXT NOT NULL,market_direction TEXT NOT NULL,signal TEXT,signals TEXT NOT NULL,risk_flags TEXT NOT NULL,qualified INTEGER NOT NULL,engine_version TEXT NOT NULL,raw_accepted_fields TEXT NOT NULL)`);
  sql.exec(`CREATE TABLE IF NOT EXISTS agent_decisions (decision_id TEXT PRIMARY KEY,campaign_id TEXT,round_number INTEGER NOT NULL,agent_id TEXT NOT NULL,strategy_version TEXT NOT NULL,scan_cycle_id TEXT NOT NULL,board_hash TEXT NOT NULL,evaluated_opportunity_ids TEXT NOT NULL,selected_opportunity_id TEXT,decision TEXT NOT NULL,allocation TEXT,agent_confidence REAL NOT NULL,reason_code TEXT NOT NULL,reason_detail TEXT,decided_at TEXT NOT NULL,execution_status TEXT NOT NULL,order_id TEXT)`);
  sql.exec(`CREATE TABLE IF NOT EXISTS decision_outcomes (decision_id TEXT PRIMARY KEY,opportunity_id TEXT,order_id TEXT,trade_id TEXT,entry_timestamp TEXT,exit_timestamp TEXT,entry_quote REAL,exit_quote REAL,quantity REAL,gross_entry REAL,gross_exit REAL,fees REAL,spread REAL,slippage REAL,realized_net_pnl REAL,realized_return REAL,holding_duration_seconds INTEGER,classification TEXT NOT NULL,execution_model_version TEXT NOT NULL,close_reason TEXT)`);
  sql.exec("CREATE INDEX IF NOT EXISTS idx_opportunity_records_scan ON opportunity_records(scan_cycle_id)");
  sql.exec("CREATE INDEX IF NOT EXISTS idx_agent_decisions_campaign ON agent_decisions(campaign_id, decided_at)");
}
function publicAgents(agents){return Object.fromEntries(Object.entries(agents).map(([id,agent])=>[id,{...agent,positions:Object.fromEntries(Object.entries(agent.positions||{}).map(([product,position])=>[product,publicPosition(position)]))}]));}
function publicPosition(position){const {boardHash,scanCycleId,decisionId,strategyVersion,executionModelVersion,...publicValue}=position;return publicValue;}
function publicTrade(trade){const {boardHash,scanCycleId,decisionId,closeDecisionId,strategyVersion,...publicValue}=trade;return publicValue;}

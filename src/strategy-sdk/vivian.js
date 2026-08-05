import { ARENA_CONFIG } from "../config.js";
import { candidateConfidence,compatibleCandidates } from "./runtime.js";

export const VIVIAN_METADATA=Object.freeze({
  strategyId:"RAFI_VIVIAN_EDGE_MOMENTUM",
  strategyName:"Vivian Edge-Adjusted Momentum Strategy",
  strategyAuthor:"RA-FI / Cody clean-room build",
  strategyVersion:"VIVIAN_EDGE_MOMENTUM_V1.0.0",
  arenaRulesVersion:"1.1",
  integrationVersion:"1.0.0",
  creationDate:"2026-08-04"
});

const LIMITS=Object.freeze({quoteAgeMs:90000,hardStopPct:-1.6,thesisStopPct:-0.4,profitTargetPct:2.4,profitProtectPct:1.25,maxHoldSeconds:210,minimumCashUsd:5000,maximumSpreadBps:120,maximumVolatilityPct:12,minimumVolumeUsd:100000,minimumQuality:72,maximumAllocationPct:24,minimumAllocationPct:8});
const DIALOGUE=Object.freeze({
  VIVIAN_HIGH_CONVICTION_ENTRY:"The edge is clean. I'm taking it.",VIVIAN_VALID_ENTRY:"Momentum is confirmed. I'm in.",VIVIAN_CAUTIOUS_ENTRY:"Good enough, but size stays controlled.",VIVIAN_HARD_STOP:"Thesis failed. Cutting it now.",VIVIAN_THESIS_INVALIDATED:"Momentum broke. I'm out.",VIVIAN_PROFIT_TARGET:"Target reached. Book it.",VIVIAN_PROFIT_PROTECTION:"The move is fading. Protect the win.",VIVIAN_TIME_EXIT:"Time is up. Recycle the capital.",VIVIAN_ROUND_EXIT:"Closing risk before the round turns.",VIVIAN_STALE_QUOTE:"No fresh price, no trade.",VIVIAN_COST_REJECTION:"The edge won't clear costs.",VIVIAN_WEAK_SETUP:"Not enough conviction.",VIVIAN_NO_OPPORTUNITY:"Nothing actionable yet.",VIVIAN_MONITOR_POSITION:"Still working. Hold the line.",VIVIAN_PORTFOLIO_FULL:"Three positions are enough.",VIVIAN_INSUFFICIENT_CASH:"Cash is too tight for a credible entry.",VIVIAN_DUPLICATE_STATE:"Already evaluated this state."});

export function evaluateVivianStrategy(context={}){
  const {agent={},assets={},round={},campaign={},costEstimates={},availableSlots=0}=context;
  const now=Number.isFinite(context.now)?context.now:latestContextTime(context);
  const candidates=compatibleCandidates(Array.isArray(context.candidates)?context.candidates:[],Array.isArray(context.opportunities)?context.opportunities:[]);
  const positions=Object.values(agent.positions||{}).sort((a,b)=>String(a.symbol).localeCompare(String(b.symbol)));
  const costs=costMetrics(costEstimates);

  const managed=positionDecision(positions,candidates,assets,round,now,costs,campaign);
  if(managed?.decision==="SELL")return finish(managed,{now,campaign,round,costs,positions,candidates});

  const cash=finite(context.cash,agent.cashUsd,0),equity=finite(context.equity,agent.accountEquityUsd,cash);
  if(availableSlots>0&&cash>=LIMITS.minimumCashUsd){
    const ranked=candidates.map(candidate=>scoreCandidate(candidate,agent,assets,now,costs,round,campaign)).filter(Boolean).sort(compareCandidates);
    const selected=ranked.find(item=>item.accepted);
    if(selected){
      const allocation=allocationFor(selected,positions.length,cash,equity,campaign);
      if(allocation>=LIMITS.minimumAllocationPct){
        const tier=selected.quality>=88&&selected.netEdgePct>=2?"HIGH_CONVICTION":selected.quality>=80?"VALID":"CAUTIOUS";
        return finish({decision:"TRADE",productId:selected.candidate.productId,selectedOpportunityId:selected.candidate.opportunityId||null,selectedCandidateId:selected.candidate.candidateId,candidateSource:selected.candidate.source,allocation:{type:"PERCENT_OF_AVAILABLE_CASH",value:allocation},reasonCode:`VIVIAN_${tier}_ENTRY`,reasonCodes:["FRESH_CANDIDATE","FRESH_QUOTE","COST_ADJUSTED_EDGE",selected.candidate.source,tier],confidence:Math.round(selected.quality),supportingMetrics:selected.supportingMetrics,riskMetrics:{...selected.riskMetrics,allocationPct:allocation,positionCount:positions.length,availableSlots,cashUsd:cash,equityUsd:equity}}, {now,campaign,round,costs,positions,candidates});
      }
    }
    if(!positions.length)return finish(passFromRanked(ranked,candidates,cash),{now,campaign,round,costs,positions,candidates});
  }

  if(managed)return finish(managed,{now,campaign,round,costs,positions,candidates});
  const reason=availableSlots<=0?"VIVIAN_PORTFOLIO_FULL":cash<LIMITS.minimumCashUsd?"VIVIAN_INSUFFICIENT_CASH":"VIVIAN_NO_OPPORTUNITY";
  return finish(baseDecision("PASS",null,reason,55),{now,campaign,round,costs,positions,candidates});
}

function positionDecision(positions,candidates,assets,round,now,costs){
  if(!positions.length)return null;
  const analyses=positions.map(position=>analyzePosition(position,candidates,assets,now,costs));
  const stop=analyses.filter(x=>x.quoteFresh&&x.netReturnPct<=LIMITS.hardStopPct).sort((a,b)=>a.netReturnPct-b.netReturnPct)[0];
  if(stop)return sellDecision(stop,"VIVIAN_HARD_STOP",96);
  const invalid=analyses.find(x=>x.quoteFresh&&x.netReturnPct<=LIMITS.thesisStopPct&&x.momentumPct<=-0.75);
  if(invalid)return sellDecision(invalid,"VIVIAN_THESIS_INVALIDATED",90);
  const target=analyses.filter(x=>x.quoteFresh&&x.netReturnPct>=LIMITS.profitTargetPct).sort((a,b)=>b.netReturnPct-a.netReturnPct)[0];
  if(target)return sellDecision(target,"VIVIAN_PROFIT_TARGET",91);
  const protect=analyses.find(x=>x.quoteFresh&&x.netReturnPct>=LIMITS.profitProtectPct&&x.momentumPct<=0.1);
  if(protect)return sellDecision(protect,"VIVIAN_PROFIT_PROTECTION",87);
  const roundExit=analyses.find(x=>x.quoteFresh&&Number(round.remainingSeconds)<=25&&(x.netReturnPct>0||x.holdingSeconds>=180));
  if(roundExit)return sellDecision(roundExit,"VIVIAN_ROUND_EXIT",84);
  const timed=analyses.find(x=>x.quoteFresh&&x.holdingSeconds>=LIMITS.maxHoldSeconds);
  if(timed)return sellDecision(timed,"VIVIAN_TIME_EXIT",82);
  const stale=analyses.find(x=>!x.quoteFresh);
  if(stale)return manageDecision(stale,"VIVIAN_STALE_QUOTE",40);
  return manageDecision(analyses.sort((a,b)=>a.netReturnPct-b.netReturnPct)[0],"VIVIAN_MONITOR_POSITION",68);
}

function analyzePosition(position,candidates,assets,now,costs){
  const asset=assets[position.symbol]||{},price=Number(asset.price),quantity=Number(position.quantity),basis=Number(position.totalCostBasisUsd),quoteFresh=freshTimestamp(asset.updatedAt||position.lastUpdatedAt,now,LIMITS.quoteAgeMs)&&price>0;
  const liquidation=quoteFresh?price*quantity*(1-costs.exitCostPct/100):basis;
  const netPnl=liquidation-basis,netReturnPct=basis>0?netPnl/basis*100:0;
  const active=candidates.filter(c=>c.productId===position.symbol&&c.eligible).sort((a,b)=>Number(a.rank||999)-Number(b.rank||999))[0];
  const opened=Date.parse(position.openedAt),holdingSeconds=Number.isFinite(opened)?Math.max(0,(now-opened)/1000):0;
  return {position,quoteFresh,price,netPnl,netReturnPct,momentumPct:Number(active?.percentMove??asset.changePercent??0),holdingSeconds,activeCandidateId:active?.candidateId||null,costs};
}

function scoreCandidate(candidate,agent,assets,now,costs,round,campaign){
  if(!candidate||!candidate.eligible||!candidate.productId||agent.positions?.[candidate.productId])return null;
  const asset=assets[candidate.productId],quoteTime=asset?.updatedAt||candidate.observedAt,quoteFresh=asset&&Number(asset.price)>0&&freshTimestamp(quoteTime,now,LIMITS.quoteAgeMs),notExpired=!candidate.expiresAt||Date.parse(candidate.expiresAt)>now,candidateFresh=freshTimestamp(candidate.observedAt,now,candidate.source==="LIVE_MOVER"?ARENA_CONFIG.moverFreshnessMs:Math.max(LIMITS.quoteAgeMs,Number(candidate.expiresAt?Date.parse(candidate.expiresAt)-Date.parse(candidate.observedAt):LIMITS.quoteAgeMs)));
  const confidence=clamp(candidateConfidence(candidate),0,100),opportunityScore=clamp(finite(candidate.evidence?.opportunityScore,confidence),0,100),momentumPct=Number(candidate.percentMove)||0,expectedMovePct=Math.max(0,finite(candidate.evidence?.expectedMovePercent,candidate.evidence?.expectedMovePct,momentumPct)),volume=optionalFinite(candidate.volume,candidate.evidence?.volumeUsd),liquidityScore=Number.isFinite(volume)?clamp(35+Math.log10(Math.max(1,volume))*8,0,100):55,rankScore=clamp(102-Number(candidate.rank||25)*4,20,100),momentumScore=clamp(50+momentumPct*15,0,100),volatilityPct=Math.abs(finite(candidate.evidence?.volatilityPercent,momentumPct)),spreadBps=finite(candidate.evidence?.spreadBps,costs.spreadBps),netEdgePct=expectedMovePct-costs.roundTripCostPct;
  let quality=confidence*.38+opportunityScore*.25+momentumScore*.19+rankScore*.1+liquidityScore*.08;
  if(Number(round.remainingSeconds)<=45)quality-=2;
  if(Number(campaign.progressPercent)>=50&&finite(agent.accountEquityUsd,0)<finite(agent.startingBalanceUsd,0)*.98)quality-=3;
  const reasons=[];
  if(!notExpired)reasons.push("EXPIRED_CANDIDATE");if(!candidateFresh)reasons.push("STALE_CANDIDATE");if(!quoteFresh)reasons.push("STALE_QUOTE");if(momentumPct<=0||String(candidate.direction||"").toUpperCase()==="DOWN")reasons.push("NO_POSITIVE_MOMENTUM");if(spreadBps>LIMITS.maximumSpreadBps)reasons.push("SPREAD_TOO_WIDE");if(volatilityPct>LIMITS.maximumVolatilityPct)reasons.push("VOLATILITY_TOO_HIGH");if(Number.isFinite(volume)&&volume<LIMITS.minimumVolumeUsd)reasons.push("LIQUIDITY_TOO_LOW");if(netEdgePct<Math.max(.35,costs.roundTripCostPct*1.25))reasons.push("EDGE_BELOW_COSTS");if(quality<LIMITS.minimumQuality)reasons.push("QUALITY_TOO_LOW");
  return {candidate,accepted:reasons.length===0,quality,netEdgePct,reasons,supportingMetrics:{confidence,opportunityScore,momentumPct,expectedMovePct,rank:Number(candidate.rank)||null,volumeUsd:Number.isFinite(volume)?volume:null,qualityScore:round2(quality),netEdgePct:round2(netEdgePct)},riskMetrics:{quoteFresh,candidateFresh,notExpired,spreadBps,volatilityPct,roundTripCostPct:costs.roundTripCostPct}};
}

function allocationFor(item,positionCount,cash,equity,campaign){let allocation=item.quality>=88&&item.netEdgePct>=2?24:item.quality>=80?18:12;allocation*=Math.pow(.86,positionCount);if(equity>0&&cash/equity<.35)allocation*=.75;if(Number(campaign.progressPercent)>=50&&equity<ARENA_CONFIG.startingBalanceUsd*.98)allocation*=.8;return clamp(Math.round(allocation),LIMITS.minimumAllocationPct,LIMITS.maximumAllocationPct);}
function passFromRanked(ranked,candidates,cash){if(cash<LIMITS.minimumCashUsd)return baseDecision("PASS",null,"VIVIAN_INSUFFICIENT_CASH",45);if(!candidates.length)return baseDecision("PASS",null,"VIVIAN_NO_OPPORTUNITY",50);const reasons=ranked.flatMap(x=>x.reasons);const code=reasons.includes("STALE_QUOTE")?"VIVIAN_STALE_QUOTE":reasons.includes("EDGE_BELOW_COSTS")||reasons.includes("SPREAD_TOO_WIDE")?"VIVIAN_COST_REJECTION":"VIVIAN_WEAK_SETUP";return {...baseDecision("PASS",null,code,55),reasonCodes:[code,...new Set(reasons)].slice(0,8),supportingMetrics:{candidatesConsidered:ranked.length,candidatesAccepted:ranked.filter(x=>x.accepted).length}};}
function sellDecision(analysis,reasonCode,confidence){return {...baseDecision("SELL",analysis.position,reasonCode,confidence),positionPercent:100,supportingMetrics:{netPnlUsd:round2(analysis.netPnl),netReturnPct:round2(analysis.netReturnPct),momentumPct:round2(analysis.momentumPct),holdingSeconds:Math.round(analysis.holdingSeconds)},riskMetrics:{quoteFresh:analysis.quoteFresh,roundTripCostPct:analysis.costs.roundTripCostPct}};}
function manageDecision(analysis,reasonCode,confidence){return {...baseDecision("MANAGE_POSITION",analysis.position,reasonCode,confidence),supportingMetrics:{netPnlUsd:round2(analysis.netPnl),netReturnPct:round2(analysis.netReturnPct),momentumPct:round2(analysis.momentumPct),holdingSeconds:Math.round(analysis.holdingSeconds)},riskMetrics:{quoteFresh:analysis.quoteFresh,roundTripCostPct:analysis.costs.roundTripCostPct}};}
function baseDecision(decision,position,reasonCode,confidence){return {decision,productId:position?.symbol||null,selectedOpportunityId:position?.opportunityId||null,selectedCandidateId:position?.candidateId||null,candidateSource:position?.candidateSource||null,allocation:null,reasonCode,reasonCodes:[reasonCode],confidence};}
function finish(decision,{now,campaign,round,costs,positions,candidates}){const dialogueKey=decision.reasonCode,identity=[campaign?.id||"campaign",round?.number||0,Math.floor(now/15000),decision.decision,decision.productId||"NONE",decision.selectedCandidateId||"NONE"].join(":");return {...decision,agentId:"CODY",reasonSummary:DIALOGUE[dialogueKey]||dialogueKey,dialogueKey,dialogueText:DIALOGUE[dialogueKey]||"Watching the setup.",evaluatedAt:new Date(now).toISOString(),strategyVersion:VIVIAN_METADATA.strategyVersion,idempotencyKey:`vivian:${identity}`,supportingMetrics:{candidatesConsidered:candidates.length,openPositionCount:positions.length,...decision.supportingMetrics},riskMetrics:{roundTripCostPct:costs.roundTripCostPct,...decision.riskMetrics}};}
function costMetrics(model={}){const feeBps=finite(model.feeRateBps,40),slippageBps=finite(model.slippageBps,5),spreadBps=finite(model.syntheticSpreadBps,4),exitCostPct=(feeBps+slippageBps+spreadBps/2)/100,roundTripCostPct=(feeBps*2+slippageBps*2+spreadBps)/100;return {feeBps,slippageBps,spreadBps,exitCostPct,roundTripCostPct};}
function latestContextTime(context){const times=[...(context.candidates||[]).map(x=>Date.parse(x.observedAt)),...Object.values(context.assets||{}).map(x=>Date.parse(x.updatedAt))].filter(Number.isFinite);return times.length?Math.max(...times):0;}
function freshTimestamp(value,now,maxAge){const timestamp=Date.parse(value);return Number.isFinite(timestamp)&&Number.isFinite(now)&&timestamp<=now+60000&&now-timestamp<=maxAge;}
function finite(...values){for(const value of values){if(value===null||value===undefined||value==="")continue;const number=Number(value);if(Number.isFinite(number))return number;}return 0;}
function optionalFinite(...values){for(const value of values){if(value===null||value===undefined||value==="")continue;const number=Number(value);if(Number.isFinite(number))return number;}return NaN;}
function clamp(value,min,max){return Math.min(max,Math.max(min,value));}
function round2(value){return Math.round(Number(value)*100)/100;}
function compareCandidates(a,b){return Number(b.accepted)-Number(a.accepted)||b.quality-a.quality||b.netEdgePct-a.netEdgePct||Number(a.candidate.rank||999)-Number(b.candidate.rank||999)||String(a.candidate.productId).localeCompare(String(b.candidate.productId));}

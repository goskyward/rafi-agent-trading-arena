import { ARENA_CONFIG } from "./config.js";

// Phase One compatibility adapters. Replace only at the future Anthropic Preston /
// Vector-OpenAI Vivian strategy boundary; the arena remains the execution authority.
const pass=(reasonCode,confidence=50)=>({decision:"PASS",productId:null,selectedOpportunityId:null,selectedCandidateId:null,candidateSource:null,allocation:null,reasonCode,reasonCodes:[reasonCode],confidence});
const manage=(position,reasonCode,confidence=50)=>({decision:"MANAGE_POSITION",productId:position.symbol,selectedOpportunityId:position.opportunityId||null,selectedCandidateId:position.candidateId||null,candidateSource:position.candidateSource||null,allocation:null,reasonCode,reasonCodes:[reasonCode],confidence});
const sell=(position,reasonCode,confidence)=>({decision:"SELL",productId:position.symbol,selectedOpportunityId:position.opportunityId||null,selectedCandidateId:position.candidateId||null,candidateSource:position.candidateSource||null,allocation:null,positionPercent:100,reasonCode,reasonCodes:[reasonCode],confidence});
const changeFor=(position,assets)=>{const a=assets[position.symbol];return a?((a.price-position.averageEntryPrice)/position.averageEntryPrice)*100:0;};
const candidateConfidence=c=>Number(c?.evidence?.confidence??c?.evidence?.opportunityScore)||Math.min(95,65+Math.abs(Number(c?.percentMove)||0)*5);
const eligible=(candidates,agent,assets,now=Date.now())=>candidates.filter(c=>c.eligible&&assets[c.productId]&&!agent.positions?.[c.productId]&&(!c.expiresAt||Date.parse(c.expiresAt)>now));
const compatibleCandidates=(candidates,opportunities=[])=>candidates.length?candidates:opportunities.map(o=>({candidateId:`RAFI_OPPORTUNITY:${o.opportunityId}`,source:"RAFI_OPPORTUNITY",productId:o.productId,opportunityId:o.opportunityId,eligible:true,expiresAt:null,percentMove:Number(o.upstreamIntelligence?.changePercent)||0,evidence:o}));

export class CodyStrategy {
 static version="CODY_MOMENTUM_COMPAT_V1.2";
 decide({agent,candidates=[],opportunities=[],assets,round,availableSlots=ARENA_CONFIG.maximumOpenPositions}){
  candidates=compatibleCandidates(candidates,opportunities);
  const positions=Object.values(agent.positions||{}).sort((a,b)=>a.symbol.localeCompare(b.symbol));
  const risk=positions.find(p=>changeFor(p,assets)<=-0.8);if(risk)return sell(risk,"CODY_RISK_EXIT",86);
  const pressure=positions[0];if(pressure&&round.remainingSeconds<=30)return sell(pressure,"CODY_ROUND_PRESSURE",82);
  const target=positions.find(p=>changeFor(p,assets)>=1);if(target)return sell(target,"CODY_MOMENTUM_TARGET",84);
  if(availableSlots>0){const adaptation=agent.halftimeAdaptation?.roundNumber===round.number&&agent.halftimeAdaptation?.active?agent.halftimeAdaptation:null,threshold=adaptation?Math.max(ARENA_CONFIG.vivianConfidenceSafetyFloor,round.remainingSeconds<=60?adaptation.finalMinuteThreshold:adaptation.halftimeThreshold):ARENA_CONFIG.vivianOpeningConfidenceThreshold;
   const ranked=eligible(candidates,agent,assets).filter(c=>Number(c.percentMove)>=0).sort((a,b)=>Number(b.percentMove)-Number(a.percentMove)||candidateConfidence(b)-candidateConfidence(a));const c=ranked.find(x=>candidateConfidence(x)>=threshold);
   if(c)return {decision:"TRADE",productId:c.productId,selectedOpportunityId:c.opportunityId,selectedCandidateId:c.candidateId,candidateSource:c.source,allocation:{type:"PERCENT_OF_AVAILABLE_CASH",value:25},reasonCode:adaptation?"CODY_EXPANDED_SEARCH_ENTRY":"CODY_MOMENTUM_ENTRY",reasonCodes:["FRESH_CANDIDATE",c.source,adaptation?"HALFTIME_ADAPTED":"NORMAL_THRESHOLD"],confidence:candidateConfidence(c)};
  }
  return positions.length?manage(positions[0],"CODY_MONITOR_PORTFOLIO",68):pass(availableSlots?"CODY_NO_POSITIVE_MOMENTUM":"CODY_PORTFOLIO_FULL",55);
 }
}

export class AtlasStrategy {
 static version="ATLAS_REVERSION_COMPAT_V1.2";
 decide({agent,candidates=[],opportunities=[],assets,round,availableSlots=ARENA_CONFIG.maximumOpenPositions}){
  candidates=compatibleCandidates(candidates,opportunities);
  const positions=Object.values(agent.positions||{}).sort((a,b)=>a.symbol.localeCompare(b.symbol));
  const risk=positions.find(p=>changeFor(p,assets)<=-0.6);if(risk)return sell(risk,"ATLAS_RISK_EXIT",82);
  const pressure=positions[0];if(pressure&&round.remainingSeconds<=30)return sell(pressure,"ATLAS_ROUND_PRESSURE",78);
  const target=positions.find(p=>changeFor(p,assets)>=0.7);if(target)return sell(target,"ATLAS_REVERSION_TARGET",80);
  if(availableSlots>0){const ranked=eligible(candidates,agent,assets).filter(c=>Number(c.percentMove)<=0).sort((a,b)=>Number(a.percentMove)-Number(b.percentMove)||candidateConfidence(b)-candidateConfidence(a)),c=ranked[0],adaptation=agent.halftimeAdaptation?.roundNumber===round.number&&agent.halftimeAdaptation?.active?agent.halftimeAdaptation:null;
   if(c)return {decision:"TRADE",productId:c.productId,selectedOpportunityId:c.opportunityId,selectedCandidateId:c.candidateId,candidateSource:c.source,allocation:{type:"PERCENT_OF_AVAILABLE_CASH",value:adaptation?.allocationPercent||ARENA_CONFIG.prestonBaseAllocationPercent},reasonCode:adaptation?"ATLAS_HALFTIME_VALUE_ENTRY":"ATLAS_REVERSION_ENTRY",reasonCodes:["FRESH_CANDIDATE",c.source,adaptation?"HALFTIME_ALLOCATION":"BASE_ALLOCATION"],confidence:candidateConfidence(c)};
  }
  return positions.length?manage(positions[0],"ATLAS_MONITOR_PORTFOLIO",72):pass(availableSlots?"ATLAS_NO_OVERSOLD_ASSET":"ATLAS_PORTFOLIO_FULL",58);
 }
}

export const AGENT_REGISTRY=Object.freeze({CODY:new CodyStrategy(),ATLAS:new AtlasStrategy()});
export const STRATEGY_VERSIONS=Object.freeze({CODY:CodyStrategy.version,ATLAS:AtlasStrategy.version});
export function validateAgentDecision(d){if(!d||!["TRADE","PASS","SELL","MANAGE_POSITION"].includes(d.decision))throw new Error("Invalid agent decision");if(d.decision==="TRADE"&&(!d.selectedCandidateId||!d.productId||d.allocation?.type!=="PERCENT_OF_AVAILABLE_CASH"||!Number.isFinite(d.allocation.value)||d.allocation.value<1||d.allocation.value>100))throw new Error("Invalid trade decision");if(d.decision!=="TRADE"&&d.allocation!==null)throw new Error("Non-trade allocation must be null");if(d.decision==="SELL"&&(!d.productId||!Number.isFinite(d.positionPercent)))throw new Error("Invalid sell decision");return d;}

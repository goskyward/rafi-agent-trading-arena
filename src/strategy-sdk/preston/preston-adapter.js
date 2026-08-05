import { ARENA_CONFIG } from "../../config.js";
import { isExactCoinbaseUsdProduct } from "../../opportunity-contract.js";
import { compatibleCandidates } from "../runtime.js";
import { decidePrestonStrategy } from "./preston-strategy.ts";

export const PRESTON_METADATA=Object.freeze({
  strategyId:"preston-atlas-v1",
  strategyName:"Preston",
  strategyAuthor:"Claude / Anthropic",
  strategyVersion:"PRESTON_ANTHROPIC_V1.0.0",
  arenaRulesVersion:"1.1",
  integrationVersion:"1.0.0",
  creationDate:"2026-08-04",
  sourceSha256:"8c37f4ba9e4381bafef4ac9e2e3d3c93b05e925a252e9c4b463b3b04a8ca1d78",
  testSha256:"93630dab1bb02a9cdd45629eb82fa64dc008892beaf741b7de7416e57d2b6916"
});

export function evaluatePrestonStrategy(arenaContext={}){
  const mapping=buildMapping(arenaContext);
  const sourceDecision=decidePrestonStrategy(mapping.context);
  return mapPrestonDecisionToArena(sourceDecision,arenaContext,mapping);
}

export function mapArenaContextToPreston(arenaContext={}){
  return buildMapping(arenaContext).context;
}

export function mapPrestonDecisionToArena(sourceDecision,arenaContext={},providedMapping){
  const mapping=providedMapping||buildMapping(arenaContext),candidate=mapping.candidatesByOpportunityId.get(sourceDecision.opportunityId)||null;
  const action=sourceDecision.action,now=finite(arenaContext.now,NaN),campaignId=arenaContext.campaign?.id||"campaign",roundNumber=finite(arenaContext.round?.number,0);
  const allocation=action==="TRADE"?{type:"PERCENT_OF_AVAILABLE_CASH",value:Number(sourceDecision.allocationPct)*100}:null;
  return {
    agentId:"ATLAS",
    decision:action,
    productId:sourceDecision.productId,
    selectedOpportunityId:action==="TRADE"?(candidate?.opportunityId||null):(mapping.position?.opportunityId||null),
    selectedCandidateId:action==="TRADE"?(candidate?.candidateId||null):(mapping.position?.candidateId||null),
    candidateSource:action==="TRADE"?(candidate?.source||null):(mapping.position?.candidateSource||null),
    allocation,
    ...(action==="SELL"?{positionPercent:100}:{}),
    reasonCode:sourceDecision.reasonCode,
    reasonCodes:[sourceDecision.reasonCode],
    reasonSummary:sourceDecision.rationale,
    dialogueKey:sourceDecision.reasonCode,
    dialogueText:sourceDecision.rationale,
    confidence:sourceDecision.confidence==null?50:Number(sourceDecision.confidence)*100,
    evaluatedAt:Number.isFinite(now)?new Date(now).toISOString():null,
    strategyVersion:PRESTON_METADATA.strategyVersion,
    idempotencyKey:`preston:${campaignId}:${roundNumber}:${Number.isFinite(now)?Math.floor(now/15000):"invalid"}:${action}:${sourceDecision.productId||"NONE"}:${candidate?.candidateId||"NONE"}`,
    supportingMetrics:{sourceAction:action,sourceOpportunityId:sourceDecision.opportunityId||null,sourceScanId:sourceDecision.scanId||null,candidatesMapped:mapping.context.opportunities.length,sourceRationale:sourceDecision.rationale},
    riskMetrics:{singlePositionLimit:true,prestonPositionCount:mapping.positionCount,sourceAllocationFraction:sourceDecision.allocationPct??null}
  };
}

function buildMapping(arenaContext){
  const now=finite(arenaContext.now,NaN),agent=arenaContext.agent||{},assets=arenaContext.assets||{},positions=Object.values(agent.positions||{}).sort((a,b)=>String(a.openedAt||"").localeCompare(String(b.openedAt||""))||String(a.symbol||"").localeCompare(String(b.symbol||""))),position=positions[0]||null;
  const suppliedCandidates=Array.isArray(arenaContext.candidates)?arenaContext.candidates:[],candidates=compatibleCandidates(suppliedCandidates,Array.isArray(arenaContext.opportunities)?arenaContext.opportunities:[]).filter(candidate=>candidate?.eligible===true);
  const candidatesByOpportunityId=new Map(),opportunities=[];
  for(const candidate of candidates){
    const mappedId=candidate.opportunityId||candidate.candidateId;
    if(!mappedId)continue;
    candidatesByOpportunityId.set(mappedId,candidate);
    opportunities.push({
      opportunityId:mappedId,
      scanId:candidate.scanId||candidate.candidateId,
      productId:candidate.productId,
      observedAtMs:Date.parse(candidate.observedAt||""),
      expiresAtMs:Date.parse(candidate.expiresAt||""),
      referencePrice:Number(candidate.referencePrice??candidate.evidence?.referencePrice),
      ...(finiteOptional(candidate.rank)!==undefined?{rank:finiteOptional(candidate.rank)}:{}),
      ...(finiteOptional(candidate.evidence?.opportunityScore,candidate.evidence?.score)!==undefined?{score:finiteOptional(candidate.evidence?.opportunityScore,candidate.evidence?.score)}:{}),
      bias:mapBias(candidate.direction),
      ...(normalizeConfidence(candidate.evidence?.confidence)!==undefined?{confidence:normalizeConfidence(candidate.evidence?.confidence)}:{}),
      ...(finiteOptional(candidate.percentMove)!==undefined?{momentumPct:finiteOptional(candidate.percentMove)}:{}),
      ...(finiteOptional(candidate.evidence?.volumeRatio,candidate.evidence?.upstreamIntelligence?.volumeRatio)!==undefined?{volumeRatio:finiteOptional(candidate.evidence?.volumeRatio,candidate.evidence?.upstreamIntelligence?.volumeRatio)}:{}),
      ...(finiteOptional(candidate.evidence?.atrPct,candidate.evidence?.upstreamIntelligence?.atrPct)!==undefined?{atrPct:finiteOptional(candidate.evidence?.atrPct,candidate.evidence?.upstreamIntelligence?.atrPct)}:{}),
      evidence:candidate.evidence
    });
  }
  const campaignRemainingMs=remainingMs(arenaContext.campaign,now),roundRemainingMs=remainingMs(arenaContext.round,now),roundDurationMs=finite(arenaContext.round?.durationSeconds,ARENA_CONFIG.roundDurationSeconds)*1000;
  const currentPrice=position?Number(assets[position.symbol]?.price??position.lastMarkPrice):0,basis=position?Number(position.totalCostBasisUsd):0,quantity=position?Number(position.quantity):0,marketValue=currentPrice*quantity;
  const context={
    nowMs:now,
    campaign:{status:mapCampaignStatus(arenaContext.campaign?.status),elapsedPct:clamp(finite(arenaContext.campaign?.progressPercent,0)/100,0,1),remainingMs:campaignRemainingMs},
    round:{number:finite(arenaContext.round?.number,0),remainingMs:roundRemainingMs,elapsedMs:Math.max(0,roundDurationMs-roundRemainingMs),isHalftimeOrLater:finite(arenaContext.round?.progressPercent,roundDurationMs?((roundDurationMs-roundRemainingMs)/roundDurationMs)*100:0)>=50},
    account:{balanceUsd:finite(arenaContext.equity,agent.accountEquityUsd,NaN),cashUsd:finite(arenaContext.cash,agent.cashUsd,NaN),startingBalanceUsd:finite(agent.startingBalanceUsd,ARENA_CONFIG.startingBalanceUsd)},
    position:position?{productId:position.symbol,entryPrice:Number(position.averageEntryPrice),currentPrice,quantity,notionalUsd:marketValue,unrealizedPnlUsd:marketValue-basis,unrealizedPnlPct:basis>0?(marketValue-basis)/basis:0,openedAtMs:Date.parse(position.openedAt||"")}:null,
    opportunities,
    constraints:{oneOpenPosition:true,minAllocationPct:0.05,maxAllocationPct:0.25,defaultAllocationPct:ARENA_CONFIG.prestonBaseAllocationPercent/100,halftimeAllocationPct:ARENA_CONFIG.prestonHalftimeAllocationPercent/100,allowedProductIds:[...new Set(candidates.map(candidate=>candidate.productId).filter(isExactCoinbaseUsdProduct))]}
  };
  return {context,candidatesByOpportunityId,position,positionCount:positions.length};
}

function remainingMs(value,now){if(Number.isFinite(Number(value?.remainingSeconds)))return Number(value.remainingSeconds)*1000;const end=Date.parse(value?.endsAt||"");if(Number.isFinite(end)&&Number.isFinite(now))return Math.max(0,end-now);if(Number.isFinite(Number(value?.progressPercent)))return Math.max(0,(1-Number(value.progressPercent)/100)*ARENA_CONFIG.campaignDurationSeconds*1000);return NaN;}
function mapCampaignStatus(status){return status==="ACTIVE"?"ACTIVE":status==="COMPLETED"?"COMPLETE":"INACTIVE";}
function mapBias(value){const normalized=String(value||"").toUpperCase();return normalized==="UP"||normalized==="BULLISH"?"bullish":normalized==="DOWN"||normalized==="BEARISH"?"bearish":"neutral";}
function normalizeConfidence(value){const number=finiteOptional(value);if(number===undefined)return undefined;return clamp(number>1?number/100:number,0,1);}
function finiteOptional(...values){for(const value of values){if(value===null||value===undefined||value==="")continue;const number=Number(value);if(Number.isFinite(number))return number;}return undefined;}
function finite(...values){const value=finiteOptional(...values);return value===undefined?NaN:value;}
function clamp(value,min,max){return Math.min(max,Math.max(min,value));}

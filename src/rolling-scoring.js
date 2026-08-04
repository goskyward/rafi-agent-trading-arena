import { ARENA_CONFIG, ROLLING_SCORING_VERSION } from "./config.js";

export const ROUND_TYPES = Object.freeze([
  { type:"CAPITAL_MISSION", label:"CAPITAL MISSION", objective:"BONUS POINTS FOR MOST MONEY EARNED", description:"Earn the highest realized profit this round for an additional 20-point bonus.", bonusCategory:"mostMoney" },
  { type:"PRECISION_MISSION", label:"PRECISION MISSION", objective:"BONUS POINTS FOR HIGHEST PERCENTAGE TRADE", description:"Complete the strongest eligible percentage-return trade this round.", bonusCategory:"highestReturn" },
  { type:"STREAK_MISSION", label:"STREAK MISSION", objective:"BONUS POINTS FOR TWO CONSECUTIVE PROFITABLE TRADES", description:"Build a winning streak before your opponent for an additional 20-point bonus.", bonusCategory:"streak" }
]);

const BASE_CATEGORY_POINTS=Object.freeze({mostMoney:20,highestReturn:20,streak:20});
const MISSION_BONUS_POINTS=20;

export function roundDefinition(roundNumber){return ROUND_TYPES[(Math.max(1,Number(roundNumber)||1)-1)%ROUND_TYPES.length];}

export function ensureRollingScoring(state,now=Date.now()){
  if(state.scoring?.rulesVersion===ROLLING_SCORING_VERSION)return state.scoring;
  const roundNumber=Math.max(1,state.round?.number||1),definition=roundDefinition(roundNumber);
  const previous=state.scoring;
  state.scoring={rulesVersion:ROLLING_SCORING_VERSION,campaignScores:previous?.campaignScores||Object.fromEntries(ARENA_CONFIG.agents.map(id=>[id,Math.round(Number(state.agents[id]?.score?.total)||0)])),events:previous?.events||[],settlements:previous?.settlements||[],settledRoundNumbers:previous?.settledRoundNumbers||Array.from({length:Math.max(0,roundNumber-1)},(_,index)=>index+1),passState:previous?.passState||Object.fromEntries(ARENA_CONFIG.agents.map(id=>[id,{roundNumber,count:0,seenOpportunityIds:[]}]))};
  addSystemEvent(state,roundNumber,"MISSION_STARTED","CURRENT MISSION",objectiveReason(definition),now);
  syncAgentScores(state);return state.scoring;
}

export function decorateRound(round){const definition=roundDefinition(round?.number||1);return {...round,type:definition.type,typeLabel:definition.label,objective:definition.objective,mission:{type:definition.type,label:definition.label,objective:definition.objective,description:definition.description,bonusCategory:definition.bonusCategory,bonusPoints:MISSION_BONUS_POINTS},scoringRulesVersion:ROLLING_SCORING_VERSION};}

export function recordDecisionScoring(state,agentId,decision,board,now=Date.now()){
  ensureRollingScoring(state,now);const roundNumber=state.round.number,tracker=state.scoring.passState[agentId];
  if(tracker.roundNumber!==roundNumber){tracker.roundNumber=roundNumber;tracker.count=0;tracker.seenOpportunityIds=[];}
  const qualified=(board?.boardStatus==="ACTIVE"?board.opportunities||[]:[]).filter(item=>item.qualified===true&&item.tradability==="TRADABLE"&&Date.parse(item.expiresAt)>now);
  if(decision.decision==="TRADE"){tracker.count=0;tracker.seenOpportunityIds=[];return;}
  if(decision.decision!=="PASS"||qualified.length===0){tracker.count=0;tracker.seenOpportunityIds=[];return;}
  const opportunity=qualified[0];if(tracker.seenOpportunityIds.includes(opportunity.opportunityId))return;
  tracker.seenOpportunityIds.push(opportunity.opportunityId);tracker.count++;
  if(tracker.count>=2){award(state,{roundNumber,agentId,eventType:"QUALIFIED_PASS_PENALTY",category:"QUALIFIED PASSES",pointsDelta:-5,reason:"Two qualified opportunities declined.",occurredAt:new Date(now).toISOString(),relatedTradeIds:[],uniqueKey:`pass:${opportunity.opportunityId}`});tracker.count=0;tracker.seenOpportunityIds=[];}
}

export function recordTradeScoring(state,trade,now=Date.now()){
  ensureRollingScoring(state,now);const tracker=state.scoring.passState[trade.agentId];tracker.count=0;tracker.seenOpportunityIds=[];
  if(trade.classification==="BREAK_EVEN"){
    const already=state.scoring.events.some(event=>event.roundNumber===trade.roundNumber&&event.agentId===trade.agentId&&event.eventType==="BREAK_EVEN_BONUS");
    if(!already)award(state,{roundNumber:trade.roundNumber,agentId:trade.agentId,eventType:"BREAK_EVEN_BONUS",category:"BREAK-EVEN EXIT",pointsDelta:5,reason:"Capital protected.",occurredAt:trade.closedAt||new Date(now).toISOString(),relatedTradeIds:[trade.tradeId],uniqueKey:`break-even:${trade.roundNumber}:${trade.agentId}`});
  }
}

export function recordWipeoutScoring(state,agentId,now=Date.now()){
  ensureRollingScoring(state,now);award(state,{roundNumber:state.round.number,agentId,eventType:"WIPEOUT_PENALTY",category:"WIPEOUT",pointsDelta:-30,reason:"Risk boundary exceeded.",occurredAt:new Date(now).toISOString(),relatedTradeIds:[],uniqueKey:`wipeout:${state.campaign.id}:${agentId}`});
}

export function settleElapsedRounds(state,now=Date.now()){
  ensureRollingScoring(state,now);if(state.campaign.status==="NOT_STARTED")return [];
  const campaignStart=Date.parse(state.campaign.startedAt),currentRound=Math.min(ARENA_CONFIG.maximumRounds,Math.floor(Math.max(0,now-campaignStart)/(ARENA_CONFIG.roundDurationSeconds*1000))+1),completedThrough=state.campaign.status==="COMPLETED"?ARENA_CONFIG.maximumRounds:Math.max(0,currentRound-1),created=[];
  for(let number=1;number<=completedThrough;number++){if(state.scoring.settledRoundNumbers.includes(number))continue;const settlement=settleRound(state,number,now);state.scoring.settledRoundNumbers.push(number);state.scoring.settlements.push(settlement);created.push(settlement);}
  if(created.length){const definition=roundDefinition(currentRound);addSystemEvent(state,currentRound,"MISSION_STARTED","CURRENT MISSION",objectiveReason(definition),now);}
  syncAgentScores(state);return created;
}

export function publicScoring(state){ensureRollingScoring(state);return {rulesVersion:ROLLING_SCORING_VERSION,campaignScores:{...state.scoring.campaignScores},recentEvents:state.scoring.events.slice(-100).reverse(),recentSettlements:state.scoring.settlements.slice(-10).reverse()};}

function settleRound(state,roundNumber,now){
  const definition=roundDefinition(roundNumber),trades=state.trades.filter(trade=>trade.roundNumber===roundNumber),roundEvents=state.scoring.events.filter(event=>event.roundNumber===roundNumber),byAgent=Object.fromEntries(ARENA_CONFIG.agents.map(id=>[id,trades.filter(trade=>trade.agentId===id)]));
  const metrics={};for(const id of ARENA_CONFIG.agents){const rows=byAgent[id],eligible=rows.filter(trade=>Number(trade.entryAllocationPercent)>=ARENA_CONFIG.scoringMinimumAllocationPercent&&trade.classification==="WIN"),ordered=[...rows].sort((a,b)=>Date.parse(a.closedAt)-Date.parse(b.closedAt));metrics[id]={netRealizedPnl:rows.reduce((sum,trade)=>sum+Number(trade.realizedNetProfitUsd||0),0),highestEligibleReturn:eligible.length?Math.max(...eligible.map(trade=>Number(trade.realizedNetReturnPercent))):null,highestReturnTrade:eligible.sort((a,b)=>b.realizedNetReturnPercent-a.realizedNetReturnPercent||Date.parse(a.closedAt)-Date.parse(b.closedAt))[0]||null,lastClosedAt:ordered.at(-1)?.closedAt||null,streak:findStreak(rows),breakEvenBonus:sumEvents(roundEvents,id,"BREAK_EVEN_BONUS"),passPenalty:sumEvents(roundEvents,id,"QUALIFIED_PASS_PENALTY"),wipeoutPenalty:sumEvents(roundEvents,id,"WIPEOUT_PENALTY")};}
  const points=Object.fromEntries(ARENA_CONFIG.agents.map(id=>[id,0])),winners={mostMoney:[],highestReturn:[],streak:[]};
  awardMostMoney(metrics,BASE_CATEGORY_POINTS.mostMoney,points,winners);awardHighestReturn(metrics,BASE_CATEGORY_POINTS.highestReturn,points,winners);awardStreak(metrics,BASE_CATEGORY_POINTS.streak,points,winners);
  const beforeCategoryAwards={...state.scoring.campaignScores};for(const category of ["mostMoney","highestReturn","streak"])for(const winner of winners[category])if(winner.points>0)award(state,{roundNumber,agentId:winner.agentId,eventType:"ROUND_CATEGORY_AWARD",category:categoryLabel(category),pointsDelta:winner.points,reason:categoryReason(category,metrics[winner.agentId]),occurredAt:roundEnd(state,roundNumber),relatedTradeIds:winner.tradeIds||[],uniqueKey:`category:${roundNumber}:${category}:${winner.agentId}`});
  const missionWinners=missionBonusWinners(definition.bonusCategory,winners,metrics);for(const winner of missionWinners)award(state,{roundNumber,agentId:winner.agentId,eventType:"MISSION_BONUS_AWARD",category:"MISSION COMPLETE",pointsDelta:winner.points,reason:categoryLabel(definition.bonusCategory),occurredAt:roundEnd(state,roundNumber),relatedTradeIds:winner.tradeIds||[],uniqueKey:`mission:${roundNumber}:${definition.bonusCategory}:${winner.agentId}`});
  const after={...state.scoring.campaignScores},roundPoints=Object.fromEntries(ARENA_CONFIG.agents.map(id=>[id,after[id]-beforeCategoryAwards[id]+metrics[id].breakEvenBonus+metrics[id].passPenalty+metrics[id].wipeoutPenalty])),before=Object.fromEntries(ARENA_CONFIG.agents.map(id=>[id,after[id]-roundPoints[id]]));
  addSystemEvent(state,roundNumber,"ROUND_COMPLETE","ROUND COMPLETE",`Vivian earned ${roundPoints.CODY} points. Preston earned ${roundPoints.ATLAS} points.`,now);
  return {settlementId:`${state.campaign.id}:round:${roundNumber}`,campaignId:state.campaign.id,roundNumber,roundType:definition.type,mission:{...definition,bonusPoints:MISSION_BONUS_POINTS},roundStartedAt:roundStart(state,roundNumber),roundEndedAt:roundEnd(state,roundNumber),agentMetrics:metrics,categoryWinners:winners,categoryPointValues:BASE_CATEGORY_POINTS,missionBonusWinners:missionWinners,missionBonusPoints:MISSION_BONUS_POINTS,roundPointsEarned:roundPoints,campaignScoreBefore:before,campaignScoreAfter:after,settledAt:new Date(now).toISOString(),rulesVersion:ROLLING_SCORING_VERSION};
}

function award(state,input){const eventId=`score:${input.uniqueKey}`;if(state.scoring.events.some(event=>event.eventId===eventId))return null;const before=Math.round(state.scoring.campaignScores[input.agentId]||0),after=before+Math.trunc(input.pointsDelta);state.scoring.campaignScores[input.agentId]=after;const event={eventId,campaignId:state.campaign.id,roundNumber:input.roundNumber,agentId:input.agentId,eventType:input.eventType,category:input.category,pointsDelta:Math.trunc(input.pointsDelta),scoreBefore:before,scoreAfter:after,reason:input.reason,occurredAt:input.occurredAt,relatedTradeIds:input.relatedTradeIds||[],rulesVersion:ROLLING_SCORING_VERSION};state.scoring.events.push(event);syncAgentScores(state);return event;}
function addSystemEvent(state,roundNumber,eventType,category,reason,now){const eventId=`score:${state.campaign.id}:${roundNumber}:${eventType}`;if(state.scoring.events.some(event=>event.eventId===eventId))return;state.scoring.events.push({eventId,campaignId:state.campaign.id,roundNumber,agentId:null,eventType,category,pointsDelta:0,scoreBefore:null,scoreAfter:null,reason,occurredAt:new Date(now).toISOString(),relatedTradeIds:[],rulesVersion:ROLLING_SCORING_VERSION});}
function syncAgentScores(state){if(!state.scoring)return;for(const id of ARENA_CONFIG.agents)state.agents[id].score={total:Math.round(state.scoring.campaignScores[id]||0)};}
function findStreak(trades){const ordered=[...trades].sort((a,b)=>Date.parse(a.closedAt)-Date.parse(b.closedAt));for(let i=1;i<ordered.length;i++)if(ordered[i-1].classification==="WIN"&&ordered[i].classification==="WIN")return {completedAt:ordered[i].closedAt,tradeIds:[ordered[i-1].tradeId,ordered[i].tradeId]};return null;}
function awardMostMoney(metrics,value,points,winners){const positive=ARENA_CONFIG.agents.filter(id=>metrics[id].netRealizedPnl>0);if(!positive.length)return;const top=Math.max(...positive.map(id=>metrics[id].netRealizedPnl)),tied=positive.filter(id=>metrics[id].netRealizedPnl===top);splitWhole(tied,value,metrics,id=>metrics[id].lastClosedAt||"9999-12-31T23:59:59.999Z").forEach(row=>{points[row.agentId]+=row.points;winners.mostMoney.push(row);});}
function awardHighestReturn(metrics,value,points,winners){const eligible=ARENA_CONFIG.agents.filter(id=>metrics[id].highestEligibleReturn>0);if(!eligible.length)return;eligible.sort((a,b)=>metrics[b].highestEligibleReturn-metrics[a].highestEligibleReturn||Date.parse(metrics[a].highestReturnTrade.closedAt)-Date.parse(metrics[b].highestReturnTrade.closedAt));const winner=eligible[0];points[winner]+=value;winners.highestReturn.push({agentId:winner,points:value,tradeIds:[metrics[winner].highestReturnTrade.tradeId]});}
function awardStreak(metrics,value,points,winners){const eligible=ARENA_CONFIG.agents.filter(id=>metrics[id].streak).sort((a,b)=>Date.parse(metrics[a].streak.completedAt)-Date.parse(metrics[b].streak.completedAt));if(!eligible.length)return;const winner=eligible[0];points[winner]+=value;winners.streak.push({agentId:winner,points:value,tradeIds:metrics[winner].streak.tradeIds});}
function splitWhole(ids,value,metrics,timeSelector){if(ids.length===1)return [{agentId:ids[0],points:value}];const ordered=[...ids].sort((a,b)=>Date.parse(timeSelector(a))-Date.parse(timeSelector(b))),base=Math.floor(value/ids.length),extra=value-base*ids.length;return ordered.map((agentId,index)=>({agentId,points:base+(index<extra?1:0)}));}
function sumEvents(events,id,type){return events.filter(event=>event.agentId===id&&event.eventType===type).reduce((sum,event)=>sum+event.pointsDelta,0);}
function roundStart(state,n){return new Date(Date.parse(state.campaign.startedAt)+(n-1)*ARENA_CONFIG.roundDurationSeconds*1000).toISOString();}
function roundEnd(state,n){return new Date(Math.min(Date.parse(state.campaign.endsAt),Date.parse(state.campaign.startedAt)+n*ARENA_CONFIG.roundDurationSeconds*1000)).toISOString();}
function missionBonusWinners(category,winners,metrics){const rows=winners[category];if(!rows.length)return[];if(category==="mostMoney")return splitWhole(rows.map(row=>row.agentId),MISSION_BONUS_POINTS,metrics,id=>metrics[id].lastClosedAt||"9999-12-31T23:59:59.999Z");return [{agentId:rows[0].agentId,points:MISSION_BONUS_POINTS,tradeIds:rows[0].tradeIds||[]}];}
function objectiveReason(definition){return `${definition.objective}. ${definition.description}`;}
function categoryLabel(category){return category==="mostMoney"?"MOST MONEY EARNED":category==="highestReturn"?"HIGHEST PERCENTAGE TRADE":"WINNING STREAK";}
function categoryReason(category,metrics){return category==="mostMoney"?"Round leader in realized profit.":category==="highestReturn"?`${Number(metrics.highestEligibleReturn).toFixed(2)}% realized return.`:"Two profitable trades in a row.";}

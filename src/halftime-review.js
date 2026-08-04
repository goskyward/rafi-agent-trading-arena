import { ARENA_CONFIG } from "./config.js";

export const HALFTIME_REVIEW_VERSION="halftime-strategy-review-v1";

export function applyHalftimeReviews(state,now=Date.now()){
  ensureHalftimeState(state);
  if(state.campaign.status!=="ACTIVE"||state.market?.status!=="live")return [];
  const round=state.round,midpoint=Date.parse(round.startedAt)+(ARENA_CONFIG.roundDurationSeconds*1000)/2;
  if(now<midpoint||now>=Date.parse(round.endsAt))return [];
  const created=[];
  for(const agentId of ARENA_CONFIG.agents){
    const key=`${state.campaign.id}:${round.number}:${agentId}`;
    if(state.halftime.reviewedKeys.includes(key))continue;
    const agent=state.agents[agentId],trades=state.trades.filter(trade=>trade.agentId===agentId&&trade.roundNumber===round.number),passCount=qualifiedPassCount(state,agentId,round.number),missionComplete=state.scoring.events.some(event=>event.roundNumber===round.number&&event.agentId===agentId&&event.eventType==="MISSION_BONUS_AWARD"),trailing=isTrailing(state,agentId),hasPosition=Object.keys(agent.positions||{}).length>0;
    let adjustment="NO CHANGE",applied=false;
    if(!missionComplete&&!hasPosition&&agentId==="CODY"&&trades.length===0&&passCount>=2&&(trailing||!missionComplete)){adjustment="SEARCH EXPANDED";applied=true;agent.halftimeAdaptation={roundNumber:round.number,type:"CONFIDENCE_THRESHOLD",openingThreshold:ARENA_CONFIG.vivianOpeningConfidenceThreshold,halftimeThreshold:Math.max(ARENA_CONFIG.vivianConfidenceSafetyFloor,ARENA_CONFIG.vivianHalftimeConfidenceThreshold),finalMinuteThreshold:Math.max(ARENA_CONFIG.vivianConfidenceSafetyFloor,ARENA_CONFIG.vivianFinalMinuteConfidenceThreshold),active:true};}
    if(!missionComplete&&!hasPosition&&agentId==="ATLAS"&&trailing){adjustment="NEXT ALLOCATION INCREASED";applied=true;agent.halftimeAdaptation={roundNumber:round.number,type:"NEXT_TRADE_ALLOCATION",allocationPercent:ARENA_CONFIG.prestonHalftimeAllocationPercent,active:true};}
    const event={eventId:`halftime:${key}`,campaignId:state.campaign.id,roundNumber:round.number,agentId,eventType:"HALFTIME_ANALYSIS",occurredAt:new Date(now).toISOString(),missionProgress:missionComplete?"COMPLETE":"INCOMPLETE",adjustment,applied,campaignScore:state.scoring.campaignScores[agentId],roundScore:roundScore(state,agentId,round.number),tradesCompleted:trades.length,qualifiedOpportunitiesPassed:passCount,timeRemainingSeconds:Math.max(0,Math.ceil((Date.parse(round.endsAt)-now)/1000)),version:HALFTIME_REVIEW_VERSION};
    state.halftime.reviewedKeys.push(key);state.halftime.events.push(event);created.push(event);
  }
  return created;
}

export function ensureHalftimeState(state){if(!state.halftime)state.halftime={version:HALFTIME_REVIEW_VERSION,reviewedKeys:[],events:[]};for(const id of ARENA_CONFIG.agents){const adaptation=state.agents[id].halftimeAdaptation;if(adaptation&&adaptation.roundNumber!==state.round.number)state.agents[id].halftimeAdaptation=null;}return state.halftime;}
export function publicHalftime(state){ensureHalftimeState(state);return {version:HALFTIME_REVIEW_VERSION,recentEvents:state.halftime.events.slice(-20).reverse()};}
function qualifiedPassCount(state,agentId,roundNumber){const penalties=state.scoring.events.filter(event=>event.agentId===agentId&&event.roundNumber===roundNumber&&event.eventType==="QUALIFIED_PASS_PENALTY").length*2,tracker=state.scoring.passState?.[agentId];return penalties+(tracker?.roundNumber===roundNumber?tracker.count:0);}
function roundScore(state,agentId,roundNumber){return state.scoring.events.filter(event=>event.agentId===agentId&&event.roundNumber===roundNumber).reduce((sum,event)=>sum+Number(event.pointsDelta||0),0);}
function isTrailing(state,agentId){const opponent=ARENA_CONFIG.agents.find(id=>id!==agentId);return state.scoring.campaignScores[agentId]<state.scoring.campaignScores[opponent];}

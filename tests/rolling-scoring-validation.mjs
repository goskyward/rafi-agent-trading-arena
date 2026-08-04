import assert from "node:assert/strict";
import { decorateRound, ensureRollingScoring, publicScoring, recordDecisionScoring, recordTradeScoring, recordWipeoutScoring, roundDefinition, settleElapsedRounds } from "../src/rolling-scoring.js";

const startedAt=Date.parse("2026-08-04T00:00:00.000Z"),agent=id=>({id,score:{total:0}}),state={campaign:{id:"campaign-test",status:"ACTIVE",startedAt:new Date(startedAt).toISOString(),endsAt:new Date(startedAt+86400000).toISOString()},round:{number:1,startedAt:new Date(startedAt).toISOString(),endsAt:new Date(startedAt+240000).toISOString(),status:"ACTIVE"},agents:{CODY:agent("CODY"),ATLAS:agent("ATLAS")},trades:[]};
ensureRollingScoring(state,startedAt);
assert.deepEqual([1,2,3,4].map(n=>roundDefinition(n).type),["CAPITAL_ROUND","PRECISION_ROUND","STREAK_ROUND","CAPITAL_ROUND"]);
assert.equal(decorateRound(state.round).objective,"40 PTS · MOST MONEY");

const board=id=>({boardStatus:"ACTIVE",opportunities:[{opportunityId:id,qualified:true,tradability:"TRADABLE",expiresAt:new Date(startedAt+600000).toISOString()}]});
recordDecisionScoring(state,"CODY",{decision:"PASS"},board("opp-a"),startedAt+1000);
recordDecisionScoring(state,"CODY",{decision:"PASS"},board("opp-a"),startedAt+2000);
assert.equal(state.scoring.campaignScores.CODY,0,"repeated polling of one opportunity must not count twice");
recordDecisionScoring(state,"CODY",{decision:"PASS"},board("opp-b"),startedAt+3000);
assert.equal(state.scoring.campaignScores.CODY,-5);

const trade=(tradeId,agentId,pnl,returnPercent,closedOffset,classification="WIN")=>({tradeId,agentId,campaignId:state.campaign.id,roundNumber:1,productId:"BICO-USD",entryAllocationPercent:10,realizedNetProfitUsd:pnl,realizedNetReturnPercent:returnPercent,classification,closedAt:new Date(startedAt+closedOffset).toISOString()});
const rows=[trade("c1","CODY",100,2,30000),trade("c2","CODY",50,1,60000),trade("a1","ATLAS",50,3,45000),trade("be1","CODY",0.01,0.04,70000,"BREAK_EVEN")];state.trades.push(...rows);for(const row of rows)recordTradeScoring(state,row,Date.parse(row.closedAt));
recordTradeScoring(state,trade("be2","CODY",0.01,0.04,80000,"BREAK_EVEN"),startedAt+80000);
assert.equal(state.scoring.events.filter(event=>event.eventType==="BREAK_EVEN_BONUS"&&event.agentId==="CODY").length,1);
recordWipeoutScoring(state,"ATLAS",startedAt+90000);recordWipeoutScoring(state,"ATLAS",startedAt+91000);assert.equal(state.scoring.events.filter(event=>event.eventType==="WIPEOUT_PENALTY").length,1);

state.round={number:2,startedAt:new Date(startedAt+240000).toISOString(),endsAt:new Date(startedAt+480000).toISOString(),status:"ACTIVE"};
const settlements=settleElapsedRounds(state,startedAt+240001);assert.equal(settlements.length,1);assert.equal(settlements[0].roundType,"CAPITAL_ROUND");assert.equal(settlements[0].categoryWinners.mostMoney[0].agentId,"CODY");assert.equal(settlements[0].categoryWinners.highestReturn[0].agentId,"ATLAS");assert.equal(settlements[0].categoryWinners.streak[0].agentId,"CODY");assert.equal(state.scoring.campaignScores.CODY,50);assert.equal(state.scoring.campaignScores.ATLAS,-15);
const eventCount=state.scoring.events.length,scoreSnapshot=JSON.stringify(state.scoring.campaignScores);assert.equal(settleElapsedRounds(state,startedAt+240002).length,0);assert.equal(state.scoring.events.length,eventCount);assert.equal(JSON.stringify(state.scoring.campaignScores),scoreSnapshot);
assert.ok(state.scoring.events.every(event=>Number.isInteger(event.pointsDelta)));assert.ok(Object.values(state.scoring.campaignScores).every(Number.isInteger));assert.equal(publicScoring(state).rulesVersion,"rolling-round-scoring-v1");

function stateForRound(number){const offset=(number-1)*240000,copy={campaign:{id:`campaign-round-${number}`,status:"ACTIVE",startedAt:new Date(startedAt).toISOString(),endsAt:new Date(startedAt+86400000).toISOString()},round:{number,startedAt:new Date(startedAt+offset).toISOString(),endsAt:new Date(startedAt+offset+240000).toISOString(),status:"ACTIVE"},agents:{CODY:agent("CODY"),ATLAS:agent("ATLAS")},trades:[]};ensureRollingScoring(copy,startedAt+offset);return copy;}
function roundTrade(target,tradeId,agentId,pnl,returnPercent,closedOffset){return {tradeId,agentId,campaignId:target.campaign.id,roundNumber:target.round.number,productId:"BTC-USD",entryAllocationPercent:10,realizedNetProfitUsd:pnl,realizedNetReturnPercent:returnPercent,classification:"WIN",closedAt:new Date(Date.parse(target.round.startedAt)+closedOffset).toISOString()};}

const precision=stateForRound(2);precision.trades.push(roundTrade(precision,"pc","CODY",200,2,30000),roundTrade(precision,"pa","ATLAS",100,4,40000));const precisionCash=precision.agents.CODY.cashUsd=1000000;precision.agents.ATLAS.cashUsd=1000000;const precisionSettlement=settleElapsedRounds(precision,Date.parse(precision.round.endsAt)+1)[0];assert.equal(precisionSettlement.roundType,"PRECISION_ROUND");assert.equal(precision.scoring.campaignScores.CODY,15);assert.equal(precision.scoring.campaignScores.ATLAS,40);assert.equal(precision.agents.CODY.cashUsd,precisionCash,"points must not alter financial balances");

const streakRound=stateForRound(3);streakRound.trades.push(roundTrade(streakRound,"s1","CODY",100,2,30000),roundTrade(streakRound,"s2","CODY",80,1,50000),roundTrade(streakRound,"s3","ATLAS",90,3,60000));const streakSettlement=settleElapsedRounds(streakRound,Date.parse(streakRound.round.endsAt)+1)[0];assert.equal(streakSettlement.roundType,"STREAK_ROUND");assert.equal(streakSettlement.categoryWinners.streak[0].agentId,"CODY");assert.equal(streakRound.scoring.campaignScores.CODY,55);assert.equal(streakRound.scoring.campaignScores.ATLAS,10);

const tie=stateForRound(2);tie.trades.push(roundTrade(tie,"tc","CODY",100,1,30000),roundTrade(tie,"ta","ATLAS",100,2,50000));const tieSettlement=settleElapsedRounds(tie,Date.parse(tie.round.endsAt)+1)[0];assert.deepEqual(tieSettlement.categoryWinners.mostMoney.map(row=>[row.agentId,row.points]),[["CODY",8],["ATLAS",7]]);assert.ok(tieSettlement.categoryWinners.mostMoney.every(row=>Number.isInteger(row.points)));

console.log(JSON.stringify({rotation:"passed",capitalRound:"passed",precisionRound:"passed",streakRound:"passed",qualifiedPassPenalty:"passed",breakEvenCap:"passed",wipeoutIdempotency:"passed",streak:"passed",wholeNumberTie:"passed",financialIsolation:"passed",wholeNumbers:"passed",settlementIdempotency:"passed"},null,2));

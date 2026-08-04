import assert from "node:assert/strict";
import { applyHalftimeReviews, publicHalftime } from "../src/halftime-review.js";

const started=Date.parse("2026-08-04T00:00:00.000Z");
function makeState(scores={CODY:0,ATLAS:10}){return {campaign:{id:"campaign-half",status:"ACTIVE"},round:{number:7,startedAt:new Date(started).toISOString(),endsAt:new Date(started+240000).toISOString(),remainingSeconds:120},market:{status:"live"},agents:{CODY:{positions:{},halftimeAdaptation:null},ATLAS:{positions:{},halftimeAdaptation:null}},trades:[],scoring:{campaignScores:scores,events:[{agentId:"CODY",roundNumber:7,eventType:"QUALIFIED_PASS_PENALTY",pointsDelta:-5}],passState:{CODY:{roundNumber:7,count:0},ATLAS:{roundNumber:7,count:0}}}};}

const vivian=makeState();
assert.equal(applyHalftimeReviews(vivian,started+119999).length,0,"review must not run before midpoint");
vivian.market.status="degraded";assert.equal(applyHalftimeReviews(vivian,started+120000).length,0,"stale market must suppress review");vivian.market.status="live";
const reviews=applyHalftimeReviews(vivian,started+120000);assert.equal(reviews.length,2);assert.equal(reviews[0].agentId,"CODY");assert.equal(reviews[0].adjustment,"SEARCH EXPANDED");assert.equal(vivian.agents.CODY.halftimeAdaptation.halftimeThreshold,76);assert.equal(vivian.agents.CODY.halftimeAdaptation.finalMinuteThreshold,74);assert.equal(applyHalftimeReviews(vivian,started+121000).length,0,"review must be idempotent");

const preston=makeState({CODY:20,ATLAS:0});preston.scoring.events=[];applyHalftimeReviews(preston,started+120000);assert.equal(preston.halftime.events.find(event=>event.agentId==="ATLAS").adjustment,"NEXT ALLOCATION INCREASED");assert.equal(preston.agents.ATLAS.halftimeAdaptation.allocationPercent,18);assert.equal(publicHalftime(preston).recentEvents.length,2);
console.log(JSON.stringify({midpointOnce:"passed",staleSuppression:"passed",vivianThresholds:"passed",prestonAllocation:"passed",immutableEvents:"passed"},null,2));

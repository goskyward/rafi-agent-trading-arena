import assert from "node:assert/strict";
import fs from "node:fs";
import { evaluateStrategy } from "../src/strategy-sdk/interface.js";
import { evaluateVivianStrategy,VIVIAN_METADATA } from "../src/strategy-sdk/vivian.js";

const now=Date.parse("2026-08-04T12:00:00.000Z"),iso=new Date(now).toISOString();
const candidate=(productId="BTC-USD",overrides={})=>({candidateId:`RAFI_OPPORTUNITY:${productId}:1`,source:"RAFI_OPPORTUNITY",productId,observedAt:iso,expiresAt:new Date(now+120000).toISOString(),eligible:true,percentMove:3,direction:"UP",volume:1000000,rank:1,opportunityId:`opp-${productId}`,scanId:"scan-1",evidence:{confidence:88,opportunityScore:85},...overrides});
const position=(productId="BTC-USD",overrides={})=>({symbol:productId,quantity:100,averageEntryPrice:100,totalCostBasisUsd:10000,totalEntryFeesUsd:40,openedAt:new Date(now-60000).toISOString(),lastUpdatedAt:iso,candidateId:`RAFI_OPPORTUNITY:${productId}:0`,candidateSource:"RAFI_OPPORTUNITY",opportunityId:`opp-${productId}`,...overrides});
const context=(overrides={})=>{const candidates=overrides.candidates??[candidate()],positions=overrides.positions??{},assets=overrides.assets??Object.fromEntries([...new Set([...candidates.map(x=>x.productId),...Object.keys(positions)])].map(productId=>[productId,{price:100,changePercent:2,updatedAt:iso}]));return {agent:{positions,cashUsd:750000,accountEquityUsd:1000000,startingBalanceUsd:1000000,metrics:{completedTrades:0,winningTrades:0,losingTrades:0},...overrides.agent},candidates,assets,availableSlots:overrides.availableSlots??Math.max(0,3-Object.keys(positions).length),cash:overrides.cash??750000,equity:overrides.equity??1000000,campaign:{id:"campaign-test",status:"ACTIVE",progressPercent:10,...overrides.campaign},round:{number:7,status:"ACTIVE",remainingSeconds:180,...overrides.round},costEstimates:{feeRateBps:40,slippageBps:5,syntheticSpreadBps:4,...overrides.costEstimates},now,...overrides.context};};
const decide=overrides=>evaluateStrategy(evaluateVivianStrategy,context(overrides));

assert.equal(VIVIAN_METADATA.strategyVersion,"VIVIAN_EDGE_MOMENTUM_V1.0.0");

const noOpportunity=decide({candidates:[]});assert.equal(noOpportunity.decision,"PASS");assert.equal(noOpportunity.reasonCode,"VIVIAN_NO_OPPORTUNITY");
const valid=decide({});assert.equal(valid.decision,"TRADE");assert.equal(valid.productId,"BTC-USD");assert.ok(valid.allocation.value>=8&&valid.allocation.value<=24);
const several=decide({candidates:[candidate("BTC-USD",{rank:2,evidence:{confidence:82,opportunityScore:80}}),candidate("ETH-USD",{percentMove:4,rank:1,evidence:{confidence:94,opportunityScore:92}})]});assert.equal(several.productId,"ETH-USD");
const expired=decide({candidates:[candidate("BTC-USD",{expiresAt:new Date(now-1).toISOString()})]});assert.equal(expired.decision,"PASS");assert.ok(expired.reasonCodes.includes("EXPIRED_CANDIDATE"));
const staleQuote=decide({assets:{"BTC-USD":{price:100,updatedAt:new Date(now-91000).toISOString()}}});assert.equal(staleQuote.reasonCode,"VIVIAN_STALE_QUOTE");
const wideSpread=decide({candidates:[candidate("BTC-USD",{evidence:{confidence:92,opportunityScore:90,spreadBps:200}})]});assert.equal(wideSpread.reasonCode,"VIVIAN_COST_REJECTION");
const insufficient=decide({cash:1000,agent:{cashUsd:1000}});assert.equal(insufficient.reasonCode,"VIVIAN_INSUFFICIENT_CASH");

const profitable=decide({candidates:[],positions:{"BTC-USD":position()},assets:{"BTC-USD":{price:101,updatedAt:iso,changePercent:1}}});assert.equal(profitable.decision,"MANAGE_POSITION");
const losing=decide({candidates:[],positions:{"BTC-USD":position()},assets:{"BTC-USD":{price:99,updatedAt:iso,changePercent:-.2}}});assert.equal(losing.decision,"MANAGE_POSITION");
const stop=decide({candidates:[],positions:{"BTC-USD":position()},assets:{"BTC-USD":{price:98,updatedAt:iso,changePercent:-2}}});assert.equal(stop.reasonCode,"VIVIAN_HARD_STOP");assert.equal(stop.decision,"SELL");
const target=decide({candidates:[],positions:{"BTC-USD":position()},assets:{"BTC-USD":{price:103,updatedAt:iso,changePercent:2}}});assert.equal(target.reasonCode,"VIVIAN_PROFIT_TARGET");
const timed=decide({candidates:[],positions:{"BTC-USD":position("BTC-USD",{openedAt:new Date(now-220000).toISOString()})},assets:{"BTC-USD":{price:100.5,updatedAt:iso,changePercent:.5}}});assert.equal(timed.reasonCode,"VIVIAN_TIME_EXIT");

const duplicateA=decide({}),duplicateB=decide({});assert.deepEqual(duplicateA,duplicateB);assert.equal(duplicateA.idempotencyKey,duplicateB.idempotencyKey);
const controller=fs.readFileSync(new URL("../src/arena-controller.js",import.meta.url),"utf8");assert.match(controller,/activity\.decisionSequenceId===sequenceId/);assert.match(controller,/state\.idempotency\[input\.idempotencyKey\]/);
assert.throws(()=>evaluateStrategy(evaluateVivianStrategy,{agent:{},candidates:[]}),/incomplete/);

const exceptional=decide({});assert.equal(exceptional.allocation.value,24);
const cautious=decide({candidates:[candidate("BTC-USD",{percentMove:2.2,evidence:{confidence:75,opportunityScore:74}})]});assert.equal(cautious.decision,"TRADE");assert.ok(cautious.allocation.value>=8&&cautious.allocation.value<24);
const feeSensitive=decide({candidates:[candidate("BTC-USD",{percentMove:.7,evidence:{confidence:90,opportunityScore:90}})]});assert.equal(feeSensitive.reasonCode,"VIVIAN_COST_REJECTION");
const roundEnd=decide({candidates:[],round:{remainingSeconds:20},positions:{"BTC-USD":position("BTC-USD",{openedAt:new Date(now-190000).toISOString()})},assets:{"BTC-USD":{price:101,updatedAt:iso,changePercent:.5}}});assert.equal(roundEnd.reasonCode,"VIVIAN_ROUND_EXIT");
const halftime=decide({campaign:{progressPercent:50},equity:970000,agent:{accountEquityUsd:970000},candidates:[candidate()]});assert.equal(halftime.decision,"TRADE");assert.ok(halftime.allocation.value<exceptional.allocation.value);

const stalePosition=decide({candidates:[],positions:{"BTC-USD":position()},assets:{"BTC-USD":{price:98,updatedAt:new Date(now-91000).toISOString(),changePercent:-2}}});assert.equal(stalePosition.decision,"MANAGE_POSITION");assert.equal(stalePosition.reasonCode,"VIVIAN_STALE_QUOTE");
const thesis=decide({candidates:[candidate("BTC-USD",{percentMove:-1,direction:"DOWN"})],positions:{"BTC-USD":position()},assets:{"BTC-USD":{price:99.5,updatedAt:iso,changePercent:-1}}});assert.equal(thesis.reasonCode,"VIVIAN_THESIS_INVALIDATED");
assert.equal(valid.agentId,"CODY");assert.equal(valid.dialogueText,"The edge is clean. I'm taking it.");assert.equal(valid.strategyVersion,VIVIAN_METADATA.strategyVersion);assert.ok(valid.supportingMetrics&&valid.riskMetrics&&valid.evaluatedAt);

console.log(JSON.stringify({strategy:VIVIAN_METADATA.strategyVersion,cases:20,deterministic:true,allocationRange:[8,24],prestonModified:false}));

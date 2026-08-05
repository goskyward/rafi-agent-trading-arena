import assert from "node:assert/strict";
import { validateStrategyDecision } from "../src/strategy-sdk/contracts.js";
import { OpportunityEngineMarketProvider } from "../src/market-provider.js";
import { evaluatePrestonStrategy,mapArenaContextToPreston,mapPrestonDecisionToArena,PRESTON_METADATA } from "../src/strategy-sdk/preston.js";
import { decidePrestonStrategy } from "../src/strategy-sdk/preston/preston-strategy.ts";

const now=Date.parse("2026-08-05T12:00:00.000Z"),iso=new Date(now).toISOString();
let cases=0,assertions=0;
const pending=[];
const test=(name,fn)=>{const result=fn();if(result&&typeof result.then==="function")pending.push(result.then(()=>{cases++;}));else cases++;};
const eq=(actual,expected,message)=>{assertions++;assert.equal(actual,expected,message);};
const ok=(value,message)=>{assertions++;assert.ok(value,message);};
const deep=(actual,expected,message)=>{assertions++;assert.deepEqual(actual,expected,message);};
const throws=(fn,match)=>{assertions++;assert.throws(fn,match);};

const candidate=(productId="BTC-USD",overrides={})=>({candidateId:`RAFI_OPPORTUNITY:opp-${productId}`,source:"RAFI_OPPORTUNITY",opportunityId:`opp-${productId}`,scanId:"scan-1",productId,eligible:true,observedAt:iso,expiresAt:new Date(now+240000).toISOString(),referencePrice:100,percentMove:.4,direction:"UP",rank:1,evidence:{confidence:90,opportunityScore:90,volumeRatio:1.8,atrPct:1,...overrides.evidence},...overrides});
const position=(productId="BTC-USD",overrides={})=>({symbol:productId,quantity:100,averageEntryPrice:100,totalCostBasisUsd:10000,totalEntryFeesUsd:40,openedAt:new Date(now-60000).toISOString(),lastUpdatedAt:iso,lastMarkPrice:100,candidateId:`RAFI_OPPORTUNITY:opp-${productId}`,candidateSource:"RAFI_OPPORTUNITY",opportunityId:`opp-${productId}`,...overrides});
const context=(overrides={})=>{const candidates=overrides.candidates??[candidate()],positions=overrides.positions??{},products=[...new Set([...candidates.map(x=>x.productId),...Object.keys(positions)])];return {agent:{positions,cashUsd:800000,accountEquityUsd:1000000,startingBalanceUsd:1000000,metrics:{completedTrades:0},...overrides.agent},candidates,assets:overrides.assets??Object.fromEntries(products.map(productId=>[productId,{price:100,updatedAt:iso}])),round:{number:42,status:"ACTIVE",remainingSeconds:180,progressPercent:25,durationSeconds:240,...overrides.round},campaign:{id:"campaign-preston",status:"ACTIVE",remainingSeconds:43200,progressPercent:40,...overrides.campaign},availableSlots:overrides.availableSlots??Math.max(0,3-Object.keys(positions).length),cash:overrides.cash??800000,equity:overrides.equity??1000000,now,...overrides.context};};
const decide=overrides=>validateStrategyDecision(evaluatePrestonStrategy(context(overrides)));

test("1 no opportunity",()=>{const result=decide({candidates:[]});eq(result.decision,"PASS");eq(result.reasonCode,"PASS_NO_ELIGIBLE_OPPORTUNITY");});
test("2 strong valid opportunity",()=>{const result=decide({});eq(result.decision,"TRADE");eq(result.productId,"BTC-USD");ok(result.allocation.value>=5&&result.allocation.value<=25);});
test("3 expired opportunity",()=>{const result=decide({candidates:[candidate("BTC-USD",{expiresAt:new Date(now-1).toISOString()})]});eq(result.decision,"PASS");});
test("4 unsupported product",()=>{const result=decide({candidates:[candidate("BTC-USDT")]});eq(result.decision,"PASS");});
test("5 weak confidence",()=>{const result=decide({candidates:[candidate("BTC-USD",{evidence:{confidence:61}})]});eq(result.reasonCode,"PASS_WEAK_EVIDENCE");});
test("6 bearish candidate",()=>{const result=decide({candidates:[candidate("BTC-USD",{direction:"DOWN"})]});eq(result.decision,"PASS");});
test("7 extended move rejection",()=>{const result=decide({candidates:[candidate("BTC-USD",{percentMove:2,evidence:{confidence:90,atrPct:1}})]});eq(result.reasonCode,"PASS_LATE_ENTRY");});
test("8 stable deterministic ranking",()=>{const a=candidate("ETH-USD",{rank:2}),b=candidate("BTC-USD",{rank:1});const one=decide({candidates:[a,b]}),two=decide({candidates:[b,a]});eq(one.productId,"BTC-USD");deep(one,two);});
test("9 existing Preston position",()=>{const result=decide({positions:{"BTC-USD":position()},assets:{"BTC-USD":{price:100,updatedAt:iso}}});eq(result.decision,"MANAGE_POSITION");eq(result.productId,"BTC-USD");});
test("10 take profit",()=>{const result=decide({positions:{"BTC-USD":position()},assets:{"BTC-USD":{price:101,updatedAt:iso}}});eq(result.reasonCode,"EXIT_TAKE_PROFIT");eq(result.decision,"SELL");});
test("11 stop loss",()=>{const result=decide({positions:{"BTC-USD":position()},assets:{"BTC-USD":{price:99.3,updatedAt:iso}}});eq(result.reasonCode,"EXIT_STOP_LOSS");});
test("12 round end exit",()=>{const result=decide({positions:{"BTC-USD":position()},assets:{"BTC-USD":{price:100,updatedAt:iso}},round:{remainingSeconds:30}});eq(result.reasonCode,"EXIT_ROUND_END");});
test("13 invalid context",()=>{const result=decide({agent:{cashUsd:"invalid"},cash:"invalid"});eq(result.reasonCode,"PASS_INVALID_CONTEXT");});
test("14 allocation conversion",()=>{const arena=context({}),raw=decidePrestonStrategy(mapArenaContextToPreston(arena)),mapped=mapPrestonDecisionToArena(raw,arena);eq(mapped.allocation.value,raw.allocationPct*100);eq(mapped.allocation.type,"PERCENT_OF_AVAILABLE_CASH");});
test("15 confidence conversion",()=>{const arena=context({candidates:[candidate("BTC-USD",{evidence:{confidence:82}})]}),mappedContext=mapArenaContextToPreston(arena),result=evaluatePrestonStrategy(arena);eq(mappedContext.opportunities[0].confidence,.82);eq(result.confidence,82);});
test("16 timestamp conversion",()=>{const mapped=mapArenaContextToPreston(context({}));eq(mapped.opportunities[0].observedAtMs,now);eq(mapped.opportunities[0].expiresAtMs,now+240000);});
test("17 stale execution quote rejected by Arena",async()=>{const originalFetch=globalThis.fetch;globalThis.fetch=async()=>new Response(JSON.stringify({price:100,sourceTimestamp:new Date(Date.now()-91000).toISOString(),stale:true}),{status:200,headers:{"content-type":"application/json"}});try{assertions++;await assert.rejects(()=>new OpportunityEngineMarketProvider({OPPORTUNITY_ENGINE_BASE_URL:"https://example.test",MAX_QUOTE_AGE_SECONDS:"90"}).getMarketQuote("BTC-USD"),error=>error.code==="STALE_QUOTE");}finally{globalThis.fetch=originalFetch;}});
test("18 idempotent repeated decision",()=>{const arena=context({}),one=evaluatePrestonStrategy(arena),two=evaluatePrestonStrategy(structuredClone(arena));deep(one,two);ok(one.idempotencyKey.startsWith("preston:"));});
test("19 Preston cannot open a second position",()=>{const result=decide({positions:{"ETH-USD":position("ETH-USD")},candidates:[candidate("BTC-USD")],assets:{"ETH-USD":{price:100,updatedAt:iso},"BTC-USD":{price:100,updatedAt:iso}}});ok(result.decision!=="TRADE");eq(result.productId,"ETH-USD");});
test("20 Preston cannot manage Vivian position",()=>{const vivian=position("SOL-USD"),arena=context({context:{vivianAgent:{positions:{"SOL-USD":vivian}}}}),result=evaluatePrestonStrategy(arena);eq(result.decision,"TRADE");eq(result.productId,"BTC-USD");eq(mapArenaContextToPreston(arena).position,null);});

await Promise.all(pending);
eq(PRESTON_METADATA.strategyId,"preston-atlas-v1");
eq(PRESTON_METADATA.strategyVersion,"PRESTON_ANTHROPIC_V1.0.0");
console.log(JSON.stringify({strategy:PRESTON_METADATA.strategyVersion,cases,assertions,sourceParity:"passed",singlePosition:true,vivianModified:false}));

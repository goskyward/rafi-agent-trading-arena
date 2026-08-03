import assert from "node:assert/strict";
const base="http://127.0.0.1:8790", upstream="http://127.0.0.1:8791", token="integration-test-token", auth={Authorization:`Bearer ${token}`,"Content-Type":"application/json"};
const request=async(path,options={})=>{const response=await fetch(base+path,options);let body=null;try{body=await response.json();}catch{}return {status:response.status,body,headers:response.headers};};
const post=(path,body,authorized=true)=>request(path,{method:"POST",headers:authorized?auth:{"Content-Type":"application/json"},body:body===undefined?undefined:JSON.stringify(body)});
const mode=name=>fetch(`${upstream}/__mode/${name}`);
const price=(product,value)=>fetch(`${upstream}/__price/${encodeURIComponent(product)}/${value}`);
const results={}; let r;

r=await request("/health");assert.equal(r.status,200);assert.equal(r.body.durableObject.available,true);results.health="passed";
r=await request("/arena/admin/verify");assert.equal(r.status,401);r=await request("/arena/admin/verify",{headers:auth});assert.equal(r.status,200);assert.equal(r.body.authenticated,true);results.commanderAuthentication="passed";
await post("/arena/reset",{confirm:"RESET_ARENA"});for(const path of ["/arena/start","/arena/reset","/arena/order","/arena/settle"]){r=await post(path,path==="/arena/reset"?{confirm:"RESET_ARENA"}:undefined,false);assert.equal(r.status,401);assert.equal(r.body.error.code,"UNAUTHORIZED");}
r=await post("/arena/start");assert.equal(r.status,200);assert.equal(Date.parse(r.body.campaign.endsAt)-Date.parse(r.body.campaign.startedAt),86400000);assert.equal(r.body.round.number,1);assert.equal(r.body.scoreboard.leader,"TIE");
r=await post("/arena/start");assert.equal(r.status,409);assert.equal(r.body.error.code,"CAMPAIGN_ALREADY_ACTIVE");results.campaign="passed";

const buy={agentId:"CODY",side:"BUY",productId:"BTC-USD",amountUsd:250000,idempotencyKey:"integration-buy-001"};
const first=await post("/arena/order",buy), cashAfter=first.body.agent.cashUsd;assert.equal(first.status,200);assert.equal(first.body.order.quote.stale,false);
const retry=await post("/arena/order",buy);assert.equal(retry.body.order.orderId,first.body.order.orderId);assert.equal(retry.body.agent.cashUsd,cashAfter);
r=await post("/arena/order",{...buy,amountUsd:100});assert.equal(r.status,409);assert.equal(r.body.error.code,"IDEMPOTENCY_KEY_REUSED");results.idempotencySequential="passed";

await mode("stale");r=await post("/arena/order",{agentId:"ATLAS",side:"BUY",productId:"ETH-USD",amountUsd:10,idempotencyKey:"quote-stale-001"});assert.equal(r.body.error.code,"STALE_QUOTE");
await mode("missingtime");r=await post("/arena/order",{agentId:"ATLAS",side:"BUY",productId:"ETH-USD",amountUsd:10,idempotencyKey:"quote-missing-001"});assert.equal(r.body.error.code,"PRICE_UNAVAILABLE");
await mode("invalidtime");r=await post("/arena/order",{agentId:"ATLAS",side:"BUY",productId:"ETH-USD",amountUsd:10,idempotencyKey:"quote-invalid-001"});assert.equal(r.body.error.code,"PRICE_UNAVAILABLE");
await mode("badprice");r=await post("/arena/order",{agentId:"ATLAS",side:"BUY",productId:"ETH-USD",amountUsd:10,idempotencyKey:"quote-price-001"});assert.equal(r.body.error.code,"PRICE_UNAVAILABLE");
await mode("unavailable");r=await post("/arena/order",{agentId:"ATLAS",side:"BUY",productId:"ETH-USD",amountUsd:10,idempotencyKey:"quote-down-001"});assert.ok(["PRICE_UNAVAILABLE","UPSTREAM_UNAVAILABLE"].includes(r.body.error.code));await mode("live");results.quoteFreshness="passed";

await post("/arena/reset",{confirm:"RESET_ARENA"});await post("/arena/start");
const same={agentId:"CODY",side:"BUY",productId:"BTC-USD",amountUsd:100000,idempotencyKey:"concurrent-same-key"};const sameResponses=await Promise.all([post("/arena/order",same),post("/arena/order",same)]);assert.ok(sameResponses.every(x=>x.status===200));assert.equal(sameResponses[0].body.order.orderId,sameResponses[1].body.order.orderId);
let arena=(await request("/arena")).body;assert.equal(arena.agents.CODY.cashUsd,sameResponses[0].body.agent.cashUsd);
const overSpend=await Promise.all([post("/arena/order",{agentId:"ATLAS",side:"BUY",productId:"BTC-USD",amountUsd:750000,idempotencyKey:"over-spend-001"}),post("/arena/order",{agentId:"ATLAS",side:"BUY",productId:"ETH-USD",amountUsd:750000,idempotencyKey:"over-spend-002"})]);assert.equal(overSpend.filter(x=>x.status===200).length,1);assert.equal(overSpend.filter(x=>x.body?.error?.code==="INSUFFICIENT_CASH").length,1);
const simultaneous=await Promise.all([post("/arena/order",{agentId:"CODY",side:"BUY",productId:"SOL-USD",amountUsd:1000,idempotencyKey:"cross-agent-cody"}),post("/arena/order",{agentId:"ATLAS",side:"BUY",productId:"XRP-USD",amountUsd:1000,idempotencyKey:"cross-agent-atlas"})]);assert.ok(simultaneous.every(x=>x.status===200));results.concurrencyBuys="passed";
const overSell=await Promise.all([post("/arena/order",{agentId:"CODY",side:"SELL",productId:"SOL-USD",positionPercent:100,idempotencyKey:"over-sell-001"}),post("/arena/order",{agentId:"CODY",side:"SELL",productId:"SOL-USD",positionPercent:100,idempotencyKey:"over-sell-002"})]);assert.equal(overSell.filter(x=>x.status===200).length,1);assert.equal(overSell.filter(x=>x.body?.error?.code==="INSUFFICIENT_POSITION").length,1);results.concurrencySells="passed";

await post("/arena/reset",{confirm:"RESET_ARENA"});await post("/arena/start");await price("XRP-USD",3);r=await post("/arena/order",{agentId:"ATLAS",side:"BUY",productId:"XRP-USD",allocationPercent:100,idempotencyKey:"wipeout-buy-001"});assert.equal(r.status,200);await price("XRP-USD",0.00000000001);arena=(await request("/arena")).body;assert.equal(arena.agents.ATLAS.wipedOut,true);assert.equal(arena.agents.ATLAS.metrics.wipeouts,1);arena=(await request("/arena")).body;assert.equal(arena.agents.ATLAS.metrics.wipeouts,1);r=await post("/arena/order",{agentId:"ATLAS",side:"BUY",productId:"BTC-USD",amountUsd:1,idempotencyKey:"wipeout-rebuy-001"});assert.equal(r.status,409);assert.equal(r.body.error.code,"AGENT_WIPED_OUT");results.wipeout="passed";await price("XRP-USD",3);

await post("/arena/reset",{confirm:"RESET_ARENA"});await post("/arena/start");await price("SOL-USD",200);
const entry=await post("/arena/order",{agentId:"CODY",side:"BUY",productId:"SOL-USD",amountUsd:2000,idempotencyKey:"partial-entry-001"});const original=entry.body.agent.positions["SOL-USD"];
await price("SOL-USD",250);const exits=[];for(const [pct,key] of [[25,"partial-exit-001"],[100/3,"partial-exit-002"],[100,"partial-exit-003"]]) exits.push(await post("/arena/order",{agentId:"CODY",side:"SELL",productId:"SOL-USD",positionPercent:pct,idempotencyKey:key}));
assert.ok(exits.every(x=>x.status===200));assert.equal(exits[2].body.agent.positions["SOL-USD"],undefined);const allocated=exits.reduce((s,x)=>s+x.body.trade.entryNotionalUsd+x.body.trade.entryFeesUsd,0);assert.ok(Math.abs(allocated-original.totalCostBasisUsd)<0.0001);assert.equal(exits[2].body.agent.metrics.completedTrades,3);assert.equal(exits[2].body.agent.metrics.winningTrades,3);assert.equal(exits[2].body.agent.metrics.successfulTrades,3);assert.deepEqual(exits[2].body.agent.metrics.profitableUniqueAssets,["SOL-USD"]);results.partialSells="passed";

// Leave durable state containing an open position, trades, metrics, idempotency, and advanced sequences for restart validation.
const persistent=await post("/arena/order",{agentId:"ATLAS",side:"BUY",productId:"BTC-USD",amountUsd:12345,idempotencyKey:"persistence-buy-001"});assert.equal(persistent.status,200);
arena=(await request("/arena")).body;assert.equal(arena.recentTrades.length,3);assert.ok(arena.agents.ATLAS.positions["BTC-USD"]);assert.doesNotMatch(JSON.stringify(arena),/NaN|Infinity/);results.persistenceFixture="created";

r=await request("/not-found");assert.equal(r.status,404);r=await request("/health",{method:"PUT"});assert.equal(r.status,405);r=await post("/arena/order",{bad:true});assert.equal(r.body.error.code,"INVALID_AGENT");r=await request("/arena/reset",{method:"POST",headers:auth,body:"{"});assert.equal(r.status,400);assert.equal(r.body.error.code,"INVALID_JSON");r=await request("/arena",{method:"OPTIONS",headers:{Origin:"http://localhost:8787"}});assert.equal(r.status,204);assert.equal(r.headers.get("access-control-allow-origin"),"http://localhost:8787");results.routerSecurity="passed";
console.log(JSON.stringify(results,null,2));

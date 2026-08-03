const hold=(productId,reasonCode,confidence=50)=>({action:"HOLD",productId,allocationPercent:null,positionPercent:null,reasonCode,confidence});

export class CodyStrategy {
  decide({agent,assets,round,uatMode=false}) {
    const position=Object.values(agent.positions||{})[0];
    if(uatMode){const btc=assets["BTC-USD"]||Object.values(assets)[0];if(position){const heldSeconds=Math.max(0,(Date.now()-Date.parse(position.openedAt))/1000);if(heldSeconds>=20)return {action:"SELL",productId:position.symbol,allocationPercent:null,positionPercent:100,reasonCode:"UAT_CONTROLLED_EXIT",confidence:100};return hold(position.symbol,"UAT_MONITORING_POSITION",100);}if(agent.metrics?.completedTrades>0)return hold(btc?.productId||"BTC-USD","UAT_LIFECYCLE_COMPLETE",100);if(btc)return {action:"BUY",productId:btc.productId,allocationPercent:1,positionPercent:null,reasonCode:"UAT_CONTROLLED_ENTRY",confidence:100};}
    if(position){const asset=assets[position.symbol],change=asset?((asset.price-position.averageEntryPrice)/position.averageEntryPrice)*100:0;if(change>=1||change<=-0.8||round.remainingSeconds<=30)return {action:"SELL",productId:position.symbol,allocationPercent:null,positionPercent:100,reasonCode:change>=1?"CODY_MOMENTUM_TARGET":change<=-0.8?"CODY_RISK_EXIT":"CODY_ROUND_PRESSURE",confidence:82};return hold(position.symbol,"CODY_MONITOR_POSITION",68);}
    const ranked=Object.values(assets).sort((a,b)=>b.changePercent-a.changePercent),asset=ranked[0];
    if(!asset||asset.changePercent<0)return hold(asset?.productId||"BTC-USD","CODY_NO_POSITIVE_MOMENTUM",55);
    return {action:"BUY",productId:asset.productId,allocationPercent:25,positionPercent:null,reasonCode:"CODY_MOMENTUM_ENTRY",confidence:Math.min(95,65+Math.abs(asset.changePercent)*5)};
  }
}

export class AtlasStrategy {
  decide({agent,assets,round}) {
    const position=Object.values(agent.positions||{})[0];
    if(position){const asset=assets[position.symbol],change=asset?((asset.price-position.averageEntryPrice)/position.averageEntryPrice)*100:0;if(change>=0.7||change<=-0.6||round.remainingSeconds<=30)return {action:"SELL",productId:position.symbol,allocationPercent:null,positionPercent:100,reasonCode:change>=0.7?"ATLAS_REVERSION_TARGET":change<=-0.6?"ATLAS_RISK_EXIT":"ATLAS_ROUND_PRESSURE",confidence:78};return hold(position.symbol,"ATLAS_MONITOR_POSITION",72);}
    const ranked=Object.values(assets).sort((a,b)=>a.changePercent-b.changePercent),asset=ranked[0];
    if(!asset||asset.changePercent>0)return hold(asset?.productId||"ETH-USD","ATLAS_NO_OVERSOLD_ASSET",58);
    return {action:"BUY",productId:asset.productId,allocationPercent:15,positionPercent:null,reasonCode:"ATLAS_REVERSION_ENTRY",confidence:Math.min(92,62+Math.abs(asset.changePercent)*5)};
  }
}

export const AGENT_REGISTRY=Object.freeze({CODY:new CodyStrategy(),ATLAS:new AtlasStrategy()});

export function validateAgentDecision(decision){
  if(!decision||!["BUY","SELL","HOLD"].includes(decision.action))throw new Error("Invalid agent action");
  if(typeof decision.productId!=="string")throw new Error("Invalid agent product");
  if(decision.action==="BUY"&&(!Number.isFinite(decision.allocationPercent)||decision.allocationPercent<=0||decision.allocationPercent>100))throw new Error("Invalid agent allocation");
  if(decision.action==="SELL"&&(!Number.isFinite(decision.positionPercent)||decision.positionPercent<=0||decision.positionPercent>100))throw new Error("Invalid agent position percentage");
  return decision;
}

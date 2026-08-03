const pass = (reasonCode, confidence = 50) => ({ decision: "PASS", productId: null, selectedOpportunityId: null, allocation: null, reasonCode, confidence });
const manage = (position, reasonCode, confidence = 50) => ({ decision: "MANAGE_POSITION", productId: position.symbol, selectedOpportunityId: position.opportunityId || null, allocation: null, reasonCode, confidence });

export class CodyStrategy {
  static version = "CODY_MOMENTUM_V1.1";
  decide({ agent, opportunities, assets, round, uatMode = false }) {
    const position = Object.values(agent.positions || {})[0];
    if (position) {
      const asset = assets[position.symbol], change = asset ? ((asset.price - position.averageEntryPrice) / position.averageEntryPrice) * 100 : 0;
      const heldSeconds = Math.max(0, (Date.now() - Date.parse(position.openedAt)) / 1000);
      if ((uatMode && heldSeconds >= 20) || change >= 1 || change <= -0.8 || round.remainingSeconds <= 30) return { decision:"SELL", productId:position.symbol, selectedOpportunityId:position.opportunityId || null, allocation:null, positionPercent:100, reasonCode:uatMode?"UAT_CONTROLLED_EXIT":change>=1?"CODY_MOMENTUM_TARGET":change<=-0.8?"CODY_RISK_EXIT":"CODY_ROUND_PRESSURE", confidence:uatMode?100:82 };
      return manage(position, "CODY_MONITOR_POSITION", 68);
    }
    if (uatMode && agent.metrics?.completedTrades > 0) return pass("UAT_LIFECYCLE_COMPLETE", 100);
    const ranked = opportunities.filter(item => assets[item.productId]).sort((a,b) => marketChange(b)-marketChange(a) || b.opportunityScore-a.opportunityScore);
    const opportunity = ranked[0];
    if (!opportunity || (!uatMode && marketChange(opportunity) < 0)) return pass("CODY_NO_POSITIVE_MOMENTUM", 55);
    return { decision:"TRADE", productId:opportunity.productId, selectedOpportunityId:opportunity.opportunityId, allocation:{type:"PERCENT_OF_AVAILABLE_CASH",value:uatMode?1:25}, reasonCode:uatMode?"UAT_CONTROLLED_ENTRY":"CODY_MOMENTUM_ENTRY", confidence:uatMode?100:Math.min(95,65+Math.abs(marketChange(opportunity))*5) };
  }
}

export class AtlasStrategy {
  static version = "ATLAS_REVERSION_V1.1";
  decide({ agent, opportunities, assets, round }) {
    const position = Object.values(agent.positions || {})[0];
    if (position) {
      const asset=assets[position.symbol], change=asset?((asset.price-position.averageEntryPrice)/position.averageEntryPrice)*100:0;
      if(change>=0.7||change<=-0.6||round.remainingSeconds<=30)return {decision:"SELL",productId:position.symbol,selectedOpportunityId:position.opportunityId||null,allocation:null,positionPercent:100,reasonCode:change>=0.7?"ATLAS_REVERSION_TARGET":change<=-0.6?"ATLAS_RISK_EXIT":"ATLAS_ROUND_PRESSURE",confidence:78};
      return manage(position,"ATLAS_MONITOR_POSITION",72);
    }
    const ranked=opportunities.filter(item=>assets[item.productId]).sort((a,b)=>marketChange(a)-marketChange(b)||b.opportunityScore-a.opportunityScore), opportunity=ranked[0];
    if(!opportunity||marketChange(opportunity)>0)return pass("ATLAS_NO_OVERSOLD_ASSET",58);
    return {decision:"TRADE",productId:opportunity.productId,selectedOpportunityId:opportunity.opportunityId,allocation:{type:"PERCENT_OF_AVAILABLE_CASH",value:15},reasonCode:"ATLAS_REVERSION_ENTRY",confidence:Math.min(92,62+Math.abs(marketChange(opportunity))*5)};
  }
}

export const AGENT_REGISTRY=Object.freeze({CODY:new CodyStrategy(),ATLAS:new AtlasStrategy()});
export const STRATEGY_VERSIONS=Object.freeze({CODY:CodyStrategy.version,ATLAS:AtlasStrategy.version});

export function validateAgentDecision(decision){
  if(!decision||!["TRADE","PASS","SELL","MANAGE_POSITION"].includes(decision.decision))throw new Error("Invalid agent decision");
  if(decision.decision==="TRADE"&&(!decision.selectedOpportunityId||!decision.productId||decision.allocation?.type!=="PERCENT_OF_AVAILABLE_CASH"||!Number.isFinite(decision.allocation.value)||decision.allocation.value<1||decision.allocation.value>100))throw new Error("Invalid trade decision");
  if(decision.decision!=="TRADE"&&decision.allocation!==null)throw new Error("Non-trade allocation must be null");
  if(decision.decision==="SELL"&&(!decision.productId||!Number.isFinite(decision.positionPercent)))throw new Error("Invalid sell decision");
  return decision;
}

function marketChange(opportunity){return Number(opportunity?.upstreamIntelligence?.changePercent)||0;}

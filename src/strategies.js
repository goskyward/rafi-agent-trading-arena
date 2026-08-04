import { evaluateVivianStrategy, VIVIAN_METADATA } from "./strategy-sdk/vivian.js";
import { evaluatePrestonStrategy, PRESTON_METADATA } from "./strategy-sdk/preston.js";
import { validateStrategyDecision } from "./strategy-sdk/contracts.js";

// Stable Arena Rules v1.1 compatibility adapters. Strategy modules receive no
// execution, UI, scoring, persistence, or networking authority.
export class CodyStrategy {static version=VIVIAN_METADATA.strategyVersion;decide(context){return evaluateVivianStrategy(context);}}
export class AtlasStrategy {static version=PRESTON_METADATA.strategyVersion;decide(context){return evaluatePrestonStrategy(context);}}
export const AGENT_REGISTRY=Object.freeze({CODY:new CodyStrategy(),ATLAS:new AtlasStrategy()});
export const STRATEGY_METADATA=Object.freeze({CODY:VIVIAN_METADATA,ATLAS:PRESTON_METADATA});
export const STRATEGY_VERSIONS=Object.freeze({CODY:VIVIAN_METADATA.strategyVersion,ATLAS:PRESTON_METADATA.strategyVersion});
export const validateAgentDecision=validateStrategyDecision;

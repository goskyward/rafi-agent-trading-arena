import { VIVIAN_METADATA } from "./strategy-sdk/vivian.js";
import { PRESTON_METADATA } from "./strategy-sdk/preston.js";
import { TemporaryVivianAdapter } from "./strategy-sdk/vivian-adapter.js";
import { TemporaryPrestonAdapter } from "./strategy-sdk/preston-adapter.js";
import { validateStrategyDecision } from "./strategy-sdk/contracts.js";

// Stable Arena Rules v1.1 compatibility adapters. Strategy modules receive no
// execution, UI, scoring, persistence, or networking authority.
export class CodyStrategy extends TemporaryVivianAdapter {}
export class AtlasStrategy extends TemporaryPrestonAdapter {}
export const AGENT_REGISTRY=Object.freeze({CODY:new CodyStrategy(),ATLAS:new AtlasStrategy()});
export const STRATEGY_METADATA=Object.freeze({CODY:VIVIAN_METADATA,ATLAS:PRESTON_METADATA});
export const STRATEGY_VERSIONS=Object.freeze({CODY:VIVIAN_METADATA.strategyVersion,ATLAS:PRESTON_METADATA.strategyVersion});
export const validateAgentDecision=validateStrategyDecision;

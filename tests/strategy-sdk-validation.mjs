import assert from "node:assert/strict";
import { ARENA_RULES_VERSION,REASON_CODES,validateStrategyContext,validateStrategyDecision } from "../src/strategy-sdk/contracts.js";
import { STRATEGY_FIXTURES } from "../src/strategy-sdk/fixtures.js";
import { evaluateStrategy } from "../src/strategy-sdk/interface.js";
import { evaluateVivianStrategy,VIVIAN_METADATA } from "../src/strategy-sdk/vivian.js";
import { evaluatePrestonStrategy,PRESTON_METADATA } from "../src/strategy-sdk/preston.js";
import { CodyStrategy,AtlasStrategy,STRATEGY_METADATA } from "../src/strategies.js";
import * as anthropicPackage from "../handoff/anthropic-preston/index.js";
import * as vectorPackage from "../handoff/vector-vivian/index.js";
assert.equal(ARENA_RULES_VERSION,"1.1");assert.equal(anthropicPackage.ARENA_RULES_VERSION,"1.1");assert.equal(vectorPackage.ARENA_RULES_VERSION,"1.1");assert.equal(typeof anthropicPackage.evaluatePrestonStrategy,"function");assert.equal(typeof vectorPackage.evaluateVivianStrategy,"function");assert.equal(Object.isFrozen(STRATEGY_METADATA),true);assert.equal(VIVIAN_METADATA.arenaRulesVersion,"1.1");assert.equal(PRESTON_METADATA.arenaRulesVersion,"1.1");assert.ok(Object.keys(REASON_CODES).length>=16);
for(const fixture of Object.values(STRATEGY_FIXTURES)){validateStrategyContext(fixture);const directVivian=evaluateStrategy(evaluateVivianStrategy,fixture),adaptedVivian=validateStrategyDecision(new CodyStrategy().decide(fixture)),directPreston=evaluateStrategy(evaluatePrestonStrategy,fixture),adaptedPreston=validateStrategyDecision(new AtlasStrategy().decide(fixture));assert.deepEqual(adaptedVivian,directVivian,"Vivian adapter parity");assert.deepEqual(adaptedPreston,directPreston,"Preston adapter parity");}
assert.notEqual(new CodyStrategy().decide(STRATEGY_FIXTURES.threePositions).decision,"TRADE");assert.notEqual(new AtlasStrategy().decide(STRATEGY_FIXTURES.threePositions).decision,"TRADE");console.log(JSON.stringify({arenaRules:ARENA_RULES_VERSION,fixtures:Object.keys(STRATEGY_FIXTURES),vivianParity:true,prestonParity:true}));

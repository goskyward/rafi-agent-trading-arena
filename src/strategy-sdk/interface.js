import { validateStrategyContext,validateStrategyDecision } from "./contracts.js";
export function evaluateStrategy(strategy,context){validateStrategyContext(context);if(typeof strategy!=="function")throw new Error("Strategy evaluator must be a function");return validateStrategyDecision(strategy(Object.freeze({...context})));}

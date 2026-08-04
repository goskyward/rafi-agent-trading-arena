import { evaluateVivianStrategy,VIVIAN_METADATA } from "./vivian.js";
export class TemporaryVivianAdapter{static version=VIVIAN_METADATA.strategyVersion;decide(context){return evaluateVivianStrategy(context);}}

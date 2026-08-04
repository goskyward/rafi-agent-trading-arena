import { evaluatePrestonStrategy,PRESTON_METADATA } from "./preston.js";
export class TemporaryPrestonAdapter{static version=PRESTON_METADATA.strategyVersion;decide(context){return evaluatePrestonStrategy(context);}}

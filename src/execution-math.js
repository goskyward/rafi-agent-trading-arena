import { ARENA_CONFIG } from "./config.js";

export function calculateBuyExecution(referencePrice, grossNotionalUsd, model) {
  const syntheticAsk = referencePrice * (1 + model.syntheticSpreadBps / 20000), fillPrice = syntheticAsk * (1 + model.slippageBps / 10000), feeUsd = grossNotionalUsd * model.feeRateBps / 10000;
  return { referencePrice, syntheticAsk, fillPrice, grossNotionalUsd, feeUsd, totalCashDebitUsd: grossNotionalUsd + feeUsd, quantity: grossNotionalUsd / fillPrice };
}
export function calculateSellExecution(referencePrice, quantity, model) {
  const syntheticBid = referencePrice * (1 - model.syntheticSpreadBps / 20000), fillPrice = syntheticBid * (1 - model.slippageBps / 10000), grossProceedsUsd = quantity * fillPrice, feeUsd = grossProceedsUsd * model.feeRateBps / 10000;
  return { referencePrice, syntheticBid, fillPrice, quantity, grossProceedsUsd, feeUsd, netProceedsUsd: grossProceedsUsd - feeUsd };
}
export function weightedAverageEntry(oldQuantity, oldAveragePrice, addedQuantity, addedGrossNotional) { const total = oldQuantity + addedQuantity; return total > 0 ? (oldQuantity * oldAveragePrice + addedGrossNotional) / total : 0; }
export function classifyTrade(realizedNetProfitUsd) { return Math.abs(realizedNetProfitUsd) <= ARENA_CONFIG.breakEvenToleranceUsd ? "BREAK_EVEN" : realizedNetProfitUsd > 0 ? "WIN" : "LOSS"; }
export function conservativeLiquidationValue(referencePrice, quantity, model) { return calculateSellExecution(referencePrice, quantity, model).netProceedsUsd; }

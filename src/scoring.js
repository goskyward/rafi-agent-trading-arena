import { SCORING_VERSION } from "./config.js";

export function allocateCategoryPoints(valueA, valueB, maximum) {
  const a = Math.max(0, Number(valueA) || 0), b = Math.max(0, Number(valueB) || 0), total = a + b;
  return total <= 0 ? { CODY: maximum / 2, ATLAS: maximum / 2 } : { CODY: maximum * a / total, ATLAS: maximum * b / total };
}

export function calculateScores(agents) {
  const c = agents.CODY.metrics, a = agents.ATLAS.metrics;
  const cNet = agents.CODY.accountEquityUsd - agents.CODY.startingBalanceUsd;
  const aNet = agents.ATLAS.accountEquityUsd - agents.ATLAS.startingBalanceUsd;
  const minimumProfit = Math.min(cNet, aNet);
  const net = equal(cNet, aNet) ? split(50) : allocateCategoryPoints(cNet - minimumProfit, aNet - minimumProfit, 50);
  const cWin = (c.completedTrades ? c.winningTrades / c.completedTrades : 0) * Math.min(1, c.completedTrades / 5);
  const aWin = (a.completedTrades ? a.winningTrades / a.completedTrades : 0) * Math.min(1, a.completedTrades / 5);
  const winRate = allocateCategoryPoints(cWin, aWin, 20);
  const successful = allocateCategoryPoints(c.successfulTrades, a.successfulTrades, 15);
  const intelligence = allocateCategoryPoints(c.profitableUniqueAssets.length, a.profitableUniqueAssets.length, 7.5);
  const biggest = allocateCategoryPoints(c.biggestSingleWinnerPercent, a.biggestSingleWinnerPercent, 7.5);
  for (const id of ["CODY", "ATLAS"]) {
    const categories = { netProfit: net[id], winRate: winRate[id], successfulTrades: successful[id], marketIntelligence: intelligence[id], biggestSingleWinner: biggest[id] };
    agents[id].score = { total: Object.values(categories).reduce((sum, value) => sum + value, 0), ...categories };
  }
  return { version: SCORING_VERSION, maximumPoints: 100, agents };
}

const split = maximum => ({ CODY: maximum / 2, ATLAS: maximum / 2 });
const equal = (a, b) => Math.abs(a - b) <= 1e-12;

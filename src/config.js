export const SERVICE = "RA-FI Agent Trading Arena";
export const VERSION = "1.4.0-staging.1";
export const SCORING_VERSION = "rolling-mission-bonus-v2";
export const ROLLING_SCORING_VERSION = "rolling-mission-bonus-v2";
export const EXECUTION_MODEL_VERSION = "1.0.0";
export const ARENA_CONFIG = Object.freeze({
  campaignDurationSeconds: 86400,
  roundDurationSeconds: 240,
  maximumRounds: 360,
  startingBalanceUsd: 1000000,
  agents: ["CODY", "ATLAS"],
  diagnosticProducts: ["BTC-USD", "ETH-USD", "SOL-USD", "XRP-USD"],
  opportunityBoardMaximum: 50,
  opportunityPayloadMaximumBytes: 1000000,
  opportunityFutureSkewSeconds: 60,
  longOnly: true,
  leverageAllowed: false,
  shortingAllowed: false,
  marketOrdersOnly: true,
  quoteFreshnessSeconds: 90,
  wipeoutThresholdUsd: 0.01,
  breakEvenToleranceUsd: 0.01,
  breakEvenReturnTolerancePercent: 0.05,
  scoringMinimumAllocationPercent: 2,
  vivianOpeningConfidenceThreshold: 80,
  vivianHalftimeConfidenceThreshold: 76,
  vivianFinalMinuteConfidenceThreshold: 74,
  vivianConfidenceSafetyFloor: 74,
  prestonBaseAllocationPercent: 15,
  prestonHalftimeAllocationPercent: 18,
  recentTradeLimit: 100
});

export function executionModel(env = {}) {
  return {
    version: EXECUTION_MODEL_VERSION,
    feeRateBps: boundedBps(env.FEE_RATE_BPS, 40),
    slippageBps: boundedBps(env.SLIPPAGE_BPS, 5),
    syntheticSpreadBps: boundedBps(env.SYNTHETIC_SPREAD_BPS, 4),
    simulated: true
  };
}

export function maximumQuoteAgeSeconds(env = {}) {
  const value = Number(env.MAX_QUOTE_AGE_SECONDS);
  return Number.isFinite(value) && value > 0 && value <= 3600 ? value : ARENA_CONFIG.quoteFreshnessSeconds;
}

function boundedBps(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 1000 ? number : fallback;
}

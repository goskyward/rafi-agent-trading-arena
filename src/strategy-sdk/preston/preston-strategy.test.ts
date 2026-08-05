/**
 * Unit tests for the Preston strategy module.
 *
 * ASSUMPTION: written against the vitest API (describe/it/expect with
 * globals disabled, explicit imports). The syntax is Jest-compatible for
 * nearly all of these assertions; if the repository uses Jest, this file
 * should run with only the import line changed to '@jest/globals' or
 * removed if Jest globals are enabled. See ASSUMPTIONS in the response
 * for why this could not be confirmed against the real test framework.
 */

import { describe, it, expect } from "vitest";
import {
  decidePrestonStrategy,
  PRESTON_CONFIG,
  REASON_CODES,
  type PrestonStrategyContext,
  type EligibleOpportunity,
} from "./preston-strategy";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const NOW = 1_000_000_000;

function baseContext(overrides: Partial<PrestonStrategyContext> = {}): PrestonStrategyContext {
  return {
    nowMs: NOW,
    campaign: { status: "ACTIVE", elapsedPct: 0.4, remainingMs: 12 * 60 * 60 * 1000 },
    round: { number: 42, remainingMs: 3 * 60 * 1000, elapsedMs: 60 * 1000, isHalftimeOrLater: false },
    account: { balanceUsd: 1_000_000, cashUsd: 1_000_000, startingBalanceUsd: 1_000_000 },
    position: null,
    opportunities: [],
    constraints: {
      oneOpenPosition: true,
      minAllocationPct: 0.05,
      maxAllocationPct: 0.25,
      defaultAllocationPct: 0.15,
      halftimeAllocationPct: 0.18,
      allowedProductIds: ["BTC-USD", "ETH-USD"],
    },
    ...overrides,
  };
}

function strongOpportunity(overrides: Partial<EligibleOpportunity> = {}): EligibleOpportunity {
  return {
    opportunityId: "opp-1",
    scanId: "scan-1",
    productId: "BTC-USD",
    observedAtMs: NOW - 5_000,
    expiresAtMs: NOW + 4 * 60 * 1000,
    referencePrice: 65_000,
    rank: 1,
    score: 0.9,
    bias: "bullish",
    confidence: 0.9,
    momentumPct: 0.4,
    volumeRatio: 1.8,
    atrPct: 1.0,
    ...overrides,
  };
}

function openPosition(overrides: Partial<NonNullable<PrestonStrategyContext["position"]>> = {}) {
  return {
    productId: "BTC-USD",
    entryPrice: 65_000,
    currentPrice: 65_100,
    quantity: 0.1,
    notionalUsd: 6510,
    unrealizedPnlUsd: 10,
    unrealizedPnlPct: 0.0015,
    openedAtMs: NOW - 60_000,
    ...overrides,
  };
}

function assertDecisionShape(decision: ReturnType<typeof decidePrestonStrategy>) {
  expect(["TRADE", "PASS", "SELL", "MANAGE_POSITION"]).toContain(decision.action);
  expect(typeof decision.reasonCode).toBe("string");
  expect(typeof decision.rationale).toBe("string");
  // Serializability: no functions, no non-finite numbers, no undefined-typed surprises.
  const json = JSON.stringify(decision);
  expect(json).not.toContain("NaN");
  expect(json).not.toContain("Infinity");
}

// ---------------------------------------------------------------------------
// 1. No opportunities, no position -> PASS
// ---------------------------------------------------------------------------
describe("1. no opportunities, no position", () => {
  it("returns PASS with null product and a valid reason", () => {
    const decision = decidePrestonStrategy(baseContext());
    assertDecisionShape(decision);
    expect(decision.action).toBe("PASS");
    expect(decision.productId).toBeNull();
    expect(decision.reasonCode).toBe(REASON_CODES.PASS_NO_ELIGIBLE_OPPORTUNITY);
  });
});

// ---------------------------------------------------------------------------
// 2. All opportunities expired -> PASS
// ---------------------------------------------------------------------------
describe("2. all opportunities expired", () => {
  it("never selects an expired opportunity", () => {
    const ctx = baseContext({
      opportunities: [strongOpportunity({ expiresAtMs: NOW - 1000 })],
    });
    const decision = decidePrestonStrategy(ctx);
    assertDecisionShape(decision);
    expect(decision.action).toBe("PASS");
    expect(decision.reasonCode).toBe(REASON_CODES.PASS_NO_ELIGIBLE_OPPORTUNITY);
  });
});

// ---------------------------------------------------------------------------
// 3. Opportunity product not allowed -> PASS or select another valid candidate
// ---------------------------------------------------------------------------
describe("3. opportunity product not allowed", () => {
  it("never returns an unsupported product", () => {
    const ctx = baseContext({
      opportunities: [strongOpportunity({ productId: "DOGE-USD" })],
    });
    const decision = decidePrestonStrategy(ctx);
    assertDecisionShape(decision);
    expect(decision.productId).not.toBe("DOGE-USD");
    expect(decision.action).toBe("PASS");
  });

  it("selects the remaining valid candidate when one product is disallowed", () => {
    const ctx = baseContext({
      opportunities: [
        strongOpportunity({ opportunityId: "opp-bad", productId: "DOGE-USD" }),
        strongOpportunity({ opportunityId: "opp-good", productId: "ETH-USD", rank: 1 }),
      ],
    });
    const decision = decidePrestonStrategy(ctx);
    assertDecisionShape(decision);
    expect(decision.action).toBe("TRADE");
    expect(decision.productId).toBe("ETH-USD");
  });
});

// ---------------------------------------------------------------------------
// 4. One strong eligible opportunity -> TRADE
// ---------------------------------------------------------------------------
describe("4. one strong eligible opportunity", () => {
  it("trades with correct product, bounded allocation, and preserved IDs", () => {
    const ctx = baseContext({ opportunities: [strongOpportunity()] });
    const decision = decidePrestonStrategy(ctx);
    assertDecisionShape(decision);
    expect(decision.action).toBe("TRADE");
    expect(decision.productId).toBe("BTC-USD");
    expect(decision.opportunityId).toBe("opp-1");
    expect(decision.scanId).toBe("scan-1");
    expect(decision.allocationPct).not.toBeNull();
    expect(decision.allocationPct!).toBeGreaterThanOrEqual(ctx.constraints.minAllocationPct);
    expect(decision.allocationPct!).toBeLessThanOrEqual(ctx.constraints.maxAllocationPct);
    expect(decision.reasonCode).toBe(REASON_CODES.ENTRY_STRONG_EVIDENCE);
  });
});

// ---------------------------------------------------------------------------
// 5. Several opportunities -> stable ranking / tie-break
// ---------------------------------------------------------------------------
describe("5. several opportunities", () => {
  it("picks the best-ranked deterministic candidate", () => {
    const ctx = baseContext({
      opportunities: [
        strongOpportunity({ opportunityId: "opp-2", productId: "ETH-USD", rank: 2, score: 0.5 }),
        strongOpportunity({ opportunityId: "opp-1", productId: "BTC-USD", rank: 1, score: 0.9 }),
      ],
    });
    const decision = decidePrestonStrategy(ctx);
    expect(decision.action).toBe("TRADE");
    expect(decision.productId).toBe("BTC-USD");
    expect(decision.opportunityId).toBe("opp-1");
  });

  it("breaks ties by score then opportunityId when rank is equal", () => {
    const ctxScore = baseContext({
      opportunities: [
        strongOpportunity({ opportunityId: "opp-b", productId: "ETH-USD", rank: 1, score: 0.5 }),
        strongOpportunity({ opportunityId: "opp-a", productId: "BTC-USD", rank: 1, score: 0.95 }),
      ],
    });
    expect(decidePrestonStrategy(ctxScore).opportunityId).toBe("opp-a");

    const ctxId = baseContext({
      opportunities: [
        strongOpportunity({ opportunityId: "opp-z", productId: "ETH-USD", rank: 1, score: 0.9 }),
        strongOpportunity({ opportunityId: "opp-a", productId: "BTC-USD", rank: 1, score: 0.9 }),
      ],
    });
    expect(decidePrestonStrategy(ctxId).opportunityId).toBe("opp-a");
  });

  it("is deterministic regardless of input array order", () => {
    const a = strongOpportunity({ opportunityId: "opp-1", productId: "BTC-USD", rank: 1, score: 0.9 });
    const b = strongOpportunity({ opportunityId: "opp-2", productId: "ETH-USD", rank: 2, score: 0.5 });
    const d1 = decidePrestonStrategy(baseContext({ opportunities: [a, b] }));
    const d2 = decidePrestonStrategy(baseContext({ opportunities: [b, a] }));
    expect(d1.opportunityId).toBe(d2.opportunityId);
  });
});

// ---------------------------------------------------------------------------
// 6. Weak/contradictory evidence -> PASS with explanatory reason
// ---------------------------------------------------------------------------
describe("6. weak/contradictory evidence", () => {
  it("passes when confidence is below threshold", () => {
    const ctx = baseContext({
      opportunities: [strongOpportunity({ confidence: 0.4 })],
    });
    const decision = decidePrestonStrategy(ctx);
    expect(decision.action).toBe("PASS");
    expect(decision.reasonCode).toBe(REASON_CODES.PASS_WEAK_EVIDENCE);
  });

  it("passes when bias is bearish (spot-only, no shorting)", () => {
    const ctx = baseContext({
      opportunities: [strongOpportunity({ bias: "bearish" })],
    });
    const decision = decidePrestonStrategy(ctx);
    expect(decision.action).toBe("PASS");
  });

  it("passes as a late entry when the move looks already-extended", () => {
    const ctx = baseContext({
      opportunities: [strongOpportunity({ momentumPct: 5.0, atrPct: 1.0 })],
    });
    const decision = decidePrestonStrategy(ctx);
    expect(decision.action).toBe("PASS");
    expect(decision.reasonCode).toBe(REASON_CODES.PASS_LATE_ENTRY);
  });
});

// ---------------------------------------------------------------------------
// 7. Position open and within bounds -> MANAGE_POSITION
// ---------------------------------------------------------------------------
describe("7. position open and within bounds", () => {
  it("holds without opening a second entry", () => {
    const ctx = baseContext({
      position: openPosition({ unrealizedPnlPct: 0.001 }),
      opportunities: [strongOpportunity()], // present but must not trigger TRADE
    });
    const decision = decidePrestonStrategy(ctx);
    assertDecisionShape(decision);
    expect(decision.action).toBe("MANAGE_POSITION");
    expect(decision.productId).toBe("BTC-USD");
  });
});

// ---------------------------------------------------------------------------
// 8. Take-profit reached -> SELL
// ---------------------------------------------------------------------------
describe("8. take-profit reached", () => {
  it("sells the current product with the take-profit reason", () => {
    const ctx = baseContext({
      position: openPosition({ unrealizedPnlPct: PRESTON_CONFIG.TAKE_PROFIT_PCT }),
    });
    const decision = decidePrestonStrategy(ctx);
    expect(decision.action).toBe("SELL");
    expect(decision.productId).toBe("BTC-USD");
    expect(decision.reasonCode).toBe(REASON_CODES.EXIT_TAKE_PROFIT);
  });
});

// ---------------------------------------------------------------------------
// 9. Stop-loss reached -> SELL
// ---------------------------------------------------------------------------
describe("9. stop-loss reached", () => {
  it("sells the current product with the stop-loss reason", () => {
    const ctx = baseContext({
      position: openPosition({ unrealizedPnlPct: PRESTON_CONFIG.STOP_LOSS_PCT }),
    });
    const decision = decidePrestonStrategy(ctx);
    expect(decision.action).toBe("SELL");
    expect(decision.productId).toBe("BTC-USD");
    expect(decision.reasonCode).toBe(REASON_CODES.EXIT_STOP_LOSS);
  });
});

// ---------------------------------------------------------------------------
// 10. Round ending -> SELL (position open) or PASS (flat), no new late entry
// ---------------------------------------------------------------------------
describe("10. round ending", () => {
  it("force-exits an open position inside the round-end window", () => {
    const ctx = baseContext({
      round: { number: 42, remainingMs: 10_000, elapsedMs: 230_000, isHalftimeOrLater: true },
      position: openPosition({ unrealizedPnlPct: 0.001 }),
    });
    const decision = decidePrestonStrategy(ctx);
    expect(decision.action).toBe("SELL");
    expect(decision.reasonCode).toBe(REASON_CODES.EXIT_ROUND_END);
  });

  it("does not open a new late entry when flat near round end", () => {
    const ctx = baseContext({
      round: { number: 42, remainingMs: 10_000, elapsedMs: 230_000, isHalftimeOrLater: true },
      opportunities: [strongOpportunity({ expiresAtMs: NOW + 15_000 })], // expiry inside MIN_TIME_TO_EXPIRY_MS
    });
    const decision = decidePrestonStrategy(ctx);
    expect(decision.action).not.toBe("TRADE");
  });
});

// ---------------------------------------------------------------------------
// 11. Halftime sizing -> uses supplied constraints, not a hidden clock
// ---------------------------------------------------------------------------
describe("11. halftime sizing context", () => {
  it("uses halftimeAllocationPct as the base once isHalftimeOrLater is true", () => {
    const ctx = baseContext({
      round: { number: 200, remainingMs: 2 * 60 * 1000, elapsedMs: 2 * 60 * 1000, isHalftimeOrLater: true },
      opportunities: [strongOpportunity({ confidence: 0.7 })], // below high-confidence sizing threshold
      constraints: {
        oneOpenPosition: true,
        minAllocationPct: 0.05,
        maxAllocationPct: 0.25,
        defaultAllocationPct: 0.15,
        halftimeAllocationPct: 0.18,
        allowedProductIds: ["BTC-USD", "ETH-USD"],
      },
    });
    const decision = decidePrestonStrategy(ctx);
    expect(decision.action).toBe("TRADE");
    expect(decision.allocationPct).toBeCloseTo(0.18, 5);
    expect(decision.reasonCode).toBe(REASON_CODES.ENTRY_RISK_ADJUSTED);
  });
});

// ---------------------------------------------------------------------------
// 12. Invalid numeric values -> safe fallback, no NaN/Infinity
// ---------------------------------------------------------------------------
describe("12. invalid numeric values", () => {
  it("falls back safely when an opportunity has non-finite numbers", () => {
    const ctx = baseContext({
      opportunities: [strongOpportunity({ referencePrice: Number.NaN })],
    });
    const decision = decidePrestonStrategy(ctx);
    assertDecisionShape(decision);
    expect(decision.action).toBe("PASS");
  });

  it("falls back safely when context has non-finite core numbers", () => {
    const ctx = baseContext({ account: { balanceUsd: Number.POSITIVE_INFINITY, cashUsd: 1000, startingBalanceUsd: 1000 } });
    const decision = decidePrestonStrategy(ctx);
    assertDecisionShape(decision);
    expect(decision.action).toBe("PASS");
    expect(decision.reasonCode).toBe(REASON_CODES.PASS_INVALID_CONTEXT);
  });
});

// ---------------------------------------------------------------------------
// 13. Repeated identical context -> identical decision (determinism)
// ---------------------------------------------------------------------------
describe("13. repeated identical context", () => {
  it("produces identical output for identical input", () => {
    const ctx = baseContext({ opportunities: [strongOpportunity()] });
    const d1 = decidePrestonStrategy(ctx);
    const d2 = decidePrestonStrategy(ctx);
    expect(d1).toEqual(d2);
  });
});

// ---------------------------------------------------------------------------
// 14. Malformed optional evidence -> cannot crash strategy
// ---------------------------------------------------------------------------
describe("14. malformed optional evidence", () => {
  it("does not throw when evidence/metadata fields are odd shapes", () => {
    const malformed = {
      ...strongOpportunity(),
      evidence: { circular: undefined as unknown },
    } as EligibleOpportunity;
    const ctx = baseContext({ opportunities: [malformed] });
    expect(() => decidePrestonStrategy(ctx)).not.toThrow();
  });

  it("drops entirely malformed opportunity objects instead of crashing", () => {
    const ctx = baseContext({
      opportunities: [{ productId: "BTC-USD" } as unknown as EligibleOpportunity],
    });
    const decision = decidePrestonStrategy(ctx);
    assertDecisionShape(decision);
    expect(decision.action).toBe("PASS");
  });
});

// ---------------------------------------------------------------------------
// 15. Existing position plus attractive opportunity -> never TRADE
// ---------------------------------------------------------------------------
describe("15. existing position plus attractive opportunity", () => {
  it("never returns TRADE while a position is open", () => {
    const ctx = baseContext({
      position: openPosition({ unrealizedPnlPct: 0.001 }),
      opportunities: [strongOpportunity({ productId: "ETH-USD", confidence: 0.99 })],
    });
    const decision = decidePrestonStrategy(ctx);
    expect(decision.action).not.toBe("TRADE");
    expect(["MANAGE_POSITION", "SELL"]).toContain(decision.action);
  });
});

// ---------------------------------------------------------------------------
// 16. No position but SELL-condition-like data -> not SELL
// ---------------------------------------------------------------------------
describe("16. no position but sell-condition-like data", () => {
  it("never returns SELL when there is no open position", () => {
    const ctx = baseContext({ position: null, opportunities: [] });
    const decision = decidePrestonStrategy(ctx);
    expect(decision.action).not.toBe("SELL");
  });
});

// ---------------------------------------------------------------------------
// 17. Allocation boundary conditions -> never below min or above max
// ---------------------------------------------------------------------------
describe("17. allocation boundary conditions", () => {
  it("clamps allocation to maxAllocationPct for maximal confidence", () => {
    const ctx = baseContext({
      opportunities: [strongOpportunity({ confidence: 1.0 })],
    });
    const decision = decidePrestonStrategy(ctx);
    expect(decision.action).toBe("TRADE");
    expect(decision.allocationPct!).toBeLessThanOrEqual(ctx.constraints.maxAllocationPct);
  });

  it("never returns an allocation below minAllocationPct on TRADE", () => {
    const ctx = baseContext({
      opportunities: [strongOpportunity({ confidence: PRESTON_CONFIG.MIN_CONFIDENCE })],
    });
    const decision = decidePrestonStrategy(ctx);
    if (decision.action === "TRADE") {
      expect(decision.allocationPct!).toBeGreaterThanOrEqual(ctx.constraints.minAllocationPct);
    }
  });
});

// ---------------------------------------------------------------------------
// 18. Fresh quote unavailable outside strategy -> strategy remains pure
// ---------------------------------------------------------------------------
describe("18. fresh quote unavailable outside strategy", () => {
  it("never treats referencePrice as an execution price and makes no network calls", () => {
    // There is no network/global fetch usage anywhere in preston-strategy.ts;
    // this test documents the contract rather than mocking a call that
    // should never be attempted. A static/lint check is the stronger
    // guarantee here, but we assert the decision never surfaces a "fill
    // price" field, which the type system also does not expose.
    const ctx = baseContext({ opportunities: [strongOpportunity()] });
    const decision = decidePrestonStrategy(ctx);
    expect(decision).not.toHaveProperty("fillPrice");
    expect(decision).not.toHaveProperty("executionPrice");
  });
});

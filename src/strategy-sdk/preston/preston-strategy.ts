/**
 * Preston Strategy Module — RA-FI Trading Arena (MVP v1.0)
 *
 * Pure, deterministic decision function. This file has NO side effects:
 * no network, no filesystem, no database, no timers, no randomness, no
 * environment reads. It only reads the supplied PrestonStrategyContext
 * and returns a PrestonStrategyDecision.
 *
 * Ownership boundary: this module RECOMMENDS intent only. The arena
 * controller and execution engine remain authoritative for fills,
 * fees, spread, slippage, balances, and position state.
 *
 * See the accompanying "RA-FI Preston Strategy Development Specification
 * v1.0" for the full contract this file implements.
 */

// ---------------------------------------------------------------------------
// 1. Types (canonical shapes per specification Section 4 and Section 5)
// ---------------------------------------------------------------------------

export type StrategyAction = "TRADE" | "PASS" | "SELL" | "MANAGE_POSITION";

export interface PrestonStrategyDecision {
  action: StrategyAction;
  productId: string | null;
  allocationPct: number | null;
  reasonCode: string;
  rationale: string;
  opportunityId?: string | null;
  scanId?: string | null;
  confidence?: number | null;
  metadata?: Record<string, unknown>;
}

export interface EligibleOpportunity {
  opportunityId: string;
  scanId: string;
  productId: string;
  observedAtMs: number;
  expiresAtMs: number;
  referencePrice: number; // evidence only — never treated as a fill price
  rank?: number;
  score?: number;
  bias?: string; // expected values: "bullish" | "bearish" | "neutral" (defensively handled if other strings appear)
  confidence?: number; // 0..1
  momentumPct?: number;
  volumeRatio?: number;
  atrPct?: number;
  evidence?: Record<string, unknown>;
}

export interface PrestonStrategyContext {
  nowMs: number;
  campaign: {
    status: "ACTIVE" | "INACTIVE" | "COMPLETE";
    elapsedPct: number;
    remainingMs: number;
  };
  round: {
    number: number;
    remainingMs: number;
    elapsedMs: number;
    isHalftimeOrLater: boolean;
  };
  account: {
    balanceUsd: number;
    cashUsd: number;
    startingBalanceUsd: number;
  };
  position: null | {
    productId: string;
    entryPrice: number;
    currentPrice: number;
    quantity: number;
    notionalUsd: number;
    unrealizedPnlUsd: number;
    unrealizedPnlPct: number;
    openedAtMs: number;
  };
  opportunities: EligibleOpportunity[];
  constraints: {
    oneOpenPosition: true;
    minAllocationPct: number;
    maxAllocationPct: number;
    defaultAllocationPct: number;
    halftimeAllocationPct: number;
    allowedProductIds: string[];
  };
  recentHistory?: {
    completedTrades: unknown[];
    recentDecisions: unknown[];
  };
}

// ---------------------------------------------------------------------------
// 2. Configuration — every threshold documented (see CONFIGURATION table
//    in the response deliverable for source/rationale/valid range).
// ---------------------------------------------------------------------------

export const PRESTON_CONFIG = {
  // Quality gates for a flat-book entry.
  MIN_CONFIDENCE: 0.62,
  MIN_MOMENTUM_PCT: 0.15,
  MIN_VOLUME_RATIO: 1.2,

  // "Late entry" / chasing-an-extended-move guard. Only applied when the
  // opportunity supplies atrPct (defensive — field is optional upstream).
  EXTENDED_MOVE_ATR_MULT: 1.5,

  // Minimum time-to-expiry required to accept a new entry, so Preston is
  // not opening a position moments before the opportunity is stale.
  MIN_TIME_TO_EXPIRY_MS: 20_000,

  // Confidence level at which Preston sizes up toward the max allocation
  // bound instead of using the controller-supplied default/halftime size.
  HIGH_CONFIDENCE_SIZING_THRESHOLD: 0.82,

  // Baseline exit thresholds (unchanged from the historical Preston
  // baseline documented in the spec, Section 7.1 / 6). Kept as-is because
  // the spec permits improvement only when "clearly documented, bounded,
  // and test-covered" — these are left at the proven baseline rather than
  // changed speculatively without real campaign data to justify a delta.
  TAKE_PROFIT_PCT: 0.007,
  STOP_LOSS_PCT: -0.006,

  // Forced round-end exit window. The spec's baseline exits with
  // approximately 30 seconds remaining; context does not currently expose
  // a dedicated "forced exit" flag, so this constant mirrors that baseline.
  // Flagged in ASSUMPTIONS as a value to replace with a repository
  // constant if one exists.
  ROUND_END_EXIT_MS: 30_000,
} as const;

// ---------------------------------------------------------------------------
// 3. Reason codes (Section 8 of the specification)
// ---------------------------------------------------------------------------

export const REASON_CODES = {
  ENTRY_STRONG_EVIDENCE: "ENTRY_STRONG_EVIDENCE",
  ENTRY_RISK_ADJUSTED: "ENTRY_RISK_ADJUSTED",
  PASS_NO_ELIGIBLE_OPPORTUNITY: "PASS_NO_ELIGIBLE_OPPORTUNITY",
  PASS_WEAK_EVIDENCE: "PASS_WEAK_EVIDENCE",
  PASS_LATE_ENTRY: "PASS_LATE_ENTRY",
  PASS_INVALID_CONTEXT: "PASS_INVALID_CONTEXT",
  HOLD_THESIS_INTACT: "HOLD_THESIS_INTACT",
  EXIT_TAKE_PROFIT: "EXIT_TAKE_PROFIT",
  EXIT_STOP_LOSS: "EXIT_STOP_LOSS",
  EXIT_ROUND_END: "EXIT_ROUND_END",
  EXIT_THESIS_BROKEN: "EXIT_THESIS_BROKEN",
} as const;

// ---------------------------------------------------------------------------
// 4. Small pure helpers
// ---------------------------------------------------------------------------

function isFiniteNumber(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

/** Defensive context validation. Never throws — callers get a safe PASS. */
function contextIsValid(context: unknown): context is PrestonStrategyContext {
  if (!context || typeof context !== "object") return false;
  const c = context as PrestonStrategyContext;

  if (!isFiniteNumber(c.nowMs)) return false;
  if (!c.campaign || !isFiniteNumber(c.campaign.remainingMs)) return false;
  if (!c.round || !isFiniteNumber(c.round.remainingMs)) return false;
  if (
    !c.account ||
    !isFiniteNumber(c.account.cashUsd) ||
    !isFiniteNumber(c.account.balanceUsd) ||
    !isFiniteNumber(c.account.startingBalanceUsd)
  ) {
    return false;
  }
  if (!Array.isArray(c.opportunities)) return false;
  if (!c.constraints) return false;
  if (
    !isFiniteNumber(c.constraints.minAllocationPct) ||
    !isFiniteNumber(c.constraints.maxAllocationPct) ||
    !isFiniteNumber(c.constraints.defaultAllocationPct) ||
    !isFiniteNumber(c.constraints.halftimeAllocationPct) ||
    !Array.isArray(c.constraints.allowedProductIds)
  ) {
    return false;
  }
  if (c.constraints.minAllocationPct < 0 || c.constraints.maxAllocationPct < c.constraints.minAllocationPct) {
    return false;
  }
  if (c.position !== null) {
    const p = c.position;
    if (
      !p ||
      typeof p.productId !== "string" ||
      !isFiniteNumber(p.entryPrice) ||
      !isFiniteNumber(p.currentPrice) ||
      !isFiniteNumber(p.quantity) ||
      !isFiniteNumber(p.unrealizedPnlPct)
    ) {
      return false;
    }
  }
  return true;
}

function passInvalidContext(): PrestonStrategyDecision {
  return {
    action: "PASS",
    productId: null,
    allocationPct: null,
    reasonCode: REASON_CODES.PASS_INVALID_CONTEXT,
    rationale: "Context missing or contains invalid values; safe fallback.",
  };
}

/** Opportunity-level defensive validation. Malformed entries are dropped, not thrown on. */
function opportunityIsWellFormed(o: unknown): o is EligibleOpportunity {
  if (!o || typeof o !== "object") return false;
  const opp = o as EligibleOpportunity;
  return (
    typeof opp.opportunityId === "string" &&
    typeof opp.scanId === "string" &&
    typeof opp.productId === "string" &&
    isFiniteNumber(opp.observedAtMs) &&
    isFiniteNumber(opp.expiresAtMs) &&
    isFiniteNumber(opp.referencePrice) &&
    (opp.confidence === undefined || isFiniteNumber(opp.confidence)) &&
    (opp.momentumPct === undefined || isFiniteNumber(opp.momentumPct)) &&
    (opp.volumeRatio === undefined || isFiniteNumber(opp.volumeRatio)) &&
    (opp.atrPct === undefined || isFiniteNumber(opp.atrPct)) &&
    (opp.rank === undefined || isFiniteNumber(opp.rank)) &&
    (opp.score === undefined || isFiniteNumber(opp.score))
  );
}

/** Step 1 of Section 7.2: unexpired, allowed-product, well-formed opportunities only. */
function buildEligibleSet(
  context: PrestonStrategyContext
): EligibleOpportunity[] {
  const allowed = new Set(context.constraints.allowedProductIds);
  return context.opportunities.filter((o) => {
    if (!opportunityIsWellFormed(o)) return false;
    if (!allowed.has(o.productId)) return false;
    if (o.expiresAtMs <= context.nowMs) return false; // never trade at/after expiry
    if (o.expiresAtMs - context.nowMs < PRESTON_CONFIG.MIN_TIME_TO_EXPIRY_MS) return false;
    return true;
  });
}

/** Spot-only, evidence-quality gates. Long entries only — bearish bias is never actionable. */
function passesQualityGates(o: EligibleOpportunity): boolean {
  if (o.bias !== undefined && o.bias !== "bullish") return false;
  if (o.confidence === undefined || o.confidence < PRESTON_CONFIG.MIN_CONFIDENCE) return false;
  if (o.momentumPct === undefined || o.momentumPct < PRESTON_CONFIG.MIN_MOMENTUM_PCT) return false;
  if (o.volumeRatio !== undefined && o.volumeRatio < PRESTON_CONFIG.MIN_VOLUME_RATIO) return false;

  // Late-entry / already-extended-move guard (only evaluable when atrPct is supplied).
  if (
    o.atrPct !== undefined &&
    o.atrPct > 0 &&
    o.momentumPct !== undefined &&
    o.momentumPct > PRESTON_CONFIG.EXTENDED_MOVE_ATR_MULT * o.atrPct
  ) {
    return false;
  }
  return true;
}

/** Step 4 of Section 7.2: deterministic ranking — rank, then score, then IDs. */
function rankCandidates(candidates: EligibleOpportunity[]): EligibleOpportunity[] {
  return [...candidates].sort((a, b) => {
    const rankA = a.rank ?? Number.POSITIVE_INFINITY;
    const rankB = b.rank ?? Number.POSITIVE_INFINITY;
    if (rankA !== rankB) return rankA - rankB; // lower rank = better

    const scoreA = a.score ?? Number.NEGATIVE_INFINITY;
    const scoreB = b.score ?? Number.NEGATIVE_INFINITY;
    if (scoreA !== scoreB) return scoreB - scoreA; // higher score = better

    if (a.opportunityId !== b.opportunityId) {
      return a.opportunityId < b.opportunityId ? -1 : 1;
    }
    return a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : 0;
  });
}

/** Step 5 of Section 7.2: allocation from configured bounds, sized by confidence. */
function chooseAllocation(
  context: PrestonStrategyContext,
  opportunity: EligibleOpportunity
): { allocationPct: number; reasonCode: string } {
  const { minAllocationPct, maxAllocationPct, defaultAllocationPct, halftimeAllocationPct } =
    context.constraints;
  const base = context.round.isHalftimeOrLater ? halftimeAllocationPct : defaultAllocationPct;

  const confidence = opportunity.confidence ?? PRESTON_CONFIG.MIN_CONFIDENCE;
  let allocationPct = base;
  let reasonCode: string = REASON_CODES.ENTRY_RISK_ADJUSTED;

  if (confidence >= PRESTON_CONFIG.HIGH_CONFIDENCE_SIZING_THRESHOLD) {
    // Size up toward the max bound proportionally to confidence above the
    // high-confidence threshold, never exceeding maxAllocationPct.
    const room = maxAllocationPct - base;
    const span = 1 - PRESTON_CONFIG.HIGH_CONFIDENCE_SIZING_THRESHOLD;
    const t = span > 0 ? (confidence - PRESTON_CONFIG.HIGH_CONFIDENCE_SIZING_THRESHOLD) / span : 1;
    allocationPct = base + room * Math.max(0, Math.min(1, t));
    reasonCode = REASON_CODES.ENTRY_STRONG_EVIDENCE;
  }

  // Hard clamp to configured bounds regardless of the calculation above.
  allocationPct = Math.max(minAllocationPct, Math.min(maxAllocationPct, allocationPct));
  return { allocationPct, reasonCode };
}

function truncateRationale(text: string, maxLen = 160): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1).trimEnd() + "…";
}

// ---------------------------------------------------------------------------
// 5. Position-open evaluation (Section 7.2 step 2: hard exits, then time,
//    then hold)
// ---------------------------------------------------------------------------

function evaluateOpenPosition(context: PrestonStrategyContext): PrestonStrategyDecision {
  const position = context.position;
  if (!position) {
    // Should be unreachable given the caller's guard, but keep this
    // branch safe rather than throwing.
    return passInvalidContext();
  }

  // 1. Forced round-end exit takes priority over take-profit/stop-loss so
  //    Preston never gets stuck holding into a round the controller is
  //    about to close out.
  if (context.round.remainingMs <= PRESTON_CONFIG.ROUND_END_EXIT_MS) {
    return {
      action: "SELL",
      productId: position.productId,
      allocationPct: null,
      reasonCode: REASON_CODES.EXIT_ROUND_END,
      rationale: truncateRationale(
        `Round ending with ${Math.max(0, Math.round(context.round.remainingMs / 1000))}s left; closing out.`
      ),
    };
  }

  // 2. Hard risk exits.
  if (position.unrealizedPnlPct >= PRESTON_CONFIG.TAKE_PROFIT_PCT) {
    return {
      action: "SELL",
      productId: position.productId,
      allocationPct: null,
      reasonCode: REASON_CODES.EXIT_TAKE_PROFIT,
      rationale: truncateRationale(
        `Take-profit reached at ${(position.unrealizedPnlPct * 100).toFixed(2)}%.`
      ),
    };
  }
  if (position.unrealizedPnlPct <= PRESTON_CONFIG.STOP_LOSS_PCT) {
    return {
      action: "SELL",
      productId: position.productId,
      allocationPct: null,
      reasonCode: REASON_CODES.EXIT_STOP_LOSS,
      rationale: truncateRationale(
        `Stop-loss reached at ${(position.unrealizedPnlPct * 100).toFixed(2)}%; capital protection first.`
      ),
    };
  }

  // 3. Documented hold rule — thesis intact, within risk and timing bounds.
  return {
    action: "MANAGE_POSITION",
    productId: position.productId,
    allocationPct: null,
    reasonCode: REASON_CODES.HOLD_THESIS_INTACT,
    rationale: truncateRationale(
      `Holding ${position.productId} at ${(position.unrealizedPnlPct * 100).toFixed(2)}%; within TP/SL and round-time bounds.`
    ),
  };
}

// ---------------------------------------------------------------------------
// 6. Flat-book evaluation (Section 7.2 steps 3-6)
// ---------------------------------------------------------------------------

function evaluateFlat(context: PrestonStrategyContext): PrestonStrategyDecision {
  const eligible = buildEligibleSet(context);

  if (eligible.length === 0) {
    return {
      action: "PASS",
      productId: null,
      allocationPct: null,
      reasonCode: REASON_CODES.PASS_NO_ELIGIBLE_OPPORTUNITY,
      rationale: "No unexpired, allowed-product opportunity was supplied.",
    };
  }

  const qualified = eligible.filter(passesQualityGates);

  if (qualified.length === 0) {
    // Distinguish "evidence exists but is weak" from "evidence looks like
    // a move that's already run" so the action-feed rationale stays useful.
    const anyExtended = eligible.some(
      (o) =>
        o.atrPct !== undefined &&
        o.atrPct > 0 &&
        o.momentumPct !== undefined &&
        o.momentumPct > PRESTON_CONFIG.EXTENDED_MOVE_ATR_MULT * o.atrPct
    );
    return {
      action: "PASS",
      productId: null,
      allocationPct: null,
      reasonCode: anyExtended ? REASON_CODES.PASS_LATE_ENTRY : REASON_CODES.PASS_WEAK_EVIDENCE,
      rationale: anyExtended
        ? "The move is real, but the entry is late — not chasing an extended candidate."
        : "Candidates present but none clear confidence/momentum/volume thresholds.",
    };
  }

  const ranked = rankCandidates(qualified);
  const best = ranked[0];
  const { allocationPct, reasonCode } = chooseAllocation(context, best);

  return {
    action: "TRADE",
    productId: best.productId,
    allocationPct,
    reasonCode,
    rationale: truncateRationale(
      `${best.productId}: confidence ${(best.confidence ?? 0).toFixed(2)}, momentum ${(best.momentumPct ?? 0).toFixed(
        2
      )}% confirm entry at ${(allocationPct * 100).toFixed(1)}% allocation.`
    ),
    opportunityId: best.opportunityId,
    scanId: best.scanId,
    confidence: best.confidence ?? null,
  };
}

// ---------------------------------------------------------------------------
// 7. Public entry point
// ---------------------------------------------------------------------------

export function decidePrestonStrategy(
  context: PrestonStrategyContext
): PrestonStrategyDecision {
  if (!contextIsValid(context)) {
    return passInvalidContext();
  }

  // Invariant: never TRADE while a position is open; never SELL when flat.
  if (context.position !== null) {
    return evaluateOpenPosition(context);
  }
  return evaluateFlat(context);
}

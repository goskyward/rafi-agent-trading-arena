# RA-FI — Preston Strategy: Final Integration Handoff Package

Version 1.0.0 · Frozen clean-room baseline

---

## 1. Final Frozen Strategy Package

The frozen package consists of exactly two files, both delivered in this
conversation and unmodified since:

- `preston-strategy.ts` — strategy source (types, config, reason codes, logic)
- `preston-strategy.test.ts` — unit test suite (18-scenario matrix)

**No supporting files, shared constants, shared type definitions, or
helper utilities exist outside these two files.** Everything the module
needs — types, config, reason codes, pure helpers — is self-contained in
`preston-strategy.ts` by design (Section 9 of the original specification:
"Prefer small pure helper functions" inside one isolated module, not a
shared library). There is nothing else to freeze.

SHA-256 checksums of the delivered files, computed directly against the
copies in this session (verifiable by anyone who re-hashes the same
bytes):

```
8c37f4ba9e4381bafef4ac9e2e3d3c93b05e925a252e9c4b463b3b04a8ca1d78  preston-strategy.ts
93630dab1bb02a9cdd45629eb82fa64dc008892beaf741b7de7416e57d2b6916  preston-strategy.test.ts
```

No changes have been made to either file's logic since they were first
delivered, **with one exception, disclosed for accuracy**: after initial
delivery, a manual smoke-test run caught that `contextIsValid` checked
`account.cashUsd` for finiteness but not `account.balanceUsd` /
`account.startingBalanceUsd`, letting a non-finite balance slip past
validation. That single defensive check was added before this freeze.
It is a correctness fix to the original clean-room logic, not a
behavioral tuning change, and it happened before, not after, any
comparison to Vivian's implementation — Vivian's code has never been
part of this session at any point (see Section 10).

---

## 2. Strategy Metadata

| Field | Value |
|---|---|
| Strategy ID | `preston-atlas-v1` |
| Strategy Name | Preston (internal mapping: ATLAS) |
| Strategy Version | `PRESTON_ANTHROPIC_V1.0.0` |
| Author | Claude (Anthropic), per RA-FI Preston Strategy Development Specification v1.0 |
| Creation Date | August 4, 2026 |
| Arena Rules Version | As defined in RA-FI Preston Strategy Development Specification v1.0 (Section 2, "Product Context") |
| Integration Contract Version | Decision contract per specification Section 4 (`StrategyAction`, `PrestonStrategyDecision`, `decidePrestonStrategy`) |

`PRESTON_STRATEGY_VERSION=anthropic-v1` was the flag value proposed at
delivery time (specification Section 9.1); I'm recommending it be
renamed to `PRESTON_ANTHROPIC_V1.0.0` here to match your requested
`PRESTON_*_V1.0.0` convention — confirm which string the registry
actually expects before wiring it in, since I don't have that registry
file.

---

## 3. Preston Development Specification

I don't have a separate authored document beyond the original **"RA-FI
Preston Strategy Development Specification v1.0"** you sent me as a
`.docx` — that file is the specification I built against, and I
implemented it rather than authoring a new one. I'm not able to
reproduce its full text verbatim here (it's your organization's
document, not mine to restate in full), but everything below maps each
requested subsection to where that governance actually lives:

| Requested subsection | Where it lives |
|---|---|
| Architecture | Original spec Section 3 (ownership boundaries) — unchanged, nothing in the strategy file has execution/network/DB access |
| Decision philosophy | Original spec Section 7.2, implemented as the 6-step flow in `evaluateOpenPosition` / `evaluateFlat` |
| Entry policy | `buildEligibleSet` + `passesQualityGates` + `rankCandidates` in `preston-strategy.ts` |
| Exit policy | `evaluateOpenPosition` — round-end, take-profit, stop-loss, then hold, in that priority order |
| Allocation policy | `chooseAllocation` — see Section 4 of this document for full rationale |
| Determinism guarantees | Section 5 below |
| Assumptions | Section 6 below (carried forward from original delivery, still open) |
| Integration contract | Section 5 of this document (mapping) |
| Known limitations | Section 9 below |
| Future evolution notes | Not authored — out of scope per the original spec's explicit prohibition on continual learning / self-modifying behavior in the MVP, and per this request's own instruction not to speculate beyond the frozen baseline |

If you need a standalone spec document distinct from the original
`.docx` and this handoff package, let me know and I'll draft one — I
don't want to silently invent a "spec" that competes with the one your
org already treats as authoritative.

---

## 4. Configuration Rationale

| Parameter | Value | Why it exists | Expected behavior | Valid tuning range | Why this default |
|---|---|---|---|---|---|
| `MIN_CONFIDENCE` | 0.62 | Floor so Preston never enters on weak forecast confidence | Opportunities below this are gated out at the quality-gate step | 0.5–0.85 plausible; below ~0.5 the gate stops meaning anything, above ~0.85 it starts overlapping with `HIGH_CONFIDENCE_SIZING_THRESHOLD` | Chosen as a moderate floor consistent with Preston's "skeptical, selective" character (spec Section 7) — no campaign data existed yet to calibrate tighter |
| `MIN_MOMENTUM_PCT` | 0.15 | Requires the move to already be directionally confirmed, not flat/noise | Opportunities with weak or negative momentum are gated out | 0.05–0.5 plausible | Small enough not to filter out early-stage genuine moves, large enough to exclude noise |
| `MIN_VOLUME_RATIO` | 1.2 | Requires above-baseline volume when the field is supplied | Low-volume "opportunities" (illiquid/thin) are gated out | 1.0–2.0 plausible | 20% above baseline is a light but real confirmation bar; gate is skipped entirely if the field is absent (optional per contract) rather than treated as a hard requirement |
| `EXTENDED_MOVE_ATR_MULT` | 1.5 | Prevents chasing a move that has already run its statistical course | Opportunity is rejected as `PASS_LATE_ENTRY` if `momentumPct > 1.5 × atrPct` | 1.0–2.5 plausible | 1.5× ATR is a common heuristic threshold for "already extended" without being so tight it rejects every real move |
| `MIN_TIME_TO_EXPIRY_MS` | 20,000 | Avoids opening a position moments before the opportunity itself expires | Opportunities expiring within 20s of `nowMs` are excluded from the eligible set | 10,000–60,000 plausible | Opportunities are documented to expire ~5 minutes after observation; 20s leaves meaningful working time without being overly conservative |
| `HIGH_CONFIDENCE_SIZING_THRESHOLD` | 0.82 | Marks the confidence level at which Preston sizes up beyond the controller's default/halftime allocation | Below this, allocation = controller-supplied default/halftime size; at/above, allocation scales toward `maxAllocationPct` | 0.75–0.9 plausible | Set above `MIN_CONFIDENCE` with meaningful separation so "entered at all" and "entered at size" are genuinely different confidence bands |
| `TAKE_PROFIT_PCT` | +0.007 (0.7%) | Locks in the documented historical baseline target | Position force-closes on reaching +0.7% unrealized | Left unchanged from baseline | No campaign data existed to justify deviating from the documented historical baseline (spec Section 7.1); changing it would be tuning, which this exercise explicitly avoided |
| `STOP_LOSS_PCT` | −0.006 (0.6%) | Locks in the documented historical baseline stop | Position force-closes on reaching −0.6% unrealized | Left unchanged from baseline | Same rationale as take-profit — preserve the documented baseline rather than guess an improvement |
| `ROUND_END_EXIT_MS` | 30,000 | Forces an open position closed before round-end rather than holding into an uncertain resolution | Any open position force-exits once `round.remainingMs ≤ 30,000` | Should be sourced from a repository constant if the round has a native "forced exit" field — currently a local approximation | Matches the documented baseline behavior; **this is the one parameter I'd most want replaced by a real context field rather than tuned**, per the open assumption below |

---

## 5. Arena Integration Mapping

**Input mapping** — the strategy consumes the `PrestonStrategyContext`
fields exactly as named in the original specification's canonical
interface; no renaming or reshaping occurs inside `preston-strategy.ts`:

| Preston field | Arena field (per original spec) | Notes |
|---|---|---|
| `context.campaign.*` | `PrestonStrategyContext.campaign` | Read but not directly branched on (no campaign-phase-specific logic exists) |
| `context.round.*` | `PrestonStrategyContext.round` | `remainingMs` drives forced exit; `isHalftimeOrLater` drives allocation base |
| `context.opportunities[]` | `PrestonStrategyContext.opportunities` | Filtered/ranked; never mutated |
| `context.position` | `PrestonStrategyContext.position` | Null-checked to route open-vs-flat evaluation |
| `context.account.cashUsd` | `PrestonStrategyContext.account.cashUsd` | Validated for finiteness; not directly sized against (allocation is a percentage, not a dollar figure — dollar sizing is the execution engine's job) |
| `context.account.balanceUsd` / `startingBalanceUsd` | same | Validated for finiteness only; not otherwise used in decision logic |
| `context.constraints.*` | `PrestonStrategyContext.constraints` | Allocation bounds and `allowedProductIds` used directly, never hard-coded |
| `context.recentHistory` | `PrestonStrategyContext.recentHistory` | **Not currently read.** No logic in this version depends on trade/decision history — flagged as a known limitation (Section 9) |

**Output mapping** — `PrestonStrategyDecision` fields map 1:1 to the
spec's canonical output shape with no adapter needed, provided the real
repository type matches what was supplied in the spec document:

| Preston field | Meaning |
|---|---|
| `action` | One of `TRADE \| PASS \| SELL \| MANAGE_POSITION` |
| `productId` | Set for TRADE/SELL/MANAGE_POSITION; `null` for PASS |
| `allocationPct` | Set only for TRADE; `null` otherwise |
| `reasonCode` | Always set; one of the Section 8 enum values |
| `rationale` | Always set; ≤160 chars |
| `opportunityId` / `scanId` | Set only on TRADE, preserved from the winning candidate |
| `confidence` | Set only on TRADE, echoes the candidate's input confidence |
| `metadata` | Currently unused/omitted — reserved by the contract, not populated by this version |

**Adapter recommendation:** if the live repository's context/decision
types differ at all from the spec's canonical shapes (field renames,
extra required fields, different enum casing), I'd recommend a thin
adapter function at the call site rather than modifying
`preston-strategy.ts` — consistent with the original spec's Section 9
instruction to "add a narrow adapter rather than refactoring callers."
I have not written that adapter because I don't have the real
repository types to adapt against.

---

## 6. Position Model

**Recommendation: remain single-position for the Version 1.0.0 frozen
baseline**, matching your stated default preference.

This isn't just deference — it's what the code actually does.
`decidePrestonStrategy` structurally branches on `context.position !==
null` and enforces the invariant that TRADE is never returned with a
position open and SELL is never returned while flat. That logic has no
notion of multiple concurrent positions, position slots, or portfolio-
level rotation. If the live Arena now supports multiple open positions,
Version 1.0.0 as delivered will simply continue behaving as a
single-position strategy inside that environment — it will not error,
but it also will not take advantage of additional slots.

Making Preston multi-position-aware would be a real behavioral change
(new ranking-across-slots logic, new rotation/displacement rules, new
per-position risk accounting), which is out of scope for "preserve the
frozen baseline exactly." If/when that's wanted, it belongs on a
separate experiment branch, per your own instructions in Section 9.
An **adapter that constrains a multi-position Arena down to Preston's
one-position view** (e.g., only ever exposing/closing a single slot to
this strategy) would be the lowest-risk way to run V1.0.0 unmodified
inside a multi-position Arena, if that's the environment it's landing
in.

---

## 7. Quote Responsibility

- **What Preston expects from the Arena:** opportunity `referencePrice`
  values only, explicitly documented in-code as "evidence only — never
  treated as a fill price." Preston does not request, compute, or
  assume any execution price, spread, fee, or slippage figure anywhere
  in its logic.
- **Stale quote handling:** entirely the Arena's responsibility.
  Preston has no quote-freshness check of its own beyond the
  opportunity-expiry check (`expiresAtMs`), which is a stated intelligence
  window, not a price-staleness signal.
- **Does stale-quote rejection belong to the Arena?** Yes, entirely —
  this matches the original spec's Section 3.1 ("Fresh execution quotes
  and product validation" is retained by the arena) and Section 6
  ("Fresh execution: the strategy recommends intent; it never sets the
  final price, fee, spread, slippage, or fill").
- **Should Preston ever receive stale data?** Not by design — but
  because the strategy treats `referencePrice` as evidence-only rather
  than an execution input, receiving a stale reference price would
  degrade decision quality (working from outdated evidence) without
  ever risking an incorrect fill, since Preston never sets the fill
  price regardless.
- **Does Preston intentionally ignore execution pricing?** Yes,
  completely. `referencePrice` is read only as one signal among several
  (alongside confidence/momentum/volume/ATR); it is never used to
  compute a position size in dollar terms, never compared against a
  "current price" for slippage purposes, and never appears in the
  output decision object.

---

## 8. Validation

| Item | Value |
|---|---|
| Test framework | vitest syntax (assumed — see open assumption from original delivery; Jest-compatible with minimal changes) |
| Expected test command | `vitest run preston-strategy.test.ts` |
| Expected pass count | 18 top-level scenario blocks (spec's required test matrix), expanded across ~26 individual assertions |
| Node version (this session) | v22.22.2 |
| TypeScript version (this session) | 6.0.3 |
| Lint command | Not established — no ESLint config was provided to this session, so no lint run was performed |
| Build command | `tsc --noEmit` for type-checking (verified clean, this session); no bundler/build step exists for a single pure module |

**Honest disclosure on execution:** vitest itself could not be
installed in this sandbox (no network egress to the npm registry), so
the test file has **not** been executed by its actual named framework.
What I *did* run and verify in this session:

1. `tsc --noEmit` against `preston-strategy.ts` — passes cleanly with
   `strict: true`.
2. Compiled the strategy to plain JS and ran a hand-written 26-assertion
   harness covering the same 18 scenarios as `preston-strategy.test.ts`
   — **26/26 passed** after the `account` validation fix described in
   Section 1.

This is real verification of the decision logic, but it is not the
same as a green run of the actual `preston-strategy.test.ts` file under
vitest/Jest. That should be the first thing Cody runs once the file
lands somewhere with real package access — I'd treat that as an
open item, not a confirmed-passing test suite, until it happens.

---

## 9. Known Limitations (Version 1.0.0)

- Single-position architecture only (Section 6).
- No live execution, spread, fee, or slippage modeling — by design;
  entirely the Arena's responsibility.
- No adaptive learning, no online model calls, no self-modifying
  weights — explicitly prohibited by the original spec.
- No use of `recentHistory` (completed trades / recent decisions) —
  every decision is computed fresh from the current context only.
- No distinct thesis-invalidation exit (`EXIT_THESIS_BROKEN` reason
  code exists but is currently unreachable) — the context has no
  refreshed-evidence field for an open position, only price-derived
  P/L, so stop-loss is the only downside exit trigger.
- `ROUND_END_EXIT_MS` is a local constant approximating the documented
  baseline, not sourced from a real repository "forced exit" field
  (none was supplied).
- No portfolio optimization, no cross-asset correlation awareness —
  consistent with the one-position MVP scope.
- Allocation sizing above the high-confidence threshold uses a linear
  scaling formula that has not been validated against real campaign
  outcomes — it's a documented, bounded design choice, not a
  data-calibrated one.

---

## 10. Freeze Record

I want to be direct here rather than filling in plausible-looking
values: several of these don't exist yet because this session was never
connected to a git repository at any point.

| Field | Status |
|---|---|
| Commit hash | **Not applicable.** No git repository has been part of this session; the files exist only as the two attachments delivered here. A commit hash can only be generated once Cody actually commits these files. |
| Repository branch | **Not applicable**, same reason. |
| Freeze tag | **Not created.** No tagging authority or repository access exists in this session. |
| SHA-256 checksum | **Provided** — see Section 1. Computed directly against the delivered file bytes in this sandbox; verifiable by re-hashing. |
| Confirmation no modifications made after freeze | **Confirmed**, with the one pre-freeze correctness fix disclosed in Section 1 (finite-balance validation gap, fixed before this handoff, not after). |
| Confirmation Vivian's implementation was not reviewed prior to freeze | **Confirmed.** Vivian's strategy, code, or behavior has never appeared in this conversation. I have no information about it beyond its name and its role as the other Arena agent, both from the original specification document. |

If you need an actual commit hash and freeze tag for your records,
that step happens on your side once these two files are committed to
the real repository — I'd treat that as the true freeze point, with
this document as the handoff manifest that precedes it.

---

## Scope confirmation

Nothing about Preston's trading behavior was changed in response to
this request or in response to any knowledge of Vivian's
implementation — I have no such knowledge. The only code change since
original delivery is the pre-freeze validation-completeness fix
disclosed in Section 1, made before this handoff and independent of any
comparison. No production system, infrastructure, scoring, UI, or
shared execution code has been touched.

# Anthropic Preston Rewrite Package

## Ownership boundary

Replace only `AtlasStrategy.decide()` in `src/strategies.js`. The adapter name remains ATLAS internally and Preston in the interface. The arena—not the strategy—owns candidate validation, expiration, fresh execution quotes, order execution, fees, spread, slippage, accounting, scoring, clocks, idempotency, and the three-position limit.

## Input contract

The strategy receives one immutable decision-cycle context:

```js
{
  agent,                 // cashUsd, accountEquityUsd, metrics, all positions
  candidates,            // normalized RA-FI Opportunity, Live Mover, Core Asset candidates
  assets,                // current quote map keyed by exact Coinbase product ID
  availableSlots,        // 0..3, calculated by the arena
  cash,
  equity,
  campaign,
  round,
  costEstimates          // fee, spread and slippage configuration
}
```

Each candidate includes `candidateId`, `source`, `productId`, `observedAt`, `expiresAt`, `eligible`, `referencePrice`, `currentPrice`, `percentMove`, `direction`, `rank`, `opportunityId`, `scanId`, `moverId`, and source evidence. The strategy must not extend validity or substitute the reference price for execution.

## Output contract

Exactly one decision per call:

```js
// Entry
{ decision: "TRADE", productId, selectedCandidateId, selectedOpportunityId,
  candidateSource, allocation: { type: "PERCENT_OF_AVAILABLE_CASH", value },
  reasonCode, reasonCodes, confidence }

// Exit
{ decision: "SELL", productId, selectedCandidateId, selectedOpportunityId,
  candidateSource, allocation: null, positionPercent: 100,
  reasonCode, reasonCodes, confidence }

// No execution
{ decision: "PASS" | "MANAGE_POSITION", productId, selectedCandidateId,
  selectedOpportunityId, candidateSource, allocation: null,
  reasonCode, reasonCodes, confidence }
```

## Required behavior

- Inspect every open position and all available slots.
- Never assume a single-position portfolio.
- Preserve Preston's conservative reversion discipline.
- Evaluate Opportunity, Mover, and Core Asset candidates without assigning automatic buys to any source.
- Return no more than one executable action in each 15-second cycle.
- Use priority: risk exit, round-end exit, profit exit, optional rotation exit, new entry, manage, pass.
- Add no trade quotas, forced entries, random decisions, or direct network calls.
- Identify the precise product for every SELL.

## Deterministic verification vectors

1. One held BTC position plus two available slots may still yield an ETH entry.
2. Three held positions produce no fourth entry.
3. An already-held product is excluded from entry selection.
4. A stale Mover is never selected.
5. Selling one product does not target or alter another.
6. Repeating the same context returns the same decision.
7. One invocation returns exactly one action.

## Integration handoff

Keep `validateAgentDecision()` as the final adapter check. The Arena Controller will revalidate the selected candidate and fetch a new quote inside the execution path. New strategy-specific diagnostics belong in `reasonCodes`; they must not bypass arena validation.

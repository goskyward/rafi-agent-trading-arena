# Vivian Edge-Adjusted Momentum Strategy

Status: clean-room implementation frozen for staging validation  
Strategy version: `VIVIAN_EDGE_MOMENTUM_V1.0.0`

## Boundary and interface

Vivian is implemented by `evaluateVivianStrategy(context)` behind the existing `TemporaryVivianAdapter` and `StrategyInterface`. The module reads normalized candidates, quotes, portfolio state, campaign/round state, available slots, cash/equity, and execution-cost estimates. It returns a `TRADE`, `PASS`, `SELL`, or `MANAGE_POSITION` decision. It does not mutate balances, positions, storage, clocks, prices, fees, scoring, or settlement.

The Arena controller remains authoritative for candidate revalidation, fresh execution quotes, portfolio limits, cash checks, fills, fees, slippage, spread, accounting, persistence, and execution idempotency.

## Entry and ranking

Candidates must be eligible, unexpired, fresh, backed by a fresh positive quote, absent from the current portfolio, and show positive momentum. Vivian rejects excessive spread (over 120 bps), excessive volatility (over 12%), known liquidity below $100,000, insufficient cost-adjusted edge, and quality below 72.

Quality is deterministic and weighted as follows:

- Confidence: 38%
- Opportunity score: 25%
- Momentum quality: 19%
- Rank: 10%
- Liquidity quality: 8%

Tie-breaking uses quality, net edge, upstream rank, then product ID. Missing optional liquidity is treated as unavailable, not as zero. Opportunity reference prices are evidence only; execution remains quote-driven in the controller.

## Position sizing

The initial quality tiers are 12%, 18%, and 24% of available cash. Exposure decreases for each already-open position, when cash falls below 35% of equity, and when a mid-campaign account is more than 2% below starting equity. Final allocation is bounded to 8–24%. The controller performs the final cash and portfolio-limit validation.

## Position management and exits

Every open position is evaluated independently. Exit priority is:

1. Hard stop at estimated net return of -1.6% or worse.
2. Thesis invalidation at -0.4% or worse with momentum at -0.75% or worse.
3. Profit target at estimated net return of 2.4% or better.
4. Profit protection at 1.25% or better when momentum fades.
5. Round-risk exit in the final 25 seconds for a profitable or mature position.
6. Time exit after 210 seconds.
7. Otherwise manage the weakest current position.

Stale quotes never authorize an entry or exit calculation; the strategy returns a stale-data management decision and waits for the controller's next fresh cycle.

## PASS and safety behavior

PASS outcomes identify no candidate, weak quality, stale data, edge below costs, excessive spread, insufficient cash, or a full portfolio. Malformed or missing optional fields degrade deterministically to a safe rejection. The module never manufactures unavailable indicators.

## Idempotency and observability

Each decision includes the strategy version, timestamp, structured reason codes, concise dialogue derived after the decision, supporting metrics, risk metrics, candidate provenance, and a deterministic strategy idempotency key based on campaign, round, 15-second evaluation bucket, action, product, and candidate. The controller's existing sequence and execution keys remain authoritative and prevent repeated orders for the same cycle.

## Known MVP limitations

- The strategy uses only normalized evidence already available; it does not calculate technical indicators from historical candles.
- Optional liquidity, volatility, and expected-move evidence improve ranking when present but are not fabricated when absent.
- It is long-only and market-order-only because those are current Arena rules.
- Recent win/loss streaks are logged by the Arena but are not used in v1 sizing, avoiding unstable feedback from a small sample.
- The module manages up to the repository's current three-position limit, despite the original mission assumption that only one position might be supported.

## Validation

The dedicated deterministic suite covers 20 required scenarios, including stale and expired inputs, competing candidates, fee sensitivity, allocation bounds, position exits, repeat prevention, and campaign/round timing. The same normalized input produces the same decision.

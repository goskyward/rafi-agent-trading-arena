# Arena Rules v1.1 — Frozen Strategy Contract

Status: frozen for OPORD-RAFI-002. Strategies may evaluate information and return one decision. They cannot change these rules.

Frozen boundaries: candidate and position contracts; strategy context and output; candidate and order validation; fresh-quote execution; fees; synthetic spread; slippage; accounting; scoring; campaign and round timing; idempotency; maximum three distinct positions.

Strategies receive normalized candidates, all positions, available slots, cash, equity, campaign state, round timing, quote context, and cost estimates. They return exactly one `TRADE`, `SELL`, `PASS`, or `MANAGE_POSITION` decision. A strategy has no UI, database, network, scoring, clock, or execution access.

The Arena Controller remains the sole authority for validation, candidate freshness, quotes, execution, portfolio limits, money, P/L, fees, scoring, persistence, and time.

Breaking changes require a new Arena Rules version and Commander approval.

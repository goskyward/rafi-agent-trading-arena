# Implementation Change Log

## Opportunity Engine URL hardening

- Persisted the provider environment, normalized whitespace and all trailing slashes, and switched upstream requests to `new URL()` construction.
- Pinned the public Opportunity Engine base URL in Wrangler runtime variables.
- Added the resolved health URL only when development diagnostics are enabled.

## Confirmation pass

- Changed authoritative Net Profit scoring to marked equity minus starting capital.
- Enforced timestamped quotes with configurable 90-second freshness and in-transaction revalidation.
- Added request fingerprints and conflicting-key rejection for idempotency.
- Set inclusive ±$0.01 break-even tolerance and persistent campaign wipeout buy lockout.
- Added preview/production Wrangler configuration and expanded validation coverage.

## 1.0.0

- Created a new standalone Arena Worker; the Opportunity Engine source was not copied or modified.
- Added the `primary-arena` SQLite-backed Durable Object and v1 migration.
- Added persistent campaign, round, account, position, ledger, idempotency, and sequence state.
- Added server-derived 24-hour campaign and four-minute round clocks capped at Round 360.
- Added bounded Opportunity Engine health and quote adapters with freshness enforcement.
- Added long-only BUY, partial SELL, full SELL, weighted-average position accounting, entry/exit costs, and stable errors.
- Added completed-trade classification and the five authoritative scoreboard metrics.
- Added the approved proportional 100-point system with win-rate sample adjustment and unique profitable-asset scoring.
- Added protected start, reset, order, and settle routes using timing-safe bearer-token comparison.
- Added environment templates, endpoint documentation, examples, unit validation, Wrangler dry-run validation, CORS allowlisting, and structured logs.
- No deployment performed.

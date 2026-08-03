# Endpoint Contract

All responses are JSON with `Cache-Control: no-store`. Stable failures use `{ "ok": false, "error": { "code", "message" } }`.

## Public reads

- `GET /` — service metadata and read endpoints.
- `GET /health` — Worker, Durable Object, bounded Opportunity Engine health, simulation, and execution-model status.
- `GET /arena` — consolidated clocks, scoreboard, agents, positions, recent trades, market state, and execution model.
- `GET /arena/scoreboard` — 100-point totals, category allocations, leader, and five display metrics.
- `GET /arena/agents` — full Cody and Atlas account models.
- `GET /arena/positions` — positions grouped by agent.
- `GET /arena/trades` — newest-first campaign ledger.

## Protected writes

Every POST requires `Authorization: Bearer <ARENA_ADMIN_TOKEN>`.

- `POST /arena/start` — starts a new 24-hour campaign; rejects an active campaign.
- `POST /arena/reset` — requires `{ "confirm": "RESET_ARENA" }`.
- `POST /arena/order` — submits one idempotent market order.
- `POST /arena/settle` — marks positions, refreshes metrics/scores, and completes expired clocks without fabricating exits.

## Order shapes

BUY requires exactly one of `allocationPercent` or `amountUsd`. SELL requires `positionPercent`. Both require `agentId`, `productId`, and an 8–128 character `idempotencyKey` containing letters, digits, `.`, `_`, `:`, or `-`.

Supported agents: `CODY`, `ATLAS`. Supported products: `BTC-USD`, `ETH-USD`, `SOL-USD`, `XRP-USD`. Only long-only market orders are accepted.

## Stable errors

Additional confirmed errors are `IDEMPOTENCY_KEY_REUSED` for a conflicting reuse and `AGENT_WIPED_OUT` when a wiped-out agent attempts another buy.

`CAMPAIGN_NOT_ACTIVE`, `CAMPAIGN_ALREADY_ACTIVE`, `ROUND_NOT_ACTIVE`, `INVALID_AGENT`, `INVALID_PRODUCT`, `INVALID_SIDE`, `INVALID_AMOUNT`, `INVALID_IDEMPOTENCY_KEY`, `INSUFFICIENT_CASH`, `INSUFFICIENT_POSITION`, `PRICE_UNAVAILABLE`, `STALE_QUOTE`, `UNAUTHORIZED`, `UPSTREAM_UNAVAILABLE`, `INVALID_CONFIRMATION`, `INVALID_JSON`, `METHOD_NOT_ALLOWED`, `NOT_FOUND`, `INTERNAL_ERROR`.

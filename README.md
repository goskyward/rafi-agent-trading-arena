# RA-FI Agent Trading Arena Worker

Standalone Cloudflare Worker and SQLite-backed Durable Object for the simulated Cody-versus-Atlas campaign. It owns clocks, accounts, positions, executions, completed trades, metrics, and the 100-point score. It does not modify the Opportunity Engine and never executes real trades.

## Local setup

1. Copy `.dev.vars.example` to `.dev.vars`.
2. Set `OPPORTUNITY_ENGINE_BASE_URL` and a long random `ARENA_ADMIN_TOKEN`.
3. From this folder run `npm install`, then `npm run dev`.
4. Read routes are public locally. All POST routes require `Authorization: Bearer <ARENA_ADMIN_TOKEN>`.

The Durable Object instance name is `primary-arena`. Local Durable Object data is persistent across local server restarts. Use the protected reset route when a clean state is required.

## Commands

```powershell
npm test
npm run check
npm run dev
```

`npm run check` performs a Wrangler dry run; it does not deploy. Deployment is not authorized by this package.

## Environment

- `OPPORTUNITY_ENGINE_BASE_URL` — existing read-only RA-FI Opportunity Engine base URL.
- `ARENA_ADMIN_TOKEN` — secret bearer token for every write route; set with `wrangler secret put` before a future authorized deployment.
- `FEE_RATE_BPS` — default `40`.
- `SLIPPAGE_BPS` — default `5`.
- `SYNTHETIC_SPREAD_BPS` — default `4`.
- `CORS_ALLOWED_ORIGINS` — comma-separated allowlist.

`MAX_QUOTE_AGE_SECONDS` sets the maximum executable quote age and defaults to 90 seconds.

Execution costs are deterministic simulation inputs and are not represented as an exact Coinbase fee tier or real order-book execution.

## Authority model

The browser cannot mutate balances. Every order is routed to the single authoritative Durable Object, validated again against persisted state, priced from a fresh upstream quote, and committed atomically with its idempotency result. A repeated idempotency key returns the original result.

Campaign and round clocks are derived from persisted absolute timestamps. A Worker restart or browser refresh cannot reset them. Open positions remain marked to market at campaign completion; they are not fabricated as exits.

Net-profit points use marked account equity minus starting balance. Partial exits each count as completed trades. Break-even is inclusive from -$0.01 through +$0.01. A reused idempotency key returns the original result only for the same material order; a conflict returns `IDEMPOTENCY_KEY_REUSED`. A first equity breach at or below $0.01 sets one persistent campaign wipeout and blocks later buys while allowing sells; only reset clears it.

See [ENDPOINT-CONTRACT.md](./ENDPOINT-CONTRACT.md) and [EXAMPLES.md](./EXAMPLES.md).

## Deployment pipeline

GitHub Actions validates every pull request and push to `main` with a locked install, syntax checks, domain tests, and a Wrangler dry-run. A second workflow can deploy the exact validated commit through the official Cloudflare Wrangler action, but only when the repository variable `CLOUDFLARE_DEPLOY_ENABLED` is explicitly set to `true`. It is intentionally disabled until Commander approval.

Deployment credentials and runtime provider values belong in the GitHub `production` environment as encrypted secrets. See [DEPLOYMENT-CHECKLIST.md](./DEPLOYMENT-CHECKLIST.md). The Worker may alternatively be connected to Cloudflare Workers Builds after approval using root `/`, build command `npm install`, and deploy command `npx wrangler deploy`; do not enable both deployment mechanisms simultaneously.

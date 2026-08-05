# Configuration, Routes, State, and Rollback

## Candidate production configuration

`wrangler.toml` is the complete authoritative configuration. The root Worker is `rafi-agent-trading-arena`; `[env.production]` names `rafi-agent-trading-arena-production`. Compatibility date is `2026-08-02`; flags are `nodejs_compat` and `global_fetch_strictly_public`. Observability is enabled at sampling rate 1.

Bindings: Durable Object `ARENA` → `ArenaController`; migration `v1` creates SQLite class `ArenaController`. No KV, D1, R2, queue, or analytics bindings exist. Non-secret variables: `ALLOW_COMPETITIVE_RESET=false`, `FEE_BPS=40`, `SLIPPAGE_BPS=5`, `SPREAD_BPS=4`, `MAX_QUOTE_AGE_SECONDS=90`, CORS `https://www.ra-fi.com,https://ra-fi.com`, production Opportunity Engine URL. Secret name: `ARENA_ADMIN_TOKEN` (value never read). No explicit campaign instance-name variable exists; routing uses Durable Object name `primary-arena`.

No custom route is declared in `wrangler.toml`; workers.dev routing applies.

## Route/security matrix

| Method | Path | Auth | Expected | Behavior / exposure | CORS / rate limit |
|---|---|---|---|---|---|
| GET | `/` | No | 200 | API metadata | Exact allowlist / none |
| GET | `/health` | No | 200 | Health, campaign and DO object identifier | Exact allowlist / none |
| GET | `/arena` | No | 200 | Public arena snapshot | Exact allowlist / none |
| GET | `/arena/scoreboard` | No | 200 | Read scoring | Exact allowlist / none |
| GET | `/arena/agents` | No | 200 | Read agent state | Exact allowlist / none |
| GET | `/arena/positions` | No | 200 | Read positions | Exact allowlist / none |
| GET | `/arena/trades` | No | 200 | Read trade history | Exact allowlist / none |
| GET | `/arena/admin/verify` | Bearer | 200/401 | Admin-token verification | Exact allowlist / none |
| GET | `/arena/admin/audit-summary` | Bearer | 200/401 | Administrative audit state | Exact allowlist / none |
| POST | `/arena/start` | Bearer | 200/401 | State write | Exact allowlist / none |
| POST | `/arena/order` | Bearer | 200/401 | Validated execution write | Exact allowlist / none |
| POST | `/arena/settle` | Bearer | 200/401 | Settlement write | Exact allowlist / none |
| POST | `/arena/reset` | Bearer + reset flag | 403 in production | Reset prohibited | Exact allowlist / none |
| OPTIONS | any | No | 204 | Preflight only | Exact allowlist / none |
| Other | any | N/A | 404 or 405 | No write | Exact allowlist / none |

No debug, fixture, or UAT diagnostics route exists in the candidate. Public activity redacts internal messages and decision sequence IDs. Admin-token comparison is timing-resistant. No source secret was found. Risks: `/health` exposes a Durable Object identifier; routes have no server-side rate limiting; disallowed origins receive a nonmatching ACAO value (browser-enforced denial rather than a direct HTTP denial).

## State migration and initialization

The safe intent is to preserve the existing production campaign, balances, positions, trades, clocks, and Durable Object instance. No reset or new campaign is authorized. The controller's SQLite migration is already the declared `v1`; no new schema migration is introduced by the strategy integration.

This intent cannot be executed safely until the target ambiguity is resolved: the live frontend uses the root Worker, but `--env production` selects a different script and namespace. UAT uses a separate Worker and Durable Object namespace; it must never be promoted by copying state.

## Rollback

Currently deployed root Worker version: `06c936ca-93d9-4e74-bb13-578c4833888f` (observed 2026-08-05). Previous known-good Git code base: `c15da2a70025e08cd120b07d148d6017f7261dee`. The exact frontend deployment version and hosting rollback command are not recorded in this repository.

After target resolution, Worker code rollback should use Cloudflare version rollback for the same root script, preserving the same Durable Object namespace. A Git redeploy from the previous commit is secondary. Do not roll back by deploying to a different environment name or deleting/recreating the Durable Object. Code rollback preserves trades created after release only if the storage schema remains backward compatible; this release adds no state migration, but that claim must be rechecked against the exact deployed target. Expected operational rollback time is minutes once the correct version and account are confirmed.

Because the exact state-preserving production command and frontend rollback identity are unresolved, rollback is not yet sufficient for promotion.

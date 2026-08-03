# GitHub to Cloudflare Deployment Checklist

## Prepared and validated

- [x] Independent private-repository source tree
- [x] Main branch target
- [x] MIT license, README, and hardened `.gitignore`
- [x] CI runs `npm ci`, lint, tests, and Wrangler dry-run
- [x] Deployment follows a successful main-branch CI run
- [x] Deployment is gated by repository variable `CLOUDFLARE_DEPLOY_ENABLED=true`
- [x] Durable Object binding and SQLite migration declared
- [x] No deployment credentials committed

## Commander approval gate

Keep `CLOUDFLARE_DEPLOY_ENABLED` unset or `false` until deployment is authorized.

After approval, configure the GitHub `production` environment and these repository secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `ARENA_ADMIN_TOKEN`
- `OPPORTUNITY_ENGINE_BASE_URL`
- `COINGECKO_DEMO_KEY` (reserved; currently unused)

Then set repository variable `CLOUDFLARE_DEPLOY_ENABLED=true`. A successful push to `main` will run validation and deploy through Wrangler. Cloudflare runtime variables for fees, slippage, spread, quote age, and CORS are versioned in `wrangler.toml`; credentials are secrets.

## Post-deployment validation

- [ ] Capture GitHub build and deployment logs
- [ ] Confirm `ArenaController` migration and `ARENA` binding
- [ ] Confirm `GET /`, `/health`, `/arena`, and `/arena/scoreboard` return HTTP 200
- [ ] Confirm Opportunity Engine health is reachable
- [ ] Run protected campaign start, buy, and sell lifecycle
- [ ] Confirm balances, ledger, scores, clocks, and refresh persistence
- [ ] Integrate frontend using consolidated `GET /arena`

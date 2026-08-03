# Pipeline Verification

Status: **READY FOR COMMANDER APPROVAL — NOT DEPLOYED**

## Local build evidence

- `npm ci`: passed; 35 packages audited, 0 vulnerabilities.
- `npm run lint`: passed.
- `npm test`: passed.
- `npm run check`: passed with Wrangler 4.118.0.
- Upload bundle: 36.74 KiB; gzip 9.77 KiB.
- Durable Object binding: `ARENA` → `ArenaController`.
- SQLite migration: `v1` with `new_sqlite_classes = ["ArenaController"]`.

## Release controls

- CI: automatic on pull requests and `main` pushes.
- Production deployment: disabled unless `CLOUDFLARE_DEPLOY_ENABLED=true`.
- Required production secrets are referenced symbolically; no values are committed.
- Cloudflare deployment and post-deployment health/trade validation remain pending Commander approval.

## Cloudflare Workers Builds alternative

If Commander chooses Cloudflare's native Git integration instead of GitHub Actions deployment:

- Repository root: `/`
- Production branch: `main`
- Build command: `npm install`
- Deploy command: `npx wrangler deploy`
- Worker name must match `rafi-agent-trading-arena`.
- Disable the GitHub deployment workflow gate to avoid duplicate deployments.

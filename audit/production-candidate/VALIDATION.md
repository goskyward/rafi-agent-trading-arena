# Validation and Dry Run

All commands ran from the candidate clone. No deploy occurred.

| Check | Command | Result |
|---|---|---|
| Lint/parsing | `npm.cmd run lint` | PASS |
| Complete repository suite | `npm.cmd test` | PASS (all 11 chained suites) |
| Vivian dedicated suite | `node tests/vivian-strategy-validation.mjs` (included above) | PASS, 20 cases |
| Preston adapter suite | `node tests/preston-strategy-validation.mjs` (included above) | PASS, 20 cases / 35 assertions |
| Contract/parity | `node tests/strategy-sdk-validation.mjs` | PASS; parity true |
| Preston original source | Vitest pinned from original installed toolchain against `preston-strategy.test.ts` | PASS, 27 tests |
| TypeScript | pinned `tsc --noEmit --strict --target ES2022 --module ESNext --moduleResolution Bundler ...` | PASS |
| Whitespace | `git diff --check c15da2a...HEAD` | PASS |
| Production dry run | `wrangler deploy --dry-run --env production --outdir dist-production-audit` | PASS; no upload |
| Startup | `wrangler check startup --env production` | PASS |

The repository has no separate compiled frontend. The exact production HTML is a standalone artifact. `node audit/production-candidate/tools/validate-frontend.mjs <artifact>` passed: 17,972,368 bytes, 371 IDs, zero duplicate IDs, 11 inline scripts parsed, and zero syntax errors. Static endpoint/token/string inspection was also completed. Visual/mobile and live stale/retry UAT remain required after the release blockers are corrected.

## Dry-run evidence

- Environment: `production` (not staging or `preston_uat`)
- Total upload: 138.16 KiB
- Gzip: 33.85 KiB
- Startup profile window: 77.8 ms
- Sampled: 77.6 ms; active 17.2 ms; idle 60.4 ms
- Module: bundled Worker entry `index.js` plus source map
- Binding: `ARENA` Durable Object
- Variables recognized: reset false; fee 40; slippage 5; spread 4; quote age 90; production CORS and Opportunity Engine
- Migration: existing `v1` SQLite Durable Object declaration; no new migration
- Warnings/errors: none from dry run/startup

Generated dry-run output and CPU profiles are excluded from the candidate commit.

## Dependency audit

`npm audit --json --omit=optional` reported three development-toolchain findings: `undici` (one high plus moderate advisories, transitive), `miniflare` (moderate, transitive), and `wrangler` (moderate, direct dev dependency through Miniflare). The Worker source has no runtime npm imports; these packages are build/test/deploy tooling rather than bundled application dependencies. Exploit relevance to public Worker requests is therefore low, but local CI/deployment-machine exposure remains. Recommended disposition: pin and test a non-forced Wrangler/toolchain upgrade in a separate maintenance change; do not use forced audit remediation in this release candidate. No critical finding was reported.

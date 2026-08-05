# Frontend Candidate and UAT Parity

## Exact frontend artifact

Path: `C:\Users\camro\Documents\LIGHTBRIDGE\CIA\marketstack\production-aws-artifact\index.html`

Size: `17,972,368` bytes

SHA-256: `3AC8E60FAE4C1B7F47E77173AE44DE1B054CD3F29C54E7E813D11946AC0E7EAE`

Configured Arena backend: `https://rafi-agent-trading-arena.camronra2020.workers.dev`.

The artifact renders the public competitors as Vivian and Preston and consumes campaign/round, activity, balances, equity, and P&L from the Arena API. It contains no UAT banner, Preston-UAT endpoint, Pages URL, localhost URL, or obvious embedded bearer/admin token. Mobile behavior is implemented in the single HTML artifact; stale/retry behavior is client-side and requires visual UAT before release.

Exact search counts:

| Needle | Count | Disposition |
|---|---:|---|
| `staging` | 0 | Clean |
| `preston-uat` | 0 | Clean |
| `pages.dev` | 0 | Clean |
| `localhost` | 0 | Clean |
| `ATLAS_REVERSION_COMPAT` | 0 | Clean |
| `RAFI_PRESTON_REVERSION` | 0 | Clean |
| `PRESTON_ANTHROPIC_V1.0.0` | 0 | **Missing required exact label** |
| `VIVIAN_EDGE_MOMENTUM_V1.0.0` | 0 | **Missing required exact label** |
| `workers.dev` | 13 | Legitimate production service URLs; each must remain inventoried |
| `ATLAS` | 70 | Internal agent identifier; not legacy-strategy fallback |

## UAT-to-production parity

Approved isolated UAT branch advanced beyond the frozen integration commit to add isolated environment wiring, schema initialization/diagnostics, evidence, campaign pinning, and exact UAT CORS. Those commits are deliberately excluded from production.

| Area | Candidate production | Isolated Preston UAT | Difference |
|---|---|---|---|
| Frozen strategy source | Same Preston tag bytes | Same | None |
| Adapter/registry at frozen integration | Same strategy mapping | Same foundation | UAT later adds diagnostics/registry exposure |
| Worker script | Root `rafi-agent-trading-arena` or ambiguous `[env.production]` target | Separate UAT Worker | Intentionally separate; target must be resolved |
| Durable Object | Root production namespace/name `primary-arena` | Separate UAT namespace/campaign | Intentionally separate |
| CORS | `ra-fi.com` and `www.ra-fi.com` | Exact isolated Pages origin | Expected environment difference |
| Frontend | Production AWS HTML | Isolated UAT page | Different artifacts |
| API routes | No strategy-registry/diagnostic route | UAT diagnostics/registry evidence added | Material observability difference |
| Opportunity source | Production Opportunity Engine | UAT-specific wiring/fixtures as configured | Environment difference |
| Quote/fee/spread/slippage/age | 40 fee, 4 spread, 5 slippage, 90s | Must be verified from UAT deployment evidence | No unproven parity claim |
| Campaign init | Preserve existing production campaign | Pinned isolated campaign | Intentionally different |

Production and UAT state bindings do not overlap in the observed deployments. Source parity is proven for frozen Preston bytes, not for all later environment-only UAT commits. The production frontend cannot display exact strategy versions because the candidate lacks the UAT registry endpoint; this is a release blocker under the requested acceptance criteria.

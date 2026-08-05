# Strategy Integrity and Runtime Mapping

## SHA-256 inventory

| Artifact | SHA-256 |
|---|---|
| Frozen Vivian source `src/strategy-sdk/vivian.js` | `6D02BBF45D860AC9CF7D0E8ACED0538D3A00582402285E840B26836F76ECCF23` |
| Frozen Preston source `src/strategy-sdk/preston/preston-strategy.ts` | `8C37F4BA9E4381BAFEF4AC9E2E3D3C93B05E925A252E9C4B463B3B04A8CA1D78` |
| Preston original tests | `93630DAB1BB02A9CDD45629EB82FA64DC008892BEAF741B7DE7416E57D2B6916` |
| Vivian validation suite | `5293ACE68671068EA0021D2A47E96D5B32D42A1D2E02059D4BE3701D57D7AB73` |
| Preston adapter | `9A9E039C0E54E85AB9CC1F4DBE0A5B87A8D10BB88A44678E0E98AD5AFAA58A78` |
| Strategy registry `src/strategies.js` | `98EC3C650D3574D048181D1E7F9972739029FDE2DEE7A8CA5A984B3FD754A4A3` |

Vivian frozen source differs from `vivian-clean-room-v1.0.0`: **No**. Preston frozen source/tests differ from `preston-clean-room-v1.0.0`: **No**. Thresholds, reason codes, dialogue, and allocation conversion changed after the approved Preston tag/UAT source: **No**.

## Production mapping

| Display | Agent ID | Strategy | Version | Runtime/adapter | Positions | Allocation | Confidence |
|---|---|---|---|---|---:|---|---|
| Vivian | `CODY` | `vivian-edge-momentum-v1` | `VIVIAN_EDGE_MOMENTUM_V1.0.0` | `CodyStrategy` → `TemporaryVivianAdapter` | Arena limit 3 | Adapter emits percent | Adapter emits 0–100 |
| Preston | `ATLAS` | `preston-atlas-v1` | `PRESTON_ANTHROPIC_V1.0.0` | `AtlasStrategy` → `TemporaryPrestonAdapter` → isolated TS strategy | Strategy intentionally 1; arena limit 3 | Frozen fraction converted ×100 | Frozen fraction converted ×100 |

The controller supplies only `state.agents[agentId]` to each strategy. Vivian cannot receive Preston positions and Preston cannot receive Vivian positions. Preston remains single-position because the isolated context derives `oneOpenPosition` from Preston's own positions. Vivian retains the arena's three-position capability. Decisions receive sequence identities and order keys for duplicate suppression.

No legacy Preston implementation is registered and no fallback selects `ATLAS_REVERSION_COMPAT_V1.2`.

## Complete audit source map

The following complete tracked files are the audit boundary:

- Controller, accounting, persistence: `src/arena-controller.js`
- Public/admin routing, authentication, Durable Object routing: `src/index.js`
- Registry: `src/strategies.js`
- Strategy contracts/interface/runtime: `src/strategy-sdk/contracts.js`, `interface.js`, `runtime.js`, `types.js`
- Vivian: `src/strategy-sdk/vivian.js`, `vivian-adapter.js`
- Preston: `src/strategy-sdk/preston.js`, `preston/preston-adapter.js`, `preston/preston-strategy.ts`
- Order constraints: `src/portfolio-limits.js`
- Quotes/freshness: `src/market-provider.js`, `src/opportunity-contract.js`, `src/config.js`
- Fill, fees, spread, slippage: `src/execution-math.js`, `src/config.js`
- P&L/scoring: `src/scoring.js`, `src/rolling-scoring.js`
- Clocks/lifecycle: `src/clocks.js`, `src/alarm-lifecycle.js`, `src/halftime-review.js`
- Shared utilities/error helpers: `src/utils.js`
- Configuration/migrations: `wrangler.toml`

These files are provided in full by the repository rather than copied into an audit document, preventing excerpt drift.

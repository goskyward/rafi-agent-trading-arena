# Trading Arena Feature-Parity Restoration

## Authority and orchestration

- `ArenaController` remains the sole owner of campaign, clocks, accounts, positions, fills, trades, metrics, and scoring.
- One Durable Object alarm starts one second after an authenticated campaign start and reschedules every 15 seconds while the campaign is active.
- Each cycle fetches one shared Opportunity Engine market context, then runs Cody and Atlas sequentially through the same existing order engine.
- Decision IDs contain campaign ID, round number, 15-second bucket, and agent ID. The activity guard prevents a second decision in the same cycle; the existing ledger idempotency map prevents duplicate fills.
- Reads do not schedule alarms or mutate lifecycle state. Reset deletes the pending alarm.

## Endpoint contract addition

`GET /arena` retains its public contract and now supplies the minimum observational fields required by the renderer:

- `agents.<ID>.activity`: status, message, selected product, decision, confidence, allocation, update time, active order ID, decision sequence ID.
- `market.assets.<PRODUCT>`: price, 24-hour change, source timestamp, and a bounded 24-observation price series.
- `executionModel`: fee, slippage, and synthetic spread assumptions for informational frontend estimates.

No frontend scoring, fill creation, market simulation, or autonomous decision path ships in the single-file artifact.

## Staging proof

- Worker version: `707204c2-b1a6-44d1-acd3-c7adc3a50db2`
- Campaign: `campaign-d167a195-4a2d-4844-b39b-d202caa1fe38`
- Alarm opened Cody's BTC position without a browser trading engine.
- At round pressure the Worker closed the position, persisted one completed trade, updated the ledger/scoreboard, advanced to round two, and opened the next position.
- Two independent reads returned the same campaign and completed-trade count.
- Production remained on `campaign-f23ef4bc-ce51-4660-9ba1-f6156751b044`, started `2026-08-03T12:44:00.118Z`; no production write or deployment occurred.

## Validation

- Worker syntax/lint: PASS
- Strategy BUY/HOLD/SELL tests: PASS
- Accounting/scoring regression tests: PASS
- Alarm cadence, shared context, decision and ledger idempotency checks: PASS
- Wrangler staging dry-run: PASS
- Single-file JavaScript parse: PASS
- Duplicate IDs: none
- External runtime assets: none
- Legacy browser engine startup: absent
- Token persistence APIs: absent
- Desktop and 390px mobile rendering: PASS

## Known limitations

- The market ladder is intentionally labeled simulated and is not exchange depth.
- Agent Intelligence remains deferred per the OPORD.
- The 5-second observer poll can skip short-lived intermediate choreography states; accepted orders, positions, completed trades, and ledger outcomes remain persistent.
- Opportunity Engine currently reports cached Coinbase service status; the Arena continues to apply its existing 90-second source-timestamp policy without changing the approved provider.

## Recommendation

`PASS` for staging feature-parity UAT. Production integration remains gated on Commander approval.

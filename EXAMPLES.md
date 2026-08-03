# Example Requests and Responses

## Start

```http
POST /arena/start
Authorization: Bearer <token>
```

Returns the consolidated `/arena` payload with persisted campaign and round timestamps.

## Buy

```json
{
  "agentId": "CODY",
  "side": "BUY",
  "productId": "BTC-USD",
  "allocationPercent": 25,
  "idempotencyKey": "cody-round1-buy-btc-001"
}
```

```json
{
  "ok": true,
  "order": {
    "orderId": "order-00000001",
    "status": "FILLED",
    "side": "BUY",
    "productId": "BTC-USD",
    "referencePrice": 100000,
    "fillPrice": 100070.01,
    "grossNotionalUsd": 249003.984,
    "feeUsd": 996.016,
    "executionModel": {
      "version": "1.0.0",
      "feeRateBps": 40,
      "slippageBps": 5,
      "syntheticSpreadBps": 4,
      "simulated": true
    }
  },
  "trade": null
}
```

## Partial sell

```json
{
  "agentId": "CODY",
  "side": "SELL",
  "productId": "BTC-USD",
  "positionPercent": 50,
  "idempotencyKey": "cody-round2-sell-btc-001"
}
```

A sell returns the filled order, updated agent, scoreboard, and completed-trade record containing entry/exit costs, net P/L, percentage return, classification, provenance, and holding time.

## Error

```json
{
  "ok": false,
  "error": {
    "code": "INSUFFICIENT_POSITION",
    "message": "CODY has no BTC-USD position to sell."
  }
}
```


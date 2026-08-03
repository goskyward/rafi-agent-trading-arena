# Trading Arena Feature-Parity Matrix

| Feature | Old Build | Current Build | Required Source | Restore/Defer |
|---|---|---|---|---|
| Agent identity card | Full | Reduced | Worker account + static identity | Restore |
| Agent status text | Animated local state | Market-only | Worker activity | Restore |
| Asset logo/name/symbol | Full | Missing | Worker market asset | Restore |
| Current price/change | Local random walk | Missing | Opportunity Engine via Worker | Restore |
| Sparkline | Local random walk | Missing | Bounded Worker quote history | Restore |
| Market-order ladder/current marker | Simulated | Missing | Frontend display from live reference | Restore, label simulated |
| Allocation percentage/value | Full | Missing | Worker activity/account | Restore |
| Estimated quantity/fee/total | Full | Missing | Worker executionModel | Restore, informational |
| BUY/SELL visual controls | Full animation | Disabled shell | Worker activity/order transitions | Restore display-only |
| Continue/review sequence | Local action | Missing | Worker activity choreography | Restore indication only |
| Order-status messaging | Full | Pending label | Worker activity | Restore |
| Open-position panel/duration/P&L | Full | Basic | Worker positions/metrics | Restore |
| Trade animation | Local | Missing | Worker active-order transition | Restore |
| Scoreboard/five metrics | Local scoring | Worker values | Worker scoreboard | Preserve Worker authority |
| Trade history | Local history | Worker recentTrades | Worker ledger | Preserve/expand |
| Commander Control | Missing originally | Present | Worker admin routes | Preserve |
| Dual clocks | Local | Server-anchored | Worker timestamps | Preserve |
| Mobile layout | Full | Reduced | Frontend CSS | Restore |
| Autonomous decision activity | Browser loop | Disabled | Durable Object alarm + strategy registry | Restore server-side |

The removed Agent Intelligence panel and real exchange order-book depth remain deferred.

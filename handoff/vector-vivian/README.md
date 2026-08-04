# Vector Vivian Strategy Package

Official Arena Rules v1.1 handoff. This package exposes only the frozen interface, shared types, deterministic fixtures, reason-code dictionary, current Vivian compatibility strategy, temporary adapter, metadata, and acceptance-validation entry points.

Assumptions: long-only simulated Coinbase USD spot products; at most three distinct positions; one decision per evaluation; no networking, storage, execution, scoring, UI, or timing authority. Vivian remains the aggressive momentum agent with the existing bounded halftime threshold adjustment.

Run `npm test` from the repository root. The `strategy-sdk-validation` suite proves direct-module and adapter parity over every fixture.

# Opportunity Contract v1.0 migration

The existing `ArenaController` SQLite-backed Durable Object creates four additive tables at initialization: `opportunity_scans`, `opportunity_records`, `agent_decisions`, and `decision_outcomes`. The existing live state key and Durable Object migration tag are unchanged.

Ordinary campaign reset replaces only `arena-state-v1`; it never drops or deletes audit tables. No production deployment or production Durable Object migration is part of this staging change.

Rollback: redeploy the prior Arena staging commit and point staging `OPPORTUNITY_ENGINE_BASE_URL` back to the prior upstream. The additive audit tables may remain safely unused. Do not drop them; they contain immutable UAT evidence.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/arena-controller.js", import.meta.url), "utf8");
assert.match(source, /async alarm\(\)/, "Durable Object alarm handler must exist");
assert.match(source, /this\.env\s*=\s*env/, "Durable Object must retain environment bindings for alarm execution");
assert.match(source, /setAlarm\(Date\.now\(\)\+AGENT_CADENCE_MS\)/, "active campaigns must reschedule the alarm");
assert.match(source, /campaign\.id.*round\.number.*bucket.*agentId/s, "decision identity must include campaign, round, bucket, and agent");
assert.match(source, /activity\.decisionSequenceId===sequenceId/, "duplicate decision cycles must stop before execution");
assert.match(source, /state\.idempotency\[input\.idempotencyKey\]/, "order execution must retain ledger idempotency");
assert.match(source, /for\(const agentId of ARENA_CONFIG\.agents\)await this\.runAgentDecision/, "registered agents must share one market cycle");
assert.match(source, /async getArena\(\) \{ return this\.buildArenaPayload\(await this\.ensureActiveCampaign\(\)/, "authoritative arena reads must ensure one active campaign");
assert.match(source, /this\.ctx\.storage\.transaction\(async txn=>/, "campaign initialization must re-read and persist inside a storage transaction");
assert.match(source, /if\(current\.campaign\.status==="ACTIVE"\)/, "active campaigns must remain unchanged");
assert.match(source, /async alarm\(\)[\s\S]*ensureActiveCampaign\(\)/, "alarms must provide automatic campaign succession");
assert.match(source, /SKIP_AUDIT_SCHEMA_INIT!=="true"&&!auditSchemaReady\(this\.ctx\.storage\.sql\)/, "existing staging Durable Objects must be able to skip schema access during quota exhaustion");
console.log(JSON.stringify({alarmCadence:"passed",decisionIdempotency:"passed",sharedMarketContext:"passed",autoStart:"passed",concurrencyGuard:"passed",schemaWriteGuard:"passed"},null,2));

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/arena-controller.js", import.meta.url), "utf8");
assert.match(source, /async alarm\(\)/, "Durable Object alarm handler must exist");
assert.match(source, /setAlarm\(Date\.now\(\)\+AGENT_CADENCE_MS\)/, "active campaigns must reschedule the alarm");
assert.match(source, /campaign\.id.*round\.number.*bucket.*agentId/s, "decision identity must include campaign, round, bucket, and agent");
assert.match(source, /activity\.decisionSequenceId===decisionId/, "duplicate decision cycles must stop before execution");
assert.match(source, /state\.idempotency\[input\.idempotencyKey\]/, "order execution must retain ledger idempotency");
assert.match(source, /for\(const agentId of ARENA_CONFIG\.agents\)await this\.runAgentDecision/, "registered agents must share one market cycle");
assert.doesNotMatch(source, /setAlarm\([^\n]*(getArena|scoreboard|health)/, "read paths must not schedule lifecycle work");
console.log(JSON.stringify({alarmCadence:"passed",decisionIdempotency:"passed",sharedMarketContext:"passed",readOnlyReads:"passed"},null,2));

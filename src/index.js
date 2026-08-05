import { ArenaController } from "./arena-controller.js";
import { SERVICE, VERSION, EXECUTION_MODEL_VERSION } from "./config.js";
import { OpportunityEngineMarketProvider } from "./market-provider.js";
import { STRATEGY_METADATA, STRATEGY_VERSIONS } from "./strategies.js";
import { ArenaError, assertFiniteTree, errorPayload, readJson, secureEqual } from "./utils.js";

export { ArenaController };

export default {
  async fetch(request, env) {
    const requestId = request.headers.get("cf-ray") || crypto.randomUUID(), url = new URL(request.url), path = normalizePath(url.pathname), cors = corsHeaders(request, env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    try {
      const stub = env.ARENA.getByName(env.ARENA_INSTANCE_NAME || "primary-arena");
      if (request.method === "GET" && path === "/") return json({ ok: true, service: SERVICE, version: VERSION, simulation: true, environment: env.ARENA_ENVIRONMENT || "default", endpoints: ["/health", "/arena", "/arena/scoreboard", "/arena/agents", "/arena/positions", "/arena/trades", "/strategy-registry"] }, 200, cors);
      if (request.method === "GET" && path === "/strategy-registry") return json({ ok: true, environment: env.ARENA_ENVIRONMENT || "default", sourceBaselineCommit: env.SOURCE_BASELINE_COMMIT || null, strategyProfile: env.STRATEGY_PROFILE || null, versions: STRATEGY_VERSIONS, metadata: STRATEGY_METADATA }, 200, cors);
      if (request.method === "GET" && path === "/uat-diagnostics" && env.ARENA_ENVIRONMENT === "preston-anthropic-uat") return json(await stub.getUatDiagnostics(), 200, cors);
      if (request.method === "GET" && path === "/health") {
        const [durableObject, upstream] = await Promise.all([stub.health().catch(() => ({ available: false })), new OpportunityEngineMarketProvider(env).health()]);
        return json({ ok: true, service: SERVICE, version: VERSION, status: upstream.reachable ? "online" : "degraded", serverTime: new Date().toISOString(), simulation: true, executionModelVersion: EXECUTION_MODEL_VERSION, durableObject, opportunityEngine: upstream }, 200, cors);
      }
      if (request.method === "GET" && path === "/arena") return json(await stub.getArena(), 200, cors);
      if (request.method === "GET" && path === "/arena/scoreboard") return json(await stub.getScoreboard(), 200, cors);
      if (request.method === "GET" && path === "/arena/agents") return json(await stub.getAgents(), 200, cors);
      if (request.method === "GET" && path === "/arena/positions") return json(await stub.getPositions(), 200, cors);
      if (request.method === "GET" && path === "/arena/trades") return json(await stub.getTrades(), 200, cors);
      if (request.method === "GET" && path === "/arena/admin/verify") {
        await requireAdmin(request, env);
        return json({ ok: true, authenticated: true }, 200, cors);
      }
      if (request.method === "GET" && path === "/arena/admin/audit-summary") {
        await requireAdmin(request, env);
        return json(await stub.getAuditSummary(), 200, cors);
      }
      if (request.method === "POST" && ["/arena/start", "/arena/reset", "/arena/order", "/arena/settle"].includes(path)) {
        await requireAdmin(request, env);
        if (path === "/arena/start") return json(await stub.startCampaign(), 200, cors);
        if (path === "/arena/reset") { if(env.ALLOW_COMPETITIVE_RESET!=="true")throw new ArenaError("RESET_DISABLED","Competitive reset is disabled in this environment.",403);const body = await readJson(request); return json(await stub.resetCampaign(body.confirm), 200, cors); }
        if (path === "/arena/order") return json(await stub.submitOrder(await readJson(request), requestId), 200, cors);
        return json(await stub.settle(), 200, cors);
      }
      if (!["GET", "POST"].includes(request.method)) throw new ArenaError("METHOD_NOT_ALLOWED", "Method not allowed.", 405);
      if (request.method === "GET" || request.method === "POST") throw new ArenaError("NOT_FOUND", "Route not found.", 404);
      throw new ArenaError("METHOD_NOT_ALLOWED", "Method not allowed.", 405);
    } catch (error) {
      const result = errorPayload(error);
      console.error(JSON.stringify({ event: "arena_request_error", requestId, route: path, code: result.body.error.code, message: error instanceof Error ? error.message : "Unknown error" }));
      return json(result.body, result.status, cors);
    }
  }
};

async function requireAdmin(request, env) {
  const header = request.headers.get("authorization") || "", token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!(await secureEqual(token, env.ARENA_ADMIN_TOKEN))) throw new ArenaError("UNAUTHORIZED", "A valid arena administrative token is required.", 401);
}
function normalizePath(path) { return path !== "/" ? path.replace(/\/+$/, "") : "/"; }
function corsHeaders(request, env) { const origin = request.headers.get("origin"), allowed = String(env.CORS_ALLOWED_ORIGINS || "http://localhost:8787,http://127.0.0.1:8787").split(",").map(x => x.trim()).filter(Boolean), allowOrigin = origin && allowed.includes(origin) ? origin : allowed[0] || "null"; return { "Access-Control-Allow-Origin": allowOrigin, Vary: "Origin", "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "Content-Type,Authorization", "Access-Control-Max-Age": "86400" }; }
function json(payload, status, cors) { assertFiniteTree(payload); return Response.json(payload, { status, headers: { ...cors, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } }); }

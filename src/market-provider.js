import { ARENA_CONFIG, maximumQuoteAgeSeconds } from "./config.js";
import { ArenaError } from "./utils.js";

export class OpportunityEngineMarketProvider {
  constructor(env) {
    this.env = env;
    this.baseUrl = String(env.OPPORTUNITY_ENGINE_BASE_URL || "").trim().replace(/\/+$/, "");
  }

  async health() {
    if (!this.baseUrl) return { reachable: false, status: "not_configured" };
    try {
      const probe = await this.probeHealth();
      const diagnostics = this.diagnosticsEnabled() ? healthDiagnostics(probe) : {};
      return { reachable: probe.payload?.ok === true, status: probe.payload?.ok === true ? "online" : "degraded", ...diagnostics };
    } catch (error) {
      const diagnostics = this.diagnosticsEnabled() && error?.diagnostics ? error.diagnostics : {};
      return { reachable: false, status: "unavailable", error: safeMessage(error), ...diagnostics };
    }
  }

  async diagnosticHealth() {
    const probe = await this.probeHealth();
    return { status: probe.response.status, service: safeText(probe.payload?.service), version: safeText(probe.payload?.version), contentType: probe.contentType };
  }

  async getOpportunityWatch() { return this.fetchJson("/opportunity-watch", 5000); }
  async getMovers() { return this.fetchJson("/movers?view=all&limit=50", 5000); }
  async getDashboardSummary() { return this.fetchJson("/dashboard-summary", 5000); }

  async getMarketQuote(productId) {
    if (!ARENA_CONFIG.supportedProducts.includes(productId)) throw new ArenaError("INVALID_PRODUCT", "The requested product is unsupported.");
    if (!this.baseUrl) throw new ArenaError("UPSTREAM_UNAVAILABLE", "Opportunity Engine is not configured.", 503);
    const symbol = productId.split("-")[0];
    const endpoints = ["/movers?view=all&limit=50", "/market-pulse", "/dashboard-summary"];
    let lastError;
    for (const endpoint of endpoints) {
      try {
        const payload = await this.fetchJson(endpoint, 5000), asset = findAsset(payload, productId, symbol);
        if (!asset) continue;
        const price = Number(asset.price ?? asset.currentPrice ?? asset.last ?? asset.lastPrice ?? asset.priceUsd);
        if (!Number.isFinite(price) || price <= 0) continue;
        const timestamp = validTimestamp(asset.updatedAt ?? asset.timestamp ?? payload.updatedAt ?? payload.generatedAt);
        if (timestamp === null) throw new ArenaError("PRICE_UNAVAILABLE", `${productId} quote has no valid source timestamp.`, 503);
        const ageSeconds = Math.max(0, (Date.now() - timestamp) / 1000);
        if (ageSeconds > maximumQuoteAgeSeconds(this.env)) throw new ArenaError("STALE_QUOTE", `${productId} quote is ${Math.round(ageSeconds)} seconds old.`, 409);
        return { productId, price, observedAt: new Date().toISOString(), sourceTimestamp: new Date(timestamp).toISOString(), ageSeconds, source: "RA-FI Opportunity Engine", stale: false, endpoint };
      } catch (error) { if (error instanceof ArenaError && ["STALE_QUOTE", "PRICE_UNAVAILABLE"].includes(error.code)) throw error; lastError = error; }
    }
    throw new ArenaError("PRICE_UNAVAILABLE", `A fresh ${productId} quote is unavailable.${lastError ? ` ${safeMessage(lastError)}` : ""}`, 503);
  }

  async fetchJson(path, timeoutMs) {
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(this.resolveUrl(path), { headers: { Accept: "application/json" }, signal: controller.signal });
      const length = Number(response.headers.get("content-length") || 0);
      if (length > 2000000) throw new Error("Upstream payload exceeds limit");
      if (!response.ok) throw new Error(`Upstream HTTP ${response.status}`);
      const payload = await response.json();
      if (!payload || typeof payload !== "object") throw new Error("Upstream payload is invalid");
      return payload;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw new ArenaError("UPSTREAM_UNAVAILABLE", "Opportunity Engine request timed out.", 503);
      throw error;
    } finally { clearTimeout(timeout); }
  }

  async probeHealth() {
    const path = "/health", provider = "OpportunityEngineMarketProvider", resolvedUrl = this.resolveUrl(path), controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 3000);
    console.log(JSON.stringify({ event: "arena_upstream_health_request", resolvedUrl: resolvedUrl.href, path, provider }));
    try {
      const response = await fetch(resolvedUrl, { headers: { Accept: "application/json" }, signal: controller.signal });
      const contentType = response.headers.get("content-type") || "";
      console.log(JSON.stringify({ event: "arena_upstream_health_response", resolvedUrl: resolvedUrl.href, httpStatus: response.status, path, provider }));
      let payload = null;
      try { payload = await response.json(); } catch {}
      const probe = { response, payload, resolvedUrl, path, provider, contentType };
      if (!response.ok) {
        const error = new Error(`Upstream HTTP ${response.status}`);
        error.diagnostics = healthDiagnostics(probe);
        throw error;
      }
      return probe;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw new ArenaError("UPSTREAM_UNAVAILABLE", "Opportunity Engine request timed out.", 503);
      throw error;
    } finally { clearTimeout(timeout); }
  }

  resolveUrl(path) {
    if (!this.baseUrl) throw new ArenaError("UPSTREAM_UNAVAILABLE", "Opportunity Engine is not configured.", 503);
    return new URL(path, `${this.baseUrl}/`);
  }

  diagnosticsEnabled() { return this.env.ENABLE_DEV_DIAGNOSTICS === "true"; }
}

function healthDiagnostics(probe) { return { upstreamHealthUrl: probe.resolvedUrl.href, providerPath: `${probe.provider}.health`, httpStatus: probe.response.status, contentType: probe.contentType }; }
function safeText(value) { return typeof value === "string" ? value.slice(0, 100) : null; }

function findAsset(payload, productId, symbol) {
  const queue = [payload], seen = new Set();
  while (queue.length) {
    const value = queue.shift(); if (!value || typeof value !== "object" || seen.has(value)) continue; seen.add(value);
    if (!Array.isArray(value)) {
      const candidate = String(value.productId ?? value.product_id ?? value.symbol ?? value.asset ?? "").toUpperCase();
      if (candidate === productId || candidate === symbol || candidate === `${symbol}-USD`) return value;
      for (const item of Object.values(value)) if (item && typeof item === "object") queue.push(item);
    } else queue.push(...value);
  }
  return null;
}
function validTimestamp(value) { const number = Date.parse(String(value || "")); return Number.isFinite(number) ? number : null; }
function safeMessage(error) { return error instanceof Error ? error.message : "Unknown upstream error"; }

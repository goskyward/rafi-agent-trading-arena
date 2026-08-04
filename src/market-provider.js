import { ARENA_CONFIG, maximumQuoteAgeSeconds } from "./config.js";
import { isExactCoinbaseUsdProduct, validateOpportunityBoard } from "./opportunity-contract.js";
import { ArenaError } from "./utils.js";

export class OpportunityEngineMarketProvider {
  constructor(env = {}) {
    this.env = env;
    this.baseUrl = String(env.OPPORTUNITY_ENGINE_BASE_URL || "").trim().replace(/\/+$/, "");
  }

  async health() {
    if (!this.baseUrl) return { reachable: false, status: "not_configured" };
    try { const payload = await this.fetchJson("/health", 3000); return { reachable: payload?.ok === true, status: payload?.ok === true ? "online" : "degraded" }; }
    catch (error) { return { reachable: false, status: "unavailable", error: safeMessage(error) }; }
  }

  async getOpportunityBoard() {
    const raw = await this.fetchJson("/opportunity-board", 7000, ARENA_CONFIG.opportunityPayloadMaximumBytes);
    return { raw, ...(await validateOpportunityBoard(raw)) };
  }

  async getMovers() {
    const payload = await this.fetchJson("/movers", 7000, ARENA_CONFIG.opportunityPayloadMaximumBytes);
    if (!Array.isArray(payload.assets)) throw new ArenaError("INVALID_MOVERS", "Movers payload has no asset collection.", 502);
    return payload;
  }

  async getMarketContext(board, heldProducts = []) {
    const productIds = [...new Set([...(board?.opportunities || []).map(item => item.productId), ...heldProducts])];
    const settled = await Promise.allSettled(productIds.map(productId => this.getMarketQuote(productId)));
    const assets = {};
    settled.forEach((result, index) => { if (result.status === "fulfilled") assets[productIds[index]] = result.value; });
    return assets;
  }

  async getCandidateMarketContext(board, movers, heldProducts = []) {
    const productIds = [...new Set([...(board?.opportunities || []).map(item => item.productId), ...(movers?.assets || []).map(item => item.productId), ...ARENA_CONFIG.coreAssets, ...heldProducts])].filter(isExactCoinbaseUsdProduct);
    const settled = await Promise.allSettled(productIds.map(productId => this.getMarketQuote(productId)));
    const assets = {};
    settled.forEach((result, index) => { if (result.status === "fulfilled") assets[productIds[index]] = result.value; });
    return assets;
  }

  async getMarketQuote(productId) {
    if (!isExactCoinbaseUsdProduct(productId)) throw new ArenaError("INVALID_PRODUCT", "The requested product is not an exact Coinbase USD spot product.");
    if (!this.baseUrl) throw new ArenaError("UPSTREAM_UNAVAILABLE", "Opportunity Engine is not configured.", 503);
    const path = `/quote?productId=${encodeURIComponent(productId)}`;
    const payload = await this.fetchJson(path, 5000);
    const price = Number(payload.price), timestamp = Date.parse(payload.sourceTimestamp || "");
    if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(timestamp)) throw new ArenaError("PRICE_UNAVAILABLE", `${productId} quote is invalid.`, 503);
    const ageSeconds = Math.max(0, (Date.now() - timestamp) / 1000);
    if (payload.stale === true || ageSeconds > maximumQuoteAgeSeconds(this.env)) throw new ArenaError("STALE_QUOTE", `${productId} quote is ${Math.round(ageSeconds)} seconds old.`, 409);
    return { productId, price, changePercent: 0, observedAt: new Date().toISOString(), sourceTimestamp: new Date(timestamp).toISOString(), ageSeconds, source: "RA-FI Opportunity Engine", stale: false, endpoint: "/quote" };
  }

  async fetchJson(path, timeoutMs, maximumBytes = 2000000) {
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(this.resolveUrl(path), { headers: { Accept: "application/json" }, signal: controller.signal });
      const declared = Number(response.headers.get("content-length") || 0);
      if (declared > maximumBytes) throw new ArenaError("UPSTREAM_PAYLOAD_TOO_LARGE", "Upstream payload exceeds limit.", 502);
      const text = await response.text();
      if (new TextEncoder().encode(text).byteLength > maximumBytes) throw new ArenaError("UPSTREAM_PAYLOAD_TOO_LARGE", "Upstream payload exceeds limit.", 502);
      if (!response.ok) throw new Error(`Upstream HTTP ${response.status}`);
      let payload; try { payload = JSON.parse(text); } catch { throw new Error("Upstream payload is not valid JSON"); }
      if (!payload || typeof payload !== "object") throw new Error("Upstream payload is invalid");
      return payload;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw new ArenaError("UPSTREAM_UNAVAILABLE", "Opportunity Engine request timed out.", 503);
      throw error;
    } finally { clearTimeout(timeout); }
  }

  resolveUrl(path) {
    if (!this.baseUrl) throw new ArenaError("UPSTREAM_UNAVAILABLE", "Opportunity Engine is not configured.", 503);
    return new URL(path, `${this.baseUrl}/`);
  }
}

function safeMessage(error) { return error instanceof Error ? error.message : "Unknown upstream error"; }

import { ARENA_CONFIG } from "./config.js";
import { ArenaError } from "./utils.js";

const BOARD_STATUSES = new Set(["ACTIVE", "EMPTY", "STALE", "INVALID"]);
const TRADABILITY = new Set(["TRADABLE", "WATCH_ONLY", "HALTED", "UNKNOWN"]);
const DIRECTIONS = new Set(["UP", "DOWN", "FLAT", "UNKNOWN"]);
const SEVERITIES = new Set(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
const PRODUCT_PATTERN = /^[A-Z0-9]{2,15}-USD$/;

export async function validateOpportunityBoard(raw, receivedAt = new Date()) {
  const rejectionCodes = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw invalid("BOARD_NOT_OBJECT");
  if (String(raw.contractVersion || "").split(".")[0] !== "1") throw invalid("UNSUPPORTED_CONTRACT_MAJOR");
  for (const field of ["engineVersion", "scanCycleId"]) if (!boundedText(raw[field], 1, 128)) throw invalid(`MISSING_${field.toUpperCase()}`);
  const generatedMs = dateValue(raw.generatedAt), expiresMs = dateValue(raw.expiresAt);
  if (generatedMs === null) throw invalid("INVALID_GENERATED_AT");
  if (expiresMs === null || expiresMs <= generatedMs) throw invalid("INVALID_EXPIRES_AT");
  if (generatedMs > receivedAt.getTime() + ARENA_CONFIG.opportunityFutureSkewSeconds * 1000) throw invalid("FUTURE_GENERATED_AT");
  if (raw.source !== "COINBASE") throw invalid("INVALID_SOURCE");
  if (!BOARD_STATUSES.has(raw.boardStatus)) throw invalid("INVALID_BOARD_STATUS");
  if (!Array.isArray(raw.opportunities)) throw invalid("OPPORTUNITIES_NOT_ARRAY");
  if (raw.opportunities.length > ARENA_CONFIG.opportunityBoardMaximum) throw invalid("BOARD_LIMIT_EXCEEDED");

  const seenIds = new Set(), accepted = [];
  for (const record of raw.opportunities) {
    const result = validateRecord(record, raw, seenIds);
    if (result.ok) accepted.push(result.value);
    else rejectionCodes.push({ opportunityId: boundedText(record?.opportunityId, 1, 128) ? record.opportunityId : null, code: result.code });
  }
  accepted.sort((a, b) => a.rank - b.rank || a.productId.localeCompare(b.productId));
  const normalized = {
    contractVersion: String(raw.contractVersion), engineVersion: String(raw.engineVersion), scanCycleId: String(raw.scanCycleId),
    generatedAt: new Date(generatedMs).toISOString(), expiresAt: new Date(expiresMs).toISOString(), source: "COINBASE",
    boardStatus: raw.boardStatus, evaluatedAssetCount: nonnegativeInteger(raw.evaluatedAssetCount), qualifiedAssetCount: nonnegativeInteger(raw.qualifiedAssetCount),
    opportunities: accepted, scoringMode: boundedNullable(raw.scoringMode, 120), scoringNotice: boundedNullable(raw.scoringNotice, 1000),
    cacheState: boundedNullable(raw.cacheState, 40), staleState: Boolean(raw.staleState),
  };
  if (normalized.boardStatus === "ACTIVE" && expiresMs <= receivedAt.getTime()) normalized.boardStatus = "STALE";
  const boardHash = await sha256Hex(stableStringify(normalized));
  return { board: { ...normalized, boardHash }, rejectionCodes };
}

function validateRecord(record, board, seenIds) {
  if (!record || typeof record !== "object" || Array.isArray(record)) return reject("RECORD_NOT_OBJECT");
  if (!boundedText(record.opportunityId, 1, 128) || seenIds.has(record.opportunityId)) return reject("INVALID_OR_DUPLICATE_OPPORTUNITY_ID");
  if (record.scanCycleId !== board.scanCycleId) return reject("SCAN_CYCLE_MISMATCH");
  if (record.engineVersion !== board.engineVersion) return reject("ENGINE_VERSION_MISMATCH");
  const productId = String(record.productId || "").trim().toUpperCase();
  if (!PRODUCT_PATTERN.test(productId) || productId !== record.productId) return reject("INVALID_COINBASE_PRODUCT");
  if (record.venue !== "COINBASE") return reject("UNSUPPORTED_VENUE");
  if (!positive(record.referencePrice)) return reject("INVALID_REFERENCE_PRICE");
  const observedMs = dateValue(record.referencePriceObservedAt), generatedMs = dateValue(record.generatedAt), expiresMs = dateValue(record.expiresAt), boardExpiresMs = dateValue(board.expiresAt);
  if (observedMs === null || generatedMs === null) return reject("INVALID_REFERENCE_TIMESTAMP");
  if (expiresMs === null || expiresMs <= generatedMs || expiresMs > boardExpiresMs) return reject("INVALID_OPPORTUNITY_EXPIRY");
  if (!score(record.opportunityScore) || !score(record.confidence)) return reject("INVALID_SCORE");
  if (!Number.isInteger(record.rank) || record.rank < 1) return reject("INVALID_RANK");
  if (!TRADABILITY.has(record.tradability)) return reject("INVALID_TRADABILITY");
  if (!DIRECTIONS.has(record.marketDirection)) return reject("INVALID_MARKET_DIRECTION");
  if (!validSignals(record.signals)) return reject("INVALID_SIGNALS");
  if (!validRisks(record.riskFlags)) return reject("INVALID_RISK_FLAGS");
  seenIds.add(record.opportunityId);
  return { ok: true, value: {
    opportunityId: record.opportunityId, productId, venue: "COINBASE", rank: record.rank,
    opportunityScore: Number(record.opportunityScore), confidence: Number(record.confidence), referencePrice: Number(record.referencePrice),
    referencePriceObservedAt: new Date(observedMs).toISOString(), generatedAt: new Date(generatedMs).toISOString(), expiresAt: new Date(expiresMs).toISOString(),
    intendedHorizonSeconds: positiveInteger(record.intendedHorizonSeconds), tradability: record.tradability, marketDirection: record.marketDirection,
    signal: boundedNullable(record.signal, 80), signals: record.signals.map(normalizeSignal), riskFlags: record.riskFlags.map(normalizeRisk),
    qualified: record.qualified === true, engineVersion: record.engineVersion, scanCycleId: record.scanCycleId,
    scoringMode: boundedNullable(record.scoringMode, 120), upstreamIntelligence: boundedObject(record.upstreamIntelligence),
  }};
}

export function isExactCoinbaseUsdProduct(value) { return typeof value === "string" && PRODUCT_PATTERN.test(value); }
export function boardAuthorizesBuys(board, now = Date.now()) { return board?.boardStatus === "ACTIVE" && Date.parse(board.expiresAt) > now; }
export function findActiveOpportunity(board, opportunityId, productId, now = Date.now()) {
  if (!boardAuthorizesBuys(board, now)) return null;
  return board.opportunities.find(item => item.opportunityId === opportunityId && item.productId === productId && item.qualified && item.tradability === "TRADABLE" && Date.parse(item.expiresAt) > now) || null;
}
export async function finalizeResolvableBoard(board, assets, rejectionCodes = []) {
  const opportunities=[];const rejected=[...rejectionCodes];
  for(const item of board.opportunities){if(assets[item.productId])opportunities.push(item);else rejected.push({opportunityId:item.opportunityId,code:"QUOTE_PRODUCT_UNRESOLVED"});}
  if(board.boardStatus==="ACTIVE"&&board.opportunities.length>0&&opportunities.length===0)throw invalid("NO_RESOLVABLE_OPPORTUNITIES");
  const normalized={...board,opportunities};delete normalized.boardHash;
  return {board:{...normalized,boardHash:await sha256Hex(stableStringify(normalized))},rejectionCodes:rejected};
}
export function stableStringify(value) { if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`; if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`; return JSON.stringify(value); }

function validSignals(value) { return Array.isArray(value) && value.length <= 12 && value.every(item => item && boundedText(item.code,1,64) && Number.isFinite(Number(item.value)) && boundedText(item.unit,1,32) && Number.isInteger(item.windowSeconds) && item.windowSeconds > 0 && dateValue(item.observedAt) !== null); }
function validRisks(value) { return Array.isArray(value) && value.length <= 8 && value.every(item => item && boundedText(item.code,1,64) && SEVERITIES.has(item.severity) && boundedText(item.message,1,240)); }
function normalizeSignal(item) { return { code:item.code, value:Number(item.value), unit:item.unit, windowSeconds:item.windowSeconds, observedAt:new Date(Date.parse(item.observedAt)).toISOString() }; }
function normalizeRisk(item) { return { code:item.code, severity:item.severity, message:item.message }; }
function dateValue(value) { const parsed = Date.parse(String(value || "")); return Number.isFinite(parsed) ? parsed : null; }
function positive(value) { return Number.isFinite(Number(value)) && Number(value) > 0; }
function score(value) { return Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 100; }
function positiveInteger(value) { return Number.isInteger(value) && value > 0 ? value : null; }
function nonnegativeInteger(value) { return Number.isInteger(value) && value >= 0 ? value : 0; }
function boundedText(value,min,max) { return typeof value === "string" && value.length >= min && value.length <= max; }
function boundedNullable(value,max) { return boundedText(value,1,max) ? value : null; }
function boundedObject(value) { return value && typeof value === "object" && !Array.isArray(value) ? JSON.parse(JSON.stringify(value)) : {}; }
function reject(code) { return { ok:false, code }; }
function invalid(code) { return new ArenaError("INVALID_OPPORTUNITY_BOARD", code, 502); }
async function sha256Hex(value) { const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,"0")).join(""); }

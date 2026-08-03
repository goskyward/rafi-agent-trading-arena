export class ArenaError extends Error {
  constructor(code, message, status = 400) { super(`[ARENA:${code}:${status}] ${message}`); this.name = "ArenaError"; this.code = code; this.status = status; this.publicMessage = message; }
}

export const finite = value => Number.isFinite(value);
export const roundMoney = value => Math.round((value + Number.EPSILON) * 1e8) / 1e8;
export const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
export const iso = milliseconds => new Date(milliseconds).toISOString();

export function errorPayload(error) {
  if (error instanceof ArenaError) return { status: error.status, body: { ok: false, error: { code: error.code, message: error.publicMessage } } };
  const encoded = error instanceof Error ? error.message.match(/^\[ARENA:([A-Z0-9_]+):(\d{3})\]\s([\s\S]*)$/) : null;
  if (encoded) return { status: Number(encoded[2]), body: { ok: false, error: { code: encoded[1], message: encoded[3] } } };
  return { status: 500, body: { ok: false, error: { code: "INTERNAL_ERROR", message: "The Arena Worker could not complete the request." } } };
}

export async function readJson(request) {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > 32768) throw new ArenaError("INVALID_AMOUNT", "Request body is too large.", 413);
  try { return await request.json(); } catch { throw new ArenaError("INVALID_JSON", "Request body must be valid JSON."); }
}

export async function secureEqual(provided, expected) {
  if (!provided || !expected) return false;
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([crypto.subtle.digest("SHA-256", encoder.encode(provided)), crypto.subtle.digest("SHA-256", encoder.encode(expected))]);
  return crypto.subtle.timingSafeEqual(a, b);
}

export function assertFiniteTree(value, path = "response") {
  if (typeof value === "number" && !Number.isFinite(value)) throw new ArenaError("INTERNAL_ERROR", `Non-finite value at ${path}.`, 500);
  if (Array.isArray(value)) value.forEach((item, index) => assertFiniteTree(item, `${path}[${index}]`));
  else if (value && typeof value === "object") Object.entries(value).forEach(([key, item]) => assertFiniteTree(item, `${path}.${key}`));
  return value;
}

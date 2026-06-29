/**
 * Canonical API envelope used by every endpoint.
 *   success → { ok: true,  data }
 *   failure → { ok: false, error: { code, message, details? } }
 */
export function ok(data) {
  return { ok: true, data };
}

export function fail(code, message, details) {
  return { ok: false, error: { code, message, details } };
}

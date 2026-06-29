/**
 * Typed fetch client for the Express API.
 *
 * - Base URL comes from NEXT_PUBLIC_API_URL (defaults to http://localhost:4000).
 * - ALWAYS sends `credentials: 'include'` so the httpOnly auth cookie travels.
 * - Unwraps the `{ ok, data }` envelope and THROWS an `ApiError` on failure.
 */
const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/**
 * Bearer token auth — needed when the API is on a different domain than the site
 * (e.g. AWS Lambda), where cookies don't reliably travel. The token is stored in
 * localStorage and sent as `Authorization: Bearer <token>` on every request.
 * (The httpOnly cookie still works for same-origin/local setups.)
 */
const TOKEN_KEY = 'om_token';
let authToken = null;
if (typeof window !== 'undefined') {
  try {
    authToken = window.localStorage.getItem(TOKEN_KEY);
  } catch {
    authToken = null;
  }
}

export function setAuthToken(token) {
  authToken = token || null;
  if (typeof window === 'undefined') return;
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token);
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    // ignore storage failures (private mode, etc.)
  }
}

export function getAuthToken() {
  return authToken;
}

async function request(path, options = {}) {
  const { body, headers, ...rest } = options;

  const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;
  const init = {
    ...rest,
    // Auth is via the Bearer token header (not cookies), so we don't send
    // credentials — this keeps CORS simple and works across domains.
    headers: {
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      ...headers,
    },
  };

  if (body !== undefined && body !== null) {
    init.body = isFormData ? body : JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch(`${BASE_URL}/api${path}`, init);
  } catch (err) {
    throw new ApiError(0, 'NETWORK_ERROR', 'Could not reach the server. Is it running?', err);
  }

  let payload = null;
  try {
    payload = await res.json();
  } catch {
    // non-JSON response
  }

  if (!res.ok || (payload && payload.ok === false)) {
    const error = payload && payload.ok === false ? payload.error : undefined;
    throw new ApiError(
      res.status,
      error?.code ?? 'HTTP_ERROR',
      error?.message ?? res.statusText ?? 'Request failed',
      error?.details,
    );
  }

  if (payload && payload.ok === true) return payload.data;
  return undefined;
}

export const api = {
  get: (path, options) => request(path, { ...options, method: 'GET' }),
  post: (path, body, options) => request(path, { ...options, method: 'POST', body }),
  put: (path, body, options) => request(path, { ...options, method: 'PUT', body }),
  patch: (path, body, options) => request(path, { ...options, method: 'PATCH', body }),
  delete: (path, options) => request(path, { ...options, method: 'DELETE' }),
};

export const getHealth = () => api.get('/health');

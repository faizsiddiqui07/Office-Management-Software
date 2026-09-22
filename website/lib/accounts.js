/**
 * Several accounts on one device — the Gmail/Instagram switcher, for everyone.
 *
 * The API is Bearer-token auth (`om_token` in localStorage, sent on every request), so
 * "which account am I" is simply "which token is in `om_token`". This module keeps a LIST
 * of signed-in accounts and moves the active one's token into `om_token`; the server never
 * learns that one device holds two tokens, and every request is authorised as exactly one
 * user — there is no way to mix them up.
 *
 * Storage:
 *   om_accounts        JSON [{ id, name, email, roleLabel, avatarUrl, token, addedAt }]
 *   om_active_account  the `id` whose token is in om_token
 *   om_token           unchanged — lib/api.js reads only this
 *
 * One account is active at a time. Switching is a FULL reload (the caller does
 * `window.location.href = …`): react-query holds the old account's dashboard, badges,
 * notifications, chat list, points, … and clearing them one key at a time is how a
 * stale number leaks across; a reload is certain. The desktop preloader covers it.
 *
 * Per-account browser state gets the account id in its key (see `scopedKey`): the
 * sidebar's "seen" stamps and the owners' round-up "closed today" — otherwise looking at
 * Approvals in one account would clear the dot in the other. Device-level things (theme,
 * Lite mode, "push asked", birthday popup) stay shared: it is the same person.
 *
 * Push notifications reach the ACTIVE account only: a browser's push endpoint belongs to
 * one user server-side (PushSubscription.endpoint is unique), and lib/pwa.js re-registers
 * it under whoever is signed in on every launch. Same as Instagram/Twitter on the web.
 *
 * Trust: a second account's token sits in the same localStorage as the first — anyone
 * with the unlocked device can switch without a password, exactly as one account already
 * works. Signing out of an account drops its token; "Sign out of all" clears everything.
 */
const ACCOUNTS_KEY = 'om_accounts';
const ACTIVE_KEY = 'om_active_account';
const TOKEN_KEY = 'om_token'; // must match lib/api.js

const canStore = () => typeof window !== 'undefined' && !!window.localStorage;

function read() {
  if (!canStore()) return [];
  try {
    const raw = window.localStorage.getItem(ACCOUNTS_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((a) => a && a.id && a.token) : [];
  } catch {
    return [];
  }
}

function write(list) {
  if (!canStore()) return;
  try {
    if (list.length) window.localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(list));
    else window.localStorage.removeItem(ACCOUNTS_KEY);
  } catch {
    /* storage blocked — the switcher just won't remember; sign-in still works */
  }
}

function setActive(id, token) {
  if (!canStore()) return;
  try {
    if (id && token) {
      window.localStorage.setItem(ACTIVE_KEY, id);
      window.localStorage.setItem(TOKEN_KEY, token);
    } else {
      window.localStorage.removeItem(ACTIVE_KEY);
      window.localStorage.removeItem(TOKEN_KEY);
    }
  } catch {
    /* ignore */
  }
}

/**
 * The account THIS TAB is signed in as — set by AuthProvider once /bootstrap answers.
 * localStorage's om_active_account is the DEVICE's active account, and another tab can
 * switch it under us; per-account keys (scopedKey) must follow the tab's own identity,
 * otherwise a stale tab writes the other account's stamps.
 */
let currentId = '';
export function setCurrentAccountId(id) {
  currentId = id ? String(id) : '';
}

/** The account id to scope browser state under: this tab's, else the device's active. */
export function scopeId() {
  return currentId || activeAccountId();
}

/** The device's active account id, or ''. Safe to call anywhere (SSR → ''). */
export function activeAccountId() {
  if (!canStore()) return '';
  try {
    return window.localStorage.getItem(ACTIVE_KEY) || '';
  } catch {
    return '';
  }
}

/** What om_token holds right now — the DEVICE's current token, which another tab may
 *  have changed since this tab loaded (lib/api.js keeps its own in-memory copy). */
export function storedToken() {
  if (!canStore()) return null;
  try {
    return window.localStorage.getItem(TOKEN_KEY) || null;
  } catch {
    return null;
  }
}

/** The active account's token (what om_token holds), or null. */
export function activeToken() {
  const id = activeAccountId();
  return (id && read().find((a) => a.id === id)?.token) || null;
}

/** All remembered accounts WITHOUT their tokens — for rendering. Active first. */
export function listAccounts() {
  const active = activeAccountId();
  return read()
    .map(({ token, ...rest }) => ({ ...rest, active: rest.id === active }))
    .sort((a, b) => (a.active === b.active ? 0 : a.active ? -1 : 1));
}

/**
 * Record (or refresh) the signed-in account and make it the active one. Called after every
 * successful sign-in and every successful /bootstrap — so the name, photo and role in the
 * switcher stay current, and a token replaced after a password change is kept in step.
 * A device that signed in before the switcher existed gets its one account adopted here
 * (and its "seen" stamps moved under that account — see migrateLegacyKeys).
 */
export function rememberAccount(user, token) {
  if (!user?.id || !token) return;
  const id = String(user.id);
  const list = read();
  const entry = {
    id,
    name: user.name || '',
    email: user.email || '',
    roleLabel: user.roleLabel || '',
    avatarUrl: user.avatarUrl || '',
    token,
    addedAt: list.find((a) => a.id === id)?.addedAt || new Date().toISOString(),
  };
  const next = [...list.filter((a) => a.id !== id), entry];
  write(next);
  setActive(id, token);
  migrateLegacyKeys(id);
}

/** Make another remembered account the active one. Returns false if unknown. Caller reloads. */
export function switchAccount(id) {
  const acc = read().find((a) => a.id === id);
  if (!acc) return false;
  setActive(acc.id, acc.token);
  return true;
}

/**
 * Drop one account (its token is gone from this device). If it was the active one, the
 * most recently added remaining account becomes active — or, with none left, the device is
 * signed out. Returns the new active id, or '' when nothing is left.
 * `keepStamps`: leave the account's per-account browser state (seen dots, round-up closed)
 * in place — for a token that merely expired, so signing back in doesn't light every dot.
 * A chosen "Sign out" clears them.
 */
export function forgetAccount(id, { keepStamps = false } = {}) {
  const list = read();
  const rest = list.filter((a) => a.id !== id);
  write(rest);
  if (!keepStamps) clearScopedKeys(id);
  if (activeAccountId() !== id) return activeAccountId();
  const next = rest[rest.length - 1];
  setActive(next?.id, next?.token);
  return next?.id || '';
}

/**
 * Drop whichever account holds this token — for a 401. Keyed by TOKEN, not by "the active
 * account": a request sent with the previous token can come back 401 after the person has
 * already signed in to another account (react-query cancels the old fetch, but the HTTP
 * reply still arrives), and forgetting "the active one" then would wipe the new sign-in.
 * Returns the new active id ('' if nothing is left). No-op if no account has the token.
 */
export function forgetAccountByToken(token, opts) {
  const acc = token ? read().find((a) => a.token === token) : null;
  return acc ? forgetAccount(acc.id, opts) : activeAccountId();
}

/** Everything gone: every token, every per-account stamp. */
export function forgetAllAccounts() {
  read().forEach((a) => clearScopedKeys(a.id));
  write([]);
  setActive(null, null);
}

/**
 * Per-account key for browser-only state: `scopedKey('om_seen_todo')` →
 * `om_seen_todo@<accountId>`. With no active account (signed out, SSR) the plain key.
 */
export function scopedKey(base) {
  const id = scopeId();
  return id ? `${base}@${id}` : base;
}

// Keys that are per-account. Anything else in localStorage is device-level.
const SCOPED_PREFIXES = ['om_seen_', 'om_eod_seen'];

function isScopedBase(key) {
  return SCOPED_PREFIXES.some((p) => key.startsWith(p)) && !key.includes('@');
}

/** Old un-scoped stamps (from before the switcher) → this account's. Once per adoption. */
function migrateLegacyKeys(id) {
  if (!canStore()) return;
  try {
    const ls = window.localStorage;
    const legacy = [];
    for (let i = 0; i < ls.length; i += 1) {
      const k = ls.key(i);
      if (k && isScopedBase(k)) legacy.push(k);
    }
    for (const k of legacy) {
      const scoped = `${k}@${id}`;
      if (ls.getItem(scoped) == null) ls.setItem(scoped, ls.getItem(k));
      ls.removeItem(k);
    }
  } catch {
    /* ignore */
  }
}

function clearScopedKeys(id) {
  if (!canStore() || !id) return;
  try {
    const ls = window.localStorage;
    const gone = [];
    for (let i = 0; i < ls.length; i += 1) {
      const k = ls.key(i);
      if (k && k.endsWith(`@${id}`)) gone.push(k);
    }
    gone.forEach((k) => ls.removeItem(k));
  } catch {
    /* ignore */
  }
}

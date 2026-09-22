'use client';

import { createContext, useContext, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, setAuthToken, getAuthToken } from './api';
import { disablePush } from './pwa';
import { rememberAccount, forgetAccountByToken, forgetAllAccounts, switchAccount, activeToken, storedToken, setCurrentAccountId } from './accounts';

const AuthContext = createContext(null);

const ME_KEY = ['auth', 'me'];
/** The WebSocket ticket that rode along with bootstrap — chat-socket.js picks it up. */
export const WS_TICKET_KEY = ['chat', 'ws-ticket'];

/**
 * One request instead of eleven. GET /bootstrap returns who you are PLUS everything the
 * shell asks for the moment it mounts (settings, branding, badges, notifications, chat
 * unread, points, today's birthdays, unseen announcements, the owners' round-up, and a
 * WebSocket ticket) — each part in exactly the shape its own endpoint returns. We drop
 * each part into the cache under the key its hook uses, so the hooks find fresh data on
 * mount and skip their own fetch. Nothing else changes: polling, invalidation and every
 * later refetch still go to the individual endpoints.
 *
 * Why it matters: on Lambda one container serves one request at a time, so eleven
 * parallel requests on open meant up to eleven cold starts of 3–4 s each — that was the
 * morning "app takes forever to open". A part the server couldn't build comes back null
 * and is simply not seeded; its hook fetches as before.
 */
function seedFromBootstrap(queryClient, b) {
  const seed = (key, value) => {
    if (value != null) queryClient.setQueryData(key, value);
  };
  // Keys spelled out here (not imported) — lib/settings.js imports useAuth from this
  // file, and a two-way import between the two is the kind of thing that works until
  // the bundler decides otherwise. They must match SETTINGS_KEY / BRANDING_KEY there.
  seed(['settings'], b.settings);
  seed(['branding'], b.branding);
  seed(['badges'], b.badges);
  seed(['notifications'], b.notifications);
  seed(['chat', 'unread'], b.chatUnread);
  seed(['bonus', 'me', ''], b.bonusMe);
  seed(['announcements', 'active-unseen'], b.announcementsUnseen);
  // Day-keyed queries use the SERVER's date so a device whose clock disagrees just
  // fetches on its own rather than showing the wrong day's data.
  if (b.today) {
    seed(['holidays', 'today', b.today], b.holidaysToday);
    seed(['tasks', 'eod-digest', b.today], b.eodDigest);
  }
  if (b.wsTicket) seed(WS_TICKET_KEY, { ...b.wsTicket, fetchedAt: Date.now() });
}

export function AuthProvider({ children }) {
  const queryClient = useQueryClient();

  const { data: user, isLoading, isError } = useQuery({
    queryKey: ME_KEY,
    queryFn: async () => {
      // The token this request goes out with. A sign-in or switch can replace it while
      // the request is in flight; the answer then belongs to the OLD token and must not
      // touch the new account's state.
      const used = getAuthToken();
      try {
        const res = await api.get('/bootstrap');
        if (res?.user && getAuthToken() === used) {
          setCurrentAccountId(res.user.id); // this tab's identity, for per-account keys
          seedFromBootstrap(queryClient, res);
          // Keep the account switcher's entry for this account current (name, photo, role,
          // and the token — which a password change replaces). See lib/accounts.js.
          // Only while this tab's token is still the DEVICE's token: another tab may have
          // switched or signed this account out meanwhile, and re-persisting it here would
          // undo that (and flip om_token back under the other tab's feet).
          if (storedToken() === used) rememberAccount(res.user, used);
        }
        return res?.user ?? null;
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          // This token is dead (signed out elsewhere, password changed, account
          // deactivated). Drop THAT account from the switcher so it can't be picked
          // again. If another account is remembered it is now the active one — reload
          // into it, exactly as signing out does; otherwise fall through to /login.
          if (used && getAuthToken() === used) {
            // The token expired on its own — keep the account's seen-stamps so signing
            // back in doesn't light every dot; only a chosen Sign out clears them.
            const next = forgetAccountByToken(used, { keepStamps: true });
            if (next) {
              setAuthToken(activeToken());
              window.location.replace('/dashboard');
            } else {
              setAuthToken(null);
            }
          } else if (used) {
            forgetAccountByToken(used, { keepStamps: true });
          }
          return null;
        }
        throw err;
      }
    },
    // A real 401 is already turned into `null` above, so anything that throws here is a
    // network or server hiccup — very common when an installed Android app resumes on a
    // flaky connection. Without retries that single failure made `user` null and bounced
    // people to the login screen (or a half-loaded sidebar), which is why they had to
    // close and reopen several times before the app "came back". Retry instead.
    retry: (failureCount, err) => !(err instanceof ApiError && err.status === 401) && failureCount < 4,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });

  // Belt-and-suspenders for the same resume problem: React Query's focus refetch leans
  // on events that Android webviews fire unreliably. `visibilitychange` and `pageshow`
  // are the ones that DO fire when an installed app is brought back, so on resume we
  // nudge the two queries the sidebar depends on — who you are, and what's new.
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== 'visible') return;
      queryClient.invalidateQueries({ queryKey: ME_KEY });
      queryClient.invalidateQueries({ queryKey: ['badges'] });
    };
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('pageshow', refresh);
    return () => {
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('pageshow', refresh);
    };
  }, [queryClient]);

  const value = {
    user: user ?? null,
    isLoading,
    isError,
    refresh: () => queryClient.invalidateQueries({ queryKey: ME_KEY }),
    async login(email, password) {
      const res = await api.post('/auth/login', { email, password });
      if (res?.token) {
        setAuthToken(res.token); // store for cross-domain (Bearer) auth
        rememberAccount(res.user, res.token); // …and in the switcher, as the active one
      }
      await queryClient.invalidateQueries({ queryKey: ME_KEY });
      return res.user;
    },
    /**
     * Make another remembered account the active one. Resolves to true when the caller
     * should hard-reload (`window.location.href = '/dashboard'`) — a reload is the only
     * reliable way to drop every cached number of the account being left.
     */
    switchTo(id) {
      return switchAccount(id);
    },
    /**
     * Sign out of the active account only. Its token goes; if another account is
     * remembered it becomes active and the caller should reload into it — the result
     * says which: `{ next: '<id>' }` or `{ next: '' }` (nothing left → /login).
     * `{ all: true }` signs out of every account on this device.
     */
    async logout({ all = false } = {}) {
      // Hand back the push subscription BEFORE the token goes, while the request can
      // still be authenticated. A subscription belongs to whoever enabled it, so
      // without this the person who just signed out kept receiving this device's
      // notifications — their check-in reminders, dues, announcements — until somebody
      // else signed in and happened to claim the endpoint back.
      try {
        await disablePush();
      } catch {
        /* best-effort — never block signing out */
      }
      try {
        await api.post('/auth/logout');
      } catch {
        // Ignore network/API errors — we clear local state regardless so the
        // user is always signed out on the client.
      }
      // Forget the account THIS tab is signed in as (its token), not whatever
      // om_active_account says — another tab may have switched the device meanwhile.
      let next = '';
      if (all) forgetAllAccounts();
      else next = forgetAccountByToken(getAuthToken());
      // forgetAccount already put the next account's token in om_token (or cleared it);
      // the in-memory copy must agree so a stray request before the reload isn't sent
      // with the dead token.
      setAuthToken(next ? activeToken() : null);
      setCurrentAccountId('');
      queryClient.setQueryData(ME_KEY, null);
      queryClient.removeQueries({ queryKey: ME_KEY });
      return { next };
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}

export function useUser() {
  return useAuth().user;
}

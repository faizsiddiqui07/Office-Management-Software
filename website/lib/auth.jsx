'use client';

import { createContext, useContext, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, setAuthToken } from './api';
import { disablePush } from './pwa';

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
      try {
        const res = await api.get('/bootstrap');
        if (res?.user) seedFromBootstrap(queryClient, res);
        return res?.user ?? null;
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
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
      if (res?.token) setAuthToken(res.token); // store for cross-domain (Bearer) auth
      await queryClient.invalidateQueries({ queryKey: ME_KEY });
      return res.user;
    },
    async logout() {
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
      setAuthToken(null); // drop the Bearer token
      queryClient.setQueryData(ME_KEY, null);
      queryClient.removeQueries({ queryKey: ME_KEY });
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

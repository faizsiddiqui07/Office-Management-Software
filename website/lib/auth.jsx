'use client';

import { createContext, useContext, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, setAuthToken } from './api';

const AuthContext = createContext(null);

const ME_KEY = ['auth', 'me'];

export function AuthProvider({ children }) {
  const queryClient = useQueryClient();

  const { data: user, isLoading, isError } = useQuery({
    queryKey: ME_KEY,
    queryFn: async () => {
      try {
        const res = await api.get('/auth/me');
        return res.user ?? null;
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

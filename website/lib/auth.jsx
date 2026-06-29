'use client';

import { createContext, useContext } from 'react';
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
    retry: false,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });

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

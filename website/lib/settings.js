'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { useAuth } from './auth';

// Both keys are also written by lib/auth.jsx (seeded from GET /bootstrap) — keep in sync.
export const SETTINGS_KEY = ['settings'];

/**
 * Live company settings, shared across the app (company name, currency, work
 * window, etc.).
 *
 * Only asked for once someone is signed in: the endpoint is a 401 otherwise (the login
 * page used to fire it anyway and eat the error), and by the time `user` is known,
 * /bootstrap has already put the settings in the cache — so on app open this hook
 * never sends a request of its own. Refetches (stale, focus, invalidate) still do.
 */
export function useSettings() {
  const { user } = useAuth();
  return useQuery({
    queryKey: SETTINGS_KEY,
    queryFn: () => api.get('/settings'),
    select: (d) => d?.settings ?? null,
    enabled: !!user,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
}

export const BRANDING_KEY = ['branding'];

/**
 * PUBLIC branding (company name + light/dark logo + brand colour). Works without
 * login, so the login page and the <Brand /> mark can show the right logo even
 * when unauthenticated.
 */
export function usePublicBranding() {
  // Wait for the sign-in check first. Signed in → /bootstrap already seeded this key
  // and nothing is sent; signed out (login page) → fetched as before, a beat later.
  // Without this it raced /bootstrap on every app open — one more cold container.
  const { isLoading } = useAuth();
  return useQuery({
    queryKey: BRANDING_KEY,
    queryFn: () => api.get('/settings/branding'),
    select: (d) => d?.branding ?? null,
    enabled: !isLoading,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
}

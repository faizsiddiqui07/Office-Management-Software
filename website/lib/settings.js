'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export const SETTINGS_KEY = ['settings'];

/**
 * Live company settings, shared across the app (company name, currency, work
 * window, etc.). Falls back silently when unauthenticated (e.g. login screen).
 */
export function useSettings() {
  return useQuery({
    queryKey: SETTINGS_KEY,
    queryFn: () => api.get('/settings'),
    select: (d) => d?.settings ?? null,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
}

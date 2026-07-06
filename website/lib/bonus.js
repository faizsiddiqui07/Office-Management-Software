'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

/** The signed-in user's own points this month (header badge + rewards page). */
export function useMyBonus() {
  return useQuery({
    queryKey: ['bonus', 'me'],
    queryFn: () => api.get('/bonus/me'),
    staleTime: 60 * 1000,
  });
}

/** The public "price list" — what each action is worth + ₹/point. */
export function useBonusGuide() {
  return useQuery({
    queryKey: ['bonus', 'guide'],
    queryFn: () => api.get('/bonus/guide'),
    staleTime: 5 * 60 * 1000,
  });
}

/** Full editable config (leadership only). */
export function useBonusConfig(enabled = true) {
  return useQuery({
    queryKey: ['bonus', 'config'],
    queryFn: () => api.get('/bonus/config'),
    enabled,
  });
}

/** Per-user totals for a month (leadership only). */
export function useBonusLeaderboard(enabled = true) {
  return useQuery({
    queryKey: ['bonus', 'leaderboard'],
    queryFn: () => api.get('/bonus/leaderboard'),
    enabled,
    select: (res) => res.rows ?? [],
  });
}

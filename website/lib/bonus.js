'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

/**
 * The signed-in user's own points.
 *
 * `params` (optional):
 *   - {month: 'YYYY-MM'} → that single month
 *   - {from: 'YYYY-MM', to: 'YYYY-MM'} → inclusive range (e.g. a financial year)
 *   - nothing → current month (default; matches the header badge)
 *
 * Period is in the queryKey so switching months/years never serves stale cache.
 */
export function useMyBonus(params) {
  const q = new URLSearchParams();
  if (params?.month) q.set('month', params.month);
  if (params?.from) q.set('from', params.from);
  if (params?.to) q.set('to', params.to);
  const qs = q.toString();
  return useQuery({
    queryKey: ['bonus', 'me', qs],
    queryFn: () => api.get(`/bonus/me${qs ? `?${qs}` : ''}`),
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

/**
 * Everyone's totals for a period (leadership only). Takes the same `params` shape as
 * useMyBonus — {month} or {from, to} — so the board follows whatever period the page is
 * showing instead of being stuck on the current month.
 */
export function useBonusLeaderboard(params, enabled = true) {
  const q = new URLSearchParams();
  if (params?.month) q.set('month', params.month);
  if (params?.from) q.set('from', params.from);
  if (params?.to) q.set('to', params.to);
  const qs = q.toString();
  return useQuery({
    queryKey: ['bonus', 'leaderboard', qs],
    queryFn: () => api.get(`/bonus/leaderboard${qs ? `?${qs}` : ''}`),
    enabled,
    select: (res) => res.rows ?? [],
  });
}

/** Recent manual awards (leadership only) — for review + owner-only undo. */
export function useRecentAwards(enabled = true) {
  return useQuery({
    queryKey: ['bonus', 'awards'],
    queryFn: () => api.get('/bonus/awards'),
    enabled,
    select: (res) => res.awards ?? [],
  });
}

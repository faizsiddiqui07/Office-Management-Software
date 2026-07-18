'use client';

import * as React from 'react';
import { usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

/**
 * Sidebar dots. The server says when something last turned up in each section that
 * needs this person; the browser remembers when they last opened it. Newer than that
 * → a dot. Opening the section clears it, which is the whole rule: the dot only says
 * "there's something here you haven't looked at", nothing more.
 *
 * "Last opened" is stored per device, so it's a nudge on the phone you actually use.
 */
const SEEN_PREFIX = 'om_seen_';

/** Nav href → the key the API reports under. */
export const BADGE_BY_HREF = {
  '/todo': 'todo',
  '/leaves': 'leaves',
  '/attendance': 'attendance',
  '/announcements': 'announcements',
};

/** The Corrections tab inside Attendance clears separately from the page itself. */
export const CORRECTIONS_KEY = 'attendance:corrections';

const ALL_KEYS = [...Object.values(BADGE_BY_HREF), CORRECTIONS_KEY];

// A tiny shared store so every sidebar (desktop + mobile) and tab reacts to the same
// state — component-local state would drift between them.
const listeners = new Set();
let cache = null;

function snapshot() {
  if (cache) return cache;
  const out = {};
  try {
    for (const k of ALL_KEYS) out[k] = window.localStorage.getItem(SEEN_PREFIX + k) || '';
  } catch {
    // storage blocked — everything reads as "never opened", which is a safe default
  }
  cache = out;
  return cache;
}

const EMPTY = {};
const serverSnapshot = () => EMPTY;

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function markSeen(key) {
  const now = new Date().toISOString();
  try {
    window.localStorage.setItem(SEEN_PREFIX + key, now);
  } catch {
    // ignore — the in-memory copy below still hides the dot for this session
  }
  cache = { ...snapshot(), [key]: now };
  listeners.forEach((l) => l());
}

// One shared empty object. Returning a fresh `{}` while the request is in flight
// would give every render a new identity, so any effect depending on it would re-run
// forever.
const NO_BADGES = {};

/** Latest "something happened here" timestamp per section. */
export function useBadges() {
  const { data } = useQuery({
    queryKey: ['badges'],
    queryFn: () => api.get('/badges'),
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
  return data ?? NO_BADGES;
}

/** `isNew(key, latestAt)` → has something arrived since this section was last opened? */
export function useSeen() {
  const seen = React.useSyncExternalStore(subscribe, snapshot, serverSnapshot);

  const isNew = React.useCallback(
    (key, latestAt) => {
      if (!latestAt) return false;
      const last = seen[key];
      return !last || new Date(latestAt) > new Date(last);
    },
    [seen],
  );

  return { isNew, markSeen };
}

/**
 * What the sidebars use: `hasDot(href)`, plus it quietly marks the section you're
 * currently on as seen — including when fresh data lands while you're sitting there.
 */
export function useNavBadges() {
  const pathname = usePathname();
  const badges = useBadges();
  const { isNew } = useSeen();

  React.useEffect(() => {
    const href = Object.keys(BADGE_BY_HREF).find((h) => pathname === h || pathname.startsWith(`${h}/`));
    if (!href) return;
    const key = BADGE_BY_HREF[href];
    // Only write when there's genuinely something unseen. Marking on every pass would
    // notify the store, re-render, and run this again — the write has to settle.
    if (isNew(key, badges[key])) markSeen(key);
  }, [pathname, badges, isNew]);

  return React.useCallback(
    (href) => {
      const key = BADGE_BY_HREF[href];
      return key ? isNew(key, badges[key]) : false;
    },
    [badges, isNew],
  );
}

'use client';

import * as React from 'react';
import { RefreshCw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

const RUNNING_BUILD = process.env.NEXT_PUBLIC_BUILD_ID || 'dev';
const CHECK_EVERY_MS = 5 * 60 * 1000;

/**
 * Tells people when a newer version of the app is live, instead of hoping the browser
 * noticed. An installed app that's been sitting in the background can happily keep
 * running yesterday's code — and a cached page can serve it even after a reload — so
 * the app asks the server what's deployed and compares it with what it's running.
 *
 * Checked when the app is opened or brought back to the front, and every few minutes
 * while it's in use. Nothing reloads on its own: someone mid-way through a form would
 * lose it, so the choice stays with them.
 */
export function UpdatePrompt() {
  const [newBuild, setNewBuild] = React.useState(null);
  const dismissed = React.useRef(new Set());

  React.useEffect(() => {
    let stopped = false;

    // `skipWhenHidden` guards the polling only — the check on open must always run.
    // Some embedded/installed views report themselves as hidden at that moment, and
    // that's exactly when we most want to know a newer version is waiting.
    const check = async ({ skipWhenHidden = true } = {}) => {
      if (stopped || (skipWhenHidden && document.visibilityState === 'hidden')) return;
      try {
        const res = await fetch('/api/version', { cache: 'no-store' });
        if (!res.ok) return;
        const { buildId } = await res.json();
        if (!buildId || buildId === RUNNING_BUILD || dismissed.current.has(buildId)) return;
        setNewBuild(buildId);
      } catch {
        // offline or the check failed — try again next time, never bother the user
      }
    };

    check({ skipWhenHidden: false });
    const timer = setInterval(() => check(), CHECK_EVERY_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') check();
    };
    const onFocus = () => check();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onFocus);

    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  if (!newBuild) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-[60] flex justify-center p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <div className="glass glass-highlight flex w-full max-w-md items-center gap-3 rounded-2xl p-3 shadow-lg ring-1 ring-border/60">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/15">
          <RefreshCw className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">A new version is available</p>
          <p className="text-xs text-muted-foreground">Reload to get the latest updates.</p>
        </div>
        <Button size="sm" onClick={() => window.location.reload()}>
          Update
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 shrink-0"
          aria-label="Not now"
          onClick={() => {
            dismissed.current.add(newBuild);
            setNewBuild(null);
          }}
        >
          <X className="size-4" />
        </Button>
      </div>
    </div>
  );
}

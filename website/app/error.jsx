'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { Home, RotateCcw, TriangleAlert } from 'lucide-react';

export default function GlobalError({ error, reset }) {
  useEffect(() => {
    // Surface in the console for debugging; never shown raw to the user.
    console.error(error);
  }, [error]);

  return (
    <main className="relative grid min-h-dvh place-items-center overflow-hidden p-6">
      <div className="pointer-events-none absolute -top-32 left-1/2 size-[36rem] -translate-x-1/2 rounded-full bg-destructive/20 blur-3xl" />
      <div className="glass glass-highlight relative w-full max-w-md rounded-3xl p-10 text-center">
        <span className="mx-auto mb-6 flex size-14 items-center justify-center rounded-2xl bg-destructive/12 text-destructive ring-1 ring-destructive/20">
          <TriangleAlert className="size-7" />
        </span>
        <p className="text-6xl font-semibold tracking-tight tabular-nums">500</p>
        <h1 className="mt-3 text-lg font-semibold">Something went wrong</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          An unexpected error occurred. You can try again or head back to your dashboard.
        </p>
        <div className="mt-7 flex items-center justify-center gap-2.5">
          <button
            type="button"
            onClick={() => reset()}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground ring-1 ring-primary/30 transition-colors hover:bg-primary/90"
          >
            <RotateCcw className="size-4" /> Try again
          </button>
          <Link
            href="/dashboard"
            className="glass inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium ring-1 ring-border transition-colors hover:bg-muted/40"
          >
            <Home className="size-4" /> Dashboard
          </Link>
        </div>
      </div>
    </main>
  );
}

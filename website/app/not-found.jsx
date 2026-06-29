import Link from 'next/link';
import { Compass, Home } from 'lucide-react';

export default function NotFound() {
  return (
    <main className="relative grid min-h-dvh place-items-center overflow-hidden p-6">
      <div className="pointer-events-none absolute -top-32 left-1/2 size-[36rem] -translate-x-1/2 rounded-full bg-primary/20 blur-3xl" />
      <div className="glass glass-highlight relative w-full max-w-md rounded-3xl p-10 text-center">
        <span className="mx-auto mb-6 flex size-14 items-center justify-center rounded-2xl bg-primary/12 text-primary ring-1 ring-primary/20">
          <Compass className="size-7" />
        </span>
        <p className="text-6xl font-semibold tracking-tight tabular-nums">404</p>
        <h1 className="mt-3 text-lg font-semibold">Page not found</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you’re looking for doesn’t exist or may have moved.
        </p>
        <Link
          href="/dashboard"
          className="mt-7 inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground ring-1 ring-primary/30 transition-colors hover:bg-primary/90"
        >
          <Home className="size-4" /> Back to dashboard
        </Link>
      </div>
    </main>
  );
}

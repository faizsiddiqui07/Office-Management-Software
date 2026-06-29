'use client';

import * as React from 'react';
import { RotateCw } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/utils';

/**
 * Refreshes ONLY the current page's data — re-fetches the active React Query
 * caches (exactly what the mounted page shows). No full-page reload, so scroll
 * position and the rest of the app state are preserved.
 */
export function RefreshButton() {
  const qc = useQueryClient();
  const [spinning, setSpinning] = React.useState(false);

  const refresh = async () => {
    if (spinning) return;
    setSpinning(true);
    try {
      await qc.invalidateQueries();
    } finally {
      setSpinning(false);
    }
  };

  return (
    <button
      type="button"
      onClick={refresh}
      aria-label="Refresh this page"
      title="Refresh this page"
      className="inline-flex size-8 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
    >
      <RotateCw className={cn('size-4 transition-transform', spinning && 'animate-spin')} />
    </button>
  );
}

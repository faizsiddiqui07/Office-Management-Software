'use client';

import Link from 'next/link';
import { Award } from 'lucide-react';
import { useMyBonus } from '@/lib/bonus';

/** Header chip with the user's reward points this month. Hidden until leadership
 *  turns the bonus system on. Tapping it opens the Rewards page. */
export function PointsBadge() {
  const { data } = useMyBonus();
  if (!data?.enabled) return null;
  const pts = data.points ?? 0;
  return (
    <Link
      href="/rewards"
      aria-label={`${pts} reward points this month`}
      className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border/60 bg-foreground/[0.04] px-2.5 text-sm font-medium transition-colors hover:bg-foreground/[0.08]"
    >
      <Award className="size-4 text-amber-500" />
      <span className="tabular-nums">{pts}</span>
      <span className="hidden text-xs text-muted-foreground sm:inline">pts</span>
    </Link>
  );
}

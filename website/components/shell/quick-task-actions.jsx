'use client';

import Link from 'next/link';
import { ClipboardList, ListTodo } from 'lucide-react';
import { useAuth } from '@/lib/auth';

/**
 * "My tasks" and "Assigned tasks", parked under the header on EVERY page.
 *
 * Two shortcuts INTO the To-Do page, not two ways to create work: wherever somebody is,
 * the question they interrupt themselves with is "what's on me?" or "what did I hand
 * out?". Creating a task is a deliberate act that belongs on the To-Do page itself, which
 * is where "Add task" and "Assign work" live.
 *
 * Each link carries what the destination should do with it:
 *   ?tab=mine     — open My tasks
 *   ?tab=assigned — open Assigned by me, and `view=all` opens it as one flat list rather
 *                   than a folder per person, because "what have I handed out" is the
 *                   question this button is asking
 *   ?jump=1       — scroll down past the stat cards to the list, which on a phone is
 *                   otherwise below the fold, so the tab switch would happen off screen
 * The board applies those and strips them from the URL (the same way it consumes ?task=).
 * That stripping is what makes a SECOND tap work: the URL returns to a plain ?tab=…, so
 * tapping again is a real navigation instead of a no-op link to where you already are.
 *
 * `sticky`, never `fixed`: every /(app) page is wrapped in a framer-motion opacity
 * animation (app/(app)/template.jsx), and its will-change becomes a containing block
 * mid-navigation — a fixed child would jump on every route change. top-[4.25rem] tucks the
 * bar a few pixels behind the header card's bottom edge so no seam of scrolling content
 * shows through the gap, exactly as the expenses filter bar already does. z-20 keeps it
 * under the header (z-30) and well under dialogs (z-50).
 *
 * Phone and tablet only (`lg:hidden`): lg is exactly the breakpoint where the sidebar
 * appears, so from a laptop up the navigation is already on screen and this bar would only
 * eat vertical space.
 *
 * Deliberately colourless. The bar sits directly under the header and is on every single
 * page — a filled button there would pull the eye away from whatever page you actually
 * opened. It reads as part of the glass surface it rides on, and the page's own primary
 * action keeps the only strong colour on screen.
 */

const linkClass =
  'inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl border border-border/60 '
  + 'bg-foreground/[0.04] px-3 text-sm font-medium transition-colors hover:bg-foreground/[0.08] '
  + 'active:translate-y-px';

export function QuickTaskActions() {
  const { user } = useAuth();
  // Same per-person delegation setting the To-Do page gates its "Assigned by me" tab on —
  // someone who cannot delegate has no such tab, so the shortcut would land them nowhere.
  const ta = user?.taskAssign || {};
  const canAssign = ta.mode === 'ALL' || (ta.mode === 'SELECTED' && (ta.users || []).length > 0);

  return (
    <div className="sticky top-[4.25rem] z-20 px-4 pt-2 sm:px-6 lg:hidden">
      <div className="glass glass-highlight flex items-center gap-2 rounded-2xl px-2.5 py-2">
        <Link href="/todo?tab=mine&jump=1" className={linkClass}>
          <ListTodo className="size-4" /> My tasks
        </Link>
        {canAssign ? (
          <Link href="/todo?tab=assigned&view=all&jump=1" className={linkClass}>
            <ClipboardList className="size-4" /> Assigned tasks
          </Link>
        ) : null}
      </div>
    </div>
  );
}

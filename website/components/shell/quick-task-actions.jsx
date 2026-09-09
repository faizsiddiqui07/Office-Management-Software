'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ClipboardList, ListTodo } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';

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
 * Coloured everywhere EXCEPT the To-Do page — they keep the same two colours the
 * Add task / Assign work buttons wear, so the pairing stays familiar. On /todo itself
 * they go plain glass: the page's own Add task and Assign work are right there in the
 * same colours, and two coloured pairs stacked on one screen would compete for the eye
 * and read as four equally important actions when only two of them create anything.
 */

const baseClass =
  'inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl border '
  + 'border-transparent px-3 text-sm font-medium transition-colors active:translate-y-px';

// Plain glass, for the To-Do page.
const glassClass = 'border-border/60 bg-foreground/[0.04] hover:bg-foreground/[0.08]';

export function QuickTaskActions() {
  const { user } = useAuth();
  // On the To-Do page these two are shortcuts to content already on screen, so they step
  // back and let that page's own coloured actions lead.
  const onTodo = usePathname() === '/todo';
  // Same per-person delegation setting the To-Do page gates its "Assigned by me" tab on —
  // someone who cannot delegate has no such tab, so the shortcut would land them nowhere.
  const ta = user?.taskAssign || {};
  const canAssign = ta.mode === 'ALL' || (ta.mode === 'SELECTED' && (ta.users || []).length > 0);

  return (
    <div className="sticky top-[4.25rem] z-20 px-4 pt-2 sm:px-6 lg:hidden">
      <div className="glass glass-highlight flex items-center gap-2 rounded-2xl px-2.5 py-2">
        <Link
          href="/todo?tab=mine&jump=1"
          className={cn(baseClass, onTodo ? glassClass : 'bg-primary text-primary-foreground hover:bg-primary/80')}
        >
          <ListTodo className="size-4" /> My tasks
        </Link>
        {canAssign ? (
          <Link
            href="/todo?tab=assigned&view=all&jump=1"
            className={cn(baseClass, onTodo ? glassClass : 'bg-warning text-warning-foreground hover:bg-warning/90')}
          >
            <ClipboardList className="size-4" /> Assigned tasks
          </Link>
        ) : null}
      </div>
    </div>
  );
}

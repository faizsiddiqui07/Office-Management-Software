'use client';

import { useAuth } from '@/lib/auth';
import { TaskDialog } from '@/components/tasks/task-dialog';
import { AssignDialog } from '@/components/tasks/assign-dialog';

/**
 * "Add task" and "Assign work", parked under the header on EVERY page.
 *
 * Adding work is the thing people do most, and from wherever they happen to be — so the
 * two actions follow the header instead of living only on the To-Do page. It rides just
 * below the header card and stays there as the page scrolls, so it is always one tap away.
 *
 * `sticky`, never `fixed`: every /(app) page is wrapped in a framer-motion opacity
 * animation (app/(app)/template.jsx), and its will-change becomes a containing block
 * mid-navigation — a fixed child would jump on every route change. top-[4.25rem] tucks the
 * bar a few pixels behind the header card's bottom edge so no seam of scrolling content
 * shows through the gap, exactly as the expenses filter bar already does. z-20 keeps it
 * under the header (z-30) and well under dialogs (z-50) — including the very dialogs these
 * buttons open.
 *
 * Phone and tablet only (`lg:hidden`): lg is exactly the breakpoint where the sidebar
 * appears, so from a laptop up the navigation is already on screen and this bar would only
 * eat vertical space.
 *
 * "Assign work" is gated on the same per-person delegation setting the To-Do page uses, so
 * someone who cannot delegate simply gets a single, full-width "Add task".
 */
export function QuickTaskActions() {
  const { user } = useAuth();
  const ta = user?.taskAssign || {};
  const canAssign = ta.mode === 'ALL' || (ta.mode === 'SELECTED' && (ta.users || []).length > 0);

  return (
    <div className="sticky top-[4.25rem] z-20 px-4 pt-2 sm:px-6 lg:hidden">
      <div className="glass glass-highlight flex items-center gap-2 rounded-2xl px-2.5 py-2">
        <TaskDialog />
        {canAssign ? <AssignDialog /> : null}
      </div>
    </div>
  );
}

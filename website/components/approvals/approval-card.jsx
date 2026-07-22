'use client';

import * as React from 'react';
import { Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

/** How long something has been waiting — the thing that decides what to do first. */
export function waitingFor(since) {
  if (!since) return '';
  const days = Math.floor((Date.now() - new Date(since).getTime()) / 86400000);
  if (days >= 1) return `waiting ${days} day${days === 1 ? '' : 's'}`;
  const hours = Math.floor((Date.now() - new Date(since).getTime()) / 3600000);
  if (hours >= 1) return `waiting ${hours}h`;
  return 'just now';
}

/**
 * One thing waiting on a decision.
 *
 * Approve is one tap. Rejecting opens a note field first — turning something down
 * without saying why is how a person ends up asking three people what happened.
 */
export function ApprovalCard({ title, subtitle, meta, waiting, children, onApprove, onReject, busy, rejectLabel = 'Reject', requireReason = true }) {
  const [rejecting, setRejecting] = React.useState(false);
  const [reason, setReason] = React.useState('');

  return (
    <div className="rounded-xl bg-card/60 p-4 ring-1 ring-border/60">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        {/* break-words throughout: a task title or reason is free text somebody typed,
            and one long unbroken run (a URL, a file name) would otherwise push the card
            wider than the phone and scroll the whole page sideways. */}
        <div className="min-w-0 flex-1">
          <p className="font-medium leading-snug break-words">{title}</p>
          {subtitle ? <p className="mt-0.5 break-words text-sm text-muted-foreground">{subtitle}</p> : null}
        </div>
        {waiting ? <span className="shrink-0 text-xs text-muted-foreground">{waiting}</span> : null}
      </div>

      {meta?.length ? (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {meta.filter(Boolean).map((m) => (
            <span key={m}>{m}</span>
          ))}
        </div>
      ) : null}

      {children}

      {rejecting ? (
        <div className="mt-3 space-y-2">
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why? The person will see this."
            className="min-h-[4.5rem] bg-background/50 text-sm"
            autoFocus
          />
          <div className="flex flex-wrap gap-2">
            <Button
              variant="destructive"
              disabled={busy || (requireReason && !reason.trim())}
              onClick={() => onReject(reason.trim())}
            >
              <X className="size-4" /> {rejectLabel}
            </Button>
            <Button variant="ghost" onClick={() => { setRejecting(false); setReason(''); }} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button onClick={onApprove} disabled={busy}>
            <Check className="size-4" /> Approve
          </Button>
          <Button variant="outline" onClick={() => setRejecting(true)} disabled={busy}>
            <X className="size-4" /> {rejectLabel}
          </Button>
        </div>
      )}
    </div>
  );
}

/** A section heading with its own pending count. */
export function SectionHead({ icon: Icon, title, count, hint }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-1">
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <h2 className="font-semibold tracking-tight">{title}</h2>
      <span
        className={cn(
          'rounded-full px-2 py-0.5 text-xs font-semibold',
          count ? 'bg-primary/12 text-primary' : 'bg-muted/60 text-muted-foreground',
        )}
      >
        {count}
      </span>
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </div>
  );
}

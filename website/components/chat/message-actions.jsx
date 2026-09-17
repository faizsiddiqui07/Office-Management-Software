'use client';

import * as React from 'react';
import { CornerUpLeft, Copy, Trash2, X, Users, User } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';

/**
 * Message par der tak dabaane (ya right-click) se khulne wala menu — WhatsApp jaisa.
 *
 * Phone par ye neeche se sheet ban kar aata hai, desktop par chhota card (ui/dialog khud
 * ye farak karta hai). Do padaav:
 *   1. Reply · Copy · Delete · Cancel
 *   2. Delete dabane par: Delete for everyone (sirf apne message par) · Delete for me · Cancel
 *
 * "Delete for everyone" sirf tab dikhta hai jab message mera ho aur pehle se hataya na
 * gaya ho — server bhi yahi niyam lagata hai, ye sirf button chhupata hai.
 */
function Row({ icon: Icon, label, hint, danger, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm transition-colors',
        'hover:bg-foreground/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
        danger ? 'text-destructive' : 'text-foreground',
      )}
    >
      <Icon className="size-4 shrink-0 opacity-80" />
      <span className="min-w-0 flex-1">
        <span className="block font-medium">{label}</span>
        {hint ? <span className="block text-xs text-muted-foreground">{hint}</span> : null}
      </span>
    </button>
  );
}

export function MessageActions({ target, onClose, onReply, onCopy, onDelete }) {
  const [step, setStep] = React.useState('main');
  const msg = target;

  // Naya message chuna → pehle padaav se; desktop ka hover-Delete seedha delete padaav
  // par kholta hai (`_step`), taaki wahan ek click faltu na lage.
  React.useEffect(() => { if (msg) setStep(msg._step === 'delete' ? 'delete' : 'main'); }, [msg]);

  const run = (fn) => () => { onClose(); fn?.(msg); };

  return (
    <Dialog open={!!msg} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent showCloseButton={false} className="gap-1 p-2 sm:max-w-xs sm:p-2">
        <DialogTitle className="sr-only">Message options</DialogTitle>
        {msg && step === 'delete' ? (
          <>
            <p className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Delete message?
            </p>
            {msg.mine && !msg.deleted ? (
              <Row
                icon={Users}
                label="Delete for everyone"
                hint="Removed from both sides"
                danger
                onClick={run((m) => onDelete(m, 'everyone'))}
              />
            ) : null}
            <Row
              icon={User}
              label="Delete for me"
              hint="Only hidden from your view"
              danger
              onClick={run((m) => onDelete(m, 'me'))}
            />
            <Row icon={X} label="Cancel" onClick={onClose} />
          </>
        ) : msg ? (
          <>
            {!msg.deleted ? <Row icon={CornerUpLeft} label="Reply" onClick={run(onReply)} /> : null}
            {msg.text ? <Row icon={Copy} label="Copy" onClick={run(onCopy)} /> : null}
            <Row icon={Trash2} label="Delete" danger onClick={() => setStep('delete')} />
            <Row icon={X} label="Cancel" onClick={onClose} />
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

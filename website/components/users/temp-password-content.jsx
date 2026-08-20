'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { Check, Copy, KeyRound, MailCheck, MailWarning } from 'lucide-react';
import { Button } from '@/components/ui/button';

function Field({ label, value, className }) {
  return (
    <div className={`min-w-0 ${className ?? ''}`}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="truncate text-sm font-medium">{value}</p>
    </div>
  );
}

export function TempPasswordContent({ user, temporaryPassword, emailed }) {
  const [copied, setCopied] = React.useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(temporaryPassword);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('Copy failed — select and copy manually');
    }
  };

  return (
    <div className="space-y-3 py-2">
      <div className="space-y-3 rounded-2xl border border-success/30 bg-success/10 p-4">
        <div className="flex items-center gap-2 text-sm font-medium text-success">
          <KeyRound className="size-4" /> One-time credentials
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Name" value={user.name} />
          <Field label="Employee ID" value={user.employeeId} />
          <Field label="Email" value={user.email} className="col-span-2" />
        </div>
        <div>
          <p className="mb-1 text-xs text-muted-foreground">Temporary password</p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg bg-background/60 px-3 py-2 font-mono text-sm">{temporaryPassword}</code>
            <Button type="button" variant="outline" size="sm" onClick={copy}>
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
        </div>
      </div>

      {/* Whether the same details just went out by email. On success the admin needn't
          copy anything; on failure (or no SMTP) they still have the password above. */}
      {emailed?.delivered ? (
        <div className="flex items-start gap-2 rounded-xl bg-success/10 p-3 text-sm text-success ring-1 ring-success/20">
          <MailCheck className="mt-0.5 size-4 shrink-0" />
          <span>Emailed to <span className="font-medium">{emailed.to || user.email}</span> — ID, temporary password, role and joining date.</span>
        </div>
      ) : (
        <div className="flex items-start gap-2 rounded-xl bg-amber-500/10 p-3 text-sm text-amber-700 ring-1 ring-amber-500/20 dark:text-amber-300">
          <MailWarning className="mt-0.5 size-4 shrink-0" />
          <span>
            {emailed?.reason === 'error'
              ? 'Couldn’t send the email (check the email settings in Settings) — share the details above with the employee yourself.'
              : 'Not emailed (email isn’t set up in Settings) — share the details above with the employee yourself.'}
          </span>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Share this securely with the employee. It won&apos;t be shown again — they&apos;ll be asked to change it on first login.
      </p>
    </div>
  );
}

'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { Check, Copy, KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/button';

function Field({ label, value, className }) {
  return (
    <div className={className}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="truncate text-sm font-medium">{value}</p>
    </div>
  );
}

export function TempPasswordContent({ user, temporaryPassword }) {
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
            <code className="flex-1 truncate rounded-lg bg-background/60 px-3 py-2 font-mono text-sm">{temporaryPassword}</code>
            <Button type="button" variant="outline" size="sm" onClick={copy}>
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Share this securely with the employee. It won&apos;t be shown again — they&apos;ll be asked to change it on first login.
      </p>
    </div>
  );
}

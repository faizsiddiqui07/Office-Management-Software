'use client';

import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Award, Loader2, Plus, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useBonusConfig } from '@/lib/bonus';
import { GlassPanel } from '@/components/glass/glass-panel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

const rand = () => Math.random().toString(36).slice(2, 10);

/** A labelled number input for a point value. */
function NumField({ label, hint, value, onChange, min = 0 }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Input type="number" min={min} value={value} onChange={(e) => onChange(e.target.value)} className="bg-background/50" />
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function BonusSettings() {
  const qc = useQueryClient();
  const { data: cfg, isLoading } = useBonusConfig();
  const [form, setForm] = React.useState(null);

  React.useEffect(() => {
    if (cfg) {
      setForm({
        enabled: !!cfg.enabled,
        rupeesPerPoint: cfg.rupeesPerPoint ?? 0,
        graceDays: cfg.graceDays ?? 1,
        assignedTaskOnTime: cfg.assignedTaskOnTime ?? 0,
        assignedTaskLatePenalty: cfg.assignedTaskLatePenalty ?? 0,
        punctualStreakDays: cfg.punctualStreakDays ?? 10,
        punctualStreakPoints: cfg.punctualStreakPoints ?? 0,
        manualItems: (cfg.manualItems ?? []).map((m) => ({ ...m })),
      });
    }
  }, [cfg]);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const saveMut = useMutation({
    mutationFn: () => api.patch('/bonus/config', form),
    onSuccess: () => {
      toast.success('Bonus settings saved');
      qc.invalidateQueries({ queryKey: ['bonus'] });
    },
    onError: (e) => toast.error(e?.message || 'Could not save'),
  });

  if (isLoading || !form) {
    return (
      <GlassPanel className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Loading bonus settings…
      </GlassPanel>
    );
  }

  const addItem = () => set({ manualItems: [...form.manualItems, { id: rand(), label: '', points: 0 }] });
  const updItem = (i, patch) => set({ manualItems: form.manualItems.map((m, j) => (j === i ? { ...m, ...patch } : m)) });
  const delItem = (i) => set({ manualItems: form.manualItems.filter((_, j) => j !== i) });

  return (
    <GlassPanel className="space-y-5 p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/15">
            <Award className="size-5" />
          </span>
          <div>
            <h2 className="font-semibold tracking-tight">Bonus &amp; rewards</h2>
            <p className="text-sm text-muted-foreground">Set what each thing is worth. Points reset every month; the team sees this as a guide.</p>
          </div>
        </div>
        <Switch checked={form.enabled} onCheckedChange={(v) => set({ enabled: v })} />
      </div>

      {form.enabled ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <NumField label="₹ per point" hint="1 point equals this many rupees" value={form.rupeesPerPoint} onChange={(v) => set({ rupeesPerPoint: v })} />
            <NumField label="Grace days for tasks" hint="Extra days after a task's due date before it counts late" value={form.graceDays} onChange={(v) => set({ graceDays: v })} />
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-semibold">Automatic points <span className="font-normal text-muted-foreground">(0 turns a rule off)</span></h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <NumField label="Assigned task done on time" hint="Only tasks someone assigns — not self-made ones" value={form.assignedTaskOnTime} onChange={(v) => set({ assignedTaskOnTime: v })} />
              <NumField label="Assigned task done late (penalty)" hint="Deducted when finished after the grace days" value={form.assignedTaskLatePenalty} onChange={(v) => set({ assignedTaskLatePenalty: v })} />
              <NumField label="Punctual streak — days" hint="Consecutive on-time days needed" min={1} value={form.punctualStreakDays} onChange={(v) => set({ punctualStreakDays: v })} />
              <NumField label="Punctual streak — points" hint="Earned each time the streak is hit" value={form.punctualStreakPoints} onChange={(v) => set({ punctualStreakPoints: v })} />
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Manual rewards &amp; penalties</h3>
              <Button variant="outline" size="sm" onClick={addItem}><Plus className="size-4" /> Add</Button>
            </div>
            <p className="text-xs text-muted-foreground">Custom things you award by hand (e.g. “Client appreciation”, “Policy violation”). Points can be negative for a penalty.</p>
            {form.manualItems.length ? (
              <div className="space-y-2">
                {form.manualItems.map((m, i) => (
                  <div key={m.id || i} className="flex items-center gap-2">
                    <Input value={m.label} onChange={(e) => updItem(i, { label: e.target.value })} placeholder="What is it for?" className="flex-1 bg-background/50" />
                    <Input type="number" value={m.points} onChange={(e) => updItem(i, { points: Number(e.target.value) })} placeholder="pts" className="w-24 bg-background/50" />
                    <Button variant="ghost" size="icon" className="size-9 shrink-0 text-destructive" onClick={() => delItem(i)} aria-label="Remove"><Trash2 className="size-4" /></Button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="rounded-lg bg-foreground/[0.03] px-3 py-3 text-sm text-muted-foreground ring-1 ring-border/50">No manual items yet — add one above.</p>
            )}
          </div>
        </>
      ) : (
        <p className="rounded-lg bg-foreground/[0.03] px-3 py-3 text-sm text-muted-foreground ring-1 ring-border/50">
          The bonus system is off. Turn it on to set point values — nobody sees points until then.
        </p>
      )}

      <div className="flex justify-end">
        <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending} className="h-10">
          {saveMut.isPending ? <Loader2 className="size-4 animate-spin" /> : null} Save bonus settings
        </Button>
      </div>
    </GlassPanel>
  );
}

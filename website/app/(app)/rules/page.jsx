'use client';

import * as React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Award, BookOpen, Cake, CalendarClock, CalendarDays, Clock, Home, ListTodo,
  Megaphone, Pencil, Plus, ShieldCheck, Trash2, Users, Wallet,
} from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth';
import { PageHeader } from '@/components/glass/page-header';
import { EmptyState } from '@/components/glass/empty-state';
import { LoadingState } from '@/components/glass/skeletons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

/** Icons a section can carry — names stored in the DB, rendered from this map only. */
const ICON_MAP = {
  ListTodo, CalendarClock, Clock, CalendarDays, Home, Cake, Award,
  BookOpen, Wallet, ShieldCheck, Users, Megaphone,
};
const ICON_OPTIONS = Object.keys(ICON_MAP);

const iconOf = (name) => ICON_MAP[name] || BookOpen;

/** Add/rename a section — title + icon. */
function SectionDialog({ open, onOpenChange, section, onSave, saving }) {
  const [title, setTitle] = React.useState('');
  const [icon, setIcon] = React.useState('BookOpen');
  React.useEffect(() => {
    if (open) {
      setTitle(section?.title || '');
      setIcon(section?.icon && ICON_MAP[section.icon] ? section.icon : 'BookOpen');
    }
  }, [open, section]);
  const Icon = iconOf(icon);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{section ? 'Rename section' : 'New section'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="rs-title">Section title</Label>
            <Input id="rs-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Dress Code" maxLength={80} />
          </div>
          <div className="space-y-1.5">
            <Label>Icon</Label>
            <Select value={icon} onValueChange={setIcon}>
              <SelectTrigger className="bg-background/50">
                <span className="flex items-center gap-2"><Icon className="size-4" /> {icon}</span>
              </SelectTrigger>
              <SelectContent>
                {ICON_OPTIONS.map((name) => {
                  const I = ICON_MAP[name];
                  return (
                    <SelectItem key={name} value={name}>
                      <span className="flex items-center gap-2"><I className="size-4" /> {name}</span>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => onSave({ title: title.trim(), icon })} disabled={!title.trim() || saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Write/edit one rule — plain text plus the live-placeholder helper. */
function RuleDialog({ open, onOpenChange, rule, tokens, onSave, saving }) {
  const [text, setText] = React.useState('');
  React.useEffect(() => {
    if (open) setText(rule?.raw || '');
  }, [open, rule]);
  const insert = (token) => {
    setText((t) => `${t}${t && !t.endsWith(' ') ? ' ' : ''}{${token}}`);
    document.getElementById('r-text')?.focus();
  };
  const tokenEntries = Object.entries(tokens || {}).filter(([k]) => k !== 'graceNote' && k !== 'overtimeAfterNote');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{rule ? 'Edit rule' : 'Add a rule'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="r-text">Rule</Label>
            <Textarea id="r-text" value={text} onChange={(e) => setText(e.target.value)} rows={4} maxLength={600} placeholder="Write the rule in simple words…" className="bg-background/50" />
          </div>
          {tokenEntries.length ? (
            <div className="rounded-xl bg-foreground/[0.03] p-3 ring-1 ring-border/50">
              <p className="text-xs font-medium text-foreground/80">Live values — tap to insert. These update by themselves when Settings change:</p>
              <div className="mt-2 flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
                {tokenEntries.map(([k, v]) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => insert(k)}
                    className="rounded-full bg-background/70 px-2 py-0.5 text-[11px] tabular-nums text-muted-foreground ring-1 ring-border/60 transition-colors hover:text-foreground"
                  >
                    {`{${k}}`} = {String(v)}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => onSave(text.trim())} disabled={!text.trim() || saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function RulesPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['rules'], queryFn: () => api.get('/rules'), staleTime: 60 * 1000 });
  const sections = data?.sections ?? [];
  const canManage = !!data?.canManage && !!user?.isOwner;
  const tokens = data?.tokens ?? {};

  // Quick-nav: one chip per section, smooth-scrolls to it (scroll-mt clears the topbar).
  const refs = React.useRef({});
  const jumpTo = (id) => refs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  // Dialog state
  const [sectionDialog, setSectionDialog] = React.useState(null); // {section?} | null
  const [ruleDialog, setRuleDialog] = React.useState(null); // {sectionId, rule?} | null
  const [confirmDelete, setConfirmDelete] = React.useState(null); // section | null

  const invalidate = () => qc.invalidateQueries({ queryKey: ['rules'] });
  const saveSection = useMutation({
    mutationFn: ({ id, body }) => (id ? api.patch(`/rules/sections/${id}`, body) : api.post('/rules/sections', body)),
    onSuccess: () => { toast.success('Saved'); setSectionDialog(null); invalidate(); },
    onError: (e) => toast.error(e?.message || 'Could not save'),
  });
  const deleteSection = useMutation({
    mutationFn: (id) => api.delete(`/rules/sections/${id}`),
    onSuccess: () => { toast.success('Section removed'); setConfirmDelete(null); invalidate(); },
    onError: (e) => toast.error(e?.message || 'Could not remove'),
  });
  const saveRule = useMutation({
    mutationFn: ({ sectionId, ruleId, text }) =>
      ruleId ? api.patch(`/rules/sections/${sectionId}/rules/${ruleId}`, { text }) : api.post(`/rules/sections/${sectionId}/rules`, { text }),
    onSuccess: () => { toast.success('Saved'); setRuleDialog(null); invalidate(); },
    onError: (e) => toast.error(e?.message || 'Could not save'),
  });
  const deleteRule = useMutation({
    mutationFn: ({ sectionId, ruleId }) => api.delete(`/rules/sections/${sectionId}/rules/${ruleId}`),
    onSuccess: () => { toast.success('Rule removed'); invalidate(); },
    onError: (e) => toast.error(e?.message || 'Could not remove'),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Office"
        title="Rules & Regulations"
        icon={BookOpen}
        description="How the office runs — timings, tasks, leaves, overtime and points, section by section. Every timing and point value shown here is live: it follows YOUR shift and the current Settings."
        actions={
          canManage ? (
            <Button onClick={() => setSectionDialog({})}>
              <Plus className="size-4" /> Add section
            </Button>
          ) : null
        }
      />

      {isLoading ? (
        <LoadingState />
      ) : !sections.length ? (
        <EmptyState icon={BookOpen} title="No rules yet" description={canManage ? 'Add the first section to start the rule book.' : 'Leadership hasn’t published the rule book yet.'} />
      ) : (
        <>
          {/* Jump chips — find your section instead of scrolling a wall of text. */}
          <div className="flex flex-wrap gap-2">
            {sections.map((s) => {
              const Icon = iconOf(s.icon);
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => jumpTo(s.id)}
                  className="inline-flex items-center gap-1.5 rounded-full bg-card/60 px-3 py-1.5 text-xs font-medium text-muted-foreground ring-1 ring-border/60 transition-colors hover:text-foreground"
                >
                  <Icon className="size-3.5" /> {s.title}
                </button>
              );
            })}
          </div>

          <div className="space-y-4">
            {sections.map((s) => {
              const Icon = iconOf(s.icon);
              return (
                <section
                  key={s.id}
                  ref={(el) => { refs.current[s.id] = el; }}
                  className="scroll-mt-24 overflow-hidden rounded-2xl border border-border/60 bg-card/50 shadow-sm ring-1 ring-white/5"
                >
                  <header className="flex items-center gap-2.5 border-b border-border/50 bg-foreground/[0.04] px-4 py-3">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary ring-1 ring-primary/15">
                      <Icon className="size-4" />
                    </span>
                    <h2 className="text-base font-semibold tracking-tight">{s.title}</h2>
                    <span className="ml-auto shrink-0 text-xs font-medium text-muted-foreground">
                      {s.rules.length} rule{s.rules.length === 1 ? '' : 's'}
                    </span>
                    {canManage ? (
                      <span className="flex shrink-0 items-center gap-0.5">
                        <Button variant="ghost" size="icon" className="size-8" onClick={() => setSectionDialog({ section: s })} aria-label="Rename section">
                          <Pencil className="size-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="size-8 text-destructive" onClick={() => setConfirmDelete(s)} aria-label="Delete section">
                          <Trash2 className="size-3.5" />
                        </Button>
                      </span>
                    ) : null}
                  </header>
                  <div className="p-3 sm:p-4">
                    {s.rules.length ? (
                      <ol className="space-y-2.5">
                        {s.rules.map((r, i) => (
                          <li key={r.id} className="flex items-start gap-3">
                            <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold tabular-nums text-primary">
                              {i + 1}
                            </span>
                            <p className="min-w-0 flex-1 text-sm leading-relaxed">{r.text}</p>
                            {canManage ? (
                              <span className="flex shrink-0 items-center gap-0.5">
                                <Button variant="ghost" size="icon" className="size-7" onClick={() => setRuleDialog({ sectionId: s.id, rule: r })} aria-label="Edit rule">
                                  <Pencil className="size-3.5" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="size-7 text-destructive"
                                  onClick={() => deleteRule.mutate({ sectionId: s.id, ruleId: r.id })}
                                  disabled={deleteRule.isPending}
                                  aria-label="Delete rule"
                                >
                                  <Trash2 className="size-3.5" />
                                </Button>
                              </span>
                            ) : null}
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <p className="py-2 text-center text-sm text-muted-foreground">No rules in this section yet.</p>
                    )}
                    {canManage ? (
                      <div className={cn('flex justify-start', s.rules.length ? 'mt-3' : 'mt-1')}>
                        <Button variant="outline" size="sm" onClick={() => setRuleDialog({ sectionId: s.id })}>
                          <Plus className="size-4" /> Add rule
                        </Button>
                      </div>
                    ) : null}
                  </div>
                </section>
              );
            })}
          </div>
        </>
      )}

      {/* ── Dialogs ── */}
      <SectionDialog
        open={!!sectionDialog}
        onOpenChange={(o) => (!o ? setSectionDialog(null) : null)}
        section={sectionDialog?.section || null}
        saving={saveSection.isPending}
        onSave={(body) => saveSection.mutate({ id: sectionDialog?.section?.id, body })}
      />
      <RuleDialog
        open={!!ruleDialog}
        onOpenChange={(o) => (!o ? setRuleDialog(null) : null)}
        rule={ruleDialog?.rule || null}
        tokens={tokens}
        saving={saveRule.isPending}
        onSave={(text) => saveRule.mutate({ sectionId: ruleDialog.sectionId, ruleId: ruleDialog?.rule?.id, text })}
      />
      <Dialog open={!!confirmDelete} onOpenChange={(o) => (!o ? setConfirmDelete(null) : null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete “{confirmDelete?.title}”?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This removes the whole section and its {confirmDelete?.rules?.length ?? 0} rule{(confirmDelete?.rules?.length ?? 0) === 1 ? '' : 's'}. It can’t be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => deleteSection.mutate(confirmDelete.id)} disabled={deleteSection.isPending}>
              {deleteSection.isPending ? 'Deleting…' : 'Delete section'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

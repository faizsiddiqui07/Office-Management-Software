'use client';

import * as React from 'react';
import { Plus, Search, Users, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAudiencePeople } from '@/lib/use-audience';

/** How many names are drawn at once. Past this, narrowing by typing beats scrolling. */
const MAX_ROWS = 50;

const initials = (name) =>
  String(name || '')
    .split(' ')
    .filter(Boolean)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

/**
 * Who an announcement goes to: whole teams, or named people.
 *
 * The two selections are held SEPARATELY and both are kept while the dialog is open, so
 * switching the dropdown to look at the other option and switching back does not quietly
 * throw away what was already picked. Only the one the mode points at is sent.
 *
 * The people list is fetched once and filtered here rather than queried per keystroke: at
 * fifteen people either approach works, and at five hundred one small download beats a
 * request on every letter.
 *
 * Picking somebody MOVES them out of the list and into the chips above; removing their chip
 * puts them back. The list is derived from the selection rather than held beside it, so the
 * two can never disagree, and what is left in it is always exactly who can still be added.
 */
export function AudiencePicker({ mode, onModeChange, roles, onRolesChange, people, onPeopleChange, roleOptions = [] }) {
  const isIndividual = mode === 'INDIVIDUAL';
  const { data: directory = [], isPending, isError } = useAudiencePeople(isIndividual);
  const [q, setQ] = React.useState('');

  const picked = React.useMemo(() => new Set(people), [people]);
  const pickedPeople = React.useMemo(
    () => directory.filter((p) => picked.has(p.id)),
    [directory, picked],
  );

  // Somebody already picked leaves the list — they are in the chips above instead, so the
  // list only ever shows who is still available to add. Removing their chip puts them back,
  // because this is derived from the selection rather than held separately.
  const matches = React.useMemo(() => {
    const needle = q.trim().toLowerCase();
    const left = directory.filter((p) => !picked.has(p.id));
    if (!needle) return left;
    return left.filter(
      (p) => p.name.toLowerCase().includes(needle)
        || (p.designation || '').toLowerCase().includes(needle)
        || (p.roleLabel || '').toLowerCase().includes(needle),
    );
  }, [directory, q, picked]);
  const shown = matches.slice(0, MAX_ROWS);
  const allPicked = !matches.length && directory.length > 0 && picked.size === directory.length;

  const togglePerson = (id) => {
    onPeopleChange(picked.has(id) ? people.filter((x) => x !== id) : [...people, id]);
  };
  const toggleRole = (key) => {
    onRolesChange(roles.includes(key) ? roles.filter((x) => x !== key) : [...roles, key]);
  };

  // What the post will actually do, in a sentence — the one thing somebody needs to be sure
  // of before they press Post.
  const summary = isIndividual
    ? people.length
      ? `Goes to ${people.length} ${people.length === 1 ? 'person' : 'people'}. No one else sees it.`
      : 'Pick the people this should go to. Only they see it in the feed, and only they are notified.'
    : roles.length
      ? `Goes to ${roles.length === 1
        ? roleOptions.find((r) => r.key === roles[0])?.label || '1 team'
        : `${roles.length} teams`}.`
      : 'No team picked — this goes to everyone in the office.';

  return (
    <div className="space-y-2">
      <Label htmlFor="an-audience-mode">Audience</Label>
      <Select value={mode} onValueChange={onModeChange}>
        <SelectTrigger id="an-audience-mode" className="w-full bg-background/50"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="TEAM">Teams</SelectItem>
          <SelectItem value="INDIVIDUAL">Individual people</SelectItem>
        </SelectContent>
      </Select>

      {!isIndividual ? (
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          {roleOptions.map((r) => (
            <button
              key={r.key}
              type="button"
              onClick={() => toggleRole(r.key)}
              className={cn(
                'rounded-full px-2.5 py-1 text-xs font-medium ring-1 transition-colors',
                roles.includes(r.key)
                  ? 'bg-primary/12 text-primary ring-primary/25'
                  : 'bg-muted/40 text-muted-foreground ring-border hover:text-foreground',
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
      ) : (
        <div className="space-y-2 rounded-xl bg-foreground/[0.03] p-2.5 ring-1 ring-border/50">
          {/* Chosen people sit ABOVE the search box so they stay in view while hunting for
              the next one, and each carries its own remove button. */}
          {pickedPeople.length ? (
            <div className="flex flex-wrap gap-1.5">
              {pickedPeople.map((p) => (
                <span
                  key={p.id}
                  className="inline-flex items-center gap-1 rounded-full bg-primary/12 py-1 pl-2.5 pr-1 text-xs font-medium text-primary ring-1 ring-primary/25"
                >
                  {p.name}
                  <button
                    type="button"
                    aria-label={`Remove ${p.name}`}
                    onClick={() => togglePerson(p.id)}
                    className="rounded-full p-0.5 transition-colors hover:bg-primary/20"
                  >
                    <X className="size-3" />
                  </button>
                </span>
              ))}
              <button
                type="button"
                onClick={() => onPeopleChange([])}
                className="px-1 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              >
                Clear all
              </button>
            </div>
          ) : null}

          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by name…"
              className="bg-background/50 pl-9"
              aria-label="Search people"
            />
          </div>

          <div className="max-h-56 overflow-y-auto rounded-lg">
            {isPending ? (
              <p className="px-3 py-6 text-center text-xs text-muted-foreground">Loading people…</p>
            ) : isError ? (
              <p className="px-3 py-6 text-center text-xs text-destructive">Couldn’t load the list. Close and open this again.</p>
            ) : !shown.length ? (
              <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                {allPicked
                  ? 'Everyone is picked.'
                  : q.trim()
                    ? `No one left matching “${q.trim()}”.`
                    : 'No one left to add.'}
              </p>
            ) : (
              <ul className="space-y-0.5">
                {shown.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => togglePerson(p.id)}
                      className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-foreground/[0.06]"
                    >
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[0.65rem] font-semibold text-primary">
                        {initials(p.name)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">{p.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {p.designation || p.roleLabel}
                        </span>
                      </span>
                      <Plus className="size-4 shrink-0 text-muted-foreground" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {matches.length > MAX_ROWS ? (
            <p className="text-center text-xs text-muted-foreground">
              Showing {MAX_ROWS} of {matches.length} — type to narrow it down.
            </p>
          ) : null}
        </div>
      )}

      <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
        <Users className="mt-px size-3.5 shrink-0" />
        {summary}
      </p>
    </div>
  );
}

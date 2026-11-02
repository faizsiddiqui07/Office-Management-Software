'use client';

import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CalendarClock, Plus, Repeat, X } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { AppDialog } from '@/components/glass/app-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NoteEditor } from '@/components/ui/note-editor';
import { TimePicker } from '@/components/ui/time-picker';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useRoleOptions } from '@/lib/use-roles';
import { AudiencePicker } from '@/components/announcements/audience-picker';
import { PRIORITY_OPTIONS, RECURRENCE_OPTIONS, WEEKDAYS, MONTHS, MAX_RULE_DATES, describeRecurrence, formatDay, companyInstant, companyParts } from '@/lib/announcement';
import { DatePicker } from '@/components/ui/date-picker';
import { companyYMD } from '@/lib/time';

// A FACTORY, not a shared constant. `setRecur(EMPTY_RULE)` handed out the very same object
// and `{ ...EMPTY_RULE }` is a shallow copy that shares its arrays — one in-place `.sort()`
// or `.push()` would dirty the module for the rest of the session. (Array.prototype.sort
// sorts in place, and this dialog needs sorted lists, so that is the natural mistake.)
const emptyRule = () => ({ type: 'NONE', weekday: null, weekdays: [], dayOfMonth: null, daysOfMonth: [], month: null, dates: [], time: '09:00' });
const DAYS_1_31 = Array.from({ length: 31 }, (_, i) => i + 1);
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

const nums = (list) => [...new Set(list)].sort((a, b) => a - b);

/**
 * An announcement's rule as this dialog holds it: lists, always, with an older post's
 * single day read into its list.
 *
 * Shape matters beyond rendering. The save below compares JSON of the before and after, so
 * a key that is present one way and absent the other reports "recurrence changed" on an
 * edit that only touched the title — and that lands in the activity log.
 */
const hydrateRule = (rc) => {
  const r = { ...emptyRule(), ...(rc?.type ? rc : {}) };
  r.weekdays = r.weekdays?.length ? nums(r.weekdays) : (r.type === 'WEEKLY' && r.weekday != null ? [r.weekday] : []);
  r.daysOfMonth = r.daysOfMonth?.length ? nums(r.daysOfMonth) : ((r.type === 'MONTHLY' || r.type === 'YEARLY') && r.dayOfMonth != null ? [r.dayOfMonth] : []);
  // Dates that have gone by are KEPT — they are the post's own record, and dropping them
  // here would make every save look like somebody had removed them.
  r.dates = Array.isArray(r.dates) ? [...r.dates].sort() : [];
  return r;
};

/** Only the fields the chosen type uses, in ONE fixed key order — see hydrateRule. */
const rulePayload = (recur) => {
  const out = { type: recur.type, time: recur.time || '09:00' };
  if (recur.type === 'WEEKLY') out.weekdays = nums(recur.weekdays || []);
  if (recur.type === 'MONTHLY') out.daysOfMonth = nums(recur.daysOfMonth || []);
  if (recur.type === 'YEARLY') { out.month = recur.month; out.daysOfMonth = nums(recur.daysOfMonth || []); }
  if (recur.type === 'DATES') out.dates = [...new Set(recur.dates || [])].sort();
  return out;
};

export function CreateAnnouncementDialog({ announcement, open: openProp, onOpenChange }) {
  const isEdit = !!announcement;
  const qc = useQueryClient();
  const [openInternal, setOpenInternal] = React.useState(false);
  const open = openProp !== undefined ? openProp : openInternal;
  const setOpen = onOpenChange || setOpenInternal;

  const [title, setTitle] = React.useState('');
  const [body, setBody] = React.useState('');
  const [priority, setPriority] = React.useState('NORMAL');
  // The audience is one choice made two ways. Both lists live here side by side and both
  // survive a switch of the dropdown, so glancing at the other option and coming back does
  // not throw away what was already picked; only the one the mode points at is sent.
  const [audienceMode, setAudienceMode] = React.useState('TEAM');
  const [audience, setAudience] = React.useState([]); // roles — empty = everyone
  const [audienceUsers, setAudienceUsers] = React.useState([]); // named people
  // Repeats: every week / month / year, at a time (company timezone). The server owns
  // when it actually goes out — this only collects the rule.
  const [recur, setRecur] = React.useState(emptyRule);
  // Hold back until a chosen moment. Empty date = goes out as soon as it is posted, which is
  // what every announcement did before this existed.
  const [schedYMD, setSchedYMD] = React.useState('');
  const [schedTime, setSchedTime] = React.useState('09:00');
  const { data: roleOptions = [] } = useRoleOptions();
  const setRule = (patch) => setRecur((r) => ({ ...r, ...patch }));
  // Every list change is worked out INSIDE the updater, from the state react hands us.
  // Building it from `recur` in the closure and passing it to setRule loses the first of
  // two quick taps, and tapping several dates in a row is the whole point of this control.
  const toggleDay = (key, n) => setRecur((r) => {
    const had = (r[key] || []).includes(n);
    return { ...r, [key]: nums(had ? (r[key] || []).filter((x) => x !== n) : [...(r[key] || []), n]) };
  });
  const addDate = (ymd) => { if (ymd) setRecur((r) => ({ ...r, dates: [...new Set([...(r.dates || []), ymd])].sort() })); };
  const removeDate = (ymd) => setRecur((r) => ({ ...r, dates: (r.dates || []).filter((d) => d !== ymd) }));
  // Switching type clears the day fields the OLD type used. Without this, a 15 left over
  // from "every year" makes the monthly summary read "Every month on the 15th" under an
  // empty grid — the two fields no longer being shared is exactly what allows that.
  const setType = (type) => setRecur((r) => ({
    ...r,
    type,
    weekday: null,
    dayOfMonth: null,
    weekdays: type === 'WEEKLY' ? r.weekdays : [],
    daysOfMonth: type === 'MONTHLY' || type === 'YEARLY' ? r.daysOfMonth : [],
    month: type === 'YEARLY' ? r.month : null,
    dates: type === 'DATES' ? r.dates : [],
  }));
  // A type this copy of the app has never heard of — a newer one, on a phone still running
  // a cached build. Editing it blind would rewrite the rule into something it isn't.
  const unknownType = isEdit && !!announcement.recurrence?.type && !RECURRENCE_OPTIONS.some((o) => o.value === announcement.recurrence.type);
  const todayCompany = companyYMD(new Date());

  React.useEffect(() => {
    if (open && isEdit) {
      setTitle(announcement.title || '');
      setBody(announcement.body || '');
      setPriority(announcement.priority || 'NORMAL');
      setAudience(announcement.audienceRoles || []);
      // Mode is DERIVED, never stored on the post — one less field that could disagree with
      // the lists it describes.
      setAudienceUsers((announcement.audienceUsers || []).map(String));
      setAudienceMode(announcement.audienceUsers?.length ? 'INDIVIDUAL' : 'TEAM');
      // An older post has no recurrence at all — read that as "doesn't repeat".
      setRecur(hydrateRule(announcement.recurrence));
      // A repeating post's publishAt was DERIVED from its own rule — nobody chose it. Filling
      // the "send later" box from it showed a date the post had never been given, and then
      // switching to "Doesn't repeat" left the screen reading "nobody sees it or is notified
      // until 5 Nov" while the post went out to the whole office that second.
      const derived = !!announcement.recurrence?.type && announcement.recurrence.type !== 'NONE';
      const at = companyParts(derived ? null : announcement.publishAt);
      setSchedYMD(at.ymd);
      setSchedTime(at.hhmm || '09:00');
    }
    if (open && !isEdit) {
      setTitle('');
      setBody('');
      setPriority('NORMAL');
      setAudience([]);
      setAudienceUsers([]);
      setAudienceMode('TEAM');
      setRecur(emptyRule());
      setSchedYMD('');
      setSchedTime('09:00');
    }
  }, [open, isEdit, announcement]);

  const mut = useMutation({
    mutationFn: () => {
      // Only the fields the chosen type uses — the server drops the rest anyway, but a
      // clean payload is easier to read in the activity log. One helper builds this and the
      // `before` below, so their key order cannot drift (the comparison is on JSON).
      const recurrence = rulePayload(recur);
      // Only the half the mode points at travels as a selection; the other goes as empty,
      // which is what tells the server to drop it. Sending both keys is deliberate — the
      // server treats an ABSENT key as "leave it alone", so a one-word title fix cannot wipe
      // the audience, and a real switch cannot leave the old list behind.
      const individual = audienceMode === 'INDIVIDUAL';
      const payload = {
        title,
        body,
        priority,
        audienceRoles: individual ? [] : audience,
        audienceUsers: individual ? audienceUsers : [],
        recurrence,
        // publishAt is sent ONLY for a post that does not repeat. A repeating post's first
        // outing comes from its OWN rule, which the server works out — so there is nothing
        // to send, and sending `null` was not harmless: the server applied it, the post lost
        // both its publishAt and its notifiedAt, and it never rang again. Fixing a typo
        // before the first outing was enough to do it.
        ...(recur.type === 'NONE' ? { publishAt: schedYMD ? companyInstant(schedYMD, schedTime) : null } : {}),
      };
      if (!isEdit) return api.post('/announcements', payload);
      // On edit, send only what actually changed. The activity log records the field
      // names, and "changed title, body, priority, audience, recurrence" on every save
      // — including a one-word title fix — would make that record worthless.
      const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
      const before = {
        title: announcement.title || '',
        body: announcement.body || '',
        priority: announcement.priority || 'NORMAL',
        audienceRoles: announcement.audienceRoles || [],
        audienceUsers: (announcement.audienceUsers || []).map(String),
        publishAt: announcement.publishAt ? new Date(announcement.publishAt).toISOString() : null,
        // Through the SAME two helpers the payload uses, so the only thing being compared is
        // the content. Hand-writing this shape beside the other one is how a one-word title
        // fix starts claiming "changed recurrence" — the comparison is JSON, so an extra key
        // or a different key order reads as a different rule.
        recurrence: rulePayload(hydrateRule(announcement.recurrence)),
      };
      const diff = {};
      for (const k of Object.keys(payload)) if (!same(payload[k], before[k])) diff[k] = payload[k];
      return api.put(`/announcements/${announcement.id}`, diff);
    },
    onSuccess: () => {
      toast.success(isEdit ? 'Announcement updated' : 'Announcement posted');
      qc.invalidateQueries({ queryKey: ['announcements'] });
      setOpen(false);
    },
    onError: (e) => toast.error(e?.message || 'Could not save announcement'),
  });

  const submit = () => {
    if (!title.trim()) return toast.error('Add a title');
    // The same three checks the server makes, so a half-filled rule is caught here with
    // a plain message instead of coming back as a validation error.
    if (unknownType) return toast.error('This post uses a newer repeat option — refresh the app to edit it');
    if (recur.type === 'WEEKLY' && !recur.weekdays?.length) return toast.error('Pick at least one day of the week it repeats on');
    if (recur.type === 'MONTHLY' && !recur.daysOfMonth?.length) return toast.error('Pick at least one date of the month it repeats on');
    if (recur.type === 'YEARLY' && (recur.month == null || !recur.daysOfMonth?.length)) return toast.error('Pick the month and at least one date it repeats on');
    if (recur.type === 'DATES') {
      if (!recur.dates?.length) return toast.error('Add at least one date for it to go out on');
      // The limit is said HERE because the server's version of this message never reaches
      // anybody: a validation failure comes back as the words "Invalid request", with the
      // real reason buried in a field nothing reads.
      if (recur.dates.length > MAX_RULE_DATES) return toast.error(`At most ${MAX_RULE_DATES} dates on one announcement`);
      // A date that has gone by has no day left to go out on. Dates the post was ALREADY
      // carrying are fine — they are its own record, and the whole list is sent on
      // every save, so refusing them would make an old post uneditable.
      const already = new Set(isEdit ? [...(announcement.recurrence?.dates || []), ...(announcement.occurrences || [])] : []);
      const stale = recur.dates.filter((d) => d < todayCompany && !already.has(d));
      if (stale.length) return toast.error(`${stale.map(formatDay).join(', ')} has already gone by — remove it`);
    }
    if (recur.type !== 'NONE' && !HHMM.test(recur.time || '')) return toast.error('Pick a time for it to go out');
    mut.mutate();
  };

  const summary = describeRecurrence(recur);
  const dayPicks = recur.daysOfMonth || [];
  const onDates = recur.type === 'MONTHLY' || recur.type === 'YEARLY';
  // "The 31st" has to mean something in April. Said here, once, so nobody is surprised.
  const clampShift = onDates && dayPicks.some((d) => d >= 29);
  // And with several dates, two of them can land on the SAME day in a short month, which
  // means one outing rather than two. The threshold is 28, not 29: two dates collapse only
  // when the lower one equals the month's length, and the shortest month is 28 — so
  // counting from 29 would miss the 28th-and-31st pair, the easiest one to pick by hand.
  const clampCollapse = onDates && dayPicks.filter((d) => d >= 28).length > 1;

  return (
    <AppDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        isEdit ? undefined : (
          <Button>
            <Plus /> New announcement
          </Button>
        )
      }
      title={isEdit ? 'Edit announcement' : 'New announcement'}
      description="Posted notices pop up for the audience on next login and live in the feed."
      footer={
        <>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={mut.isPending}>
            {mut.isPending ? 'Saving…' : isEdit ? 'Save changes' : 'Post announcement'}
          </Button>
        </>
      }
    >
      <div className="max-h-[60vh] space-y-4 overflow-y-auto py-2">
        <div className="space-y-1.5">
          <Label htmlFor="an-title">Title</Label>
          <Input id="an-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Office closed on Monday" className="bg-background/50" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="an-body">Message</Label>
          <NoteEditor id="an-body" value={body} onChange={setBody} placeholder="Write the announcement…" className="[&_textarea]:min-h-28" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="an-priority">Priority</Label>
          <Select value={priority} onValueChange={setPriority}>
            <SelectTrigger id="an-priority" className="w-full bg-background/50">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PRIORITY_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <AudiencePicker
          mode={audienceMode}
          onModeChange={setAudienceMode}
          roles={audience}
          onRolesChange={setAudience}
          people={audienceUsers}
          onPeopleChange={setAudienceUsers}
          roleOptions={roleOptions}
        />

        {/* Hold it back until a chosen moment. Hidden for a repeating post on purpose: that
            post's first outing is worked out from its own rule, which has its own time, and
            the server overwrites anything set here — two controls for one moment, one of them
            silently losing. */}
        {recur.type === 'NONE' ? (
          <div className="space-y-2 rounded-xl bg-foreground/[0.03] p-3 ring-1 ring-border/50">
            <Label htmlFor="an-sched-date" className="flex items-center gap-1.5">
              <CalendarClock className="size-3.5 text-muted-foreground" /> Send later (optional)
            </Label>
            <div className="flex flex-wrap gap-2">
              {/* The floor is the COMPANY's today, not the device's — a laptop in another
                  timezone could otherwise offer a day the server reads as yesterday. */}
              <DatePicker
                id="an-sched-date"
                value={schedYMD}
                min={todayCompany}
                onChange={setSchedYMD}
                clearable
                placeholder="Post straight away"
                className="min-w-[10rem] flex-1 bg-background/50"
              />
              {schedYMD ? (
                <TimePicker
                  id="an-sched-time"
                  value={schedTime}
                  onChange={setSchedTime}
                  className="min-w-[8rem] bg-background/50"
                />
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground">
              {schedYMD
                ? 'Nobody sees it or is notified until then — it waits out of sight and goes out on its own. You can still see and edit it in the meantime.'
                : 'Leave the date empty and it goes out the moment you post it.'}
            </p>
          </div>
        ) : null}

        {/* Repeats — the same post going out again on a schedule: every week on a day,
            every month on a date, or every year on a month-and-date. Each time it goes
            out it pops up for everyone again and returns to the top of the feed. */}
        <div className="space-y-2 rounded-xl bg-foreground/[0.03] p-3 ring-1 ring-border/50">
          <Label htmlFor="an-repeat" className="flex items-center gap-1.5">
            <Repeat className="size-3.5" /> Repeat
          </Label>
          <Select value={recur.type} onValueChange={setType} disabled={unknownType}>
            <SelectTrigger id="an-repeat" className="w-full bg-background/50">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RECURRENCE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* A repeat option this build has never heard of — a newer one, reached from a
              phone still running a cached copy. Rewriting it blind would turn it into
              something it is not, so the control is locked rather than lying. */}
          {unknownType ? (
            <p className="text-xs text-amber-600 dark:text-amber-300">
              This post repeats in a way this version of the app doesn’t know. Refresh the app to edit its schedule — everything else here still saves.
            </p>
          ) : null}

          {recur.type === 'WEEKLY' ? (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label className="text-xs text-muted-foreground">On</Label>
                {recur.weekdays?.length ? (
                  <span className="text-[11px] text-muted-foreground">{recur.weekdays.length} picked</span>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {WEEKDAYS.map((d, i) => (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={recur.weekdays?.includes(i)}
                    onClick={() => toggleDay('weekdays', i)}
                    className={cn(
                      'rounded-full px-2.5 py-1 text-xs font-medium ring-1 transition-colors',
                      recur.weekdays?.includes(i) ? 'bg-primary/12 text-primary ring-primary/25' : 'bg-muted/40 text-muted-foreground ring-border hover:text-foreground',
                    )}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {recur.type === 'YEARLY' ? (
            <div className="space-y-1.5">
              <Label htmlFor="an-month" className="text-xs text-muted-foreground">Month</Label>
              <Select value={recur.month != null ? String(recur.month) : null} onValueChange={(v) => setRule({ month: Number(v) })}>
                <SelectTrigger id="an-month" className="w-full bg-background/50"><span>{recur.month != null ? MONTHS[recur.month - 1] : 'Pick a month'}</span></SelectTrigger>
                <SelectContent>
                  {MONTHS.map((m, i) => <SelectItem key={m} value={String(i + 1)}>{m}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          {/* Dates of the month, as many as wanted. A fixed-height grid with tabular
              figures rather than pills, so the columns line up — the same cell the app's
              calendar uses. Seven columns on a phone (a 320px screen gives ~34px cells),
              ten once there is room. Colour-only feedback, no new animation: Lite mode
              switches animations off, so anything that relies on one reads as a dead
              control there. */}
          {onDates ? (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label className="text-xs text-muted-foreground">
                  {recur.type === 'YEARLY' ? 'Dates in that month' : 'Dates of the month'}
                </Label>
                {dayPicks.length ? (
                  <button type="button" onClick={() => setRule({ daysOfMonth: [] })} className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
                    {dayPicks.length} picked · Clear
                  </button>
                ) : null}
              </div>
              <div className="grid grid-cols-7 gap-1 sm:grid-cols-10 sm:gap-1.5">
                {DAYS_1_31.map((d) => (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={dayPicks.includes(d)}
                    onClick={() => toggleDay('daysOfMonth', d)}
                    className={cn(
                      // h-11 is 44px — the smallest target a thumb reliably hits on iOS.
                      // Measured at 375px: seven 41px-wide cells per row, no sideways scroll.
                      'flex h-11 items-center justify-center rounded-lg text-xs font-medium tabular-nums ring-1 transition-colors sm:h-9',
                      dayPicks.includes(d) ? 'bg-primary/12 text-primary ring-primary/25' : 'bg-muted/40 text-muted-foreground ring-border hover:text-foreground',
                    )}
                  >
                    {d}
                  </button>
                ))}
              </div>
              {/* Directly under the grid, not folded into the summary below it: five rows of
                  cells push that paragraph out of sight on a phone, and this is the one
                  sentence worth reading before saving. */}
              {clampShift || clampCollapse ? (
                <p className="text-xs text-muted-foreground">
                  {clampShift ? 'A month too short for a date you picked sends it on that month’s last day instead — the 31st becomes the 30th in April and the 28th in February. ' : ''}
                  {clampCollapse ? 'In a short month two of your dates can land on the same day, and then it goes out once that month.' : ''}
                </p>
              ) : null}
            </div>
          ) : null}

          {/* Named calendar days: pick one, pick another, as many as wanted. The app's own
              calendar is reused rather than a second kind of picker — `marked` shows what is
              already on the list and `viewYMD` keeps it on the month last used, so adding
              four dates in a row is four taps, not four hunts back from today. */}
          {recur.type === 'DATES' ? (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="an-dates" className="text-xs text-muted-foreground">On these dates</Label>
                <span className="text-[11px] text-muted-foreground">
                  {recur.dates?.length ? `${recur.dates.length} of ${MAX_RULE_DATES}` : `up to ${MAX_RULE_DATES}`}
                </span>
              </div>
              {recur.dates?.length ? (
                <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
                  {recur.dates.map((d) => {
                    const gone = d < todayCompany;
                    return (
                      <span
                        key={d}
                        className={cn(
                          'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium tabular-nums ring-1',
                          // A date that has already gone by is part of the post's record, so
                          // it stays — just not dressed as something still to come.
                          gone ? 'bg-muted/40 text-muted-foreground ring-border' : 'bg-primary/12 text-primary ring-primary/25',
                        )}
                        title={gone ? 'Already gone by' : undefined}
                      >
                        {formatDay(d)}
                        <button type="button" onClick={() => removeDate(d)} aria-label={`Remove ${formatDay(d)}`} className="opacity-60 hover:opacity-100">
                          <X className="size-3" />
                        </button>
                      </span>
                    );
                  })}
                </div>
              ) : null}
              <DatePicker
                id="an-dates"
                value=""
                // The COMPANY's today, not the device's: the server decides what "gone by"
                // means in the office's timezone, and a laptop abroad would otherwise offer
                // a day the server then refuses.
                min={todayCompany}
                marked={recur.dates || []}
                viewYMD={recur.dates?.length ? recur.dates[recur.dates.length - 1] : ''}
                onChange={addDate}
                disabled={(recur.dates?.length || 0) >= MAX_RULE_DATES}
                placeholder={recur.dates?.length ? 'Add another date' : 'Add a date'}
                className="w-full bg-background/50"
              />
              <p className="text-xs text-muted-foreground">
                It goes out on each of these days and then it’s finished — it won’t repeat after the last one.
              </p>
            </div>
          ) : null}

          {recur.type !== 'NONE' ? (
            <div className="space-y-1.5">
              <Label htmlFor="an-time" className="text-xs text-muted-foreground">At</Label>
              {/* The app's own picker, not a bare native input — it stores HH:mm, never
                  an empty string, so "Pick a time" can't be asked of somebody looking at
                  a time. */}
              <TimePicker id="an-time" value={recur.time || '09:00'} onChange={(v) => setRule({ time: v || '09:00' })} className="bg-background/50" />
            </div>
          ) : null}

          {summary ? (
            <p className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{summary}.</span> It goes out again on each of those days, pops up for
              everyone as new, and returns to the top of the feed.
            </p>
          ) : null}
        </div>
      </div>
    </AppDialog>
  );
}

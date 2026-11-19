'use client';

import * as React from 'react';
import { AlarmClock, Plus, Repeat, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { TimePicker } from '@/components/ui/time-picker';
import { DatePicker } from '@/components/ui/date-picker';

/**
 * "YAAD DILANA" + "REPEAT" — ek hi jagah, kyunki ye dono dialog me bilkul ek jaise lagte
 * hain: apna task banate waqt (task-dialog) aur kisi ko kaam dete waqt (assign-dialog).
 * Owner ne saaf kaha tha ki ye sirf personal task tak na rahe (19 Nov 2026). Do jagah
 * alag-alag likhte to ek jagah ka sudhaar doosri jagah chhoot jaata.
 *
 * DO ALAG CHEEZEIN, JAAN-BOOJH KAR:
 *   • REPEAT batata hai kaam KIN DINON lautega (har mahine 5 aur 20)
 *   • YAAD batati hai un dinon KIS-KIS WAQT phone bajega (subah 10, shaam 5)
 * Owner ne dono maange the — "kai din aur kai waqt". Alag rakhne se ek hi din par teen
 * waqt chunna apne aap ban jaata hai, bina kisi alag hisaab ke.
 *
 * TEEN WAQT KI HADD owner ki chuni hui hai, aur ye sirf UI ki sajavat nahi: ye waqt
 * scheduler ke ek hi tick me push bante hain, aur har push 3 second tak await hota hai.
 * Server par bhi wahi hadd lagi hai (validators) — yahan wo dikhti hai, wahan wo lagti hai.
 *
 * Reminder sirf us bande ko jaati hai JISKA kaam hai, dene wale ko nahi — isliye "aapko"
 * nahi, "unhe" likha jaata hai jab kaam kisi aur ko diya ja raha ho.
 */

const MAX_TIMES = 3;
const DAYS = [['Sun', 0], ['Mon', 1], ['Tue', 2], ['Wed', 3], ['Thu', 4], ['Fri', 5], ['Sat', 6]];
// Office ke aam waqt — ek tap me lag jaate hain. Apna waqt neeche se.
const QUICK = [['09:30', 'Morning 9:30'], ['13:00', '1 PM'], ['17:00', 'Evening 5']];

/** '17:00' → '5:00 PM' — chip par 24-ghante wala waqt padhne me ruk-ruk hota hai. */
function pretty(hm) {
  const [h, m] = String(hm).split(':').map(Number);
  const pm = h >= 12;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${pm ? 'PM' : 'AM'}`;
}

const EMPTY_REPEAT = { type: 'NONE', weekdays: [], daysOfMonth: [], dates: [] };

/** Server par bhejne layak saaf repeat — khaali list wale type NONE ban jaate hain. */
export function cleanRepeat(repeat) {
  const r = { ...EMPTY_REPEAT, ...(repeat || {}) };
  if (r.type === 'WEEKLY' && !r.weekdays.length) return EMPTY_REPEAT;
  if (r.type === 'MONTHLY' && !r.daysOfMonth.length) return EMPTY_REPEAT;
  if (r.type === 'DATES' && !r.dates.length) return EMPTY_REPEAT;
  return r;
}

export { EMPTY_REPEAT };

export function ReminderRepeatFields({
  times, setTimes,
  dayBefore, setDayBefore,
  repeat, setRepeat,
  hasDueDate,
  // Kaam kisi aur ko diya ja raha hai — to lafz "unhe" ho, "aapko" nahi.
  forSomeoneElse = false,
  disabled = false,
}) {
  const [draft, setDraft] = React.useState('');
  const [draftDate, setDraftDate] = React.useState('');
  const r = { ...EMPTY_REPEAT, ...(repeat || {}) };
  const full = times.length >= MAX_TIMES;

  const addTime = (hm) => {
    if (!hm || disabled) return;
    if (times.includes(hm)) return;
    if (times.length >= MAX_TIMES) return;
    setTimes([...times, hm].sort());
  };
  const dropTime = (hm) => setTimes(times.filter((t) => t !== hm));
  const toggleIn = (list, v) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v].sort((a, b) => a - b));

  return (
    <div className="space-y-4 rounded-xl border border-border/60 bg-foreground/[0.02] p-3">
      {/* ── Yaad dilana ───────────────────────────────────────────────── */}
      <div className="space-y-2">
        <Label className="flex items-center gap-1.5"><AlarmClock className="size-3.5" /> Remind {forSomeoneElse ? 'them' : 'me'}</Label>

        {!hasDueDate ? (
          <p className="text-xs text-muted-foreground">Pick a due date first — reminders go out on that day.</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-1.5">
              {QUICK.map(([hm, label]) => (
                <button
                  key={hm}
                  type="button"
                  disabled={disabled || (full && !times.includes(hm))}
                  onClick={() => (times.includes(hm) ? dropTime(hm) : addTime(hm))}
                  className={cn(
                    'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                    times.includes(hm) ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background/50 text-muted-foreground hover:text-foreground',
                    (disabled || (full && !times.includes(hm))) && 'cursor-not-allowed opacity-50',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Apna waqt. TimePicker pehle se bana hua hai (rules/settings me use hota hai). */}
            <div className="flex items-center gap-2">
              <TimePicker value={draft} onChange={setDraft} disabled={disabled || full} placeholder="Own time" className="flex-1 bg-background/50" />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={disabled || full || !draft || times.includes(draft)}
                onClick={() => { addTime(draft); setDraft(''); }}
              >
                <Plus className="size-3.5" /> Add
              </Button>
            </div>

            {times.length ? (
              <div className="flex flex-wrap gap-1.5">
                {times.map((hm) => (
                  <span key={hm} className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary ring-1 ring-primary/20">
                    {pretty(hm)}
                    <button type="button" disabled={disabled} onClick={() => dropTime(hm)} aria-label={`Remove ${pretty(hm)}`} className="rounded-full hover:bg-primary/20">
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
              </div>
            ) : null}

            <p className="text-xs text-muted-foreground">
              {times.length
                ? `${times.length} of ${MAX_TIMES} times${full ? ' — that is the limit' : ''}. A reminder lands within about 5 minutes of the time.`
                : 'No reminder set.'}
            </p>

            {times.length ? (
              <div className="flex items-center justify-between gap-3 pt-1">
                <span className="text-sm">Also remind a day before</span>
                <Switch checked={!!dayBefore} onCheckedChange={setDayBefore} disabled={disabled} />
              </div>
            ) : null}
          </>
        )}
      </div>

      {/* ── Repeat ────────────────────────────────────────────────────── */}
      <div className="space-y-2 border-t border-border/60 pt-3">
        <Label className="flex items-center gap-1.5"><Repeat className="size-3.5" /> Repeat</Label>
        {!hasDueDate ? (
          <p className="text-xs text-muted-foreground">A repeating task needs a due date — that is what the next one is counted from.</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-1.5">
              {[['NONE', 'No repeat'], ['DAILY', 'Every day'], ['WEEKLY', 'Weekly'], ['MONTHLY', 'Monthly'], ['DATES', 'Pick dates']].map(([type, label]) => (
                <button
                  key={type}
                  type="button"
                  disabled={disabled}
                  onClick={() => setRepeat({ ...r, type })}
                  className={cn(
                    'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                    r.type === type ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background/50 text-muted-foreground hover:text-foreground',
                    disabled && 'cursor-not-allowed opacity-50',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            {r.type === 'WEEKLY' ? (
              <div className="flex flex-wrap gap-1.5">
                {DAYS.map(([label, n]) => (
                  <button
                    key={n}
                    type="button"
                    disabled={disabled}
                    onClick={() => setRepeat({ ...r, weekdays: toggleIn(r.weekdays, n) })}
                    className={cn(
                      'h-9 w-11 rounded-lg border text-xs font-medium transition-colors sm:h-8',
                      r.weekdays.includes(n) ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background/50 text-muted-foreground',
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            ) : null}

            {r.type === 'MONTHLY' ? (
              <>
                <div className="grid grid-cols-7 gap-1">
                  {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                    <button
                      key={d}
                      type="button"
                      disabled={disabled}
                      onClick={() => setRepeat({ ...r, daysOfMonth: toggleIn(r.daysOfMonth, d) })}
                      className={cn(
                        'h-9 rounded-lg border text-xs font-medium transition-colors sm:h-8',
                        r.daysOfMonth.includes(d) ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background/50 text-muted-foreground',
                      )}
                    >
                      {d}
                    </button>
                  ))}
                </div>
                {r.daysOfMonth.some((d) => d > 28) ? (
                  <p className="text-xs text-muted-foreground">A month that has no 29th, 30th or 31st uses its last day instead.</p>
                ) : null}
              </>
            ) : null}

            {r.type === 'DATES' ? (
              <>
                <div className="flex items-center gap-2">
                  <DatePicker value={draftDate} onChange={setDraftDate} className="flex-1 bg-background/50" />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={disabled || !draftDate || r.dates.includes(draftDate) || r.dates.length >= 24}
                    onClick={() => { setRepeat({ ...r, dates: [...r.dates, draftDate].sort() }); setDraftDate(''); }}
                  >
                    <Plus className="size-3.5" /> Add
                  </Button>
                </div>
                {r.dates.length ? (
                  <div className="flex flex-wrap gap-1.5">
                    {r.dates.map((d) => (
                      <span key={d} className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary ring-1 ring-primary/20">
                        {d}
                        <button type="button" disabled={disabled} onClick={() => setRepeat({ ...r, dates: r.dates.filter((x) => x !== d) })} aria-label={`Remove ${d}`} className="rounded-full hover:bg-primary/20">
                          <X className="size-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                ) : null}
              </>
            ) : null}

            {r.type !== 'NONE' ? (
              <p className="text-xs text-muted-foreground">
                When it is finished, the next one is created automatically with the same reminder times.
              </p>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

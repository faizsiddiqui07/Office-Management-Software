'use client';

import * as React from 'react';
import { AlarmClock, Plus, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { TimePicker } from '@/components/ui/time-picker';
import { formatDayLabel } from '@/lib/time';

/**
 * "YAAD DILANA" — ek hi jagah, kyunki ye dono dialog me bilkul ek jaisa lagta hai:
 * apna task banate waqt (task-dialog) aur kisi ko kaam dete waqt (assign-dialog).
 * Owner ne saaf kaha tha ki ye sirf personal task tak na rahe (19 Nov 2026). Do jagah
 * alag-alag likhte to ek jagah ka sudhaar doosri jagah chhoot jaata.
 *
 * ── KIS DIN KA WAQT? YE SAWAAL HI IS FILE KA SABAK HAI ───────────────────────────
 * Pehle yahan sirf "Remind me" likha tha aur neeche waqt ke chip. Owner ne 19 Nov 2026
 * ko poochha: "9 baje chun liya, lekin KIS DIN ka 9 baje? task wale din ka ya usse
 * pehle wale din ka?" — aur wo kahin likha hi nahi tha.
 *
 * Jawab: waqt HAMESHA due wale din ka hai. Isliye ab har jagah us din ki ASLI TAREEKH
 * likhi jaati hai ("Thu, 21 Nov par 9:30 AM"), sirf "9:30 AM" nahi. "Ek din pehle"
 * wali switch bhi apni tareekh khud dikhati hai. Tareekh mahine ke naam ke saath hai,
 * 21/11 jaise ank nahi — taaki padhne wale ko sochna na pade.
 *
 * TEEN WAQT KI HADD owner ki chuni hui hai, aur ye sirf UI ki sajavat nahi: ye waqt
 * scheduler ke ek hi tick me push bante hain, aur har push 3 second tak await hota hai.
 * Server par bhi wahi hadd lagi hai (validators) — yahan wo dikhti hai, wahan wo lagti hai.
 *
 * Reminder sirf us bande ko jaati hai JISKA kaam hai, dene wale ko nahi — isliye "aapko"
 * nahi, "unhe" likha jaata hai jab kaam kisi aur ko diya ja raha ho.
 */

const MAX_TIMES = 3;
// Office ke aam waqt — ek tap me lag jaate hain. Apna waqt neeche se.
const QUICK = [['09:30', 'Morning 9:30'], ['13:00', '1 PM'], ['17:00', 'Evening 5']];

/** '17:00' → '5:00 PM' — chip par 24-ghante wala waqt padhne me ruk-ruk hota hai. */
function pretty(hm) {
  const [h, m] = String(hm).split(':').map(Number);
  const pm = h >= 12;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${pm ? 'PM' : 'AM'}`;
}

/** 'YYYY-MM-DD' se ek din peechhe. Chhoti si baat, par Date object ke bina — mahine ke
 *  aakhir aur saal ke aakhir dono apne aap theek nikalte hain. */
function dayBeforeYMD(ymd) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(ymd || ''))) return '';
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export function ReminderFields({
  times, setTimes,
  dayBefore, setDayBefore,
  dueYMD,
  // Kaam kisi aur ko diya ja raha hai — to lafz "unhe" ho, "aapko" nahi.
  forSomeoneElse = false,
  disabled = false,
}) {
  const [draft, setDraft] = React.useState('');
  const full = times.length >= MAX_TIMES;
  const hasDueDate = !!dueYMD;
  const whom = forSomeoneElse ? 'them' : 'me';
  const dueLabel = hasDueDate ? formatDayLabel(dueYMD) : '';
  const beforeLabel = hasDueDate ? formatDayLabel(dayBeforeYMD(dueYMD)) : '';

  const addTime = (hm) => {
    if (!hm || disabled) return;
    if (times.includes(hm)) return;
    if (times.length >= MAX_TIMES) return;
    setTimes([...times, hm].sort());
  };
  const dropTime = (hm) => setTimes(times.filter((t) => t !== hm));

  return (
    <div className="space-y-3 rounded-xl border border-border/60 bg-foreground/[0.02] p-3">
      <div className="space-y-1">
        <Label className="flex items-center gap-1.5"><AlarmClock className="size-3.5" /> Remind {whom}</Label>
        {/* Sawaal "kis din?" ka jawab SABSE UPAR, kuch chunne se pehle hi. */}
        <p className="text-xs text-muted-foreground">
          {hasDueDate
            ? <>On the due day — <span className="font-medium text-foreground">{dueLabel}</span></>
            : 'Pick a due date first — reminders go out on that day.'}
        </p>
      </div>

      {hasDueDate ? (
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

          {/* Chuna hua waqt hamesha TAREEKH ke saath — "9:30 AM" akela phir wahi sawaal
              khada kar deta hai jo owner ne poochha tha. */}
          {times.length ? (
            <div className="flex flex-wrap gap-1.5">
              {times.map((hm) => (
                <span key={hm} className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary ring-1 ring-primary/20">
                  {dueLabel} · {pretty(hm)}
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
            <div className="flex items-start justify-between gap-3 border-t border-border/60 pt-3">
              <span className="text-sm">
                Also remind the day before
                {/* Yahan bhi asli tareekh — "a day before" sunne me saaf lagta hai par
                    padhne wale ko phir se hisaab lagana padta hai. */}
                <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                  Same times on {beforeLabel}
                </span>
              </span>
              <Switch checked={!!dayBefore} onCheckedChange={setDayBefore} disabled={disabled} className="mt-0.5" />
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

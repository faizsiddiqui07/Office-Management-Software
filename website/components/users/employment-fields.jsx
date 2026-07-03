'use client';

import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/** A blank schedule = "follow the office hours". Custom values override them. */
export const DEFAULT_SCHEDULE = { workStart: '', workEnd: '', graceMinutes: 0, workDays: [] };

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Employment type + an OPTIONAL custom schedule available to EVERYONE (not just
 * part-timers). Leave the hours/days blank and the person follows the office
 * hours from Settings; fill them in for someone like an early office boy (09:00)
 * or a gunner on 11:00–19:00.
 */
export function EmploymentFields({ employmentType, schedule, onTypeChange, onScheduleChange }) {
  const s = schedule || DEFAULT_SCHEDULE;
  const setSched = (k) => (e) => onScheduleChange({ ...s, [k]: e.target.value });
  const workDays = Array.isArray(s.workDays) ? s.workDays : [];
  const toggleDay = (d) =>
    onScheduleChange({
      ...s,
      workDays: workDays.includes(d) ? workDays.filter((x) => x !== d) : [...workDays, d].sort((a, b) => a - b),
    });
  const clearHours = () => onScheduleChange({ workStart: '', workEnd: '', graceMinutes: 0, workDays: [] });
  const hasCustom = !!(s.workStart || s.workEnd || workDays.length);

  return (
    <div className="space-y-3 rounded-xl bg-foreground/[0.04] p-3 ring-1 ring-border/50">
      <div className="space-y-1.5">
        <Label htmlFor="emp-type">Employment type</Label>
        <Select value={employmentType || 'FULL_TIME'} onValueChange={onTypeChange}>
          <SelectTrigger id="emp-type" className="w-full bg-background/50">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="FULL_TIME">Full time</SelectItem>
            <SelectItem value="PART_TIME">Part time</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-3 border-t border-border/50 pt-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <Label>Custom timing <span className="font-normal text-muted-foreground">(optional)</span></Label>
            <p className="text-xs text-muted-foreground">Leave blank to follow the office hours in Settings.</p>
          </div>
          {hasCustom ? (
            <button type="button" onClick={clearHours} className="shrink-0 text-xs font-medium text-primary hover:underline">
              Use office hours
            </button>
          ) : null}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="emp-in">Check-in</Label>
            <Input id="emp-in" type="time" value={s.workStart || ''} onChange={setSched('workStart')} className="bg-background/50" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="emp-out">Check-out</Label>
            <Input id="emp-out" type="time" value={s.workEnd || ''} onChange={setSched('workEnd')} className="bg-background/50" />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="emp-grace">Grace (minutes)</Label>
          <Input
            id="emp-grace"
            type="number"
            min="0"
            max="180"
            value={s.graceMinutes ?? 0}
            onChange={setSched('graceMinutes')}
            className="bg-background/50"
          />
        </div>

        <div className="space-y-1.5">
          <Label>Working days</Label>
          <div className="flex flex-wrap gap-1.5">
            {DAYS.map((d, i) => (
              <button
                key={d}
                type="button"
                onClick={() => toggleDay(i)}
                className={
                  'rounded-full px-3 py-1.5 text-xs font-medium ring-1 transition-colors ' +
                  (workDays.includes(i)
                    ? 'bg-primary text-primary-foreground ring-primary'
                    : 'bg-background/50 text-muted-foreground ring-border hover:text-foreground')
                }
              >
                {d}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            {workDays.length
              ? `Works ${workDays.length} day${workDays.length === 1 ? '' : 's'} a week — other days won't count as absent.`
              : 'Leave all off to follow the office week.'}
          </p>
        </div>
      </div>
    </div>
  );
}

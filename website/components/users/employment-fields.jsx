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

/** Default part-time window used when a full-time user is switched to part-time. */
export const DEFAULT_SCHEDULE = { workStart: '10:00', workEnd: '18:00', graceMinutes: 0 };

/**
 * Employment type + (for part-timers) their own check-in / check-out / grace.
 * Shared by the create- and edit-user dialogs so the two never diverge.
 */
export function EmploymentFields({ employmentType, schedule, onTypeChange, onScheduleChange }) {
  const partTime = employmentType === 'PART_TIME';
  const s = schedule || DEFAULT_SCHEDULE;
  const setSched = (k) => (e) => onScheduleChange({ ...s, [k]: e.target.value });

  return (
    <div className="space-y-3 rounded-xl bg-foreground/[0.04] p-3 ring-1 ring-border/50">
      <div className="space-y-1.5">
        <Label htmlFor="emp-type">Employment type</Label>
        <Select value={employmentType || 'FULL_TIME'} onValueChange={onTypeChange}>
          <SelectTrigger id="emp-type" className="w-full bg-background/50">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="FULL_TIME">Full time — office hours</SelectItem>
            <SelectItem value="PART_TIME">Part time — custom hours</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {partTime ? (
        <>
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
          <p className="text-xs text-muted-foreground">
            Marked late after check-in + grace; overtime counts past check-out.
          </p>
        </>
      ) : (
        <p className="text-xs text-muted-foreground">Follows the office hours set in Settings.</p>
      )}
    </div>
  );
}

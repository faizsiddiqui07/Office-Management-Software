'use client';

import * as React from 'react';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { DateRange } from '@/components/ui/date-range';
import { DatePicker } from '@/components/ui/date-picker';
import { APP_LIVE_YMD, APP_LIVE_MONTH } from '@/lib/app-live';
import { REPORT_TYPES } from '@/lib/report';
import { todayYMD } from '@/lib/expense';

/** Current fiscal year (Apr–Mar) start year for a YMD. */
function fiscalYearOf(ymd) {
  const y = Number(ymd.slice(0, 4));
  return Number(ymd.slice(5, 7)) >= 4 ? y : y - 1;
}

/**
 * Report period control: the type select plus an input that MATCHES the type —
 * a date for daily, any-date-in-week for weekly, a month picker for monthly,
 * and a fiscal-year select for yearly. Parent keeps `type` + `date` (the YMD
 * the API expects); this converts month/year picks into that date.
 */
export function PeriodPicker({ type, onTypeChange, date, onDateChange, range, onRangeChange, idPrefix = 'pp' }) {
  const today = todayYMD();
  const currentFY = fiscalYearOf(today);
  // Never offer a fiscal year from before the system went live — those reports would
  // be a page of "absent" for data that simply doesn't exist.
  const firstFY = fiscalYearOf(APP_LIVE_YMD);
  const fyOptions = [];
  for (let y = currentFY; y >= firstFY; y -= 1) fyOptions.push(y);

  // Every month from go-live to now, newest first.
  const monthOptions = [];
  for (let key = today.slice(0, 7); key >= APP_LIVE_MONTH; ) {
    const [y, m] = key.split('-').map(Number);
    monthOptions.push({
      value: key,
      label: new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
    });
    const prev = new Date(Date.UTC(y, m - 2, 1));
    key = `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, '0')}`;
  }

  return (
    <>
      <div className="w-full space-y-1.5 sm:w-auto">
        <Label htmlFor={`${idPrefix}-type`}>Report</Label>
        <Select value={type} onValueChange={onTypeChange}>
          <SelectTrigger id={`${idPrefix}-type`} className="w-full bg-background/50 sm:w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {REPORT_TYPES.map((x) => (
              <SelectItem key={x.value} value={x.value}>
                {x.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {type === 'daily' ? (
        <div className="w-full space-y-1.5 sm:w-auto">
          <Label htmlFor={`${idPrefix}-date`}>Date</Label>
          <DatePicker
            id={`${idPrefix}-date`}
            value={date}
            min={APP_LIVE_YMD}
            max={today}
            onChange={(v) => onDateChange(v || today)}
            className="w-full bg-background/50 sm:w-44"
          />
        </div>
      ) : null}

      {type === 'weekly' ? (
        <div className="w-full space-y-1.5 sm:w-auto">
          <Label htmlFor={`${idPrefix}-week`}>Any date in that week</Label>
          <DatePicker
            id={`${idPrefix}-week`}
            value={date}
            min={APP_LIVE_YMD}
            max={today}
            onChange={(v) => onDateChange(v || today)}
            className="w-full bg-background/50 sm:w-44"
          />
        </div>
      ) : null}

      {type === 'monthly' ? (
        <div className="w-full space-y-1.5 sm:w-auto">
          <Label htmlFor={`${idPrefix}-month`}>Month</Label>
          {/* A bounded list, not <input type="month">: Firefox and desktop Safari render
              that as a plain text box and ignore min entirely, which reopened the
              pre-live months this picker exists to close off. */}
          <Select value={date.slice(0, 7)} onValueChange={(v) => onDateChange(`${v}-01`)}>
            <SelectTrigger id={`${idPrefix}-month`} className="w-full bg-background/50 sm:w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {monthOptions.map((m) => (
                <SelectItem key={m.value} value={m.value}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      {type === 'yearly' ? (
        <div className="w-full space-y-1.5 sm:w-auto">
          <Label htmlFor={`${idPrefix}-fy`}>Financial year</Label>
          <Select value={String(fiscalYearOf(date))} onValueChange={(v) => onDateChange(`${v}-04-01`)}>
            <SelectTrigger id={`${idPrefix}-fy`} className="w-full bg-background/50 sm:w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {fyOptions.map((y) => (
                <SelectItem key={y} value={String(y)}>
                  {`FY ${y}–${String(y + 1).slice(2)} (Apr–Mar)`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      {type === 'custom' ? (
        <div className="w-full space-y-1.5 sm:w-auto">
          <Label>Date range</Label>
          <DateRange value={range} onChange={onRangeChange} max={today} />
        </div>
      ) : null}
    </>
  );
}

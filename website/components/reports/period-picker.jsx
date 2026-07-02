'use client';

import * as React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
export function PeriodPicker({ type, onTypeChange, date, onDateChange, idPrefix = 'pp' }) {
  const today = todayYMD();
  const currentFY = fiscalYearOf(today);
  const fyOptions = [currentFY, currentFY - 1, currentFY - 2, currentFY - 3];

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
          <Input
            id={`${idPrefix}-date`}
            type="date"
            value={date}
            max={today}
            onChange={(e) => onDateChange(e.target.value || today)}
            className="w-full bg-background/50 sm:w-44"
          />
        </div>
      ) : null}

      {type === 'weekly' ? (
        <div className="w-full space-y-1.5 sm:w-auto">
          <Label htmlFor={`${idPrefix}-week`}>Any date in that week</Label>
          <Input
            id={`${idPrefix}-week`}
            type="date"
            value={date}
            onChange={(e) => onDateChange(e.target.value || today)}
            className="w-full bg-background/50 sm:w-44"
          />
        </div>
      ) : null}

      {type === 'monthly' ? (
        <div className="w-full space-y-1.5 sm:w-auto">
          <Label htmlFor={`${idPrefix}-month`}>Month</Label>
          <Input
            id={`${idPrefix}-month`}
            type="month"
            value={date.slice(0, 7)}
            max={today.slice(0, 7)}
            onChange={(e) => onDateChange(e.target.value ? `${e.target.value}-01` : today)}
            className="w-full bg-background/50 sm:w-44"
          />
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
    </>
  );
}

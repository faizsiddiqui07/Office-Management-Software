'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Home, Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { holidayYMDSetFromList } from '@/lib/calendar';
import { AppDialog } from '@/components/glass/app-dialog';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import { APP_LIVE_YMD } from '@/lib/app-live';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { LEAVE_TYPES, isPaidType, computeWorkingDaysClient, WFH_TYPE } from '@/lib/leave';
import { companyTodayYMD } from '@/lib/expense';

/**
 * Apply for leave, or (when `leave` is passed) edit a still-PENDING request.
 * Controlled via `open`/`onOpenChange` in edit mode; renders its own trigger
 * button otherwise.
 */
export function ApplyLeaveDialog({ leave, open: openProp, onOpenChange, wfh = false }) {
  const isEdit = !!leave;
  // Work-from-home mode: the same dialog, but WFH is not a kind of leave — one date,
  // no half day, no balance, and its own yearly allowance.
  const isWFH = wfh || leave?.type === WFH_TYPE;
  const qc = useQueryClient();
  const [openInternal, setOpenInternal] = React.useState(false);
  const open = openProp !== undefined ? openProp : openInternal;
  const setOpen = onOpenChange || setOpenInternal;

  const [type, setType] = React.useState('CASUAL');
  const [start, setStart] = React.useState('');
  const [end, setEnd] = React.useState('');
  const [halfDay, setHalfDay] = React.useState(false);
  const [halfDayPart, setHalfDayPart] = React.useState('FIRST'); // FIRST = morning, SECOND = afternoon
  const [reason, setReason] = React.useState('');

  // Pre-fill when opening (fresh for a new request, existing values for an edit).
  React.useEffect(() => {
    if (!open) return;
    setType(leave?.type || (isWFH ? WFH_TYPE : 'CASUAL'));
    setStart(leave?.startYMD || '');
    setEnd(leave?.endYMD || '');
    setHalfDay(!!leave?.halfDay);
    setHalfDayPart(leave?.halfDayPart || 'FIRST');
    setReason(leave?.reason || '');
  }, [open, leave, isWFH]);

  const sameDay = !!start && start === end;

  // How many work-from-home days are left this year — the number that decides whether
  // this request can even be made. Comes back on the balance the page already loads.
  const { data: balData } = useQuery({
    queryKey: ['leaves', 'balance'],
    queryFn: () => api.get('/leaves/balance'),
    enabled: open && isWFH,
  });
  const wfhLeft = balData?.balance?.wfh?.remaining;
  const wfhCap = balData?.balance?.wfh?.cap ?? 2;

  const { data: holData } = useQuery({
    queryKey: ['holidays', 'range', start, end],
    queryFn: () => api.get(`/holidays?from=${start}&to=${end}`),
    enabled: !!start && !!end && end >= start,
  });
  const holidaySet = React.useMemo(
    () => holidayYMDSetFromList(holData?.holidays, start, end),
    [holData, start, end],
  );
  // The applicant's OWN off-days, straight from the server (the office weekend, or a
  // part-timer's own schedule) — the same set the deduction will be worked out from.
  // Assuming Sunday here meant the "Submit · N days" people read before committing
  // could differ from what actually came off their balance.
  const { data: todayData } = useQuery({
    queryKey: ['attendance', 'today'],
    queryFn: () => api.get('/attendance/today'),
    enabled: open,
    staleTime: 60_000,
  });
  const weekendDays = todayData?.settings?.weekendDays ?? [0];
  const days = computeWorkingDaysClient(start, end, halfDay && sameDay, weekendDays, holidaySet);

  const mut = useMutation({
    mutationFn: () => {
      const isHalf = !isWFH && halfDay && sameDay;
      // WFH is always one date and never half a day — send exactly that, whatever the
      // leave-shaped state happens to hold.
      const body = isWFH
        ? { type: WFH_TYPE, startYMD: start, endYMD: start, halfDay: false, reason }
        : { type, startYMD: start, endYMD: end, halfDay: isHalf, reason, ...(isHalf ? { halfDayPart } : {}) };
      return isEdit ? api.patch(`/leaves/${leave.id}`, body) : api.post('/leaves', body);
    },
    onSuccess: () => {
      toast.success(
        isWFH
          ? (isEdit ? 'Request updated' : 'Work-from-home request sent')
          : (isEdit ? 'Leave request updated' : 'Leave request submitted'),
      );
      qc.invalidateQueries({ queryKey: ['leaves'] });
      setOpen(false);
    },
    onError: (e) => toast.error(e?.message || 'Could not save the request'),
  });

  const submit = () => {
    if (isWFH) {
      if (!start) return toast.error('Pick the date');
      if (days <= 0) return toast.error('That date is a holiday or a non-working day for you');
      return mut.mutate();
    }
    if (!start || !end) return toast.error('Pick a start and end date');
    if (end < start) return toast.error('End date is before the start date');
    if (days <= 0) return toast.error('Selected dates contain no working days');
    return mut.mutate();
  };

  const noneLeft = isWFH && !isEdit && wfhLeft === 0;

  return (
    <AppDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        isEdit ? undefined : (
          <Button variant={isWFH ? 'outline' : 'default'}>
            {isWFH ? <><Home className="size-4" /> Work from home</> : <><Plus /> Apply for leave</>}
          </Button>
        )
      }
      title={isWFH ? (isEdit ? 'Edit work-from-home request' : 'Request to work from home') : (isEdit ? 'Edit leave request' : 'Apply for leave')}
      description={
        isWFH
          ? 'One day at a time. It doesn’t touch your leave balance — the day counts as worked.'
          : isEdit
            ? 'Update the details of your pending request.'
            : "Pick your dates and type — we'll compute the working days deducted."
      }
      footer={
        <>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={mut.isPending || days <= 0 || noneLeft}>
            {mut.isPending
              ? 'Saving…'
              : isWFH
                ? (isEdit ? 'Save' : 'Send request')
                : `${isEdit ? 'Save' : 'Submit'} · ${days} day${days === 1 ? '' : 's'}`}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="space-y-4 py-2"
      >
        {!isWFH ? (
          <div className="space-y-1.5">
            <Label htmlFor="lv-type">Type</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger id="lv-type" className="w-full bg-background/50">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LEAVE_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}

        {isWFH ? (
          // One date. Never in the past — a free day that could be back-dated would let
          // an absence be quietly rewritten, so the picker starts at today.
          <div className="space-y-1.5">
            <Label htmlFor="lv-start">Date</Label>
            <DatePicker
              id="lv-start"
              value={start}
              min={companyTodayYMD()}
              onChange={(v) => { setStart(v); setEnd(v); }}
              className="bg-background/50"
            />
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="lv-start">From</Label>
              <DatePicker
                id="lv-start"
                value={start}
                min={APP_LIVE_YMD}
                onChange={(v) => {
                  setStart(v);
                  if (!end || end < v) setEnd(v);
                }}
                className="bg-background/50"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lv-end">To</Label>
              <DatePicker
                id="lv-end"
                value={end}
                min={start || APP_LIVE_YMD}
                onChange={setEnd}
                className="bg-background/50"
              />
            </div>
          </div>
        )}

        {!isWFH && sameDay ? (
          <div className="space-y-2.5">
            <div className="flex items-center gap-3">
              <Switch id="lv-half" checked={halfDay} onCheckedChange={setHalfDay} />
              <Label htmlFor="lv-half">Half day</Label>
            </div>
            {halfDay ? (
              <div className="grid grid-cols-2 gap-2">
                {[
                  { v: 'FIRST', label: 'Morning', hint: 'first half' },
                  { v: 'SECOND', label: 'Afternoon', hint: 'second half' },
                ].map((o) => (
                  <button
                    key={o.v}
                    type="button"
                    onClick={() => setHalfDayPart(o.v)}
                    className={
                      halfDayPart === o.v
                        ? 'rounded-lg bg-primary/12 px-3 py-2 text-sm font-medium text-primary ring-1 ring-primary/25'
                        : 'rounded-lg bg-muted/40 px-3 py-2 text-sm font-medium text-muted-foreground ring-1 ring-border transition-colors hover:text-foreground'
                    }
                  >
                    {o.label}
                    <span className="ml-1 text-xs opacity-60">· {o.hint}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="space-y-1.5">
          <Label htmlFor="lv-reason">Reason</Label>
          <Textarea
            id="lv-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Add a short note for the approver…"
            className="bg-background/50"
          />
        </div>

        {isWFH ? (
          <div
            className={
              noneLeft
                ? 'rounded-xl bg-destructive/10 p-3 text-sm text-destructive ring-1 ring-destructive/20'
                : 'rounded-xl bg-primary/10 p-3 text-sm text-primary ring-1 ring-primary/20'
            }
          >
            {noneLeft ? (
              <>You’ve used all {wfhCap} work-from-home days for this year (1 April – 31 March).</>
            ) : (
              <>
                Doesn’t touch your leave balance — the day counts as worked.{' '}
                {wfhLeft != null ? (
                  <span className="font-semibold">{wfhLeft} of {wfhCap} left this year.</span>
                ) : null}
              </>
            )}
          </div>
        ) : (
        <div
          className={
            isPaidType(type)
              ? 'rounded-xl bg-primary/10 p-3 text-sm text-primary ring-1 ring-primary/20'
              : 'rounded-xl bg-muted/40 p-3 text-sm text-muted-foreground ring-1 ring-border/50'
          }
        >
          {days > 0 ? (
            isPaidType(type) ? (
              <>
                This will deduct <span className="font-semibold">{days}</span> working day
                {days === 1 ? '' : 's'} from your balance once approved.
              </>
            ) : (
              <>
                Unpaid (LOP) — <span className="font-semibold">{days}</span> day{days === 1 ? '' : 's'},
                balance not affected.
              </>
            )
          ) : (
            'Pick a date range to see the working days deducted.'
          )}
        </div>
        )}
      </form>
    </AppDialog>
  );
}

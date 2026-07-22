'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';
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
import { LEAVE_TYPES, isPaidType, computeWorkingDaysClient } from '@/lib/leave';

/**
 * Apply for leave, or (when `leave` is passed) edit a still-PENDING request.
 * Controlled via `open`/`onOpenChange` in edit mode; renders its own trigger
 * button otherwise.
 */
export function ApplyLeaveDialog({ leave, open: openProp, onOpenChange }) {
  const isEdit = !!leave;
  const qc = useQueryClient();
  const [openInternal, setOpenInternal] = React.useState(false);
  const open = openProp !== undefined ? openProp : openInternal;
  const setOpen = onOpenChange || setOpenInternal;

  const [type, setType] = React.useState('CASUAL');
  const [start, setStart] = React.useState('');
  const [end, setEnd] = React.useState('');
  const [halfDay, setHalfDay] = React.useState(false);
  const [reason, setReason] = React.useState('');

  // Pre-fill when opening (fresh for a new request, existing values for an edit).
  React.useEffect(() => {
    if (!open) return;
    setType(leave?.type || 'CASUAL');
    setStart(leave?.startYMD || '');
    setEnd(leave?.endYMD || '');
    setHalfDay(!!leave?.halfDay);
    setReason(leave?.reason || '');
  }, [open, leave]);

  const sameDay = !!start && start === end;

  const { data: holData } = useQuery({
    queryKey: ['holidays', 'range', start, end],
    queryFn: () => api.get(`/holidays?from=${start}&to=${end}`),
    enabled: !!start && !!end && end >= start,
  });
  const holidaySet = React.useMemo(
    () => holidayYMDSetFromList(holData?.holidays, start, end),
    [holData, start, end],
  );
  const days = computeWorkingDaysClient(start, end, halfDay && sameDay, [0], holidaySet);

  const mut = useMutation({
    mutationFn: () => {
      const body = { type, startYMD: start, endYMD: end, halfDay: halfDay && sameDay, reason };
      return isEdit ? api.patch(`/leaves/${leave.id}`, body) : api.post('/leaves', body);
    },
    onSuccess: () => {
      toast.success(isEdit ? 'Leave request updated' : 'Leave request submitted');
      qc.invalidateQueries({ queryKey: ['leaves'] });
      setOpen(false);
    },
    onError: (e) => toast.error(e?.message || 'Could not save the request'),
  });

  const submit = () => {
    if (!start || !end) return toast.error('Pick a start and end date');
    if (end < start) return toast.error('End date is before the start date');
    if (days <= 0) return toast.error('Selected dates contain no working days');
    mut.mutate();
  };

  return (
    <AppDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        isEdit ? undefined : (
          <Button>
            <Plus /> Apply for leave
          </Button>
        )
      }
      title={isEdit ? 'Edit leave request' : 'Apply for leave'}
      description={
        isEdit
          ? 'Update the details of your pending request.'
          : "Pick your dates and type — we'll compute the working days deducted."
      }
      footer={
        <>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={mut.isPending || days <= 0}>
            {mut.isPending ? 'Saving…' : `${isEdit ? 'Save' : 'Submit'} · ${days} day${days === 1 ? '' : 's'}`}
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

        {sameDay ? (
          <div className="flex items-center gap-3">
            <Switch id="lv-half" checked={halfDay} onCheckedChange={setHalfDay} />
            <Label htmlFor="lv-half">Half day</Label>
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
      </form>
    </AppDialog>
  );
}

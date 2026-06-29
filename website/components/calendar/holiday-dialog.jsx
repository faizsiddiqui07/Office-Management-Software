'use client';

import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { AppDialog } from '@/components/glass/app-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { EVENT_TYPE_OPTIONS } from '@/lib/calendar';

export function HolidayDialog({ open, onOpenChange, holiday, defaultStartYMD }) {
  const isEdit = !!holiday;
  const qc = useQueryClient();
  const [title, setTitle] = React.useState('');
  const [type, setType] = React.useState('HOLIDAY');
  const [start, setStart] = React.useState('');
  const [end, setEnd] = React.useState('');
  const [desc, setDesc] = React.useState('');

  React.useEffect(() => {
    if (!open) return;
    setTitle(holiday?.title || '');
    setType(holiday?.type || 'HOLIDAY');
    setStart(holiday?.startYMD || defaultStartYMD || '');
    setEnd(holiday?.endYMD || holiday?.startYMD || defaultStartYMD || '');
    setDesc(holiday?.description || '');
  }, [open, holiday, defaultStartYMD]);

  const saveMut = useMutation({
    mutationFn: () => {
      const payload = { title, type, startYMD: start, endYMD: end || start, description: desc };
      return isEdit ? api.put(`/holidays/${holiday.id}`, payload) : api.post('/holidays', payload);
    },
    onSuccess: () => {
      toast.success(isEdit ? 'Calendar entry updated' : 'Calendar entry added');
      qc.invalidateQueries({ queryKey: ['holidays'] });
      onOpenChange(false);
    },
    onError: (e) => toast.error(e?.message || 'Could not save'),
  });

  const delMut = useMutation({
    mutationFn: () => api.delete(`/holidays/${holiday.id}`),
    onSuccess: () => {
      toast.success('Calendar entry deleted');
      qc.invalidateQueries({ queryKey: ['holidays'] });
      onOpenChange(false);
    },
    onError: (e) => toast.error(e?.message || 'Could not delete'),
  });

  const submit = () => {
    if (!title.trim()) return toast.error('Add a title');
    if (!start) return toast.error('Pick a date');
    saveMut.mutate();
  };

  return (
    <AppDialog
      open={open}
      onOpenChange={onOpenChange}
      title={isEdit ? 'Edit calendar entry' : 'Add calendar entry'}
      footer={
        <>
          {isEdit ? (
            <Button variant="ghost" className="mr-auto text-destructive" onClick={() => delMut.mutate()} disabled={delMut.isPending}>
              <Trash2 className="size-4" /> Delete
            </Button>
          ) : null}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saveMut.isPending}>
            {saveMut.isPending ? 'Saving…' : isEdit ? 'Save' : 'Add'}
          </Button>
        </>
      }
    >
      <div className="max-h-[60vh] space-y-4 overflow-y-auto py-2">
        <div className="space-y-1.5">
          <Label htmlFor="h-title">Title</Label>
          <Input id="h-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Independence Day" className="bg-background/50" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="h-type">Type</Label>
          <Select value={type} onValueChange={setType}>
            <SelectTrigger id="h-type" className="w-full bg-background/50">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EVENT_TYPE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="h-start">From</Label>
            <Input
              id="h-start"
              type="date"
              value={start}
              onChange={(e) => {
                setStart(e.target.value);
                if (!end || end < e.target.value) setEnd(e.target.value);
              }}
              className="bg-background/50"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="h-end">To</Label>
            <Input id="h-end" type="date" value={end} min={start || undefined} onChange={(e) => setEnd(e.target.value)} className="bg-background/50" />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="h-desc">Description</Label>
          <Textarea id="h-desc" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Optional details…" className="bg-background/50" />
        </div>
      </div>
    </AppDialog>
  );
}

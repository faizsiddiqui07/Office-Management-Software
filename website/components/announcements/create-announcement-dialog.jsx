'use client';

import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
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
import { useRoleOptions } from '@/lib/use-roles';
import { PRIORITY_OPTIONS } from '@/lib/announcement';

export function CreateAnnouncementDialog({ announcement, open: openProp, onOpenChange }) {
  const isEdit = !!announcement;
  const qc = useQueryClient();
  const [openInternal, setOpenInternal] = React.useState(false);
  const open = openProp !== undefined ? openProp : openInternal;
  const setOpen = onOpenChange || setOpenInternal;

  const [title, setTitle] = React.useState('');
  const [body, setBody] = React.useState('');
  const [priority, setPriority] = React.useState('NORMAL');
  const [audience, setAudience] = React.useState([]); // empty = everyone
  const { data: roleOptions = [] } = useRoleOptions();

  React.useEffect(() => {
    if (open && isEdit) {
      setTitle(announcement.title || '');
      setBody(announcement.body || '');
      setPriority(announcement.priority || 'NORMAL');
      setAudience(announcement.audienceRoles || []);
    }
    if (open && !isEdit) {
      setTitle('');
      setBody('');
      setPriority('NORMAL');
      setAudience([]);
    }
  }, [open, isEdit, announcement]);

  const mut = useMutation({
    mutationFn: () => {
      const payload = { title, body, priority, audienceRoles: audience };
      return isEdit ? api.put(`/announcements/${announcement.id}`, payload) : api.post('/announcements', payload);
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
    mut.mutate();
  };

  const toggleRole = (r) =>
    setAudience((prev) => (prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]));

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
          <Textarea id="an-body" value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write the announcement…" className="min-h-28 bg-background/50" />
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
        <div className="space-y-1.5">
          <Label>Audience {audience.length === 0 ? '· Everyone' : ''}</Label>
          <div className="flex flex-wrap gap-1.5">
            {roleOptions.map((r) => (
              <button
                key={r.key}
                type="button"
                onClick={() => toggleRole(r.key)}
                className={cn(
                  'rounded-full px-2.5 py-1 text-xs font-medium ring-1 transition-colors',
                  audience.includes(r.key)
                    ? 'bg-primary/12 text-primary ring-primary/25'
                    : 'bg-muted/40 text-muted-foreground ring-border hover:text-foreground',
                )}
              >
                {r.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">Leave none selected to notify everyone.</p>
        </div>
      </div>
    </AppDialog>
  );
}

'use client';

import * as React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Tags, Plus, X } from 'lucide-react';
import { api } from '@/lib/api';
import { AppDialog } from '@/components/glass/app-dialog';
import { ConfirmDialog } from '@/components/glass/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function CategoryManager() {
  const qc = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const [label, setLabel] = React.useState('');
  const [removing, setRemoving] = React.useState(null); // category pending delete confirm

  const { data: meta } = useQuery({ queryKey: ['visitors', 'meta'], queryFn: () => api.get('/visitors/meta') });
  const categories = meta?.categories ?? [];

  const addMut = useMutation({
    mutationFn: () => api.post('/visitors/categories', { label: label.trim() }),
    onSuccess: () => {
      toast.success('Category added');
      setLabel('');
      qc.invalidateQueries({ queryKey: ['visitors', 'meta'] });
    },
    onError: (e) => toast.error(e?.message || 'Could not add category'),
  });

  const delMut = useMutation({
    mutationFn: (name) => api.delete(`/visitors/categories?name=${encodeURIComponent(name)}`),
    onSuccess: () => {
      toast.success('Category removed');
      setRemoving(null);
      qc.invalidateQueries({ queryKey: ['visitors', 'meta'] });
    },
    onError: (e) => toast.error(e?.message || 'Could not remove category'),
  });

  return (
    <AppDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button variant="outline" className="w-full sm:w-auto">
          <Tags className="size-4" /> Categories
        </Button>
      }
      title="Visitor categories"
      description="Add the categories your team logs entries against (e.g. Visitors, Finance)."
      footer={
        <Button variant="outline" onClick={() => setOpen(false)}>
          Done
        </Button>
      }
    >
      <div className="space-y-4 py-2">
        <div className="flex gap-2">
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && label.trim()) addMut.mutate();
            }}
            placeholder="New category…"
            className="bg-background/50"
          />
          <Button onClick={() => label.trim() && addMut.mutate()} disabled={addMut.isPending || !label.trim()} className="shrink-0">
            <Plus className="size-4" /> Add
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          {categories.map((c) => (
            <span key={c} className="inline-flex items-center gap-1.5 rounded-full bg-foreground/[0.06] py-1 pl-3 pr-1.5 text-sm ring-1 ring-border/50">
              {c}
              {categories.length > 1 ? (
                <button
                  type="button"
                  onClick={() => setRemoving(c)}
                  className="-m-1.5 rounded-full p-2 text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive"
                  aria-label={`Remove ${c}`}
                >
                  <X className="size-3.5" />
                </button>
              ) : null}
            </span>
          ))}
        </div>
      </div>

      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => (!o ? setRemoving(null) : null)}
        title={`Remove "${removing}"?`}
        description="Existing entries keep the label; new entries just won't offer it."
        tone="destructive"
        confirmLabel="Remove"
        loading={delMut.isPending}
        onConfirm={() => removing && delMut.mutate(removing)}
      />
    </AppDialog>
  );
}

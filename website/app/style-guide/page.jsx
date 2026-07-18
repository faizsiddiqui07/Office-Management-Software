'use client';

import * as React from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  CalendarClock,
  CalendarDays,
  Inbox,
  LayoutDashboard,
  Megaphone,
  Settings,
  Users,
  Wallet,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { ThemeToggle } from '@/components/theme-toggle';

import { GlassCard } from '@/components/glass/glass-card';
import { GlassPanel } from '@/components/glass/glass-panel';
import { StatCard } from '@/components/glass/stat-card';
import { PageHeader } from '@/components/glass/page-header';
import { StatusBadge } from '@/components/glass/status-badge';
import { EmptyState } from '@/components/glass/empty-state';
import { DataTable } from '@/components/glass/data-table';
import { AppDialog } from '@/components/glass/app-dialog';
import { ConfirmDialog } from '@/components/glass/confirm-dialog';
import {
  CardSkeleton,
  LoadingState,
  StatCardSkeleton,
  TableSkeleton,
} from '@/components/glass/skeletons';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

// Vengeance UI
import AnimatedButton from '@/components/ui/animated-button';
import { GlowBorderCard } from '@/components/ui/glow-border-card';
import { AnimatedRays } from '@/components/ui/animated-rays';
import { SpotlightNavbar } from '@/components/ui/spotlight-navbar';

/* ── helpers ─────────────────────────────────────────────── */

function Section({ title, description, children }) {
  return (
    <section className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

function Swatch({ name, className }) {
  return (
    <div className="space-y-1.5">
      <div className={cn('h-16 rounded-xl ring-1 ring-border/60', className)} />
      <p className="text-xs text-muted-foreground">{name}</p>
    </div>
  );
}

const demoData = [
  { name: 'Aarav Sharma', role: 'CEO', status: 'PRESENT', hours: '8h 12m' },
  { name: 'Priya Nair', role: 'Manager', status: 'LATE', hours: '7h 46m' },
  { name: 'Rahul Verma', role: 'Employee', status: 'ON_LEAVE', hours: '—' },
  { name: 'Sneha Iyer', role: 'Employee', status: 'PRESENT', hours: '8h 03m' },
  { name: 'Meera Joshi', role: 'Office Boy', status: 'PRESENT', hours: '8h 20m' },
];
const demoColumns = [
  { accessorKey: 'name', header: 'Name', cell: ({ row }) => <span className="font-medium">{row.original.name}</span> },
  { accessorKey: 'role', header: 'Role' },
  {
    accessorKey: 'status',
    header: 'Status',
    cell: ({ row }) => {
      const s = row.original.status;
      const tone = s === 'PRESENT' ? 'success' : s === 'LATE' ? 'warning' : 'info';
      return <StatusBadge tone={tone}>{s.replace('_', ' ')}</StatusBadge>;
    },
  },
  { accessorKey: 'hours', header: 'Hours', cell: ({ row }) => <span className="tabular-nums">{row.original.hours}</span> },
];

/* ── page ────────────────────────────────────────────────── */

export default function StyleGuidePage() {
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [confirmLoading, setConfirmLoading] = React.useState(false);

  return (
    <div className="min-h-dvh">
      {/* sticky header */}
      <header className="sticky top-0 z-30 px-4 pt-4 sm:px-6">
        <div className="glass glass-highlight mx-auto flex max-w-6xl items-center justify-between gap-3 rounded-2xl px-4 py-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary/80">Design system</p>
            <h1 className="text-lg font-semibold tracking-tight">Premium Apple Glass · Style Guide</h1>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/dashboard">
              <Button variant="outline" size="sm">
                Dashboard
              </Button>
            </Link>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl space-y-14 px-4 py-10 sm:px-6">
        <p className="text-sm text-muted-foreground">
          Toggle the theme (top-right) to QA every component in both light and dark. Everything below is a reusable
          building block for the app.
        </p>

        {/* Colors */}
        <Section title="Color & status tokens" description="Neutral glass base + a single calm indigo accent, plus semantic status colors.">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            <Swatch name="primary" className="bg-primary" />
            <Swatch name="success" className="bg-success" />
            <Swatch name="warning" className="bg-warning" />
            <Swatch name="info" className="bg-info" />
            <Swatch name="destructive" className="bg-destructive" />
            <Swatch name="muted" className="bg-muted" />
            <Swatch name="secondary" className="bg-secondary" />
            <Swatch name="accent" className="bg-accent" />
            <Swatch name="card" className="bg-card" />
            <Swatch name="glass" className="glass" />
            <Swatch name="glass-strong" className="glass-strong" />
            <Swatch name="glass-subtle" className="glass-subtle" />
          </div>
        </Section>

        {/* Typography */}
        <Section title="Typography" description="SF system stack first, Inter as the loaded fallback.">
          <GlassCard className="space-y-2 p-6">
            <h1 className="text-4xl font-semibold tracking-tight">Display heading</h1>
            <h2 className="text-2xl font-semibold tracking-tight">Section heading</h2>
            <h3 className="text-lg font-medium">Subsection heading</h3>
            <p className="text-base text-foreground/90">
              Body text — calm, spacious, and legible. The quick brown fox jumps over the lazy dog.
            </p>
            <p className="text-sm text-muted-foreground">Muted secondary text for hints and metadata.</p>
          </GlassCard>
        </Section>

        {/* Glass surfaces */}
        <Section title="Glass surfaces" description="GlassCard, GlassPanel and StatCard — the workhorse surfaces.">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <GlassCard className="p-6">
              <h3 className="font-medium">GlassCard</h3>
              <p className="mt-1 text-sm text-muted-foreground">Standard frosted surface.</p>
            </GlassCard>
            <GlassCard interactive className="p-6">
              <h3 className="font-medium">Interactive</h3>
              <p className="mt-1 text-sm text-muted-foreground">Hover me — lifts with a glow.</p>
            </GlassCard>
            <GlassPanel className="p-6">
              <h3 className="font-medium">GlassPanel</h3>
              <p className="mt-1 text-sm text-muted-foreground">Larger section surface.</p>
            </GlassPanel>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Present today" value="42" icon={Users} tone="success" trend={{ value: '+3', direction: 'up' }} hint="vs. yesterday" />
            <StatCard label="On leave" value="5" icon={Inbox} tone="info" hint="2 half-days" />
            <StatCard label="Pending" value="3" icon={Megaphone} tone="warning" />
            <StatCard label="Overtime" value="28h" icon={CalendarClock} tone="default" trend={{ value: '-1h', direction: 'down' }} />
          </div>
        </Section>

        {/* Buttons */}
        <Section title="Buttons" description="shadcn/ui buttons + the Vengeance UI animated button.">
          <GlassCard className="flex flex-wrap items-center gap-3 p-6">
            <Button>Default</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="destructive">Destructive</Button>
            <Button variant="link">Link</Button>
            <Separator orientation="vertical" className="h-6" />
            <AnimatedButton className="border-primary/40 bg-primary text-primary-foreground [--shine:rgba(255,255,255,.7)] dark:bg-primary dark:text-primary-foreground">
              Vengeance Animated
            </AnimatedButton>
          </GlassCard>
        </Section>

        {/* Badges */}
        <Section title="Badges & status" description="Badge variants and the glassy StatusBadge tones.">
          <GlassCard className="flex flex-wrap items-center gap-3 p-6">
            <Badge>Default</Badge>
            <Badge variant="secondary">Secondary</Badge>
            <Badge variant="outline">Outline</Badge>
            <Badge variant="destructive">Destructive</Badge>
            <Separator orientation="vertical" className="h-6" />
            <StatusBadge tone="success">Present</StatusBadge>
            <StatusBadge tone="warning">Late</StatusBadge>
            <StatusBadge tone="destructive">Absent</StatusBadge>
            <StatusBadge tone="info">On leave</StatusBadge>
            <StatusBadge tone="primary">Approved</StatusBadge>
            <StatusBadge tone="neutral">Cancelled</StatusBadge>
          </GlassCard>
        </Section>

        {/* Form controls */}
        <Section title="Form controls" description="Inputs, select, switch and tabs.">
          <GlassCard className="grid grid-cols-1 gap-6 p-6 md:grid-cols-2">
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="sg-name">Full name</Label>
                <Input id="sg-name" placeholder="Aarav Sharma" className="bg-background/50" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sg-role">Role</Label>
                <Select defaultValue="Employee">
                  <SelectTrigger id="sg-role" className="w-full bg-background/50">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CEO">CEO</SelectItem>
                    <SelectItem value="Manager">Manager</SelectItem>
                    <SelectItem value="Employee">Employee</SelectItem>
                    <SelectItem value="Office Boy">Office Boy</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sg-note">Notes</Label>
                <Textarea id="sg-note" placeholder="Add a note…" className="bg-background/50" />
              </div>
              <div className="flex items-center gap-3">
                <Switch id="sg-switch" defaultChecked />
                <Label htmlFor="sg-switch">Email notifications</Label>
              </div>
            </div>

            <div>
              <Tabs defaultValue="overview">
                <TabsList>
                  <TabsTrigger value="overview">Overview</TabsTrigger>
                  <TabsTrigger value="activity">Activity</TabsTrigger>
                  <TabsTrigger value="security">Security</TabsTrigger>
                </TabsList>
                <TabsContent value="overview" className="pt-4 text-sm text-muted-foreground">
                  Tabs use a smooth animated active indicator. This is the overview panel.
                </TabsContent>
                <TabsContent value="activity" className="pt-4 text-sm text-muted-foreground">
                  Recent activity would render here.
                </TabsContent>
                <TabsContent value="security" className="pt-4 text-sm text-muted-foreground">
                  Security settings would render here.
                </TabsContent>
              </Tabs>
            </div>
          </GlassCard>
        </Section>

        {/* Overlays */}
        <Section title="Overlays & feedback" description="Dialogs, confirm flow, tooltips and toasts.">
          <GlassCard className="flex flex-wrap items-center gap-3 p-6">
            <AppDialog
              trigger={<Button>Open dialog</Button>}
              title="Invite teammate"
              description="Send an invitation to join the workspace."
              footer={
                <>
                  <Button variant="outline">Cancel</Button>
                  <Button onClick={() => toast.success('Invitation sent (demo)')}>Send invite</Button>
                </>
              }
            >
              <div className="space-y-3 py-2">
                <div className="space-y-1.5">
                  <Label htmlFor="sg-invite">Email</Label>
                  <Input id="sg-invite" placeholder="name@company.com" className="bg-background/50" />
                </div>
              </div>
            </AppDialog>

            <Button variant="destructive" onClick={() => setConfirmOpen(true)}>
              Delete record
            </Button>

            <Tooltip>
              <TooltipTrigger render={<Button variant="outline">Hover for tooltip</Button>} />
              <TooltipContent>A glassy, accessible tooltip</TooltipContent>
            </Tooltip>

            <Button variant="secondary" onClick={() => toast.success('Saved successfully')}>
              Show toast
            </Button>
          </GlassCard>

          <ConfirmDialog
            open={confirmOpen}
            onOpenChange={setConfirmOpen}
            title="Delete this record?"
            description="This action cannot be undone. The record will be permanently removed."
            tone="destructive"
            confirmLabel="Delete"
            loading={confirmLoading}
            onConfirm={() => {
              setConfirmLoading(true);
              setTimeout(() => {
                setConfirmLoading(false);
                setConfirmOpen(false);
                toast.success('Record deleted (demo)');
              }, 800);
            }}
          />
        </Section>

        {/* Data */}
        <Section title="Data table" description="Sortable, filterable, paginated — the app's standard table.">
          <DataTable columns={demoColumns} data={demoData} searchPlaceholder="Search people…" pageSize={4} />
        </Section>

        {/* Empty & loading */}
        <Section title="Empty & loading states" description="Every data view ships with these.">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <EmptyState
              icon={Inbox}
              title="No requests yet"
              description="When teammates apply for leave, their requests will show up here."
              action={<Button size="sm">New request</Button>}
            />
            <GlassCard className="p-6">
              <LoadingState label="Loading attendance…" />
            </GlassCard>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCardSkeleton />
            <StatCardSkeleton />
            <CardSkeleton className="sm:col-span-2 lg:col-span-2" />
          </div>
          <TableSkeleton rows={4} cols={4} />
        </Section>

        {/* Vengeance UI */}
        <Section title="Vengeance UI" description="Premium animated components layered on top of the glass system.">
          <div className="space-y-6">
            <GlassPanel className="space-y-6 p-6">
              <div>
                <p className="mb-1 text-sm font-medium text-muted-foreground">Spotlight Navbar</p>
                <SpotlightNavbar
                  items={[
                    { label: 'Dashboard', href: '#' },
                    { label: 'Attendance', href: '#' },
                    { label: 'Leaves', href: '#' },
                    { label: 'Reports', href: '#' },
                  ]}
                />
              </div>
            </GlassPanel>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="flex items-center justify-center rounded-2xl p-6 ring-1 ring-border/60">
                <GlowBorderCard colorPreset="aurora" width="260px" aspectRatio="4/3" borderRadius="1rem">
                  <div className="text-center">
                    <p className="text-sm font-medium">Glow Border Card</p>
                    <p className="text-xs text-muted-foreground">Animated conic glow</p>
                  </div>
                </GlowBorderCard>
              </div>

              <div className="relative h-56 overflow-hidden rounded-2xl ring-1 ring-border/60">
                <AnimatedRays className="absolute inset-0">
                  <div className="text-center">
                    <p className="text-lg font-semibold">Animated Rays</p>
                    <p className="text-sm text-muted-foreground">Aurora background</p>
                  </div>
                </AnimatedRays>
              </div>
            </div>
          </div>
        </Section>

        <PageHeader
          eyebrow="That's everything"
          title="One coherent system"
          description="Built once, reused across every screen in the app."
        />
      </div>
    </div>
  );
}

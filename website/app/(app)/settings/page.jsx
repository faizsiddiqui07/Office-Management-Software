'use client';

import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { BellRing, Building2, CheckCircle2, Crosshair, ImageUp, KeyRound, Loader2, Mail, MapPin, Plus, Send, Settings, ShieldAlert, Trash2, X } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { SETTINGS_KEY } from '@/lib/settings';
import { downscaleImage } from '@/lib/image';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/glass/page-header';
import { GlassPanel } from '@/components/glass/glass-panel';
import { EmptyState } from '@/components/glass/empty-state';
import { LoadingState } from '@/components/glass/skeletons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function SettingsPage() {
  const { user } = useAuth();
  const allowed = !!user && can(user, 'manageSettings');
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: SETTINGS_KEY,
    queryFn: () => api.get('/settings'),
    enabled: allowed,
  });

  const [form, setForm] = React.useState(null);
  const [newCategory, setNewCategory] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [capturing, setCapturing] = React.useState(false);
  const [logoBusy, setLogoBusy] = React.useState(''); // '' | 'light' | 'dark'
  const lightInputRef = React.useRef(null);
  const darkInputRef = React.useRef(null);
  const [bgBusy, setBgBusy] = React.useState(''); // '' | 'light' | 'dark'
  const bgLightRef = React.useRef(null);
  const bgDarkRef = React.useRef(null);
  const [smtp, setSmtp] = React.useState({ smtpUser: '', smtpPass: '', smtpHost: '', smtpPort: '', currentPassword: '' });
  const [smtpSaving, setSmtpSaving] = React.useState(false);
  const [smtpTesting, setSmtpTesting] = React.useState(false);

  React.useEffect(() => {
    if (data?.settings) {
      const s = data.settings;
      setForm({
        companyName: s.companyName ?? '',
        brandColor: s.brandColor ?? '#4f46e5',
        timezone: 'Asia/Kolkata', // fixed to IST — not user-editable
        workStart: s.workStart ?? '10:00',
        workEnd: s.workEnd ?? '18:00',
        graceMinutes: s.graceMinutes ?? 0,
        weekendDays: [...(s.weekendDays ?? [0])],
        annualLeaveQuota: s.annualLeaveQuota ?? 18,
        currency: s.currency ?? 'INR',
        expenseCategories: [...(s.expenseCategories ?? [])],
        checkinAlerts: {
          enabled: s.checkinAlerts?.enabled !== false,
          onlyLate: s.checkinAlerts?.onlyLate === true,
        },
        gpsAttendance: {
          enabled: s.gpsAttendance?.enabled === true,
          latitude: s.gpsAttendance?.latitude ?? null,
          longitude: s.gpsAttendance?.longitude ?? null,
          radiusMeters: s.gpsAttendance?.radiusMeters ?? 200,
        },
      });
      // Email (SMTP): show the current sender/host/port; the password is
      // write-only so it's never loaded back into the form.
      setSmtp((prev) => ({
        ...prev,
        smtpUser: s.smtpUser ?? '',
        smtpHost: s.smtpHost ?? '',
        smtpPort: s.smtpPort ? String(s.smtpPort) : '',
      }));
    }
  }, [data]);

  if (!allowed) {
    return (
      <div className="space-y-8">
        <PageHeader eyebrow="Settings" title="Company settings" icon={Settings} />
        <EmptyState icon={ShieldAlert} title="No access" description="Only leadership (CEO / Boss) can change company settings." />
      </div>
    );
  }

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setGps = (k, v) => setForm((f) => ({ ...f, gpsAttendance: { ...f.gpsAttendance, [k]: v } }));

  const captureLocation = () => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      return toast.error('Location is not available on this device/browser');
    }
    setCapturing(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setForm((f) => ({
          ...f,
          gpsAttendance: {
            ...f.gpsAttendance,
            latitude: Number(pos.coords.latitude.toFixed(6)),
            longitude: Number(pos.coords.longitude.toFixed(6)),
          },
        }));
        setCapturing(false);
        toast.success('Office location captured');
      },
      (err) => {
        setCapturing(false);
        toast.error(err?.code === 1 ? 'Allow location access to capture' : 'Could not get your location — try again');
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 },
    );
  };

  const uploadLogo = (variant) => async (e) => {
    const input = e.target;
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) {
      toast.error('Logo must be under 4 MB');
      input.value = '';
      return;
    }
    setLogoBusy(variant);
    try {
      // Logos keep transparency → PNG; downscale so the stored image stays small.
      const dataUrl = await downscaleImage(file, { maxDim: 800, mime: 'image/png' });
      await api.post('/settings/logo', { dataUrl, variant });
      await queryClient.invalidateQueries({ queryKey: SETTINGS_KEY });
      toast.success(`${variant === 'light' ? 'Light' : 'Dark'} logo updated`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : err?.message || 'Could not upload logo');
    } finally {
      setLogoBusy('');
      input.value = '';
    }
  };

  const removeLogo = (variant) => async () => {
    setLogoBusy(variant);
    try {
      await api.delete(`/settings/logo?variant=${variant}`);
      await queryClient.invalidateQueries({ queryKey: SETTINGS_KEY });
      toast.success('Logo removed');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not remove logo');
    } finally {
      setLogoBusy('');
    }
  };

  const uploadBg = (variant) => async (e) => {
    const input = e.target;
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) {
      toast.error('Background must be under 8 MB');
      input.value = '';
      return;
    }
    setBgBusy(variant);
    try {
      // Backgrounds are photos → JPEG, downscaled to keep the stored image small.
      const dataUrl = await downscaleImage(file, { maxDim: 1920, mime: 'image/jpeg', quality: 0.82 });
      await api.post('/settings/background', { dataUrl, variant });
      await queryClient.invalidateQueries({ queryKey: SETTINGS_KEY });
      toast.success(`${variant === 'light' ? 'Light' : 'Dark'} background updated`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : err?.message || 'Could not upload background');
    } finally {
      setBgBusy('');
      input.value = '';
    }
  };

  const removeBg = (variant) => async () => {
    setBgBusy(variant);
    try {
      await api.delete(`/settings/background?variant=${variant}`);
      await queryClient.invalidateQueries({ queryKey: SETTINGS_KEY });
      toast.success('Background removed');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not remove background');
    } finally {
      setBgBusy('');
    }
  };

  const toggleWeekend = (d) =>
    setForm((f) => ({
      ...f,
      weekendDays: f.weekendDays.includes(d) ? f.weekendDays.filter((x) => x !== d) : [...f.weekendDays, d].sort(),
    }));

  const addCategory = () => {
    const c = newCategory.trim().toUpperCase().replace(/\s+/g, '_');
    if (!c) return;
    if (form.expenseCategories.includes(c)) return setNewCategory('');
    set('expenseCategories', [...form.expenseCategories, c]);
    setNewCategory('');
  };

  const save = async () => {
    setSaving(true);
    try {
      await api.put('/settings', {
        ...form,
        graceMinutes: Number(form.graceMinutes),
        annualLeaveQuota: Number(form.annualLeaveQuota),
        gpsAttendance: {
          enabled: !!form.gpsAttendance.enabled,
          latitude: form.gpsAttendance.latitude == null ? null : Number(form.gpsAttendance.latitude),
          longitude: form.gpsAttendance.longitude == null ? null : Number(form.gpsAttendance.longitude),
          radiusMeters: Number(form.gpsAttendance.radiusMeters) || 200,
        },
      });
      await queryClient.invalidateQueries({ queryKey: SETTINGS_KEY });
      toast.success('Settings saved — applied across the app');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not save settings');
    } finally {
      setSaving(false);
    }
  };

  const setS = (k, v) => setSmtp((f) => ({ ...f, [k]: v }));

  const saveSmtp = async () => {
    if (!smtp.smtpUser.trim()) return toast.error('Enter the sender email');
    if (!data?.settings?.smtpConfigured && !smtp.smtpPass) return toast.error('Enter the app password');
    if (!smtp.currentPassword) return toast.error('Enter your account password to confirm');
    setSmtpSaving(true);
    try {
      await api.put('/settings/smtp', {
        smtpUser: smtp.smtpUser.trim(),
        smtpPass: smtp.smtpPass || undefined,
        smtpHost: smtp.smtpHost.trim() || undefined,
        smtpPort: smtp.smtpPort ? Number(smtp.smtpPort) : undefined,
        currentPassword: smtp.currentPassword,
      });
      await queryClient.invalidateQueries({ queryKey: SETTINGS_KEY });
      setSmtp((f) => ({ ...f, smtpPass: '', currentPassword: '' }));
      toast.success('Email settings saved');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not save email settings');
    } finally {
      setSmtpSaving(false);
    }
  };

  const testEmail = async () => {
    setSmtpTesting(true);
    try {
      const res = await api.post('/settings/smtp/test', {});
      toast.success(`Test email sent to ${res?.to || 'your address'} — check your inbox (and spam)`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not send the test email');
    } finally {
      setSmtpTesting(false);
    }
  };

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Settings"
        title="Company settings"
        icon={Settings}
        description="These values drive attendance, leave, and expense rules everywhere."
      />

      {isLoading || !form ? (
        <LoadingState label="Loading settings…" />
      ) : (
        <>
          <GlassPanel className="space-y-5 p-6">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Building2 className="size-4 text-primary" /> Organisation
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="s-name">Company name</Label>
                <Input id="s-name" value={form.companyName} onChange={(e) => set('companyName', e.target.value)} className="bg-background/50" />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="s-brand">Brand color</Label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    aria-label="Brand color swatch"
                    value={form.brandColor}
                    onChange={(e) => set('brandColor', e.target.value)}
                    className="h-9 w-12 cursor-pointer rounded-lg border border-input bg-transparent p-1"
                  />
                  <Input id="s-brand" value={form.brandColor} onChange={(e) => set('brandColor', e.target.value)} className="max-w-[140px] bg-background/50" />
                </div>
                <p className="text-xs text-muted-foreground">Used to theme your PDF reports — set it to match your uploaded logo.</p>
              </div>
              <div className="space-y-3 sm:col-span-2">
                <div>
                  <Label>Company logo</Label>
                  <p className="text-xs text-muted-foreground">
                    Upload separate logos for light and dark mode — a white/light logo for dark backgrounds, a dark/coloured one for light backgrounds. Shown in the header and on PDF reports.
                  </p>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {/* Light-mode logo */}
                  <div className="space-y-2 rounded-xl bg-foreground/[0.03] p-3 ring-1 ring-border/50">
                    <p className="text-xs font-medium text-foreground/80">Light mode</p>
                    <div className="flex h-14 items-center justify-center rounded-md bg-white p-2 ring-1 ring-border">
                      {data?.settings?.logoLight ? (
                        <img src={data.settings.logoLight} alt="Light-mode logo" className="max-h-10 w-auto max-w-full object-contain" />
                      ) : (
                        <span className="text-xs text-muted-foreground">No light logo</span>
                      )}
                    </div>
                    <input ref={lightInputRef} type="file" accept="image/png,image/jpeg,image/jpg,image/webp,image/svg+xml" onChange={uploadLogo('light')} className="hidden" />
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" size="sm" variant="outline" onClick={() => lightInputRef.current?.click()} disabled={logoBusy === 'light'}>
                        <ImageUp className="size-4" /> {logoBusy === 'light' ? 'Uploading…' : 'Upload'}
                      </Button>
                      {data?.settings?.logoLight ? (
                        <Button type="button" size="sm" variant="ghost" onClick={removeLogo('light')} disabled={logoBusy === 'light'} className="text-destructive">
                          <Trash2 className="size-4" /> Remove
                        </Button>
                      ) : null}
                    </div>
                  </div>
                  {/* Dark-mode logo */}
                  <div className="space-y-2 rounded-xl bg-foreground/[0.03] p-3 ring-1 ring-border/50">
                    <p className="text-xs font-medium text-foreground/80">Dark mode</p>
                    <div className="flex h-14 items-center justify-center rounded-md bg-neutral-900 p-2 ring-1 ring-border">
                      {data?.settings?.logoDark ? (
                        <img src={data.settings.logoDark} alt="Dark-mode logo" className="max-h-10 w-auto max-w-full object-contain" />
                      ) : (
                        <span className="text-xs text-neutral-400">No dark logo</span>
                      )}
                    </div>
                    <input ref={darkInputRef} type="file" accept="image/png,image/jpeg,image/jpg,image/webp,image/svg+xml" onChange={uploadLogo('dark')} className="hidden" />
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" size="sm" variant="outline" onClick={() => darkInputRef.current?.click()} disabled={logoBusy === 'dark'}>
                        <ImageUp className="size-4" /> {logoBusy === 'dark' ? 'Uploading…' : 'Upload'}
                      </Button>
                      {data?.settings?.logoDark ? (
                        <Button type="button" size="sm" variant="ghost" onClick={removeLogo('dark')} disabled={logoBusy === 'dark'} className="text-destructive">
                          <Trash2 className="size-4" /> Remove
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
              <div className="space-y-3 sm:col-span-2">
                <div>
                  <Label>Background image</Label>
                  <p className="text-xs text-muted-foreground">
                    Optional — a photo shown behind the app, with separate versions for light and dark mode. Leave empty to use the default ambient background.
                  </p>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {/* Light-mode background */}
                  <div className="space-y-2 rounded-xl bg-foreground/[0.03] p-3 ring-1 ring-border/50">
                    <p className="text-xs font-medium text-foreground/80">Light mode</p>
                    <div className="h-16 w-full overflow-hidden rounded-md ring-1 ring-border">
                      {data?.settings?.bgLight ? (
                        <img src={data.settings.bgLight} alt="Light-mode background" className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center bg-white">
                          <span className="text-xs text-muted-foreground">No light background</span>
                        </div>
                      )}
                    </div>
                    <input ref={bgLightRef} type="file" accept="image/png,image/jpeg,image/jpg,image/webp" onChange={uploadBg('light')} className="hidden" />
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" size="sm" variant="outline" onClick={() => bgLightRef.current?.click()} disabled={bgBusy === 'light'}>
                        <ImageUp className="size-4" /> {bgBusy === 'light' ? 'Uploading…' : 'Upload'}
                      </Button>
                      {data?.settings?.bgLight ? (
                        <Button type="button" size="sm" variant="ghost" onClick={removeBg('light')} disabled={bgBusy === 'light'} className="text-destructive">
                          <Trash2 className="size-4" /> Remove
                        </Button>
                      ) : null}
                    </div>
                  </div>
                  {/* Dark-mode background */}
                  <div className="space-y-2 rounded-xl bg-foreground/[0.03] p-3 ring-1 ring-border/50">
                    <p className="text-xs font-medium text-foreground/80">Dark mode</p>
                    <div className="h-16 w-full overflow-hidden rounded-md ring-1 ring-border">
                      {data?.settings?.bgDark ? (
                        <img src={data.settings.bgDark} alt="Dark-mode background" className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center bg-neutral-900">
                          <span className="text-xs text-neutral-400">No dark background</span>
                        </div>
                      )}
                    </div>
                    <input ref={bgDarkRef} type="file" accept="image/png,image/jpeg,image/jpg,image/webp" onChange={uploadBg('dark')} className="hidden" />
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" size="sm" variant="outline" onClick={() => bgDarkRef.current?.click()} disabled={bgBusy === 'dark'}>
                        <ImageUp className="size-4" /> {bgBusy === 'dark' ? 'Uploading…' : 'Upload'}
                      </Button>
                      {data?.settings?.bgDark ? (
                        <Button type="button" size="sm" variant="ghost" onClick={removeBg('dark')} disabled={bgBusy === 'dark'} className="text-destructive">
                          <Trash2 className="size-4" /> Remove
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="s-tz">Timezone</Label>
                <Input id="s-tz" value="IST" disabled readOnly className="bg-background/50 cursor-not-allowed opacity-80" />
                <p className="text-xs text-muted-foreground">Fixed to India Standard Time (Asia/Kolkata).</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="s-cur">Currency</Label>
                <Input id="s-cur" value={form.currency} onChange={(e) => set('currency', e.target.value.toUpperCase())} className="bg-background/50" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="s-quota">Annual leave quota (days)</Label>
                <Input id="s-quota" type="number" min={0} max={365} value={form.annualLeaveQuota} onChange={(e) => set('annualLeaveQuota', e.target.value)} className="bg-background/50" />
              </div>
            </div>
          </GlassPanel>

          <GlassPanel className="space-y-5 p-6">
            <div className="text-sm font-semibold">Work hours</div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="s-start">Work start</Label>
                <Input id="s-start" type="time" value={form.workStart} onChange={(e) => set('workStart', e.target.value)} className="bg-background/50" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="s-end">Work end</Label>
                <Input id="s-end" type="time" value={form.workEnd} onChange={(e) => set('workEnd', e.target.value)} className="bg-background/50" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="s-grace">Grace period (minutes)</Label>
                <Input id="s-grace" type="number" min={0} max={180} value={form.graceMinutes} onChange={(e) => set('graceMinutes', e.target.value)} className="bg-background/50" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Weekend days</Label>
              <div className="flex flex-wrap gap-2">
                {DAYS.map((d, i) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => toggleWeekend(i)}
                    className={cn(
                      'rounded-full px-3.5 py-1.5 text-xs font-medium ring-1 transition-colors',
                      form.weekendDays.includes(i)
                        ? 'bg-primary/12 text-primary ring-primary/25'
                        : 'bg-muted/40 text-muted-foreground ring-border hover:text-foreground',
                    )}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>
          </GlassPanel>

          <GlassPanel className="space-y-4 p-6">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <BellRing className="size-4 text-primary" /> Check-in alerts
            </div>
            <p className="text-sm text-muted-foreground">
              Notify leadership in the notification bell when an employee checks in.
            </p>
            <div className="flex items-center justify-between gap-4 rounded-xl bg-muted/30 px-4 py-3 ring-1 ring-border">
              <div className="min-w-0 space-y-0.5">
                <p className="text-sm font-medium">Enable check-in alerts</p>
                <p className="text-xs text-muted-foreground">Boss / CEO get an in-app alert each time someone checks in.</p>
              </div>
              <Switch
                checked={form.checkinAlerts.enabled}
                onCheckedChange={(v) => setForm((f) => ({ ...f, checkinAlerts: { ...f.checkinAlerts, enabled: v } }))}
              />
            </div>
            <div
              className={cn(
                'flex items-center justify-between gap-4 rounded-xl bg-muted/30 px-4 py-3 ring-1 ring-border transition-opacity',
                !form.checkinAlerts.enabled && 'pointer-events-none opacity-50',
              )}
            >
              <div className="min-w-0 space-y-0.5">
                <p className="text-sm font-medium">Only late arrivals</p>
                <p className="text-xs text-muted-foreground">Alert only when someone is late — avoids a ping for every check-in.</p>
              </div>
              <Switch
                checked={form.checkinAlerts.onlyLate}
                onCheckedChange={(v) => setForm((f) => ({ ...f, checkinAlerts: { ...f.checkinAlerts, onlyLate: v } }))}
              />
            </div>
          </GlassPanel>

          <GlassPanel className="space-y-4 p-6">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <MapPin className="size-4 text-primary" /> GPS attendance
            </div>
            <p className="text-sm text-muted-foreground">
              When on, employees can only check in/out within {form.gpsAttendance.radiusMeters}m of the office.
            </p>
            <div className="flex items-center justify-between gap-4 rounded-xl bg-muted/30 px-4 py-3 ring-1 ring-border">
              <div className="min-w-0 space-y-0.5">
                <p className="text-sm font-medium">Require location at the office</p>
                <p className="text-xs text-muted-foreground">Strict — check-in is blocked outside the office radius.</p>
              </div>
              <Switch checked={form.gpsAttendance.enabled} onCheckedChange={(v) => setGps('enabled', v)} />
            </div>
            <div className={cn('space-y-4', !form.gpsAttendance.enabled && 'pointer-events-none opacity-50')}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div className="space-y-1">
                  <Label>Office location</Label>
                  <p className="text-sm text-muted-foreground">
                    {form.gpsAttendance.latitude != null && form.gpsAttendance.longitude != null
                      ? `Set at ${form.gpsAttendance.latitude}, ${form.gpsAttendance.longitude}`
                      : 'Not set — stand at the office and capture it.'}
                  </p>
                </div>
                <Button type="button" variant="outline" onClick={captureLocation} disabled={capturing} className="w-full sm:w-auto">
                  {capturing ? <Loader2 className="size-4 animate-spin" /> : <Crosshair className="size-4" />} Capture current location
                </Button>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="s-radius">Allowed radius (metres)</Label>
                <Input
                  id="s-radius"
                  type="number"
                  min={10}
                  max={5000}
                  value={form.gpsAttendance.radiusMeters}
                  onChange={(e) => setGps('radiusMeters', e.target.value)}
                  className="w-full bg-background/50 sm:max-w-[200px]"
                />
              </div>
              {form.gpsAttendance.enabled && (form.gpsAttendance.latitude == null || form.gpsAttendance.longitude == null) ? (
                <p className="text-xs font-medium text-amber-600 dark:text-amber-300">
                  ⚠ Capture the office location — without it, GPS won’t be enforced.
                </p>
              ) : null}
            </div>
          </GlassPanel>

          <GlassPanel className="space-y-4 p-6">
            <div className="text-sm font-semibold">Expense categories</div>
            <div className="flex flex-wrap gap-2">
              {form.expenseCategories.map((c) => (
                <span key={c} className="inline-flex items-center gap-1.5 rounded-full bg-muted/50 px-3 py-1.5 text-xs font-medium ring-1 ring-border">
                  {c}
                  <button type="button" onClick={() => set('expenseCategories', form.expenseCategories.filter((x) => x !== c))} className="text-muted-foreground hover:text-destructive">
                    <X className="size-3.5" />
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <Input
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCategory(); } }}
                placeholder="Add a category…"
                className="max-w-xs bg-background/50"
              />
              <Button type="button" variant="outline" onClick={addCategory} className="shrink-0">
                <Plus className="size-4" /> Add
              </Button>
            </div>
          </GlassPanel>

          <GlassPanel className="space-y-5 p-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Mail className="size-4 text-primary" /> Email (SMTP)
              </div>
              {data?.settings?.smtpConfigured ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/12 px-2.5 py-1 text-xs font-medium text-emerald-600 ring-1 ring-emerald-500/25 dark:text-emerald-300">
                  <CheckCircle2 className="size-3.5" /> Configured
                </span>
              ) : (
                <span className="rounded-full bg-muted/50 px-2.5 py-1 text-xs font-medium text-muted-foreground ring-1 ring-border">
                  Using server default
                </span>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              The account used to send password-reset and system emails. For Gmail, use a{' '}
              <a
                href="https://myaccount.google.com/apppasswords"
                target="_blank"
                rel="noreferrer"
                className="text-primary underline underline-offset-2"
              >
                16-character App Password
              </a>{' '}
              — not your normal Gmail password.
            </p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="smtp-user">Sender email</Label>
                <Input id="smtp-user" type="email" autoComplete="off" placeholder="you@gmail.com" value={smtp.smtpUser} onChange={(e) => setS('smtpUser', e.target.value)} className="bg-background/50" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="smtp-pass">App password</Label>
                <Input
                  id="smtp-pass"
                  type="password"
                  autoComplete="new-password"
                  placeholder={data?.settings?.smtpConfigured ? '•••••••• (leave blank to keep)' : '16-char app password'}
                  value={smtp.smtpPass}
                  onChange={(e) => setS('smtpPass', e.target.value)}
                  className="bg-background/50"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="smtp-host">SMTP host <span className="font-normal text-muted-foreground">(optional)</span></Label>
                <Input id="smtp-host" autoComplete="off" placeholder="smtp.gmail.com" value={smtp.smtpHost} onChange={(e) => setS('smtpHost', e.target.value)} className="bg-background/50" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="smtp-port">Port <span className="font-normal text-muted-foreground">(optional)</span></Label>
                <Input id="smtp-port" type="number" placeholder="587" value={smtp.smtpPort} onChange={(e) => setS('smtpPort', e.target.value)} className="bg-background/50" />
              </div>
            </div>
            <div className="space-y-1.5 rounded-xl bg-amber-500/[0.06] p-3 ring-1 ring-amber-500/20">
              <Label htmlFor="smtp-confirm" className="flex items-center gap-1.5"><KeyRound className="size-3.5" /> Confirm with your account password</Label>
              <Input id="smtp-confirm" type="password" autoComplete="current-password" placeholder="Your login password" value={smtp.currentPassword} onChange={(e) => setS('currentPassword', e.target.value)} className="max-w-xs bg-background/50" />
              <p className="text-xs text-muted-foreground">Required to change email settings. The app password is stored encrypted and never shown again.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" onClick={saveSmtp} disabled={smtpSaving}>
                {smtpSaving ? <Loader2 className="size-4 animate-spin" /> : null} Save email settings
              </Button>
              <Button type="button" variant="outline" onClick={testEmail} disabled={smtpTesting}>
                {smtpTesting ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />} Send test email
              </Button>
              <span className="text-xs text-muted-foreground">Test goes to {user?.email || 'your address'}</span>
            </div>
          </GlassPanel>

          <div className="flex justify-end">
            <Button onClick={save} disabled={saving} className="h-10">
              {saving ? <Loader2 className="size-4 animate-spin" /> : null} Save settings
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

'use client';

import * as React from 'react';
import { useTheme } from 'next-themes';
import { toast } from 'sonner';
import { Camera, CircleUser, KeyRound, Loader2, Monitor, Moon, Sun, Trash2, UserCog } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { roleName } from '@/lib/permissions';
import { downscaleImage } from '@/lib/image';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/glass/page-header';
import { GlassPanel } from '@/components/glass/glass-panel';
import { NotificationsCard } from '@/components/pwa/notifications-card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { Label } from '@/components/ui/label';

function initialsOf(name = '') {
  return name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();
}

export default function ProfilePage() {
  const { user, refresh } = useAuth();
  const { theme, setTheme } = useTheme();

  const [form, setForm] = React.useState({ name: '', phone: '', avatarUrl: '' });
  const [savingProfile, setSavingProfile] = React.useState(false);
  const [photoBusy, setPhotoBusy] = React.useState(false);
  const photoRef = React.useRef(null);
  const [pwd, setPwd] = React.useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [savingPwd, setSavingPwd] = React.useState(false);

  React.useEffect(() => {
    if (user) setForm({ name: user.name ?? '', phone: user.phone ?? '', avatarUrl: user.avatarUrl ?? '' });
  }, [user]);

  if (!user) return null;

  const saveProfile = async (e) => {
    e.preventDefault();
    setSavingProfile(true);
    try {
      await api.patch('/auth/profile', form);
      await refresh();
      toast.success('Profile updated');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not update profile');
    } finally {
      setSavingProfile(false);
    }
  };

  const pickPhoto = async (e) => {
    const input = e.target;
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) {
      toast.error('Photo must be under 8 MB');
      input.value = '';
      return;
    }
    setPhotoBusy(true);
    try {
      // Downscale to a small square-ish avatar and store as a data-URL.
      const dataUrl = await downscaleImage(file, { maxDim: 256, mime: 'image/jpeg', quality: 0.85 });
      await api.patch('/auth/profile', { avatarUrl: dataUrl });
      setForm((f) => ({ ...f, avatarUrl: dataUrl }));
      await refresh();
      toast.success('Photo updated');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not update the photo');
    } finally {
      setPhotoBusy(false);
      input.value = '';
    }
  };

  const removePhoto = async () => {
    setPhotoBusy(true);
    try {
      await api.patch('/auth/profile', { avatarUrl: '' });
      setForm((f) => ({ ...f, avatarUrl: '' }));
      await refresh();
      toast.success('Photo removed');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not remove the photo');
    } finally {
      setPhotoBusy(false);
    }
  };

  const changePassword = async (e) => {
    e.preventDefault();
    if (pwd.newPassword.length < 8) return toast.error('New password must be at least 8 characters');
    if (pwd.newPassword !== pwd.confirm) return toast.error('New passwords do not match');
    setSavingPwd(true);
    try {
      await api.post('/auth/change-password', {
        currentPassword: pwd.currentPassword,
        newPassword: pwd.newPassword,
      });
      setPwd({ currentPassword: '', newPassword: '', confirm: '' });
      toast.success('Password changed');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not change password');
    } finally {
      setSavingPwd(false);
    }
  };

  const themes = [
    { value: 'light', label: 'Light', icon: Sun },
    { value: 'dark', label: 'Dark', icon: Moon },
    { value: 'system', label: 'System', icon: Monitor },
  ];

  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Account" title="Profile & settings" icon={UserCog} description="Manage your personal details, password, and appearance." />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Profile */}
        <GlassPanel className="space-y-5 p-6 lg:col-span-2">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <CircleUser className="size-4 text-primary" /> Your profile
          </div>
          <form onSubmit={saveProfile} className="space-y-5">
            <div className="flex flex-wrap items-center gap-4">
              {/* Tap the photo to change it. */}
              <button
                type="button"
                onClick={() => photoRef.current?.click()}
                disabled={photoBusy}
                className="group relative shrink-0 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="Change photo"
              >
                <Avatar className="size-16">
                  {form.avatarUrl ? <AvatarImage src={form.avatarUrl} alt={form.name} /> : null}
                  <AvatarFallback className="text-lg">{initialsOf(form.name || user.name)}</AvatarFallback>
                </Avatar>
                <span className="absolute -bottom-0.5 -right-0.5 flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground ring-2 ring-background">
                  {photoBusy ? <Loader2 className="size-3.5 animate-spin" /> : <Camera className="size-3.5" />}
                </span>
              </button>
              <input ref={photoRef} type="file" accept="image/*" onChange={pickPhoto} className="hidden" />
              <div className="min-w-0 text-sm">
                <p className="font-medium">{user.name}</p>
                <p className="text-muted-foreground">{roleName(user)} · {user.employeeId}</p>
                <div className="mt-1 flex flex-wrap gap-2">
                  <Button type="button" size="sm" variant="outline" onClick={() => photoRef.current?.click()} disabled={photoBusy}>
                    <Camera className="size-3.5" /> {form.avatarUrl ? 'Change photo' : 'Add photo'}
                  </Button>
                  {form.avatarUrl ? (
                    <Button type="button" size="sm" variant="ghost" className="text-destructive" onClick={removePhoto} disabled={photoBusy}>
                      <Trash2 className="size-3.5" /> Remove
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="p-name">Full name</Label>
                <Input id="p-name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className="bg-background/50" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="p-email">Email</Label>
                <Input id="p-email" value={user.email} disabled className="bg-muted/40" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="p-phone">Phone</Label>
                <Input id="p-phone" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} placeholder="+91 …" className="bg-background/50" />
              </div>
            </div>

            <div className="flex justify-end">
              <Button type="submit" disabled={savingProfile}>
                {savingProfile ? <Loader2 className="size-4 animate-spin" /> : null} Save changes
              </Button>
            </div>
          </form>
        </GlassPanel>

        {/* Appearance */}
        <GlassPanel className="space-y-4 p-6">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Monitor className="size-4 text-primary" /> Appearance
          </div>
          <p className="text-sm text-muted-foreground">Choose how the app looks on this device.</p>
          <div className="space-y-2">
            {themes.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => setTheme(t.value)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium ring-1 transition-colors',
                  theme === t.value ? 'bg-primary/12 text-primary ring-primary/25' : 'glass ring-border hover:bg-muted/40',
                )}
              >
                <t.icon className="size-4" /> {t.label}
                {theme === t.value ? <span className="ml-auto text-xs">Active</span> : null}
              </button>
            ))}
          </div>
        </GlassPanel>
      </div>

      {/* Password */}
      <GlassPanel className="space-y-5 p-6">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <KeyRound className="size-4 text-primary" /> Change password
        </div>
        <form onSubmit={changePassword} className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="cur">Current password</Label>
            <PasswordInput id="cur" value={pwd.currentPassword} onChange={(e) => setPwd((p) => ({ ...p, currentPassword: e.target.value }))} required className="bg-background/50" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new">New password</Label>
            <PasswordInput id="new" value={pwd.newPassword} onChange={(e) => setPwd((p) => ({ ...p, newPassword: e.target.value }))} required className="bg-background/50" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="conf">Confirm new password</Label>
            <PasswordInput id="conf" value={pwd.confirm} onChange={(e) => setPwd((p) => ({ ...p, confirm: e.target.value }))} required className="bg-background/50" />
          </div>
          <div className="sm:col-span-3 flex justify-end">
            <Button type="submit" variant="outline" disabled={savingPwd}>
              {savingPwd ? <Loader2 className="size-4 animate-spin" /> : null} Update password
            </Button>
          </div>
        </form>
      </GlassPanel>

      <NotificationsCard />
    </div>
  );
}

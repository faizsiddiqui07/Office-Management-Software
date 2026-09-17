'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { Camera, Loader2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { AvatarCropper } from './avatar-cropper';

/**
 * "Apni profile photo lagao" — ek baar ka modal, har us bande ke liye jiski photo nahi
 * hai. Naya employee password set karte hi yahi sabse pehle dekhta hai (AppShell me
 * ForcePasswordChange ke baad shell mount hota hai, aur ye uske saath).
 *
 * Kab dikhta hai: user.avatarUrl khaali ho AUR usne pichhle 7 din me "Skip for now"
 * na dabaya ho. Skip ka nishaan SERVER par hai (avatarPromptSkippedAt) — localStorage
 * par nahi — taaki phone par skip kiya to laptop par dobara na tange, aur 7 din baad ek
 * baar phir yaad dila de. Owner "ek baar" chahta hai; 7 din ka dohraav is liye ki skip
 * "abhi nahi" hai, "kabhi nahi" nahi. Ek line se badal sakta hai (SKIP_DAYS).
 *
 * Photo isi modal me chunti aur crop hoti hai — kahin aur bhejne ki zaroorat nahi.
 */
const SKIP_DAYS = 7;

function initialsOf(name = '') {
  return name.split(' ').filter(Boolean).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
}

function skippedRecently(iso) {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) && Date.now() - t < SKIP_DAYS * 24 * 60 * 60 * 1000;
}

export function ProfilePhotoPrompt() {
  const { user, refresh } = useAuth();
  const [file, setFile] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [closed, setClosed] = React.useState(false); // isi session me save/skip ke baad turant band
  const inputRef = React.useRef(null);

  const show = !!user && !closed && !user.avatarUrl && !skippedRecently(user.avatarPromptSkippedAt);

  const pick = (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (f.size > 12 * 1024 * 1024) { toast.error('Photo must be under 12 MB'); return; }
    setFile(f);
  };

  const save = async (dataUrl) => {
    setBusy(true);
    try {
      await api.patch('/auth/profile', { avatarUrl: dataUrl });
      setClosed(true);
      await refresh();
      toast.success('Profile photo set');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not save the photo');
    } finally {
      setBusy(false);
    }
  };

  const skip = async () => {
    setBusy(true);
    try {
      await api.patch('/auth/profile', { skipAvatarPrompt: true });
      setClosed(true);
      await refresh();
    } catch {
      setClosed(true); // server na maane to bhi is session me tang mat karo
    } finally {
      setBusy(false);
    }
  };

  if (!show) return null;

  return (
    <Dialog open onOpenChange={() => {}}>
      <DialogContent showCloseButton={false} className="sm:max-w-md">
        {file ? (
          <>
            <DialogTitle>Adjust your photo</DialogTitle>
            <DialogDescription>Fit your face inside the circle.</DialogDescription>
            <AvatarCropper file={file} onDone={save} onCancel={() => setFile(null)} busy={busy} />
          </>
        ) : (
          <>
            <div className="flex flex-col items-center gap-4 pt-2 text-center">
              <div className="relative">
                <Avatar className="size-24 ring-4 ring-primary/20">
                  <AvatarFallback className="text-2xl">{initialsOf(user.name)}</AvatarFallback>
                </Avatar>
                <span className="absolute -bottom-1 -right-1 grid size-8 place-items-center rounded-full bg-primary text-primary-foreground ring-4 ring-background">
                  <Camera className="size-4" />
                </span>
              </div>
              <div>
                <DialogTitle className="text-lg">Add your profile photo</DialogTitle>
                <DialogDescription className="mt-1">
                  Your colleagues see it in chat and on the team page. It takes ten seconds.
                </DialogDescription>
              </div>
            </div>
            <input ref={inputRef} type="file" accept="image/*" onChange={pick} className="hidden" />
            <div className="mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="ghost" onClick={skip} disabled={busy}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : null} Skip for now
              </Button>
              <Button type="button" onClick={() => inputRef.current?.click()} disabled={busy}>
                <Camera className="size-4" /> Choose photo
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

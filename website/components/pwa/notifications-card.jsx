'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { Bell, BellRing, Check, Download, Loader2, Share } from 'lucide-react';
import { GlassPanel } from '@/components/glass/glass-panel';
import { Button } from '@/components/ui/button';
import { enablePush, pushSupported, notificationPermission, canInstall, promptInstall } from '@/lib/pwa';

export function NotificationsCard() {
  const [perm, setPerm] = React.useState('default');
  const [busy, setBusy] = React.useState(false);
  const [installable, setInstallable] = React.useState(false);
  const [installed, setInstalled] = React.useState(false);
  const [isIOS, setIsIOS] = React.useState(false);

  React.useEffect(() => {
    setPerm(notificationPermission());
    setInstallable(canInstall());

    // "Am I running INSIDE the installed app?" — which is NOT the same question as
    // "is this app installed on this device?". Using the first to answer the second is
    // what made a plain browser tab on a fresh machine claim it was already installed.
    // It is now only ever a hint, and `installable` below overrules it.
    const mq = typeof window !== 'undefined' ? window.matchMedia?.('(display-mode: standalone)') : null;
    const readStandalone = () =>
      !!(mq?.matches || (typeof navigator !== 'undefined' && navigator.standalone === true));
    setInstalled(readStandalone());
    // Re-read when the window changes mode (opened from the installed app, or back out to
    // a tab). It used to be checked once on mount and never again.
    const onMode = () => setInstalled(readStandalone());
    mq?.addEventListener?.('change', onMode);

    // iOS Safari never fires beforeinstallprompt — install is manual there.
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
    setIsIOS(/iphone|ipad|ipod/i.test(ua) && !/crios|fxios/i.test(ua));

    const onInstallable = () => setInstallable(true);
    const onInstalled = () => {
      setInstalled(true);
      setInstallable(false);
    };
    window.addEventListener('pwa-installable', onInstallable);
    window.addEventListener('appinstalled', onInstalled);
    window.addEventListener('pwa-installed', onInstalled);
    return () => {
      mq?.removeEventListener?.('change', onMode);
      window.removeEventListener('pwa-installable', onInstallable);
      window.removeEventListener('appinstalled', onInstalled);
      window.removeEventListener('pwa-installed', onInstalled);
    };
  }, []);

  const supported = pushSupported();

  const enable = async () => {
    setBusy(true);
    try {
      await enablePush();
      setPerm('granted');
      toast.success('Push notifications enabled on this device');
    } catch (e) {
      toast.error(e?.message || 'Could not enable notifications');
      setPerm(notificationPermission());
    } finally {
      setBusy(false);
    }
  };

  const install = async () => {
    const ok = await promptInstall();
    if (ok) {
      toast.success('Installing…');
      setInstallable(false);
    }
  };

  // The browser only offers an install when the app is NOT already on this device, so a
  // live offer settles it — whatever the display-mode said. Without this the card could
  // show a green "Installed" badge and hide the button on a machine where it was never
  // installed, which is exactly what happened on a second/third device.
  const reallyInstalled = installed && !installable;

  const installHint = reallyInstalled
    ? 'Installed on this device.'
    : installable
      ? 'Add the app to your home screen for quick, full-screen access.'
      : isIOS
        ? 'On iPhone/iPad: tap the Share icon, then “Add to Home Screen”.'
        : 'Not installed on this device. In your browser menu (⋮), choose “Install app” — or look for the install icon in the address bar.';

  return (
    <GlassPanel className="space-y-4 p-6">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <BellRing className="size-4 text-primary" /> Notifications & app
      </div>

      <div className="flex flex-col gap-3 rounded-xl bg-muted/30 px-4 py-3 ring-1 ring-border sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-0.5">
          <p className="text-sm font-medium">Push notifications</p>
          <p className="text-xs text-muted-foreground">
            {!supported
              ? 'Not supported on this browser.'
              : perm === 'granted'
                ? 'On — you’ll get alerts even when the app is closed.'
                : perm === 'denied'
                  ? 'Blocked in your browser settings — allow it there to enable.'
                  : 'Get alerts on this device for check-ins, leaves, dues and more.'}
          </p>
        </div>
        <Button
          onClick={enable}
          disabled={!supported || busy || perm === 'granted' || perm === 'denied'}
          variant="outline"
          className="w-full sm:w-auto"
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Bell className="size-4" />}
          {perm === 'granted' ? 'Enabled' : 'Enable'}
        </Button>
      </div>

      {/* Install — available to every user; the action adapts to the device. */}
      <div className="flex flex-col gap-3 rounded-xl bg-muted/30 px-4 py-3 ring-1 ring-border sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-0.5">
          <p className="text-sm font-medium">Install app</p>
          <p className="text-xs text-muted-foreground">{installHint}</p>
        </div>
        {reallyInstalled ? (
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-success/10 px-3 py-1.5 text-xs font-medium text-success ring-1 ring-success/20">
            <Check className="size-4" /> Installed
          </span>
        ) : installable ? (
          <Button onClick={install} className="w-full sm:w-auto">
            <Download className="size-4" /> Install
          </Button>
        ) : isIOS ? (
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-muted/50 px-3 py-1.5 text-xs font-medium text-muted-foreground ring-1 ring-border">
            <Share className="size-4" /> Share → Add to Home Screen
          </span>
        ) : null}
      </div>
    </GlassPanel>
  );
}

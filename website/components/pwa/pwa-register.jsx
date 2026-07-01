'use client';

import * as React from 'react';
import { registerServiceWorker, captureInstallPrompt, ensurePushOnLaunch } from '@/lib/pwa';

/** Registers the service worker and captures the install prompt (renders nothing). */
export function PwaRegister() {
  React.useEffect(() => {
    registerServiceWorker();
    // Make notifications native when installed / already permitted.
    const t = setTimeout(() => ensurePushOnLaunch(), 1500);
    const onPrompt = (e) => {
      e.preventDefault();
      captureInstallPrompt(e);
      window.dispatchEvent(new Event('pwa-installable'));
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => {
      clearTimeout(t);
      window.removeEventListener('beforeinstallprompt', onPrompt);
    };
  }, []);

  return null;
}

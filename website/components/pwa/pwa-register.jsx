'use client';

import * as React from 'react';
import { registerServiceWorker, captureInstallPrompt } from '@/lib/pwa';

/** Registers the service worker and captures the install prompt (renders nothing). */
export function PwaRegister() {
  React.useEffect(() => {
    registerServiceWorker();
    const onPrompt = (e) => {
      e.preventDefault();
      captureInstallPrompt(e);
      window.dispatchEvent(new Event('pwa-installable'));
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  return null;
}

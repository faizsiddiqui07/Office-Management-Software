'use client';

import { api } from './api';

let deferredPrompt = null;

/** Register the service worker (idempotent). */
export function registerServiceWorker() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('/sw.js').catch((e) => console.error('SW registration failed', e));
}

/** Capture the browser's install prompt so we can trigger it from a button. */
export function captureInstallPrompt(e) {
  deferredPrompt = e;
}
export function canInstall() {
  return !!deferredPrompt;
}
export async function promptInstall() {
  if (!deferredPrompt) return false;
  deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  deferredPrompt = null;
  return outcome === 'accepted';
}

export function pushSupported() {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

export function notificationPermission() {
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission; // 'default' | 'granted' | 'denied'
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

/** Ask permission, subscribe to push, and register the subscription server-side. */
export async function enablePush() {
  if (!pushSupported()) throw new Error('Push notifications aren’t supported on this browser');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Notification permission was not granted');

  const reg = await navigator.serviceWorker.ready;
  const { key } = await api.get('/push/public-key');
  if (!key) throw new Error('Push is not configured on the server');

  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key),
    });
  }
  await api.post('/push/subscribe', { subscription: sub.toJSON() });
  return true;
}

/** Running as an installed app (standalone / added to home screen)? */
export function isStandalone() {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
}

/**
 * Make notifications "just work". If permission is already granted, silently
 * (re)register the push subscription so alerts arrive as native notifications —
 * even when the app is closed. If it's still undecided AND the app is installed,
 * ask once. Best-effort: never throws.
 */
export async function ensurePushOnLaunch() {
  if (!pushSupported()) return;
  const perm = Notification.permission;
  if (perm === 'denied') return;
  try {
    if (perm === 'granted') {
      await enablePush();
    } else if (isStandalone()) {
      if (typeof localStorage !== 'undefined' && localStorage.getItem('om_push_asked')) return;
      try {
        localStorage.setItem('om_push_asked', '1');
      } catch {
        /* ignore */
      }
      await enablePush();
    }
  } catch {
    /* best-effort — the user can still enable it from Settings/Profile */
  }
}

export async function disablePush() {
  if (!pushSupported()) return;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub) {
    await api.post('/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {});
    await sub.unsubscribe().catch(() => {});
  }
}

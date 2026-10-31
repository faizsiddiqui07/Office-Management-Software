'use client';

import { api } from './api';

// The install offer, captured either by the inline script in app/layout.jsx (which runs
// before React and therefore never misses it) or by PwaRegister as a fallback.
let deferredPrompt = null;
const earlyEvent = () => (typeof window !== 'undefined' ? window.__omInstallEvent || null : null);

/** Register the service worker (idempotent). */
export function registerServiceWorker() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('/sw.js').catch((e) => console.error('SW registration failed', e));
}

/** Capture the browser's install prompt so we can trigger it from a button. */
export function captureInstallPrompt(e) {
  deferredPrompt = e;
  if (typeof window !== 'undefined') window.__omInstallEvent = e;
}
/**
 * Can the browser install the app on THIS device right now?
 *
 * `beforeinstallprompt` is only fired when the app is NOT already installed here, so a
 * captured event is proof of "installable, and definitely not installed" — which is why
 * the card trusts it above everything else.
 */
export function canInstall() {
  return !!(deferredPrompt || earlyEvent());
}
export async function promptInstall() {
  const e = deferredPrompt || earlyEvent();
  if (!e) return false;
  e.prompt();
  const { outcome } = await e.userChoice;
  deferredPrompt = null;
  if (typeof window !== 'undefined') window.__omInstallEvent = null;
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

/**
 * Ask permission (only if it hasn't been given), subscribe to push, and register the
 * subscription server-side.
 *
 * `requestPermission()` runs ONLY when permission is still undecided. It used to run on
 * every call, including the silent one `ensurePushOnLaunch` makes on every launch — and on
 * iOS that call outside a user gesture can reject outright, which took the silent
 * re-subscribe down with it. When permission is already granted there is nothing to ask.
 */
export async function enablePush() {
  if (!pushSupported()) throw new Error('Push notifications aren’t supported on this browser');
  const perm = Notification.permission === 'granted'
    ? 'granted'
    : await Notification.requestPermission();
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
      // Nishaan KOSHISH KE BAAD lagta hai, pehle nahi. Pehle ye upar lagta tha: agar wo
      // ek koshish kisi bhi wajah se fail ho jaati (iOS ka bina-tap wala reject, server
      // par chaabi na hona, network), to nishaan laga rehta aur app DOBARA KABHI nahi
      // poochhti — banda hamesha ke liye bina notification ke reh jaata.
      await enablePush();
      try {
        localStorage.setItem('om_push_asked', '1');
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* best-effort — the user can still enable it from Settings/Profile */
  }
}

/**
 * Is this device REALLY subscribed to push right now?
 *
 * `Notification.permission === 'granted'` is not the same question, and Settings used to
 * treat it as if it were — it printed "On — you'll get alerts even when the app is
 * closed" on the strength of the permission alone. A device can hold that permission and
 * still have no subscription at all: the browser can expire or rotate one, re-installing
 * the app drops it, and the server prunes any endpoint the push service reports as gone
 * (404/410). Nothing told the user, so the card stayed green while the phone stayed
 * silent. Owner's report, 27 Oct 2026.
 *
 * Never throws — an unknown answer comes back as false, and the card then offers to
 * switch it on rather than claiming it already is.
 */
export async function hasPushSubscription() {
  if (!pushSupported()) return false;
  try {
    // Same guard as disablePush: `serviceWorker.ready` never settles when nothing has
    // been registered on this origin, so this must not be awaited bare.
    const reg = await Promise.race([
      navigator.serviceWorker.getRegistration(),
      new Promise((resolve) => { setTimeout(() => resolve(null), 2000); }),
    ]);
    if (!reg?.pushManager) return false;
    return !!(await reg.pushManager.getSubscription());
  } catch {
    return false;
  }
}

export async function disablePush() {
  if (!pushSupported()) return;
  // `serviceWorker.ready` never settles when no worker has been registered on this
  // origin — it waits forever rather than rejecting. Signing out awaits this, so an
  // unresolved promise here left the Sign out button doing nothing at all. Take the
  // registration if there is one, and give up after a moment either way.
  const reg = await Promise.race([
    navigator.serviceWorker.getRegistration(),
    new Promise((resolve) => { setTimeout(() => resolve(null), 2000); }),
  ]).catch(() => null);
  if (!reg?.pushManager) return;
  const sub = await reg.pushManager.getSubscription().catch(() => null);
  if (sub) {
    await api.post('/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {});
    await sub.unsubscribe().catch(() => {});
  }
}

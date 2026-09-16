/* Office Management — service worker (PWA install + Web Push). */

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Minimal fetch handler (pass-through) — present so the app is installable,
// but intentionally does NOT cache, to avoid serving stale Next.js assets.
self.addEventListener('fetch', () => {});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: 'Office Management', body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'Office Management';
  const options = {
    body: data.body || '',
    // No custom icon/badge — the installed app's own icon is shown, so we don't
    // display the extra placeholder graphic alongside it.
    //
    // `tag` groups notifications: a new one REPLACES an existing one with the same tag.
    // Chat sends "chat:<conversationId>", so a busy conversation keeps updating one
    // notification instead of stacking ten — but two different chats never overwrite
    // each other.
    tag: data.type || 'office-management',
    // …and replacing is SILENT by default. Without this, only the first message in a
    // conversation would ever buzz: every later one would quietly swap the text and the
    // phone would never alert again. The sender decides — chat buzzes on the first
    // message of a burst and stays quiet for the rest of it.
    renotify: data.renotify === true,
    data: { link: data.link || '/dashboard' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = (event.notification.data && event.notification.data.link) || '/dashboard';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if ('focus' in w) {
          if ('navigate' in w) w.navigate(link);
          return w.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(link);
      return undefined;
    }),
  );
});

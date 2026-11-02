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
    // The big round picture on the right of the notification.
    //
    // This used to be left out, on the reasoning that the installed app's own icon is
    // already shown and a second graphic would be clutter. On a real phone the opposite
    // happens: with no icon given, Android invents one — a grey circle with a letter taken
    // from the text. The owner's screenshot (2 Nov 2026) showed "T", from the word
    // "testing". A meaningless letter is worse than the app's mark, so now we say which
    // picture to use. If some phone ends up showing the mark twice, delete this one line.
    icon: '/brand/icon-192.png',
    //
    // `tag` groups notifications: a new one REPLACES an existing one with the same tag.
    // Chat sends "chat:<conversationId>", so a busy conversation keeps updating one
    // notification instead of stacking ten — but two different chats never overwrite
    // each other.
    //
    // `data.tag` FIRST, `data.type` only as a fallback. Everything except chat used to
    // land on `type` — the category, e.g. "TASK_ASSIGNED" — so the second task anybody
    // assigned you silently replaced the first, and the one after that replaced it
    // again. The server now sends its own `tag` (see notify() in models/Notification.js);
    // the fallback keeps an older server working against this file.
    tag: data.tag || data.type || 'office-management',
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

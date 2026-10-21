// Keeps the app's own files on the device so it opens quickly and shows
// something when the Wi-Fi drops. Messages, photos and sign-in always go to
// the server and are never kept here.
const CACHE = 'kitchen-table-v1';
const SHELL = ['/', '/manifest.webmanifest', '/icons/icon-192.png', '/textures/paper-light.png', '/textures/paper-dark.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/media') || url.pathname.startsWith('/socket')) return;

  // The page itself: always try for the newest, fall back to the saved copy.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('/', copy));
          return res;
        })
        .catch(() => caches.match('/')),
    );
    return;
  }

  // Built files have their contents in their names, so a saved copy is always right.
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/fonts/') || url.pathname.startsWith('/icons/') || url.pathname.startsWith('/textures/')) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
  }
});

// Notifications while the app is closed. The server sends JSON: a title, a
// line of text, a tag (one per chat, call or game) and where tapping goes.
// They're shown one at a time, so a quick run of them joins up properly.
let showing = Promise.resolve();

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  showing = showing.then(() => show(data)).catch(() => {});
  event.waitUntil(showing);
});

async function show(data) {
  const tag = data.tag || undefined;
  const now = Date.now();
  let lines = data.body ? [data.body] : [];
  let buzzed = now;

  // More messages in the same chat join one notification, newest last, and a
  // quick run of them buzzes once rather than every time.
  if (tag && data.kind === 'message') {
    const [old] = await self.registration.getNotifications({ tag });
    if (old && old.data && Array.isArray(old.data.lines)) {
      lines = [...old.data.lines, ...lines].slice(-5);
      if (now - (old.data.buzzed || 0) < 30000) buzzed = old.data.buzzed;
    }
  }

  return self.registration.showNotification(data.title || 'Kitchen Table', {
    body: lines.join('\n'),
    tag,
    renotify: Boolean(tag) && buzzed === now,
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-96.png',
    timestamp: data.at || now,
    requireInteraction: data.kind === 'call',
    vibrate: data.kind === 'call' ? [400, 200, 400, 200, 400] : [120],
    data: { url: data.url || '/', kind: data.kind, lines, buzzed },
  });
}

// Tapping one opens the app at the chat, call or game, in the window that's
// already open if there is one.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin);
  if (url.origin !== self.location.origin) return;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const open = windows.find((w) => new URL(w.url).origin === url.origin);
      if (!open) return self.clients.openWindow(url.href);
      open.postMessage({ type: 'open', hash: url.hash });
      return open.focus();
    }),
  );
});

// Some browsers replace a subscription now and then; this tells the server.
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    (async () => {
      const res = await fetch('/api/push', { credentials: 'same-origin' });
      if (!res.ok) return;
      const { key } = await res.json();
      const raw = atob(key.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (key.length % 4)) % 4));
      const sub = await self.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: Uint8Array.from(raw, (c) => c.charCodeAt(0)),
      });
      await fetch('/api/push/subscriptions', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', 'x-family': '1' },
        body: JSON.stringify({ subscription: sub.toJSON(), replaces: event.oldSubscription ? event.oldSubscription.endpoint : null }),
      });
    })(),
  );
});

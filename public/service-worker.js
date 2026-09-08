importScripts('https://www.gstatic.com/firebasejs/9.22.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.22.0/firebase-messaging-compat.js');

const CACHE_NAME = 'cmdr-draft-cache-v6.13';
const urlsToCache = [
  '/',
  '/index.html',
  '/styles.css',
  '/script.js',
  '/auth.js',
  '/hub.js',
  '/admin.js',
  '/player-view.js',
  '/firebase-setup.js',
  '/room-actions.js',
  '/deck-actions.js',
  '/deck-builder-view.js',
  '/deck-parser.js',
  '/draft-async.js',
  '/draft-burn.js',
  '/draft-snake.js',
  '/card-inspector.js',
  '/booster-simulator.js',
  '/booster-draft.js',
  '/war-room.js',
  '/collection-hub.js',
  '/collection-hub.css',
  '/commander-precons.json',
  '/profile.js',
  '/calendar.js',
  '/click.mp3',
  '/choose.mp3',
  '/reveal.mp3',
  '/card_back.webp',
  '/icon.png',
  '/icon-192.png',
  '/icon-maskable-512.png',
  '/manifest.json'
];

// Initialize Firebase for Background FCM
firebase.initializeApp({
  apiKey: "AIzaSyAgz3iXNpyrBuLF_v2dl1LkcpAzF24j7so",
  authDomain: "commander-challenge.firebaseapp.com",
  databaseURL: "https://commander-challenge-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "commander-challenge",
  storageBucket: "commander-challenge.firebasestorage.app",
  messagingSenderId: "579721236208",
  appId: "1:579721236208:web:fe4b4de3bb543734bf7c35"
});

const messaging = firebase.messaging();
messaging.onBackgroundMessage((payload) => {
  const notificationTitle = payload.notification?.title || 'Commander Draft Challenge';
  const notificationOptions = {
    body: payload.notification?.body,
    icon: '/icon-192.png',
    data: payload.data
  };
  self.registration.showNotification(notificationTitle, notificationOptions);
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const urlToOpen = event.notification.data?.url || '/';
  
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      for (let i = 0; i < windowClients.length; i++) {
        const client = windowClients[i];
        if (client.url.includes(urlToOpen) && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(urlToOpen);
    })
  );
});

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        const requests = urlsToCache.map(url => new Request(url, { cache: 'reload' }));
        return cache.addAll(requests).catch(err => console.warn('PWA Precache error:', err));
      })
  );
});

self.addEventListener('fetch', event => {
    if (event.request.method !== 'GET') return;

    const url = new URL(event.request.url);

    // Skip non-HTTP/HTTPS and cross-origin external APIs (e.g. Scryfall, Archidekt, Firebase RTDB)
    if (!url.protocol.startsWith('http')) return;
    if (url.origin !== self.location.origin) {
        // Let cross-origin requests bypass SW fetch handler so browser handles CORS and 404s natively
        return;
    }

    // Skip API / Cloud Function routes from caching
    if (url.pathname.startsWith('/compareDecks') || 
        url.pathname.startsWith('/searchCommanderDecks') || 
        url.pathname.startsWith('/getCollectionInsights') ||
        url.pathname.startsWith('/suggestImprovements') ||
        url.pathname.startsWith('/shortenUrl') ||
        url.pathname.startsWith('/getSets') ||
        url.pathname.startsWith('/checkSetCollection')) {
        return;
    }

    // Network-First for same-origin assets: always serve fresh assets when online
    event.respondWith(
        fetch(event.request)
            .then(networkResponse => {
                if (networkResponse && networkResponse.status === 200) {
                    const responseClone = networkResponse.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseClone));
                }
                return networkResponse;
            })
            .catch(async () => {
                const cached = await caches.match(event.request);
                if (cached) return cached;
                if (event.request.mode === 'navigate') {
                    const fallbackHtml = await caches.match('/index.html');
                    if (fallbackHtml) return fallbackHtml;
                }
                return new Response('Network error or offline', {
                    status: 503,
                    statusText: 'Service Unavailable',
                    headers: { 'Content-Type': 'text/plain' }
                });
            })
    );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('Purging stale cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});
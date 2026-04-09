importScripts('https://www.gstatic.com/firebasejs/9.22.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.22.0/firebase-messaging-compat.js');

const CACHE_NAME = 'cmdr-draft-cache-v9';
const urlsToCache = [
  '/',
  '/index.html',
  '/script.js',
  '/click.mp3',
  '/choose.mp3',
  '/reveal.mp3',
  '/card_back.webp',
  '/icon.svg',
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
    icon: '/icon.svg',
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
        // Focus the app tab if it is already open
        if (client.url.includes(urlToOpen) && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(urlToOpen);
    })
  );
});

self.addEventListener('install', event => {
  self.skipWaiting(); // Force the waiting service worker to become active immediately
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        // When installing, we force a network request to bypass the browser's HTTP cache.
        // This ensures we are caching the latest versions of the files.
        const requests = urlsToCache.map(url => new Request(url, { cache: 'reload' }));
        return cache.addAll(requests);
      })
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  
  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Network First: If we get a response, clone it and update the cache
        const responseClone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseClone));
        return response;
      })
      .catch(() => {
        // Fallback: If offline, serve from cache
        return caches.match(event.request);
      })
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim()); // Take control of all pages immediately
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (!cacheWhitelist.includes(cacheName)) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});
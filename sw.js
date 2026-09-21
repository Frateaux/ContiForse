/**
 * ContiFor - Service Worker per funzionamento Offline PWA
 */

const CACHE_NAME = 'contifor-shell-v3.8.7';

const APP_SHELL_FILES = [
  './',
  './index.html',
  './manifest.json',
  './bundle.js',
  './assets/icon.svg',
  './css/main.css',
  './css/components.css',
  './css/themes.css'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(APP_SHELL_FILES);
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keyList) => {
      return Promise.all(
        keyList.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Le chiamate all'API Gemini devono sempre andare direttamente alla rete (Zero-Cloud Storage)
  if (url.hostname.includes('googleapis.com') || url.pathname.includes(':generateContent')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // Cache First per la shell applicativa locale
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request).then((networkResponse) => {
        // Se la richiesta è locale valida, possiamo aggiungerla alla cache
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      });
    }).catch(() => {
      // Fallback offline di base su index.html se si naviga
      if (event.request.mode === 'navigate') {
        return caches.match('./index.html');
      }
    })
  );
});

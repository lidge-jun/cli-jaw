// ── CLI-JAW Service Worker ──
// Cache-first for static assets, network-only for API/WS

const CACHE_NAME = 'clijaw-v1';
const STATIC_ASSETS = [
    '/',
    '/css/variables.css',
    '/css/layout.css',
    '/css/chat.css',
    '/css/sidebar.css',
    '/css/modals.css',
    '/css/markdown.css',
    '/css/orc-state.css',
    '/css/tool-ui.css',
    '/manifest.json',
];

// Install: pre-cache static assets
self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(STATIC_ASSETS))
    );
    self.skipWaiting();
});

// Activate: purge old caches
self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

// Fetch: network-first for API, cache-first for static
self.addEventListener('fetch', (e) => {
    const { request } = e;
    const url = new URL(request.url);

    // Only handle GET requests from same origin
    if (request.method !== 'GET' || url.origin !== self.location.origin) return;

    // API, WebSocket, and Vite HMR → network only
    if (url.pathname.startsWith('/api/') ||
        url.pathname.startsWith('/ws') ||
        url.pathname.startsWith('/@vite') ||
        url.pathname.startsWith('/__vite')) {
        return;
    }

    // Static assets → cache-first with network fallback
    e.respondWith(
        caches.match(request).then(cached => {
            if (cached) return cached;
            return fetch(request).then(resp => {
                if (resp.ok) {
                    const clone = resp.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
                }
                return resp;
            });
        }).catch(() => {
            // Only return cached root for navigation requests
            if (request.mode === 'navigate') return caches.match('/');
            return new Response('', { status: 408 });
        })
    );
});

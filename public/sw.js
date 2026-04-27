/**
 * RouteMasterPro Service Worker
 * Cache-first strategy for static assets, network-first for API calls.
 * Enables offline PWA support for the web version.
 */

const CACHE_VERSION = 'v1';
const STATIC_CACHE = `rmp-static-${CACHE_VERSION}`;
const TILE_CACHE = `rmp-tiles-${CACHE_VERSION}`;
const API_CACHE = `rmp-api-${CACHE_VERSION}`;

const STATIC_ASSETS = [
  '/',
  '/index.html',
];

// Tile servers we cache aggressively
const TILE_SERVERS = [
  'tile.openstreetmap.org',
  'tile-cyclosm.openstreetmap.fr',
  'basemaps.cartocdn.com',
  'server.arcgisonline.com',
  'tile.opentopomap.org',
];

// API endpoints (network-first, cache fallback)
const API_PATTERNS = [
  /\/api\//,
  /\/trpc\//,
  /\/sync\//,
];

// ─── Install ───────────────────────────────────────────────────────────

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn('[SW] Failed to cache some static assets:', err);
      });
    })
  );
  self.skipWaiting();
});

// ─── Activate ──────────────────────────────────────────────────────────

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== STATIC_CACHE && name !== TILE_CACHE && name !== API_CACHE)
          .map((name) => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

// ─── Fetch ─────────────────────────────────────────────────────────────

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // Skip browser extension requests
  if (!url.protocol.startsWith('http')) return;

  // 1. Map tiles: cache-first (aggressive)
  if (isTileRequest(url)) {
    event.respondWith(tileCacheFirst(request));
    return;
  }

  // 2. Static assets: cache-first (JS, CSS, images, fonts)
  if (isStaticAsset(url)) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  // 3. API calls: network-first with cache fallback
  if (isApiRequest(url)) {
    event.respondWith(networkFirst(request, API_CACHE));
    return;
  }

  // 4. Everything else: network-first
  event.respondWith(networkFirst(request, STATIC_CACHE));
});

// ─── Helpers ───────────────────────────────────────────────────────────

function isTileRequest(url) {
  return TILE_SERVERS.some((server) => url.hostname === server || url.hostname.endsWith('.' + server));
}

function isStaticAsset(url) {
  const extensions = ['.js', '.css', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico', '.woff', '.woff2', '.ttf', '.eot'];
  const pathname = url.pathname.toLowerCase();
  return extensions.some((ext) => pathname.endsWith(ext)) || pathname === '/' || pathname === '/index.html';
}

function isApiRequest(url) {
  return API_PATTERNS.some((pattern) => pattern.test(url.pathname));
}

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      // Don't cache opaque responses
      if (response.type === 'basic' || response.type === 'cors') {
        cache.put(request, response.clone());
      }
    }
    return response;
  } catch (error) {
    // Offline and not in cache — return offline page for navigation
    if (request.mode === 'navigate') {
      const offlineResponse = await caches.match('/');
      if (offlineResponse) return offlineResponse;
    }
    throw error;
  }
}

async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      if (response.type === 'basic' || response.type === 'cors') {
        cache.put(request, response.clone());
      }
    }
    return response;
  } catch (error) {
    const cached = await caches.match(request);
    if (cached) return cached;

    // If it's a navigation request, show the cached index
    if (request.mode === 'navigate') {
      const offlineResponse = await caches.match('/');
      if (offlineResponse) return offlineResponse;
    }
    throw error;
  }
}

async function tileCacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(TILE_CACHE);
      // Limit tile cache to 500 items (oldest evicted)
      const keys = await cache.keys();
      if (keys.length >= 500) {
        const oldest = keys.slice(0, keys.length - 499);
        await Promise.all(oldest.map((key) => cache.delete(key)));
      }
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    // Return a transparent tile if offline
    return new Response(null, { status: 204 });
  }
}

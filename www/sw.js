/**
 * KRUX Service Worker v2
 * Estrategia: Cache First para assets estáticos, Network First para datos
 * PWA completa con soporte offline
 */

const CACHE_VERSION = 'v348';
const CACHE_NAME = `krux-cache-${CACHE_VERSION}`;
const DATA_CACHE_NAME = `krux-data-${CACHE_VERSION}`;
const OFFLINE_URL = './offline.html';

// Assets estáticos para cachear en la instalación
const STATIC_ASSETS = [
  './',
  './index.html',
  './offline.html',
  './app_2.css',
  './app_3.js',
  './train-catalog-data.js',
  './train-exercises.js',
  './train-plans.js',
  './train-library.js',
  './train-plans-ui.js',
  './train-profile.js',
  './train-recommender.js',
  './train-coach-ui.js',
  './train-hub-ui.js',
  './activity-ui.js',
  './train-mental-data.js',
  './train-mental-ops.js',
  './train-mental-ui.js',
  './usernames.js',
  './auth.js',
  './firebase-config.js',
  './maplibre-config.js',
  './map-ui.js',
  './climb-session.js',
  './climb-session-ui.js',
  './gym-info.js',
  './climb-conditions.js',
  './school-photos.js',
  './sector-progress.js',
  './sun-map.js',
  './map-style.js',
  './offline-packs.js',
  './activity-ui.js',
  './sector-images.js',
  './vendor/maplibre-gl-4.1.0/maplibre-gl.js',
  './vendor/maplibre-gl-4.1.0/maplibre-gl.css',
  './vendor/three-0.160.1/three.min.js',
  './vendor/firebase-9.23.0/firebase-app-compat.js',
  './vendor/firebase-9.23.0/firebase-auth-compat.js',
  './vendor/firebase-9.23.0/firebase-firestore-compat.js',
  './vendor/firebase-9.23.0/firebase-storage-compat.js',
  './vendor/firebase-9.23.0/firebase-messaging-compat.js',
  './assets/schools/generic/caliza.svg',
  './assets/schools/generic/granito.svg',
  './assets/schools/generic/roca.svg',
  './assets/schools/mora.webp',
  './assets/schools/toledo.webp',
  './assets/schools/sanmartin.webp',
  './assets/schools/cuenca.webp',
  './assets/schools/pedriza.webp',
  './assets/schools/patones.webp',
  './maplibre-map.js',
  './terrain-3d.js',
  './map-search.js',
  './user-features.js',
  './route-photos.js',
  './manifest.json',
  './favicon.png',
  './logo_krujx_v2.png',
  './assets/logo.png',
  './assets/krux-logo-login.png',
  './assets/reset-view-icon.png',
  './assets/train/entrena-roca.jpg',
  './assets/train/sesion-roca.jpg',
  './assets/train/modalidad-deportiva.jpg',
  './assets/train/modalidad-bloque.jpg',
  './assets/train/ficha-cabecera.jpg',
  './assets/train/plan-activo.jpg',
  './assets/train/cat-dedos.jpg',
  './assets/train/cat-traccion.jpg',
  './assets/train/cat-potencia.jpg',
  './assets/train/cat-resistencia.jpg',
  './assets/train/cat-piernas.jpg',
  './assets/train/cat-core.jpg',
  './assets/train/cat-tecnica.jpg',
  './assets/train/cat-antagonistas.jpg',
  './assets/train/cat-movilidad.jpg',
  './assets/train/cat-general.jpg',
  './icons/climbing-marker.png',
  './icons/parking_icon.png',
  './icons/pwa/icon-192x192.png',
  './icons/pwa/icon-512x512.png',
  './icons/pwa/apple-touch-icon.png',
  './capacitor-init.js'
];

// Recursos externos que intentaremos cachear
const EXTERNAL_RESOURCES = [
  'https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=Inter:wght@400;500;600;700;800&display=swap'
];

// Teselas de mapa: no pasan por el service worker (son miles y llenarían la caché). Las de las escuelas
// descargadas las sirve offline-packs.js desde IndexedDB.
const TILE_HOSTS = ['www.ign.es', 'tms-pnoa-ma.idee.es', 'api.maptiler.com', 'demotiles.maplibre.org'];

// Instalación: cachear assets estáticos
self.addEventListener('install', (event) => {
  console.log('[SW] Instalando Service Worker...');

  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[SW] Cacheando assets estáticos');
        // Cachear assets locales. cache:'reload' salta la caché HTTP del navegador (max-age de GitHub Pages/Hosting):
        // así la caché nueva nunca se llena con una copia vieja de un JS recién publicado.
        return cache.addAll(STATIC_ASSETS.map((url) => new Request(url, { cache: 'reload' })))
          .then(() => {
            // Intentar cachear recursos externos (no falla si no se pueden)
            return Promise.allSettled(
              EXTERNAL_RESOURCES.map(url =>
                fetch(url, { mode: 'cors' }).then(response => {
                  if (response.ok && response.status !== 206) {
                    return cache.put(url, response);
                  }
                }).catch(() => {
                  console.log('[SW] No se pudo cachear recurso externo:', url);
                })
              )
            );
          });
      })
      .then(() => {
        console.log('[SW] Instalación completada');
        return self.skipWaiting();
      })
      .catch((error) => {
        console.error('[SW] Error en instalación:', error);
      })
  );
});

// Activación: limpiar caches antiguos
self.addEventListener('activate', (event) => {
  console.log('[SW] Activando Service Worker...');

  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((cacheName) => {
              // Eliminar caches que no coincidan con la versión actual
              return cacheName.startsWith('krux-') &&
                     cacheName !== CACHE_NAME &&
                     cacheName !== DATA_CACHE_NAME;
            })
            .map((cacheName) => {
              console.log('[SW] Eliminando cache antiguo:', cacheName);
              return caches.delete(cacheName);
            })
        );
      })
      .then(() => {
        console.log('[SW] Service Worker activado');
        return self.clients.claim();
      })
  );
});

// Fetch: estrategia de cache
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Ignorar peticiones que no sean GET
  if (request.method !== 'GET') {
    return;
  }

  // Ignorar peticiones a Firebase (auth, firestore, storage)
  if (url.hostname.includes('firebase') ||
      url.hostname.includes('firebaseio') ||
      url.hostname.includes('googleapis.com') && !url.pathname.includes('fonts')) {
    return;
  }

  // Ignorar chrome-extension y otros esquemas no http/https
  if (!url.protocol.startsWith('http')) {
    return;
  }

  if (TILE_HOSTS.includes(url.hostname)) {
    return;
  }

  // Estrategia para archivos GeoJSON: Network First para reflejar actualizaciones
  if (url.pathname.includes('/Cartografia/') ||
      url.pathname.endsWith('.geojson')) {
    event.respondWith(networkFirstThenCache(request));
    return;
  }

  // Estrategia para tiles del mapa
  if (url.pathname.includes('/tiles/')) {
    event.respondWith(cacheFirstThenNetwork(request, DATA_CACHE_NAME));
    return;
  }

  // Estrategia para assets estáticos (CSS, JS, imágenes)
  if (isStaticAsset(url)) {
    event.respondWith(cacheFirstThenNetwork(request, CACHE_NAME));
    return;
  }

  // Estrategia para navegación (HTML)
  if (request.mode === 'navigate') {
    event.respondWith(networkFirstWithOfflineFallback(request));
    return;
  }

  // Por defecto: network first
  event.respondWith(networkFirstThenCache(request));
});

/**
 * Determina si es un asset estático
 */
function isStaticAsset(url) {
  const staticExtensions = ['.css', '.js', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.woff', '.woff2', '.ttf', '.ico'];
  return staticExtensions.some(ext => url.pathname.endsWith(ext));
}

/**
 * Cache First, luego Network
 * Ideal para assets que no cambian frecuentemente
 */
async function cacheFirstThenNetwork(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cachedResponse = await cache.match(request);

  if (cachedResponse) {
    // Actualizar cache en background (stale-while-revalidate)
    fetchAndCache(request, cache).catch(() => {});
    return cachedResponse;
  }

  // Sin copia en esta versión de la caché (p. ej. justo tras subir CACHE_VERSION): para lo propio se salta la caché HTTP
  // y se descarga de la red, para no guardar ni ejecutar una versión vieja de un JS que acaba de cambiar (admin.js, admin-routes.js...)
  return fetchAndCache(request, cache, new URL(request.url).origin === self.location.origin);
}

/**
 * Respuesta guardada para una petición sin red: en cualquier caché (también la de escuelas descargadas,
 * kxoff-geojson) y, para lo propio, ignorando el ?v= de versión (la copia puede ser de otra versión)
 */
async function matchAnyCache(request) {
  const exact = await caches.match(request);
  if (exact) return exact;
  if (new URL(request.url).origin === self.location.origin) {
    return caches.match(request, { ignoreSearch: true });
  }
  return undefined;
}

/**
 * Network First con fallback a página offline
 * Ideal para navegación
 */
async function networkFirstWithOfflineFallback(request) {
  const cache = await caches.open(CACHE_NAME);

  try {
    const networkResponse = await fetch(request);

    if (networkResponse.ok && networkResponse.status !== 206) {
      cache.put(request, networkResponse.clone());
    }

    return networkResponse;
  } catch (error) {
    // Intentar servir desde cache
    const cachedResponse = await matchAnyCache(request);

    if (cachedResponse) {
      return cachedResponse;
    }

    // Si es navegación y no hay cache, mostrar página offline
    const offlineResponse = await cache.match(OFFLINE_URL);
    if (offlineResponse) {
      return offlineResponse;
    }

    // Fallback final al index
    return cache.match('./index.html');
  }
}

/**
 * Network First, luego Cache
 * Ideal para contenido dinámico
 */
async function networkFirstThenCache(request) {
  const cache = await caches.open(CACHE_NAME);

  try {
    const networkResponse = await fetch(request);

    if (networkResponse.ok && networkResponse.status !== 206) {
      cache.put(request, networkResponse.clone());
    }

    return networkResponse;
  } catch (error) {
    const cachedResponse = await matchAnyCache(request);

    if (cachedResponse) {
      return cachedResponse;
    }

    throw error;
  }
}

/**
 * Fetch y guardar en cache
 */
async function fetchAndCache(request, cache, fresh = false) {
  try {
    const networkResponse = await fetch(request, fresh ? { cache: 'reload' } : undefined);

    if (networkResponse.ok && networkResponse.status !== 206) {
      cache.put(request, networkResponse.clone());
    }

    return networkResponse;
  } catch (error) {
    // Intentar devolver del cache si falla la red
    const cachedResponse = await matchAnyCache(request);
    if (cachedResponse) {
      return cachedResponse;
    }
    console.error('[SW] Error en fetch:', error);
    throw error;
  }
}

// Escuchar mensajes del cliente
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }

  if (event.data && event.data.type === 'CACHE_GEOJSON') {
    // Cachear archivos GeoJSON bajo demanda
    const urls = event.data.urls;
    caches.open(DATA_CACHE_NAME).then((cache) => {
      urls.forEach(url => {
        fetch(url).then(response => {
          if (response.ok && response.status !== 206) {
            cache.put(url, response);
          }
        });
      });
    });
  }

  // Limpiar caches específicos
  if (event.data && event.data.type === 'CLEAR_CACHE') {
    caches.delete(CACHE_NAME).then(() => {
      console.log('[SW] Cache limpiado');
    });
  }

  // Pre-cachear rutas específicas
  if (event.data && event.data.type === 'PRECACHE_ROUTES') {
    const routes = event.data.routes;
    caches.open(DATA_CACHE_NAME).then((cache) => {
      routes.forEach(route => {
        fetch(route).then(response => {
          if (response.ok && response.status !== 206) {
            cache.put(route, response);
            console.log('[SW] Pre-cacheada ruta:', route);
          }
        });
      });
    });
  }
});

// Sincronización en background (cuando vuelve la conexión)
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-ascents') {
    event.waitUntil(syncPendingAscents());
  }
});

/**
 * Sincronizar ascensos pendientes almacenados en IndexedDB
 */
async function syncPendingAscents() {
  console.log('[SW] Sincronizando ascensos pendientes...');
  // Esta función se implementará cuando se añada IndexedDB
  // Por ahora, notificamos a los clientes que la sincronización está disponible
  const clients = await self.clients.matchAll();
  clients.forEach(client => {
    client.postMessage({
      type: 'SYNC_AVAILABLE',
      message: 'La conexión está disponible para sincronizar'
    });
  });
}

// ============================================
// PUSH (web instalada: FCM; el token lo guarda push.js)
// ============================================
// FCM entrega {notification:{title, body}, data:{notificationId, type, ...}}. Siempre se muestra una notificación:
// Safari en iOS retira el permiso si un push llega sin enseñar nada.
self.addEventListener('push', (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch (_) { payload = { notification: { body: event.data && event.data.text() } }; }
  const n = payload.notification || {};
  const data = payload.data || {};
  event.waitUntil(
    self.registration.showNotification(n.title || payload.title || 'KRUX', {
      body: n.body || payload.body || 'Tienes un aviso nuevo en KRUX',
      icon: './icons/pwa/icon-192x192.png',
      badge: './icons/pwa/icon-96x96.png',
      tag: data.notificationId || undefined,
      data
    })
  );
});

// Al tocarla: se enfoca la app abierta y se le pasa el aviso (push.js abre lo mismo que la campana);
// si estaba cerrada se abre con ?kxpush=1 y se muestra la campana
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const scope = self.registration.scope;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const client = list.find(c => c.url.startsWith(scope));
      if (client) {
        client.postMessage({ type: 'KRUX_PUSH_CLICK', data });
        return 'focus' in client ? client.focus() : undefined;
      }
      return self.clients.openWindow ? self.clients.openWindow(scope + '?kxpush=1') : undefined;
    })
  );
});

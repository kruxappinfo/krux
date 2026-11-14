// ================== KRUX SIN CONEXIÓN ==================
// Escuelas descargadas para usarlas sin cobertura: vías, sectores, parkings y puntos de interés, croquis
// (fotos del sector y sus trazados), votos, comentarios y la ortofoto del PNOA de la zona.
//  - El contenido vive en IndexedDB: funciona igual en la web y en la app (Capacitor), haya o no service worker.
//  - Un índice pequeño en localStorage permite decidir al vuelo, sin esperas, si algo está guardado
//    (el mapa pregunta por cada tesela en transformRequest, que es síncrono).
//  - Lecturas de Firestore: kxGetDoc / kxGetQuery / kxOfflineListen sirven la copia guardada cuando no hay red
//    y la refrescan cuando sí la hay. Aquí solo se lee de Firestore: nunca se escribe ni se borra nada remoto.
// Las teselas de MapTiler (rótulos, curvas de nivel, relieve) no se descargan: sus condiciones no permiten la
// descarga masiva. Sin conexión el mapa queda en satélite con las capas propias de KRUX encima.

// ============================================
// CONSTANTES
// ============================================
const KXOFF_DB = 'krux-offline';
const KXOFF_INDEX = 'kx-offline-v1';
const KXOFF_GEOJSON_CACHE = 'kxoff-geojson';           // solo web: el service worker la consulta sin red
const KXOFF_AREA_ZOOMS = [10, 15];                      // toda la escuela (con margen)
const KXOFF_DETAIL_ZOOMS = [16, 18];                    // alrededor de vías, sectores, parkings y puntos de interés
const KXOFF_AREA_MARGIN_DEG = 0.01;                     // ~1 km alrededor de los límites de la escuela
const KXOFF_DETAIL_BUFFER_M = 150;
const KXOFF_FINE_ZOOM = 19;                             // resolución real del PNOA (25 cm): solo junto a vías y sectores
const KXOFF_FINE_BUFFER_M = 75;
const KXOFF_TILE_BYTES = 25000;                         // media medida de una tesela del PNOA (z14–z18)
const KXOFF_FINE_TILE_BYTES = 12000;                    // las de z19 pesan menos
const KXOFF_PHOTO_BYTES = 900000;                       // si la foto no informa de su tamaño
const KXOFF_GLYPH_FONTS = ['Noto Sans Regular', 'Noto Sans Italic', 'Noto Sans Bold'];
const KXOFF_GLYPH_RANGES = ['0-255', '8192-8447'];      // latino (con tildes y eñes) y puntuación tipográfica
const KXOFF_TIMEOUT_MS = 6000;                          // lectura que no responde: se sirve la copia guardada
const KXOFF_UNREACHABLE_MS = 60000;                     // tras un fallo de red, la copia se sirve directamente
const KXOFF_CONCURRENCY = 6;
const KXOFF_GEOJSON_KEYS = ['vias', 'sectores', 'parkings', 'puntosInteres', 'rutasAcceso'];

// ============================================
// FUNCIONES PURAS (se prueban en Node)
// ============================================
function kxoffTileXY(lng, lat, z) {
  const n = 2 ** z;
  const latR = lat * Math.PI / 180;
  const x = Math.floor((lng + 180) / 360 * n);
  const y = Math.floor((1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2 * n);
  const clamp = v => Math.min(n - 1, Math.max(0, v));
  return [clamp(x), clamp(y)];
}

// Teselas de una escuela: la zona entera a escala media y el detalle solo donde hay algo que escalar o encontrar
function kxoffTileKeys(bounds, points, opts = {}) {
  const area = opts.areaZooms || KXOFF_AREA_ZOOMS;
  const detail = opts.detailZooms || KXOFF_DETAIL_ZOOMS;
  const bufferM = opts.bufferM ?? KXOFF_DETAIL_BUFFER_M;
  const margin = opts.margin ?? KXOFF_AREA_MARGIN_DEG;
  const keys = new Set();
  const addBox = (w, s, e, n, z) => {
    const [x0, y0] = kxoffTileXY(w, n, z);
    const [x1, y1] = kxoffTileXY(e, s, z);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) keys.add(`t/${z}/${x}/${y}`);
  };
  if (bounds) {
    const [[w, s], [e, n]] = bounds;
    for (let z = area[0]; z <= area[1]; z++) addBox(w - margin, s - margin, e + margin, n + margin, z);
  }
  // Puntos cercanos (~30 m) dan las mismas teselas: se agrupan antes de recorrerlos
  const around = (list, meters, z0, z1) => {
    const seen = new Set();
    (list || []).forEach(([lng, lat]) => {
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;
      const cell = `${Math.round(lng * 3000)}:${Math.round(lat * 3000)}`;
      if (seen.has(cell)) return;
      seen.add(cell);
      const dLat = meters / 111320;
      const dLng = meters / (111320 * Math.cos(lat * Math.PI / 180));
      for (let z = z0; z <= z1; z++) addBox(lng - dLng, lat - dLat, lng + dLng, lat + dLat, z);
    });
  };
  around(points, bufferM, detail[0], detail[1]);
  // Máxima nitidez solo donde se escala (vías y sectores)
  around(opts.finePoints, opts.fineBufferM ?? KXOFF_FINE_BUFFER_M, KXOFF_FINE_ZOOM, KXOFF_FINE_ZOOM);
  return [...keys];
}

// Coordenadas sueltas de una lista de features GeoJSON (puntos, líneas y polígonos)
function kxoffFeaturePoints(features) {
  const pts = [];
  const walk = c => {
    if (!Array.isArray(c)) return;
    if (typeof c[0] === 'number') pts.push(c);
    else c.forEach(walk);
  };
  (features || []).forEach(f => f && f.geometry && walk(f.geometry.coordinates));
  return pts;
}

// Clave de una tesela del PNOA (WMTS del IGN) a partir de su URL; null si no lo es
function kxoffPnoaKey(url) {
  if (typeof url !== 'string' || !url.includes('pnoa-ma')) return null;
  const z = /[?&]TILEMATRIX=(\d+)/i.exec(url);
  const row = /[?&]TILEROW=(\d+)/i.exec(url);
  const col = /[?&]TILECOL=(\d+)/i.exec(url);
  return z && row && col ? `t/${z[1]}/${col[1]}/${row[1]}` : null;
}

// Clave de un rango de glifos (fuentes de los rótulos del mapa); null si no lo es
function kxoffGlyphKey(url) {
  const m = typeof url === 'string' && /\/fonts\/([^/?]+)\/(\d+-\d+)\.pbf/.exec(url);
  return m ? `g/${decodeURIComponent(m[1])}/${m[2]}` : null;
}

// Tesela guardada de menor zoom que contiene a la pedida (para ampliarla sin conexión); null si no hay
function kxoffAncestorKey(key, has, minZoom = KXOFF_AREA_ZOOMS[0]) {
  const m = /^t\/(\d+)\/(\d+)\/(\d+)$/.exec(key);
  if (!m) return null;
  const [z, x, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  for (let pz = Math.min(z - 1, KXOFF_FINE_ZOOM); pz >= minZoom; pz--) {
    const d = z - pz;
    const k = `t/${pz}/${x >> d}/${y >> d}`;
    if (has(k)) return k;
  }
  return null;
}

// Datos de Firestore → valores que se pueden guardar (Timestamp y GeoPoint pierden su clase al clonarse)
function kxoffSerialize(v) {
  if (v == null || typeof v !== 'object' || v instanceof Date) return v;
  if (typeof v.toMillis === 'function' && typeof v.toDate === 'function') return { __kxts: v.toMillis() };
  if (typeof v.latitude === 'number' && typeof v.longitude === 'number' && typeof v.isEqual === 'function') {
    return { __kxgeo: [v.latitude, v.longitude] };
  }
  if (Array.isArray(v)) return v.map(kxoffSerialize);
  const out = {};
  Object.keys(v).forEach(k => { out[k] = kxoffSerialize(v[k]); });
  return out;
}

function kxoffRevive(v) {
  if (v == null || typeof v !== 'object' || v instanceof Date) return v;
  if (Array.isArray(v)) return v.map(kxoffRevive);
  const fs = typeof firebase !== 'undefined' && firebase.firestore ? firebase.firestore : null;
  if (typeof v.__kxts === 'number') return fs && fs.Timestamp ? fs.Timestamp.fromMillis(v.__kxts) : new Date(v.__kxts);
  if (Array.isArray(v.__kxgeo)) {
    const [lat, lng] = v.__kxgeo;
    return fs && fs.GeoPoint ? new fs.GeoPoint(lat, lng) : { latitude: lat, longitude: lng };
  }
  const out = {};
  Object.keys(v).forEach(k => { out[k] = kxoffRevive(v[k]); });
  return out;
}

function kxoffFormatBytes(n) {
  if (!Number.isFinite(n) || n <= 0) return '0 MB';
  if (n < 1e6) return `${Math.max(1, Math.round(n / 1e3))} KB`;
  return `${(n / 1e6).toFixed(n < 1e7 ? 1 : 0).replace('.', ',')} MB`;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    kxoffTileXY, kxoffTileKeys, kxoffFeaturePoints, kxoffPnoaKey, kxoffGlyphKey, kxoffAncestorKey,
    kxoffSerialize, kxoffRevive, kxoffFormatBytes
  };
}

// ============================================
// ALMACÉN (IndexedDB) E ÍNDICE (localStorage)
// ============================================
// blobs: 't/z/x/y' (tesela), 'g/fuente/rango' (glifos), 'p/<url>' (foto) → { type, buf }
// docs:  '<colección>/<id>' → datos del documento (null = no existe) · 'q/…' → [{ id, data }] de una consulta
let kxoffDbPromise = null;
function kxoffDb() {
  if (!kxoffDbPromise) {
    kxoffDbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(KXOFF_DB, 1);
      req.onupgradeneeded = () => {
        ['blobs', 'docs'].forEach(s => { if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s); });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => { kxoffDbPromise = null; reject(req.error); };
    });
  }
  return kxoffDbPromise;
}

async function kxoffTx(store, mode, fn) {
  const db = await kxoffDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(req ? req.result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
const kxoffGet = (store, key) => kxoffTx(store, 'readonly', os => os.get(key));
const kxoffPut = (store, key, value) => kxoffTx(store, 'readwrite', os => { os.put(value, key); });
const kxoffPutMany = (store, entries) => kxoffTx(store, 'readwrite', os => { entries.forEach(([k, v]) => os.put(v, k)); });
const kxoffDeleteMany = (store, keys) => kxoffTx(store, 'readwrite', os => { keys.forEach(k => os.delete(k)); });

function kxoffTimeout(promise, ms = KXOFF_TIMEOUT_MS) {
  let t;
  const timer = new Promise((_, reject) => {
    t = setTimeout(() => reject(Object.assign(new Error('Sin respuesta de la red'), { code: 'kx/timeout' })), ms);
  });
  return Promise.race([promise, timer]).finally(() => clearTimeout(t));
}

// Instantáneas con la misma forma que las de Firestore, para que el código que las lee no cambie
function kxoffDocSnap(id, data) {
  return { id, exists: data != null, fromCache: true, data: () => (data == null ? undefined : kxoffRevive(data)) };
}
function kxoffQuerySnap(list) {
  const docs = (list || []).map(d => kxoffDocSnap(d.id, d.data));
  return { docs, size: docs.length, empty: docs.length === 0, fromCache: true, forEach: cb => docs.forEach(cb) };
}
function kxoffSnapList(snapshot, filter) {
  const list = [];
  snapshot.forEach(d => {
    const data = d.data();
    if (!filter || filter(data)) list.push({ id: d.id, data: kxoffSerialize(data) });
  });
  return list;
}

// ============================================
// NÚCLEO
// ============================================
const KxOffline = (() => {
  let index = { v: 1, packs: {} };
  let blobSet = new Set();
  let docSet = new Set();
  let prefixes = [];
  let unreachableUntil = 0;
  let protocolReady = false;
  const jobs = new Map();          // descargas en curso: schoolId → { controller, progress }
  const photoUrls = new Map();     // url remota → object URL (los más recientes)
  const PHOTO_URLS_MAX = 40;

  function loadIndex() {
    try {
      const raw = JSON.parse(localStorage.getItem(KXOFF_INDEX) || 'null');
      if (raw && raw.v === 1 && raw.packs) index = raw;
    } catch (_) { /* sin almacenamiento: no hay escuelas descargadas */ }
    rebuild();
  }

  function saveIndex() {
    localStorage.setItem(KXOFF_INDEX, JSON.stringify(index));
    rebuild();
  }

  function rebuild() {
    blobSet = new Set();
    docSet = new Set();
    prefixes = [];
    Object.values(index.packs).forEach(p => {
      (p.blobs || []).forEach(k => blobSet.add(k));
      (p.docs || []).forEach(k => docSet.add(k));
      prefixes.push(...(p.prefixes || []));
    });
  }

  function emit(schoolId) {
    try { document.dispatchEvent(new CustomEvent('kx:offline-changed', { detail: { schoolId } })); } catch (_) {}
  }

  // ---- Estado de la red ----
  function isOffline() {
    return (typeof navigator !== 'undefined' && navigator.onLine === false) || Date.now() < unreachableUntil;
  }
  function markUnreachable() { unreachableUntil = Date.now() + KXOFF_UNREACHABLE_MS; }

  // ---- Consultas del índice ----
  const has = schoolId => !!index.packs[schoolId];
  const pack = schoolId => index.packs[schoolId] || null;
  const covers = key => docSet.has(key) || prefixes.some(p => key.startsWith(p));
  const hasBlob = key => blobSet.has(key);
  const progress = schoolId => (jobs.get(schoolId) || {}).progress || null;

  // ---- Lecturas guardadas ----
  async function cachedDoc(key) {
    const id = key.slice(key.lastIndexOf('/') + 1);
    const data = await kxoffGet('docs', key).catch(() => undefined);
    return kxoffDocSnap(id, data === undefined ? null : data);
  }
  async function cachedQuery(key, pick) {
    const list = (await kxoffGet('docs', key).catch(() => undefined)) || [];
    return kxoffQuerySnap(pick ? list.filter(d => pick(kxoffRevive(d.data))) : list);
  }
  // Refresco con lo último que llegó de la red (solo de lo ya descargado)
  function saveDoc(key, data) {
    if (!covers(key)) return;
    kxoffPut('docs', key, data == null ? null : kxoffSerialize(data)).catch(() => {});
  }
  function saveQuery(key, list) {
    if (!covers(key)) return;
    kxoffPut('docs', key, list).catch(() => {});
  }

  // ---- Mapa: teselas y glifos guardados ----
  function transformRequest(url, type) {
    if (!blobSet.size) return undefined;
    if (type === 'Tile') {
      const key = kxoffPnoaKey(url);
      if (key && (blobSet.has(key) || (isOffline() && kxoffAncestorKey(key, hasBlob)))) return { url: `kxoff://${key}` };
    } else if (type === 'Glyphs') {
      const key = kxoffGlyphKey(url);
      if (key && blobSet.has(key)) return { url: `kxoff://${key}` };
    }
    return undefined;
  }

  // Tesela sin descargar a este zoom: se recorta y amplía la guardada que la contiene
  async function overzoom(key) {
    const anc = kxoffAncestorKey(key, hasBlob);
    if (!anc) return null;
    const rec = await kxoffGet('blobs', anc);
    if (!rec) return null;
    const [z, x, y] = key.split('/').slice(1).map(Number);
    const pz = Number(anc.split('/')[1]);
    const d = z - pz;
    const size = 256 / (1 << d);
    const sx = (x - ((x >> d) << d)) * size;
    const sy = (y - ((y >> d) << d)) * size;
    const bmp = await createImageBitmap(new Blob([rec.buf], { type: rec.type || 'image/jpeg' }));
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, sx, sy, size, size, 0, 0, 256, 256);
    if (bmp.close) bmp.close();
    const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.9));
    return blob ? blob.arrayBuffer() : null;
  }

  function registerProtocol() {
    if (protocolReady || typeof maplibregl === 'undefined' || !maplibregl.addProtocol) return;
    protocolReady = true;
    maplibregl.addProtocol('kxoff', async (params) => {
      const key = params.url.replace('kxoff://', '');
      const rec = await kxoffGet('blobs', key).catch(() => null);
      if (rec) return { data: rec.buf };
      if (key.startsWith('t/')) {
        const data = await overzoom(key);
        if (data) return { data };
      }
      throw new Error(`Sin copia sin conexión: ${key}`);
    });
  }

  // ---- Fotos de croquis guardadas ----
  async function photoUrl(url) {
    if (!url || !blobSet.has(`p/${url}`)) return null;
    if (photoUrls.has(url)) {
      const u = photoUrls.get(url);
      photoUrls.delete(url);
      photoUrls.set(url, u);   // la más reciente, al final
      return u;
    }
    const rec = await kxoffGet('blobs', `p/${url}`).catch(() => null);
    if (!rec) return null;
    const obj = URL.createObjectURL(new Blob([rec.buf], { type: rec.type || 'image/jpeg' }));
    photoUrls.set(url, obj);
    while (photoUrls.size > PHOTO_URLS_MAX) {
      const [oldest, oldUrl] = photoUrls.entries().next().value;
      photoUrls.delete(oldest);
      URL.revokeObjectURL(oldUrl);
    }
    return obj;
  }

  // Galería de un sector con las fotos guardadas en local (más rápidas y disponibles sin conexión)
  async function localizeImages(images) {
    if (!blobSet.size || !Array.isArray(images)) return images;
    return Promise.all(images.map(async img => {
      const local = img && await photoUrl(img.url);
      return local ? { ...img, url: local, remoteUrl: img.url } : img;
    }));
  }

  // ============================================
  // DESCARGA
  // ============================================
  function glyphTemplate() {
    const map = typeof window !== 'undefined' ? window.mlMap : null;
    const style = map && typeof map.getStyle === 'function' ? map.getStyle() : null;
    if (style && style.glyphs) return style.glyphs;
    const key = typeof MAPLIBRE_CONFIG !== 'undefined' ? MAPLIBRE_CONFIG.MAPTILER_KEY : '';
    return `https://api.maptiler.com/fonts/{fontstack}/{range}.pbf?key=${key}`;
  }

  function tileUrl(key) {
    const [z, x, y] = key.split('/').slice(1);
    return KXBASE_PNOA.replace('{z}', z).replace('{x}', x).replace('{y}', y);
  }

  async function pool(items, size, fn) {
    let i = 0;
    const worker = async () => { while (i < items.length) { const item = items[i++]; await fn(item); } };
    await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  }

  async function fetchBuffer(url, signal) {
    let lastError;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(url, { signal, mode: 'cors' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return { type: res.headers.get('content-type') || '', buf: await res.arrayBuffer() };
      } catch (e) {
        if (signal && signal.aborted) throw e;
        lastError = e;
      }
    }
    throw lastError;
  }

  // Lo que hay que bajar de una escuela y cuánto ocupa (lee Firestore, no guarda nada)
  async function prepare(schoolId) {
    const cfg = typeof MAPLIBRE_SCHOOLS !== 'undefined' ? MAPLIBRE_SCHOOLS[schoolId] : null;
    if (!cfg) throw new Error('Esta escuela todavía no se puede descargar');
    if (typeof firebase === 'undefined' || !firebase.firestore) throw new Error('Firebase no está disponible');
    const db = firebase.firestore();
    const docId = firebase.firestore.FieldPath.documentId();
    const pfx = `${schoolId}_`;
    const byPrefix = col => db.collection(col).where(docId, '>=', pfx).where(docId, '<', `${pfx}`).get();
    const geoUrls = KXOFF_GEOJSON_KEYS.map(k => cfg.geojson && cfg.geojson[k]).filter(u => typeof u === 'string');
    const ofSchool = d => !d.schoolId || d.schoolId === schoolId;   // mismo filtro que el mapa

    const slow = p => kxoffTimeout(p, 30000);
    const [geo, images, drawings, grades, alejes, estados, comments, routes, pois, sectors] = await Promise.all([
      Promise.all(geoUrls.map(u => fetch(u).then(r => (r.ok ? r.json() : null)).catch(() => null))),
      slow(byPrefix('sector_images')),
      slow(byPrefix('sector_route_drawings')),
      slow(byPrefix('grade_votes')),
      slow(byPrefix('aleje_votes')),
      slow(byPrefix('estado_votes')),
      slow(db.collection('comments').where('routeId', '>=', pfx).where('routeId', '<', `${pfx}`).get()),
      slow(db.collection('pending_routes').where('schoolId', '==', schoolId).where('status', '==', 'approved').get()),
      slow(db.collection('pending_poi').where('status', '==', 'approved').get()),
      slow(db.collection('pending_sectors').where('status', '==', 'approved').get())
    ]);

    // Documentos sueltos (las colecciones con prefijo cubren también los que no existen)
    const docs = new Map();
    [['sector_images', images], ['sector_route_drawings', drawings], ['grade_votes', grades],
      ['aleje_votes', alejes], ['estado_votes', estados]].forEach(([col, snap]) => {
      snap.forEach(d => docs.set(`${col}/${d.id}`, kxoffSerialize(d.data())));
    });
    const byRoute = new Map();
    comments.forEach(d => {
      const k = `q/comments/${d.data().routeId}`;
      if (!byRoute.has(k)) byRoute.set(k, []);
      byRoute.get(k).push({ id: d.id, data: kxoffSerialize(d.data()) });
    });
    byRoute.forEach((list, k) => docs.set(k, list));
    docs.set(`q/pending_routes/${schoolId}`, kxoffSnapList(routes));
    docs.set(`q/pending_poi/${schoolId}`, kxoffSnapList(pois, ofSchool));
    docs.set(`q/pending_sectors/${schoolId}`, kxoffSnapList(sectors, ofSchool));
    const prefixList = ['sector_images', 'sector_route_drawings', 'grade_votes', 'aleje_votes', 'estado_votes']
      .map(c => `${c}/${pfx}`).concat(`q/comments/${pfx}`);

    // Fotos de los croquis
    const photoSet = new Set();
    images.forEach(d => {
      const data = d.data();
      (Array.isArray(data.images) ? data.images : []).forEach(img => img && img.url && photoSet.add(img.url));
      if (data.imageUrl) photoSet.add(data.imageUrl);
    });
    const photos = [...photoSet].map(url => ({ key: `p/${url}`, url, size: KXOFF_PHOTO_BYTES }));
    await pool(photos.filter(p => !blobSet.has(p.key)), KXOFF_CONCURRENCY, async p => {
      try {
        const res = await kxoffTimeout(fetch(p.url, { method: 'HEAD', mode: 'cors' }), 8000);
        const len = Number(res.headers.get('content-length'));
        if (len > 0) p.size = len;
      } catch (_) { /* se queda la estimación */ }
    });

    // Teselas: la escuela entera y el detalle alrededor de todo lo que se dibuja en el mapa
    const points = [];
    const climbPoints = [];   // vías y sectores: ahí se baja además la máxima resolución
    geo.forEach((g, i) => {
      if (!g) return;
      const pts = kxoffFeaturePoints(g.features);
      points.push(...pts);
      if (geoUrls[i] === cfg.geojson.vias || geoUrls[i] === cfg.geojson.sectores) climbPoints.push(...pts);
    });
    routes.forEach(d => {
      const v = d.data();
      const g = v.geojsonFeature && v.geojsonFeature.geometry;
      const c = Array.isArray(v.coordinates) ? v.coordinates : g && (g.coordinates || (g.lng != null ? [g.lng, g.lat] : null));
      if (Array.isArray(c) && typeof c[0] === 'number') { points.push(c); climbPoints.push(c); }
    });
    pois.forEach(d => { const v = d.data(); if (ofSchool(v) && Array.isArray(v.coordinates)) points.push(v.coordinates); });
    sectors.forEach(d => {
      const v = d.data();
      if (ofSchool(v) && Array.isArray(v.vertices)) v.vertices.forEach(p => { points.push([p.lng, p.lat]); climbPoints.push([p.lng, p.lat]); });
    });
    const tiles = kxoffTileKeys(cfg.bounds, points, { finePoints: climbPoints }).map(key => ({
      key, url: tileUrl(key), size: key.startsWith(`t/${KXOFF_FINE_ZOOM}/`) ? KXOFF_FINE_TILE_BYTES : KXOFF_TILE_BYTES
    }));
    const tpl = glyphTemplate();
    const glyphs = [];
    KXOFF_GLYPH_FONTS.forEach(font => KXOFF_GLYPH_RANGES.forEach(range => glyphs.push({
      key: `g/${font}/${range}`,
      url: tpl.replace('{fontstack}', encodeURIComponent(font)).replace('{range}', range),
      size: 75000
    })));

    const blobs = [...tiles, ...glyphs, ...photos];
    const pending = blobs.filter(b => !blobSet.has(b.key));
    const docsBytes = JSON.stringify([...docs.values()]).length;
    return {
      schoolId,
      name: cfg.name || schoolId,
      geoUrls,
      docs,
      prefixes: prefixList,
      blobs,
      pending,
      photoCount: photos.length,
      tileCount: tiles.length,
      bytes: pending.reduce((s, b) => s + b.size, 0) + docsBytes,
      totalBytes: blobs.reduce((s, b) => s + b.size, 0) + docsBytes
    };
  }

  // Descarga y guarda el plan de prepare(). Si ya estaba descargada, la actualiza.
  function download(plan) {
    const schoolId = plan.schoolId;
    if (jobs.has(schoolId)) return jobs.get(schoolId).promise;
    const controller = new AbortController();
    const job = { controller, progress: { done: 0, total: plan.pending.length, bytes: 0, expected: plan.bytes } };
    jobs.set(schoolId, job);
    emit(schoolId);
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

    job.promise = (async () => {
      const stored = [];
      const failed = [];
      let lastEmit = 0;
      try {
        await pool(plan.pending, KXOFF_CONCURRENCY, async b => {
          if (controller.signal.aborted) return;
          try {
            const rec = await fetchBuffer(b.url, controller.signal);
            await kxoffPut('blobs', b.key, rec);
            stored.push(b.key);
            job.progress.bytes += rec.buf.byteLength;
          } catch (e) {
            if (e && e.name === 'QuotaExceededError') { controller.abort(); job.quota = true; }
            if (!controller.signal.aborted) failed.push(b.key);
          }
          job.progress.done++;
          if (Date.now() - lastEmit > 250) { lastEmit = Date.now(); emit(schoolId); }
        });
        if (controller.signal.aborted) throw Object.assign(new Error('cancelled'), { code: job.quota ? 'kx/quota' : 'kx/cancelled' });

        await kxoffPutMany('docs', [...plan.docs.entries()]);
        // Web: los GeoJSON quedan en una caché que el service worker consulta sin red (en la app ya van dentro)
        if (typeof caches !== 'undefined' && plan.geoUrls.length) {
          await caches.open(KXOFF_GEOJSON_CACHE).then(c => c.addAll(plan.geoUrls)).catch(() => {});
        }

        const failedSet = new Set(failed);
        const previous = index.packs[schoolId];
        index.packs[schoolId] = {
          name: plan.name,
          savedAt: Date.now(),
          // Actualización: lo de antes más lo nuevo (de lo ya guardado solo se conoce el total anterior)
          bytes: previous && previous.bytes ? previous.bytes + job.progress.bytes : plan.totalBytes - plan.bytes + job.progress.bytes,
          missing: failed.length,
          blobs: plan.blobs.map(b => b.key).filter(k => !failedSet.has(k)),
          docs: [...plan.docs.keys()],
          prefixes: plan.prefixes,
          geojson: plan.geoUrls
        };
        saveIndex();
        if (previous) await purge(previous);   // lo que la versión anterior tenía y ya no hace falta
        return { missing: failed.length };
      } catch (e) {
        // Cancelada o sin espacio: se borra lo nuevo que no use ninguna escuela
        const orphan = stored.filter(k => !blobSet.has(k));
        if (orphan.length) await kxoffDeleteMany('blobs', orphan).catch(() => {});
        throw e;
      } finally {
        jobs.delete(schoolId);
        emit(schoolId);
      }
    })();
    return job.promise;
  }

  function cancel(schoolId) {
    const job = jobs.get(schoolId);
    if (job) job.controller.abort();
  }

  // Borra del almacén lo de un paquete que ya no esté en el índice (ni en otra escuela)
  async function purge(old) {
    const blobs = (old.blobs || []).filter(k => !blobSet.has(k));
    const docs = (old.docs || []).filter(k => !docSet.has(k));
    if (blobs.length) await kxoffDeleteMany('blobs', blobs).catch(() => {});
    if (docs.length) await kxoffDeleteMany('docs', docs).catch(() => {});
    // Documentos refrescados al leerlos con red (kxGetDoc) que no venían en la descarga
    const freePrefixes = (old.prefixes || []).filter(p => !prefixes.includes(p));
    if (freePrefixes.length) {
      await kxoffTx('docs', 'readwrite', os => {
        freePrefixes.forEach(p => os.delete(IDBKeyRange.bound(p, `${p}\uffff`)));
      }).catch(() => {});
    }
    blobs.filter(k => k.startsWith('p/')).forEach(k => {
      const u = photoUrls.get(k.slice(2));
      if (u) { URL.revokeObjectURL(u); photoUrls.delete(k.slice(2)); }
    });
    const stillUsed = new Set(Object.values(index.packs).flatMap(p => p.geojson || []));
    const geo = (old.geojson || []).filter(u => !stillUsed.has(u));
    if (geo.length && typeof caches !== 'undefined') {
      await caches.open(KXOFF_GEOJSON_CACHE).then(c => Promise.all(geo.map(u => c.delete(u)))).catch(() => {});
    }
  }

  async function remove(schoolId) {
    const old = index.packs[schoolId];
    if (!old) return;
    delete index.packs[schoolId];
    saveIndex();
    await purge(old);
    emit(schoolId);
  }

  loadIndex();
  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => { unreachableUntil = 0; });
    // Otra pestaña descargó o borró una escuela
    window.addEventListener('storage', e => { if (e.key === KXOFF_INDEX) { loadIndex(); emit(null); } });
  }

  return {
    isOffline, markUnreachable, has, pack, covers, progress, cachedDoc, cachedQuery, saveDoc, saveQuery,
    transformRequest, registerProtocol, photoUrl, localizeImages, prepare, download, cancel, remove,
    packs: () => ({ ...index.packs })
  };
})();

// ============================================
// LECTURAS DE FIRESTORE CON COPIA SIN CONEXIÓN
// ============================================
function kxIsOffline() {
  return KxOffline.isOffline();
}

// Igual que ref.get(); si el documento es de una escuela descargada, sin red devuelve la copia guardada
async function kxGetDoc(ref) {
  const key = ref.path;
  if (!KxOffline.covers(key)) return ref.get();
  if (KxOffline.isOffline()) return KxOffline.cachedDoc(key);
  try {
    const snap = await kxoffTimeout(ref.get());
    KxOffline.saveDoc(key, snap.exists ? snap.data() : null);
    return snap;
  } catch (e) {
    if (e && e.code === 'kx/timeout') KxOffline.markUnreachable();
    console.warn('[Offline] Sin red, se usa la copia guardada de', key);
    return KxOffline.cachedDoc(key);
  }
}

// Igual que query.get() para una consulta guardada con la clave `key`.
// pick: subconjunto de la consulta guardada (p. ej. un sector de la escuela); entonces no se refresca la copia.
async function kxGetQuery(query, key, pick) {
  if (!KxOffline.covers(key)) return query.get();
  if (KxOffline.isOffline()) return KxOffline.cachedQuery(key, pick);
  try {
    const snap = await kxoffTimeout(query.get());
    if (!pick) KxOffline.saveQuery(key, kxoffSnapList(snap));
    return snap;
  } catch (e) {
    if (e && e.code === 'kx/timeout') KxOffline.markUnreachable();
    console.warn('[Offline] Sin red, se usa la copia guardada de', key);
    return KxOffline.cachedQuery(key, pick);
  }
}

// Envuelve el callback de un onSnapshot: sin red (o si tarda) lo llama con la copia guardada y,
// cuando llega la respuesta real, refresca la copia. filter: qué documentos de la consulta se guardan.
function kxOfflineListen(key, handler, filter) {
  let real = false;
  setTimeout(async () => {
    if (real || !KxOffline.covers(key)) return;
    const snap = await KxOffline.cachedQuery(key);
    if (!real) handler(snap);
  }, KxOffline.isOffline() ? 0 : KXOFF_TIMEOUT_MS);
  return snapshot => {
    real = true;
    if (KxOffline.covers(key)) KxOffline.saveQuery(key, kxoffSnapList(snapshot, filter));
    handler(snapshot);
  };
}

// ============================================
// INTERFAZ: botón de la ficha de escuela y hoja de descarga
// ============================================
const KxOfflineUI = (() => {
  let dialog = null;
  let current = null;          // escuela abierta en la hoja
  let plan = null;             // tamaño calculado para la escuela abierta
  let planError = null;
  let preparing = null;        // escuela cuya descarga se está preparando (antes de empezar a bajar)
  const mounts = new Set();    // botones montados (ficha móvil y popup de escritorio)

  const esc = s => (typeof kxEsc === 'function' ? kxEsc(s) : String(s));
  const icon = (n, size = 20) => (typeof kxIcon === 'function' ? kxIcon(n, { size }) : '');
  const supported = school => !!(school && typeof MAPLIBRE_SCHOOLS !== 'undefined' && MAPLIBRE_SCHOOLS[school.id]);
  const pct = p => (p && p.total ? Math.min(100, Math.round(p.done / p.total * 100)) : 0);

  function stateOf(id) {
    if (KxOffline.progress(id)) return 'downloading';
    if (preparing === id) return 'preparing';
    return KxOffline.has(id) ? 'ready' : 'none';
  }

  // ---- Botón ----
  function mount(el, school) {
    if (!el) return;
    el.dataset.kxOffSchool = supported(school) ? school.id : '';
    el.hidden = !supported(school);
    el._kxOffSchool = school;
    mounts.add(el);
    paint(el);
  }

  function paint(el) {
    const school = el._kxOffSchool;
    const id = el.dataset.kxOffSchool;
    if (!id) { el.innerHTML = ''; return; }
    const st = stateOf(id);
    const p = KxOffline.progress(id);
    const label = st === 'ready' ? 'Disponible sin conexión'
      : st === 'downloading' ? `Descargando ${pct(p)} %`
      : st === 'preparing' ? 'Preparando la descarga' : 'Descargar para usar sin conexión';
    const glyph = st === 'ready' ? 'circleCheck' : 'download';
    const ring = st === 'downloading' || st === 'preparing' ? `<span class="kx-off-ring" style="--kx-off-p:${pct(p)}" aria-hidden="true"></span>` : '';
    el.innerHTML = `<button type="button" class="kx-off-btn is-${st}" aria-label="${esc(label)}" title="${esc(label)}">${ring}${icon(glyph)}</button>`;
    el.querySelector('button').onclick = e => { e.stopPropagation(); open(school); };
  }

  function refreshMounts() {
    mounts.forEach(el => {
      if (!el.isConnected) { mounts.delete(el); return; }
      paint(el);
    });
  }

  // ---- Hoja ----
  function ensureDialog() {
    if (dialog) return dialog;
    dialog = document.createElement('div');
    dialog.className = 'kx-off-sheet hidden';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'kx-off-title');
    dialog.innerHTML = '<div class="kx-off-scrim" data-kx-off-close></div><div class="kx-off-card"></div>';
    dialog.addEventListener('click', e => { if (e.target.closest('[data-kx-off-close]')) close(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && dialog && !dialog.classList.contains('hidden')) close(); });
    document.body.appendChild(dialog);
    return dialog;
  }

  function open(school) {
    if (!supported(school)) return;
    current = { id: school.id, nombre: school.nombre || (MAPLIBRE_SCHOOLS[school.id] || {}).name || school.id };
    plan = null;
    planError = null;
    ensureDialog().classList.remove('hidden');
    render();
    dialog.querySelector('.kx-off-card button')?.focus({ preventScroll: true });
    if (stateOf(current.id) === 'none') measure();
  }

  function close() {
    if (dialog) dialog.classList.add('hidden');
    current = null;
  }

  async function measure() {
    const id = current && current.id;
    if (!id) return;
    if (KxOffline.isOffline()) { planError = 'Necesitas conexión para descargar la escuela.'; render(); return; }
    try {
      const p = await KxOffline.prepare(id);
      if (current && current.id === id) { plan = p; render(); }
    } catch (e) {
      console.error('[Offline] Error preparando la descarga:', e);
      if (current && current.id === id) { planError = 'No se pudo calcular la descarga. Revisa la conexión.'; render(); }
    }
  }

  async function start() {
    const id = current && current.id;
    if (!id) return;
    const name = current.nombre;
    try {
      let p = plan && plan.schoolId === id ? plan : null;
      if (!p) {
        preparing = id;
        render();
        refreshMounts();
        try { p = await KxOffline.prepare(id); } finally { preparing = null; }
      }
      plan = null;
      const res = await KxOffline.download(p);
      if (typeof showToast === 'function') {
        if (res.missing) showToast(`${name} descargada con huecos`, 'warning', { detail: `Faltan ${res.missing} archivos. Pulsa «Actualizar» con mejor conexión para completarla.` });
        else showToast(`${name} lista para usar sin conexión`, 'success');
      }
    } catch (e) {
      if (e && e.code === 'kx/cancelled') return;
      console.error('[Offline] Error descargando:', e);
      if (typeof showToast === 'function') {
        const detail = e && e.code === 'kx/quota' ? 'No queda espacio suficiente en el dispositivo.' : 'Revisa la conexión e inténtalo de nuevo.';
        showToast('No se pudo descargar la escuela', 'error', { detail });
      }
    }
  }

  async function removePack() {
    const id = current && current.id;
    if (!id) return;
    const confirmEl = document.getElementById('confirm-modal');
    if (confirmEl) confirmEl.classList.add('kx-above');   // por encima de esta hoja
    const ok = typeof showConfirm === 'function'
      ? await showConfirm(`Se borrará la copia de ${current.nombre} de este dispositivo. Lo que hayas registrado no se pierde.`, 'Quitar descarga', 'Quitar')
      : true;
    if (confirmEl) confirmEl.classList.remove('kx-above');
    if (!ok) return;
    await KxOffline.remove(id);
    if (typeof showToast === 'function') showToast('Descarga eliminada', 'info');
  }

  function render() {
    if (!dialog || !current) return;
    const card = dialog.querySelector('.kx-off-card');
    const id = current.id;
    const st = stateOf(id);
    const btn = (label, action, variant = 'primary', ic) => (typeof kxButtonHTML === 'function'
      ? kxButtonHTML({ icon: ic, label, variant, size: 'lg', attrs: { 'data-kx-off-act': action } })
      : `<button type="button" data-kx-off-act="${action}">${esc(label)}</button>`);
    const includes = `<ul class="kx-off-list">
        <li>${icon('route', 18)}<span>Vías, sectores, parkings y puntos de interés</span></li>
        <li>${icon('images', 18)}<span>Croquis con sus trazados, votos y comentarios</span></li>
        <li>${icon('map', 18)}<span>Mapa satélite de la zona</span></li>
        <li>${icon('check', 18)}<span>Registro de sesiones y ascensos: se suben solos al volver la cobertura</span></li>
      </ul>`;
    let body = '';
    let actions = '';

    if (st === 'preparing') {
      body = `<p class="kx-off-meta" aria-live="polite">Preparando la descarga…</p>${includes}`;
      actions = btn('Seguir usando la app', 'close', 'tertiary');
    } else if (st === 'downloading') {
      const p = KxOffline.progress(id);
      body = `<div class="kx-off-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct(p)}" aria-label="Progreso de la descarga">
          <span style="width:${pct(p)}%"></span></div>
        <p class="kx-off-meta">${pct(p)} % · ${esc(kxoffFormatBytes(p.bytes))} de unos ${esc(kxoffFormatBytes(p.expected))}</p>
        <p class="kx-off-note">Puedes cerrar esta ventana y seguir usando la app mientras se descarga.</p>`;
      actions = btn('Cancelar descarga', 'cancel', 'secondary') + btn('Seguir usando la app', 'close', 'tertiary');
    } else if (st === 'ready') {
      const pk = KxOffline.pack(id);
      const date = new Date(pk.savedAt).toLocaleDateString('es-ES', { day: 'numeric', month: 'long' });
      body = `<p class="kx-off-status">${icon('circleCheck', 20)}<span>Disponible sin conexión</span></p>
        <p class="kx-off-meta">${esc(kxoffFormatBytes(pk.bytes))} · actualizada el ${esc(date)}</p>
        ${pk.missing ? `<p class="kx-off-warn">${icon('triangleAlert', 18)}<span>Faltan ${pk.missing} archivos por bajar. Actualiza con mejor conexión para completarla.</span></p>` : ''}
        ${includes}
        <p class="kx-off-note">Los rótulos y las curvas de nivel del mapa necesitan conexión.</p>`;
      actions = btn('Actualizar', 'update', 'primary', 'refresh') + btn('Quitar descarga', 'remove', 'tertiary', 'trash');
    } else {
      const size = planError
        ? `<p class="kx-off-warn">${icon('wifiOff', 18)}<span>${esc(planError)}</span></p>`
        : `<p class="kx-off-meta" aria-live="polite">${plan ? `Unos ${esc(kxoffFormatBytes(plan.bytes))}${plan.photoCount ? ` · ${plan.photoCount} ${plan.photoCount === 1 ? 'foto' : 'fotos'} de croquis` : ''}` : 'Calculando el tamaño…'}</p>`;
      body = `${size}${includes}
        <p class="kx-off-note">Mejor con wifi. Los rótulos y las curvas de nivel del mapa necesitan conexión.</p>`;
      actions = btn('Descargar', 'download', 'primary', 'download') + btn('Ahora no', 'close', 'tertiary');
    }

    card.innerHTML = `<header class="kx-off-head">
        <h2 class="kx-off-title" id="kx-off-title">${esc(current.nombre)} sin conexión</h2>
        <button type="button" class="kx-close" data-kx-off-close aria-label="Cerrar">${icon('x', 20)}</button>
      </header>
      <div class="kx-off-body">${body}</div>
      <div class="kx-off-actions">${actions}</div>`;
    const dl = card.querySelector('[data-kx-off-act="download"]');
    if (dl && !plan && !planError) dl.disabled = true;
    card.querySelectorAll('[data-kx-off-act]').forEach(b => {
      b.onclick = () => {
        const act = b.dataset.kxOffAct;
        if (act === 'download' || act === 'update') start();
        else if (act === 'cancel') KxOffline.cancel(id);
        else if (act === 'remove') removePack();
        else close();
      };
    });
  }

  if (typeof document === 'undefined') return { mount, open, close };   // Node (pruebas)

  document.addEventListener('kx:offline-changed', e => {
    refreshMounts();
    const id = e.detail && e.detail.schoolId;
    if (current && (!id || id === current.id)) render();
  });

  // Aviso al perder la conexión: qué sigue funcionando
  window.addEventListener('offline', () => {
    if (typeof showToast !== 'function') return;
    const names = Object.values(KxOffline.packs()).map(p => p.name);
    showToast('Sin conexión', 'info', {
      detail: names.length
        ? `Tienes disponible: ${names.join(', ')}. Lo que registres se subirá al volver la cobertura.`
        : 'Lo que registres se guardará y se subirá al volver la cobertura.'
    });
  });

  return { mount, open, close };
})();

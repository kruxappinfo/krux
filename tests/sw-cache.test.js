// Service Worker: tras subir CACHE_VERSION, los JS publicados (admin.js, admin-routes.js, sector-images.js) deben descargarse de la red
// y no servirse de una caché vieja ni de la caché HTTP del navegador. Carga sw.js REAL en un entorno simulado (sin red ni navegador).
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
const versionOf = (src) => (src.match(/const CACHE_VERSION = '([^']+)'/) || [])[1];
let COMMITTED = null;
try { COMMITTED = execFileSync('git', ['show', 'HEAD:sw.js'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch (_) { /* sin git */ }

// Entorno mínimo de un Service Worker: caches, fetch, Request y los listeners registrados
function boot(src = SRC) {
  const log = { fetches: [], skipWaiting: 0, claimed: 0, put: [], deleted: [] };
  const stores = new Map();
  const getStore = (name) => { if (!stores.has(name)) stores.set(name, new Map()); return stores.get(name); };
  const keyOf = (r) => (typeof r === 'string' ? new URL(r, 'https://krux.test/').href : r.url);
  const cacheApi = (name) => ({
    match: async (r) => getStore(name).get(keyOf(r)),
    put: async (r, res) => { log.put.push(keyOf(r)); getStore(name).set(keyOf(r), res); },
    addAll: async (reqs) => { for (const r of reqs) { const res = await ctx.fetch(r); getStore(name).set(keyOf(r), res); } }
  });
  class FakeRequest { constructor(url, init = {}) { this.url = new URL(url, 'https://krux.test/').href; this.cache = init.cache || 'default'; this.method = 'GET'; this.mode = 'no-cors'; } }
  const listeners = {};
  const ctx = {
    console: { log() {}, warn() {}, error() {} }, URL, Promise, Set, Map, Array, Object, JSON, Request: FakeRequest,
    fetch: async (r, init) => {
      const req = typeof r === 'string' ? new FakeRequest(r) : r;
      log.fetches.push({ url: req.url, cache: (init && init.cache) || req.cache || 'default' });
      return { ok: true, status: 200, url: req.url, clone() { return this; } };
    },
    caches: {
      open: async (n) => cacheApi(n),
      keys: async () => [...stores.keys()],
      delete: async (n) => { log.deleted.push(n); return stores.delete(n); },
      match: async () => undefined
    },
    self: { location: { origin: 'https://krux.test' }, skipWaiting: () => { log.skipWaiting++; return Promise.resolve(); }, clients: { claim: () => { log.claimed++; return Promise.resolve(); } },
      addEventListener: (type, fn) => { listeners[type] = fn; } }
  };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  const waits = [];
  const fire = async (type, extra = {}) => { const e = Object.assign({ waitUntil: (p) => waits.push(p), respondWith: (p) => waits.push(p) }, extra); listeners[type](e); await Promise.all(waits.splice(0)); };
  return { ctx, log, stores, getStore, fire, FakeRequest };
}

describe('Service Worker: versión de caché y descarga de los JS protegidos', () => {
  it('CACHE_VERSION es nueva respecto a la última versión confirmada en git', () => {
    expect(versionOf(SRC)).toMatch(/^v\d+$/);
    if (COMMITTED && !versionOf(COMMITTED)?.startsWith('v306')) expect(versionOf(SRC)).not.toBe(versionOf(COMMITTED));
    else expect(Number(versionOf(SRC).slice(1))).toBeGreaterThan(305);
  });

  it('la instalación precachea con cache:"reload" (no usa copias de la caché HTTP) e incluye sector-images.js', async () => {
    const sw = boot();
    await sw.fire('install');
    const fetched = sw.log.fetches.filter((f) => f.url.startsWith('https://krux.test/'));
    expect(fetched.length).toBeGreaterThan(30);
    expect(fetched.every((f) => f.cache === 'reload')).toBe(true);
    expect(fetched.some((f) => f.url.endsWith('/sector-images.js'))).toBe(true);
    expect(sw.log.skipWaiting).toBe(1);   // se mantiene la activación inmediata
  });

  it('la activación borra las cachés de versiones anteriores y conserva las actuales; reclama los clientes', async () => {
    const sw = boot();
    const v = versionOf(SRC);
    sw.getStore('krux-cache-v305').set('x', 1); sw.getStore('krux-data-v305').set('x', 1); sw.getStore('krux-offline-pack').set('x', 1);
    sw.getStore(`krux-cache-${v}`).set('x', 1); sw.getStore(`krux-data-${v}`).set('x', 1); sw.getStore('otra-app').set('x', 1);
    await sw.fire('activate');
    expect(sw.log.deleted.sort()).toEqual(['krux-cache-v305', 'krux-data-v305', 'krux-offline-pack'].sort());
    expect([...sw.stores.keys()].sort()).toEqual([`krux-cache-${v}`, `krux-data-${v}`, 'otra-app'].sort());
    expect(sw.log.claimed).toBe(1);
  });

  for (const file of ['admin.js', 'admin-routes.js', 'sector-images.js']) {
    it(`${file}: sin copia en la caché nueva se descarga de la red con cache:"reload" y se guarda`, async () => {
      const sw = boot();
      const req = new sw.FakeRequest(`https://krux.test/${file}`);
      await sw.fire('fetch', { request: req });
      const f = sw.log.fetches.find((x) => x.url.endsWith('/' + file));
      expect(f && f.cache).toBe('reload');
      expect(sw.log.put.some((u) => u.endsWith('/' + file))).toBe(true);
    });
  }

  it('con copia en la caché de esta versión se sigue sirviendo primero la caché (sin tocar esa estrategia)', async () => {
    const sw = boot();
    const url = 'https://krux.test/sector-images.js';
    sw.getStore(`krux-cache-${versionOf(SRC)}`).set(url, { ok: true, status: 200, tag: 'copia-cacheada' });
    let answered;
    await sw.fire('fetch', { request: new sw.FakeRequest(url), respondWith: (p) => { answered = p; } });
    expect((await answered).tag).toBe('copia-cacheada');
    expect(sw.log.fetches.find((x) => x.url === url).cache).toBe('default');   // la revalidación en segundo plano no cambia
  });

  it('un recurso de otro origen sin copia no fuerza reload (no se altera la política de terceros)', async () => {
    const sw = boot();
    await sw.fire('fetch', { request: new sw.FakeRequest('https://cdn.example.com/lib.js') });
    expect(sw.log.fetches.find((x) => x.url.startsWith('https://cdn.example.com/')).cache).toBe('default');
  });

  it('las demás estrategias no cambian: GeoJSON sigue «red primero» y Firebase no se intercepta', async () => {
    const sw = boot();
    let intercepted = false;
    await sw.fire('fetch', { request: new sw.FakeRequest('https://firestore.googleapis.com/v1/x'), respondWith: () => { intercepted = true; } });
    expect(intercepted).toBe(false);
    await sw.fire('fetch', { request: new sw.FakeRequest('https://krux.test/Cartografia/Valeria/Valeria_Vias.geojson') });
    expect(sw.log.fetches.find((x) => x.url.endsWith('.geojson')).cache).toBe('default');
  });

  it('el único cambio de sw.js respecto a git son la versión, el precacheo con reload y la descarga fresca en cache-miss', () => {
    if (!COMMITTED || versionOf(COMMITTED) === versionOf(SRC)) return;
    const strip = (s) => s.replace(/\/\/.*$/gm, '').replace(/\s+/g, ' ');
    const a = strip(COMMITTED), b = strip(SRC);
    const normalized = b
      .replace(`'${versionOf(SRC)}'`, `'${versionOf(COMMITTED)}'`)
      .replace('cache.addAll(STATIC_ASSETS.map((url) => new Request(url, { cache: \'reload\' })))', 'cache.addAll(STATIC_ASSETS)')
      .replace('return fetchAndCache(request, cache, new URL(request.url).origin === self.location.origin);', 'return fetchAndCache(request, cache);')
      .replace('async function fetchAndCache(request, cache, fresh = false)', 'async function fetchAndCache(request, cache)')
      .replace("await fetch(request, fresh ? { cache: 'reload' } : undefined)", 'await fetch(request)');
    expect(normalized).toBe(a);
  });
});

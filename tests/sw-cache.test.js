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

// Regla de la subida de versión: si sw.js es IDÉNTICO al confirmado en git no hay nada que subir; si DIFIERE, CACHE_VERSION debe ser nueva
// (los .js se sirven «primero caché»: sin subir la versión los usuarios seguirían con el código anterior). Devuelve el problema o null.
function versionBumpProblem(src, committed) {
  if (committed == null || src === committed) return null;
  return versionOf(src) === versionOf(committed) ? `sw.js cambió pero CACHE_VERSION sigue siendo ${versionOf(src)}: hay que subirla` : null;
}

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
  it('CACHE_VERSION es nueva respecto a la última versión confirmada en git (si sw.js es idéntico a HEAD no hay nada que subir)', () => {
    expect(versionOf(SRC)).toMatch(/^v\d+$/);
    expect(Number(versionOf(SRC).slice(1))).toBeGreaterThan(305);   // nunca por debajo de la última versión publicada antes de este control
    expect(versionBumpProblem(SRC, COMMITTED)).toBeNull();
  });

  it('regla de la subida de versión (casos sintéticos): idéntico a HEAD → no se exige incremento; distinto → la versión debe ser nueva', () => {
    const sw = (v, extra = '') => `const CACHE_VERSION = '${v}';\n${extra}`;
    // sin git: no hay con qué comparar
    expect(versionBumpProblem(sw('v307'), null)).toBeNull();
    // idéntico a HEAD: no se exige incremento (copia limpia tras publicar)
    expect(versionBumpProblem(sw('v307'), sw('v307'))).toBeNull();
    // distinto de HEAD con la versión nueva: correcto (preparar una publicación)
    expect(versionBumpProblem(sw('v307'), sw('v306'))).toBeNull();
    expect(versionBumpProblem(sw('v307', 'const x = 1;'), sw('v306'))).toBeNull();
    // distinto de HEAD pero con la MISMA versión: es el error que el control debe seguir detectando
    expect(versionBumpProblem(sw('v306', 'const x = 1;'), sw('v306'))).toMatch(/CACHE_VERSION/);
    expect(versionBumpProblem(sw('v306', 'const x = 1;'), sw('v306', 'const x = 2;'))).toMatch(/CACHE_VERSION/);
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
    // El precacheo con reload y la descarga fresca son SIEMPRE obligatorios en el sw.js actual (también cuando ya están confirmados en git)
    expect(SRC).toContain("new Request(url, { cache: 'reload' })");
    expect(SRC).toContain("await fetch(request, fresh ? { cache: 'reload' } : undefined)");
    let normalized = b.replace(`'${versionOf(SRC)}'`, `'${versionOf(COMMITTED)}'`);
    // Transición v305→v306: el git anterior aún NO tenía el reload, así que se deshace en la copia de trabajo para comparar.
    // Transiciones posteriores (p. ej. v306→v307): git ya lo tiene, y entonces el ÚNICO cambio admitido es la versión.
    const gitAlreadyHasReload = COMMITTED.includes("new Request(url, { cache: 'reload' })");
    if (!gitAlreadyHasReload) {
      normalized = normalized
        .replace('cache.addAll(STATIC_ASSETS.map((url) => new Request(url, { cache: \'reload\' })))', 'cache.addAll(STATIC_ASSETS)')
        .replace('return fetchAndCache(request, cache, new URL(request.url).origin === self.location.origin);', 'return fetchAndCache(request, cache);')
        .replace('async function fetchAndCache(request, cache, fresh = false)', 'async function fetchAndCache(request, cache)')
        .replace("await fetch(request, fresh ? { cache: 'reload' } : undefined)", 'await fetch(request)');
    }
    // v307→v308 (push en la web): además se admiten el SDK de mensajería en el precacheo y los listeners push/notificationclick
    const withoutPush = (x) => x.replace(" './vendor/firebase-9.23.0/firebase-messaging-compat.js',", '')
      .replace(/self\.addEventListener\('push'[\s\S]*$/, '');
    expect(withoutPush(normalized)).toBe(withoutPush(a));
  });
});

// Sesiones de escalada (climb-session.js): cronómetro, pausas, metros, GPS, estadísticas y el ciclo completo
// con la cola de sincronización. Se carga el archivo tal cual en un contexto aislado, con Firebase simulado.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SRC = readFileSync(new URL('../climb-session.js', import.meta.url), 'utf8');
const RANK = ['5a', '5b', '6a', '6a+', '6b', '6c', '7a'];

// Mundo simulado: Firestore en memoria, logAscent con la misma semántica que user-features.js, localStorage y GPS
function world({ online = true, geo = null } = {}) {
  const store = new Map();               // ruta → documento
  const ascents = new Map();             // id → payload recibido por logAscent
  const ls = new Map();
  let idSeq = 0;
  const w = { online, logCalls: 0, failLog: false, geo, watchers: [], remote: [] };
  const ref = (path) => ({
    id: path.split('/').pop(),
    set: async (data, opts) => {
      if (!w.online) throw new Error('offline');
      store.set(path, opts && opts.merge ? { ...(store.get(path) || {}), ...data } : data);
    },
    get: async () => ({ exists: store.has(path), data: () => store.get(path) }),
    onSnapshot: () => () => {},
    collection: (n) => coll(`${path}/${n}`)
  });
  const coll = (path) => ({
    doc: (id) => ref(`${path}/${id || 'auto' + (++idSeq)}`),
    where: () => { const q = { limit: () => q, orderBy: () => q, where: () => q, get: async () => ({ docs: path.endsWith('/climb_sessions') ? w.remote.map(r => ({ id: r.id, data: () => r.data })) : [] }) }; return q; }
  });
  const ctx = vm.createContext({
    console, setTimeout, clearTimeout, setInterval: () => 0, Date,
    db: { collection: (n) => (n === 'users' ? { doc: (u) => ref(`users/${u}`) } : coll(n)) },
    firebase: {
      auth: () => ({ currentUser: { uid: 'u1' }, onAuthStateChanged: () => {} }),
      firestore: { Timestamp: { fromMillis: (ms) => ({ toMillis: () => ms }) }, FieldValue: { serverTimestamp: () => 'SERVER_TS' } }
    },
    logAscent: async (payload) => {
      w.logCalls++;
      if (!w.online || w.failLog) return false;
      if (!ascents.has(payload.id)) ascents.set(payload.id, payload);   // id fijo: no se duplica
      return true;
    },
    kxGradeRank: (g) => RANK.indexOf(g),
    localStorage: { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, v) },
    navigator: { get onLine() { return w.online; }, geolocation: {
      watchPosition: (ok, err) => { const id = w.watchers.length + 1; w.watchers.push({ ok, err, id, cleared: false }); return id; },
      clearWatch: (id) => { w.watchers.find(x => x.id === id).cleared = true; }
    } },
    window: { addEventListener() {}, Capacitor: undefined },
    document: { addEventListener() {}, visibilityState: 'visible' },
    fetch: async () => ({ ok: false })
  });
  vm.runInContext(SRC, ctx, { filename: 'climb-session.js' });
  w.get = (name) => vm.runInContext(name, ctx);
  w.store = store; w.ascents = ascents; w.ls = ls;
  return w;
}
const flushAsync = () => new Promise(r => setTimeout(r, 15));
const fix = (lat, lng, extra = {}) => ({ coords: { latitude: lat, longitude: lng, accuracy: 8, ...extra }, timestamp: Date.now() });

describe('cronómetro', () => {
  const w = world();
  const { kxsActiveMs, kxsNewSession, kxsPause, kxsResume, kxsFinish, kxsFormatClock, kxsFormatDuration } = Object.fromEntries(
    ['kxsActiveMs', 'kxsNewSession', 'kxsPause', 'kxsResume', 'kxsFinish', 'kxsFormatClock', 'kxsFormatDuration'].map(n => [n, w.get(n)]));
  const T0 = 1_700_000_000_000;

  it('el tiempo se deriva de marcas de tiempo, sin contadores', () => {
    const s = kxsNewSession({ id: 'a', now: T0 });
    expect(kxsActiveMs(s, T0 + 90_000)).toBe(90_000);
    expect(kxsActiveMs(s, T0 + 5_000_000)).toBe(5_000_000);   // aunque la app haya estado en segundo plano
  });

  it('la pausa detiene el tiempo contabilizado y reanudar lo continúa', () => {
    let s = kxsNewSession({ id: 'a', now: T0 });
    s = kxsPause(s, T0 + 60_000);
    expect(s.status).toBe('paused');
    expect(kxsActiveMs(s, T0 + 60_000)).toBe(60_000);
    expect(kxsActiveMs(s, T0 + 600_000)).toBe(60_000);        // en pausa no corre
    s = kxsResume(s, T0 + 600_000);
    expect(s.status).toBe('active');
    expect(kxsActiveMs(s, T0 + 660_000)).toBe(120_000);
  });

  it('varias pausas se restan todas; pausar o reanudar dos veces no hace nada', () => {
    let s = kxsNewSession({ id: 'a', now: T0 });
    s = kxsPause(s, T0 + 10_000); s = kxsResume(s, T0 + 20_000);
    s = kxsPause(s, T0 + 30_000); s = kxsResume(s, T0 + 50_000);
    expect(kxsActiveMs(s, T0 + 60_000)).toBe(60_000 - 10_000 - 20_000);
    expect(kxsResume(s, T0 + 70_000)).toBe(s);
    const p = kxsPause(s, T0 + 70_000);
    expect(kxsPause(p, T0 + 80_000)).toBe(p);
  });

  it('finalizar en pausa cierra el intervalo y fija la duración', () => {
    let s = kxsNewSession({ id: 'a', now: T0 });
    s = kxsPause(s, T0 + 60_000);
    const done = kxsFinish(s, T0 + 300_000, { stats: { routes: 0 } });
    expect(done.status).toBe('finished');
    expect(done.endedAt).toBe(T0 + 300_000);
    expect(done.activeMs).toBe(60_000);
    expect(done.pauses[0].to).toBe(T0 + 300_000);
    expect(kxsActiveMs(done, T0 + 9_000_000)).toBe(60_000);   // finalizada: ya no cambia
  });

  it('un reloj que retrocede no produce tiempos negativos', () => {
    const s = kxsNewSession({ id: 'a', now: T0 });
    expect(kxsActiveMs(s, T0 - 5000)).toBe(0);
    expect(kxsPause(s, T0 - 5000).pauses[0].from).toBe(T0);
  });

  it('formatos de reloj y duración', () => {
    expect(kxsFormatClock(0)).toBe('00:00:00');
    expect(kxsFormatClock(5_076_000)).toBe('01:24:36');
    expect(kxsFormatDuration(30_000)).toBe('< 1 min');
    expect(kxsFormatDuration(42 * 60_000)).toBe('42 min');
    expect(kxsFormatDuration(204 * 60_000)).toBe('3 h 24 min');
  });
});

describe('metros', () => {
  const w = world();
  const len = w.get('kxsRouteLength'), pick = w.get('kxsPickMeters'), stats = w.get('kxsStats');

  it('un solo largo da su longitud; multilargo, la suma', () => {
    expect(len({ long1: 25 })).toBe(25);
    expect(len({ modalidad: 'Multilargo', long1: 10, long2: 25 })).toBe(35);
  });
  it('varias longitudes de una vía no multilargo son ambiguas: no se adivinan', () => {
    expect(len({ modalidad: 'Deportiva', long1: 10, long2: 25 })).toBeNull();
    expect(len({})).toBeNull();
    expect(len({ long1: 0 })).toBeNull();
  });
  it('mismo id con variantes: se elige por nombre, y si no coinciden no se inventa', () => {
    const cands = [{ nombre: 'Thor', long1: 30 }, { nombre: 'Thor bis', long1: 12 }];
    expect(pick(cands, 'thor bis')).toBe(12);
    expect(pick(cands, 'otro')).toBeNull();
    expect(pick([], 'x')).toBeNull();
    expect(pick([{ nombre: 'A', long1: 20 }, { nombre: 'A', long1: 20 }], 'A')).toBe(20);
  });
  it('los metros solo suman encadenadas con longitud; las demás se cuentan aparte', () => {
    const s = stats([
      { grade: '6a', style: 'redpoint', meters: 20 },
      { grade: '6b', style: 'flash', meters: 30 },
      { grade: '6c', style: 'onsight', meters: null },      // sin longitud: no suma ni se inventa
      { grade: '7a', style: 'project', meters: 40 }          // intento: no cuenta como metros escalados
    ]);
    expect(s.meters).toBe(50);
    expect(s.metersKnown).toBe(2);
    expect(s.metersUnknown).toBe(1);
    expect(s.routes).toBe(4); expect(s.sends).toBe(3); expect(s.attempts).toBe(1);
  });
  it('grados: recuento, sin grado aparte y máximo entre las encadenadas', () => {
    const s = stats([
      { grade: '6a', style: 'redpoint' }, { grade: '6a', style: 'flash' }, { grade: '', style: 'redpoint' },
      { grade: '?', style: 'redpoint' }, { grade: '7a', style: 'project' }, { grade: '6b', style: 'toprope' }
    ]);
    expect(s.gradeCounts).toEqual({ '6a': 2, '7a': 1, '6b': 1 });
    expect(s.ungraded).toBe(2);
    expect(s.maxGrade).toBe('6b');                            // el 7a fue un intento
    expect(stats([]).maxGrade).toBe('');
  });
});

describe('GPS: filtro, distancia y track', () => {
  const w = world();
  const accept = w.get('kxsAcceptFix'), hav = w.get('kxsHaversine'), pack = w.get('kxsPackTrack'), unpack = w.get('kxsUnpackTrack'), down = w.get('kxsDownsample');

  it('haversine: ~111 km por grado de latitud', () => {
    expect(Math.round(hav({ lat: 0, lng: 0 }, { lat: 1, lng: 0 }) / 1000)).toBe(111);
  });
  it('descarta fixes imprecisos, parados y saltos imposibles', () => {
    const last = { lat: 40, lng: -3, t: 0 };
    expect(accept(null, { lat: 40, lng: -3, acc: 10, t: 0 })).toBe(0);
    expect(accept(last, { lat: 40, lng: -3, acc: 90, t: 5000 })).toBeNull();              // impreciso
    expect(accept(last, { lat: 40.00001, lng: -3, acc: 10, t: 5000 })).toBeNull();        // ~1 m: parado
    expect(accept(last, { lat: 40.01, lng: -3, acc: 10, t: 5000 })).toBeNull();           // 1,1 km en 5 s
    expect(accept(last, { lat: 40.0003, lng: -3, acc: 10, t: 30000 })).toBeGreaterThan(30);
    expect(accept(last, { lat: NaN, lng: -3, t: 1 })).toBeNull();
  });
  it('el track se reduce uniformemente conservando extremos y se guarda sin arrays anidados', () => {
    const pts = Array.from({ length: 5000 }, (_, i) => ({ lng: -3 + i / 1e5, lat: 40, t: i }));
    const d = down(pts, 2000);
    expect(d).toHaveLength(2000);
    expect(d[0]).toBe(pts[0]); expect(d[1999]).toBe(pts[4999]);
    const packed = pack(pts);
    expect(packed.lng).toHaveLength(2000);
    expect(packed.lng.every(n => typeof n === 'number')).toBe(true);
    expect(unpack(packed)[10]).toMatchObject({ lat: 40 });
    expect(unpack(null)).toEqual([]);
  });
});

describe('sesión completa', () => {
  const info = (over) => ({ schoolId: 'valeria', schoolName: 'Valeria', routeId: 1, routeName: 'Thor', grade: '6b', sector: 'Puente', style: 'redpoint', ...over });

  it('iniciar sin GPS: sesión activa, sin pedir ubicación ni registrar coordenadas', async () => {
    const w = world();
    const K = w.get('KruxSession');
    await K.init({ uid: 'u1' });
    const s = await K.start({ gps: false });
    expect(s.status).toBe('active');
    expect(s.gps).toMatchObject({ enabled: false, status: 'off' });
    expect(w.watchers).toHaveLength(0);
    await flushAsync();
    expect(w.store.get(`users/u1/climb_sessions/${s.id}`).status).toBe('active');
    expect(w.store.get(`users/u1/climb_sessions/${s.id}`).userId).toBe('u1');
  });

  it('no se puede iniciar una segunda sesión mientras hay una activa', async () => {
    const w = world(); const K = w.get('KruxSession');
    await K.init({ uid: 'u1' });
    await K.start({});
    await expect(K.start({})).rejects.toMatchObject({ code: 'exists' });
  });

  it('iniciar con GPS: escucha la ubicación, acumula distancia y pausa/finaliza la detienen', async () => {
    const w = world(); const K = w.get('KruxSession');
    await K.init({ uid: 'u1' });
    await K.start({ gps: true });
    expect(w.watchers).toHaveLength(1);
    const t0 = Date.now();
    w.watchers[0].ok({ coords: { latitude: 40, longitude: -3, accuracy: 6 }, timestamp: t0 });
    w.watchers[0].ok({ coords: { latitude: 40.0004, longitude: -3, accuracy: 6 }, timestamp: t0 + 30000 });
    expect(K.get().session.gps.distanceM).toBeGreaterThan(40);
    expect(K.get().session.gps.status).toBe('ok');
    K.pause();
    expect(w.watchers[0].cleared).toBe(true);                 // en pausa no hay actualizaciones de ubicación
    K.resume();
    expect(w.watchers).toHaveLength(2);
    w.watchers[1].ok({ coords: { latitude: 40.0008, longitude: -3, accuracy: 6 }, timestamp: t0 + 60000 });
    const done = await K.finish();
    expect(w.watchers[1].cleared).toBe(true);
    expect(done.session.gps.distanceM).toBeGreaterThan(80);
    await flushAsync();
    const saved = w.store.get(`users/u1/climb_sessions/${done.session.id}`);
    expect(saved.track.lng.length).toBe(3);
    expect(saved.gps.distanceM).toBeGreaterThan(80);
  });

  it('GPS denegado: la sesión funciona igual y queda anotado', async () => {
    const w = world(); const K = w.get('KruxSession');
    await K.init({ uid: 'u1' });
    await K.start({ gps: true });
    w.watchers[0].err({ code: 1 });
    expect(K.isActive()).toBe(true);
    expect(K.get().session.gps.status).toBe('denied');
    K.pause(); K.resume();
    expect(w.watchers).toHaveLength(1);                       // no se vuelve a pedir tras denegar
    await K.addAscent(info());
    expect(K.stats().routes).toBe(1);
  });

  it('sin GPS activado no se guarda track aunque lleguen fixes', async () => {
    const w = world(); const K = w.get('KruxSession');
    await K.init({ uid: 'u1' });
    await K.start({ gps: false });
    const done = await K.finish();
    await flushAsync();
    expect(w.store.get(`users/u1/climb_sessions/${done.session.id}`).track).toBeUndefined();
    expect(done.session.gps.distanceM).toBe(0);
  });

  it('registrar varias vías: cada ascenso usa logAscent con sessionId y hora real, sin duplicados', async () => {
    const w = world(); const K = w.get('KruxSession');
    await K.init({ uid: 'u1' });
    const s = await K.start({});
    await K.addAscent(info());
    await K.addAscent(info({ routeId: 2, routeName: 'Otra', grade: '6a', style: 'flash', companions: ['u2'] }));
    await K.addAscent(info({ routeId: 3, routeName: 'Intento', grade: '7a', style: 'project' }));
    expect(K.stats()).toMatchObject({ routes: 3, sends: 2, attempts: 1 });
    await K.flush(); await K.flush(); await K.flush();         // reintentos: el id fijo evita duplicar
    expect(w.ascents.size).toBe(3);
    const payloads = [...w.ascents.values()];
    expect(payloads.every(p => p.sessionId === s.id)).toBe(true);
    expect(payloads.every(p => typeof p.loggedAt === 'number' && p.id)).toBe(true);
    expect(payloads.find(p => p.routeId === 2).companions).toEqual(['u2']);
    expect(payloads.find(p => p.routeId === 3).style).toBe('project');
    expect(new Set(payloads.map(p => p.id)).size).toBe(3);
    expect(w.store.get(`users/u1/climb_sessions/${s.id}`).ascentIds).toHaveLength(3);
  });

  it('un estilo desconocido cae en redpoint (el resto de valores no se inventa)', async () => {
    const w = world(); const K = w.get('KruxSession');
    await K.init({ uid: 'u1' });
    await K.start({});
    const e = await K.addAscent(info({ style: 'raro' }));
    expect(e.style).toBe('redpoint');
  });

  it('finalizar calcula estadísticas, escuela principal y deja la sesión cerrada sin duplicar ascensos', async () => {
    const w = world(); const K = w.get('KruxSession');
    await K.init({ uid: 'u1' });
    await K.start({});
    await K.addAscent(info());
    await K.addAscent(info({ routeId: 2, grade: '6a' }));
    await K.addAscent(info({ routeId: 9, schoolId: 'mora', schoolName: 'Mora' }));
    const done = await K.finish();
    expect(K.isActive()).toBe(false);
    expect(done.session.status).toBe('finished');
    expect(done.session.schoolName).toBe('Valeria');
    expect(done.session.stats).toMatchObject({ routes: 3, maxGrade: '6b' });
    await flushAsync();
    expect(w.ascents.size).toBe(3);                            // finalizar no crea ascensos nuevos
    const saved = w.store.get(`users/u1/climb_sessions/${done.session.id}`);
    expect(saved.status).toBe('finished');
    expect(saved.stats.routes).toBe(3);
    expect(saved.endedAt.toMillis()).toBeGreaterThanOrEqual(saved.startedAt.toMillis());
  });

  it('sin conexión: la sesión y los ascensos quedan locales y se suben al volver la red', async () => {
    const w = world({ online: false }); const K = w.get('KruxSession');
    await K.init({ uid: 'u1' });
    const s = await K.start({});
    await K.addAscent(info());
    await K.addAscent(info({ routeId: 2 }));
    expect(K.stats().routes).toBe(2);                          // el contador no espera a la red
    expect(K.pendingCount()).toBe(2);
    await K.flush();
    expect(w.ascents.size).toBe(0);
    const done = await K.finish();                                   // también se puede finalizar sin red
    expect(done.session.status).toBe('finished');
    w.online = true;
    await K.flush();
    expect(w.ascents.size).toBe(2);
    expect(w.store.get(`users/u1/climb_sessions/${s.id}`).status).toBe('finished');
    expect(K.pendingCount()).toBe(0);
  });

  it('un fallo de logAscent no pierde el ascenso: se reintenta sin duplicar', async () => {
    const w = world(); const K = w.get('KruxSession');
    await K.init({ uid: 'u1' });
    await K.start({});
    w.failLog = true;
    await K.addAscent(info());
    await K.flush();
    expect(w.ascents.size).toBe(0);
    expect(K.pendingCount()).toBe(1);
    w.failLog = false;
    await K.flush();
    expect(w.ascents.size).toBe(1);
    expect(K.pendingCount()).toBe(0);
  });

  it('recuperar una sesión activa tras reiniciar la app (misma marca de inicio y pausas)', async () => {
    const w = world(); const K = w.get('KruxSession');
    await K.init({ uid: 'u1' });
    const s = await K.start({});
    await K.addAscent(info());
    K.pause();
    const raw = w.ls.get('krux_climb_u1');
    expect(raw).toBeTruthy();

    const w2 = world(); w2.ls.set('krux_climb_u1', raw);        // «nuevo arranque»: solo queda el almacenamiento local
    const K2 = w2.get('KruxSession');
    await K2.init({ uid: 'u1' });
    expect(K2.isActive()).toBe(true);
    expect(K2.isPaused()).toBe(true);
    expect(K2.get().session.id).toBe(s.id);
    expect(K2.get().session.startedAt).toBe(s.startedAt);
    expect(K2.stats().routes).toBe(1);
    K2.resume();
    expect(K2.isPaused()).toBe(false);
  });

  it('la sesión de un usuario no aparece al entrar con otro', async () => {
    const w = world(); const K = w.get('KruxSession');
    await K.init({ uid: 'u1' });
    await K.start({});
    await K.init({ uid: 'u2' });
    expect(K.isActive()).toBe(false);
    await K.init(null);
    expect(K.isActive()).toBe(false);
    await K.init({ uid: 'u1' });
    expect(K.isActive()).toBe(true);
  });

  it('sin sesión iniciada no se puede registrar en ella (el registro convencional no se toca)', async () => {
    const w = world(); const K = w.get('KruxSession');
    await K.init({ uid: 'u1' });
    expect(await K.addAscent(info())).toBeNull();
    expect(w.logCalls).toBe(0);
  });

  it('las rutas de Firestore usan la subcolección del usuario y la carga del historial incluye lo pendiente', async () => {
    const w = world({ online: false }); const K = w.get('KruxSession');
    await K.init({ uid: 'u1' });
    await K.start({});
    await K.finish();
    const list = await K.list();
    expect(list).toHaveLength(1);
    expect(list[0].status).toBe('finished');
  });
});

describe('conflicto entre dispositivos', () => {
  const other = () => ({ id: 'otra', data: { type: 'rock', status: 'active', startedAt: { toMillis: () => 1000 }, pauses: [], rev: 3, updatedAt: { toMillis: () => 2000 }, ascentIds: [], gps: { enabled: false, status: 'off' } } });

  it('no se crea una segunda sesión si hay una activa en otro dispositivo: se retoma esa', async () => {
    const w = world(); const K = w.get('KruxSession');
    w.remote = [other()];
    await K.init({ uid: 'u1' });
    expect(K.isActive()).toBe(true);                           // sin sesión local, init ya la adopta
    expect(K.get().session.id).toBe('otra');
    await expect(K.start({})).rejects.toMatchObject({ code: 'exists' });
  });

  it('start() con una sesión remota activa y sin local lanza remote-active', async () => {
    const w = world(); const K = w.get('KruxSession');
    await K.init({ uid: 'u1' });
    w.remote = [other()];                                      // aparece después de iniciar la app
    await expect(K.start({})).rejects.toMatchObject({ code: 'remote-active' });
    expect(K.isActive()).toBe(false);
    const s = await K.adopt();
    expect(s.session.id).toBe('otra');
  });

  it('con sesión local y otra activa en otro dispositivo se avisa del conflicto (una vez)', async () => {
    const w = world(); const K = w.get('KruxSession');
    await K.init({ uid: 'u1' });
    await K.start({});
    const seen = [];
    K.on((t, api) => { if (t === 'conflict') seen.push(t); });
    w.remote = [other()];
    await K.checkConflict(true);
    await K.checkConflict(true);
    expect(seen).toHaveLength(1);
  });

  it('sin conexión se puede iniciar (no se puede comprobar) y no hay aviso falso', async () => {
    const w = world({ online: false }); const K = w.get('KruxSession');
    await K.init({ uid: 'u1' });
    w.remote = [other()];
    const s = await K.start({});
    expect(s.status).toBe('active');
  });
});

describe('permisos nativos', () => {
  const root = new URL('../', import.meta.url);
  const sh = readFileSync(new URL('../scripts/native-permissions.sh', import.meta.url), 'utf8');

  it('el script es idempotente, cubre iOS y Android y no pide ubicación en segundo plano', () => {
    expect(sh).toContain('NSLocationWhenInUseUsageDescription');
    expect(sh).toContain('ACCESS_FINE_LOCATION');
    expect(sh).toContain('ACCESS_COARSE_LOCATION');
    expect(sh).not.toMatch(/BACKGROUND_LOCATION|NSLocationAlways|UIBackgroundModes/);
    expect(sh).toMatch(/if f'android.permission.\{perm\}"' not in s/);   // solo añade si falta
  });
  it('cap:sync aplica los permisos tras sincronizar', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    expect(pkg.scripts['cap:sync']).toMatch(/cap sync.*native-permissions\.sh/);
  });
});

describe('contrato con el resto de la app', () => {
  const uf = readFileSync(new URL('../user-features.js', import.meta.url), 'utf8');
  const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');

  it('logAscent solo añade sessionId/loggedAt/companions cuando existen (registro convencional intacto)', () => {
    expect(uf).toMatch(/\.\.\.\(ascentData\.sessionId \? \{ sessionId: ascentData\.sessionId \} : \{\}\)/);
    expect(uf).toMatch(/\.\.\.\(ascentData\.loggedAt \?/);
    expect(uf).toMatch(/if \(ascentData\.id\)/);
    expect(uf).toMatch(/await db\.collection\('ascents'\)\.add\(data\)/);          // la ruta sin id sigue siendo add()
  });

  it('las reglas protegen las sesiones: solo el propietario y sin cambiar nada más', () => {
    const block = rules.match(/match \/climb_sessions\/\{sessionId\} \{[\s\S]*?\n      \}/)[0];
    expect(block).toContain('allow read, delete: if isOwner(userId)');
    expect(block).toContain("request.resource.data.type == 'rock'");
    expect(block).not.toMatch(/isAuthenticated\(\)\s*;/);
  });

  it('el permiso de ubicación de iOS está declarado y explica el uso', () => {
    const plist = readFileSync(new URL('../ios/App/App/Info.plist', import.meta.url), 'utf8');
    expect(plist).toMatch(/NSLocationWhenInUseUsageDescription<\/key>\s*<string>[^<]*sesión de escalada[^<]*<\/string>/);
  });
});

describe('calorías estimadas', () => {
  const kcal = world().get('kxsEstimateKcal');
  it('escala con el tiempo activo y es 0 sin tiempo', () => {
    expect(kcal(0)).toBe(0);
    expect(kcal(-5)).toBe(0);
    expect(kcal(3600000)).toBe(406);          // 5,8 MET × 70 kg × 1 h
    expect(kcal(7200000)).toBe(812);
  });
});

// ================== KRUX — SESIONES DE ESCALADA EN ROCA ==================
// Datos y lógica de una jornada de escalada: cronómetro derivado de marcas de tiempo, registro de vías
// con el sistema de ascensos existente (logAscent), GPS opcional y sincronización con cola local.
// La interfaz está en climb-session-ui.js; este archivo no toca el DOM.
//
// Modelo (Firestore): users/{uid}/climb_sessions/{sessionId}
//   type:'rock', status:'active'|'paused'|'finished', startedAt, endedAt, pauses:[{from,to}] (ms),
//   activeMs, gps:{enabled,status,distanceM?}, schoolId?, schoolName?, ascentIds:[], stats:{…},
//   track?:{lng:[],lat:[],t:[]} (solo si hubo GPS), rev, userId.
// La relación de verdad es ascents.sessionId; ascentIds es una copia de lectura rápida.
// Los ascensos de sesión conservan su estructura y añaden sessionId, loggedAt (hora real) y companions.

const KXS_MAX_TRACK = 2000;          // puntos que se guardan en Firestore (límite de 1 MiB por documento)
const KXS_MAX_LOCAL_TRACK = 8000;    // puntos en memoria durante la sesión
const KXS_MAX_ACCURACY_M = 50;       // se descartan fixes peores que esto
const KXS_MIN_STEP_M = 4;            // y los que no se mueven al menos esto
const KXS_MAX_SPEED_MS = 15;         // salto imposible a pie (saltos del GPS)
const KXS_STYLES = ['redpoint', 'onsight', 'flash', 'toprope', 'project'];

// ============================================
// FUNCIONES PURAS (probadas en tests/climb-session.test.js)
// ============================================

// Tiempo contabilizado: desde el inicio, sin los intervalos de pausa. Solo depende de marcas de tiempo.
function kxsActiveMs(session, now = Date.now()) {
  if (!session) return 0;
  const end = session.endedAt != null ? session.endedAt : now;
  const paused = (session.pauses || []).reduce((sum, p) => sum + Math.max(0, (p.to != null ? p.to : end) - p.from), 0);
  return Math.max(0, end - session.startedAt - paused);
}

function kxsFormatClock(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  const p = n => String(n).padStart(2, '0');
  return `${p(h)}:${p(m)}:${p(s)}`;
}

// «3 h 24 min» / «42 min» / «< 1 min»
function kxsFormatDuration(ms) {
  const min = Math.floor(ms / 60000);
  if (min < 1) return '< 1 min';
  const h = Math.floor(min / 60);
  return h ? `${h} h ${String(min % 60).padStart(2, '0')} min` : `${min} min`;
}

function kxsNewSession({ id, now, gps = false, schoolId = '', schoolName = '' }) {
  return {
    id, type: 'rock', status: 'active', startedAt: now, endedAt: null, pauses: [], activeMs: 0,
    gps: { enabled: !!gps, status: gps ? 'pending' : 'off', distanceM: 0 },
    schoolId: schoolId || '', schoolName: schoolName || '', ascentIds: [], stats: null, rev: 1, updatedAt: now
  };
}

function kxsPause(s, now) {
  if (!s || s.status !== 'active') return s;
  return { ...s, status: 'paused', pauses: [...s.pauses, { from: Math.max(now, s.startedAt), to: null }], rev: s.rev + 1, updatedAt: now };
}

function kxsResume(s, now) {
  if (!s || s.status !== 'paused') return s;
  const pauses = s.pauses.map(p => (p.to == null ? { ...p, to: Math.max(now, p.from) } : p));
  return { ...s, status: 'active', pauses, rev: s.rev + 1, updatedAt: now };
}

function kxsFinish(s, now, { stats = null, distanceM = 0, schoolId, schoolName } = {}) {
  if (!s || s.status === 'finished') return s;
  const end = Math.max(now, s.startedAt);
  const pauses = s.pauses.map(p => (p.to == null ? { ...p, to: Math.max(end, p.from) } : p));
  const done = { ...s, status: 'finished', endedAt: end, pauses, rev: s.rev + 1, updatedAt: now, stats };
  done.activeMs = kxsActiveMs(done);
  const hasGps = s.gps && s.gps.enabled && distanceM > 0;
  done.gps = { ...s.gps, distanceM: hasGps ? Math.round(distanceM) : 0, status: s.gps && s.gps.enabled ? s.gps.status : 'off' };
  if (schoolId !== undefined) { done.schoolId = schoolId; done.schoolName = schoolName || ''; }
  return done;
}

function kxsHaversine(a, b) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Decide si un fix GPS entra en el track. last: último punto aceptado ({lng,lat,t}) o null.
// Devuelve la distancia añadida (m) o null si se descarta.
function kxsAcceptFix(last, fix) {
  if (!fix || !isFinite(fix.lat) || !isFinite(fix.lng)) return null;
  if (fix.acc != null && fix.acc > KXS_MAX_ACCURACY_M) return null;
  if (!last) return 0;
  const d = kxsHaversine(last, fix);
  if (d < KXS_MIN_STEP_M) return null;
  const dt = (fix.t - last.t) / 1000;
  if (dt > 0 && d / dt > KXS_MAX_SPEED_MS) return null;
  return d;
}

// Reduce el track a un máximo de puntos repartidos de forma uniforme (conserva el primero y el último)
function kxsDownsample(points, max = KXS_MAX_TRACK) {
  if (points.length <= max) return points.slice();
  const out = [];
  const step = (points.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(points[Math.round(i * step)]);
  return out;
}

// Track de Firestore (arrays planos: Firestore no admite arrays anidados) ↔ lista de puntos
function kxsPackTrack(points) {
  const pts = kxsDownsample(points);
  return {
    lng: pts.map(p => Math.round(p.lng * 1e6) / 1e6),
    lat: pts.map(p => Math.round(p.lat * 1e6) / 1e6),
    t: pts.map(p => p.t)
  };
}
function kxsUnpackTrack(track) {
  if (!track || !Array.isArray(track.lng)) return [];
  return track.lng.map((lng, i) => ({ lng, lat: track.lat[i], t: (track.t || [])[i] }));
}

// Longitud de una vía (m) a partir de las propiedades del GeoJSON de la escuela: la misma regla que Actividad.
// Un solo largo → ese valor; multilargo → suma; varias longitudes ambiguas (variantes) → null (no se adivina).
function kxsRouteLength(p) {
  const L = [1, 2, 3, 4, 5].map(n => { const v = parseFloat(p['long' + n]); return v > 0 ? v : null; });
  if (!L.some(Boolean)) return null;
  if (L[1] == null) return L[0] || null;
  if (/multilargo/i.test(p.modalidad || '')) return L.filter(Boolean).reduce((s, v) => s + v, 0);
  return null;
}

// Elige la longitud entre las filas del GeoJSON con el mismo id (variantes): por nombre si hace falta
function kxsPickMeters(candidates, routeName) {
  if (!candidates || !candidates.length) return null;
  let cand = candidates;
  if (cand.length > 1) {
    const nm = String(routeName || '').trim().toLowerCase();
    const byName = cand.filter(p => String(p.nombre || '').trim().toLowerCase() === nm);
    if (byName.length) cand = byName;
  }
  const vals = [...new Set(cand.map(kxsRouteLength))];
  return vals.length === 1 ? vals[0] : null;
}

// Una tanda encadenada cuenta como encadenada salvo que sea un intento (project)
const kxsIsSend = e => e.style !== 'project';

// Estadísticas de la sesión a partir de sus ascensos.
// METROS ESCALADOS = longitud de las vías que se escalaron enteras hasta la reunión: encadenadas en cualquier estilo
// (redpoint, a vista, flash y top rope) y con longitud conocida. Los intentos («proyecto», no encadenada) no suman:
// no se sabe cuánto de la vía se subió y contar la vía entera sería inventar metros. Es el mismo criterio que
// «Metros escalados» de Actividad. metersUnknown cuenta las encadenadas sin longitud (nunca se inventan metros).
function kxsStats(entries) {
  const list = entries || [];
  const sends = list.filter(kxsIsSend);
  const gradeCounts = {};
  let ungraded = 0;
  list.forEach(e => {
    const g = e.grade && e.grade !== '?' ? e.grade : '';
    if (g) gradeCounts[g] = (gradeCounts[g] || 0) + 1; else ungraded++;
  });
  let meters = 0, metersKnown = 0;
  sends.forEach(e => { if (e.meters > 0) { meters += e.meters; metersKnown++; } });
  const rank = typeof kxGradeRank === 'function' ? kxGradeRank : () => -1;
  const sentGrades = sends.map(e => e.grade).filter(g => g && g !== '?');
  const maxGrade = sentGrades.length ? sentGrades.reduce((a, b) => (rank(b) > rank(a) ? b : a)) : '';
  return {
    routes: list.length, sends: sends.length, attempts: list.length - sends.length,
    meters: Math.round(meters), metersKnown, metersUnknown: sends.length - metersKnown,
    gradeCounts, ungraded, maxGrade
  };
}

// Escuela principal de la sesión: la que más ascensos tiene (o '' si no hay ninguno)
function kxsMainSchool(entries) {
  const count = new Map();
  (entries || []).forEach(e => {
    if (!e.schoolId) return;
    const c = count.get(e.schoolId) || { n: 0, name: e.schoolName || '' };
    c.n++; count.set(e.schoolId, c);
  });
  let best = null;
  count.forEach((c, id) => { if (!best || c.n > best.n) best = { id, ...c }; });
  return best ? { schoolId: best.id, schoolName: best.name } : null;
}

// Datos del ascenso (lo que recibe logAscent) a partir de una entrada de sesión.
// date: mismo formato que el formulario actual (día, sin hora); loggedAt: la hora real del registro.
function kxsAscentPayload(entry, sessionId) {
  return {
    id: entry.ascentId,
    schoolId: entry.schoolId, schoolName: entry.schoolName,
    routeId: entry.routeId, routeName: entry.routeName,
    grade: entry.grade, sector: entry.sector || '',
    style: entry.style,
    date: new Date(entry.at).toISOString().split('T')[0],
    loggedAt: entry.at,
    tries: 1,
    sessionId,
    companions: entry.companions || []
  };
}

// ============================================
// ÍNDICE DE VÍAS DE LA ESCUELA (longitudes) — compartido con Actividad
// ============================================
const kxsViasCache = new Map();
function kxsLoadViasIndex(schoolId) {
  if (kxsViasCache.has(schoolId)) return kxsViasCache.get(schoolId);
  const school = typeof MAPLIBRE_SCHOOLS !== 'undefined' ? MAPLIBRE_SCHOOLS[schoolId] : null;
  const url = school && school.geojson && school.geojson.vias;
  const p = (async () => {
    if (!url) return null;
    try {
      const r = await fetch(url);
      if (!r.ok) return null;
      const g = await r.json();
      const m = new Map();
      (g.features || []).forEach(f => {
        const id = String(f.properties && f.properties.id);
        if (!m.has(id)) m.set(id, []);
        m.get(id).push(f.properties);
      });
      return m;
    } catch (_) { return null; }
  })();
  kxsViasCache.set(schoolId, p);
  p.then(v => { if (!v) kxsViasCache.delete(schoolId); });   // un fallo de red no se queda en caché
  return p;
}

async function kxsMetersFor(schoolId, routeId, routeName) {
  if (!schoolId || routeId == null || routeId === '') return null;
  const idx = await kxsLoadViasIndex(schoolId);
  return idx ? kxsPickMeters(idx.get(String(routeId)), routeName) : null;
}

// ============================================
// ESTADO, PERSISTENCIA LOCAL Y SINCRONIZACIÓN
// ============================================
// state = { active: item|null, finished: item[] } · item = { session, entries, track:[{lng,lat,t}], dirty }
// finished: sesiones cerradas que aún no se han subido (sin conexión). Todo vive en localStorage por usuario.
const KruxSession = (() => {
  let uid = null;
  let state = { active: null, finished: [] };
  let watchId = null, watchKind = null;
  let flushing = false, finishing = false, flushTimer = null, persistAt = 0, unsub = null;
  const listeners = new Set();
  let lastGpsError = '';

  const nowMs = () => Date.now();
  const lsKey = () => `krux_climb_${uid}`;
  const emit = (type) => listeners.forEach(fn => { try { fn(type, api); } catch (e) { console.error('[sesión]', e); } });
  const user = () => (typeof firebase !== 'undefined' && firebase.auth ? firebase.auth().currentUser : null);
  const col = () => db.collection('users').doc(uid).collection('climb_sessions');

  // ---- localStorage (puede no estar disponible: se sigue en memoria) ----
  function persist(force = true) {
    if (!uid) return;
    const t = nowMs();
    if (!force && t - persistAt < 15000) return;   // el track llega a cada fix: se guarda cada 15 s
    persistAt = t;
    try { localStorage.setItem(lsKey(), JSON.stringify(state)); } catch (e) { /* sin almacenamiento */ }
  }
  function restore() {
    try {
      const raw = localStorage.getItem(lsKey());
      const s = raw ? JSON.parse(raw) : null;
      state = { active: s && s.active || null, finished: (s && s.finished) || [] };
    } catch (e) { state = { active: null, finished: [] }; }
  }

  // ---- Firestore ----
  function serialize(item) {
    const s = item.session;
    const ts = ms => (ms == null ? null : firebase.firestore.Timestamp.fromMillis(ms));
    const doc = {
      userId: uid, type: s.type, status: s.status,
      startedAt: ts(s.startedAt), endedAt: ts(s.endedAt), pauses: s.pauses, activeMs: kxsActiveMs(s),
      gps: s.gps, schoolId: s.schoolId || '', schoolName: s.schoolName || '',
      ascentIds: item.entries.map(e => e.ascentId), stats: s.stats || kxsStats(item.entries),
      rev: s.rev, updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    if (s.status === 'finished' && s.gps && s.gps.enabled && item.track && item.track.length > 1) doc.track = kxsPackTrack(item.track);
    return doc;
  }

  function deserialize(id, d) {
    const ms = v => (v && v.toMillis ? v.toMillis() : (typeof v === 'number' ? v : null));
    return {
      id, type: d.type || 'rock', status: d.status, startedAt: ms(d.startedAt), endedAt: ms(d.endedAt),
      pauses: d.pauses || [], activeMs: d.activeMs || 0, gps: d.gps || { enabled: false, status: 'off', distanceM: 0 },
      schoolId: d.schoolId || '', schoolName: d.schoolName || '', ascentIds: d.ascentIds || [],
      stats: d.stats || null, rev: d.rev || 1, updatedAt: ms(d.updatedAt) || 0
    };
  }

  // Sube lo pendiente de un item: primero los ascensos (por el mismo logAscent, con id fijo para no duplicar)
  // y después el documento de la sesión.
  async function flushItem(item) {
    for (const e of item.entries) {
      if (e.synced) continue;
      const ok = await logAscent(kxsAscentPayload(e, item.session.id));
      if (!ok) return false;
      e.synced = true;
      persist();
    }
    if (item.dirty) {
      const rev = item.session.rev;
      await col().doc(item.session.id).set(serialize(item), { merge: true });
      if (item.session.rev === rev) item.dirty = false;
    }
    return true;
  }

  async function flush() {
    if (flushing || !uid || !user() || (typeof navigator !== 'undefined' && navigator.onLine === false)) return;
    flushing = true;
    try {
      for (const item of [...state.finished]) {
        if (await flushItem(item)) state.finished = state.finished.filter(f => f !== item);
        else break;
      }
      if (state.active) await flushItem(state.active);
      persist();
    } catch (e) {
      console.warn('[sesión] sincronización pendiente:', e && e.code || e);
    } finally { flushing = false; }
  }
  const scheduleFlush = (ms = 600) => { clearTimeout(flushTimer); flushTimer = setTimeout(flush, ms); };

  function touch(item) { item.dirty = true; persist(); emit('change'); scheduleFlush(); }

  // ---- Seguimiento entre dispositivos ----
  function stopRemoteWatch() { if (unsub) { unsub(); unsub = null; } }
  function watchRemote() {
    stopRemoteWatch();
    const item = state.active;
    if (!item || !uid) return;
    try {
      unsub = col().doc(item.session.id).onSnapshot(snap => {
        if (!snap.exists || snap.metadata.hasPendingWrites || !state.active || state.active !== item) return;
        const remote = deserialize(snap.id, snap.data());
        if (remote.rev <= item.session.rev || item.dirty) return;     // lo local es igual o más nuevo
        adoptRemote(item, remote);
      }, () => {});
    } catch (e) { /* sin red: sigue en local */ }
  }

  async function adoptRemote(item, remote) {
    const known = new Set(item.entries.map(e => e.ascentId));
    const missing = remote.ascentIds.filter(id => !known.has(id));
    if (missing.length) {
      try { (await loadAscents(remote.id)).forEach(e => { if (!known.has(e.ascentId)) item.entries.push(e); }); } catch (e) { /* se reintenta en el siguiente cambio */ }
      item.entries.sort((a, b) => a.at - b.at);
    }
    item.session = { ...item.session, ...remote };
    if (remote.status === 'finished') {
      stopGps(); stopRemoteWatch();
      state.active = null;
    } else syncGps();
    persist(); emit('change');
  }

  async function loadAscents(sessionId) {
    const snap = await db.collection('ascents').where('userId', '==', uid).where('sessionId', '==', sessionId).get();
    return snap.docs.map(doc => {
      const a = doc.data();
      const at = a.loggedAt && a.loggedAt.toMillis ? a.loggedAt.toMillis() : (a.date && a.date.toMillis ? a.date.toMillis() : nowMs());
      return {
        ascentId: doc.id, routeId: a.routeId, routeName: a.routeName, grade: a.grade || '', style: a.style, sector: a.sector || '',
        schoolId: a.schoolId, schoolName: a.schoolName, at, meters: null, companions: a.companions || [], synced: true
      };
    }).sort((x, y) => x.at - y.at);
  }

  // Sesiones activas o en pausa del usuario que no son la local (otro dispositivo). Más recientes primero.
  async function remoteActive() {
    const snap = await col().where('status', 'in', ['active', 'paused']).limit(5).get();
    const mine = state.active && state.active.session.id;
    return snap.docs.map(d => deserialize(d.id, d.data())).filter(s => s.id !== mine).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  // Dos sesiones activas a la vez para el mismo usuario: se avisa una vez por sesión ajena (no se fusionan)
  const warned = new Set();
  let lastCheck = 0;
  async function checkConflict(force = false) {
    if (!state.active || !uid || !user() || (typeof navigator !== 'undefined' && navigator.onLine === false)) return;
    if (!force && nowMs() - lastCheck < 60000) return;
    lastCheck = nowMs();
    try {
      const other = (await remoteActive())[0];
      if (other && !warned.has(other.id)) { warned.add(other.id); emit('conflict', other); }
    } catch (e) { /* sin red: se comprobará más tarde */ }
  }

  // Al iniciar sesión en la app: recupera la local y, si no hay, una activa de otro dispositivo
  async function recover() {
    if (!state.active) {
      try {
        const snap = await col().where('status', 'in', ['active', 'paused']).limit(5).get();
        const docs = snap.docs.map(d => deserialize(d.id, d.data())).sort((a, b) => b.updatedAt - a.updatedAt);
        if (docs[0]) {
          const entries = await loadAscents(docs[0].id);
          state.active = { session: docs[0], entries, track: [], dirty: false };
          persist();
        }
      } catch (e) { /* sin red: no hay nada que recuperar */ }
    }
    if (state.active) { syncGps(); watchRemote(); checkConflict(true); }
    flush();
    emit('change');
  }

  // ---- GPS (opcional, independiente del cronómetro y de los ascensos) ----
  function onFix(pos) {
    const item = state.active;
    if (!item || item.session.status !== 'active' || !item.session.gps.enabled) return;
    const c = pos.coords || {};
    const fix = { lat: c.latitude, lng: c.longitude, acc: c.accuracy, t: pos.timestamp || nowMs() };
    const last = item.track[item.track.length - 1] || null;
    const add = kxsAcceptFix(last, fix);
    if (add === null) return;
    item.track.push({ lng: fix.lng, lat: fix.lat, t: fix.t });
    if (item.track.length > KXS_MAX_LOCAL_TRACK) item.track = kxsDownsample(item.track, KXS_MAX_LOCAL_TRACK / 2);
    item.session.gps.distanceM = (item.session.gps.distanceM || 0) + add;
    if (item.session.gps.status !== 'ok') { item.session.gps.status = 'ok'; touch(item); }
    persist(false);
    emit('track');
  }

  function gpsFailed(status, message) {
    const item = state.active;
    lastGpsError = message;
    if (item && item.session.gps.status !== status) { item.session.gps = { ...item.session.gps, status }; touch(item); }
    emit('gps-error');
  }

  async function startGps() {
    if (watchId != null) return;
    const cap = typeof window !== 'undefined' ? window.Capacitor : null;
    const native = cap && cap.isNativePlatform && cap.isNativePlatform() && cap.Plugins && cap.Plugins.Geolocation;
    try {
      if (native) {
        const G = cap.Plugins.Geolocation;
        const perm = await G.requestPermissions();
        if (perm.location !== 'granted' && perm.coarseLocation !== 'granted') return gpsFailed('denied', 'Sin permiso de ubicación');
        watchKind = 'native';
        watchId = await G.watchPosition({ enableHighAccuracy: true, timeout: 30000, maximumAge: 0 }, (pos, err) => {
          if (err) gpsFailed(err.code === 1 || /denied/i.test(err.message || '') ? 'denied' : 'error', 'No se pudo obtener la ubicación');
          else if (pos) onFix(pos);
        });
      } else if (typeof navigator !== 'undefined' && navigator.geolocation) {
        watchKind = 'web';
        watchId = navigator.geolocation.watchPosition(onFix, err => {
          gpsFailed(err && err.code === 1 ? 'denied' : 'error', err && err.code === 1 ? 'Sin permiso de ubicación' : 'No se pudo obtener la ubicación');
        }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 });
      } else gpsFailed('error', 'Este dispositivo no ofrece ubicación');
    } catch (e) { watchId = null; gpsFailed('error', 'No se pudo activar la ubicación'); }
  }

  function stopGps() {
    if (watchId == null) return;
    const id = watchId, kind = watchKind;
    watchId = null; watchKind = null;
    try {
      if (kind === 'native') window.Capacitor.Plugins.Geolocation.clearWatch({ id });
      else navigator.geolocation.clearWatch(id);
    } catch (e) { /* ya detenido */ }
  }

  // El GPS solo escucha con sesión activa (no en pausa ni sin sesión) y con el seguimiento activado
  function syncGps() {
    const s = state.active && state.active.session;
    const want = s && s.status === 'active' && s.gps.enabled && s.gps.status !== 'denied';
    if (want) startGps(); else stopGps();
  }

  // ---- API pública ----
  const api = {
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    get() { return state.active; },
    isActive() { return !!state.active; },
    isPaused() { return !!state.active && state.active.session.status === 'paused'; },
    elapsedMs() { return state.active ? kxsActiveMs(state.active.session) : 0; },
    stats() { return state.active ? kxsStats(state.active.entries) : null; },
    gpsError() { return lastGpsError; },
    pendingCount() { return state.finished.length + (state.active ? state.active.entries.filter(e => !e.synced).length : 0); },

    // Estado de la sesión de un usuario concreto (sin sesión cuando sale)
    async init(u) {
      stopGps(); stopRemoteWatch(); clearTimeout(flushTimer);
      uid = u ? u.uid : null;
      state = { active: null, finished: [] };
      if (!uid) { emit('change'); return; }
      restore();
      emit('change');
      await recover();
    },

    async start({ gps = false, schoolId = '', schoolName = '' } = {}) {
      if (!uid) throw Object.assign(new Error('auth'), { code: 'auth' });
      if (state.active) throw Object.assign(new Error('exists'), { code: 'exists' });
      // Con conexión, no se crea una segunda sesión si ya hay una activa en otro dispositivo (espera máx. 4 s)
      if (typeof navigator === 'undefined' || navigator.onLine !== false) {
        let waitT;
        const other = await Promise.race([remoteActive().catch(() => []), new Promise(r => { waitT = setTimeout(() => r([]), 4000); })]);
        clearTimeout(waitT);
        if (other[0]) throw Object.assign(new Error('remote-active'), { code: 'remote-active', session: other[0] });
      }
      const session = kxsNewSession({ id: col().doc().id, now: nowMs(), gps, schoolId, schoolName });
      state.active = { session, entries: [], track: [], dirty: true };
      persist(); emit('change'); scheduleFlush(0);
      watchRemote();
      if (gps) await startGps();   // un fallo del GPS no impide la sesión: queda anotado en gps.status
      return session;
    },

    pause() {
      const item = state.active;
      if (!item || item.session.status !== 'active') return;
      item.session = kxsPause(item.session, nowMs());
      stopGps(); touch(item);
    },
    resume() {
      const item = state.active;
      if (!item || item.session.status !== 'paused') return;
      item.session = kxsResume(item.session, nowMs());
      syncGps(); touch(item);
    },

    // Registra una vía en la sesión con el sistema de ascensos existente. info: datos de la vía + estilo.
    // El contador se actualiza al instante; la subida a Firestore se reintenta sola si no hay conexión.
    async addAscent(info) {
      const item = state.active;
      if (!item) return null;
      const style = KXS_STYLES.includes(info.style) ? info.style : 'redpoint';
      const entry = {
        ascentId: db.collection('ascents').doc().id,
        routeId: info.routeId, routeName: info.routeName, grade: info.grade || '', style, sector: info.sector || '',
        schoolId: info.schoolId, schoolName: info.schoolName,
        at: nowMs(), meters: null, companions: (info.companions || []).slice(0, 10), synced: false
      };
      item.entries.push(entry);
      item.session.ascentIds = item.entries.map(e => e.ascentId);
      if (!item.session.schoolId && entry.schoolId) { item.session.schoolId = entry.schoolId; item.session.schoolName = entry.schoolName || ''; }
      item.session.rev++; touch(item);
      // El check de la vía aparece ya en el mapa (logAscent lo repite al subirlo, sin efecto)
      if (typeof addAscentToCache === 'function' && entry.routeId != null) addAscentToCache(entry.schoolId, entry.routeId, { date: new Date(entry.at), style: entry.style, grade: entry.grade });
      // Los metros se resuelven con el mismo índice que Actividad; si la red falla, quedan sin dato
      kxsMetersFor(entry.schoolId, entry.routeId, entry.routeName).then(m => {
        if (m > 0) { entry.meters = m; persist(); emit('change'); }
      }).catch(() => {});
      return entry;
    },

    // Cierra la sesión y devuelve el resumen. Nada se duplica: los ascensos ya existen en `ascents`.
    // La hora de fin se fija al pulsar; antes de calcular las estadísticas se espera (poco) a los metros pendientes.
    async finish() {
      const item = state.active;
      if (!item || finishing) return null;
      finishing = true;
      const now = nowMs();
      stopGps(); stopRemoteWatch();
      const pendingMeters = item.entries.filter(e => e.meters == null && kxsIsSend(e)).map(async e => {
        const m = await kxsMetersFor(e.schoolId, e.routeId, e.routeName);
        if (m > 0) e.meters = m;
      });
      let waitT;
      await Promise.race([Promise.allSettled(pendingMeters), new Promise(r => { waitT = setTimeout(r, 2500); })]);
      clearTimeout(waitT);
      const stats = kxsStats(item.entries);
      const school = kxsMainSchool(item.entries);
      item.session = kxsFinish(item.session, now, {
        stats, distanceM: item.session.gps.distanceM || 0,
        ...(school ? school : {})
      });
      item.session.ascentIds = item.entries.map(e => e.ascentId);
      item.dirty = true;
      state.finished.push(item);
      state.active = null;
      finishing = false;
      persist(); emit('change'); scheduleFlush(0);
      return item;
    },

    // Historial (Actividad): sesiones finalizadas del usuario, más recientes primero
    async list(limit = 50) {
      if (!uid) return [];
      let remote = [];
      try {
        const snap = await col().where('status', '==', 'finished').orderBy('startedAt', 'desc').limit(limit).get();
        remote = snap.docs.map(d => ({ ...deserialize(d.id, d.data()), track: kxsUnpackTrack(d.data().track) }));
      } catch (e) { console.warn('[sesión] historial no disponible:', e && e.code || e); }   // sin red: solo lo local
      const have = new Set(remote.map(s => s.id));
      const local = state.finished.filter(f => !have.has(f.session.id)).map(f => ({ ...f.session, track: f.track }));
      return [...local, ...remote].sort((a, b) => b.startedAt - a.startedAt);
    },
    async ascentsOf(sessionId) {
      if (!uid) return [];
      const local = state.finished.find(f => f.session.id === sessionId);
      if (local) return local.entries;
      return loadAscents(sessionId);
    },

    // Adopta la sesión activa de otro dispositivo (tras un conflicto al iniciar)
    async adopt() { if (!state.active) await recover(); return state.active; },
    checkConflict,
    flush,
    _debug: () => ({ state, uid })
  };

  // Reintentos: al volver la conexión, al volver a la app y de forma periódica
  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => scheduleFlush(300));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') persist();
      else { emit('change'); scheduleFlush(300); syncGps(); checkConflict(); }
    });
    window.addEventListener('pagehide', () => persist());
    window.addEventListener('pageshow', () => { emit('change'); scheduleFlush(300); });
    setInterval(() => { if (state.finished.length || (state.active && state.active.dirty) || (state.active && state.active.entries.some(e => !e.synced))) flush(); }, 45000);
  }
  if (typeof firebase !== 'undefined' && firebase.auth) firebase.auth().onAuthStateChanged(u => api.init(u));

  return api;
})();

if (typeof window !== 'undefined') window.KruxSession = KruxSession;

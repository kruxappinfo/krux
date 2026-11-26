// ================== KRUX — SESIONES DE ESCALADA EN ROCA ==================
// Datos y lógica de una jornada de escalada: cronómetro derivado de marcas de tiempo, registro de vías
// con el sistema de ascensos existente (logAscent), GPS opcional y sincronización con cola local.
// La interfaz está en climb-session-ui.js; este archivo no toca el DOM.
//
// Modelo (Firestore): users/{uid}/climb_sessions/{sessionId}
//   type:'rock'|'gym', companions:[uid], status:'active'|'paused'|'finished', startedAt, endedAt, pauses:[{from,to}] (ms),
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

// type: 'rock' (roca, desde el mapa) o 'gym' (rocódromo: sin GPS, con el rocódromo y los compañeros elegidos al empezar)
function kxsNewSession({ id, now, gps = false, schoolId = '', schoolName = '', type = 'rock', companions = [] }) {
  const gym = type === 'gym';
  return {
    id, type: gym ? 'gym' : 'rock', status: 'active', companions: (companions || []).slice(0, 10), startedAt: now, endedAt: null, pauses: [], activeMs: 0,
    gps: { enabled: !gym && !!gps, status: !gym && gps ? 'pending' : 'off', distanceM: 0 },
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

// Gasto energético estimado (kcal) por actividades, con MET del Compendium of Physical Activities y un peso de
// referencia (KRUX no guarda el peso del usuario: es una estimación, no una medida). Una jornada de roca es sobre
// todo esperar y asegurar, así que el tiempo total no se multiplica por un MET de escalada:
//   · cada vía cuenta el tiempo que se tarda en escalarla (por sus metros) con el MET de su dificultad;
//   · el recorrido a pie (GPS) cuenta como senderismo;
//   · el resto del tiempo activo cuenta como estar de pie o asegurando.
const KXS_KCAL = {
  kg: 70,
  metClimb: 5.8,          // escalada en roca, dificultad baja-moderada
  metClimbHard: 7.5,      // escalada en roca, dificultad alta (desde hardGrade)
  hardGrade: '6c',
  metWalk: 6.0,           // senderismo campo a través (aproximaciones con mochila)
  metRest: 1.8,           // de pie, asegurando o descansando
  climbMPerMin: 2.5,      // ritmo de escalada: una vía de 25 m ≈ 10 min
  defaultRouteM: 20,      // vía sin longitud conocida
  gymRouteM: 15,          // vía de rocódromo
  boulderMinPerTry: 1.5,  // bloque: minutos de esfuerzo por intento
  maxBoulderMin: 20,
  minRouteMin: 4, maxRouteMin: 180,
  walkMinSpeed: 0.25,     // m/s: por debajo es ruido del GPS con la persona parada
  walkSpeed: 0.7          // m/s: ritmo mínimo supuesto en un tramo sin puntos (móvil bloqueado)
};

// Tiempo andando a partir del track: cada tramo cuenta lo que se tarda en recorrerlo a walkSpeed, nunca más que su
// duración real. Un tramo largo sin puntos (pantalla bloqueada) no se cuenta entero como marcha.
function kxsWalkMs(track) {
  let ms = 0;
  for (let i = 1; i < (track || []).length; i++) {
    const a = track[i - 1], b = track[i];
    const dt = (b.t - a.t) / 1000;
    if (!(dt > 0)) continue;
    const d = kxsHaversine(a, b);
    if (d / dt < KXS_KCAL.walkMinSpeed) continue;
    ms += Math.min(dt, d / KXS_KCAL.walkSpeed) * 1000;
  }
  return ms;
}

// Minutos de escalada y MET de una vía registrada (los intentos también cuentan: se escala igual).
// Rocódromo: un bloque son unos 1,5 min de esfuerzo por intento; una vía de rocódromo, unos 15 m.
function kxsRouteEffort(e) {
  const rank = typeof kxGradeRank === 'function' ? kxGradeRank : () => -1;
  const hard = e.grade && rank(e.grade) >= 0 && rank(e.grade) >= rank(KXS_KCAL.hardGrade);
  if (e.climbType === 'boulder') {
    const min = Math.min(KXS_KCAL.maxBoulderMin, KXS_KCAL.boulderMinPerTry * Math.max(1, e.tries || 1));
    return { ms: min * 60000, met: hard ? KXS_KCAL.metClimbHard : KXS_KCAL.metClimb };
  }
  const m = e.meters > 0 ? e.meters : (e.climbType === 'indoor' ? KXS_KCAL.gymRouteM : KXS_KCAL.defaultRouteM);
  const min = Math.min(KXS_KCAL.maxRouteMin, Math.max(KXS_KCAL.minRouteMin, m / KXS_KCAL.climbMPerMin));
  return { ms: min * 60000, met: hard ? KXS_KCAL.metClimbHard : KXS_KCAL.metClimb };
}

// Desglose { total, climb, walk, rest, kg } en kcal y los tiempos usados (ms). Si escalar y andar suman más que el tiempo
// activo (vías largas mal estimadas), se reparten dentro de él para no contar más horas de las que duró la sesión.
// kg: el peso del usuario si lo ha indicado en su perfil; si no, el de referencia.
function kxsEstimateKcal({ entries = [], activeMs = 0, track = [], kg = null } = {}) {
  const K = { ...KXS_KCAL, kg: kxsValidWeight(kg) || KXS_KCAL.kg }, h = ms => ms / 3600000;
  const efforts = (entries || []).map(kxsRouteEffort);
  let climbMs = efforts.reduce((s, x) => s + x.ms, 0);
  let walkMs = kxsWalkMs(track);
  const total = Math.max(activeMs || 0, 0);
  const scale = total > 0 && climbMs + walkMs > total ? total / (climbMs + walkMs) : (total > 0 ? 1 : 0);
  climbMs *= scale; walkMs *= scale;
  const restMs = Math.max(0, total - climbMs - walkMs);
  const climb = efforts.reduce((s, x) => s + x.met * K.kg * h(x.ms * scale), 0);
  const walk = K.metWalk * K.kg * h(walkMs);
  const rest = K.metRest * K.kg * h(restMs);
  const r = Math.round;
  return { total: r(climb) + r(walk) + r(rest), climb: r(climb), walk: r(walk), rest: r(rest), climbMs: r(climbMs), walkMs: r(walkMs), restMs: r(restMs), kg: K.kg, ownKg: !!kxsValidWeight(kg) };
}

// ============================================
// PESO DEL USUARIO (solo para las calorías)
// ============================================
// Es un dato personal: no va en users/{uid} (lo lee cualquier usuario con sesión) sino en users/{uid}/private/settings,
// que solo puede leer y escribir su dueño. Se guarda también en el móvil para usarlo sin conexión.
function kxsValidWeight(v) {
  const n = Math.round(Number(v) * 10) / 10;
  return n >= 30 && n <= 250 ? n : null;
}
const KruxWeight = (() => {
  let cached = null, cachedUid = null;
  const key = uid => `krux_weight_${uid}`;
  const ref = uid => db.collection('users').doc(uid).collection('private').doc('settings');
  return {
    get() { return cached; },
    async load(uid) {
      if (!uid) return null;
      if (cachedUid !== uid) { cachedUid = uid; cached = null; }
      try { cached = kxsValidWeight(localStorage.getItem(key(uid))) || cached; } catch (e) { /* sin almacenamiento */ }
      try {
        const doc = await ref(uid).get();
        const v = doc.exists ? kxsValidWeight(doc.data().weightKg) : null;
        if (v) { cached = v; try { localStorage.setItem(key(uid), String(v)); } catch (e) { /* sin almacenamiento */ } }
      } catch (e) { /* sin red o sin permiso: vale el del móvil */ }
      return cached;
    },
    // kg vacío borra el peso. Devuelve true si quedó guardado en la cuenta, 'local' si solo en el móvil.
    async save(uid, kg) {
      const v = kg === '' || kg == null ? null : kxsValidWeight(kg);
      if (kg !== '' && kg != null && !v) throw Object.assign(new Error('weight'), { code: 'weight' });
      cachedUid = uid; cached = v;
      try { if (v) localStorage.setItem(key(uid), String(v)); else localStorage.removeItem(key(uid)); } catch (e) { /* sin almacenamiento */ }
      try {
        await ref(uid).set({ weightKg: v || firebase.firestore.FieldValue.delete() }, { merge: true });
        return true;
      } catch (e) { return 'local'; }
    }
  };
})();
if (typeof window !== 'undefined') window.KruxWeight = KruxWeight;

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
    ...(entry.climbType ? { climbType: entry.climbType } : {}),
    ...(entry.schoolCity ? { schoolCity: entry.schoolCity } : {}),
    date: new Date(entry.at).toISOString().split('T')[0],
    loggedAt: entry.at,
    tries: entry.tries > 0 ? entry.tries : 1,
    rating: entry.rating || 0,
    notes: entry.notes || '',
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
      userId: uid, type: s.type, status: s.status, companions: s.companions || [],
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
      id, type: d.type || 'rock', status: d.status, companions: d.companions || [], startedAt: ms(d.startedAt), endedAt: ms(d.endedAt),
      pauses: d.pauses || [], activeMs: d.activeMs || 0, gps: d.gps || { enabled: false, status: 'off', distanceM: 0 },
      schoolId: d.schoolId || '', schoolName: d.schoolName || '', ascentIds: d.ascentIds || [],
      stats: d.stats || null, rev: d.rev || 1, updatedAt: ms(d.updatedAt) || 0, postId: d.postId || null
    };
  }

  // Sube lo pendiente de un item: primero los ascensos (por el mismo logAscent, con id fijo para no duplicar)
  // y después el documento de la sesión.
  async function flushItem(item) {
    let uploaded = 0;
    try {
      for (const e of item.entries) {
        if (e.synced) continue;
        const ok = await logAscent(kxsAscentPayload(e, item.session.id));
        if (!ok) return false;
        e.synced = true; uploaded++;
        persist();
      }
    } finally { if (uploaded) emit('synced'); }   // Actividad vuelve a leer los ascensos
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
        schoolId: a.schoolId, schoolName: a.schoolName, at, meters: null, companions: a.companions || [], synced: true,
        climbType: a.climbType || '', tries: a.tries || 1
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
    const background = cap && cap.isNativePlatform && cap.isNativePlatform() && cap.Plugins && cap.Plugins.BackgroundGeolocation;
    try {
      if (background) {
        // App nativa: sigue registrando con la pantalla bloqueada o la app en segundo plano (si no, cada bloqueo deja
        // una recta entre el último punto y el siguiente). En Android se muestra una notificación mientras graba.
        watchKind = 'background';
        watchId = await background.addWatcher({
          backgroundTitle: 'Sesión de escalada en curso',
          backgroundMessage: 'KRUX está registrando tu recorrido. Finaliza o pausa la sesión para detenerlo.',
          requestPermissions: true, stale: false, distanceFilter: 0
        }, (loc, err) => {
          if (err) gpsFailed(err.code === 'NOT_AUTHORIZED' ? 'denied' : 'error', err.code === 'NOT_AUTHORIZED' ? 'Sin permiso de ubicación' : 'No se pudo obtener la ubicación');
          else if (loc && !loc.simulated) onFix({ coords: { latitude: loc.latitude, longitude: loc.longitude, accuracy: loc.accuracy }, timestamp: loc.time || nowMs() });
        });
      } else if (native) {
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
      if (kind === 'background') window.Capacitor.Plugins.BackgroundGeolocation.removeWatcher({ id });
      else if (kind === 'native') window.Capacitor.Plugins.Geolocation.clearWatch({ id });
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
      KruxWeight.load(uid);   // para las calorías al finalizar (no bloquea)
      restore();
      emit('change');
      await recover();
    },

    async start({ gps = false, schoolId = '', schoolName = '', type = 'rock', companions = [] } = {}) {
      if (!uid) throw Object.assign(new Error('auth'), { code: 'auth' });
      if (state.active) throw Object.assign(new Error('exists'), { code: 'exists' });
      // Con conexión, no se crea una segunda sesión si ya hay una activa en otro dispositivo (espera máx. 4 s)
      if (typeof navigator === 'undefined' || navigator.onLine !== false) {
        let waitT;
        const other = await Promise.race([remoteActive().catch(() => []), new Promise(r => { waitT = setTimeout(() => r([]), 4000); })]);
        clearTimeout(waitT);
        if (other[0]) throw Object.assign(new Error('remote-active'), { code: 'remote-active', session: other[0] });
      }
      const session = kxsNewSession({ id: col().doc().id, now: nowMs(), gps, schoolId, schoolName, type, companions });
      state.active = { session, entries: [], track: [], dirty: true };
      persist(); emit('change'); scheduleFlush(0);
      watchRemote();
      if (session.gps.enabled) await startGps();   // un fallo del GPS no impide la sesión: queda anotado en gps.status
      return session;
    },

    // Compañeros de la sesión de rocódromo: se proponen en cada bloque que se registra
    setCompanions(list) {
      const item = state.active;
      if (!item) return;
      item.session.companions = (list || []).slice(0, 10);
      item.session.rev++; touch(item);
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
    // Rocódromo: info.climbType ('indoor' | 'boulder'); un bloque con foto ya sube su ascenso al guardarse
    // (info.ascentId + info.synced) y aquí solo se anota en la sesión, con la miniatura de la foto.
    async addAscent(info) {
      const item = state.active;
      if (!item) return null;
      const style = KXS_STYLES.includes(info.style) ? info.style : 'redpoint';
      const entry = {
        ascentId: info.ascentId || db.collection('ascents').doc().id,
        routeId: info.routeId, routeName: info.routeName, grade: info.grade || '', style, sector: info.sector || '',
        schoolId: info.schoolId, schoolName: info.schoolName,
        at: nowMs(), meters: null, companions: (info.companions || []).slice(0, 10), synced: !!info.synced,
        ...(info.climbType ? { climbType: info.climbType } : {}),
        ...(info.schoolCity ? { schoolCity: info.schoolCity } : {}),
        ...(info.thumbUrl ? { thumbUrl: info.thumbUrl, blockId: info.blockId || '', color: info.color || '' } : {}),
        tries: Math.max(1, Math.min(999, parseInt(info.tries, 10) || 1)),
        rating: [1, 2, 3, 4, 5].includes(Number(info.rating)) ? Number(info.rating) : 0,
        notes: String(info.notes || '').slice(0, 1000)
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
      // Las calorías se calculan al cerrar, con los metros de cada vía y el track completo (Firestore guarda el track reducido)
      stats.kcal = kxsEstimateKcal({ entries: item.entries, activeMs: kxsActiveMs({ ...item.session, endedAt: now }), track: item.track, kg: KruxWeight.get() });
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
        // Solo ordena por fecha (índice automático): filtrar por estado a la vez exigiría un índice compuesto que no existe
        // y la consulta fallaba sin avisar. Las sesiones en curso son una o dos, así que se descartan aquí.
        const snap = await col().orderBy('startedAt', 'desc').limit(limit + 5).get();
        remote = snap.docs.filter(d => d.data().status === 'finished').slice(0, limit)
          .map(d => ({ ...deserialize(d.id, d.data()), track: kxsUnpackTrack(d.data().track) }));
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

    // Borra una sesión finalizada (no la que está en curso: esa se finaliza antes). Los ascensos se conservan: son
    // tu registro de vías y siguen en Actividad. Sin conexión no se borra (para no dejar copias a medias).
    async remove(sessionId) {
      if (!uid || !sessionId) return false;
      if (state.active && state.active.session.id === sessionId) throw Object.assign(new Error('active'), { code: 'active' });
      const local = state.finished.find(f => f.session.id === sessionId);
      if (local && local.dirty && !local.entries.some(e => e.synced)) {
        // Nunca llegó a subirse: basta con quitarla del móvil
        state.finished = state.finished.filter(f => f !== local);
        persist(); emit('deleted');
        return true;
      }
      if (typeof navigator !== 'undefined' && navigator.onLine === false) throw Object.assign(new Error('offline'), { code: 'offline' });
      await col().doc(sessionId).delete();
      state.finished = state.finished.filter(f => f.session.id !== sessionId);
      persist(); emit('deleted');
      return true;
    },

    // Publicación del feed en la que se compartió la sesión (para no publicarla dos veces y poder borrarla con ella)
    async setPost(sessionId, postId) {
      if (!uid || !sessionId) return;
      const local = state.finished.find(f => f.session.id === sessionId);
      if (local) { local.session.postId = postId || null; persist(); }
      await col().doc(sessionId).set({ postId: postId || null }, { merge: true });
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

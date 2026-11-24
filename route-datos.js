// ================== DATOS DE VÍA CON HISTORIAL (route_datos) ==================
// Estilo, expreses y metros de una vía de KRUX los escriben spotters y admins (sustituyen al GeoJSON); nombre, grado y
// descripción, solo admins (mapa «fix»). Cada cambio se guarda con su historial en route_datos/{escuela}_{id}/historial,
// para ver quién cambió qué y poder volver al valor anterior. Lo cargan la web (index.html) y el panel admin.html.
//
// Una clave de cambio es el campo de primer nivel («estilo», «exp1», «long2»…) o, con prefijo «f_», un campo de fix
// («f_nombre», «f_grado1», «f_descripcion»). Un valor es el dato nuevo o KX_RD_DELETE (quitar el dato propio).
// En el historial, cada clave guarda { to, from }: sin «to» se quitó el dato; sin «from» no había dato propio.

const KX_RD_DELETE = Symbol('borrar');

// ¿Es clave de fix? y nombre del campo dentro del documento
function kxRdIsFix(key) { return key.startsWith('f_'); }
function kxRdName(key) { return kxRdIsFix(key) ? key.slice(2) : key; }

/**
 * Entradas de historial de una escritura: solo lo que cambia respecto a lo guardado (prev). Función pura.
 * @param {object} prev documento actual de route_datos ({} si no existe)
 * @param {object} changes clave → valor nuevo o KX_RD_DELETE
 * @returns {object} clave → { to?, from? }
 */
function kxRdPlan(prev, changes) {
  prev = prev || {};
  const entries = {};
  for (const [key, value] of Object.entries(changes)) {
    const src = kxRdIsFix(key) ? (prev.fix || {}) : prev;
    const name = kxRdName(key);
    const had = Object.prototype.hasOwnProperty.call(src, name);
    const del = value === KX_RD_DELETE;
    if (del && !had) continue;
    if (!del && had && src[name] === value) continue;
    const entry = {};
    if (!del) entry.to = value;
    if (had) entry.from = src[name];
    entries[key] = entry;
  }
  return entries;
}

/** Documento tal como queda tras aplicar unas entradas. Función pura. */
function kxRdApply(prev, entries) {
  const out = { ...(prev || {}) };
  out.fix = { ...(out.fix || {}) };
  for (const [key, entry] of Object.entries(entries)) {
    const dst = kxRdIsFix(key) ? out.fix : out;
    const name = kxRdName(key);
    if ('to' in entry) dst[name] = entry.to; else delete dst[name];
  }
  if (!Object.keys(out.fix).length) delete out.fix;
  return out;
}

/** Cambios que devuelven una entrada del historial a su valor anterior. Función pura. */
function kxRdRestoreChanges(entryChanges) {
  const changes = {};
  for (const [key, entry] of Object.entries(entryChanges || {})) {
    changes[key] = 'from' in entry ? entry.from : KX_RD_DELETE;
  }
  return changes;
}

/** «exp2» → «Expreses (variante 2)», «f_grado1» → «Grado». Función pura. */
function kxRdFieldLabel(key) {
  const m = kxRdName(key).match(/^([a-z]+?)(\d?)$/);
  const base = { nombre: 'Nombre', estilo: 'Estilo', descripcion: 'Descripción', grado: 'Grado', exp: 'Expreses', long: 'Metros' }[m ? m[1] : kxRdName(key)];
  if (!base) return kxRdName(key);
  return m && m[2] && Number(m[2]) > 1 ? `${base} (variante ${m[2]})` : base;
}

/**
 * Escribe cambios en una vía y deja su entrada de historial, todo en una transacción (la entrada compara lo que
 * había con lo que se guarda). Devuelve el documento resultante, o null si no cambiaba nada.
 * @param {string} role 'admin' o 'spotter'
 */
async function kxRouteDataWrite(schoolId, routeId, changes, role) {
  const db = firebase.firestore();
  const FV = firebase.firestore.FieldValue;
  const user = firebase.auth().currentUser;
  if (!user) throw new Error('Sin sesión');
  const ref = db.collection('route_datos').doc(`${schoolId}_${routeId}`);
  const hist = ref.collection('historial').doc();
  return db.runTransaction(async (t) => {
    const snap = await t.get(ref);
    const prev = snap.exists ? snap.data() : {};
    const entries = kxRdPlan(prev, changes);
    if (!Object.keys(entries).length) return null;
    const payload = { schoolId, routeId: Number(routeId), updatedBy: user.uid, updatedAt: FV.serverTimestamp() };
    for (const [key, entry] of Object.entries(entries)) {
      const value = 'to' in entry ? entry.to : FV.delete();
      if (kxRdIsFix(key)) (payload.fix = payload.fix || {})[kxRdName(key)] = value;
      else payload[key] = value;
    }
    t.set(ref, payload, { merge: true });
    t.set(hist, { uid: user.uid, role, at: FV.serverTimestamp(), changes: entries });
    return kxRdApply(prev, entries);
  });
}

/** Últimos cambios de una vía (más recientes primero), con el nombre de quien los hizo. Solo admins. */
async function kxRouteDataHistory(schoolId, routeId, limit = 20) {
  const db = firebase.firestore();
  const snap = await db.collection('route_datos').doc(`${schoolId}_${routeId}`)
    .collection('historial').orderBy('at', 'desc').limit(limit).get();
  const entries = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  const names = new Map();
  await Promise.all([...new Set(entries.map(e => e.uid))].map(async (uid) => {
    try {
      const u = await db.collection('users').doc(uid).get();
      const data = u.exists ? u.data() : {};
      names.set(uid, data.displayName || data.username || 'Usuario');
    } catch (_) { names.set(uid, 'Usuario'); }
  }));
  return entries.map(e => ({ ...e, name: names.get(e.uid) || 'Usuario' }));
}

/**
 * Aprueba una sugerencia de un usuario sobre una vía del mapa de KRUX: el dato pasa a route_datos.
 * La sugerencia de «tipo de escalada» se guarda con el campo «descripcion» y es en realidad el estilo.
 * @returns {{ok: boolean, error?: string}}
 */
async function kxRouteDataApproveSuggestion(suggestion, value, role) {
  const routeId = Number(suggestion.routeId);
  if (!suggestion.schoolId || !Number.isInteger(routeId)) return { ok: false, error: 'La sugerencia no indica la vía' };
  const text = String(value).trim();
  let key, parsed;
  if (suggestion.field === 'descripcion') {
    if (!text || text.length > 120) return { ok: false, error: 'El estilo debe tener entre 1 y 120 caracteres' };
    key = 'estilo'; parsed = text;
  } else {
    const m = String(suggestion.field).match(/^(exp|long)([1-5])$/);
    if (!m) return { ok: false, error: 'Campo no admitido' };
    parsed = Number(text);
    const [lo, hi] = m[1] === 'exp' ? [0, 50] : [1, 500];
    if (!Number.isInteger(parsed) || parsed < lo || parsed > hi) return { ok: false, error: `El valor debe estar entre ${lo} y ${hi}` };
    key = suggestion.field;
  }
  await kxRouteDataWrite(suggestion.schoolId, routeId, { [key]: parsed }, role);
  return { ok: true };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { KX_RD_DELETE, kxRdPlan, kxRdApply, kxRdRestoreChanges, kxRdFieldLabel };
}

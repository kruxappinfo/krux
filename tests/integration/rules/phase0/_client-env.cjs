// Ayudante compartido de las pruebas del cliente de fotos de vía: ejecuta un route-photos.js (el actual o una versión antigua) en un contexto aislado (vm) con el SDK real de Firebase
// apuntando a los emuladores, y envuelve db/storage con «interruptores de fallo» (fallos parciales, respuestas perdidas, reintentos). Solo emulador local.
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');
const ROOT = path.resolve(__dirname, '../../../..');
const L = require('./_lib.cjs');
const S = require('./_storage.cjs');
require(path.join(ROOT, 'node_modules/firebase/compat/storage'));
const { seed } = L;
const PROD_BUCKET = 'climbmaps-80cae.firebasestorage.app';
const SRC = fs.readFileSync(path.join(ROOT, 'route-photos.js'), 'utf8');

// El código del cliente se ejecuta en un contexto aislado (vm): sus literales de objeto tienen OTRO Object.prototype y el SDK de Firestore los rechaza
// («custom Object»). En un navegador real todo es un único contexto. Se reconstruyen los objetos simples en el contexto principal (los FieldValue y las fechas se dejan tal cual).
const plain = (v) => {
  if (Array.isArray(v)) return v.map(plain);
  if (v && typeof v === 'object' && Object.prototype.toString.call(v) === '[object Object]' && (!v.constructor || v.constructor.name === 'Object')) {
    const o = {}; for (const k of Object.keys(v)) o[k] = plain(v[k]); return o;
  }
  return v;
};

// ---- Entorno del navegador para un usuario, con interruptores de fallo ----
// hooks: { 'file.put': (n, real, args) => Promise, 'doc.set': ..., 'batch.commit': ..., 'file.delete': ..., 'file.getMetadata': ..., 'doc.get': ... }  (n = nº de llamada, desde 1)
function makeEnv(user, { hooks = {}, prepare, profile, clock, src = SRC, store = {} } = {}) {   // store: almacenamiento local compartido entre «ejecuciones» de la app
  const calls = [], counters = {};
  const run = (name, real, args = []) => {
    calls.push(name); counters[name] = (counters[name] || 0) + 1;
    return hooks[name] ? hooks[name](counters[name], real, args) : real();
  };
  const db = {
    collection: (c) => ({
      doc: (id) => { const ref = user.db.collection(c).doc(id);
        return { id, _ref: ref, set: (d) => run('doc.set', () => ref.set(plain(d)), [id, d]), get: (o) => run('doc.get', () => ref.get(o)), delete: () => run('doc.delete', () => ref.delete()) }; },
      where: (...a) => user.db.collection(c).where(...a)
    }),
    batch: () => { const b = user.db.batch(); return { delete: (r) => b.delete(r._ref || r), set: (r, d) => b.set(r._ref || r, plain(d)), commit: () => run('batch.commit', () => b.commit()) }; }
  };
  const storage = {
    app: { options: { storageBucket: PROD_BUCKET } },
    ref: () => ({ child: (p) => { const ref = user.st.ref().child(p);
      return { put: (d, m) => run('file.put', () => ref.put(d, plain(m))), getMetadata: () => run('file.getMetadata', () => ref.getMetadata()), delete: () => run('file.delete', () => ref.delete()) }; } })
  };
  const ctx = {
    console: { log() {}, error() {}, warn() {} }, db, storage, Uint8Array, crypto: require('node:crypto').webcrypto,
    currentUser: profile === null ? null : { uid: user.uid, email: user.email, displayName: 'Test ' + user.uid.slice(0, 4) },
    firebase: { firestore: { FieldValue: user.FV } },
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } }
  };
  if (prepare) ctx.kxPrepareImageForUpload = prepare;
  if (clock) ctx.Date = { now: () => clock.t };   // reloj local controlable (el cliente solo lo usa para decidir si reintenta y para las entradas pendientes)
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  return { ctx, calls, counters, store, api: ctx, pending: () => JSON.parse(store['kx-route-photos-pending-docs'] || '[]') };
}
const mkFile = (name, type, size = 4096) => Object.assign(new Uint8Array(size).fill(9), { name, type, size, lastModified: 1 });
const netErr = (code = 'unavailable') => Object.assign(new Error('simulated ' + code), { code });
const attempt = async (fn) => { try { return { ok: true, value: await fn() }; } catch (error) { return { ok: false, error }; } };
const idOf = (url) => decodeURIComponent(url.split('/o/')[1].split('?')[0]).split('/').pop().split('.')[0];
const docOf = (id) => L.ownerData(`route-photos/${id}`);
const backdate = async (id, ageMs) => { const d = await docOf(id); await seed(`route-photos/${id}`, { ...d, uploadedAt: new Date(Date.now() - ageMs) }); };
const poll = async (cond, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await cond()) return true; await S.sleep(150); } return false; };

module.exports = { plain, makeEnv, mkFile, netErr, attempt, idOf, docOf, backdate, poll, SRC, PROD_BUCKET };

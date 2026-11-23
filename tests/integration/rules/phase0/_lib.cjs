// Utilidades comunes de las pruebas de la Fase 0 de seguridad. SOLO emulador local (proyecto demo-krux-phase0,
// puertos 8190 Firestore, 9190 Auth, 9199 Storage). No usa credenciales ni datos de producción.
//
// MODE=proposal (por defecto): cada prueba afirma el resultado que exige la política propuesta.
// MODE=current: se cargan las reglas actuales de producción SOLO en el emulador; el informe lista dónde el
//   comportamiento actual no cumple la política (vulnerabilidades confirmadas). No es un fallo de la prueba.
const path = require('node:path');
const ROOT = path.resolve(__dirname, '../../../..');
const fs = require('node:fs');
const firebase = require(path.join(ROOT, 'node_modules/firebase/compat/app'));
require(path.join(ROOT, 'node_modules/firebase/compat/auth'));
require(path.join(ROOT, 'node_modules/firebase/compat/firestore'));

firebase.firestore.setLogLevel('silent');
const PROJECT = 'demo-krux-phase0';
const FS_HOST = '127.0.0.1', FS_PORT = 8190, AUTH_PORT = 9190, ST_PORT = 9199;
const MODE = process.env.MODE === 'current' ? 'current' : 'proposal';
const SUPER_EMAIL = 'krux.app.info@gmail.com';

// ---- Reglas en el emulador (nunca se escribe en firestore.rules) ----
const RULES_FILES = {
  // RULES_FILE=<ruta> permite probar otra propuesta (p. ej. la revisión 0b) sin tocar el código de las pruebas
  proposal: process.env.RULES_FILE || path.join(ROOT, 'docs/security-phase0/firestore.rules.phase0b.proposal'),
  proposal0: path.join(ROOT, 'docs/security-phase0/firestore.rules.phase0.proposal'),
  current: path.join(ROOT, 'firestore.rules')
};
async function loadFirestoreRules(mode = MODE) {
  const content = fs.readFileSync(RULES_FILES[mode], 'utf8');
  const r = await fetch(`http://${FS_HOST}:${FS_PORT}/emulator/v1/projects/${PROJECT}:securityRules`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rules: { files: [{ name: 'firestore.rules', content }] } })
  });
  if (!r.ok) throw new Error('No se pudieron cargar las reglas en el emulador: ' + (await r.text()));
}

// ---- Usuarios de prueba (Auth emulator) ----
const mk = async (name, email) => {
  const app = firebase.initializeApp({ apiKey: 'fake', projectId: PROJECT, authDomain: 'x', storageBucket: `${PROJECT}.appspot.com` }, name);
  app.auth().useEmulator(`http://127.0.0.1:${AUTH_PORT}`, { disableWarnings: true });
  const db = app.firestore();
  db.settings({ host: `${FS_HOST}:${FS_PORT}`, ssl: false, experimentalForceLongPolling: false });
  let cred;
  try { cred = await app.auth().createUserWithEmailAndPassword(email, 'password123'); }
  catch (e) { cred = await app.auth().signInWithEmailAndPassword(email, 'password123'); }
  return { app, db, uid: cred.user.uid, email, FV: firebase.firestore.FieldValue, TS: firebase.firestore.Timestamp,
    token: () => cred.user.getIdToken(true) };
};
// Cliente SIN sesión
const mkAnon = async (name) => {
  const app = firebase.initializeApp({ apiKey: 'fake', projectId: PROJECT, authDomain: 'x' }, name);
  const db = app.firestore();
  db.settings({ host: `${FS_HOST}:${FS_PORT}`, ssl: false });
  return { db, uid: null, FV: firebase.firestore.FieldValue, TS: firebase.firestore.Timestamp };
};

// ---- Escritura/lectura saltando las reglas («Bearer owner», solo emulador) ----
const toValue = (v) => {
  if (v === null) return { nullValue: null };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => [k, toValue(x)])) } };
};
const docUrl = (p) => `http://${FS_HOST}:${FS_PORT}/v1/projects/${PROJECT}/databases/(default)/documents/${p}`;
const ownerHeaders = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' };
async function seed(docPath, data) {
  const r = await fetch(docUrl(docPath), { method: 'PATCH', headers: ownerHeaders,
    body: JSON.stringify({ fields: Object.fromEntries(Object.entries(data).filter(([, x]) => x !== undefined).map(([k, x]) => [k, toValue(x)])) }) });
  if (!r.ok) throw new Error('seed ' + docPath + ': ' + (await r.text()));
}
async function ownerGet(docPath) {
  const r = await fetch(docUrl(docPath), { headers: ownerHeaders });
  return r.status === 404 ? null : r.json();
}
async function ownerDelete(docPath) { await fetch(docUrl(docPath), { method: 'DELETE', headers: ownerHeaders }); }
const exists = async (docPath) => (await ownerGet(docPath)) !== null;
// Valor simple de un campo leído por REST (para comprobar el estado final sin pasar por reglas)
const plain = (v) => {
  if (!v) return undefined;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('nullValue' in v) return null;
  if ('mapValue' in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, plain(x)]));
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(plain);
  return v;
};
const ownerData = async (docPath) => { const d = await ownerGet(docPath); return d ? plain({ mapValue: { fields: d.fields || {} } }) : null; };

// ---- Registro de resultados ----
const results = [];
// shouldPass = lo que EXIGE la política (modo proposal) o lo que debería ocurrir con la política (modo current)
const RUN_T0 = Date.now();
// Rastro opcional (KX_TRACE=1): una línea por comprobación en stderr y un aviso si pasan 30 s sin ninguna. Sirve para saber DÓNDE se queda una suite cuando el emulador deja de responder.
let lastProgress = Date.now();
// Las suites que acumulan resultados en memoria (escenarios con reintentos) avisan de su avance con progress() para que el aviso de «sin progreso» no sea una falsa alarma
const progress = (label) => { lastProgress = Date.now(); if (process.env.KX_TRACE) process.stderr.write(`[+${((Date.now() - RUN_T0) / 1000).toFixed(1)}s]    · ${label}\n`); };
const traceResult = (r) => {
  lastProgress = Date.now();
  if (process.env.KX_TRACE) process.stderr.write(`[+${((Date.now() - RUN_T0) / 1000).toFixed(1)}s] ${r.pass ? 'ok ' : 'FALLO'} ${r.label}\n`);
};
if (process.env.KX_TRACE) setInterval(() => { const q = Math.round((Date.now() - lastProgress) / 1000); if (q >= 30) process.stderr.write(`[+${((Date.now() - RUN_T0) / 1000).toFixed(1)}s] SIN PROGRESO desde hace ${q} s tras: ${results.length ? results[results.length - 1].label : '(nada)'}\n`); }, 10000).unref();
const expect = async (label, promise, shouldPass, note) => {
  let ok, err = '';
  try { await promise; ok = true; } catch (e) { ok = false; err = String(e.code || '') + ' ' + String(e.message || '').slice(0, 90); }
  const unexpected = !ok && !/permission|PERMISSION|unauthorized|403|denied/i.test(err);
  // `atMs` = instante en que TERMINÓ la operación (ms desde el arranque de la suite). Sirve para diagnosticar fallos de las pruebas con tiempo real (ver tests de ventana escalada).
  const r = ({ label, policy: shouldPass ? 'permitido' : 'denegado', got: ok ? 'permitido' : 'denegado',
    pass: ok === shouldPass && !unexpected, atMs: Date.now() - RUN_T0, ...(err ? { error: err } : {}), ...(unexpected ? { errorInesperado: err } : {}), ...(note ? { nota: note } : {}) });
  results.push(r); traceResult(r);
};
// Comprobaciones lógicas (no son una operación de Firestore)
const check = (label, cond, note) => { const r = ({ label, policy: 'verdadero', got: cond ? 'verdadero' : 'falso', pass: !!cond, ...(note ? { nota: note } : {}) }); results.push(r); traceResult(r); };

// Defecto YA EXISTENTE en código de producción que esta fase no corrige: se registra que sigue ocurriendo (no es un fallo de la prueba).
// reproducido=true significa que el defecto se ha vuelto a observar.
const knownDefect = (label, reproducido, note) => results.push({ label, policy: 'sin defecto', got: reproducido ? 'DEFECTO REPRODUCIDO' : 'no reproducido',
  pass: true, conocido: true, reproducido: !!reproducido, ...(note ? { nota: note } : {}) });

function finish(titulo) {
  const fallos = results.filter(r => !r.pass);
  const infra = results.filter(r => /EMULATOR_(TIMEOUT|WEDGED|NETWORK)/.test(r.error || ''));
  if (infra.length) console.error(`EMULATOR_TIMEOUT: ${infra.length} comprobación(es) fallaron porque el emulador de Storage dejó de responder (fallo de INFRAESTRUCTURA, no de las reglas); primera: ${infra[0].label}`);
  const conocidos = results.filter(r => r.conocido);
  const out = { archivo: titulo, modo: MODE, resumen: `${results.length - fallos.length - conocidos.length}/${results.length - conocidos.length} cumplen la política`, fallos };
  if (conocidos.length) out.defectosConocidos = conocidos.map(c => `${c.reproducido ? 'REPRODUCIDO' : 'no reproducido'}: ${c.label}${c.nota ? ' — ' + c.nota : ''}`);
  if (process.env.VERBOSE) out.todos = results;
  console.log(JSON.stringify(out, null, 1));
  // En modo proposal un fallo es un fallo real. En modo current los «fallos» son vulnerabilidades confirmadas.
  process.exitCode = MODE === 'proposal' && fallos.length ? 1 : 0;
}

module.exports = { progress, firebase, PROJECT, FS_HOST, FS_PORT, AUTH_PORT, ST_PORT, MODE, SUPER_EMAIL, mk, mkAnon, seed, ownerGet, ownerData,
  ownerDelete, exists, loadFirestoreRules, expect, check, knownDefect, results, finish, ROOT };

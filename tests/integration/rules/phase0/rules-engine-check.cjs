// VERIFICACIÓN CON EL MOTOR REAL DE REGLAS DE FIREBASE (no con el emulador), SIN DESPLEGAR NADA y sin leer ni escribir datos reales.
// Usa la API  projects:test  de Firebase Rules: se envía el TEXTO de las reglas y casos con datos simulados («mocks» de firestore.get/exists, request.time
// y resource.timeCreated) y el servicio devuelve si las habría permitido. No crea rulesets ni releases y no toca Firestore ni Storage.
// Lo que SÍ demuestra: que el motor de producción interpreta como esperamos `resource.timeCreated`, la aritmética de timestamps, las comparaciones de
// plazos y cuántos documentos consulta cada regla (límite de la plataforma: 2). Lo que NO demuestra: los permisos IAM reales de Storage → Firestore
// (los mocks sustituyen a la consulta) ni el comportamiento de subidas reanudables. Eso se comprueba con el canario de docs/security-phase0/STORAGE-DEPLOY.md.
//
// Requisitos: gcloud con sesión (se usa «gcloud auth print-access-token») y permiso firebaserules.rulesets.test en el proyecto. Proyecto: .firebaserc o KRUX_FIREBASE_PROJECT.
// Uso: node rules-engine-check.cjs            (usa storage.rules y docs/security-phase0/firestore.rules.route-photos-only.proposal)
// NO forma parte de run-phase0.sh (necesita red y credenciales).
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const ROOT = path.resolve(__dirname, '../../../..');
const { variantA1 } = require('./_variants.cjs');
const PROJECT = process.env.KRUX_FIREBASE_PROJECT || JSON.parse(fs.readFileSync(path.join(ROOT, '.firebaserc'), 'utf8')).projects.default;
const BUCKET = `${PROJECT}.firebasestorage.app`;
const token = execFileSync('gcloud', ['auth', 'print-access-token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const iso = (d) => d.toISOString().replace(/\.\d+Z$/, 'Z');
const NOW = new Date();
const ago = (min) => iso(new Date(NOW.getTime() - min * 60000));
const DB = '/databases/%28default%29/documents/';

async function run(file, name, cases, quiet = false) {
  const content = fs.readFileSync(file, 'utf8');
  let bad = 0;
  for (let from = 0; from < cases.length; from += 100) {   // la API admite lotes: se envían de 100 en 100
    const chunk = cases.slice(from, from + 100);
    const body = { source: { files: [{ name, content }] }, testSuite: { testCases: chunk.map(c => c.tc) } };
    const r = await fetch(`https://firebaserules.googleapis.com/v1/projects/${PROJECT}:test`, { method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'x-goog-user-project': PROJECT, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json();
    if (!r.ok) throw new Error(`${r.status} ${JSON.stringify(j).slice(0, 400)}`);
    j.testResults.forEach((res, i) => {
      const docs = new Set((res.functionCalls || []).filter(f => /exists|get/i.test(f.function)).map(f => f.args[0]));
      const okState = res.state === 'SUCCESS' && !(res.debugMessages || []).some(m => /Error/.test(m) && chunk[i].noErrors !== false) && docs.size <= 2;
      if (!okState) bad++;
      if (quiet && okState) return;
      console.log(`${okState ? 'OK ' : 'XX '} ${chunk[i].label}  [docs consultados: ${docs.size}]${res.debugMessages ? '  ' + res.debugMessages.join('; ').slice(0, 120) : ''}`);
    });
  }
  if (quiet) console.log(`  ${cases.length - bad}/${cases.length} coinciden`);
  return bad;
}

// ---------- Storage ----------
const sp = (obj) => `/b/${BUCKET}/o/${obj}`;
const photo = 'valeria_12_abcdefghij012345', obj = `route-photos/valeria/u1/${photo}.jpg`;
const mock = (fn, p, value) => ({ function: fn, args: [{ exactValue: DB + p }], result: { value } });
const mocks = (uid, { role, docAge, docExists = true, docBy = 'u1', storagePath = obj } = {}) => [
  mock('firestore.exists', `admins/${uid}`, !!role), ...(role ? [mock('firestore.get', `admins/${uid}`, { data: { role } })] : []),
  mock('firestore.exists', `route-photos/${photo}`, docExists),
  ...(docExists ? [mock('firestore.get', `route-photos/${photo}`, { data: { uploadedBy: docBy, storagePath, uploadedAt: ago(docAge) } })] : [])];
const auth = (uid, email = `${uid}@x.dev`) => ({ uid, token: { email } });
const del = (label, expectation, fileAge, { uid = 'u1', email, ...m } = {}) => ({ label, tc: { expectation, request: { path: sp(obj), method: 'delete', time: iso(NOW), auth: auth(uid, email) },
  resource: { timeCreated: ago(fileAge), name: obj, size: 1000, contentType: 'image/jpeg' }, functionMocks: mocks(uid, m) } });
// existing: objeto que YA existe en esa ruta (subir encima = sobrescribir, que el motor evalúa como «create»); si no, resource es null (archivo nuevo)
const crea = (label, expectation, docAge, { uid = 'u1', ctype = 'image/jpeg', size = 1000, o = obj, existing = null, ...m } = {}) => ({ label, tc: { expectation, request: { path: sp(o), method: 'create', time: iso(NOW), auth: auth(uid),
  resource: { contentType: ctype, size, name: o } }, resource: existing, functionMocks: mocks(uid, { docAge, ...m }) } });
const simple = (label, expectation, method, o, uid, { role, ctype = 'image/jpeg', size = 1000, email, existing = null } = {}) => ({ label, tc: { expectation, request: { path: sp(o), method, time: iso(NOW), auth: uid ? auth(uid, email) : null,
  ...(method === 'create' ? { resource: { contentType: ctype, size, name: o } } : {}) }, ...(method === 'create' ? { resource: existing } : {}), ...(method === 'delete' ? { resource: { timeCreated: ago(5), name: o, size: 1, contentType: ctype } } : {}),
  functionMocks: uid ? [mock('firestore.exists', `admins/${uid}`, !!role), ...(role ? [mock('firestore.get', `admins/${uid}`, { data: { role } })] : [])] : [] } });
const H = 60;
const storageCases = [
  del('route-photos delete · autor, archivo y documento de 11 h 59 min', 'ALLOW', 11 * H + 59, { docAge: 11 * H + 59 }),
  del('route-photos delete · autor, archivo y documento de 12 h 01 min', 'DENY', 12 * H + 1, { docAge: 12 * H + 1 }),
  del('route-photos delete · borrar y RESUBIR: archivo de 3 min, documento de 12 h 01 min', 'DENY', 3, { docAge: 12 * H + 1 }),
  del('route-photos delete · documento RECREADO: archivo de 12 h 01 min, documento de 3 min', 'DENY', 12 * H + 1, { docAge: 3 }),
  del('route-photos delete · autor, SIN documento, archivo de 11 h 59 min (sin documento no se puede demostrar la aceptación: solo administración)', 'DENY', 11 * H + 59, { docExists: false }),
  del('route-photos delete · autor, SIN documento, archivo de 3 min', 'DENY', 3, { docExists: false }),
  del('route-photos delete · autor, sin documento, archivo de 12 h 01 min', 'DENY', 12 * H + 1, { docExists: false }),
  del('route-photos delete · admin, SIN documento, archivo de 40 h', 'ALLOW', 40 * H, { uid: 'a1', role: 'admin', docExists: false }),
  del('route-photos delete · otro usuario a 1 h', 'DENY', 60, { uid: 'u2', docAge: 60 }),
  // Estado intermedio «Storage final + Firestore actual»: un documento FALSIFICADO (uploadedAt en el futuro, posible con las reglas actuales de Firestore) no amplía el plazo del archivo
  del('route-photos delete · documento falsificado con uploadedAt 5 h en el FUTURO, archivo de 11 h 59 min', 'ALLOW', 11 * H + 59, { docAge: -5 * H }),
  del('route-photos delete · documento falsificado con uploadedAt 5 h en el FUTURO, archivo de 12 h 01 min (manda timeCreated)', 'DENY', 12 * H + 1, { docAge: -5 * H }),
  del('route-photos delete · spotter AUTOR a 13 h', 'DENY', 13 * H, { role: 'spotter', docAge: 13 * H }),
  del('route-photos delete · spotter ajeno a 1 h', 'DENY', 60, { uid: 's1', role: 'spotter', docAge: 60 }),
  del('route-photos delete · admin ajeno a 40 h', 'ALLOW', 40 * H, { uid: 'a1', role: 'admin', docAge: 40 * H }),
  del('route-photos delete · super-admin a 40 h', 'ALLOW', 40 * H, { uid: 'sa', email: 'krux.app.info@gmail.com', docAge: 40 * H }),
  crea('route-photos create · documento de 1 min, jpeg', 'ALLOW', 1),
  crea('route-photos create · documento de 2 min 01 s (con la ventana anterior de 2 min se rechazaba)', 'ALLOW', 121 / 60),
  crea('route-photos create · documento de 4 min 59 s (ventana de subida de 5 min)', 'ALLOW', 299 / 60),
  crea('route-photos create · documento de 5 min 01 s', 'DENY', 301 / 60),
  crea('route-photos create · documento de 10 min (la ventana de la primera propuesta)', 'DENY', 10),
  crea('route-photos create · extensión .jpg con image/png', 'DENY', 1, { ctype: 'image/png' }),
  crea('route-photos create · 6 MB', 'DENY', 1, { size: 6 * 1024 * 1024 }),
  crea('route-photos create · el documento es de otro autor', 'DENY', 1, { docBy: 'u2' }),
  crea('route-photos create · el documento apunta a otro archivo', 'DENY', 1, { storagePath: 'route-photos/valeria/u1/otro.jpg' }),
  crea('route-photos create · sin documento', 'DENY', 1, { docExists: false }),
  crea('route-photos create · SOBRESCRIBIR un archivo que ya existe (dentro de la ventana de 5 min)', 'DENY', 1, { existing: { name: obj, size: 900, timeCreated: ago(1), contentType: 'image/jpeg' } }),
  crea('route-photos create · otro usuario (u2) en la carpeta de u1', 'DENY', 1, { uid: 'u2' }),
  simple('sector-images create · spotter', 'ALLOW', 'create', 'sector-images/sch/s/img_1.jpg', 's1', { role: 'spotter' }),
  simple('sector-images create · usuario normal', 'DENY', 'create', 'sector-images/sch/s/img_1.jpg', 'u1'),
  simple('sector-images delete · usuario normal', 'DENY', 'delete', 'sector-images/sch/s/img_1.jpg', 'u1'),
  simple('gym-photos create · dueño', 'ALLOW', 'create', 'gym-photos/u1/roco-1_1.jpg', 'u1'),
  simple('gym-photos create · dueño SOBRESCRIBE un archivo existente', 'DENY', 'create', 'gym-photos/u1/roco-1_1.jpg', 'u1', { existing: { name: 'gym-photos/u1/roco-1_1.jpg', size: 9, timeCreated: ago(5), contentType: 'image/jpeg' } }),
  simple('gym-photos create · ajeno', 'DENY', 'create', 'gym-photos/u1/roco-1_1.jpg', 'u2'),
  simple('gym-photos delete · dueño (solo admin)', 'DENY', 'delete', 'gym-photos/u1/roco-1_1.jpg', 'u1'),
  simple('profile-photos create · dueño, 12 MB', 'ALLOW', 'create', 'profile-photos/u1/1_a.jpg', 'u1', { size: 12 * 1024 * 1024 }),
  simple('profile-photos create · ajeno', 'DENY', 'create', 'profile-photos/u1/1_a.jpg', 'u2'),
  simple('posts create · dueño, vídeo', 'ALLOW', 'create', 'posts/u1/1_0_v.mp4', 'u1', { ctype: 'video/mp4', size: 50 * 1024 * 1024 }),
  simple('posts delete · ajeno', 'DENY', 'delete', 'posts/u1/1_0_v.mp4', 'u2'),
  simple('ruta no prevista · usuario con sesión sube', 'DENY', 'create', 'exercises/e1.jpg', 'u1'),
  simple('ruta no prevista · super-admin sube', 'DENY', 'create', 'otra/x.jpg', 'sa', { email: 'krux.app.info@gmail.com' })
];

// ---------- Firestore (solo route-photos y marcas) ----------
const FS = '/databases/%28default%29/documents/';
const fsPath = (p) => FS + p;
const fmock = (fn, p, value) => ({ function: fn, args: [{ exactValue: FS + p }], result: { value } });
const delPhoto = (label, expectation, age, { uid = 'u1', email, role, tomb = true, by = 'u1' } = {}) => ({ label, tc: { expectation, request: { path: fsPath(`route-photos/${photo}`), method: 'delete', time: iso(NOW), auth: auth(uid, email) },
  resource: { data: { uploadedBy: by, uploadedAt: ago(age), storagePath: obj } },
  functionMocks: [fmock('existsAfter', `route-photo-tombstones/${photo}`, tomb), fmock('exists', `admins/${uid}`, !!role), ...(role ? [fmock('get', `admins/${uid}`, { data: { role } })] : [])] } });
const fsCases = [
  delPhoto('firestore route-photos delete · autor a 11 h 59 min con marca', 'ALLOW', 11 * H + 59),
  delPhoto('firestore route-photos delete · autor a 12 h 01 min con marca', 'DENY', 12 * H + 1),
  delPhoto('firestore route-photos delete · autor a 1 h SIN marca', 'DENY', 60, { tomb: false }),
  delPhoto('firestore route-photos delete · otro usuario a 1 h con marca', 'DENY', 60, { uid: 'u2' }),
  delPhoto('firestore route-photos delete · spotter autor a 13 h', 'DENY', 13 * H, { role: 'spotter' }),
  delPhoto('firestore route-photos delete · admin a 40 h con marca', 'ALLOW', 40 * H, { uid: 'a1', role: 'admin', by: 'u1' }),
  delPhoto('firestore route-photos delete · admin SIN marca', 'DENY', 40 * H, { uid: 'a1', role: 'admin', tomb: false }),
  delPhoto('firestore route-photos delete · super-admin a 40 h con marca', 'ALLOW', 40 * H, { uid: 'sa', email: 'krux.app.info@gmail.com' })
];

// ---------- Rejilla: NINGUNA combinación permite al autor borrar a partir de las 12 h desde la aceptación del documento ----------
// Para cada edad del documento (uploadedAt) y del archivo (timeCreated), con y sin documento, para el autor, otro usuario, spotter y administración,
// el resultado esperado se calcula con la política: el autor solo con documento existente, doc < 12 h y archivo < 12 h; admin y super-admin siempre; los demás nunca.
const AGES = [0, 30, 60, 119, 121, 600, 7200, 43140, 43199, 43201, 43260, 46800, 172800];   // segundos
const gridCases = [];
for (const docAge of [...AGES, null]) for (const fileAge of AGES) for (const who of ['author', 'other', 'spotter', 'admin', 'super']) {
  const uid = { author: 'u1', other: 'u2', spotter: 's1', admin: 'a1', super: 'sa' }[who];
  const role = { spotter: 'spotter', admin: 'admin' }[who];
  const email = who === 'super' ? 'krux.app.info@gmail.com' : undefined;
  const allowed = who === 'admin' || who === 'super' || (who === 'author' && docAge !== null && docAge < 12 * 3600 && fileAge < 12 * 3600);
  const minutes = (x) => x / 60;
  gridCases.push(del(`rejilla delete · ${who} · documento ${docAge === null ? 'AUSENTE' : docAge + ' s'} · archivo ${fileAge} s`, allowed ? 'ALLOW' : 'DENY', minutes(fileAge),
    { uid, email, role, ...(docAge === null ? { docExists: false } : { docAge: minutes(docAge) }) }));
}
// Rejilla de SUBIDA: el archivo solo se admite si es el autor, su documento existe y tiene menos de 5 min; la ventana no interviene en el borrado.
const CAGES = [0, 30, 119, 121, 240, 299, 301, 600, 3600, 43200];
const gridCreate = [];
for (const docAge of [...CAGES, null]) for (const who of ['author', 'other']) {
  const uid = who === 'author' ? 'u1' : 'u2';
  const allowed = who === 'author' && docAge !== null && docAge < 300;
  gridCreate.push(crea(`rejilla create · ${who} · documento ${docAge === null ? 'AUSENTE' : docAge + ' s'}`, allowed ? 'ALLOW' : 'DENY', docAge === null ? 1 : docAge / 60, { uid, ...(docAge === null ? { docExists: false } : {}) }));
}
const gridFs = [];
for (const age of AGES) for (const who of ['author', 'other', 'spotter', 'admin']) {
  const uid = { author: 'u1', other: 'u2', spotter: 's1', admin: 'a1' }[who], role = { spotter: 'spotter', admin: 'admin' }[who];
  const allowed = who === 'admin' || (who === 'author' && age < 12 * 3600);
  gridFs.push(delPhoto(`rejilla firestore delete · ${who} · documento ${age} s · con marca`, allowed ? 'ALLOW' : 'DENY', age / 60, { uid, role }));
}

// ---------- Variante A1 (propuesta, no desplegada): un administrador puede borrar SIN marca un documento de formato antiguo (sin storagePath) ----------
const delA1 = (label, expectation, { uid = 'u1', email, role, legacy = false, tomb = false, by = 'u1', age = 60 } = {}) => ({ label, tc: { expectation, request: { path: fsPath(`route-photos/${photo}`), method: 'delete', time: iso(NOW), auth: auth(uid, email) },
  resource: { data: legacy ? { uploadedBy: by, uploadedAt: ago(age * 60), photoUrl: 'https://x/o/y', schoolId: 'valeria', filename: 'f.jpeg' } : { uploadedBy: by, uploadedAt: ago(age * 60), storagePath: obj } },
  functionMocks: [fmock('existsAfter', `route-photo-tombstones/${photo}`, tomb), fmock('exists', `admins/${uid}`, !!role), ...(role ? [fmock('get', `admins/${uid}`, { data: { role } })] : [])] } });
const a1Cases = [
  delA1('A1 · admin, documento ANTIGUO, borrado simple (sin marca)', 'ALLOW', { uid: 'a1', role: 'admin', legacy: true }),
  delA1('A1 · super-admin, documento ANTIGUO, borrado simple', 'ALLOW', { uid: 'sa', email: 'krux.app.info@gmail.com', legacy: true }),
  delA1('A1 · admin, documento NUEVO, borrado simple (exige marca)', 'DENY', { uid: 'a1', role: 'admin' }),
  delA1('A1 · super-admin, documento NUEVO, borrado simple', 'DENY', { uid: 'sa', email: 'krux.app.info@gmail.com' }),
  delA1('A1 · admin, documento NUEVO, con marca en el mismo lote', 'ALLOW', { uid: 'a1', role: 'admin', tomb: true }),
  delA1('A1 · autor, documento ANTIGUO, borrado simple', 'DENY', { legacy: true, age: 60 }),
  delA1('A1 · autor, documento ANTIGUO con marca pero vencido', 'DENY', { legacy: true, tomb: true, age: 13 * 60 }),
  delA1('A1 · spotter, documento ANTIGUO, borrado simple', 'DENY', { uid: 's1', role: 'spotter', legacy: true }),
  delA1('A1 · otro usuario, documento ANTIGUO, borrado simple', 'DENY', { uid: 'u2', legacy: true }),
  delA1('A1 · otro usuario, documento ANTIGUO, con marca', 'DENY', { uid: 'u2', legacy: true, tomb: true }),
  delA1('A1 · admin, documento ANTIGUO, con marca (el cliente nuevo sigue funcionando)', 'ALLOW', { uid: 'a1', role: 'admin', legacy: true, tomb: true })
];

(async () => {
  console.log(`Proyecto: ${PROJECT} · motor real de Firebase Rules (projects:test) · ${new Date().toISOString()}\n== Storage (storage.rules) ==`);
  let bad = await run(path.join(ROOT, 'storage.rules'), 'storage.rules', storageCases);
  console.log('\n== Firestore (firestore.rules.route-photos-only.proposal) ==');
  bad += await run(path.join(ROOT, 'docs/security-phase0/firestore.rules.route-photos-only.proposal'), 'firestore.rules', fsCases);
  const variantFile = path.join(require('node:os').tmpdir(), `kx-a1-${process.pid}.rules`);
  fs.writeFileSync(variantFile, variantA1(fs.readFileSync(path.join(ROOT, 'docs/security-phase0/firestore.rules.route-photos-only.proposal'), 'utf8')));
  console.log('\n== Variante A1 (propuesta; construida en memoria, no desplegada) ==');
  bad += await run(variantFile, 'firestore.rules', a1Cases);
  fs.rmSync(variantFile, { force: true });
  console.log('\n== Rejilla Storage: ' + gridCases.length + ' combinaciones (solo se imprimen las que NO coinciden) ==');
  bad += await run(path.join(ROOT, 'storage.rules'), 'storage.rules', gridCases, true);
  console.log('\n== Rejilla de subida (Storage): ' + gridCreate.length + ' combinaciones ==');
  bad += await run(path.join(ROOT, 'storage.rules'), 'storage.rules', gridCreate, true);
  console.log('\n== Rejilla Firestore: ' + gridFs.length + ' combinaciones ==');
  bad += await run(path.join(ROOT, 'docs/security-phase0/firestore.rules.route-photos-only.proposal'), 'firestore.rules', gridFs, true);
  console.log(`\n${bad ? bad + ' casos NO coinciden' : 'Todos los casos coinciden'} (${storageCases.length + fsCases.length + a1Cases.length + gridCases.length + gridCreate.length + gridFs.length} casos)`);
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error('ERROR', e.message); process.exit(2); });

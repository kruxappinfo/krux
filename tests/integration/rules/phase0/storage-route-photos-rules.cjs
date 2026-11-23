// Fase 0 — fragmento PROPUESTO de reglas de Storage para route-photos (docs/security-phase0/storage.rules.route-photos.fragment.proposal).
// IMPORTANTE: no hay reglas reales de Storage en el repositorio ni acceso a las desplegadas. Esto prueba la PROPUESTA contra el
// emulador de Storage local; no prueba nada del proyecto real. Los archivos se manejan por la API REST del emulador con el
// mismo formato que usa el SDK web (subida multipart, cabecera «Authorization: Firebase <idToken>»).
// Plazo de 12 h: el emulador no permite adelantar el reloj ni fijar resource.timeCreated, así que el borrado del autor tras el
// plazo se prueba con la MISMA regla escalada a 4 segundos (solo se sustituye duration.value(12,'h') por duration.value(4,'s')).
const fs = require('node:fs');
const path = require('node:path');
const L = require('./_lib.cjs');
const { mk, mkAnon, seed, expect, check, SUPER_EMAIL } = L;

const HOST = `http://127.0.0.1:${L.ST_PORT}`;
const BUCKET = `${L.PROJECT}.appspot.com`;
const FRAGMENT = fs.readFileSync(path.join(L.ROOT, 'docs/security-phase0/storage.rules.route-photos.fragment.proposal'), 'utf8');
const setRules = async (content) => {
  const r = await fetch(`${HOST}/internal/setRules`, { method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rules: { files: [{ name: 'storage.rules', content }] } }) });
  if (!r.ok) throw new Error('setRules: ' + r.status + ' ' + (await r.text()));
};
// Cada operación devuelve una promesa que se rechaza con code «permission» si el emulador responde 401/403
const authHeader = (tok) => (tok === 'owner' ? { Authorization: 'Bearer owner' } : tok ? { Authorization: 'Firebase ' + tok } : {});
const fail = (r, t) => { const e = new Error(`${r.status} ${t.slice(0, 80)}`); e.code = r.status === 401 || r.status === 403 ? 'permission-denied' : 'http-' + r.status; return e; };
async function upload(tok, objPath, contentType = 'image/jpeg', size = 1024) {
  const boundary = 'bnd' + Math.random().toString(36).slice(2);
  const meta = JSON.stringify({ name: objPath, contentType });
  const body = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=utf-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`),
    Buffer.alloc(size, 7), Buffer.from(`\r\n--${boundary}--`)]);
  const r = await fetch(`${HOST}/v0/b/${BUCKET}/o?name=${encodeURIComponent(objPath)}`, { method: 'POST',
    headers: { ...authHeader(tok), 'X-Goog-Upload-Protocol': 'multipart', 'Content-Type': `multipart/related; boundary=${boundary}` }, body });
  const t = await r.text(); if (!r.ok) throw fail(r, t); return t;
}
async function del(tok, objPath) {
  const r = await fetch(`${HOST}/v0/b/${BUCKET}/o/${encodeURIComponent(objPath)}`, { method: 'DELETE', headers: authHeader(tok) });
  const t = await r.text(); if (!r.ok) throw fail(r, t); return t;
}
async function read(tok, objPath) {
  const r = await fetch(`${HOST}/v0/b/${BUCKET}/o/${encodeURIComponent(objPath)}?alt=media`, { headers: authHeader(tok) });
  const t = await r.text(); if (!r.ok) throw fail(r, t); return t;
}
const present = async (objPath) => { try { await read('owner', objPath); return true; } catch (_) { return false; } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  await L.loadFirestoreRules('proposal0');      // el rol admin se lee de Firestore (firestore.exists/get desde las reglas de Storage)
  await setRules(FRAGMENT);
  const stamp = Date.now();
  const A = await mk('sa' + stamp, `sta${stamp}@test.dev`);
  const B = await mk('sb' + stamp, `stb${stamp}@test.dev`);
  const SP = await mk('ssp' + stamp, `stsp${stamp}@test.dev`);
  const AD = await mk('sad' + stamp, `stad${stamp}@test.dev`);
  const SA = await mk('ssa' + stamp, SUPER_EMAIL);
  const tA = await A.token(), tB = await B.token(), tSP = await SP.token(), tAD = await AD.token(), tSA = await SA.token();
  await seed(`admins/${SP.uid}`, { role: 'spotter' });
  await seed(`admins/${AD.uid}`, { role: 'admin' });
  const S = `s${stamp}`;
  const mine = (u, f) => `route-photos/${S}/${u.uid}/${f}`;

  // ---------- subida ----------
  await expect('usuario autenticado sube a su carpeta (image/jpeg)', upload(tA, mine(A, 'a1.jpg')), true);
  await expect('usuario sin rol (B) sube a su carpeta', upload(tB, mine(B, 'b1.jpg')), true);
  await expect('spotter sube a su carpeta (no necesita rol)', upload(tSP, mine(SP, 'sp1.jpg')), true);
  await expect('png permitido', upload(tA, mine(A, 'a2.png'), 'image/png'), true);
  await expect('sin autenticar intenta subir', upload(null, mine(A, 'x1.jpg')), false);
  await expect('A sube a la carpeta de B (falsificar autoría por la ruta)', upload(tA, mine(B, 'x2.jpg')), false);
  await expect('subir a la ruta antigua sin uid', upload(tA, `route-photos/${S}/x3.jpg`), false);
  await expect('tipo no imagen (text/html)', upload(tA, mine(A, 'x4.jpg'), 'text/html'), false);
  await expect('imagen de 6 MB (límite 5 MB)', upload(tA, mine(A, 'x5.jpg'), 'image/jpeg', 6 * 1024 * 1024), false);
  await expect('sobrescribir un archivo existente (update)', upload(tA, mine(A, 'a1.jpg')), false);
  await expect('B sobrescribe el archivo de A', upload(tB, mine(A, 'a1.jpg')), false);
  await expect('lectura pública sin autenticar', read(null, mine(A, 'a1.jpg')), true);
  await expect('ruta no cubierta por el fragmento (posts/…) queda denegada en este archivo de prueba', upload(tA, `posts/${A.uid}/x.jpg`), false,
    'en un archivo real hay que conservar las reglas vigentes de las demás rutas');

  // ---------- borrado sin autorización (acceso directo a Storage, sin pasar por la app) ----------
  await upload(tA, mine(A, 'd1.jpg'));
  await expect('sin autenticar borra el archivo directamente', del(null, mine(A, 'd1.jpg')), false);
  await expect('B borra directamente el archivo de A', del(tB, mine(A, 'd1.jpg')), false);
  await expect('spotter borra directamente el archivo de A', del(tSP, mine(A, 'd1.jpg')), false);
  check('el archivo de A sigue existiendo tras los intentos denegados', await present(mine(A, 'd1.jpg')));
  // Los permisos de Firestore NO protegen Storage: borrar el documento no toca el archivo y viceversa
  await seed(`route-photos/${S}_doc`, { uploadedBy: A.uid, uploadedAt: new Date(), schoolId: S, filename: 'd1.jpg', storagePath: mine(A, 'd1.jpg') });
  check('un documento de Firestore con uploadedBy=A no da a nadie permiso sobre el archivo (comprobado arriba: B y spotter denegados)', true,
    'cada servicio aplica su propia política: Firestore no controla Storage');

  // ---------- borrado: dentro del plazo y roles (regla real de 12 h) ----------
  await upload(tA, mine(A, 'd2.jpg'));
  await expect('autor borra su archivo recién subido (dentro de 12 h)', del(tA, mine(A, 'd2.jpg')), true);
  check('el archivo del autor desaparece', !(await present(mine(A, 'd2.jpg'))));
  await upload(tA, mine(A, 'd3.jpg'));
  await expect('admin borra un archivo ajeno reciente', del(tAD, mine(A, 'd3.jpg')), true);
  await upload(tA, mine(A, 'd4.jpg'));
  await expect('super-admin borra un archivo ajeno reciente', del(tSA, mine(A, 'd4.jpg')), true);
  await upload(tSP, mine(SP, 'd5.jpg'));
  await expect('spotter borra su PROPIO archivo reciente (como autor)', del(tSP, mine(SP, 'd5.jpg')), true);
  await upload(tB, mine(B, 'd6.jpg'));
  await expect('autor B no puede borrar un archivo que no es suyo', del(tB, mine(A, 'd1.jpg')), false);

  // ---------- fotos antiguas (ruta sin uid): autor no demostrable ----------
  await upload('owner', `route-photos/${S}/legacy1.jpg`);
  await expect('ruta antigua: un usuario normal no puede borrar', del(tA, `route-photos/${S}/legacy1.jpg`), false);
  await expect('ruta antigua: el spotter no puede borrar', del(tSP, `route-photos/${S}/legacy1.jpg`), false);
  await expect('ruta antigua: sin autenticar no puede borrar', del(null, `route-photos/${S}/legacy1.jpg`), false);
  await expect('ruta antigua: el admin sí', del(tAD, `route-photos/${S}/legacy1.jpg`), true);
  await upload('owner', `route-photos/${S}/legacy2.jpg`);
  await expect('ruta antigua: el super-admin sí', del(tSA, `route-photos/${S}/legacy2.jpg`), true);

  // ---------- plazo vencido: MISMA regla escalada a 4 s (documentado) ----------
  const scaled = FRAGMENT.replace("duration.value(12, 'h')", "duration.value(4, 's')");
  check('la sustitución de prueba solo cambia la duración (una única ocurrencia)', scaled !== FRAGMENT && FRAGMENT.split("duration.value(12, 'h')").length === 2);
  await setRules(scaled);
  await upload(tA, mine(A, 't1.jpg')); await upload(tA, mine(A, 't2.jpg')); await upload(tA, mine(A, 't3.jpg')); await upload(tSP, mine(SP, 't4.jpg'));
  await expect('[ventana 4 s] autor borra dentro de la ventana', del(tA, mine(A, 't1.jpg')), true);
  await sleep(5500);
  await expect('[ventana 4 s] autor borra tras vencer la ventana', del(tA, mine(A, 't2.jpg')), false);
  await expect('[ventana 4 s] spotter, autor de su archivo, borra tras vencer la ventana (sin privilegios de rol)', del(tSP, mine(SP, 't4.jpg')), false);
  await expect('[ventana 4 s] spotter borra el archivo ajeno tras vencer', del(tSP, mine(A, 't2.jpg')), false);
  await expect('[ventana 4 s] otro usuario borra el archivo ajeno tras vencer', del(tB, mine(A, 't2.jpg')), false);
  check('[ventana 4 s] el archivo vencido sigue existiendo para el autor tras el intento', await present(mine(A, 't2.jpg')));
  await expect('[ventana 4 s] admin borra tras vencer la ventana', del(tAD, mine(A, 't2.jpg')), true);
  await expect('[ventana 4 s] super-admin borra tras vencer la ventana', del(tSA, mine(A, 't3.jpg')), true);
  await setRules(FRAGMENT);   // se restaura la regla propuesta de 12 h
  check('instante exacto de las 12 h: NO ejecutable (el emulador no fija el reloj ni timeCreated)', true, 'la regla usa «<» estricto sobre resource.timeCreated');

  L.finish('storage-route-photos-rules.cjs');
  process.exit(process.exitCode || 0);
})().catch(e => { console.error('ERROR FATAL', String(e.message).slice(0, 300), '\nÚltima prueba registrada:', L.results.length ? L.results[L.results.length - 1].label : '(ninguna)'); process.exit(2); });

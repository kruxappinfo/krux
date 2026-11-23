// DECISIÓN (2026-11-15): se mantiene A0 y A1 NO se adopta ni se implementa; este archivo conserva TODAS sus pruebas de seguridad (A1 solo como estudio, con una variante en memoria).
// Alternativa a la «capa 0» de los documentos huérfanos: que administradores y super-administradores resuelvan documentos huérfanos de clientes antiguos
// CREANDO SU MARCA (tombstone) DE FORMA SEGURA Y ATÓMICA, sin permitir reutilizar ids ni debilitar las reglas.
//   A0  (sin cambiar reglas)  La vía con las reglas VIGENTES de la propuesta: lote atómico «borrar el documento + crear su marca». Estas pruebas demuestran que ya es segura.
//   A1  (variante opcional)   Reglas con un cambio mínimo: un administrador puede borrar SIN marca un documento de formato antiguo (sin storagePath). Seguro porque las reglas ya no permiten
//                             crear documentos de ese formato, así que su id no se puede reutilizar. La variante se construye EN MEMORIA aquí; no se guarda ningún archivo de reglas desplegable.
// Solo emulador local; datos sintéticos; no toca producción.
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const ROOT = path.resolve(__dirname, '../../../..');
const FS_FILE = path.join(ROOT, 'docs/security-phase0/firestore.rules.route-photos-only.proposal');
process.env.RULES_FILE = process.env.RULES_FILE || FS_FILE;
process.env.MODE = 'proposal';
const L = require('./_lib.cjs');
const S = require('./_storage.cjs');
const { mkPhotoV2, delPhotoBatch, BASE } = require('./_photos.cjs');
const { makeEnv, mkFile, attempt, docOf } = require('./_client-env.cjs');
const { variantA1 } = require('./_variants.cjs');
const { mk, seed, expect, check, SUPER_EMAIL } = L;
const H = 3600 * 1000;
const sha = (x) => crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');

(async () => {
  const stamp = Date.now(), SCH = `ao${stamp}`;
  const A = await mk('ao' + stamp, `ao${stamp}@test.dev`), B = await mk('bo' + stamp, `bo${stamp}@test.dev`), ADM = await mk('ad' + stamp, `ad${stamp}@test.dev`);
  const SP = await mk('sp' + stamp, `sp${stamp}@test.dev`), SA = await mk('sa' + stamp, SUPER_EMAIL);
  for (const u of [A, B, ADM, SP, SA]) { u.st = u.app.storage(); u.st.useEmulator('127.0.0.1', L.ST_PORT); }
  await seed(`admins/${ADM.uid}`, { role: 'admin' }); await seed(`admins/${SP.uid}`, { role: 'spotter' });
  await S.loadStorageRules(path.join(ROOT, 'storage.rules'));
  const fsText = fs.readFileSync(FS_FILE, 'utf8');
  const load = async (text) => { const r = await fetch(`http://127.0.0.1:${L.FS_PORT}/emulator/v1/projects/${L.PROJECT}:securityRules`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rules: { files: [{ name: 'firestore.rules', content: text }] } }) }); if (!r.ok) throw new Error(await r.text()); };
  await load(fsText);

  // ---------- fixtures sintéticos ----------
  let k = 0;
  const legacy = async (ageMs = 90 * 24 * H, by = A) => { k++; const fn = `${1700000000000 + k}_Vieja${k}.jpeg`, id = `${SCH}_Vieja${k}_${1700000000000 + k}`;
    await seed(`route-photos/${id}`, { photoUrl: `${BASE}route-photos%2F${SCH}%2F${fn}?alt=media&token=t`, uploadedBy: by.uid, uploadedByName: 'X', uploadedAt: new Date(Date.now() - ageMs), routeName: `Vieja${k}`, schoolId: SCH, filename: fn }); return { id, path: `route-photos/${SCH}/${fn}` }; };
  const fresh = async (ageMs, { file = false, by = A } = {}) => { const x = mkPhotoV2(by, by.FV, {}, SCH, ++k); await seed(`route-photos/${x.id}`, { ...x.data, uploadedAt: new Date(Date.now() - ageMs) }); if (file) await S.upload('owner', x.storagePath); return x; };
  const decoys = { [`sector_route_drawings/${SCH}_s`]: { schoolId: SCH, drawings: [{ routeId: 1, points: [{ x: 1, y: 1 }] }] }, [`sector_images/${SCH}_s`]: { schoolId: SCH, images: [{ id: 'i', storagePath: `sector-images/${SCH}/s/i.jpg` }] } };
  for (const [p, d] of Object.entries(decoys)) await seed(p, d);
  await S.upload('owner', `sector-images/${SCH}/s/i.jpg`);
  const decoyState = async () => { const o = {}; for (const p of Object.keys(decoys)) o[p] = await L.ownerData(p); const r = await fetch(`${S.HOST}/storage/v1/b/${S.BUCKET}/o?prefix=sector-images/${SCH}/`, { headers: { Authorization: 'Bearer owner' } }); o.obj = ((await r.json()).items || []).map(i => i.name); return sha(o); };
  const decoysBefore = await decoyState();
  const state = async (id) => ({ doc: !!(await docOf(id)), tomb: await L.exists(`route-photo-tombstones/${id}`) });
  const noop = (s, label) => check(label, !s.doc ? false : !s.tomb);

  // =================== A0: reglas vigentes ===================
  const L1 = await legacy(), N1 = await fresh(13 * H), N2 = await fresh(13 * H), L2 = await legacy(), N3 = await fresh(1 * H), L3 = await legacy();
  await expect('A0 · un administrador resuelve un huérfano de cliente antiguo (formato antiguo) con el lote «borrar + marca»', delPhotoBatch(ADM, L1.id), true);
  let st = await state(L1.id);
  check('A0 · estado: documento borrado Y marca creada (las dos cosas, nunca solo una)', !st.doc && st.tomb);
  check('A0 · la marca la firma el administrador y solo contiene deletedBy y deletedAt', (await L.ownerData(`route-photo-tombstones/${L1.id}`)).deletedBy === ADM.uid && Object.keys(await L.ownerData(`route-photo-tombstones/${L1.id}`)).sort().join() === 'deletedAt,deletedBy');
  await expect('A0 · un super-administrador resuelve un huérfano de formato nuevo vencido (13 h)', delPhotoBatch(SA, N1.id), true);
  check('A0 · estado: documento borrado y marca creada', await state(N1.id).then(s => !s.doc && s.tomb));

  // atomicidad: si la marca no es válida, NO se borra el documento
  for (const [label, over] of [['marca con deletedBy de otro usuario', { deletedBy: B.uid }], ['marca con la hora del cliente', { deletedAt: new Date(Date.now() - 5000) }], ['marca con un campo extra', { motivo: 'x' }]]) {
    await expect(`A0 · atomicidad: ${label} → el lote entero se rechaza`, delPhotoBatch(ADM, L2.id, over), false);
    st = await state(L2.id); check(`A0 · atomicidad: tras el rechazo (${label}) el documento SIGUE y no hay marca`, st.doc && !st.tomb);
  }
  await expect('A0 · atomicidad: una marca suelta (sin borrar el documento) se rechaza', ADM.db.collection('route-photo-tombstones').doc(L2.id).set({ deletedBy: ADM.uid, deletedAt: ADM.FV.serverTimestamp() }), false);
  await expect('A0 · atomicidad: una marca para un documento inexistente se rechaza (no se pueden envenenar ids)', ADM.db.collection('route-photo-tombstones').doc(`${SCH}_9_${'q'.repeat(16)}`).set({ deletedBy: ADM.uid, deletedAt: ADM.FV.serverTimestamp() }), false);
  check('A0 · atomicidad: el huérfano L2 sigue intacto tras todos los intentos', await state(L2.id).then(s => s.doc && !s.tomb));

  // quién puede y quién no
  for (const [who, u] of [['otro usuario', B], ['un spotter', SP]]) {
    await expect(`A0 · ${who} NO puede resolver un huérfano ajeno`, delPhotoBatch(u, L2.id), false);
    await expect(`A0 · ${who} NO puede resolver un huérfano nuevo vencido`, delPhotoBatch(u, N2.id), false);
  }
  const anon = await L.mkAnon('anon' + stamp);
  await expect('A0 · un visitante NO puede', (() => { const b = anon.db.batch(); b.delete(anon.db.collection('route-photos').doc(L2.id)); b.set(anon.db.collection('route-photo-tombstones').doc(L2.id), { deletedBy: 'x', deletedAt: anon.FV.serverTimestamp() }); return b.commit(); })(), false);
  await expect('A0 · el AUTOR no puede resolver su huérfano pasadas 12 h', delPhotoBatch(A, N2.id), false);
  await expect('A0 · el autor SÍ puede resolver el suyo dentro de las 12 h (control: comportamiento ya existente)', delPhotoBatch(A, N3.id), true);
  check('A0 · tras los intentos no autorizados, L2 y N2 siguen sin marca', await state(L2.id).then(s => s.doc && !s.tomb) && await state(N2.id).then(s => s.doc && !s.tomb));

  // no se debilita nada: la vía de los clientes antiguos (borrado simple de un administrador) sigue denegada con las reglas vigentes
  await expect('A0 · NO se debilita: el borrado simple de un administrador (como hacen los clientes antiguos) sigue denegado en formato antiguo', ADM.db.collection('route-photos').doc(L2.id).delete(), false);
  await expect('A0 · NO se debilita: ni en formato nuevo', ADM.db.collection('route-photos').doc(N2.id).delete(), false);
  await expect('A0 · NO se debilita: un super-administrador tampoco puede borrar sin marca', SA.db.collection('route-photos').doc(N2.id).delete(), false);

  // ids
  await expect('A0 · el id resuelto (formato nuevo) NO se puede reutilizar por su autor', A.db.collection('route-photos').doc(N1.id).set({ ...N1.data }), false);
  await expect('A0 · ni por un administrador', ADM.db.collection('route-photos').doc(N1.id).set({ ...N1.data, uploadedBy: ADM.uid, storagePath: `route-photos/${SCH}/${ADM.uid}/${N1.filename}` }), false);
  const legacyId = L1.id;
  await expect('A0 · el id de formato antiguo resuelto no se puede crear (el formato antiguo ya no es válido)', A.db.collection('route-photos').doc(legacyId).set({ photoUrl: `${BASE}route-photos%2F${SCH}%2Fx.jpeg?alt=media`, uploadedBy: A.uid, uploadedAt: A.FV.serverTimestamp(), routeId: 1, schoolId: SCH, filename: 'x.jpeg', storagePath: `route-photos/${SCH}/${A.uid}/x.jpeg` }), false);
  await expect('A0 · la marca no la puede modificar ni borrar un administrador; solo el super-administrador (capacidad ya existente)', (async () => { await ADM.db.collection('route-photo-tombstones').doc(N1.id).delete(); })(), false);
  await expect('A0 · el administrador no puede modificar la marca', ADM.db.collection('route-photo-tombstones').doc(N1.id).update({ deletedBy: B.uid }), false);

  // límites de lo que hace la vía (documentados): las reglas no ven Storage
  const N4 = await fresh(13 * H, { file: true });
  await expect('A0 · LÍMITE: las reglas permiten resolver un documento CON archivo (no ven Storage); el cliente/herramienta debe comprobar antes que el archivo no existe', delPhotoBatch(ADM, N4.id), true);
  check('A0 · LÍMITE: tras ello el archivo sigue en Storage (huérfano inverso, solo informado; nunca se borra solo)', await S.present(N4.storagePath));
  const N5 = await fresh(13 * H, { file: true }); const eAdm = makeEnv(ADM);
  const rr = await attempt(() => eAdm.api.deleteRoutePhoto(N5.id, A.uid));
  check('A0 · con el cliente actual, un administrador que borra una foto con archivo borra primero el archivo y luego el documento (sin dejar archivo huérfano)', rr.ok && !(await S.present(N5.storagePath)) && await state(N5.id).then(s => !s.doc && s.tomb), rr.error && rr.error.message);
  check('A0 · nada de lo anterior tocó trazados de vías, sectores ni sus archivos', await decoyState() === decoysBefore);

  // =================== A1: variante opcional (en memoria) ===================
  const variant = variantA1(fsText);
  check('A1 · la variante se construye cambiando SOLO la regla de borrado de route-photos', variant !== fsText && variant.split('\n').length - fsText.split('\n').length <= 3 && variant.includes("!('storagePath' in resource.data)"));
  await load(variant);
  const V1 = await legacy(), V2 = await legacy(), V3 = await legacy(), V4 = await legacy(), W1 = await fresh(13 * H), W2 = await fresh(1 * H);
  await expect('A1 · un administrador con un cliente antiguo (borrado simple) resuelve un huérfano de formato antiguo', ADM.db.collection('route-photos').doc(V1.id).delete(), true);
  check('A1 · estado: documento borrado SIN marca (no hace falta: ese id no se puede volver a crear)', await state(V1.id).then(s => !s.doc && !s.tomb));
  await expect('A1 · un super-administrador también', SA.db.collection('route-photos').doc(V2.id).delete(), true);
  await expect('A1 · SIN debilitar: el borrado simple de un administrador sobre un documento de formato NUEVO sigue denegado (exige marca)', ADM.db.collection('route-photos').doc(W1.id).delete(), false);
  await expect('A1 · SIN debilitar: el super-administrador tampoco puede borrar un documento nuevo sin marca', SA.db.collection('route-photos').doc(W1.id).delete(), false);
  for (const [who, u] of [['otro usuario', B], ['un spotter', SP], ['el autor (documento antiguo vencido)', A]]) await expect(`A1 · SIN debilitar: ${who} NO puede borrar un documento antiguo sin marca`, u.db.collection('route-photos').doc(V3.id).delete(), false);
  await expect('A1 · SIN debilitar: un visitante no puede', anon.db.collection('route-photos').doc(V3.id).delete(), false);
  await expect('A1 · el lote «borrar + marca» del administrador sigue funcionando (nuevos y antiguos)', (async () => { await delPhotoBatch(ADM, V4.id); await delPhotoBatch(ADM, W1.id); })(), true);
  await expect('A1 · el autor sigue pudiendo borrar lo suyo dentro de 12 h solo con marca', delPhotoBatch(A, W2.id), true);
  await expect('A1 · el autor sigue SIN poder borrar con borrado simple dentro de las 12 h', (async () => { const x = await fresh(1 * H); await A.db.collection('route-photos').doc(x.id).delete(); })(), false);
  // ids: el formato antiguo es imposible de crear, así que borrar sin marca no permite reutilizar el id
  await expect('A1 · el id antiguo borrado sin marca NO se puede recrear (ni por su autor)', A.db.collection('route-photos').doc(V1.id).set({ photoUrl: `${BASE}route-photos%2F${SCH}%2Fx.jpeg?alt=media`, uploadedBy: A.uid, uploadedByName: 'X', uploadedAt: A.FV.serverTimestamp(), routeName: 'Vieja', schoolId: SCH, filename: 'x.jpeg' }), false);
  await expect('A1 · ni con el formato nuevo completo bajo ese id', A.db.collection('route-photos').doc(V1.id).set({ photoUrl: `${BASE}route-photos%2F${SCH}%2F${A.uid}%2Fx.jpg?alt=media`, uploadedBy: A.uid, uploadedAt: A.FV.serverTimestamp(), routeId: 1, schoolId: SCH, filename: `${V1.id}.jpg`, storagePath: `route-photos/${SCH}/${A.uid}/${V1.id}.jpg` }), false);
  await expect('A1 · ni un administrador puede crear un documento de formato antiguo', ADM.db.collection('route-photos').doc(`${SCH}_Nueva_1700000009999`).set({ photoUrl: `${BASE}route-photos%2F${SCH}%2Fy.jpeg?alt=media`, uploadedBy: ADM.uid, uploadedAt: ADM.FV.serverTimestamp(), routeName: 'Nueva', schoolId: SCH, filename: 'y.jpeg' }), false);
  await expect('A1 · una marca suelta sigue denegada', ADM.db.collection('route-photo-tombstones').doc(V3.id).set({ deletedBy: ADM.uid, deletedAt: ADM.FV.serverTimestamp() }), false);
  check('A1 · nada de lo anterior tocó trazados de vías, sectores ni sus archivos', await decoyState() === decoysBefore);

  await load(fsText);   // se restauran las reglas de la propuesta en el emulador
  L.finish('admin-orphan-resolution.cjs');
  process.exit(process.exitCode || 0);
})().catch(e => { console.error('ERROR FATAL', String(e.stack || e.message).slice(0, 800), '\nÚltima prueba registrada:', L.results.length ? L.results[L.results.length - 1].label : '(ninguna)'); process.exit(2); });

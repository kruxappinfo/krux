// Fase 0c — el cliente REAL (route-photos.js) contra los emuladores de Auth, Firestore y Storage con las reglas FINALES
// (storage.rules + firestore.rules.phase0c.proposal). Ejecuta el código de producción en un contexto aislado (vm) con el SDK real de Firebase
// apuntando al emulador; las únicas piezas simuladas son los globales del navegador (currentUser, localStorage, kxPrepareImageForUpload) y los
// «interruptores de fallo» que envuelven db/storage para provocar fallos parciales, pérdida de respuestas y reintentos.
// NO toca producción ni usa credenciales. Un fallo aquí significa que cliente y reglas no son compatibles.
const path = require('node:path');
const fs = require('node:fs');
const ROOT = path.resolve(__dirname, '../../../..');
process.env.RULES_FILE = process.env.RULES_FILE || path.join(ROOT, 'docs/security-phase0/firestore.rules.phase0c.proposal');
process.env.MODE = 'proposal';
const L = require('./_lib.cjs');
const S = require('./_storage.cjs');
require(path.join(ROOT, 'node_modules/firebase/compat/storage'));
const { mk, seed, expect, check, SUPER_EMAIL } = L;
const H = 3600 * 1000;
const PROD_BUCKET = 'climbmaps-80cae.firebasestorage.app';

const { makeEnv, mkFile, netErr, attempt, idOf, docOf, backdate, poll } = require('./_client-env.cjs');

(async () => {
  await L.loadFirestoreRules('proposal');
  await S.loadStorageRules(path.join(ROOT, 'storage.rules'));
  const stamp = Date.now();
  const A = await mk('ra' + stamp, `ra${stamp}@test.dev`), B = await mk('rb' + stamp, `rb${stamp}@test.dev`);
  const SP = await mk('rsp' + stamp, `rsp${stamp}@test.dev`), AD = await mk('rad' + stamp, `rad${stamp}@test.dev`), SA = await mk('rsa' + stamp, SUPER_EMAIL);
  for (const u of [A, B, SP, AD, SA]) { u.st = u.app.storage(); u.st.useEmulator('127.0.0.1', L.ST_PORT); }
  await seed(`admins/${SP.uid}`, { role: 'spotter' }); await seed(`admins/${AD.uid}`, { role: 'admin' });
  const SCH = 'sc' + stamp;   // escuela propia de esta ejecución: el emulador conserva los datos de ejecuciones anteriores

  check('el cliente contiene las funciones públicas que usa app_3.js', ['uploadRoutePhoto', 'deleteRoutePhoto', 'getRoutePhotos', 'getRoutePhotoURL', 'canUploadPhotos', 'isPhotoAdmin']
    .every(f => typeof makeEnv(A).api[f] === 'function'));

  // ===== Permisos de interfaz =====
  const eA = makeEnv(A), eSP = makeEnv(SP), eAD = makeEnv(AD), eSA = makeEnv(SA), eNo = makeEnv(A, { profile: null });
  check('canUploadPhotos: cualquier usuario con sesión', await eA.api.canUploadPhotos() === true && await eSP.api.canUploadPhotos() === true);
  check('canUploadPhotos: sin sesión no', await eNo.api.canUploadPhotos() === false);
  check('isPhotoAdmin: usuario normal no, spotter NO, admin sí, super-admin sí', await eA.api.isPhotoAdmin() === false && await eSP.api.isPhotoAdmin() === false && await eAD.api.isPhotoAdmin() === true && await eSA.api.isPhotoAdmin() === true);

  // ===== U1. Subida correcta: orden, formato y relación documento↔archivo =====
  let e = makeEnv(A);
  const r1 = await attempt(() => e.api.uploadRoutePhoto(SCH, 12, 'Vía de prueba', mkFile('Foto Vía.JPEG', 'image/jpeg', 200 * 1024)));
  check('U1: la subida termina bien', r1.ok, r1.error && r1.error.message);
  const id1 = r1.ok ? idOf(r1.value) : null, d1 = id1 ? await docOf(id1) : null;
  check('U1: el documento se crea ANTES de subir el archivo', e.calls.indexOf('doc.set') >= 0 && e.calls.indexOf('doc.set') < e.calls.indexOf('file.put'), e.calls.join(' > '));
  check('U1: id = {escuela}_{vía}_{16 caracteres [a-z0-9]}', new RegExp('^' + SCH + '_12_[a-z0-9]{16}$').test(id1 || ''), id1);
  check('U1: filename = {id}.jpg (la extensión sale del tipo, no del nombre «.JPEG»)', d1 && d1.filename === `${id1}.jpg`, d1 && d1.filename);
  check('U1: storagePath = route-photos/{escuela}/{uid}/{filename}', d1 && d1.storagePath === `route-photos/${SCH}/${A.uid}/${id1}.jpg`);
  check('U1: photoUrl sin token y con ?alt=media', d1 && /\?alt=media$/.test(d1.photoUrl) && !/token/.test(d1.photoUrl), d1 && d1.photoUrl);
  check('U1: el archivo existe y se lee sin sesión (como lo ve un visitante)', d1 && await S.present(d1.storagePath) && await S.read(null, d1.storagePath).then(() => true, () => false));
  check('U1: sin sesión el documento y el archivo son los mismos que devuelve la URL', d1 && r1.value === d1.photoUrl);
  check('U1: uploadedBy = uid, uploadedAt lo puso el servidor (cercano a ahora), sin campos extra', d1 && d1.uploadedBy === A.uid && Math.abs(Date.parse(d1.uploadedAt) - Date.now()) < 60000
    && Object.keys(d1).sort().join() === ['filename', 'photoUrl', 'routeId', 'routeName', 'schoolId', 'storagePath', 'uploadedAt', 'uploadedBy', 'uploadedByName'].sort().join(), d1 && Object.keys(d1).join());
  const list1 = await e.api.getRoutePhotos(SCH, 12, 'Vía de prueba');
  check('U1: getRoutePhotos devuelve la foto con su URL', list1.some(x => x.id === id1 && x.url === d1.photoUrl));
  check('U1: sin marcas ni pendientes', !(await L.exists(`route-photo-tombstones/${id1}`)) && e.pending().length === 0);

  // ===== U2. Formatos y conversión =====
  for (const [type, ext] of [['image/png', 'png'], ['image/webp', 'webp'], ['image/jpg', 'jpg']]) {
    const x = makeEnv(A); const r = await attempt(() => x.api.uploadRoutePhoto(SCH, 7, 'V', mkFile('f.' + ext, type)));
    check(`U2: ${type} se sube como .${ext}`, r.ok && r.value.includes(`.${ext}?alt=media`), r.error && r.error.message);
  }
  let x = makeEnv(A, { prepare: async (f) => Object.assign(new Uint8Array(1000), { name: 'f.jpg', type: 'image/jpeg', size: 1000 }) });
  let r = await attempt(() => x.api.uploadRoutePhoto(SCH, 7, 'V', mkFile('original.png', 'image/png', 3000)));
  check('U2: si la reducción convierte PNG en JPEG, la extensión y el tipo siguen la imagen REAL que se sube', r.ok && /\.jpg\?alt=media$/.test(r.value), r.error && r.error.message);

  // ===== U3. Entradas inválidas: no se crea nada =====
  for (const [label, args] of [['tipo GIF', [SCH, 12, 'V', mkFile('a.gif', 'image/gif')]], ['6 MB', [SCH, 12, 'V', mkFile('a.jpg', 'image/jpeg', 6 * 1024 * 1024)]],
    ['routeId sin definir', [SCH, undefined, 'V', mkFile('a.jpg', 'image/jpeg')]], ['routeId decimal', [SCH, 1.5, 'V', mkFile('a.jpg', 'image/jpeg')]],
    ['routeId texto', [SCH, '12', 'V', mkFile('a.jpg', 'image/jpeg')]], ['escuela con espacios', ['mi escuela', 12, 'V', mkFile('a.jpg', 'image/jpeg')]]]) {
    x = makeEnv(A); r = await attempt(() => x.api.uploadRoutePhoto(...args));
    check(`U3: ${label} se rechaza sin escribir nada`, !r.ok && !x.calls.includes('doc.set') && !x.calls.includes('file.put'), r.ok ? 'se aceptó' : r.error.message);
  }
  x = makeEnv(A, { prepare: async () => mkFile('grande.jpg', 'image/jpeg', 6 * 1024 * 1024) });
  r = await attempt(() => x.api.uploadRoutePhoto(SCH, 12, 'V', mkFile('a.jpg', 'image/jpeg', 100 * 1024)));
  check('U3: si tras reducir sigue pesando más de 5 MB se rechaza SIN crear el documento', !r.ok && !x.calls.includes('doc.set'));
  x = makeEnv(A, { profile: null }); r = await attempt(() => x.api.uploadRoutePhoto(SCH, 12, 'V', mkFile('a.jpg', 'image/jpeg')));
  check('U3: sin sesión se rechaza', !r.ok && !x.calls.includes('doc.set'));

  // ===== U4. Fallos parciales de la subida =====
  let failedId = null;
  x = makeEnv(A, { hooks: { 'doc.set': async (n, real, args) => { failedId = args[0]; return real(); }, 'file.put': async () => { throw netErr('storage/retry-limit-exceeded'); } } });
  r = await attempt(() => x.api.uploadRoutePhoto(SCH, 21, 'V', mkFile('a.jpg', 'image/jpeg')));
  const list4 = (await x.api.getRoutePhotos(SCH, 21));   // sin nombre de vía: la consulta de reserva por nombre devolvería fotos de otras vías con el mismo nombre
  check('U4: el archivo falla siempre → error al usuario, sin foto visible (documento deshecho)', !r.ok && list4.length === 0, r.error && r.error.message);
  check('U4: se intentó 2 veces, se limpió con lote (documento + marca) y no queda pendiente', x.counters['file.put'] === 2 && x.counters['batch.commit'] === 1 && x.pending().length === 0, x.calls.join(' > '));
  check('U4: el id fallido queda marcado (no se puede reutilizar) y no hay archivo ni documento', !!failedId && await L.exists(`route-photo-tombstones/${failedId}`) && !(await docOf(failedId)) && !(await S.present(`route-photos/${SCH}/${A.uid}/${failedId}.jpg`)), failedId);
  // Fallo LENTO (> 90 s tras aceptar el documento): un segundo intento empezaría de cero y no cabría bien en la ventana de 5 min → no se reintenta, se limpia
  const clk = { t: Date.now() }; let slowId = null;
  x = makeEnv(A, { clock: clk, hooks: { 'doc.set': async (n, real, args) => { slowId = args[0]; return real(); }, 'file.put': async () => { clk.t += 100000; throw netErr('storage/retry-limit-exceeded'); } } });
  r = await attempt(() => x.api.uploadRoutePhoto(SCH, 27, 'V', mkFile('a.jpg', 'image/jpeg')));
  check('U4: el archivo falla tras 100 s → NO se reintenta (solo 1 intento), se limpia con marca y no queda nada', !r.ok && x.counters['file.put'] === 1 && x.counters['batch.commit'] === 1 && !(await docOf(slowId)) && await L.exists(`route-photo-tombstones/${slowId}`), x.calls.join(' > '));
  const clk2 = { t: Date.now() };
  x = makeEnv(A, { clock: clk2, hooks: { 'file.put': async (n, real) => { if (n === 1) { clk2.t += 5000; throw netErr('storage/retry-limit-exceeded'); } return real(); } } });
  r = await attempt(() => x.api.uploadRoutePhoto(SCH, 28, 'V', mkFile('a.jpg', 'image/jpeg')));
  check('U4: el archivo falla a los 5 s → SÍ se reintenta y la subida termina bien', r.ok && x.counters['file.put'] === 2, r.error && r.error.message);
  x = makeEnv(A, { hooks: { 'file.put': async (n, real) => { if (n === 1) throw netErr('storage/retry-limit-exceeded'); return real(); } } });
  r = await attempt(() => x.api.uploadRoutePhoto(SCH, 22, 'V', mkFile('a.jpg', 'image/jpeg')));
  let list = await x.api.getRoutePhotos(SCH, 22, 'V');
  check('U4: el archivo falla una vez y el reintento funciona → una sola foto, sin limpieza', r.ok && list.length === 1 && !x.calls.includes('batch.commit') && x.counters['file.put'] === 2, x.calls.join(' > '));
  x = makeEnv(A, { hooks: { 'file.put': async (n, real) => { await real(); throw netErr('unknown'); } } });
  r = await attempt(() => x.api.uploadRoutePhoto(SCH, 23, 'V', mkFile('a.jpg', 'image/jpeg')));
  list = await x.api.getRoutePhotos(SCH, 23, 'V');
  check('U4: el archivo llegó al servidor pero el cliente vio un error → se detecta, NO se repite ni se borra', r.ok && list.length === 1 && x.counters['file.put'] === 1 && !x.calls.includes('batch.commit') && await S.present(`route-photos/${SCH}/${A.uid}/${list[0].id}.jpg`), x.calls.join(' > '));
  x = makeEnv(A, { hooks: { 'doc.set': async (n, real) => { await real(); throw netErr('unavailable'); } } });
  r = await attempt(() => x.api.uploadRoutePhoto(SCH, 24, 'V', mkFile('a.jpg', 'image/jpeg')));
  list = await x.api.getRoutePhotos(SCH, 24, 'V');
  check('U4: el documento se creó pero se perdió la respuesta → el cliente lo reconoce y sigue con el archivo', r.ok && list.length === 1 && x.counters['file.put'] === 1, r.error && r.error.message);
  x = makeEnv(A, { hooks: { 'doc.set': async () => { throw netErr('permission-denied'); } } });
  r = await attempt(() => x.api.uploadRoutePhoto(SCH, 25, 'V', mkFile('a.jpg', 'image/jpeg')));
  check('U4: el documento se rechaza → no se sube ningún archivo y el error es comprensible', !r.ok && !x.calls.includes('file.put') && /permiso denegado|conexi/.test(r.error.message), r.error && r.error.message);
  // El archivo falla Y el borrado del documento también (sin red): queda pendiente y se limpia solo en cuanto hay red
  let offline = true;
  x = makeEnv(A, { hooks: { 'file.put': async () => { throw netErr('storage/retry-limit-exceeded'); }, 'file.delete': async () => { throw netErr('storage/object-not-found'); },
    'batch.commit': async (n, real) => { if (offline) throw netErr('unavailable'); return real(); } } });
  r = await attempt(() => x.api.uploadRoutePhoto(SCH, 26, 'V', mkFile('a.jpg', 'image/jpeg')));
  const pend = x.pending(); const orphanId = pend[0] && pend[0].id;
  check('U4: sin red para limpiar → el documento huérfano queda anotado como pendiente', !r.ok && pend.length === 1 && !!(await docOf(orphanId)), JSON.stringify(pend));
  offline = false;
  const cleaned = await (async () => { await x.api.getRoutePhotos(SCH, 26, 'V'); return poll(async () => !(await docOf(orphanId))); })();
  check('U4: al volver la red, el siguiente acceso limpia el huérfano (documento borrado, marca creada, pendiente vacío)', cleaned && await L.exists(`route-photo-tombstones/${orphanId}`) && x.pending().length === 0, JSON.stringify(x.pending()));

  // ===== U5. Doble pulsación y concurrencia =====
  x = makeEnv(A); const f = mkFile('doble.jpg', 'image/jpeg');
  const dbl = await Promise.allSettled([x.api.uploadRoutePhoto(SCH, 31, 'V', f), x.api.uploadRoutePhoto(SCH, 31, 'V', f)]);
  check('U5: doble pulsación con el mismo archivo → una sola subida (un documento, un archivo)', dbl.every(p => p.status === 'fulfilled') && dbl[0].value === dbl[1].value && x.counters['doc.set'] === 1 && x.counters['file.put'] === 1, x.calls.join(' > '));
  x = makeEnv(A);
  const par = await Promise.allSettled([1, 2, 3, 4, 5].map(i => x.api.uploadRoutePhoto(SCH, 32, 'V', mkFile(`p${i}.jpg`, 'image/jpeg'))));
  list = await x.api.getRoutePhotos(SCH, 32, 'V');
  check('U5: 5 subidas simultáneas de fotos distintas → 5 documentos y 5 archivos', par.every(p => p.status === 'fulfilled') && list.length === 5 && (await Promise.all(list.map(p => S.present(`route-photos/${SCH}/${A.uid}/${p.id}.jpg`)))).every(Boolean), par.filter(p => p.status !== 'fulfilled').map(p => p.reason.message).join('|'));
  const eB = makeEnv(B); const mixed = await Promise.allSettled([makeEnv(A).api.uploadRoutePhoto(SCH, 33, 'V', mkFile('a.jpg', 'image/jpeg')), eB.api.uploadRoutePhoto(SCH, 33, 'V', mkFile('a.jpg', 'image/jpeg'))]);
  list = await eB.api.getRoutePhotos(SCH, 33, 'V');
  check('U5: dos usuarios suben a la vez a la misma vía → dos fotos independientes', mixed.every(p => p.status === 'fulfilled') && list.length === 2 && new Set(list.map(p => p.uploadedBy)).size === 2);

  // ===== D. Borrado =====
  const up = async (user, route = 40) => { const env = makeEnv(user); const url = await env.api.uploadRoutePhoto(SCH, route, 'V', mkFile('x.jpg', 'image/jpeg')); return { id: idOf(url), env, path: `route-photos/${SCH}/${user.uid}/${idOf(url)}.jpg` }; };
  let ph = await up(A);
  x = makeEnv(A); r = await attempt(() => x.api.deleteRoutePhoto(ph.id, A.uid));
  check('D1: el autor borra su foto reciente (archivo y documento)', r.ok && !(await S.present(ph.path)) && !(await docOf(ph.id)), r.error && r.error.message);
  check('D1: orden: primero el archivo, después el lote documento + marca', x.calls.indexOf('file.delete') >= 0 && x.calls.indexOf('file.delete') < x.calls.indexOf('batch.commit'), x.calls.join(' > '));
  check('D1: queda la marca permanente y no hay pendientes', await L.exists(`route-photo-tombstones/${ph.id}`) && x.pending().length === 0);
  await expect('D1: no se puede recrear el mismo id (ampliar el plazo)', A.db.collection('route-photos').doc(ph.id).set({ photoUrl: `https://firebasestorage.googleapis.com/v0/b/${PROD_BUCKET}/o/${encodeURIComponent(ph.path)}?alt=media`,
    uploadedBy: A.uid, uploadedAt: A.FV.serverTimestamp(), routeId: 40, schoolId: SCH, filename: `${ph.id}.jpg`, storagePath: ph.path }), false);

  // Reemplazar una foto = borrarla (archivo, documento y marca) y subir otra con un id NUEVO: el id antiguo queda quemado y no se reutiliza
  const oldPhoto = ph.id;
  const replacement = await up(A);
  check('D1: reemplazar una foto: la nueva tiene un id DISTINTO; el antiguo sigue sin documento ni archivo y con su marca', replacement.id !== oldPhoto && !(await docOf(oldPhoto)) && await L.exists(`route-photo-tombstones/${oldPhoto}`) && !(await S.present(`route-photos/${SCH}/${A.uid}/${oldPhoto}.jpg`)) && !!(await docOf(replacement.id)));

  ph = await up(A);
  x = makeEnv(B); r = await attempt(() => x.api.deleteRoutePhoto(ph.id, A.uid));
  check('D2: otro usuario no puede borrar (el cliente ni lo intenta) y nada cambia', !r.ok && !x.calls.includes('file.delete') && await S.present(ph.path) && !!(await docOf(ph.id)), r.error && r.error.message);
  x = makeEnv(SP); r = await attempt(() => x.api.deleteRoutePhoto(ph.id, A.uid));
  check('D2: un spotter ajeno no tiene privilegios de borrado', !r.ok && await S.present(ph.path));

  ph = await up(A); await backdate(ph.id, 13 * H);
  x = makeEnv(A); r = await attempt(() => x.api.deleteRoutePhoto(ph.id, A.uid));
  check('D3: el autor tras 12 h → mensaje claro y NADA se borra (ni archivo ni documento ni marca)', !r.ok && /12 primeras horas/.test(r.error.message) && await S.present(ph.path) && !!(await docOf(ph.id)) && !(await L.exists(`route-photo-tombstones/${ph.id}`)), r.error && r.error.message);
  check('D3: el fallo del archivo no deja un documento pendiente (el archivo sigue ahí)', x.pending().length === 0 && !x.calls.includes('batch.commit'), x.calls.join(' > '));
  ph = await up(A); await backdate(ph.id, 11 * H + 59 * 60 * 1000);
  r = await attempt(() => makeEnv(A).api.deleteRoutePhoto(ph.id, A.uid));
  check('D3: el autor a 11 h 59 min sí puede', r.ok && !(await S.present(ph.path)) && !(await docOf(ph.id)), r.error && r.error.message);
  ph = await up(SP); await backdate(ph.id, 13 * H);
  r = await attempt(() => makeEnv(SP).api.deleteRoutePhoto(ph.id, SP.uid));
  check('D3: un spotter, autor de su foto, tras 12 h no puede (sin privilegios por rol)', !r.ok && await S.present(ph.path));
  ph = await up(A); await backdate(ph.id, 13 * H);
  r = await attempt(() => makeEnv(AD).api.deleteRoutePhoto(ph.id, A.uid));
  check('D3: el admin borra una foto ajena de 13 h', r.ok && !(await S.present(ph.path)) && !(await docOf(ph.id)) && await L.exists(`route-photo-tombstones/${ph.id}`), r.error && r.error.message);
  ph = await up(A); await backdate(ph.id, 40 * H);
  r = await attempt(() => makeEnv(SA).api.deleteRoutePhoto(ph.id, A.uid));
  check('D3: el super-admin borra una foto ajena de 40 h', r.ok && !(await S.present(ph.path)) && !(await docOf(ph.id)), r.error && r.error.message);

  // Cruce del plazo entre el borrado del archivo y el del documento: el servidor dice «no» → no se anota pendiente (no mejora reintentando)
  ph = await up(A);
  x = makeEnv(A, { hooks: { 'batch.commit': async () => { throw netErr('permission-denied'); }, 'doc.delete': async () => { throw netErr('permission-denied'); } } });
  r = await attempt(() => x.api.deleteRoutePhoto(ph.id, A.uid));
  check('D3: si el servidor rechaza el documento por plazo (tras borrar el archivo) → mensaje claro y SIN entrada pendiente', !r.ok && /12 primeras horas/.test(r.error.message) && x.pending().length === 0, JSON.stringify(x.pending()));
  await S.del('owner', ph.path).catch(() => {}); await L.ownerDelete(`route-photos/${ph.id}`);

  // Fallos parciales del borrado
  ph = await up(A); let down = true;
  x = makeEnv(A, { hooks: { 'batch.commit': async (n, real) => { if (down) throw netErr('unavailable'); return real(); } } });
  r = await attempt(() => x.api.deleteRoutePhoto(ph.id, A.uid));
  check('D4: se borró el archivo y falla el documento → error, documento visible pero anotado como pendiente', !r.ok && !(await S.present(ph.path)) && !!(await docOf(ph.id)) && x.pending().length === 1, r.error && r.error.message);
  down = false; await x.api.getRoutePhotos(SCH, 40, 'V');
  check('D4: al volver la red se completa solo (documento borrado, marca creada, sin pendientes)', await poll(async () => !(await docOf(ph.id))) && await L.exists(`route-photo-tombstones/${ph.id}`) && x.pending().length === 0, JSON.stringify(x.pending()));
  ph = await up(A);
  x = makeEnv(A, { hooks: { 'file.delete': async () => { throw netErr('unavailable'); } } });
  r = await attempt(() => x.api.deleteRoutePhoto(ph.id, A.uid));
  check('D4: falla el borrado del archivo → no se toca el documento (no se crea un archivo huérfano)', !r.ok && !!(await docOf(ph.id)) && await S.present(ph.path) && !x.calls.includes('batch.commit') && x.pending().length === 0, r.error && r.error.message);
  ph = await up(A); await S.del('owner', ph.path);
  r = await attempt(() => makeEnv(A).api.deleteRoutePhoto(ph.id, A.uid));
  check('D4: documento sin archivo (archivo ya inexistente) → se borra el documento', r.ok && !(await docOf(ph.id)), r.error && r.error.message);
  // ===== D5. Documento que existe con el archivo ya inexistente (object-not-found explícito) =====
  const recreate = (u, ph) => u.db.collection('route-photos').doc(ph.id).set({ photoUrl: `https://firebasestorage.googleapis.com/v0/b/${PROD_BUCKET}/o/${encodeURIComponent(ph.path)}?alt=media`,
    uploadedBy: u.uid, uploadedAt: u.FV.serverTimestamp(), routeId: 40, schoolId: SCH, filename: `${ph.id}.jpg`, storagePath: ph.path });
  ph = await up(A); await S.del('owner', ph.path);
  x = makeEnv(AD, { hooks: { 'file.delete': async () => { throw netErr('storage/object-not-found'); } } });
  r = await attempt(() => x.api.deleteRoutePhoto(ph.id, A.uid));
  check('D5 éxito: object-not-found al borrar el archivo → continúa: documento borrado y marca creada en el lote', r.ok && !(await docOf(ph.id)) && await L.exists(`route-photo-tombstones/${ph.id}`) && x.calls.includes('batch.commit') && x.pending().length === 0, r.error && r.error.message);
  check('D5 éxito: no hacía falta consultar metadatos y el id queda protegido', !x.calls.includes('file.getMetadata'));
  await expect('D5 éxito: el id borrado no se puede recrear', recreate(A, ph), false);
  ph = await up(A); await S.del('owner', ph.path);
  x = makeEnv(A, { hooks: { 'file.delete': async () => { throw netErr('storage/unauthorized'); } } });
  r = await attempt(() => x.api.deleteRoutePhoto(ph.id, A.uid));
  check('D5 permisos: «sin permiso» con el archivo YA inexistente (metadatos = object-not-found) → continúa y deja la marca', r.ok && x.calls.includes('file.getMetadata') && !(await docOf(ph.id)) && await L.exists(`route-photo-tombstones/${ph.id}`), r.error && r.error.message);
  ph = await up(A);
  x = makeEnv(A, { hooks: { 'file.delete': async () => { throw netErr('storage/unauthorized'); } } });
  r = await attempt(() => x.api.deleteRoutePhoto(ph.id, A.uid));
  check('D5 permisos: «sin permiso» con el archivo EXISTENTE → no se toca el documento ni se crea marca', !r.ok && !!(await docOf(ph.id)) && await S.present(ph.path) && !x.calls.includes('batch.commit') && !(await L.exists(`route-photo-tombstones/${ph.id}`)) && x.pending().length === 0, r.error && r.error.message);
  ph = await up(A); await S.del('owner', ph.path);
  x = makeEnv(A, { hooks: { 'file.delete': async () => { throw netErr('storage/unauthorized'); }, 'file.getMetadata': async () => { throw netErr('unavailable'); } } });
  r = await attempt(() => x.api.deleteRoutePhoto(ph.id, A.uid));
  check('D5 red: sin poder comprobar si el archivo existe (red caída) → NO asume que no existe: documento y marca intactos', !r.ok && !!(await docOf(ph.id)) && !(await L.exists(`route-photo-tombstones/${ph.id}`)) && !x.calls.includes('batch.commit'), r.error && r.error.message);
  ph = await up(A); await S.del('owner', ph.path); let off = true;
  x = makeEnv(AD, { hooks: { 'file.delete': async () => { throw netErr('storage/object-not-found'); }, 'batch.commit': async (n, real) => { if (off) throw netErr('unavailable'); return real(); } } });
  r = await attempt(() => x.api.deleteRoutePhoto(ph.id, A.uid));
  check('D5 parcial: archivo ausente y red caída en el lote → error, documento y marca JUNTOS intactos (el lote es atómico) y pendiente anotado', !r.ok && !!(await docOf(ph.id)) && !(await L.exists(`route-photo-tombstones/${ph.id}`)) && x.pending().length === 1, JSON.stringify(x.pending()));
  off = false; await x.api.getRoutePhotos(SCH, 40, 'V');
  check('D5 parcial: al volver la red se completa solo: documento borrado + marca + sin pendientes', await poll(async () => !(await docOf(ph.id))) && await L.exists(`route-photo-tombstones/${ph.id}`) && x.pending().length === 0, JSON.stringify(x.pending()));
  await expect('D5 parcial: tras completarse, el id sigue sin poderse reutilizar', recreate(A, ph), false);

  ph = await up(A); const e1 = makeEnv(A), e2 = makeEnv(A);
  const two = await Promise.allSettled([e1.api.deleteRoutePhoto(ph.id, A.uid), e2.api.deleteRoutePhoto(ph.id, A.uid)]);
  check('D4: borrado simultáneo desde dos dispositivos → ambos terminan bien, una sola marca, nada queda', two.every(p => p.status === 'fulfilled' || /not found/i.test(p.reason.message)) && !(await S.present(ph.path)) && !(await docOf(ph.id)), two.map(p => p.status + (p.reason ? ':' + p.reason.message : '')).join(' | '));
  ph = await up(A); await L.ownerDelete(`route-photos/${ph.id}`);
  r = await attempt(() => makeEnv(A).api.deleteRoutePhoto(ph.id, A.uid));
  check('D4: documento ya borrado y archivo huérfano → el cliente responde «Photo not found» y el archivo (solo administración) no se toca', !r.ok && /not found/i.test(r.error.message) && await S.present(ph.path));
  await expect('D4: el autor no puede borrar ese archivo huérfano por su cuenta (sin documento)', A.st.ref().child(ph.path).delete(), false);
  await S.del('owner', ph.path);
  r = await attempt(() => makeEnv(A).api.deleteRoutePhoto('valeria_1_noexiste00000000', A.uid));
  check('D4: borrar una foto inexistente → «Photo not found»', !r.ok && /not found/i.test(r.error.message));

  // ===== L. Fotos antiguas =====
  const lid = `valeria_Via_1764000000000`, lpath = `route-photos/${SCH}/${stamp}_legacy.jpeg`;
  await seed(`route-photos/${lid}`, { photoUrl: 'https://firebasestorage.googleapis.com/v0/b/x/o/y?alt=media&token=t', uploadedBy: A.uid, uploadedByName: 'A', uploadedAt: new Date('2025-12-01T10:00:00Z'), routeName: 'ViaAntigua', schoolId: SCH, filename: `${stamp}_legacy.jpeg` });
  await S.upload('owner', lpath);
  const eL = makeEnv(B);
  list = await eL.api.getRoutePhotos(SCH, 999, 'ViaAntigua');   // routeId sin fotos → consulta de reserva por nombre
  check('L: una foto antigua se lista por nombre de vía (consulta de reserva) con su URL antigua', list.length === 1 && list[0].id === lid && /token=t$/.test(list[0].url), JSON.stringify(list.map(p => p.id)));
  r = await attempt(() => makeEnv(A).api.deleteRoutePhoto(lid, A.uid));
  check('L: el autor de una foto antigua no puede borrarla (mensaje claro) y no se toca nada', !r.ok && /12 primeras horas/.test(r.error.message) && await S.present(lpath) && !!(await docOf(lid)), r.error && r.error.message);
  r = await attempt(() => makeEnv(AD).api.deleteRoutePhoto(lid, A.uid));
  check('L: el admin borra una foto antigua (archivo en la ruta antigua + documento + marca)', r.ok && !(await S.present(lpath)) && !(await docOf(lid)) && await L.exists(`route-photo-tombstones/${lid}`), r.error && r.error.message);
  const nueva = await up(A, 41);
  list = await makeEnv(B).api.getRoutePhotos(SCH, 41, 'V');
  check('L: foto nueva y antigua conviven en la misma consulta de vías', list.length === 1 && list[0].id === nueva.id);

  // ===== P. Transición: el cliente nuevo publicado ANTES de desplegar reglas, contra las reglas ACTUALES de producción (solo emulador) =====
  await L.loadFirestoreRules('current');                                   // firestore.rules desplegado
  await S.loadStorageRules(path.join(ROOT, 'storage.rules.previous'));      // storage desplegado (con comodín)
  x = makeEnv(A);
  r = await attempt(() => x.api.uploadRoutePhoto(SCH, 50, 'V', mkFile('a.jpg', 'image/jpeg')));
  const pid = r.ok ? idOf(r.value) : null;
  check('P: con las reglas actuales la subida del cliente nuevo funciona (documento + archivo)', r.ok && !!(await docOf(pid)) && await S.present(`route-photos/${SCH}/${A.uid}/${pid}.jpg`), r.error && r.error.message);
  list = await x.api.getRoutePhotos(SCH, 50, 'V');
  check('P: con las reglas actuales se listan las fotos', list.length === 1 && list[0].id === pid);
  r = await attempt(() => x.api.deleteRoutePhoto(pid, A.uid));
  check('P: con las reglas actuales el borrado funciona (el lote con marca se rechaza y el borrado simple lo completa)', r.ok && !(await docOf(pid)) && !(await S.present(`route-photos/${SCH}/${A.uid}/${pid}.jpg`)) && x.calls.includes('doc.delete'), r.error && r.error.message + ' | ' + x.calls.join('>'));
  check('P: con las reglas actuales no queda marca (la colección aún no existe en producción) ni pendientes', !(await L.exists(`route-photo-tombstones/${pid}`)) && x.pending().length === 0);

  // ===== P2/P3. Estados intermedios del despliegue con el cliente NUEVO: Storage final + Firestore actual, y Firestore final + Storage anterior =====
  const lifecycle = async (tag, route) => {
    x = makeEnv(A);
    r = await attempt(() => x.api.uploadRoutePhoto(SCH, route, 'V', mkFile('a.jpg', 'image/jpeg')));
    const id = r.ok ? idOf(r.value) : null, fp = id ? `route-photos/${SCH}/${A.uid}/${id}.jpg` : null;
    check(`${tag}: la subida del cliente nuevo funciona (documento + archivo)`, r.ok && !!(await docOf(id)) && await S.present(fp), r.error && r.error.message);
    check(`${tag}: la foto se lista`, (await x.api.getRoutePhotos(SCH, route)).some(p => p.id === id));
    r = await attempt(() => x.api.deleteRoutePhoto(id, A.uid));
    check(`${tag}: el borrado funciona (archivo y documento)`, r.ok && !(await docOf(id)) && !(await S.present(fp)), r.error && r.error.message + ' | ' + x.calls.join('>'));
    return id;
  };
  await L.loadFirestoreRules('current');                                       // Firestore ACTUAL de producción
  await S.loadStorageRules(path.join(ROOT, 'storage.rules'));                  // Storage FINAL
  await lifecycle('P2 (Storage final + Firestore actual)', 51);
  await L.loadFirestoreRules('proposal');                                      // Firestore FINAL (o la variante de solo route-photos)
  await S.loadStorageRules(path.join(ROOT, 'storage.rules.previous'));         // Storage ANTERIOR (con comodín)
  const p3 = await lifecycle('P3 (Firestore final + Storage anterior)', 52);
  check('P3: con el Firestore final el borrado deja su marca permanente', await L.exists(`route-photo-tombstones/${p3}`));

  // ===== W. Ventana de subida: si el archivo llega tarde las reglas lo rechazan y el cliente limpia todo (ventana escalada de 5 min a 3 s) =====
  await L.loadFirestoreRules('proposal');
  const stFull = fs.readFileSync(path.join(ROOT, 'storage.rules'), 'utf8');
  check('W: storage.rules contiene la ventana de subida de 5 min exactamente una vez', stFull.split("duration.value(5, 'm')").length === 2);
  await S.setRules(stFull.split("duration.value(5, 'm')").join("duration.value(3, 's')"));
  let lateId = null;
  x = makeEnv(A, { hooks: { 'doc.set': async (n, real, args) => { lateId = args[0]; return real(); }, 'file.put': async (n, real) => { await S.sleep(4000); return real(); } } });
  r = await attempt(() => x.api.uploadRoutePhoto(SCH, 53, 'V', mkFile('a.jpg', 'image/jpeg')));
  check('W: el archivo llega fuera de la ventana → error de permiso, SIN reintento inútil (1 solo intento)', !r.ok && /permiso denegado/.test(r.error.message) && x.counters['file.put'] === 1, r.error && r.error.message);
  check('W: el cliente limpia: no hay documento, hay marca y no hay archivo', !!lateId && !(await docOf(lateId)) && await L.exists(`route-photo-tombstones/${lateId}`) && !(await S.present(`route-photos/${SCH}/${A.uid}/${lateId}.jpg`)), String(lateId));
  check('W: tras el fallo no quedan pendientes ni fotos visibles', x.pending().length === 0 && (await x.api.getRoutePhotos(SCH, 53)).length === 0);
  x = makeEnv(A, { hooks: { 'file.put': async (n, real) => { await S.sleep(1000); return real(); } } });
  r = await attempt(() => x.api.uploadRoutePhoto(SCH, 54, 'V', mkFile('a.jpg', 'image/jpeg')));
  check('W: el archivo llega dentro de la ventana (1 s de 3 s) → correcto', r.ok && x.counters['file.put'] === 1, r.error && r.error.message);

  // ===== J. Diario de subidas (capa 1): app cerrada a mitad de una subida. Solo se informa; nada se borra solo; el descarte es una llamada explícita =====
  await L.loadFirestoreRules('proposal'); await S.loadStorageRules(path.join(ROOT, 'storage.rules'));
  const store = {}, clockJ = { t: Date.now() };
  let jid = null;
  const crashEnv = makeEnv(A, { store, clock: clockJ, hooks: { 'doc.set': async (n, real, args) => { jid = args[0]; return real(); }, 'file.put': () => new Promise(() => {}) } });   // el archivo no llega nunca: «la app se cierra»
  crashEnv.api.uploadRoutePhoto(SCH, 61, 'V', mkFile('a.jpg', 'image/jpeg')).catch(() => {});
  await poll(async () => !!jid && !!(await docOf(jid)));
  const jpath = `route-photos/${SCH}/${A.uid}/${jid}.jpg`;
  const journal = () => JSON.parse(store['kx-route-photos-upload-journal'] || '[]'), interrupted = () => JSON.parse(store['kx-route-photos-interrupted-uploads'] || '[]');
  check('J1: con la app «cerrada» a mitad de la subida queda el documento (sin archivo) y la anotación en el diario', !!(await docOf(jid)) && !(await S.present(jpath)) && journal().some(e => e.id === jid && e.uid === A.uid && e.path === jpath));
  let next = makeEnv(A, { store, clock: clockJ });
  clockJ.t += 2 * 60000; await next.api.kxRpRetryPending();
  check('J2: a los 2 min (dentro del margen) no se clasifica ni se consulta como interrumpida', journal().length === 1 && interrupted().length === 0);
  clockJ.t += 5 * 60000; await next.api.kxRpRetryPending();
  check('J3: pasados 6 min se detecta como INTERRUMPIDA y se informa (kxRpInterruptedUploads)', interrupted().length === 1 && interrupted()[0].id === jid && next.api.kxRpInterruptedUploads().length === 1, JSON.stringify(interrupted()));
  check('J4: NADA se ha borrado ni escrito: el documento sigue, sin marca y sin archivo, y no hubo escrituras en esta ejecución', !!(await docOf(jid)) && !(await L.exists(`route-photo-tombstones/${jid}`)) && !(await S.present(jpath)) && !['doc.set', 'doc.delete', 'batch.commit', 'file.put', 'file.delete'].some(c => next.calls.includes(c)), next.calls.join('>'));
  clockJ.t += 60000; await next.api.kxRpRetryPending(); await next.api.getRoutePhotos(SCH, 61); await S.sleep(500);   // getRoutePhotos lanza su reconciliación sin esperarla
  check('J5: ni siquiera tras más ejecuciones y consultas se borra nada solo (el documento sigue)', !!(await docOf(jid)) && !(await L.exists(`route-photo-tombstones/${jid}`)));
  const other = makeEnv(B, { store, clock: clockJ });
  await other.api.kxRpRetryPending();
  check('J6: otra cuenta con el mismo almacenamiento ni toca ni ve la subida interrumpida de A', other.api.kxRpInterruptedUploads().length === 0 && !!(await docOf(jid)));
  await S.upload('owner', jpath);   // «el archivo llega por fin»: la subida había terminado
  clockJ.t += 11 * 60000;           // la revalidación de las ya detectadas se espacia 10 min
  for (let k = 0; k < 5 && interrupted().length; k++) { await next.api.kxRpRetryPending(); await S.sleep(300); }
  check('J7: si el archivo aparece, deja de constar como interrumpida y el documento se conserva', interrupted().length === 0 && !!(await docOf(jid)));
  await S.del('owner', jpath);
  await next.api.kxRpRetryPending();   // sin diario: no se vuelve a detectar (la anotación se consumió)
  jid = null;
  const crash2 = makeEnv(A, { store, clock: clockJ, hooks: { 'doc.set': async (n, real, args) => { jid = args[0]; return real(); }, 'file.put': () => new Promise(() => {}) } });
  crash2.api.uploadRoutePhoto(SCH, 62, 'V', mkFile('b.jpg', 'image/jpeg')).catch(() => {});
  await poll(async () => !!jid && !!(await docOf(jid)));
  clockJ.t += 7 * 60000; const n2 = makeEnv(A, { store, clock: clockJ }); await n2.api.kxRpRetryPending();
  r = await attempt(() => n2.api.kxRpDiscardInterruptedUpload(jid));
  check('J8: descarte EXPLÍCITO de la interrumpida: borra el documento con su marca (reglas reales, dentro de las 12 h del autor)', r.ok && r.value === true && !(await docOf(jid)) && await L.exists(`route-photo-tombstones/${jid}`) && n2.api.kxRpInterruptedUploads().length === 0, r.error && r.error.message);
  await expect('J9: el id descartado no se puede reutilizar', A.db.collection('route-photos').doc(jid).set({ photoUrl: 'https://x/y', uploadedBy: A.uid, uploadedAt: A.FV.serverTimestamp(), routeId: 62, schoolId: SCH, filename: `${jid}.jpg`, storagePath: `route-photos/${SCH}/${A.uid}/${jid}.jpg` }), false);
  check('J10: una subida normal deja el diario vacío', await (async () => { const e = makeEnv(A, { store: {} }); await e.api.uploadRoutePhoto(SCH, 63, 'V', mkFile('c.jpg', 'image/jpeg')); return JSON.parse(e.store['kx-route-photos-upload-journal'] || '[]').length === 0; })());

  L.finish('route-photos-client.cjs');
  process.exit(process.exitCode || 0);
})().catch(e => { console.error('ERROR FATAL', String(e.stack || e.message).slice(0, 700), '\nÚltima prueba registrada:', L.results.length ? L.results[L.results.length - 1].label : '(ninguna)'); process.exit(2); });

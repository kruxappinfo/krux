// Fase 0b — fotos de vía (Firestore): vinculación documento ↔ archivo, autoría, plazo de 12 h y hueco «borrar y recrear».
// MODE=proposal carga firestore.rules.phase0b.proposal. Las escrituras reproducen lo que haría el cliente NUEVO de route-photos.js
// (id {escuela}_{vía}_{ms}_{aleatorio}, archivo {id}.jpg en route-photos/{escuela}/{uid}/).
const L = require('./_lib.cjs');
const { mk, mkAnon, seed, exists, ownerData, expect, check, knownDefect, SUPER_EMAIL } = L;

(async () => {
  await L.loadFirestoreRules();
  const stamp = Date.now();
  const A = await mk('ba' + stamp, `ba${stamp}@test.dev`);
  const B = await mk('bb' + stamp, `bb${stamp}@test.dev`);
  const SP = await mk('bsp' + stamp, `bsp${stamp}@test.dev`);
  const AD = await mk('bad' + stamp, `bad${stamp}@test.dev`);
  const SA = await mk('bsa' + stamp, SUPER_EMAIL);
  const anon = await mkAnon('ban' + stamp);
  await seed(`admins/${SP.uid}`, { role: 'spotter' });
  await seed(`admins/${AD.uid}`, { role: 'admin' });
  const FV = A.FV;
  const school = 'valeria', route = 12;
  const BASE = 'https://firebasestorage.googleapis.com/v0/b/climbmaps-80cae.firebasestorage.app/o/';
  let n = 0;
  const rnd = () => (n++ + 'abcdefghijklmnopqrstuvwxyz'.repeat(3)).replace(/[^a-z0-9]/g, '').slice(-6).padStart(6, 'a');
  // Foto válida del usuario u; `at` = instante embebido en el id (por defecto, ahora)
  const mkPhoto = (u, over = {}, at = Date.now()) => {
    const r = rnd();
    const id = `${school}_${route}_${at}_${r}`;
    const filename = `${id}.jpg`;
    const storagePath = `route-photos/${school}/${u.uid}/${filename}`;
    return { id, data: Object.assign({ photoUrl: `${BASE}${storagePath.replace(/\//g, '%2F')}?alt=media&token=abc-123`, uploadedBy: u.uid, uploadedByName: 'T',
      uploadedAt: FV.serverTimestamp(), routeId: route, routeName: 'Via', schoolId: school, filename, storagePath }, over) };
  };
  const ref = (u, id) => u.db.collection('route-photos').doc(id);
  const put = (u, p) => ref(u, p.id).set(p.data);

  // ---------- creación válida ----------
  let p = mkPhoto(A);
  await expect('crear: foto con id, archivo y URL coherentes', put(A, p), true);
  p = mkPhoto(B); await expect('crear: usuario sin rol', put(B, p), true);
  p = mkPhoto(SP); await expect('crear: spotter (no hace falta rol)', put(SP, p), true);
  p = mkPhoto(A); p.data.photoUrl = p.data.photoUrl.replace('firebasestorage.app', 'appspot.com');
  await expect('crear: bucket con dominio appspot.com', put(A, p), true);
  p = mkPhoto(A); await expect('crear: sin autenticar', anon.db.collection('route-photos').doc(p.id).set(p.data), false);

  // ---------- autoría, vinculación y apuntar a archivos ajenos ----------
  p = mkPhoto(A, { uploadedBy: B.uid }); await expect('autoría: A crea con uploadedBy de B', put(A, p), false);
  const pB = mkPhoto(B);
  p = mkPhoto(A); p.data.photoUrl = pB.data.photoUrl;
  await expect('vinculación: el documento de A apunta (photoUrl) a la foto de B', put(A, p), false);
  p = mkPhoto(A); p.data.storagePath = pB.data.storagePath;
  await expect('vinculación: storagePath de B en un documento de A', put(A, p), false);
  p = mkPhoto(A); p.data.photoUrl = 'https://evil.example/x.jpg';
  await expect('vinculación: photoUrl externa', put(A, p), false);
  p = mkPhoto(A); p.data.photoUrl = p.data.photoUrl.replace('climbmaps-80cae', 'otro-proyecto');
  await expect('vinculación: photoUrl de otro bucket', put(A, p), false);
  p = mkPhoto(A); p.data.photoUrl = `${BASE}route-photos%2Fvaleria%2F${A.uid}%2Fotro.jpg?alt=media&token=t`;
  await expect('vinculación: photoUrl de un archivo propio distinto al storagePath', put(A, p), false);
  p = mkPhoto(A); p.data.filename = 'otro.jpg';
  await expect('vinculación: filename distinto del id', put(A, p), false);
  p = mkPhoto(A); p.data.storagePath = `route-photos/${school}/${A.uid}/otro.jpg`;
  await expect('vinculación: storagePath no coincide con el filename', put(A, p), false);
  p = mkPhoto(A); p.data.storagePath = `route-photos/${school}/${p.data.filename}`;
  await expect('vinculación: ruta antigua sin uid', put(A, p), false);
  p = mkPhoto(A, { schoolId: 'valeria/../x' }); await expect('vinculación: schoolId con barras', put(A, p), false);
  p = mkPhoto(A, { routeId: 99 }); await expect('vinculación: routeId que no es el del id', put(A, p), false);
  p = mkPhoto(A, { routeId: '12' }); await expect('vinculación: routeId como cadena', put(A, p), false);
  p = mkPhoto(A); const bad = Object.assign({}, p, { id: `${school}_${route}_${Date.now()}_ab` });
  await expect('id: sufijo aleatorio demasiado corto', ref(A, bad.id).set(p.data), false);
  p = mkPhoto(A); await expect('id: no coincide con el formato (sin marca de tiempo)', ref(A, `cualquiera_${rnd()}`).set(p.data), false);
  p = mkPhoto(A, {}, Date.now() - 11 * 60 * 1000); await expect('id: marca de tiempo 11 min en el pasado (recrear un id antiguo)', put(A, p), false);
  p = mkPhoto(A, {}, Date.now() + 11 * 60 * 1000); await expect('id: marca de tiempo 11 min en el futuro', put(A, p), false);
  p = mkPhoto(A, {}, Date.now() - 5 * 60 * 1000); await expect('id: marca de tiempo 5 min en el pasado (tolerancia a un reloj de móvil desajustado)', put(A, p), true);

  // ---------- fecha de subida ----------
  p = mkPhoto(A, { uploadedAt: new Date(Date.now() - 5000) }); await expect('fecha: uploadedAt del cliente', put(A, p), false);
  p = mkPhoto(A, { uploadedAt: new Date(Date.now() - 3600000) }); await expect('fecha: uploadedAt de hace 1 h (recuperar plazo)', put(A, p), false);
  p = mkPhoto(A); delete p.data.uploadedAt; await expect('fecha: sin uploadedAt', put(A, p), false);
  p = mkPhoto(A, { extra: 1 }); await expect('campos: campo arbitrario', put(A, p), false);
  p = mkPhoto(A); delete p.data.storagePath; await expect('campos: sin storagePath (forma del cliente actual)', put(A, p), false, 'el cliente actual no escribe storagePath');

  // ---------- inmutabilidad ----------
  const ok = mkPhoto(A); await put(A, ok);
  await expect('inmutable: autor modifica uploadedAt', ref(A, ok.id).update({ uploadedAt: FV.serverTimestamp() }), false);
  await expect('inmutable: autor modifica uploadedBy', ref(A, ok.id).update({ uploadedBy: B.uid }), false);
  await expect('inmutable: autor modifica storagePath', ref(A, ok.id).update({ storagePath: `route-photos/${school}/${A.uid}/x.jpg` }), false);
  await expect('inmutable: autor modifica photoUrl', ref(A, ok.id).update({ photoUrl: pB.data.photoUrl }), false);
  await expect('inmutable: admin modifica la foto', ref(AD, ok.id).update({ routeName: 'x' }), false);
  await expect('inmutable: set() de reemplazo del mismo documento', ref(A, ok.id).set(ok.data), false);

  // ---------- borrado: plazo de 12 h y roles ----------
  const aged = async (tag, ageSec, u = A) => {                 // documento sembrado con antigüedad ageSec; el id lleva ese mismo instante
    const at = Date.now() - ageSec * 1000;
    const q = mkPhoto(u, {}, at);
    await seed(`route-photos/${q.id}`, Object.assign({}, q.data, { uploadedAt: new Date(at) }));
    return q.id;
  };
  const H = 3600;
  await expect('borrado: autor a 1 min', ref(A, await aged('a', 60)).delete(), true);
  await expect('borrado: autor a 11 h 59 min 40 s', ref(A, await aged('b', 12 * H - 20)).delete(), true);
  await expect('borrado: autor a 12 h 00 min 20 s', ref(A, await aged('c', 12 * H + 20)).delete(), false);
  await expect('borrado: autor a 30 días', ref(A, await aged('d', 30 * 24 * H)).delete(), false);
  check('instante exacto de las 12 h: NO ejecutable (request.time no se puede fijar)', true, 'la regla usa «<» estricto');
  await expect('borrado: admin a 1 min', ref(AD, await aged('e', 60)).delete(), true);
  await expect('borrado: admin a 13 h', ref(AD, await aged('f', 13 * H)).delete(), true);
  await expect('borrado: super-admin a 13 h', ref(SA, await aged('g', 13 * H)).delete(), true);
  await expect('borrado: super-admin a 1 min', ref(SA, await aged('g2', 60)).delete(), true);
  const sp1 = await aged('h', 60), sp2 = await aged('i', 13 * H);
  await expect('borrado: spotter, foto ajena reciente', ref(SP, sp1).delete(), false);
  await expect('borrado: spotter, foto ajena antigua', ref(SP, sp2).delete(), false);
  await expect('borrado: usuario normal, foto ajena reciente', ref(B, sp1).delete(), false);
  await expect('borrado: sin autenticar', anon.db.collection('route-photos').doc(sp1).delete(), false);
  check('las fotos ajenas siguen existiendo', (await exists(`route-photos/${sp1}`)) && (await exists(`route-photos/${sp2}`)));
  await expect('borrado: el spotter borra SU PROPIA foto reciente (como autor)', ref(SP, await aged('j', 60, SP)).delete(), true);
  await expect('borrado: el spotter NO borra su propia foto pasadas 12 h (sin privilegios de rol)', ref(SP, await aged('k', 13 * H, SP)).delete(), false);

  // ---------- hueco «borrar y recrear el documento» para reiniciar el plazo ----------
  // Secuencia de un autor malintencionado: la foto tiene 11 h 59 min 30 s; la borra y la vuelve a crear con el MISMO id para
  // que uploadedAt valga «ahora» y poder borrarla otras 12 h. En las reglas 0 el id era libre: funcionaba. En las 0b el id lleva su instante.
  const atOld = Date.now() - (12 * H - 30) * 1000;
  const loop = mkPhoto(A, {}, atOld);
  await seed(`route-photos/${loop.id}`, Object.assign({}, loop.data, { uploadedAt: new Date(atOld) }));
  await expect('hueco: el autor borra su documento dentro del plazo', ref(A, loop.id).delete(), true);
  await expect('hueco: el autor RECREA el mismo id para reiniciar el plazo', put(A, loop), false,
    'id con marca de tiempo de hace ~12 h: la regla exige ±10 min de la hora del servidor');
  const loop2 = mkPhoto(A, {}, Date.now() - 9 * 60 * 1000);
  await seed(`route-photos/${loop2.id}`, Object.assign({}, loop2.data, { uploadedAt: new Date(Date.now() - 9 * 60 * 1000) }));
  await ref(A, loop2.id).delete();
  await expect('hueco: recrear dentro de la tolerancia (9 min) SÍ es posible', put(A, loop2), true);
  const re = await ownerData(`route-photos/${loop2.id}`);
  check('hueco: la ampliación máxima del plazo queda acotada a la tolerancia (≤ 10 min)', Date.now() - Date.parse(re.uploadedAt) < 60 * 1000 && (Date.parse(re.uploadedAt) - (Date.now() - 9 * 60 * 1000)) < 10 * 60 * 1000 + 5000,
    'por eso el plazo efectivo del autor es de 12 h + hasta 10 min sobre la hora del id');

  // ---------- fotos antiguas (formato real de producción, con datos SINTÉTICOS: sin storagePath, id {escuela}_{nombre}_{ms}, la mayoría sin routeId) ----------
  const legacy = [
    ['valeria_Demo_1_1700000000001', { photoUrl: `${BASE}route-photos%2Fvaleria%2F1700000000001_Demo_1.jpeg?alt=media&token=t`, uploadedBy: A.uid, uploadedByName: 'x', uploadedAt: new Date('2025-11-30T13:08:00Z'), routeName: 'Demo 1', schoolId: 'valeria', filename: '1700000000001_Demo_1.jpeg' }],
    ['valeria_12_1700000000002', { photoUrl: `${BASE}route-photos%2Fvaleria%2F1700000000002_demo_2.jpeg?alt=media&token=t`, uploadedBy: A.uid, uploadedAt: new Date('2025-12-05T22:37:00Z'), routeId: 12, routeName: 'demo 2', schoolId: 'valeria', filename: '1700000000002_demo_2.jpeg' }]];
  for (const [id, d] of legacy) {
    await seed(`route-photos/${id}`, d);
    await expect(`antigua ${id}: lectura pública`, anon.db.collection('route-photos').doc(id).get(), true);
    await expect(`antigua ${id}: su autor NO puede borrarla (el plazo venció hace meses)`, ref(A, id).delete(), false);
    await expect(`antigua ${id}: otro usuario no puede borrarla`, ref(B, id).delete(), false);
    await expect(`antigua ${id}: el spotter no puede borrarla`, ref(SP, id).delete(), false);
  }
  await expect('antigua: consulta por schoolId y routeId (getRoutePhotos)', anon.db.collection('route-photos').where('schoolId', '==', 'valeria').where('routeId', '==', 12).get(), true);
  await expect('antigua: consulta de reserva por routeName (getRoutePhotos)', anon.db.collection('route-photos').where('schoolId', '==', 'valeria').where('routeName', '==', 'Demo 1').get(), true);
  await expect('antigua: el admin la modera (borra)', ref(AD, legacy[0][0]).delete(), true);
  await expect('antigua: el super-admin la modera (borra)', ref(SA, legacy[1][0]).delete(), true);

  L.finish('route-photos-binding-rules.cjs');
  process.exit(process.exitCode || 0);
})().catch(e => { console.error('ERROR FATAL', String(e.message).slice(0, 300), '\nÚltima prueba registrada:', L.results.length ? L.results[L.results.length - 1].label : '(ninguna)'); process.exit(2); });

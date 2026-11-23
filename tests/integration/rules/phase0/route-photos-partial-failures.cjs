// Fase 0b — fallos parciales entre Firestore (documento) y Storage (archivo) de las fotos de vía, con las dos propuestas cargadas.
// Cada escenario deja un estado conocido y comprueba quién puede reparar qué. El orden recomendado del cliente es: ARCHIVO primero, DOCUMENTO después.
const path = require('node:path');
const L = require('./_lib.cjs');
const S = require('./_storage.cjs');
const { mkPhoto } = require('./_photos.cjs');
const { mk, mkAnon, seed, exists, expect, check, SUPER_EMAIL } = L;
(async () => {
  await L.loadFirestoreRules('proposal');
  await S.loadStorageRules(path.join(L.ROOT, 'docs/security-phase0/storage.rules.phase0b.proposal'));
  const stamp = Date.now();
  const A = await mk('fa' + stamp, `fa${stamp}@test.dev`), B = await mk('fb' + stamp, `fb${stamp}@test.dev`), AD = await mk('fad' + stamp, `fad${stamp}@test.dev`);
  const anon = await mkAnon('fan' + stamp);
  await seed(`admins/${AD.uid}`, { role: 'admin' });
  const tA = await A.token(), tAD = await AD.token(), tB = await B.token();
  const FV = A.FV;
  const doc = (u, id) => u.db.collection('route-photos').doc(id);
  const mkDoc = async (u, over, at) => { const p = mkPhoto(u, FV, over, at); await doc(u, p.id).set(p.data); return p; };
  const seedAged = async (u, ageSec) => { const at = Date.now() - ageSec * 1000; const p = mkPhoto(u, FV, {}, at); await seed(`route-photos/${p.id}`, Object.assign({}, p.data, { uploadedAt: new Date(at) })); return p; };
  const notFound = (promise) => promise.then(() => false, (e) => /404/.test(e.message));

  // F1. El documento se crea y la subida falla (p. ej. tipo no permitido o sin red): queda un documento «fantasma»
  let p = await mkDoc(A);
  await expect('F1 la subida falla (tipo no permitido)', S.upload(tA, p.storagePath, 'text/html'), false);
  check('F1 el documento fantasma es visible públicamente (no queda oculto)', await doc(anon, p.id).get().then(d => d.exists, () => false));
  check('F1 no existe archivo', !(await S.present(p.storagePath)));
  await expect('F1 limpieza: el cliente borra el documento fantasma (autor, dentro de 12 h)', doc(A, p.id).delete(), true);

  // F2. Se borra el archivo y falla el borrado del documento por cruzar el plazo entre los dos pasos
  p = await seedAged(A, 12 * 3600 - 8);                       // 11 h 59 min 52 s
  await S.upload('owner', p.storagePath);
  await expect('F2 paso 1: el autor borra el archivo (quedan 8 s)', S.del(tA, p.storagePath), true);
  await S.sleep(9500);
  await expect('F2 paso 2: el borrado del documento llega tarde y se deniega', doc(A, p.id).delete(), false);
  check('F2 queda un documento fantasma (sin archivo), visible y no oculto', await exists(`route-photos/${p.id}`) && !(await S.present(p.storagePath)));
  await expect('F2 reparación: el admin borra el documento fantasma', doc(AD, p.id).delete(), true);

  // F3. Orden inverso (no recomendado): documento primero y luego archivo
  p = await seedAged(A, 12 * 3600 - 8);
  await S.upload('owner', p.storagePath);
  await expect('F3 paso 1: el autor borra el documento (quedan 8 s)', doc(A, p.id).delete(), true);
  await S.sleep(9500);
  await expect('F3 paso 2: sin documento, el autor aún puede borrar el archivo mientras dure timeCreated (archivo reciente en la prueba)', S.del(tA, p.storagePath), true);
  check('F3 no queda huérfano en este caso', !(await S.present(p.storagePath)));

  // F4. Reintentos: el archivo ya no existe. Para el AUTOR la regla de borrado evalúa resource.timeCreated y, sin objeto, falla: el emulador
  // responde 403 (permiso), no 404; el admin recibe 404. El cliente no debe interpretar ese 403 como «no puedo borrar»: debe comprobar la
  // existencia con una lectura (pública) y, si el archivo no existe, continuar con el borrado del documento.
  await expect('F4 el autor reintenta borrar un archivo inexistente: el emulador responde «permiso» (403), no 404', S.del(tA, p.storagePath), false);
  check('F4 el admin recibe 404 (no encontrado) al borrar un archivo inexistente', await notFound(S.del(tAD, p.storagePath)));
  check('F4 la comprobación de existencia con lectura pública devuelve 404 (el cliente puede decidir con ella)', await notFound(S.read(null, p.storagePath)));

  // F5. Reintento de subida tras un fallo, con el documento aún reciente
  p = await seedAged(A, 14 * 60);                              // documento de hace 14 min
  await expect('F5 reintento de subida con el documento de hace 14 min', S.upload(tA, p.storagePath), true);
  p = await seedAged(A, 16 * 60);
  await expect('F5 reintento de subida con el documento de hace 16 min (hay que crear un documento nuevo)', S.upload(tA, p.storagePath), false);

  // F6. Un usuario no puede completar el documento de otro ni repararlo
  p = await mkDoc(A);
  await expect('F6 B sube el archivo del documento de A', S.upload(tB, p.storagePath), false);
  await expect('F6 B borra el documento fantasma de A', doc(B, p.id).delete(), false);
  await expect('F6 el admin borra el documento fantasma de A', doc(AD, p.id).delete(), true);

  // F7. Inventario de huérfanos que el admin puede hacer (solo lectura): documentos sin archivo
  const qs = await doc(AD, 'x').parent.where('schoolId', '==', 'valeria').get();
  check('F7 el admin puede listar los documentos de route-photos para compararlos con el listado de Storage', qs.size >= 0);
  L.finish('route-photos-partial-failures.cjs');
  process.exit(process.exitCode || 0);
})().catch(e => { console.error('ERROR FATAL', String(e.message).slice(0, 300), '\nÚltima prueba registrada:', L.results.length ? L.results[L.results.length - 1].label : '(ninguna)'); process.exit(2); });

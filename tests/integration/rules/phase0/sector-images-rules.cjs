// Fase 0 — fotografías de sector (sector_images). NO se cambian sus reglas en esta fase: estas pruebas fijan el comportamiento
// ACTUAL (para detectar regresiones) y reproducen la pérdida de fotos por escrituras concurrentes del array images[].
// Las operaciones reproducen sector-images.js: leer el documento, modificar el array completo y escribirlo de vuelta.
const L = require('./_lib.cjs');
const P = require('../../../../docs/security-phase0/sector-images-fixes.proposal.cjs');
const { mk, mkAnon, seed, ownerData, expect, check, knownDefect, SUPER_EMAIL } = L;

(async () => {
  await L.loadFirestoreRules();
  const stamp = Date.now();
  const U = await mk('xu' + stamp, `xu${stamp}@test.dev`);     // usuario normal
  const SP1 = await mk('xs1' + stamp, `xs1${stamp}@test.dev`); // spotter 1
  const SP2 = await mk('xs2' + stamp, `xs2${stamp}@test.dev`); // spotter 2
  const AD = await mk('xad' + stamp, `xad${stamp}@test.dev`);
  const SA = await mk('xsa' + stamp, SUPER_EMAIL);
  const anon = await mkAnon('xan' + stamp);
  await seed(`admins/${SP1.uid}`, { role: 'spotter' });
  await seed(`admins/${SP2.uid}`, { role: 'spotter' });
  await seed(`admins/${AD.uid}`, { role: 'admin' });
  const FV = U.FV;
  const school = `sch${stamp}`;
  const img = (id, by, order) => ({ id, url: `https://x/${id}.jpg`, storagePath: `sector-images/${school}/s/${id}.jpg`, order, uploadedAt: new Date().toISOString(), uploadedBy: by });
  const ref = (u, d) => u.db.collection('sector_images').doc(d);

  // ---------- permisos actuales (documentados, sin cambios) ----------
  const d1 = `${school}_a`;
  await expect('usuario normal NO puede crear una galería', ref(U, d1).set({ schoolId: school, images: [img('i1', U.uid, 0)] }), false);
  await expect('sin autenticar NO puede crear una galería', ref(anon, d1).set({ schoolId: school, images: [] }), false);
  await expect('spotter crea una galería', ref(SP1, d1).set({ schoolId: school, sectorName: 'A', normalizedName: 'a', images: [img('i1', SP1.uid, 0), img('i2', SP2.uid, 1)], updatedAt: FV.serverTimestamp() }), true);
  await expect('usuario normal NO puede modificar el array', ref(U, d1).update({ images: [] }), false);
  await expect('usuario normal NO puede borrar la galería', ref(U, d1).delete(), false);
  await expect('sin autenticar NO puede modificar', ref(anon, d1).update({ images: [] }), false);
  await expect('lectura pública', ref(anon, d1).get(), true);
  await expect('admin añade una foto', ref(AD, d1).update({ images: [img('i1', SP1.uid, 0), img('i2', SP2.uid, 1), img('i3', AD.uid, 2)] }), true);
  await expect('super-admin modifica', ref(SA, d1).update({ updatedAt: FV.serverTimestamp() }), true);
  // Limitación conocida: las reglas no distinguen autores dentro del array (todo el array es un único documento)
  await expect('[comportamiento actual] un spotter puede quitar la foto de OTRO spotter (limitación de diseño, no se cambia en esta fase)',
    ref(SP1, d1).update({ images: [img('i1', SP1.uid, 0), img('i3', AD.uid, 1)] }), true,
    'las reglas no pueden saber de quién es cada elemento del array; exigiría una foto por documento (futuro)');
  await expect('[comportamiento actual] un spotter puede reordenar fotos ajenas', ref(SP2, d1).update({ images: [img('i3', AD.uid, 0), img('i1', SP1.uid, 1)] }), true);

  // ---------- trazados (sector_route_drawings): permisos actuales ----------
  const dr = `${school}_a`;
  await expect('spotter crea un documento de trazados', SP1.db.collection('sector_route_drawings').doc(dr).set({ schoolId: school, drawings: [{ routeName: 'V1', imageId: 'i1' }] }), true);
  await expect('usuario normal no escribe trazados', U.db.collection('sector_route_drawings').doc(dr).update({ drawings: [] }), false);
  await expect('el spotter NO puede borrar el documento de trazados', SP1.db.collection('sector_route_drawings').doc(dr).delete(), false);
  await expect('el admin NO puede borrar el documento de trazados', AD.db.collection('sector_route_drawings').doc(dr).delete(), false);
  check('el documento de trazados sigue existiendo', (await ownerData(`sector_route_drawings/${dr}`)) !== null);

  // ---------- concurrencia: código ACTUAL (leer, modificar el array entero, escribir) ----------
  const c1 = `${school}_conc1`;
  await seed(`sector_images/${c1}`, { schoolId: school, images: [img('base', AD.uid, 0)] });
  const rmw = async (u, newImg) => {            // lo que hace uploadSectorImages: get() y luego update({images: [...images, nuevas]})
    const doc = await ref(u, c1).get();
    const images = doc.data().images;
    await new Promise(r => setTimeout(r, 150));  // la subida a Storage tarda: las dos escrituras se solapan
    await ref(u, c1).update({ images: [...images, newImg], updatedAt: FV.serverTimestamp() });
  };
  await Promise.all([rmw(SP1, img('nuevaS1', SP1.uid, 1)), rmw(SP2, img('nuevaS2', SP2.uid, 1))]);
  const afterRmw = (await ownerData(`sector_images/${c1}`)).images.map(i => i.id);
  knownDefect('dos spotters suben a la vez con el código actual (leer-modificar-escribir): se pierde una foto', afterRmw.length === 2,
    `quedan ${afterRmw.length} de 3 fotos esperadas: ${JSON.stringify(afterRmw)}`);

  // ---------- concurrencia: propuesta con transacción ----------
  const c2 = `${school}_conc2`;
  await seed(`sector_images/${c2}`, { schoolId: school, images: [img('base', AD.uid, 0)] });
  await Promise.all([
    P.kxAddGalleryImagesTx(SP1.db, FV, c2, { schoolId: school }, [img('nuevaS1', SP1.uid, 0)]),
    P.kxAddGalleryImagesTx(SP2.db, FV, c2, { schoolId: school }, [img('nuevaS2', SP2.uid, 0)]),
    P.kxAddGalleryImagesTx(AD.db, FV, c2, { schoolId: school }, [img('nuevaAD', AD.uid, 0)])
  ]);
  const afterTx = (await ownerData(`sector_images/${c2}`)).images;
  check('propuesta (transacción): tres subidas simultáneas conservan todas las fotos', afterTx.length === 4 && ['base', 'nuevaS1', 'nuevaS2', 'nuevaAD'].every(id => afterTx.some(i => i.id === id)),
    JSON.stringify(afterTx.map(i => i.id)));
  check('propuesta (transacción): el campo order queda correlativo', afterTx.map(i => i.order).join() === '0,1,2,3');
  // Primera subida a un sector sin galería, también en paralelo
  const c3 = `${school}_conc3`;
  await Promise.all([
    P.kxAddGalleryImagesTx(SP1.db, FV, c3, { schoolId: school, sectorName: 'C' }, [img('p1', SP1.uid, 0)]),
    P.kxAddGalleryImagesTx(SP2.db, FV, c3, { schoolId: school, sectorName: 'C' }, [img('p2', SP2.uid, 0)])
  ]);
  check('propuesta (transacción): dos primeras subidas simultáneas a un sector nuevo conservan ambas', (await ownerData(`sector_images/${c3}`)).images.length === 2);
  // Borrados concurrentes de fotos distintas
  const c4 = `${school}_conc4`;
  await seed(`sector_images/${c4}`, { schoolId: school, images: [img('a', AD.uid, 0), img('b', AD.uid, 1), img('c', AD.uid, 2), img('d', AD.uid, 3)] });
  await Promise.all([P.kxRemoveGalleryImageTx(SP1.db, FV, c4, 'a'), P.kxRemoveGalleryImageTx(SP2.db, FV, c4, 'c')]);
  const rest = (await ownerData(`sector_images/${c4}`)).images.map(i => i.id);
  check('propuesta (transacción): dos borrados simultáneos de fotos distintas quitan solo esas dos', rest.join() === 'b,d', JSON.stringify(rest));
  // Autorización de la propuesta: un usuario sin rol no puede usarla
  await expect('propuesta: usuario normal no puede ejecutar la transacción de añadir', P.kxAddGalleryImagesTx(U.db, FV, `${school}_conc5`, { schoolId: school }, [img('z', U.uid, 0)]), false);
  await expect('propuesta: usuario normal no puede ejecutar la transacción de quitar', P.kxRemoveGalleryImageTx(U.db, FV, c4, 'b'), false);
  check('propuesta: tras los intentos denegados el array no cambia', (await ownerData(`sector_images/${c4}`)).images.length === 2);

  L.finish('sector-images-rules.cjs');
  process.exit(process.exitCode || 0);
})().catch(e => { console.error('ERROR FATAL', String(e.message).slice(0, 300), '\nÚltima prueba registrada:', L.results.length ? L.results[L.results.length - 1].label : '(ninguna)'); process.exit(2); });

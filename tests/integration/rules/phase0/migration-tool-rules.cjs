// Fase 0 — migrate-route-ids.html contra las reglas propuestas. NO ejecuta la herramienta: reproduce, en el emulador, el MISMO
// patrón de escritura que hacen migrateVotes (aleje_votes y estado_votes) y migrateRoutePhotos, con un usuario administrador
// y con el super-admin, para saber si seguiría pudiendo escribir. No se añade ninguna excepción a las reglas.
// Resultado esperado con la política: DENEGADO (la herramienta no podría ejecutarse tras desplegar las reglas).
const L = require('./_lib.cjs');
const { mk, seed, expect, check, SUPER_EMAIL } = L;
(async () => {
  await L.loadFirestoreRules();
  const stamp = Date.now();
  const AD = await mk('mad' + stamp, `mad${stamp}@test.dev`);
  const SA = await mk('msa' + stamp, SUPER_EMAIL);
  const U1 = await mk('mu1' + stamp, `mu1${stamp}@test.dev`), U2 = await mk('mu2' + stamp, `mu2${stamp}@test.dev`);
  await seed(`admins/${AD.uid}`, { role: 'admin' });
  const school = `s${stamp}`;
  for (const [col, who] of [['aleje_votes', AD], ['estado_votes', SA]]) {
    // Documento con clave antigua {schoolId}_{nombreDeVía} y votos de varias personas
    const oldId = `${school}_Via Antigua`;
    await seed(`${col}/${oldId}`, { votes: { [U1.uid]: 3, [U2.uid]: 4 }, updatedAt: new Date() });
    const data = (await who.db.collection(col).doc(oldId).get()).data();
    // migrateVotes, rama «el documento nuevo no existe»: set({...data, routeId, routeName, migratedFrom})
    await expect(`${col}: migrateVotes crea el documento nuevo copiando todos los votos`, who.db.collection(col).doc(`${school}_77`).set({ ...data, routeId: 77, routeName: 'Via Antigua', migratedFrom: oldId }), false,
      'copia los votos de otras personas y añade routeName/migratedFrom');
    // migrateVotes, rama «ya existe»: set({votes: mergedVotes, routeId, routeName, migratedFrom}, {merge:true})
    await seed(`${col}/${school}_78`, { schoolId: school, routeId: 78, votes: { [U1.uid]: 5 }, updatedAt: new Date() });
    await expect(`${col}: migrateVotes fusiona votos de otras personas en el documento existente`, who.db.collection(col).doc(`${school}_78`).set({ votes: { [U2.uid]: 4, [U1.uid]: 5 }, routeId: 78, routeName: 'Via Antigua', migratedFrom: oldId }, { merge: true }), false);
  }
  // migrateRoutePhotos: añade routeId a fotos antiguas (update sobre route-photos)
  await seed(`route-photos/${school}_old`, { photoUrl: 'https://x', uploadedBy: U1.uid, routeName: 'Via Antigua', schoolId: school });
  await expect('route-photos: migrateRoutePhotos añade routeId a una foto antigua (admin)', AD.db.collection('route-photos').doc(`${school}_old`).update({ routeId: 77 }), false);
  await expect('route-photos: migrateRoutePhotos añade routeId a una foto antigua (super-admin)', SA.db.collection('route-photos').doc(`${school}_old`).update({ routeId: 77 }), false);
  check('migrate-route-ids.html no es alcanzable desde la app (sin enlaces ni copia a www/)',
    require('node:fs').readdirSync(L.ROOT + '/www').indexOf('migrate-route-ids.html') === -1, 'build-www.sh solo copia index, offline y admin-users; se abre a mano');
  L.finish('migration-tool-rules.cjs');
  process.exit(process.exitCode || 0);
})().catch(e => { console.error('ERROR FATAL', String(e.message).slice(0, 300)); process.exit(2); });

// Demostración del hueco de la revisión 0 de las reglas (firestore.rules.phase0.proposal): el id del documento era libre, así que el autor
// podía borrar su foto dentro del plazo y recrear el MISMO documento para reiniciar uploadedAt (y con él las 12 h de borrado).
// La revisión 0b lo cierra (ver route-photos-binding-rules.cjs, bloque «hueco»). Esta prueba solo documenta el defecto de la revisión 0.
const L = require('./_lib.cjs');
const { mk, seed, ownerData, expect, check, knownDefect } = L;
(async () => {
  await L.loadFirestoreRules('proposal0');
  const stamp = Date.now();
  const A = await mk('la' + stamp, `la${stamp}@test.dev`);
  const FV = A.FV;
  const id = `valeria_12_${stamp}`;
  const filename = `${stamp}_Via.jpg`;
  const data = { photoUrl: `https://firebasestorage.googleapis.com/v0/b/climbmaps-80cae.firebasestorage.app/o/route-photos%2Fvaleria%2F${A.uid}%2F${filename}?alt=media&token=t`,
    uploadedBy: A.uid, uploadedAt: FV.serverTimestamp(), routeId: 12, schoolId: 'valeria', filename, storagePath: `route-photos/valeria/${A.uid}/${filename}` };
  const old = new Date(Date.now() - (12 * 3600 - 30) * 1000);
  await seed(`route-photos/${id}`, Object.assign({}, data, { uploadedAt: old }));
  await expect('revisión 0: el autor borra dentro del plazo', A.db.collection('route-photos').doc(id).delete(), true);
  let recreated = true;
  try { await A.db.collection('route-photos').doc(id).set(data); } catch (_) { recreated = false; }
  const d = recreated ? await ownerData(`route-photos/${id}`) : null;
  knownDefect('revisión 0: el autor recrea el mismo documento y uploadedAt vuelve a «ahora» (plazo de 12 h reiniciado)', recreated && Date.now() - Date.parse(d.uploadedAt) < 30000,
    'CORREGIDO en la revisión 0b (id con marca de tiempo ±10 min)');
  L.finish('route-photos-loophole-v0.cjs'); process.exit(0);
})().catch(e => { console.error('ERROR FATAL', String(e.message).slice(0, 300)); process.exit(2); });

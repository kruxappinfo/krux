// Sonda de DIAGNÓSTICO (no es una suite de seguridad): mide si el emulador de Storage se queda sin responder cuando varias peticiones, cada una con una consulta firestore.get() de las
// reglas, están en vuelo a la vez. Se usó para demostrar la causa de la intermitencia de storage-phase0c-rules (ver STORAGE-DEPLOY.md §8, «Pruebas con tiempo real»).
//   node emulator-concurrency-probe.cjs <concurrencia> <rondas>      (emulador de Fase 0 arrancado; para añadir carga: soak.sh no, ver el procedimiento del documento)
// Cada ronda crea <concurrencia> documentos y sube a la vez su archivo (permitido por las reglas) y después los borra a la vez como administrador. Resultado: rondas completadas o la
// primera petición que no respondió (límite 30 s por petición, ver _storage.cjs).
const path = require('node:path');
const ROOT = path.resolve(__dirname, '../../../..');
process.env.RULES_FILE = process.env.RULES_FILE || path.join(ROOT, 'docs/security-phase0/firestore.rules.route-photos-only.proposal');
process.env.MODE = 'proposal';
const L = require('./_lib.cjs');
const S = require('./_storage.cjs');
const { mkPhotoV2 } = require('./_photos.cjs');
const { mk, seed } = L;
(async () => {
  const conc = Number(process.argv[2] || 8), rounds = Number(process.argv[3] || 20);
  await L.loadFirestoreRules('proposal'); await S.loadStorageRules(path.join(ROOT, 'storage.rules'));
  const stamp = Date.now();
  const A = await mk('pa' + stamp, `pa${stamp}@test.dev`), AD = await mk('pad' + stamp, `pad${stamp}@test.dev`);
  await seed(`admins/${AD.uid}`, { role: 'admin' });
  const tA = await A.token(), tAD = await AD.token();
  const t0 = Date.now(); let ops = 0;
  for (let r = 1; r <= rounds; r++) {
    const photos = Array.from({ length: conc }, () => mkPhotoV2(A, A.FV));
    for (const x of photos) await A.db.collection('route-photos').doc(x.id).set(x.data);
    try {
      await Promise.all(photos.map(x => S.upload(tA, x.storagePath))); ops += conc;
      await Promise.all(photos.map(x => S.del(tAD, x.storagePath))); ops += conc;
    } catch (e) { console.log(JSON.stringify({ resultado: 'SIN RESPUESTA', concurrencia: conc, ronda: r, operacionesCompletadas: ops, error: e.message, segundos: Math.round((Date.now() - t0) / 1000) })); process.exit(1); }
  }
  console.log(JSON.stringify({ resultado: 'OK', concurrencia: conc, rondas: rounds, operaciones: ops, segundos: Math.round((Date.now() - t0) / 1000) }));
})().catch(e => { console.log(JSON.stringify({ resultado: 'ERROR', error: String(e.message).slice(0, 200) })); process.exit(2); });

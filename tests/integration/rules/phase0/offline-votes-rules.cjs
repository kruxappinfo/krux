// Fase 0 — cola de escrituras sin conexión y las reglas propuestas de votos. El SDK de Node no tiene IndexedDB, pero la cola de
// mutaciones pendientes (disableNetwork → escribir → enableNetwork) se reenvía igual: se prueba qué ocurre con cada patrón de
// escritura al reconectar. NO sustituye a una prueba en Chrome/Capacitor con persistencia real (ver tests/integration/harness).
const L = require('./_lib.cjs');
const { mk, seed, ownerData, check, expect } = L;
(async () => {
  await L.loadFirestoreRules();
  const stamp = Date.now();
  const A = await mk('oa' + stamp, `oa${stamp}@test.dev`);
  const B = await mk('ob' + stamp, `ob${stamp}@test.dev`);
  const FV = A.FV;
  const school = `s${stamp}`;
  const settle = (p) => p.then(() => 'ok', (e) => e.code || 'error');
  const ref = (u, id) => u.db.collection('grade_votes').doc(id);
  const w = (u, id, rid, v) => ref(u, id).set({ schoolId: school, routeId: rid, votes: { [u.uid]: v }, updatedAt: FV.serverTimestamp() }, { merge: true });

  // 1) Voto propio (set merge de su clave) puesto en cola sin conexión mientras otra persona vota en línea
  let id = `${school}_1`;
  await seed(`grade_votes/${id}`, { schoolId: school, routeId: 1, votes: { [B.uid]: 20 }, updatedAt: new Date() });
  await A.db.disableNetwork();
  const q1 = settle(w(A, id, 1, 7));
  await w(B, id, 1, 21);                                   // B (en línea) cambia su voto mientras A está sin conexión
  await A.db.enableNetwork();
  check('cola: voto propio encolado sin conexión se acepta al reconectar', (await q1) === 'ok');
  check('cola: no se pierde el voto que otra persona hizo mientras tanto', (d => d.votes[A.uid] === 7 && d.votes[B.uid] === 21)(await ownerData(`grade_votes/${id}`)));

  // 2) Escritura antigua de mapa completo con copia vieja (mlVoteGrade) encolada sin conexión
  id = `${school}_2`;
  await seed(`grade_votes/${id}`, { schoolId: school, routeId: 2, votes: { [A.uid]: 10, [B.uid]: 20 }, updatedAt: new Date() });
  await A.db.disableNetwork();
  const stale = { [A.uid]: 11, [B.uid]: 20 };              // copia leída antes de quedarse sin conexión
  const q2 = settle(ref(A, id).set({ schoolId: school, routeId: 2, votes: stale, updatedAt: FV.serverTimestamp() }, { merge: true }));
  await w(B, id, 2, 30);                                   // B cambia mientras tanto
  await A.db.enableNetwork();
  const r2 = await q2;
  console.error('[info] escritura antigua de mapa completo al reconectar →', r2, '| estado final:', JSON.stringify((await ownerData(`grade_votes/${id}`)).votes));
  check('cola: la escritura ANTIGUA de mapa completo con datos viejos se rechaza al reconectar (no pisa a B)', r2 === 'permission-denied' && (await ownerData(`grade_votes/${id}`)).votes[B.uid] === 30,
    'consecuencia: el voto de A se pierde; el cliente nuevo debe escribir solo su clave');

  // 3) Retirar el voto encolado con FieldValue.delete()
  id = `${school}_3`;
  await seed(`grade_votes/${id}`, { schoolId: school, routeId: 3, votes: { [A.uid]: 10, [B.uid]: 20 }, updatedAt: new Date() });
  await A.db.disableNetwork();
  const q3 = settle(ref(A, id).set({ schoolId: school, routeId: 3, votes: { [A.uid]: FV.delete() }, updatedAt: FV.serverTimestamp() }, { merge: true }));
  await A.db.enableNetwork();
  check('cola: retirar el voto (FieldValue.delete) encolado se acepta y elimina solo el voto propio', (await q3) === 'ok' && (d => d.votes[A.uid] === undefined && d.votes[B.uid] === 20)(await ownerData(`grade_votes/${id}`)));

  // 4) Primer voto de una vía que aún no tiene documento, encolado sin conexión
  id = `${school}_4`;
  await A.db.disableNetwork();
  const q4 = settle(w(A, id, 4, 5));
  await A.db.enableNetwork();
  check('cola: crear el documento (primer voto) sin conexión y reconectar', (await q4) === 'ok' && (await ownerData(`grade_votes/${id}`)).votes[A.uid] === 5);

  // 5) Dos usuarios con la cola llena votando a la vez al reconectar
  id = `${school}_5`;
  await A.db.disableNetwork(); await B.db.disableNetwork();
  const qa = settle(w(A, id, 5, 1)), qb = settle(w(B, id, 5, 2));
  await Promise.all([A.db.enableNetwork(), B.db.enableNetwork()]);
  const [ra, rb] = await Promise.all([qa, qb]);
  check('cola: dos usuarios reconectan a la vez con su primer voto: se conservan los dos', ra === 'ok' && rb === 'ok' && Object.keys((await ownerData(`grade_votes/${id}`)).votes).length === 2, `${ra}/${rb}`);
  L.finish('offline-votes-rules.cjs');
  process.exit(process.exitCode || 0);
})().catch(e => { console.error('ERROR FATAL', String(e.message).slice(0, 300)); process.exit(2); });

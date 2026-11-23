// Fase 0 — votos de grado, aleje y estado (grade_votes, aleje_votes, estado_votes).
// Estructura actual conservada: {schoolId}_{routeId} → { schoolId, routeId, votes: { uid: valor }, updatedAt }.
// Las escrituras reproducen las del cliente: kxSaveRouteVotes (set merge solo con su clave) y, cuando se indica,
// las de mlVoteAleje/mlVoteGrade/mlVoteEstado (mapa completo) y mlCancelGradeVote (borra en local + merge).
const L = require('./_lib.cjs');
const { mk, mkAnon, seed, ownerData, ownerDelete, expect, check, MODE, SUPER_EMAIL } = L;

(async () => {
  await L.loadFirestoreRules();
  const stamp = Date.now();
  const A = await mk('va' + stamp, `va${stamp}@test.dev`);
  const B = await mk('vb' + stamp, `vb${stamp}@test.dev`);
  const C = await mk('vc' + stamp, `vc${stamp}@test.dev`);
  const SA = await mk('vsa' + stamp, SUPER_EMAIL);
  const anon = await mkAnon('van' + stamp);
  const FV = A.FV;

  const COLS = [['grade_votes', 0, 35], ['aleje_votes', 1, 5], ['estado_votes', 1, 5]];
  let n = 0;
  for (const [col, MIN, MAX] of COLS) {
    const school = `s${stamp}${col[0]}`;               // escuela de la prueba (una por colección)
    const next = () => ({ routeId: ++n, id: `${school}_${n}` });
    const ref = (u, id) => u.db.collection(col).doc(id);
    // Escritura del cliente: set merge con SOLO su clave (kxSaveRouteVotes)
    const vote = (u, id, rid, v, extra) => ref(u, id).set(Object.assign({ schoolId: school, routeId: rid,
      votes: { [u.uid]: v }, updatedAt: FV.serverTimestamp() }, extra || {}), { merge: true });
    const T = `${col}: `;

    // --- votos propios ---
    let { routeId: r1, id: d1 } = next();
    await expect(T + 'crear voto propio', vote(A, d1, r1, MIN + 1), true);
    await expect(T + 'modificar voto propio', vote(A, d1, r1, MAX), true);
    await expect(T + 'otro usuario añade su propio voto al mismo documento', vote(B, d1, r1, MIN), true);
    check(T + 'tras añadir B, el voto de A sigue intacto', (await ownerData(`${col}/${d1}`)).votes[A.uid] === MAX);
    // Retirar el voto propio como debe hacerse (FieldValue.delete)
    await expect(T + 'eliminar voto propio con FieldValue.delete()', vote(A, d1, r1, FV.delete()), true);
    check(T + 'el voto propio desaparece del servidor y el de B se conserva', (d => d.votes[A.uid] === undefined && d.votes[B.uid] === MIN)(await ownerData(`${col}/${d1}`)));

    // Cliente ACTUAL (mlVoteAleje/Grade/Estado): reescribe el mapa completo con lo que leyó. Sin carrera, los votos ajenos no cambian
    ({ routeId: r1, id: d1 } = next());
    await vote(A, d1, r1, MIN + 1); await vote(B, d1, r1, MAX);
    const leido = (await ownerData(`${col}/${d1}`)).votes;
    await expect(T + 'compatibilidad: mapa completo leído y reescrito SIN cambios ajenos (cliente actual, sin carrera)',
      ref(A, d1).set({ schoolId: school, routeId: r1, votes: { ...leido, [A.uid]: MIN }, updatedAt: FV.serverTimestamp() }, { merge: true }), true);

    // --- votos ajenos y suplantación ---
    ({ routeId: r1, id: d1 } = next());
    const dOwn = d1;
    await vote(A, d1, r1, MIN + 1);
    await expect(T + 'B modifica el voto de A', ref(B, d1).set({ votes: { [A.uid]: MAX }, updatedAt: FV.serverTimestamp() }, { merge: true }), false);
    await expect(T + 'B elimina el voto de A (FieldValue.delete)', ref(B, d1).set({ votes: { [A.uid]: FV.delete() }, updatedAt: FV.serverTimestamp() }, { merge: true }), false);
    await expect(T + 'B añade un voto con un uid inventado', ref(B, d1).set({ votes: { 'uid-inventado': MIN }, updatedAt: FV.serverTimestamp() }, { merge: true }), false);
    await expect(T + 'B añade su voto y a la vez toca el de A', ref(B, d1).update({ [`votes.${B.uid}`]: MIN, [`votes.${A.uid}`]: MAX, updatedAt: FV.serverTimestamp() }), false);
    ({ routeId: r1, id: d1 } = next());
    await expect(T + 'suplantar a A al CREAR el documento', ref(B, d1).set({ schoolId: school, routeId: r1, votes: { [A.uid]: MIN }, updatedAt: FV.serverTimestamp() }), false);
    check(T + 'tras los intentos ajenos, el voto de A sigue intacto y no hay votos inventados', (d => d.votes[A.uid] === MIN + 1 && Object.keys(d.votes).length === 1)(await ownerData(`${col}/${dOwn}`)));

    // --- sobrescribir el conjunto / datos viejos / mapa vacío ---
    ({ routeId: r1, id: d1 } = next());
    await vote(A, d1, r1, MIN + 1); await vote(B, d1, r1, MAX);
    await expect(T + 'set() sin merge que reemplaza todo el mapa', ref(A, d1).set({ schoolId: school, routeId: r1, votes: { [A.uid]: MIN }, updatedAt: FV.serverTimestamp() }), false);
    // Lectura-modificación-escritura con copia vieja (mlVoteAleje/Grade/Estado reescriben el mapa completo)
    const stale = { [A.uid]: MIN + 1, [B.uid]: MAX };            // lo que A leyó
    await vote(B, d1, r1, MIN);                                   // B cambia su voto mientras tanto
    await expect(T + 'A reescribe el mapa completo con una copia vieja (pisa el voto nuevo de B)',
      ref(A, d1).set({ schoolId: school, routeId: r1, votes: { ...stale, [A.uid]: MAX }, updatedAt: FV.serverTimestamp() }, { merge: true }), false);
    check(T + 'el voto de B no ha sido pisado', (await ownerData(`${col}/${d1}`)).votes[B.uid] === MIN,
      MODE === 'current' ? 'con las reglas actuales el voto de B se pierde: confirma el riesgo de escrituras concurrentes' : undefined);
    ({ routeId: r1, id: d1 } = next());
    await expect(T + 'crear documento con mapa de votos vacío', ref(A, d1).set({ schoolId: school, routeId: r1, votes: {}, updatedAt: FV.serverTimestamp() }), false);
    await expect(T + 'crear documento sin mapa votes', ref(A, d1).set({ schoolId: school, routeId: r1, updatedAt: FV.serverTimestamp() }), false);

    // --- valores incorrectos ---
    for (const [lab, val] of [[`por debajo del rango (${MIN - 1})`, MIN - 1], [`por encima del rango (${MAX + 1})`, MAX + 1],
      ['decimal 2.5', 2.5], ['cadena "3"', '3'], ['booleano', true], ['null', null], ['negativo muy grande', -999], ['999', 999]]) {
      ({ routeId: r1, id: d1 } = next());
      await expect(T + `crear con valor ${lab}`, vote(A, d1, r1, val), false);
    }
    ({ routeId: r1, id: d1 } = next());
    await vote(A, d1, r1, MIN + 1);
    await expect(T + 'actualizar el voto propio a un valor fuera de rango', vote(A, d1, r1, MAX + 1), false);
    await expect(T + 'actualizar el voto propio a una cadena', vote(A, d1, r1, 'x'), false);
    await expect(T + 'valor en el límite inferior', vote(A, d1, r1, MIN), true);
    await expect(T + 'valor en el límite superior', vote(A, d1, r1, MAX), true);

    // --- campos y metadatos ---
    ({ routeId: r1, id: d1 } = next());
    await expect(T + 'crear con campo adicional', vote(A, d1, r1, MIN, { admin: true }), false);
    await vote(A, d1, r1, MIN + 1);
    await expect(T + 'actualizar añadiendo un campo adicional', vote(A, d1, r1, MIN + 1, { points: 99 }), false);
    await expect(T + 'modificar schoolId', ref(A, d1).set({ schoolId: 'otra', votes: { [A.uid]: MIN }, updatedAt: FV.serverTimestamp() }, { merge: true }), false);
    await expect(T + 'modificar routeId (número distinto)', ref(A, d1).set({ routeId: r1 + 1000, votes: { [A.uid]: MIN }, updatedAt: FV.serverTimestamp() }, { merge: true }), false);
    await expect(T + 'routeId como cadena sobre un número del MISMO valor (lo que envía mlCancelGradeVote desde data-route)',
      ref(A, d1).set({ schoolId: school, routeId: String(r1), votes: { [A.uid]: FV.delete() }, updatedAt: FV.serverTimestamp() }, { merge: true }), true,
      'revisión 0b: se tolera el cambio de tipo para no romper a los clientes antiguos');
    await expect(T + 'routeId como cadena con OTRO valor', ref(A, d1).set({ schoolId: school, routeId: String(r1 + 500), votes: { [A.uid]: MIN }, updatedAt: FV.serverTimestamp() }, { merge: true }), false);
    await expect(T + 'updatedAt con fecha del cliente', ref(A, d1).set({ votes: { [A.uid]: MIN }, updatedAt: new Date(Date.now() - 60000) }, { merge: true }), false);
    await expect(T + 'updatedAt ausente', ref(A, d1).set({ votes: { [A.uid]: MIN } }, { merge: true }), false);
    ({ routeId: r1, id: d1 } = next());
    await expect(T + 'id de documento incoherente con schoolId_routeId', ref(A, `${school}_9999999`).set({ schoolId: school, routeId: r1, votes: { [A.uid]: MIN }, updatedAt: FV.serverTimestamp() }), false);

    // --- borrar el documento entero ---
    ({ routeId: r1, id: d1 } = next());
    await vote(A, d1, r1, MIN + 1);
    await expect(T + 'usuario normal borra el documento entero', ref(A, d1).delete(), false);
    await expect(T + 'otro usuario borra el documento entero', ref(B, d1).delete(), false);
    await expect(T + 'super-admin borra el documento entero', ref(SA, d1).delete(), true);

    // --- sin autenticación ---
    ({ routeId: r1, id: d1 } = next());
    await expect(T + 'escribir sin autenticar (crear)', anon.db.collection(col).doc(d1).set({ schoolId: school, routeId: r1, votes: { x: MIN }, updatedAt: FV.serverTimestamp() }), false);
    await vote(A, d1, r1, MIN + 1);
    await expect(T + 'escribir sin autenticar (actualizar)', anon.db.collection(col).doc(d1).set({ votes: { x: MIN } }, { merge: true }), false);
    await expect(T + 'leer sin autenticar (los votos son públicos)', anon.db.collection(col).doc(d1).get(), true);

    // --- documentos antiguos ---
    ({ routeId: r1, id: d1 } = next());
    await seed(`${col}/${d1}`, { votes: { [C.uid]: MIN + 1 }, legacyField: 'x' });           // sin schoolId/routeId y con un campo desconocido
    await expect(T + 'documento antiguo (sin schoolId/routeId, con campo extra): el cliente añade su voto y los metadatos', vote(A, d1, r1, MIN), true);
    check(T + 'documento antiguo: se conserva el campo desconocido y el voto previo', (d => d.legacyField === 'x' && d.votes[C.uid] === MIN + 1)(await ownerData(`${col}/${d1}`)));
    ({ routeId: r1, id: d1 } = next());
    await seed(`${col}/${d1}`, { schoolId: school, routeId: r1, votes: { [C.uid]: MIN + 1 } });   // sin updatedAt
    await expect(T + 'documento antiguo sin updatedAt: se puede votar', vote(A, d1, r1, MIN), true);

    // --- concurrencia con escritura de solo la clave propia ---
    ({ routeId: r1, id: d1 } = next());
    const users = await Promise.all([1, 2, 3, 4, 5, 6].map(i => mk(`cv${i}${stamp}${col[0]}`, `cv${i}_${col[0]}${stamp}@test.dev`)));
    const withOldRead = users.map(u => ref(u, d1).get());       // todos leen primero (documento aún inexistente)
    await Promise.all(withOldRead);
    await Promise.all(users.map((u, i) => vote(u, d1, r1, MIN + (i % (MAX - MIN + 1)))));
    check(T + 'seis usuarios votan a la vez con set merge de su clave: no se pierde ninguno',
      Object.keys((await ownerData(`${col}/${d1}`)).votes).length === 6);
  }

  // --- Defecto confirmado: mlCancelGradeVote (delete local + merge) NO borra en el servidor ---
  const school = `s${stamp}cancel`;
  const cref = (id) => A.db.collection('grade_votes').doc(id);
  const cid = `${school}_1`;
  await seed(`grade_votes/${cid}`, { schoolId: school, routeId: 1, votes: { [A.uid]: 10, [B.uid]: 12 }, updatedAt: new Date() });   // documento ya existente con dos votos
  // Lo que hace mlCancelGradeVote: lee votes, hace delete votes[uid] y escribe el mapa restante con merge:true
  const votesRead = { ...(await ownerData(`grade_votes/${cid}`)).votes }; delete votesRead[A.uid];
  await cref(cid).set({ schoolId: school, routeId: 1, votes: votesRead, updatedAt: A.FV.serverTimestamp() }, { merge: true });
  check('mlCancelGradeVote tal cual: el voto SIGUE en el servidor (el merge no borra claves ausentes)', (await ownerData(`grade_votes/${cid}`)).votes[A.uid] === 10,
    'DEFECTO CONFIRMADO: depende solo de Firestore, independiente de las reglas');
  await cref(cid).set({ schoolId: school, routeId: 1, votes: { [A.uid]: A.FV.delete() }, updatedAt: A.FV.serverTimestamp() }, { merge: true });
  check('con FieldValue.delete() el voto sí se elimina y el de B queda', (d => d.votes[A.uid] === undefined && d.votes[B.uid] === 12)(await ownerData(`grade_votes/${cid}`)));

  L.finish('votes-rules.cjs');
  process.exit(process.exitCode || 0);
})().catch(e => { console.error('ERROR FATAL', String(e.message).slice(0, 300), '\nÚltima prueba registrada:', L.results.length ? L.results[L.results.length - 1].label : '(ninguna)'); process.exit(2); });

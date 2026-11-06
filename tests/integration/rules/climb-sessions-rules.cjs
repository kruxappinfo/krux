const path = require('node:path');
const ROOT = path.resolve(__dirname, '../../..');
// Reglas de users/{uid}/climb_sessions y del ascenso con sessionId contra el emulador local (proyecto demo).
const firebase = require(path.join(ROOT, 'node_modules/firebase/compat/app'));
require(path.join(ROOT, 'node_modules/firebase/compat/auth'));
require(path.join(ROOT, 'node_modules/firebase/compat/firestore'));

const mk = async (name, email) => {
  const app = firebase.initializeApp({ apiKey: 'fake', projectId: 'demo-krux-audit', authDomain: 'x' }, name);
  app.auth().useEmulator('http://127.0.0.1:9109', { disableWarnings: true });
  const db = app.firestore(); db.useEmulator('127.0.0.1', 8089);
  let cred;
  try { cred = await app.auth().createUserWithEmailAndPassword(email, 'password123'); }
  catch (e) { cred = await app.auth().signInWithEmailAndPassword(email, 'password123'); }
  return { db, uid: cred.user.uid };
};

const results = [];
const expect = async (label, promise, shouldPass) => {
  let ok;
  try { await promise; ok = true; } catch (e) { ok = false; if (!/permission|PERMISSION/i.test(String(e.code + e.message))) label += ` (error inesperado: ${e.code})`; }
  results.push({ label, pass: ok === shouldPass, expected: shouldPass ? 'permitido' : 'denegado', got: ok ? 'permitido' : 'denegado' });
};

(async () => {
  const stamp = Date.now();
  const A = await mk('a' + stamp, `a${stamp}@test.dev`);
  const B = await mk('b' + stamp, `b${stamp}@test.dev`);
  const ref = (u, id) => u.db.collection('users').doc(A.uid).collection('climb_sessions').doc(id);
  const session = (over) => Object.assign({
    userId: A.uid, type: 'rock', status: 'active', startedAt: new Date(), endedAt: null, pauses: [], activeMs: 0,
    gps: { enabled: false, status: 'off', distanceM: 0 }, ascentIds: [], stats: null, rev: 1
  }, over || {});

  await expect('sesión: dueño crea activa', ref(A, 's1').set(session()), true);
  await expect('sesión: dueño la actualiza (pausa, merge)', ref(A, 's1').set({ status: 'paused', rev: 2, pauses: [{ from: 1, to: null }] }, { merge: true }), true);
  await expect('sesión: dueño la finaliza con track plano', ref(A, 's1').set({ status: 'finished', track: { lng: [1, 2], lat: [3, 4], t: [5, 6] } }, { merge: true }), true);
  await expect('sesión: dueño la lee', ref(A, 's1').get(), true);
  await expect('sesión: dueño lista las suyas', A.db.collection('users').doc(A.uid).collection('climb_sessions').where('status', '==', 'finished').get(), true);
  await expect('sesión: otro usuario no la lee', ref(B, 's1').get(), false);
  await expect('sesión: otro usuario no lista', B.db.collection('users').doc(A.uid).collection('climb_sessions').get(), false);
  await expect('sesión: otro usuario no escribe', ref(B, 's2').set(session()), false);
  await expect('sesión: otro usuario no modifica', ref(B, 's1').set({ status: 'finished' }, { merge: true }), false);
  await expect('sesión: otro usuario no borra', ref(B, 's1').delete(), false);
  await expect('sesión: userId de otra persona', ref(A, 's3').set(session({ userId: B.uid })), false);
  await expect('sesión: tipo distinto de roca', ref(A, 's4').set(session({ type: 'gym' })), false);
  await expect('sesión: estado inválido', ref(A, 's5').set(session({ status: 'borrada' })), false);
  await expect('sesión: dueño borra', ref(A, 's1').delete(), true);

  // Ascenso dentro de una sesión: misma regla que cualquier ascenso (sessionId/loggedAt/companions son campos opcionales)
  const asc = (u, over) => Object.assign({ userId: u.uid, schoolId: 'valeria', routeId: 1, grade: '6a', style: 'redpoint', date: new Date() }, over || {});
  await expect('ascenso con sessionId: dueño crea', A.db.collection('ascents').doc('a-ses-1').set(asc(A, { sessionId: 's1', loggedAt: new Date(), companions: [B.uid] })), true);
  await expect('ascenso sin sesión: dueño crea (igual que antes)', A.db.collection('ascents').doc('a-solo-1').set(asc(A)), true);
  await expect('ascenso con sessionId: no se crea a nombre de otro', B.db.collection('ascents').doc('a-ses-2').set(asc(A, { sessionId: 's1' })), false);
  await expect('ascenso: consulta por sessionId', A.db.collection('ascents').where('userId', '==', A.uid).where('sessionId', '==', 's1').get(), true);

  const failed = results.filter(r => !r.pass);
  results.forEach(r => console.log((r.pass ? 'OK  ' : 'FALLA') + ' ' + r.label + (r.pass ? '' : `  → esperado ${r.expected}, obtenido ${r.got}`)));
  console.log(`\n${results.length - failed.length}/${results.length} correctas`);
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('ERROR', e); process.exit(2); });

const path = require('node:path');
const ROOT = path.resolve(__dirname, '../../..');
// Publicaciones guardadas (users/{uid}/savedPosts), contra el emulador local y las reglas de firestore.rules: solo su dueño las ve.
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
const FV = firebase.firestore.FieldValue;

const results = [];
const expect = async (label, promise, shouldPass) => {
  let ok;
  try { await promise; ok = true; } catch (e) { ok = false; if (!/permission|PERMISSION/i.test(String(e.code + e.message))) label += ` (error inesperado: ${e.code})`; }
  results.push({ label, pass: ok === shouldPass, expected: shouldPass ? 'permitido' : 'denegado', got: ok ? 'permitido' : 'denegado' });
};

(async () => {
  const A = await mk('a', 'saved-a@test.local');
  const B = await mk('b', 'saved-b@test.local');
  const savedA = A.db.collection('users').doc(A.uid).collection('savedPosts');
  await A.db.collection('users').doc(A.uid).set({ displayName: 'A', savedPosts: ['p0', 'p1'] });

  // Migración del array antiguo (mismo lote que kxMigrateLegacySavedPosts)
  await expect('A migra su array antiguo a la subcolección y lo borra del perfil', (() => {
    const b = A.db.batch();
    ['p0', 'p1'].forEach(id => b.set(savedA.doc(id), { savedAt: FV.serverTimestamp() }));
    b.update(A.db.collection('users').doc(A.uid), { savedPosts: FV.delete() });
    return b.commit();
  })(), true);
  await expect('A guarda una publicación', savedA.doc('p2').set({ savedAt: FV.serverTimestamp() }), true);
  await expect('A lista sus guardados por fecha', savedA.orderBy('savedAt', 'desc').get(), true);
  await expect('A quita un guardado', savedA.doc('p2').delete(), true);
  await expect('A no guarda con campos extra', savedA.doc('p3').set({ savedAt: FV.serverTimestamp(), note: 'x' }), false);
  await expect('A no inventa la fecha', savedA.doc('p3').set({ savedAt: new Date(2000, 0, 1) }), false);

  const BsavedA = B.db.collection('users').doc(A.uid).collection('savedPosts');
  await expect('B no lista los guardados de A', BsavedA.get(), false);
  await expect('B no lee un guardado de A', BsavedA.doc('p0').get(), false);
  await expect('B no guarda nada en la lista de A', BsavedA.doc('p9').set({ savedAt: FV.serverTimestamp() }), false);
  await expect('B no borra un guardado de A', BsavedA.doc('p0').delete(), false);

  const failed = results.filter(r => !r.pass);
  results.forEach(r => console.log((r.pass ? 'OK  ' : 'FALLA') + ' ' + r.label + (r.pass ? '' : `  → esperado ${r.expected}, obtenido ${r.got}`)));
  console.log(`\n${results.length - failed.length}/${results.length} correctas`);
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('ERROR', e); process.exit(1); });

const path = require('node:path');
const ROOT = path.resolve(__dirname, '../../..');
// Bloques de rocódromo (users/{uid}/gym_blocks y Storage gym-blocks/{uid}/), contra el emulador local y las reglas de
// firestore.rules y storage.rules: privados, solo su dueño los lee, escribe y borra.
const firebase = require(path.join(ROOT, 'node_modules/firebase/compat/app'));
require(path.join(ROOT, 'node_modules/firebase/compat/auth'));
require(path.join(ROOT, 'node_modules/firebase/compat/firestore'));
require(path.join(ROOT, 'node_modules/firebase/compat/storage'));

const mk = async (name, email) => {
  const app = firebase.initializeApp({ apiKey: 'fake', projectId: 'demo-krux-audit', authDomain: 'x', storageBucket: 'demo-krux-audit.appspot.com' }, name);
  app.auth().useEmulator('http://127.0.0.1:9109', { disableWarnings: true });
  const db = app.firestore(); db.useEmulator('127.0.0.1', 8089);
  const st = app.storage(); st.useEmulator('127.0.0.1', 9199);
  let cred;
  try { cred = await app.auth().createUserWithEmailAndPassword(email, 'password123'); }
  catch (e) { cred = await app.auth().signInWithEmailAndPassword(email, 'password123'); }
  return { db, st, uid: cred.user.uid };
};
const FV = firebase.firestore.FieldValue;

const results = [];
const expect = async (label, promise, shouldPass) => {
  let ok;
  try { await promise; ok = true; } catch (e) { ok = false; if (!/permission|PERMISSION|unauthorized/i.test(String(e.code + e.message))) label += ` (error inesperado: ${e.code})`; }
  results.push({ label, pass: ok === shouldPass, expected: shouldPass ? 'permitido' : 'denegado', got: ok ? 'permitido' : 'denegado' });
};

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 0xff, 0xd9]);

(async () => {
  const A = await mk('a', 'blocks-a@test.local');
  const B = await mk('b', 'blocks-b@test.local');
  const colA = A.db.collection('users').doc(A.uid).collection('gym_blocks');
  const id = colA.doc().id;
  const block = (over = {}) => ({
    userId: A.uid, gymId: 'roco-1', gymName: 'Sharma', ascentId: 'asc1', ascentRouteId: 'gym_1', type: 'boulder', grade: '6B',
    name: '', color: 'amarillo', date: '2026-11-26', style: 'flash',
    photoPath: `gym-blocks/${A.uid}/${id}.jpg`, photoUrl: 'https://x/y.jpg', thumbUrl: 'https://x/t.jpg', w: 1600, h: 1200,
    holds: [{ t: 'start', p: [0.1, 0.1, 0.2, 0.1, 0.2, 0.2], s: [0.15, 0.15] }],
    createdAt: FV.serverTimestamp(), updatedAt: FV.serverTimestamp(), ...over
  });

  // Firestore
  await expect('A crea su bloque', colA.doc(id).set(block()), true);
  await expect('A lista sus bloques por fecha', colA.orderBy('createdAt', 'desc').limit(60).get(), true);
  await expect('A lista sus bloques de un rocódromo', colA.where('gymId', '==', 'roco-1').get(), true);
  await expect('A corrige las presas (merge)', colA.doc(id).set({ holds: [], updatedAt: FV.serverTimestamp() }, { merge: true }), true);
  await expect('A anota la publicación del feed', colA.doc(id).set({ postId: 'p1', updatedAt: FV.serverTimestamp() }, { merge: true }), true);
  await expect('A no guarda campos extra', colA.doc(id).set({ secreto: 1, updatedAt: FV.serverTimestamp() }, { merge: true }), false);
  await expect('A no inventa la fecha de cambio', colA.doc(id).set({ holds: [], updatedAt: new Date(2000, 0, 1) }, { merge: true }), false);
  await expect('A no apunta la foto a otra carpeta', colA.doc(colA.doc().id).set(block()), false);
  await expect('A no pone un tipo desconocido', colA.doc(id).set(block({ type: 'otro' })), false);
  await expect('A no guarda más de 60 presas', colA.doc(id).set(block({ holds: Array.from({ length: 61 }, () => ({ t: 'hand', p: [0, 0, 1, 0, 1, 1] })) })), false);
  await expect('A no crea a nombre de otra persona', colA.doc(id).set(block({ userId: B.uid })), false);

  const colAasB = B.db.collection('users').doc(A.uid).collection('gym_blocks');
  await expect('B no lista los bloques de A', colAasB.get(), false);
  await expect('B no lee un bloque de A', colAasB.doc(id).get(), false);
  await expect('B no escribe en los bloques de A', colAasB.doc(id).set(block()), false);
  await expect('B no borra un bloque de A', colAasB.doc(id).delete(), false);

  // Storage
  const meta = { contentType: 'image/jpeg' };
  const refA = (f) => A.st.ref(`gym-blocks/${A.uid}/${f}`);
  await expect('A sube la foto de su bloque', refA(`${id}.jpg`).put(JPEG, meta), true);
  await expect('A sube la miniatura', refA(`${id}_t.jpg`).put(JPEG, meta), true);
  await expect('A cambia la foto antes de guardar (sobrescribe)', refA(`${id}.jpg`).put(JPEG, meta), true);
  await expect('A lee su foto', refA(`${id}.jpg`).getMetadata(), true);
  await expect('A no sube algo que no es JPEG', refA(`${id}.jpg`).put(JPEG, { contentType: 'image/png' }), false);
  await expect('A no sube con un nombre raro', refA('../x.jpg').put(JPEG, meta), false);
  await expect('A no sube a la carpeta de B', A.st.ref(`gym-blocks/${B.uid}/${id}.jpg`).put(JPEG, meta), false);
  await expect('B no lee la foto de A', B.st.ref(`gym-blocks/${A.uid}/${id}.jpg`).getMetadata(), false);
  await expect('B no borra la foto de A', B.st.ref(`gym-blocks/${A.uid}/${id}.jpg`).delete(), false);
  await expect('A borra su miniatura', refA(`${id}_t.jpg`).delete(), true);
  await expect('A borra su foto', refA(`${id}.jpg`).delete(), true);
  await expect('A borra su bloque', colA.doc(id).delete(), true);

  const failed = results.filter(r => !r.pass);
  results.forEach(r => console.log((r.pass ? 'OK  ' : 'FALLA') + ' ' + r.label + (r.pass ? '' : `  → esperado ${r.expected}, obtenido ${r.got}`)));
  console.log(`\n${results.length - failed.length}/${results.length} correctas`);
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('ERROR', e); process.exit(1); });

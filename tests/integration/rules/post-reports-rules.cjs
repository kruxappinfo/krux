const path = require('node:path');
const ROOT = path.resolve(__dirname, '../../..');
// Denuncias de publicaciones (post_reports) y borrado por admin, contra el emulador local y las reglas de firestore.rules.
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
  const author = await mk('author', 'pr-author@test.local');
  const rep = await mk('rep', 'pr-rep@test.local');
  const other = await mk('other', 'pr-other@test.local');
  const admin = await mk('admin', 'krux.app.info@gmail.com');
  await expect('el autor publica', author.db.collection('posts').doc('p1').set({ userId: author.uid, text: 'hola' }), true);

  const mine = (u, postId, extra = {}) => u.db.collection('post_reports').doc(`${postId}__${u.uid}`).set({
    postId, postAuthorId: author.uid, reason: 'spam', reporterId: u.uid, createdAt: FV.serverTimestamp(), status: 'open', ...extra });
  await expect('B comprueba que aún no ha denunciado (documento inexistente)', rep.db.collection('post_reports').doc(`p1__${rep.uid}`).get(), true);
  await expect('B denuncia la publicación', mine(rep, 'p1'), true);
  await expect('B lee su denuncia', rep.db.collection('post_reports').doc(`p1__${rep.uid}`).get(), true);
  await expect('B no la sobrescribe (misma denuncia)', mine(rep, 'p1', { reason: 'other' }), false);
  await expect('el autor no se denuncia a sí mismo', author.db.collection('post_reports').doc(`p1__${author.uid}`).set({
    postId: 'p1', postAuthorId: author.uid, reason: 'spam', reporterId: author.uid, createdAt: FV.serverTimestamp(), status: 'open' }), false);
  await expect('motivo inventado denegado', mine(other, 'p1', { reason: 'xx' }), false);
  await expect('estado distinto de open denegado', mine(other, 'p1', { status: 'resolved' }), false);
  await expect('autor falso denegado', mine(other, 'p1', { postAuthorId: other.uid }), false);
  await expect('denuncia a nombre de otro denegada', rep.db.collection('post_reports').doc(`p1__${other.uid}`).set({
    postId: 'p1', postAuthorId: author.uid, reason: 'spam', reporterId: other.uid, createdAt: FV.serverTimestamp(), status: 'open' }), false);
  await expect('denuncia de publicación inexistente denegada', mine(other, 'nada'), false);
  await expect('campo extra denegado', mine(other, 'p1', { nota: 'x' }), false);

  await expect('C no lee la denuncia de B', other.db.collection('post_reports').doc(`p1__${rep.uid}`).get(), false);
  await expect('C no lista denuncias', other.db.collection('post_reports').get(), false);
  await expect('B no resuelve su propia denuncia', rep.db.collection('post_reports').doc(`p1__${rep.uid}`).update({ status: 'resolved' }), false);
  await expect('B no borra su denuncia', rep.db.collection('post_reports').doc(`p1__${rep.uid}`).delete(), false);
  await expect('el autor no borra la denuncia que recibe', author.db.collection('post_reports').doc(`p1__${rep.uid}`).delete(), false);

  await expect('admin lista las abiertas', admin.db.collection('post_reports').where('status', '==', 'open').get(), true);
  await expect('admin resuelve una denuncia', admin.db.collection('post_reports').doc(`p1__${rep.uid}`).update({ status: 'resolved' }), true);
  await expect('C no borra la publicación del autor', other.db.collection('posts').doc('p1').delete(), false);
  await expect('admin borra la publicación denunciada', admin.db.collection('posts').doc('p1').delete(), true);
  await expect('admin borra una denuncia', admin.db.collection('post_reports').doc(`p1__${rep.uid}`).delete(), true);

  const failed = results.filter(r => !r.pass);
  results.forEach(r => console.log((r.pass ? 'OK  ' : 'FALLA') + ' ' + r.label + (r.pass ? '' : `  → esperado ${r.expected}, obtenido ${r.got}`)));
  console.log(`\n${results.length - failed.length}/${results.length} correctas`);
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('ERROR', e); process.exit(1); });

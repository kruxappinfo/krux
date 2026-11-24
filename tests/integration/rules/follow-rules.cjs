const path = require('node:path');
const ROOT = path.resolve(__dirname, '../../..');
// Seguir / dejar de seguir y contadores del perfil (users/{uid}.stats), contra el emulador local y las reglas de firestore.rules.
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

// Mismo lote que followUser / unfollowUser de user-features.js
const follow = (me, target) => {
  const b = me.db.batch();
  b.set(me.db.collection('users').doc(me.uid).collection('following').doc(target), { userId: target, followedAt: FV.serverTimestamp() });
  b.set(me.db.collection('users').doc(target).collection('followers').doc(me.uid), { userId: me.uid, followedAt: FV.serverTimestamp() });
  b.update(me.db.collection('users').doc(me.uid), { 'stats.followingCount': FV.increment(1) });
  b.update(me.db.collection('users').doc(target), { 'stats.followersCount': FV.increment(1) });
  return b.commit();
};
const unfollow = (me, target) => {
  const b = me.db.batch();
  b.delete(me.db.collection('users').doc(me.uid).collection('following').doc(target));
  b.delete(me.db.collection('users').doc(target).collection('followers').doc(me.uid));
  b.update(me.db.collection('users').doc(me.uid), { 'stats.followingCount': FV.increment(-1) });
  b.update(me.db.collection('users').doc(target), { 'stats.followersCount': FV.increment(-1) });
  return b.commit();
};

(async () => {
  const s = Date.now();
  const A = await mk('a' + s, `a${s}@test.dev`);
  const B = await mk('b' + s, `b${s}@test.dev`);
  const C = await mk('c' + s, `c${s}@test.dev`);
  await A.db.collection('users').doc(A.uid).set({ displayName: 'Ana', stats: { totalAscents: 28, followersCount: 0, followingCount: 0 }, savedPosts: ['p1'] });
  await B.db.collection('users').doc(B.uid).set({ displayName: 'Beto' });   // sin stats, como algunas cuentas reales
  await C.db.collection('users').doc(C.uid).set({ displayName: 'Carla', stats: { followingCount: 0 } });
  const count = async () => ((await A.db.collection('users').doc(A.uid).get()).data().stats || {}).followersCount;

  // --- Lo que hace la app ---
  await expect('B sigue a A (lote completo)', follow(B, A.uid), true);
  results.push({ label: 'A tiene 1 seguidor', pass: (await count()) === 1, expected: 1, got: await count() });
  await expect('A sigue a B, que no tiene stats', follow(A, B.uid), true);
  await expect('C sigue a A', follow(C, A.uid), true);
  await expect('B deja de seguir a A', unfollow(B, A.uid), true);
  results.push({ label: 'A queda con 1 seguidor', pass: (await count()) === 1, expected: 1, got: await count() });
  await expect('A sigue editando su perfil y sus guardados', A.db.collection('users').doc(A.uid).update({ bio: 'hola', savedPosts: FV.arrayUnion('p2'), 'stats.totalAscents': FV.increment(1) }), true);

  // --- Lo que ya no se puede ---
  await expect('B no sube el contador de A sin seguirle', B.db.collection('users').doc(A.uid).update({ 'stats.followersCount': FV.increment(1) }), false);
  await expect('B no pone un número cualquiera', B.db.collection('users').doc(A.uid).update({ 'stats.followersCount': 999 }), false);
  await expect('C (que sigue a A) no suma otra vez sin crear nada', C.db.collection('users').doc(A.uid).update({ 'stats.followersCount': FV.increment(1) }), false);
  await expect('C no resta sin dejar de seguir', C.db.collection('users').doc(A.uid).update({ 'stats.followersCount': FV.increment(-1) }), false);
  await expect('B no sigue sumando +2 de golpe', (() => { const b = B.db.batch(); b.set(B.db.collection('users').doc(A.uid).collection('followers').doc(B.uid), { userId: B.uid }); b.update(B.db.collection('users').doc(A.uid), { 'stats.followersCount': FV.increment(2) }); return b.commit(); })(), false);
  await expect('B no toca los ascensos de A', B.db.collection('users').doc(A.uid).update({ 'stats.totalAscents': 0 }), false);
  await expect('B no toca el «siguiendo» de A', B.db.collection('users').doc(A.uid).update({ 'stats.followingCount': 50 }), false);
  await expect('B no cambia los guardados de A', B.db.collection('users').doc(A.uid).update({ savedPosts: [] }), false);
  await expect('B no cambia la bio de A', B.db.collection('users').doc(A.uid).update({ bio: 'x' }), false);
  await expect('B no apunta a C como seguidor de A', B.db.collection('users').doc(A.uid).collection('followers').doc(C.uid).set({ userId: C.uid }), false);
  await expect('B no escribe en el «siguiendo» de A', B.db.collection('users').doc(A.uid).collection('following').doc(B.uid).set({ userId: B.uid }), false);

  const failed = results.filter(r => !r.pass);
  results.forEach(r => console.log((r.pass ? 'OK  ' : 'FALLA') + ' ' + r.label + (r.pass ? '' : `  → esperado ${r.expected}, obtenido ${r.got}`)));
  console.log(`\n${results.length - failed.length}/${results.length} correctas`);
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('ERROR', e); process.exit(1); });

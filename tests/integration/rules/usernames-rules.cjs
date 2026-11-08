const path = require('node:path');
const ROOT = path.resolve(__dirname, '../../..');
// Reglas de nombres de usuario (usernames/{nombre} y users/{uid}.username) contra el emulador local (proyecto demo).
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
  try { await promise; ok = true; } catch (e) { ok = false; if (!/permission|PERMISSION/i.test(String(e.code + e.message))) label += ` (error inesperado: ${e.code} ${e.message})`; }
  results.push({ label, pass: ok === shouldPass, expected: shouldPass ? 'permitido' : 'denegado', got: ok ? 'permitido' : 'denegado' });
};

// Lo mismo que KruxUsernames.claim (usernames.js), sin comprobaciones de cliente
const claim = (X, name, { reserve = true, setUser = true, freeOld = true } = {}) => X.db.runTransaction(async tx => {
  const uref = X.db.collection('users').doc(X.uid);
  const me = await tx.get(uref);
  const old = me.exists ? me.data().username : null;
  if (reserve) tx.set(X.db.collection('usernames').doc(name), { uid: X.uid });
  if (setUser) tx.set(uref, { username: name }, { merge: true });
  if (freeOld && old && old !== name) tx.delete(X.db.collection('usernames').doc(old));
});

(async () => {
  const s = Date.now().toString(36);
  const A = await mk('a' + s, `a${s}@test.dev`);
  const B = await mk('b' + s, `b${s}@test.dev`);
  await A.db.collection('users').doc(A.uid).set({ displayName: 'Ana' });
  await B.db.collection('users').doc(B.uid).set({ displayName: 'Bea' });
  const na = `ana.${s}`, nb = `bea_${s}`;

  await expect('A reserva su nombre y lo pone en su perfil (transacción)', claim(A, na), true);
  await expect('cualquiera puede comprobar si un nombre está libre', B.db.collection('usernames').doc(na).get(), true);
  await expect('B no puede quedarse el nombre de A', claim(B, na, { freeOld: false }), false);
  await expect('B no puede poner en su perfil un nombre que no ha reservado', B.db.collection('users').doc(B.uid).update({ username: na }), false);
  await expect('B no puede reservar un nombre sin ponerlo en su perfil', B.db.collection('usernames').doc(nb).set({ uid: B.uid }), false);
  await expect('B no puede reservar un nombre a nombre de A', B.db.runTransaction(async tx => { tx.set(B.db.collection('usernames').doc(nb), { uid: A.uid }); tx.set(B.db.collection('users').doc(B.uid), { username: nb }, { merge: true }); }), false);
  await expect('formato inválido (mayúsculas)', claim(B, `Bea${s}`), false);
  await expect('formato inválido (punto al final)', claim(B, `bea${s}.`), false);
  await expect('formato inválido (dos puntos seguidos)', claim(B, `be..a${s}`), false);
  await expect('campos extra en la reserva', B.db.runTransaction(async tx => { tx.set(B.db.collection('usernames').doc(nb), { uid: B.uid, extra: 1 }); tx.set(B.db.collection('users').doc(B.uid), { username: nb }, { merge: true }); }), false);
  await expect('B reserva su propio nombre', claim(B, nb), true);
  await expect('B no puede borrar la reserva de A', B.db.collection('usernames').doc(na).delete(), false);
  await expect('A no puede liberar el nombre que tiene puesto', A.db.collection('usernames').doc(na).delete(), false);
  await expect('A no puede quitarse el nombre de usuario', A.db.collection('users').doc(A.uid).update({ username: firebase.firestore.FieldValue.delete() }), false);
  await expect('A no puede modificar una reserva', A.db.collection('usernames').doc(na).update({ uid: B.uid }), false);
  const na2 = `ana2.${s}`;
  await expect('A cambia de nombre: reserva el nuevo y libera el antiguo', claim(A, na2), true);
  const freed = await B.db.collection('usernames').doc(na).get();
  results.push({ label: 'el nombre antiguo de A queda libre', pass: !freed.exists, expected: 'libre', got: freed.exists ? 'ocupado' : 'libre' });
  await expect('B puede quedarse ahora el nombre antiguo de A', claim(B, na), true);
  await expect('A sigue editando el resto de su perfil sin tocar el nombre de usuario', A.db.collection('users').doc(A.uid).update({ bio: 'hola' }), true);
  await expect('otra persona sigue pudiendo actualizar contadores', B.db.collection('users').doc(A.uid).update({ 'stats.followersCount': 1 }), true);
  await expect('nadie más puede cambiar el nombre de usuario de A', B.db.collection('users').doc(A.uid).update({ username: na }), false);

  const failed = results.filter(r => !r.pass);
  results.forEach(r => console.log((r.pass ? 'OK  ' : 'FALLA') + ' ' + r.label + (r.pass ? '' : `  → esperado ${r.expected}, obtenido ${r.got}`)));
  console.log(`\n${results.length - failed.length}/${results.length} correctas`);
  process.exit(failed.length ? 1 : 0);
})();

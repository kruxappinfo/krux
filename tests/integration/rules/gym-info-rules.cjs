const path = require('node:path');
const ROOT = path.resolve(__dirname, '../../..');
// Reglas de gym_info (información de rocódromos de la comunidad) y de sus votos, contra el emulador local (proyecto demo).
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
  return { db, uid: cred.user.uid, FV: firebase.firestore.FieldValue };
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
  const C = await mk('c' + stamp, `c${stamp}@test.dev`);
  const SA = await mk('sa' + stamp, 'krux.app.info@gmail.com');
  const gym = 'roco-' + stamp;
  const info = (u, id) => u.db.collection('gym_info').doc(id);
  const vote = (u, id) => info(u, id).collection('votes').doc(u.uid);
  const base = (u, over) => Object.assign({ gymId: gym, kind: 'hours', text: 'L–V 10–23', authorId: u.uid, authorName: 'A', createdAt: u.FV.serverTimestamp(), up: 0, down: 0 }, over || {});
  const voteBatch = (u, id, counters, v) => { const b = u.db.batch(); b.update(info(u, id), counters); if (v) b.set(vote(u, id), { v }); else b.delete(vote(u, id)); return b.commit(); };

  await expect('crear horario propio', info(A, 'h1').set(base(A)), true);
  await expect('crear con contadores inflados', info(A, 'h2').set(base(A, { up: 9 })), false);
  await expect('crear a nombre de otro', info(A, 'h3').set(base(A, { authorId: B.uid })), false);
  await expect('crear tipo no admitido', info(A, 'h4').set(base(A, { kind: 'spam' })), false);
  await expect('crear horario vacío', info(A, 'h5').set(base(A, { text: '' })), false);
  await expect('otro usuario lee', info(B, 'h1').get(), true);
  await expect('foto con ruta propia', info(A, 'p1').set((({ text, ...r }) => r)(base(A, { kind: 'photo', photoUrl: 'https://x/y.jpg', storagePath: `gym-photos/${A.uid}/${gym}_1.jpg` }))), true);
  await expect('foto con ruta de otro usuario', info(A, 'p2').set((({ text, ...r }) => r)(base(A, { kind: 'photo', photoUrl: 'https://x/y.jpg', storagePath: `gym-photos/${B.uid}/x.jpg` }))), false);
  const facId = `${gym}__facility__parking`;
  await expect('instalación con id fijo', info(A, facId).set((({ text, ...r }) => r)(base(A, { kind: 'facility', value: 'parking' }))), true);
  await expect('instalación con id libre', info(A, 'f2').set((({ text, ...r }) => r)(base(A, { kind: 'facility', value: 'duchas' }))), false);

  await expect('voto: me gusta con su contador', voteBatch(B, 'h1', { up: 1, down: 0 }, 1), true);
  await expect('voto: repetir me gusta sin cambio', voteBatch(B, 'h1', { up: 2, down: 0 }, 1), false);
  await expect('voto: solo contador, sin voto', info(C, 'h1').update({ up: 2 }), false);
  await expect('voto: solo voto, sin contador', vote(C, 'h1').set({ v: 1 }), false);
  await expect('voto: contador +2', voteBatch(C, 'h1', { up: 3, down: 0 }, 1), false);
  await expect('voto: valor 5', voteBatch(C, 'h1', { up: 2, down: 0 }, 5), false);
  await expect('voto: otro usuario, me gusta', voteBatch(C, 'h1', { up: 2, down: 0 }, 1), true);
  await expect('voto: cambiar a no me gusta', voteBatch(B, 'h1', { up: 1, down: 1 }, -1), true);
  await expect('voto: retirar', voteBatch(B, 'h1', { up: 1, down: 0 }, 0), true);
  await expect('voto: el autor no vota lo suyo', voteBatch(A, 'h1', { up: 2, down: 0 }, 1), false);
  await expect('voto: tocar el texto al votar', (() => { const b = B.db.batch(); b.update(info(B, 'h1'), { up: 2, text: 'otro' }); b.set(vote(B, 'h1'), { v: 1 }); return b.commit(); })(), false);
  await expect('voto: escribir el voto de otro', info(B, 'h1').collection('votes').doc(C.uid).set({ v: -1 }), false);

  await expect('editar texto ajeno', info(B, 'h1').update({ text: 'cambiado' }), false);
  await expect('borrar ajeno', info(B, 'h1').delete(), false);
  await expect('super-admin restaura', info(SA, 'h1').update({ restored: true }), true);
  await expect('autor borra lo suyo', info(A, 'p1').delete(), true);
  await expect('super-admin borra', info(SA, 'h1').delete(), true);
  await expect('listar por rocódromo', B.db.collection('gym_info').where('gymId', '==', gym).get(), true);

  const failed = results.filter(r => !r.pass);
  results.forEach(r => console.log((r.pass ? 'OK  ' : 'FALLA') + ' ' + r.label + (r.pass ? '' : `  → esperado ${r.expected}, obtenido ${r.got}`)));
  console.log(`\n${results.length - failed.length}/${results.length} correctas`);
  process.exit(failed.length ? 1 : 0);
})();

const path = require('node:path');
const ROOT = path.resolve(__dirname, '../../..');
// Reglas de gym_info (información de rocódromos de la comunidad) y de gym_reports (denuncias), contra el emulador local.
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
  const SA = await mk('sa' + stamp, 'krux.app.info@gmail.com');
  const gym = 'roco-' + stamp;
  const info = (u, id) => u.db.collection('gym_info').doc(id.length < 12 ? `${id}-${stamp}` : id);
  const rep = (u, id) => u.db.collection('gym_reports').doc(id);
  const iid = (id) => `${id}-${stamp}`;   // los ids cortos se sufijan con la marca de tiempo: cada ejecución parte de cero
  const base = (u, over) => Object.assign({ gymId: gym, kind: 'hours', text: 'L–V 10–23', authorId: u.uid, authorName: 'A', createdAt: u.FV.serverTimestamp() }, over || {});
  const noText = (o) => { const { text, ...r } = o; return r; };

  // Aportaciones
  await expect('crear horario propio', info(A, 'h1').set(base(A)), true);
  await expect('crear con contador (campo ya no existe)', info(A, 'h2').set(base(A, { up: 0 })), false);
  await expect('crear a nombre de otro', info(A, 'h3').set(base(A, { authorId: B.uid })), false);
  await expect('crear tipo no admitido', info(A, 'h4').set(base(A, { kind: 'spam' })), false);
  await expect('crear horario vacío', info(A, 'h5').set(base(A, { text: '' })), false);
  await expect('otro usuario lee', info(B, 'h1').get(), true);
  await expect('foto con ruta propia', info(A, 'p1').set(noText(base(A, { kind: 'photo', photoUrl: 'https://x/y.jpg', storagePath: `gym-photos/${A.uid}/${gym}_1.jpg` }))), true);
  await expect('foto con ruta de otro usuario', info(A, 'p2').set(noText(base(A, { kind: 'photo', photoUrl: 'https://x/y.jpg', storagePath: `gym-photos/${B.uid}/x.jpg` }))), false);
  await expect('instalación con id fijo', info(A, `${gym}__facility__parking`).set(noText(base(A, { kind: 'facility', value: 'parking' }))), true);
  await expect('instalación con id libre', info(A, 'f2').set(noText(base(A, { kind: 'facility', value: 'duchas' }))), false);
  const link = (u, over) => noText(base(u, Object.assign({ kind: 'link', network: 'instagram', url: 'https://www.instagram.com/sharma' }, over || {})));
  await expect('enlace: Instagram https', info(A, 'l1').set(link(A)), true);
  await expect('enlace: red desconocida', info(A, 'l2').set(link(A, { network: 'myspace' })), false);
  await expect('enlace: sin https', info(A, 'l3').set(link(A, { url: 'http://x.com/a' })), false);
  await expect('enlace: esquema javascript', info(A, 'l4').set(link(A, { url: 'javascript:alert(1)' })), false);
  await expect('enlace: con espacios', info(A, 'l5').set(link(A, { url: 'https://a.com/x y' })), false);

  // Ya no hay votos: nadie modifica una aportación salvo el admin
  await expect('editar la propia (solo admin edita)', info(A, 'h1').update({ text: 'cambiado' }), false);
  await expect('editar ajena', info(B, 'h1').update({ text: 'cambiado' }), false);
  await expect('subcolección de votos retirada', info(B, 'h1').collection('votes').doc(B.uid).set({ v: 1 }), false);
  await expect('borrar ajeno', info(B, 'h1').delete(), false);

  // Denuncias
  const report = (u, infoId, over) => Object.assign({ infoId: iid(infoId), gymId: gym, kind: 'hours', reason: 'incorrect', proposal: 'Abre a las 9', reporterId: u.uid, reporterName: 'B', createdAt: u.FV.serverTimestamp(), status: 'open' }, over || {});
  const rid = (u, id) => `${iid(id)}__${u.uid}`;
  await expect('denuncia: B denuncia h1 con propuesta', rep(B, rid(B, 'h1')).set(report(B, 'h1')), true);
  await expect('denuncia: sin propuesta (cadena vacía)', rep(B, rid(B, 'l1')).set(report(B, 'l1', { kind: 'link', proposal: '' })), true);
  await expect('denuncia: repetida por la misma persona (no se puede reescribir)', rep(B, rid(B, 'h1')).set(report(B, 'h1', { proposal: 'otra' })), false);
  await expect('denuncia: id que no es infoId__uid', rep(B, 'cualquiera').set(report(B, 'h1')), false);
  await expect('denuncia: a nombre de otro', rep(B, rid(A, 'p1')).set(report(B, 'p1', { reporterId: A.uid })), false);
  await expect('denuncia: aportación inexistente', rep(B, rid(B, 'no-existe')).set(report(B, 'no-existe')), false);
  await expect('denuncia: motivo inválido', rep(B, rid(B, 'p1')).set(report(B, 'p1', { kind: 'photo', reason: 'odio' })), false);
  await expect('denuncia: estado resuelta al crear', rep(B, rid(B, 'p1')).set(report(B, 'p1', { kind: 'photo', status: 'resolved' })), false);
  await expect('denuncia: propuesta de 600 caracteres', rep(B, rid(B, 'p1')).set(report(B, 'p1', { kind: 'photo', proposal: 'x'.repeat(600) })), false);
  await expect('denuncia: quien la envió la lee', rep(B, rid(B, 'h1')).get(), true);
  await expect('denuncia: otra persona no la lee', rep(A, rid(B, 'h1')).get(), false);
  await expect('denuncia: otra persona no lista', A.db.collection('gym_reports').get(), false);
  await expect('denuncia: el reportero no la modifica', rep(B, rid(B, 'h1')).update({ status: 'resolved' }), false);
  await expect('denuncia: el reportero no la borra', rep(B, rid(B, 'h1')).delete(), false);
  await expect('denuncia: super-admin lista', SA.db.collection('gym_reports').get(), true);
  await expect('denuncia: super-admin la resuelve', rep(SA, rid(B, 'h1')).update({ status: 'resolved' }), true);

  // Moderación
  await expect('super-admin edita una aportación', info(SA, 'h1').update({ text: 'corregido' }), true);
  await expect('autor borra lo suyo', info(A, 'p1').delete(), true);
  await expect('super-admin borra', info(SA, 'h1').delete(), true);
  await expect('listar por rocódromo', B.db.collection('gym_info').where('gymId', '==', gym).get(), true);

  const failed = results.filter(r => !r.pass);
  results.forEach(r => console.log((r.pass ? 'OK  ' : 'FALLA') + ' ' + r.label + (r.pass ? '' : `  → esperado ${r.expected}, obtenido ${r.got}`)));
  console.log(`\n${results.length - failed.length}/${results.length} correctas`);
  process.exit(failed.length ? 1 : 0);
})();

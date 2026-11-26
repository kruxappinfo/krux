const path = require('node:path');
const ROOT = path.resolve(__dirname, '../../..');
// Conversaciones, mensajes, avisos y registro de errores, contra el emulador local y las reglas de firestore.rules.
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
  try { await promise; ok = true; } catch (e) { ok = false; if (!/permission|PERMISSION/i.test(String(e.code + e.message))) label += ` (error inesperado: ${e.code} ${e.message})`; }
  results.push({ label, pass: ok === shouldPass, expected: shouldPass ? 'permitido' : 'denegado', got: ok ? 'permitido' : 'denegado' });
};
const eq = (label, got, want) => results.push({ label, pass: JSON.stringify(got) === JSON.stringify(want), expected: JSON.stringify(want), got: JSON.stringify(got) });

(async () => {
  const s = Date.now();
  const A = await mk('a' + s, `a${s}@test.dev`);
  const B = await mk('b' + s, `b${s}@test.dev`);
  const C = await mk('c' + s, `c${s}@test.dev`);
  const SA = await mk('sa' + s, 'krux.app.info@gmail.com');
  const pair = [A.uid, B.uid].sort();
  const id = `dm_${pair.join('_')}`;
  const conv = (u) => u.db.collection('conversations').doc(id);

  // --- Crear la conversación como getOrCreateConversation (transacción sobre un id que aún no existe) ---
  const createTx = (u) => u.db.runTransaction(async tx => {
    const snap = await tx.get(conv(u));
    if (snap.exists) return 'existía';
    tx.set(conv(u), { participants: pair, participantInfo: {}, lastMessage: '', lastMessageTime: FV.serverTimestamp(), unreadCount: { [A.uid]: 0, [B.uid]: 0 } });
    return 'creada';
  });
  await expect('A crea la conversación en una transacción', createTx(A), true);
  let second; await expect('B, a la vez, encuentra la misma', createTx(B).then(r => { second = r; }), true);
  eq('no se duplica', second, 'existía');
  await expect('C no crea una conversación ajena', C.db.collection('conversations').doc('x' + s).set({ participants: [A.uid, B.uid] }), false);
  await expect('A no crea una conversación consigo mismo', A.db.collection('conversations').doc('y' + s).set({ participants: [A.uid, A.uid] }), false);
  await expect('A no crea una de tres', A.db.collection('conversations').doc('z' + s).set({ participants: [A.uid, B.uid, C.uid] }), false);
  await expect('C no lee la conversación', conv(C).get(), false);

  // --- Mensajes (lote mensaje + bandeja, como sendMessage) ---
  const send = (u, to, text, extra = {}) => { const b = u.db.batch(); const ref = conv(u).collection('messages').doc(); b.set(ref, { senderId: u.uid, text, timestamp: FV.serverTimestamp(), status: 'sent', ...extra }); b.update(conv(u), { lastMessage: text, lastMessageTime: FV.serverTimestamp(), [`unreadCount.${to}`]: FV.increment(1) }); return b.commit().then(() => ref); };
  let mA, mB;
  await expect('A envía', send(A, B.uid, 'hola').then(r => { mA = r; }), true);
  await expect('B contesta compartiendo una publicación', send(B, A.uid, 'mira', { sharedPost: { id: 'p1' } }).then(r => { mB = r; }), true);
  await expect('A no envía a nombre de B', conv(A).collection('messages').add({ senderId: B.uid, text: 'soy B', status: 'sent' }), false);
  await expect('A no mete campos raros', conv(A).collection('messages').add({ senderId: A.uid, text: 'x', status: 'sent', admin: true }), false);
  await expect('C no envía', conv(C).collection('messages').add({ senderId: C.uid, text: 'intruso', status: 'sent' }), false);
  await expect('A marca como leído el de B', conv(A).collection('messages').doc(mB.id).update({ status: 'read' }), true);
  await expect('A no marca como leído el suyo', conv(A).collection('messages').doc(mA.id).update({ status: 'read' }), false);
  // --- Doble tic: recibido ---
  let mB2;
  await expect('B envía otro', send(B, A.uid, 'otro').then(r => { mB2 = r; }), true);
  await expect('A no marca como recibido el suyo', conv(A).collection('messages').doc(mA.id).update({ deliveredAt: FV.serverTimestamp() }), false);
  await expect('A no pone una hora inventada', conv(A).collection('messages').doc(mB2.id).update({ deliveredAt: new Date(2020, 0, 1) }), false);
  await expect('A no marca recibido y cambia el texto a la vez', conv(A).collection('messages').doc(mB2.id).update({ deliveredAt: FV.serverTimestamp(), text: 'x' }), false);
  await expect('C no marca como recibido', conv(C).collection('messages').doc(mB2.id).update({ deliveredAt: FV.serverTimestamp() }), false);
  await expect('A marca como recibido el de B', conv(A).collection('messages').doc(mB2.id).update({ deliveredAt: FV.serverTimestamp() }), true);
  await expect('A no lo vuelve a marcar (no cambia la hora)', conv(A).collection('messages').doc(mB2.id).update({ deliveredAt: FV.serverTimestamp() }), false);
  await expect('A lo marca como leído después', conv(A).collection('messages').doc(mB2.id).update({ status: 'read' }), true);
  await expect('B no se pone a sí mismo «recibido» al crear', conv(B).collection('messages').add({ senderId: B.uid, text: 'x', status: 'sent', deliveredAt: FV.serverTimestamp() }), false);
  await expect('A no edita el texto de B', conv(A).collection('messages').doc(mB.id).update({ text: 'cambiado' }), false);
  await expect('A no borra el mensaje de B', conv(A).collection('messages').doc(mB.id).delete(), false);
  await expect('A borra su mensaje', conv(A).collection('messages').doc(mA.id).delete(), true);

  // --- Bandeja: leer, vaciar solo para mí ---
  await expect('A pone a 0 sus no leídos', conv(A).update({ [`unreadCount.${A.uid}`]: 0 }), true);
  await expect('A vacía la conversación para sí', conv(A).update({ [`clearedAt.${A.uid}`]: FV.serverTimestamp(), [`unreadCount.${A.uid}`]: 0 }), true);
  await expect('A no la vacía para B', conv(A).update({ [`clearedAt.${B.uid}`]: FV.serverTimestamp() }), false);
  await expect('A no cambia quién participa', conv(A).update({ participants: [A.uid, C.uid].sort() }), false);
  await expect('A no cambia los nombres guardados', conv(A).update({ participantInfo: { [B.uid]: { displayName: 'x' } } }), false);
  await expect('A no borra la conversación de los dos', conv(A).delete(), false);
  const left = (await conv(B).collection('messages').get()).size;
  eq('a B le quedan sus mensajes', left, 2);

  // --- Avisos ---
  const notif = (u, target, nid) => u.db.collection('users').doc(target).collection('notifications').doc(nid);
  const base = (u, type) => ({ type, text: 'le dio like a tu publicación', fromUserId: u.uid, fromUserName: 'Ana', fromUserPhoto: 'https://x/y.jpg', read: false, createdAt: FV.serverTimestamp() });
  await expect('A avisa a B de un like (id tipo_uid_recurso)', notif(A, B.uid, `like_${A.uid}_p1`).set({ ...base(A, 'like'), postId: 'p1' }), true);
  await expect('A vuelve a avisar (sobrescribe su aviso)', notif(A, B.uid, `like_${A.uid}_p1`).set({ ...base(A, 'like'), postId: 'p1' }), true);
  await expect('A avisa de que sigue a B', notif(A, B.uid, `follow_${A.uid}_`).set(base(A, 'follow')), true);
  await expect('A no avisa a nombre de C', notif(A, B.uid, `like_${C.uid}_p1`).set({ ...base(A, 'like'), fromUserId: C.uid }), false);
  await expect('A no usa un id cualquiera', notif(A, B.uid, 'spam' + s).set(base(A, 'like')), false);
  await expect('A no inventa tipos', notif(A, B.uid, `hack_${A.uid}_1`).set(base(A, 'hack')), false);
  await expect('A no manda textos enormes', notif(A, B.uid, `comment_${A.uid}_p2`).set({ ...base(A, 'comment'), text: 'x'.repeat(2000) }), false);
  await expect('A no manda avisos ya leídos', notif(A, B.uid, `comment_${A.uid}_p3`).set({ ...base(A, 'comment'), read: true }), false);
  await expect('B marca el aviso como leído', notif(B, B.uid, `like_${A.uid}_p1`).update({ read: true }), true);
  await expect('A borra su aviso (al quitar el like)', notif(A, B.uid, `like_${A.uid}_p1`).delete(), true);
  await expect('C no borra avisos de A', notif(C, B.uid, `follow_${A.uid}_`).delete(), false);

  // --- Registro de errores ---
  const err = (u, extra = {}) => u.db.collection('client_errors').add({ kind: 'console', message: 'Error toggling like', code: 'unavailable', stack: '', source: '', view: 'feed-view', version: 'v330', platform: 'web', online: true, ua: 'test', at: FV.serverTimestamp(), ...extra });
  await expect('cualquiera con sesión registra un error', err(A), true);
  await expect('no se registran campos de más (uid)', err(A, { uid: A.uid }), false);
  await expect('no se registran mensajes enormes', err(A, { message: 'x'.repeat(600) }), false);
  await expect('un usuario no lee los errores', A.db.collection('client_errors').limit(1).get(), false);
  await expect('el superadmin los lee', SA.db.collection('client_errors').limit(5).get(), true);

  const failed = results.filter(r => !r.pass);
  results.forEach(r => console.log((r.pass ? 'OK  ' : 'FALLA') + ' ' + r.label + (r.pass ? '' : `  → esperado ${r.expected}, obtenido ${r.got}`)));
  console.log(`\n${results.length - failed.length}/${results.length} correctas`);
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('ERROR', e); process.exit(1); });

const path = require('node:path');
const ROOT = path.resolve(__dirname, '../../..');
// Publicaciones, comentarios, respuestas y mensajes: lo que hace la app y lo que ya no se puede hacer a nombre de otro.
// Contra el emulador local y las reglas de firestore.rules.
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

// Igual que kxAddWithCounter / kxDeleteWithCounter de app_3.js
const addWithCounter = (u, colRef, data, counterRef, field) => {
  const ref = colRef.doc(); const b = u.db.batch();
  b.set(ref, data); b.update(counterRef, { [field]: FV.increment(1) });
  return b.commit().then(() => ref);
};
const delWithCounter = (u, docRef, counterRef, field) => {
  const b = u.db.batch(); b.delete(docRef); b.update(counterRef, { [field]: FV.increment(-1) }); return b.commit();
};

(async () => {
  const s = Date.now();
  const A = await mk('a' + s, `a${s}@test.dev`);
  const B = await mk('b' + s, `b${s}@test.dev`);
  const C = await mk('c' + s, `c${s}@test.dev`);
  const post = (u, id) => u.db.collection('posts').doc(id);

  // --- Publicaciones ---
  const pid = 'p' + s, oldPid = 'old' + s;
  await expect('A publica a su nombre', post(A, pid).set({ userId: A.uid, content: 'hola', likes: [], commentsCount: 0 }), true);
  await expect('A no publica a nombre de B', post(A, 'fake' + s).set({ userId: B.uid, content: 'soy B' }), false);
  await expect('A no publica sin autor', post(A, 'anon' + s).set({ content: 'x' }), false);
  await expect('publicación antigua con likes: 0', post(A, oldPid).set({ userId: A.uid, likes: 0, commentsCount: 0 }), true);

  // Likes
  await expect('B da like', post(B, pid).update({ likes: FV.arrayUnion(B.uid) }), true);
  await expect('C da like', post(C, pid).update({ likes: FV.arrayUnion(C.uid) }), true);
  await expect('B da like a una publicación antigua (likes: 0)', post(B, oldPid).update({ likes: FV.arrayUnion(B.uid) }), true);
  await expect('B quita su like', post(B, pid).update({ likes: FV.arrayRemove(B.uid) }), true);
  await expect('B quitar un like que no tiene no rompe', post(B, pid).update({ likes: FV.arrayRemove(B.uid) }), true);
  await expect('B no quita el like de C', post(B, pid).update({ likes: FV.arrayRemove(C.uid) }), false);
  await expect('B no pone un like a nombre de A', post(B, pid).update({ likes: FV.arrayUnion(A.uid) }), false);
  await expect('B no vacía la lista de likes', post(B, pid).update({ likes: [] }), false);
  await expect('B no cambia el texto', post(B, pid).update({ content: 'hackeado' }), false);
  await expect('B no se hace autor', post(B, pid).update({ userId: B.uid }), false);
  await expect('B no pone commentsCount a 999', post(B, pid).update({ commentsCount: 999 }), false);
  await expect('B no sube commentsCount de 2 en 2', post(B, pid).update({ commentsCount: FV.increment(2) }), false);
  await expect('B no borra la publicación', post(B, pid).delete(), false);
  eq('likes quedan [C]', (await post(A, pid).get()).data().likes, [C.uid]);

  // --- Comentarios ---
  let cRef;
  await expect('B comenta (comentario + contador en un lote)', addWithCounter(B, post(B, pid).collection('comments'), { userId: B.uid, text: 'buena' }, post(B, pid), 'commentsCount').then(r => { cRef = r; }), true);
  eq('commentsCount = 1', (await post(A, pid).get()).data().commentsCount, 1);
  await expect('B no comenta a nombre de C', addWithCounter(B, post(B, pid).collection('comments'), { userId: C.uid, text: 'x' }, post(B, pid), 'commentsCount'), false);
  eq('lo rechazado no sube el contador', (await post(A, pid).get()).data().commentsCount, 1);
  const cB = (u) => u.db.collection('posts').doc(pid).collection('comments').doc(cRef.id);
  await expect('C da like al comentario', cB(C).update({ likes: FV.arrayUnion(C.uid) }), true);
  await expect('A da like al comentario', cB(A).update({ likes: FV.arrayUnion(A.uid) }), true);
  await expect('C no quita el like de A del comentario', cB(C).update({ likes: [] }), false);
  await expect('C no edita el comentario de B', cB(C).update({ text: 'x' }), false);
  await expect('C no pone repliesCount a 50', cB(C).update({ repliesCount: 50 }), false);

  // Respuestas
  let rRef;
  await expect('C responde (respuesta + repliesCount en un lote)', addWithCounter(C, cB(C).collection('replies'), { userId: C.uid, text: 'sí', likes: [] }, cB(C), 'repliesCount').then(r => { rRef = r; }), true);
  eq('repliesCount = 1', (await cB(A).get()).data().repliesCount, 1);
  const rC = (u) => cB(u).collection('replies').doc(rRef.id);
  await expect('A da like a la respuesta', rC(A).update({ likes: FV.arrayUnion(A.uid) }), true);
  await expect('A no reescribe los likes de la respuesta', rC(A).update({ likes: [B.uid] }), false);
  await expect('B (autor del comentario) borra la respuesta de C', delWithCounter(B, rC(B), cB(B), 'repliesCount'), true);
  eq('repliesCount = 0', (await cB(A).get()).data().repliesCount, 0);

  // Borrar comentarios
  let c2;
  await expect('C comenta', addWithCounter(C, post(C, pid).collection('comments'), { userId: C.uid, text: 'otro' }, post(C, pid), 'commentsCount').then(r => { c2 = r; }), true);
  await expect('B no borra el comentario de C', delWithCounter(B, post(B, pid).collection('comments').doc(c2.id), post(B, pid), 'commentsCount'), false);
  await expect('C borra su comentario (con contador)', delWithCounter(C, post(C, pid).collection('comments').doc(c2.id), post(C, pid), 'commentsCount'), true);
  await expect('A (autora) borra el comentario de B', delWithCounter(A, cB(A), post(A, pid), 'commentsCount'), true);
  eq('commentsCount = 0', (await post(A, pid).get()).data().commentsCount, 0);
  await expect('A edita su publicación', post(A, pid).update({ content: 'editado' }), true);

  // --- Mensajes (lote mensaje + conversación) ---
  const conv = A.db.collection('conversations').doc('cv' + s);
  await expect('A abre conversación con B', conv.set({ participants: [A.uid, B.uid].sort(), unreadCount: { [A.uid]: 0, [B.uid]: 0 }, lastMessage: '' }), true);
  const send = (u, text) => { const c = u.db.collection('conversations').doc('cv' + s); const b = u.db.batch(); b.set(c.collection('messages').doc(), { senderId: u.uid, text }); b.update(c, { lastMessage: text, [`unreadCount.${u.uid === A.uid ? B.uid : A.uid}`]: FV.increment(1) }); return b.commit(); };
  await expect('A envía (mensaje + bandeja en un lote)', send(A, 'hola'), true);
  await expect('B contesta', send(B, 'qué tal'), true);
  await expect('C no envía a esa conversación', send(C, 'intruso'), false);
  eq('la bandeja tiene el último mensaje', (await conv.get()).data().lastMessage, 'qué tal');

  const failed = results.filter(r => !r.pass);
  results.forEach(r => console.log((r.pass ? 'OK  ' : 'FALLA') + ' ' + r.label + (r.pass ? '' : `  → esperado ${r.expected}, obtenido ${r.got}`)));
  console.log(`\n${results.length - failed.length}/${results.length} correctas`);
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('ERROR', e); process.exit(1); });

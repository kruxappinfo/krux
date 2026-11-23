// Fase 0 — notificaciones (users/{uid}/notifications). Protección PROVISIONAL: acota qué puede escribir un cliente
// en una bandeja ajena; no sustituye a las Cloud Functions. Las escrituras reproducen createNotification (app_3.js:4057):
// id determinista {tipo}_{uidEmisor}_{recurso}, set() con type, text, fromUserId, fromUserName, fromUserPhoto, read:false,
// createdAt serverTimestamp y, según el caso, postId/commentId/replyId.
const L = require('./_lib.cjs');
const { mk, mkAnon, seed, ownerData, exists, expect, check } = L;

(async () => {
  await L.loadFirestoreRules();
  const stamp = Date.now();
  const A = await mk('na' + stamp, `na${stamp}@test.dev`);   // emisor
  const B = await mk('nb' + stamp, `nb${stamp}@test.dev`);   // destinatario
  const C = await mk('nc' + stamp, `nc${stamp}@test.dev`);   // tercero
  const anon = await mkAnon('nan' + stamp);
  const FV = A.FV;
  const inbox = (u, owner) => u.db.collection('users').doc(owner.uid).collection('notifications');
  const doc = (u, owner, id) => inbox(u, owner).doc(id);
  const base = (u, type, over) => Object.assign({ type, text: 'le dio like a tu publicación', fromUserId: u.uid, fromUserName: 'Ana',
    fromUserPhoto: 'https://ui-avatars.com/api/?name=A', read: false, createdAt: FV.serverTimestamp() }, over || {});
  const key = (u, type, res) => `${type}_${u.uid}_${res}`.replace(/[^a-zA-Z0-9_]/g, '_');

  // ---------- creación legítima (las que hace la app hoy) ----------
  await expect('like: emisor crea en la bandeja de B', doc(A, B, key(A, 'like', 'post1')).set(base(A, 'like', { postId: 'post1' })), true);
  await expect('follow: id con recurso vacío (follow_uid_)', doc(A, B, key(A, 'follow', '')).set(base(A, 'follow', { text: 'ha empezado a seguirte' })), true);
  await expect('reply: con postId, commentId y replyId', doc(A, B, key(A, 'reply', 'rep1')).set(base(A, 'reply', { text: 'respondió a tu comentario', postId: 'post1', commentId: 'c1', replyId: 'rep1' })), true);
  await expect('comment: con postId y commentId', doc(A, B, key(A, 'comment', 'post1')).set(base(A, 'comment', { text: 'comentó en tu publicación', postId: 'post1', commentId: 'c9' })), true);
  await expect('mention: postId vacío (sendMentionNotifications pasa postId || "")', doc(A, B, key(A, 'mention', '')).set(base(A, 'mention', { text: 'te mencionó en una publicación', postId: '' })), true);
  await expect('createNotification hace get() del documento de destino ANTES de crear (inexistente)', doc(A, B, key(A, 'like', 'inexistente')).get(), true,
    'si esto se denegara, el cliente actual dejaría de crear notificaciones sin avisar');

  // ---------- creación abusiva ----------
  await expect('sin autenticar', anon.db.collection('users').doc(B.uid).collection('notifications').doc(key(A, 'like', 'x1')).set(base(A, 'like')), false);
  await expect('en la propia bandeja', doc(A, A, key(A, 'like', 'self')).set(base(A, 'like')), false);
  await expect('fromUserId de otra persona (suplantación)', doc(A, B, key(A, 'like', 'x2')).set(base(A, 'like', { fromUserId: C.uid })), false);
  await expect('id con el uid de otra persona (pisar su notificación)', doc(A, B, key(C, 'like', 'x3')).set(base(A, 'like')), false);
  await expect('id que no sigue {tipo}_{uid}_', doc(A, B, 'cualquier-cosa').set(base(A, 'like')), false);
  await expect('id con tipo distinto al del campo type', doc(A, B, key(A, 'follow', 'x4')).set(base(A, 'like')), false);
  await expect('tipo inventado (admin_alert)', doc(A, B, key(A, 'admin_alert', 'x5')).set(base(A, 'admin_alert')), false);
  await expect('tipo vacío', doc(A, B, `_${A.uid}_x6`).set(base(A, '')), false);
  await expect('texto vacío', doc(A, B, key(A, 'like', 'x7')).set(base(A, 'like', { text: '' })), false);
  await expect('texto de 201 caracteres', doc(A, B, key(A, 'like', 'x8')).set(base(A, 'like', { text: 'x'.repeat(201) })), false);
  await expect('texto de 200 caracteres (límite)', doc(A, B, key(A, 'like', 'x8b')).set(base(A, 'like', { text: 'x'.repeat(200) })), true);
  await expect('texto que no es cadena', doc(A, B, key(A, 'like', 'x9')).set(base(A, 'like', { text: 42 })), false);
  await expect('campo adicional (url)', doc(A, B, key(A, 'like', 'x10')).set(base(A, 'like', { url: 'https://evil.example' })), false);
  await expect('campo adicional (type de rol, isAdmin)', doc(A, B, key(A, 'like', 'x11')).set(base(A, 'like', { isAdmin: true })), false);
  await expect('read:true al crear', doc(A, B, key(A, 'like', 'x12')).set(base(A, 'like', { read: true })), false);
  await expect('createdAt con fecha del cliente', doc(A, B, key(A, 'like', 'x13')).set(base(A, 'like', { createdAt: new Date(Date.now() - 5000) })), false);
  await expect('createdAt ausente', doc(A, B, key(A, 'like', 'x14')).set((() => { const d = base(A, 'like'); delete d.createdAt; return d; })()), false);
  await expect('fromUserPhoto con esquema no https (javascript:)', doc(A, B, key(A, 'like', 'x15')).set(base(A, 'like', { fromUserPhoto: 'javascript:alert(1)' })), false);
  await expect('fromUserPhoto http', doc(A, B, key(A, 'like', 'x15b')).set(base(A, 'like', { fromUserPhoto: 'http://x/y.png' })), false);
  await expect('fromUserName de 81 caracteres', doc(A, B, key(A, 'like', 'x16')).set(base(A, 'like', { fromUserName: 'n'.repeat(81) })), false);
  await expect('postId demasiado largo', doc(A, B, key(A, 'like', 'x17')).set(base(A, 'like', { postId: 'p'.repeat(101) })), false);

  // ---------- lectura ----------
  await expect('el dueño lee su bandeja (lista)', inbox(B, B).get(), true);
  await expect('el dueño lee una notificación', doc(B, B, key(A, 'like', 'post1')).get(), true);
  await expect('A lista la bandeja de B sin filtro', inbox(A, B).get(), false);
  await expect('C lee una notificación de B (no es suya ni la creó)', doc(C, B, key(A, 'like', 'post1')).get(), false);
  await expect('A lee la notificación que él creó', doc(A, B, key(A, 'like', 'post1')).get(), true);
  await expect('A lista solo lo que él creó (where fromUserId == A)', inbox(A, B).where('fromUserId', '==', A.uid).get(), true);
  await expect('sin autenticar lee una bandeja', anon.db.collection('users').doc(B.uid).collection('notifications').get(), false);

  // ---------- actualización ----------
  await expect('el dueño marca como leída (update({read:true}))', doc(B, B, key(A, 'like', 'post1')).update({ read: true }), true);
  await expect('el dueño marca todas como leídas (batch)', (() => { const b = B.db.batch(); ['follow_' + A.uid + '_', key(A, 'comment', 'post1')].forEach(i => b.update(doc(B, B, i), { read: true })); return b.commit(); })(), true);
  await expect('el dueño cambia el texto', doc(B, B, key(A, 'like', 'post1')).update({ text: 'otro' }), false);
  await expect('el dueño cambia fromUserId', doc(B, B, key(A, 'like', 'post1')).update({ fromUserId: C.uid }), false);
  await expect('el dueño marca como leída y cambia el texto a la vez', doc(B, B, key(A, 'like', 'post1')).update({ read: true, text: 'x' }), false);
  await expect('C marca como leída una notificación ajena', doc(C, B, key(A, 'like', 'post1')).update({ read: true }), false);
  await expect('el emisor la modifica de inmediato (update)', doc(A, B, key(A, 'like', 'post1')).update({ text: 'otra cosa' }), false);
  await expect('el emisor repite el set() (createNotification de menos de 1 h)', doc(A, B, key(A, 'like', 'post1')).set(base(A, 'like', { postId: 'post1' })), false);
  // Renotificar pasada 1 h: createNotification hace set() sobre la existente. Hoy se rechaza en silencio.
  const oldId = key(A, 'like', 'post-viejo');
  await seed(`users/${B.uid}/notifications/${oldId}`, { type: 'like', text: 'viejo', fromUserId: A.uid, fromUserName: 'Ana', read: true, createdAt: new Date(Date.now() - 2 * 3600 * 1000) });
  await expect('el emisor renotifica pasada 1 h (set sobre la existente)', doc(A, B, oldId).set(base(A, 'like', { postId: 'post-viejo' })), true,
    'arregla el fallo actual: este set() hoy se rechaza porque solo el dueño puede actualizar');
  const oldId2 = key(A, 'like', 'post-viejo2');
  await seed(`users/${B.uid}/notifications/${oldId2}`, { type: 'like', text: 'viejo', fromUserId: A.uid, read: true, createdAt: new Date(Date.now() - 2 * 3600 * 1000) });
  await expect('otra persona renotifica sobre la notificación de A', doc(C, B, oldId2).set(base(C, 'like', { postId: 'post-viejo2' })), false);

  // ---------- borrado ----------
  await expect('C borra una notificación ajena', doc(C, B, key(A, 'comment', 'post1')).delete(), false);
  await expect('el emisor borra la que creó (unlike / unfollow)', doc(A, B, key(A, 'comment', 'post1')).delete(), true);
  await expect('el dueño borra una de su bandeja', doc(B, B, key(A, 'reply', 'rep1')).delete(), true);
  check('las notificaciones legítimas restantes siguen existiendo', await exists(`users/${B.uid}/notifications/${key(A, 'like', 'post1')}`));

  L.finish('notifications-rules.cjs');
  process.exit(process.exitCode || 0);
})().catch(e => { console.error('ERROR FATAL', String(e.message).slice(0, 300), '\nÚltima prueba registrada:', L.results.length ? L.results[L.results.length - 1].label : '(ninguna)'); process.exit(2); });

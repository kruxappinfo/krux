const path = require('node:path');
const ROOT = path.resolve(__dirname, '../../..');
// Doble tic de los mensajes directos: el MessagingService real de user-features.js, con dos cuentas a la vez
// (cada una en su propio contexto), contra el emulador local y las reglas de firestore.rules.
const firebase = require(path.join(ROOT, 'node_modules/firebase/compat/app'));
require(path.join(ROOT, 'node_modules/firebase/compat/auth'));
require(path.join(ROOT, 'node_modules/firebase/compat/firestore'));

const src = require('node:fs').readFileSync(path.join(ROOT, 'user-features.js'), 'utf8');
const block = src.slice(src.indexOf('window.MessagingService = {'), src.indexOf('\n};', src.indexOf('window.MessagingService = {')) + 3);

const mk = async (name, email) => {
  const app = firebase.initializeApp({ apiKey: 'fake', projectId: 'demo-krux-audit', authDomain: 'x' }, name);
  app.auth().useEmulator('http://127.0.0.1:9109', { disableWarnings: true });
  const db = app.firestore(); db.useEmulator('127.0.0.1', 8089);
  try { await app.auth().createUserWithEmailAndPassword(email, 'password123'); }
  catch (e) { await app.auth().signInWithEmailAndPassword(email, 'password123'); }
  // Mismo «realm» que el SDK (un contexto vm aparte da arrays que Firestore rechaza); globals propios de cada cuenta
  const ctx = { window: {}, navigator: { onLine: true } };
  const store = new Map(), localStorage = { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
  const load = new Function('window', 'db', 'navigator', 'firebase', 'localStorage', `let MessagingService;\n${block}\nMessagingService = window.MessagingService;\nreturn MessagingService;`);
  const svc = load(ctx.window, db, ctx.navigator, { auth: () => app.auth(), firestore: firebase.firestore }, localStorage);
  return { uid: app.auth().currentUser.uid, db, ctx, svc };
};

// Lo mismo que pinta el chat (app_3.js renderChatMessages) para un mensaje propio
const tick = (m) => !m.timestamp ? 'enviando' : m.status === 'read' ? 'leído' : m.deliveredAt ? 'recibido' : 'enviado';

const results = [];
const check = (label, ok, extra) => results.push({ label: label + (ok ? '' : ` → ${extra}`), pass: !!ok });
const wait = (ms) => new Promise(r => setTimeout(r, ms));
// Espera a que la escucha en tiempo real de A cumpla la condición (o se rinde a los 5 s)
const until = async (getter, cond) => { for (let i = 0; i < 50; i++) { const v = getter(); if (v && cond(v)) return v; await wait(100); } return getter(); };

(async () => {
  const s = Date.now();
  const A = await mk('a' + s, `a${s}@test.dev`);
  const B = await mk('b' + s, `b${s}@test.dev`);

  const conv = await A.svc.getOrCreateConversation(B.uid, { displayName: 'B' });
  await A.svc.sendMessage(conv.id, 'hola', B.uid);
  await A.svc.sendMessage(conv.id, '¿vienes mañana a Patones?', B.uid);

  // A tiene el chat abierto: ve sus mensajes en tiempo real
  let seenByA = null;
  const unsubA = A.svc.subscribeToMessages(conv.id, (msgs) => { seenByA = msgs; });
  const mineA = () => seenByA && seenByA.filter(m => m.senderId === A.uid);
  let list = await until(mineA, l => l.length === 2 && l.every(m => m.timestamp));
  check('A ve sus 2 mensajes con un tic (enviado)', list.length === 2 && list.every(m => tick(m) === 'enviado'), list.map(tick).join());

  // B, sin conexión, no confirma nada
  B.ctx.navigator.onLine = false;
  await B.svc.markAsDelivered(conv.id, 'x');
  await wait(400);
  check('sin conexión B no marca nada', mineA().every(m => tick(m) === 'enviado'), mineA().map(tick).join());
  B.ctx.navigator.onLine = true;

  // B abre la app: su bandeja recibe la conversación con no leídos y confirma la llegada (como app_3.js)
  const unsubB = B.svc.subscribeToConversations((convs) => {
    convs.forEach(c => {
      if ((c.unreadCount?.[B.uid] || 0) > 0) {
        const t = c.lastMessageTime?.toMillis ? c.lastMessageTime.toMillis() : 0;
        if (t) B.svc.markAsDelivered(c.id, String(t));
      }
    });
  });
  list = await until(mineA, l => l.every(m => tick(m) === 'recibido'));
  check('A ve doble tic gris (recibido) sin que B abra el chat', list.every(m => tick(m) === 'recibido'), list.map(tick).join());
  check('recibido no cambia status (las apps antiguas siguen marcando leído)', list.every(m => m.status === 'sent'));

  // Un mensaje nuevo con B con la app abierta llega solo al doble tic
  await A.svc.sendMessage(conv.id, 'te espero a las 9', B.uid);
  list = await until(mineA, l => l.length === 3 && l.every(m => tick(m) === 'recibido'));
  check('un mensaje nuevo pasa a recibido solo', list.length === 3 && list.every(m => tick(m) === 'recibido'), list.map(tick).join());

  // Repetir con la misma clave no vuelve a escribir (la hora de recibido no cambia)
  const before = list.map(m => m.deliveredAt.toMillis()).join();
  await B.svc.markAsDelivered(conv.id, 'otra-clave');
  await wait(400);
  check('volver a confirmar no cambia la hora de recibido', mineA().map(m => m.deliveredAt.toMillis()).join() === before);

  // Los mensajes de B no los marca B como recibidos (solo los que le llegan)
  await B.svc.sendMessage(conv.id, 'vale', A.uid);
  await B.svc.markAsDelivered(conv.id, 'b-propios');
  await wait(400);
  const fromB = seenByA.find(m => m.senderId === B.uid);
  check('B no confirma sus propios mensajes', fromB && !fromB.deliveredAt, JSON.stringify(fromB));

  // A también los recibe: el de B pasa a doble tic para B
  await A.svc.markAsDelivered(conv.id, 'a');
  const fromB2 = await until(() => seenByA.find(m => m.senderId === B.uid), m => m.deliveredAt);
  check('A confirma el mensaje de B', fromB2 && fromB2.deliveredAt);

  // B abre el chat y lee: doble tic de color, y la hora de recibido se conserva
  await B.svc.markAsRead(conv.id);
  list = await until(mineA, l => l.every(m => tick(m) === 'leído'));
  check('al leer, A ve doble tic de color (leído)', list.every(m => tick(m) === 'leído'), list.map(tick).join());
  check('leído conserva la hora de recibido', list.every(m => m.deliveredAt));
  const convB = (await B.db.collection('conversations').doc(conv.id).get()).data();
  check('el contador de no leídos de B vuelve a 0', convB.unreadCount[B.uid] === 0, JSON.stringify(convB.unreadCount));

  // Leído sin haber pasado por recibido (app antigua del otro lado) también se pinta como leído
  await A.svc.sendMessage(conv.id, 'último', B.uid);
  const last = await until(() => seenByA.filter(m => m.senderId === A.uid).slice(-1)[0], m => m.timestamp && m.text === 'último');
  await B.db.collection('conversations').doc(conv.id).collection('messages').doc(last.id).update({ status: 'read' });
  const lastRead = await until(() => seenByA.find(m => m.id === last.id), m => m.status === 'read');
  check('leído sin recibido se pinta como leído', tick(lastRead) === 'leído', tick(lastRead));

  // --- Confirmaciones de lectura desactivadas (Ajustes → Privacidad) ---
  const settings = (u, uid) => u.db.collection('users').doc(uid).collection('private').doc('settings');
  const denied = async (label, p) => { try { await p; check(label, false, 'se permitió'); } catch (e) { check(label, /permission/i.test(String(e.code)), e.code); } };
  await B.svc.setReadReceipts(B.uid, false);
  check('B desactiva las confirmaciones de lectura', B.svc.readReceiptsEnabled() === false && (await settings(B, B.uid).get()).data().readReceipts === false);
  await denied('A no lee los ajustes de B', settings(A, B.uid).get());
  await denied('A no cambia los ajustes de B', settings(A, B.uid).set({ readReceipts: true }, { merge: true }));
  await denied('B no guarda un valor que no sea sí/no', settings(B, B.uid).set({ readReceipts: 'no' }, { merge: true }));
  await settings(B, B.uid).set({ weightKg: 70 }, { merge: true });
  check('el peso y el ajuste conviven', (await settings(B, B.uid).get()).data().readReceipts === false);

  await A.svc.sendMessage(conv.id, 'privado', B.uid);
  const priv = await until(() => seenByA.find(m => m.text === 'privado'), m => m.timestamp && m.deliveredAt);
  check('sin confirmaciones sigue llegando el doble tic de recibido', priv && priv.deliveredAt);
  await B.svc.markAsRead(conv.id);
  await wait(600);
  const privAfter = seenByA.find(m => m.text === 'privado');
  check('B lo lee pero A no ve «leído»', privAfter.status === 'sent' && tick(privAfter) === 'recibido', tick(privAfter));
  const convB2 = (await B.db.collection('conversations').doc(conv.id).get()).data();
  check('aun así el contador de B vuelve a 0', convB2.unreadCount[B.uid] === 0, JSON.stringify(convB2.unreadCount));

  // B tampoco ve si A ha leído los suyos (lo pinta el chat: leído solo con las confirmaciones activas)
  const tickFor = (svc, m) => !m.timestamp ? 'enviando' : (m.status === 'read' && svc.readReceiptsEnabled()) ? 'leído' : (m.deliveredAt || m.status === 'read') ? 'recibido' : 'enviado';
  const bLeido = seenByA.find(m => m.senderId === B.uid && m.status === 'read') || fromB2;
  await A.svc.markAsRead(conv.id);
  const bMsg = await until(() => seenByA.find(m => m.id === bLeido.id), m => m.status === 'read');
  check('A sí confirma la lectura (lo tiene activado)', bMsg.status === 'read');
  check('B ve su mensaje como recibido, no como leído', tickFor(B.svc, bMsg) === 'recibido', tickFor(B.svc, bMsg));

  // Al cargar la sesión en otro dispositivo se recupera el ajuste de la cuenta
  const B2 = await mk('b2' + s, `b${s}@test.dev`);
  await B2.svc.loadPrivacy(B2.uid);
  check('otro dispositivo de B carga el ajuste desactivado', B2.svc.readReceiptsEnabled() === false);

  // Reactivarlo: vuelve a marcar como leído
  await B.svc.setReadReceipts(B.uid, true);
  check('reactivar quita el campo', !('readReceipts' in (await settings(B, B.uid).get()).data()));
  await A.svc.sendMessage(conv.id, 'de nuevo', B.uid);
  await until(() => seenByA.find(m => m.text === 'de nuevo'), m => m.timestamp);
  await B.svc.markAsRead(conv.id);
  const again = await until(() => seenByA.find(m => m.text === 'de nuevo'), m => m.status === 'read');
  check('con las confirmaciones activas vuelve el «leído»', tick(again) === 'leído', tick(again));

  // --- Like a un mensaje (doble toque): lo pone quien lo recibe y lo ve quien lo envió al momento ---
  const target = seenByA.find(m => m.text === 'de nuevo');
  await B.svc.setMessageLike(conv.id, target.id, true);
  let liked = await until(() => seenByA.find(m => m.id === target.id), m => (m.likes || []).includes(B.uid));
  check('B da like y A lo ve en tiempo real', (liked.likes || []).includes(B.uid), JSON.stringify(liked.likes));
  await B.svc.setMessageLike(conv.id, target.id, true);
  liked = seenByA.find(m => m.id === target.id);
  check('dar like dos veces no lo duplica', liked.likes.length === 1, JSON.stringify(liked.likes));
  check('el like no cambia el estado de leído', liked.status === 'read');
  let ownDenied = false;
  try { await A.svc.setMessageLike(conv.id, target.id, true); } catch (e) { ownDenied = /permission/i.test(e.code); }
  check('A no puede dar like a su propio mensaje', ownDenied);
  await B.svc.setMessageLike(conv.id, target.id, false);
  liked = await until(() => seenByA.find(m => m.id === target.id), m => !(m.likes || []).length);
  check('B quita el like y A deja de verlo', !(liked.likes || []).length, JSON.stringify(liked.likes));

  unsubA(); unsubB();
  const failed = results.filter(r => !r.pass);
  results.forEach(r => console.log((r.pass ? 'OK  ' : 'FALLA') + ' ' + r.label));
  console.log(`\n${results.length - failed.length}/${results.length} correctas`);
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('ERROR', e); process.exit(1); });

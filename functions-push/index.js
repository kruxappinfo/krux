// ================== PUSH DE KRUX ==================
// Cada notificación nueva de la app (users/{uid}/notifications/{id}, la campana) se envía también como push a los
// móviles del usuario: tokens de FCM en users/{uid}/push_tokens/{id} (los guarda push.js). Los tokens que FCM da por
// caducados se borran. Codebase «push»: se despliega aparte de las funciones que ya hay en el proyecto.
//   firebase deploy --only functions:push

const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');

admin.initializeApp();

const MAX_BODY = 180;
const DEAD_TOKEN = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument'
]);

// Texto plano a partir del HTML de la notificación (la campana lo pinta como HTML; el push no admite marcado)
function plain(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function message(n) {
  const from = plain(n.fromUserName) || 'Alguien';
  let body;
  if (n.type === 'ascent_tag' && n.tag) {
    const t = n.tag;
    body = `${from} te ha añadido como compañero en ${t.routeName || 'una vía'}${t.grade ? ` (${t.grade})` : ''}. Confírmalo para añadirlo a tu registro.`;
  } else {
    // Las notificaciones antiguas de seguimiento ya traen el nombre al principio del texto
    const text = plain(n.text);
    body = text.startsWith(from) ? text : `${from} ${text}`;
  }
  if (body.length > MAX_BODY) body = body.slice(0, MAX_BODY - 1).trimEnd() + '…';
  return { title: 'KRUX', body };
}

exports.pushOnNotification = functions.firestore
  .document('users/{uid}/notifications/{notificationId}')
  .onCreate(async (snap, context) => {
    const n = snap.data() || {};
    const { uid, notificationId } = context.params;
    if (!n.type || n.fromUserId === uid) return null;

    const tokensSnap = await admin.firestore().collection('users').doc(uid).collection('push_tokens').get();
    if (tokensSnap.empty) return null;
    const docs = tokensSnap.docs.filter(d => typeof d.get('token') === 'string');
    if (!docs.length) return null;

    const { title, body } = message(n);
    const data = {
      notificationId: String(notificationId),
      type: String(n.type),
      fromUserId: String(n.fromUserId || ''),
      postId: String(n.postId || '')
    };
    const res = await admin.messaging().sendEachForMulticast({
      tokens: docs.map(d => d.get('token')),
      notification: { title, body },
      data,
      android: { priority: 'high', notification: { channelId: 'krux_default', sound: 'default' } },
      apns: { payload: { aps: { sound: 'default' } } }
    });

    const dead = [];
    res.responses.forEach((r, i) => {
      if (!r.success && r.error && DEAD_TOKEN.has(r.error.code)) dead.push(docs[i].ref.delete());
    });
    await Promise.all(dead);
    functions.logger.info('push', { type: n.type, sent: res.successCount, failed: res.failureCount, removed: dead.length });
    return null;
  });

exports._test = { plain, message };

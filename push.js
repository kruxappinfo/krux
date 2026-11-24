// ================== NOTIFICACIONES PUSH ==================
// Solo en la app nativa (Capacitor). Pide permiso una vez tras iniciar sesión, guarda el token de FCM del móvil en
// users/{uid}/push_tokens/{token} y lo borra al cerrar sesión. El envío lo hace la Cloud Function pushOnNotification
// (functions-push/) con cada notificación nueva de la campana. Al tocar un push se abre lo mismo que al tocar la
// notificación en la campana. La parte nativa (Firebase, APNs) la prepara scripts/native-push.sh.

const KruxPush = (() => {
  const ASKED_KEY = 'krux_push_asked';
  const CHANNEL = 'krux_default';
  let token = null, savedFor = null, listening = false, pendingTap = null;

  const plugin = () => {
    const cap = window.Capacitor;
    return cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform() && cap.Plugins && cap.Plugins.PushNotifications
      ? cap.Plugins.PushNotifications : null;
  };
  const platform = () => (window.Capacitor && window.Capacitor.getPlatform ? window.Capacitor.getPlatform() : 'web');
  const tokens = (uid) => db.collection('users').doc(uid).collection('push_tokens');

  async function save(uid) {
    if (!token || !uid || savedFor === uid) return;
    try {
      await tokens(uid).doc(token).set({ token, platform: platform(), updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
      savedFor = uid;
    } catch (e) { console.warn('[Push] No se pudo guardar el token:', e); }
  }

  // Abre lo que corresponde a la notificación tocada (mismo destino que en la campana)
  function openFromPush(data) {
    if (!data || !data.notificationId) return;
    if (typeof window.handleNotificationClick !== 'function' || !(firebase.auth().currentUser)) { pendingTap = data; return; }
    pendingTap = null;
    if (data.type === 'ascent_tag') {
      // La confirmación se hace desde la campana (con los datos de la vía): se abre la lista de avisos
      if (typeof window.markNotificationRead === 'function') window.markNotificationRead(data.notificationId);
      document.getElementById('notification-btn')?.click();
      return;
    }
    window.handleNotificationClick(data.notificationId, data.type, data.fromUserId || '', data.postId || '', '', '');
  }

  function listen(P) {
    if (listening) return;
    listening = true;
    P.addListener('registration', (t) => {
      token = t && t.value;
      savedFor = null;
      const u = firebase.auth().currentUser;
      if (u) save(u.uid);
    });
    P.addListener('registrationError', (e) => console.warn('[Push] Error de registro:', e));
    P.addListener('pushNotificationActionPerformed', (a) => openFromPush(a && a.notification && a.notification.data));
    // Con la app abierta la campana ya se actualiza sola: no hace falta nada más
  }

  async function start(user) {
    const P = plugin();
    if (!P || !user) return;
    try {
      listen(P);
      if (platform() === 'android' && P.createChannel) {
        P.createChannel({ id: CHANNEL, name: 'Avisos de KRUX', description: 'Seguidores, comentarios, me gusta y compañeros de cordada', importance: 4, visibility: 1 }).catch(() => {});
      }
      let perm = await P.checkPermissions();
      if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') {
        let asked = false;
        try { asked = localStorage.getItem(ASKED_KEY) === '1'; } catch (_) { /* sin almacenamiento */ }
        if (asked) return;
        try { localStorage.setItem(ASKED_KEY, '1'); } catch (_) { /* sin almacenamiento */ }
        perm = await P.requestPermissions();
      }
      if (perm.receive !== 'granted') return;
      if (token) save(user.uid); else await P.register();
      if (pendingTap) openFromPush(pendingTap);
    } catch (e) { console.warn('[Push] No disponible:', e); }
  }

  // Antes de cerrar sesión: este móvil deja de recibir los avisos de esa cuenta
  async function stop() {
    const u = firebase.auth().currentUser;
    if (!u || !token) return;
    try { await tokens(u.uid).doc(token).delete(); } catch (e) { console.warn('[Push] No se pudo borrar el token:', e); }
    savedFor = null;
  }

  if (typeof firebase !== 'undefined' && firebase.auth) {
    // Un poco después del arranque, para no pedir el permiso encima de la pantalla de carga
    firebase.auth().onAuthStateChanged((user) => { if (user) setTimeout(() => start(user), 2500); });
  }

  return { start, stop };
})();

if (typeof window !== 'undefined') window.KruxPush = KruxPush;

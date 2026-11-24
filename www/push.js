// ================== NOTIFICACIONES PUSH ==================
// App nativa (Capacitor) y web instalada (iPhone: añadida a la pantalla de inicio, iOS 16.4+). Guarda el token de FCM
// del dispositivo en users/{uid}/push_tokens/{token} y lo borra al cerrar sesión. El envío lo hace la Cloud Function
// pushOnNotification (functions-push/) con cada notificación nueva de la campana. Al tocar un push se abre lo mismo
// que al tocar la notificación en la campana.
//  - Nativa: pide permiso una vez tras iniciar sesión. La parte nativa la prepara scripts/native-push.sh.
//  - Web: el permiso solo se puede pedir tras un toque (Safari), con el botón «Activar avisos» de la campana.
//    El push lo recibe y lo muestra sw.js; usa la clave VAPID por defecto de Firebase.

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
  const isNative = () => !!(window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform());
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
    if (!data || !(data.notificationId || data.openBell)) return;
    if (typeof window.handleNotificationClick !== 'function' || !(firebase.auth().currentUser)) { pendingTap = data; return; }
    pendingTap = null;
    if (data.openBell || data.type === 'ascent_tag') {
      // La confirmación se hace desde la campana (con los datos de la vía): se abre la lista de avisos
      if (data.notificationId && typeof window.markNotificationRead === 'function') window.markNotificationRead(data.notificationId);
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

  // ---------- Web instalada ----------
  async function webSupported() {
    if (isNative() || !('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return false;
    if (!firebase.messaging || !firebase.messaging.isSupported) return false;
    try { return !!(await firebase.messaging.isSupported()); } catch (_) { return false; }
  }

  function showCta(show) {
    const cta = document.getElementById('notification-push-cta');
    if (cta) cta.hidden = !show;
  }

  async function webRegister(user) {
    try {
      const reg = await navigator.serviceWorker.ready;
      const t = await firebase.messaging().getToken({ serviceWorkerRegistration: reg });
      if (!t) return false;
      if (t !== token) { token = t; savedFor = null; }
      await save(user.uid);
      return savedFor === user.uid;
    } catch (e) {
      console.warn('[Push] No se pudo activar en la web:', e);
      return false;
    }
  }

  async function webStart(user) {
    if (!user || !(await webSupported())) { showCta(false); return; }
    const perm = Notification.permission;
    showCta(perm === 'default');
    if (perm === 'granted') await webRegister(user);
    if (pendingTap) openFromPush(pendingTap);
  }

  async function webEnable(btn) {
    const user = firebase.auth().currentUser;
    if (!user) return;
    if (btn) btn.disabled = true;
    try {
      // Primero el permiso, aún dentro del toque: Safari no lo concede después de un await
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') {
        showCta(false);
        if (typeof showToast === 'function') showToast('Sin permiso no se pueden enviar avisos. Puedes activarlo en los ajustes del dispositivo.', 'info');
        return;
      }
      const ok = await webRegister(user);
      showCta(!ok);
      if (typeof showToast === 'function') showToast(ok ? 'Avisos activados en este dispositivo' : 'No se pudieron activar los avisos', ok ? 'success' : 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('click', (e) => {
      const btn = e.target.closest && e.target.closest('#notification-push-btn');
      if (btn) { e.preventDefault(); webEnable(btn); }
    });
  }
  if (typeof navigator !== 'undefined' && navigator.serviceWorker) {
    // Push tocado con la app ya abierta (lo envía sw.js)
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data && e.data.type === 'KRUX_PUSH_CLICK') openFromPush(e.data.data);
    });
  }
  // Push tocado con la app cerrada: sw.js la abre con ?kxpush=1 y se muestra la campana
  if (typeof location !== 'undefined' && /[?&]kxpush=1/.test(location.search)) {
    pendingTap = { openBell: true };
    try { history.replaceState(null, '', location.pathname + location.hash); } catch (_) { /* sin history */ }
  }

  // Antes de cerrar sesión: este dispositivo deja de recibir los avisos de esa cuenta
  async function stop() {
    const u = firebase.auth().currentUser;
    if (!u || !token) return;
    try { await tokens(u.uid).doc(token).delete(); } catch (e) { console.warn('[Push] No se pudo borrar el token:', e); }
    if (!isNative()) {
      try { await firebase.messaging().deleteToken(); } catch (_) { /* ya no estaba */ }
      token = null;
    }
    savedFor = null;
  }

  if (typeof firebase !== 'undefined' && firebase.auth) {
    // Un poco después del arranque, para no pedir el permiso encima de la pantalla de carga
    firebase.auth().onAuthStateChanged((user) => {
      if (!user) { showCta(false); return; }
      setTimeout(() => (isNative() ? start(user) : webStart(user)), 2500);
    });
  }

  return { start, stop };
})();

if (typeof window !== 'undefined') window.KruxPush = KruxPush;

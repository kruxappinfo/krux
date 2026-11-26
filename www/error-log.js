// ================== REGISTRO DE ERRORES ==================
// Guarda en client_errors los fallos que ocurren en los móviles de los usuarios (errores sin capturar,
// promesas rechazadas y console.error), para enterarse antes de que nadie lo cuente.
// Sin datos personales: ni uid, ni email, ni nombre; los textos se recortan y se limpian de emails.
// Solo el superadmin puede leerlos (firestore.rules). Límite por sesión y sin repetir el mismo fallo.

const KX_ERRLOG_MAX_PER_SESSION = 25;
const KX_ERRLOG_APP_VERSION = 'v355';   // se sube junto a CACHE_VERSION de sw.js

const KruxErrorLog = (() => {
  let sent = 0, sending = false;
  const seen = new Set();
  const queue = [];

  const clean = (text, max) => String(text == null ? '' : text)
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]')
    .replace(/(token|key|password)=[^&\s]+/gi, '$1=[x]')
    .slice(0, max);

  function platform() {
    try { return window.Capacitor ? window.Capacitor.getPlatform() : 'web'; } catch (_) { return 'web'; }
  }

  function currentView() {
    const v = document.querySelector('.view.active:not(.hidden)');
    return v ? v.id : '';
  }

  function describe(value) {
    if (value instanceof Error) return { message: value.message, stack: value.stack || '', code: value.code || '' };
    if (value && typeof value === 'object') {
      return { message: value.message || (() => { try { return JSON.stringify(value); } catch (_) { return String(value); } })(), stack: value.stack || '', code: value.code || '' };
    }
    return { message: String(value), stack: '', code: '' };
  }

  function record(kind, value, extra = {}) {
    try {
      if (sent + queue.length >= KX_ERRLOG_MAX_PER_SESSION) return;
      const d = describe(value);
      const message = clean(extra.prefix ? `${extra.prefix} ${d.message}` : d.message, 500);
      if (!message) return;
      const key = kind + '|' + message;
      if (seen.has(key)) return;
      seen.add(key);
      queue.push({
        kind,
        message,
        code: clean(d.code, 80),
        stack: clean(d.stack, 2000),
        source: clean(extra.source || '', 200),
        view: clean(currentView(), 60),
        version: KX_ERRLOG_APP_VERSION,
        platform: platform(),
        online: navigator.onLine !== false,
        ua: clean(navigator.userAgent, 300)
      });
      flush();
    } catch (_) { /* el registro nunca rompe la app */ }
  }

  async function flush() {
    if (sending || !queue.length) return;
    if (typeof firebase === 'undefined' || !firebase.apps || !firebase.apps.length) return;
    const user = firebase.auth().currentUser;
    if (!user) return;   // se envían al iniciar sesión (ver onAuthStateChanged abajo)
    sending = true;
    try {
      while (queue.length) {
        const item = queue.shift();
        await firebase.firestore().collection('client_errors').add({
          ...item,
          at: firebase.firestore.FieldValue.serverTimestamp()
        });
        sent++;
      }
    } catch (_) {
      // Sin conexión o rechazado: se descarta, no se reintenta en bucle
      queue.length = 0;
    } finally {
      sending = false;
    }
  }

  // Errores sin capturar y promesas rechazadas
  window.addEventListener('error', (e) => {
    // Imágenes o scripts que no cargan llegan aquí sin e.error: no son fallos de la app
    if (!e.error && !e.message) return;
    record('error', e.error || e.message, { source: e.filename ? `${e.filename.split('/').pop()}:${e.lineno}:${e.colno}` : '' });
  });
  window.addEventListener('unhandledrejection', (e) => record('promise', e.reason));

  // console.error: la app ya avisa así de los fallos que captura (guardar un like, cargar el feed…)
  const originalError = console.error.bind(console);
  console.error = (...args) => {
    originalError(...args);
    if (sending) return;   // un fallo al guardar el propio registro no se vuelve a registrar
    const err = args.find(a => a instanceof Error || (a && typeof a === 'object' && a.message));
    const text = args.filter(a => typeof a === 'string').join(' ');
    record('console', err || text, { prefix: err && text ? text : '' });
  };

  function start() {
    try { firebase.auth().onAuthStateChanged(u => { if (u) flush(); }); } catch (_) { }
  }

  return { record, start };
})();

if (typeof window !== 'undefined') {
  window.KruxErrorLog = KruxErrorLog;
  KruxErrorLog.start();
}

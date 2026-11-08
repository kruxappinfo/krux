// ================== KRUX NOMBRES DE USUARIO ==================
// Nombre de usuario (@usuario, único) separado del nombre de perfil (displayName, libre), como en Instagram.
// Unicidad: cada nombre se reserva en usernames/{nombre} → { uid }, en la misma transacción que actualiza
// users/{uid}.username (las reglas de Firestore comprueban que ambos coinciden).

const KX_USERNAME_MIN = 3;
const KX_USERNAME_MAX = 30;

// Nombres que no puede coger nadie (rutas, marca, cuentas de sistema)
const KX_USERNAME_RESERVED = new Set(['krux', 'admin', 'administrador', 'soporte', 'support', 'ayuda', 'help', 'root',
  'system', 'sistema', 'moderador', 'staff', 'oficial', 'official', 'null', 'undefined', 'usuario', 'user', 'me', 'yo']);

// ============================================
// LÓGICA PURA
// ============================================

// Lo que se escribe pasa a minúsculas y sin @ inicial ni espacios alrededor
function kxNormalizeUsername(input) {
  return String(input || '').trim().replace(/^@+/, '').toLowerCase();
}

// null si es válido; si no, el motivo para mostrar en el campo
function kxValidateUsername(input) {
  const u = kxNormalizeUsername(input);
  if (!u) return 'Escribe un nombre de usuario';
  if (u.length < KX_USERNAME_MIN) return `Mínimo ${KX_USERNAME_MIN} caracteres`;
  if (u.length > KX_USERNAME_MAX) return `Máximo ${KX_USERNAME_MAX} caracteres`;
  if (!/^[a-z0-9._]+$/.test(u)) return 'Solo letras sin tilde, números, punto y guion bajo';
  if (u.startsWith('.') || u.endsWith('.')) return 'No puede empezar ni acabar en punto';
  if (u.includes('..')) return 'No puede tener dos puntos seguidos';
  if (/^[0-9._]+$/.test(u)) return 'Tiene que llevar al menos una letra';
  if (KX_USERNAME_RESERVED.has(u)) return 'Ese nombre no está disponible';
  return null;
}

// Base de una sugerencia a partir del nombre o del correo: «Jaime Lillo» → «jaime.lillo»
function kxUsernameBase(displayName, email) {
  const from = String(displayName || '').trim() || String(email || '').split('@')[0];
  let base = from.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/ñ/g, 'n').replace(/[\s-]+/g, '.').replace(/[^a-z0-9._]/g, '')
    .replace(/\.{2,}/g, '.').replace(/^[._]+|[._]+$/g, '');
  if (base.length > KX_USERNAME_MAX - 4) base = base.slice(0, KX_USERNAME_MAX - 4).replace(/[._]+$/, '');
  if (base.length < KX_USERNAME_MIN || kxValidateUsername(base)) base = 'escalador';
  return base;
}

// Candidatas en orden: la base, sin puntos y con números (para cuando la base ya está cogida)
function kxUsernameCandidates(displayName, email, seed = Date.now()) {
  const base = kxUsernameBase(displayName, email);
  const flat = base.replace(/\./g, '');
  const out = [base];
  if (flat !== base && !kxValidateUsername(flat)) out.push(flat);
  let n = Math.abs(Math.floor(seed)) % 900 + 100;
  for (let i = 0; i < 6; i++, n = (n * 7 + 13) % 900 + 100) out.push(`${base}${n}`.slice(0, KX_USERNAME_MAX));
  return out.filter(c => !kxValidateUsername(c));
}

// Texto con el que se menciona a alguien: su @usuario, o su nombre si aún no tiene (menciones antiguas)
function kxMentionLabel(m) {
  return (m && (m.username || m.displayName)) || '';
}

// ============================================
// FIRESTORE
// ============================================
const KruxUsernames = (() => {
  const ref = (name) => db.collection('usernames').doc(name);

  // true si está libre o ya es de esta cuenta
  async function isAvailable(name, uid) {
    const u = kxNormalizeUsername(name);
    if (kxValidateUsername(u)) return false;
    const snap = await ref(u).get();
    return !snap.exists || (snap.data() || {}).uid === uid;
  }

  // Primera candidata libre para sugerir
  async function suggest(displayName, email, uid) {
    for (const c of kxUsernameCandidates(displayName, email)) {
      try { if (await isAvailable(c, uid)) return c; } catch (_) { return c; }
    }
    return '';
  }

  // Reserva el nombre para la cuenta y libera el anterior. Lanza Error('taken') si es de otra persona
  // y Error('invalid') si no cumple el formato.
  async function claim(name) {
    const user = firebase.auth().currentUser;
    if (!user) throw new Error('auth');
    const u = kxNormalizeUsername(name);
    if (kxValidateUsername(u)) throw new Error('invalid');
    const userRef = db.collection('users').doc(user.uid);
    await db.runTransaction(async (tx) => {
      const [taken, me] = await Promise.all([tx.get(ref(u)), tx.get(userRef)]);
      if (taken.exists && (taken.data() || {}).uid !== user.uid) throw new Error('taken');
      const old = me.exists ? me.data().username : null;
      if (old === u) return;
      if (!taken.exists) tx.set(ref(u), { uid: user.uid, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
      if (me.exists) tx.update(userRef, { username: u });
      else tx.set(userRef, { username: u }, { merge: true });
      if (old && old !== u) tx.delete(ref(old));
    });
    return u;
  }

  return { isAvailable, suggest, claim };
})();

// ============================================
// INTERFAZ: CAMPO CON COMPROBACIÓN Y PANTALLA DE ELECCIÓN
// ============================================

// Campo «@usuario» con validación y disponibilidad en vivo. current: el nombre que ya tiene la cuenta.
// Devuelve { value(), check() } — check() resuelve true si se puede guardar.
function kxBindUsernameField(input, statusEl, { current = '' } = {}) {
  let seq = 0, timer = null, lastOk = null;
  const uid = () => (firebase.auth().currentUser || {}).uid || null;
  const show = (text, tone) => {
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.dataset.tone = tone || '';
    input.setAttribute('aria-invalid', tone === 'error' ? 'true' : 'false');
  };
  const check = async () => {
    clearTimeout(timer);
    const v = kxNormalizeUsername(input.value);
    const my = ++seq;
    const err = kxValidateUsername(v);
    if (err) { show(err, 'error'); lastOk = null; return false; }
    if (v === current) { show('Es tu nombre de usuario actual', 'ok'); lastOk = v; return true; }
    if (lastOk === v) return true;
    show('Comprobando…', 'muted');
    try {
      const free = await KruxUsernames.isAvailable(v, uid());
      if (my !== seq) return false;
      show(free ? `@${v} está disponible` : `@${v} ya está cogido`, free ? 'ok' : 'error');
      lastOk = free ? v : null;
      return free;
    } catch (e) {
      if (my !== seq) return false;
      show('No se pudo comprobar. Revisa la conexión.', 'error');
      return false;
    }
  };
  input.addEventListener('input', () => {
    // Minúsculas y sin espacios mientras se escribe
    const clean = input.value.toLowerCase().replace(/\s+/g, '');
    if (clean !== input.value) { const pos = input.selectionStart; input.value = clean; try { input.setSelectionRange(pos, pos); } catch (_) {} }
    lastOk = null;
    clearTimeout(timer);
    timer = setTimeout(check, 400);
  });
  return { value: () => kxNormalizeUsername(input.value), check, setCurrent: (c) => { current = c || ''; lastOk = null; } };
}

// Mensaje para un error de KruxUsernames.claim
function kxUsernameClaimError(e) {
  const m = e && e.message;
  if (m === 'taken') return 'Ese nombre de usuario ya está cogido';
  if (m === 'invalid') return 'Ese nombre de usuario no es válido';
  return 'No se pudo guardar el nombre de usuario. Revisa la conexión.';
}

// Pantalla «Elige tu nombre de usuario» para las cuentas que aún no tienen. Se muestra una vez por sesión.
const KruxUsernamePrompt = (() => {
  let shownThisSession = false, el = null;

  async function maybeShow(user) {
    if (!user || shownThisSession || typeof db === 'undefined') return;
    try {
      const doc = await db.collection('users').doc(user.uid).get();
      if (doc.exists && doc.data().username) return;
      shownThisSession = true;
      const data = doc.exists ? doc.data() : {};
      const suggestion = await KruxUsernames.suggest(data.displayName || user.displayName, user.email, user.uid);
      if ((firebase.auth().currentUser || {}).uid !== user.uid) return;
      open(suggestion);
    } catch (e) {
      console.warn('[Usuarios] No se pudo comprobar el nombre de usuario:', e);
    }
  }

  function open(suggestion) {
    if (el) el.remove();
    el = document.createElement('div');
    el.id = 'username-modal';
    el.className = 'modal-overlay kx-uname-overlay';
    el.innerHTML = `<div class="edit-profile-modal-content kx-uname-modal" role="dialog" aria-modal="true" aria-labelledby="kx-uname-title">
      <div class="edit-profile-header"><h2 id="kx-uname-title">Elige tu nombre de usuario</h2></div>
      <form class="edit-profile-form" novalidate>
        <p class="kx-uname-intro">Es tu @ en KRUX: con él te encuentran y te mencionan. Tu nombre de perfil no cambia, y podrás cambiar el @ cuando quieras desde «Editar perfil».</p>
        <div class="edit-form-group">
          <label for="kx-uname-input">Nombre de usuario</label>
          <div class="kx-uname-field"><span aria-hidden="true">@</span><input type="text" id="kx-uname-input" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" maxlength="${KX_USERNAME_MAX}" aria-describedby="kx-uname-status"></div>
          <p class="kx-uname-status" id="kx-uname-status" aria-live="polite"></p>
          <p class="kx-uname-help">Letras sin tilde, números, punto y guion bajo. De ${KX_USERNAME_MIN} a ${KX_USERNAME_MAX} caracteres.</p>
        </div>
        <button type="submit" class="submit-btn">Continuar</button>
        <button type="button" class="kx-uname-later" data-later>Ahora no</button>
      </form>
    </div>`;
    document.body.appendChild(el);
    const input = el.querySelector('#kx-uname-input');
    const field = kxBindUsernameField(input, el.querySelector('#kx-uname-status'));
    input.value = suggestion || '';
    if (suggestion) field.check();
    el.querySelector('[data-later]').addEventListener('click', close);
    el.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = el.querySelector('.submit-btn');
      if (btn.disabled) return;
      btn.disabled = true;
      const label = btn.textContent;
      btn.textContent = 'Guardando…';
      try {
        if (!(await field.check())) return;
        const name = await KruxUsernames.claim(field.value());
        kxSetProfileHandleIfOwn(name);
        close();
        if (typeof showToast === 'function') showToast(`Ya eres @${name}`, 'success');
      } catch (err) {
        console.error('[Usuarios] Error al guardar el nombre de usuario:', err);
        const status = el.querySelector('#kx-uname-status');
        status.textContent = kxUsernameClaimError(err);
        status.dataset.tone = 'error';
      } finally {
        if (el) { btn.disabled = false; btn.textContent = label; }
      }
    });
    setTimeout(() => { try { input.focus({ preventScroll: true }); } catch (_) {} }, 50);
  }

  function close() { if (el) { el.remove(); el = null; } }

  return { maybeShow, open, close };
})();

// Si la vista de perfil propio está abierta, refleja el @ nuevo sin recargarla
function kxSetProfileHandleIfOwn(name) {
  const me = (firebase.auth().currentUser || {}).uid;
  if (typeof currentProfileUserId !== 'undefined' && currentProfileUserId && currentProfileUserId !== me) return;
  if (typeof kxSetProfileHandle === 'function') kxSetProfileHandle(name);
}

if (typeof window !== 'undefined') {
  window.KruxUsernames = KruxUsernames;
  window.KruxUsernamePrompt = KruxUsernamePrompt;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { kxNormalizeUsername, kxValidateUsername, kxUsernameBase, kxUsernameCandidates, kxMentionLabel, KX_USERNAME_RESERVED };
}

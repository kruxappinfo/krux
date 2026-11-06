// ================== INFORMACIÓN DE ROCÓDROMOS (COMUNIDAD) ==================
// Los usuarios aportan fotos, horario, precio, contacto e instalaciones de cada rocódromo y la comunidad los vota
// con «me gusta» / «no me gusta». El contenido se modera solo:
//   - puntuación = me gusta − no me gusta; se ordena de mayor a menor (a igualdad, lo más reciente primero);
//   - cuando los no me gusta superan a los me gusta por KXG_HIDE_NET o más, la aportación se oculta para todos
//     (queda en el panel de admin, que puede restaurarla o borrarla);
//   - horario, precio y contacto muestran solo la versión mejor puntuada; fotos e instalaciones, todas las visibles.
// Firestore: gym_info/{id} (aportación con contadores up/down) y gym_info/{id}/votes/{uid} ({ v: 1 | -1 }).
// Las reglas obligan a que voto y contador cambien juntos y en una unidad (un voto por persona y aportación).

// ============================================
// LÓGICA (sin DOM; probada en tests/gym-info.test.js)
// ============================================
const KXG_HIDE_NET = 5;
const KXG_KINDS = ['photo', 'hours', 'price', 'contact', 'facility'];
const KXG_SINGLE = ['hours', 'price', 'contact'];   // una sola versión visible: la mejor puntuada
const KXG_TEXT_MAX = 500;
const KXG_FACILITIES = [
  { key: 'gimnasio', label: 'Gimnasio / zona de fuerza' },
  { key: 'travesia', label: 'Travesías' },
  { key: 'tablero', label: 'Tablero (Moonboard, Kilter…)' },
  { key: 'parking', label: 'Parking' },
  { key: 'vestuarios', label: 'Vestuarios' },
  { key: 'duchas', label: 'Duchas' },
  { key: 'taquillas', label: 'Taquillas' },
  { key: 'cafeteria', label: 'Cafetería' },
  { key: 'tienda', label: 'Tienda' },
  { key: 'alquiler', label: 'Alquiler de material' },
  { key: 'cursos', label: 'Cursos y escuela' },
  { key: 'infantil', label: 'Zona infantil' }
];

function kxgScore(item) { return (item.up || 0) - (item.down || 0); }

function kxgIsHidden(item) { return !item.restored && (item.down || 0) - (item.up || 0) >= KXG_HIDE_NET; }

function kxgMillis(t) {
  if (!t) return 0;
  if (typeof t.toMillis === 'function') return t.toMillis();
  if (t instanceof Date) return t.getTime();
  return typeof t === 'number' ? t : 0;
}

function kxgSort(items) {
  return items.slice().sort((a, b) => kxgScore(b) - kxgScore(a) || kxgMillis(b.createdAt) - kxgMillis(a.createdAt));
}

// Agrupa las aportaciones visibles de un rocódromo en lo que enseña la ficha
function kxgBuildView(items) {
  const visible = kxgSort(items.filter(i => KXG_KINDS.includes(i.kind) && !kxgIsHidden(i)));
  const view = { photos: [], facilities: [], hours: null, price: null, contact: null };
  for (const it of visible) {
    if (it.kind === 'photo') view.photos.push(it);
    else if (it.kind === 'facility') view.facilities.push(it);
    else if (KXG_SINGLE.includes(it.kind) && !view[it.kind]) view[it.kind] = it;
  }
  return view;
}

// Cambio de contadores al pasar del voto `before` al voto `after` (1, -1 o 0 = sin voto)
function kxgVoteDelta(before, after) {
  return { up: (after === 1 ? 1 : 0) - (before === 1 ? 1 : 0), down: (after === -1 ? 1 : 0) - (before === -1 ? 1 : 0) };
}

// Id fijo de una instalación: una sola aportación por instalación y rocódromo (los demás la votan)
function kxgFacilityId(gymId, key) { return `${gymId}__facility__${key}`; }

function kxgFacilityLabel(key) {
  const f = KXG_FACILITIES.find(x => x.key === key);
  return f ? f.label : key;
}

// ============================================
// DATOS (Firestore v8)
// ============================================
const KruxGymInfo = (() => {
  const col = () => db.collection('gym_info');
  const uid = () => (firebase.auth().currentUser || {}).uid || null;

  async function list(gymId) {
    const snap = await col().where('gymId', '==', gymId).get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }

  // Votos del usuario actual para estas aportaciones → { [infoId]: 1 | -1 }
  async function myVotes(items) {
    const me = uid();
    if (!me || !items.length) return {};
    const docs = await Promise.all(items.map(i => col().doc(i.id).collection('votes').doc(me).get().catch(() => null)));
    const out = {};
    docs.forEach((d, k) => { if (d && d.exists) out[items[k].id] = d.data().v; });
    return out;
  }

  // Vota (o retira el voto si se repite el mismo). Devuelve el voto final y los contadores nuevos.
  async function vote(infoId, value) {
    const me = uid();
    if (!me) throw new Error('auth');
    const ref = col().doc(infoId);
    const vref = ref.collection('votes').doc(me);
    return db.runTransaction(async (tx) => {
      const [doc, vdoc] = [await tx.get(ref), await tx.get(vref)];
      if (!doc.exists) throw new Error('gone');
      const before = vdoc.exists ? vdoc.data().v : 0;
      const after = before === value ? 0 : value;
      const d = kxgVoteDelta(before, after);
      const up = (doc.data().up || 0) + d.up, down = (doc.data().down || 0) + d.down;
      tx.update(ref, { up, down });
      if (after) tx.set(vref, { v: after }); else tx.delete(vref);
      return { v: after, up, down };
    });
  }

  function base(gymId, kind) {
    const u = firebase.auth().currentUser;
    return {
      gymId, kind, authorId: u.uid, authorName: (u.displayName || 'Usuario').slice(0, 80),
      createdAt: firebase.firestore.FieldValue.serverTimestamp(), up: 0, down: 0
    };
  }

  async function addText(gymId, kind, text) {
    if (!uid()) throw new Error('auth');
    const clean = String(text || '').trim().slice(0, KXG_TEXT_MAX);
    if (!clean) throw new Error('empty');
    await col().add({ ...base(gymId, kind), text: clean });
  }

  // Instalación: si ya la aportó alguien, se vota «me gusta» en lugar de duplicarla
  async function addFacility(gymId, key) {
    if (!uid()) throw new Error('auth');
    const ref = col().doc(kxgFacilityId(gymId, key));
    const doc = await ref.get();
    if (doc.exists) {
      if (doc.data().authorId === uid()) return 'own';
      const v = await ref.collection('votes').doc(uid()).get();
      if (!v.exists || v.data().v !== 1) await vote(ref.id, 1);
      return 'voted';
    }
    await ref.set({ ...base(gymId, 'facility'), value: key });
    return 'created';
  }

  async function addPhoto(gymId, file) {
    if (!uid()) throw new Error('auth');
    if (!/^image\/(jpe?g|png|webp)$/.test(file.type)) throw new Error('type');
    if (file.size > 15 * 1024 * 1024) throw new Error('size');
    const toUpload = typeof kxPrepareImageForUpload === 'function' ? await kxPrepareImageForUpload(file) : file;
    const ext = /png/.test(toUpload.type) ? 'png' : /webp/.test(toUpload.type) ? 'webp' : 'jpg';
    const path = `gym-photos/${uid()}/${gymId}_${Date.now()}.${ext}`;
    const snap = await storage.ref(path).put(toUpload, { contentType: toUpload.type || undefined, cacheControl: 'public,max-age=31536000,immutable' });
    const photoUrl = await snap.ref.getDownloadURL();
    await col().add({ ...base(gymId, 'photo'), photoUrl, storagePath: path });
  }

  // Borra una aportación propia (o cualquiera, si es admin). La foto se borra también del almacenamiento.
  async function remove(item) {
    await col().doc(item.id).delete();
    if (item.storagePath) { try { await storage.ref(item.storagePath).delete(); } catch (_) {} }
  }

  return { list, myVotes, vote, addText, addFacility, addPhoto, remove };
})();

// ============================================
// INTERFAZ: ficha del rocódromo en hoja inferior (modal en escritorio)
// ============================================
const KruxGymSheet = (() => {
  let el = null, sheet = null;
  let gym = null;           // { id, nombre, pago, cuerda, bloque, auto, coords }
  let items = [], votes = {}, view = 'info', addKind = 'hours', busy = false;
  const toast = (msg, type = 'info') => { if (typeof showToast === 'function') showToast(msg, type); };
  const me = () => (firebase.auth().currentUser || {}).uid || null;
  const askLogin = () => { toast('Inicia sesión para aportar o votar', 'info'); if (typeof openLoginModal === 'function') openLoginModal(); };

  function ensure() {
    if (el) return;
    el = document.createElement('div');
    el.id = 'kx-gym-sheet';
    el.className = 'bottom-sheet hidden';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-labelledby', 'kx-gym-title');
    el.innerHTML = '<div class="kx-msheet-drag" id="kx-gym-drag"></div><div class="bottom-sheet-content kx-msheet-body" id="kx-gym-body"></div><div class="kx-msheet-foot" id="kx-gym-foot"></div>';
    document.body.appendChild(el);
    sheet = KXMapSheet.create(el, { snaps: ['expanded'], onStateChange: (s) => document.body.classList.toggle('kx-gym-open', s !== 'hidden') });
    el.addEventListener('click', onClick);
    el.addEventListener('change', onChange);
  }

  function voteHTML(it) {
    const mine = votes[it.id] || 0;
    const own = it.authorId && it.authorId === me();
    const btn = (v, icon, n, label) => `<button type="button" class="kxg-vote${mine === v ? ' is-on' : ''}" data-kxg="vote" data-id="${kxEsc(it.id)}" data-v="${v}" aria-pressed="${mine === v}" aria-label="${label}"${own ? ' disabled title="No puedes votar tu propia aportación"' : ''}>${kxIcon(icon, { size: 16 })}<span>${n || 0}</span></button>`;
    return `<span class="kxg-votes">${btn(1, 'thumbsUp', it.up, 'Me gusta')}${btn(-1, 'thumbsDown', it.down, 'No me gusta')}</span>`;
  }

  function ownHTML(it) {
    return it.authorId === me() ? `<button type="button" class="kxg-del" data-kxg="del" data-id="${kxEsc(it.id)}" aria-label="Borrar mi aportación">${kxIcon('trash', { size: 16 })}</button>` : '';
  }

  function textRowHTML(kind, icon, title, it) {
    const body = it
      ? `<p class="kxg-text">${kxEsc(it.text)}</p><p class="kxg-by">Aportado por ${kxEsc(it.authorName || 'Usuario')}</p>`
      : '<p class="kxg-none">Nadie lo ha añadido todavía.</p>';
    return `<section class="kxg-card">
      <div class="kxg-card-head"><span class="kxg-card-ic">${kxIcon(icon, { size: 18 })}</span><h3 class="kxg-card-title">${title}</h3>
        ${it ? `${ownHTML(it)}${voteHTML(it)}` : `<button type="button" class="kxg-add" data-kxg="add" data-kind="${kind}">${kxIcon('plus', { size: 16 })}<span>Añadir</span></button>`}</div>
      ${body}</section>`;
  }

  function infoHTML() {
    const v = kxgBuildView(items);
    const yes = x => x === true || x === 'true';
    const types = [[yes(gym.cuerda), 'Cuerda'], [yes(gym.bloque), 'Bloque'], [yes(gym.auto), 'Autobelay']].filter(t => t[0]).map(t => t[1]);
    const price = gym.pago === 'si' ? 'De pago' : gym.pago === 'no' ? 'Gratuito' : '';
    const tags = [price, ...types].filter(Boolean).map(t => kxTagHTML({ text: t })).join('');
    const photos = v.photos.length
      ? `<div class="kxg-photos">${v.photos.map(p => `<figure class="kxg-photo"><img src="${kxEsc(p.photoUrl)}" alt="Foto de ${kxEsc(gym.nombre)}" loading="lazy">
          <figcaption>${ownHTML(p)}${voteHTML(p)}</figcaption></figure>`).join('')}</div>`
      : '<p class="kxg-none">Aún no hay fotos. Sé la primera persona en subir una.</p>';
    const facilities = v.facilities.length
      ? `<ul class="kxg-facs">${v.facilities.map(f => `<li class="kxg-fac"><span>${kxEsc(kxgFacilityLabel(f.value))}</span>${ownHTML(f)}${voteHTML(f)}</li>`).join('')}</ul>`
      : '<p class="kxg-none">Nadie ha indicado instalaciones todavía.</p>';
    return `${tags ? `<div class="kxg-tags">${tags}</div>` : ''}
      <section class="kxg-card">
        <div class="kxg-card-head"><span class="kxg-card-ic">${kxIcon('image', { size: 18 })}</span><h3 class="kxg-card-title">Fotos</h3>
          <button type="button" class="kxg-add" data-kxg="add" data-kind="photo">${kxIcon('plus', { size: 16 })}<span>Subir</span></button></div>
        ${photos}</section>
      ${textRowHTML('hours', 'clock', 'Horario', v.hours)}
      ${textRowHTML('price', 'star', 'Precios', v.price)}
      <section class="kxg-card">
        <div class="kxg-card-head"><span class="kxg-card-ic">${kxIcon('mountain', { size: 18 })}</span><h3 class="kxg-card-title">Instalaciones</h3>
          <button type="button" class="kxg-add" data-kxg="add" data-kind="facility">${kxIcon('plus', { size: 16 })}<span>Añadir</span></button></div>
        ${facilities}</section>
      ${textRowHTML('contact', 'link', 'Web y contacto', v.contact)}
      <p class="kxg-note">La información la aporta la comunidad. Vota con ${kxIcon('thumbsUp', { size: 14 })} lo que sea correcto y con ${kxIcon('thumbsDown', { size: 14 })} lo que no: lo más votado se muestra primero y lo que acumula ${KXG_HIDE_NET} «no me gusta» más que «me gusta» desaparece.</p>`;
  }

  function addHTML() {
    const kinds = [{ value: 'hours', label: 'Horario' }, { value: 'price', label: 'Precios' }, { value: 'facility', label: 'Instalación' }, { value: 'photo', label: 'Foto' }, { value: 'contact', label: 'Contacto' }];
    const used = new Set(items.filter(i => i.kind === 'facility' && !kxgIsHidden(i)).map(i => i.value));
    const ph = { hours: 'Ej.: L–V 10:00–23:00 · S–D 10:00–21:00', price: 'Ej.: Entrada 12 € · Bono 10 entradas 100 € · Mensual 55 €', contact: 'Ej.: www.rocodromo.es · 600 000 000' };
    let field;
    if (addKind === 'photo') {
      field = `<label class="kxg-drop" for="kxg-file">${kxIcon('image', { size: 28 })}<strong>Elige una foto</strong><small>JPG, PNG o WebP. Se reduce antes de subirla.</small></label>
        <input type="file" id="kxg-file" accept="image/jpeg,image/png,image/webp" hidden>
        <p class="kxg-file-name" id="kxg-file-name" hidden></p>`;
    } else if (addKind === 'facility') {
      field = `<p class="kxg-help">Marca todas las que tenga el rocódromo.</p><div class="kxg-fac-pick" role="group" aria-label="Instalaciones (puedes elegir varias)">${KXG_FACILITIES.map(f => `<label class="kxg-fac-opt${used.has(f.key) ? ' is-used' : ''}"><input type="checkbox" name="kxg-fac" value="${f.key}"><span>${kxEsc(f.label)}</span>${used.has(f.key) ? '<small>Ya indicada: sumarás tu «me gusta»</small>' : ''}</label>`).join('')}</div>`;
    } else {
      field = kxFieldHTML({ id: 'kxg-text', label: { hours: 'Horario', price: 'Precios', contact: 'Web y contacto' }[addKind], type: 'textarea', placeholder: ph[addKind], help: 'Si ya hay una versión, la tuya se muestra en cuanto tenga igual o más votos.', attrs: { maxlength: KXG_TEXT_MAX } });
    }
    return `${kxSegmentedHTML({ items: kinds, value: addKind, label: 'Qué quieres añadir', attrs: { id: 'kxg-kind' } })}<div class="kxg-form">${field}</div>`;
  }

  function render({ keepScroll = false } = {}) {
    const body = el.querySelector('#kx-gym-body');
    const keep = body.scrollTop;
    const add = view === 'add';
    el.querySelector('#kx-gym-drag').innerHTML = kxSheetDragHTML({ title: add ? 'Añadir información' : gym.nombre, titleId: 'kx-gym-title', metaHTML: add ? kxEsc(gym.nombre) : 'Rocódromo' });
    body.innerHTML = view === 'loading' ? kxSkeletonHTML('rows') : add ? addHTML() : infoHTML();
    el.querySelector('#kx-gym-foot').innerHTML = add
      ? kxButtonHTML({ label: 'Cancelar', variant: 'secondary', size: 'lg', attrs: { 'data-kxg': 'back' } }) + kxButtonHTML({ icon: 'check', label: 'Publicar', size: 'lg', attrs: { 'data-kxg': 'submit' } })
      : kxButtonHTML({ icon: 'navigation', label: 'Cómo llegar', variant: 'secondary', size: 'lg', attrs: { 'data-kxg': 'go' } }) + kxButtonHTML({ icon: 'plus', label: 'Aportar', size: 'lg', attrs: { 'data-kxg': 'add' } });
    body.scrollTop = keepScroll ? keep : 0;
    if (add) kxBindSegmented(el.querySelector('#kxg-kind'), (k) => { addKind = k; render(); });
    sheet.refresh();
  }

  async function load() {
    try {
      items = await KruxGymInfo.list(gym.id);
      votes = await KruxGymInfo.myVotes(items);
    } catch (e) {
      console.warn('[Rocódromos] No se pudo cargar la información:', e);
      items = []; votes = {};
      toast('No se pudo cargar la información del rocódromo', 'error');
    }
  }

  async function open(p, coords) {
    ensure();
    gym = { ...p, coords };
    view = 'loading';
    render();
    if (sheet.state === 'hidden') sheet.open('expanded');
    await load();
    if (gym && gym.id === p.id) { view = 'info'; render(); }
  }

  async function submit() {
    if (busy) return;
    if (!me()) { askLogin(); return; }
    busy = true;
    const btn = el.querySelector('[data-kxg="submit"]');
    if (btn) btn.setAttribute('aria-busy', 'true');
    try {
      if (addKind === 'photo') {
        const f = el.querySelector('#kxg-file').files[0];
        if (!f) { toast('Elige una foto', 'info'); return; }
        await KruxGymInfo.addPhoto(gym.id, f);
        toast('Foto publicada', 'success');
      } else if (addKind === 'facility') {
        const keys = [...el.querySelectorAll('input[name="kxg-fac"]:checked')].map(i => i.value);
        if (!keys.length) { toast('Elige al menos una instalación', 'info'); return; }
        const tally = { created: 0, voted: 0, own: 0 };
        for (const k of keys) tally[await KruxGymInfo.addFacility(gym.id, k)]++;
        const parts = [];
        if (tally.created) parts.push(tally.created === 1 ? '1 instalación añadida' : `${tally.created} instalaciones añadidas`);
        if (tally.voted) parts.push(tally.voted === 1 ? '1 ya estaba indicada: has sumado tu «me gusta»' : `${tally.voted} ya estaban indicadas: has sumado tu «me gusta»`);
        if (tally.own) parts.push(tally.own === 1 ? '1 ya la habías añadido tú' : `${tally.own} ya las habías añadido tú`);
        toast(parts.join(' · '), 'success');
      } else {
        const t = el.querySelector('#kxg-text').value.trim();
        if (!t) { kxSetFieldError('kxg-text', 'Escribe la información'); return; }
        await KruxGymInfo.addText(gym.id, addKind, t);
        toast('Información publicada', 'success');
      }
      await load();
      view = 'info';
      render();
    } catch (e) {
      console.error('[Rocódromos] Error al publicar:', e);
      const m = e && e.message;
      toast(m === 'type' ? 'Formato no admitido: usa JPG, PNG o WebP' : m === 'size' ? 'La foto pesa demasiado (máx. 15 MB)' : 'No se pudo publicar. Revisa la conexión.', 'error');
    } finally {
      busy = false;
      const b = el.querySelector('[data-kxg="submit"]');
      if (b) b.removeAttribute('aria-busy');
    }
  }

  const ACTIONS = {
    add(btn) {
      if (!me()) { askLogin(); return; }
      addKind = (btn && btn.dataset.kind) || addKind;
      view = 'add';
      render();
    },
    back() { view = 'info'; render(); },
    submit,
    go() { window.open(`https://www.google.com/maps/dir/?api=1&destination=${gym.coords[1]},${gym.coords[0]}`, '_blank'); },
    async vote(btn) {
      if (!me()) { askLogin(); return; }
      if (busy) return;
      busy = true;
      try {
        const id = btn.dataset.id;
        const r = await KruxGymInfo.vote(id, Number(btn.dataset.v));
        const it = items.find(i => i.id === id);
        if (it) { it.up = r.up; it.down = r.down; }
        if (r.v) votes[id] = r.v; else delete votes[id];
        if (it && kxgIsHidden(it)) toast('Esta aportación se ha ocultado por los votos de la comunidad', 'info');
        render({ keepScroll: true });
      } catch (e) {
        console.error('[Rocódromos] Error al votar:', e);
        toast('No se pudo registrar el voto', 'error');
      } finally { busy = false; }
    },
    async del(btn) {
      const it = items.find(i => i.id === btn.dataset.id);
      if (!it || !window.confirm('¿Borrar esta aportación?')) return;
      try {
        await KruxGymInfo.remove(it);
        items = items.filter(i => i !== it);
        render({ keepScroll: true });
        toast('Aportación borrada', 'success');
      } catch (e) { toast('No se pudo borrar', 'error'); }
    }
  };

  function onClick(e) {
    const a = e.target.closest('[data-kxg]');
    if (a && !a.disabled && ACTIONS[a.dataset.kxg]) { e.preventDefault(); ACTIONS[a.dataset.kxg](a); }
  }

  function onChange(e) {
    if (e.target.id === 'kxg-file') {
      const f = e.target.files[0];
      const n = el.querySelector('#kxg-file-name');
      if (n) { n.hidden = !f; n.textContent = f ? f.name : ''; }
    }
    if (e.target.id === 'kxg-text') kxSetFieldError('kxg-text', '');
  }

  return { open };
})();

window.KruxGymSheet = KruxGymSheet;

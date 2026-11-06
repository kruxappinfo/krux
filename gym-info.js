// ================== INFORMACIÓN DE ROCÓDROMOS (COMUNIDAD) ==================
// Los usuarios aportan fotos, horario, precios, instalaciones, redes y contacto de cada rocódromo.
// Lo aportado se publica al instante. Si algo está mal, cualquier usuario puede denunciarlo con el botón ⚠ y
// proponer un cambio; las denuncias llegan al panel de admin, que decide (aplicar el cambio, borrar o descartar).
//   - horario, precios y contacto muestran la versión más reciente; de cada red, el enlace más reciente;
//     fotos e instalaciones, todas (una instalación solo puede indicarse una vez por rocódromo).
// Firestore: gym_info/{id} (aportación) y gym_reports/{infoId__uid} (denuncia: motivo, cambio propuesto, estado).
// Una persona solo puede denunciar una vez cada aportación.

// ============================================
// LÓGICA (sin DOM; probada en tests/gym-info.test.js)
// ============================================
const KXG_KINDS = ['photo', 'hours', 'price', 'contact', 'facility', 'link'];
const KXG_SINGLE = ['hours', 'price', 'contact'];   // una sola versión visible: la más reciente
const KXG_TEXT_MAX = 500;
// Redes y web: cada enlace es una aportación con red + dirección. De cada red se muestra la más reciente.
// Solo se admiten direcciones https de la red elegida (la web puede ser cualquier dominio); se normaliza al guardar y al mostrar.
const KXG_NETWORKS = [
  { key: 'instagram', label: 'Instagram', icon: 'instagram', hosts: ['instagram.com'], base: 'https://www.instagram.com/', ph: '@nombre o enlace de Instagram' },
  { key: 'facebook', label: 'Facebook', icon: 'facebook', hosts: ['facebook.com', 'fb.com', 'fb.me'], base: 'https://www.facebook.com/', ph: 'nombre de página o enlace de Facebook' },
  { key: 'tiktok', label: 'TikTok', icon: 'music', hosts: ['tiktok.com'], base: 'https://www.tiktok.com/@', ph: '@nombre o enlace de TikTok' },
  { key: 'youtube', label: 'YouTube', icon: 'youtube', hosts: ['youtube.com', 'youtu.be'], base: 'https://www.youtube.com/@', ph: '@canal o enlace de YouTube' },
  { key: 'x', label: 'X (Twitter)', icon: 'x', hosts: ['x.com', 'twitter.com'], base: 'https://x.com/', ph: '@nombre o enlace de X' },
  { key: 'web', label: 'Página web', icon: 'globe', hosts: null, base: null, ph: 'www.turocodromo.es' }
];
const KXG_LINK_MAX = 300;

function kxgNetwork(key) { return KXG_NETWORKS.find(n => n.key === key) || null; }

// Devuelve la dirección https normalizada, o null si no es válida para esa red
function kxgNormalizeLink(network, input) {
  const n = kxgNetwork(network);
  let t = String(input == null ? '' : input).trim();
  if (!n || !t || /\s/.test(t)) return null;
  // Usuario sin dirección («@nombre» o «nombre») en las redes que lo permiten
  if (n.base && !/[/:]/.test(t) && !n.hosts.some(h => t.toLowerCase().includes(h))) {
    const user = t.replace(/^@/, '');
    if (!/^[A-Za-z0-9_.-]{1,60}$/.test(user)) return null;
    return n.base + user;
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(t) && !/^https?:\/\//i.test(t)) return null;   // javascript:, data:, mailto:…
  if (!/^https?:\/\//i.test(t)) t = 'https://' + t.replace(/^\/+/, '');
  let u;
  try { u = new URL(t); } catch (_) { return null; }
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  if (u.username || u.password || !host.includes('.')) return null;
  if (n.hosts && !n.hosts.some(h => host === h || host.endsWith('.' + h))) return null;
  u.protocol = 'https:';
  const href = u.toString();
  return href.length <= KXG_LINK_MAX ? href : null;
}

// Texto corto del enlace para la lista: dominio y ruta sin «https://www.»
function kxgLinkDisplay(href) {
  try { const u = new URL(href); return (u.hostname.replace(/^www\./, '') + u.pathname + u.search).replace(/\/$/, ''); } catch (_) { return href; }
}

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

function kxgMillis(t) {
  if (!t) return 0;
  if (typeof t.toMillis === 'function') return t.toMillis();
  if (t instanceof Date) return t.getTime();
  return typeof t === 'number' ? t : 0;
}

// Más recientes primero
function kxgSort(items) {
  return items.slice().sort((a, b) => kxgMillis(b.createdAt) - kxgMillis(a.createdAt));
}

const KXG_REASONS = [
  { value: 'incorrect', label: 'Es incorrecto' },
  { value: 'outdated', label: 'Está desfasado' },
  { value: 'inappropriate', label: 'Inapropiado o spam' }
];
const KXG_REASON_LABEL = { incorrect: 'Es incorrecto', outdated: 'Está desfasado', inappropriate: 'Inapropiado o spam' };

// Una denuncia por persona y aportación
function kxgReportId(infoId, uid) { return `${infoId}__${uid}`; }

// Agrupa las aportaciones visibles de un rocódromo en lo que enseña la ficha
function kxgBuildView(items) {
  const visible = kxgSort(items.filter(i => KXG_KINDS.includes(i.kind)));
  const view = { photos: [], facilities: [], links: [], hours: null, price: null, contact: null };
  const seenNet = new Set();
  for (const it of visible) {
    if (it.kind === 'photo') view.photos.push(it);
    else if (it.kind === 'facility') view.facilities.push(it);
    else if (it.kind === 'link') {
      const href = kxgNormalizeLink(it.network, it.url);
      if (href && !seenNet.has(it.network)) { seenNet.add(it.network); view.links.push({ ...it, href }); }
    }
    else if (KXG_SINGLE.includes(it.kind) && !view[it.kind]) view[it.kind] = it;
  }
  view.links.sort((a, b) => KXG_NETWORKS.findIndex(n => n.key === a.network) - KXG_NETWORKS.findIndex(n => n.key === b.network));
  return view;
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

  // Caché de la última lectura de cada rocódromo (memoria + localStorage): la ficha se pinta al instante con lo último
  // que se vio y se refresca en segundo plano. Las fechas se guardan en milisegundos.
  const CACHE_KEY = 'krux_gym_info_v1', CACHE_MAX = 20;
  const mem = new Map();
  const readStore = () => { try { return JSON.parse(localStorage.getItem(CACHE_KEY)) || {}; } catch (_) { return {}; } };
  function cached(gymId) {
    if (mem.has(gymId)) return mem.get(gymId);
    const e = readStore()[gymId];
    return e ? e.items : null;
  }
  function remember(gymId, items) {
    mem.set(gymId, items);
    try {
      const store = readStore();
      store[gymId] = { t: Date.now(), items: items.map(i => ({ ...i, createdAt: kxgMillis(i.createdAt) })) };
      Object.keys(store).sort((a, b) => store[b].t - store[a].t).slice(CACHE_MAX).forEach(k => delete store[k]);
      localStorage.setItem(CACHE_KEY, JSON.stringify(store));
    } catch (_) {}
  }

  async function list(gymId) {
    const snap = await col().where('gymId', '==', gymId).get();
    const out = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    remember(gymId, out);
    return out;
  }

  // Abre la conexión con Firestore antes de que nadie toque un rocódromo (la primera lectura tarda por la conexión)
  let warmed = false;
  function warm() {
    if (warmed || typeof db === 'undefined') return;
    warmed = true;
    col().where('gymId', '==', '__warm__').limit(1).get().catch(() => {});
  }

  // Denuncia + propuesta de cambio. Devuelve 'sent' o 'already' si esta persona ya había denunciado esa aportación.
  async function report(item, reason, proposal) {
    const me = uid();
    if (!me) throw new Error('auth');
    if (!KXG_REASON_LABEL[reason]) throw new Error('reason');
    const ref = db.collection('gym_reports').doc(kxgReportId(item.id, me));
    const prev = await ref.get().catch(() => null);
    if (prev && prev.exists) return 'already';
    const u = firebase.auth().currentUser;
    await ref.set({
      infoId: item.id, gymId: item.gymId, kind: item.kind, reason,
      proposal: String(proposal || '').trim().slice(0, KXG_TEXT_MAX),
      reporterId: me, reporterName: (u.displayName || 'Usuario').slice(0, 80),
      createdAt: firebase.firestore.FieldValue.serverTimestamp(), status: 'open'
    });
    return 'sent';
  }

  function base(gymId, kind) {
    const u = firebase.auth().currentUser;
    return {
      gymId, kind, authorId: u.uid, authorName: (u.displayName || 'Usuario').slice(0, 80),
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };
  }

  async function addText(gymId, kind, text) {
    if (!uid()) throw new Error('auth');
    const clean = String(text || '').trim().slice(0, KXG_TEXT_MAX);
    if (!clean) throw new Error('empty');
    await col().add({ ...base(gymId, kind), text: clean });
  }

  // Instalación: una por rocódromo y tipo. Si ya estaba indicada, no se duplica.
  async function addFacility(gymId, key) {
    if (!uid()) throw new Error('auth');
    const ref = col().doc(kxgFacilityId(gymId, key));
    const doc = await ref.get();
    if (doc.exists) return 'exists';
    await ref.set({ ...base(gymId, 'facility'), value: key });
    return 'created';
  }

  async function addLink(gymId, network, input) {
    if (!uid()) throw new Error('auth');
    const url = kxgNormalizeLink(network, input);
    if (!url) throw new Error('link');
    await col().add({ ...base(gymId, 'link'), network, url });
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

  return { list, cached, warm, report, addText, addFacility, addLink, addPhoto };
})();

// ============================================
// INTERFAZ: ficha del rocódromo en hoja inferior (modal en escritorio)
// ============================================
const KruxGymSheet = (() => {
  let el = null, sheet = null;
  let gym = null;           // { id, nombre, pago, cuerda, bloque, auto, coords }
  let items = [], photoIdx = 0, facPage = 0, view = 'info', reportReason = 'incorrect', addKind = 'hours', linkNet = 'instagram', busy = false;
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
    el.addEventListener('input', (e) => { if (e.target.id === 'kxg-url') kxSetFieldError('kxg-url', ''); if (e.target.id === 'kxg-proposal') kxSetFieldError('kxg-proposal', ''); });
  }

  // Aportaciones de otras personas que se pueden denunciar, con una etiqueta y un resumen para elegir
  function reportables() {
    const v = kxgBuildView(items);
    const mine = (it) => it.authorId && it.authorId === me();
    const out = [];
    v.photos.forEach((p, i) => { if (!mine(p)) out.push({ it: p, label: `Foto ${i + 1}`, sub: '', thumb: p.photoUrl }); });
    [['hours', 'Horario'], ['price', 'Precios'], ['contact', 'Contacto']].forEach(([k, label]) => { const it = v[k]; if (it && !mine(it)) out.push({ it, label, sub: it.text }); });
    v.facilities.forEach(f => { if (!mine(f)) out.push({ it: f, label: 'Instalación', sub: kxgFacilityLabel(f.value) }); });
    v.links.forEach(l => { if (!mine(l)) out.push({ it: l, label: kxgNetwork(l.network).label, sub: kxgLinkDisplay(l.href) }); });
    return out;
  }


  // Instalaciones en páginas de 6 (2 columnas × 3 filas) que se pasan deslizando, con puntos indicadores
  const FAC_PER_PAGE = 6;
  function facilitiesHTML(list) {
    const pages = [];
    for (let i = 0; i < list.length; i += FAC_PER_PAGE) pages.push(list.slice(i, i + FAC_PER_PAGE));
    if (facPage >= pages.length) facPage = pages.length - 1;
    const chip = (f) => `<div class="kxg-fchip"><span>${kxEsc(kxgFacilityLabel(f.value))}</span></div>`;
    return `<div class="kxg-facs" data-kxg-facs>
      <div class="kxg-fstage"><div class="kxg-ftrack" style="transform:translateX(-${facPage * 100}%)">${pages.map(pg => `<div class="kxg-fpage">${pg.map(chip).join('')}</div>`).join('')}</div></div>
      ${pages.length > 1 ? `<div class="kxg-dots" aria-hidden="true">${pages.map((_, i) => `<span class="kxg-dot${i === facPage ? ' is-on' : ''}"></span>`).join('')}</div>` : ''}
    </div>`;
  }

  function textRowHTML(kind, icon, title, it) {
    const body = it
      ? `<p class="kxg-text">${kxEsc(it.text)}</p><p class="kxg-by">Aportado por ${kxEsc(it.authorName || 'Usuario')}</p>`
      : '<p class="kxg-none">Nadie lo ha añadido todavía.</p>';
    return `<section class="kxg-card">
      <div class="kxg-card-head"><span class="kxg-card-ic">${kxIcon(icon, { size: 18 })}</span><h3 class="kxg-card-title">${title}</h3>
        </div>
      ${body}</section>`;
  }

  function infoHTML() {
    const v = kxgBuildView(items);
    const yes = x => x === true || x === 'true';
    const types = [[yes(gym.cuerda), 'Cuerda'], [yes(gym.bloque), 'Bloque'], [yes(gym.auto), 'Autobelay']].filter(t => t[0]).map(t => t[1]);
    const price = gym.pago === 'si' ? 'De pago' : gym.pago === 'no' ? 'Gratuito' : '';
    const tags = [price, ...types].filter(Boolean).map(t => kxTagHTML({ text: t })).join('');
    if (photoIdx >= v.photos.length) photoIdx = Math.max(0, v.photos.length - 1);
    const cur = v.photos[photoIdx];
    // Una foto cada vez, sin desplazamiento nativo ni botones: se cambia deslizando (o con las flechas del teclado); al tocarla se abre en grande
    const photos = cur
      ? `<div class="kxg-gallery">
          <div class="kxg-stage" data-kxg-stage>
            <div class="kxg-track" style="transform:translateX(-${photoIdx * 100}%)">${v.photos.map((ph, i) => `<button type="button" class="kxg-photo-btn" data-kxg="zoom" aria-label="Ver la foto ${i + 1} de ${v.photos.length} en grande"><img src="${kxEsc(ph.photoUrl)}" alt="Foto ${i + 1} de ${v.photos.length} de ${kxEsc(gym.nombre)}" draggable="false"${Math.abs(i - photoIdx) > 1 ? ' loading="lazy"' : ''}></button>`).join('')}</div>
            ${v.photos.length > 1 ? `<span class="kxg-count" aria-hidden="true">${photoIdx + 1} / ${v.photos.length}</span>` : ''}
          </div>
          
        </div>`
      : '<p class="kxg-none">Aún no hay fotos. Sé la primera persona en subir una.</p>';
    const facilities = v.facilities.length
      ? facilitiesHTML(v.facilities)
      : '<p class="kxg-none">Nadie ha indicado instalaciones todavía.</p>';
    return `${tags ? `<div class="kxg-tags">${tags}</div>` : ''}
      <section class="kxg-card">
        <div class="kxg-card-head"><span class="kxg-card-ic">${kxIcon('image', { size: 18 })}</span><h3 class="kxg-card-title">Fotos</h3></div>
        ${photos}</section>
      ${textRowHTML('hours', 'clock', 'Horario', v.hours)}
      ${textRowHTML('price', 'star', 'Precios', v.price)}
      <section class="kxg-card">
        <div class="kxg-card-head"><span class="kxg-card-ic">${kxIcon('mountain', { size: 18 })}</span><h3 class="kxg-card-title">Instalaciones</h3></div>
        ${facilities}</section>
      <section class="kxg-card">
        <div class="kxg-card-head"><span class="kxg-card-ic">${kxIcon('link', { size: 18 })}</span><h3 class="kxg-card-title">Redes y web</h3></div>
        ${v.links.length
          ? `<ul class="kxg-links">${v.links.map(l => { const n = kxgNetwork(l.network); return `<li class="kxg-linkrow">
              <a class="kxg-link" href="${kxEsc(l.href)}" target="_blank" rel="noopener noreferrer" aria-label="${kxEsc(n.label)}: abrir ${kxEsc(kxgLinkDisplay(l.href))} (se abre en otra página)">
                <span class="kxg-link-ic">${kxIcon(n.icon, { size: 20 })}</span>
                <span class="kxg-link-text"><strong>${kxEsc(n.label)}</strong><small>${kxEsc(kxgLinkDisplay(l.href))}</small></span>
                ${kxIcon('externalLink', { size: 16, cls: 'kxg-link-out' })}
              </a></li>`; }).join('')}</ul>`
          : '<p class="kxg-none">Nadie ha añadido redes sociales ni web todavía.</p>'}</section>
      ${textRowHTML('contact', 'messageCircle', 'Contacto', v.contact)}
      <p class="kxg-note">La información la aporta la comunidad. Si algo está mal, pulsa ${kxIcon('triangleAlert', { size: 14 })} para avisarnos y proponer un cambio: lo revisaremos.</p>`;
  }

  function addHTML() {
    const kinds = [{ value: 'hours', label: 'Horario' }, { value: 'price', label: 'Precios' }, { value: 'facility', label: 'Instalación' }, { value: 'photo', label: 'Foto' }, { value: 'link', label: 'Redes y web' }, { value: 'contact', label: 'Contacto' }];
    const used = new Set(items.filter(i => i.kind === 'facility').map(i => i.value));
    const ph = { hours: 'Ej.: L–V 10:00–23:00 · S–D 10:00–21:00', price: 'Ej.: Entrada 12 € · Bono 10 entradas 100 € · Mensual 55 €', contact: 'Ej.: 600 000 000 · info@rocodromo.es' };
    let field;
    if (addKind === 'photo') {
      field = `<label class="kxg-drop" for="kxg-file">${kxIcon('image', { size: 28 })}<strong>Elige una foto</strong><small>JPG, PNG o WebP. Se reduce antes de subirla.</small></label>
        <input type="file" id="kxg-file" accept="image/jpeg,image/png,image/webp" hidden>
        <p class="kxg-file-name" id="kxg-file-name" hidden></p>`;
    } else if (addKind === 'link') {
      const net = kxgNetwork(linkNet);
      field = `<p class="kxg-help">Elige la red y pega el enlace o el nombre de usuario.</p>
        <div class="kxg-fac-pick" role="radiogroup" aria-label="Red social">${KXG_NETWORKS.map(n => `<label class="kxg-fac-opt"><input type="radio" name="kxg-net" value="${n.key}"${n.key === linkNet ? ' checked' : ''}><span>${kxIcon(n.icon, { size: 16 })} ${kxEsc(n.label)}</span></label>`).join('')}</div>
        <div class="kxg-url">${kxFieldHTML({ id: 'kxg-url', label: 'Enlace o usuario', type: 'text', placeholder: net.ph, attrs: { inputmode: 'url', autocapitalize: 'none', autocomplete: 'off', spellcheck: 'false', maxlength: KXG_LINK_MAX } })}</div>`;
    } else if (addKind === 'facility') {
      field = `<p class="kxg-help">Marca todas las que tenga el rocódromo.</p><div class="kxg-fac-pick" role="group" aria-label="Instalaciones (puedes elegir varias)">${KXG_FACILITIES.map(f => `<label class="kxg-fac-opt${used.has(f.key) ? ' is-used' : ''}"><input type="checkbox" name="kxg-fac" value="${f.key}"${used.has(f.key) ? ' disabled' : ''}><span>${kxEsc(f.label)}</span>${used.has(f.key) ? '<small>Ya indicada</small>' : ''}</label>`).join('')}</div>`;
    } else {
      field = kxFieldHTML({ id: 'kxg-text', label: { hours: 'Horario', price: 'Precios', contact: 'Teléfono o correo' }[addKind], type: 'textarea', placeholder: ph[addKind], help: 'Si ya hay una versión, la tuya pasa a mostrarse en su lugar.', attrs: { maxlength: KXG_TEXT_MAX } });
    }
    return `${kxSegmentedHTML({ items: kinds, value: addKind, label: 'Qué quieres añadir', attrs: { id: 'kxg-kind' } })}<div class="kxg-form">${field}</div>`;
  }

  // Hoja de denuncia: se elige qué parte de la ficha está mal, el motivo y, si se quiere, el cambio propuesto
  function reportFormHTML() {
    const opts = reportables();
    const pick = opts.length
      ? `<div class="kxg-pick" role="radiogroup" aria-label="Parte de la ficha que denuncias">${opts.map((o, i) => `<label class="kxg-pick-opt">
          <input type="radio" name="kxg-part" value="${kxEsc(o.it.id)}"${i === 0 ? ' checked' : ''}>
          ${o.thumb ? `<img src="${kxEsc(o.thumb)}" alt="" draggable="false">` : ''}
          <span class="kxg-pick-text"><strong>${kxEsc(o.label)}</strong>${o.sub ? `<small>${kxEsc(o.sub)}</small>` : ''}</span></label>`).join('')}</div>`
      : '<p class="kxg-none">No hay información de otras personas que denunciar.</p>';
    return `<div class="kxg-field"><h3 class="kxg-label">¿Qué parte está mal?</h3>${pick}</div>
      <div class="kxg-field"><h3 class="kxg-label">¿Qué le pasa?</h3>
        ${kxSegmentedHTML({ items: KXG_REASONS, value: reportReason, label: 'Motivo de la denuncia', attrs: { id: 'kxg-reason' } })}</div>
      <div id="kxg-prop-slot"></div>`;
  }

  const selectedPart = () => {
    const sel = el.querySelector('input[name="kxg-part"]:checked');
    return sel ? items.find(i => i.id === sel.value) || null : null;
  };

  // El cambio se propone sobre la propia información: el campo sale con el valor actual para corregirlo
  // (horario, precios, contacto y enlaces). En fotos e instalaciones solo se avisa: el equipo decide si la quita.
  function renderProposal() {
    const slot = el.querySelector('#kxg-prop-slot');
    if (!slot) return;
    const it = selectedPart();
    if (!it) { slot.innerHTML = ''; return; }
    if (it.kind === 'link') {
      const n = kxgNetwork(it.network);
      slot.innerHTML = kxFieldHTML({ id: 'kxg-proposal', label: `Enlace de ${n ? n.label : 'la red'} correcto`, type: 'text', value: it.url, optional: true, help: 'Corrige el enlace. Solo tendremos que aceptar o rechazar tu propuesta.', attrs: { inputmode: 'url', autocapitalize: 'none', autocomplete: 'off', spellcheck: 'false', maxlength: KXG_LINK_MAX } });
    } else if (KXG_SINGLE.includes(it.kind)) {
      const label = { hours: 'Horario correcto', price: 'Precios correctos', contact: 'Contacto correcto' }[it.kind];
      slot.innerHTML = kxFieldHTML({ id: 'kxg-proposal', label, type: 'textarea', value: it.text, optional: true, help: 'Edita el texto con la información correcta. Solo tendremos que aceptar o rechazar tu propuesta.', attrs: { maxlength: KXG_TEXT_MAX } });
    } else {
      slot.innerHTML = '<p class="kxg-note">Revisaremos tu denuncia y, si es necesario, quitaremos esta información.</p>';
    }
    sheet.refresh();
  }

  function render({ keepScroll = false } = {}) {
    const body = el.querySelector('#kx-gym-body');
    const keep = body.scrollTop;
    const add = view === 'add', rep = view === 'report';
    el.querySelector('#kx-gym-drag').innerHTML = kxSheetDragHTML({ title: rep ? 'Denunciar información' : add ? 'Añadir información' : gym.nombre, titleId: 'kx-gym-title', metaHTML: add || rep ? kxEsc(gym.nombre) : 'Rocódromo', asideHTML: view === 'info' && reportables().length ? `<button type="button" class="kxg-report" data-kxg="report" aria-label="Denunciar información incorrecta" title="Denunciar información incorrecta">${kxIcon('triangleAlert', { size: 20 })}</button>` : '' });
    body.innerHTML = view === 'loading' ? kxSkeletonHTML('rows') : rep ? reportFormHTML() : add ? addHTML() : infoHTML();
    el.querySelector('#kx-gym-foot').innerHTML = rep
      ? kxButtonHTML({ label: 'Cancelar', variant: 'secondary', size: 'lg', attrs: { 'data-kxg': 'back' } }) + kxButtonHTML({ icon: 'triangleAlert', label: 'Enviar denuncia', size: 'lg', attrs: { 'data-kxg': 'send-report' } })
      : add
      ? kxButtonHTML({ label: 'Cancelar', variant: 'secondary', size: 'lg', attrs: { 'data-kxg': 'back' } }) + kxButtonHTML({ icon: 'check', label: 'Publicar', size: 'lg', attrs: { 'data-kxg': 'submit' } })
      : kxButtonHTML({ icon: 'navigation', label: 'Cómo llegar', variant: 'secondary', size: 'lg', attrs: { 'data-kxg': 'go' } }) + kxButtonHTML({ icon: 'plus', label: 'Aportar', size: 'lg', attrs: { 'data-kxg': 'add' } });
    body.scrollTop = keepScroll ? keep : 0;
    if (add) kxBindSegmented(el.querySelector('#kxg-kind'), (k) => { addKind = k; render(); });
    if (rep) kxBindSegmented(el.querySelector('#kxg-reason'), (v) => { reportReason = v; });
    if (rep) renderProposal();
    bindStage();
    bindFacilities();
    sheet.refresh();
  }

  async function load() {
    try {
      items = await KruxGymInfo.list(gym.id);
    } catch (e) {
      console.warn('[Rocódromos] No se pudo cargar la información:', e);
      items = [];
      toast('No se pudo cargar la información del rocódromo', 'error');
    }
  }

  async function open(p, coords) {
    ensure();
    // Una sola ficha a la vez: se cierran las de escuela, sector y vía si estaban abiertas
    ['hideBottomSheet', 'hideSectorBottomSheet', 'hideRouteBottomSheet'].forEach(fn => { try { if (typeof window[fn] === 'function') window[fn](); } catch (_) {} });
    gym = { ...p, coords };
    photoIdx = 0; facPage = 0;
    closeLightbox();
    const known = KruxGymInfo.cached(p.id);
    items = known || [];
    view = known ? 'info' : 'loading';
    render();
    if (sheet.state === 'hidden') sheet.open('expanded');
    const before = known ? JSON.stringify(known.map(i => [i.id, i.text, i.url])) : null;
    await load();
    if (!gym || gym.id !== p.id || lb) return;
    // Con datos ya pintados solo se vuelve a dibujar si algo cambió
    if (known && JSON.stringify(items.map(i => [i.id, i.text, i.url])) === before) return;
    if (view === 'loading' || view === 'info') { view = 'info'; render({ keepScroll: !!known }); }
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
        const tally = { created: 0, exists: 0 };
        for (const k of keys) tally[await KruxGymInfo.addFacility(gym.id, k)]++;
        const parts = [];
        if (tally.created) parts.push(tally.created === 1 ? '1 instalación añadida' : `${tally.created} instalaciones añadidas`);
        if (tally.exists) parts.push(tally.exists === 1 ? '1 ya estaba indicada' : `${tally.exists} ya estaban indicadas`);
        toast(parts.join(' · '), 'success');
      } else if (addKind === 'link') {
        const raw = el.querySelector('#kxg-url').value.trim();
        if (!raw) { kxSetFieldError('kxg-url', 'Escribe el enlace o el usuario'); return; }
        if (!kxgNormalizeLink(linkNet, raw)) { kxSetFieldError('kxg-url', `No parece un enlace de ${kxgNetwork(linkNet).label}`); return; }
        await KruxGymInfo.addLink(gym.id, linkNet, raw);
        toast('Enlace publicado', 'success');
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

  // Deslizador: la pista sigue al dedo mientras se arrastra y, al soltar, se asienta con una animación suave
  // (según la distancia o la velocidad del gesto). Sin desplazamiento nativo; con rebote en los extremos.
  const reducedMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function makeSlider(stage, track, { count, index, onChange, canDrag = () => true }) {
    let x0 = 0, y0 = 0, t0 = 0, dx = 0, drag = false, down = false, idx = index();
    const place = (i, extra = 0) => { track.style.transform = `translateX(calc(${-i * 100}% + ${extra}px))`; };
    const settle = (i) => {
      track.style.transition = reducedMotion() ? 'none' : 'transform 0.38s cubic-bezier(0.22, 0.9, 0.28, 1)';
      place(i);
    };
    const go = (i) => {
      const n = count();
      i = Math.max(0, Math.min(n - 1, i));
      if (i !== idx) { idx = i; onChange(i); }
      settle(i);
    };
    stage.addEventListener('pointerdown', (e) => {
      if ((e.button != null && e.button > 0) || !canDrag()) return;
      idx = index(); down = true; drag = false; dx = 0; x0 = e.clientX; y0 = e.clientY; t0 = performance.now();
    });
    stage.addEventListener('pointermove', (e) => {
      if (!down || !canDrag()) return;
      const mx = e.clientX - x0, my = e.clientY - y0;
      if (!drag) {
        if (Math.abs(mx) < 8 || Math.abs(mx) < Math.abs(my) * 1.2) return;   // gesto vertical: lo gestiona la página
        drag = true; track.style.transition = 'none';
        try { stage.setPointerCapture(e.pointerId); } catch (_) {}
      }
      const n = count();
      dx = (idx === 0 && mx > 0) || (idx === n - 1 && mx < 0) ? mx * 0.35 : mx;   // rebote en los extremos
      place(idx, dx);
    });
    const end = (e) => {
      if (!down) return;
      down = false;
      if (!drag) return;
      lastSwipe = Date.now();
      const w = stage.clientWidth || 1, v = dx / Math.max(1, performance.now() - t0);
      let target = idx;
      if (dx < -w * 0.2 || v < -0.45) target = idx + 1;
      else if (dx > w * 0.2 || v > 0.45) target = idx - 1;
      drag = false;
      go(target);
    };
    stage.addEventListener('pointerup', end);
    stage.addEventListener('pointercancel', end);
    stage.addEventListener('click', (e) => { if (Date.now() - lastSwipe < 350) { e.stopPropagation(); e.preventDefault(); } }, true);
    return { go, current: () => idx };
  }

  // Ampliar la foto abierta en grande, siempre a voluntad de la persona: pellizco o rueda del ratón, y arrastre para
  // moverla cuando está ampliada. Nunca se amplía sola (sin doble toque). Ampliada no se cambia de foto; sin ampliar, deslizar pasa a la siguiente.
  function bindZoom(root) {
    const MAX = 5;
    let sc = 1, tx = 0, ty = 0, pinch = null, pan = null, moved = false;
    const pts = new Map();
    const img = () => root.querySelectorAll('.kxg-lb-slide img')[photoIdx];
    const clamp = () => {
      const im = img(); if (!im) return;
      const lx = Math.max(0, (im.offsetWidth * sc - root.clientWidth) / 2), ly = Math.max(0, (im.offsetHeight * sc - root.clientHeight) / 2);
      tx = Math.max(-lx, Math.min(lx, tx)); ty = Math.max(-ly, Math.min(ly, ty));
      if (sc <= 1) { tx = 0; ty = 0; }
    };
    const apply = (smooth) => {
      const im = img(); if (!im) return;
      clamp();
      im.style.transition = smooth && !reducedMotion() ? 'transform 0.25s cubic-bezier(0.22, 0.9, 0.28, 1)' : 'none';
      im.style.transform = sc === 1 && !tx && !ty ? '' : `translate(${tx}px, ${ty}px) scale(${sc})`;
    };
    // Cambia la escala manteniendo fijo el punto (px, py) de la pantalla
    const zoomAt = (ns, px, py) => {
      ns = Math.max(1, Math.min(MAX, ns));
      const r = root.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const k = ns / sc;
      tx = (px - cx) - ((px - cx) - tx) * k; ty = (py - cy) - ((py - cy) - ty) * k;
      sc = ns;
    };
    const dist = () => { const [a, b] = [...pts.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
    const mid = () => { const [a, b] = [...pts.values()]; return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; };
    root.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.kxg-lb-close')) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      moved = false;
      if (pts.size === 2) { pinch = { d: dist(), sc }; pan = null; }
      else if (pts.size === 1) pan = { x: e.clientX, y: e.clientY, tx, ty };
    });
    root.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && pts.size >= 2) {
        const m = mid();
        zoomAt(pinch.sc * dist() / pinch.d, m.x, m.y); moved = true; apply(false);
      } else if (pan && sc > 1) {
        const dx = e.clientX - pan.x, dy = e.clientY - pan.y;
        if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
        tx = pan.tx + dx; ty = pan.ty + dy; apply(false);
      }
    });
    const up = (e) => {
      if (!pts.has(e.pointerId)) return;
      const was = pts.size;
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = null;
      if (pts.size === 1) { const [p] = [...pts.values()]; pan = { x: p.x, y: p.y, tx, ty }; }
      if (pts.size === 0) {
        pan = null;
        if (sc < 1.05) { sc = 1; tx = 0; ty = 0; apply(true); }
      }
    };
    root.addEventListener('pointerup', up);
    root.addEventListener('pointercancel', up);
    root.addEventListener('wheel', (e) => {
      e.preventDefault();
      zoomAt(sc * Math.exp(-e.deltaY * 0.0025), e.clientX, e.clientY); apply(false);
      if (sc < 1.02) { sc = 1; apply(true); }
    }, { passive: false });
    return { active: () => sc > 1 || pts.size > 1, reset: () => { sc = 1; tx = 0; ty = 0; root.querySelectorAll('.kxg-lb-slide img').forEach(i => { i.style.transform = ''; }); } };
  }

  // Foto a pantalla completa (se cierra con la X, Escape o tocando fuera de la imagen)
  let lb = null, lbCtl = null, galleryCtl = null, lastSwipe = 0;
  function closeLightbox() { if (lb) { lb.remove(); lb = null; lbCtl = null; document.removeEventListener('keydown', onLbKey); } }
  function onLbKey(e) {
    if (e.key === 'Escape') closeLightbox();
    else if (lbCtl && e.key === 'ArrowRight') lbCtl.go(lbCtl.current() + 1);
    else if (lbCtl && e.key === 'ArrowLeft') lbCtl.go(lbCtl.current() - 1);
  }
  function openLightbox() {
    const photos = kxgBuildView(items).photos;
    if (!photos.length) return;
    closeLightbox();
    lb = document.createElement('div');
    lb.className = 'kxg-lb';
    lb.setAttribute('role', 'dialog');
    lb.setAttribute('aria-modal', 'true');
    lb.setAttribute('aria-label', 'Foto en grande');
    lb.innerHTML = `<button type="button" class="kxg-lb-close" aria-label="Cerrar">${kxIcon('x', { size: 22 })}</button>
      <div class="kxg-lb-track" style="transform:translateX(-${photoIdx * 100}%)">${photos.map(ph => `<div class="kxg-lb-slide"><img src="${kxEsc(ph.photoUrl)}" alt="Foto de ${kxEsc(gym.nombre)}" draggable="false"></div>`).join('')}</div>
      ${photos.length > 1 ? `<span class="kxg-lb-count">${photoIdx + 1} / ${photos.length}</span>` : ''}`;
    document.body.appendChild(lb);
    document.addEventListener('keydown', onLbKey);
    const zoom = bindZoom(lb);
    lbCtl = makeSlider(lb, lb.querySelector('.kxg-lb-track'), {
      count: () => photos.length, index: () => photoIdx,
      canDrag: () => !zoom.active(),
      onChange: (i) => { photoIdx = i; zoom.reset(); const c = lb.querySelector('.kxg-lb-count'); if (c) c.textContent = `${i + 1} / ${photos.length}`; }
    });
    lb.addEventListener('click', (e) => {
      if (Date.now() - lastSwipe < 350) return;
      if (e.target.closest('.kxg-lb-close') || e.target === lb || e.target.classList.contains('kxg-lb-slide')) { closeLightbox(); render({ keepScroll: true }); }
    });
    lb.querySelector('.kxg-lb-close').focus();
  }

  // Galería de la ficha: deslizar cambia de foto con animación; un toque sin desplazamiento la abre en grande
  function bindStage() {
    galleryCtl = null;
    const stage = el.querySelector('[data-kxg-stage]');
    if (!stage) return;
    const photos = kxgBuildView(items).photos;
    galleryCtl = makeSlider(stage, stage.querySelector('.kxg-track'), {
      count: () => photos.length, index: () => photoIdx,
      onChange: (i) => {
        photoIdx = i;
        const c = stage.querySelector('.kxg-count'); if (c) c.textContent = `${i + 1} / ${photos.length}`;
      }
    });
    stage.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); galleryCtl.go(galleryCtl.current() + (e.key === 'ArrowRight' ? 1 : -1)); }
    });
  }

  // Páginas de instalaciones: mismo deslizamiento que las fotos
  function bindFacilities() {
    const box = el.querySelector('[data-kxg-facs]');
    if (!box) return;
    const pages = box.querySelectorAll('.kxg-fpage').length;
    if (pages < 2) return;
    makeSlider(box.querySelector('.kxg-fstage'), box.querySelector('.kxg-ftrack'), {
      count: () => pages, index: () => facPage,
      onChange: (i) => { facPage = i; box.querySelectorAll('.kxg-dot').forEach((d, k) => d.classList.toggle('is-on', k === i)); }
    });
  }

  const ACTIONS = {
    zoom() { if (Date.now() - lastSwipe > 400) openLightbox(); },
    add(btn) {
      if (!me()) { askLogin(); return; }
      addKind = (btn && btn.dataset.kind) || addKind;
      view = 'add';
      render();
    },
    back() { view = 'info'; render(); },
    submit,
    go() { window.open(`https://www.google.com/maps/dir/?api=1&destination=${gym.coords[1]},${gym.coords[0]}`, '_blank'); },
    report() {
      if (!me()) { askLogin(); return; }
      reportReason = 'incorrect';
      view = 'report';
      render();
    },
    async 'send-report'(btn) {
      if (busy) return;
      const item = selectedPart();
      if (!item) { toast('Elige qué parte está mal', 'info'); return; }
      // Propuesta: solo cuenta si cambia el valor actual; los enlaces se guardan ya normalizados
      let proposal = '';
      const field = el.querySelector('#kxg-proposal');
      if (field) {
        const val = field.value.trim();
        if (item.kind === 'link') {
          const href = val ? kxgNormalizeLink(item.network, val) : null;
          if (val && !href) { kxSetFieldError('kxg-proposal', `No parece un enlace de ${kxgNetwork(item.network).label}`); return; }
          proposal = href && href !== item.url ? href : '';
        } else {
          proposal = val !== String(item.text || '').trim() ? val : '';
        }
      }
      busy = true;
      btn.setAttribute('aria-busy', 'true');
      try {
        const r = await KruxGymInfo.report(item, reportReason, proposal);
        toast(r === 'already' ? 'Ya habías denunciado esto: lo estamos revisando' : 'Gracias: hemos recibido tu denuncia y la revisaremos', r === 'already' ? 'info' : 'success');
        view = 'info';
        render();
      } catch (e) {
        console.error('[Rocódromos] Error al denunciar:', e);
        toast('No se pudo enviar la denuncia. Revisa la conexión.', 'error');
      } finally { busy = false; btn.removeAttribute('aria-busy'); }
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
    if (e.target.name === 'kxg-part') renderProposal();
    if (e.target.name === 'kxg-net') {
      linkNet = e.target.value;
      const inp = el.querySelector('#kxg-url');
      inp.placeholder = kxgNetwork(linkNet).ph;
      kxSetFieldError('kxg-url', '');
    }
  }

  return { open, warm: KruxGymInfo.warm };
})();

window.KruxGymSheet = KruxGymSheet;

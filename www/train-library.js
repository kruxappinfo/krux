// ================== ENTRENA — BIBLIOTECA DE EJERCICIOS Y ASISTENTE DE PLANES ==================
// Interfaz sobre el catálogo (train-catalog-data.js + train-exercises.js):
//   KruxLibrary: buscador, filtros combinables, fichas y modo «selección» para el editor de planes.
//   KruxWizard:  asistente de 4 pasos que propone un plan editable (reglas deterministas).
// Reutiliza los estilos y componentes de Entrena (--tr-*, pe-*). Carga después de app_3.js.
(function () {
  'use strict';
  const K = window.KruxExercises;
  if (!K || !window.KRUX_CATALOG_DATA) return;

  const esc = text => (typeof trEsc === 'function' ? trEsc(text) : String(text == null ? '' : text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
  const $ = id => document.getElementById(id);
  const toast = (msg, type, opts) => { if (typeof showToast === 'function') showToast(msg, type, opts); };

  // ── Catálogo: base empaquetada (+ ampliación opcional desde Firestore) ──
  let catalog = K.createCatalog(window.KRUX_CATALOG_DATA);
  let remotePromise = null;

  // Las fichas globales publicadas en Firestore (exercises/{id}) amplían o actualizan el catálogo
  // base. Si no hay red o las reglas aún no lo permiten, se sigue con el catálogo empaquetado.
  function loadRemote() {
    if (!remotePromise) remotePromise = fetchRemote();
    return remotePromise;
  }

  async function fetchRemote() {
    try {
      // Sin sesión no se intenta (se reintentará al abrir la biblioteca ya identificado)
      if (typeof db === 'undefined' || !firebase.auth().currentUser) { remotePromise = null; return; }
      const snap = await db.collection('exercises').where('status', '==', 'published').get();
      if (snap.empty) return;
      const merged = new Map(catalog.exercises.map(e => [e.id, e]));
      const base = { ...window.KRUX_CATALOG_DATA };
      const accepted = [];
      snap.forEach(doc => {
        const ex = { ...doc.data(), id: doc.id };
        const current = merged.get(ex.id);
        if (current && (current.contentVersion || 1) >= (ex.contentVersion || 1)) return;
        const probe = K.createCatalog({ ...base, exercises: base.exercises.concat(accepted, [ex]) });
        if (K.validateExercise(ex, probe).length) return;     // una ficha inválida nunca entra
        accepted.push(ex);
        merged.set(ex.id, ex);
      });
      if (accepted.length) catalog = K.createCatalog({ ...base, exercises: Array.from(merged.values()) });
    } catch (error) {
      remotePromise = null;   // se reintenta la próxima vez
    }
  }

  // ── Favoritos (users/{uid}/exercise_favorites/{exerciseId}) ──────────
  let favorites = new Set();
  let favoritesLoadedFor = null;

  const uid = () => (firebase.auth().currentUser || {}).uid || null;

  async function loadFavorites() {
    const id = uid();
    if (!id) { favorites = new Set(); favoritesLoadedFor = null; return; }
    if (favoritesLoadedFor === id) return;
    try {
      const snap = await db.collection('users').doc(id).collection('exercise_favorites').get();
      favorites = new Set(snap.docs.map(d => d.id));
      favoritesLoadedFor = id;
    } catch (error) {
      console.error('Error cargando favoritos de ejercicios:', error);
    }
  }

  async function toggleFavorite(exerciseId) {
    const id = uid();
    if (!id) { toast('Inicia sesión para guardar favoritos', 'info'); return false; }
    const ref = db.collection('users').doc(id).collection('exercise_favorites').doc(exerciseId);
    const had = favorites.has(exerciseId);
    if (had) favorites.delete(exerciseId); else favorites.add(exerciseId);   // se refleja al instante
    const write = had ? ref.delete() : ref.set({ exerciseId, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
    const settled = write.then(() => true, error => {
      if (had) favorites.add(exerciseId); else favorites.delete(exerciseId);   // el servidor lo rechazó: se deshace
      console.error('Error guardando el favorito:', error);
      toast('No se ha podido guardar el favorito', 'error', { detail: typeof kxFriendlyError === 'function' ? kxFriendlyError(error) : 'Inténtalo de nuevo.' });
      return false;
    });
    // Sin red la promesa no termina: tras 8 s se avisa y se deja en cola (si falla después, se deshace igualmente)
    const first = await Promise.race([settled, new Promise(r => setTimeout(() => r('pending'), 8000))]);
    if (first === 'pending') {
      toast('Sin conexión', 'info', { detail: 'El favorito se guardará cuando vuelva la conexión.' });
      return true;
    }
    return first;
  }

  try {
    firebase.auth().onAuthStateChanged(user => {
      if (!user) { favorites = new Set(); favoritesLoadedFor = null; remotePromise = null; }
    });
  } catch (_) { /* sin Firebase: la biblioteca funciona con el catálogo empaquetado */ }

  // ── Iconos ───────────────────────────────────────────────────────────
  const ICON_PATHS = {
    finger: '<path d="M8 21v-8a2 2 0 0 1 4 0v-5a2 2 0 0 1 4 0v3a2 2 0 0 1 4 0v7a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4z"/>',
    pull: '<path d="M4 4h16"/><path d="M8 4v6a4 4 0 0 0 8 0V4"/><path d="M12 14v7"/><path d="M9 18l3 3 3-3"/>',
    bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
    wave: '<path d="M2 12c2.5-6 5.5-6 8 0s5.5 6 8 0"/><path d="M20 12h2"/>',
    foot: '<path d="M7 20h10"/><path d="M8 20c-1-3-1-6 0-9l3-5a2 2 0 0 1 3.4 2L13 12h3a3 3 0 0 1 3 3v5"/>',
    core: '<circle cx="12" cy="12" r="9"/><path d="M12 7v10"/><path d="M8 9h8"/><path d="M8 15h8"/>',
    route: '<circle cx="6" cy="19" r="2"/><circle cx="18" cy="5" r="2"/><path d="M8 19h6a4 4 0 0 0 0-8h-4a4 4 0 0 1 0-8h6"/>',
    shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
    flow: '<path d="M4 8c3 0 3-3 6-3s3 3 6 3 3-3 4-3"/><path d="M4 16c3 0 3-3 6-3s3 3 6 3 3-3 4-3"/>',
    dumbbell: '<rect x="2.5" y="9" width="2.5" height="6" rx="1.25"/><rect x="5.5" y="6" width="3" height="12" rx="1.5"/><line x1="8.5" y1="12" x2="15.5" y2="12"/><rect x="15.5" y="6" width="3" height="12" rx="1.5"/><rect x="19" y="9" width="2.5" height="6" rx="1.25"/>'
  };
  const svg = (body, size, sw) => `<svg width="${size || 20}" height="${size || 20}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw || 1.8}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  const I = {
    back: svg('<polyline points="15 18 9 12 15 6"></polyline>', 22, 2.2),
    close: svg('<line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>', 18, 2),
    search: svg('<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.5" y2="16.5"/>', 18, 2),
    filter: svg('<line x1="4" y1="6" x2="20" y2="6"/><line x1="7" y1="12" x2="17" y2="12"/><line x1="10" y1="18" x2="14" y2="18"/>', 18, 2),
    plus: svg('<line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line>', 18, 2.2),
    check: svg('<polyline points="20 6 9 17 4 12"></polyline>', 16, 2.6),
    chev: svg('<polyline points="9 18 15 12 9 6"></polyline>', 18, 2),
    heart: svg('<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z"/>', 20, 2),
    heartFill: '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z"/></svg>',
    warn: svg('<path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>', 18, 2),
    spark: svg('<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/>', 20, 1.8)
  };
  const categoryIcon = (catId, size) => {
    const c = catalog.catById.get(catId);
    return svg(ICON_PATHS[(c && c.icon) || 'dumbbell'], size || 24, 1.7);
  };

  const levelName = n => K.LEVEL_LABELS[n] || '';
  const catShort = c => c.name.split(/,| y /)[0];
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const equipNames = ex => {
    const req = ex.equipment.required.filter(id => id !== 'peso-corporal').map(id => (catalog.eqById.get(id) || {}).short).filter(Boolean);
    return req.length ? req.join(' + ') : 'Sin material';
  };
  const mainAbility = ex => K.TAGS.abilities[ex.abilities[0]] || '';

  // ═══════════════════════════════════════════════════════════════════
  // BIBLIOTECA
  // ═══════════════════════════════════════════════════════════════════
  const FILTER_GROUPS = [
    { key: 'abilities', label: 'Capacidad', options: () => Object.entries(K.TAGS.abilities).map(([id, name]) => [id, name]) },
    { key: 'bodyAreas', label: 'Zona corporal', options: () => Object.entries(K.TAGS.bodyAreas) },
    { key: 'equipment', label: 'Material', options: () => [['ninguno', 'Sin material']].concat(catalog.equipment.filter(e => e.id !== 'peso-corporal').map(e => [e.id, e.name])) },
    { key: 'technicalLevel', label: 'Nivel técnico', options: () => [[1, 'Principiante'], [2, 'Intermedio'], [3, 'Avanzado']] },
    { key: 'physicalDemand', label: 'Exigencia física', options: () => [[1, 'Baja'], [2, 'Media'], [3, 'Alta']] },
    { key: 'durations', label: 'Duración', options: () => Object.entries(K.DURATION_BUCKETS).map(([id, b]) => [id, b.label]) },
    { key: 'disciplines', label: 'Modalidad', options: () => Object.entries(K.TAGS.climbingDisciplines) },
    { key: 'contexts', label: 'Contexto', options: () => Object.entries(K.TAGS.trainingContexts) }
  ];
  const emptyFilters = () => ({ abilities: [], bodyAreas: [], equipment: [], technicalLevel: [], physicalDemand: [], durations: [], disciplines: [], contexts: [] });
  const PAGE = 40;

  let lib = null;   // estado de la biblioteca abierta
  let libTimer = null;

  function libModal() { return $('ex-library-modal'); }

  function activeFilterCount() {
    return FILTER_GROUPS.reduce((n, g) => n + lib.filters[g.key].length, 0);
  }

  function results() {
    return K.filterExercises(catalog, {
      query: lib.query,
      categoryId: lib.categoryId,
      favoritesOnly: lib.favoritesOnly,
      favoriteIds: Array.from(favorites),
      abilities: lib.filters.abilities,
      bodyAreas: lib.filters.bodyAreas,
      equipment: lib.filters.equipment,
      technicalLevel: lib.filters.technicalLevel,
      physicalDemand: lib.filters.physicalDemand,
      durations: lib.filters.durations,
      disciplines: lib.filters.disciplines,
      contexts: lib.filters.contexts
    });
  }

  async function openLibrary(opts) {
    const o = opts || {};
    lib = {
      mode: o.mode === 'pick' ? 'pick' : 'browse',
      single: !!o.single,
      title: o.title || '',
      onPick: o.onPick || null,
      query: '',
      categoryId: o.categoryId || null,
      favoritesOnly: false,
      filters: emptyFilters(),
      limit: PAGE,
      added: new Set(),
      addedCount: 0,
      detailId: null,
      stack: []
    };
    renderLibrary();
    const modal = libModal();
    modal.classList.remove('hidden');
    requestAnimationFrame(() => modal.classList.add('pe-open'));
    setTimeout(() => { const h = $('xl-heading'); if (h) h.focus({ preventScroll: true }); }, 320);
    // Datos que pueden llegar después sin bloquear la pantalla
    Promise.all([loadRemote(), loadFavorites()]).then(() => {
      if (lib && libModal().classList.contains('pe-open')) { renderChips(); renderList(); }
    });
  }

  function closeLibrary() {
    closeSheet(true);
    const modal = libModal();
    modal.classList.remove('pe-open');
    setTimeout(() => modal.classList.add('hidden'), 280);
    lib = null;
  }

  function renderLibrary() {
    const pick = lib.mode === 'pick';
    libModal().innerHTML = `
      <div class="pe-screen xl-screen">
        <header class="pe-topbar xl-topbar">
          <button type="button" class="pe-icon-btn pe-back-btn" id="xl-back" aria-label="${pick ? 'Cerrar biblioteca' : 'Volver'}">${I.back}</button>
          <div class="pe-heading">
            <h2 class="pe-title" id="xl-heading" tabindex="-1">${pick ? 'Añadir ejercicio' : 'Ejercicios'}</h2>
            <p class="pe-subtitle">${esc(pick && lib.title ? lib.title : 'Biblioteca de entrenamiento')}</p>
          </div>
          <button type="button" class="xl-filter-btn" id="xl-filter-btn" aria-haspopup="dialog">${I.filter}<span>Filtrar</span><em class="xl-badge" id="xl-badge" hidden></em></button>
        </header>
        <div class="xl-toolbar">
          <div class="xl-search">
            <span class="xl-search-icon">${I.search}</span>
            <input id="xl-search" type="search" inputmode="search" enterkeyhint="search" autocomplete="off" placeholder="Buscar ejercicio, material o zona" aria-label="Buscar ejercicio">
            <button type="button" class="xl-search-clear" id="xl-search-clear" aria-label="Borrar búsqueda" hidden>${I.close}</button>
          </div>
          <div class="xl-chips" id="xl-chips" role="group" aria-label="Categorías"></div>
        </div>
        <div class="xl-scroll" id="xl-scroll">
          <p class="xl-count" id="xl-count" aria-live="polite"></p>
          <div class="xl-list" id="xl-list"></div>
        </div>
        ${pick && !lib.single ? `<div class="xl-pickbar"><button type="button" class="pe-save-btn pe-save-btn--wide" id="xl-done"><span id="xl-done-label">Listo</span></button></div>` : ''}
        <div class="xl-detail hidden" id="xl-detail"></div>
      </div>`;

    $('xl-back').onclick = closeLibrary;
    $('xl-filter-btn').onclick = openFilterSheet;
    const input = $('xl-search');
    input.oninput = () => {
      lib.query = input.value;
      $('xl-search-clear').hidden = !input.value;
      clearTimeout(libTimer);
      libTimer = setTimeout(() => { lib.limit = PAGE; renderList(); }, 120);
    };
    $('xl-search-clear').onclick = () => {
      input.value = '';
      lib.query = '';
      $('xl-search-clear').hidden = true;
      lib.limit = PAGE;
      renderList();
      input.focus();
    };
    $('xl-chips').onclick = e => {
      const chip = e.target.closest('[data-cat]');
      if (!chip) return;
      const v = chip.dataset.cat;
      if (v === 'fav') { lib.favoritesOnly = !lib.favoritesOnly; if (lib.favoritesOnly) lib.categoryId = null; }
      else { lib.favoritesOnly = false; lib.categoryId = v === 'all' ? null : v; }
      lib.limit = PAGE;
      renderChips();
      renderList();
    };
    $('xl-list').onclick = onListClick;
    const done = $('xl-done');
    if (done) done.onclick = closeLibrary;
    renderChips();
    renderList();
    updateBadge();
  }

  function renderChips() {
    const box = $('xl-chips');
    if (!box) return;
    const chip = (value, label, on) => `<button type="button" class="xl-chip${on ? ' is-on' : ''}" data-cat="${value}" aria-pressed="${on ? 'true' : 'false'}">${esc(label)}</button>`;
    box.innerHTML =
      chip('all', 'Todos', !lib.categoryId && !lib.favoritesOnly) +
      (uid() ? chip('fav', `Favoritos${favorites.size ? ` · ${favorites.size}` : ''}`, lib.favoritesOnly) : '') +
      catalog.categories.map(c => chip(c.id, catShort(c), lib.categoryId === c.id)).join('');
    const on = box.querySelector('.is-on');
    if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest', inline: 'center' });
  }

  function updateBadge() {
    const badge = $('xl-badge');
    if (!badge) return;
    const n = activeFilterCount();
    badge.hidden = !n;
    badge.textContent = n;
    $('xl-filter-btn').setAttribute('aria-label', n ? `Filtrar, ${n} filtros activos` : 'Filtrar');
  }

  function cardHTML(ex) {
    const added = lib.mode === 'pick' && lib.added.has(ex.id);
    return `
      <article class="xl-card" data-id="${esc(ex.id)}">
        <button type="button" class="xl-card-main" data-open="${esc(ex.id)}">
          <span class="xl-thumb">${categoryIcon(ex.primaryCategoryId, 26)}</span>
          <span class="xl-card-body">
            <span class="xl-card-name">${esc(ex.name)}</span>
            <span class="xl-card-meta">${esc(mainAbility(ex))} · ${esc(levelName(ex.technicalLevel))}</span>
            <span class="xl-card-tags"><span class="xl-pill">${esc(equipNames(ex))}</span><span class="xl-pill">${ex.durationMin} min</span></span>
          </span>
          ${lib.mode === 'pick' ? '' : `<span class="xl-card-chev">${I.chev}</span>`}
        </button>
        ${lib.mode === 'pick' ? `<button type="button" class="xl-add${added ? ' is-added' : ''}" data-add="${esc(ex.id)}" aria-label="${added ? 'Añadido' : 'Añadir'} ${esc(ex.name)}">${added ? I.check : I.plus}</button>` : ''}
      </article>`;
  }

  function renderList() {
    const list = $('xl-list');
    if (!list) return;
    const found = results();
    const shown = found.slice(0, lib.limit);
    $('xl-count').textContent = found.length ? plural(found.length, 'ejercicio', 'ejercicios') : '';
    updateBadge();

    if (!found.length) {
      const filtered = lib.query || activeFilterCount() || lib.categoryId || lib.favoritesOnly;
      list.innerHTML = `
        <div class="pe-empty xl-empty">
          <p class="pe-empty-title">${lib.favoritesOnly && !favorites.size ? 'Aún no tienes favoritos' : 'No hay ejercicios con estos criterios'}</p>
          <p class="pe-empty-text">${lib.favoritesOnly && !favorites.size ? 'Toca el corazón de una ficha para guardarla aquí.' : 'Prueba con otra palabra o quita algún filtro.'}</p>
          ${filtered ? '<button type="button" class="pe-add-ex-btn xl-reset" id="xl-reset">Quitar filtros</button>' : ''}
        </div>`;
      const reset = $('xl-reset');
      if (reset) reset.onclick = () => {
        lib.query = ''; lib.categoryId = null; lib.favoritesOnly = false; lib.filters = emptyFilters(); lib.limit = PAGE;
        $('xl-search').value = ''; $('xl-search-clear').hidden = true;
        renderChips(); renderList();
      };
      return;
    }
    list.innerHTML = shown.map(cardHTML).join('') +
      (found.length > shown.length ? `<button type="button" class="pe-add-ex-btn xl-more" id="xl-more">Mostrar más (${found.length - shown.length})</button>` : '');
    const more = $('xl-more');
    if (more) more.onclick = () => { lib.limit += PAGE; renderList(); };
  }

  function addToPick(ex) {
    if (!lib || !lib.onPick) return false;
    const item = K.planItemFromExercise(ex);
    const ok = lib.onPick(item, ex);
    if (ok === false) return false;
    lib.added.add(ex.id);
    lib.addedCount++;
    const label = $('xl-done-label');
    if (label) label.textContent = `Listo · ${lib.addedCount} ${lib.addedCount === 1 ? 'añadido' : 'añadidos'}`;
    if (lib.single) { closeLibrary(); return true; }
    toast(`${ex.name} añadido`, 'success', { duration: 1600 });
    return true;
  }

  function onListClick(e) {
    const add = e.target.closest('[data-add]');
    if (add) {
      const ex = catalog.byId.get(add.dataset.add);
      if (ex && addToPick(ex)) {
        add.classList.add('is-added');
        add.innerHTML = I.check;
      }
      return;
    }
    const open = e.target.closest('[data-open]');
    if (open) openDetail(open.dataset.open);
  }

  // ── Filtros (hoja inferior) ──────────────────────────────────────────
  function closeSheet(immediate) {
    const sheet = $('xl-sheet');
    if (!sheet) return;
    sheet.id = '';
    if (immediate) { sheet.remove(); return; }
    sheet.classList.remove('pe-lib-open');
    setTimeout(() => sheet.remove(), 250);
  }

  function openSheetShell(title, bodyHTML, footerHTML) {
    closeSheet(true);
    const sheet = document.createElement('div');
    sheet.id = 'xl-sheet';
    sheet.className = 'pe-lib-sheet xl-sheet';
    sheet.innerHTML = `
      <div class="pe-lib-backdrop" data-close></div>
      <div class="pe-lib-panel" role="dialog" aria-modal="true" aria-labelledby="xl-sheet-title">
        <div class="pe-lib-handle" aria-hidden="true"></div>
        <div class="pe-lib-head">
          <h3 class="pe-lib-title" id="xl-sheet-title">${esc(title)}</h3>
          <button type="button" class="pe-icon-btn" data-close aria-label="Cerrar">${I.close}</button>
        </div>
        <div class="xl-sheet-body">${bodyHTML}</div>
        ${footerHTML || ''}
      </div>`;
    libModal().appendChild(sheet);
    sheet.addEventListener('click', e => { if (e.target.closest('[data-close]')) closeSheet(); });
    requestAnimationFrame(() => sheet.classList.add('pe-lib-open'));
    return sheet;
  }

  function openFilterSheet() {
    const body = FILTER_GROUPS.map(g => `
      <fieldset class="xl-fgroup">
        <legend class="pe-label">${g.label}</legend>
        <div class="xl-fchips">
          ${g.options().map(([id, name]) => `<button type="button" class="xl-chip${lib.filters[g.key].includes(id) ? ' is-on' : ''}" data-fk="${g.key}" data-fv="${id}" aria-pressed="${lib.filters[g.key].includes(id) ? 'true' : 'false'}">${esc(name)}</button>`).join('')}
        </div>
      </fieldset>`).join('');
    const footer = `
      <div class="xl-sheet-foot">
        <button type="button" class="xl-clear" id="xl-fclear">Borrar filtros</button>
        <button type="button" class="pe-save-btn" id="xl-fapply"><span id="xl-fapply-label"></span></button>
      </div>`;
    const sheet = openSheetShell('Filtrar ejercicios', body, footer);

    const refresh = () => {
      const n = results().length;
      $('xl-fapply-label').textContent = n ? `Ver ${plural(n, 'ejercicio', 'ejercicios')}` : 'Sin resultados';
      renderList();
    };
    sheet.querySelector('.xl-sheet-body').onclick = e => {
      const chip = e.target.closest('[data-fk]');
      if (!chip) return;
      const key = chip.dataset.fk;
      const raw = chip.dataset.fv;
      const value = key === 'technicalLevel' || key === 'physicalDemand' ? parseInt(raw, 10) : raw;
      const arr = lib.filters[key];
      const idx = arr.indexOf(value);
      if (idx >= 0) arr.splice(idx, 1); else arr.push(value);
      chip.classList.toggle('is-on', idx < 0);
      chip.setAttribute('aria-pressed', idx < 0 ? 'true' : 'false');
      lib.limit = PAGE;
      refresh();
    };
    $('xl-fclear').onclick = () => {
      lib.filters = emptyFilters();
      sheet.querySelectorAll('[data-fk]').forEach(c => { c.classList.remove('is-on'); c.setAttribute('aria-pressed', 'false'); });
      refresh();
    };
    $('xl-fapply').onclick = () => closeSheet();
    refresh();
  }

  // ═══════════════════════════════════════════════════════════════════
  // FICHA
  // ═══════════════════════════════════════════════════════════════════
  const REL_TITLES = {
    variants: 'Variantes', regressions: 'Más fácil', progressions: 'Más difícil',
    alternatives: 'Alternativas', prerequisites: 'Antes de este ejercicio', relatedExercises: 'Relacionados'
  };

  function section(title, inner, cls) {
    return inner ? `<section class="xl-sec${cls ? ' ' + cls : ''}"><h3 class="pe-label">${esc(title)}</h3>${inner}</section>` : '';
  }
  const list = (items, ordered) => items && items.length ? `<${ordered ? 'ol' : 'ul'} class="xl-bullets">${items.map(i => `<li>${esc(i)}</li>`).join('')}</${ordered ? 'ol' : 'ul'}>` : '';

  // ── Contenido compartido por la ficha completa y la guía rápida ──────────
  // Una sola implementación: lo que se ve en la guía sale de las mismas funciones que la ficha.
  const stopList = ex => Array.from(new Set((ex.instructions.stopCriteria || []).concat(ex.safety.stopCriteria || [])));

  const secSetup = ex => section('Preparación', ex.instructions.setup ? `<p class="xl-text">${esc(ex.instructions.setup)}</p>` : '');
  const secSteps = ex => {
    const ins = ex.instructions;
    return section('Cómo se hace', ins.executionSteps && ins.executionSteps.length ? `<ol class="xl-steps">${ins.executionSteps.map(s => `<li><b>${esc(s.title)}</b><span>${esc(s.description)}</span></li>`).join('')}</ol>${ins.breathing ? `<p class="xl-text xl-text--muted">Respiración: ${esc(ins.breathing)}</p>` : ''}` : '');
  };
  const secCues = ex => section('Claves técnicas', list(ex.instructions.keyCues));
  const secMistakes = ex => section('Errores frecuentes', ex.instructions.commonMistakes && ex.instructions.commonMistakes.length ? `<ul class="xl-mistakes">${ex.instructions.commonMistakes.map(m => `<li><b>${esc(m.name)}</b><span>${esc(m.correction)}</span></li>`).join('')}</ul>` : '');
  const secValid = ex => section('Ejecución válida', list(ex.instructions.completionCriteria));
  const secSafety = ex => {
    const stops = stopList(ex);
    return stops.length || ex.safety.warnings.length || ex.safety.prerequisites.length || ex.safety.supervisionRequired ? `
          <section class="xl-sec xl-alert" role="note">
            <h3 class="xl-alert-title">${I.warn}<span>Seguridad</span></h3>
            ${ex.safety.supervisionRequired ? '<p class="xl-text"><b>Conviene hacerlo con supervisión de un entrenador.</b></p>' : ''}
            ${list(ex.safety.warnings)}
            ${ex.safety.prerequisites.length ? `<p class="xl-text xl-text--muted">Requisitos: ${esc(ex.safety.prerequisites.join(' '))}</p>` : ''}
            ${stops.length ? `<p class="xl-text"><b>Detén el ejercicio si:</b></p>${list(stops)}` : ''}
          </section>` : '';
  };
  const reviewNote = ex => ex.review.status === 'reviewed'
    ? `<p class="xl-review is-ok">Contenido revisado por ${esc(ex.review.reviewedBy)}.</p>`
    : '<p class="xl-review">Contenido orientativo, pendiente de revisión por un entrenador. No sustituye el consejo de un profesional.</p>';

  // Imagen o vídeo SOLO si está verificado; si no hay o falla la carga, ficha textual (icono en la completa)
  const fallbackHero = ex => `<div class="xl-hero" aria-hidden="true"><span class="xl-hero-icon">${categoryIcon(ex.primaryCategoryId, 44)}</span></div>`;
  function mediaBlock(ex, compact) {
    const items = K.verifiedMedia(ex);
    if (!items.length) return compact ? '' : fallbackHero(ex);
    const fig = m => {
      const attrs = m.storagePath ? `data-storage="${esc(m.storagePath)}"` : `src="${esc(m.externalUrl)}"`;
      const tag = m.type === 'video'
        ? `<video class="xg-media-el" ${attrs} controls muted loop playsinline preload="none"${m.posterPath ? '' : ''} aria-label="${esc(m.caption || ex.name)}"></video>`
        : `<img class="xg-media-el" ${attrs} alt="${esc(m.caption || ex.name)}" loading="lazy" decoding="async" referrerpolicy="no-referrer">`;
      return `<figure class="xg-media-item">${tag}<figcaption>${esc(m.caption || '')}${m.caption ? ' · ' : ''}${esc(m.attribution)}</figcaption></figure>`;
    };
    return `<div class="xg-media" data-fallback="${compact ? 'none' : 'hero'}">${items.map(fig).join('')}</div>`;
  }

  // Resuelve rutas de Storage y retira lo que no cargue: nunca rompe la guía
  function hydrateMedia(root) {
    root.querySelectorAll('.xg-media').forEach(box => {
      const ex = catalog.byId.get(box.closest('[data-guide-for]') ? box.closest('[data-guide-for]').dataset.guideFor : '');
      const drop = el => {
        const fig = el.closest('figure');
        if (fig) fig.remove();
        if (!box.querySelector('figure')) {
          if (box.dataset.fallback === 'hero' && ex) box.outerHTML = fallbackHero(ex); else box.remove();
        }
      };
      box.querySelectorAll('.xg-media-el').forEach(el => {
        el.addEventListener('error', () => drop(el), { once: true });
        if (el.dataset.storage) {
          try {
            firebase.storage().ref(el.dataset.storage).getDownloadURL().then(url => { el.src = url; }, () => drop(el));
          } catch (_) { drop(el); }
        }
      });
    });
  }

  // Guía rápida: mismo contenido, solo lo necesario para ejecutar el ejercicio
  function guideHTML(ex) {
    return `<div class="xg-content" data-guide-for="${esc(ex.id)}">
      ${mediaBlock(ex, true)}
      <p class="xl-lead">${esc(ex.shortDescription)}</p>
      ${secSetup(ex)}${secSteps(ex)}${secCues(ex)}${secMistakes(ex)}${secSafety(ex)}
      ${reviewNote(ex)}
    </div>`;
  }

  function detailHTML(ex) {
    const ins = ex.instructions;
    const cat = catalog.catById.get(ex.primaryCategoryId);
    const eqReq = ex.equipment.required.map(id => (catalog.eqById.get(id) || {}).name).filter(Boolean);
    const eqOpt = ex.equipment.optional.map(id => (catalog.eqById.get(id) || {}).name).filter(Boolean);
    const eqAlt = ex.equipment.alternatives.filter(id => !ex.equipment.required.includes(id)).map(id => (catalog.eqById.get(id) || {}).name).filter(Boolean);
    const tags = [].concat(
      ex.abilities.map(id => K.TAGS.abilities[id]),
      ex.bodyAreas.map(id => K.TAGS.bodyAreas[id]),
      ex.movementPatterns.map(id => K.TAGS.movementPatterns[id])
    );
    const rels = K.getRelations(catalog, ex);
    const rxRows = (ex.prescriptionSchema || []).map(p => {
      const def = K.PARAMS[p.param];
      const value = p.default;
      if (!def || !value) return '';           // sin valor inicial (0 o vacío): no se muestra
      const unit = def.unit ? ` ${def.unit}` : '';
      return `<div class="xl-fact"><dt>${esc(p.label || def.label)}</dt><dd>${esc(value)}${unit}</dd></div>`;
    }).join('');

    return `
      <header class="pe-topbar xl-topbar">
        <button type="button" class="pe-icon-btn pe-back-btn" id="xl-detail-back" aria-label="Volver">${I.back}</button>
        <div class="pe-heading">
          <h2 class="pe-title xl-detail-title" id="xl-detail-title" tabindex="-1">${esc(ex.name)}</h2>
          <p class="pe-subtitle">${esc(cat ? cat.name : '')}</p>
        </div>
        <button type="button" class="xl-fav-btn${favorites.has(ex.id) ? ' is-on' : ''}" id="xl-fav" aria-pressed="${favorites.has(ex.id) ? 'true' : 'false'}" aria-label="${favorites.has(ex.id) ? 'Quitar de favoritos' : 'Guardar en favoritos'}">${favorites.has(ex.id) ? I.heartFill : I.heart}</button>
      </header>
      <div class="xl-detail-scroll" data-guide-for="${esc(ex.id)}">
        ${mediaBlock(ex, false)}
        <p class="xl-lead">${esc(ex.shortDescription)}</p>
        <div class="xl-tagrow">${tags.map(t => `<span class="xl-pill xl-pill--soft">${esc(t)}</span>`).join('')}</div>

        <dl class="xl-facts">
          <div class="xl-fact"><dt>Nivel técnico</dt><dd>${esc(levelName(ex.technicalLevel))}</dd></div>
          <div class="xl-fact"><dt>Exigencia física</dt><dd>${esc(K.DEMAND_LABELS[ex.physicalDemand])}</dd></div>
          <div class="xl-fact"><dt>Material</dt><dd>${esc(equipNames(ex))}</dd></div>
          <div class="xl-fact"><dt>Duración típica</dt><dd>≈ ${ex.durationMin} min</dd></div>
        </dl>

        ${section('Objetivo', `<p class="xl-text">${esc(ex.purpose)}</p>`)}
        ${section('Material', `<p class="xl-text">${esc(eqReq.length ? eqReq.join(', ') + '.' : 'No necesitas material.')}${eqAlt.length ? ` Alternativa: ${esc(eqAlt.join(', '))}.` : ''}${eqOpt.length ? ` Opcional: ${esc(eqOpt.join(', '))}.` : ''}</p>${ex.equipment.setupNotes ? `<p class="xl-text xl-text--muted">${esc(ex.equipment.setupNotes)}</p>` : ''}`)}
        ${secSetup(ex)}${secSteps(ex)}${secCues(ex)}${secMistakes(ex)}${secValid(ex)}${secSafety(ex)}
        ${rels.map(g => section(REL_TITLES[g.type], `<div class="xl-rels">${g.items.map(i => `
          <button type="button" class="xl-rel" data-rel="${esc(i.ex.id)}">
            <span class="xl-rel-icon">${categoryIcon(i.ex.primaryCategoryId, 20)}</span>
            <span class="xl-rel-body"><b>${esc(i.ex.name)}</b><small>${esc(i.rel.reason)}</small></span>
            ${I.chev}
          </button>`).join('')}</div>`)).join('')}
        ${section('Parámetros orientativos', rxRows ? `<dl class="xl-facts xl-facts--rx">${rxRows}</dl><p class="xl-text xl-text--muted">Valores de partida. Ajústalos según tu nivel, tu objetivo y cómo te sientas ese día.</p>` : '')}
        ${ins.coachingNotes ? section('Notas', `<p class="xl-text">${esc(ins.coachingNotes)}</p>`) : ''}
        ${reviewNote(ex)}
      </div>
      <div class="xl-detail-foot">
        <button type="button" class="pe-save-btn pe-save-btn--wide" id="xl-add-plan">${I.plus}<span id="xl-add-label"></span></button>
      </div>`;
  }

  function openDetail(id, fromBack) {
    const ex = catalog.byId.get(id);
    if (!ex || !lib) return;
    if (!fromBack && lib.detailId) lib.stack.push(lib.detailId);
    lib.detailId = id;
    const box = $('xl-detail');
    box.innerHTML = detailHTML(ex);
    hydrateMedia(box);
    box.classList.remove('hidden');
    requestAnimationFrame(() => box.classList.add('is-open'));
    const pick = lib.mode === 'pick';
    const added = pick && lib.added.has(id);
    $('xl-add-label').textContent = pick ? (added ? 'Añadido · añadir otra vez' : 'Añadir a la sesión') : 'Añadir a mi plan';

    $('xl-detail-back').onclick = detailBack;
    const paintFav = () => {
      const btn = $('xl-fav');
      if (!btn) return;
      const on = favorites.has(id);
      btn.classList.toggle('is-on', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      btn.setAttribute('aria-label', on ? 'Quitar de favoritos' : 'Guardar en favoritos');
      btn.innerHTML = on ? I.heartFill : I.heart;
      renderChips();
    };
    $('xl-fav').onclick = async () => {
      const pending = toggleFavorite(id);   // el cambio local es inmediato
      paintFav();
      await pending;
      paintFav();                           // si el servidor lo rechazó, vuelve al estado anterior
    };
    $('xl-add-plan').onclick = () => {
      if (pick) { if (addToPick(ex)) { $('xl-add-label').textContent = 'Añadido · añadir otra vez'; } }
      else addToActivePlan(ex);
    };
    box.querySelector('.xl-detail-scroll').onclick = e => {
      const rel = e.target.closest('[data-rel]');
      if (rel) { openDetail(rel.dataset.rel); box.querySelector('.xl-detail-scroll').scrollTop = 0; }
    };
    box.querySelector('.xl-detail-scroll').scrollTop = 0;
    const title = $('xl-detail-title');
    if (title) title.focus({ preventScroll: true });
  }

  function detailBack() {
    if (!lib) return;
    if (lib.stack.length) { openDetail(lib.stack.pop(), true); return; }
    lib.detailId = null;
    const box = $('xl-detail');
    box.classList.remove('is-open');
    setTimeout(() => { if (lib && !lib.detailId) box.classList.add('hidden'); }, 250);
  }

  // «Añadir a mi plan» desde el modo exploración: elige sesión del plan activo
  function addToActivePlan(ex) {
    const plan = window.kruxActivePlan;
    if (!plan || !Array.isArray(plan.sessions) || !plan.sessions.length) {
      toast('Aún no tienes un plan', 'info', { detail: 'Crea uno desde «Crear plan» o con el asistente y vuelve a añadirlo.' });
      return;
    }
    const body = `<div class="xl-rels">${plan.sessions.map((s, i) => `
      <button type="button" class="xl-rel" data-sess="${i}">
        <span class="xl-rel-icon xl-rel-icon--day">${esc(s.day && s.day !== '?' ? s.day : '?')}</span>
        <span class="xl-rel-body"><b>${esc(s.name)}</b><small>${plural(s.exercises.length, 'ejercicio', 'ejercicios')}</small></span>
        ${I.chev}
      </button>`).join('')}</div>`;
    const sheet = openSheetShell('Añadir a una sesión', body);
    sheet.querySelector('.xl-sheet-body').onclick = async e => {
      const btn = e.target.closest('[data-sess]');
      if (!btn) return;
      const sess = plan.sessions[parseInt(btn.dataset.sess, 10)];
      if (sess.exercises.length >= 30) { toast('Máximo 30 ejercicios por sesión', 'info'); return; }
      sess.exercises.push(K.planItemFromExercise(ex));
      closeSheet();
      const signedIn = !!uid();
      const ok = signedIn ? await KruxTrainStore.savePlan(plan) : true;
      if (!ok) { sess.exercises.pop(); }
      else {
        toast(`${ex.name} añadido a ${sess.name}`, 'success', signedIn ? undefined : { detail: 'Inicia sesión para guardarlo en tu cuenta.' });
      }
      if (typeof window.refreshTrainView === 'function') window.refreshTrainView();
    };
  }

  // ═══════════════════════════════════════════════════════════════════
  // ASISTENTE
  // ═══════════════════════════════════════════════════════════════════
  const GOAL_OPTIONS = [
    ['fuerza', 'Fuerza', 'Dedos, tracción y fuerza máxima', 'dumbbell'],
    ['resistencia', 'Resistencia', 'Aguantar más escalando', 'wave'],
    ['potencia', 'Potencia', 'Movimientos explosivos', 'bolt'],
    ['tecnica', 'Técnica', 'Moverte mejor con menos esfuerzo', 'route'],
    ['general', 'Mejora general', 'Un poco de todo', 'flow']
  ];
  const LEVEL_OPTIONS = [
    [1, 'Principiante', 'Empiezo o escalo de forma ocasional'],
    [2, 'Intermedio', 'Escalo con regularidad y conozco los ejercicios básicos'],
    [3, 'Avanzado', 'Entreno con constancia y tengo experiencia con trabajo de dedos']
  ];
  const MINUTES = [30, 45, 60, 90];

  let wiz = null;

  function wizModal() { return $('plan-wizard-modal'); }

  function openWizard() {
    wiz = { step: 1, goal: null, level: null, days: 3, minutes: 60, equipment: [], proposal: null };
    renderWizard();
    const modal = wizModal();
    modal.classList.remove('hidden');
    requestAnimationFrame(() => modal.classList.add('pe-open'));
  }

  function closeWizard() {
    const modal = wizModal();
    modal.classList.remove('pe-open');
    setTimeout(() => modal.classList.add('hidden'), 280);
    wiz = null;
  }

  const STEP_TITLES = { 1: '¿Cuál es tu objetivo?', 2: '¿Qué experiencia tienes?', 3: '¿Cuánto tiempo tienes?', 4: '¿Con qué material cuentas?' };

  function canAdvance() {
    if (wiz.step === 1) return !!wiz.goal;
    if (wiz.step === 2) return !!wiz.level;
    return true;
  }

  function wizBody() {
    if (wiz.step === 1) {
      return `<div class="xl-opts" role="radiogroup" aria-labelledby="wz-title">${GOAL_OPTIONS.map(([id, name, desc, icon]) => `
        <button type="button" class="xl-opt${wiz.goal === id ? ' is-on' : ''}" role="radio" aria-checked="${wiz.goal === id}" data-goal="${id}">
          <span class="xl-opt-icon">${svg(ICON_PATHS[icon], 24, 1.7)}</span>
          <span class="xl-opt-text"><b>${name}</b><small>${desc}</small></span>
          <span class="xl-opt-check">${I.check}</span>
        </button>`).join('')}</div>`;
    }
    if (wiz.step === 2) {
      return `<div class="xl-opts" role="radiogroup" aria-labelledby="wz-title">${LEVEL_OPTIONS.map(([id, name, desc]) => `
        <button type="button" class="xl-opt${wiz.level === id ? ' is-on' : ''}" role="radio" aria-checked="${wiz.level === id}" data-level="${id}">
          <span class="xl-opt-icon xl-opt-icon--n">${id}</span>
          <span class="xl-opt-text"><b>${name}</b><small>${desc}</small></span>
          <span class="xl-opt-check">${I.check}</span>
        </button>`).join('')}</div>
        <p class="pe-hint">Con nivel principiante no se proponen ejercicios intensos de dedos, campus ni cargas altas.</p>`;
    }
    if (wiz.step === 3) {
      return `
        <div class="pe-card">
          <h3 class="pe-label" id="wz-days-label">Días por semana</h3>
          <div class="xl-seg" role="radiogroup" aria-labelledby="wz-days-label">${[1, 2, 3, 4, 5, 6].map(n => `<button type="button" class="xl-seg-btn${wiz.days === n ? ' is-on' : ''}" role="radio" aria-checked="${wiz.days === n}" data-days="${n}">${n}</button>`).join('')}</div>
          <div class="pe-divider" aria-hidden="true"></div>
          <h3 class="pe-label" id="wz-min-label">Tiempo por sesión</h3>
          <div class="xl-seg" role="radiogroup" aria-labelledby="wz-min-label">${MINUTES.map(n => `<button type="button" class="xl-seg-btn${wiz.minutes === n ? ' is-on' : ''}" role="radio" aria-checked="${wiz.minutes === n}" data-min="${n}">${n} min</button>`).join('')}</div>
          <p class="pe-hint">Los días y el tiempo se podrán ajustar después en el editor.</p>
        </div>`;
    }
    return `
      <div class="pe-card">
        <div class="xl-fchips">${catalog.equipment.filter(e => e.id !== 'peso-corporal').map(e => `<button type="button" class="xl-chip xl-chip--lg${wiz.equipment.includes(e.id) ? ' is-on' : ''}" data-eq="${e.id}" aria-pressed="${wiz.equipment.includes(e.id)}">${esc(e.name)}</button>`).join('')}</div>
        <p class="pe-hint">El peso corporal siempre está disponible. Solo se proponen ejercicios que puedas hacer con lo que marques.</p>
      </div>`;
  }

  function proposalBody() {
    const p = wiz.proposal;
    const DAY = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
    const DAY_NAMES = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
    const rows = DAY.map((d, i) => {
      const s = p.sessions.find(x => x.day === d);
      if (!s) return `<li class="xl-week-row is-rest"><span class="xl-week-day">${d}</span><span class="xl-week-name">Descanso</span></li>`;
      return `<li class="xl-week-row"><span class="xl-week-day is-on" title="${DAY_NAMES[i]}">${d}</span>
        <details class="xl-week-session"><summary><span class="xl-week-name">${esc(s.name)}</span><span class="xl-week-meta">${plural(s.exercises.length, 'ejercicio', 'ejercicios')} · ≈ ${K.estimateMinutes(s.exercises)} min</span></summary>
          <ul class="xl-why">${s.exercises.map(it => `<li><b>${esc(it.name)}</b><small>${esc(it.why || '')}</small></li>`).join('')}</ul>
        </details></li>`;
    }).join('');
    return `
      <div class="pe-card">
        <h3 class="xl-prop-name">${esc(p.name)}</h3>
        <p class="xl-text xl-text--muted">${K.GOALS[p.goal].label} · ${esc(levelName(p.level))} · ${plural(p.weeks, 'semana', 'semanas')} · ${plural(p.sessions.length, 'sesión', 'sesiones')} por semana</p>
        <ul class="xl-week" aria-label="Semana tipo">${rows}</ul>
        <p class="pe-hint">Es una semana tipo que se repite durante todo el plan. No incluye progresión semanal automática.</p>
      </div>
      ${p.notes.length ? `<div class="xl-alert xl-alert--soft" role="note"><h3 class="xl-alert-title">${I.warn}<span>Ten en cuenta</span></h3>${list(p.notes)}</div>` : ''}`;
  }

  function renderWizard(focusSel) {
    const proposal = wiz.step === 5;
    const title = proposal ? 'Tu propuesta' : STEP_TITLES[wiz.step];
    wizModal().innerHTML = `
      <div class="pe-screen xl-screen">
        <header class="pe-topbar xl-topbar">
          <button type="button" class="pe-icon-btn pe-back-btn" id="wz-back" aria-label="${wiz.step === 1 ? 'Cerrar asistente' : 'Paso anterior'}">${I.back}</button>
          <div class="pe-heading">
            <p class="pe-subtitle xl-step">${proposal ? 'Asistente de planes' : `Paso ${wiz.step} de 4`}</p>
            <h2 class="pe-title xl-wz-title" id="wz-title" tabindex="-1">${title}</h2>
          </div>
        </header>
        <div class="xl-progress" aria-hidden="true"><span style="width:${proposal ? 100 : (wiz.step - 1) * 25 + 10}%"></span></div>
        <div class="xl-scroll xl-wz-scroll" id="wz-scroll">${proposal ? proposalBody() : wizBody()}</div>
        <div class="xl-pickbar">
          ${proposal
            ? `<button type="button" class="pe-save-btn pe-save-btn--wide" id="wz-go"><span>Revisar y editar</span></button>`
            : `<button type="button" class="pe-save-btn pe-save-btn--wide" id="wz-next"${canAdvance() ? '' : ' disabled'}><span>${wiz.step === 4 ? 'Ver propuesta' : 'Siguiente'}</span></button>`}
        </div>
      </div>`;
    $('wz-back').onclick = () => {
      if (wiz.step === 1) closeWizard();
      else { wiz.step = wiz.step === 5 ? 4 : wiz.step - 1; renderWizard(); }
    };
    const t = $('wz-title');
    const keep = focusSel && $('wz-scroll').querySelector(focusSel);
    if (keep) keep.focus({ preventScroll: true });
    else if (t) t.focus({ preventScroll: true });

    const scroll = $('wz-scroll');
    scroll.onclick = e => {
      const el = e.target.closest('[data-goal],[data-level],[data-days],[data-min],[data-eq]');
      if (!el) return;
      if (el.dataset.goal) wiz.goal = el.dataset.goal;
      else if (el.dataset.level) wiz.level = parseInt(el.dataset.level, 10);
      else if (el.dataset.days) wiz.days = parseInt(el.dataset.days, 10);
      else if (el.dataset.min) wiz.minutes = parseInt(el.dataset.min, 10);
      else {
        const id = el.dataset.eq;
        wiz.equipment = wiz.equipment.includes(id) ? wiz.equipment.filter(x => x !== id) : wiz.equipment.concat(id);
      }
      const top = scroll.scrollTop;
      const attr = Object.keys(el.dataset)[0];
      renderWizard(`[data-${attr === 'min' ? 'min' : attr}="${el.dataset[attr]}"]`);
      $('wz-scroll').scrollTop = top;
    };
    const next = $('wz-next');
    if (next) next.onclick = () => {
      if (!canAdvance()) return;
      if (wiz.step === 4) {
        wiz.proposal = K.recommendPlan(catalog, { goal: wiz.goal, level: wiz.level, days: wiz.days, minutes: wiz.minutes, equipment: wiz.equipment });
        wiz.step = 5;
      } else wiz.step++;
      renderWizard();
    };
    const go = $('wz-go');
    if (go) go.onclick = () => {
      const p = wiz.proposal;
      if (!p.sessions.length) { toast('No hay ejercicios compatibles', 'info', { detail: 'Vuelve atrás y añade material o baja la exigencia.' }); return; }
      closeWizard();
      if (typeof window.openPlanEditor === 'function') window.openPlanEditor({ draft: p });
    };
  }

  // ═══════════════════════════════════════════════════════════════════
  // GUÍA RÁPIDA «CÓMO HACERLO»
  // ═══════════════════════════════════════════════════════════════════
  // Hoja superpuesta (no desmonta nada de lo que hay debajo): el cronómetro, la serie, las cargas
  // y los campos del entrenamiento siguen intactos mientras se consulta. Solo se lee la ficha.
  const GUIDE_ICON = svg('<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><path d="M9 7h7M9 11h5"/>', 18, 2);
  let guide = null;   // { trigger, id }

  function guideButton(exerciseId, extraClass) {
    return `<button type="button" class="xg-btn${extraClass ? ' ' + extraClass : ''}" data-guide="${esc(exerciseId)}">${GUIDE_ICON}<span>Cómo hacerlo</span></button>`;
  }

  // Ficha asociada a un ejercicio de plan (por id o, en planes antiguos, por nombre exacto)
  function guideIdFor(item) {
    if (!item) return null;
    if (item.exerciseId && catalog.byId.has(item.exerciseId)) return item.exerciseId;
    const ex = K.resolveByName(catalog, item.name);
    return ex ? ex.id : null;
  }

  function fitGuide() {
    const vv = window.visualViewport;
    const h = vv ? vv.height : window.innerHeight;
    document.documentElement.style.setProperty('--xg-vh', Math.round(h) + 'px');
  }

  function openGuide(exerciseId, opts) {
    const ex = catalog.byId.get(exerciseId);
    const sheet = $('ex-guide-sheet');
    if (!ex || !sheet) return false;
    if (guide) closeGuide(true);
    guide = { id: exerciseId, trigger: (opts && opts.trigger) || document.activeElement };
    const running = !!(window.KruxTrainSession && window.KruxTrainSession.isRunning());
    $('xg-title').textContent = ex.name;
    $('xg-body').innerHTML = guideHTML(ex);
    hydrateMedia($('xg-body'));
    $('xg-done').querySelector('span').textContent = running ? 'Volver al entrenamiento' : 'Cerrar';
    const full = $('xg-full');
    full.hidden = running;       // durante un entrenamiento no se sale hacia la biblioteca
    full.dataset.exercise = exerciseId;
    sheet.classList.remove('hidden');
    document.body.classList.add('xg-open');
    fitGuide();
    if (window.visualViewport) window.visualViewport.addEventListener('resize', fitGuide);
    requestAnimationFrame(() => sheet.classList.add('is-open'));
    $('xg-body').scrollTop = 0;
    setTimeout(() => $('xg-title').focus({ preventScroll: true }), 60);
    return true;
  }

  function closeGuide(immediate) {
    const sheet = $('ex-guide-sheet');
    if (!sheet || !guide) return;
    const trigger = guide.trigger;
    guide = null;
    if (window.visualViewport) window.visualViewport.removeEventListener('resize', fitGuide);
    document.body.classList.remove('xg-open');
    sheet.classList.remove('is-open');
    const finish = () => { if (!guide) sheet.classList.add('hidden'); };
    if (immediate) finish(); else setTimeout(finish, 240);
    // Vuelve al mismo control, sin desplazar nada
    if (trigger && document.contains(trigger) && typeof trigger.focus === 'function') trigger.focus({ preventScroll: true });
  }

  document.addEventListener('DOMContentLoaded', () => {
    const sheet = $('ex-guide-sheet');
    if (!sheet) return;
    sheet.addEventListener('click', e => {
      if (e.target.closest('[data-xg-close]')) { closeGuide(); return; }
      const full = e.target.closest('#xg-full');
      if (full) { const id = full.dataset.exercise; closeGuide(true); window.KruxLibrary.openSheet(id); }
    });
    // Foco dentro de la hoja mientras está abierta
    sheet.addEventListener('keydown', e => {
      if (e.key !== 'Tab' || !guide) return;
      const f = Array.from(sheet.querySelectorAll('button:not([hidden]), [tabindex="-1"]:not(.xg-panel)')).filter(el => el.offsetParent !== null);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
  });

  // Cualquier botón con data-guide abre la guía de ese ejercicio
  document.addEventListener('click', e => {
    const btn = e.target.closest('[data-guide]');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    openGuide(btn.dataset.guide, { trigger: btn });
  }, true);

  // Escape cierra solo la guía (por encima del entrenamiento y de la biblioteca)
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && guide) { e.stopImmediatePropagation(); closeGuide(); }
  }, true);

  // Cierre con Escape de lo que esté arriba
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if ($('xl-sheet')) { closeSheet(); return; }
    if (lib && lib.detailId) { detailBack(); return; }
    if (lib && libModal().classList.contains('pe-open')) { closeLibrary(); return; }
    if (wiz && wizModal().classList.contains('pe-open')) closeWizard();
  });

  window.KruxGuide = {
    open: openGuide, close: closeGuide, button: guideButton, idFor: guideIdFor, isOpen: () => !!guide,
    // Solo para pruebas: simula la altura visible con el teclado abierto
    _fit: h => document.documentElement.style.setProperty('--xg-vh', h + 'px')
  };
  window.KruxLibrary = {
    html: { guide: guideHTML, detail: detailHTML },
    open: openLibrary,
    close: closeLibrary,
    // Abre la ficha de un ejercicio concreto (p. ej. desde el editor de un ejercicio del plan)
    openSheet(exerciseId) {
      openLibrary({ mode: 'browse' });
      openDetail(exerciseId);
    },
    catalog: () => catalog,
    categoryIcon
  };
  window.KruxWizard = { open: openWizard };
})();

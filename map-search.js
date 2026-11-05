// ================== BUSCADOR DEL MAPA ==================
// Búsqueda en línea de escuelas, sectores y vías (sin personas) en la barra superior del mapa.
// Las sugerencias salen justo debajo de la barra: sin hojas ni modales. Usa el mismo índice de lugares
// que la búsqueda global (window.KruxPlaces, definido en app_3.js) y abre cada destino con la misma lógica.

// ============================================
// SUGERENCIAS (lógica pura, sin DOM)
// ============================================
const MAP_SEARCH_MIN_CHARS = 2;
const MAP_SEARCH_LIMITS = { school: 3, sector: 4, route: 6 };

/**
 * Agrupa los resultados para una consulta. Escuelas y sectores salen de matchPlaces, las vías de matchRoutes.
 * A igualdad de relevancia, lo de la escuela que está abierta en el mapa va primero.
 * @returns {{schools: object[], sectors: object[], routes: object[]}}
 */
function mapSearchSuggest(places, query, currentSchoolId) {
  const q = String(query || '').trim();
  const empty = { schools: [], sectors: [], routes: [] };
  if (!places || q.length < MAP_SEARCH_MIN_CHARS) return empty;
  const nq = places.norm(q);
  const sameSchoolFirst = (list, idOf) => {
    if (!currentSchoolId) return list;
    const rank = (x) => (x.key.startsWith(nq) ? 0 : 1);
    return list
      .map((x, i) => ({ x, i }))
      .sort((a, b) => rank(a.x) - rank(b.x) || (idOf(b.x) === currentSchoolId) - (idOf(a.x) === currentSchoolId) || a.i - b.i)
      .map(({ x }) => x);
  };
  const found = places.index;
  const placeHits = places.matchPlaces(found, q);
  const schools = placeHits.filter(p => p.kind === 'school').slice(0, MAP_SEARCH_LIMITS.school);
  const sectors = sameSchoolFirst(placeHits.filter(p => p.kind === 'sector'), (x) => x.schoolId).slice(0, MAP_SEARCH_LIMITS.sector);
  const routes = sameSchoolFirst(places.matchRoutes(found, q), (x) => x.schoolId).slice(0, MAP_SEARCH_LIMITS.route);
  return { schools, sectors, routes };
}

if (typeof window !== 'undefined') window.KruxMapSearchLogic = { suggest: mapSearchSuggest, MIN_CHARS: MAP_SEARCH_MIN_CHARS };

// ============================================
// INTERFAZ
// ============================================
function initMapSearch() {
  const wrap = document.getElementById('map-search-wrap');
  const input = document.getElementById('map-search-input');
  const clearBtn = document.getElementById('map-search-clear');
  const list = document.getElementById('map-suggest');
  if (!wrap || !input || !list) return;

  let index = null;          // índice de lugares (se carga la primera vez que se enfoca el campo)
  let loading = null;
  let loadFailed = false;
  let shown = [];            // filas pintadas, en orden: se abren por posición
  let active = -1;           // fila resaltada con el teclado
  let seq = 0;

  const esc = (t) => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const places = () => window.KruxPlaces;

  const ICONS = {
    mountain: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 20l6.5-11 4 6.5 2.5-4L21 20z"></path></svg>',
    sector: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19l4-12 4 6 3-4 5 10z"></path><circle cx="16.5" cy="5.5" r="1.5"></circle></svg>',
    clock: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><polyline points="12 7 12 12 15 14"></polyline></svg>'
  };

  // ---------- Carga del índice ----------
  function ensureIndex() {
    if (index) return Promise.resolve(index);
    if (loading) return loading;
    const api = places();
    if (!api) return Promise.reject(new Error('Buscador no disponible'));
    loadFailed = false;
    loading = api.load().then(idx => { index = idx; loading = null; return idx; })
      .catch(err => { loading = null; loadFailed = true; throw err; });
    return loading;
  }

  // Foco en el mapa: la fila resaltada que sea una escuela da el foco a su marcador (estado «en foco»)
  function focusRow(i) {
    if (typeof window.kxFocusSchool !== 'function') return;
    const it = shown[i];
    window.kxFocusSchool(it && it.kind === 'school' ? it.id : null);
  }

  // ---------- Apertura y cierre ----------
  function setOpen(open) {
    list.hidden = !open;
    input.setAttribute('aria-expanded', String(open));
    wrap.classList.toggle('is-open', open);
    if (!open) {
      active = -1;
      input.removeAttribute('aria-activedescendant');
      if (typeof window.kxFocusSchool === 'function') window.kxFocusSchool(null);
    }
  }

  function updateClear() {
    clearBtn.hidden = input.value.length === 0;
  }

  // ---------- Pintado ----------
  function gradeChip(grade) {
    return typeof kxGradeChipHTML === 'function' ? kxGradeChipHTML(grade, 'search-grade') : `<span class="search-grade">${esc(grade || '?')}</span>`;
  }

  function rowHTML(it, i) {
    const open = `role="option" id="map-suggest-${i}" data-i="${i}" aria-selected="${i === active}"`;
    if (it.kind === 'school') {
      const stats = [
        it.sectors ? `${it.sectors} ${it.sectors === 1 ? 'sector' : 'sectores'}` : '',
        it.routes ? `${it.routes} ${it.routes === 1 ? 'vía' : 'vías'}` : ''
      ].filter(Boolean).join(' · ');
      return `<div class="search-row ms-row" ${open}><span class="search-thumb">${ICONS.mountain}</span><div class="search-info"><div class="search-title">${esc(it.name)}</div><div class="search-meta">Escuela${stats ? ` · ${stats}` : ''}</div></div></div>`;
    }
    if (it.kind === 'sector') {
      return `<div class="search-row ms-row" ${open}><span class="search-thumb search-thumb--soft">${ICONS.sector}</span><div class="search-info"><div class="search-title">${esc(it.name)}</div><div class="search-meta">Sector · ${esc(it.schoolName)}</div></div></div>`;
    }
    const meta = [it.sector ? `Sector ${esc(it.sector)}` : '', esc(it.schoolName)].filter(Boolean).join(' · ');
    return `<div class="search-row ms-row" ${open}>${gradeChip(it.grade)}<div class="search-info"><div class="search-title">${esc(it.name)}</div><div class="search-meta">${meta}</div></div></div>`;
  }

  function render(sections, heads) {
    shown = [];
    let html = '';
    sections.forEach((items, s) => {
      if (!items.length) return;
      html += `<div class="ms-head" role="presentation">${heads[s]}</div>`;
      items.forEach(it => { html += rowHTML(it, shown.length); shown.push(it); });
    });
    list.innerHTML = html;
    setOpen(true);
  }

  function renderState(title, hint = '') {
    shown = [];
    list.innerHTML = `<div class="ms-state" role="presentation"><div class="ms-state-title">${esc(title)}</div>${hint ? `<div class="ms-state-hint">${esc(hint)}</div>` : ''}</div>`;
    setOpen(true);
  }

  function renderRecent() {
    const api = places();
    const recent = api ? api.recent() : [];
    if (!recent.length) { setOpen(false); return; }
    // Los recientes se guardan como {type, id|schoolId, name}: se pintan con la forma de los resultados
    const items = recent.map(it => (it.type === 'school'
      ? { kind: 'school', id: it.id, name: it.name, recent: true }
      : it.type === 'sector'
        ? { kind: 'sector', schoolId: it.schoolId, schoolName: it.schoolName, name: it.name, recent: true }
        : { kind: 'route', schoolId: it.schoolId, schoolName: it.schoolName, name: it.name, grade: it.grade, sector: it.sector, recent: true }));
    render([items], [`${ICONS.clock}<span>Recientes</span>`]);
  }

  function run() {
    const my = ++seq;
    const q = input.value.trim();
    updateClear();
    if (q.length === 0) { renderRecent(); return; }
    if (q.length < MAP_SEARCH_MIN_CHARS) { renderState('Sigue escribiendo', 'Escribe al menos 2 letras'); return; }
    if (!places()) { renderState('El buscador no está listo', 'Inténtalo de nuevo en unos segundos'); return; }
    if (!index) {
      renderState('Cargando…');
      ensureIndex().then(() => { if (my === seq || input.value.trim() === q) run(); })
        .catch(() => { if (my === seq) renderState('No se pudo cargar la cartografía', 'Revisa tu conexión y vuelve a escribir'); });
      return;
    }
    const currentSchool = typeof mlCurrentSchool !== 'undefined' ? mlCurrentSchool : null;
    const api = places();
    const res = mapSearchSuggest({ index, norm: api.norm, matchPlaces: api.matchPlaces, matchRoutes: api.matchRoutes }, q, currentSchool);
    if (!res.schools.length && !res.sectors.length && !res.routes.length) {
      renderState(`Sin resultados para «${q}»`, 'Prueba con el nombre de una escuela, un sector o una vía');
      return;
    }
    render([res.schools, res.sectors, res.routes], ['Escuelas', 'Sectores', 'Vías']);
  }

  // ---------- Elegir una sugerencia ----------
  async function choose(i) {
    const it = shown[i];
    const api = places();
    if (!it || !api) return;
    let target = it;
    if (it.recent) {
      // Un reciente se resuelve contra la cartografía actual (puede que ya no exista)
      try {
        const idx = await ensureIndex();
        target = it.kind === 'school' ? idx.schools.find(x => x.id === it.id)
          : it.kind === 'sector' ? idx.sectors.find(x => x.schoolId === it.schoolId && x.name === it.name)
            : idx.routes.find(x => x.schoolId === it.schoolId && x.name === it.name && (x.sector || '') === (it.sector || ''));
      } catch (_) { target = null; }
      if (!target) {
        if (typeof showToast === 'function') showToast('Ese resultado ya no está disponible', 'info');
        return;
      }
    }
    api.remember(target.kind === 'school'
      ? { type: 'school', id: target.id, name: target.name }
      : target.kind === 'sector'
        ? { type: 'sector', schoolId: target.schoolId, schoolName: target.schoolName, name: target.name }
        : { type: 'route', schoolId: target.schoolId, schoolName: target.schoolName, name: target.name, grade: target.grade, sector: target.sector });
    input.value = target.name;
    updateClear();
    setOpen(false);
    input.blur();
    // Mientras el mapa viaja a la escuela, su marcador conserva el foco
    if (target.kind === 'school' && typeof window.kxFocusSchool === 'function') window.kxFocusSchool(target.id, { untilMoveEnd: true });
    api.open(target);
  }

  function setActive(next) {
    if (!shown.length) return;
    active = (next + shown.length) % shown.length;
    list.querySelectorAll('.ms-row').forEach((el, i) => el.setAttribute('aria-selected', String(i === active)));
    const el = document.getElementById(`map-suggest-${active}`);
    input.setAttribute('aria-activedescendant', `map-suggest-${active}`);
    if (el) el.scrollIntoView({ block: 'nearest' });
    focusRow(active);
  }

  // ---------- Eventos ----------
  input.addEventListener('focus', () => {
    // El buscador y los paneles de filtro y leyenda no conviven abiertos
    if (typeof closeGradeFilterPanel === 'function') closeGradeFilterPanel();
    if (typeof closeLegendPanel === 'function') closeLegendPanel();
    ensureIndex().catch(() => {});   // precarga mientras se escribe
    run();
  });

  input.addEventListener('input', run);

  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (list.hidden) run(); else setActive(active + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(active - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); if (shown.length) choose(active >= 0 ? active : 0); }
    else if (e.key === 'Escape') { setOpen(false); input.blur(); }
  });

  // Tocar una sugerencia (click: no compite con el desplazamiento de la lista)
  list.addEventListener('click', (e) => {
    const row = e.target.closest('.ms-row');
    if (row) choose(Number(row.dataset.i));
  });
  // En escritorio, el campo no pierde el foco al pulsar la lista
  list.addEventListener('mousedown', (e) => e.preventDefault());
  // Ratón sobre una fila: foco en su marcador; al salir de la lista, se retira
  list.addEventListener('mouseover', (e) => {
    const row = e.target.closest('.ms-row');
    if (row) focusRow(Number(row.dataset.i));
  });
  list.addEventListener('mouseleave', () => focusRow(active));

  clearBtn.addEventListener('click', () => {
    input.value = '';
    input.focus();
    run();
  });

  // Tocar fuera cierra las sugerencias (pointerdown: también en iOS, donde un toque en el mapa no siempre genera click)
  document.addEventListener('pointerdown', (e) => {
    if (list.hidden) return;
    if (!wrap.contains(e.target)) { setOpen(false); input.blur(); }
  });

  // Al salir del mapa no se deja el teclado ni las sugerencias abiertas
  new MutationObserver(() => {
    const view = document.getElementById('map-view');
    if (view && view.classList.contains('hidden')) { setOpen(false); input.blur(); }
  }).observe(document.getElementById('map-view') || document.body, { attributes: true, attributeFilter: ['class'] });

  updateClear();
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initMapSearch);
  else initMapSearch();
}

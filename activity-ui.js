// ================== ACTIVIDAD — INTERFAZ (Roca y Rocódromo) ==================
// Pinta las secciones de #activity-view a partir de las ascensiones que ya carga
// loadActivityData() en app_3.js (una sola lectura de Firestore: aquí no se pide nada nuevo
// salvo los GeoJSON estáticos de las escuelas para leer la longitud de las vías).
//
// Reutiliza de app_3.js: parseAscentDate, isGymAscent, calculateAndUpdateStats (+ spans stat-*),
// _rocoGradeIndex/_rocoMaxGrade/_rocoAvgGrade, GYM_ROCO_GRADE_SCALE, STYLE_LABELS,
// _navigateToGymOnMap, getProjects (user-features.js), getGradeColor (maplibre-config.js),
// getSectorGalleryImages (sector-images.js) y los datos de _gthDefs/_gthMeasures (tests físicos).
(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nf = { format: n => String(Math.round(Number(n))).replace(/\B(?=(\d{3})+(?!\d))/g, '.') };
  const nf1 = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 });
  const pad = n => String(n).padStart(2, '0');
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const MONTHS_LONG = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

  // ── Fechas ───────────────────────────────────────────────────────────
  const dkey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const endOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const mondayOf = d => addDays(startOfDay(d), -((d.getDay() + 6) % 7));
  const fmtDay = d => `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  const fmtDayYear = d => `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  const fromInput = s => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d); };
  const relDays = d => {
    const n = Math.floor((startOfDay(new Date()) - startOfDay(d)) / 86400000);
    if (n <= 0) return 'Hoy';
    if (n === 1) return 'Ayer';
    if (n < 30) return `Hace ${n} días`;
    const mo = Math.floor(n / 30);
    return mo < 12 ? `Hace ${mo} ${mo === 1 ? 'mes' : 'meses'}` : `Hace ${Math.floor(n / 365)} ${Math.floor(n / 365) === 1 ? 'año' : 'años'}`;
  };

  // ── Iconos (trazo 1.75, como el resto de KRUX) ───────────────────────
  const ico = (body, s = 18) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  const I = {
    chevron: ico('<path d="m9 18 6-6-6-6"/>', 18),
    down: ico('<path d="m6 9 6 6 6-6"/>', 16),
    close: ico('<path d="M18 6 6 18M6 6l12 12"/>', 20),
    route: ico('<path d="M3 17l5-5 4 4 8-8"/><path d="M15 8h5v5"/>'),
    peak: ico('<path d="m3 20 7-14 4 8 2-3 5 9z"/>'),
    gauge: ico('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
    calendar: ico('<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M16 3v4M8 3v4M4 10h16"/><path d="m9.5 15 2 2 3.5-3.5"/>'),
    zap: ico('<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>'),
    flame: ico('<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.4-.5-2-1-3-1.1-2.2-.2-4.2 2-6 .5 2.5 2 4.1 4 6a7 7 0 1 1-14 2c0-1.2.4-2.3 1-3 .5 1 1 2 2.5 2.5z"/>'),
    star: ico('<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>'),
    trend: ico('<path d="M3 17l6-6 4 4 8-8"/><path d="M14 7h7v7"/>'),
    bars: ico('<path d="M5 20V10M10 20V4M15 20v-7M20 20v-11"/>'),
    target: ico('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>'),
    pin: ico('<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/>', 15),
    ruler: ico('<path d="M21.3 8.7 8.7 21.3a1 1 0 0 1-1.4 0L2.7 16.7a1 1 0 0 1 0-1.4L15.3 2.7a1 1 0 0 1 1.4 0l4.6 4.6a1 1 0 0 1 0 1.4z"/><path d="m7.5 10.5 2 2M10.5 7.5l2 2M13.5 4.5l2 2M4.5 13.5l2 2"/>'),
    check: ico('<path d="m20 6-11 11-5-5"/>', 16),
    info: ico('<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>', 16),
    arrUp: ico('<path d="M12 19V5M6 11l6-6 6 6"/>', 13),
    arrDown: ico('<path d="M12 5v14M6 13l6 6 6-6"/>', 13),
  };

  // ── Hitos de altura (metros escalados) ──────────────────────────────
  // kind: estructura = altura total de la construcción (incluye antena, pedestal o chapitel)
  //       pared      = desnivel de la pared desde su base
  //       montana    = elevación sobre el nivel del mar (no es una altura de construcción)
  const KIND = {
    estructura: 'Altura total de la estructura',
    pared: 'Desnivel de la pared desde su base',
    montana: 'Elevación sobre el nivel del mar',
  };
  const MILESTONES = [
    { id: 'pisa', name: 'la Torre de Pisa', short: 'Torre de Pisa', m: 57, kind: 'estructura', note: 'Altura aproximada (≈56–57 m según el lado que se mida).' },
    { id: 'libertad', name: 'la Estatua de la Libertad', short: 'Estatua de la Libertad', m: 93, kind: 'estructura', note: 'Del suelo a la antorcha, incluido el pedestal.' },
    { id: 'bigben', name: 'el Big Ben (Elizabeth Tower)', short: 'Big Ben', m: 96, kind: 'estructura', note: 'Altura total de la torre.' },
    { id: 'eiffel', name: 'la Torre Eiffel', short: 'Torre Eiffel', m: 330, kind: 'estructura', note: 'Con antenas (330 m); sin ellas mide unos 300 m.' },
    { id: 'empire', name: 'el Empire State Building', short: 'Empire State', m: 443, kind: 'estructura', note: 'Hasta la punta de la antena (443 m); el tejado está a 381 m.' },
    { id: 'burj', name: 'el Burj Khalifa', short: 'Burj Khalifa', m: 828, kind: 'estructura', note: 'Altura total con la aguja.' },
    { id: 'capitan', name: 'la pared de El Capitán', short: 'El Capitán', m: 900, kind: 'pared', note: 'Pared de Yosemite, unos 900 m desde la base.' },
    { id: 'naranjo', name: 'el Naranjo de Bulnes', short: 'Naranjo de Bulnes', m: 2519, kind: 'montana', note: 'Cota de la cima sobre el nivel del mar (2.519 m), no desnivel de la pared.' },
    { id: 'mulhacen', name: 'el Mulhacén', short: 'Mulhacén', m: 3479, kind: 'montana', note: 'Cota de la cima sobre el nivel del mar.' },
    { id: 'teide', name: 'el Teide', short: 'Teide', m: 3715, kind: 'montana', note: 'Cota de la cima sobre el nivel del mar (la base está bajo el mar).' },
    { id: 'montblanc', name: 'el Mont Blanc', short: 'Mont Blanc', m: 4806, kind: 'montana', note: 'Cota de la cima sobre el nivel del mar (varía con el hielo de la cumbre).' },
    { id: 'kili', name: 'el Kilimanjaro', short: 'Kilimanjaro', m: 5895, kind: 'montana', note: 'Cota de la cima sobre el nivel del mar.' },
    { id: 'aconcagua', name: 'el Aconcagua', short: 'Aconcagua', m: 6961, kind: 'montana', note: 'Cota de la cima sobre el nivel del mar.' },
    { id: 'k2', name: 'el K2', short: 'K2', m: 8611, kind: 'montana', note: 'Cota de la cima sobre el nivel del mar.' },
    { id: 'everest', name: 'el Everest', short: 'Everest', m: 8849, kind: 'montana', note: 'Cota de la cima sobre el nivel del mar (8.848,86 m).' },
  ].sort((a, b) => a.m - b.m);

  // ── Estado ───────────────────────────────────────────────────────────
  const S = {
    items: [], rock: [], sends: [], gym: [], gymSends: [],
    loaded: false,
    perfPeriod: 'year', perfMore: false,
    metersPeriod: 'year', metersCustom: null, metersById: new Map(), metersReady: false, metersToken: 0,
    viasIdx: new Map(),
    evoPeriod: 'month', evoCustom: null, evoView: 'vol', evoSel: null,
    pyrView: 'send',
    hmFilter: 'all', hmYear: new Date().getFullYear(), hmGymYear: new Date().getFullYear(),
    recMore: false,
    placesTab: 'school',
    sessFilter: 'all', sessions: [], sessShown: 5, gymSessions: [], gymSessShown: 5,
    thumbs: new Map(),
    climb: [], climbShown: 5, climbToken: 0,
  };

  // ── Helpers de datos ────────────────────────────────────────────────
  const rank = g => (typeof _rocoGradeIndex === 'function' ? _rocoGradeIndex(g) : -1);
  const scale = i => (typeof GYM_ROCO_GRADE_SCALE !== 'undefined' ? GYM_ROCO_GRADE_SCALE[i] : null);
  const gcolor = g => (typeof getGradeColor === 'function' ? getGradeColor(String(g || '').toLowerCase()) : '#888');
  const styleLabel = s => (typeof STYLE_LABELS !== 'undefined' && STYLE_LABELS[s]) || ({ flash: 'Flash', redpoint: 'Redpoint', onsight: 'A vista', project: 'Intento', toprope: 'Top rope' }[s]) || s || '';
  const isFlash = a => a.style === 'flash' || a.style === 'onsight';
  const place = a => ({ school: a.schoolName || a.school || '', sector: a.sectorName || a.sector || '' });
  const knownSchool = id => typeof MAPLIBRE_SCHOOLS !== 'undefined' && id && !!MAPLIBRE_SCHOOLS[id];
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  function gradeStats(list) {
    const r = list.map(i => rank(i.a.grade)).filter(x => x >= 0);
    if (!r.length) return { max: null, min: null, avg: null, maxI: -1, minI: -1, avgI: -1 };
    const maxI = Math.max(...r), minI = Math.min(...r), avgI = Math.round(r.reduce((s, x) => s + x, 0) / r.length);
    return { max: scale(maxI), min: scale(minI), avg: scale(avgI), maxI, minI, avgI };
  }

  const inRange = (it, from, to) => it.d && it.d >= from && it.d <= to;

  // Rango de un periodo y el inmediatamente anterior (misma duración)
  function periodRange(p, custom) {
    const now = new Date();
    let from, to;
    if (p === 'week') { from = mondayOf(now); to = endOfDay(addDays(from, 6)); }
    else if (p === 'month') { from = new Date(now.getFullYear(), now.getMonth(), 1); to = endOfDay(new Date(now.getFullYear(), now.getMonth() + 1, 0)); }
    else if (p === 'year') { from = new Date(now.getFullYear(), 0, 1); to = endOfDay(new Date(now.getFullYear(), 11, 31)); }
    else if (p === 'custom' && custom) { from = startOfDay(custom.from); to = endOfDay(custom.to); }
    else return null;
    let pf, pt;
    if (p === 'week') { pf = addDays(from, -7); pt = endOfDay(addDays(from, -1)); }
    else if (p === 'month') { pf = new Date(from.getFullYear(), from.getMonth() - 1, 1); pt = endOfDay(new Date(from.getFullYear(), from.getMonth(), 0)); }
    else if (p === 'year') { pf = new Date(from.getFullYear() - 1, 0, 1); pt = endOfDay(new Date(from.getFullYear() - 1, 11, 31)); }
    else { const days = Math.round((startOfDay(to) - from) / 86400000) + 1; pt = endOfDay(addDays(from, -1)); pf = addDays(from, -days); }
    return { from, to, pf, pt };
  }

  const PERIOD_TXT = { week: 'Esta semana', month: 'Este mes', year: 'Este año', todo: 'Todo', custom: 'Personalizado' };
  const PREV_TXT = { week: 'semana anterior', month: 'mes anterior', year: 'año anterior', custom: 'periodo anterior' };
  const customTxt = c => (c ? `${fmtDay(c.from)} – ${fmtDay(c.to)}` : 'Personalizado');

  function delta(cur, prev) {
    if (!prev) return null;
    return Math.round(((cur - prev) / prev) * 100);
  }

  // Variación pequeña bajo una cifra (↑ +12% · = igual)
  function trend(pct, suffix = '') {
    if (pct == null) return '';
    if (pct === 0) return `<span class="ax-trend is-flat">= igual${suffix}</span>`;
    return `<span class="ax-trend ${pct > 0 ? 'is-up' : 'is-down'}">${pct > 0 ? I.arrUp : I.arrDown}${pct > 0 ? '+' : ''}${pct}%${suffix}</span>`;
  }
  function trendSteps(cur, prev, unitOne, unitMany) {
    if (cur < 0 || prev < 0) return '';
    const s = cur - prev;
    if (s === 0) return '<span class="ax-trend is-flat">= igual</span>';
    return `<span class="ax-trend ${s > 0 ? 'is-up' : 'is-down'}">${s > 0 ? I.arrUp : I.arrDown}${s > 0 ? '+' : ''}${s} ${Math.abs(s) === 1 ? unitOne : unitMany}</span>`;
  }

  // ── Piezas de interfaz ──────────────────────────────────────────────
  // Selector desplegable con aspecto de píldora (control nativo: accesible y sin dependencias)
  function select(action, current, opts, label) {
    return `<label class="ax-select"><select data-ax-change="${action}" aria-label="${esc(label)}">${opts.map(([v, l]) => `<option value="${v}"${v === current ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>${I.down}</label>`;
  }
  function seg(action, current, opts, label) {
    return `<div class="ax-seg" role="group" aria-label="${esc(label)}">${opts.map(([v, l]) => `<button type="button" class="ax-seg-btn${v === current ? ' is-active' : ''}" data-ax="${action}" data-v="${v}" aria-pressed="${v === current}">${l}</button>`).join('')}</div>`;
  }
  const panelHead = (title, right = '') => `<header class="ax-panel-head"><h2 class="ax-h2">${title}</h2>${right}</header>`;
  const moreBtn = (action, open, lessTxt = 'Ver menos', moreTxt = 'Ver todas') => `<button type="button" class="ax-head-link" data-ax="${action}" aria-expanded="${open}">${open ? lessTxt : moreTxt}${I.chevron}</button>`;

  // ── Hoja inferior (detalles) ────────────────────────────────────────
  let sheetEl = null, sheetPrevFocus = null, sheetOnClose = null;
  function closeSheet(applied) {
    if (!sheetEl) return;
    sheetEl.remove();
    sheetEl = null;
    document.removeEventListener('keydown', onSheetKey);
    const cb = sheetOnClose; sheetOnClose = null;
    if (cb && !applied) cb();
    try { sheetPrevFocus?.focus({ preventScroll: true }); } catch (_) { /* sin foco */ }
  }
  function onSheetKey(e) { if (e.key === 'Escape') closeSheet(); }
  function openSheet({ title, subtitle = '', html, onClose }) {
    closeSheet(true);
    sheetPrevFocus = document.activeElement;
    sheetOnClose = onClose || null;
    const el = document.createElement('div');
    el.className = 'ax-sheet-overlay';
    el.innerHTML = `<div class="ax-sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="ax-sheet-grab" aria-hidden="true"></div>
      <header class="ax-sheet-head">
        <div><h2>${esc(title)}</h2>${subtitle ? `<p>${esc(subtitle)}</p>` : ''}</div>
        <button type="button" class="ax-icon-btn" data-ax-close aria-label="Cerrar">${I.close}</button>
      </header>
      <div class="ax-sheet-body">${html}</div>
    </div>`;
    el.addEventListener('click', e => { if (e.target === el || e.target.closest('[data-ax-close]')) closeSheet(); });
    document.body.appendChild(el);
    sheetEl = el;
    document.addEventListener('keydown', onSheetKey);
    el.querySelector('[data-ax-close]')?.focus({ preventScroll: true });
    hydrateThumbs(el);
    return el;
  }

  // ── Fotos reales de sector (si existen) ─────────────────────────────
  function thumbFor(schoolId, sector) {
    if (!schoolId || !sector || typeof getSectorGalleryImages !== 'function') return Promise.resolve(null);
    const k = `${schoolId}|${sector}`;
    if (!S.thumbs.has(k)) {
      S.thumbs.set(k, getSectorGalleryImages(schoolId, sector)
        .then(imgs => (imgs && imgs[0] && imgs[0].url) || null)
        .catch(() => null));
    }
    return S.thumbs.get(k);
  }
  function hydrateThumbs(root) {
    (root || document).querySelectorAll('[data-thumb-school]').forEach(el => {
      if (el.dataset.thumbDone || !el.dataset.thumbSchool || !el.dataset.thumbSector) return;
      el.dataset.thumbDone = '1';
      thumbFor(el.dataset.thumbSchool, el.dataset.thumbSector).then(url => {
        if (!url || !el.isConnected) return;
        el.style.setProperty('--ax-photo', `url("${String(url).replace(/"/g, '%22')}")`);
        el.classList.add('has-photo');
      });
    });
  }
  const photoAttr = (schoolId, sector) => (schoolId && sector ? ` data-thumb-school="${esc(schoolId)}" data-thumb-sector="${esc(sector)}"` : '');

  // ── Normalización de ascensiones ────────────────────────────────────
  function normalize(all) {
    S.items = (all || []).map(a => ({ a, d: parseAscentDate(a.date), gym: isGymAscent(a), send: a.style !== 'project', key: a.id || `${a.routeId}|${a.date}` }))
      .sort((x, y) => (y.d || 0) - (x.d || 0));
    S.rock = S.items.filter(i => !i.gym);
    S.sends = S.rock.filter(i => i.send);
    S.gym = S.items.filter(i => i.gym);
    S.gymSends = S.gym.filter(i => i.send);
  }

  // ── Longitud real de las vías (GeoJSON de la escuela) ───────────────
  // La regla de longitudes (un largo, multilargo, variantes ambiguas) y el índice de vías viven en climb-session.js,
  // compartidos con las sesiones de escalada para que ambos cuenten los mismos metros.
  const lengthOf = p => kxsRouteLength(p);
  const loadViasIndex = schoolId => (knownSchool(schoolId) ? kxsLoadViasIndex(schoolId) : Promise.resolve(null));
  function metersFor(idx, a) {
    if (!idx || a.routeId == null || a.routeId === '') return null;
    return kxsPickMeters(idx.get(String(a.routeId)), a.routeName);
  }
  async function resolveMeters() {
    const token = ++S.metersToken;
    S.metersById = new Map();
    S.metersReady = false;
    const schools = [...new Set(S.sends.map(i => i.a.schoolId).filter(Boolean))];
    const idxs = await Promise.all(schools.map(async s => [s, await loadViasIndex(s)]));
    if (token !== S.metersToken) return;
    const by = new Map(idxs);
    S.sends.forEach(i => S.metersById.set(i.key, metersFor(by.get(i.a.schoolId), i.a)));
    S.metersReady = true;
    renderMeters();
    renderRecords();
  }
  const mOf = it => S.metersById.get(it.key);

  // ══════════════════════════════════════════════════════════════════
  // PROYECTO ACTIVO
  // ══════════════════════════════════════════════════════════════════
  function projectsList() {
    const list = typeof getProjects === 'function' ? getProjects() : [];
    const t = p => { const v = p.addedAt; const d = v && v.toDate ? v.toDate() : (v ? new Date(v) : null); return d && !isNaN(d) ? d.getTime() : 0; };
    return list.slice().sort((a, b) => t(b) - t(a));
  }

  function projectSlide(p, n, total) {
    const tries = S.rock.filter(i => String(i.a.routeId) === String(p.id));
    const attempts = tries.reduce((s, i) => s + (parseInt(i.a.tries, 10) > 0 ? parseInt(i.a.tries, 10) : 1), 0);
    const sent = tries.some(i => i.send);
    const last = tries.find(i => i.d);
    const days = new Set(tries.filter(i => i.d).map(i => dkey(i.d))).size;
    const ref = tries[0] ? tries[0].a : null;
    const pl = ref ? place(ref) : { school: '', sector: '' };
    const placeTxt = [pl.school, pl.sector ? `Sector ${pl.sector}` : ''].filter(Boolean).join(' · ');
    const go = ref && knownSchool(ref.schoolId)
      ? `<button type="button" class="ax-project-go" data-ax="place-go" data-school="${esc(ref.schoolId)}" aria-label="Ver ${esc(p.name || 'la vía')} en el mapa">${I.chevron}</button>` : '';
    return `<article class="ax-project" role="group" aria-roledescription="proyecto" aria-label="${n + 1} de ${total}"${ref ? photoAttr(ref.schoolId, pl.sector) : ''}>
      <div class="ax-project-body">
        <span class="ax-project-eyebrow">Proyecto activo</span>
        ${total > 1 ? `<span class="ax-project-count">${n + 1} de ${total}</span>` : ''}
        <div class="ax-project-grade">${esc(p.grade || '?')}</div>
        <h2 class="ax-project-name">${esc(p.name || 'Vía sin nombre')}</h2>
        <p class="ax-project-place">${placeTxt ? `${I.pin}<span>${esc(placeTxt)}</span>` : '<span>Guardado en tus proyectos</span>'}</p>
        ${go}
      </div>
      <dl class="ax-project-stats">
        <div><dd>${tries.length ? attempts : '—'}</dd><dt>Intentos</dt></div>
        <div><dd>${tries.length ? days : '—'}</dd><dt>${days === 1 ? 'Sesión' : 'Sesiones'}</dt></div>
        <div><dd>${sent ? 'Encadenado' : (last ? relDays(last.d) : 'Sin intentos')}</dd><dt>${sent ? 'Estado' : 'Último intento'}</dt></div>
      </dl>
    </article>`;
  }

  function renderProject() {
    const el = $('ax-project');
    if (!el) return;
    const list = projectsList();
    if (!list.length) {
      el.innerHTML = `<div class="ax-project-empty">
          <span class="ax-eyebrow">Proyecto activo</span>
          <h2>Elige tu próximo objetivo</h2>
          <p>Guarda una vía como proyecto desde el mapa: aquí verás tus intentos, tus sesiones y cuándo la encadenas.</p>
          <button type="button" class="ax-btn" data-ax="goto-map">Buscar una vía en el mapa</button>
        </div>`;
      return;
    }
    el.innerHTML = `<div class="ax-project-track" data-ax-track tabindex="0" aria-label="Proyectos activos">${list.map((p, n) => projectSlide(p, n, list.length)).join('')}</div>
      ${list.length > 1 ? `<div class="ax-dots" aria-hidden="true">${list.map((_, n) => `<i class="${n === 0 ? 'is-on' : ''}"></i>`).join('')}</div>` : ''}`;
    const track = el.querySelector('[data-ax-track]');
    const dots = [...el.querySelectorAll('.ax-dots i')];
    if (dots.length) track.addEventListener('scroll', () => {
      const i = Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
      dots.forEach((d, k) => d.classList.toggle('is-on', k === i));
    }, { passive: true });
    hydrateThumbs(el);
  }

  // ══════════════════════════════════════════════════════════════════
  // TU RENDIMIENTO
  // ══════════════════════════════════════════════════════════════════
  function renderPerf() {
    const el = $('ax-perf');
    if (!el) return;
    const p = S.perfPeriod;
    const rng = p === 'todo' ? null : periodRange(p);
    const cur = rng ? S.sends.filter(i => inRange(i, rng.from, rng.to)) : S.sends;
    const prev = rng ? S.sends.filter(i => inRange(i, rng.pf, rng.pt)) : null;

    // Se reutiliza el cálculo original (rellena los nodos ocultos stat-*)
    calculateAndUpdateStats(cur.map(i => i.a));
    const g = id => (document.getElementById(id)?.innerHTML || '-');
    const cs = gradeStats(cur), ps = prev ? gradeStats(prev) : null;
    const daysN = parseInt(g('stat-placeholder-1'), 10) || 0;
    const prevDays = prev ? new Set(prev.filter(i => i.d).map(i => dkey(i.d))).size : 0;

    const metric = (val, label, extra) => `<div class="ax-metric"><strong class="ax-metric-val">${val}</strong><span class="ax-metric-lbl">${label}</span>${extra || '<span class="ax-trend is-flat"></span>'}</div>`;
    const secondary = [
      ['Flash rate', g('stat-flash-rate')], ['Intentos totales', g('stat-total-tries')], ['Intentos por vía', g('stat-avg-tries')],
      ['Vías valoradas', g('stat-rated-routes')], ['Valoración media', g('stat-avg-rating')], ['Escuelas visitadas', g('stat-schools-count')],
      ['Sectores visitados', g('stat-sectors-count')], ['Estilo predominante', g('stat-main-style')],
    ];
    el.innerHTML = `<article class="ax-panel">
      ${panelHead('Tu rendimiento', select('perf-period', p, [['week', 'Esta semana'], ['month', 'Este mes'], ['year', 'Este año'], ['todo', 'Todo']], 'Periodo de las estadísticas'))}
      <div class="ax-metrics">
        ${metric(g('stat-total-routes'), 'Vías encadenadas', prev ? trend(delta(cur.length, prev.length)) : '')}
        ${metric(g('stat-max-grade'), 'Grado máximo', prev ? trendSteps(cs.maxI, ps.maxI, 'grado', 'grados') : '')}
        ${metric(g('stat-avg-grade'), 'Grado medio', prev ? trendSteps(cs.avgI, ps.avgI, 'grado', 'grados') : '')}
        ${metric(daysN, 'Días escalando', prev ? trend(delta(daysN, prevDays)) : '')}
      </div>
      <dl class="ax-kv-list" id="ax-perf-more"${S.perfMore ? '' : ' hidden'}>
        ${secondary.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}
      </dl>
      <button type="button" class="ax-link" data-ax="perf-more" aria-expanded="${S.perfMore}" aria-controls="ax-perf-more">${S.perfMore ? 'Menos estadísticas' : 'Más estadísticas'}</button>
    </article>`;
  }

  // ══════════════════════════════════════════════════════════════════
  // METROS ESCALADOS
  // ══════════════════════════════════════════════════════════════════
  const fmtTimes = x => nf1.format(Math.round(x * 10) / 10);

  function metersIn(rng) {
    let total = 0, unknown = 0, known = 0;
    S.sends.forEach(i => {
      if (rng && !inRange(i, rng.from, rng.to)) return;
      const m = mOf(i);
      if (m > 0) { total += m; known++; } else unknown++;
    });
    return { total, unknown, known };
  }

  function milestoneState(meters) {
    let idx = -1;
    MILESTONES.forEach((m, i) => { if (meters >= m.m) idx = i; });
    const cur = idx >= 0 ? MILESTONES[idx] : null;
    const next = MILESTONES[idx + 1] || null;
    const base = cur ? cur.m : 0;
    const pct = next ? Math.max(0, Math.min(100, ((meters - base) / (next.m - base)) * 100)) : 100;
    return { idx, cur, next, base, pct, missing: next ? Math.max(0, Math.ceil(next.m - meters)) : 0 };
  }

  // Fotos de los hitos: recortes con fondo transparente en assets/activity/hitos/<id>.webp.
  // Se añade el id aquí al incorporar una foto nueva; sin foto (hoy, el Everest), la tarjeta es solo tipográfica.
  const HITO_PHOTOS = new Set(['pisa', 'libertad', 'bigben', 'eiffel', 'empire', 'burj', 'capitan', 'naranjo', 'mulhacen', 'teide', 'montblanc', 'kili', 'aconcagua', 'k2']);
  const hitoPhoto = m => (m && HITO_PHOTOS.has(m.id) ? `assets/activity/hitos/${m.id}.webp` : null);

  function celebrate(rng, st) {
    // Una vez por hito y periodo con fecha fija (no cada vez que se abre la pantalla).
    // La primera visita solo guarda el estado: no se celebran hitos antiguos.
    if (S.metersPeriod === 'custom' || !st.cur) return;
    let uid = 'x';
    try { uid = firebase.auth().currentUser?.uid || 'x'; } catch (_) { /* sin sesión */ }
    const key = `krux_act_ms_${uid}_${S.metersPeriod}_${dkey(rng.from)}`;
    let prev = null;
    try { prev = localStorage.getItem(key); } catch (_) { return; }
    try { if (prev === null || st.idx > parseInt(prev, 10)) localStorage.setItem(key, String(st.idx)); } catch (_) { /* sin almacenamiento */ }
    if (prev !== null && st.idx > parseInt(prev, 10)) {
      $('ax-meters')?.querySelector('.ax-panel')?.classList.add('is-celebrate');
      if (typeof showToast === 'function') showToast(`Nuevo hito: ya has escalado la altura de ${st.cur.name}`, 'success');
    }
  }

  function renderMeters() {
    const el = $('ax-meters');
    if (!el) return;
    const p = S.metersPeriod;
    const sel = select('meters-period', p, [['week', 'Esta semana'], ['month', 'Este mes'], ['year', 'Este año'], ['custom', p === 'custom' ? customTxt(S.metersCustom) : 'Personalizado']], 'Periodo de los metros');
    if (!S.metersReady) {
      el.innerHTML = `<article class="ax-panel ax-meters">${panelHead('Metros escalados', sel)}<div class="ax-skel" style="height:132px"></div></article>`;
      return;
    }
    const rng = periodRange(p, S.metersCustom);
    const { total, unknown, known } = metersIn(rng);
    const meters = Math.round(total);
    const st = milestoneState(meters);
    const prevR = metersIn({ from: rng.pf, to: rng.pt });

    let eq;
    if (!known) eq = unknown ? 'Ninguna ascensión de este periodo tiene longitud verificada.' : 'Registra ascensiones para ver tus metros.';
    else if (st.cur) {
      const x = meters / st.cur.m;
      eq = `Equivale a ${Math.round(x * 10) === 10 ? '' : `<strong>${fmtTimes(x)} veces</strong> `}${esc(st.cur.name)}`;
    } else eq = `Camino a ${esc(MILESTONES[0].name)}`;
    const nextTxt = known && st.next
      ? `<strong>${Math.round(st.pct)}%</strong> hacia ${esc(st.next.name)} · faltan ${nf.format(st.missing)} m`
      : (known ? 'Has superado todos los hitos' : '');

    const ref = st.cur || st.next;
    const photo = hitoPhoto(ref);
    el.innerHTML = `<article class="ax-panel ax-meters">
      ${panelHead('Metros escalados', sel)}
      <div class="ax-meters-top">
        <div class="ax-meters-body">
          <div class="ax-meters-num">${nf.format(meters)}<span> m</span></div>
          <p class="ax-meters-eq">${eq}</p>
          ${prevR.total > 0 && known ? trend(delta(total, prevR.total), ` vs ${PREV_TXT[p]}`) : ''}
        </div>
        ${photo ? `<img class="ax-meters-photo${ref.kind === 'montana' || ref.id === 'capitan' ? '' : ' is-tall'}" src="${photo}" alt="${esc(ref.short)}" width="${ref.kind === 'montana' || ref.id === 'capitan' ? 150 : 84}" height="120" decoding="async">` : ''}
      </div>
      <div class="ax-meters-row">
        <div class="ax-meters-prog">
          ${known && st.next ? `<div class="ax-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(st.pct)}" aria-label="Progreso hacia ${esc(st.next.short)}"><i style="width:${st.pct.toFixed(1)}%"></i></div>` : ''}
          ${nextTxt ? `<p class="ax-caption">${nextTxt}</p>` : ''}
        </div>
        <button type="button" class="ax-round" data-ax="meters-hitos" aria-label="Ver hitos y marcas de metros">${I.chevron}</button>
      </div>
      ${unknown ? `<p class="ax-caption ax-caption--muted">${I.info}<span>${plural(unknown, 'ascensión', 'ascensiones')} sin longitud verificada: cuentan como ascensión pero no suman metros.</span></p>` : ''}
    </article>`;
    celebrate(rng, st);
  }

  function metersRecords() {
    const day = new Map(), month = new Map(), sess = new Map();
    S.sends.forEach(i => {
      const m = mOf(i);
      if (!(m > 0) || !i.d) return;
      const k = dkey(i.d);
      day.set(k, (day.get(k) || 0) + m);
      const mk = `${i.d.getFullYear()}-${pad(i.d.getMonth() + 1)}`;
      month.set(mk, (month.get(mk) || 0) + m);
      const pl = place(i.a);
      const sk = `${k}|${i.a.schoolId || pl.school}|${pl.sector}`;
      const cur = sess.get(sk) || { m: 0, label: `${fmtDayYear(i.d)}${pl.sector ? ' · ' + pl.sector : pl.school ? ' · ' + pl.school : ''}` };
      cur.m += m; sess.set(sk, cur);
    });
    const best = (map, lab) => { let b = null; map.forEach((v, k) => { const m = typeof v === 'number' ? v : v.m; if (!b || m > b.m) b = { m, label: typeof v === 'number' ? lab(k) : v.label }; }); return b; };
    return {
      day: best(day, k => fmtDayYear(fromInput(k))),
      month: best(month, k => { const [y, mo] = k.split('-').map(Number); return `${cap(MONTHS_LONG[mo - 1])} ${y}`; }),
      session: best(sess),
    };
  }

  function hitosSheet() {
    const rng = periodRange(S.metersPeriod, S.metersCustom);
    const per = Math.round(metersIn(rng).total);
    const all = Math.round(metersIn(null).total);
    const rec = metersRecords();
    const rows = MILESTONES.map(m => {
      const reached = all >= m.m;
      return `<li class="ax-hito${reached ? ' is-reached' : ''}">
        <span class="ax-hito-mark">${reached ? I.check : ''}</span>
        ${hitoPhoto(m) ? `<img class="ax-hito-img" src="${hitoPhoto(m)}" alt="" loading="lazy" decoding="async">` : '<span class="ax-hito-img"></span>'}
        <div class="ax-hito-text"><strong>${esc(m.short)}</strong><span>${nf.format(m.m)} m · ${KIND[m.kind]}</span><small>${esc(m.note)}</small></div>
        <span class="ax-hito-x">${all > 0 ? fmtTimes(all / m.m) + '×' : ''}</span>
      </li>`;
    }).join('');
    openSheet({
      title: 'Hitos de altura',
      subtitle: `Total acumulado: ${nf.format(all)} m · ${S.metersPeriod === 'custom' ? customTxt(S.metersCustom) : PERIOD_TXT[S.metersPeriod]}: ${nf.format(per)} m`,
      html: `<div class="ax-mini-grid">
          ${[['Mejor día', rec.day], ['Mejor sesión', rec.session], ['Mejor mes', rec.month]].map(([l, r]) => `<div class="ax-mini"><span>${l}</span><strong>${r ? nf.format(Math.round(r.m)) + ' m' : '—'}</strong><small>${r ? esc(r.label) : 'Sin datos'}</small></div>`).join('')}
        </div>
        <p class="ax-note">${I.info}<span>Solo suman las ascensiones encadenadas con longitud verificada en el mapa de KRUX. Las referencias mezclan alturas de construcciones y cotas de montañas; cada una indica a cuál corresponde. El progreso se calcula entre el último hito alcanzado y el siguiente.</span></p>
        <ol class="ax-hitos">${rows}</ol>`,
    });
  }

  // ══════════════════════════════════════════════════════════════════
  // EVOLUCIÓN
  // ══════════════════════════════════════════════════════════════════
  function evoBuckets() {
    const now = new Date();
    const mk = (from, to, label, full) => {
      const all = S.rock.filter(i => inRange(i, from, endOfDay(to)));
      const items = all.filter(i => i.send);
      return { from, to: endOfDay(to), label, full, items, tries: all.length - items.length, count: items.length, g: gradeStats(items), future: from > now };
    };
    const out = [];
    const p = S.evoPeriod;
    if (p === 'week') {
      const m0 = mondayOf(now);
      for (let i = 7; i >= 0; i--) { const f = addDays(m0, -7 * i); out.push(mk(f, addDays(f, 6), `${f.getDate()}/${f.getMonth() + 1}`, `Semana del ${fmtDay(f)}`)); }
    } else if (p === 'month') {
      for (let m = 0; m < 12; m++) {
        const f = new Date(now.getFullYear(), m, 1);
        out.push(mk(f, new Date(f.getFullYear(), m + 1, 0), cap(MONTHS[m]), `${cap(MONTHS_LONG[m])} ${f.getFullYear()}`));
      }
    } else if (p === 'year') {
      const ys = S.sends.filter(i => i.d).map(i => i.d.getFullYear());
      const y0 = Math.max(ys.length ? Math.min(...ys) : now.getFullYear(), now.getFullYear() - 9);
      for (let y = y0; y <= now.getFullYear(); y++) out.push(mk(new Date(y, 0, 1), new Date(y, 11, 31), String(y), `Año ${y}`));
    } else if (p === 'custom' && S.evoCustom) {
      const f = startOfDay(S.evoCustom.from), t = startOfDay(S.evoCustom.to);
      const days = Math.round((t - f) / 86400000) + 1;
      if (days <= 14) { for (let i = 0; i < days; i++) { const d = addDays(f, i); out.push(mk(d, d, String(d.getDate()), fmtDayYear(d))); } }
      else if (days <= 120) { for (let w = mondayOf(f); w <= t; w = addDays(w, 7)) { const a = w < f ? f : w, to = addDays(w, 6); out.push(mk(a, to > t ? t : to, `${a.getDate()}/${a.getMonth() + 1}`, `Semana del ${fmtDay(a)}`)); } }
      else { for (let m = new Date(f.getFullYear(), f.getMonth(), 1); m <= t; m = new Date(m.getFullYear(), m.getMonth() + 1, 1)) { const a = m < f ? f : m, to = new Date(m.getFullYear(), m.getMonth() + 1, 0); out.push(mk(a, to > t ? t : to, cap(MONTHS[m.getMonth()]), `${cap(MONTHS_LONG[m.getMonth()])} ${m.getFullYear()}`)); } }
    }
    return out;
  }

  // Total del rango mostrado frente al rango anterior de la misma duración
  function evoCompare(b) {
    const now = new Date();
    const p = S.evoPeriod;
    let from, to, pf, pt, curTxt, prevTxt;
    if (p === 'month') { from = new Date(now.getFullYear(), 0, 1); to = now; pf = new Date(now.getFullYear() - 1, 0, 1); pt = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate(), 23, 59, 59); curTxt = 'vías este año'; prevTxt = 'vs. mismo periodo de ' + (now.getFullYear() - 1); }
    else if (p === 'week') { from = b[0].from; to = b[b.length - 1].to; pt = addDays(from, -1); pf = addDays(from, -56); curTxt = 'vías en 8 semanas'; prevTxt = 'vs. 8 semanas anteriores'; }
    else if (p === 'year') { from = new Date(now.getFullYear(), 0, 1); to = now; pf = new Date(now.getFullYear() - 1, 0, 1); pt = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate(), 23, 59, 59); curTxt = 'vías este año'; prevTxt = 'vs. mismo periodo de ' + (now.getFullYear() - 1); }
    else { from = b[0].from; to = b[b.length - 1].to; const days = Math.round((startOfDay(to) - from) / 86400000) + 1; pt = endOfDay(addDays(from, -1)); pf = addDays(from, -days); curTxt = 'vías en el periodo'; prevTxt = 'vs. periodo anterior'; }
    const cur = S.sends.filter(i => inRange(i, from, to)).length;
    const prev = S.sends.filter(i => inRange(i, pf, pt)).length;
    return { cur, prev, pct: delta(cur, prev), curTxt, prevTxt };
  }

  function renderEvolution() {
    const el = $('ax-evolution');
    if (!el) return;
    const sel = select('evo-period', S.evoPeriod, [['week', 'Últimas 8 semanas'], ['month', 'Este año'], ['year', 'Por años'], ['custom', S.evoPeriod === 'custom' ? customTxt(S.evoCustom) : 'Personalizado']], 'Periodo de la evolución');
    const tabs = seg('evo-view', S.evoView, [['vol', 'Vías'], ['avg', 'Grado medio'], ['max', 'Grado máximo']], 'Dato de la gráfica');
    const b = evoBuckets();
    if (!b.length || b.every(x => x.count === 0 && x.tries === 0)) {
      el.innerHTML = `<article class="ax-panel">${panelHead('Evolución', sel)}${tabs}<p class="ax-empty">Sin ascensiones en este periodo.</p></article>`;
      return;
    }
    if (S.evoSel == null || S.evoSel >= b.length || b[S.evoSel].future) {
      let last = b.length - 1;
      while (last > 0 && b[last].future) last--;
      S.evoSel = last;
    }
    const v = S.evoView;
    // Escala del eje Y
    let ticks, val, top;
    if (v === 'vol') {
      const mx = Math.max(...b.map(x => x.count + x.tries), 1);
      const step = mx <= 4 ? 1 : mx <= 10 ? 2 : mx <= 25 ? 5 : mx <= 50 ? 10 : Math.ceil(mx / 50) * 10;
      top = Math.ceil(mx / step) * step;
      ticks = []; for (let t = top; t >= 0; t -= step) ticks.push([t, String(t)]);
      val = x => x.count;
    } else {
      const key = v === 'avg' ? 'avgI' : 'maxI';
      const rs = b.map(x => x.g[key]).filter(r => r >= 0);
      const lo = Math.max(0, Math.min(...rs) - 2), hi = Math.max(...rs) + 1;
      top = hi - lo;
      const step = Math.max(1, Math.ceil(top / 4));
      ticks = []; for (let t = top; t >= 0; t -= step) ticks.push([t, scale(t + lo) || '']);
      val = x => (x.g[key] >= 0 ? x.g[key] - lo : 0);
    }
    const s = b[S.evoSel];
    const tipX = Math.max(14, Math.min(86, ((S.evoSel + 0.5) / b.length) * 100));
    const tipH = top ? (v === 'vol' ? (s.count + s.tries) : val(s)) / top * 100 : 0;
    const tip = `<div class="ax-tip" style="left:${tipX}%;bottom:calc(${Math.min(100, tipH)}% + 10px)"><strong>${esc(s.full)}</strong><span>${plural(s.count, 'vía', 'vías')}</span>${s.g.avg ? `<span>${v === 'max' ? s.g.max + ' máximo' : s.g.avg + ' medio'}</span>` : ''}</div>`;
    const chart = `<div class="ax-chart">
      <div class="ax-chart-y" aria-hidden="true">${ticks.map(([, l]) => `<span>${esc(l)}</span>`).join('')}</div>
      <div class="ax-chart-plot">
        <div class="ax-chart-grid" aria-hidden="true">${ticks.map(() => '<i></i>').join('')}</div>
        <div class="ax-chart-bars">${b.map((x, i) => {
          const h = top ? (val(x) / top) * 100 : 0;
          const h2 = v === 'vol' && top ? (x.tries / top) * 100 : 0;
          const lbl = `${x.full}: ${plural(x.count, 'vía encadenada', 'vías encadenadas')}${x.tries ? `, ${plural(x.tries, 'intento', 'intentos')}` : ''}${x.g.avg ? `, grado medio ${x.g.avg}, máximo ${x.g.max}` : ''}`;
          return `<button type="button" class="ax-col${i === S.evoSel ? ' is-sel' : ''}" data-ax="evo-bar" data-i="${i}" aria-pressed="${i === S.evoSel}" aria-label="${esc(lbl)}"${x.future ? ' disabled' : ''}>
            <span class="ax-col-stack">${h2 > 0 ? `<i class="ax-col-try" style="height:${h2}%"></i>` : ''}<i class="ax-col-main" style="height:${h}%"></i></span>
          </button>`;
        }).join('')}</div>
        ${tip}
      </div>
      <div class="ax-chart-x" aria-hidden="true">${b.map(x => `<span>${esc(x.label)}</span>`).join('')}</div>
    </div>`;
    const cmp = evoCompare(b);
    el.innerHTML = `<article class="ax-panel">
      ${panelHead('Evolución', sel)}
      ${tabs}
      ${chart}
      ${v === 'vol' ? '<div class="ax-legend"><span class="lg lg-main">Encadenadas</span><span class="lg lg-try">Intentos</span></div>' : ''}
      <p class="ax-evo-sum"><strong class="${cmp.pct > 0 ? 'is-up' : cmp.pct < 0 ? 'is-down' : ''}">${cmp.pct == null ? '—' : (cmp.pct > 0 ? '+' : '') + cmp.pct + '%'}</strong> ${esc(cmp.prevTxt)}<span class="ax-sep" aria-hidden="true">·</span><strong>${cmp.cur}</strong> ${esc(cmp.curTxt)}</p>
    </article>`;
  }

  // ══════════════════════════════════════════════════════════════════
  // PIRÁMIDE DE GRADOS
  // ══════════════════════════════════════════════════════════════════
  function pyramidCounts(view) {
    const counts = {};
    S.rock.forEach(i => {
      if (view === 'send' ? !i.send : i.send) return;
      const g = String(i.a.grade || '').toLowerCase();
      if (rank(g) < 0) return;
      const c = counts[g] || (counts[g] = { n: 0, flash: 0 });
      c.n++;
      if (isFlash(i.a)) c.flash++;
    });
    return counts;
  }

  function renderPyramid() {
    const el = $('ax-pyramid');
    if (!el) return;
    const view = S.pyrView;
    const tabs = '';
    const pick = select('pyr-view', view, [['send', 'Encadenadas'], ['try', 'Intentos']], 'Qué contar en la pirámide');
    const counts = pyramidCounts(view);
    const sends = view === 'send' ? counts : pyramidCounts('send');
    // Grado consolidado: el más alto con al menos 5 vías encadenadas (regla original)
    const conso = Object.keys(sends).sort((a, b) => rank(b) - rank(a)).find(g => sends[g].n >= 5);
    const ranks = Object.keys(counts).map(rank);
    if (!ranks.length) {
      el.innerHTML = `<article class="ax-panel">${panelHead('Pirámide de grados', pick)}<p class="ax-empty">${view === 'send' ? 'Sin ascensiones encadenadas todavía.' : 'Sin intentos registrados.'}</p></article><span id="act-consolidated-grade" hidden>${conso || '-'}</span>`;
      return;
    }
    // Solo los grados escalados, del más alto al más bajo
    const rows = Object.keys(counts).sort((a, b) => rank(b) - rank(a));
    const max = Math.max(...rows.map(g => counts[g]?.n || 0));
    el.innerHTML = `<article class="ax-panel">
      ${panelHead('Pirámide de grados', pick)}
      <div id="act-pyramid-roca" class="ax-pyr">${rows.map(g => {
        const c = counts[g] || { n: 0, flash: 0 };
        const w = c.n ? Math.max(3, Math.round((c.n / max) * 100)) : 0;
        const inner = `<span class="ax-pyr-g">${g}</span><span class="ax-pyr-bar"><i style="width:${w}%;--c:${gcolor(g)}"></i></span><span class="ax-pyr-n">${c.n}</span>`;
        return c.n
          ? `<button type="button" class="ax-pyr-row${g === conso ? ' is-conso' : ''}" data-ax="pyr-row" data-g="${esc(g)}" aria-label="${g}: ${plural(c.n, view === 'send' ? 'vía' : 'intento', view === 'send' ? 'vías' : 'intentos')}${view === 'send' ? `, ${c.flash} a flash o a vista` : ''}">${inner}</button>`
          : `<div class="ax-pyr-row is-zero">${inner}</div>`;
      }).join('')}</div>
      <div class="ax-pyr-foot">
        <span>Grado consolidado: <strong id="act-consolidated-grade">${conso || '-'}</strong></span>
        <small>≥5 vías encadenadas</small>
      </div>
    </article>`;
  }

  function ascentRows(list) {
    return `<ul class="ax-asc-list">${list.map(i => {
      const a = i.a, pl = place(a);
      const m = mOf(i);
      return `<li class="ax-asc">
        <span class="ax-grade" style="--c:${gcolor(a.grade)}">${esc(a.grade || '?')}</span>
        <div class="ax-asc-text"><strong>${esc(a.routeName || 'Vía sin nombre')}</strong>
          <span>${[pl.school, pl.sector].filter(Boolean).map(esc).join(' · ') || '—'}</span></div>
        <div class="ax-asc-meta"><span class="ax-style is-${esc(a.style || 'x')}">${esc(styleLabel(a.style))}</span>
          <small>${i.d ? fmtDay(i.d) : ''}${a.tries > 1 ? ` · ${a.tries} int.` : ''}${m > 0 ? ` · ${nf.format(m)} m` : ''}</small></div>
      </li>`;
    }).join('')}</ul>`;
  }

  function pyramidSheet(g) {
    const view = S.pyrView;
    const list = S.rock.filter(i => (view === 'send' ? i.send : !i.send) && String(i.a.grade || '').toLowerCase() === g);
    const flash = list.filter(i => isFlash(i.a)).length;
    openSheet({ title: `Grado ${g}`, subtitle: view === 'send' ? `${plural(list.length, 'vía encadenada', 'vías encadenadas')} · ${flash} a flash o a vista` : plural(list.length, 'intento', 'intentos'), html: ascentRows(list) });
  }

  // ══════════════════════════════════════════════════════════════════
  // CONSISTENCIA (mapa de calor)
  // ══════════════════════════════════════════════════════════════════
  function heatHTML(items, year, which) {
    const count = new Map();
    items.forEach(i => { if (i.d && i.d.getFullYear() === year) { const k = dkey(i.d); count.set(k, (count.get(k) || 0) + 1); } });
    const today = startOfDay(new Date());
    // Cada bloque (columna de días y meses) mide exactamente sus semanas: así todas las celdas son iguales
    // y las letras de los días quedan alineadas con las filas
    const block = (w, total, gaps, html) => `<div class="ax-hm-month" style="width:calc((100% - ${gaps}px) * ${w} / ${total} + ${(w - 1) * 2}px)">${html}</div>`;
    const half = (m0, m1) => {
      const months = [];
      for (let m = m0; m <= m1; m++) {
        const first = new Date(year, m, 1);
        const dim = new Date(year, m + 1, 0).getDate();
        const lead = (first.getDay() + 6) % 7;
        const weeks = Math.ceil((lead + dim) / 7);
        let cells = '';
        for (let c = 0; c < weeks * 7; c++) {
          const day = c - lead + 1;
          if (day < 1 || day > dim) { cells += '<i class="ax-hm-cell is-void"></i>'; continue; }
          const date = new Date(year, m, day);
          if (date > today) { cells += '<i class="ax-hm-cell is-future"></i>'; continue; }
          const k = dkey(date), n = count.get(k) || 0;
          const lv = n === 0 ? 0 : n <= 2 ? 1 : n <= 4 ? 2 : n <= 7 ? 3 : 4;
          cells += n
            ? `<button type="button" class="ax-hm-cell lv-${lv}" data-ax="hm-day" data-k="${k}" data-hm="${which}" aria-label="${fmtDayYear(date)}: ${plural(n, 'vía', 'vías')}"></button>`
            : '<i class="ax-hm-cell lv-0"></i>';
        }
        months.push({ m, weeks, cells });
      }
      const total = 1 + months.reduce((s, x) => s + x.weeks, 0);
      const gaps = months.reduce((s, x) => s + (x.weeks - 1) * 2, 0) + months.length * 5;
      const days = ['L', 'M', 'X', 'J', 'V', 'S', 'D'].map(l => `<i class="ax-hm-cell ax-hm-dl" data-l="${l}"></i>`).join('');
      return `<div class="ax-hm-row">${block(1, total, gaps, `<span class="ax-hm-mlabel"></span><div class="ax-hm-cells" style="grid-template-columns:1fr" aria-hidden="true">${days}</div>`)}${months.map(x =>
        block(x.weeks, total, gaps, `<span class="ax-hm-mlabel">${cap(MONTHS[x.m])}</span><div class="ax-hm-cells" style="grid-template-columns:repeat(${x.weeks},1fr)">${x.cells}</div>`)).join('')}</div>`;
    };
    const total = [...count.values()].reduce((s, v) => s + v, 0);
    return { html: `<div class="ax-hm">${half(0, 5)}${half(6, 11)}</div>`, total, days: count.size };
  }

  function yearOpts(items) {
    const ys = new Set(items.filter(i => i.d).map(i => i.d.getFullYear()));
    const now = new Date().getFullYear();
    ys.add(now);
    return [...ys].sort((a, b) => b - a).map(y => [String(y), y === now ? 'Este año' : String(y)]);
  }

  const heatLegend = '<div class="ax-hm-legend" aria-hidden="true"><span>Menos</span><i class="ax-hm-cell lv-0"></i><i class="ax-hm-cell lv-1"></i><i class="ax-hm-cell lv-2"></i><i class="ax-hm-cell lv-3"></i><i class="ax-hm-cell lv-4"></i><span>Más</span></div>';

  function renderConsistency() {
    const el = $('ax-consistency');
    if (!el) return;
    const f = S.hmFilter;
    const items = f === 'roca' ? S.rock : f === 'gym' ? S.gym : S.items;
    const h = heatHTML(items, S.hmYear, 'main');
    el.innerHTML = `<article class="ax-panel">
      ${panelHead('Consistencia', select('hm-year', String(S.hmYear), yearOpts(S.items), 'Año del mapa de actividad'))}
      ${seg('hm-filter', f, [['all', 'Toda'], ['roca', 'Roca'], ['gym', 'Rocódromo']], 'Tipo de actividad')}
      ${h.html}
      <div class="ax-hm-foot"><span>${plural(h.days, 'día', 'días')} · ${plural(h.total, 'vía', 'vías')}</span>${heatLegend}</div>
    </article>`;
  }

  function renderGymConsistency() {
    const el = $('ax-gym-consistency');
    if (!el) return;
    const h = heatHTML(S.gym, S.hmGymYear, 'gym');
    el.innerHTML = `<article class="ax-panel">
      ${panelHead('Consistencia', select('hm-gym-year', String(S.hmGymYear), yearOpts(S.gym), 'Año del mapa de rocódromo'))}
      ${S.gym.length ? h.html : '<p class="ax-empty">Sin sesiones de rocódromo registradas.</p>'}
      <div class="ax-hm-foot"><span>${plural(h.days, 'día', 'días')} de rocódromo</span>${heatLegend}</div>
    </article>`;
  }

  function daySheet(k, which) {
    const pool = which === 'gym' ? S.gym : (S.hmFilter === 'roca' ? S.rock : S.hmFilter === 'gym' ? S.gym : S.items);
    const list = pool.filter(i => i.d && dkey(i.d) === k);
    const d = fromInput(k);
    const groups = groupSessions(list);
    openSheet({
      title: `${d.getDate()} de ${MONTHS_LONG[d.getMonth()]} de ${d.getFullYear()}`,
      subtitle: `${plural(list.length, 'vía', 'vías')} · ${plural(groups.length, 'sesión', 'sesiones')}`,
      html: groups.map(g => `<section class="ax-day-sess"><h3>${esc(g.title)}</h3><p>${esc(g.subtitle)}</p>${ascentRows(g.items)}</section>`).join('') || '<p class="ax-empty">Sin actividad este día.</p>',
    });
  }

  // ══════════════════════════════════════════════════════════════════
  // RÉCORDS
  // ══════════════════════════════════════════════════════════════════
  function bestStreak(items) {
    const days = [...new Set(items.filter(i => i.d).map(i => dkey(i.d)))].sort();
    let best = 0, run = 0, prev = null;
    days.forEach(k => {
      const d = fromInput(k);
      run = prev && Math.round((d - prev) / 86400000) === 1 ? run + 1 : 1;
      if (run > best) best = run;
      prev = d;
    });
    return best;
  }

  function renderRecords() {
    const el = $('ax-records');
    if (!el) return;
    const sends = S.sends;
    if (!sends.length) { el.innerHTML = `<article class="ax-panel">${panelHead('Tus mejores marcas')}<p class="ax-empty">Tus récords aparecerán cuando registres ascensiones.</p></article>`; return; }
    const topOf = list => { let b = null; list.forEach(i => { const r = rank(i.a.grade); if (r >= 0 && (!b || r > b.r)) b = { r, i }; }); return b; };
    const maxG = topOf(sends), maxF = topOf(sends.filter(i => isFlash(i.a)));
    const dayMap = new Map(), monthMap = new Map(), monthDays = new Map();
    sends.forEach(i => {
      if (!i.d) return;
      const k = dkey(i.d), mk = `${i.d.getFullYear()}-${pad(i.d.getMonth() + 1)}`;
      dayMap.set(k, (dayMap.get(k) || 0) + 1);
      monthMap.set(mk, (monthMap.get(mk) || 0) + 1);
      if (!monthDays.has(mk)) monthDays.set(mk, new Set());
      monthDays.get(mk).add(k);
    });
    const maxOf = map => { let b = null; map.forEach((v, k) => { const n = v instanceof Set ? v.size : v; if (!b || n > b.n) b = { n, k }; }); return b; };
    const bd = maxOf(dayMap), bm = maxOf(monthMap), bmd = maxOf(monthDays);
    const mLabel = k => { const [y, m] = k.split('-').map(Number); return `${cap(MONTHS_LONG[m - 1])} ${y}`; };
    const streak = bestStreak(sends);
    const rm = S.metersReady ? metersRecords() : { day: null, session: null };
    const route = i => [i.a.routeName, place(i.a).school].filter(Boolean).join(' · ');
    // [etiqueta, valor, detalle, icono, tono, id heredado]
    const cards = [
      maxG && ['Grado máximo', maxG.i.a.grade, route(maxG.i), I.peak, '', 'record-highest-grade'],
      maxF && ['Flash más alto', maxF.i.a.grade, route(maxF.i), I.zap, 'amber', 'record-highest-flash'],
      streak > 0 && ['Mejor racha', plural(streak, 'día', 'días'), 'seguidos escalando', I.flame, 'coral', 'record-streak'],
      bd && ['Más vías en un día', bd.n, fmtDayYear(fromInput(bd.k)), I.star, 'amber', 'record-most-day'],
      rm.day && ['Más metros en un día', `${nf.format(rm.day.m)} m`, rm.day.label, I.ruler, ''],
      rm.session && ['Más metros en una sesión', `${nf.format(rm.session.m)} m`, rm.session.label, I.ruler, ''],
      bm && ['Más vías en un mes', bm.n, mLabel(bm.k), I.bars, ''],
      bmd && ['Más días en un mes', bmd.n, mLabel(bmd.k), I.calendar, ''],
    ].filter(Boolean);
    const shown = S.recMore ? cards : cards.slice(0, 4);
    el.innerHTML = `<article class="ax-panel">
      ${panelHead('Tus mejores marcas', cards.length > 4 ? moreBtn('rec-more', S.recMore) : '')}
      <ul class="ax-rec-list">${shown.map(([l, v, s, ic, tone, id]) => `<li class="ax-rec-row">
        <span class="ax-rec-ico${tone ? ' is-' + tone : ''}">${ic}</span>
        <span class="ax-rec-text"><span class="ax-rec-lbl">${l}</span>${s ? `<span class="ax-rec-sub">${esc(s)}</span>` : ''}</span>
        <strong class="ax-rec-val"${id ? ` id="${id}"` : ''}>${esc(v)}</strong>
      </li>`).join('')}</ul>
    </article>`;
  }

  // ══════════════════════════════════════════════════════════════════
  // LUGARES FAVORITOS
  // ══════════════════════════════════════════════════════════════════
  function renderPlaces() {
    const el = $('ax-places');
    if (!el) return;
    const sel = select('places-tab', S.placesTab, [['school', 'Escuelas'], ['sector', 'Sectores']], 'Agrupar lugares por');
    const map = new Map();
    S.sends.forEach(i => {
      const pl = place(i.a);
      const name = S.placesTab === 'school' ? pl.school : pl.sector;
      if (!name) return;
      const k = S.placesTab === 'school' ? (i.a.schoolId || name) : `${i.a.schoolId || pl.school}|${name}`;
      const cur = map.get(k) || { name, schoolId: i.a.schoolId, school: pl.school, sectors: new Map(), n: 0, routes: new Set() };
      cur.n++; cur.routes.add(String(i.a.routeId ?? i.a.routeName));
      if (pl.sector) cur.sectors.set(pl.sector, (cur.sectors.get(pl.sector) || 0) + 1);
      map.set(k, cur);
    });
    const list = [...map.values()].sort((a, b) => b.n - a.n).slice(0, 5);
    if (!list.length) { el.innerHTML = `<article class="ax-panel">${panelHead('Tus lugares favoritos', sel)}<p class="ax-empty">Aparecerán con tus ascensiones.</p></article>`; return; }
    el.innerHTML = `<article class="ax-panel">
      ${panelHead('Tus lugares favoritos', sel)}
      <div class="ax-places">${list.map((p, idx) => {
        // Miniatura: el sector más visitado de la escuela (o el propio sector)
        const sector = S.placesTab === 'sector' ? p.name : [...p.sectors.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
        const known = knownSchool(p.schoolId);
        const tag = known ? `button type="button" data-ax="place-go" data-school="${esc(p.schoolId)}"` : 'div';
        return `<${tag} class="ax-place">
          <span class="ax-thumb ax-thumb--opt"${photoAttr(p.schoolId, sector)}></span>
          <span class="ax-place-text"><strong>${esc(p.name)}</strong><span>${S.placesTab === 'sector' && p.school ? esc(p.school) + ' · ' : ''}${plural(p.routes.size, 'vía', 'vías')} · ${plural(p.n, 'ascensión', 'ascensiones')}</span></span>
          <span class="ax-rank" aria-label="Puesto ${idx + 1}">${idx + 1}</span>
        </${known ? 'button' : 'div'}>`;
      }).join('')}</div>
    </article>`;
    hydrateThumbs(el);
  }

  // ══════════════════════════════════════════════════════════════════
  // SESIONES
  // ══════════════════════════════════════════════════════════════════
  function groupSessions(items) {
    const map = new Map();
    items.slice().sort((a, b) => (b.d || 0) - (a.d || 0)).forEach(i => {
      const pl = place(i.a);
      const k = `${i.d ? dkey(i.d) : 'x'}|${i.a.schoolId || pl.school}|${pl.sector}`;
      if (!map.has(k)) map.set(k, { key: k, d: i.d, schoolId: i.a.schoolId, school: pl.school, sector: pl.sector, items: [] });
      map.get(k).items.push(i);
    });
    return [...map.values()].map(g => {
      const grades = g.items.map(i => i.a.grade).filter(Boolean);
      g.max = typeof _rocoMaxGrade === 'function' ? _rocoMaxGrade(grades) : null;
      g.avg = typeof _rocoAvgGrade === 'function' ? _rocoAvgGrade(grades) : null;
      g.title = g.sector || g.school || 'Sesión';
      g.subtitle = [g.d ? fmtDayYear(g.d) : '', g.sector ? g.school : ''].filter(Boolean).join(' · ');
      return g;
    });
  }

  function sessionCard(g, i, kind) {
    return `<button type="button" class="ax-sess" data-ax="sess-open" data-kind="${kind}" data-i="${i}">
      <span class="ax-thumb ax-thumb--lg ax-datetile"${kind === 'rock' ? photoAttr(g.schoolId, g.sector) : ''}>${g.d ? `<b>${g.d.getDate()}</b><small>${MONTHS[g.d.getMonth()]}</small>` : ''}</span>
      <span class="ax-sess-text">
        <small>${g.d ? fmtDayYear(g.d) : ''}${g.school && g.sector ? ' · ' + esc(g.school) : ''}</small>
        <strong>${esc(g.sector || g.school || 'Sesión')}</strong>
        <span class="ax-sess-chips"><em>${plural(g.items.length, 'vía', 'vías')}</em>${g.max ? `<em class="ax-chip-grade" style="--c:${gcolor(g.max)}">${esc(g.max)}${g.items.length > 1 && g.avg ? ` · ${esc(g.avg)} medio` : ''}</em>` : ''}</span>
      </span>
      <span class="ax-sess-go">${I.chevron}</span>
    </button>`;
  }

  function renderSessions() {
    const el = $('activity-list');
    if (!el) return;
    const f = S.sessFilter;
    const pool = S.rock.filter(i => f === 'all' || i.a.style === f);
    S.sessions = groupSessions(pool);
    if (!S.sessions.length) {
      el.innerHTML = `<div class="ax-panel ax-empty-state">
        <h3>${S.rock.length ? 'Sin ascensiones para este filtro' : 'Sin ascensiones registradas'}</h3>
        <p>${S.rock.length ? 'Prueba con otro filtro.' : 'Registra tu primera ascensión desde el mapa.'}</p></div>`;
      return;
    }
    const shown = S.sessions.slice(0, S.sessShown);
    el.innerHTML = shown.map((g, i) => sessionCard(g, i, 'rock')).join('')
      + (S.sessions.length > shown.length ? `<button type="button" class="ax-btn ax-btn--soft" data-ax="sess-more">Ver todas las sesiones</button>` : '');
    hydrateThumbs(el);
  }

  // ── Sesiones de escalada (reales, iniciadas desde el mapa) ───────────
  // Separadas de «Últimas sesiones», que agrupa ascensos por día y lugar: aquí cada tarjeta es una sesión con
  // cronómetro (climb-session.js) y su detalle es el mismo resumen que se ve al finalizarla.
  function climbCard(c, i) {
    const d = new Date(c.startedAt);
    const st = c.stats || {};
    const dur = typeof kxsFormatDuration === 'function' ? kxsFormatDuration(c.activeMs || 0) : '';
    const bits = [dur, plural(st.routes || 0, 'vía', 'vías'), st.meters > 0 ? `${nf.format(st.meters)} m` : '', c.gps && c.gps.enabled && c.gps.distanceM > 0 && typeof kxsFormatDistance === 'function' ? kxsFormatDistance(c.gps.distanceM) : ''].filter(Boolean);
    return `<button type="button" class="ax-sess" data-ax="climb-open" data-i="${i}">
      <span class="ax-thumb ax-thumb--lg ax-datetile"><b>${d.getDate()}</b><small>${MONTHS[d.getMonth()]}</small></span>
      <span class="ax-sess-text">
        <small>${fmtDayYear(d)}</small>
        <strong>${esc(c.schoolName || 'Sesión de escalada')}</strong>
        <span class="ax-sess-chips">${bits.map(t => `<em>${esc(t)}</em>`).join('')}${st.maxGrade ? `<em class="ax-chip-grade" style="--c:${gcolor(st.maxGrade)}">${esc(st.maxGrade)}</em>` : ''}</span>
      </span>
      <span class="ax-sess-go">${I.chevron}</span>
    </button>`;
  }

  function renderClimbSessions() {
    const el = $('ax-climb');
    if (!el) return;
    if (!S.climb.length) { el.innerHTML = ''; return; }   // sin sesiones no se muestra nada (no hay estado vacío engañoso)
    const shown = S.climb.slice(0, S.climbShown);
    el.innerHTML = `<div class="ax-bare-head"><h2 class="ax-h2 ax-h2--lg">Sesiones de escalada</h2></div>
      <div class="activity-list ax-sess-list">${shown.map(climbCard).join('')}</div>
      ${S.climb.length > shown.length ? '<button type="button" class="ax-btn ax-btn--soft" data-ax="climb-more">Ver todas las sesiones de escalada</button>' : ''}`;
  }

  async function loadClimbSessions() {
    const token = ++S.climbToken;
    if (!window.KruxSession) return;
    try {
      const list = await KruxSession.list(50);
      if (token !== S.climbToken) return;
      S.climb = list;
    } catch (e) { return; }
    renderClimbSessions();
  }

  async function openClimbSession(id) {
    let c = S.climb.find(x => x.id === id);
    if (!c) { await loadClimbSessions(); c = S.climb.find(x => x.id === id); }
    if (!c || !window.KruxSessionUI) return;
    let entries = [];
    try { entries = await KruxSession.ascentsOf(c.id); } catch (e) { /* se muestra el resumen guardado */ }
    KruxSessionUI.openSummary({ session: c, entries }, { history: true });
  }

  function renderGymSessions() {
    const el = $('activity-list-gym');
    if (!el) return;
    S.gymSessions = groupSessions(S.gym);
    if (!S.gymSessions.length) {
      el.innerHTML = '<div class="ax-panel ax-empty-state"><h3>Sin sesiones en rocódromo</h3><p>Añade «Rocódromo» al registrar una ascensión.</p></div>';
      return;
    }
    const shown = S.gymSessions.slice(0, S.gymSessShown);
    el.innerHTML = shown.map((g, i) => sessionCard(g, i, 'gym')).join('')
      + (S.gymSessions.length > shown.length ? `<button type="button" class="ax-btn ax-btn--soft" data-ax="gsess-more">Ver todas las sesiones</button>` : '');
  }

  function sessionSheet(kind, i) {
    const g = (kind === 'gym' ? S.gymSessions : S.sessions)[i];
    if (!g) return;
    const sends = g.items.filter(x => x.send).length;
    const mTot = kind === 'rock' && S.metersReady ? g.items.reduce((s, x) => s + (mOf(x) > 0 ? mOf(x) : 0), 0) : 0;
    openSheet({
      title: g.title,
      subtitle: g.subtitle,
      html: `<div class="ax-mini-grid ax-mini-grid--4">
          <div class="ax-mini"><span>Vías</span><strong>${g.items.length}</strong></div>
          <div class="ax-mini"><span>Máximo</span><strong>${g.max || '—'}</strong></div>
          <div class="ax-mini"><span>Medio</span><strong>${g.avg || '—'}</strong></div>
          <div class="ax-mini"><span>${mTot > 0 ? 'Metros' : 'Encadenadas'}</span><strong>${mTot > 0 ? nf.format(mTot) + ' m' : sends}</strong></div>
        </div>
        ${ascentRows(g.items)}
        ${knownSchool(g.schoolId) ? `<button type="button" class="ax-btn ax-btn--soft" data-ax="place-go" data-school="${esc(g.schoolId)}">Ver en el mapa</button>` : ''}`,
    });
  }

  // ══════════════════════════════════════════════════════════════════
  // ROCÓDROMO — evolución física (tests)
  // ══════════════════════════════════════════════════════════════════
  function testSeries(def) {
    return (typeof _gthMeasures !== 'undefined' ? _gthMeasures : []).filter(m => m.testId === def.id).map(m => {
      const d = m.measuredAt && m.measuredAt.toDate ? m.measuredAt.toDate() : new Date(m.measuredAt);
      return { v: def.unit === 'grade' ? rank(m.gradeValue) : m.value, d };
    }).filter(m => m.d && !isNaN(m.d) && m.v != null && m.v >= 0).sort((a, b) => a.d - b.d);
  }

  function renderPhysical() {
    const el = $('ax-physical');
    if (!el) return;
    const defs = (typeof _gthDefs !== 'undefined' ? _gthDefs : []).filter(d => d.pinned);
    const seen = new Set();
    const charts = defs.filter(d => { const k = d.templateKey || d.id; if (seen.has(k)) return false; seen.add(k); return true; })
      .map(d => ({ d, s: testSeries(d) })).filter(x => x.s.length >= 3);
    if (!charts.length) {
      el.innerHTML = `<article class="ax-panel">${panelHead('Evolución física')}<p class="ax-empty">Registra al menos 3 mediciones de un test para ver su progresión.</p></article>`;
      return;
    }
    el.innerHTML = `<article class="ax-panel">${panelHead('Evolución física')}<div class="ax-phys">${charts.map(({ d, s }) => {
      const vals = s.map(x => x.v), lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1;
      const up = d.progressDirection === 'higher_is_better';
      // Arriba siempre es mejor: en los tests de «menos es mejor» se invierte el eje
      const yy = v => (up ? 88 - ((v - lo) / span) * 76 : 12 + ((v - lo) / span) * 76).toFixed(1);
      const pts = s.map((x, i) => `${(2 + (i / (s.length - 1)) * 96).toFixed(1)},${yy(x.v)}`).join(' ');
      const unit = typeof _gthUnitLabel === 'function' ? _gthUnitLabel(d) : '';
      const fv = x => d.unit === 'grade' ? (scale(x.v) || '') : `${nf1.format(x.v)} ${unit}`.trim();
      const better = up ? vals[vals.length - 1] - vals[0] : vals[0] - vals[vals.length - 1];
      return `<div class="ax-phys-row">
        <div class="ax-phys-head"><strong>${esc(d.name)}</strong><span class="ax-trend ${better > 0 ? 'is-up' : better < 0 ? 'is-down' : 'is-flat'}">${better > 0 ? 'Mejora' : better < 0 ? 'Empeora' : 'Igual'} desde ${fmtDay(s[0].d)}</span></div>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" class="ax-phys-svg" role="img" aria-label="Evolución de ${esc(d.name)}: de ${esc(fv(s[0]))} a ${esc(fv(s[s.length - 1]))}"><polyline points="${pts}"/></svg>
        <div class="ax-phys-foot"><span>${fmtDay(s[0].d)} · ${esc(fv(s[0]))}</span><strong>${esc(fv(s[s.length - 1]))}</strong></div>
      </div>`;
    }).join('')}</div></article>`;
  }

  // ══════════════════════════════════════════════════════════════════
  // Rango personalizado
  // ══════════════════════════════════════════════════════════════════
  function customRangeSheet(target) {
    const cur = target === 'meters' ? S.metersCustom : S.evoCustom;
    const today = dkey(new Date());
    const from = cur ? dkey(cur.from) : dkey(addDays(new Date(), -30));
    const to = cur ? dkey(cur.to) : today;
    const sheet = openSheet({
      title: 'Rango personalizado',
      subtitle: 'Elige el periodo a analizar',
      // Al cancelar se vuelve a pintar la sección para que el selector recupere su valor anterior
      onClose: () => (target === 'meters' ? renderMeters() : renderEvolution()),
      html: `<div class="ax-presets">${[[7, 'Últimos 7 días'], [30, 'Últimos 30 días'], [90, 'Últimos 3 meses']].map(([n, l]) => `<button type="button" class="ax-seg-btn ax-preset" data-preset="${n}">${l}</button>`).join('')}</div>
        <div class="ax-date-row"><label>Desde<input type="date" id="ax-d-from" value="${from}" max="${today}"></label><label>Hasta<input type="date" id="ax-d-to" value="${to}" max="${today}"></label></div>
        <p class="ax-form-err" id="ax-d-err" role="alert" hidden>La fecha de inicio debe ser anterior a la de fin.</p>
        <div class="ax-actions"><button type="button" class="ax-btn ax-btn--soft" data-ax-close>Cancelar</button><button type="button" class="ax-btn" id="ax-d-apply">Aplicar</button></div>`,
    });
    sheet.querySelectorAll('[data-preset]').forEach(b => b.addEventListener('click', () => {
      sheet.querySelector('#ax-d-from').value = dkey(addDays(new Date(), -parseInt(b.dataset.preset, 10)));
      sheet.querySelector('#ax-d-to').value = today;
    }));
    sheet.querySelector('#ax-d-apply').addEventListener('click', () => {
      const f = sheet.querySelector('#ax-d-from').value, t = sheet.querySelector('#ax-d-to').value;
      if (!f || !t || f > t) { sheet.querySelector('#ax-d-err').hidden = false; return; }
      const range = { from: fromInput(f), to: fromInput(t) };
      closeSheet(true);
      if (target === 'meters') { S.metersCustom = range; S.metersPeriod = 'custom'; renderMeters(); }
      else { S.evoCustom = range; S.evoPeriod = 'custom'; S.evoSel = null; renderEvolution(); }
    });
  }

  // ── Eventos ──────────────────────────────────────────────────────────
  function onClick(e) {
    const t = e.target.closest('[data-ax]');
    if (!t || !t.closest('#activity-view, .ax-sheet-overlay')) return;
    const v = t.dataset.v;
    switch (t.dataset.ax) {
      case 'perf-more': S.perfMore = !S.perfMore; renderPerf(); break;
      case 'meters-hitos': hitosSheet(); break;
      case 'evo-view': S.evoView = v; renderEvolution(); break;
      case 'evo-bar': S.evoSel = parseInt(t.dataset.i, 10); renderEvolution(); break;
      case 'pyr-row': pyramidSheet(t.dataset.g); break;
      case 'hm-filter': S.hmFilter = v; renderConsistency(); break;
      case 'hm-day': daySheet(t.dataset.k, t.dataset.hm); break;
      case 'rec-more': S.recMore = !S.recMore; renderRecords(); break;
      case 'place-go': closeSheet(true); if (typeof _navigateToGymOnMap === 'function') _navigateToGymOnMap(t.dataset.school); break;
      case 'goto-map': if (typeof switchView === 'function') switchView('map-view'); break;
      case 'sess-open': sessionSheet(t.dataset.kind, parseInt(t.dataset.i, 10)); break;
      case 'climb-open': openClimbSession(S.climb[parseInt(t.dataset.i, 10)] && S.climb[parseInt(t.dataset.i, 10)].id); break;
      case 'climb-more': S.climbShown += 10; renderClimbSessions(); break;
      case 'sess-more': S.sessShown += 10; renderSessions(); break;
      case 'gsess-more': S.gymSessShown += 10; renderGymSessions(); break;
      case 'retry': if (typeof loadActivityData === 'function') { showLoading(); loadActivityData(); } break;
    }
  }

  function onChange(e) {
    const t = e.target.closest('[data-ax-change]');
    if (!t || !t.closest('#activity-view')) return;
    const v = t.value;
    switch (t.dataset.axChange) {
      case 'perf-period': S.perfPeriod = v; renderPerf(); break;
      case 'meters-period': if (v === 'custom') customRangeSheet('meters'); else { S.metersPeriod = v; renderMeters(); } break;
      case 'evo-period': if (v === 'custom') customRangeSheet('evo'); else { S.evoPeriod = v; S.evoSel = null; renderEvolution(); } break;
      case 'hm-year': S.hmYear = parseInt(v, 10); renderConsistency(); break;
      case 'hm-gym-year': S.hmGymYear = parseInt(v, 10); renderGymConsistency(); break;
      case 'places-tab': S.placesTab = v; renderPlaces(); break;
      case 'pyr-view': S.pyrView = v; renderPyramid(); break;
    }
  }

  // ── Estados globales ────────────────────────────────────────────────
  const SECTIONS = ['ax-project', 'ax-perf', 'ax-meters', 'ax-evolution', 'ax-pyramid', 'ax-consistency', 'ax-records', 'ax-places', 'ax-gym-consistency', 'ax-physical'];

  function showLoading() {
    SECTIONS.forEach(id => { const el = $(id); if (el) el.innerHTML = `<div class="ax-panel"><div class="ax-skel" style="height:${id === 'ax-project' ? 220 : 110}px"></div></div>`; });
  }

  function showError() {
    const el = $('ax-project');
    if (el) el.innerHTML = '<div class="ax-panel ax-error" role="alert"><p>No se han podido cargar tus datos de actividad.</p><button type="button" class="ax-btn" data-ax="retry">Reintentar</button></div>';
    if (!S.loaded) SECTIONS.filter(id => id !== 'ax-project').forEach(id => { const x = $(id); if (x) x.innerHTML = ''; });
  }

  function render(all) {
    S.loaded = true;
    normalize(all);
    renderProject();
    renderPerf();
    renderMeters();
    renderEvolution();
    renderPyramid();
    renderConsistency();
    renderRecords();
    renderPlaces();
    renderClimbSessions();
    loadClimbSessions();
    renderSessions();
    renderGymConsistency();
    renderGymSessions();
    renderPhysical();
    resolveMeters();
  }

  function setSessionFilter(f) {
    S.sessFilter = f;
    S.sessShown = 5;
    renderSessions();
  }

  function init() {
    const root = $('activity-view');
    if (!root || root.dataset.axReady) return;
    root.dataset.axReady = '1';
    document.addEventListener('click', onClick);
    document.addEventListener('change', onChange);
    if (!S.loaded) showLoading();   // si los datos ya llegaron no se tapan con el esqueleto
    // Al finalizar una sesión de escalada, su tarjeta aparece sin recargar la pestaña
    if (window.KruxSession) {
      let was = KruxSession.isActive();
      KruxSession.on(() => { const now = KruxSession.isActive(); if (was && !now) loadClimbSessions(); was = now; });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

  window.KruxActivity = {
    render, showError, setSessionFilter, renderPhysical, openClimbSession,
    // Funciones puras expuestas para las pruebas
    _test: { milestoneState, lengthOf, MILESTONES, periodRange, bestStreak, groupSessions, delta },
  };
})();

/**
 * Spotter Tool — Menú de creación para Spotters/Admins
 *
 * Herramienta para agregar nuevas vías, sectores, puntos de interés y escuelas.
 * Solo disponible para usuarios con rol 'admin' o 'spotter' en Firestore.
 *
 * Funcionalidades:
 * - Menú desplegable con opciones: + Vía, + Sector, + Punto de Interés, + Escuela
 * - Dibujar puntos de vías en el mapa
 * - Dibujar la línea de la pared de cada sector en el mapa
 * - Añadir puntos de interés con tipo seleccionable
 * - Proponer nuevas escuelas de escalada
 * - Sincronización con Firestore (pendientes de aprobación)
 * - Descarga de GeoJSON actualizado
 */

// ============================================
// VARIABLES GLOBALES
// ============================================

// --- Modo Vía (existente) ---
let devModeActive = false;
let devCurrentSchoolSectors = [];
let devPendingSectorNames = new Set(); // Sectores propios aún pendientes de aprobación
let devPendingRouteCoords = null;
let devRouteMarker = null;
let devPendingRouteDocId = null;

// --- Menú Spotter ---
let devSpotterMenuOpen = false;

// --- Modo Punto de Interés ---
let devPOIMode = false;
let devPOICoords = null;
let devPOIMarker = null;
let devPOIType = null;

// --- Modo Escuela ---
let devSchoolMode = false;
let devSchoolCoords = null;
let devSchoolMarker = null;

// --- Modo Sector (línea de la pared) ---
let devSectorMode = false;
let devSectorVertices = [];
const DEV_SECTOR_SOURCE = 'dev-sector-draw-source';
const DEV_SECTOR_CASING_LAYER = 'dev-sector-draw-casing';
const DEV_SECTOR_LINE_LAYER = 'dev-sector-draw-line';
const DEV_SECTOR_VERTEX_LAYER = 'dev-sector-draw-vertices';

// ============================================
// VERIFICACIÓN DE PERMISOS
// ============================================

/**
 * Verifica si el usuario actual es administrador o spotter verificado
 */
async function isDevAdminOrSpotter() {
  try {
    const user = auth.currentUser;
    if (!user) {
      console.log('[DevEditor] isDevAdminOrSpotter: sin auth.currentUser');
      return false;
    }

    const adminDoc = await db.collection('admins').doc(user.uid).get();
    if (!adminDoc.exists) {
      console.log('[DevEditor] isDevAdminOrSpotter: admins/' + user.uid + ' no existe');
      return false;
    }

    const role = adminDoc.data().role;
    const ok = role === 'admin' || role === 'spotter';
    _devEditorRole = ok ? role : null;
    console.log('[DevEditor] isDevAdminOrSpotter: role="' + role + '" → ' + ok);
    return ok;
  } catch (error) {
    console.error('[DevEditor] Error verificando admin/spotter:', error && error.code, error && error.message);
    return false;
  }
}

/**
 * Devuelve 'approved' si el usuario actual tiene rol 'admin', 'pending' en caso contrario.
 * Los admins no necesitan pasar por el flujo de aprobación.
 */
async function getInitialStatus() {
  try {
    const user = auth.currentUser;
    if (!user) return 'pending';
    const adminDoc = await db.collection('admins').doc(user.uid).get();
    if (!adminDoc.exists) return 'pending';
    return adminDoc.data().role === 'admin' ? 'approved' : 'pending';
  } catch (e) {
    return 'pending';
  }
}

// ============================================
// INICIALIZACIÓN DEL BOTÓN
// ============================================

// Rol del usuario actual ('admin' | 'spotter' | null): decide si se muestran los puntos de cada propuesta
let _devEditorRole = null;

// Caché del rol ligada al usuario: nunca se reutiliza el resultado de otra sesión.
// Guarda también el «no» para que el watchdog no consulte Firestore cada 5 s.
let _devEditorRoleCache = { uid: null, ts: 0, hasAccess: false };
const _DEV_EDITOR_ROLE_TTL = 60000;

async function _getDevEditorAccess({ force = false } = {}) {
  const uid = auth.currentUser ? auth.currentUser.uid : null;
  if (!uid) return false;
  const now = Date.now();
  if (!force && _devEditorRoleCache.uid === uid && now - _devEditorRoleCache.ts < _DEV_EDITOR_ROLE_TTL) {
    return _devEditorRoleCache.hasAccess;
  }
  const ok = await isDevAdminOrSpotter();
  // Si la sesión cambió durante la consulta, el resultado no es de nadie
  if (!auth.currentUser || auth.currentUser.uid !== uid) return false;
  _devEditorRoleCache = { uid, ts: Date.now(), hasAccess: ok };
  return ok;
}

// Usuario para el que está montada la herramienta y turno de la comprobación en curso:
// una comprobación lenta de una sesión anterior se descarta al terminar
let _devEditorUid = null;
let _devEditorCheckSeq = 0;

// Encabeza la pila de controles del mapa (abajo a la derecha) en cuanto MapLibre la ha creado;
// hasta entonces el botón espera en #map y se recoloca con 'maplibre:ready'
function _placeDevEditorButton(btn) {
  const stack = document.querySelector('#map .maplibregl-ctrl-bottom-right');
  if (stack && btn.parentElement !== stack) stack.insertBefore(btn, stack.firstChild);
}

/**
 * Desmonta todo lo que la herramienta pueda tener abierto con los permisos del usuario anterior:
 * modos de dibujo (y sus listeners del mapa), menú, modales, datos temporales y el propio botón.
 */
function _resetDevEditorSession() {
  try { deactivateAllModes(); } catch (e) { console.warn('[DevEditor] Error cerrando modos:', e); }
  ['dev-spotter-menu', 'dev-route-modal', 'dev-poi-modal', 'dev-school-modal', 'dev-sector-modal',
   'dev-sector-toolbar', 'dev-mode-bar', 'spotter-sector-photo-prompt'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.remove();
  });
  devCurrentSchoolSectors = [];
  devPendingSectorNames = new Set();
  devPendingRouteCoords = null;
  devPendingRouteDocId = null;
  _devEditorRole = null;
  try {
    const temp = mlMap && mlMap.getSource && mlMap.getSource('dev-temp-routes');
    if (temp) temp.setData({ type: 'FeatureCollection', features: [] });
  } catch (e) {}
  const btn = document.getElementById('btn-dev-editor');
  if (btn) btn.remove();
}

/**
 * Muestra el botón solo si el usuario actual tiene rol admin/spotter en Firestore.
 * Sin permiso (o sin sesión) lo retira. retry: reintenta una vez si la primera consulta dice que no.
 */
async function addDevEditorButton({ retry = false } = {}) {
  if (!auth || !auth.currentUser) {
    console.log('[DevEditor] addDevEditorButton: sin usuario autenticado');
    _resetDevEditorSession();
    return;
  }
  const uid = auth.currentUser.uid;
  const seq = ++_devEditorCheckSeq;
  const stale = () => seq !== _devEditorCheckSeq || !auth.currentUser || auth.currentUser.uid !== uid;
  try {
    let hasAccess = await _getDevEditorAccess();
    if (!hasAccess && retry && !stale()) {
      // Reintentar una vez tras 2s por si fue fallo de red transitorio
      await new Promise(r => setTimeout(r, 2000));
      if (stale()) return;
      hasAccess = await _getDevEditorAccess({ force: true });
    }
    if (stale()) return;
    if (!hasAccess) {
      console.log('[DevEditor] Usuario sin rol admin/spotter — sin herramienta de edición');
      _resetDevEditorSession();
      return;
    }
    // Ya montado para este usuario: asegurar visibilidad y posición
    const existing = document.getElementById('btn-dev-editor');
    if (existing) {
      existing.style.display = 'flex';
      _placeDevEditorButton(existing);
      return;
    }

    // Anclar al contenedor del mapa (igual que btn-3d-toggle y dev-spotter-menu)
    // para que position:absolute use el mismo sistema de coordenadas en desktop y mobile.
    const host = document.getElementById('map') || document.body;
    if (!host) {
      setTimeout(() => addDevEditorButton(), 500);
      return;
    }

    const btn = document.createElement('button');
    btn.id = 'btn-dev-editor';
    btn.className = 'map-control-btn';
    btn.innerHTML = DEV_ICONS.add;
    btn.title = 'Añadir al mapa';
    btn.type = 'button';
    btn.classList.add('maplibregl-ctrl', 'kx-ctrl-edit');
    btn.setAttribute('aria-label', 'Añadir al mapa');
    btn.setAttribute('aria-pressed', 'false');
    // Aspecto en app_2.css (MAPA — CONTROLES y HERRAMIENTA SPOTTER)
    btn.style.display = 'flex';

    btn.addEventListener('click', toggleDevMode);
    host.appendChild(btn);
    _placeDevEditorButton(btn);

    if (typeof mlMap !== 'undefined' && mlMap) {
      // off antes de on: el botón se recrea en cada sesión con permisos y no debe acumular listeners
      ['zoom', 'zoomend', 'moveend'].forEach(ev => {
        mlMap.off(ev, updateDevButtonVisibility);
        mlMap.on(ev, updateDevButtonVisibility);
      });
    }

    console.log('[DevEditor] Botón Spotter añadido');
  } catch (err) {
    console.error('[DevEditor] Error añadiendo botón:', err);
  }
}

/**
 * Mantiene visible el botón Spotter tras mover el mapa.
 * Los permisos ya se verificaron al crearlo (sin restricción de proximidad).
 */
function updateDevButtonVisibility() {
  const btn = document.getElementById('btn-dev-editor');
  if (btn) btn.style.display = 'flex';
}

// ============================================
// ICONOS Y CATÁLOGO
// ============================================

// Un solo trazo (1.75) para toda la herramienta, igual que los controles del mapa
const _devSvg = paths => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const DEV_ICONS = {
  add: _devSvg('<path d="M12 5v14M5 12h14"/>'),
  close: _devSvg('<path d="M6 6l12 12M18 6L6 18"/>'),
  via: _devSvg('<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>'),
  sector: _devSvg('<path d="M5 17l4.5-8.5 5 5L19 6"/><circle cx="5" cy="17" r="1.6"/><circle cx="9.5" cy="8.5" r="1.6"/><circle cx="14.5" cy="13.5" r="1.6"/><circle cx="19" cy="6" r="1.6"/>'),
  poi: _devSvg('<path d="M12 3v18"/><path d="M12 5h6l2 2.5-2 2.5h-6"/><path d="M12 12H6l-2 2.5L6 17h6"/>'),
  escuela: _devSvg('<path d="M3 19l6.5-11 3.5 6 2-3 6 8z"/>'),
  chevron: _devSvg('<path d="M9 6l6 6-6 6"/>'),
  back: _devSvg('<path d="M15 6l-6 6 6 6"/>'),
  undo: _devSvg('<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>'),
  check: _devSvg('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  camera: _devSvg('<path d="M4 8h3l1.5-2h7L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>')
};

// Tipos de punto de interés, agrupados como en la leyenda del mapa (iconos: assets/poi-icons)
const DEV_POI_SECTIONS = [
  { label: 'Alojamientos', items: [['hotel', 'Hotel'], ['camping', 'Camping'], ['refugio', 'Refugio'], ['albergue', 'Albergue'], ['vivac', 'Vivac']] },
  { label: 'Naturaleza', items: [['cumbre', 'Cumbre'], ['rio', 'Río'], ['cueva', 'Cueva']] },
  { label: 'Patrimonio', items: [['iglesia', 'Iglesia'], ['ermita', 'Ermita'], ['ruina', 'Ruina']] },
  { label: 'Importante', items: [['hospital', 'Hospital'], ['farmacia', 'Farmacia'], ['policia', 'Policía'], ['bomberos', 'Bomberos']] },
  { label: 'Servicios', items: [['restaurante', 'Restaurante'], ['bar', 'Bar'], ['gasolinera', 'Gasolinera'], ['tienda', 'Tienda'], ['merendero', 'Merendero'], ['banco', 'Banco'], ['correos', 'Correos'], ['informacion', 'Información']] },
  { label: 'Infraestructuras', items: [['parking', 'Parking'], ['puente', 'Puente'], ['escalera', 'Escalera'], ['mirador', 'Mirador']] },
  { label: 'Instalaciones', items: [['fuente', 'Fuente'], ['wc', 'WC'], ['ducha', 'Ducha'], ['piscina', 'Piscina']] }
];

const DEV_GRADES = [
  ['Fácil (3-5)', ['3a', '3b', '3c', '4a', '4b', '4c', '5a', '5a+', '5b', '5b+', '5c', '5c+']],
  ['Medio (6a-6c)', ['6a', '6a+', '6b', '6b+', '6c', '6c+']],
  ['Difícil (7a-7c)', ['7a', '7a+', '7b', '7b+', '7c', '7c+']],
  ['Muy difícil (8+)', ['8a', '8a+', '8b', '8b+', '8c', '8c+', '9a', '9a+', '9b', '9b+', '9c']]
];

function _devEsc(text) {
  return String(text == null ? '' : text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function _devPOILabel(key) {
  for (const section of DEV_POI_SECTIONS) {
    const hit = section.items.find(item => item[0] === key);
    if (hit) return hit[1];
  }
  return key || 'Punto de interés';
}

const _devPOIIcon = key => `assets/poi-icons/${encodeURIComponent(key)}.svg`;

// Puntos que recibe un spotter cuando le aprueban la propuesta (tabla en spotter-approval.js)
function _devPoints(collection) {
  if (_devEditorRole !== 'spotter' || typeof KX_SPOTTER_POINTS === 'undefined') return 0;
  return KX_SPOTTER_POINTS[collection] || 0;
}

function _devSchoolName() {
  if (typeof mlCurrentSchool === 'undefined' || !mlCurrentSchool) return '';
  return (typeof MAPLIBRE_SCHOOLS !== 'undefined' && MAPLIBRE_SCHOOLS[mlCurrentSchool]?.name) || mlCurrentSchool;
}

// ============================================
// MENÚ SPOTTER
// ============================================

/**
 * Botón del mapa: con un modo activo lo cancela; sin ninguno, abre o cierra el menú
 */
function toggleDevMode() {
  if (devModeActive || devPOIMode || devSchoolMode || devSectorMode) {
    deactivateAllModes();
    return;
  }
  toggleSpotterMenu();
}

/**
 * Abre/cierra el menú del Spotter: una tarjeta a la izquierda de la columna de controles
 */
function toggleSpotterMenu() {
  if (document.getElementById('dev-spotter-menu')) {
    closeSpotterMenu();
    return;
  }
  devSpotterMenuOpen = true;

  const school = _devSchoolName();
  const pts = collection => {
    const p = _devPoints(collection);
    return p ? `<span class="dev-sm-pts">+${p} pts</span>` : '';
  };
  const item = (opt, icon, label, hint, collection, more) => `
    <button type="button" class="dev-sm-item" role="menuitem" data-opt="${opt}">
      <span class="dev-sm-ico">${icon}</span>
      <span class="dev-sm-txt"><strong>${label}</strong><small>${_devEsc(hint)}</small></span>
      ${more ? `<span class="dev-sm-more">${DEV_ICONS.chevron}</span>` : pts(collection)}
    </button>`;
  const inSchool = school ? `En ${school}` : 'Abre antes una escuela';

  const menu = document.createElement('div');
  menu.id = 'dev-spotter-menu';
  menu.className = 'dev-spotter-menu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', 'Añadir al mapa');
  menu.innerHTML = `
    <div class="dev-sm-view" data-view="root">
      <p class="dev-sm-title">Añadir al mapa</p>
      ${item('via', DEV_ICONS.via, 'Vía', inSchool, 'pending_routes')}
      ${item('sector', DEV_ICONS.sector, 'Sector', inSchool, 'pending_sectors')}
      ${item('poi', DEV_ICONS.poi, 'Punto de interés', 'Fuente, parking, refugio…', 'pending_poi', true)}
      ${item('escuela', DEV_ICONS.escuela, 'Escuela', 'Una zona de escalada nueva', 'pending_schools')}
    </div>
    <div class="dev-sm-view" data-view="poi" hidden>
      <button type="button" class="dev-sm-back" data-opt="back">${DEV_ICONS.back}<span>Punto de interés</span>${pts('pending_poi')}</button>
      <div class="dev-sm-scroll">
        ${DEV_POI_SECTIONS.map(section => `
          <p class="dev-sm-sec">${section.label}</p>
          <div class="dev-sm-grid">
            ${section.items.map(([key, label]) => `
              <button type="button" class="dev-sm-poi" role="menuitem" data-poi="${key}">
                <img src="${_devPOIIcon(key)}" alt="" width="32" height="32" loading="lazy">
                <span>${label}</span>
              </button>`).join('')}
          </div>`).join('')}
      </div>
    </div>`;

  menu.addEventListener('click', e => {
    const poi = e.target.closest('[data-poi]');
    if (poi) { selectPOIType(poi.dataset.poi); return; }
    const opt = e.target.closest('[data-opt]');
    if (!opt) return;
    if (opt.dataset.opt === 'poi' || opt.dataset.opt === 'back') togglePOIAccordion(e);
    else selectSpotterOption(opt.dataset.opt);
  });

  document.getElementById('map').appendChild(menu);
  _setDevButtonState(true, 'Cerrar el menú');

  // Cerrar al tocar fuera (con retardo para que no lo cierre el mismo toque que lo abre)
  setTimeout(() => {
    document.addEventListener('click', handleSpotterMenuOutsideClick);
  }, 10);
}

function handleSpotterMenuOutsideClick(e) {
  const menu = document.getElementById('dev-spotter-menu');
  const btn = document.getElementById('btn-dev-editor');
  if (menu && !menu.contains(e.target) && !(btn && btn.contains(e.target))) {
    closeSpotterMenu();
  }
}

function closeSpotterMenu() {
  const menu = document.getElementById('dev-spotter-menu');
  if (menu) menu.remove();
  const wasOpen = devSpotterMenuOpen;
  devSpotterMenuOpen = false;
  document.removeEventListener('click', handleSpotterMenuOutsideClick);
  if (wasOpen && !(devModeActive || devPOIMode || devSchoolMode || devSectorMode)) _setDevButtonState(false);
}

/**
 * Cambia entre la lista principal y los tipos de punto de interés
 */
function togglePOIAccordion(e) {
  if (e) e.stopPropagation();
  const menu = document.getElementById('dev-spotter-menu');
  if (!menu) return;
  const root = menu.querySelector('[data-view="root"]');
  const poi = menu.querySelector('[data-view="poi"]');
  const toPOI = poi.hidden;
  root.hidden = toPOI;
  poi.hidden = !toPOI;
  (toPOI ? poi : root).querySelector('button')?.focus({ preventScroll: true });
}

function selectPOIType(poiType) {
  closeSpotterMenu();
  activatePOIMode(poiType);
}

function selectSpotterOption(option) {
  closeSpotterMenu();
  switch (option) {
    case 'via': activateDevMode(); break;
    case 'sector': activateSectorMode(); break;
    case 'escuela': activateSchoolMode(); break;
  }
}

/**
 * Desactiva todos los modos activos
 */
function deactivateAllModes() {
  if (devModeActive) deactivateDevMode();
  if (devPOIMode) deactivatePOIMode();
  if (devSchoolMode) deactivateSchoolMode();
  if (devSectorMode) deactivateSectorMode();
  closeSpotterMenu();
}

// ============================================
// ESTADO VISUAL: BOTÓN, BARRA DE MODO Y PIN
// ============================================

// El botón pasa a «cerrar» (bosque sobre claro) mientras hay menú o modo abierto
function _setDevButtonState(active, label) {
  const btn = document.getElementById('btn-dev-editor');
  if (!btn) return;
  if (active) btn.classList.add('is-active'); else btn.classList.remove('is-active');
  btn.innerHTML = active ? DEV_ICONS.close : DEV_ICONS.add;
  btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  btn.setAttribute('aria-label', active ? (label || 'Cancelar') : 'Añadir al mapa');
  btn.title = active ? (label || 'Cancelar') : 'Añadir al mapa';
}

function _setDevCursor(on) {
  if (typeof mlMap !== 'undefined' && mlMap) mlMap.getCanvas().style.cursor = on ? 'crosshair' : '';
}

/**
 * Barra de modo: dice qué se está añadiendo, qué hay que hacer ahora y ofrece las acciones del paso.
 * actions: [{ act, label, icon, primary, disabled }]
 */
function _showDevModeBar({ icon, title, hint, actions = [] }) {
  const host = document.getElementById('map');
  if (!host || !host.querySelector) return;
  let bar = document.getElementById('dev-mode-bar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'dev-mode-bar';
    bar.className = 'dev-mode-bar';
    bar.setAttribute('role', 'status');
    bar.addEventListener('click', e => {
      const act = e.target.closest('[data-act]');
      if (act && !act.disabled) _handleDevBarAction(act.dataset.act);
    });
    host.appendChild(bar);
  }
  bar.innerHTML = `
    <div class="dev-mode-bar-main">
      <span class="dev-mode-bar-ico">${icon}</span>
      <span class="dev-mode-bar-txt"><strong>${_devEsc(title)}</strong><small>${_devEsc(hint)}</small></span>
      <button type="button" class="dev-mode-bar-x" data-act="cancel" aria-label="Cancelar">${DEV_ICONS.close}</button>
    </div>
    ${actions.length ? `<div class="dev-mode-bar-actions">${actions.map(a => `
      <button type="button" class="dev-bar-btn${a.primary ? ' is-primary' : ''}" data-act="${a.act}"${a.disabled ? ' disabled' : ''}>${a.icon || ''}<span>${a.label}</span></button>`).join('')}</div>` : ''}`;
  _setDevButtonState(true, 'Cancelar');
}

function _hideDevModeBar() {
  const bar = document.getElementById('dev-mode-bar');
  if (bar) bar.remove();
  _setDevButtonState(false);
}

function _handleDevBarAction(act) {
  switch (act) {
    case 'cancel': deactivateAllModes(); break;
    case 'continue':
      if (devModeActive) showDevRouteModal();
      else if (devPOIMode) showPOIModal();
      else if (devSchoolMode) showSchoolModal();
      break;
    case 'undo': undoSectorVertex(); break;
    case 'finish': finishSectorDraw(); break;
  }
}

const _DEV_CONTINUE = [{ act: 'continue', label: 'Continuar', icon: DEV_ICONS.check, primary: true }];

/**
 * Crea o mueve el pin arrastrable de un modo de un solo punto.
 * content: HTML del interior (icono). onMove recibe [lng, lat] al colocarlo y al soltarlo.
 */
function _placeDevPin(marker, lngLat, content, onMove) {
  onMove([lngLat.lng, lngLat.lat]);
  if (marker) {
    marker.setLngLat(lngLat);
    return marker;
  }
  const el = document.createElement('div');
  el.className = 'dev-pin';
  el.innerHTML = content;
  const created = new maplibregl.Marker({ element: el, draggable: true, anchor: 'bottom' })
    .setLngLat(lngLat)
    .addTo(mlMap);
  created.on('dragend', () => {
    const p = created.getLngLat();
    onMove([p.lng, p.lat]);
  });
  return created;
}

// ============================================
// HOJA DE FORMULARIO (común a los cuatro modos)
// ============================================

/**
 * Abre una hoja con formulario. onSave devuelve una promesa; mientras dura, el botón queda bloqueado
 * (sin dobles envíos). onCancel se llama al cerrar sin guardar.
 */
function _openDevSheet({ id, icon, title, sub, body, saveLabel, onSave, onCancel, focusId }) {
  const previous = document.getElementById(id);
  if (previous) previous.remove();

  const overlay = document.createElement('div');
  overlay.id = id;
  overlay.className = 'dev-route-modal-overlay';
  overlay.innerHTML = `
    <div class="dev-route-modal" role="dialog" aria-modal="true" aria-labelledby="${id}-title">
      <div class="dev-route-modal-header">
        <span class="dev-sheet-ico">${icon}</span>
        <div class="dev-sheet-head">
          <h3 id="${id}-title">${_devEsc(title)}</h3>
          ${sub ? `<p>${_devEsc(sub)}</p>` : ''}
        </div>
        <button type="button" class="dev-modal-close" data-act="cancel" aria-label="Cerrar">${DEV_ICONS.close}</button>
      </div>
      <form class="dev-route-modal-body" novalidate>
        ${body}
        <p class="dev-form-error" role="alert" hidden></p>
      </form>
      <div class="dev-route-modal-footer">
        <button type="button" class="dev-btn-cancel" data-act="cancel">Cancelar</button>
        <button type="button" class="dev-btn-save" data-act="save">${saveLabel}</button>
      </div>
    </div>`;

  const cancel = () => {
    if (overlay._devSaving) return;
    overlay.remove();
    if (typeof onCancel === 'function') onCancel();
  };
  const save = async () => {
    if (overlay._devSaving) return;
    const btn = overlay.querySelector('.dev-btn-save');
    _devFormError(id, '');
    overlay._devSaving = true;
    btn.disabled = true;
    btn.textContent = 'Guardando…';
    try {
      await onSave();
    } finally {
      overlay._devSaving = false;
      btn.disabled = false;
      btn.textContent = saveLabel;
    }
  };

  overlay.addEventListener('click', e => {
    if (e.target === overlay) { cancel(); return; }
    const act = e.target.closest('[data-act]');
    if (!act) return;
    if (act.dataset.act === 'cancel') cancel(); else save();
  });
  overlay.addEventListener('keydown', e => { if (e.key === 'Escape') cancel(); });
  overlay.querySelector('form').addEventListener('submit', e => { e.preventDefault(); save(); });

  document.body.appendChild(overlay);
  if (focusId) setTimeout(() => document.getElementById(focusId)?.focus(), 100);
  return overlay;
}

/** Error de formulario dentro de la hoja (los avisos flotantes quedan tapados por ella). */
function _devFormError(sheetId, message, fieldId) {
  const sheet = document.getElementById(sheetId);
  if (!sheet || !sheet.querySelector) return;
  sheet.querySelectorAll('.is-invalid').forEach(el => el.classList.remove('is-invalid'));
  const box = sheet.querySelector('.dev-form-error');
  if (box) { box.textContent = message || ''; box.hidden = !message; }
  const field = fieldId && document.getElementById(fieldId);
  if (field) { field.classList.add('is-invalid'); field.focus(); }
}

function _removeDevSheet(id) {
  const sheet = document.getElementById(id);
  if (sheet) sheet.remove();
}

// Aviso tras guardar: un admin publica directamente; un spotter envía a revisión y ve lo que ganará
function _devSavedToast(what, status, collection) {
  if (status === 'approved') {
    showDevToast(`${what} publicada en el mapa`, 'success');
    return;
  }
  const points = _devPoints(collection);
  showDevToast(`${what} enviada a revisión` + (points ? `\n+${points} pts cuando se apruebe` : ''), 'success');
}

// ============================================
// MODO VÍA
// ============================================

/**
 * Activa el modo de añadir vía. Necesita una escuela abierta con al menos un sector.
 */
async function activateDevMode() {
  deactivateAllModes();
  if (typeof mlCurrentSchool === 'undefined' || !mlCurrentSchool) {
    showDevToast('Abre una escuela para añadir una vía\nAcércate en el mapa hasta que se carguen sus sectores', 'warning');
    return;
  }

  devModeActive = true;
  _showDevModeBar({ icon: DEV_ICONS.via, title: 'Nueva vía', hint: 'Cargando sectores…' });

  await loadSchoolSectors();
  if (!devModeActive) return;   // cancelado mientras cargaba

  if (devCurrentSchoolSectors.length === 0) {
    deactivateDevMode();
    showDevToast('Esta escuela aún no tiene sectores\nDibuja primero el sector y después añade sus vías', 'warning');
    return;
  }

  _showDevModeBar({ icon: DEV_ICONS.via, title: 'Nueva vía', hint: `Toca el pie de la vía en ${_devSchoolName()}` });
  if (mlMap) {
    mlMap.on('click', handleDevMapClick);
    _setDevCursor(true);
  }
}

/**
 * Desactiva el modo vía
 */
function deactivateDevMode() {
  devModeActive = false;
  devPendingRouteCoords = null;

  if (typeof mlMap !== 'undefined' && mlMap) {
    mlMap.off('click', handleDevMapClick);
    _setDevCursor(false);
  }
  if (devRouteMarker) {
    devRouteMarker.remove();
    devRouteMarker = null;
  }

  closeDevRouteModal();
  _hideDevModeBar();
}

// ============================================
// CARGA DE SECTORES
// ============================================

/**
 * Carga los sectores de la escuela actual
 */
async function loadSchoolSectors() {
  devCurrentSchoolSectors = [];

  if (!mlCurrentSchool) {
    console.warn('[DevEditor] No hay escuela cargada');
    return;
  }

  const schoolId = mlCurrentSchool;
  const school = MAPLIBRE_SCHOOLS[schoolId];
  const sectorNames = new Set();

  // 1. Sectores del GeoJSON estático
  if (school?.geojson?.sectores) {
    try {
      const response = await fetch(school.geojson.sectores + '?v=' + Date.now());
      if (response.ok) {
        const geojson = await response.json();
        if (geojson.features) {
          geojson.features
            .map(f => f.properties.nombre)
            .filter(name => name && name.trim() !== '')
            .forEach(name => sectorNames.add(name));
        }
      }
    } catch (error) {
      console.warn('[DevEditor] Error cargando GeoJSON sectores:', error);
    }
  }

  // 2. Sectores aprobados en Firestore para esta escuela
  try {
    const snap = await db.collection('pending_sectors')
      .where('schoolId', '==', schoolId)
      .where('status', '==', 'approved')
      .get();
    snap.forEach(doc => {
      const nombre = doc.data().nombre?.trim();
      if (nombre) sectorNames.add(nombre);
    });
  } catch (error) {
    console.warn('[DevEditor] Error cargando sectores aprobados:', error);
  }

  // 3. Sectores propios pendientes de aprobación (solo los del usuario actual)
  devPendingSectorNames = new Set();
  try {
    const user = auth.currentUser;
    if (user) {
      const snap = await db.collection('pending_sectors')
        .where('schoolId', '==', schoolId)
        .where('createdBy', '==', user.uid)
        .where('status', '==', 'pending')
        .get();
      snap.forEach(doc => {
        const nombre = doc.data().nombre?.trim();
        if (nombre) {
          devPendingSectorNames.add(nombre);
          sectorNames.add(nombre);
        }
      });
    }
  } catch (error) {
    console.warn('[DevEditor] Error cargando sectores propios pendientes:', error);
  }

  devCurrentSchoolSectors = [...sectorNames].sort((a, b) => a.localeCompare(b, 'es'));
}

// ============================================
// MANEJO DE CLICS EN EL MAPA
// ============================================

/**
 * Coloca (o mueve) el pin de la vía. El formulario se abre con «Continuar», tras ajustar el pin.
 */
function handleDevMapClick(e) {
  // Ignorar si el clic fue en un control
  if (e.originalEvent && e.originalEvent.target !== mlMap.getCanvas()) return;

  // No colocar encima de una vía existente
  if (mlMap.getLayer('vias-layer') && mlMap.queryRenderedFeatures(e.point, { layers: ['vias-layer'] }).length > 0) {
    showDevToast('Ahí ya hay una vía: toca un punto libre', 'warning');
    return;
  }

  devRouteMarker = _placeDevPin(devRouteMarker, e.lngLat, DEV_ICONS.via, coords => { devPendingRouteCoords = coords; });
  _showDevModeBar({ icon: DEV_ICONS.via, title: 'Nueva vía', hint: 'Arrastra el pin para ajustar', actions: _DEV_CONTINUE });
}

// ============================================
// FORMULARIO DE VÍA
// ============================================

/**
 * Muestra la hoja para completar los datos de la vía
 */
async function showDevRouteModal() {
  if (!devPendingRouteCoords) return;

  // Sector más probable según las vías cercanas
  const detectedSector = await detectSectorByProximity();
  if (!devModeActive) return;

  const gradeOptions = DEV_GRADES.map(([label, grades]) =>
    `<optgroup label="${label}">${grades.map(g => `<option value="${g}">${g}</option>`).join('')}</optgroup>`).join('');
  const sectorOptions = devCurrentSchoolSectors.map(s =>
    `<option value="${_devEsc(s)}"${s === detectedSector ? ' selected' : ''}>${_devEsc(s)}${devPendingSectorNames.has(s) ? ' (en revisión)' : ''}</option>`).join('');

  _openDevSheet({
    id: 'dev-route-modal',
    icon: DEV_ICONS.via,
    title: 'Nueva vía',
    sub: _devSchoolName(),
    saveLabel: 'Guardar y dibujar',
    focusId: 'dev-route-name',
    onSave: saveDevRoute,
    body: `
      <div class="dev-form-group">
        <label for="dev-route-name">Nombre de la vía</label>
        <input type="text" id="dev-route-name" placeholder="Ej.: El gran diedro" maxlength="80" autocomplete="off" required>
      </div>
      <div class="dev-form-row">
        <div class="dev-form-group">
          <label for="dev-route-grade">Grado</label>
          <select id="dev-route-grade" required>
            <option value="">Elegir…</option>
            ${gradeOptions}
          </select>
        </div>
        <div class="dev-form-group">
          <label for="dev-route-sector">Sector</label>
          <select id="dev-route-sector" required>
            <option value="">Elegir…</option>
            ${sectorOptions}
          </select>
        </div>
      </div>
      <div class="dev-form-row">
        <div class="dev-form-group">
          <label for="dev-route-express">Chapas <span>opcional</span></label>
          <input type="number" id="dev-route-express" placeholder="8" min="0" max="50" inputmode="numeric">
        </div>
        <div class="dev-form-group">
          <label for="dev-route-meters">Metros <span>opcional</span></label>
          <input type="number" id="dev-route-meters" placeholder="25" min="1" max="500" inputmode="numeric">
        </div>
      </div>
      <div class="dev-form-group">
        <label for="dev-route-description">Tipo de escalada <span>opcional</span></label>
        <input type="text" id="dev-route-description" placeholder="Placa, fisura, diedro…" maxlength="120" autocomplete="off">
      </div>
      <div class="dev-form-group">
        <label for="dev-route-modality">Modalidad</label>
        <select id="dev-route-modality">
          <option value="Simple">Simple</option>
          <option value="Multilargo">Multilargo</option>
          <option value="Boulder">Boulder</option>
        </select>
      </div>`
  });
}

// Vías de la escuela para detectar el sector: una descarga por escuela, no una por toque
let _devViasCache = { schoolId: null, features: [] };

/**
 * Detecta el sector más probable basándose en la proximidad
 * a otras vías existentes en el mapa
 * @returns {string|null} Nombre del sector detectado o null
 */
async function detectSectorByProximity() {
  if (!devPendingRouteCoords || !mlCurrentSchool) return null;

  try {
    const school = MAPLIBRE_SCHOOLS[mlCurrentSchool];
    if (!school || !school.geojson || !school.geojson.vias) return null;

    if (_devViasCache.schoolId !== mlCurrentSchool) {
      const response = await fetch(school.geojson.vias);
      if (!response.ok) return null;
      const geojson = await response.json();
      _devViasCache = { schoolId: mlCurrentSchool, features: geojson.features || [] };
    }
    if (!devPendingRouteCoords) return null;

    const clickCoords = devPendingRouteCoords; // [lng, lat]

    // Distancia (euclidiana, basta a esta escala) a cada vía, con su sector
    const distances = _devViasCache.features
      .filter(f => f.properties && f.properties.sector && f.geometry && f.geometry.coordinates)
      .map(f => {
        const c = Array.isArray(f.geometry.coordinates[0]) ? f.geometry.coordinates[0] : f.geometry.coordinates;
        return { sector: f.properties.sector, distance: Math.hypot(clickCoords[0] - c[0], clickCoords[1] - c[1]) };
      })
      .sort((a, b) => a.distance - b.distance);

    if (distances.length === 0) return null;

    // Vía más cercana a menos de ~100 m (≈ 0.001°): su sector manda
    if (distances[0].distance < 0.001) return distances[0].sector;

    // Si no, el sector más repetido entre las 5 vías más cercanas
    const votes = {};
    distances.slice(0, 5).forEach(item => { votes[item.sector] = (votes[item.sector] || 0) + 1; });
    return Object.entries(votes).sort((a, b) => b[1] - a[1])[0][0];
  } catch (error) {
    console.error('[DevEditor] Error detectando sector por proximidad:', error);
    return null;
  }
}

/**
 * Cierra el formulario de vía
 */
function closeDevRouteModal() {
  _removeDevSheet('dev-route-modal');
}

// ============================================
// GUARDADO DE VÍAS
// ============================================

/**
 * Guarda la nueva vía en Firestore y pasa al dibujo sobre la foto del sector
 */
async function saveDevRoute() {
  const name = document.getElementById('dev-route-name')?.value?.trim();
  const grade = document.getElementById('dev-route-grade')?.value;
  const sector = document.getElementById('dev-route-sector')?.value;
  const express = parseInt(document.getElementById('dev-route-express')?.value) || null;
  const meters = parseInt(document.getElementById('dev-route-meters')?.value) || null;
  const description = document.getElementById('dev-route-description')?.value?.trim() || null;
  const modality = document.getElementById('dev-route-modality')?.value || 'Simple';

  if (!name) return _devFormError('dev-route-modal', 'Escribe el nombre de la vía', 'dev-route-name');
  if (!grade) return _devFormError('dev-route-modal', 'Elige el grado', 'dev-route-grade');
  if (!sector) return _devFormError('dev-route-modal', 'Elige el sector', 'dev-route-sector');
  if (!devPendingRouteCoords || !mlCurrentSchool) return _devFormError('dev-route-modal', 'Falta la ubicación: cierra y vuelve a tocar el mapa');

  try {
    const user = auth.currentUser;
    const schoolId = mlCurrentSchool;
    const schoolName = MAPLIBRE_SCHOOLS[schoolId]?.name || schoolId;
    const initialStatus = await getInitialStatus();

    const routeData = {
      // Datos de la vía
      nombre: name,
      grado1: grade,
      sector: sector,
      exp1: express,
      long1: meters,
      descripcion: description,
      modalidad: modality,
      variante: 'NO',

      // Coordenadas (formato GeoJSON)
      coordinates: devPendingRouteCoords,

      // Metadatos
      schoolId: schoolId,
      schoolName: schoolName,
      createdBy: user.uid,
      createdByEmail: user.email,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      status: initialStatus,

      // GeoJSON Feature data para exportar (sin arrays anidados para Firestore)
      geojsonFeature: {
        type: 'Feature',
        properties: {
          nombre: name,
          grado1: grade,
          sector: sector,
          exp1: express,
          long1: meters,
          descripcion: description,
          modalidad: modality,
          variante: 'NO'
        },
        geometry: {
          type: 'Point',
          // Guardamos lng y lat por separado para evitar arrays anidados en Firestore
          lng: devPendingRouteCoords[0],
          lat: devPendingRouteCoords[1]
        }
      }
    };

    const docRef = await db.collection('pending_routes').add(routeData);
    devPendingRouteDocId = docRef.id;

    // La vía no se pinta aquí: aparece cuando se completa el dibujo (y, si es de un spotter, se aprueba).
    // Se sale del modo para que el editor de dibujo no compita con los toques del mapa.
    deactivateDevMode();

    const openDrawing = () => {
      showDevToast('Vía guardada\nAhora dibújala sobre la foto del sector', 'info');
      setTimeout(() => {
        openDrawingEditorForPendingRoute(routeData.nombre, routeData.sector, docRef.id);
      }, 500);
    };

    // Sin foto del sector no hay dónde dibujar: se ofrece subirla antes
    const hasSectorPhoto = typeof window.sectorHasImage === 'function'
      ? await window.sectorHasImage(schoolId, routeData.sector)
      : true;

    if (!hasSectorPhoto) {
      promptSectorPhoto(schoolId, routeData.sector, openDrawing);
    } else {
      openDrawing();
    }
  } catch (error) {
    console.error('[DevEditor] Error guardando vía:', error);
    _devFormError('dev-route-modal', 'No se pudo guardar: ' + error.message);
  }
}

// ============================================
// CARGAR VÍAS PENDIENTES
// ============================================

/**
 * Carga las vías pendientes de Firestore y las muestra en el mapa
 * Se llama cuando el admin está cerca de una escuela
 */
async function loadPendingRoutesFromFirestore() {
  if (!mlMap || !mlCurrentSchool) return;

  const hasAccess = await isDevAdminOrSpotter();
  if (!hasAccess) return;

  try {
    const snapshot = await db.collection('pending_routes')
      .where('schoolId', '==', mlCurrentSchool)
      .where('status', '==', 'pending')
      .get();

    if (snapshot.empty) return;

    const sourceId = 'dev-temp-routes';
    const layerId = 'dev-temp-routes-layer';

    if (!mlMap.getSource(sourceId)) {
      mlMap.addSource(sourceId, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });

      mlMap.addLayer({
        id: layerId,
        type: 'circle',
        source: sourceId,
        paint: {
          'circle-radius': 8,
          'circle-color': '#FF8D67',
          'circle-stroke-color': '#F7F6F0',
          'circle-stroke-width': 2,
          'circle-opacity': 0.9
        }
      });
    }

    const features = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      features.push({
        type: 'Feature',
        properties: {
          nombre: data.nombre,
          grado1: data.grado1,
          sector: data.sector,
          isPending: true,
          docId: doc.id
        },
        geometry: {
          type: 'Point',
          coordinates: data.coordinates
        }
      });
    });

    mlMap.getSource(sourceId).setData({ type: 'FeatureCollection', features });
  } catch (error) {
    console.error('[DevEditor] Error cargando vías pendientes:', error);
  }
}

// ============================================
// ABRIR EDITOR DE DIBUJO PARA VÍA PENDIENTE
// ============================================

/**
 * Abre el editor de dibujo para una vía pendiente recién creada
 * @param {string} routeName - Nombre de la vía
 * @param {string} sectorName - Nombre del sector
 * @param {string} docId - ID del documento en Firestore
 */
async function openDrawingEditorForPendingRoute(routeName, sectorName, docId) {
  if (!mlCurrentSchool) {
    showDevToast('No se puede determinar la escuela actual', 'error');
    return;
  }

  // Verificar que existe imagen del sector
  const imageUrl = await getSectorImageUrl(mlCurrentSchool, sectorName);
  if (!imageUrl) {
    showDevToast('Vía guardada sin dibujo\nEl sector aún no tiene foto', 'warning');
    return;
  }

  if (typeof openRouteDrawingEditorForPendingRoute === 'function') {
    await openRouteDrawingEditorForPendingRoute(mlCurrentSchool, sectorName, routeName, docId);
  } else {
    showDevToast('Abre la foto del sector para dibujar la vía', 'warning');
  }
}

// ============================================
// EXPORTAR GEOJSON
// ============================================

/**
 * Descarga las vías pendientes como GeoJSON
 * (Para integrar manualmente con los archivos existentes)
 */
async function exportPendingRoutesAsGeoJSON() {
  try {
    const snapshot = await db.collection('pending_routes')
      .where('schoolId', '==', mlCurrentSchool)
      .where('status', '==', 'pending')
      .get();

    if (snapshot.empty) {
      showDevToast('No hay vías pendientes para exportar', 'info');
      return;
    }

    const features = [];
    let fid = 1000; // Empezar con FID alto para evitar conflictos

    snapshot.forEach(doc => {
      const storedFeature = doc.data().geojsonFeature;
      features.push({
        type: 'Feature',
        properties: { ...storedFeature.properties, fid: fid++ },
        geometry: {
          type: 'MultiPoint',
          coordinates: [[storedFeature.geometry.lng, storedFeature.geometry.lat]]
        }
      });
    });

    const geojson = {
      type: 'FeatureCollection',
      name: `${mlCurrentSchool}_Vias_Nuevas`,
      features: features
    };

    const blob = new Blob([JSON.stringify(geojson, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${mlCurrentSchool}_vias_nuevas_${Date.now()}.geojson`;
    a.click();
    URL.revokeObjectURL(url);

    showDevToast(`Exportadas ${features.length} vías`, 'success');
  } catch (error) {
    console.error('[DevEditor] Error exportando:', error);
    showDevToast('Error al exportar: ' + error.message, 'error');
  }
}

// ============================================
// MODO PUNTO DE INTERÉS
// ============================================

const _devPOIPin = type => `<img src="${_devPOIIcon(type)}" alt="" width="36" height="36">`;

/**
 * Activa el modo de creación de POI
 */
function activatePOIMode(poiType) {
  deactivateAllModes();
  devPOIMode = true;
  devPOIType = poiType;

  _showDevModeBar({ icon: _devPOIPin(poiType), title: _devPOILabel(poiType), hint: 'Toca el mapa donde está' });
  if (mlMap) {
    mlMap.on('click', handlePOIMapClick);
    _setDevCursor(true);
  }
}

/**
 * Desactiva el modo POI
 */
function deactivatePOIMode() {
  devPOIMode = false;
  devPOIType = null;
  devPOICoords = null;

  if (typeof mlMap !== 'undefined' && mlMap) {
    mlMap.off('click', handlePOIMapClick);
    _setDevCursor(false);
  }
  if (devPOIMarker) {
    devPOIMarker.remove();
    devPOIMarker = null;
  }

  closePOIModal();
  _hideDevModeBar();
}

/**
 * Coloca (o mueve) el pin del POI
 */
function handlePOIMapClick(e) {
  if (e.originalEvent && e.originalEvent.target !== mlMap.getCanvas()) return;

  const isNew = !devPOIMarker;
  devPOIMarker = _placeDevPin(devPOIMarker, e.lngLat, _devPOIPin(devPOIType), coords => { devPOICoords = coords; });
  if (isNew) devPOIMarker.getElement().classList.add('dev-pin--poi');
  _showDevModeBar({ icon: _devPOIPin(devPOIType), title: _devPOILabel(devPOIType), hint: 'Arrastra el pin para ajustar', actions: _DEV_CONTINUE });
}

/**
 * Muestra la hoja para completar los datos del POI
 */
function showPOIModal() {
  if (!devPOICoords) return;
  _openDevSheet({
    id: 'dev-poi-modal',
    icon: _devPOIPin(devPOIType),
    title: _devPOILabel(devPOIType),
    sub: _devSchoolName() || 'Punto de interés',
    saveLabel: 'Guardar punto',
    focusId: 'dev-poi-name',
    onSave: savePOI,
    body: `
      <div class="dev-form-group">
        <label for="dev-poi-name">Nombre <span>opcional</span></label>
        <input type="text" id="dev-poi-name" placeholder="Ej.: Fuente del río" maxlength="80" autocomplete="off">
      </div>
      <div class="dev-form-group">
        <label for="dev-poi-link">Enlace <span>opcional</span></label>
        <input type="url" id="dev-poi-link" placeholder="https://…" inputmode="url" autocomplete="off">
      </div>`
  });
}

function closePOIModal() {
  _removeDevSheet('dev-poi-modal');
}

/**
 * Guarda el POI en Firestore
 */
async function savePOI() {
  if (!devPOICoords) return _devFormError('dev-poi-modal', 'Falta la ubicación: cierra y vuelve a tocar el mapa');

  const nombre = document.getElementById('dev-poi-name')?.value?.trim() || null;
  const link = document.getElementById('dev-poi-link')?.value?.trim() || null;
  if (link && !/^https?:\/\/\S+\.\S+/i.test(link)) {
    return _devFormError('dev-poi-modal', 'El enlace debe empezar por https://', 'dev-poi-link');
  }

  try {
    const user = auth.currentUser;
    const initialStatus = await getInitialStatus();

    await db.collection('pending_poi').add({
      descripcio: devPOIType,
      nombre: nombre,
      link: link,
      coordinates: devPOICoords,
      schoolId: mlCurrentSchool || null,
      createdBy: user.uid,
      createdByEmail: user.email,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      status: initialStatus
    });

    deactivatePOIMode();
    _devSavedToast('Propuesta', initialStatus, 'pending_poi');
  } catch (error) {
    console.error('[Spotter] Error guardando POI:', error);
    _devFormError('dev-poi-modal', 'No se pudo guardar: ' + error.message);
  }
}

// ============================================
// MODO ESCUELA
// ============================================

/**
 * Activa el modo de creación de escuela
 */
function activateSchoolMode() {
  deactivateAllModes();
  devSchoolMode = true;

  _showDevModeBar({ icon: DEV_ICONS.escuela, title: 'Nueva escuela', hint: 'Toca el mapa donde está la escuela' });
  if (mlMap) {
    mlMap.on('click', handleSchoolMapClick);
    _setDevCursor(true);
  }
}

/**
 * Desactiva el modo escuela
 */
function deactivateSchoolMode() {
  devSchoolMode = false;
  devSchoolCoords = null;

  if (typeof mlMap !== 'undefined' && mlMap) {
    mlMap.off('click', handleSchoolMapClick);
    _setDevCursor(false);
  }
  if (devSchoolMarker) {
    devSchoolMarker.remove();
    devSchoolMarker = null;
  }

  closeSchoolModal();
  _hideDevModeBar();
}

/**
 * Coloca (o mueve) el pin de la escuela
 */
function handleSchoolMapClick(e) {
  if (e.originalEvent && e.originalEvent.target !== mlMap.getCanvas()) return;

  devSchoolMarker = _placeDevPin(devSchoolMarker, e.lngLat, DEV_ICONS.escuela, coords => { devSchoolCoords = coords; });
  _showDevModeBar({ icon: DEV_ICONS.escuela, title: 'Nueva escuela', hint: 'Arrastra el pin para ajustar', actions: _DEV_CONTINUE });
}

/**
 * Muestra la hoja para completar los datos de la escuela
 */
function showSchoolModal() {
  if (!devSchoolCoords) return;
  _openDevSheet({
    id: 'dev-school-modal',
    icon: DEV_ICONS.escuela,
    title: 'Nueva escuela',
    sub: 'Zona de escalada',
    saveLabel: 'Guardar escuela',
    focusId: 'dev-school-name',
    onSave: saveSchool,
    body: `
      <div class="dev-form-group">
        <label for="dev-school-name">Nombre de la escuela</label>
        <input type="text" id="dev-school-name" placeholder="Ej.: Los Cahorros" maxlength="80" autocomplete="off" required>
      </div>
      <div class="dev-form-group">
        <label for="dev-school-desc">Descripción <span>opcional</span></label>
        <input type="text" id="dev-school-desc" placeholder="Ej.: Caliza, deportiva, orientación sur" maxlength="160" autocomplete="off">
      </div>`
  });
}

function closeSchoolModal() {
  _removeDevSheet('dev-school-modal');
}

/**
 * Guarda la escuela en Firestore
 */
async function saveSchool() {
  const name = document.getElementById('dev-school-name')?.value?.trim();
  if (!name) return _devFormError('dev-school-modal', 'Escribe el nombre de la escuela', 'dev-school-name');
  if (!devSchoolCoords) return _devFormError('dev-school-modal', 'Falta la ubicación: cierra y vuelve a tocar el mapa');

  try {
    const user = auth.currentUser;
    const descripcion = document.getElementById('dev-school-desc')?.value?.trim() || null;
    const initialStatus = await getInitialStatus();

    await db.collection('pending_schools').add({
      nombre: name,
      descripcion: descripcion,
      coordinates: devSchoolCoords,
      createdBy: user.uid,
      createdByEmail: user.email,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      status: initialStatus
    });

    deactivateSchoolMode();
    _devSavedToast('Escuela', initialStatus, 'pending_schools');

    // Las escuelas no tienen escucha en vivo: se vuelve a pedir la capa para que aparezca ya
    const reload = initialStatus === 'approved' ? 'loadApprovedSchoolsFromFirestore' : 'loadMyPendingSchoolsFromFirestore';
    if (typeof window[reload] === 'function') window[reload]();
  } catch (error) {
    console.error('[Spotter] Error guardando escuela:', error);
    _devFormError('dev-school-modal', 'No se pudo guardar: ' + error.message);
  }
}

// ============================================
// MODO SECTOR (LÍNEA DE LA PARED)
// ============================================

const DEV_SECTOR_MIN_POINTS = 2;
let _devSectorDblZoom = false;   // el doble toque hacía zoom antes de entrar en el modo

function _sectorBar() {
  const n = devSectorVertices.length;
  const hint = n === 0 ? 'Toca el mapa para trazar la línea de la pared'
    : n < DEV_SECTOR_MIN_POINTS ? '1 punto · añade al menos otro'
    : `${n} puntos · sigue o termina`;
  _showDevModeBar({
    icon: DEV_ICONS.sector,
    title: 'Nuevo sector',
    hint,
    actions: [
      { act: 'undo', label: 'Deshacer', icon: DEV_ICONS.undo, disabled: n === 0 },
      { act: 'finish', label: 'Terminar', icon: DEV_ICONS.check, primary: true, disabled: n < DEV_SECTOR_MIN_POINTS }
    ]
  });
}

// Escucha del dibujo: se quita mientras el formulario está abierto y vuelve si se cancela
function _sectorDrawListeners(on) {
  if (typeof mlMap === 'undefined' || !mlMap) return;
  mlMap.off('click', handleSectorMapClick);
  mlMap.off('dblclick', handleSectorMapDblClick);
  if (on) {
    mlMap.on('click', handleSectorMapClick);
    mlMap.on('dblclick', handleSectorMapDblClick);
  }
  _setDevCursor(on);
}

/**
 * Activa el modo de dibujo de sector. Necesita una escuela abierta.
 */
function activateSectorMode() {
  deactivateAllModes();
  if (typeof mlCurrentSchool === 'undefined' || !mlCurrentSchool) {
    showDevToast('Abre una escuela para añadir un sector\nSi la escuela no existe, créala primero', 'warning');
    return;
  }

  devSectorMode = true;
  devSectorVertices = [];
  _sectorBar();

  if (!mlMap) return;

  // El doble toque termina la línea: no debe hacer zoom mientras se dibuja
  _devSectorDblZoom = mlMap.doubleClickZoom.isEnabled();
  mlMap.doubleClickZoom.disable();
  _sectorDrawListeners(true);

  if (!mlMap.getSource(DEV_SECTOR_SOURCE)) {
    mlMap.addSource(DEV_SECTOR_SOURCE, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] }
    });

    // Línea coral con borde claro: se lee sobre roca, bosque y mapa topográfico
    mlMap.addLayer({
      id: DEV_SECTOR_CASING_LAYER,
      type: 'line',
      source: DEV_SECTOR_SOURCE,
      filter: ['==', '$type', 'LineString'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#F7F6F0', 'line-width': 6, 'line-opacity': 0.9 }
    });
    mlMap.addLayer({
      id: DEV_SECTOR_LINE_LAYER,
      type: 'line',
      source: DEV_SECTOR_SOURCE,
      filter: ['==', '$type', 'LineString'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#FF8D67', 'line-width': 3 }
    });
    mlMap.addLayer({
      id: DEV_SECTOR_VERTEX_LAYER,
      type: 'circle',
      source: DEV_SECTOR_SOURCE,
      filter: ['==', '$type', 'Point'],
      paint: {
        'circle-radius': 6,
        'circle-color': '#F7F6F0',
        'circle-stroke-color': '#153E35',
        'circle-stroke-width': 2
      }
    });
  }
}

/**
 * Desactiva el modo sector
 */
function deactivateSectorMode() {
  devSectorMode = false;
  devSectorVertices = [];

  if (typeof mlMap !== 'undefined' && mlMap) {
    _sectorDrawListeners(false);
    if (_devSectorDblZoom) mlMap.doubleClickZoom.enable();
    _devSectorDblZoom = false;

    [DEV_SECTOR_VERTEX_LAYER, DEV_SECTOR_LINE_LAYER, DEV_SECTOR_CASING_LAYER].forEach(id => {
      if (mlMap.getLayer(id)) mlMap.removeLayer(id);
    });
    if (mlMap.getSource(DEV_SECTOR_SOURCE)) mlMap.removeSource(DEV_SECTOR_SOURCE);
  }

  closeSectorModal();
  _hideDevModeBar();
}

/**
 * Añade un punto a la línea del sector
 */
function handleSectorMapClick(e) {
  if (e.originalEvent && e.originalEvent.target !== mlMap.getCanvas()) return;

  // Un doble toque llega como dos clics en el mismo sitio: el segundo no añade un punto repetido
  const last = devSectorVertices[devSectorVertices.length - 1];
  if (last) {
    const p = mlMap.project(last);
    if (Math.hypot(p.x - e.point.x, p.y - e.point.y) < 10) return;
  }

  devSectorVertices.push([e.lngLat.lng, e.lngLat.lat]);
  updateSectorDrawPreview();
  _sectorBar();
}

/**
 * Doble toque: termina la línea
 */
function handleSectorMapDblClick(e) {
  e.preventDefault();
  if (devSectorVertices.length < DEV_SECTOR_MIN_POINTS) {
    showDevToast('Marca al menos dos puntos de la pared', 'warning');
    return;
  }
  finishSectorDraw();
}

/**
 * Actualiza la línea y sus puntos en el mapa
 */
function updateSectorDrawPreview() {
  if (!mlMap || !mlMap.getSource(DEV_SECTOR_SOURCE)) return;

  const features = devSectorVertices.map((v, i) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: v },
    properties: { index: i }
  }));
  if (devSectorVertices.length >= 2) {
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: devSectorVertices },
      properties: {}
    });
  }

  mlMap.getSource(DEV_SECTOR_SOURCE).setData({ type: 'FeatureCollection', features });
}

/**
 * Da la línea por terminada y abre el formulario. Cancelarlo devuelve al dibujo, con los puntos intactos.
 */
function finishSectorDraw() {
  if (!devSectorMode || devSectorVertices.length < DEV_SECTOR_MIN_POINTS) return;
  _sectorDrawListeners(false);
  showSectorModal();
}

/**
 * Deshace el último punto dibujado
 */
function undoSectorVertex() {
  if (devSectorVertices.length > 0) {
    devSectorVertices.pop();
    updateSectorDrawPreview();
    _sectorBar();
  }
}

/**
 * Muestra la hoja con los datos del sector
 */
function showSectorModal() {
  _openDevSheet({
    id: 'dev-sector-modal',
    icon: DEV_ICONS.sector,
    title: 'Nuevo sector',
    sub: _devSchoolName(),
    saveLabel: 'Guardar sector',
    focusId: 'dev-sector-name',
    onSave: saveSector,
    onCancel: () => {
      // Vuelve al dibujo: se puede corregir la línea sin empezar de cero
      if (!devSectorMode) return;
      _sectorDrawListeners(true);
      _sectorBar();
    },
    body: `
      <div class="dev-form-group">
        <label for="dev-sector-name">Nombre del sector</label>
        <input type="text" id="dev-sector-name" placeholder="Ej.: Sector Norte" maxlength="80" autocomplete="off" required>
      </div>
      <div class="dev-form-row">
        <div class="dev-form-group">
          <label for="dev-sector-expo">Orientación <span>opcional</span></label>
          <select id="dev-sector-expo">
            <option value="">Sin especificar</option>
            <option value="Sol mañana">Sol de mañana</option>
            <option value="Sol tarde">Sol de tarde</option>
            <option value="Sol total">Sol todo el día</option>
            <option value="Sombra">Sombra</option>
          </select>
        </div>
        <div class="dev-form-group">
          <label for="dev-sector-restr">Restricción</label>
          <select id="dev-sector-restr" onchange="toggleSectorDates()">
            <option value="NO">Ninguna</option>
            <option value="SI">Por fechas</option>
          </select>
        </div>
      </div>
      <div class="dev-form-row" id="dev-sector-dates" hidden>
        <div class="dev-form-group">
          <label for="dev-sector-date-start">Desde (DD-MM)</label>
          <input type="text" id="dev-sector-date-start" placeholder="01-02" maxlength="5" inputmode="numeric" autocomplete="off">
        </div>
        <div class="dev-form-group">
          <label for="dev-sector-date-end">Hasta (DD-MM)</label>
          <input type="text" id="dev-sector-date-end" placeholder="30-06" maxlength="5" inputmode="numeric" autocomplete="off">
        </div>
      </div>`
  });
}

function closeSectorModal() {
  _removeDevSheet('dev-sector-modal');
}

/**
 * Muestra/oculta las fechas según la restricción
 */
function toggleSectorDates() {
  const restr = document.getElementById('dev-sector-restr')?.value;
  const dates = document.getElementById('dev-sector-dates');
  if (dates) dates.hidden = restr !== 'SI';
}

const _devValidDayMonth = value => {
  const m = /^(\d{2})-(\d{2})$/.exec(value || '');
  return !!m && +m[1] >= 1 && +m[1] <= 31 && +m[2] >= 1 && +m[2] <= 12;
};

/**
 * Guarda el sector en Firestore
 */
async function saveSector() {
  const name = document.getElementById('dev-sector-name')?.value?.trim();
  if (!name) return _devFormError('dev-sector-modal', 'Escribe el nombre del sector', 'dev-sector-name');
  if (devSectorVertices.length < DEV_SECTOR_MIN_POINTS) {
    return _devFormError('dev-sector-modal', 'La línea necesita al menos dos puntos: cierra y sigue dibujando');
  }

  const restr = document.getElementById('dev-sector-restr')?.value || 'NO';
  const expo = document.getElementById('dev-sector-expo')?.value || null;
  const dateStart = document.getElementById('dev-sector-date-start')?.value?.trim() || null;
  const dateEnd = document.getElementById('dev-sector-date-end')?.value?.trim() || null;
  if (restr === 'SI') {
    if (!_devValidDayMonth(dateStart)) return _devFormError('dev-sector-modal', 'Fecha de inicio con formato DD-MM (p. ej. 01-02)', 'dev-sector-date-start');
    if (!_devValidDayMonth(dateEnd)) return _devFormError('dev-sector-modal', 'Fecha de fin con formato DD-MM (p. ej. 30-06)', 'dev-sector-date-end');
  }

  try {
    const user = auth.currentUser;
    const schoolId = mlCurrentSchool || null;
    const initialStatus = await getInitialStatus();

    await db.collection('pending_sectors').add({
      nombre: name,
      restr: restr,
      exposicion: expo,
      Fecha_inicio: restr === 'SI' ? dateStart : null,
      Fecha_fin: restr === 'SI' ? dateEnd : null,
      geometryType: 'MultiLineString',
      // Vértices como objetos {lng, lat}: Firestore no admite arrays anidados
      vertices: devSectorVertices.map(v => ({ lng: v[0], lat: v[1] })),
      schoolId: schoolId,
      createdBy: user.uid,
      createdByEmail: user.email,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      status: initialStatus
    });

    deactivateSectorMode();
    _devSavedToast('Propuesta', initialStatus, 'pending_sectors');

    // Sector nuevo: seguro que no tiene foto, y sin foto no se pueden dibujar sus vías
    promptSectorPhoto(schoolId, name, null);
  } catch (error) {
    console.error('[Spotter] Error guardando sector:', error);
    _devFormError('dev-sector-modal', 'No se pudo guardar: ' + error.message);
  }
}

// ============================================
// FOTO DEL SECTOR — PROMPT AL SPOTTER
// ============================================

/**
 * Pregunta si se quiere añadir foto al sector.
 * @param {string} schoolId
 * @param {string} sectorName
 * @param {Function|null} onNo  Callback ejecutado si el usuario dice No
 */
function promptSectorPhoto(schoolId, sectorName, onNo) {
  const existing = document.getElementById('spotter-sector-photo-prompt');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'spotter-sector-photo-prompt';
  overlay.className = 'dev-route-modal-overlay dev-photo-prompt';
  overlay.innerHTML = `
    <div class="dev-route-modal" role="dialog" aria-modal="true" aria-labelledby="spotter-photo-title">
      <span class="dev-sheet-ico dev-sheet-ico--lg">${DEV_ICONS.camera}</span>
      <h3 id="spotter-photo-title">Este sector no tiene foto</h3>
      <p>Las vías se dibujan sobre la foto de la pared. ¿Añades una para <strong>${_devEsc(sectorName)}</strong>?</p>
      <div class="dev-route-modal-footer">
        <button type="button" class="dev-btn-cancel" id="spotter-photo-no">Ahora no</button>
        <button type="button" class="dev-btn-save" id="spotter-photo-yes">Añadir foto</button>
      </div>
    </div>`;

  document.body.appendChild(overlay);

  const decline = () => {
    overlay.remove();
    if (typeof onNo === 'function') onNo();
  };

  overlay.querySelector('#spotter-photo-yes').addEventListener('click', () => {
    overlay.remove();
    if (typeof window.showSectorUploadModal === 'function') {
      window.showSectorUploadModal(schoolId, encodeURIComponent(sectorName));
    }
  });
  overlay.querySelector('#spotter-photo-no').addEventListener('click', decline);
  overlay.addEventListener('click', e => { if (e.target === overlay) decline(); });
  overlay.addEventListener('keydown', e => { if (e.key === 'Escape') decline(); });
}

// ============================================
// UTILIDADES UI
// ============================================

/**
 * Muestra un aviso
 */
function showDevToast(message, type = 'info') {
  // Un único sistema de avisos para toda la app (showToast, en user-features.js)
  showToast(message, type);
}

// ============================================
// INICIALIZACIÓN
// ============================================

/**
 * Inicializa la herramienta Spotter
 */
let _devEditorInitialized = false;
async function initDevRouteEditor() {
  if (_devEditorInitialized) return;
  if (typeof auth === 'undefined' || typeof db === 'undefined') {
    setTimeout(initDevRouteEditor, 500);
    return;
  }
  _devEditorInitialized = true;
  console.log('[DevEditor] init iniciado');

  // Esperar a que Firebase Auth termine de restaurar la sesión.
  try {
    if (typeof waitForAuthReady === 'function') {
      await waitForAuthReady();
      console.log('[DevEditor] waitForAuthReady resuelto, currentUser:', auth.currentUser ? auth.currentUser.uid : 'null');
    }
  } catch (e) {
    console.warn('[DevEditor] waitForAuthReady falló:', e);
  }

  // Intento inmediato si ya hay usuario.
  _devEditorUid = auth.currentUser ? auth.currentUser.uid : null;
  if (auth.currentUser) {
    await addDevEditorButton({ retry: true });
  }

  // Listener permanente de cambios de auth (login/logout/cambio de usuario/restauración tardía).
  // Cada cambio desmonta lo del usuario anterior y vuelve a leer el rol real en Firestore.
  auth.onAuthStateChanged(async (user) => {
    const uid = user ? user.uid : null;
    console.log('[DevEditor] onAuthStateChanged:', uid);
    if (uid !== _devEditorUid) {
      _resetDevEditorSession();
      _devEditorUid = uid;
    }
    _devEditorRoleCache = { uid: null, ts: 0, hasAccess: false };
    if (user) {
      await addDevEditorButton({ retry: true });
    } else {
      _devEditorCheckSeq++;   // descarta cualquier comprobación que siguiera en curso
    }
  });

  // Si el mapa se reinicializa, reasignar listeners y restaurar el botón.
  window.addEventListener('maplibre:ready', async () => {
    if (typeof mlMap !== 'undefined' && mlMap) {
      ['zoom', 'zoomend', 'moveend'].forEach(ev => {
        mlMap.off(ev, updateDevButtonVisibility);
        mlMap.on(ev, updateDevButtonVisibility);
      });
    }
    if (auth.currentUser) {
      await addDevEditorButton();
    }
  });

  // Watchdog permanente: cada 5s comprueba que si hay usuario con acceso,
  // el botón existe en el DOM. Si no, lo recrea. Cubre cualquier flujo
  // raro (mapa reinicializado, error transitorio de Firestore, listener
  // de auth no disparado, etc.).
  setInterval(async () => {
    if (!auth.currentUser) return;
    if (document.getElementById('btn-dev-editor')) return;
    console.log('[DevEditor] Watchdog: botón ausente con usuario logueado, reintentando');
    await addDevEditorButton();
  }, 5000);
}

// Auto-inicializar cuando el DOM esté listo. No esperamos a mlMap porque
// addDevEditorButton solo necesita el div #map, y el listener maplibre:ready
// se encarga de los listeners de zoom cuando el mapa exista.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => initDevRouteEditor());
} else {
  initDevRouteEditor();
}

// Exponer funciones globalmente
window.toggleDevMode = toggleDevMode;
window.closeDevRouteModal = closeDevRouteModal;
window.saveDevRoute = saveDevRoute;
window.exportPendingRoutesAsGeoJSON = exportPendingRoutesAsGeoJSON;
window.loadPendingRoutesFromFirestore = loadPendingRoutesFromFirestore;

// Menú Spotter
window.toggleSpotterMenu = toggleSpotterMenu;
window.selectSpotterOption = selectSpotterOption;
window.togglePOIAccordion = togglePOIAccordion;
window.selectPOIType = selectPOIType;

// Modo POI
window.closePOIModal = closePOIModal;
window.savePOI = savePOI;

// Modo Escuela
window.closeSchoolModal = closeSchoolModal;
window.saveSchool = saveSchool;

// Modo Sector
window.closeSectorModal = closeSectorModal;
window.saveSector = saveSector;
window.undoSectorVertex = undoSectorVertex;
window.finishSectorDraw = finishSectorDraw;
window.toggleSectorDates = toggleSectorDates;

console.log('[Spotter] Modulo cargado');

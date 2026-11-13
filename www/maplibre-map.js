/**
 * MapLibre GL JS - Inicialización del Mapa
 *
 * Reemplaza Google Maps con MapLibre GL JS
 * Soporta: PNOA, Terreno 3D, GeoJSON, Popups
 */

// ============================================
// VARIABLES GLOBALES
// ============================================
let mlMap = null;                    // Instancia del mapa MapLibre
let mlCurrentSchool = null;          // Escuela actualmente cargada
let mlRoutePopup = null;             // Popup para rutas
let mlUserMarker = null;             // Marcador de ubicación del usuario
let mlLoadedSources = new Set();     // Sources cargados
let mlIs3DEnabled = false;           // Estado del terreno 3D
let mlFilterPanelOpen = false;        // Estado del panel de filtro
let mlGradeRangeMin = 0;              // Índice mínimo del rango de grado (0 = primer grado)
let mlGradeRangeMax = -1;             // Índice máximo del rango de grado (-1 = se inicializa al total)
let mlShowOnlyMyRoutes = false;       // Mostrar solo vías realizadas por el usuario
let mlShowOnlyProjects = false;       // Mostrar solo vías guardadas en proyectos

// ============================================
// VARIANT GROUPS STATE
// ============================================
let mlVariantGroups = new Map();       // groupKey → [{ props, coords }, ...]
let mlVariantFeatureIndex = new Map(); // featureId → groupKey (reverse lookup)
let mlCurrentVariantGroup = null;      // Array of variant data for active carousel
let mlCurrentVariantSlide = 0;         // Active slide index in carousel
let mlVariantSwipeStartX = 0;         // Touch swipe tracking
let mlVariantMarkers = [];            // HTML markers for concentric variant rings

// ============================================
// REALTIME LISTENERS (Firestore onSnapshot)
// ============================================
let mlApprovedRoutesUnsub = null;     // Unsubscriber para vías aprobadas
let mlApprovedPOIUnsub = null;        // Unsubscriber para POIs aprobados
let mlApprovedSectorsUnsub = null;    // Unsubscriber para sectores aprobados
let mlMyPendingRoutesUnsub = null;    // Unsubscriber para vías pendientes del usuario
let mlMyPendingPOIUnsub = null;       // Unsubscriber para POIs pendientes del usuario
let mlMyPendingSectorsUnsub = null;   // Unsubscriber para sectores pendientes del usuario
let mlUserViasInteractionAttached = false;
let mlUserPOIInteractionAttached = false;
let mlUserSectorsInteractionAttached = false;
let mlMyPendingViasInteractionAttached = false;
let mlMyPendingSectorsInteractionAttached = false;
let mlAdminPendingRoutesUnsub = null;
let mlAdminPendingPOIUnsub = null;
let mlAdminPendingSectorsUnsub = null;
let mlAdminPendingViasInteractionAttached = false;
let mlAdminPendingPOIInteractionAttached = false;
let mlAdminPendingSectorsInteractionAttached = false;

// Cache de escuelas pendientes del usuario (docId → {nombre, coordinates})
const mlPendingSchoolsCache = new Map();

// Edit state for admin drag-to-edit geometry
const mlEditState = { markers: [], docId: null, collection: null, type: null };

function mlClearApprovedListeners() {
  if (mlApprovedRoutesUnsub) { try { mlApprovedRoutesUnsub(); } catch (e) {} mlApprovedRoutesUnsub = null; }
  if (mlApprovedPOIUnsub) { try { mlApprovedPOIUnsub(); } catch (e) {} mlApprovedPOIUnsub = null; }
  if (mlApprovedSectorsUnsub) { try { mlApprovedSectorsUnsub(); } catch (e) {} mlApprovedSectorsUnsub = null; }
  if (mlMyPendingRoutesUnsub) { try { mlMyPendingRoutesUnsub(); } catch (e) {} mlMyPendingRoutesUnsub = null; }
  if (mlMyPendingPOIUnsub) { try { mlMyPendingPOIUnsub(); } catch (e) {} mlMyPendingPOIUnsub = null; }
  if (mlMyPendingSectorsUnsub) { try { mlMyPendingSectorsUnsub(); } catch (e) {} mlMyPendingSectorsUnsub = null; }
  if (mlAdminPendingRoutesUnsub) { try { mlAdminPendingRoutesUnsub(); } catch (e) {} mlAdminPendingRoutesUnsub = null; }
  if (mlAdminPendingPOIUnsub) { try { mlAdminPendingPOIUnsub(); } catch (e) {} mlAdminPendingPOIUnsub = null; }
  if (mlAdminPendingSectorsUnsub) { try { mlAdminPendingSectorsUnsub(); } catch (e) {} mlAdminPendingSectorsUnsub = null; }
}

// Cancels pending (user-specific) subscriptions and empties their map layers.
// Called on every session change so the previous user's data and admin tools are not left on the map.
function mlClearPendingItemsLayers() {
  // Edición por arrastre (solo admin) que estuviera en curso
  if (mlEditState.docId) mlCancelPendingEdit();
  [...mlPendingSchoolsCache.keys()].forEach(id => { if (!mlApprovedSchoolsCache.has(id)) mlPendingSchoolsCache.delete(id); });

  if (mlMyPendingRoutesUnsub) { try { mlMyPendingRoutesUnsub(); } catch (e) {} mlMyPendingRoutesUnsub = null; }
  if (mlMyPendingPOIUnsub) { try { mlMyPendingPOIUnsub(); } catch (e) {} mlMyPendingPOIUnsub = null; }
  if (mlMyPendingSectorsUnsub) { try { mlMyPendingSectorsUnsub(); } catch (e) {} mlMyPendingSectorsUnsub = null; }
  if (mlAdminPendingRoutesUnsub) { try { mlAdminPendingRoutesUnsub(); } catch (e) {} mlAdminPendingRoutesUnsub = null; }
  if (mlAdminPendingPOIUnsub) { try { mlAdminPendingPOIUnsub(); } catch (e) {} mlAdminPendingPOIUnsub = null; }
  if (mlAdminPendingSectorsUnsub) { try { mlAdminPendingSectorsUnsub(); } catch (e) {} mlAdminPendingSectorsUnsub = null; }

  if (!mlMap) return;
  const empty = { type: 'FeatureCollection', features: [] };
  ['pending-my-routes-source', 'pending-my-poi-source', 'pending-my-sectors-source',
   'admin-pending-routes-source', 'admin-pending-poi-source', 'admin-pending-sectors-source',
   'pending-my-schools-source', 'admin-pending-schools-source']
    .forEach(id => { try { if (mlMap.getSource(id)) mlMap.getSource(id).setData(empty); } catch (e) {} });
}

// ============================================
// PALETA DE COLORES PARA SECTORES
// ============================================
// 20 colores vibrantes y distinguibles para sectores
const SECTOR_COLORS = [
  '#7ED957',  // Verde lima
  '#9B7EDE',  // Violeta
  '#FF6B9D',  // Rosa
  '#FFD93D',  // Amarillo
  '#6BCFFF',  // Azul cielo
  '#FF9F43',  // Naranja
  '#54E346',  // Verde brillante
  '#FF6B6B',  // Rojo coral
  '#4ECDC4',  // Turquesa
  '#A8E6CF',  // Verde menta
  '#DDA0DD',  // Ciruela
  '#87CEEB',  // Azul claro
  '#F0E68C',  // Khaki
  '#FF7F50',  // Coral
  '#98D8C8',  // Verde agua
  '#F7DC6F',  // Amarillo suave
  '#BB8FCE',  // Púrpura claro
  '#85C1E9',  // Azul pastel
  '#F8B500',  // Dorado
  '#2ECC71'   // Esmeralda
];

/**
 * Convierte un color hex a componentes "r, g, b" (sin el rgba wrapper).
 * Útil para construir strings rgba() con opacidad variable.
 */
function hexToRgbComponents(hex) {
  const num = parseInt(hex.replace('#', ''), 16);
  return `${(num >> 16) & 0xFF}, ${(num >> 8) & 0xFF}, ${num & 0xFF}`;
}

/**
 * Oscurece un color hex para crear el casing
 */
function darkenColor(hex, amount = 0.4) {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.max(0, Math.floor((num >> 16) * (1 - amount)));
  const g = Math.max(0, Math.floor(((num >> 8) & 0x00FF) * (1 - amount)));
  const b = Math.max(0, Math.floor((num & 0x0000FF) * (1 - amount)));
  return `#${(r << 16 | g << 8 | b).toString(16).padStart(6, '0')}`;
}

/**
 * Genera expresión MapLibre para colores de sectores basada en FID
 */
function generateSectorColorExpression() {
  // Usamos el operador % para ciclar a través de los colores
  // ['%', ['get', 'fid'], 20] obtiene el índice del color
  const cases = [];
  for (let i = 0; i < SECTOR_COLORS.length; i++) {
    cases.push(['==', ['%', ['to-number', ['get', 'fid']], SECTOR_COLORS.length], i]);
    cases.push(SECTOR_COLORS[i]);
  }
  cases.push(SECTOR_COLORS[0]); // default
  return ['case', ...cases];
}

/**
 * Genera expresión MapLibre para colores de casing (oscurecidos)
 */
function generateSectorCasingColorExpression() {
  const cases = [];
  for (let i = 0; i < SECTOR_COLORS.length; i++) {
    cases.push(['==', ['%', ['to-number', ['get', 'fid']], SECTOR_COLORS.length], i]);
    cases.push(darkenColor(SECTOR_COLORS[i]));
  }
  cases.push(darkenColor(SECTOR_COLORS[0])); // default
  return ['case', ...cases];
}

// ============================================
// CARTOGRAFÍA 2D — ESTILO (Fase 2)
// ============================================
// Vista cenital plana: sectores como líneas verdes con borde claro, vías como círculos con el color de grado
// original (generateGradeColorExpression / getGradeColor, sin tocar), iconos planos y etiquetas en píldora.
// Todo con capas nativas de MapLibre; los estados (seleccionado, hover) van por feature-state, sin redibujar fuentes.
const KX_MAP = {
  forest: '#153E35',        // --kx-forest
  forestBright: '#2E9A63',  // verde luminoso del sector seleccionado (derivado de --kx-forest)
  sage: '#DCE9DF',          // --kx-sage
  halo: '#A8E3BF',          // halo del seleccionado
  chalk: '#F7F6F0',         // --kx-chalk
  granite: '#202923',       // --kx-granite
  coral: '#FF8D67',         // --kx-coral
  info: '#2F6FB3',          // --kx-info (parkings)
  access: '#F07A22',        // rutas de acceso
  shadow: 'rgba(16, 28, 23, 0.38)'
};

const _kxSel = ['boolean', ['feature-state', 'selected'], false];

// Radio de las vías (px) por zoom. Lo comparten la capa de vías, la sombra, los ticks y los anillos de variantes.
const KX_ROUTE_RADIUS = {
  mobile:  [[14, 2],   [16, 3.5], [17, 4.5], [18, 6], [19, 7.5], [20, 9]],
  desktop: [[14, 3],   [16, 5],   [17, 6],   [18, 8], [19, 10],  [20, 13]]
};
const KX_ROUTE_STROKE = 1.5;

function kxRouteRadiusStops() {
  return KX_ROUTE_RADIUS[isMobileDevice() ? 'mobile' : 'desktop'];
}

function kxZoomExpr(stops, map = v => v) {
  const expr = ['interpolate', ['linear'], ['zoom']];
  stops.forEach(([z, v]) => expr.push(z, map(v)));
  return expr;
}

// Círculo plano de vía: color de grado original + borde blanco fino
function kxRoutePaint(strokeColor = '#ffffff') {
  return {
    'circle-radius': kxZoomExpr(kxRouteRadiusStops()),
    'circle-color': generateGradeColorExpression('grado1'),
    'circle-stroke-color': strokeColor,
    'circle-stroke-width': KX_ROUTE_STROKE,
    'circle-opacity': 1
  };
}

// Sombra de contacto (sin desplazamiento, no simula altura): separa el borde blanco de la roca clara
function kxRouteShadowPaint() {
  return {
    'circle-radius': kxZoomExpr(kxRouteRadiusStops(), r => r + KX_ROUTE_STROKE + 1.2),
    'circle-color': KX_MAP.shadow,
    'circle-blur': 0.45,
    'circle-opacity': 0.9
  };
}

// Sector: doble trazo. Debajo, un borde blanco (7–8 px); encima, la línea mate del color propio del sector
// (3,5–4 px). El seleccionado engorda ambos trazos y conserva su color. Sin sombras, halos ni animación.
// Colores más vivos que pastel, sin llegar a fluorescentes; asignados de forma estable por sector
// (ver kxAssignSectorColors).
const KX_SECTOR_PALETTE = [
  '#579C68',  // verde
  '#299F98',  // turquesa
  '#438FC5',  // azul
  '#9273B8',  // morado
  '#D98942',  // naranja
  '#CC716E'   // coral
];

// Área táctil invisible alrededor de cada sector (px). Es una capa aparte: el trazo visible no se engorda.
const KX_SECTOR_HIT_WIDTH = 24;

function kxSectorHash(name) {
  // FNV-1a de 32 bits: estable entre sesiones y dispositivos
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) { h ^= name.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

/**
 * Asigna a cada sector un índice de color (properties.kxc) a partir de su nombre. Mismo nombre → mismo color,
 * siempre. Si dos sectores vecinos (cajas envolventes a menos de ~40 m) coinciden, el segundo, por orden de
 * nombre, pasa al siguiente color libre de la paleta. Solo añade una propiedad en memoria: no toca geometrías,
 * identificadores ni datos guardados.
 */
function kxAssignSectorColors(features) {
  const n = KX_SECTOR_PALETTE.length;
  const PAD = 0.0004;
  const boxes = features.map(f => {
    const g = f.geometry;
    const lines = !g ? [] : g.type === 'MultiLineString' ? g.coordinates : g.type === 'LineString' ? [g.coordinates] : [];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    lines.forEach(l => l.forEach(([x, y]) => { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }));
    return { x0: x0 - PAD, y0: y0 - PAD, x1: x1 + PAD, y1: y1 + PAD };
  });
  const near = (a, b) => a.x0 <= b.x1 && a.x1 >= b.x0 && a.y0 <= b.y1 && a.y1 >= b.y0;
  const nameOf = (f, i) => String((f.properties && (f.properties.nombre || f.properties.name)) || `sector-${i}`);
  const order = features.map((_, i) => i).sort((a, b) => {
    const na = nameOf(features[a], a), nb = nameOf(features[b], b);
    return na < nb ? -1 : na > nb ? 1 : a - b;
  });
  const assigned = new Map();
  for (const i of order) {
    const pref = kxSectorHash(nameOf(features[i], i)) % n;
    const used = new Set();
    for (const [j, c] of assigned) if (near(boxes[i], boxes[j])) used.add(c);
    let pick = pref;
    for (let k = 0; k < n; k++) { const c = (pref + k) % n; if (!used.has(c)) { pick = c; break; } }
    assigned.set(i, pick);
    features[i].properties = features[i].properties || {};
    features[i].properties.kxc = pick;
  }
  return features;
}

// Color del sector: el índice asignado (kxc) o, si la fuente no lo trae (teselas vectoriales), un reparto estable por fid
function kxSectorColorExpr() {
  const idx = ['coalesce', ['to-number', ['get', 'kxc'], -1], ['%', ['to-number', ['get', 'fid'], 0], KX_SECTOR_PALETTE.length]];
  const expr = ['match', idx];
  KX_SECTOR_PALETTE.forEach((c, i) => expr.push(i, c));
  expr.push(KX_SECTOR_PALETTE[0]);
  return expr;
}

function kxSectorLinePaint() {
  return {
    'line-color': kxSectorColorExpr(),
    'line-width': ['interpolate', ['linear'], ['zoom'],
      12, ['case', _kxSel, 4.5, 2.5],
      14, ['case', _kxSel, 5, 3],
      16, ['case', _kxSel, 5.25, 3.75],
      18, ['case', _kxSel, 5.5, 4],
      20, ['case', _kxSel, 6, 4.5]],
    'line-opacity': ['interpolate', ['linear'], ['zoom'], 12, 0.7, 13, 1],
    'line-width-transition': { duration: 200 }
  };
}

// En 3D las líneas van pegadas al relieve y en las paredes se estiran: con el borde blanco ancho de la vista
// plana se ve deshilachado, así que ahí se deja en un filo fino alrededor de la línea
function kxSectorCasingWidth() {
  const stops = is3DMode
    ? [12, 6, 4, 14, 6.5, 4.5, 16, 7, 5.25, 18, 7.25, 5.5, 20, 7.75, 6]
    : [12, 7.5, 5.5, 14, 8.5, 6.5, 16, 9, 7.5, 18, 9.5, 8, 20, 10.5, 9];
  const expr = ['interpolate', ['linear'], ['zoom']];
  for (let i = 0; i < stops.length; i += 3) expr.push(stops[i], ['case', _kxSel, stops[i + 1], stops[i + 2]]);
  return expr;
}

const KX_SECTOR_CASING_LAYERS = ['sectores-casing-layer', 'sectores-usuarios-casing-layer'];
function kxApplySectorCasing3D() {
  KX_SECTOR_CASING_LAYERS.forEach(id => {
    if (mlMap && mlMap.getLayer(id)) mlMap.setPaintProperty(id, 'line-width', kxSectorCasingWidth());
  });
}

function kxSectorCasingPaint() {
  return {
    'line-color': '#FFFFFF',
    'line-width': kxSectorCasingWidth(),
    'line-opacity': ['interpolate', ['linear'], ['zoom'],
      12, ['case', _kxSel, 0.8, 0.6],
      13, ['case', _kxSel, 1, 0.95]],
    'line-width-transition': { duration: 200 }
  };
}

// Capa interactiva: misma fuente y geometría que el sector, invisible (opacidad 0) y ancha. Solo sirve para
// detectar toques; el dibujo lo hacen las dos capas visibles.
function kxSectorHitPaint() {
  return { 'line-color': '#000000', 'line-opacity': 0, 'line-width': KX_SECTOR_HIT_WIDTH };
}

function kxAddSectorHitLayer(sourceId, layerId, minzoom, sourceLayer) {
  if (!mlMap || mlMap.getLayer(layerId) || !mlMap.getSource(sourceId)) return;
  const layer = {
    id: layerId,
    type: 'line',
    source: sourceId,
    minzoom,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: kxSectorHitPaint()
  };
  if (sourceLayer) layer['source-layer'] = sourceLayer;
  // Por debajo de las vías: su círculo siempre recibe el toque antes que la línea del sector
  const before = mlMap.getLayer('vias-shadow-layer') ? 'vias-shadow-layer' : (mlMap.getLayer('vias-layer') ? 'vias-layer' : undefined);
  mlMap.addLayer(layer, before);
  kxBindSectorEvents(layerId);
}

// ---- Etiquetas de sector al lateral de la línea, en el lado contrario a las vías ----
// Cada sector tiene un punto de etiqueta en la mitad de su trazado (fuente de puntos propia, ligera: uno por sector).
// La píldora se ancla a ese punto hacia el lado de la línea con menos vías cerca, así nombre y vías no se pisan.
const KX_LINE_SOURCE_OF = { 'sectores-labels-source': 'sectores-source', 'sectores-usuarios-labels-source': 'sectores-usuarios-source' };
const KX_LABEL_NEAR_M = [35, 90];   // radios (m) en los que se cuentan las vías a cada lado, de cerca a lejos
const _kxLabelPoints = new Map();   // fuente de línea → sectores con sus candidatos de etiqueta

function kxRoutePoints() {
  const pts = [];
  const add = g => {
    if (!g) return;
    if (g.type === 'Point') pts.push(g.coordinates);
    else if (g.type === 'MultiPoint') g.coordinates.forEach(c => pts.push(c));
  };
  ['vias-source', 'vias-usuarios-source'].forEach(id => {
    const src = mlMap.getSource(id);
    const data = src && src.serialize && src.serialize().data;
    if (data && data.features) data.features.forEach(f => add(f.geometry));
  });
  // Las variantes se quitan de vias-source y se pintan como anillos: también cuentan
  for (const group of mlVariantGroups.values()) group.forEach(gf => { if (gf.coords) pts.push(gf.coords); });
  return pts;
}


// Las etiquetas de sector son pequeñas píldoras HTML (una por sector, solo los de la escuela abierta): así usan la
// tipografía de la app y el color propio de su sector, y se ven igual en reposo que seleccionadas.
const KX_LABEL_MIN_ZOOM = 17;        // por defecto, si la escuela no define zoomLevels.sectorNames
const KX_LABEL_GAP = 6;              // px entre el borde blanco de la línea y la píldora
const KX_LABEL_PAD = 4;              // aire mínimo frente a vías, líneas y otras etiquetas
const KX_LABEL_FRACTIONS = [0.5, 0.35, 0.65, 0.2, 0.8];   // puntos del trazado donde se prueba la etiqueta
const KX_LABEL_BUDGET_ZOOM = 18;     // por debajo de este zoom se limita el número de etiquetas…
const KX_LABEL_BUDGET = 8;           // …a las de los sectores con más vías
const _kxLabelMarkers = new Map();   // fuente de línea → [{ marker, el, pill, id, cands, prio, lines, last, size }]
let _kxLabelRoutes = [];             // vías y variantes de la escuela (lng, lat), para no taparlas

/**
 * Puntos candidatos para la etiqueta de un sector: varios puntos del trazado (mitad, tercios, extremos suaves),
 * cada uno con la dirección perpendicular hacia la que se coloca (primero el lado con menos vías).
 * lines: [[lng, lat], ...][]; routes: [lng, lat][]. Devuelve [{ point: [lng, lat], dir: [este, norte] }].
 */
function kxSectorLabelCandidates(lines, routes) {
  const longest = lines.filter(l => l && l.length >= 2).sort((a, b) => b.length - a.length)[0];
  if (!longest) return [];
  const lat0 = longest[0][1] * Math.PI / 180;
  const kx = 111320 * Math.cos(lat0), ky = 110540;
  const P = longest.map(([x, y]) => [x * kx, y * ky]);
  const seg = [];
  let total = 0;
  for (let i = 1; i < P.length; i++) { const d = Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]); seg.push(d); total += d; }
  if (!total) return [];
  const out = [];
  for (const frac of KX_LABEL_FRACTIONS) {
    let acc = 0, k = 0;
    while (k < seg.length - 1 && acc + seg[k] < total * frac) { acc += seg[k]; k++; }
    const t = seg[k] ? (total * frac - acc) / seg[k] : 0;
    const M = [P[k][0] + (P[k + 1][0] - P[k][0]) * t, P[k][1] + (P[k + 1][1] - P[k][1]) * t];
    const len = seg[k] || 1;
    const n = [-(P[k + 1][1] - P[k][1]) / len, (P[k + 1][0] - P[k][0]) / len];
    let side = 0;
    for (const R of KX_LABEL_NEAR_M) {
      let left = 0, right = 0;
      for (const [rx, ry] of routes) {
        const dx = rx * kx - M[0], dy = ry * ky - M[1];
        if (dx * dx + dy * dy > R * R) continue;
        if (dx * n[0] + dy * n[1] >= 0) left++; else right++;
      }
      if (left !== right) { side = left < right ? 1 : -1; break; }
    }
    if (!side) side = n[1] >= 0 ? 1 : -1;
    const point = [M[0] / kx, M[1] / ky];
    out.push({ point, dir: [n[0] * side, n[1] * side] }, { point, dir: [-n[0] * side, -n[1] * side] });
  }
  return out;
}

// ---- Geometría en pantalla (puras, sin mapa) ----
function kxRectsOverlap(a, b, pad = 0) {
  return a.left < b.right + pad && a.right > b.left - pad && a.top < b.bottom + pad && a.bottom > b.top - pad;
}

function kxRectHitsCircle(r, cx, cy, radius) {
  const x = Math.max(r.left, Math.min(cx, r.right)), y = Math.max(r.top, Math.min(cy, r.bottom));
  return (cx - x) * (cx - x) + (cy - y) * (cy - y) <= radius * radius;
}

// ¿El segmento a–b cruza el rectángulo (ampliado en pad)? Recorte de Liang–Barsky.
function kxRectHitsSegment(r, ax, ay, bx, by, pad = 0) {
  const x0 = r.left - pad, x1 = r.right + pad, y0 = r.top - pad, y1 = r.bottom + pad;
  const dx = bx - ax, dy = by - ay;
  let t0 = 0, t1 = 1;
  const clip = (p, q) => {
    if (p === 0) return q >= 0;
    const t = q / p;
    if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
    else { if (t < t0) return false; if (t < t1) t1 = t; }
    return true;
  };
  return clip(-dx, ax - x0) && clip(dx, x1 - ax) && clip(-dy, ay - y0) && clip(dy, y1 - ay) && t0 <= t1;
}

/**
 * Elige el primer hueco libre para una etiqueta. cands: [{ at: [x, y], dir: [dx, dy] }] en pantalla (dir unitario,
 * y hacia abajo); size: { w, h }; ctx: { lineHalf, bounds, excl[], placed[], circles[[x, y, r]], segments[[ax, ay, bx, by]] }.
 * Prueba primero el índice `first` (la posición anterior, para que no salte). Devuelve { index, rect } o null.
 */
function kxChooseLabelSpot(cands, size, ctx, first = -1) {
  const order = cands.map((_, i) => i);
  if (first >= 0 && first < cands.length) { order.splice(first, 1); order.unshift(first); }
  for (const i of order) {
    const { at, dir } = cands[i];
    const ext = Math.abs(dir[0]) * size.w / 2 + Math.abs(dir[1]) * size.h / 2;
    const d = ctx.lineHalf + KX_LABEL_GAP + ext;
    const cx = at[0] + dir[0] * d, cy = at[1] + dir[1] * d;
    const rect = { left: cx - size.w / 2, top: cy - size.h / 2, right: cx + size.w / 2, bottom: cy + size.h / 2 };
    const b = ctx.bounds;
    if (rect.left < b.left || rect.top < b.top || rect.right > b.right || rect.bottom > b.bottom) continue;
    if ((ctx.excl || []).some(e => kxRectsOverlap(rect, e))) continue;
    if ((ctx.placed || []).some(p => kxRectsOverlap(rect, p, KX_LABEL_PAD))) continue;
    if ((ctx.circles || []).some(([x, y, rad]) => kxRectHitsCircle(rect, x, y, rad + KX_LABEL_PAD))) continue;
    if ((ctx.segments || []).some(([ax, ay, bx, by]) => kxRectHitsSegment(rect, ax, ay, bx, by, ctx.lineHalf + 1))) continue;
    return { index: i, rect };
  }
  return null;
}

/**
 * (Re)calcula los candidatos de etiqueta de una fuente de sectores y pinta sus píldoras (una por sector).
 * Se llama al terminar de cargar la escuela (cuando ya están las vías) y en cada actualización de sectores de usuarios.
 */
function kxRefreshSectorLabels(lineSourceId) {
  const src = mlMap && mlMap.getSource(lineSourceId);
  const data = src && src.serialize && src.serialize().data;
  if (!data || !data.features) return;
  _kxLabelRoutes = kxRoutePoints();
  // Relevancia: número de vías del sector (para decidir qué nombres se ven cuando falta sitio)
  const routeCount = new Map();
  ['vias-source', 'vias-usuarios-source'].forEach(id => {
    const s2 = mlMap.getSource(id);
    const d2 = s2 && s2.serialize && s2.serialize().data;
    (d2 && d2.features || []).forEach(f => {
      const k = String(f.properties && f.properties.sector || '').trim().toLowerCase();
      if (k) routeCount.set(k, (routeCount.get(k) || 0) + 1);
    });
  });
  const items = [];
  data.features.forEach((f, i) => {
    const g = f.geometry;
    const lines = !g ? [] : g.type === 'MultiLineString' ? g.coordinates : g.type === 'LineString' ? [g.coordinates] : [];
    const cands = kxSectorLabelCandidates(lines, _kxLabelRoutes);
    if (!cands.length || !f.properties.nombre) return;
    items.push({ id: i, props: f.properties, lines, cands,
      prio: routeCount.get(String(f.properties.nombre).trim().toLowerCase()) || 0 });
  });
  _kxLabelPoints.set(lineSourceId, items);
  kxRenderSectorLabels(lineSourceId);
  kxEnsureLabelSync();
}

function kxRemoveSectorLabels(lineSourceId) {
  const ids = lineSourceId ? [lineSourceId] : [..._kxLabelMarkers.keys()];
  ids.forEach(id => {
    (_kxLabelMarkers.get(id) || []).forEach(m => m.marker.remove());
    _kxLabelMarkers.delete(id);
  });
}

// Crea las píldoras una sola vez; después solo se recolocan (sin volver a crearlas: así no parpadean)
function kxRenderSectorLabels(lineSourceId) {
  kxRemoveSectorLabels(lineSourceId);
  const list = [];
  for (const it of _kxLabelPoints.get(lineSourceId) || []) {
    const name = it.props.nombre;
    const root = document.createElement('div');
    root.className = 'kx-label-marker';
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'kx-map-label is-hidden';
    pill.setAttribute('aria-label', `Sector ${name}`);
    pill.title = name;
    pill.style.setProperty('--kx-sector', kxSectorColorOf({ properties: it.props }));
    const txt = document.createElement('span');
    txt.className = 'kx-map-label__txt';
    txt.textContent = name;
    pill.appendChild(txt);
    root.appendChild(pill);
    const m = { id: it.id, source: lineSourceId, root, el: pill, cands: it.cands, lines: it.lines, prio: it.prio, last: -1, size: null };
    pill.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (mlMap.getCanvas().style.cursor === 'crosshair') return;
      const line = { source: lineSourceId, id: it.id, properties: kxLineFeatureProps(lineSourceId, it.id) || it.props };
      const at = m.marker.getLngLat();
      kxSelectSector(line, { lng: at.lng, lat: at.lat });
      kxOpenSectorFeature(line, at);
    });
    m.marker = new maplibregl.Marker({ element: root, anchor: 'center', opacityWhenCovered: '1' })
      .setLngLat(it.cands[0].point)
      .addTo(mlMap);
    if (kxSelectedSector && kxSelectedSector.source === lineSourceId && kxSelectedSector.id === it.id) pill.classList.add('is-selected');
    list.push(m);
  }
  _kxLabelMarkers.set(lineSourceId, list);
  kxPlaceSectorLabels();
}

function kxLabelSize(m) {
  const sel = m.el.classList.contains('is-selected');
  if (!m.size || m.size.sel !== sel) m.size = { w: m.el.offsetWidth, h: m.el.offsetHeight, sel };
  return m.size;
}

/**
 * Coloca todas las etiquetas visibles en el hueco libre más cercano a su sector, sin tapar vías, variantes, líneas
 * de sector ni otras etiquetas, ni quedar bajo el buscador, la barra inferior o los botones. Si no hay hueco, se
 * oculta (salvo la del sector seleccionado). Solo se ejecuta al terminar un movimiento, zoom o giro.
 */
function kxPlaceSectorLabels() {
  if (!mlMap) return;
  const all = [..._kxLabelMarkers.values()].flat();
  if (!all.length) return;
  const school = mlCurrentSchool ? MAPLIBRE_SCHOOLS[mlCurrentSchool] : null;
  const minZoom = (school && school.zoomLevels && school.zoomLevels.sectorNames) || KX_LABEL_MIN_ZOOM;
  const zoom = mlMap.getZoom();
  const canvas = mlMap.getCanvas();
  const W = canvas.clientWidth, H = canvas.clientHeight;
  const bounds = { left: 6, top: 64, right: W - 6, bottom: H - 130 };   // sin bajar a escala, atribución ni barra inferior
  const excl = [{ left: W - 64, top: H - 400, right: W, bottom: H }];   // columna de controles
  const view = { left: -60, top: -60, right: W + 60, bottom: H + 60 };

  // Obstáculos en pantalla
  const routeR = mlGetViasRadius() + KX_ROUTE_STROKE + 1;
  const circles = [];
  if (zoom >= ((school && school.zoomLevels && school.zoomLevels.vias) || 17) - 0.5) {
    for (const c of _kxLabelRoutes) {
      const p = mlMap.project(c);
      if (p.x > view.left && p.x < view.right && p.y > view.top && p.y < view.bottom) circles.push([p.x, p.y, routeR]);
    }
  }
  const segments = [];
  const onScreen = new Map();
  for (const m of all) {
    let visible = false;
    for (const l of m.lines) {
      let prev = null;
      for (const c of l) {
        const p = mlMap.project(c);
        if (prev) {
          segments.push([prev.x, prev.y, p.x, p.y]);
          if (!visible && kxRectHitsSegment({ left: 0, top: 0, right: W, bottom: H }, prev.x, prev.y, p.x, p.y)) visible = true;
        }
        prev = p;
      }
    }
    onScreen.set(m, visible);
  }
  const lineHalf = 4.5;   // medio borde blanco del sector

  const selected = all.filter(m => m.el.classList.contains('is-selected'));
  const rest = all.filter(m => !m.el.classList.contains('is-selected')).sort((a, b) => b.prio - a.prio || a.id - b.id);
  const zoomOk = zoom >= minZoom;
  const budget = zoom < KX_LABEL_BUDGET_ZOOM ? KX_LABEL_BUDGET : Infinity;
  const placed = [];
  let shown = 0;
  let selRect = null;

  for (const m of selected.concat(rest)) {
    const isSel = m.el.classList.contains('is-selected');
    m.el.classList.remove('is-dimmed');
    if ((!isSel && (!zoomOk || shown >= budget)) || !onScreen.get(m)) { m.el.classList.add('is-hidden'); continue; }
    const size = kxLabelSize(m);
    const cands = m.cands.map(c => {
      const at = mlMap.project(c.point);
      const lat = c.point[1] * Math.PI / 180;
      const q = mlMap.project([c.point[0] + c.dir[0] * 5 / (111320 * Math.cos(lat)), c.point[1] + c.dir[1] * 5 / 110540]);
      const dx = q.x - at.x, dy = q.y - at.y, len = Math.hypot(dx, dy) || 1;
      return { at: [at.x, at.y], dir: [dx / len, dy / len] };
    });
    let spot = kxChooseLabelSpot(cands, size, { lineHalf, bounds, excl, placed, circles, segments }, m.last);
    // La del seleccionado se ve siempre: si no hay hueco, en su primera posición
    if (!spot && isSel) spot = kxChooseLabelSpot(cands, size, { lineHalf, bounds: view }, m.last >= 0 ? m.last : 0);
    if (!spot) { m.el.classList.add('is-hidden'); continue; }
    m.last = spot.index;
    const at = cands[spot.index].at;
    const cx = (spot.rect.left + spot.rect.right) / 2, cy = (spot.rect.top + spot.rect.bottom) / 2;
    m.marker.setLngLat(m.cands[spot.index].point).setOffset([cx - at[0], cy - at[1]]);
    m.el.classList.remove('is-hidden');
    placed.push(spot.rect);
    if (isSel) selRect = spot.rect;
    else shown++;
  }
  // Con un sector seleccionado, las etiquetas que tiene muy cerca pierden protagonismo
  if (selRect) {
    for (const m of rest) {
      if (m.el.classList.contains('is-hidden')) continue;
      const r = m.el.getBoundingClientRect();
      const c = canvas.getBoundingClientRect();
      const rr = { left: r.left - c.left, top: r.top - c.top, right: r.right - c.left, bottom: r.bottom - c.top };
      if (kxRectsOverlap(rr, selRect, 60)) m.el.classList.add('is-dimmed');
    }
  }
}

// Al hacer zoom solo se aplica el umbral (barato); la colocación completa, al terminar cada movimiento, zoom o giro
let _kxLabelSyncBound = false;
function kxEnsureLabelSync() {
  if (_kxLabelSyncBound || !mlMap) return;
  _kxLabelSyncBound = true;
  mlMap.on('zoom', () => {
    const school = mlCurrentSchool ? MAPLIBRE_SCHOOLS[mlCurrentSchool] : null;
    const minZoom = (school && school.zoomLevels && school.zoomLevels.sectorNames) || KX_LABEL_MIN_ZOOM;
    if (mlMap.getZoom() >= minZoom) return;
    for (const m of [..._kxLabelMarkers.values()].flat()) {
      if (!m.el.classList.contains('is-selected')) m.el.classList.add('is-hidden');
    }
  });
  mlMap.on('moveend', kxPlaceSectorLabels);
}

function kxLabelMarkerFor(lineSourceId, id) {
  const list = _kxLabelMarkers.get(lineSourceId);
  return list ? list.find(m => m.id === id) : null;
}

// Etiqueta de sector: píldora a lo largo de la línea, horizontal, sin solaparse (colisión nativa).
// Solo para teselas vectoriales (sin datos en memoria para calcular el lateral).
function kxAddSectorLabels(sourceId, layerId, minzoom, sourceLayer) {
  if (!mlMap || mlMap.getLayer(layerId) || !mlMap.getSource(sourceId)) return;
  kxEnsureLabelPill();
  const layer = {
    id: layerId,
    type: 'symbol',
    source: sourceId,
    minzoom,
    layout: {
      ...kxLabelLayout(['interpolate', ['linear'], ['zoom'], 16, 11, 19, 12.5]),
      'symbol-placement': 'line-center',
      'text-rotation-alignment': 'viewport',
      'icon-rotation-alignment': 'viewport',
      'text-pitch-alignment': 'viewport',
      'text-keep-upright': true
    },
    // El sector seleccionado ya lleva su etiqueta flotante: se oculta la del mapa para no duplicarla
    paint: { ...kxLabelPaint(), 'text-opacity': ['case', _kxSel, 0, 1], 'icon-opacity': ['case', _kxSel, 0, 1] }
  };
  if (sourceLayer) layer['source-layer'] = sourceLayer;
  // Por debajo de las vías: el nombre nunca tapa un punto
  const before = mlMap.getLayer('vias-shadow-layer') ? 'vias-shadow-layer' : (mlMap.getLayer('vias-layer') ? 'vias-layer' : undefined);
  mlMap.addLayer(layer, before);
  kxBindSectorEvents(layerId);
}

function kxLabelLayout(size) {
  return {
    'text-field': ['get', 'nombre'],
    'text-font': ['Noto Sans Bold'],
    'text-size': size,
    'text-max-width': 12,
    'text-padding': 4,
    'icon-image': 'kx-label-pill',
    'icon-text-fit': 'both',
    'icon-text-fit-padding': [3, 9, 3, 14],
    'icon-allow-overlap': false,
    'text-allow-overlap': false,
    'text-optional': false
  };
}

function kxLabelPaint() {
  return { 'text-color': KX_MAP.granite, 'icon-opacity': 1, 'text-opacity': 1 };
}

// Fondo de etiqueta: blanco cálido translúcido, borde finísimo, sombra suave y punto verde a la izquierda.
// Imagen estirable (stretchX/Y) para que MapLibre la ajuste al texto con icon-text-fit.
function kxEnsureLabelPill(id = 'kx-label-pill', withDot = true) {
  if (!mlMap || mlMap.hasImage(id)) return;
  const d = _mlDPR, W = 46, H = 30, m = 3;
  const c = document.createElement('canvas');
  c.width = W * d; c.height = H * d;
  const ctx = c.getContext('2d');
  ctx.scale(d, d);
  const r = (H - 2 * m) / 2;
  const pill = () => {
    ctx.beginPath();
    ctx.moveTo(m + r, m); ctx.lineTo(W - m - r, m);
    ctx.arc(W - m - r, H / 2, r, -Math.PI / 2, Math.PI / 2);
    ctx.lineTo(m + r, H - m);
    ctx.arc(m + r, H / 2, r, Math.PI / 2, -Math.PI / 2);
    ctx.closePath();
  };
  ctx.shadowColor = withDot ? 'rgba(32, 41, 35, 0.22)' : 'rgba(32, 41, 35, 0.14)'; ctx.shadowBlur = withDot ? 3 : 2; ctx.shadowOffsetY = 1;
  pill(); ctx.fillStyle = 'rgba(247, 246, 240, 0.95)'; ctx.fill();
  ctx.shadowColor = 'transparent';
  pill(); ctx.strokeStyle = 'rgba(32, 41, 35, 0.10)'; ctx.lineWidth = 1; ctx.stroke();
  if (withDot) { ctx.beginPath(); ctx.arc(m + 11, H / 2, 3, 0, Math.PI * 2); ctx.fillStyle = KX_MAP.forestBright; ctx.fill(); }
  const img = ctx.getImageData(0, 0, c.width, c.height);
  mlMap.addImage(id, { width: c.width, height: c.height, data: new Uint8Array(img.data.buffer) }, {
    pixelRatio: d,
    stretchX: withDot ? [[22 * d, 30 * d]] : [[16 * d, 30 * d]],
    stretchY: [[14 * d, 16 * d]],
    content: withDot ? [20 * d, 7 * d, 36 * d, 23 * d] : [14 * d, 7 * d, 32 * d, 23 * d]
  });
}

// SVG → imagen nítida (a la densidad real de la pantalla) para iconos de capas symbol
function kxLoadSVGImage(imageId, svgString, cssWidth, cssHeight = cssWidth) {
  return new Promise(resolve => {
    if (!mlMap || mlMap.hasImage(imageId)) { resolve(); return; }
    const pw = Math.round(cssWidth * _mlDPR), ph = Math.round(cssHeight * _mlDPR);
    const img = new Image(pw, ph);
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = pw; c.height = ph;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0, pw, ph);
        const data = ctx.getImageData(0, 0, pw, ph);
        if (!mlMap.hasImage(imageId)) mlMap.addImage(imageId, { width: pw, height: ph, data: new Uint8Array(data.data.buffer) }, { pixelRatio: _mlDPR });
      } catch (e) { console.warn('Icono no disponible:', imageId, e); }
      resolve();
    };
    img.onerror = () => { console.warn('Error cargando icono:', imageId); resolve(); };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgString);
  });
}

// Sombra de contacto bajo las vías: misma fuente y mismo filtro que vias-layer (applyGradeFilter la sincroniza)
function kxAddRouteShadow(sourceId, minzoom, sourceLayer) {
  if (!mlMap || !mlMap.getLayer('vias-layer') || mlMap.getLayer('vias-shadow-layer')) return;
  const layer = { id: 'vias-shadow-layer', type: 'circle', source: sourceId, minzoom, paint: kxRouteShadowPaint() };
  if (sourceLayer) layer['source-layer'] = sourceLayer;
  mlMap.addLayer(layer, 'vias-layer');
  const f = mlMap.getFilter('vias-layer');
  if (f) mlMap.setFilter('vias-shadow-layer', f);
}

// --- Estado de selección (feature-state) ---
let kxSelectedSector = null;   // { source, sourceLayer, id }
let kxSectorLabelMarker = null;
let kxSectorChooser = null;
let kxSelectedSchool = null;   // id de la escuela seleccionada
let kxFocusedSchool = null;    // id de la escuela con foco (búsqueda, navegación…); independiente de la selección
let kxFocusTimer = null;

function kxSetFeatureState(ref, state) {
  if (!ref || !mlMap || !mlMap.getSource(ref.source)) return;
  try {
    const target = { source: ref.source, id: ref.id };
    if (ref.sourceLayer) target.sourceLayer = ref.sourceLayer;
    mlMap.setFeatureState(target, state);
  } catch (_) {}
}

function kxClearSectorSelection() {
  if (kxSelectedSector) {
    kxSetFeatureState(kxSelectedSector, { selected: false });
    const m = kxLabelMarkerFor(kxSelectedSector.source, kxSelectedSector.id);
    if (m) m.el.classList.remove('is-selected');
  }
  kxSelectedSector = null;
  if (kxSectorLabelMarker) { kxSectorLabelMarker.remove(); kxSectorLabelMarker = null; }
  kxPlaceSectorLabels();
}

function kxSelectSector(feature, lngLat) {
  kxClearSectorSelection();
  kxCloseSectorChooser();
  if (!feature || feature.id == null) return;
  // Una etiqueta del mapa representa a su línea: se selecciona la línea
  const lineSource = KX_LINE_SOURCE_OF[feature.source] || feature.source;
  kxSelectedSector = { source: lineSource, sourceLayer: feature.sourceLayer, id: feature.id };
  kxSetFeatureState(kxSelectedSector, { selected: true });
  // Su etiqueta es la misma píldora de siempre: solo se marca como seleccionada (se ve aunque falte zoom)
  const own = kxLabelMarkerFor(lineSource, feature.id);
  if (own) { own.el.classList.add('is-selected'); kxPlaceSectorLabels(); return; }
  // Sin etiqueta propia (teselas vectoriales): una píldora igual, sobre el toque
  const name = feature.properties && feature.properties.nombre;
  if (name && lngLat) {
    const el = document.createElement('div');
    el.className = 'kx-map-label is-selected';
    el.textContent = name;
    el.style.setProperty('--kx-sector', kxSectorColorOf(feature));
    kxSectorLabelMarker = new maplibregl.Marker({ element: el, anchor: 'bottom', offset: [0, -9] })
      .setLngLat(lngLat)
      .addTo(mlMap);
  }
}

function kxSectorColorOf(f) {
  const i = Number(f && f.properties && f.properties.kxc);
  return KX_SECTOR_PALETTE[Number.isInteger(i) && i >= 0 && i < KX_SECTOR_PALETTE.length ? i : 0];
}

function kxCloseSectorChooser() {
  if (kxSectorChooser) { kxSectorChooser.remove(); kxSectorChooser = null; }
}

const KX_SECTOR_HIT_LAYERS = ['sectores-hit-layer', 'sectores-usuarios-hit-layer'];
const KX_SECTOR_LABEL_LAYERS = ['sectores-labels-layer', 'sectores-usuarios-labels-layer'];
const KX_ROUTE_LAYERS = ['vias-layer', 'vias-usuarios-layer', 'vias-ticks-circle-layer', 'pending-my-routes-layer', 'admin-pending-routes-layer'];
// Elementos con su propio toque que el sector nunca debe interceptar (si el dedo cae exactamente sobre ellos)
const KX_PRIORITY_LAYERS = KX_ROUTE_LAYERS.concat(['school-markers-layer', 'escuelas-usuarios-layer', 'parkings-layer', 'puntos-interes-layer', 'poi-usuarios-layer']);
const KX_LABEL_TAP_PAD = 8;   // px alrededor de una etiqueta que también cuentan como toque

const _kxBoundSectorLayers = new Set();
// Los eventos por capa de MapLibre sobreviven a la capa: se registran una sola vez por id, aunque se recargue la escuela
function kxBindSectorEvents(layerId, { cursor = true } = {}) {
  if (!mlMap || _kxBoundSectorLayers.has(layerId)) return;
  _kxBoundSectorLayers.add(layerId);
  if (cursor) {
    mlMap.on('mouseenter', layerId, () => { mlMap.getCanvas().style.cursor = 'pointer'; });
    mlMap.on('mouseleave', layerId, () => { mlMap.getCanvas().style.cursor = ''; });
  }
  mlMap.on('click', layerId, (e) => {
    if (mlMap.getCanvas().style.cursor === 'crosshair') return;
    if (!e.features || e.features.length === 0) return;
    kxHandleSectorTap(e);
  });
}

// Abre la ficha de siempre según el origen del sector (estático o aportado por usuarios)
function kxOpenSectorFeature(f, lngLat) {
  const source = KX_LINE_SOURCE_OF[f.source] || f.source;
  if (source === 'sectores-usuarios-source') {
    // La etiqueta solo lleva nombre y color: la ficha de usuario necesita las propiedades completas de su línea
    const full = kxLineFeatureProps(source, f.id);
    return mlOpenUserSector(full || f.properties, lngLat);
  }
  if (source !== f.source) {
    const full = kxLineFeatureProps(source, f.id);
    return mlOpenStaticSector(full || f.properties, lngLat);
  }
  return mlOpenStaticSector(f.properties, lngLat);
}

function kxLineFeatureProps(lineSourceId, id) {
  const src = mlMap && mlMap.getSource(lineSourceId);
  const data = src && src.serialize && src.serialize().data;
  const f = data && data.features && data.features[id];
  return f ? f.properties : null;
}

function kxSectorKey(f) {
  return f.source + '|' + (f.id != null ? f.id : f.properties && f.properties.nombre);
}

/**
 * Toque sobre un sector o su etiqueta. El área táctil es la capa invisible de 24 px, no el trazo.
 *  1. Una vía, escuela, parking o POI justo bajo el dedo tiene prioridad (lo gestiona su propio handler).
 *  2. Una etiqueta (con un margen de 8 px) abre el sector que representa.
 *  3. Un único sector dentro del área táctil se selecciona y abre; si hay varios, se elige en un selector.
 * Devuelve true cuando el evento ya está gestionado, para que los demás handlers de sector no lo repitan.
 */
function kxHandleSectorTap(e) {
  const oe = e.originalEvent || {};
  if (oe._kxSectorHandled) return true;
  oe._kxSectorHandled = true;
  // La píldora de un sector gestiona su propio toque
  if (oe.target && oe.target.closest && oe.target.closest('.kx-map-label')) return true;

  const priority = KX_PRIORITY_LAYERS.filter(id => mlMap.getLayer(id));
  if (priority.length && mlMap.queryRenderedFeatures(e.point, { layers: priority }).length) return true;

  const labelLayers = KX_SECTOR_LABEL_LAYERS.filter(id => mlMap.getLayer(id));
  if (labelLayers.length) {
    const pad = KX_LABEL_TAP_PAD;
    const box = [[e.point.x - pad, e.point.y - pad], [e.point.x + pad, e.point.y + pad]];
    const label = mlMap.queryRenderedFeatures(box, { layers: labelLayers })[0];
    if (label) {
      kxSelectSector(label, e.lngLat);
      kxOpenSectorFeature(label, e.lngLat);
      return true;
    }
  }

  const layers = KX_SECTOR_HIT_LAYERS.filter(id => mlMap.getLayer(id));
  const seen = new Set();
  const candidates = [];
  for (const f of mlMap.queryRenderedFeatures(e.point, { layers })) {
    const key = kxSectorKey(f);
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push(f);
  }
  // Sin sectores en el área táctil no se abre nada
  if (!candidates.length) return true;

  if (candidates.length === 1) {
    kxSelectSector(candidates[0], e.lngLat);
    kxOpenSectorFeature(candidates[0], e.lngLat);
    return true;
  }

  kxCloseSectorChooser();
  kxClearSectorSelection();
  const wrap = document.createElement('div');
  wrap.className = 'kx-sector-chooser';
  wrap.setAttribute('role', 'listbox');
  wrap.setAttribute('aria-label', 'Elige un sector');
  const title = document.createElement('p');
  title.className = 'kx-sector-chooser__title';
  title.textContent = `${candidates.length} sectores aquí`;
  wrap.appendChild(title);
  candidates.slice(0, 6).forEach(f => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'kx-sector-chooser__item';
    b.setAttribute('role', 'option');
    b.textContent = f.properties.nombre || 'Sector sin nombre';
    b.style.setProperty('--kx-sector', kxSectorColorOf(f));
    const ref = { source: f.source, sourceLayer: f.sourceLayer, id: f.id };
    b.addEventListener('mouseenter', () => kxSetFeatureState(ref, { selected: true }));
    b.addEventListener('mouseleave', () => kxSetFeatureState(ref, { selected: false }));
    b.addEventListener('click', ev => {
      ev.stopPropagation();
      kxSetFeatureState(ref, { selected: false });
      kxSelectSector(f, e.lngLat);
      kxOpenSectorFeature(f, e.lngLat);
    });
    wrap.appendChild(b);
  });
  kxSectorChooser = new maplibregl.Popup({ closeButton: false, closeOnClick: true, offset: 14, maxWidth: '240px', className: 'kx-sector-chooser-popup' })
    .setLngLat(e.lngLat)
    .setDOMContent(wrap)
    .addTo(mlMap);
  kxSectorChooser.on('close', () => { kxSectorChooser = null; });
  return true;
}

// --- Iconos planos ---
// Marcador de escuela: pin circular con punta inferior, montaña blanca y contorno blanco. Sin texto, sin sombras.
// Los estados comparten silueta, proporciones y montaña; solo cambia el relleno. Con icon-anchor 'bottom' y un
// icon-offset de KX_SCHOOL_PIN_TIP_GAP, la punta visible queda exactamente sobre la coordenada.
const KX_SCHOOL_PIN = { normal: '#398C62', selected: '#27A866', pending: '#F59E0B' };
// El SVG original es de 96×112; se rasteriza a 48×56 px CSS (a la densidad real de la pantalla)
const KX_SCHOOL_PIN_W = 48, KX_SCHOOL_PIN_H = 56;
const KX_SCHOOL_PIN_HALF_W = 22.5;   // semiancho del pin con su contorno
const KX_SCHOOL_PIN_BODY_UP = 30.75; // del extremo visible de la punta al centro del círculo
const KX_SCHOOL_PIN_TIP_GAP = 1.25;  // la punta redondeada queda 1,25 px por encima del borde inferior de la imagen
// Escala del pin por zoom (icon-size sobre la imagen de 48 px de ancho)
const KX_SCHOOL_SCALE = [[5, 0.55], [8, 0.68], [10, 0.78], [12, 0.85]];

// SVG original de KRUX (sin cambios de geometría): solo varía el relleno según el estado
function kxSchoolPinSVG(fill) {
  return `<svg xmlns="http://www.w3.org/2000/svg"
     width="96" height="112"
     viewBox="0 0 96 112">
  <path
    d="M48 5
       C24.3 5 5 24.3 5 48
       C5 66 16 78 29 88
       L44 105
       Q48 110 52 105
       L67 88
       C80 78 91 66 91 48
       C91 24.3 71.7 5 48 5Z"
    fill="${fill}"
    stroke="#FFFFFF"
    stroke-width="4"
    stroke-linejoin="round"/>

  <path
    d="M22 57 L39 32 L49 45 L59 29 L77 57 Z"
    fill="#FFFFFF"/>

  <path
    d="M22 57 L39 32 L49 45"
    fill="none"
    stroke="#EAF3ED"
    stroke-width="1.5"
    stroke-linejoin="round"/>
</svg>`;
}

function kxSchoolScaleAt(z) {
  const st = KX_SCHOOL_SCALE;
  if (z <= st[0][0]) return st[0][1];
  for (let i = 1; i < st.length; i++) {
    if (z <= st[i][0]) return st[i - 1][1] + (st[i][1] - st[i - 1][1]) * (z - st[i - 1][0]) / (st[i][0] - st[i - 1][0]);
  }
  return st[st.length - 1][1];
}

// Etiqueta del nombre, a la derecha del pin y a la altura de su círculo (independiente del SVG)
function kxSchoolLabelLayer(id, sourceId) {
  kxEnsureLabelPill('kx-school-label', false);
  const sizes = { 7: 11, 10: 12, 12: 13 };
  const offset = ['interpolate', ['linear'], ['zoom']];
  Object.entries(sizes).forEach(([z, size]) => {
    const sc = kxSchoolScaleAt(+z);
    // El borde visible de la píldora queda 15 px a la izquierda del texto (relleno 4 + 11 del margen de la imagen)
    offset.push(+z, ['literal', [+((KX_SCHOOL_PIN_HALF_W * sc + 4 + 15) / size).toFixed(3), -+((KX_SCHOOL_PIN_BODY_UP * sc) / size).toFixed(3)]]);
  });
  return {
    id,
    type: 'symbol',
    source: sourceId,
    minzoom: 7,
    maxzoom: 12,
    layout: {
      ...kxLabelLayout(['interpolate', ['linear'], ['zoom'], 7, 11, 10, 12, 12, 13]),
      'icon-image': 'kx-school-label',
      'icon-text-fit-padding': [0, 4, 0, 4],
      'text-anchor': 'left',
      'text-justify': 'left',
      'text-offset': offset,
      'text-max-width': 10
    },
    paint: { ...kxLabelPaint(), 'text-color': KX_MAP.forest }
  };
}

function kxPOISVG(poiType) {
  const poi = getPOISVG(poiType);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28" width="28" height="28">
    <circle cx="14" cy="14" r="11.5" fill="${poi.color}" stroke="#ffffff" stroke-width="2"/>
    <svg x="6.5" y="6.5" width="15" height="15" viewBox="0 0 20 20">
      <g fill="none" stroke="#ffffff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${poi.svg}</g>
    </svg>
  </svg>`;
}

function kxTickBadgeSVG() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16">
    <circle cx="8" cy="8" r="6.6" fill="${KX_MAP.forest}" stroke="#ffffff" stroke-width="1.6"/>
    <path d="M5 8.3 L7.1 10.3 L11 6" fill="none" stroke="#ffffff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

// ============================================
// CONFIGURACIÓN DE GESTOS TÁCTILES
// ============================================

// Estado del pinch-to-zoom + rotación
let pinch = {
  active: false,
  startDist: 0,
  startZoom: 0,
  startAngle: 0,
  startBearing: 0,
  focalLngLat: null
};

// Flag para saber si los handlers personalizados están activos
let customTouchHandlersActive = false;

// Referencias a los handlers para poder removerlos
let touchHandlers = {
  onTouchStart: null,
  onTouchMove: null,
  onTouchEnd: null
};

// Funciones auxiliares para gestos
function getTouchDist(t1, t2) {
  const dx = t1.clientX - t2.clientX;
  const dy = t1.clientY - t2.clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

function getTouchCenter(t1, t2, rect) {
  return {
    x: (t1.clientX + t2.clientX) / 2 - rect.left,
    y: (t1.clientY + t2.clientY) / 2 - rect.top
  };
}

function getTouchAngle(t1, t2) {
  return Math.atan2(t2.clientY - t1.clientY, t2.clientX - t1.clientX) * 180 / Math.PI;
}

/**
 * Configura los gestos táctiles del mapa.
 *
 * Pinch-to-zoom manual con ROTACIÓN habilitada para iOS WebView.
 * Rotación disponible en cualquier parte del mapa (con y sin 3D).
 */
function setupTouchZoomFix() {
  if (!mlMap) return;

  const canvas = mlMap.getCanvas();

  // ===== VISTA 2D INICIAL =====
  mlMap.setPitch(0);
  mlMap.setBearing(0);
  mlMap.setMaxPitch(0);

  // ===== CONFIGURAR HANDLERS =====
  mlMap.touchZoomRotate.disable();
  mlMap.touchPitch.disable();
  mlMap.dragRotate.disable();
  mlMap.dragPan.enable();

  // Crear handlers
  touchHandlers.onTouchStart = function (e) {
    if (e.touches.length === 2) {
      e.preventDefault();
      mlMap.dragPan.disable();

      const t1 = e.touches[0];
      const t2 = e.touches[1];
      const rect = canvas.getBoundingClientRect();
      const center = getTouchCenter(t1, t2, rect);

      pinch.active = true;
      pinch.startDist = getTouchDist(t1, t2);
      pinch.startZoom = mlMap.getZoom();
      pinch.startAngle = getTouchAngle(t1, t2);
      pinch.startBearing = mlMap.getBearing();
      pinch.focalLngLat = mlMap.unproject([center.x, center.y]);
    }
  };

  touchHandlers.onTouchMove = function (e) {
    if (!pinch.active || e.touches.length !== 2) return;
    e.preventDefault();

    const t1 = e.touches[0];
    const t2 = e.touches[1];
    const rect = canvas.getBoundingClientRect();
    const currentDist = getTouchDist(t1, t2);
    const currentCenter = getTouchCenter(t1, t2, rect);
    const currentAngle = getTouchAngle(t1, t2);

    // Calcular nuevo zoom
    const scale = currentDist / pinch.startDist;
    const newZoom = Math.max(
      mlMap.getMinZoom(),
      Math.min(mlMap.getMaxZoom(), pinch.startZoom + Math.log2(scale))
    );

    // Calcular nueva rotación (bearing)
    const angleDelta = currentAngle - pinch.startAngle;
    const newBearing = pinch.startBearing - angleDelta;

    // Aplicar zoom y rotación centrado en el punto focal
    mlMap.jumpTo({
      zoom: newZoom,
      bearing: newBearing,
      around: pinch.focalLngLat
    });

    // Ajustar pan para seguir los dedos
    const focalScreen = mlMap.project(pinch.focalLngLat);
    const offsetX = currentCenter.x - focalScreen.x;
    const offsetY = currentCenter.y - focalScreen.y;

    if (Math.abs(offsetX) > 0.5 || Math.abs(offsetY) > 0.5) {
      const mapCenter = mlMap.project(mlMap.getCenter());
      const newCenter = mlMap.unproject([
        mapCenter.x - offsetX,
        mapCenter.y - offsetY
      ]);
      mlMap.setCenter(newCenter);
    }
  };

  touchHandlers.onTouchEnd = function (e) {
    if (pinch.active && e.touches.length < 2) {
      pinch.active = false;
      mlMap.dragPan.enable();
    }
  };

  // Añadir handlers personalizados
  enableCustomTouchHandlers();

  console.log('Gestos iOS: pinch-to-zoom + rotación activos');
}

/**
 * Habilita los handlers táctiles personalizados (para modo 2D)
 */
function enableCustomTouchHandlers() {
  if (customTouchHandlersActive || !mlMap) return;

  const canvas = mlMap.getCanvas();
  canvas.addEventListener('touchstart', touchHandlers.onTouchStart, { passive: false });
  canvas.addEventListener('touchmove', touchHandlers.onTouchMove, { passive: false });
  canvas.addEventListener('touchend', touchHandlers.onTouchEnd, { passive: true });
  canvas.addEventListener('touchcancel', touchHandlers.onTouchEnd, { passive: true });

  customTouchHandlersActive = true;
  console.log('[Touch] Handlers personalizados habilitados');
}

/**
 * Deshabilita los handlers táctiles personalizados (para modo 3D nativo)
 */
function disableCustomTouchHandlers() {
  if (!customTouchHandlersActive || !mlMap) return;

  const canvas = mlMap.getCanvas();
  canvas.removeEventListener('touchstart', touchHandlers.onTouchStart);
  canvas.removeEventListener('touchmove', touchHandlers.onTouchMove);
  canvas.removeEventListener('touchend', touchHandlers.onTouchEnd);
  canvas.removeEventListener('touchcancel', touchHandlers.onTouchEnd);

  // Resetear estado del pinch
  pinch.active = false;

  customTouchHandlersActive = false;
  console.log('[Touch] Handlers personalizados deshabilitados');
}

// ============================================
// INICIALIZACIÓN PRINCIPAL
// ============================================

/**
 * Inicializa el mapa MapLibre
 * Esta función reemplaza a initMap() de Google Maps
 */
function initMapLibre() {
  console.log('Iniciando MapLibre GL JS...');

  // Verificar que MapLibre está cargado
  if (typeof maplibregl === 'undefined') {
    console.error('MapLibre GL JS no está cargado');
    return;
  }

  // Crear el mapa
  mlMap = new maplibregl.Map({
    container: 'map',
    style: createBaseStyle(),
    center: MAP_DEFAULTS.center,
    zoom: MAP_DEFAULTS.zoom,
    minZoom: MAP_DEFAULTS.minZoom,
    maxZoom: MAP_DEFAULTS.maxZoom,
    pitch: 0,             // Sin inclinación inicial
    bearing: 0,           // Sin rotación inicial
    maxPitch: 0,          // BLOQUEADO: Se cambia dinámicamente en zoom >= 14
    attributionControl: true,
    hash: false,
    touchPitch: false,    // DESACTIVADO: Se activa solo en zoom >= 14
    dragRotate: false     // DESACTIVADO: Se activa solo en zoom >= 14
  });

  // Añadir controles
  addMapControls();

  // Crear popup reutilizable
  mlRoutePopup = new maplibregl.Popup({
    closeButton: true,
    closeOnClick: false,
    maxWidth: '340px',
    className: 'ml-route-popup kx-mpop'
  });
  kxWatchRoutePopup(mlRoutePopup);

  // Eventos cuando el mapa esté listo
  mlMap.on('load', onMapLoad);

  // Evento de error
  mlMap.on('error', (e) => {
    console.error('Error en MapLibre:', e.error);
  });

  // Exponer globalmente para compatibilidad
  window.mlMap = mlMap;

  console.log('MapLibre inicializado correctamente');
}

/**
 * Estilo base del mapa: ortofoto del PNOA o mapa topográfico (map-style.js)
 */
function createBaseStyle() {
  return KxBaseMap.initialStyle(MAPLIBRE_CONFIG.MAPTILER_KEY);
}

/**
 * Añade controles al mapa
 */
function addMapControls() {
  // La esquina inferior derecha apila cada control nuevo encima del anterior.
  // Orden final (de arriba abajo): edición (solo admin/spotter), 3D, geolocalización y atribución.
  // Sin botones de zoom ni brújula: el zoom, el desplazamiento y la rotación se hacen por gestos.

  // Control de geolocalización
  const geolocateControl = new maplibregl.GeolocateControl({
    positionOptions: {
      enableHighAccuracy: true
    },
    trackUserLocation: true,
    showUserHeading: true
  });
  mlMap.addControl(geolocateControl, 'bottom-right');

  // Control de escala
  mlMap.addControl(new maplibregl.ScaleControl({
    maxWidth: 150,
    unit: 'metric'
  }), 'bottom-left');

  // Botón de filtro por grado (columna inferior derecha)
  addGradeFilterButton();

  // Sol y sombra: botón, panel y capa (sun-map.js)
  if (window.KxSunMap) KxSunMap.init(mlMap);

  // Vista del mapa base: satélite / topográfico (map-style.js)
  KxBaseMap.init(mlMap);

  // Botón de información / leyenda
  addInfoLegendButton();

  // Sesiones de escalada: botón flotante y tarjeta de sesión activa (climb-session-ui.js)
  if (typeof KruxSessionUI !== 'undefined') KruxSessionUI.mountMap(mlMap);
}

// Recorrido GPS de la sesión activa (lista vacía = quitarlo). Lo llama climb-session-ui.js
function kxSessionDrawTrack(points) {
  if (!mlMap) return;
  const apply = () => {
    const data = { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: points.map(p => [p.lng, p.lat]) } };
    const src = mlMap.getSource('kx-session-track');
    if (src) { src.setData(data); return; }
    if (!points.length) return;
    mlMap.addSource('kx-session-track', { type: 'geojson', data });
    mlMap.addLayer({ id: 'kx-session-track-casing', type: 'line', source: 'kx-session-track', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#FFFFFF', 'line-width': 7, 'line-opacity': 0.9 } });
    mlMap.addLayer({ id: 'kx-session-track-line', type: 'line', source: 'kx-session-track', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#2F7D62', 'line-width': 3.5 } });
  };
  if (mlMap.isStyleLoaded()) apply(); else mlMap.once('idle', apply);
}

// Estado del modo 3D
// El botón 3D está desactivado por decisión de producto: el código del modo 3D se conserva y
// basta poner esta constante en true para recuperarlo en todas las escuelas
const MAP_3D_BUTTON_ENABLED = false;
// Excepción: escuelas con relieve propio del IGN (KX_LOCAL_DEM), donde el botón 3D sí aparece dentro de sus límites
const MAP_3D_SCHOOLS = ['pedriza', 'patones'];
let is3DMode = false;
const MIN_ZOOM_FOR_3D = 14;
const MIN_ZOOM_IN_3D = 12;   // Ya en 3D se puede alejar más sin que el modo se apague
const MAX_PITCH_3D = 85;     // Inclinación máxima en modo 3D: el tope de MapLibre 4
const INITIAL_PITCH_3D = 65; // Inclinación con la que arranca el modo 3D
const MAX_DPR_3D = 2;        // El relieve se pinta a 2 px por punto: más densidad solo cuesta fluidez

// Zoom mínimo para cargar geometrías automáticamente
const MIN_ZOOM_FOR_AUTO_LOAD = 12;

/**
 * Obtiene el ID de la escuela más cercana al centro del mapa
 * @returns {string|null} ID de la escuela o null si no hay ninguna cerca
 */
function getSchoolAtCurrentPosition() {
  if (!mlMap) return null;

  const center = mlMap.getCenter();
  const zoom = mlMap.getZoom();

  // Si zoom es menor al mínimo, no detectar escuelas
  if (zoom < MIN_ZOOM_FOR_AUTO_LOAD) return null;

  let closestSchool = null;
  let closestDistance = Infinity;

  // Verificar proximidad a cada escuela configurada
  for (const schoolId in MAPLIBRE_SCHOOLS) {
    const school = MAPLIBRE_SCHOOLS[schoolId];
    const schoolCenter = school.center; // [lng, lat]

    // Calcular distancia aproximada en grados
    const dLng = Math.abs(center.lng - schoolCenter[0]);
    const dLat = Math.abs(center.lat - schoolCenter[1]);
    const distance = Math.sqrt(dLng * dLng + dLat * dLat);

    // Umbral de proximidad (~2km aprox dependiendo de latitud)
    const threshold = 0.02;

    if (dLng < threshold && dLat < threshold && distance < closestDistance) {
      closestSchool = schoolId;
      closestDistance = distance;
    }
  }

  return closestSchool;
}

/**
 * Carga automáticamente las geometrías de una escuela cuando el usuario
 * hace zoom manual hacia ella
 */
function checkAndLoadSchoolOnZoom() {
  const nearbySchoolId = getSchoolAtCurrentPosition();

  // Si no hay escuela cerca, limpiar si había una cargada
  if (!nearbySchoolId) {
    // Solo limpiar si el zoom es bajo (el usuario se alejó)
    if (mlCurrentSchool && mlMap.getZoom() < MIN_ZOOM_FOR_AUTO_LOAD) {
      console.log('[AutoLoad] Usuario alejado de escuela, limpiando capas');
      mlClearSchoolLayers();
      mlCurrentSchool = null;
    }
    return;
  }

  // Si ya está cargada esta escuela, no hacer nada
  if (mlCurrentSchool === nearbySchoolId) {
    return;
  }

  // Cargar la nueva escuela (skipFlyTo = true para no mover el mapa)
  console.log(`[AutoLoad] Detectada escuela cercana: ${nearbySchoolId}, cargando geometrías...`);
  mlLoadSchool(nearbySchoolId, true);

  // Actualizar variables globales
  if (typeof window.currentSchoolId !== 'undefined') {
    window.currentSchoolId = nearbySchoolId;
  }
  const school = MAPLIBRE_SCHOOLS[nearbySchoolId];
  if (school && typeof window.currentSchoolName !== 'undefined') {
    window.currentSchoolName = school.name;
  }
}

/**
 * Verifica si el centro del mapa está cerca de alguna escuela
 * @returns {boolean} true si está cerca de una escuela
 */
function isNearSchool() {
  if (!mlMap) return false;

  const center = mlMap.getCenter();
  const zoom = mlMap.getZoom();

  // Si zoom es menor a MIN_ZOOM_FOR_3D, no está "cerca"
  if (zoom < MIN_ZOOM_FOR_3D) return false;

  // Verificar proximidad a cada escuela configurada
  for (const schoolId in MAPLIBRE_SCHOOLS) {
    const school = MAPLIBRE_SCHOOLS[schoolId];
    const schoolCenter = school.center; // [lng, lat]

    // Calcular distancia aproximada en grados
    const dLng = Math.abs(center.lng - schoolCenter[0]);
    const dLat = Math.abs(center.lat - schoolCenter[1]);

    // Umbral de proximidad (~2km aprox dependiendo de latitud)
    const threshold = 0.02;

    if (dLng < threshold && dLat < threshold) {
      return true;
    }
  }

  // También considerar "cerca" si hay una escuela cargada
  return mlCurrentSchool !== null;
}

/**
 * Añade botón de toggle 3D al mapa
 * Funciona tanto en web como en apps nativas (iOS/Android)
 */
function add3DToggleButton() {
  // Verificar si el botón ya existe para evitar duplicados
  if (document.getElementById('btn-3d-toggle')) {
    console.log('[3D] Botón 3D ya existe, omitiendo creación');
    return;
  }

  const isNative = window.Capacitor !== undefined;

  if (!MAP_3D_BUTTON_ENABLED && MAP_3D_SCHOOLS.length === 0) {
    // Sin botón 3D, pero la carga automática de la escuela al acercarse se mantiene
    mlMap.on('moveend', checkAndLoadSchoolOnZoom);
    mlMap.on('zoomend', checkAndLoadSchoolOnZoom);
    console.log('[3D] Botón 3D desactivado');
    return;
  }

  const btn = document.createElement('button');
  btn.id = 'btn-3d-toggle';
  btn.type = 'button';
  btn.className = 'map-control-btn maplibregl-ctrl kx-ctrl-3d';
  btn.innerHTML = '3D';
  btn.title = 'Activar vista 3D';
  btn.setAttribute('aria-label', 'Activar vista 3D');
  btn.setAttribute('aria-pressed', 'false');
  // Aspecto en app_2.css (MAPA — CONTROLES); la visibilidad la decide update3DButtonVisibility
  btn.style.display = 'none';

  btn.addEventListener('click', toggle3DMode);

  // Encabeza la pila de controles de la esquina inferior derecha
  const stack = mlMap.getContainer().querySelector('.maplibregl-ctrl-bottom-right');
  if (stack) stack.insertBefore(btn, stack.firstChild);
  else document.getElementById('map').appendChild(btn);

  // Mostrar/ocultar según proximidad a escuela
  mlMap.on('zoom', update3DButtonVisibility);
  mlMap.on('zoomend', update3DButtonVisibility);
  mlMap.on('moveend', update3DButtonVisibility);
  update3DButtonVisibility();

  // Auto-cargar geometrías de escuela al hacer zoom manual
  mlMap.on('moveend', checkAndLoadSchoolOnZoom);
  mlMap.on('zoomend', checkAndLoadSchoolOnZoom);

  console.log('[3D] Botón 3D añadido' + (isNative ? ' (móvil nativo)' : ' (web)'));
}

/**
 * Añade botón de creador de vías al mapa (solo admins)
 * Se posiciona encima del botón 3D, visible cuando hay sector seleccionado
 */
function addRouteCreatorButton() {
  // Verificar si el botón ya existe para evitar duplicados
  if (document.getElementById('btn-route-creator')) {
    console.log('[RouteCreator] Botón ya existe, omitiendo creación');
    return;
  }

  const isNative = window.Capacitor !== undefined;

  const btn = document.createElement('button');
  btn.id = 'btn-route-creator';
  btn.className = 'map-control-btn';
  btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <path d="M12 20h9"/>
    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
  </svg>`;
  btn.title = 'Dibujar vías en el sector';

  // Posición: encima del botón 3D (bottom + altura del 3D + gap)
  btn.style.cssText = `
    position: absolute;
    bottom: ${isNative ? '295px' : '295px'};
    right: 10px;
    width: 36px;
    height: 36px;
    background: #10b981;
    border: none;
    border-radius: 8px;
    color: white;
    cursor: pointer;
    z-index: 1000;
    display: none;
    align-items: center;
    justify-content: center;
    transition: background 0.2s ease;
    -webkit-tap-highlight-color: transparent;
    touch-action: manipulation;
  `;

  // En móvil, usar touchend para respuesta inmediata
  // En web, usar click normal
  if (isNative) {
    let touchHandled = false;
    btn.addEventListener('touchend', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!touchHandled) {
        touchHandled = true;
        console.log('[RouteCreator] Touch detectado en móvil');
        openRouteCreatorForCurrentSector();
        // Reset después de un breve delay para evitar doble disparo
        setTimeout(() => { touchHandled = false; }, 300);
      }
    });
  } else {
    btn.addEventListener('click', openRouteCreatorForCurrentSector);
  }

  document.getElementById('map').appendChild(btn);

  // Mostrar/ocultar según sector seleccionado y si es admin
  mlMap.on('zoom', updateRouteCreatorButtonVisibility);
  mlMap.on('zoomend', updateRouteCreatorButtonVisibility);
  mlMap.on('moveend', updateRouteCreatorButtonVisibility);

  console.log('[RouteCreator] Botón creador de vías añadido' + (isNative ? ' (móvil nativo)' : ' (web)'));
}

/**
 * Actualiza visibilidad del botón creador de vías
 * Solo visible cuando: (1) hay sector seleccionado, (2) usuario es admin, (3) zoom >= umbral de 3D
 */
async function updateRouteCreatorButtonVisibility() {
  const btn = document.getElementById('btn-route-creator');
  if (!btn) return;

  const nearSchool = isNearSchool();

  if (nearSchool) {
    // Verificar si es admin
    const isAdmin = await checkIsAdmin();
    if (isAdmin) {
      btn.style.display = 'flex';
    } else {
      btn.style.display = 'none';
    }
  } else {
    btn.style.display = 'none';
  }
}

/**
 * Verifica si el usuario actual es admin (caché para evitar llamadas repetidas)
 */
let _cachedIsAdmin = null;
let _cachedAdminCheckTime = 0;
const ADMIN_CACHE_DURATION = 60000; // 1 minuto

async function checkIsAdmin() {
  const now = Date.now();

  // Usar caché si está disponible y no ha expirado
  if (_cachedIsAdmin !== null && (now - _cachedAdminCheckTime) < ADMIN_CACHE_DURATION) {
    return _cachedIsAdmin;
  }

  try {
    if (typeof auth === 'undefined' || !auth.currentUser) {
      _cachedIsAdmin = false;
      _cachedAdminCheckTime = now;
      return false;
    }

    const adminDoc = await db.collection('admins').doc(auth.currentUser.uid).get();
    _cachedIsAdmin = adminDoc.exists && (adminDoc.data().role === 'admin' || adminDoc.data().role === 'spotter');
    _cachedAdminCheckTime = now;
    return _cachedIsAdmin;
  } catch (error) {
    console.error('[RouteCreator] Error verificando admin:', error);
    _cachedIsAdmin = false;
    _cachedAdminCheckTime = now;
    return false;
  }
}

let _cachedAdminRole = undefined;
let _cachedAdminRoleTime = 0;

async function checkAdminRole() {
  const now = Date.now();
  if (_cachedAdminRole !== undefined && (now - _cachedAdminRoleTime) < ADMIN_CACHE_DURATION) {
    return _cachedAdminRole;
  }
  try {
    if (typeof auth === 'undefined' || !auth.currentUser) {
      _cachedAdminRole = null; _cachedAdminRoleTime = now; return null;
    }
    const doc = await db.collection('admins').doc(auth.currentUser.uid).get();
    _cachedAdminRole = doc.exists ? (doc.data().role || null) : null;
    _cachedAdminRoleTime = now;
    return _cachedAdminRole;
  } catch (e) {
    _cachedAdminRole = null; _cachedAdminRoleTime = now; return null;
  }
}

/**
 * Abre el editor de vías para el sector actualmente visible
 */
async function openRouteCreatorForCurrentSector() {
  console.log('[RouteCreator] Función openRouteCreatorForCurrentSector iniciada');
  console.log('[RouteCreator] mlCurrentSchool:', mlCurrentSchool);

  if (!mlCurrentSchool) {
    console.warn('[RouteCreator] No hay escuela seleccionada');
    return;
  }

  // Verificar si es admin
  const isAdmin = await checkIsAdmin();
  if (!isAdmin) {
    if (typeof showRDToast === 'function') {
      showRDToast('Solo los administradores pueden dibujar vías', 'error');
    }
    return;
  }

  // Obtener el sector más cercano al centro del mapa
  const center = mlMap.getCenter();
  const sectorName = await findNearestSector(mlCurrentSchool, center.lng, center.lat);

  if (!sectorName) {
    showToast('No se encontró ningún sector cercano', 'warning');
    return;
  }

  // Verificar que existe imagen del sector
  const hasImage = await sectorHasImage(mlCurrentSchool, sectorName);
  if (!hasImage) {
    showToast(`El sector «${sectorName}» no tiene imagen\nSube una imagen primero.`, 'warning');
    return;
  }

  // Abrir el editor de dibujo
  if (typeof openRouteDrawingEditor === 'function') {
    openRouteDrawingEditor(mlCurrentSchool, sectorName);
  } else {
    console.error('[RouteCreator] openRouteDrawingEditor no está disponible');
  }
}

/**
 * Encuentra el sector más cercano a una coordenada
 */
async function findNearestSector(schoolId, lng, lat) {
  try {
    const school = MAPLIBRE_SCHOOLS[schoolId];
    if (!school || !school.geojson || !school.geojson.sectores) {
      return null;
    }

    const response = await fetch(school.geojson.sectores);
    if (!response.ok) return null;

    const geojson = await response.json();
    if (!geojson.features || geojson.features.length === 0) return null;

    let nearestSector = null;
    let minDistance = Infinity;

    for (const feature of geojson.features) {
      if (!feature.geometry || !feature.geometry.coordinates) continue;

      // Para polígonos, usar el centroide
      let sectorLng, sectorLat;
      if (feature.geometry.type === 'Polygon') {
        const coords = feature.geometry.coordinates[0];
        sectorLng = coords.reduce((sum, c) => sum + c[0], 0) / coords.length;
        sectorLat = coords.reduce((sum, c) => sum + c[1], 0) / coords.length;
      } else if (feature.geometry.type === 'Point') {
        sectorLng = feature.geometry.coordinates[0];
        sectorLat = feature.geometry.coordinates[1];
      } else {
        continue;
      }

      const distance = Math.sqrt(
        Math.pow(lng - sectorLng, 2) + Math.pow(lat - sectorLat, 2)
      );

      if (distance < minDistance) {
        minDistance = distance;
        nearestSector = feature.properties.nombre || feature.properties.name;
      }
    }

    return nearestSector;
  } catch (error) {
    console.error('[RouteCreator] Error buscando sector:', error);
    return null;
  }
}

// ¿Está el centro del mapa dentro de una escuela de MAP_3D_SCHOOLS, con zoom suficiente?
function kxIn3DSchool() {
  return !!kx3DSchoolId();
}

// Escuela de MAP_3D_SCHOOLS bajo el centro del mapa (null si no hay o falta zoom)
function kx3DSchoolId() {
  if (!mlMap || mlMap.getZoom() < (is3DMode ? MIN_ZOOM_IN_3D : MIN_ZOOM_FOR_3D)) return null;
  const c = mlMap.getCenter();
  return MAP_3D_SCHOOLS.find(id => {
    const b = MAPLIBRE_SCHOOLS[id] && MAPLIBRE_SCHOOLS[id].bounds;
    return b && c.lng >= b[0][0] && c.lng <= b[1][0] && c.lat >= b[0][1] && c.lat <= b[1][1];
  }) || null;
}

/**
 * Actualiza visibilidad del botón 3D según proximidad a escuela
 */
function update3DButtonVisibility() {
  const btn = document.getElementById('btn-3d-toggle');
  if (!btn) return;

  const nearSchool = MAP_3D_BUTTON_ENABLED ? isNearSchool() : kxIn3DSchool();

  if (nearSchool) {
    btn.style.display = 'flex';
  } else {
    btn.style.display = 'none';
    // Si nos alejamos de la escuela, desactivar 3D
    if (is3DMode) {
      disable3DMode();
    }
  }

  // También actualizar el botón de creador de vías
  updateRouteCreatorButtonVisibility();
}

/**
 * Toggle modo 3D
 */
function toggle3DMode() {
  if (is3DMode) {
    disable3DMode();
    return;
  }
  // Donde hay maqueta precargada (KX_TERRAIN_3D) se abre el visor propio; si no, el relieve de MapLibre
  const schoolId = kx3DSchoolId();
  if (schoolId && typeof kxTerrain3D !== 'undefined' && kxTerrain3D.available(schoolId)) {
    kxOpenTerrainViewer(schoolId);
  } else {
    enable3DMode();
  }
}

/**
 * Abre el visor 3D propio (terrain-3d.js) sobre el mapa, con los sectores cargados y sus colores.
 * Si el visor no puede arrancar (sin red para Three.js, sin WebGL...), entra el modo 3D de MapLibre.
 */
function kxOpenTerrainViewer(schoolId) {
  if (kxTerrain3D.isOpen()) return;
  const sectors = [];
  ['sectores-source', 'sectores-usuarios-source'].forEach(sourceId => {
    const src = mlMap.getSource(sourceId);
    const data = src && src.serialize && src.serialize().data;
    if (!data || !Array.isArray(data.features)) return;
    data.features.forEach(f => {
      const p = f.properties || {};
      sectors.push({ feature: f, user: sourceId === 'sectores-usuarios-source', name: p.nombre || p.name || '', color: kxSectorColorOf(f) });
    });
  });
  // Caminos de acceso: en 2D están desactivados (MAPLIBRE_RUTAS_ACCESO_ACTIVAS), pero en 3D sí se dibujan
  const g = MAPLIBRE_SCHOOLS[schoolId].geojson || {};
  const pathsUrl = g.rutasAcceso || g.rutasAccesoDesactivadas;
  const pathsReady = pathsUrl
    ? fetch(pathsUrl).then(r => (r.ok ? r.json() : null)).then(d => (d && d.features) || []).catch(() => [])
    : Promise.resolve([]);
  // POI (estáticos y de usuarios) y parkings, con la misma insignia que en el mapa 2D
  const pois = [];
  ['puntos-interes-source', 'poi-usuarios-source'].forEach(sourceId => {
    const src = mlMap.getSource(sourceId);
    const data = src && src.serialize && src.serialize().data;
    if (!data || !Array.isArray(data.features)) return;
    data.features.forEach(f => {
      const p = f.properties || {};
      const co = f.geometry && f.geometry.type === 'Point' ? f.geometry.coordinates : null;
      if (co) pois.push({ lng: co[0], lat: co[1], icon: kxPoiIconSrc(p.descripcio || p.descripcion || p.Descripcion || p.tipo || ''), name: p.nombre || p.name || '' });
    });
  });
  const parkingsReady = g.parkings
    ? fetch(g.parkings).then(r => (r.ok ? r.json() : null)).then(d => (d && d.features) || []).catch(() => [])
    : Promise.resolve([]);
  const c = mlMap.getCenter();
  Promise.all([pathsReady, parkingsReady]).then(([paths, parkings]) => {
    parkings.forEach(f => {
      const geom = f.geometry || {};
      const pts = geom.type === 'Point' ? [geom.coordinates] : geom.type === 'MultiPoint' ? geom.coordinates : [];
      pts.forEach(co => pois.push({ lng: co[0], lat: co[1], icon: kxPoiIconSrc('parking'), name: (f.properties && (f.properties.Descripcion || f.properties.nombre)) || 'Parking' }));
    });
    return kxTerrain3D.open(schoolId, {
    pois,
    paths,
    pathColor: KX_MAP.access,
    container: document.getElementById('map-view'),
    name: MAPLIBRE_SCHOOLS[schoolId].name,
    center: [c.lng, c.lat],
    zoom: mlMap.getZoom(),
    bearing: mlMap.getBearing(),
    sectors,
    onSector(item, lngLat) {
      // En escritorio la ficha es un popup del mapa 2D: se vuelve a él antes de abrirla
      if (!isMobileDevice()) {
        kxTerrain3D.close();
        mlMap.jumpTo({ center: lngLat });
      }
      const props = item.feature.properties || {};
      if (item.user) mlOpenUserSector(props, lngLat);
      else mlOpenStaticSector(props, lngLat);
    },
    onClose(center) {
      // El mapa 2D queda donde se estaba mirando en 3D
      if (center && mlMap) mlMap.jumpTo({ center });
    }
  });
  }).catch(e => {
    console.warn('[3D] Visor de relieve no disponible, se usa el 3D del mapa:', e);
    enable3DMode();
  });
}

/**
 * Activa el modo 3D con vista inclinada
 * - Deshabilita handlers personalizados de pinch
 * - Habilita handlers nativos de MapLibre para pitch, zoom y rotación
 * - Permite inclinación hasta MAX_PITCH_3D
 */
function enable3DMode() {
  if (!(MAP_3D_BUTTON_ENABLED ? isNearSchool() : kxIn3DSchool())) return;

  is3DMode = true;
  mlMap.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_DPR_3D));
  kxApplySectorCasing3D();

  // 1. DESHABILITAR handlers personalizados (para que no interfieran)
  disableCustomTouchHandlers();

  // 2. Configurar máximo pitch
  mlMap.setMaxPitch(MAX_PITCH_3D);

  // 3. HABILITAR handlers nativos de MapLibre para 3D
  mlMap.touchZoomRotate.enable();
  mlMap.touchPitch.enable();
  mlMap.dragRotate.enable();
  mlMap.dragPan.enable();

  // 4. Activar terreno 3D (solo existe mientras el modo 3D está activo)
  add3DTerrain();

  // 5. Animar a vista 3D inicial
  mlMap.easeTo({
    pitch: INITIAL_PITCH_3D,
    bearing: mlMap.getBearing(),
    duration: 500
  });

  const btn = document.getElementById('btn-3d-toggle');
  if (btn) {
    btn.classList.add('is-active');
    btn.setAttribute('aria-pressed', 'true');
    btn.title = 'Desactivar vista 3D';
  }

  console.log('[3D] Modo 3D activado - handlers nativos de MapLibre habilitados');
}

/**
 * Desactiva el modo 3D, vuelve a vista plana
 * - Deshabilita handlers nativos de MapLibre
 * - Restaura handlers personalizados de pinch-to-zoom
 * - Bloquea pitch
 */
function disable3DMode() {
  is3DMode = false;
  kxApplySectorCasing3D();

  // 1. Animar vuelta a vista 2D
  mlMap.easeTo({
    pitch: 0,
    bearing: 0,
    duration: 500
  });

  // 2. Esperar a que termine la animación para restaurar handlers
  setTimeout(() => {
    if (!is3DMode) {
      // 3. Bloquear pitch y quitar terreno 3D
      mlMap.setMaxPitch(0);
      remove3DTerrain();
      mlMap.setPixelRatio(window.devicePixelRatio || 1);

      // 4. DESHABILITAR handlers nativos de 3D
      mlMap.touchZoomRotate.disable();
      mlMap.touchPitch.disable();
      mlMap.dragRotate.disable();

      // 5. RESTAURAR handlers personalizados
      enableCustomTouchHandlers();
      mlMap.dragPan.enable();
    }
  }, 550);

  const btn = document.getElementById('btn-3d-toggle');
  if (btn) {
    btn.classList.remove('is-active');
    btn.setAttribute('aria-pressed', 'false');
    btn.title = 'Activar vista 3D';
  }

  console.log('[3D] Modo 3D desactivado - handlers personalizados restaurados');
}

/**
 * Callback cuando el mapa está listo
 */
function onMapLoad() {
  console.log('Mapa MapLibre cargado');
  kxPrewarmSchoolSheet();

  // FIX: Configurar pinch-to-zoom para que el zoom se centre en el punto del gesto
  // Esto reemplaza el handler nativo de MapLibre que causa el "avance" del mapa
  setupTouchZoomFix();

  // Añadir botón de toggle 3D
  add3DToggleButton();

  // Botón de creador de vías desactivado
  // addRouteCreatorButton();

  // El terreno 3D ya no se carga aquí: solo se activa con el botón 3D (enable3DMode)

  // Cargar límites autonómicos
  loadAutonomousBoundaries();

  // Cargar icono de parking
  loadParkingIcon();

  // Precalentar los iconos POI más comunes en tiempo libre del navegador
  _mlPrewarmPOIIcons();

  // Listener para actualizar ticks de ascensos al moverse/zoom
  mlMap.on('moveend', scheduleTicksUpdate);
  mlMap.on('sourcedata', (e) => {
    if (e.sourceId === 'vias-source' && e.isSourceLoaded) {
      scheduleTicksUpdate();
    }
  });

  // Cargar markers de escuelas (vista general)
  loadSchoolMarkers();

  // Rocódromos (Comunidad de Madrid): se ven a partir de un zoom más cercano que las escuelas
  loadGymMarkers();

  // Cargar escuelas aprobadas desde Firestore (marcadores adicionales)
  loadApprovedSchoolsFromFirestore();

  // Escuelas pendientes (admin ve todas, spotter solo las propias, otros nada): las carga el
  // listener de sesión de más abajo, que se dispara al registrarse y en cada cambio de usuario

  // NO cargar escuela por defecto - el usuario selecciona desde markers
  // mlLoadSchool('valeria');

  // Re-subscribe to approved items and update pending items on auth state change.
  // onSnapshot connections are dropped when Firebase auth state changes; without this
  // approved Spotter content disappears after logout/re-login.
  // Fires immediately on registration: también hace la carga inicial de las escuelas pendientes.
  if (typeof firebase !== 'undefined' && firebase.auth) {
    firebase.auth().onAuthStateChanged(async (user) => {
      // Invalidate cached roles so they are re-evaluated under the new auth state
      _cachedIsAdmin = null;
      _cachedAdminRole = undefined;
      _cachedAdminRoleTime = 0;
      _cachedAdminCheckTime = 0;

      if (!mlMap) return;

      // Lo del usuario anterior (pendientes, escuelas pendientes, edición en curso) no sobrevive
      // a ningún cambio de sesión: logout, login o cambio directo de cuenta
      mlClearPendingItemsLayers();

      const schoolId = mlCurrentSchool;
      if (schoolId) {
        // Approved items are public — always re-subscribe regardless of auth state
        loadApprovedRoutesFromFirestore(schoolId);
        loadApprovedSectorsFromFirestore(schoolId);
        loadApprovedPOIFromFirestore(schoolId);
      }

      if (!user) return;
      // Reload user-specific (pending) items based on the new user's real role
      const role = await checkAdminRole();
      if (!auth.currentUser || auth.currentUser.uid !== user.uid) return;   // la sesión cambió durante la consulta
      if (role === 'admin') {
        if (schoolId) loadAllPendingForAdmin(schoolId);
        loadAllPendingSchoolsForAdmin();
      } else if (role === 'spotter') {
        if (schoolId) {
          loadMyPendingRoutesFromFirestore(schoolId);
          loadMyPendingPOIFromFirestore(schoolId);
          loadMyPendingSectorsFromFirestore(schoolId);
        }
        loadMyPendingSchoolsFromFirestore();
      }
    });
  }

  // Activar botón de centrar mapa (Spain Reset)
  setupResetViewButton();

  // Notificar que el mapa está listo
  window.dispatchEvent(new CustomEvent('maplibre:ready', { detail: { map: mlMap } }));
}

// ============================================
// LÍMITES AUTONÓMICOS
// ============================================

/**
 * Carga los límites de comunidades autónomas como capa de líneas
 * GeoJSON simplificado (~89KB, solo península), visible zoom 6-12
 * Sin interacción, sin fill, solo línea sutil
 */
function loadAutonomousBoundaries() {
  if (!mlMap) return;

  function addBoundaryLayers(geojson) {
    try {
      if (mlMap.getSource('ccaa-boundaries-source')) return; // Ya cargado

      mlMap.addSource('ccaa-boundaries-source', {
        type: 'geojson',
        data: geojson
      });

      // Determinar dónde insertar la capa (debajo de labels si existe)
      const beforeLayer = mlMap.getLayer('labels-place-city') ? 'labels-place-city' : undefined;

      // Capa de casing (borde exterior oscuro para contraste sobre satélite)
      mlMap.addLayer({
        id: 'ccaa-boundaries-casing',
        type: 'line',
        source: 'ccaa-boundaries-source',
        minzoom: 6,
        maxzoom: 12,
        paint: {
          'line-color': '#000000',
          'line-opacity': [
            'interpolate', ['linear'], ['zoom'],
            6, 0.4,
            8, 0.5,
            10, 0.45,
            12, 0.25
          ],
          'line-width': [
            'interpolate', ['linear'], ['zoom'],
            6, 2.5,
            8, 3.5,
            10, 4,
            12, 3
          ]
        },
        layout: {
          'line-cap': 'round',
          'line-join': 'round'
        }
      }, beforeLayer);

      // Capa principal (línea interior clara)
      mlMap.addLayer({
        id: 'ccaa-boundaries-layer',
        type: 'line',
        source: 'ccaa-boundaries-source',
        minzoom: 6,
        maxzoom: 12,
        paint: {
          'line-color': '#e0e0e0',
          'line-opacity': [
            'interpolate', ['linear'], ['zoom'],
            6, 0.8,
            8, 0.95,
            10, 0.9,
            12, 0.5
          ],
          'line-width': [
            'interpolate', ['linear'], ['zoom'],
            6, 1,
            8, 1.5,
            10, 2,
            12, 1.5
          ]
        },
        layout: {
          'line-cap': 'round',
          'line-join': 'round'
        }
      }, beforeLayer);

      console.log('[CCAA] Límites autonómicos cargados correctamente');
    } catch (err) {
      console.warn('[CCAA] Error añadiendo capas de límites:', err);
    }
  }

  fetch('data/spain_ccaa_boundaries.geojson')
    .then(r => {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(geojson => {
      console.log('[CCAA] GeoJSON cargado:', geojson.features.length, 'features');
      if (mlMap.isStyleLoaded()) {
        addBoundaryLayers(geojson);
      } else {
        mlMap.once('styledata', () => addBoundaryLayers(geojson));
      }
    })
    .catch(err => {
      console.warn('[CCAA] Error cargando límites autonómicos:', err);
    });
}

// ============================================
// TERRENO 3D
// ============================================

/**
 * Añade terreno 3D al mapa
 * Funciona tanto en web como en apps nativas (iOS/Android)
 */
function add3DTerrain() {
  if (!MAPLIBRE_CONFIG.MAPTILER_KEY || MAPLIBRE_CONFIG.MAPTILER_KEY === 'get_your_own_key') {
    console.warn('Necesitas una API key de MapTiler para el terreno 3D');
    return;
  }

  try {
    // Añadir fuente de terreno (solo la primera vez): relieve propio donde lo hay, MapTiler en el resto
    if (!mlMap.getSource('terrain-source')) {
      kxRegisterDemProtocol();
      mlMap.addSource('terrain-source', {
        type: 'raster-dem',
        tiles: ['kxdem://{z}/{x}/{y}'],
        tileSize: 512,
        maxzoom: 14,
        encoding: 'mapbox',
        attribution: `${KX_LOCAL_DEM_ATTRIBUTION} · © <a href="https://www.maptiler.com/copyright/" target="_blank">MapTiler</a>`
      });
    }

    // Activar terreno
    mlMap.setTerrain({
      source: 'terrain-source',
      exaggeration: MAP_DEFAULTS.terrain.exaggeration
    });

    // Sin capa de sombreado propia: bajo la ortofoto no se veía y el topográfico ya trae la suya (kx-hillshade)

    mlIs3DEnabled = true;
    console.log('Terreno 3D activado');

  } catch (error) {
    console.error('Error al añadir terreno 3D:', error);
  }
}

// Ruta de la tesela de relieve propia que cubre z/x/y, o null si la zona no tiene MDT propio
function kxLocalDemTile(z, x, y) {
  for (const zone of (typeof KX_LOCAL_DEM !== 'undefined' ? KX_LOCAL_DEM : [])) {
    const r = zone.zooms[z];
    if (r && x >= r[0] && x <= r[1] && y >= r[2] && y <= r[3]) return `${zone.path}/${z}/${x}/${y}.webp`;
  }
  return null;
}

// Protocolo kxdem://z/x/y: sirve la tesela propia (MDT05 del IGN) si existe y, si no o si falla, la de MapTiler.
// Mismo formato en ambas (Terrain-RGB, 512 px), así MapLibre las mezcla sin notar el cambio de fuente.
let kxDemProtocolReady = false;
function kxRegisterDemProtocol() {
  if (kxDemProtocolReady) return;
  kxDemProtocolReady = true;
  maplibregl.addProtocol('kxdem', async (params, abortController) => {
    const [z, x, y] = params.url.replace('kxdem://', '').split('/').map(Number);
    const remote = `https://api.maptiler.com/tiles/terrain-rgb-v2/${z}/${x}/${y}?key=${MAPLIBRE_CONFIG.MAPTILER_KEY}`;
    const local = kxLocalDemTile(z, x, y);
    if (local) {
      try {
        const res = await fetch(local, { signal: abortController.signal });
        if (res.ok) return { data: await res.arrayBuffer() };
      } catch (e) {
        if (e.name === 'AbortError') throw e;
      }
    }
    const res = await fetch(remote, { signal: abortController.signal });
    if (!res.ok) throw new Error(`Relieve ${z}/${x}/${y}: HTTP ${res.status}`);
    return { data: await res.arrayBuffer() };
  });
}

/**
 * Quita el terreno 3D y el sombreado para volver a una vista totalmente plana
 */
function remove3DTerrain() {
  try {
    mlMap.setTerrain(null);
    if (mlMap.getLayer('hillshade-layer')) {
      mlMap.removeLayer('hillshade-layer');
    }
    mlIs3DEnabled = false;
  } catch (error) {
    console.error('Error al quitar terreno 3D:', error);
  }
}

/**
 * ============================================
 * CONTROL DE CÁMARA 3D POR GESTOS
 * ============================================
 * Cuando el modo 3D está activo, el drag controla:
 * - Vertical → Pitch (inclinación, máx 80°)
 * - Horizontal → Bearing (rotación, 360° libre)
 */

// Variables para el handler 3D
let ml3DModeActive = false;       // ¿Modo 3D activo?
let ml3DDragActive = false;       // ¿Arrastrando en modo 3D?
let ml3DStartX = 0;               // Posición inicial X
let ml3DStartY = 0;               // Posición inicial Y
let ml3DStartPitch = 0;           // Pitch al iniciar drag
let ml3DStartBearing = 0;         // Bearing al iniciar drag

// Sensibilidad del control (ajustar al gusto)
const ML3D_PITCH_SENSITIVITY = 0.5;    // Grados por píxel vertical
const ML3D_BEARING_SENSITIVITY = 0.5;  // Grados por píxel horizontal
const ML3D_MAX_PITCH = 80;             // Límite máximo de pitch

/**
 * Toggle terreno 3D con control por gestos
 */
function mlToggle3D() {
  if (!mlMap) return;

  ml3DModeActive = !ml3DModeActive;

  if (ml3DModeActive) {
    // Activar modo 3D
    console.log('🏔️ Modo 3D activado - Arrastra para controlar cámara');

    // Desactivar controles nativos de drag
    mlMap.dragRotate.disable();
    mlMap.dragPan.disable();

    // Activar handlers personalizados
    ml3DEnableHandlers();

    // Animar a vista inicial 3D
    mlMap.easeTo({
      pitch: 45,
      duration: 600
    });

  } else {
    // Desactivar modo 3D
    console.log('🗺️ Modo 2D activado - Control nativo');

    // Restaurar controles nativos
    mlMap.dragRotate.enable();
    mlMap.dragPan.enable();

    // Desactivar handlers personalizados
    ml3DDisableHandlers();

    // Volver a vista cenital
    mlMap.easeTo({
      pitch: 0,
      bearing: 0,
      duration: 600
    });
  }

  // Actualizar estado visual del botón (si existe)
  const btn3D = document.querySelector('.ml-terrain-btn, #btn-3d, [data-action="toggle3d"]');
  if (btn3D) {
    btn3D.classList.toggle('active', ml3DModeActive);
  }
}

/**
 * Activa los handlers de touch/mouse para control 3D
 */
function ml3DEnableHandlers() {
  const canvas = mlMap.getCanvas();

  // Touch events (móvil)
  canvas.addEventListener('touchstart', ml3DTouchStart, { passive: false });
  canvas.addEventListener('touchmove', ml3DTouchMove, { passive: false });
  canvas.addEventListener('touchend', ml3DTouchEnd, { passive: true });

  // Mouse events (desktop)
  canvas.addEventListener('mousedown', ml3DMouseDown);
  canvas.addEventListener('mousemove', ml3DMouseMove);
  canvas.addEventListener('mouseup', ml3DMouseUp);
  canvas.addEventListener('mouseleave', ml3DMouseUp);
}

/**
 * Desactiva los handlers de touch/mouse
 */
function ml3DDisableHandlers() {
  const canvas = mlMap.getCanvas();

  canvas.removeEventListener('touchstart', ml3DTouchStart);
  canvas.removeEventListener('touchmove', ml3DTouchMove);
  canvas.removeEventListener('touchend', ml3DTouchEnd);

  canvas.removeEventListener('mousedown', ml3DMouseDown);
  canvas.removeEventListener('mousemove', ml3DMouseMove);
  canvas.removeEventListener('mouseup', ml3DMouseUp);
  canvas.removeEventListener('mouseleave', ml3DMouseUp);
}

// ============================================
// HANDLERS TOUCH (Móvil)
// ============================================

function ml3DTouchStart(e) {
  if (!ml3DModeActive || e.touches.length !== 1) return;

  e.preventDefault();
  ml3DDragActive = true;

  ml3DStartX = e.touches[0].clientX;
  ml3DStartY = e.touches[0].clientY;
  ml3DStartPitch = mlMap.getPitch();
  ml3DStartBearing = mlMap.getBearing();
}

function ml3DTouchMove(e) {
  if (!ml3DDragActive || !ml3DModeActive) return;

  e.preventDefault();

  const deltaX = e.touches[0].clientX - ml3DStartX;
  const deltaY = e.touches[0].clientY - ml3DStartY;

  // Calcular nuevos valores
  // Drag hacia arriba (deltaY negativo) = aumentar pitch
  // Drag hacia derecha (deltaX positivo) = aumentar bearing
  let newPitch = ml3DStartPitch - (deltaY * ML3D_PITCH_SENSITIVITY);
  let newBearing = ml3DStartBearing + (deltaX * ML3D_BEARING_SENSITIVITY);

  // Limitar pitch entre 0 y máximo
  newPitch = Math.max(0, Math.min(ML3D_MAX_PITCH, newPitch));

  // Aplicar cambios sin animación (respuesta inmediata)
  mlMap.jumpTo({
    pitch: newPitch,
    bearing: newBearing
  });
}

function ml3DTouchEnd() {
  ml3DDragActive = false;
}

// ============================================
// HANDLERS MOUSE (Desktop)
// ============================================

function ml3DMouseDown(e) {
  if (!ml3DModeActive || e.button !== 0) return; // Solo botón izquierdo

  e.preventDefault();
  ml3DDragActive = true;

  ml3DStartX = e.clientX;
  ml3DStartY = e.clientY;
  ml3DStartPitch = mlMap.getPitch();
  ml3DStartBearing = mlMap.getBearing();
}

function ml3DMouseMove(e) {
  if (!ml3DDragActive || !ml3DModeActive) return;

  const deltaX = e.clientX - ml3DStartX;
  const deltaY = e.clientY - ml3DStartY;

  let newPitch = ml3DStartPitch - (deltaY * ML3D_PITCH_SENSITIVITY);
  let newBearing = ml3DStartBearing + (deltaX * ML3D_BEARING_SENSITIVITY);

  newPitch = Math.max(0, Math.min(ML3D_MAX_PITCH, newPitch));

  mlMap.jumpTo({
    pitch: newPitch,
    bearing: newBearing
  });
}

function ml3DMouseUp() {
  ml3DDragActive = false;
}

// Exponer estado para uso externo
window.ml3DModeActive = () => ml3DModeActive;

// ============================================
// CARGA DE ESCUELAS
// ============================================

/**
 * Carga una escuela (Vector Tiles o GeoJSON)
 * @param {string} schoolId - ID de la escuela
 * @param {boolean} skipFlyTo - Si es true, no hace flyTo (útil cuando ya se hizo antes)
 */
async function mlLoadSchool(schoolId, skipFlyTo = false) {
  const school = MAPLIBRE_SCHOOLS[schoolId];
  if (!school) {
    // Puede ser una escuela pendiente creada por el Spotter
    const pendingSchool = mlPendingSchoolsCache.get(schoolId);
    if (pendingSchool) {
      await mlLoadPendingSchool(schoolId, pendingSchool.coordinates, skipFlyTo);
      return;
    }
    console.error('Escuela no encontrada:', schoolId);
    return;
  }

  console.log(`Cargando escuela: ${school.name}`);

  // Limpiar capas anteriores
  mlClearSchoolLayers();

  mlCurrentSchool = schoolId;

  // Decidir si usar Vector Tiles o GeoJSON
  const useVectorTiles = typeof USE_VECTOR_TILES !== 'undefined' && USE_VECTOR_TILES && school.tiles;

  try {
    if (useVectorTiles) {
      console.log('Usando Vector Tiles para mejor rendimiento');
      await mlLoadSchoolVectorTiles(school);
    } else {
      console.log('Usando GeoJSON (fallback)');
      await mlLoadSchoolGeoJSON(school);
    }

    // Centrar mapa en la escuela (solo si no se omitió)
    if (!skipFlyTo) {
      mlMap.flyTo({
        center: school.center,
        essential: true
      });
    }

    console.log(`Escuela ${school.name} cargada correctamente`);

    // Re-aplicar filtro de grados si había uno activo
    applyGradeFilter();

  } catch (error) {
    console.error('Error cargando escuela:', error);
    // Fallback a GeoJSON si falla Vector Tiles
    if (useVectorTiles) {
      console.log('Fallback a GeoJSON...');
      await mlLoadSchoolGeoJSON(school);
      applyGradeFilter();
    }
  }
}

/**
 * Carga escuela usando Vector Tiles (.pbf)
 */
async function mlLoadSchoolVectorTiles(school) {
  // Cargar sectores (líneas) con estilo casing (borde oscuro + línea principal)
  if (school.tiles.sectores) {
    mlMap.addSource('sectores-source', {
      type: 'vector',
      tiles: [window.location.origin + '/' + school.tiles.sectores],
      minzoom: school.zoomLevels.sectores,
      maxzoom: 20,
      promoteId: { sectores: 'fid' }
    });
    mlLoadedSources.add('sectores-source');

    // Capa de casing (borde oscuro exterior) - color dinámico por sector
    mlMap.addLayer({
      id: 'sectores-casing-layer',
      type: 'line',
      source: 'sectores-source',
      'source-layer': 'sectores',
      minzoom: school.zoomLevels.sectores,
      layout: {
        'line-cap': 'round',
        'line-join': 'round'
      },
      paint: kxSectorCasingPaint()
    });

    // Capa principal - color dinámico por sector
    mlMap.addLayer({
      id: 'sectores-layer',
      type: 'line',
      source: 'sectores-source',
      'source-layer': 'sectores',
      minzoom: school.zoomLevels.sectores,
      layout: {
        'line-cap': 'round',
        'line-join': 'round'
      },
      paint: kxSectorLinePaint()
    });
    kxAddSectorLabels('sectores-source', 'sectores-labels-layer', school.zoomLevels.sectorNames || 16, 'sectores');
    kxAddSectorHitLayer('sectores-source', 'sectores-hit-layer', school.zoomLevels.sectores, 'sectores');
  }

  // Cargar vías (círculos)
  if (school.tiles.vias) {
    mlMap.addSource('vias-source', {
      type: 'vector',
      tiles: [window.location.origin + '/' + school.tiles.vias],
      minzoom: school.zoomLevels.vias,
      maxzoom: 20
    });
    mlLoadedSources.add('vias-source');

    mlMap.addLayer({
      id: 'vias-layer',
      type: 'circle',
      source: 'vias-source',
      'source-layer': 'vias',
      minzoom: school.zoomLevels.vias,
      paint: kxRoutePaint()
    });
    kxAddRouteShadow('vias-source', school.zoomLevels.vias, 'vias');

    // Añadir interactividad
    setupViasInteraction();
    setupSectoresInteraction();

    // Cargar GeoJSON en paralelo solo para construir el índice de variantes
    // (las tiles PBF no permiten pre-procesamiento de features)
    if (school.geojson && school.geojson.vias) {
      fetch(school.geojson.vias)
        .then(r => r.ok ? r.json() : null)
        .then(geojson => {
          if (geojson && geojson.features) {
            mlBuildVariantGroupsIndex(geojson.features);
            // Ocultar variantes del circle layer y crear marcadores concéntricos
            applyGradeFilter(); // re-aplica filtro incluyendo exclusión de variantes
            mlCreateVariantMarkers();
          }
        })
        .catch(e => console.warn('Error loading variant index for tiles path:', e));
    }
  }

  // Cargar parkings (símbolos)
  if (school.tiles.parkings) {
    mlMap.addSource('parkings-source', {
      type: 'vector',
      tiles: [window.location.origin + '/' + school.tiles.parkings],
      minzoom: school.zoomLevels.parkings,
      maxzoom: 20
    });
    mlLoadedSources.add('parkings-source');

    mlMap.addLayer({
      id: 'parkings-layer',
      type: 'symbol',
      source: 'parkings-source',
      'source-layer': 'parkings',
      minzoom: school.zoomLevels.parkings,
      layout: {
        'icon-image': 'parking-icon',
        'icon-size': ['interpolate', ['linear'], ['zoom'], 15, 0.82, 18, 1],
        'icon-allow-overlap': true
      }
    });

    // Añadir interactividad a parkings
    setupParkingsInteraction();
  }

  // Cargar puntos de interés desde GeoJSON estático
  if (school.geojson && school.geojson.puntosInteres) {
    await mlLoadPuntosInteres(school.geojson.puntosInteres);
  }

  // Cargar vías aprobadas desde Firestore
  await loadApprovedRoutesFromFirestore(school.id, school.zoomLevels.vias);

  // Cargar sectores aprobados desde Firestore
  await loadApprovedSectorsFromFirestore(school.id);

  // Cargar POIs aprobados desde Firestore
  await loadApprovedPOIFromFirestore(school.id);

  // Cargar ítems pendientes según rol
  checkAdminRole().then(role => {
    if (role === 'admin') {
      loadAllPendingForAdmin(school.id, school.zoomLevels?.vias || 14);
    } else if (role === 'spotter') {
      loadMyPendingRoutesFromFirestore(school.id, school.zoomLevels?.vias || 14);
      loadMyPendingPOIFromFirestore(school.id);
      loadMyPendingSectorsFromFirestore(school.id);
    }
  });
}

/**
 * Carga escuela usando GeoJSON (fallback)
 */
async function mlLoadSchoolGeoJSON(school) {
  // Lanzar suscripciones Firestore inmediatamente — independientes del GeoJSON estático
  const firestoreLoads = [
    loadApprovedRoutesFromFirestore(school.id, school.zoomLevels?.vias || 14),
    loadApprovedSectorsFromFirestore(school.id),
    loadApprovedPOIFromFirestore(school.id)
  ];

  // Items pendientes según rol: fire and forget
  checkAdminRole().then(role => {
    if (role === 'admin') {
      loadAllPendingForAdmin(school.id, school.zoomLevels?.vias || 14);
    } else if (role === 'spotter') {
      loadMyPendingRoutesFromFirestore(school.id, school.zoomLevels?.vias || 14);
      loadMyPendingPOIFromFirestore(school.id);
      loadMyPendingSectorsFromFirestore(school.id);
    }
  });

  // Sectores
  const sectoresLoad = school.geojson.sectores ? (async () => {
    try {
      const response = await fetch(school.geojson.sectores);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const geojson = await response.json();

      // Generar FIDs numéricos si no existen para coloreado dinámico
      if (geojson.features) {
        geojson.features.forEach((f, i) => {
          if (f.properties.fid == null || f.properties.fid === '') {
            const name = f.properties.nombre || f.properties.name || `sector-${i}`;
            let hash = 0;
            for (let j = 0; j < name.length; j++) { hash = ((hash << 5) - hash) + name.charCodeAt(j); hash |= 0; }
            f.properties.fid = Math.abs(hash);
          }
        });
        kxAssignSectorColors(geojson.features);
      }

      mlMap.addSource('sectores-source', { type: 'geojson', data: geojson, generateId: true });
      mlLoadedSources.add('sectores-source');
      mlMap.addLayer({
        id: 'sectores-casing-layer', type: 'line', source: 'sectores-source',
        minzoom: school.zoomLevels.sectores,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: kxSectorCasingPaint()
      });
      mlMap.addLayer({
        id: 'sectores-layer', type: 'line', source: 'sectores-source',
        minzoom: school.zoomLevels.sectores,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: kxSectorLinePaint()
      });
      kxAddSectorHitLayer('sectores-source', 'sectores-hit-layer', school.zoomLevels.sectores);
      console.log(`Capa sectores cargada: ${geojson.features?.length || 0} elementos`);
      // La interacción se registra aquí, cuando la capa ya existe (la carga de vías corre en paralelo)
      setupSectoresInteraction();
    } catch (error) {
      console.error('Error cargando sectores:', error);
    }
  })() : Promise.resolve();

  // Vías (setupViasInteraction necesita la capa, se llama dentro)
  const viasLoad = school.geojson.vias ? (async () => {
    await mlLoadGeoJSONLayer(
      'vias', school.geojson.vias, 'circle',
      kxRoutePaint(),
      school.zoomLevels.vias, {}, mlProcessVariantsForGeoJSON
    );
    kxAddRouteShadow('vias-source', school.zoomLevels.vias);
    setupViasInteraction();
  })() : Promise.resolve();

  // Parkings
  const parkingsLoad = school.geojson.parkings ? (async () => {
    await mlLoadGeoJSONLayer(
      'parkings', school.geojson.parkings, 'symbol', {},
      school.zoomLevels.parkings,
      { 'icon-image': 'parking-icon', 'icon-size': ['interpolate', ['linear'], ['zoom'], 15, 0.82, 18, 1], 'icon-allow-overlap': true }
    );
    setupParkingsInteraction();
  })() : Promise.resolve();

  // Todo en paralelo: GeoJSON estáticos + Firestore + POIs + rutas de acceso
  await Promise.all([
    sectoresLoad,
    viasLoad,
    parkingsLoad,
    school.geojson.puntosInteres ? mlLoadPuntosInteres(school.geojson.puntosInteres) : Promise.resolve(),
    school.geojson.rutasAcceso ? mlLoadRutasAcceso(school.geojson.rutasAcceso) : Promise.resolve(),
    ...firestoreLoads
  ]);

  // Deja en memoria las vías completas de la escuela: la ficha de sector y el visor de fotos las tienen al instante
  kxSchoolRouteFeatures(school.id).catch(() => {});

  // Con sectores y vías ya cargados, cada nombre se coloca al lado de su línea donde no hay vías
  if (mlCurrentSchool === school.id) {
    kxRefreshSectorLabels('sectores-source');
    if (mlMap.getSource('sectores-usuarios-source')) kxRefreshSectorLabels('sectores-usuarios-source');
  }
}

/**
 * Carga las rutas de acceso con estilo de línea naranja intermitente
 */
async function mlLoadRutasAcceso(url) {
  const sourceId = 'rutas-acceso-source';
  const layerId = 'rutas-acceso-layer';

  const urlWithCache = url;

  try {
    const response = await fetch(urlWithCache);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const geojson = await response.json();

    // Añadir source
    if (mlMap.getSource(sourceId)) {
      mlMap.removeSource(sourceId);
    }
    mlMap.addSource(sourceId, {
      type: 'geojson',
      data: geojson
    });
    mlLoadedSources.add(sourceId);

    // Añadir capa con línea naranja intermitente (dashed)
    // Los POI y parkings van siempre por encima de los caminos, se carguen antes o después que ellos
    const aboveRoutes = ['parkings-layer', 'puntos-interes-layer', 'poi-usuarios-layer'].find(id => mlMap.getLayer(id));
    mlMap.addLayer({
      id: layerId,
      type: 'line',
      source: sourceId,
      minzoom: 12,
      layout: {
        'line-cap': 'round',
        'line-join': 'round'
      },
      paint: {
        'line-color': KX_MAP.access,  // Naranja
        'line-width': [
          'interpolate', ['linear'], ['zoom'],
          12, 1.6,
          14, 2.2,
          16, 3,
          18, 3.6
        ],
        'line-opacity': ['interpolate', ['linear'], ['zoom'], 12, 0.7, 13.5, 0.95],
        'line-dasharray': [1.4, 1.6]  // Línea intermitente (dash, gap)
      }
    }, aboveRoutes);

    console.log(`Capa rutas de acceso cargada: ${geojson.features?.length || 0} elementos`);

  } catch (error) {
    console.error('Error cargando rutas de acceso:', error);
  }
}

// ============================================
// MAPA DE SVGs PARA PUNTOS DE INTERÉS
// ============================================
const POI_SVG_MAP = {
  'albergue': { color: '#1565c0', svg: '<path d="M3 17V8L10 3L17 8V17"/><rect x="7" y="12" width="6" height="5"/>' },
  'hotel': { color: '#1565c0', svg: '<rect x="4" y="4" width="12" height="14" stroke="white" stroke-width="1.4"/><rect x="6" y="6" width="2" height="2" fill="white" stroke="none"/><rect x="10" y="6" width="2" height="2" fill="white" stroke="none"/><rect x="6" y="10" width="2" height="2" fill="white" stroke="none"/><rect x="10" y="10" width="2" height="2" fill="white" stroke="none"/><rect x="8" y="14" width="4" height="4" fill="white" stroke="none"/>' },
  'refugio': { color: '#1565c0', svg: '<path d="M3 17V10L10 5L17 10V17"/><rect x="7" y="13" width="6" height="4"/><circle cx="10" cy="9" r="1.5" fill="white" stroke="none"/>' },
  'vivac': { color: '#1565c0', svg: '<path d="M3 17V12L10 6L17 12V17"/><path d="M10 6V3"/><rect x="7" y="12" width="6" height="5"/>' },
  'camping': { color: '#1565c0', svg: '<path d="M10 4L3 16H17L10 4Z"/><path d="M10 4L3 16H17L10 4Z" fill="white" fill-opacity="0.15" stroke="white" stroke-width="1.4"/><path d="M8 16V12C8 10.9 8.9 10 10 10C11.1 10 12 10.9 12 12V16" stroke="white" stroke-width="1.4" fill="none"/>' },
  'peligro': { color: '#cc2200', svg: '<path d="M10 3L2 17H18L10 3Z"/><line x1="10" y1="9" x2="10" y2="13"/><circle cx="10" cy="15.5" r="0.9" fill="white" stroke="none"/>' },
  'hospital': { color: '#cc2200', svg: '<rect x="8" y="3" width="4" height="14" fill="white" stroke="none"/><rect x="3" y="8" width="14" height="4" fill="white" stroke="none"/>' },
  'bomberos': { color: '#cc2200', svg: '<path d="M10 17C10 17 5 14 5 9C5 9 7 11 8 10C8 10 7 7 10 4C10 4 10 7 12 8C12 8 11 5 13 5C13 5 16 8 15 12C15 14 13 16 10 17Z" fill="white" stroke="white" stroke-width="0.8"/><path d="M10 17C10 17 8 15 8 12C8 11 9 12 10 12C11 12 12 11 12 12C12 15 10 17 10 17Z" fill="#cc2200" stroke="none"/>' },
  'farmacia': { color: '#cc2200', svg: '<rect x="9" y="4" width="2" height="12" fill="white" stroke="none"/><rect x="4" y="9" width="12" height="2" fill="white" stroke="none"/>' },
  'policia': { color: '#cc2200', svg: '<circle cx="10" cy="10" r="6"/><circle cx="10" cy="10" r="2.5"/><line x1="10" y1="4" x2="10" y2="6"/><line x1="10" y1="14" x2="10" y2="16"/><line x1="4" y1="10" x2="6" y2="10"/><line x1="14" y1="10" x2="16" y2="10"/>' },
  'cumbre': { color: '#2e7d32', svg: '<path d="M10 3L3 16H17L10 3Z"/><path d="M7 16L10 10L13 16"/><circle cx="10" cy="6" r="0.8" fill="white" stroke="none"/>' },
  'rio': { color: '#2e7d32', svg: '<path d="M3 12C6 12 6 7 10 7C14 7 14 12 17 12"/><path d="M3 15C6 15 6 10 10 10C14 10 14 15 17 15"/>' },
  'arroyo': { color: '#2e7d32', svg: '<path d="M3 13C6 13 6 9 10 9C14 9 14 13 17 13"/><line x1="3" y1="16" x2="17" y2="16"/>' },
  'agua': { color: '#2e7d32', svg: '<path d="M10 3C10 3 6 8 6 12C6 15 8 17 10 17C12 17 14 15 14 12C14 8 10 3 10 3Z"/><path d="M8 13C9 14 11 14 12 13"/>' },
  'fuente': { color: '#0277BD', svg: '<path d="M10 4C10 4 7 7 7 10H13C13 7 10 4 10 4Z"/><line x1="10" y1="10" x2="10" y2="14"/><line x1="7" y1="14" x2="13" y2="14"/><path d="M7 14C7 16 9 17 10 17C11 17 13 16 13 14"/>' },
  'cueva': { color: '#2e7d32', svg: '<path d="M3 16C3 16 3 9 10 9C17 9 17 16 17 16"/><path d="M3 16H17"/><path d="M10 9V6"/><path d="M8 7L12 5M8 9L12 7" stroke-dasharray="0"/>' },
  'restaurante': { color: '#e65100', svg: '<path d="M6 3V9C6 12 8 13 10 13C12 13 14 12 14 9V3"/><line x1="10" y1="13" x2="10" y2="17"/><line x1="7" y1="17" x2="13" y2="17"/><line x1="6" y1="7" x2="14" y2="7" stroke-dasharray="2 1"/>' },
  'gasolinera': { color: '#e65100', svg: '<rect x="3" y="7" width="10" height="10"/><line x1="3" y1="11" x2="13" y2="11"/><path d="M13 9H15C16 9 17 10 17 11V14C17 15 16 15 16 15"/><line x1="16" y1="15" x2="16" y2="17"/><rect x="5" y="13" width="6" height="4" fill="white" stroke="none"/>' },
  'bar': { color: '#e65100', svg: '<rect x="5" y="9" width="10" height="8" rx="1"/><path d="M5 13H15"/><path d="M7 9V7C7 5 9 4 10 4C11 4 13 5 13 7V9"/>' },
  'merendero': { color: '#e65100', svg: '<rect x="3" y="6" width="14" height="10" rx="0.5"/><line x1="3" y1="10" x2="17" y2="10"/><line x1="10" y1="4" x2="10" y2="6"/><rect x="7" y="12" width="6" height="4" rx="0.5"/>' },
  'tienda': { color: '#e65100', svg: '<rect x="3" y="7" width="14" height="10" rx="0.5"/><path d="M3 7L5 3H15L17 7"/><line x1="3" y1="11" x2="17" y2="11"/><rect x="8" y="13" width="4" height="4"/>' },
  'puente': { color: '#37474f', svg: '<line x1="3" y1="9" x2="17" y2="9"/><line x1="3" y1="14" x2="17" y2="14"/><line x1="5" y1="9" x2="5" y2="14"/><line x1="10" y1="9" x2="10" y2="14"/><line x1="15" y1="9" x2="15" y2="14"/><path d="M3 9C5 9 5 5 10 5C15 5 15 9 17 9"/>' },
  'escalera': { color: '#37474f', svg: '<path d="M4 17L4 13L8 13L8 9L12 9L12 5L17 5"/><line x1="4" y1="17" x2="17" y2="17"/>' },
  'mirador': { color: '#37474f', svg: '<path d="M3 10C3 10 6 5 10 5C14 5 17 10 17 10C17 10 14 15 10 15C6 15 3 10 3 10Z" fill="none" stroke="white" stroke-width="1.5"/><circle cx="10" cy="10" r="2.5" fill="white" stroke="none"/><circle cx="10" cy="10" r="1.2" fill="#37474f" stroke="none"/>' },
  'parking': { color: '#37474f', svg: '<text x="6" y="15" font-size="13" font-weight="bold" fill="white" font-family="Arial, sans-serif" stroke="none">P</text>' },
  'correos': { color: '#37474f', svg: '<rect x="3" y="6" width="14" height="10" rx="0.5"/><path d="M3 6L10 12L17 6" fill="none"/>' },
  'informacion': { color: '#37474f', svg: '<circle cx="10" cy="10" r="7"/><line x1="10" y1="9" x2="10" y2="14"/><circle cx="10" cy="6.5" r="0.9" fill="white" stroke="none"/>' },
  'iglesia': { color: '#6a1b9a', svg: '<path d="M4 17V9L10 6L16 9V17"/><rect x="8" y="12" width="4" height="5"/><line x1="10" y1="2" x2="10" y2="7"/><line x1="7.5" y1="4" x2="12.5" y2="4"/>' },
  'ermita': { color: '#6a1b9a', svg: '<path d="M5 17V10L10 7L15 10V17"/><rect x="8" y="13" width="4" height="4"/><line x1="10" y1="3" x2="10" y2="8"/><line x1="8" y1="5" x2="12" y2="5"/>' },
  'ruina': { color: '#6a1b9a', svg: '<rect x="4" y="5" width="12" height="12" rx="0.5"/><line x1="4" y1="9" x2="16" y2="9"/><line x1="4" y1="13" x2="16" y2="13"/><line x1="8" y1="5" x2="8" y2="17"/><line x1="12" y1="5" x2="12" y2="17"/>' },
  'wc': { color: '#00695c', svg: '<circle cx="6.5" cy="5" r="1.5" fill="white" stroke="none"/><line x1="6.5" y1="6.5" x2="6.5" y2="12"/><line x1="4" y1="9" x2="9" y2="9"/><line x1="6.5" y1="12" x2="4.5" y2="16"/><line x1="6.5" y1="12" x2="8.5" y2="16"/><circle cx="13.5" cy="5" r="1.5" fill="white" stroke="none"/><path d="M11 9L13.5 6.5L16 9L14.5 16H12.5L11 9Z" fill="white" stroke="none"/>' },
  'ducha': { color: '#00695c', svg: '<path d="M5 5C5 5 7 5 9 7" stroke-width="1.8" fill="none"/><ellipse cx="11" cy="8.5" rx="3.5" ry="2" transform="rotate(-45 11 8.5)" fill="none" stroke="white" stroke-width="1.4"/><line x1="8" y1="12" x2="8" y2="15"/><line x1="11" y1="13" x2="11" y2="16"/><line x1="14" y1="12" x2="14" y2="15"/>' },
  'piscina': { color: '#00695c', svg: '<rect x="3" y="6" width="14" height="10" rx="0.5"/><path d="M3 11C5 11 5 9 7.5 9C10 9 10 11 12.5 11C15 11 15 9 17 9" fill="none" stroke="white" stroke-width="1.4"/><path d="M3 14C5 14 5 12 7.5 12C10 12 10 14 12.5 14C15 14 15 12 17 12" fill="none" stroke="white" stroke-width="1.4"/>' },
  'telefono': { color: '#00695c', svg: '<path d="M6 4H9L10 7L8.5 8.5C9.5 10.5 11.5 12 13.5 13L15 11.5L18 12.5V15.5C18 16.5 17 17 16 17C9 17 3 11 3 4C3 3 3.5 2 4.5 2H7.5L6 4Z" stroke-width="1.3"/>' },
  'banco': { color: '#F99D04', svg: '<rect x="3" y="14" width="14" height="2" fill="white" stroke="none"/><rect x="3" y="5" width="14" height="2" fill="white" stroke="none"/><rect x="5" y="7" width="2" height="7" fill="white" stroke="none"/><rect x="9" y="7" width="2" height="7" fill="white" stroke="none"/><rect x="13" y="7" width="2" height="7" fill="white" stroke="none"/>' }
};

// Versión de los iconos (incrementar al actualizar para forzar recarga del cache)
const POI_ICONS_VERSION = '17';

// Iconos de puntos de interés (pack «KRUX POI matte»): disco mate de la categoría, borde blanco y pictograma blanco.
// Un SVG propio por tipo; la paleta de los POI es independiente de la de grados y sectores.
const POI_SVG_FILES = {
  'albergue': 'assets/poi-icons/albergue.svg',
  'hotel': 'assets/poi-icons/hotel.svg',
  'refugio': 'assets/poi-icons/refugio.svg',
  'vivac': 'assets/poi-icons/vivac.svg',
  'camping': 'assets/poi-icons/camping.svg',
  'peligro': 'assets/poi-icons/peligro.svg',
  'hospital': 'assets/poi-icons/hospital.svg',
  'bomberos': 'assets/poi-icons/bomberos.svg',
  'farmacia': 'assets/poi-icons/farmacia.svg',
  'policia': 'assets/poi-icons/policia.svg',
  'cumbre': 'assets/poi-icons/cumbre.svg',
  'rio': 'assets/poi-icons/rio.svg',
  'arroyo': 'assets/poi-icons/arroyo.svg',
  'agua': 'assets/poi-icons/agua.svg',
  'fuente': 'assets/poi-icons/fuente.svg',
  'cueva': 'assets/poi-icons/cueva.svg',
  'restaurante': 'assets/poi-icons/restaurante.svg',
  'gasolinera': 'assets/poi-icons/gasolinera.svg',
  'bar': 'assets/poi-icons/bar.svg',
  'merendero': 'assets/poi-icons/merendero.svg',
  'tienda': 'assets/poi-icons/tienda.svg',
  'puente': 'assets/poi-icons/puente.svg',
  'escalera': 'assets/poi-icons/escalera.svg',
  'mirador': 'assets/poi-icons/mirador.svg',
  'parking': 'assets/poi-icons/parking.svg',
  'correos': 'assets/poi-icons/correos.svg',
  'informacion': 'assets/poi-icons/informacion.svg',
  'iglesia': 'assets/poi-icons/iglesia.svg',
  'ermita': 'assets/poi-icons/ermita.svg',
  'ruina': 'assets/poi-icons/ruina.svg',
  'wc': 'assets/poi-icons/wc.svg',
  'ducha': 'assets/poi-icons/ducha.svg',
  'piscina': 'assets/poi-icons/piscina.svg',
  'telefono': 'assets/poi-icons/telefono.svg',
  'banco': 'assets/poi-icons/banco.svg',
  'bombero': 'assets/poi-icons/bomberos.svg',   // alias
};

/**
 * Obtiene el color y SVG correspondiente a un tipo de punto de interés
 */
function getPOISVG(descripcion) {
  if (!descripcion) return { color: '#37474f', svg: '<circle cx="10" cy="10" r="3" fill="white"/>' };
  const desc = descripcion.toLowerCase().trim();
  return POI_SVG_MAP[desc] || { color: '#37474f', svg: '<circle cx="10" cy="10" r="3" fill="white"/>' };
}

// Caché global: reutiliza iconos ya renderizados dentro de la sesión
const _mlPoiIconCache = new Map();

/**
 * Precalienta los iconos POI más comunes usando tiempo libre del navegador.
 * Así están listos en caché cuando el usuario abre una escuela.
 */
function _mlPrewarmPOIIcons() {
  const types = ['parking', 'camping', 'vivac', 'mirador', 'fuente', 'restaurante', 'bar', 'hotel', 'refugio', ''];
  const schedule = typeof requestIdleCallback !== 'undefined'
    ? (cb) => requestIdleCallback(cb, { timeout: 5000 })
    : (cb) => setTimeout(cb, 2000);
  schedule(() => { types.forEach(t => createSVGPinImage(t).catch(() => {})); });
}

/**
 * Genera una imagen de pin SVG con color y icono para usar como icono en MapLibre.
 * Si hay SVG externo disponible en POI_SVG_FILES, lo usa directamente.
 * El resultado se cachea en memoria para evitar re-renderizado al cambiar de escuela.
 */
// DPR del dispositivo, limitado a 3 para no desperdiciar memoria
const _mlDPR = Math.min(Math.ceil(window.devicePixelRatio || 1), 3);

function createSVGPinImage(poiType) {
  const cacheKey = (poiType || '').toLowerCase().trim() || '__default__';
  if (_mlPoiIconCache.has(cacheKey)) return Promise.resolve(_mlPoiIconCache.get(cacheKey));
  return _createSVGPinImageRaw(poiType).then(img => {
    _mlPoiIconCache.set(cacheKey, img);
    return img;
  });
}

// Los POI son insignias circulares: se rasterizan a 32 px CSS (a la densidad real de la pantalla) y se anclan por el centro
const POI_ICON_CSS_SIZE = 32;

// URL de la insignia de un tipo de POI (para usarla como <img> fuera del mapa 2D)
function kxPoiIconSrc(poiType) {
  const desc = (poiType || '').toLowerCase().trim();
  const file = POI_SVG_FILES[desc];
  return file ? file + '?v=' + POI_ICONS_VERSION : 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(kxPOISVG(desc));
}

function _createSVGPinImageRaw(poiType) {
  const desc = (poiType || '').toLowerCase().trim();
  const file = POI_SVG_FILES[desc];
  // Tipo sin icono propio: insignia genérica dibujada en código (color de categoría o gris)
  const src = file
    ? file + '?v=' + POI_ICONS_VERSION
    : 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(kxPOISVG(desc));
  return _kxPOIBadgeImage(desc, src);
}

// Los iconos llegan después de crear la capa: sin este refresco, un icono que llega tarde deja el genérico en pantalla
function kxReloadSourceData(sourceId) {
  const src = mlMap && mlMap.getSource(sourceId);
  const data = src && src.serialize && src.serialize().data;
  if (data) src.setData(data);
}

function _kxPOIBadgeImage(poiType, src) {
  const px = Math.round(POI_ICON_CSS_SIZE * _mlDPR);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onerror = () => reject(new Error(`Failed to load image for POI type "${poiType}"`));
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = px; c.height = px;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0, px, px);
        resolve({ data: ctx.getImageData(0, 0, px, px).data, width: px, height: px });
      } catch (e) { reject(e); }
    };
    img.src = src;
  });
}

// Zoom mínimo de los POI: cada escuela puede bajarlo con zoomLevels.puntosInteres (p. ej. La Pedriza,
// que es muy grande); sin valor se mantiene el de siempre.
function kxPoiMinZoom(schoolId, fallback) {
  const school = typeof MAPLIBRE_SCHOOLS !== 'undefined' ? MAPLIBRE_SCHOOLS[schoolId] : null;
  const z = school && school.zoomLevels ? school.zoomLevels.puntosInteres : null;
  return Number.isFinite(z) ? z : fallback;
}
function kxPoiIconSize(minZoom, startSize) {
  const z0 = Math.min(minZoom, 15);
  return ['interpolate', ['linear'], ['zoom'], z0, startSize, 16, 0.9, 18, 1, 20, 1.12];
}
// Reajusta una capa de POI que ya existía (venía de otra escuela) al zoom de la actual.
function kxApplyPoiZoom(layerId, schoolId, fallback, startSize) {
  if (!mlMap || !mlMap.getLayer(layerId)) return;
  const mz = kxPoiMinZoom(schoolId, fallback);
  mlMap.setLayerZoomRange(layerId, mz, 24);
  mlMap.setLayoutProperty(layerId, 'icon-size', kxPoiIconSize(mz, startSize));
}

/**
 * Carga los puntos de interés con pins SVG diferenciados por tipo y color.
 */
async function mlLoadPuntosInteres(url) {
  const sourceId = 'puntos-interes-source';
  const layerId = 'puntos-interes-layer';

  const urlWithCache = url;

  try {
    const response = await fetch(urlWithCache);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const geojson = await response.json();

    // Verificar que hay features
    if (!geojson.features || geojson.features.length === 0) {
      console.log('Puntos de interés: sin elementos');
      return;
    }

    // Recoger tipos únicos de POI y registrar como imágenes en el mapa
    const usedPOITypes = new Set();
    geojson.features.forEach(f => {
      const desc = f.properties.descripcio || f.properties.descripcion || f.properties.Descripcion || f.properties.tipo || '';
      f.properties._poiType = desc;
      f.properties._svgIcon = 'poi-svg-' + desc.toLowerCase().trim();
      usedPOITypes.add(desc.toLowerCase().trim());
    });

    // Remover capas/fuentes anteriores
    if (mlMap.getLayer(layerId)) mlMap.removeLayer(layerId);
    if (mlMap.getSource(sourceId)) mlMap.removeSource(sourceId);

    mlMap.addSource(sourceId, { type: 'geojson', data: geojson });
    mlLoadedSources.add(sourceId);

    // Añadir capa INMEDIATAMENTE con fallback al icono por defecto
    // MapLibre re-renderiza automáticamente cuando se registra cada icono con addImage()
    mlMap.addLayer({
      id: layerId,
      type: 'symbol',
      source: sourceId,
      minzoom: kxPoiMinZoom(mlCurrentSchool, 14),
      layout: {
        'icon-image': ['coalesce', ['image', ['get', '_svgIcon']], ['image', 'poi-svg-default']],
        'icon-size': kxPoiIconSize(kxPoiMinZoom(mlCurrentSchool, 14), 0.78),
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'icon-anchor': 'center'
      }
    });

    // Cargar iconos en background — no bloquear la aparición de la capa
    const typesToLoad = [...usedPOITypes].filter(t => !mlMap.hasImage('poi-svg-' + t));
    if (!mlMap.hasImage('poi-svg-default')) typesToLoad.push('');
    Promise.all(typesToLoad.map(async poiType => {
      try {
        const img = await createSVGPinImage(poiType);
        const imgId = poiType === '' ? 'poi-svg-default' : 'poi-svg-' + poiType;
        if (!mlMap.hasImage(imgId)) mlMap.addImage(imgId, img, { sdf: false, pixelRatio: _mlDPR });
      } catch (err) {
        console.warn(`Error creating SVG for POI type "${poiType}":`, err);
      }
    })).then(() => { if (typesToLoad.length) kxReloadSourceData(sourceId); });

    // Interactividad: mostrar popup con descripción al hacer click
    let mlPoiPopup = null;
    let mlPoiPopupCoords = null;

    // Auto-cerrar POI popup al alejarse (zoom out o desplazamiento)
    function checkPoiPopupDistance() {
      if (!mlPoiPopup || !mlPoiPopupCoords) return;
      const popupPoint = mlMap.project(mlPoiPopupCoords);
      const center = mlMap.project(mlMap.getCenter());
      const dx = popupPoint.x - center.x;
      const dy = popupPoint.y - center.y;
      const distPx = Math.sqrt(dx * dx + dy * dy);
      // Cerrar si el POI queda fuera del viewport visible (margen generoso)
      const canvas = mlMap.getCanvas();
      const maxDist = Math.max(canvas.width, canvas.height) * 0.45;
      if (distPx > maxDist || mlMap.getZoom() < 13.5) {
        mlPoiPopup.remove();
        mlPoiPopup = null;
        mlPoiPopupCoords = null;
      }
    }

    mlMap.on('moveend', checkPoiPopupDistance);
    mlMap.on('zoomend', checkPoiPopupDistance);

    mlMap.on('click', layerId, (e) => {
      if (!e.features || e.features.length === 0) return;
      const props = e.features[0].properties;
      const coords = e.features[0].geometry.coordinates.slice();
      const desc = props._poiType || 'Punto de interés';
      const nombre = props.Nombre || props.nombre || '';

      // Ajustar coordenadas si es MultiPoint
      while (Math.abs(e.lngLat.lng - coords[0]) > 180) {
        coords[0] += e.lngLat.lng > coords[0] ? 360 : -360;
      }

      // Cerrar popup anterior si existe
      if (mlPoiPopup) {
        mlPoiPopup.remove();
        mlPoiPopup = null;
      }

      const descCapitalized = desc.charAt(0).toUpperCase() + desc.slice(1);
      const poiLat = coords[1];
      const poiLng = coords[0];
      const poiGmapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${poiLat},${poiLng}`;
      const poiBtnId = `poi-directions-${Date.now()}`;

      mlPoiPopup = new maplibregl.Popup({ offset: 18, closeButton: false, className: 'poi-popup' })
        .setLngLat(coords)
        .setHTML(`
          <div class="poi-popup-content">
            <div class="poi-popup-info">
              <div class="poi-popup-type">${descCapitalized}</div>
              ${nombre ? `<div class="poi-popup-name">${nombre}</div>` : ''}
            </div>
          </div>
          <button class="poi-popup-directions-btn" id="${poiBtnId}">
            🧭 ¿Cómo llegar?
          </button>
        `)
        .addTo(mlMap);

      // Asignar evento al botón de direcciones
      setTimeout(() => {
        const btnDir = document.getElementById(poiBtnId);
        if (btnDir) btnDir.onclick = () => window.open(poiGmapsUrl, '_blank');
      }, 50);

      mlPoiPopupCoords = [coords[0], coords[1]];

      // Cerrar al hacer click fuera
      mlPoiPopup.on('close', () => {
        mlPoiPopup = null;
        mlPoiPopupCoords = null;
      });
    });

    // Cursor pointer al hover
    mlMap.on('mouseenter', layerId, () => {
      mlMap.getCanvas().style.cursor = 'pointer';
    });
    mlMap.on('mouseleave', layerId, () => {
      mlMap.getCanvas().style.cursor = '';
    });

    console.log(`Capa puntos de interés cargada: ${geojson.features.length} elementos`);

  } catch (error) {
    console.error('Error cargando puntos de interés:', error);
  }
}

/**
 * Carga una capa GeoJSON
 */
async function mlLoadGeoJSONLayer(layerId, url, type, paint, minzoom = 0, layout = {}, preprocessFn = null) {
  const sourceId = `${layerId}-source`;
  const fullLayerId = `${layerId}-layer`;

  try {
    // Cargar GeoJSON
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const geojson = await response.json();

    // Pre-procesar GeoJSON si se proporciona callback (ej. variantes)
    if (typeof preprocessFn === 'function') {
      preprocessFn(geojson);
    }

    // Añadir source
    if (mlMap.getSource(sourceId)) {
      mlMap.removeSource(sourceId);
    }
    mlMap.addSource(sourceId, {
      type: 'geojson',
      data: geojson
    });
    mlLoadedSources.add(sourceId);

    // Añadir capa
    const layerConfig = {
      id: fullLayerId,
      type: type,
      source: sourceId,
      minzoom: minzoom,
      paint: paint
    };

    if (Object.keys(layout).length > 0) {
      layerConfig.layout = layout;
    }

    mlMap.addLayer(layerConfig);

    console.log(`Capa ${layerId} cargada: ${geojson.features?.length || 0} elementos`);

  } catch (error) {
    console.error(`Error cargando capa ${layerId}:`, error);
  }
}

/**
 * Limpia las capas de la escuela actual
 */
function mlClearSchoolLayers() {
  // El filtro de un grado pertenece a la escuela que se deja
  mlGradeFocus = null;
  kxUserRoutesBaseFilter = undefined;
  kxRenderGradeFocusChip();
  const layerIds = ['vias-ticks-circle-layer', 'vias-ticks-layer', 'vias-shadow-layer', 'vias-layer', 'sectores-hit-layer', 'sectores-usuarios-hit-layer', 'sectores-labels-layer', 'sectores-usuarios-labels-layer', 'sectores-layer', 'sectores-casing-layer', 'parkings-layer', 'rutas-acceso-layer', 'puntos-interes-layer', 'vias-variant-connector-layer', 'vias-usuarios-layer', 'poi-usuarios-layer', 'sectores-usuarios-layer', 'sectores-usuarios-casing-layer', 'pending-my-routes-layer', 'pending-my-poi-layer', 'pending-my-sectors-layer', 'pending-my-sectors-casing-layer', 'admin-pending-routes-layer', 'admin-pending-poi-layer', 'admin-pending-sectors-layer', 'admin-pending-sectors-casing-layer'];
  const sourceIds = ['vias-ticks-source', 'vias-source', 'sectores-labels-source', 'sectores-usuarios-labels-source', 'sectores-source', 'parkings-source', 'rutas-acceso-source', 'puntos-interes-source', 'vias-variant-connector-source', 'vias-usuarios-source', 'poi-usuarios-source', 'sectores-usuarios-source', 'pending-my-routes-source', 'pending-my-poi-source', 'pending-my-sectors-source', 'admin-pending-routes-source', 'admin-pending-poi-source', 'admin-pending-sectors-source'];

  // Cancelar listeners realtime antes de eliminar capas/sources
  mlClearApprovedListeners();

  // Resetear flags de interacción (las capas serán recreadas)
  mlUserViasInteractionAttached = false;
  mlUserPOIInteractionAttached = false;
  mlUserSectorsInteractionAttached = false;
  mlMyPendingViasInteractionAttached = false;
  mlMyPendingSectorsInteractionAttached = false;
  mlAdminPendingViasInteractionAttached = false;
  mlAdminPendingPOIInteractionAttached = false;
  mlAdminPendingSectorsInteractionAttached = false;

  // Cancel any active geometry edit
  mlCancelPendingEdit();

  // Selección visual de sector (el feature-state muere con la fuente)
  kxClearSectorSelection();
  _kxLabelPoints.clear();
  kxRemoveSectorLabels();
  kxCloseSectorChooser();

  // Limpiar estado de variantes
  mlClearVariantMarkers();
  mlVariantGroups.clear();
  mlVariantFeatureIndex.clear();
  mlCurrentVariantGroup = null;
  mlCurrentVariantSlide = 0;

  layerIds.forEach(id => {
    if (mlMap.getLayer(id)) {
      mlMap.removeLayer(id);
    }
  });

  sourceIds.forEach(id => {
    if (mlMap.getSource(id)) {
      mlMap.removeSource(id);
      mlLoadedSources.delete(id);
    }
  });
}

// ============================================
// CAPA DE TICKS (CHECKS) EN VÍAS COMPLETADAS
// ============================================

/**
 * Crea o actualiza la capa de ticks (checks) sobre las vías que el usuario ha ascendido.
 * Usa userAscentsCache de user-features.js para determinar qué vías marcar.
 */
function updateAscentTicksLayer() {
  if (!mlMap || !mlCurrentSchool) return;
  if (typeof userAscentsCache === 'undefined' || !userAscentsCache.size) return;

  const tickSourceId = 'vias-ticks-source';
  const tickLayerId = 'vias-ticks-layer';

  // Recopilar features de vías visibles que el usuario ha completado
  const tickFeatures = [];

  // Intentar obtener features del source de vías (vector tiles o geojson)
  let viasFeatures = [];
  try {
    if (mlMap.getSource('vias-source')) {
      viasFeatures = mlMap.querySourceFeatures('vias-source', {
        sourceLayer: 'vias'
      });
      // Fallback: si no hay sourceLayer (geojson mode)
      if (!viasFeatures.length) {
        viasFeatures = mlMap.querySourceFeatures('vias-source');
      }
    }
  } catch (e) {
    // querySourceFeatures puede fallar si los tiles no están cargados
  }

  const addedRoutes = new Set();

  viasFeatures.forEach(feature => {
    const routeId = feature.properties?.id;
    if (!routeId && routeId !== 0) return;

    const routeName = feature.properties?.nombre;
    const grado1 = feature.properties?.grado1 || null;
    const key = `${mlCurrentSchool}:${routeId}`;
    if (userAscentsCache.has(key) && !addedRoutes.has(routeId)) {
      addedRoutes.add(routeId);

      // Obtener coordenadas del feature
      let coords;
      if (feature.geometry.type === 'Point') {
        coords = feature.geometry.coordinates;
      } else if (feature.geometry.type === 'MultiPoint') {
        coords = feature.geometry.coordinates[0];
      } else {
        return;
      }

      tickFeatures.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: coords },
        properties: { nombre: routeName, id: routeId, grado1, sector: feature.properties?.sector || '', gradeColor: getGradeColor(grado1 || '') }
      });
    }
  });

  const tickGeoJSON = {
    type: 'FeatureCollection',
    features: tickFeatures
  };

  // Actualizar o crear source/layer
  if (mlMap.getSource(tickSourceId)) {
    mlMap.getSource(tickSourceId).setData(tickGeoJSON);
  } else {
    // Cargar icono de check si no existe
    loadTickIcon().then(() => {
      if (mlMap.getSource(tickSourceId)) {
        mlMap.getSource(tickSourceId).setData(tickGeoJSON);
        return;
      }

      mlMap.addSource(tickSourceId, {
        type: 'geojson',
        data: tickGeoJSON
      });

      // La vía encadenada conserva su círculo con el color de grado (mismo tamaño que el resto de vías)
      mlMap.addLayer({
        id: 'vias-ticks-circle-layer',
        type: 'circle',
        source: tickSourceId,
        minzoom: 16,
        paint: {
          'circle-radius': kxZoomExpr(kxRouteRadiusStops()),
          'circle-color': ['get', 'gradeColor'],
          'circle-stroke-color': 'white',
          'circle-stroke-width': KX_ROUTE_STROKE
        }
      });

      // Check discreto: insignia verde bosque en el borde superior derecho, sin tapar el color de la vía
      const tickStops = kxRouteRadiusStops().filter(([z]) => z >= 16);
      mlMap.addLayer({
        id: tickLayerId,
        type: 'symbol',
        source: tickSourceId,
        minzoom: 16,
        layout: {
          'icon-image': 'tick-icon',
          'icon-size': ['interpolate', ['linear'], ['zoom'], 16, 0.62, 18, 0.78, 20, 1],
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
          'icon-anchor': 'center'
        },
        paint: {
          'icon-translate': kxZoomExpr(tickStops, r => ['literal', [+(r * 0.85).toFixed(2), -(r * 0.85).toFixed(2)]])
        }
      });
    });
  }
}

/**
 * Carga el icono de tick/check para la capa de vías completadas
 */
function loadTickIcon() {
  return kxLoadSVGImage('tick-icon', kxTickBadgeSVG(), 16);
}

// Escuchar eventos de movimiento del mapa para actualizar ticks
// (los tiles se cargan progresivamente, hay que refrescar al moverse)
let mlTicksUpdateTimer = null;
function scheduleTicksUpdate() {
  if (mlTicksUpdateTimer) clearTimeout(mlTicksUpdateTimer);
  mlTicksUpdateTimer = setTimeout(() => {
    updateAscentTicksLayer();
  }, 500);
}

// ============================================
// VARIANT GROUPS PROCESSING
// ============================================

/**
 * Construye el índice de grupos de variantes a partir de los features GeoJSON.
 * Procesa los campos `variante` y `Union` según la matriz de casos:
 *   A: variante=null → sin cambios
 *   B1: variante=SI, Union=null, modalidad=Simple → trinomios como variantes
 *   B2: variante=SI, Union!=null → agrupar por IDs del Union
 *   C: variante=NO, Union!=null → igual que B2
 */
function mlBuildVariantGroupsIndex(features) {
  mlVariantGroups.clear();
  mlVariantFeatureIndex.clear();

  // Map feature id → feature (for Union cross-referencing)
  const featureById = new Map();
  for (const f of features) {
    const fId = f.properties.id;
    if (fId != null) {
      featureById.set(Number(fId), f);
    }
  }

  // --- Paso 1: Procesar grupos Union (Casos B2 y C) ---
  // Collect all Union strings to find groups
  const unionGroupsRaw = new Map(); // normalizedKey → { originalUnion, features[] }

  for (const f of features) {
    const props = f.properties;
    const union = props.union;
    const variante = props.variante;

    if (!union) continue;
    // B2: variante=SI con Union, o C: variante=NO con Union
    if (variante !== 'SI' && variante !== 'NO') continue;

    const ids = union.split('_').map(Number).filter(n => !isNaN(n));
    if (ids.length < 2) continue;

    // Normalizar key ordenando los IDs
    const normalizedKey = ids.slice().sort((a, b) => a - b).join('_');

    if (!unionGroupsRaw.has(normalizedKey)) {
      unionGroupsRaw.set(normalizedKey, { originalUnion: union, featureIds: new Set() });
    }
    // Añadir todos los IDs referenciados por este Union string
    for (const id of ids) {
      unionGroupsRaw.get(normalizedKey).featureIds.add(id);
    }
  }

  // Construir grupos finales con features reales
  for (const [key, groupData] of unionGroupsRaw) {
    const orderedIds = groupData.originalUnion.split('_').map(Number).filter(n => !isNaN(n));
    const groupFeatures = [];

    for (const id of orderedIds) {
      const f = featureById.get(id);
      if (!f) continue; // ID referenciado no existe en dataset
      const coords = f.geometry && f.geometry.coordinates
        ? (f.geometry.type === 'MultiPoint' ? f.geometry.coordinates[0] : f.geometry.coordinates)
        : null;
      groupFeatures.push({ props: { ...f.properties }, coords: coords });
    }

    if (groupFeatures.length < 2) continue; // Solo agrupar si hay 2+ features

    // Asignar metadata de grupo a cada feature
    groupFeatures.forEach((gf, idx) => {
      gf.props._variantGroupKey = key;
      gf.props._variantIndex = idx;
      // Actualizar el feature original
      const origFeature = featureById.get(Number(gf.props.id));
      if (origFeature) {
        origFeature.properties._variantGroupKey = key;
        origFeature.properties._variantIndex = idx;
      }
      mlVariantFeatureIndex.set(Number(gf.props.id), key);
    });

    mlVariantGroups.set(key, groupFeatures);
  }

  // --- Paso 2: Procesar Caso B1 (trinomios internos) ---
  for (const f of features) {
    const props = f.properties;
    // Solo para: variante=SI, sin Union, modalidad Simple
    if (props.variante !== 'SI') continue;
    if (props.union) continue;
    if (props._variantGroupKey) continue; // Ya fue procesado en un grupo Union

    // Recoger trinomios con datos
    const trinomials = [];
    for (let i = 1; i <= 5; i++) {
      const grado = props['grado' + i];
      if (grado != null && grado !== '') {
        trinomials.push({
          index: i,
          grado: grado,
          exp: props['exp' + i],
          long: props['long' + i]
        });
      }
    }

    if (trinomials.length < 2) continue; // Se necesitan al menos 2 variantes

    const groupKey = 'b1_' + props.id;
    const coords = f.geometry && f.geometry.coordinates
      ? (f.geometry.type === 'MultiPoint' ? f.geometry.coordinates[0] : f.geometry.coordinates)
      : null;

    // Crear un "slide" por cada trinomio
    const groupFeatures = trinomials.map((t, idx) => ({
      props: {
        ...props,
        _variantGroupKey: groupKey,
        _variantIndex: idx,
        _isTrinomialGroup: true,
        _trinomialIndex: t.index,
        // Override de grado/exp/long con datos del trinomio
        _displayGrado: t.grado,
        _displayExp: t.exp,
        _displayLong: t.long,
        _variantLabel: 'Variante ' + (idx + 1)
      },
      coords: coords
    }));

    f.properties._variantGroupKey = groupKey;
    f.properties._variantIndex = 0;
    f.properties._isTrinomialGroup = true;
    mlVariantFeatureIndex.set(Number(props.id), groupKey);
    mlVariantGroups.set(groupKey, groupFeatures);
  }

  console.log(`Variant groups index built: ${mlVariantGroups.size} groups, ${mlVariantFeatureIndex.size} features indexed`);
}

/**
 * Aplica offsets geográficos laterales a features de grupos Union (B2/C)
 * para que se dibujen separados en el mapa en lugar de apilados.
 * Offset: ~2.5m por step en latitud de España.
 */
function mlApplyLateralOffsets(features) {
  const OFFSET_STEP = 0.000025; // ~2.5m en latitud

  for (const [key, group] of mlVariantGroups) {
    // No aplicar offset a grupos B1 (trinomios de un solo punto)
    if (key.startsWith('b1_')) continue;
    if (group.length < 2) continue;

    // Calcular centroide
    let sumLng = 0, sumLat = 0, count = 0;
    for (const gf of group) {
      if (gf.coords) {
        sumLng += gf.coords[0];
        sumLat += gf.coords[1];
        count++;
      }
    }
    if (count === 0) continue;
    const centerLat = sumLat / count;

    // Distribuir offsets laterales (N-S) centrados en el centroide
    const n = group.length;
    group.forEach((gf, idx) => {
      const offset = OFFSET_STEP * (idx - (n - 1) / 2);
      const targetLat = centerLat + offset;

      // Encontrar y modificar el feature original en el array
      const origFeature = features.find(f => Number(f.properties.id) === Number(gf.props.id));
      if (origFeature && origFeature.geometry && origFeature.geometry.coordinates) {
        if (origFeature.geometry.type === 'MultiPoint') {
          origFeature.geometry.coordinates[0][1] = targetLat;
        } else {
          origFeature.geometry.coordinates[1] = targetLat;
        }
        // Actualizar coords en el grupo también
        gf.coords = origFeature.geometry.type === 'MultiPoint'
          ? origFeature.geometry.coordinates[0]
          : origFeature.geometry.coordinates;
      }
    });
  }
}

/**
 * Genera GeoJSON de líneas conectoras entre features de cada grupo Union.
 * Las líneas unen visualmente las variantes agrupadas.
 */
function mlBuildVariantConnectorGeoJSON(features) {
  const connectorFeatures = [];

  for (const [key, group] of mlVariantGroups) {
    if (key.startsWith('b1_')) continue; // B1 no tiene conectores
    if (group.length < 2) continue;

    // Coordenadas ordenadas de cada feature del grupo
    const coords = group
      .filter(gf => gf.coords)
      .map(gf => [gf.coords[0], gf.coords[1]]);

    if (coords.length < 2) continue;

    connectorFeatures.push({
      type: 'Feature',
      properties: {
        groupKey: key,
        primaryGrade: group[0].props.grado1 || ''
      },
      geometry: {
        type: 'LineString',
        coordinates: coords
      }
    });
  }

  return {
    type: 'FeatureCollection',
    features: connectorFeatures
  };
}

/**
 * Añade la capa de líneas conectoras de variantes al mapa
 */
function mlLoadVariantConnectorLayer(connectorGeoJSON) {
  const sourceId = 'vias-variant-connector-source';
  const layerId = 'vias-variant-connector-layer';

  // Limpiar si ya existe
  if (mlMap.getLayer(layerId)) mlMap.removeLayer(layerId);
  if (mlMap.getSource(sourceId)) mlMap.removeSource(sourceId);

  if (!connectorGeoJSON.features || connectorGeoJSON.features.length === 0) return;

  mlMap.addSource(sourceId, {
    type: 'geojson',
    data: connectorGeoJSON
  });
  mlLoadedSources.add(sourceId);

  mlMap.addLayer({
    id: layerId,
    type: 'line',
    source: sourceId,
    minzoom: 17,
    paint: {
      'line-color': generateGradeColorExpression('primaryGrade'),
      'line-width': [
        'interpolate', ['linear'], ['zoom'],
        17, 1.5,
        19, 2.5,
        20, 3
      ],
      'line-opacity': 0.6,
      'line-dasharray': [2, 1.5]
    }
  });

  console.log(`Variant connector layer loaded: ${connectorGeoJSON.features.length} connectors`);
}

// ============================================
// VARIANT CONCENTRIC RING MARKERS
// ============================================

/**
 * Genera SVG inline para un marcador de variantes con anillos concéntricos.
 * El marcador se inscribe en un viewBox de 100×100 y se escala vía CSS
 * para coincidir con el radio de los puntos simples a cualquier zoom.
 *
 * @param {string[]} gradeColors — array de colores hex; [0] = centro, [1..N] = anillos
 * @returns {string} SVG markup
 */
/**
 * @param {string[]} gradeColors — [0]=centro, [1..N]=anillos
 * @param {number}   pixelDiameter — diámetro real del marcador en px
 */
function mlGenerateVariantMarkerSVG(gradeColors, pixelDiameter) {
  const VB = 100;
  const C  = VB / 2;
  const R  = C;
  const N  = gradeColors.length - 1;

  // Convertir px reales → unidades de viewBox.
  // Borde exterior = mismo grosor que circle-stroke-width de puntos simples.
  // Gap entre anillos se reduce con más variantes para dejar más espacio al color.
  const strokePx = KX_ROUTE_STROKE;
  const pxToVB   = VB / pixelDiameter;
  const STROKE_W = strokePx * pxToVB;
  const gapFactor = N <= 1 ? 1.0 : N === 2 ? 0.6 : 0.4;
  const GAP       = N > 0 ? strokePx * gapFactor * pxToVB : 0;

  const INNER_R = R - STROKE_W;

  // Centro con doble peso para que la vía principal domine
  const CENTER_WEIGHT = 2;
  const totalWeight   = CENTER_WEIGHT + N;
  const unit          = (INNER_R - N * GAP) / totalWeight;
  const centerR       = unit * CENTER_WEIGHT;
  const ringBand      = unit;

  let svg = `<svg viewBox="0 0 ${VB} ${VB}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%">`;

  // Borde blanco exterior
  svg += `<circle cx="${C}" cy="${C}" r="${R - STROKE_W / 2}" fill="none" stroke="white" stroke-width="${STROKE_W}"/>`;

  // Círculo central
  svg += `<circle cx="${C}" cy="${C}" r="${centerR}" fill="${gradeColors[0]}"/>`;

  // Anillos concéntricos con gaps blancos
  for (let i = 0; i < N; i++) {
    const ringInner = centerR + (i + 1) * GAP + i * ringBand;
    const ringR     = ringInner + ringBand / 2;
    const gapR      = ringInner - GAP / 2;
    svg += `<circle cx="${C}" cy="${C}" r="${gapR}"  fill="none" stroke="white"              stroke-width="${GAP}"/>`;
    svg += `<circle cx="${C}" cy="${C}" r="${ringR}" fill="none" stroke="${gradeColors[i + 1]}" stroke-width="${ringBand}"/>`;
  }

  svg += '</svg>';
  return svg;
}

/**
 * Calcula el radio de los puntos de vías (px) para el zoom actual,
 * replicando la interpolación lineal de vias-layer circle-radius.
 */
function mlGetViasRadius() {
  const zoom = mlMap.getZoom();
  const stops = kxRouteRadiusStops();

  if (zoom <= stops[0][0]) return stops[0][1];
  if (zoom >= stops[stops.length - 1][0]) return stops[stops.length - 1][1];

  for (let i = 0; i < stops.length - 1; i++) {
    if (zoom <= stops[i + 1][0]) {
      const t = (zoom - stops[i][0]) / (stops[i + 1][0] - stops[i][0]);
      return stops[i][1] + t * (stops[i + 1][1] - stops[i][1]);
    }
  }
  return stops[stops.length - 1][1];
}

/**
 * Crea marcadores HTML con anillos concéntricos para cada grupo de variantes.
 * Cada marcador se posiciona en el centroide del grupo.
 */
function mlCreateVariantMarkers() {
  mlClearVariantMarkers();

  for (const [groupKey, group] of mlVariantGroups) {
    if (group.length < 2) continue;

    // Calcular centroide del grupo
    let sumLng = 0, sumLat = 0, count = 0;
    for (const gf of group) {
      if (gf.coords) {
        sumLng += gf.coords[0];
        sumLat += gf.coords[1];
        count++;
      }
    }
    if (count === 0) continue;
    const centroid = [sumLng / count, sumLat / count];

    // Array de colores: centro = primer route, anillos = variantes
    const gradeColors = group.map(gf => {
      const grade = gf.props._displayGrado || gf.props.grado1 || '?';
      return getGradeColor(grade);
    });

    // Crear elemento HTML (SVG se regenera en updateMarkers)
    const el = document.createElement('div');
    el.style.cursor = 'pointer';
    el.className = 'variant-marker';
    el.dataset.groupKey = groupKey;

    // Crear marcador MapLibre
    const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
      .setLngLat(centroid)
      .addTo(mlMap);

    // Click handler → abre carrusel de variantes
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const coords = { lng: centroid[0], lat: centroid[1] };

      if (isMobileDevice()) {
        adaptiveMapPanForBottomSheet(coords);
        mlShowVariantGroupBottomSheet(group, 0, coords);
      } else {
        mlMap.flyTo({
          center: centroid,
          zoom: mlMap.getZoom(),
          speed: 0.8,
          curve: 1,
          padding: { top: 450, bottom: 0, left: 0, right: 0 }
        });
        mlShowVariantGroupPopup(group, 0, coords);
      }
    });

    mlVariantMarkers.push({ marker, gradeColors, props: group.map(gf => gf.props || {}) });
  }

  // Control de visibilidad, tamaño y regeneración SVG por zoom
  if (mlVariantMarkers.length > 0) {
    let lastDiameter = 0;
    const updateMarkers = () => {
      const school = mlCurrentSchool ? MAPLIBRE_SCHOOLS[mlCurrentSchool] : null;
      const baseZoom = school ? school.zoomLevels.vias : 17;
      const minZoom = mlGradeFocus ? Math.min(KX_FOCUS_MINZOOM, baseZoom) : baseZoom;
      const visible = mlMap.getZoom() >= minZoom;

      const strokeW      = KX_ROUTE_STROKE;
      const baseDiameter = Math.round(mlGetViasRadius() * 2 + strokeW * 2);
      const sizeChanged  = baseDiameter !== lastDiameter;
      lastDiameter = baseDiameter;

      for (const entry of mlVariantMarkers) {
        const N  = entry.gradeColors.length - 1;
        // Marcadores con 3+ variantes: ligeramente más grandes para que
        // los anillos finos sean legibles
        const scale = N >= 3 ? 1.25 : N >= 2 ? 1.15 : 1.0;
        const d  = Math.round(baseDiameter * scale);
        const el = entry.marker.getElement();
        el.style.display = visible && kxVariantPassesGradeFilter(entry) ? '' : 'none';
        el.style.width   = d + 'px';
        el.style.height  = d + 'px';
        // Regenerar SVG solo cuando cambia el diámetro base en px
        if (sizeChanged) {
          el.innerHTML = mlGenerateVariantMarkerSVG(entry.gradeColors, d);
        }
      }
    };
    // Un solo listener vivo: se retira al limpiar la escuela (antes se acumulaba uno por carga)
    mlVariantZoomHandler = updateMarkers;
    mlMap.on('zoom', updateMarkers);
    updateMarkers(); // estado inicial
  }

  console.log(`Variant markers created: ${mlVariantMarkers.length} concentric markers`);
}

/**
 * Elimina todos los marcadores HTML de variantes del mapa.
 */
let mlVariantZoomHandler = null;
function mlClearVariantMarkers() {
  for (const entry of mlVariantMarkers) entry.marker.remove();
  mlVariantMarkers = [];
  if (mlVariantZoomHandler && mlMap) { mlMap.off('zoom', mlVariantZoomHandler); mlVariantZoomHandler = null; }
}

/**
 * Procesa variantes tras cargar un GeoJSON de vías:
 * construye índice, elimina features de variantes del GeoJSON y
 * crea marcadores concéntricos.
 */
function mlProcessVariantsForGeoJSON(geojson) {
  if (!geojson || !geojson.features) return;
  mlBuildVariantGroupsIndex(geojson.features);

  // Eliminar features de variantes del GeoJSON para que no se pinten
  // como puntos individuales en vias-layer
  geojson.features = geojson.features.filter(f => {
    const id = Number(f.properties.id);
    return !mlVariantFeatureIndex.has(id);
  });

  // Crear marcadores concéntricos para los grupos
  mlCreateVariantMarkers();
}

// ============================================
// INTERACTIVIDAD
// ============================================

/**
 * Configura interacción con capa de vías
 */
function setupViasInteraction() {
  // Clic en vía
  mlMap.on('click', 'vias-layer', (e) => {
    if (mlMap.getCanvas().style.cursor === 'crosshair') return;
    if (!e.features || e.features.length === 0) return;

    const feature = e.features[0];
    const props = feature.properties;
    const coords = e.lngLat;

    // Normalizar campo descripcio → descripcion (GeoJSON usa "descripcio")
    if (!props.descripcion && props.descripcio) {
      props.descripcion = props.descripcio;
    }

    // --- Detección de grupo de variantes ---
    const featureId = Number(props.id);
    const variantGroupKey = props._variantGroupKey || mlVariantFeatureIndex.get(featureId);
    const variantGroup = variantGroupKey ? mlVariantGroups.get(variantGroupKey) : null;

    if (variantGroup && variantGroup.length >= 2) {
      // Encontrar el índice del feature clickeado dentro del grupo
      let clickedIndex = variantGroup.findIndex(gf => Number(gf.props.id) === featureId);
      if (clickedIndex < 0) clickedIndex = 0;

      if (isMobileDevice()) {
        adaptiveMapPanForBottomSheet(coords);
        mlShowVariantGroupBottomSheet(variantGroup, clickedIndex, coords);
      } else {
        mlMap.flyTo({
          center: coords,
          zoom: mlMap.getZoom(),
          speed: 0.8,
          curve: 1,
          padding: { top: 450, bottom: 0, left: 0, right: 0 }
        });
        mlShowVariantGroupPopup(variantGroup, clickedIndex, coords);
      }
      return;
    }

    // --- Comportamiento estándar (sin variantes) ---
    // Resaltado breve sobre la vía tocada (sus coordenadas reales)
    const g = feature.geometry;
    const point = g && (g.type === 'MultiPoint' ? g.coordinates[0] : g.type === 'Point' ? g.coordinates : null);
    if (point) mlApplyRouteHighlight(point, props.id);

    if (isMobileDevice()) {
      adaptiveMapPanForBottomSheet(coords);
      showRouteBottomSheet(props, coords);
    } else {
      mlMap.flyTo({
        center: coords,
        zoom: mlMap.getZoom(),
        speed: 0.8,
        curve: 1,
        padding: { top: 450, bottom: 0, left: 0, right: 0 }
      });
      showRoutePopup(props, coords);
    }
  });

  // Cursor pointer al hover
  mlMap.on('mouseenter', 'vias-layer', () => {
    mlMap.getCanvas().style.cursor = 'pointer';
  });

  mlMap.on('mouseleave', 'vias-layer', () => {
    mlMap.getCanvas().style.cursor = '';
  });
}

/**
 * Muestra popup de ruta con nuevo diseño
 */
/**
 * Devuelve el HTML del tag "(Variante N)" para rutas con variante=SI.
 *
 * Caso A — union=null (trinomios: misma vía con varios grados):
 *   Usa _trinomialIndex inyectado en props por el sistema de carrusel.
 *   Index 0 → principal (sin etiqueta). Index 1 → "(Variante 1)", etc.
 *
 * Caso B — union="X_Y_Z" (vías distintas con trayecto compartido):
 *   La primera ID del grupo → principal. Las siguientes → "(Variante N)".
 */
function getVariantLabel(props) {
  if (props.variante !== 'SI') return '';
  const union = props.union;

  if (!union) {
    // Trinomio: _variantIndex es 0-based (0 = principal, 1+ = variantes)
    const idx = Number(props._variantIndex) || 0;
    if (idx === 0) return '';
    return `<small class="ml-route-variant-tag">(Variante ${idx})</small>`;
  }

  // Grupo union (vías distintas con trayecto compartido) → sin etiqueta
  return '';
}

async function showRoutePopup(props, coords) {
  if (!props.descripcion && props.descripcio) props.descripcion = props.descripcio;
  const grade = props.grado1 || '?';
  const gradeColor = getGradeColor(grade);
  const routeId = Number(props.id);
  const routeName = props.nombre || 'Sin nombre';
  const sectorName = props.sector || '';
  const encodedSector = encodeURIComponent(sectorName);
  const schoolId = mlCurrentSchool || 'valeria';

  // Verificar si es admin para mostrar botón de desarrollador
  const isAdmin = await isRoutePopupAdmin();
  // Vías aportadas por la comunidad: pie con autoría y acciones de admin
  const communityHTML = props.docId ? kxUserRouteFooterHTML(props, await kxIsAdminUser()) : '';

  // Verificar si la vía tiene dibujo en la imagen del sector (para mostrar botón "Ver vía")
  let hasDrawing = false;
  if (sectorName && typeof hasRouteDrawing === 'function') {
    hasDrawing = await hasRouteDrawing(schoolId, sectorName, routeId);
  }

  // Verificar si el usuario ha completado esta vía
  const hasAscent = (typeof hasUserAscent === 'function') && hasUserAscent(schoolId, routeId);
  const ascentInfo = hasAscent && (typeof getUserAscentInfo === 'function') ? getUserAscentInfo(schoolId, routeId) : null;

  // Guardar datos de la vía actual para las funciones de los botones
  mlCurrentRouteGrade = grade;
  mlCurrentRouteSector = sectorName;
  mlCurrentRouteId = routeId;
  mlCurrentRouteName = routeName;

  // Obtener número de comentarios
  let commentCount = 0;
  try {
    if (typeof db !== 'undefined' && typeof normalizeId === 'function') {
      const commentRouteId = `${schoolId}_${normalizeId(routeName)}`;
      const commentsSnap = await db.collection('comments').where('routeId', '==', commentRouteId).get();
      commentCount = commentsSnap.size;
    }
  } catch (e) {
    console.warn('Error fetching comment count:', e);
  }
  // Check de ascenso + icono de estilo para el header
  const ascentStyleSVG = ascentInfo && ascentInfo.style && (typeof getAscentStyleSVG === 'function') ? getAscentStyleSVG(ascentInfo.style) : '';
  const ascentCheckHTML = hasAscent ? `
    <span class="ml-route-ascent-check">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
    </span>
    ${ascentStyleSVG ? `<span class="ml-route-ascent-style ascent-style-${ascentInfo.style}">${ascentStyleSVG}</span>` : ''}
  ` : '';

  const variantLabel = getVariantLabel(props);

  const html = `
    <div class="ml-route-popup-new">
      <!-- Header: Check + Nombre + Grado -->
      <div class="ml-route-header">
        ${ascentCheckHTML}
        <span class="ml-route-name">${routeName}${variantLabel}</span>
        <span class="ml-route-grade" style="background-color: ${gradeColor}">${grade}</span>
      </div>

      ${kxRouteChipsHTML({ routeId, schoolId, descripcion: props.descripcion, exp: props.exp1, long: props.long1, routeName, suffix: props._isTrinomialGroup ? props._trinomialIndex : 1 })}
      ${kxRouteDescriptionHTML(props.descripcion)}

      <div id="ml-variant-grade-${routeId}"></div>
      <div id="ml-variant-aleje-${routeId}"></div>
      <div id="ml-variant-estado-${routeId}"></div>
      <div id="ml-variant-incident-${routeId}"></div>

      ${kxRouteActionsHTML({ routeId, routeName, hasAscent, commentCount })}

      <div class="ml-route-report-section">${mlReportButtonHTML({ routeId, routeName, schoolId, sector: sectorName, grade })}</div>

      <!-- Botón Ver vía (solo si tiene dibujo en la imagen) -->
      ${hasDrawing ? `
        <div class="ml-route-view-section">
          <button class="ml-route-view-btn" onclick="mlViewRouteInSector('${schoolId}', '${encodedSector}', ${routeId})">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
              <circle cx="12" cy="12" r="3"/>
            </svg>
            Ver vía
          </button>
        </div>
      ` : ''}

      ${communityHTML}

      <!-- Botón de desarrollador (solo admins) -->
      ${isAdmin ? `
        <div class="ml-route-dev-section">
          <button class="ml-route-dev-btn" onclick="mlOpenDrawingEditor(${routeId})">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
            </svg>
            Vincular con imagen del sector
          </button>
        </div>
      ` : ''}
    </div>
  `;

  mlRoutePopup
    .setLngLat(coords)
    .setHTML(html)
    .addTo(mlMap);

  kxRenderRouteVoteCards(schoolId, routeId, grade, { grade: `ml-variant-grade-${routeId}`, aleje: `ml-variant-aleje-${routeId}`, estado: `ml-variant-estado-${routeId}` });
  kxRenderRouteIncidents({ schoolId, routeId, routeName, sector: sectorName }, `ml-variant-incident-${routeId}`);
}

// ============================================
// VARIANT GROUP CAROUSEL - POPUP (DESKTOP)
// ============================================

/**
 * Construye la fila de badges de grado para navegar entre variantes.
 * @param {Array}  groupFeatures — array de { props, coords }
 * @param {number} activeIndex   — índice activo
 * @param {boolean} isTrinomial
 * @param {string} navFn        — nombre de la función JS a llamar al hacer click
 * @param {string} barId        — id del contenedor de badges
 */
function mlBuildVariantBadgesHTML(groupFeatures, activeIndex, isTrinomial, navFn, barId) {
  let html = `<div class="ml-variant-badge-bar" id="${barId}">`;
  for (let i = 0; i < groupFeatures.length; i++) {
    const gf    = groupFeatures[i];
    const grade = isTrinomial
      ? (gf.props._displayGrado || gf.props.grado1 || '?')
      : (gf.props.grado1 || '?');
    const color = getGradeColor(grade);
    const rgb   = hexToRgbComponents(color);
    const isActive = i === activeIndex;
    // Active: solid grade color bg + white text + shadow (matches .ml-route-grade).
    // Inactive: same color at 35% opacity bg + white text at 80% — readable but subdued.
    const style = isActive
      ? `background:${color};color:#fff;box-shadow:0 2px 6px rgba(0,0,0,0.25);`
      : `background:rgba(${rgb},0.35);color:rgba(255,255,255,0.8);`;
    html += `<button class="ml-variant-badge${isActive ? ' active' : ''}"
               style="${style}"
               data-color="${color}"
               data-rgb="${rgb}"
               onclick="${navFn}(${i})">${grade}</button>`;
  }
  html += '</div>';
  return html;
}

/**
 * Muestra un popup con badges de variante (desktop).
 * @param {Array} groupFeatures - Array de { props, coords } del grupo
 * @param {number} startIndex - Índice de la variante clickeada
 * @param {Object} coords - lngLat del click
 */
async function mlShowVariantGroupPopup(groupFeatures, startIndex, coords) {
  mlCurrentVariantGroup = groupFeatures;
  mlCurrentVariantSlide = startIndex >= 0 ? startIndex : 0;

  const isTrinomial = groupFeatures[0].props._isTrinomialGroup;

  const badgesHTML = mlBuildVariantBadgesHTML(groupFeatures, mlCurrentVariantSlide, isTrinomial, 'mlVariantGoTo', 'ml-variant-badge-bar');
  const slideHTML  = await mlBuildVariantSlideHTML(groupFeatures[mlCurrentVariantSlide], isTrinomial);

  const html = `
    <div class="ml-route-popup-new ml-variant-popup">
      ${badgesHTML}
      <div id="ml-variant-content">${slideHTML}</div>
    </div>
  `;

  // Cerrar popup existente
  if (mlRoutePopup) mlRoutePopup.remove();
  mlRoutePopup = new maplibregl.Popup({
    closeButton: true,
    closeOnClick: false,
    maxWidth: '380px',
    className: 'ml-route-popup kx-mpop'
  });
  kxWatchRoutePopup(mlRoutePopup);

  mlRoutePopup
    .setLngLat(coords)
    .setHTML(html)
    .addTo(mlMap);

  // Añadir soporte de swipe al popup
  setTimeout(() => {
    const container = document.getElementById('ml-variant-content');
    if (container) {
      container.addEventListener('touchstart', (e) => {
        mlVariantSwipeStartX = e.changedTouches[0].screenX;
      }, { passive: true });
      container.addEventListener('touchend', (e) => {
        const diff = mlVariantSwipeStartX - e.changedTouches[0].screenX;
        if (Math.abs(diff) > 50) {
          mlVariantNav(diff > 0 ? 1 : -1);
        }
      }, { passive: true });
    }
  }, 100);

  // Cargar datos asíncronos (aleje, estado)
  mlLoadVariantSlideAsyncData(groupFeatures[mlCurrentVariantSlide], isTrinomial);
}

/**
 * Construye el HTML de un slide individual del carrusel de variantes.
 * Reutiliza el mismo layout que showRoutePopup pero con datos de la variante.
 */
async function mlBuildVariantSlideHTML(variantData, isTrinomial) {
  const props = variantData.props;
  const schoolId = mlCurrentSchool || 'valeria';
  const sectorName = props.sector || '';
  const encodedSector = encodeURIComponent(sectorName);

  // Para B1 (trinomios), usar los campos _display*; para B2/C usar grado1/exp1/long1
  let grade, exp, longM;
  if (isTrinomial) {
    grade = props._displayGrado || props.grado1 || '?';
    exp = props._displayExp;
    longM = props._displayLong;
  } else {
    grade = props.grado1 || '?';
    exp = props.exp1;
    longM = props.long1;
  }

  const gradeColor = getGradeColor(grade);
  const routeId = Number(props.id);
  const routeName = props.nombre || 'Sin nombre';

  // Verificar dibujo y permisos en paralelo
  const [hasDrawing, isSpotter] = await Promise.all([
    (sectorName && typeof hasRouteDrawing === 'function')
      ? hasRouteDrawing(schoolId, sectorName, routeId)
      : Promise.resolve(false),
    isRoutePopupAdmin()
  ]);

  // Check de ascenso
  const hasAscent = (typeof hasUserAscent === 'function') && hasUserAscent(schoolId, routeId);
  const ascentInfo = hasAscent && (typeof getUserAscentInfo === 'function') ? getUserAscentInfo(schoolId, routeId) : null;
  const ascentStyleSVG = ascentInfo && ascentInfo.style && (typeof getAscentStyleSVG === 'function') ? getAscentStyleSVG(ascentInfo.style) : '';
  const ascentCheckHTML = hasAscent ? `
    <span class="ml-route-ascent-check">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
    </span>
    ${ascentStyleSVG ? `<span class="ml-route-ascent-style ascent-style-${ascentInfo.style}">${ascentStyleSVG}</span>` : ''}
  ` : '';

  // Normalizar descripcio → descripcion
  if (!props.descripcion && props.descripcio) {
    props.descripcion = props.descripcio;
  }

  return `
    <!-- Header: Check + Nombre (grado ya indicado en segmented control) -->
    <div class="ml-route-header">
      ${ascentCheckHTML}
      <span class="ml-route-name">${routeName}${getVariantLabel(props)}</span>
    </div>

    ${kxRouteChipsHTML({ routeId, schoolId, descripcion: props.descripcion, exp, long: longM, routeName, suffix: isTrinomial ? props._trinomialIndex : 1 })}
    ${kxRouteDescriptionHTML(props.descripcion)}

    <div id="ml-variant-grade-${routeId}"></div>
    <div id="ml-variant-aleje-${routeId}"></div>
    <div id="ml-variant-estado-${routeId}"></div>
    <div id="ml-variant-incident-${routeId}"></div>

    ${kxRouteActionsHTML({ routeId, routeName, hasAscent })}

    <div class="ml-route-report-section">${mlReportButtonHTML({ routeId, routeName, schoolId, sector: sectorName, grade })}</div>

    <!-- Botón Ver vía (si tiene dibujo en la imagen del sector) -->
    ${hasDrawing ? `
      <div class="ml-route-view-section">
        <button class="ml-route-view-btn" onclick="mlViewRouteInSector('${schoolId}', '${encodedSector}', ${routeId}, ${isTrinomial ? (Number(props._variantIndex) || 0) : 0})">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
            <circle cx="12" cy="12" r="3"/>
          </svg>
          Ver vía
        </button>
      </div>
    ` : ''}

    <!-- Botón Vincular (si no tiene dibujo y es spotter/admin) -->
    ${!hasDrawing && isSpotter ? `
      <div class="ml-route-dev-section">
        <button class="ml-route-dev-btn" onclick="mlOpenDrawingEditor(${routeId})">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
          </svg>
          Vincular con imagen del sector
        </button>
      </div>
    ` : ''}
  `;
}

/**
 * Carga datos asíncronos (aleje, estado) para el slide de variante actual.
 */
function mlLoadVariantSlideAsyncData(variantData, isTrinomial) {
  const props = variantData.props;
  const schoolId = mlCurrentSchool || 'valeria';
  const routeId = Number(props.id);
  const variantGrade = props._displayGrado || props.grado1 || '?';
  kxRenderRouteVoteCards(schoolId, routeId, variantGrade, { grade: `ml-variant-grade-${routeId}`, aleje: `ml-variant-aleje-${routeId}`, estado: `ml-variant-estado-${routeId}` });
  kxRenderRouteIncidents({ schoolId, routeId, routeName: props.nombre || 'Sin nombre', sector: props.sector || '' }, `ml-variant-incident-${routeId}`);
}

/**
 * Navega directamente a una variante por índice (popup desktop).
 * Llamada por onclick de los badges y por swipe.
 * @param {number} index — índice destino
 */
async function mlVariantGoTo(index) {
  if (!mlCurrentVariantGroup || mlCurrentVariantGroup.length === 0) return;
  if (index === mlCurrentVariantSlide) return;

  mlCurrentVariantSlide = index;
  const isTrinomial = mlCurrentVariantGroup[0].props._isTrinomialGroup;

  // Actualizar estado visual de los badges
  const badgeBar = document.getElementById('ml-variant-badge-bar');
  if (badgeBar) {
    badgeBar.querySelectorAll('.ml-variant-badge').forEach((b, i) => {
      const isActive = i === index;
      const color = b.dataset.color || '#888';
      const rgb   = b.dataset.rgb   || '136, 136, 136';
      b.classList.toggle('active', isActive);
      b.style.background  = isActive ? color : `rgba(${rgb},0.35)`;
      b.style.color        = isActive ? '#fff' : 'rgba(255,255,255,0.8)';
      b.style.boxShadow    = isActive ? '0 2px 6px rgba(0,0,0,0.25)' : 'none';
    });
  }

  // Transición fade del contenido — fijar altura para evitar colapso visual
  const contentEl = document.getElementById('ml-variant-content');
  if (contentEl) {
    // Capturar altura actual y fijarla antes de vaciar el contenido
    const currentH = contentEl.offsetHeight;
    contentEl.style.minHeight = `${currentH}px`;
    contentEl.classList.add('fading');
    await new Promise(resolve => setTimeout(resolve, 150));
    contentEl.innerHTML = await mlBuildVariantSlideHTML(mlCurrentVariantGroup[index], isTrinomial);
    contentEl.classList.remove('fading');
    // Liberar la altura fijada para que el nuevo contenido respire
    contentEl.style.minHeight = '';
    mlLoadVariantSlideAsyncData(mlCurrentVariantGroup[index], isTrinomial);
  }

  // Actualizar estado global de ruta
  const props = mlCurrentVariantGroup[index].props;
  mlCurrentRouteGrade = isTrinomial ? (props._displayGrado || props.grado1) : props.grado1;
  mlCurrentRouteSector = props.sector || '';
  mlCurrentRouteId = Number(props.id);
  mlCurrentRouteName = props.nombre || 'Sin nombre';
}

/**
 * Wrapper para swipe (dirección relativa → índice absoluto).
 */
async function mlVariantNav(direction) {
  if (!mlCurrentVariantGroup) return;
  const n = mlCurrentVariantGroup.length;
  await mlVariantGoTo((mlCurrentVariantSlide + direction + n) % n);
}

// ============================================
// VARIANT GROUP CAROUSEL - BOTTOM SHEET (MOBILE)
// ============================================

/**
 * Muestra un bottom sheet con carrusel de variantes (móvil).
 * Reutiliza el bottom sheet existente pero le prepone navegación de variantes.
 */
async function mlShowVariantGroupBottomSheet(groupFeatures, startIndex, coords) {
  const index = startIndex >= 0 ? startIndex : 0;
  const isTrinomial = groupFeatures[0].props._isTrinomialGroup;

  // Primero la ficha estándar con los datos de la variante actual (quita la barra de variantes anterior)
  const shown = await showRouteBottomSheet(kxVariantSheetProps(groupFeatures[index], isTrinomial), coords);
  if (!shown) return;

  mlCurrentVariantGroup = groupFeatures;
  mlCurrentVariantSlide = index;
  kxMountRouteVariantBar(groupFeatures, index, isTrinomial);
}

// Props de una variante para la ficha: en un trinomio (B1) grado, expreses y metros son los de esa variante
function kxVariantSheetProps(variant, isTrinomial) {
  const props = { ...variant.props };
  if (isTrinomial) {
    props.grado1 = props._displayGrado || props.grado1;
    props.exp1 = props._displayExp;
    props.long1 = props._displayLong;
  }
  return props;
}

// Barra de grados de las variantes bajo la cabecera de la ficha de vía
function kxMountRouteVariantBar(groupFeatures, index, isTrinomial) {
  kxRemoveRouteVariantBar();
  const sheet = document.getElementById('route-bottom-sheet');
  const head = sheet && (sheet.querySelector('.rbs-handle') || sheet.firstElementChild);
  if (!head) return;
  const tmp = document.createElement('div');
  tmp.innerHTML = mlBuildVariantBadgesHTML(
    groupFeatures, index, isTrinomial,
    'mlVariantGoToBottomSheet', 'rbs-variant-badge-bar'
  ).replace('ml-variant-badge-bar', 'ml-variant-badge-bar rbs-variant-badge-bar');
  head.insertAdjacentElement('afterend', tmp.firstElementChild);
}

function kxRemoveRouteVariantBar() {
  const bar = document.getElementById('rbs-variant-badge-bar');
  if (bar) bar.remove();
}

/**
 * Navega directamente a una variante por índice (bottom sheet móvil).
 * @param {number} index — índice destino
 */
async function mlVariantGoToBottomSheet(index) {
  if (!mlCurrentVariantGroup || mlCurrentVariantGroup.length === 0) return;
  if (index === mlCurrentVariantSlide) return;

  mlCurrentVariantSlide = index;
  const isTrinomial = mlCurrentVariantGroup[0].props._isTrinomialGroup;
  const currentVariant = mlCurrentVariantGroup[index];

  // Actualizar estado visual de los badges
  const badgeBar = document.getElementById('rbs-variant-badge-bar');
  if (badgeBar) {
    badgeBar.querySelectorAll('.ml-variant-badge').forEach((b, i) => {
      const isActive = i === index;
      const color = b.dataset.color || '#888';
      const rgb   = b.dataset.rgb   || '136, 136, 136';
      b.classList.toggle('active', isActive);
      b.style.background  = isActive ? color : `rgba(${rgb},0.35)`;
      b.style.color        = isActive ? '#fff' : 'rgba(255,255,255,0.8)';
      b.style.boxShadow    = isActive ? '0 2px 6px rgba(0,0,0,0.25)' : 'none';
    });
  }

  // Actualizar datos del bottom sheet sin cerrar/reabrir
  mlUpdateBottomSheetContent(kxVariantSheetProps(currentVariant, isTrinomial), isTrinomial);
}

/**
 * Actualiza el contenido del bottom sheet de ruta con datos de una nueva variante.
 * Modifica directamente los elementos DOM existentes del bottom sheet.
 */
function mlUpdateBottomSheetContent(props, isTrinomial) {
  kxFillRouteSheet(props, { isTrinomial });
}

/**
 * Rellena la ficha de vía móvil (#route-bottom-sheet). Lo inmediato se pinta en el acto;
 * votos, comentarios, «Ver vía» y la herramienta de admin llegan después.
 */
// docId de la vía de la comunidad abierta en la ficha (descarta respuestas tardías de checkAdminRole)
let kxRouteSheetDocId = null;

function kxFillRouteSheet(props, { isTrinomial = false, contribute = true } = {}) {
  const schoolId = mlCurrentSchool || 'valeria';
  const grade = props.grado1 || '?';
  const routeId = Number(props.id);
  const routeName = props.nombre || 'Sin nombre';
  const sectorName = props.sector || '';
  const encodedSector = encodeURIComponent(sectorName);

  // Estado global para los botones
  mlCurrentRouteGrade = grade;
  mlCurrentRouteSector = sectorName;
  mlCurrentRouteId = routeId;
  mlCurrentRouteName = routeName;

  // Vías contiguas del sector para deslizar la ficha a los lados
  kxRouteSheetProps = props;
  kxRouteSheetNav = null;
  kxRouteSheetComputeNav();

  // --- Cabecera ---
  const nameEl = document.getElementById('rbs-route-name');
  if (nameEl) nameEl.innerHTML = routeName + getVariantLabel(props);
  const sectorEl = document.getElementById('rbs-route-sector');
  if (sectorEl) {
    sectorEl.textContent = sectorName ? `Sector ${sectorName}` : '';
    sectorEl.hidden = !sectorName;
  }
  const gradeEl = document.getElementById('rbs-route-grade');
  if (gradeEl) {
    gradeEl.textContent = grade;
    gradeEl.style.backgroundColor = getGradeColor(grade);
  }

  // --- Cápsulas técnicas ---
  if (!props.descripcion && props.descripcio) props.descripcion = props.descripcio;
  const chipsEl = document.getElementById('rbs-info-items');
  if (chipsEl) {
    chipsEl.innerHTML = kxRouteChipsHTML({ routeId, schoolId, descripcion: props.descripcion, exp: props.exp1, long: props.long1, contribute, routeName, suffix: props._isTrinomialGroup ? props._trinomialIndex : 1 });
  }
  const descEl = document.getElementById('rbs-desc-container');
  if (descEl) descEl.innerHTML = kxRouteDescriptionHTML(props.descripcion);

  // --- Grado recomendado, Aleje y Estado (solo lectura) ---
  // Al pasar de una vía a otra con la ficha abierta, las tarjetas anteriores se quedan (atenuadas) hasta
  // que llegan las nuevas: si se cambiaran por esqueletos, más bajos, la ficha encogería y volvería a crecer
  ['rbs-grade-container', 'rbs-aleje-container', 'rbs-estado-container'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.querySelector('.kx-rcard:not(.is-loading)')) el.classList.add('is-refreshing');
    else el.innerHTML = '<div class="kx-rcard is-loading" aria-hidden="true"></div>';
  });
  kxRenderRouteVoteCards(schoolId, routeId, grade, { grade: 'rbs-grade-container', aleje: 'rbs-aleje-container', estado: 'rbs-estado-container' },
    { isCurrent: () => mlCurrentRouteId === routeId });

  // --- Incidencias comunicadas (tarjeta naranja) ---
  const incidentEl = document.getElementById('rbs-incident-container');
  if (incidentEl) incidentEl.innerHTML = '';
  kxIncidentCtx = null;
  kxRenderRouteIncidents({ schoolId, routeId, routeName, sector: sectorName }, 'rbs-incident-container');

  // --- Vía aportada por la comunidad: autoría y acciones de admin ---
  const communityEl = document.getElementById('rbs-community-section');
  if (communityEl) {
    communityEl.innerHTML = '';
    if (props.docId) {
      const docId = props.docId;
      kxIsAdminUser().then(isAdmin => {
        if (kxRouteSheetDocId !== docId) return;
        communityEl.innerHTML = kxUserRouteFooterHTML(props, isAdmin);
      });
    }
  }
  kxRouteSheetDocId = props.docId || null;

  // --- Acciones ---
  const hasAscent = (typeof hasUserAscent === 'function') && hasUserAscent(schoolId, routeId);
  const actionsEl = document.getElementById('rbs-actions');
  if (actionsEl) {
    actionsEl.innerHTML = kxRouteActionsHTML({ routeId, routeName, hasAscent });
    kxRouteCommentCount(schoolId, routeName).then(n => {
      if (!n || mlCurrentRouteId !== routeId) return;
      const icon = actionsEl.querySelectorAll('.kx-ract-icon')[2];
      if (icon && !icon.querySelector('.kx-ract-count')) icon.insertAdjacentHTML('beforeend', `<span class="kx-ract-count">${n}</span>`);
    });
  }

  // --- Notificar incidencia ---
  const reportSection = document.getElementById('rbs-report-section');
  if (reportSection) reportSection.innerHTML = mlReportButtonHTML({ routeId, routeName, schoolId, sector: sectorName, grade });

  // --- Ver vía / Vincular con imagen (admin) ---
  const viewSection = document.getElementById('rbs-view-section');
  const btnView = document.getElementById('rbs-btn-view');
  const devSection = document.getElementById('rbs-dev-section');
  const btnDev = document.getElementById('rbs-btn-dev');
  // Los botones visibles se quedan mientras se comprueba la vía nueva (sin acción): ocultarlos y volver a
  // mostrarlos movía la ficha. Si la vía nueva no tiene trazado, se ocultan al saberlo.
  if (btnView) btnView.onclick = null;
  if (btnDev) btnDev.onclick = null;
  Promise.all([
    (sectorName && typeof hasRouteDrawing === 'function') ? hasRouteDrawing(schoolId, sectorName, routeId) : Promise.resolve(false),
    isRoutePopupAdmin()
  ]).then(([hasDrawing, isAdmin]) => {
    if (mlCurrentRouteId !== routeId) return;
    if (viewSection && btnView) {
      viewSection.classList.toggle('hidden', !hasDrawing);
      if (hasDrawing) btnView.onclick = () => { hideRouteBottomSheet(); mlViewRouteInSector(schoolId, encodedSector, routeId, isTrinomial ? (Number(props._variantIndex) || 0) : 0); };
    }
    if (devSection && btnDev) {
      devSection.classList.toggle('hidden', !isAdmin);
      if (isAdmin) btnDev.onclick = () => { hideRouteBottomSheet(); mlOpenDrawingEditor(routeId); };
    }
  }).catch(() => {
    if (mlCurrentRouteId !== routeId) return;
    if (viewSection) viewSection.classList.add('hidden');
    if (devSection) devSection.classList.add('hidden');
  });
}

// ============================================
// FICHA DE VÍA — DESLIZAR A LA VÍA CONTIGUA
// Arrastrar la ficha a la izquierda abre la vía siguiente del sector y a la derecha la anterior,
// en el orden de las vías en la pared (su id). En un trinomio se recorren antes sus variantes.
// ============================================
let kxRouteSheetProps = null;   // props de la vía abierta en la ficha
let kxRouteSheetNav = null;     // { prev, next }: vías contiguas, o null mientras se calculan
let kxRouteSheetBusy = false;   // animación de cambio de vía en curso

// Vías del sector ordenadas por id: [{ id, props, point }]
async function kxRouteSheetStops(schoolId, sectorName) {
  const target = String(sectorName || '').toLowerCase().trim();
  const seen = new Set();
  const stops = [];
  const add = f => {
    const p = f.properties || {};
    if (String(p.sector || '').toLowerCase().trim() !== target) return;
    const id = Number(p.id);
    if (!Number.isFinite(id) || seen.has(id)) return;
    seen.add(id);
    const g = f.geometry;
    const point = g && (g.type === 'MultiPoint' ? g.coordinates[0] : g.type === 'Point' ? g.coordinates : null);
    stops.push({ id, props: p, point });
  };
  (await kxSchoolRouteFeatures(schoolId)).forEach(add);
  (kxSpotterRouteFeatures(schoolId) || []).forEach(add);
  return stops.sort((a, b) => a.id - b.id);
}

async function kxRouteSheetComputeNav() {
  const props = kxRouteSheetProps;
  if (!props || !props.sector || !mlCurrentSchool) return;
  try {
    const stops = await kxRouteSheetStops(mlCurrentSchool, props.sector);
    if (kxRouteSheetProps !== props) return;   // ya se abrió otra vía
    const i = stops.findIndex(s => s.id === Number(props.id));
    kxRouteSheetNav = i < 0 ? null : { prev: stops[i - 1] || null, next: stops[i + 1] || null };
  } catch (e) {
    console.warn('Vías contiguas:', e);
  }
}

// Trinomio abierto con su barra de variantes (sus variantes se recorren antes de cambiar de vía)
function kxRouteSheetTrinomial() {
  const group = mlCurrentVariantGroup;
  return group && group[0].props._isTrinomialGroup && document.getElementById('rbs-variant-badge-bar') ? group : null;
}

function kxRouteSheetCanStep(dir) {
  const tri = kxRouteSheetTrinomial();
  if (tri) {
    const j = mlCurrentVariantSlide + dir;
    if (j >= 0 && j < tri.length) return true;
  }
  return !!(kxRouteSheetNav && (dir > 0 ? kxRouteSheetNav.next : kxRouteSheetNav.prev));
}

// Cambia el contenido de la ficha a la variante o vía contigua (sin animación)
function kxRouteSheetGo(dir) {
  const tri = kxRouteSheetTrinomial();
  if (tri) {
    const j = mlCurrentVariantSlide + dir;
    if (j >= 0 && j < tri.length) { mlVariantGoToBottomSheet(j); return; }
  }
  const stop = kxRouteSheetNav && (dir > 0 ? kxRouteSheetNav.next : kxRouteSheetNav.prev);
  if (!stop) return;

  if (stop.point && mlMap) {
    mlApplyRouteHighlight(stop.point, stop.id);
    adaptiveMapPanForBottomSheet(stop.point);
  }

  // ¿Pertenece a un grupo de variantes? Entonces la ficha lleva su barra de grados
  const key = stop.props._variantGroupKey || mlVariantFeatureIndex.get(stop.id);
  const group = key ? mlVariantGroups.get(key) : null;
  if (group && group.length >= 2) {
    const isTrinomial = !!group[0].props._isTrinomialGroup;
    let index = isTrinomial ? (dir < 0 ? group.length - 1 : 0) : group.findIndex(gf => Number(gf.props.id) === stop.id);
    if (index < 0) index = 0;
    if (group === mlCurrentVariantGroup && document.getElementById('rbs-variant-badge-bar')) {
      mlVariantGoToBottomSheet(index);
      return;
    }
    mlCurrentVariantGroup = group;
    mlCurrentVariantSlide = index;
    kxMountRouteVariantBar(group, index, isTrinomial);
    kxFillRouteSheet(kxVariantSheetProps(group[index], isTrinomial), { isTrinomial });
    return;
  }

  kxRemoveRouteVariantBar();
  mlCurrentVariantGroup = null;
  const props = { ...stop.props };
  if (!props.descripcion && props.descripcio) props.descripcion = props.descripcio;
  kxFillRouteSheet(props, { isTrinomial: false, contribute: true });
}

function kxInitRouteSheetSwipe(sheet) {
  let g = null;
  const reduceMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Lo que se desliza: cabecera, barra de variantes y contenido (el tirador se queda)
  const parts = () => sheet.querySelectorAll('.rbs-head, .rbs-variant-badge-bar, .kx-msheet-body');
  const place = (x, ms = 0, opacity = 1) => parts().forEach(el => {
    el.style.transition = ms ? `transform ${ms}ms var(--kx-ease), opacity ${ms}ms var(--kx-ease)` : 'none';
    el.style.transform = x ? `translate3d(${x}px, 0, 0)` : '';
    el.style.opacity = opacity === 1 ? '' : String(opacity);
  });

  const step = dir => {
    kxRouteSheetBusy = true;
    const w = sheet.clientWidth || window.innerWidth;
    const out = reduceMotion() ? 0 : 170;
    const inn = reduceMotion() ? 0 : 260;
    place(-dir * w * 0.6, out, 0);
    setTimeout(() => {
      kxRouteSheetGo(dir);
      const body = sheet.querySelector('.kx-msheet-body');
      if (body) body.scrollTop = 0;
      place(dir * w * 0.3, 0, 0);
      void sheet.offsetWidth;   // fija la posición de partida antes de animar la entrada
      place(0, inn, 1);
      setTimeout(() => { parts().forEach(el => { el.style.transition = ''; }); kxRouteSheetBusy = false; }, inn);
    }, out);
  };

  sheet.addEventListener('touchstart', e => {
    g = null;
    if (e.touches.length !== 1 || kxRouteSheetBusy || rbsCurrentState === 'hidden') return;
    if (e.target.closest('input, textarea, select, .kx-gchart')) return;
    const t = e.touches[0];
    g = { x0: t.clientX, y0: t.clientY, t0: performance.now(), axis: null, dx: 0 };
  }, { passive: true });

  sheet.addEventListener('touchmove', e => {
    if (!g || e.touches.length !== 1) return;
    const t = e.touches[0];
    const dx = t.clientX - g.x0, dy = t.clientY - g.y0;
    if (!g.axis) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      g.axis = Math.abs(dx) > Math.abs(dy) * 1.2 ? 'x' : 'y';
      if (g.axis === 'x') { g.prev = kxRouteSheetCanStep(-1); g.next = kxRouteSheetCanStep(1); }
    }
    if (g.axis !== 'x') return;
    if (e.cancelable) e.preventDefault();
    // Sin vía en esa dirección: la ficha cede un poco y vuelve (rebote)
    g.dx = (dx > 0 && !g.prev) || (dx < 0 && !g.next) ? dx * 0.25 : dx;
    place(g.dx);
  }, { passive: false });

  const end = cancelled => {
    if (!g || g.axis !== 'x') { g = null; return; }
    const w = sheet.clientWidth || window.innerWidth;
    const v = g.dx / Math.max(1, performance.now() - g.t0);
    let dir = 0;
    if (!cancelled) {
      if ((g.dx < -w * 0.2 || v < -0.5) && g.next) dir = 1;
      else if ((g.dx > w * 0.2 || v > 0.5) && g.prev) dir = -1;
    }
    g = null;
    if (dir) step(dir);
    else place(0, reduceMotion() ? 0 : 220);
  };
  sheet.addEventListener('touchend', () => end(false));
  sheet.addEventListener('touchcancel', () => end(true));
}

// ============================================
// FICHA DE VÍA — BLOQUES DE SOLO LECTURA
// Cápsulas técnicas, Grado recomendado, Aleje, Estado de la vía y acciones.
// Se vota al registrar un ascenso (user-features.js: openAscentModal → kxSaveRouteVotes).
// ============================================

const KX_ALEJE_LEVELS = ['Muy pequeño', 'Pequeño', 'Normal', 'Expuesto', 'Muy expuesto'];

const KX_ROUTE_INFO_TEXT = {
  grado: 'Grado medio que votan quienes la han escalado. Vota al registrar tu ascenso.',
  aleje: 'Distancia entre seguros según la comunidad. Vota al registrar tu ascenso.',
  estado: 'Estado del equipamiento y la roca según la comunidad. Vota al registrar tu ascenso.'
};

function kxRouteInfo(key) {
  if (typeof showToast === 'function' && KX_ROUTE_INFO_TEXT[key]) showToast(KX_ROUTE_INFO_TEXT[key], 'info');
}

function kxRouteInfoBtnHTML(key, label) {
  return `<button type="button" class="kx-rinfo" onclick="kxRouteInfo('${key}')" aria-label="Qué es ${label}"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9.5"/><path d="M12 11v5.5"/><circle cx="12" cy="7.6" r="0.6" fill="currentColor"/></svg></button>`;
}

function kxRouteFmtDecimal(n) {
  return n.toFixed(1).replace('.', ',');
}

function kxEscHTML(str) {
  return String(str).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

// Palabras que describen el estilo de escalada de una vía (y conectores o adjetivos que las acompañan)
const KX_STYLE_WORDS = new Set(['placa', 'placas', 'fisura', 'fisuras', 'desplome', 'desplomes', 'desplomada', 'desplomado',
  'diedro', 'diedros', 'diedraco', 'techo', 'techos', 'techito', 'techaco', 'muro', 'espolón', 'espolon', 'arista',
  'chimenea', 'bavaresa', 'regletas', 'agujeros', 'cazos', 'barriguita', 'cueva', 'laja', 'bloque', 'resistencia',
  'adherencia', 'travesía', 'travesia', 'cresta', 'canto', 'cantos']);
const KX_STYLE_LINKS = new Set(['y', 'e', 'con', 'de', 'o', 'varios', 'varias', 'muy', 'ligero', 'ligera', 'pequeño', 'pequeña',
  'buenos', 'estilo', 'vertical', 'tumbada', 'tumbado', 'técnica', 'tecnica', 'técnico', 'tecnico', 'mantenida', 'mantenido',
  'fisurada', 'fisurado', 'resbaladizo', 'resbaladiza', 'física', 'fisica', 'tumbadas']);

function kxLevenshtein1(a, b) {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1) || (a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2));
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : b.slice(i + 1) === a.slice(i);
}

// ¿La palabra está en el conjunto, o se diferencia en una sola letra (errata: «plca», «despplome»)?
function kxWordIn(word, set) {
  if (set.has(word)) return true;
  if (word.length < 4) return false;
  for (const w of set) if (w.length >= 4 && kxLevenshtein1(word, w)) return true;
  return false;
}

/**
 * Reparte el atributo «descripcion» del GeoJSON: si la primera frase solo habla del estilo
 * («Placa», «Placa, bavaresa y fisura», «Desplome»), va a la cápsula de estilo y el resto a la descripción.
 * «Placa. Comparte reunión con 2» → { style: 'Placa', description: 'Comparte reunión con 2' }
 */
function kxRouteSplitDescription(text) {
  const t = String(text || '').trim();
  if (!t) return { style: null, description: null };
  const m = t.match(/^([^.;:!?¡¿]+)(?:[.;:]+\s*|$)([\s\S]*)$/);
  if (m) {
    const first = m[1].trim();
    const words = first.toLowerCase().split(/[\s,/]+/).filter(Boolean);
    const isStyle = words.length > 0 && words.length <= 8 &&
      words.some(w => kxWordIn(w, KX_STYLE_WORDS)) &&
      words.every(w => kxWordIn(w, KX_STYLE_WORDS) || kxWordIn(w, KX_STYLE_LINKS));
    if (isStyle) {
      const rest = m[2].trim();
      return { style: first.charAt(0).toUpperCase() + first.slice(1), description: rest || null };
    }
  }
  return { style: null, description: t };
}

/**
 * Cápsulas técnicas: estilo, expreses y longitud. Un dato que falta se ofrece para contribuir.
 * opts.contribute = false oculta las cápsulas vacías.
 * opts.suffix: número de variante de un trinomio (exp2/long2…); routeName: vía a la que se atribuye el dato.
 */
function kxRouteChipsHTML({ routeId, schoolId, descripcion, exp, long, contribute = true, routeName = '', suffix = 1 }) {
  const has = v => v != null && String(v).trim() !== '';
  const chip = (icon, alt, value, field, ask, strong = false, cls = '') => {
    if (has(value)) {
      return `<div class="kx-rchip${strong ? ' is-strong' : ''}${cls}"><img src="icons/${icon}" alt="${alt}" width="28" height="28"><span class="kx-rchip-text">${kxEscHTML(value)}</span></div>`;
    }
    if (!contribute) return '';
    return `<button type="button" class="kx-rchip is-missing${cls}" onclick="mlContributeField(${routeId}, '${schoolId}', '${field}', ${Number(suffix) || 1}, '${encodeURIComponent(routeName || '').replace(/'/g, '%27')}')"><img src="icons/${icon}" alt="" width="28" height="28"><span class="kx-rchip-text">${ask}</span></button>`;
  };
  const expNum = has(exp) ? Number(exp) : null;
  const expText = has(exp) ? `${exp} ${expNum === 1 ? 'exprés' : 'expreses'}` : null;
  const html =
    chip('placa.png', 'Estilo', kxRouteSplitDescription(descripcion).style, 'tipo', 'Estilo', true, ' is-style') +
    chip('mosq.png', 'Equipamiento', expText, 'express', 'Expreses') +
    chip('cuerda.png', 'Longitud', has(long) ? `${long} m` : null, 'metros', 'Metros', true);
  return html ? `<div class="kx-rchips">${html}</div>` : '';
}

/**
 * Descripción: el texto del atributo «descripcion» que no es un estilo. Vacío si no hay.
 */
function kxRouteDescriptionHTML(descripcion) {
  const { description } = kxRouteSplitDescription(descripcion);
  if (!description) return '';
  return `
    <section class="kx-rcard kx-rcard--desc">
      <div class="kx-rcard-head">
        <svg class="kx-rdesc-icon" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2.5H7a2 2 0 0 0-2 2v15a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7.5z"/><path d="M14 2.5v5h5"/><path d="M9 12h6"/><path d="M9 15.5h6"/><path d="M9 8.5h2"/></svg>
        <h3 class="kx-rcard-title">Descripción</h3>
      </div>
      <p class="kx-rdesc-text">${kxEscHTML(description)}</p>
    </section>`;
}

/**
 * Grado recomendado: media de los votos de grado. Sin votos se muestra el grado de la reseña.
 */
function kxRouteGradeCardHTML(grade, gradeVoteData) {
  const count = gradeVoteData ? gradeVoteData.voteCount : 0;
  const avgIdx = gradeVoteData ? gradeVoteData.avgGradeIdx : null;
  const hasVotes = count > 0 && avgIdx !== null;
  const shown = hasVotes ? ALL_GRADES_ORDERED[Math.round(avgIdx)] : (grade && grade !== '?' ? grade : '—');
  const sub = hasVotes
    ? `Consenso de la comunidad (${count} ${count === 1 ? 'voto' : 'votos'})`
    : 'Aún sin votos de la comunidad';
  return `
    <section class="kx-rcard kx-rcard--grade">
      <div class="kx-rcard-main">
        <div class="kx-rcard-head"><h3 class="kx-rcard-title">Grado recomendado</h3>${kxRouteInfoBtnHTML('grado', 'el grado recomendado')}</div>
        <p class="kx-rcard-sub">${sub}</p>
      </div>
      <span class="kx-rgrade-soft${hasVotes ? '' : ' is-empty'}"${hasVotes ? ` style="background:rgba(${hexToRgbComponents(getGradeColor(shown))},0.5)"` : ''}>${shown}</span>
    </section>`;
}

/**
 * Aleje: escala de cinco tramos con un indicador en la media. No es un control.
 */
function kxRouteAlejeCardHTML(alejeData) {
  const avg = alejeData && alejeData.avg;
  const hasVotes = avg !== null && avg !== undefined && avg > 0;
  const level = hasVotes ? Math.min(5, Math.max(1, Math.round(avg))) : 0;
  const pill = hasVotes
    ? `<span class="kx-raleje-pill is-l${level}">${KX_ALEJE_LEVELS[level - 1]}</span>`
    : '<span class="kx-raleje-pill is-empty">Sin votos</span>';
  // Indicador en el centro del tramo equivalente a la media (1 → 10 %, 5 → 90 %)
  const marker = hasVotes
    ? `<span class="kx-raleje-marker" style="left:${((Math.min(5, Math.max(1, avg)) - 0.5) / 5) * 100}%"></span>`
    : '';
  return `
    <section class="kx-rcard kx-rcard--aleje"${hasVotes ? ` aria-label="Aleje: ${KX_ALEJE_LEVELS[level - 1]}"` : ''}>
      <div class="kx-rcard-head">
        <h3 class="kx-rcard-title kx-rcard-title--lg">Aleje</h3>${kxRouteInfoBtnHTML('aleje', 'el aleje')}
        ${pill}
      </div>
      <div class="kx-raleje-scale${hasVotes ? '' : ' is-empty'}" aria-hidden="true">
        <span class="kx-raleje-seg is-l1"></span><span class="kx-raleje-seg is-l2"></span><span class="kx-raleje-seg is-l3"></span><span class="kx-raleje-seg is-l4"></span><span class="kx-raleje-seg is-l5"></span>
        ${marker}
      </div>
      <div class="kx-raleje-legend"><span>Protección cercana</span><span>Protección alejada</span></div>
    </section>`;
}

/**
 * Estado de la vía: estrellas con la media y el número de valoraciones.
 */
function kxRouteEstadoCardHTML(estadoData) {
  const avg = estadoData && estadoData.avg;
  const count = (estadoData && estadoData.count) || 0;
  const hasVotes = avg !== null && avg !== undefined && avg > 0;
  const filled = hasVotes ? Math.round(avg) : 0;
  let stars = '';
  for (let i = 1; i <= 5; i++) {
    stars += `<svg class="kx-rstar${i <= filled ? ' is-on' : ''}" width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.6l2.9 6 6.5.8-4.8 4.5 1.2 6.5L12 17.3l-5.8 3.1 1.2-6.5L2.6 9.4l6.5-.8z"/></svg>`;
  }
  const value = hasVotes
    ? `<span class="kx-restado-val"><strong>${kxRouteFmtDecimal(avg)}</strong> (${count} ${count === 1 ? 'valoración' : 'valoraciones'})</span>`
    : '<span class="kx-restado-val">Sin valoraciones</span>';
  return `
    <section class="kx-rcard kx-rcard--estado">
      <div class="kx-rcard-head"><h3 class="kx-rcard-title">Estado de la vía</h3>${kxRouteInfoBtnHTML('estado', 'el estado de la vía')}</div>
      <div class="kx-restado-rate"${hasVotes ? ` aria-label="${kxRouteFmtDecimal(avg)} de 5"` : ''}><span class="kx-rstars">${stars}</span>${value}</div>
      <p class="kx-restado-sub">Valoración media del estado por quienes han registrado una ascensión.</p>
    </section>`;
}

function kxRouteBookmarkIcon(active) {
  return `<svg width="28" height="28" viewBox="0 0 24 24" fill="${active ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 21l-6-4.5L6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2z"/></svg>`;
}

/**
 * Acciones sociales: Ascenso, Guardar, Comentarios, Compartir.
 */
function kxRouteActionsHTML({ routeId, routeName, hasAscent = false, commentCount = 0 }) {
  const enc = encodeURIComponent(routeName);
  const saved = isRouteInProjects(routeId);
  const iconCheck = `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9.5"/><path d="M7.8 12.3l2.8 2.8 5.6-5.8"/></svg>`;
  const iconComment = `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.5 11.5a8.5 8.5 0 0 1-12.4 7.6L3.5 20.5l1.4-4.4A8.5 8.5 0 1 1 20.5 11.5z"/></svg>`;
  const iconShare = `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21.5 2.5L10.6 13.4"/><path d="M21.5 2.5l-7 19-3.9-8.1-8.1-3.9z"/></svg>`;
  const badge = commentCount > 0 ? `<span class="kx-ract-count">${commentCount}</span>` : '';
  return `
    <div class="kx-ractions">
      <button type="button" class="kx-ract${hasAscent ? ' is-done' : ''}" onclick="mlRegisterAscent(${routeId}, '${enc}')"><span class="kx-ract-icon">${iconCheck}</span><span class="kx-ract-label">Ascenso</span></button>
      <button type="button" class="kx-ract${saved ? ' bookmark-active' : ''}" id="ml-bookmark-btn" aria-pressed="${saved}" onclick="mlToggleBookmark(${routeId}, '${enc}')"><span class="kx-ract-icon">${kxRouteBookmarkIcon(saved)}</span><span class="kx-ract-label">Guardar</span></button>
      <button type="button" class="kx-ract" onclick="mlOpenComments(${routeId}, '${enc}')"><span class="kx-ract-icon">${iconComment}${badge}</span><span class="kx-ract-label">Comentarios</span></button>
      <button type="button" class="kx-ract is-strong" onclick="mlShareRoute(${routeId}, '${enc}')"><span class="kx-ract-icon">${iconShare}</span><span class="kx-ract-label">Compartir</span></button>
    </div>`;
}

const KX_ROUTE_EYE_ICON = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1.5 12S5.5 4.5 12 4.5 22.5 12 22.5 12 18.5 19.5 12 19.5 1.5 12 1.5 12z"/><circle cx="12" cy="12" r="3.2"/></svg>`;

const KX_ROUTE_LINK_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`;

async function kxRouteCommentCount(schoolId, routeName) {
  try {
    if (typeof db === 'undefined' || typeof normalizeId !== 'function') return 0;
    const snap = await db.collection('comments').where('routeId', '==', `${schoolId}_${normalizeId(routeName)}`).get();
    return snap.size;
  } catch (e) {
    console.warn('Error fetching comment count:', e);
    return 0;
  }
}

/**
 * Pinta las tres tarjetas de votos (grado, aleje, estado) en sus contenedores.
 * Se usa al abrir la ficha y tras votar desde el registro de ascenso.
 */
function kxRenderRouteVoteCards(schoolId, routeId, grade, ids, { isCurrent = null } = {}) {
  const set = (id, html) => {
    if (isCurrent && !isCurrent()) return;   // ya se pasó a otra vía
    const el = document.getElementById(id);
    if (el) { el.innerHTML = html; el.classList.remove('is-refreshing'); }
  };
  return Promise.all([
    getGradeVotes(schoolId, routeId).then(d => set(ids.grade, kxRouteGradeCardHTML(grade, d))).catch(() => set(ids.grade, '')),
    getAlejeVotes(schoolId, routeId).then(d => set(ids.aleje, kxRouteAlejeCardHTML(d))).catch(() => set(ids.aleje, '')),
    getEstadoVotes(schoolId, routeId).then(d => set(ids.estado, kxRouteEstadoCardHTML(d))).catch(() => set(ids.estado, ''))
  ]);
}

/**
 * Guarda los votos de grado, aleje y estado de una vía (desde el registro de ascenso).
 * votes: { gradeIdx, aleje, estado } con null = sin voto. initial: los votos que tenía el usuario.
 * Solo escribe lo que ha cambiado; un voto quitado se borra del mapa.
 */
async function kxSaveRouteVotes(schoolId, routeId, votes, initial = {}) {
  if (typeof auth === 'undefined' || !auth.currentUser || !schoolId || !Number.isFinite(Number(routeId))) return false;
  const uid = auth.currentUser.uid;
  const rid = Number(routeId);
  const fs = firebase.firestore();
  const del = firebase.firestore.FieldValue.delete();
  const jobs = [
    ['grade_votes', 'gradeIdx'],
    ['aleje_votes', 'aleje'],
    ['estado_votes', 'estado']
  ].filter(([, key]) => (votes[key] ?? null) !== (initial[key] ?? null))
   .map(([col, key]) => fs.collection(col).doc(`${schoolId}_${rid}`).set({
      schoolId,
      routeId: rid,
      votes: { [uid]: votes[key] ?? del },
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true }));
  if (!jobs.length) return false;
  if ((votes.estado ?? null) !== (initial.estado ?? null)) kxSectorEstadoCache.clear();
  await Promise.all(jobs);
  // Refrescar la ficha abierta si es la misma vía
  if (Number(mlCurrentRouteId) === rid && Number.isFinite(rid)) {
    kxRenderRouteVoteCards(schoolId, rid, mlCurrentRouteGrade, { grade: 'rbs-grade-container', aleje: 'rbs-aleje-container', estado: 'rbs-estado-container' });
    kxRenderRouteVoteCards(schoolId, rid, mlCurrentRouteGrade, { grade: `ml-variant-grade-${rid}`, aleje: `ml-variant-aleje-${rid}`, estado: `ml-variant-estado-${rid}` });
  }
  return true;
}

/**
 * Genera el HTML del indicador de aleje con 5 segmentos iguales y votación por click.
 * Cada segmento representa un nivel discreto (1-5). Los usuarios votan clickando un segmento.
 * El marcador indica la media de las votaciones.
 * @param {number} routeId - ID numérico de la ruta (from GeoJSON properties.id)
 * @param {string} schoolId - ID de la escuela
 * @param {number|null} avgVote - Media actual de votaciones (1-5), null si no hay votos
 * @param {number|null} userVote - Voto del usuario actual (1-5), null si no ha votado
 * @returns {string} HTML string
 */
function generateAlejeBarHTML(routeId, schoolId, avgVote, userVote) {
  const segments = [
    { level: 1, cls: 'ml-route-aleje-g1' },
    { level: 2, cls: 'ml-route-aleje-g2' },
    { level: 3, cls: 'ml-route-aleje-y' },
    { level: 4, cls: 'ml-route-aleje-o' },
    { level: 5, cls: 'ml-route-aleje-r' }
  ];

  const segmentsHTML = segments.map(s => {
    const activeClass = userVote === s.level ? 'ml-route-aleje-active' : '';
    return `<div class="ml-route-aleje-segment ${s.cls} ${activeClass}" onclick="mlVoteAleje(${routeId}, '${schoolId}', ${s.level})" data-level="${s.level}"></div>`;
  }).join('');

  // Marcador de media: posicionar en % sobre la barra (cada segmento = 20%)
  let markerHTML = '';
  if (avgVote !== null && avgVote > 0) {
    const pct = ((avgVote - 1) / 4) * 100;
    markerHTML = `<div class="ml-route-aleje-marker" style="left: ${pct}%"><div class="ml-route-aleje-line"></div></div>`;
  }

  return `
    <div class="ml-route-aleje">
      <span class="ml-route-aleje-label">Aleje ${userVote === null ? '<span class="ml-route-aleje-hint">(vota)</span>' : ''}</span>
      <div class="ml-route-aleje-bar">
        ${segmentsHTML}
        ${markerHTML}
      </div>
    </div>
  `;
}

/**
 * Vota el aleje de una ruta. Guarda en Firestore y actualiza la barra visualmente.
 * @param {number} routeId - ID numérico de la ruta
 * @param {string} schoolId - ID de la escuela
 * @param {number} level - Nivel votado (1-5)
 */
async function mlVoteAleje(routeId, schoolId, level) {
  try {
    if (typeof auth === 'undefined' || !auth.currentUser) {
      if (typeof showToast === 'function') showToast('Inicia sesión para votar el aleje');
      return;
    }

    const userId = auth.currentUser.uid;
    const docId = `${schoolId}_${routeId}`;

    const db = firebase.firestore();
    const alejeRef = db.collection('aleje_votes').doc(docId);
    const doc = await alejeRef.get();

    let votes = {};
    if (doc.exists) {
      votes = doc.data().votes || {};
    }

    // Toggle: si el usuario ya votó este mismo nivel, cancelar voto
    const isUnvote = votes[userId] === level;

    if (isUnvote) {
      // Usar FieldValue.delete() para eliminar la clave del mapa en Firestore
      // (delete local no basta con merge:true, Firestore no borra claves ausentes)
      await alejeRef.set({
        schoolId: schoolId,
        routeId: routeId,
        votes: { [userId]: firebase.firestore.FieldValue.delete() },
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      delete votes[userId];
    } else {
      votes[userId] = level;
      await alejeRef.set({
        schoolId: schoolId,
        routeId: routeId,
        votes: votes,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    }

    // Calcular nueva media (o null si no quedan votos)
    const values = Object.values(votes);
    const avg = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null;

    // Actualizar barra visualmente sin recargar popup
    const bar = document.querySelector('.ml-route-aleje-bar');
    if (bar) {
      // Actualizar segmento activo (ninguno si se canceló)
      bar.querySelectorAll('.ml-route-aleje-segment').forEach(seg => {
        const segLevel = parseInt(seg.getAttribute('data-level'));
        seg.classList.toggle('ml-route-aleje-active', !isUnvote && segLevel === level);
      });

      // Actualizar o eliminar marcador
      let marker = bar.querySelector('.ml-route-aleje-marker');
      if (avg !== null) {
        const pct = ((avg - 1) / 4) * 100;
        if (marker) {
          marker.style.left = pct + '%';
        } else {
          marker = document.createElement('div');
          marker.className = 'ml-route-aleje-marker';
          marker.style.left = pct + '%';
          marker.innerHTML = '<div class="ml-route-aleje-line"></div>';
          bar.appendChild(marker);
        }
      } else if (marker) {
        marker.remove();
      }
    }

    // Mostrar "(vota)" solo cuando el usuario no tiene voto activo
    const label = document.querySelector('.ml-route-aleje-label');
    if (label) {
      label.innerHTML = isUnvote
        ? 'Aleje <span class="ml-route-aleje-hint">(vota)</span>'
        : 'Aleje';
    }

    if (typeof showToast === 'function') showToast(isUnvote ? 'Voto de aleje cancelado' : 'Aleje actualizado', 'success');

  } catch (e) {
    console.error('[Aleje] Error votando:', e);
    if (typeof showToast === 'function') showToast('No se ha podido votar el aleje', 'error');
  }
}

/**
 * Obtiene los datos de votación de aleje para una ruta desde Firestore.
 * @param {string} schoolId - ID de la escuela
 * @param {number} routeId - ID numérico de la ruta
 * @returns {Promise<{avg: number|null, userVote: number|null}>}
 */
async function getAlejeVotes(schoolId, routeId) {
  try {
    if (typeof firebase === 'undefined' || !firebase.firestore) {
      return { avg: null, userVote: null };
    }

    const db = firebase.firestore();
    const docId = `${schoolId}_${routeId}`;
    const doc = await db.collection('aleje_votes').doc(docId).get();

    if (!doc.exists) return { avg: null, userVote: null };

    const votes = doc.data().votes || {};
    const values = Object.values(votes);

    if (values.length === 0) return { avg: null, userVote: null };

    const avg = values.reduce((a, b) => a + b, 0) / values.length;

    let userVote = null;
    if (typeof auth !== 'undefined' && auth.currentUser) {
      userVote = votes[auth.currentUser.uid] || null;
    }

    return { avg, userVote, count: values.length };
  } catch (e) {
    console.error('[Aleje] Error obteniendo votos:', e);
    return { avg: null, userVote: null };
  }
}

// ─────────────────────────────────────────────────────────────────
// GRADE VOTING SLIDER
// ─────────────────────────────────────────────────────────────────

const GRADE_CONSENSUS_THRESHOLD = 21;

async function getGradeVotes(schoolId, routeId) {
  try {
    if (typeof firebase === 'undefined' || !firebase.firestore) {
      return { voteCount: 0, avgGradeIdx: null, userVoteIdx: null };
    }
    const db = firebase.firestore();
    const doc = await db.collection('grade_votes').doc(`${schoolId}_${routeId}`).get();
    if (!doc.exists) return { voteCount: 0, avgGradeIdx: null, userVoteIdx: null };
    const votes = doc.data().votes || {};
    const values = Object.values(votes);
    if (values.length === 0) return { voteCount: 0, avgGradeIdx: null, userVoteIdx: null };
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    let userVoteIdx = null;
    if (typeof auth !== 'undefined' && auth.currentUser) {
      const v = votes[auth.currentUser.uid];
      userVoteIdx = (v !== undefined) ? v : null;
    }
    return { voteCount: values.length, avgGradeIdx: avg, userVoteIdx };
  } catch (e) {
    console.error('[GradeVotes] Error obteniendo votos:', e);
    return { voteCount: 0, avgGradeIdx: null, userVoteIdx: null };
  }
}

function buildConsensusBadgeHTML(grade, gradeVoteData) {
  if (!gradeVoteData || gradeVoteData.voteCount < GRADE_CONSENSUS_THRESHOLD) return '';
  const officialIdx = ALL_GRADES_ORDERED.indexOf(grade);
  if (officialIdx === -1) return '';
  const consensusIdx = Math.round(gradeVoteData.avgGradeIdx);
  if (consensusIdx === officialIdx) return '';
  return `<span class="ml-grade-consensus-badge">${ALL_GRADES_ORDERED[consensusIdx]} · consenso</span>`;
}

function generateGradeSliderHTML(routeId, schoolId, grade, gradeVoteData) {
  const officialIdx = ALL_GRADES_ORDERED.indexOf(grade);
  if (officialIdx === -1) return '';

  // Build 5-label window centered on official grade, clamped to array bounds
  const labelIndices = [];
  for (let offset = -2; offset <= 2; offset++) {
    labelIndices.push(Math.max(0, Math.min(ALL_GRADES_ORDERED.length - 1, officialIdx + offset)));
  }
  const officialStep = labelIndices.indexOf(officialIdx);

  const voteCount = gradeVoteData ? gradeVoteData.voteCount : 0;
  const avgGradeIdx = gradeVoteData ? gradeVoteData.avgGradeIdx : null;
  const userVoteIdx = gradeVoteData ? gradeVoteData.userVoteIdx : null;
  const hasUserVote = userVoteIdx !== null;

  let sliderValue = officialStep;
  if (hasUserVote) {
    const stepPos = labelIndices.indexOf(userVoteIdx);
    if (stepPos !== -1) {
      sliderValue = stepPos;
    } else {
      // User voted outside the window — snap to closest label
      let minDist = Infinity;
      labelIndices.forEach((idx, pos) => {
        const dist = Math.abs(idx - userVoteIdx);
        if (dist < minDist) { minDist = dist; sliderValue = pos; }
      });
    }
  }

  const labelsHTML = labelIndices.map(idx =>
    `<span class="ml-grade-slider-lbl">${ALL_GRADES_ORDERED[idx]}</span>`
  ).join('');

  // Tick position: account for 22px thumb half-width inset
  const tickLeft = `calc(11px + ${officialStep} * (100% - 22px) / 4)`;

  let metaText = '';
  if (voteCount > 0 && avgGradeIdx !== null) {
    const avgGrade = ALL_GRADES_ORDERED[Math.round(avgGradeIdx)];
    metaText = `${voteCount} ${voteCount === 1 ? 'voto' : 'votos'} · media ${avgGrade}`;
  }

  let feedbackHTML = '';

  return `
    <div class="ml-grade-slider" data-route="${routeId}" data-school="${schoolId}" data-official-idx="${officialIdx}" data-label-indices="${labelIndices.join(',')}">
      <div class="ml-grade-slider-header">
        <span class="ml-route-aleje-label">Grado ${!hasUserVote ? '<span class="ml-route-aleje-hint">(vota)</span>' : ''}</span>
        ${metaText ? `<span class="ml-grade-slider-meta">${metaText}</span>` : ''}
      </div>
      <div class="ml-grade-slider-labels">${labelsHTML}</div>
      <div class="ml-grade-slider-track-wrap">
        <input type="range" class="ml-grade-slider-input" min="0" max="4" step="1" value="${sliderValue}"
               data-label-indices="${labelIndices.join(',')}"
               data-official-idx="${officialIdx}"
               data-route="${routeId}"
               data-school="${schoolId}"
               data-user-vote-step="${hasUserVote ? sliderValue : -1}"
               oninput="mlGradeSliderInput(this)"
               onclick="mlGradeSliderClick(this)"
               onchange="mlVoteGrade(${routeId}, '${schoolId}', parseInt(this.getAttribute('data-label-indices').split(',')[parseInt(this.value)]))" />
        <div class="ml-grade-slider-tick" style="left:${tickLeft}"></div>
      </div>
      ${feedbackHTML}
    </div>
  `;
}

function mlGradeSliderClick(input) {
  const userVoteStep = parseInt(input.getAttribute('data-user-vote-step'));
  if (userVoteStep === -1) return;
  if (parseInt(input.value) === userVoteStep) {
    const routeId = input.getAttribute('data-route');
    const schoolId = input.getAttribute('data-school');
    mlCancelGradeVote(routeId, schoolId, input);
  }
}

async function mlCancelGradeVote(routeId, schoolId, input) {
  try {
    if (typeof auth === 'undefined' || !auth.currentUser) return;
    const userId = auth.currentUser.uid;
    const db = firebase.firestore();
    const gradeRef = db.collection('grade_votes').doc(`${schoolId}_${routeId}`);
    const doc = await gradeRef.get();
    if (!doc.exists) return;
    const votes = doc.data().votes || {};
    delete votes[userId];
    await gradeRef.set(
      { schoolId, routeId, votes, updatedAt: firebase.firestore.FieldValue.serverTimestamp() },
      { merge: true }
    );

    // Reset slider to official position
    const container = input.closest('.ml-grade-slider');
    const officialIdx = parseInt(container.getAttribute('data-official-idx'));
    const labelIndices = input.getAttribute('data-label-indices').split(',').map(Number);
    const officialStep = labelIndices.indexOf(officialIdx);
    input.value = officialStep;
    input.setAttribute('data-user-vote-step', '-1');

    // Reset label hint
    const label = container.querySelector('.ml-route-aleje-label');
    if (label) label.innerHTML = 'Grado <span class="ml-route-aleje-hint">(vota)</span>';

    // Update meta text
    const values = Object.values(votes);
    const metaEl = container.querySelector('.ml-grade-slider-meta');
    if (values.length > 0) {
      const avg = values.reduce((a, b) => a + b, 0) / values.length;
      const avgGrade = ALL_GRADES_ORDERED[Math.round(avg)];
      if (metaEl) metaEl.textContent = `${values.length} ${values.length === 1 ? 'voto' : 'votos'} · media ${avgGrade}`;
    } else if (metaEl) {
      metaEl.remove();
    }

    // Update consensus badge
    const showBadge = values.length >= GRADE_CONSENSUS_THRESHOLD && values.length > 0 &&
      Math.round(values.reduce((a, b) => a + b, 0) / values.length) !== officialIdx;
    const popupHeader = document.querySelector('.ml-route-popup-new .ml-route-header');
    if (popupHeader) {
      const badge = popupHeader.querySelector('.ml-grade-consensus-badge');
      if (!showBadge && badge) badge.remove();
    }
    const rbsBadge = document.getElementById('rbs-consensus-badge');
    if (rbsBadge && !showBadge) rbsBadge.style.display = 'none';

    if (typeof showToast === 'function') showToast('Voto cancelado', 'success');
  } catch (e) {
    console.error('[GradeVotes] Error cancelando voto:', e);
    if (typeof showToast === 'function') showToast('No se ha podido cancelar el voto', 'error');
  }
}

function mlGradeSliderInput(input) {
  const labelIndices = input.getAttribute('data-label-indices').split(',').map(Number);
  const officialIdx = parseInt(input.getAttribute('data-official-idx'));
  const gradeIdx = labelIndices[parseInt(input.value)];
  const grade = ALL_GRADES_ORDERED[gradeIdx];

  const container = input.closest('.ml-grade-slider');
  if (!container) return;

}

async function mlVoteGrade(routeId, schoolId, gradeIdx) {
  try {
    if (typeof auth === 'undefined' || !auth.currentUser) {
      if (typeof showToast === 'function') showToast('Inicia sesión para votar el grado');
      return;
    }
    const userId = auth.currentUser.uid;
    const db = firebase.firestore();
    const gradeRef = db.collection('grade_votes').doc(`${schoolId}_${routeId}`);
    const doc = await gradeRef.get();
    const votes = doc.exists ? (doc.data().votes || {}) : {};

    votes[userId] = gradeIdx;
    await gradeRef.set(
      { schoolId, routeId, votes, updatedAt: firebase.firestore.FieldValue.serverTimestamp() },
      { merge: true }
    );

    const values = Object.values(votes);
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    const consensusIdx = Math.round(avg);
    const avgGrade = ALL_GRADES_ORDERED[consensusIdx];

    // Update label hint
    const container = document.querySelector(`.ml-grade-slider[data-route="${routeId}"]`);
    if (container) {
      const label = container.querySelector('.ml-route-aleje-label');
      if (label) label.innerHTML = 'Grado';

      let metaEl = container.querySelector('.ml-grade-slider-meta');
      if (!metaEl) {
        metaEl = document.createElement('span');
        metaEl.className = 'ml-grade-slider-meta';
        container.querySelector('.ml-grade-slider-header').appendChild(metaEl);
      }
      metaEl.textContent = `${values.length} ${values.length === 1 ? 'voto' : 'votos'} · media ${avgGrade}`;
    }

    // Update consensus badge in popup header
    const officialIdx = container ? parseInt(container.getAttribute('data-official-idx')) : -1;
    if (officialIdx !== -1) {
      const showBadge = values.length >= GRADE_CONSENSUS_THRESHOLD && consensusIdx !== officialIdx;
      const badgeText = `${ALL_GRADES_ORDERED[consensusIdx]} · consenso`;

      const popupHeader = document.querySelector('.ml-route-popup-new .ml-route-header');
      if (popupHeader) {
        let badge = popupHeader.querySelector('.ml-grade-consensus-badge');
        if (showBadge) {
          if (!badge) {
            badge = document.createElement('span');
            badge.className = 'ml-grade-consensus-badge';
            popupHeader.appendChild(badge);
          }
          badge.textContent = badgeText;
        } else if (badge) {
          badge.remove();
        }
      }

      const rbsBadge = document.getElementById('rbs-consensus-badge');
      if (rbsBadge) {
        if (showBadge) {
          rbsBadge.textContent = badgeText;
          rbsBadge.style.display = '';
        } else {
          rbsBadge.style.display = 'none';
        }
      }
    }

    // Track voted step for cancel-on-retap
    const sliderInput = container ? container.querySelector('.ml-grade-slider-input') : null;
    if (sliderInput) sliderInput.setAttribute('data-user-vote-step', sliderInput.value);

    if (typeof showToast === 'function') showToast('Grado actualizado', 'success');
  } catch (e) {
    console.error('[GradeVotes] Error votando:', e);
    if (typeof showToast === 'function') showToast('No se ha podido votar el grado', 'error');
  }
}

/**
 * Genera el HTML del sistema de estrellas para votar el estado de la vía.
 * 5 estrellas clicables. El usuario puede votar, cambiar o cancelar su voto.
 * Se muestra la media de todas las votaciones.
 * @param {number} routeId - ID numérico de la ruta (from GeoJSON properties.id)
 * @param {string} schoolId - ID de la escuela
 * @param {number|null} avgVote - Media actual de votaciones (1-5), null si no hay votos
 * @param {number|null} userVote - Voto del usuario actual (1-5), null si no ha votado
 * @returns {string} HTML string
 */
function generateEstadoStarsHTML(routeId, schoolId, avgVote, userVote) {
  let starsHTML = '';
  for (let i = 1; i <= 5; i++) {
    const filledClass = (userVote !== null && i <= userVote) ? 'ml-estado-star-filled' : '';
    const avgClass = (userVote === null && avgVote !== null && i <= Math.round(avgVote)) ? 'ml-estado-star-avg' : '';
    starsHTML += `<span class="ml-estado-star ${filledClass} ${avgClass}" onclick="mlVoteEstado(${routeId}, '${schoolId}', ${i})" data-star="${i}" data-avg="${avgVote !== null ? avgVote : 0}" onmouseenter="mlEstadoHover(${i})" onmouseleave="mlEstadoHover(0)">&#9733;</span>`;
  }

  let avgHTML = '';
  if (avgVote !== null && avgVote > 0) {
    avgHTML = `<span class="ml-estado-avg">${avgVote.toFixed(1)}</span>`;
  }

  return `
    <div class="ml-route-estado">
      <span class="ml-route-estado-label">Estado de la v&iacute;a ${userVote === null ? '<span class="ml-route-estado-hint">(vota)</span>' : ''}</span>
      <div class="ml-estado-stars-row">
        <div class="ml-estado-stars">${starsHTML}</div>
        ${avgHTML}
      </div>
    </div>
  `;
}

/**
 * Efecto hover en estrellas de estado: rellena dorado las estrellas 1..level.
 * Al salir (level=0), restaura el estado real del voto del usuario.
 * @param {number} level - Estrella sobre la que se hace hover (0 = salir)
 */
function mlEstadoHover(level) {
  const stars = document.querySelectorAll('.ml-estado-star');
  stars.forEach(star => {
    const starLevel = parseInt(star.getAttribute('data-star'));
    if (level > 0) {
      // Estrellas dentro del rango hover: dorado sólido (ocultar avg atenuado)
      if (starLevel <= level) {
        star.classList.add('ml-estado-hovering');
        star.classList.add('ml-estado-star-hover');
      } else {
        // Estrellas fuera del rango hover: mantener estado base (avg atenuado si aplica)
        star.classList.remove('ml-estado-hovering');
        star.classList.remove('ml-estado-star-hover');
      }
    } else {
      // Al salir, restaurar estado: mostrar avg de nuevo si no hay voto propio
      star.classList.remove('ml-estado-star-hover');
      star.classList.remove('ml-estado-hovering');
    }
  });
}

/**
 * Vota el estado de una ruta. Guarda en Firestore y actualiza las estrellas visualmente.
 * Si el usuario vota el mismo nivel que ya tenía, se cancela el voto.
 * @param {number} routeId - ID numérico de la ruta
 * @param {string} schoolId - ID de la escuela
 * @param {number} level - Nivel votado (1-5)
 */
async function mlVoteEstado(routeId, schoolId, level) {
  try {
    if (typeof auth === 'undefined' || !auth.currentUser) {
      if (typeof showToast === 'function') showToast('Inicia sesión para votar el estado');
      return;
    }

    const userId = auth.currentUser.uid;
    const docId = `${schoolId}_${routeId}`;
    kxSectorEstadoCache.clear();   // la media del sector cambia con este voto

    const db = firebase.firestore();
    const estadoRef = db.collection('estado_votes').doc(docId);
    const doc = await estadoRef.get();

    let votes = {};
    if (doc.exists) {
      votes = doc.data().votes || {};
    }

    // Toggle: si el usuario ya votó este mismo nivel, cancelar voto
    const isUnvote = votes[userId] === level;

    if (isUnvote) {
      await estadoRef.set({
        schoolId: schoolId,
        routeId: routeId,
        votes: { [userId]: firebase.firestore.FieldValue.delete() },
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      delete votes[userId];
    } else {
      votes[userId] = level;
      await estadoRef.set({
        schoolId: schoolId,
        routeId: routeId,
        votes: votes,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    }

    // Calcular nueva media
    const values = Object.values(votes);
    const avg = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null;
    const newUserVote = isUnvote ? null : level;

    // Actualizar estrellas visualmente
    const starsContainer = document.querySelector('.ml-estado-stars');
    if (starsContainer) {
      const roundedAvg = avg !== null ? Math.round(avg) : 0;
      starsContainer.querySelectorAll('.ml-estado-star').forEach(star => {
        const starLevel = parseInt(star.getAttribute('data-star'));
        star.setAttribute('data-avg', avg !== null ? avg : 0);
        star.classList.toggle('ml-estado-star-filled', newUserVote !== null && starLevel <= newUserVote);
        // Si el usuario quita su voto, mostrar la media atenuada
        star.classList.toggle('ml-estado-star-avg', newUserVote === null && starLevel <= roundedAvg);
      });
    }

    // Actualizar media
    const avgEl = document.querySelector('.ml-estado-avg');
    if (avg !== null) {
      if (avgEl) {
        avgEl.textContent = avg.toFixed(1);
      } else {
        const row = document.querySelector('.ml-estado-stars-row');
        if (row) {
          const span = document.createElement('span');
          span.className = 'ml-estado-avg';
          span.textContent = avg.toFixed(1);
          row.appendChild(span);
        }
      }
    } else if (avgEl) {
      avgEl.remove();
    }

    // Actualizar label "(vota)"
    const label = document.querySelector('.ml-route-estado-label');
    if (label) {
      label.innerHTML = isUnvote
        ? 'Estado de la v&iacute;a <span class="ml-route-estado-hint">(vota)</span>'
        : 'Estado de la v&iacute;a';
    }

    if (typeof showToast === 'function') showToast(isUnvote ? 'Voto de estado cancelado' : 'Estado actualizado');

  } catch (e) {
    console.error('[Estado] Error votando:', e);
    if (typeof showToast === 'function') showToast('No se ha podido votar el estado', 'error');
  }
}

/**
 * Obtiene los datos de votación de estado para una ruta desde Firestore.
 * @param {string} schoolId - ID de la escuela
 * @param {number} routeId - ID numérico de la ruta
 * @returns {Promise<{avg: number|null, userVote: number|null}>}
 */
async function getEstadoVotes(schoolId, routeId) {
  try {
    if (typeof firebase === 'undefined' || !firebase.firestore) {
      return { avg: null, userVote: null };
    }

    const db = firebase.firestore();
    const docId = `${schoolId}_${routeId}`;
    const doc = await db.collection('estado_votes').doc(docId).get();

    if (!doc.exists) return { avg: null, userVote: null };

    const votes = doc.data().votes || {};
    const values = Object.values(votes);

    if (values.length === 0) return { avg: null, userVote: null };

    const avg = values.reduce((a, b) => a + b, 0) / values.length;

    let userVote = null;
    if (typeof auth !== 'undefined' && auth.currentUser) {
      userVote = votes[auth.currentUser.uid] || null;
    }

    return { avg, userVote, count: values.length };
  } catch (e) {
    console.error('[Estado] Error obteniendo votos:', e);
    return { avg: null, userVote: null };
  }
}

/**
 * Obtiene los IDs de todas las vías de un sector a partir de la fuente GeoJSON del mapa.
 * @param {string} sectorName - Nombre del sector
 * @returns {number[]} Array de IDs numéricos de las vías del sector
 */
function getRouteIdsForSector(sectorName) {
  if (!mlMap || !mlMap.getSource('vias-source')) return [];

  const source = mlMap.getSource('vias-source');
  let routeFeatures = [];

  if (source && source._data && source._data.features) {
    routeFeatures = source._data.features;
  } else {
    routeFeatures = mlMap.querySourceFeatures('vias-source', { sourceLayer: 'vias' });
  }

  const targetSector = sectorName.toLowerCase().trim();
  const routeIds = [];

  routeFeatures.forEach(feature => {
    const props = feature.properties;
    const routeSector = (props.sector || '').toLowerCase().trim();
    if (routeSector === targetSector) {
      const id = Number(props.id);
      if (!isNaN(id)) routeIds.push(id);
    }
  });

  return routeIds;
}

/**
 * Calcula el estado medio de un sector a partir de los votos de estado de sus vías.
 * Solo muestra resultado si al menos el 40% de las vías tienen valoración.
 * @param {string} schoolId - ID de la escuela
 * @param {string} sectorName - Nombre del sector
 * @returns {Promise<{avg: number|null, ratedCount: number, totalCount: number}>}
 */
// Medias de estado ya calculadas por sector (evita releer todos los votos al reabrir la ficha).
// mlVoteEstado la vacía al votar.
const kxSectorEstadoCache = new Map();   // "schoolId|sector" → { at, promise }
const KX_SECTOR_ESTADO_TTL = 5 * 60 * 1000;

async function getSectorEstadoAverage(schoolId, sectorName, routeIdsIn) {
  const key = `${schoolId}|${String(sectorName || '').toLowerCase().trim()}`;
  const hit = kxSectorEstadoCache.get(key);
  if (hit && Date.now() - hit.at < KX_SECTOR_ESTADO_TTL) return hit.promise;
  const promise = kxComputeSectorEstado(schoolId, sectorName, routeIdsIn);
  kxSectorEstadoCache.set(key, { at: Date.now(), promise });
  promise.then(r => { if (r.error) kxSectorEstadoCache.delete(key); });
  return promise;
}

async function kxComputeSectorEstado(schoolId, sectorName, routeIdsIn) {
  try {
    if (typeof firebase === 'undefined' || !firebase.firestore) {
      return { avg: null, ratedCount: 0, totalCount: 0, votesCount: 0 };
    }

    const routeIds = Array.isArray(routeIdsIn) ? routeIdsIn : getRouteIdsForSector(sectorName);
    const totalCount = routeIds.length;

    if (totalCount === 0) return { avg: null, ratedCount: 0, totalCount: 0, votesCount: 0 };

    const db = firebase.firestore();
    const BATCH_SIZE = 10; // Firestore 'in' queries limited to 10
    const allAvgs = [];
    let votesCount = 0;

    // Batch query estado_votes documents
    for (let i = 0; i < routeIds.length; i += BATCH_SIZE) {
      const batch = routeIds.slice(i, i + BATCH_SIZE);
      const docIds = batch.map(id => `${schoolId}_${id}`);

      // Fetch each doc individually (doc IDs, not field queries)
      const promises = docIds.map(docId =>
        db.collection('estado_votes').doc(docId).get()
      );
      const docs = await Promise.all(promises);

      docs.forEach(doc => {
        if (doc.exists) {
          const votes = doc.data().votes || {};
          const values = Object.values(votes);
          if (values.length > 0) {
            const avg = values.reduce((a, b) => a + b, 0) / values.length;
            allAvgs.push(avg);
            votesCount += values.length;
          }
        }
      });
    }

    const ratedCount = allAvgs.length;
    const minRequired = Math.ceil(totalCount * 0.4);

    if (ratedCount < minRequired) {
      return { avg: null, ratedCount, totalCount, votesCount };
    }

    const sectorAvg = allAvgs.reduce((a, b) => a + b, 0) / allAvgs.length;
    return { avg: sectorAvg, ratedCount, totalCount, votesCount };
  } catch (e) {
    console.error('[SectorEstado] Error calculando media del sector:', e);
    return { avg: null, ratedCount: 0, totalCount: 0, votesCount: 0, error: true };
  }
}

/**
 * Genera HTML de estrellas de solo lectura para el estado del sector.
 * @param {number} avgVote - Media del estado (1-5)
 * @param {number} ratedCount - Número de vías valoradas
 * @param {number} totalCount - Total de vías en el sector
 * @returns {string} HTML del indicador
 */
function generateSectorEstadoHTML(avgVote, ratedCount, totalCount) {
  let starsHTML = '';
  const roundedAvg = Math.round(avgVote);

  for (let i = 1; i <= 5; i++) {
    const filledClass = i <= roundedAvg ? 'ml-sector-estado-star-filled' : '';
    starsHTML += `<span class="ml-sector-estado-star ${filledClass}">&#9733;</span>`;
  }

  return `
    <div class="ml-sector-estado">
      <div class="ml-sector-estado-header">
        <span class="ml-sector-estado-label">Estado del Sector</span>
        <span class="ml-sector-estado-count">${ratedCount}/${totalCount} v&iacute;as valoradas</span>
      </div>
      <div class="ml-sector-estado-row">
        <div class="ml-sector-estado-stars">${starsHTML}</div>
        <span class="ml-sector-estado-avg">${avgVote.toFixed(1)}</span>
      </div>
    </div>
  `;
}

/**
 * Abre modal para que el usuario contribuya datos faltantes de una vía
 */
// Vía y campo a los que se atribuye la contribución abierta (una variante usa exp2/long2…)
let mlContributeTarget = { routeName: null, suffix: 1 };

function mlContributeField(routeId, schoolId, field, suffix = 1, encodedName = '') {
  const routeName = (encodedName && decodeURIComponent(encodedName)) || mlCurrentRouteName || 'Sin nombre';
  mlContributeTarget = { routeName, suffix: Number(suffix) || 1 };

  // Cerrar popup / bottom sheet
  if (mlRoutePopup) mlRoutePopup.remove();
  hideRouteBottomSheet();

  // Si hay una función de contribución disponible en user-features, usarla
  if (typeof openContributeModal === 'function') {
    openContributeModal(schoolId, routeName, field);
    return;
  }

  // Generar solo el campo correspondiente al tipo de sugerencia
  let fieldHTML = '';
  if (field === 'tipo') {
    fieldHTML = `
      <label style="display:block; margin-bottom:8px; font-size:14px; color:#374151;">Tipo de escalada</label>
      <select class="ml-contribute-select" id="ml-contribute-tipo">
        <option value="">Selecciona...</option>
        <option value="Placa">Placa</option>
        <option value="Fisura">Fisura</option>
        <option value="Diedro">Diedro</option>
        <option value="Desplome">Desplome</option>
        <option value="Bavaresa">Bavaresa</option>
        <option value="Chimenea">Chimenea</option>
      </select>`;
  } else if (field === 'express') {
    fieldHTML = `
      <label style="display:block; margin-bottom:8px; font-size:14px; color:#374151;">N&uacute;mero de express</label>
      <input type="number" class="ml-contribute-input" id="ml-contribute-exp" placeholder="Ej: 8" min="0" max="50">`;
  } else if (field === 'metros') {
    fieldHTML = `
      <label style="display:block; margin-bottom:8px; font-size:14px; color:#374151;">Metros de la v&iacute;a</label>
      <input type="number" class="ml-contribute-input" id="ml-contribute-long" placeholder="Ej: 25" min="0" max="500">`;
  } else {
    // Fallback: mostrar todos los campos si no se especifica campo
    fieldHTML = `
      <label style="display:block; margin-bottom:8px; font-size:14px; color:#374151;">Tipo de escalada</label>
      <select class="ml-contribute-select" id="ml-contribute-tipo">
        <option value="">Selecciona...</option>
        <option value="Placa">Placa</option>
        <option value="Fisura">Fisura</option>
        <option value="Diedro">Diedro</option>
        <option value="Desplome">Desplome</option>
        <option value="Bavaresa">Bavaresa</option>
        <option value="Chimenea">Chimenea</option>
      </select>
      <label style="display:block; margin-top:12px; margin-bottom:8px; font-size:14px; color:#374151;">N&uacute;mero de express</label>
      <input type="number" class="ml-contribute-input" id="ml-contribute-exp" placeholder="Ej: 8" min="0" max="50">
      <label style="display:block; margin-top:12px; margin-bottom:8px; font-size:14px; color:#374151;">Metros de la v&iacute;a</label>
      <input type="number" class="ml-contribute-input" id="ml-contribute-long" placeholder="Ej: 25" min="0" max="500">`;
  }

  // Fallback: Mostrar modal básico de contribución
  const overlay = document.createElement('div');
  overlay.className = 'ml-contribute-modal-overlay';
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

  overlay.innerHTML = `
    <div class="ml-contribute-modal">
      <h3>Contribuir datos</h3>
      <p>Ayuda a completar la información de <strong>${routeName}</strong></p>
      ${fieldHTML}
      <div class="ml-contribute-actions">
        <button class="ml-contribute-btn ml-contribute-btn-cancel" onclick="this.closest('.ml-contribute-modal-overlay').remove()">Cancelar</button>
        <button class="ml-contribute-btn ml-contribute-btn-submit" onclick="mlSubmitContribution(${routeId}, '${schoolId}')">Enviar</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
}

/**
 * Envía la contribución de datos de vía a Firestore
 */
async function mlSubmitContribution(routeId, schoolId) {
  const routeName = mlContributeTarget.routeName || mlCurrentRouteName || 'Sin nombre';
  const suffix = mlContributeTarget.suffix;
  const tipo = document.getElementById('ml-contribute-tipo')?.value;
  const exp = document.getElementById('ml-contribute-exp')?.value;
  const long = document.getElementById('ml-contribute-long')?.value;

  if (!tipo && !exp && !long) {
    if (typeof showToast === 'function') showToast('Rellena al menos un campo', 'info');
    return;
  }

  if (typeof db === 'undefined' || typeof currentUser === 'undefined' || !currentUser) {
    if (typeof showToast === 'function') showToast('Inicia sesión para contribuir', 'info');
    return;
  }

  const contribution = {
    routeId: routeId,
    routeName: routeName,
    schoolId: schoolId,
    userId: currentUser.uid,
    userEmail: currentUser.email,
    status: 'pending',
    timestamp: firebase.firestore.FieldValue.serverTimestamp(),
    data: {}
  };
  if (tipo) contribution.data.descripcion = tipo;
  if (exp) contribution.data['exp' + suffix] = parseInt(exp);
  if (long) contribution.data['long' + suffix] = parseInt(long);

  try {
    await db.collection('routeSuggestions').add(contribution);

    // Mostrar éxito
    const modal = document.querySelector('.ml-contribute-modal');
    if (modal) {
      modal.innerHTML = `
        <div class="ml-contribute-success">
          <div class="ml-contribute-success-icon">&#10004;&#65039;</div>
          <h3>Gracias</h3>
          <p>Tu contribuci&oacute;n ser&aacute; revisada por un administrador.</p>
        </div>
      `;
      setTimeout(() => {
        document.querySelector('.ml-contribute-modal-overlay')?.remove();
      }, 2000);
    }
  } catch (error) {
    console.error('Error enviando contribución:', error);
    if (typeof showToast === 'function') showToast('Error al enviar', 'error');
  }
}
window.mlContributeField = mlContributeField;
window.mlSubmitContribution = mlSubmitContribution;

// ============================================
// NOTIFICAR UN PROBLEMA (vías de KRUX)
// ============================================
// Se guarda en routeSuggestions con kind: 'report' (las reglas ya permiten crearlo con status 'pending')
// y los admins lo revisan en Sugerencias.

let mlReportRoute = null;
let mlReportReady = false;

// Fila «Notificar incidencia» de la ficha de vía. Cualquier usuario con sesión puede usarla, sin registrar ascensión.
function mlReportButtonHTML(route) {
  const data = encodeURIComponent(JSON.stringify(route));
  return `<button type="button" class="kx-rnotify" data-route="${data}" onclick="mlOpenRouteReport(this)">
    <svg class="kx-rnotify-flag" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 21.5V3.5"/><path d="M5 4h13l-2.6 4.5L18 13H5"/></svg>
    <span class="kx-rnotify-text"><span class="kx-rnotify-title">Notificar incidencia</span><span class="kx-rnotify-sub">Equipamiento, seguridad o información</span></span>
    <svg class="kx-rnotify-chev" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>
  </button>`;
}

// ============================================
// INCIDENCIAS DE VÍA (como en Waze)
// Cada aviso es público y la comunidad lo confirma («Sigue ahí») o lo niega («Ya no está»).
// Colección route_incident_votes: un documento por usuario, vía y tipo de problema
// ({schoolId}_{routeId}_{tipo}_{uid}), con vote = 'report' | 'confirm' | 'deny'.
// Una incidencia está activa si avisos + confirmaciones superan a los «Ya no está»
// y alguien la ha avisado o confirmado en los últimos KX_INCIDENT_TTL_DAYS días.
// ============================================

const KX_INCIDENT_TYPES = {
  seguridad: 'Chapas o roca en mal estado',
  grado: 'El grado podría ser incorrecto',
  nombre: 'El nombre podría ser incorrecto',
  datos: 'Expreses, metros o tipo incorrectos',
  ubicacion: 'Ubicación en el mapa incorrecta',
  otro: 'Otro problema'
};
const KX_INCIDENT_ORDER = ['seguridad', 'datos', 'grado', 'nombre', 'ubicacion', 'otro'];
const KX_INCIDENT_TTL_DAYS = 90;

let kxIncidentCtx = null; // { schoolId, routeId, routeName, sector, incidents }

function kxIncidentRouteKey(schoolId, routeId) {
  return `${schoolId}_${routeId}`;
}

function kxCurrentUid() {
  if (typeof auth !== 'undefined' && auth && auth.currentUser) return auth.currentUser.uid;
  return (typeof currentUser !== 'undefined' && currentUser) ? currentUser.uid : null;
}

/**
 * Incidencias activas de una vía, la de seguridad primero.
 * → [{ type, label, reports, confirms, denies, firstAt, lastAt, myVote }]
 */
async function kxLoadRouteIncidents(schoolId, routeId) {
  if (!schoolId || !Number.isFinite(Number(routeId)) || typeof firebase === 'undefined' || !firebase.firestore) return [];
  try {
    const snap = await firebase.firestore().collection('route_incident_votes')
      .where('routeKey', '==', kxIncidentRouteKey(schoolId, Number(routeId))).get();
    const uid = kxCurrentUid();
    const byType = {};
    snap.forEach(doc => {
      const v = doc.data();
      if (!KX_INCIDENT_TYPES[v.type]) return;
      const it = byType[v.type] || (byType[v.type] = { type: v.type, label: KX_INCIDENT_TYPES[v.type], reports: 0, confirms: 0, denies: 0, firstAt: null, lastAt: null, myVote: null });
      const at = v.at && typeof v.at.toDate === 'function' ? v.at.toDate() : new Date();
      if (v.vote === 'report') it.reports++;
      else if (v.vote === 'confirm') it.confirms++;
      else if (v.vote === 'deny') it.denies++;
      if (v.vote === 'report' && (!it.firstAt || at < it.firstAt)) it.firstAt = at;
      if (v.vote !== 'deny' && (!it.lastAt || at > it.lastAt)) it.lastAt = at;
      if (v.uid === uid) it.myVote = v.vote;
    });
    const limit = Date.now() - KX_INCIDENT_TTL_DAYS * 86400000;
    return Object.values(byType)
      .filter(it => it.reports + it.confirms > it.denies && it.lastAt && it.lastAt.getTime() >= limit)
      .map(it => ({ ...it, firstAt: it.firstAt || it.lastAt }))
      .sort((a, b) => KX_INCIDENT_ORDER.indexOf(a.type) - KX_INCIDENT_ORDER.indexOf(b.type));
  } catch (e) {
    console.warn('[Incidencias] No se han podido cargar:', e);
    return [];
  }
}

/**
 * Guarda el voto del usuario sobre una incidencia (sustituye al que tuviera para ese tipo).
 */
async function kxSaveIncidentVote({ schoolId, routeId, routeName = '', sector = '', type, vote }) {
  const uid = kxCurrentUid();
  if (!uid || !KX_INCIDENT_TYPES[type] || !Number.isFinite(Number(routeId))) return false;
  const routeKey = kxIncidentRouteKey(schoolId, Number(routeId));
  await firebase.firestore().collection('route_incident_votes').doc(`${routeKey}_${type}_${uid}`).set({
    routeKey,
    schoolId,
    routeId: Number(routeId),
    routeName,
    sector,
    type,
    uid,
    vote,
    at: firebase.firestore.FieldValue.serverTimestamp()
  });
  return true;
}

// «hace 3 días», «hoy», «hace 2 meses»
function kxIncidentAgo(date) {
  const days = Math.floor((Date.now() - date.getTime()) / 86400000);
  if (days <= 0) return 'hoy';
  if (days === 1) return 'ayer';
  if (days < 30) return `hace ${days} días`;
  const months = Math.floor(days / 30);
  return months === 1 ? 'hace 1 mes' : `hace ${months} meses`;
}

/**
 * Tarjeta naranja «Incidencia comunicada». Vacía si la vía no tiene incidencias activas.
 */
function kxRouteIncidentCardHTML(incidents) {
  if (!incidents || !incidents.length) return '';
  const first = incidents[0];
  const summary = incidents.length > 1 ? `${first.label} y ${incidents.length - 1} más.` : `${first.label}.`;
  return `
    <section class="kx-rincident" aria-label="Incidencia comunicada">
      <svg class="kx-rincident-icon" width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.3 3.9 1.9 18a2 2 0 0 0 1.7 3h16.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4.5"/><circle cx="12" cy="17.2" r="0.7" fill="currentColor"/></svg>
      <div class="kx-rincident-main">
        <h3 class="kx-rincident-title">Incidencia comunicada</h3>
        <p class="kx-rincident-sub">${kxEscHTML(summary)}</p>
      </div>
      <button type="button" class="kx-rincident-btn" onclick="kxOpenIncidentSheet()">Ver detalles<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg></button>
    </section>`;
}

/**
 * Carga y pinta las incidencias de una vía en un contenedor de la ficha.
 */
async function kxRenderRouteIncidents({ schoolId, routeId, routeName, sector }, containerId) {
  const incidents = await kxLoadRouteIncidents(schoolId, routeId);
  if (Number(mlCurrentRouteId) === Number(routeId)) {
    kxIncidentCtx = { schoolId, routeId: Number(routeId), routeName, sector, incidents };
  }
  const el = document.getElementById(containerId);
  if (el) el.innerHTML = kxRouteIncidentCardHTML(incidents);
  return incidents;
}

function kxRefreshIncidentViews() {
  const ctx = kxIncidentCtx;
  if (!ctx) return;
  const route = { schoolId: ctx.schoolId, routeId: ctx.routeId, routeName: ctx.routeName, sector: ctx.sector };
  ['rbs-incident-container', `ml-variant-incident-${ctx.routeId}`].forEach(id => {
    if (document.getElementById(id)) kxRenderRouteIncidents(route, id).then(() => kxRenderIncidentSheet());
  });
}

// ---- Hoja «Ver detalles»: cada incidencia con «Sigue ahí» / «Ya no está» ----
function kxOpenIncidentSheet() {
  const sheet = document.getElementById('route-incident-sheet');
  if (!sheet || !kxIncidentCtx) return;
  document.getElementById('route-incident-route').textContent =
    [kxIncidentCtx.routeName, kxIncidentCtx.sector].filter(Boolean).join(' · ');
  kxRenderIncidentSheet();
  sheet.classList.remove('hidden');
}

function kxRenderIncidentSheet() {
  const list = document.getElementById('route-incident-list');
  if (!list || !kxIncidentCtx) return;
  const items = kxIncidentCtx.incidents || [];
  if (!items.length) {
    list.innerHTML = '<p class="ri-empty">Esta vía ya no tiene incidencias activas.</p>';
    return;
  }
  list.innerHTML = items.map(it => {
    const avisos = `${it.reports} ${it.reports === 1 ? 'aviso' : 'avisos'}`;
    const mine = it.myVote === 'report' ? '<span class="ri-mine">La comunicaste tú</span>' : '';
    return `
      <article class="ri-item">
        <h3 class="ri-title">${kxEscHTML(it.label)}</h3>
        <p class="ri-meta">Comunicada ${kxIncidentAgo(it.firstAt)} · ${avisos}${mine ? ' · ' : ''}${mine}</p>
        <p class="ri-q">¿Sigue ahí?</p>
        <div class="ri-actions" role="group" aria-label="¿Sigue ahí? ${kxEscHTML(it.label)}">
          <button type="button" class="ri-vote is-yes${it.myVote === 'confirm' ? ' is-on' : ''}" aria-pressed="${it.myVote === 'confirm'}" onclick="kxVoteIncident('${it.type}', 'confirm', this)">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>
            Sigue ahí<span class="ri-count">${it.reports + it.confirms}</span>
          </button>
          <button type="button" class="ri-vote is-no${it.myVote === 'deny' ? ' is-on' : ''}" aria-pressed="${it.myVote === 'deny'}" onclick="kxVoteIncident('${it.type}', 'deny', this)">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
            Ya no está<span class="ri-count">${it.denies}</span>
          </button>
        </div>
      </article>`;
  }).join('');
}

async function kxVoteIncident(type, vote, btn) {
  const ctx = kxIncidentCtx;
  if (!ctx) return;
  if (!kxCurrentUid()) {
    if (typeof showToast === 'function') showToast('Inicia sesión para confirmar incidencias', 'info');
    return;
  }
  const it = (ctx.incidents || []).find(i => i.type === type);
  if (it && it.myVote === vote) return;
  if (btn) btn.disabled = true;
  try {
    await kxSaveIncidentVote({ ...ctx, type, vote });
    if (typeof showToast === 'function') showToast(vote === 'deny' ? 'Gracias. Lo tendremos en cuenta' : 'Gracias por confirmarlo', 'success');
    kxRefreshIncidentViews();
  } catch (e) {
    console.error('[Incidencias] Error votando:', e);
    if (typeof showToast === 'function') showToast('No se ha podido guardar tu respuesta', 'error');
    if (btn) btn.disabled = false;
  }
}

window.kxOpenIncidentSheet = kxOpenIncidentSheet;
window.kxVoteIncident = kxVoteIncident;

function mlOpenRouteReport(btn) {
  let route = null;
  try { route = JSON.parse(decodeURIComponent(btn?.dataset.route || '')); } catch (_) { /* sin datos */ }
  const sheet = document.getElementById('route-report-sheet');
  if (!route || !sheet) return;

  if (typeof currentUser === 'undefined' || !currentUser) {
    if (typeof showToast === 'function') showToast('Inicia sesión para notificar una incidencia', 'info');
    return;
  }

  mlInitRouteReport();
  mlReportRoute = route;

  document.getElementById('route-report-route').textContent =
    [route.routeName, route.sector].filter(Boolean).join(' · ');

  const now = document.getElementById('route-report-grade-now');
  now.textContent = route.grade || '?';
  now.style.backgroundColor = getGradeColor(route.grade || '?');

  const select = document.getElementById('route-report-grade');
  select.innerHTML = '<option value="">Elige el grado</option>' +
    ALL_GRADES_ORDERED.map(g => `<option value="${g}">${g}</option>`).join('');

  document.getElementById('route-report-name').value = route.routeName || '';
  document.getElementById('route-report-message').value = '';
  document.querySelectorAll('#route-report-issues .kx-chip').forEach(chip => mlSetReportChip(chip, false));
  mlUpdateReportFields();
  mlShowReportError('');

  const submit = document.getElementById('route-report-submit');
  submit.disabled = false;
  submit.textContent = 'Enviar';

  sheet.classList.remove('hidden');
}

function mlSetReportChip(chip, on) {
  chip.classList.toggle('is-active', on);
  chip.setAttribute('aria-pressed', on ? 'true' : 'false');
}

function mlSelectedReportIssues() {
  return [...document.querySelectorAll('#route-report-issues .kx-chip.is-active')].map(c => c.dataset.issue);
}

// Campos que dependen de lo marcado: grado correcto, nombre correcto y texto obligatorio con «Otro»
function mlUpdateReportFields() {
  const issues = mlSelectedReportIssues();
  document.getElementById('route-report-grade-group').hidden = !issues.includes('grado');
  document.getElementById('route-report-name-group').hidden = !issues.includes('nombre');
  document.getElementById('route-report-optional').hidden = issues.includes('otro');
}

function mlShowReportError(text) {
  const el = document.getElementById('route-report-error');
  el.textContent = text;
  el.hidden = !text;
}

function mlInitRouteReport() {
  if (mlReportReady) return;
  mlReportReady = true;

  document.getElementById('route-report-issues').addEventListener('click', (e) => {
    const chip = e.target.closest('.kx-chip');
    if (!chip) return;
    mlSetReportChip(chip, !chip.classList.contains('is-active'));
    mlUpdateReportFields();
    mlShowReportError('');
  });

  document.getElementById('route-report-form').addEventListener('submit', (e) => {
    e.preventDefault();
    mlSubmitRouteReport();
  });
}

async function mlSubmitRouteReport() {
  const route = mlReportRoute;
  if (!route) return;
  if (typeof currentUser === 'undefined' || !currentUser) {
    mlShowReportError('Inicia sesión para notificar una incidencia.');
    return;
  }

  const issues = mlSelectedReportIssues();
  const message = document.getElementById('route-report-message').value.trim();
  const grade = document.getElementById('route-report-grade').value;
  const name = document.getElementById('route-report-name').value.trim();

  if (!issues.length) return mlShowReportError('Marca qué ocurre con la vía.');
  if (issues.includes('grado') && (!grade || grade === route.grade)) {
    return mlShowReportError('Elige el grado correcto.');
  }
  if (issues.includes('nombre') && (!name || name === route.routeName)) {
    return mlShowReportError('Escribe el nombre correcto.');
  }
  if (issues.includes('otro') && !message) return mlShowReportError('Cuéntanos qué ocurre.');

  const report = {
    kind: 'report',
    routeId: route.routeId,
    routeName: route.routeName || 'Sin nombre',
    schoolId: route.schoolId || '',
    sector: route.sector || '',
    grade: route.grade || '',
    issues,
    message,
    userId: currentUser.uid,
    userEmail: currentUser.email || '',
    status: 'pending',
    timestamp: firebase.firestore.FieldValue.serverTimestamp()
  };
  const proposed = {};
  if (issues.includes('grado')) proposed.grado1 = grade;
  if (issues.includes('nombre')) proposed.nombre = name;
  if (Object.keys(proposed).length) report.proposed = proposed;

  const submit = document.getElementById('route-report-submit');
  submit.disabled = true;
  submit.textContent = 'Enviando…';
  mlShowReportError('');

  try {
    await db.collection('routeSuggestions').add(report);
    // Cada tipo marcado se publica como incidencia para que la comunidad la confirme o la niegue
    try {
      await Promise.all(issues.map(type => kxSaveIncidentVote({
        schoolId: route.schoolId, routeId: route.routeId, routeName: route.routeName || '', sector: route.sector || '', type, vote: 'report'
      })));
      kxRefreshIncidentViews();
    } catch (err) {
      console.warn('[Incidencias] No se ha podido publicar la incidencia:', err);
    }
    const sheet = document.getElementById('route-report-sheet');
    if (typeof closeFeedSheet === 'function') closeFeedSheet(sheet);
    else sheet.classList.add('hidden');
    if (typeof showToast === 'function') showToast('Gracias. Revisaremos la vía', 'success');
  } catch (error) {
    console.error('Error enviando el reporte de la vía:', error);
    mlShowReportError('No se pudo enviar. Inténtalo de nuevo.');
    submit.disabled = false;
    submit.textContent = 'Enviar';
  }
}

window.mlOpenRouteReport = mlOpenRouteReport;

// Funciones para los botones del popup - conectadas con user-features.js
function mlRegisterAscent(routeId, encodedName) {
  const name = decodeURIComponent(encodedName);
  console.log('Registrar ascenso:', name, 'routeId:', routeId);

  // Cerrar popup
  if (mlRoutePopup) mlRoutePopup.remove();

  // Usar openAscentModal de user-features.js
  if (typeof openAscentModal === 'function') {
    // Obtener datos de la vía actual
    const schoolId = mlCurrentSchool || 'valeria';
    const schoolName = MAPLIBRE_SCHOOLS[schoolId]?.name || 'Escuela';
    const grade = mlCurrentRouteGrade || '?';
    const sector = mlCurrentRouteSector || '';
    openAscentModal(schoolId, schoolName, routeId, name, grade, sector);
  } else {
    showToast('Función de registro no disponible', 'info');
  }
}

function mlToggleFavorite(encodedName) {
  const name = decodeURIComponent(encodedName);
  console.log('Toggle favorito:', name);

  if (typeof addToFavorites === 'function') {
    const schoolId = mlCurrentSchool || 'valeria';
    addToFavorites(schoolId, name);
  } else {
    showToast('Función de favoritos no disponible', 'info');
  }
}

function buildBookmarkIcon(routeId) {
  const inProj = typeof isProject === 'function' && isProject(routeId);
  const color = inProj ? '#eab308' : 'currentColor';
  const fill = inProj ? '#eab308' : 'none';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="${fill}" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>`;
}

function isRouteInProjects(routeId) {
  return typeof isProject === 'function' && isProject(routeId);
}

async function mlToggleBookmark(routeId, encodedName) {
  const name = decodeURIComponent(encodedName);

  if (typeof toggleProject !== 'function') {
    showToast('Función no disponible', 'error');
    return;
  }

  await toggleProject(routeId, name, mlCurrentRouteGrade || '');

  // Actualizar icono + estado "presionado" del botón en el popup activo
  const btn = document.getElementById('ml-bookmark-btn');
  if (btn) {
    const saved = isRouteInProjects(routeId);
    const icon = btn.querySelector('.kx-ract-icon');
    if (icon) {
      icon.innerHTML = kxRouteBookmarkIcon(saved);
      btn.setAttribute('aria-pressed', String(saved));
    } else {
      btn.innerHTML = buildBookmarkIcon(routeId);
    }
    btn.classList.toggle('bookmark-active', saved);
  }

  // Si el filtro de proyectos está activo, reaplicar para reflejar el cambio
  if (mlShowOnlyProjects) applyGradeFilter();
}

function mlOpenComments(routeId, encodedName) {
  const name = decodeURIComponent(encodedName);
  console.log('Abrir comentarios:', name, 'routeId:', routeId);

  // Cerrar popup
  if (mlRoutePopup) mlRoutePopup.remove();

  // Abrir modal de comentarios directamente
  if (typeof openCommentsModal === 'function') {
    openCommentsModal(mlCurrentSchool, routeId, name);
  } else {
    showToast('Comentarios no disponibles', 'info');
  }
}

function mlShareRoute(routeId, encodedName) {
  const name = decodeURIComponent(encodedName);
  console.log('Compartir ruta:', name, 'routeId:', routeId);

  // Usar Web Share API si está disponible
  if (navigator.share) {
    navigator.share({
      title: name,
      text: `Mira esta vía de escalada: ${name}`,
      url: window.location.href
    }).catch(() => {
      // Si falla, copiar al portapapeles
      copyToClipboard(window.location.href);
    });
  } else {
    // Fallback: copiar URL al portapapeles
    const url = window.location.href;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url).then(() => {
        showToast('Enlace copiado al portapapeles', 'success');
      });
    }
  }
}

/**
 * Abre el visor del sector con la vía resaltada
 */
function mlViewRouteInSector(schoolId, encodedSector, routeId, variantIndex = 0) {
  routeId = Number(routeId);
  variantIndex = Number(variantIndex) || 0;
  const sectorName = decodeURIComponent(encodedSector);
  console.log('Ver vía en sector:', routeId, 'variantIndex:', variantIndex, 'en', sectorName);

  // Cerrar popup
  if (mlRoutePopup) mlRoutePopup.remove();

  // Abrir el visor del sector con la vía resaltada
  if (typeof openSectorImageViewerWithHighlight === 'function') {
    openSectorImageViewerWithHighlight(schoolId, sectorName, routeId, variantIndex);
  } else {
    // Fallback: abrir visor sin highlight
    if (typeof openSectorImageViewer === 'function') {
      openSectorImageViewer(schoolId, sectorName);
    } else {
      showToast('Visor de sector no disponible', 'info');
    }
  }
}

// ============================================
// HIGHLIGHT DE VÍA EN EL MAPA (desde visor de sector)
// ============================================

let mlHighlightTimer = null;

/**
 * Encuentra la coordenada de una vía por su routeId.
 * Busca primero en el source de vector tiles y luego en el GeoJSON.
 */
async function mlFindRouteCoords(routeId) {
  // 1. Intentar querySourceFeatures (vector tiles cargados)
  if (mlMap && mlMap.getSource('vias-source')) {
    try {
      let features = mlMap.querySourceFeatures('vias-source', { sourceLayer: 'vias' });
      if (!features.length) {
        features = mlMap.querySourceFeatures('vias-source');
      }
      for (const f of features) {
        if (f.properties && Number(f.properties.id) === Number(routeId)) {
          if (f.geometry.type === 'Point') return f.geometry.coordinates;
          if (f.geometry.type === 'MultiPoint') return f.geometry.coordinates[0];
        }
      }
    } catch (e) { /* tiles may not be loaded */ }

    // 1b. Intentar source._data (GeoJSON mode)
    try {
      const source = mlMap.getSource('vias-source');
      if (source && source._data && source._data.features) {
        for (const f of source._data.features) {
          if (f.properties && Number(f.properties.id) === Number(routeId)) {
            if (f.geometry.type === 'Point') return f.geometry.coordinates;
            if (f.geometry.type === 'MultiPoint') return f.geometry.coordinates[0];
          }
        }
      }
    } catch (e) { /* no _data */ }
  }

  // 2. Fallback: fetch GeoJSON directamente
  const schoolId = mlCurrentSchool || 'valeria';
  const school = typeof MAPLIBRE_SCHOOLS !== 'undefined' ? MAPLIBRE_SCHOOLS[schoolId] : null;
  if (school && school.geojson && school.geojson.vias) {
    try {
      const resp = await fetch(school.geojson.vias);
      if (resp.ok) {
        const geojson = await resp.json();
        for (const f of (geojson.features || [])) {
          if (f.properties && Number(f.properties.id) === Number(routeId)) {
            if (f.geometry.type === 'Point') return f.geometry.coordinates;
            if (f.geometry.type === 'MultiPoint') return f.geometry.coordinates[0];
          }
        }
      }
    } catch (e) { /* fetch failed */ }
  }

  return null;
}

/**
 * Navega al mapa, centra en la vía y la resalta visualmente.
 * Llamada desde el visor de sector (svNavigateToRouteOnMap).
 * Compatible con Web y App Nativa (Capacitor WebView).
 */
async function mlHighlightRouteOnMap(routeId) {
  if (!mlMap) return;

  const coords = await mlFindRouteCoords(routeId);
  if (!coords) {
    if (typeof showToast === 'function') showToast('No se encontró la vía en el mapa', 'info');
    return;
  }

  const mobile = typeof isMobileDevice === 'function' && isMobileDevice();
  const targetZoom = Math.max(mlMap.getZoom(), 18);

  // Volar a la ubicación de la vía (parámetros ajustados para móvil)
  mlMap.flyTo({
    center: coords,
    zoom: targetZoom,
    speed: mobile ? 1.6 : 1.2,
    curve: 1,
    padding: { top: mobile ? 60 : 100, bottom: 0, left: 0, right: 0 }
  });

  // Aplicar highlight tras la animación de vuelo
  mlMap.once('moveend', () => {
    mlApplyRouteHighlight(coords, routeId);
  });
}

// ID del requestAnimationFrame activo para la animación de pulso
let mlPulseAnimId = null;

/**
 * Aplica un highlight visual temporal (anillo pulsante) en la posición de la vía.
 * Usa requestAnimationFrame para rendimiento fluido en WebView móvil.
 */
function mlApplyRouteHighlight(coords, routeId, opts = {}) {
  // Limpiar highlight anterior
  mlClearRouteHighlight();

  const mobile = typeof isMobileDevice === 'function' && isMobileDevice();
  const highlightSourceId = 'vias-highlight-source';
  const highlightLayerId = 'vias-highlight-layer';
  const highlightPulseLayerId = 'vias-highlight-pulse-layer';

  // Crear source con la vía destacada
  mlMap.addSource(highlightSourceId, {
    type: 'geojson',
    data: {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry: { type: 'Point', coordinates: coords },
        properties: { id: routeId }
      }]
    }
  });

  // Resaltado breve y estático (sin pulso continuo): halo salvia + anillo verde bosque alrededor del punto.
  // El anillo crece suavemente desde el tamaño de la vía (transición nativa de MapLibre).
  const r = opts.radius || (mlGetViasRadius() + KX_ROUTE_STROKE);
  const ringRadius = r + (mobile ? 5 : 6);

  mlMap.addLayer({
    id: highlightPulseLayerId,
    type: 'circle',
    source: highlightSourceId,
    paint: {
      'circle-radius': r,
      'circle-radius-transition': { duration: 240 },
      'circle-color': KX_MAP.halo,
      'circle-opacity': 0.42,
      'circle-blur': 0.35
    }
  });

  mlMap.addLayer({
    id: highlightLayerId,
    type: 'circle',
    source: highlightSourceId,
    paint: {
      'circle-radius': r,
      'circle-radius-transition': { duration: 240 },
      'circle-color': 'rgba(0,0,0,0)',
      'circle-stroke-color': KX_MAP.forest,
      'circle-stroke-width': 2.5,
      'circle-stroke-opacity': 1
    }
  });

  mlPulseAnimId = requestAnimationFrame(() => {
    mlPulseAnimId = null;
    try {
      mlMap.setPaintProperty(highlightPulseLayerId, 'circle-radius', ringRadius + 6);
      mlMap.setPaintProperty(highlightLayerId, 'circle-radius', ringRadius);
    } catch (e) {}
  });

  // Auto-eliminar el highlight después de 5 segundos
  mlHighlightTimer = setTimeout(() => {
    mlClearRouteHighlight();
  }, 5000);

  // En móvil: eliminar también al tocar el mapa
  // En web: eliminar al hacer clic
  // (se registra en el siguiente ciclo: si no, el propio clic que la crea la borraría al instante)
  const dismissEvent = mobile ? 'touchstart' : 'click';
  const dismiss = () => mlClearRouteHighlight();
  mlHighlightDismiss = dismiss;
  mlHighlightDismissEvent = dismissEvent;
  setTimeout(() => {
    if (mlMap && mlHighlightDismiss === dismiss) mlMap.once(dismissEvent, dismiss);
  }, 0);
}

/**
 * Elimina las capas y source del highlight de vía.
 */
// Al cerrar la ficha de una vía (popup o hoja inferior) se quita su marca. El chequeo va diferido: al tocar otra vía,
// la ficha anterior se cierra y la nueva se abre en el mismo instante, y esa marca nueva no debe borrarse.
function mlClearHighlightIfRouteClosed() {
  setTimeout(() => {
    const popupOpen = typeof mlRoutePopup !== 'undefined' && mlRoutePopup && mlRoutePopup.isOpen();
    if (!popupOpen && rbsCurrentState === 'hidden') mlClearRouteHighlight();
  }, 0);
}

// Solo cuenta como «cierre» el de un popup que de verdad estaba abierto (remove() dispara 'close' aunque no lo esté)
function kxWatchRoutePopup(popup) {
  if (popup._kxWatched) return;
  popup._kxWatched = true;
  if (popup.isOpen()) popup._kxOpened = true;
  popup.on('open', () => { popup._kxOpened = true; });
  popup.on('close', () => {
    if (!popup._kxOpened) return;
    popup._kxOpened = false;
    mlClearHighlightIfRouteClosed();
  });
}

// Un solo «cerrar al tocar» vivo: el de la marca anterior no debe borrar la nueva
let mlHighlightDismiss = null;
let mlHighlightDismissEvent = null;

function mlClearRouteHighlight() {
  if (mlHighlightDismiss && mlMap) { mlMap.off(mlHighlightDismissEvent, mlHighlightDismiss); }
  mlHighlightDismiss = null;
  if (mlHighlightTimer) {
    clearTimeout(mlHighlightTimer);
    mlHighlightTimer = null;
  }

  if (mlPulseAnimId) {
    cancelAnimationFrame(mlPulseAnimId);
    mlPulseAnimId = null;
  }

  const layers = ['vias-highlight-layer', 'vias-highlight-pulse-layer'];
  const source = 'vias-highlight-source';

  layers.forEach(id => {
    if (mlMap && mlMap.getLayer(id)) {
      try { mlMap.removeLayer(id); } catch (e) {}
    }
  });

  if (mlMap && mlMap.getSource(source)) {
    try { mlMap.removeSource(source); } catch (e) {}
  }
}

// Variables para almacenar datos de la vía actual
let mlCurrentRouteGrade = null;
let mlCurrentRouteSector = null;
let mlCurrentRouteId = null;
let mlCurrentRouteName = null;

/**
 * Abre detalles de ruta (conecta con sistema existente)
 */
function mlOpenRouteDetails(encodedName) {
  const name = decodeURIComponent(encodedName);

  // Cerrar popup
  mlRoutePopup.remove();

  // Intentar usar función existente de app_3.js
  if (typeof openRouteInfoWindow === 'function') {
    openRouteInfoWindow(name, mlCurrentSchool);
  } else if (typeof showRouteDetails === 'function') {
    showRouteDetails(name, mlCurrentSchool);
  } else {
    console.log('Abrir detalles de:', name);
    // Aquí puedes añadir tu propia lógica
  }
}

// ============================================
// SECTOR POPUP
// ============================================

// Variable para popup de sector
let mlSectorPopup = null;

/**
 * Verifica si la fecha actual está dentro del período de restricción
 * @param {string} fechaInicio - Formato "DD-MM"
 * @param {string} fechaFin - Formato "DD-MM"
 * @returns {boolean}
 */
function isCurrentlyRestricted(fechaInicio, fechaFin) {
  if (!fechaInicio || !fechaFin) return false;

  const now = new Date();
  const currentYear = now.getFullYear();

  // Parsear fechas (formato DD-MM)
  const [diaInicio, mesInicio] = fechaInicio.split('-').map(Number);
  const [diaFin, mesFin] = fechaFin.split('-').map(Number);

  const inicio = new Date(currentYear, mesInicio - 1, diaInicio);
  const fin = new Date(currentYear, mesFin - 1, diaFin);

  // Si el rango cruza el año (ej: 15-11 a 15-02)
  if (fin < inicio) {
    return now >= inicio || now <= fin;
  }

  return now >= inicio && now <= fin;
}

/**
 * Obtiene el icono de exposición según el valor
 * @param {string} exposicion
 * @returns {string} HTML del icono
 */
function getExposureIcon(exposicion) {
  if (!exposicion) return '';

  const exp = exposicion.toLowerCase().trim();

  if (exp.includes('mañana')) {
    return `<img src="icons/sol mañana.png" alt="Sol mañana" width="32" height="32">`;
  } else if (exp.includes('tarde')) {
    return `<img src="icons/sol tarde.png" alt="Sol tarde" width="32" height="32">`;
  } else if (exp === 'sombra') {
    return `<img src="icons/sombra.png" alt="Sombra" width="32" height="32">`;
  } else if (exp.includes('sol')) {
    return `<img src="icons/sol.png" alt="Sol" width="32" height="32">`;
  }

  return `<img src="icons/sol.png" alt="Sol" width="32" height="32">`;
}

/**
 * ============================================
 * GRÁFICO DE GRADOS (Fase 3): datos y montaje en fichas y popups
 * Un solo recuento en todas partes: grado1 del GeoJSON completo de la escuela (en minúsculas)
 * más las vías aprobadas de spotters de esa escuela; las vías sin grado se cuentan aparte.
 * ============================================
 */
const kxRoutesGeojsonCache = new Map();   // url → Promise<features[]>

function kxSchoolRouteFeatures(schoolId) {
  const url = MAPLIBRE_SCHOOLS[schoolId]?.geojson?.vias;
  if (!url) return Promise.resolve([]);
  if (!kxRoutesGeojsonCache.has(url)) {
    kxRoutesGeojsonCache.set(url, fetch(url)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(g => g.features || [])
      .catch(e => { kxRoutesGeojsonCache.delete(url); throw e; }));
  }
  return kxRoutesGeojsonCache.get(url);
}

// Vías de spotters ya cargadas en el mapa, solo si pertenecen a esa escuela (null si no están)
function kxSpotterRouteFeatures(schoolId) {
  if (!mlMap || mlCurrentSchool !== schoolId) return null;
  const src = mlMap.getSource('vias-usuarios-source');
  return src && src._data && Array.isArray(src._data.features) ? src._data.features : null;
}

function kxCountGrades(features, filter, acc = { counts: {}, ungraded: 0 }) {
  for (const f of features || []) {
    const p = f.properties || {};
    if (filter && !filter(p)) continue;
    const g = String(p.grado1 || '').toLowerCase().trim();
    if (g) acc.counts[g] = (acc.counts[g] || 0) + 1; else acc.ungraded++;
  }
  return acc;
}

// Sector: se cuenta desde el GeoJSON completo (antes, desde las vías dibujadas: vacío con poco zoom)
async function kxSectorGradeStats(schoolId, sectorName) {
  const target = String(sectorName || '').toLowerCase().trim();
  const inSector = p => String(p.sector || '').toLowerCase().trim() === target;
  const acc = kxCountGrades(await kxSchoolRouteFeatures(schoolId), inSector);
  const spot = kxSpotterRouteFeatures(schoolId);
  if (spot) kxCountGrades(spot, inSector, acc);
  return kxGradeStats(acc.counts, { ungraded: acc.ungraded });
}

// Vías de un sector (GeoJSON completo de la escuela + vías de spotters ya cargadas): [{ id, name }]
async function kxSectorRoutes(schoolId, sectorName) {
  const target = String(sectorName || '').toLowerCase().trim();
  const routes = [];
  const add = f => {
    const p = f.properties || {};
    if (String(p.sector || '').toLowerCase().trim() === target) routes.push({ id: p.id, name: p.nombre || '' });
  };
  (await kxSchoolRouteFeatures(schoolId)).forEach(add);
  (kxSpotterRouteFeatures(schoolId) || []).forEach(add);
  return routes;
}

let kxPendingChartGrade = null;   // grado que se selecciona al volver al gráfico desde el filtro del mapa

function kxMountGradeChart(container, stats, ctx) {
  // Ficha de sector: las vías sin grado entran en el gráfico como una última barra «?»
  if (ctx.withUngraded && stats.ungraded > 0) {
    const entries = [...stats.entries, { grade: '?', count: stats.ungraded, pct: (stats.ungraded / stats.total) * 100, family: '', ungraded: true }];
    stats = { ...stats, entries, graded: stats.total, max: Math.max(stats.max, stats.ungraded) };
  }
  container.innerHTML = kxGradeChartHTML(stats, { id: `${container.id || 'kx'}-gc`, title: ctx.title || 'Vías por grado' });
  const el = container.querySelector('.kx-gchart');
  // Ficha de sector: «Vías por Grado (31 total)»
  const totalEl = ctx.compactTotal && el && el.querySelector('.kx-gchart-total');
  if (totalEl) totalEl.textContent = `(${stats.graded} total)`;
  // Ficha de sector: gráfico solo informativo, sin selección de grados
  if (ctx.static) {
    if (el) el.classList.add('is-static');
    container.querySelectorAll('.kx-gbar').forEach(b => { b.tabIndex = -1; b.removeAttribute('aria-pressed'); });
    return null;
  }
  const ctl = kxBindGradeChart(el, stats, { onViewRoutes: e => kxFocusGrade({ ...ctx, grade: e.grade, count: e.count }) });
  const sameCtx = mlGradeFocus && mlGradeFocus.schoolId === ctx.schoolId && (mlGradeFocus.sector || '') === (ctx.sector || '');
  const want = kxPendingChartGrade || (sameCtx ? mlGradeFocus.grade : null);
  kxPendingChartGrade = null;
  if (ctl && want) { const i = stats.entries.findIndex(x => x.grade === want); if (i >= 0) ctl.select(i); }
  return ctl;
}

// Carga y monta el gráfico en un contenedor. ctx: { schoolId, sector?, sectorProps?, coords? }
async function kxLoadGradeChart(container, ctx) {
  if (!container || !ctx || !ctx.schoolId) return;
  const token = {};
  container._kxGcToken = token;
  container.innerHTML = kxGradeChartStateHTML('loading', { title: ctx.title });
  try {
    const stats = await kxSectorGradeStats(ctx.schoolId, ctx.sector);
    if (container._kxGcToken !== token || !container.isConnected) return;   // ya se abrió otra ficha
    kxMountGradeChart(container, stats, ctx);
  } catch (e) {
    console.warn('Gráfico de grados:', e);
    if (container._kxGcToken !== token) return;
    container.innerHTML = kxGradeChartStateHTML('error', { title: ctx.title });
    const retry = container.querySelector('[data-kx-retry]');
    if (retry) retry.addEventListener('click', () => kxLoadGradeChart(container, ctx));
  }
}

/**
 * Muestra popup de sector
 */
function showSectorPopup(props, coords, extraHTML = '') {
  // Cerrar popup/bottom sheet de ruta si está abierto
  if (mlRoutePopup) mlRoutePopup.remove();
  hideRouteBottomSheet();

  const sectorName = props.nombre || 'Sector sin nombre';
  const restr = (props.restr || '').toUpperCase();
  const hasRestriction = restr === 'SI' || restr === 'SÍ';
  const fechaInicio = props.Fecha_inicio;
  const fechaFin = props.Fecha_fin;
  const exposicion = props.exposicion || '';

  // Verificar si está restringido ahora
  const isRestricted = hasRestriction && isCurrentlyRestricted(fechaInicio, fechaFin);

  // Iconos de restricción
  const restrictionIcon = isRestricted
    ? `<img src="icons/prohibido.png" alt="Prohibido" width="36" height="36">`
    : `<img src="icons/permitido.png" alt="Permitido" width="36" height="36">`;

  const restrictionText = isRestricted ? 'Prohibido' : 'Permitido';
  const restrictionColor = isRestricted ? '#dc2626' : '#16a34a';
  const restrictionDates = hasRestriction ? `(Restricción: ${fechaInicio} - ${fechaFin})` : '';

  // Icono de exposición
  const exposureIcon = getExposureIcon(exposicion);
  const exposureText = exposicion ? exposicion.replace(/_/g, ' ') : 'No especificada';

  // Generar IDs únicos para contenedores dinámicos
  const chartId = `sector-chart-${Date.now()}`;
  const estadoId = `sector-estado-${Date.now()}`;

  const html = `
    <div class="ml-sector-popup">
      <!-- Header: Nombre del sector -->
      <div class="ml-sector-header">${sectorName}</div>

      <!-- Fila de restricción -->
      <div class="ml-sector-row">
        <span class="ml-sector-icon">${restrictionIcon}</span>
        <div class="ml-sector-text">
          <span style="color: ${restrictionColor}; font-weight: 600;">${restrictionText}</span>
          <span style="color: #6b7280; font-size: 12px; margin-left: 6px;">${restrictionDates}</span>
        </div>
      </div>

      <!-- Fila de exposición -->
      <div class="ml-sector-row">
        <span class="ml-sector-icon">${exposureIcon}</span>
        <span class="ml-sector-text" style="color: #f59e0b; font-weight: 500;">${exposureText}</span>
      </div>

      <!-- Estado del Sector (se carga asincrónicamente) -->
      <div id="${estadoId}"></div>

      <!-- Gráfico de vías por grado -->
      <div class="ml-sector-chart" id="${chartId}">
        <div style="text-align: center; color: #888;">Cargando...</div>
      </div>

      <!-- Botón Ver Sector -->
      <button class="ml-sector-view-btn" onclick="openSectorImageViewer('${mlCurrentSchool || 'valeria'}', '${sectorName.replace(/'/g, "\\'")}')">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
          <circle cx="8.5" cy="8.5" r="1.5"/>
          <polyline points="21 15 16 10 5 21"/>
        </svg>
        Ver Sector
      </button>

      ${extraHTML}
    </div>
  `;

  // Crear popup si no existe
  if (!mlSectorPopup) {
    mlSectorPopup = new maplibregl.Popup({
      closeButton: true,
      closeOnClick: false,
      maxWidth: '360px',
      className: 'ml-sector-popup-container kx-mpop'
    });
    // remove()/addTo() también disparan 'close' al reabrir otra ficha: solo se limpia si de verdad no queda ninguna abierta
    mlSectorPopup.on('close', () => setTimeout(() => {
      if (!(mlSectorPopup && mlSectorPopup.isOpen()) && secBsCurrentState === 'hidden') kxClearSectorSelection();
    }, 0));
  }

  mlSectorPopup
    .setLngLat(coords)
    .setHTML(html)
    .addTo(mlMap);

  // Gráfico de grados (mismos datos y componente que la ficha móvil)
  kxLoadGradeChart(document.getElementById(chartId), { schoolId: mlCurrentSchool, sector: sectorName, sectorProps: props, coords: { lng: coords[0], lat: coords[1] } });

  // Cargar estado del sector asincrónicamente
  const schoolId = mlCurrentSchool || 'valeria';
  getSectorEstadoAverage(schoolId, sectorName).then(result => {
    const container = document.getElementById(estadoId);
    if (!container) return;
    if (result.avg !== null) {
      container.innerHTML = generateSectorEstadoHTML(result.avg, result.ratedCount, result.totalCount);
    }
  });
}

/**
 * Configura interacción de click en sectores
 */
function setupSectoresInteraction() {
  // El toque lo recibe la capa invisible de 24 px (y las etiquetas), no la línea visible
  kxBindSectorEvents('sectores-hit-layer');
}

function mlOpenStaticSector(props, coords) {
    if (isMobileDevice()) {
      // En móvil, usar bottom sheet
      if (mlSectorPopup) mlSectorPopup.remove();
      // Desplazamiento adaptativo: solo mover si el sector queda tapado por el bottom sheet
      adaptiveMapPanForBottomSheet(coords);
      showSectorBottomSheet(props, [coords.lng, coords.lat]);
    } else {
      // En desktop, usar popup tradicional de MapLibre
      mlMap.flyTo({
        center: coords,
        zoom: mlMap.getZoom(),
        speed: 0.8,
        curve: 1,
        padding: { top: 450, bottom: 0, left: 0, right: 0 }
      });
      showSectorPopup(props, [coords.lng, coords.lat]);
    }
}

// ============================================
// ICONOS
// ============================================

/**
 * Carga icono de parking
 */
function loadParkingIcon() {
  // Mismo icono del pack que el POI «parking»
  return createSVGPinImage('parking').then(img => {
    if (mlMap && !mlMap.hasImage('parking-icon')) mlMap.addImage('parking-icon', img, { pixelRatio: _mlDPR });
  }).catch(e => console.warn('Icono de parking no disponible:', e));
}

// ============================================
// PARKING POPUP
// ============================================

let mlParkingPopup = null;

/**
 * Configura interacción con parkings
 */
function setupParkingsInteraction() {
  if (!mlMap.getLayer('parkings-layer')) return;

  // Cursor pointer
  mlMap.on('mouseenter', 'parkings-layer', () => {
    mlMap.getCanvas().style.cursor = 'pointer';
  });

  mlMap.on('mouseleave', 'parkings-layer', () => {
    mlMap.getCanvas().style.cursor = '';
  });

  // Click en parking
  mlMap.on('click', 'parkings-layer', (e) => {
    if (mlMap.getCanvas().style.cursor === 'crosshair') return;
    if (!e.features || e.features.length === 0) return;

    const feature = e.features[0];
    const props = feature.properties;
    const coords = e.lngLat;

    // Auto-centrar con padding para evitar que el popup quede cortado
    mlMap.flyTo({
      center: coords,
      zoom: mlMap.getZoom(),
      speed: 0.8,
      curve: 1,
      padding: { top: 450, bottom: 0, left: 0, right: 0 }
    });

    showParkingPopup(props, [coords.lng, coords.lat]);
  });
}

/**
 * Muestra popup de parking
 */
function showParkingPopup(props, coords) {
  // Cerrar otros popups / bottom sheets
  if (mlRoutePopup) mlRoutePopup.remove();
  if (mlSectorPopup) mlSectorPopup.remove();
  hideRouteBottomSheet();

  const nombre = props.nombre || props.Nombre || 'Parking';
  const descripcion = props.descripcion || props.Descripcion || '';
  const plazas = props.plazas || props.Plazas || '';
  const tipo = props.tipo || props.Tipo || '';

  // URL para navegación
  const lat = coords[1];
  const lng = coords[0];
  const gmapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;

  const html = `
    <div class="ml-parking-popup">
      <div class="ml-parking-header">
        <span class="ml-parking-icon">🅿️</span>
        <span class="ml-parking-name">${nombre}</span>
      </div>

      ${descripcion ? `<p class="ml-parking-desc">${descripcion}</p>` : ''}

      <div class="ml-parking-info">
        ${plazas ? `<span>🚗 ${plazas} plazas</span>` : ''}
        ${tipo ? `<span>📍 ${tipo}</span>` : ''}
      </div>

      <button class="ml-parking-btn" onclick="window.open('${gmapsUrl}', '_blank')">
        🧭 Cómo llegar
      </button>
    </div>
  `;

  // Crear popup si no existe
  if (!mlParkingPopup) {
    mlParkingPopup = new maplibregl.Popup({
      closeButton: true,
      closeOnClick: false,
      maxWidth: '280px',
      className: 'ml-parking-popup-container'
    });
  }

  mlParkingPopup
    .setLngLat(coords)
    .setHTML(html)
    .addTo(mlMap);
}

// ============================================
// MARKERS DE ESCUELAS (Symbol Layer nativo)
// ============================================

let mlSchoolPopup = null;

// ============================================
// ROCÓDROMOS
// ============================================
// Capa propia de rocódromos (Cartografia/Rocodromos/rocodromos.geojson). Aparecen a partir del zoom 9, agrupados en
// burbujas con el número de rocódromos hasta el zoom 11; desde el 12 se ve cada uno con su icono y, desde el 13, su nombre.
const GYM_MIN_ZOOM = 9;
let mlGymPopup = null;

function loadGymMarkers() {
  if (!mlMap || mlMap.getSource('gyms-source')) return;
  fetch('Cartografia/Rocodromos/rocodromos.geojson')
    .then(r => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))))
    .then(async geojson => {
      if (mlMap.getSource('gyms-source')) return;
      mlMap.addSource('gyms-source', { type: 'geojson', data: geojson, cluster: true, clusterMaxZoom: 11, clusterRadius: 44 });
      await loadGymIcons();
      // Burbuja de grupo: halo salvia + círculo verde bosque con el número
      mlMap.addLayer({
        id: 'gym-clusters-halo', type: 'circle', source: 'gyms-source', minzoom: GYM_MIN_ZOOM, filter: ['has', 'point_count'],
        paint: { 'circle-color': '#DCE9DF', 'circle-opacity': 0.75, 'circle-radius': ['step', ['get', 'point_count'], 21, 5, 25, 15, 30] }
      });
      mlMap.addLayer({
        id: 'gym-clusters', type: 'circle', source: 'gyms-source', minzoom: GYM_MIN_ZOOM, filter: ['has', 'point_count'],
        paint: { 'circle-color': '#153E35', 'circle-radius': ['step', ['get', 'point_count'], 15, 5, 18, 15, 22], 'circle-stroke-width': 2.5, 'circle-stroke-color': '#ffffff' }
      });
      mlMap.addLayer({
        id: 'gym-cluster-count', type: 'symbol', source: 'gyms-source', minzoom: GYM_MIN_ZOOM, filter: ['has', 'point_count'],
        layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-font': ['Noto Sans Bold'], 'text-size': 13, 'text-allow-overlap': true },
        paint: { 'text-color': '#ffffff' }
      });
      mlMap.addLayer({
        id: 'gym-markers-layer', type: 'symbol', source: 'gyms-source', minzoom: GYM_MIN_ZOOM, filter: ['!', ['has', 'point_count']],
        layout: {
          'icon-image': ['case', ['==', ['get', 'pago'], 'no'], 'gym-icon-free', 'gym-icon-paid'],
          'icon-size': ['interpolate', ['linear'], ['zoom'], 9, 0.32, 12, 0.42, 15, 0.55],
          'icon-allow-overlap': true, 'icon-anchor': 'center'
        }
      });
      mlMap.addLayer({
        id: 'gym-labels-layer', type: 'symbol', source: 'gyms-source', minzoom: 13, filter: ['!', ['has', 'point_count']],
        layout: { 'text-field': ['get', 'nombre'], 'text-font': ['Noto Sans Bold'], 'text-size': 12, 'text-offset': [0, 1.6], 'text-anchor': 'top', 'text-max-width': 9, 'text-optional': true },
        paint: { 'text-color': '#153E35', 'text-halo-color': 'rgba(255, 255, 255, 0.95)', 'text-halo-width': 2 }
      });
      setupGymLayerInteraction();
      // Conexión con Firestore lista antes del primer toque (la ficha de rocódromo tarda menos en abrir)
      if (window.KruxGymSheet && window.KruxGymSheet.warm) window.KruxGymSheet.warm();
    })
    .catch(err => console.warn('[Rocódromos] No se han podido cargar:', err));
}

// Iconos: de pago = cuadrado verde bosque con moneda «€» coral; gratuito (municipal o al aire libre) = círculo blanco con borde verde.
// Se distinguen por la forma y por la moneda, no solo por el color, para leerse bien sobre la ortofoto.
async function loadGymIcons() {
  const size = 96;
  const shadow = '<defs><filter id="s" x="-25%" y="-25%" width="150%" height="150%"><feDropShadow dx="0" dy="1.5" stdDeviation="1.6" flood-color="#0b1f1a" flood-opacity="0.35"/></filter></defs>';
  const hold = (fg, bg) => `<path d="M17.6 31.6c-2.4-1.3-3.2-4.4-1.8-6.9l3.4-6.2c1.5-2.7 4.9-3.7 7.6-2.2l4.1 2.3c2.6 1.5 3.4 4.9 1.8 7.4l-3.2 5.1c-1.5 2.4-4.7 3.3-7.2 1.9z" fill="${fg}"/><circle cx="24.4" cy="24.4" r="2.5" fill="${bg}"/>`;
  const paid = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="${size}" height="${size}">${shadow}
    <rect x="5" y="7" width="36" height="36" rx="11" fill="#153E35" stroke="#ffffff" stroke-width="2.5" filter="url(#s)"/>
    <g transform="translate(-1 1)">${hold('#ffffff', '#153E35')}</g>
    <circle cx="38.5" cy="9.5" r="7.5" fill="#FF8D67" stroke="#ffffff" stroke-width="2"/>
    <text x="38.5" y="13.2" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="10.5" font-weight="700" fill="#202923">€</text>
  </svg>`;
  const free = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="${size}" height="${size}">${shadow}
    <circle cx="24" cy="25" r="17" fill="#ffffff" stroke="#153E35" stroke-width="3" filter="url(#s)"/>
    <g transform="translate(-0.4 0.6)">${hold('#153E35', '#ffffff')}</g>
  </svg>`;
  await loadSVGAsImage('gym-icon-paid', paid, size);
  await loadSVGAsImage('gym-icon-free', free, size);
}

function setupGymLayerInteraction() {
  ['gym-clusters', 'gym-markers-layer'].forEach(layer => {
    mlMap.on('mouseenter', layer, () => { mlMap.getCanvas().style.cursor = 'pointer'; });
    mlMap.on('mouseleave', layer, () => { mlMap.getCanvas().style.cursor = ''; });
  });
  // Grupo: acercar hasta que se separe
  mlMap.on('click', 'gym-clusters', async (e) => {
    if (mlMap.getCanvas().style.cursor === 'crosshair') return;
    const f = e.features && e.features[0];
    if (!f) return;
    try {
      const zoom = await mlMap.getSource('gyms-source').getClusterExpansionZoom(f.properties.cluster_id);
      mlMap.easeTo({ center: f.geometry.coordinates, zoom: Math.max(zoom, mlMap.getZoom() + 1) });
    } catch (_) { mlMap.easeTo({ center: f.geometry.coordinates, zoom: mlMap.getZoom() + 2 }); }
  });
  mlMap.on('click', 'gym-markers-layer', (e) => {
    if (mlMap.getCanvas().style.cursor === 'crosshair') return;
    const f = e.features && e.features[0];
    if (!f) return;
    // Un toque abre la ficha completa (hoja en móvil, modal en escritorio); el popup queda como alternativa
    if (window.KruxGymSheet) window.KruxGymSheet.open(f.properties, f.geometry.coordinates.slice());
    else showGymPopup(f.properties, f.geometry.coordinates.slice());
  });
}

function showGymPopup(p, coords) {
  const esc = t => String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const yes = v => v === true || v === 'true';
  const types = [[yes(p.cuerda), 'Cuerda'], [yes(p.bloque), 'Bloque'], [yes(p.auto), 'Autobelay']].filter(t => t[0]).map(t => t[1]);
  const price = p.pago === 'si' ? 'De pago' : p.pago === 'no' ? 'Gratuito' : '';
  const gmapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${coords[1]},${coords[0]}`;
  if (!mlGymPopup) mlGymPopup = new maplibregl.Popup({ closeButton: false, closeOnClick: true, maxWidth: '300px', offset: 18, className: 'ml-gym-popup' });
  mlGymPopup.setLngLat(coords).setHTML(`
    <div class="ml-gym-popup-content">
      <button type="button" class="ml-popup-close-btn" data-gym-close aria-label="Cerrar">&times;</button>
      <p class="ml-gym-kicker">Rocódromo${price ? ` · <span class="ml-gym-price ml-gym-price--${esc(p.pago)}">${price}</span>` : ''}</p>
      <h3 class="ml-gym-title">${esc(p.nombre)}</h3>
      ${types.length ? `<ul class="ml-gym-tags">${types.map(t => `<li>${t}</li>`).join('')}</ul>` : ''}
      <div class="ml-gym-actions">
        <button type="button" class="ml-gym-btn ml-gym-btn--alt" data-gym-go>Cómo llegar</button>
        ${window.KruxGymSheet ? '<button type="button" class="ml-gym-btn" data-gym-info>Fotos e información</button>' : ''}
      </div>
    </div>`).addTo(mlMap);
  const el = mlGymPopup.getElement();
  el.querySelector('[data-gym-close]').onclick = () => mlGymPopup.remove();
  el.querySelector('[data-gym-go]').onclick = () => window.open(gmapsUrl, '_blank');
  // Ficha con lo que aporta la comunidad (gym-info.js): fotos, horario, precios, instalaciones y contacto
  const info = el.querySelector('[data-gym-info]');
  if (info) info.onclick = () => { mlGymPopup.remove(); window.KruxGymSheet.open(p, coords); };
}

/**
 * Carga los markers de escuelas como Symbol Layer nativo de MapLibre
 * Esto hace que los iconos escalen con el zoom como las líneas de sectores
 */
function loadSchoolMarkers() {
  if (!mlMap || typeof SCHOOL_MARKERS === 'undefined') {
    console.warn('No se pueden cargar markers: mapa o SCHOOL_MARKERS no disponible');
    return;
  }

  console.log('Cargando markers de escuelas como Symbol Layer:', SCHOOL_MARKERS.length);

  // Limpiar source/layers existentes si los hay
  ['school-labels-layer', 'school-markers-selected-layer', 'school-markers-layer', 'school-halo-layer']
    .forEach(id => { if (mlMap.getLayer(id)) mlMap.removeLayer(id); });
  if (mlMap.getSource('schools-source')) mlMap.removeSource('schools-source');
  kxSelectedSchool = null;
  kxFocusedSchool = null;

  // Crear popup compartido para escuelas
  if (!mlSchoolPopup) {
    mlSchoolPopup = new maplibregl.Popup({
      closeButton: true,
      closeOnClick: false,
      maxWidth: '340px',
      className: 'ml-school-popup kx-mpop'
    });
    // En escritorio la ficha es este popup; en móvil, la hoja inferior (hideBottomSheet limpia la selección)
    mlSchoolPopup.on('close', () => setTimeout(() => {
      if (!isMobileDevice() && !(mlSchoolPopup && mlSchoolPopup.isOpen())) kxSelectSchool(null);
    }, 0));
  }

  // Crear GeoJSON con las escuelas
  const schoolsGeoJSON = {
    type: 'FeatureCollection',
    features: SCHOOL_MARKERS.map(school => ({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: school.coords
      },
      properties: {
        id: school.id,
        nombre: school.nombre,
        zoom: school.zoom,
        isOpen: school.isOpen,
        rockType: school.rockType || 'Caliza',
        coords: school.coords
      }
    }))
  };

  // Añadir source
  mlMap.addSource('schools-source', {
    type: 'geojson',
    data: schoolsGeoJSON,
    promoteId: 'id'
  });

  // Cargar iconos SVG como imágenes
  loadSchoolIcons().then(() => {
    const scale = kxZoomExpr(KX_SCHOOL_SCALE);
    const zoomFade = ['interpolate', ['linear'], ['zoom'], 11.4, 1, 12, 0.6];
    const stateOn = ['any', _kxSel, ['boolean', ['feature-state', 'focus'], false]];

    // Halo del estado «en foco»: círculo verde translúcido y mate, detrás del pin y centrado en su círculo.
    // Es una capa aparte, así que no altera el anclaje del marcador.
    mlMap.addLayer({
      id: 'school-halo-layer',
      type: 'circle',
      source: 'schools-source',
      minzoom: 5,
      maxzoom: 12,
      paint: {
        'circle-radius': kxZoomExpr(KX_SCHOOL_SCALE, sc => +(KX_SCHOOL_PIN_W * 0.8 * sc).toFixed(2)),
        'circle-translate': kxZoomExpr(KX_SCHOOL_SCALE, sc => ['literal', [0, -+(KX_SCHOOL_PIN_BODY_UP * sc).toFixed(2)]]),
        'circle-translate-anchor': 'viewport',
        'circle-pitch-alignment': 'viewport',
        'circle-color': KX_SCHOOL_PIN.selected,
        'circle-opacity': ['case', ['boolean', ['feature-state', 'focus'], false], 0.3, 0],
        'circle-stroke-color': KX_SCHOOL_PIN.selected,
        'circle-stroke-width': 5,
        'circle-stroke-opacity': ['case', ['boolean', ['feature-state', 'focus'], false], 0.2, 0],
        'circle-opacity-transition': { duration: 180 },
        'circle-stroke-opacity-transition': { duration: 180 }
      }
    });

    const pinLayout = icon => ({
      'icon-image': icon,
      'icon-size': scale,
      'icon-anchor': 'bottom',
      'icon-offset': [0, KX_SCHOOL_PIN_TIP_GAP],
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
      'icon-pitch-alignment': 'viewport',
      'icon-rotation-alignment': 'viewport'
    });

    // Estado normal (todas las escuelas); es la capa interactiva
    mlMap.addLayer({
      id: 'school-markers-layer',
      type: 'symbol',
      source: 'schools-source',
      minzoom: 5,
      maxzoom: 12,
      layout: pinLayout('kx-school-pin'),
      paint: { 'icon-opacity': zoomFade }
    });

    // Seleccionada o en foco: mismo pin con el verde intenso, superpuesto con exactitud
    mlMap.addLayer({
      id: 'school-markers-selected-layer',
      type: 'symbol',
      source: 'schools-source',
      minzoom: 5,
      maxzoom: 12,
      layout: pinLayout('kx-school-pin-selected'),
      paint: {
        'icon-opacity': ['interpolate', ['linear'], ['zoom'], 11.4, ['case', stateOn, 1, 0], 12, ['case', stateOn, 0.6, 0]],
        'icon-opacity-transition': { duration: 160 }
      }
    });

    // Etiqueta flotante independiente del icono: desde el zoom 7, sin solaparse
    mlMap.addLayer(kxSchoolLabelLayer('school-labels-layer', 'schools-source'));

    // Configurar interactividad
    setupSchoolLayerInteraction();

    console.log('Markers de escuelas cargados como Symbol Layer');
  });
}

/**
 * Carga los iconos SVG de escuelas como imágenes para MapLibre
 */
async function loadSchoolIcons() {
  // Un único pin con tres rellenos: normal (verde mate), seleccionada (verde intenso) y pendiente de aprobación
  await kxLoadSVGImage('kx-school-pin', kxSchoolPinSVG(KX_SCHOOL_PIN.normal), KX_SCHOOL_PIN_W, KX_SCHOOL_PIN_H);
  await kxLoadSVGImage('kx-school-pin-selected', kxSchoolPinSVG(KX_SCHOOL_PIN.selected), KX_SCHOOL_PIN_W, KX_SCHOOL_PIN_H);
  await kxLoadSVGImage('kx-school-pin-pending', kxSchoolPinSVG(KX_SCHOOL_PIN.pending), KX_SCHOOL_PIN_W, KX_SCHOOL_PIN_H);
}

// Selección y foco son estados independientes: el pin intenso se muestra con cualquiera de los dos y el halo solo con el foco
function kxSelectSchool(id) {
  if (kxSelectedSchool != null) kxSetFeatureState({ source: 'schools-source', id: kxSelectedSchool }, { selected: false });
  kxSelectedSchool = id;
  if (id != null) kxSetFeatureState({ source: 'schools-source', id }, { selected: true });
}

/**
 * Da el foco a una escuela (o lo quita con null). Lo usan el buscador y la navegación.
 * opts.untilMoveEnd: el foco se retira al acabar el siguiente movimiento del mapa (o a los 4 s si no hay ninguno).
 */
function kxFocusSchool(id, opts = {}) {
  if (kxFocusTimer) { clearTimeout(kxFocusTimer); kxFocusTimer = null; }
  if (kxFocusedSchool != null) kxSetFeatureState({ source: 'schools-source', id: kxFocusedSchool }, { focus: false });
  kxFocusedSchool = id != null ? id : null;
  if (kxFocusedSchool == null) return;
  kxSetFeatureState({ source: 'schools-source', id: kxFocusedSchool }, { focus: true });
  if (opts.untilMoveEnd && mlMap) {
    const mine = kxFocusedSchool;
    const release = () => { if (kxFocusedSchool === mine) kxFocusSchool(null); };
    mlMap.once('movestart', () => { clearTimeout(kxFocusTimer); mlMap.once('moveend', release); });
    kxFocusTimer = setTimeout(release, 4000);
  }
}
window.kxFocusSchool = kxFocusSchool;

/**
 * Helper para cargar un SVG como imagen en MapLibre
 */
function loadSVGAsImage(imageId, svgString, size) {
  return new Promise((resolve) => {
    if (mlMap.hasImage(imageId)) {
      resolve();
      return;
    }

    const img = new Image(size, size);
    img.onload = () => {
      if (!mlMap.hasImage(imageId)) {
        mlMap.addImage(imageId, img);
      }
      resolve();
    };
    img.onerror = () => {
      console.warn('Error cargando icono:', imageId);
      resolve();
    };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgString);
  });
}

/**
 * Configura la interactividad de la capa de escuelas
 */
function setupSchoolLayerInteraction() {
  // Cursor pointer al hover
  mlMap.on('mouseenter', 'school-markers-layer', () => {
    mlMap.getCanvas().style.cursor = 'pointer';
  });

  mlMap.on('mouseleave', 'school-markers-layer', () => {
    mlMap.getCanvas().style.cursor = '';
  });

  // Click en marker de escuela
  mlMap.on('click', 'school-markers-layer', (e) => {
    if (mlMap.getCanvas().style.cursor === 'crosshair') return;
    if (!e.features || e.features.length === 0) return;

    const feature = e.features[0];
    const props = feature.properties;

    // Reconstruir objeto school desde properties
    const school = {
      id: props.id,
      nombre: props.nombre,
      coords: JSON.parse(props.coords),
      zoom: props.zoom,
      isOpen: props.isOpen,
      rockType: props.rockType
    };

    // Centrar instantáneamente sin animación de zoom
    mlMap.jumpTo({
      center: school.coords,
      padding: { top: 450, bottom: 0, left: 0, right: 0 }
    });

    showSchoolPopup(school, null);
  });
}

/**
 * Muestra popup de escuela con resumen
 */
// Escritorio: las herramientas de admin van plegadas bajo los botones, solo para admins
async function kxRenderSchoolPopupAdmin(school) {
  const slot = document.getElementById(`school-admin-${school.id}`);
  if (!slot || !(await kxIsAdminUser()) || !document.body.contains(slot)) return;
  slot.innerHTML = `
    <button type="button" class="kx-radmin is-wide" aria-expanded="false">${KX_ADMIN_ICONS.edit} Herramientas de admin</button>
    <div class="ml-school-admin-panel" hidden>${kxSchoolAdminHTML(school)}</div>`;
  const btn = slot.querySelector('button');
  const panel = slot.querySelector('.ml-school-admin-panel');
  btn.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    btn.setAttribute('aria-expanded', String(!panel.hidden));
  });
}

async function showSchoolPopup(school, marker) {
  const lat = school.coords[1];
  const lng = school.coords[0];
  const gmapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;

  // Generar ID único para el gráfico
  const chartId = `school-chart-${Date.now()}`;

  // HTML inicial del popup
  const initialHtml = buildSchoolPopupHtml(school, chartId, gmapsUrl);

  mlSchoolPopup
    .setLngLat(school.coords)
    .setHTML(initialHtml)
    .addTo(mlMap);

  // Configurar event listeners
  setTimeout(() => {
    setupSchoolPopupEvents(school, gmapsUrl);
    // Cargar estadísticas si la función existe
    loadSchoolStats(school.id, chartId);
    kxRenderSchoolPopupAdmin(school);
  }, 100);
}

/**
 * Helper para comparar y ordenar grados de escalada (French grades)
 * @param {string} gradeA
 * @param {string} gradeB
 * @returns {number}
 */
function compareGrades(gradeA, gradeB) {
  // Orden común de map-ui.js (tabla de colores): «4+» tras 4c, «5» y «7?» al principio de su familia
  if (typeof kxCompareGrades === 'function') return kxCompareGrades(gradeA, gradeB);
  return String(gradeA).localeCompare(String(gradeB), 'es', { numeric: true });
}

/**
 * Helper para ordenar un array de grados de escalada.
 * @param {string[]} grades
 * @returns {string[]}
 */
function sortGrades(grades) {
  return grades.sort(compareGrades);
}

/**
 * Helper para obtener un color basado en el grado de escalada.
 * Colores distintivos para cada grado y subgrado.
 * @param {string} grade
 * @returns {string} Hex color code
 */
function getGradeColor(grade) {
  const gradeLower = grade.toLowerCase();

  // Colores pastel por grado completo - respetando asignación manual
  const gradeColors = {
    // Grados 3-4: Azules/Cyan pastel
    '3': '#e0f7fa',      // Azul claro pastel
    '3a': '#e0f7fa',     // Azul claro pastel
    '3b': '#b2ebf2',     // Cyan claro
    '3c': '#80deea',     // Cyan
    '4a': '#4dd0e1',     // Cyan medio
    '4b': '#26c6da',     // Cyan
    '4c': '#00bcd4',     // Cyan oscuro
    '4+': '#00acc1',     // Cyan más oscuro

    // Grado 5: Verdes pastel
    '5a': '#d7ffaf',     // Verde lima pastel
    '5a+': '#c5f59a',    // Verde lima
    '5b': '#a8e68f',     // Verde claro
    '5b+': '#8cd97f',    // Verde
    '5c': '#46923a',     // Verde medio
    '5c+': '#3d8032',    // Verde oscuro
    '5+': '#3d8032',     // Verde oscuro

    // Grado 6a: Amarillos pastel
    '6a': '#fff48d',     // Amarillo pastel
    '6a+': '#ffeb3b',    // Amarillo

    // Grado 6b: Naranjas pastel
    '6b': '#ffd919',     // Amarillo-naranja pastel
    '6b+': '#ffc107',    // Naranja claro

    // Grado 6c: Naranjas-Rojos pastel
    '6c': '#fda750',     // Naranja pastel
    '6c+': '#ff9800',    // Naranja

    // Grado 7a: Rojos pastel
    '7a': '#ff6161',     // Rojo claro pastel
    '7a+': '#f44336',    // Rojo

    // Grado 7b: Rojos oscuros pastel
    '7b': '#e53935',     // Rojo medio
    '7b+': '#d32f2f',    // Rojo oscuro

    // Grado 7c: Rojos muy oscuros
    '7c': '#ce1616',     // Rojo muy oscuro
    '7c+': '#b71c1c',    // Rojo casi negro

    // Grado 8: Rosas/Magentas pastel
    '8a': '#f463ef',     // Rosa pastel
    '8a+': '#e91e63',    // Rosa
    '8b': '#d81b60',     // Rosa oscuro
    '8b+': '#c2185b',    // Rosa muy oscuro
    '8c': '#ad1457',     // Magenta oscuro
    '8c+': '#8b00d9',    // Púrpura

    // Grado 9: Púrpuras/Negro
    '9a': '#7b00b3',     // Púrpura oscuro
    '9a+': '#6a0080',    // Púrpura muy oscuro
    '9b': '#4a0066',     // Casi negro púrpura
    '9b+': '#2d004d',    // Casi negro
    '9c': '#1a0033',     // Negro púrpura
    '9c+': '#0d001a'     // Negro
  };

  // Buscar coincidencia exacta
  if (gradeColors[gradeLower]) {
    return gradeColors[gradeLower];
  }

  // Fallback por número de grado (colores pastel)
  const gradeNum = parseInt(grade.match(/(\d+)/)?.[1]);
  if (isNaN(gradeNum)) return '#d1d5db'; // Gris pastel

  if (gradeNum <= 3) return '#e0f7fa';   // Azul claro pastel
  if (gradeNum === 4) return '#4dd0e1';  // Cyan pastel
  if (gradeNum === 5) return '#a8e68f';  // Verde pastel
  if (gradeNum === 6) return '#ffd919';  // Amarillo-naranja pastel
  if (gradeNum === 7) return '#ff6161';  // Rojo pastel
  if (gradeNum >= 8) return '#f463ef';  // Rosa pastel

  return '#d1d5db'; // Gris pastel por defecto
}

/**
 * Obtiene la ruta del icono del clima según el código WMO
 * @param {number} code - WMO weather code
 * @returns {string} Ruta al icono
 */
function getWeatherIcon(code) {
  if (code === 0) return 'icons/weather/sunny.png';                    // Sol despejado
  if ([1, 2].includes(code)) return 'icons/weather/partly-cloudy.png'; // Parcialmente nublado
  if (code === 3) return 'icons/weather/cloudy.png';                   // Nublado
  if ([45, 48].includes(code)) return 'icons/weather/fog.png';         // Niebla
  if ([51, 53, 55].includes(code)) return 'icons/weather/light-rain.png'; // Llovizna
  if ([61, 63, 65].includes(code)) return 'icons/weather/rain.png';    // Lluvia
  if ([66, 67].includes(code)) return 'icons/weather/rain.png';        // Lluvia helada
  if ([71, 73, 75, 77].includes(code)) return 'icons/weather/snow.png'; // Nieve
  if ([80, 81, 82].includes(code)) return 'icons/weather/rain.png';    // Chubascos
  if ([85, 86].includes(code)) return 'icons/weather/snow.png';        // Nieve
  if ([95, 96, 99].includes(code)) return 'icons/weather/storm.png';   // Tormenta
  return 'icons/weather/partly-cloudy.png'; // Por defecto
}

/**
 * Formatea la fecha para mostrar día de la semana
 * @param {string} dateStr - Fecha en formato YYYY-MM-DD
 * @returns {string} Nombre del día y número
 */
function formatWeatherDate(dateStr) {
  const date = new Date(dateStr + 'T00:00:00');
  const days = ['DOMINGO', 'LUNES', 'MARTES', 'MIÉRCOLES', 'JUEVES', 'VIERNES', 'SÁBADO'];
  const months = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO',
    'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'];
  return `${days[date.getDay()]}, ${date.getDate()} ${months[date.getMonth()]}`;
}

/**
 * Obtiene dirección del viento desde grados
 * @param {number} degrees - Grados de dirección
 * @returns {string} Flecha de dirección
 */
function getWindDirection(degrees) {
  const directions = ['↓', '↙', '←', '↖', '↑', '↗', '→', '↘'];
  const index = Math.round(degrees / 45) % 8;
  return directions[index];
}

/**
 * Carga el clima actual y pronóstico para una escuela
 * @param {object} school - Datos de la escuela
 */
async function loadWeatherData(school) {
  const lat = school.coords[1];
  const lng = school.coords[0];

  try {
    // Open-Meteo API (gratuita, sin key)
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,relative_humidity_2m,precipitation_probability,weather_code,wind_speed_10m,wind_direction_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,wind_speed_10m_max,wind_direction_10m_dominant&timezone=auto&forecast_days=7`;

    const response = await fetch(url);
    if (!response.ok) throw new Error('Weather API error');

    const data = await response.json();

    // Actualizar clima actual
    const current = data.current;

    // Buscar el contenedor correcto (puede tener timestamp diferente)
    const allWeatherSections = document.querySelectorAll('[id^="weather-' + school.id + '"]');
    if (allWeatherSections.length === 0) return;

    const section = allWeatherSections[allWeatherSections.length - 1];

    // Actualizar icono del clima
    const iconEl = section.querySelector('.ml-weather-icon');
    if (iconEl) {
      iconEl.src = getWeatherIcon(current.weather_code);
    }

    // Actualizar temperatura
    const tempEl = section.querySelector('.ml-weather-temp');
    if (tempEl) {
      tempEl.textContent = `${Math.round(current.temperature_2m)}°C`;
    }

    // Actualizar detalles
    const precipEl = section.querySelector('.ml-weather-precip');
    if (precipEl) {
      precipEl.textContent = `${current.precipitation_probability || 0}%`;
    }

    const humidityEl = section.querySelector('.ml-weather-humidity');
    if (humidityEl) {
      humidityEl.textContent = `${current.relative_humidity_2m}%`;
    }

    const windEl = section.querySelector('.ml-weather-wind');
    if (windEl) {
      windEl.textContent = `${Math.round(current.wind_speed_10m)} km/h`;
    }

    // Guardar datos del pronóstico para el desplegable
    section.dataset.forecast = JSON.stringify(data.daily);

  } catch (error) {
    console.warn('Error cargando datos del clima:', error);
  }
}

/**
 * Renderiza el pronóstico semanal
 * @param {string} schoolId - ID de la escuela
 * @param {object} dailyData - Datos diarios del clima
 */
function renderWeatherForecast(schoolId, dailyData) {
  const forecastContainer = document.getElementById(`forecast-${schoolId}`);
  if (!forecastContainer || !dailyData) return;

  let html = '';

  // Mostrar los próximos 7 días (scrolleable, muestra 2 a la vez)
  for (let i = 0; i < Math.min(7, dailyData.time.length); i++) {
    const date = formatWeatherDate(dailyData.time[i]);
    const maxTemp = Math.round(dailyData.temperature_2m_max[i]);
    const minTemp = Math.round(dailyData.temperature_2m_min[i]);
    const precipProb = dailyData.precipitation_probability_max[i] || 0;
    const precipSum = dailyData.precipitation_sum[i] || 0;
    const windSpeed = Math.round(dailyData.wind_speed_10m_max[i]);
    const windDir = getWindDirection(dailyData.wind_direction_10m_dominant[i]);
    const weatherCode = dailyData.weather_code[i];
    const weatherIcon = getWeatherIcon(weatherCode);

    html += `
      <div class='ml-forecast-day'>
        <div class='ml-forecast-date'>${date}</div>
        <div class='ml-forecast-content'>
          <div class='ml-forecast-temps'>
            <span class='ml-temp-max'>↑ ${maxTemp}°</span>
            <span class='ml-temp-min'>↓ ${minTemp}°</span>
          </div>
          <img class='ml-forecast-icon' src='${weatherIcon}' alt='Clima'>
          <div class='ml-forecast-details'>
            <span class='ml-forecast-precip'><img src='icons/weather/Gota.png' alt='' class='ml-precip-icon'> ${precipProb}% | ${precipSum.toFixed(1)} mm</span>
            <span class='ml-forecast-wind'>${windDir} ${windSpeed} km/h</span>
          </div>
        </div>
      </div>
    `;
  }

  forecastContainer.innerHTML = html;
}

/**
 * Carga estadísticas de la escuela (Gráfico Donut SVG Interactivo)
 */
/**
 * Lee las vías aprobadas de Spotters desde Firestore y devuelve { grado: count }
 * Usa la fuente del mapa si ya está cargada; si no, consulta Firestore directamente.
 */
async function getSpotterGradeCounts(schoolId) {
  const counts = {};
  // Intentar leer de la fuente del mapa primero (más rápido), solo si es la de esta escuela
  if (mlMap && mlCurrentSchool === schoolId) {
    try {
      const source = mlMap.getSource('vias-usuarios-source');
      if (source && source._data?.features?.length > 0) {
        source._data.features.forEach(f => {
          const grade = (f.properties?.grado1 || '').toLowerCase().trim();
          if (grade) counts[grade] = (counts[grade] || 0) + 1;
        });
        return counts;
      }
    } catch (e) {}
  }
  // Fallback: consultar Firestore directamente
  if (!schoolId || typeof firebase === 'undefined' || !firebase.firestore) return counts;
  try {
    const db = firebase.firestore();
    const snapshot = await db.collection('pending_routes')
      .where('schoolId', '==', schoolId)
      .where('status', '==', 'approved')
      .get();
    snapshot.forEach(doc => {
      const grade = (doc.data().grado1 || doc.data().geojsonFeature?.properties?.grado1 || '').toLowerCase().trim();
      if (grade) counts[grade] = (counts[grade] || 0) + 1;
    });
  } catch (e) {}
  return counts;
}

async function loadSchoolStats(schoolId, chartId) {
  const container = document.getElementById(chartId);
  if (!container) return;

  try {
    const schoolConfig = MAPLIBRE_SCHOOLS[schoolId];
    const hasStatic = !!(schoolConfig && schoolConfig.geojson && schoolConfig.geojson.vias);
    if (hasStatic || mlApprovedSchoolsCache.has(schoolId)) {
      const response = hasStatic ? await fetch(schoolConfig.geojson.vias) : null;
      if (!hasStatic || response.ok) {
        const geojson = hasStatic ? await response.json() : { features: [] };

        // 1. Agrupar por grado específico
        const gradeCounts = {};
        let total = 0;

        geojson.features.forEach(feature => {
          let grade = (feature.properties.grado1 || '').toLowerCase().trim();
          if (!grade) return;
          gradeCounts[grade] = (gradeCounts[grade] || 0) + 1;
          total++;
        });

        // Sumar vías aprobadas de Spotters
        const spotterCounts = await getSpotterGradeCounts(schoolId);
        Object.entries(spotterCounts).forEach(([grade, count]) => {
          gradeCounts[grade] = (gradeCounts[grade] || 0) + count;
          total += count;
        });

        if (total === 0) {
          container.innerHTML = '<div style="color: #666; font-size: 13px;">Sin datos de vías</div>';
          return;
        }

        // 2. Ordenar grados
        const sortedGrades = sortGrades(Object.keys(gradeCounts));

        // 3. Generar SVG con segmentos gruesos
        // Radio ajustado para segmentos más anchos (el stroke-width es 6 en CSS)
        const radius = 15;
        const circumference = 2 * Math.PI * radius; // ~94.25
        let accumulatedLength = 0;
        let svgSegments = '';

        sortedGrades.forEach(grade => {
          const count = gradeCounts[grade];
          const percent = count / total;
          const segmentLength = percent * circumference;
          const color = getGradeColor(grade);

          // dasharray: longitud_segmento longitud_hueco
          // dashoffset: posición inicial (negativo para ir en sentido horario)
          const dashArray = `${segmentLength} ${circumference - segmentLength}`;
          const dashOffset = -accumulatedLength;

          svgSegments += `
            <circle class="ml-donut-segment"
              cx="20" cy="20" r="${radius}"
              stroke="${color}"
              stroke-dasharray="${dashArray}"
              stroke-dashoffset="${dashOffset}"
              data-grade="${grade.toUpperCase()}"
              data-count="${count}"
            />`;

          accumulatedLength += segmentLength;
        });

        // 4. Inyectar HTML con círculo central
        container.innerHTML = `
          <div class="ml-donut-chart">
            <svg viewBox="0 0 40 40">
              ${svgSegments}
            </svg>
            <div class="ml-chart-center"></div>
            <div class="ml-chart-center-text" id="center-text-${chartId}">
              <div class="ml-total-vias">${total}</div>
              <div class="ml-total-label">Vías</div>
            </div>
          </div>
        `;

        // 5. Añadir interactividad (Event Listeners)
        const segments = container.querySelectorAll('.ml-donut-segment');
        const centerText = document.getElementById(`center-text-${chartId}`);
        const defaultContent = centerText.innerHTML;

        segments.forEach(segment => {
          segment.addEventListener('mouseenter', () => {
            // Mover el segmento al frente (z-index visual en SVG depende del orden del DOM)
            segment.parentNode.appendChild(segment);

            const g = segment.getAttribute('data-grade');
            const c = segment.getAttribute('data-count');
            const color = segment.getAttribute('stroke');
            centerText.innerHTML = `
               <div class="ml-total-vias" style="color: ${color};">${g}</div>
               <div class="ml-total-label">${c} Vías</div>
             `;
          });

          segment.addEventListener('mouseleave', () => {
            centerText.innerHTML = defaultContent;
          });
        });

        return;
      }
    }
  } catch (e) {
    console.warn('Error cargando estadísticas SVG:', e);
  }

  container.innerHTML = '<div style="color: #888; text-align: center; font-size: 13px;">Estadísticas no disponibles</div>';
}

/**
 * Construye HTML del popup de escuela (Rediseño según mockup)
 */
function buildSchoolPopupHtml(school, chartId, gmapsUrl) {
  const weatherId = `weather-${school.id}-${Date.now()}`;
  const rockType = school.rockType || (school.isUserSchool ? 'Roca sin indicar' : 'Caliza');

  return `
    <div class='ml-school-popup-content'>
      <button class='ml-popup-close-btn' id='btn-close-${school.id}'>&times;</button>

      <h3 class='ml-school-title'>${school.nombre}</h3>

      <div class='ml-grade-chart-section'>
        <div class='ml-chart-title'>Vías por Grado</div>
        <div class='ml-grade-chart-container' id='${chartId}'>
          <div style='padding: 20px; text-align: center; color: #888; font-size: 13px;'>
            Cargando vías...
          </div>
        </div>
      </div>

      <div class='ml-weather-section' id='${weatherId}'>
        <div class='ml-weather-current'>
          <img class='ml-weather-icon' src='icons/weather/partly-cloudy.png' alt='Clima'>
          <div class='ml-weather-temp-container'>
            <span class='ml-weather-temp'>--°C</span>
            <button class='ml-weather-toggle-btn' id='weather-toggle-${school.id}'>
              <svg width='12' height='12' viewBox='0 0 12 12' fill='none'>
                <path d='M2 4L6 8L10 4' stroke='currentColor' stroke-width='2' stroke-linecap='round'></path>
              </svg>
            </button>
          </div>
          <div class='ml-weather-details'>
            <div>Precipitaciones: <img src='icons/weather/Gota.png' alt='' class='ml-precip-icon'> <span class='ml-weather-precip'>--%</span></div>
            <div>Humedad: <span class='ml-weather-humidity'>--%</span></div>
            <div>Viento: <span class='ml-weather-wind'>-- km/h</span></div>
          </div>
        </div>
        <div class='ml-weather-forecast hidden' id='forecast-${school.id}'>
          <div class='ml-forecast-loading'>Cargando pronóstico...</div>
        </div>
      </div>

      <div class='ml-rock-type kx-rock-tag' id='rock-type-${school.id}'>
        ${kxTagHTML({ icon: 'mountain', text: rockType })}
      </div>

      <div class='ml-school-actions kx-school-actions'>
        ${kxButtonHTML({ icon: 'navigation', label: '¿Cómo ir?', variant: 'secondary', attrs: { id: `btn-directions-${school.id}` } })}
        ${kxButtonHTML({ icon: 'map', label: 'Visitar escuela', variant: 'primary', attrs: { id: `btn-visit-${school.id}` } })}
      </div>
      ${school.docId ? `<div class='ml-school-admin' id='school-admin-${school.id}'></div>` : ''}
    </div>
  `;
}

/**
 * Configura eventos del popup de escuela
 */
function setupSchoolPopupEvents(school, gmapsUrl) {
  const btnDirections = document.getElementById(`btn-directions-${school.id}`);
  const btnVisit = document.getElementById(`btn-visit-${school.id}`);
  const btnClose = document.getElementById(`btn-close-${school.id}`);
  const weatherToggle = document.getElementById(`weather-toggle-${school.id}`);
  const forecast = document.getElementById(`forecast-${school.id}`);
  const rockType = document.getElementById(`rock-type-${school.id}`);

  // Botón cerrar
  if (btnClose) {
    btnClose.onclick = () => mlSchoolPopup.remove();
  }

  // Botón direcciones
  if (btnDirections) {
    btnDirections.onclick = () => window.open(gmapsUrl, '_blank');
  }

  // Toggle del pronóstico semanal
  if (weatherToggle && forecast) {
    let forecastExpanded = false;

    weatherToggle.onclick = () => {
      forecastExpanded = !forecastExpanded;

      if (forecastExpanded) {
        // Cargar pronóstico si no está cargado
        const weatherSections = document.querySelectorAll('[id^="weather-' + school.id + '"]');
        if (weatherSections.length > 0) {
          const section = weatherSections[weatherSections.length - 1];
          const forecastData = section.dataset.forecast;
          if (forecastData) {
            renderWeatherForecast(school.id, JSON.parse(forecastData));
          }
        }

        forecast.classList.remove('hidden');
        weatherToggle.classList.add('expanded');

        // Ocultar tipo de roca
        if (rockType) {
          rockType.classList.add('hidden');
        }
      } else {
        forecast.classList.add('hidden');
        weatherToggle.classList.remove('expanded');

        // Mostrar tipo de roca
        if (rockType) {
          rockType.classList.remove('hidden');
        }
      }
    };
  }

  // Cargar datos del clima
  loadWeatherData(school);

  // Botón visitar escuela
  if (btnVisit) {
    btnVisit.onclick = () => {
      mlSchoolPopup.remove();

      // Cargar la escuela si existe en MAPLIBRE_SCHOOLS
      if (MAPLIBRE_SCHOOLS[school.id]) {
        const schoolConfig = MAPLIBRE_SCHOOLS[school.id];

        // Usar coordenadas de MAPLIBRE_SCHOOLS directamente (no de SCHOOL_MARKERS)
        mlMap.flyTo({
          center: schoolConfig.center,
          zoom: schoolConfig.zoom,
          duration: 1500
        });

        // Cargar la escuela inmediatamente (skipFlyTo=true porque ya hicimos el flyTo arriba)
        mlLoadSchool(school.id, true);

        // Actualizar variables globales si existen
        if (typeof currentSchoolId !== 'undefined') {
          window.currentSchoolId = school.id;
        }
        if (typeof currentSchoolName !== 'undefined') {
          window.currentSchoolName = school.nombre;
        }
      } else if (mlPendingSchoolsCache.has(school.id)) {
        // Escuela aprobada/pendiente solo en Firestore — cargar como pending school
        mlMap.flyTo({
          center: school.coords,
          zoom: school.zoom || 16,
          duration: 1500
        });
        mlLoadSchool(school.id, true);
        if (typeof currentSchoolId !== 'undefined') window.currentSchoolId = school.id;
        if (typeof currentSchoolName !== 'undefined') window.currentSchoolName = school.nombre;
      } else {
        // Fallback para escuelas no configuradas en MAPLIBRE_SCHOOLS
        mlMap.flyTo({
          center: school.coords,
          zoom: school.zoom || 17,
          duration: 1500
        });
        console.warn('Escuela no configurada en MAPLIBRE_SCHOOLS:', school.id);
        if (typeof showToast === 'function') {
          showToast('Esta escuela aún no está disponible', 'info');
        }
      }
    };
  }
}

// ============================================
// UTILIDADES PÚBLICAS
// ============================================

/**
 * Centra el mapa en coordenadas
 */
function mlFlyTo(lng, lat, zoom = 16) {
  if (!mlMap) return;
  mlMap.flyTo({
    center: [lng, lat],
    zoom: zoom,
    duration: 1500
  });
}

/**
 * Obtiene el mapa actual
 */
function mlGetMap() {
  return mlMap;
}

/**
 * Obtiene la escuela actual
 */
function mlGetCurrentSchool() {
  return mlCurrentSchool;
}

// ============================================
// INICIALIZACIÓN AUTOMÁTICA
// ============================================

let mlMapInitialized = false;

// Función que será llamada por initMap si USE_MAPLIBRE es true
function initMap() {
  if (typeof USE_MAPLIBRE !== 'undefined' && USE_MAPLIBRE) {
    console.log('Usando MapLibre GL JS');
    // No inicializar inmediatamente, esperar a que el contenedor sea visible
    mlMapInitialized = false;
    console.log('MapLibre listo para inicializar cuando se muestre el mapa');
  } else {
    console.log('USE_MAPLIBRE está desactivado, se esperaba Google Maps');
  }
}

/**
 * Determina la comunidad autónoma actual según el centro del mapa.
 * Compara contra bounding boxes de CCAA_REGIONS.
 * Devuelve el objeto de la comunidad (con center, zoom, name).
 * Fallback: Madrid.
 */
function getCurrentCCAA() {
  if (!mlMap) return CCAA_REGIONS[CCAA_DEFAULT];

  const { lng, lat } = mlMap.getCenter();

  for (const key of Object.keys(CCAA_REGIONS)) {
    const region = CCAA_REGIONS[key];
    const [minLng, minLat, maxLng, maxLat] = region.bbox;
    if (lng >= minLng && lng <= maxLng && lat >= minLat && lat <= maxLat) {
      // Si la región tiene resetTo, redirigir al reset a esa otra región
      return region.resetTo ? CCAA_REGIONS[region.resetTo] : region;
    }
  }

  return CCAA_REGIONS[CCAA_DEFAULT];
}

/**
 * Crea y configura el botón "Volver a vista regional"
 * Se posiciona debajo del botón de filtro en la esquina superior derecha
 */
function setupResetViewButton() {
  if (document.getElementById('resetViewBtn')) return;

  const container = document.getElementById('map');
  if (!container) return;

  // Crear botón dinámicamente (mismo patrón que addGradeFilterButton)
  const btn = document.createElement('button');
  btn.id = 'resetViewBtn';
  btn.className = 'map-control-btn reset-view-btn';
  btn.title = 'Volver a vista general';
  btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>`;
  btn.type = 'button';
  btn.setAttribute('aria-label', 'Volver a vista general');
  btn.classList.add('maplibregl-ctrl');   // la columna de controles de MapLibre solo deja pasar los toques a sus controles

  // Columna de controles de abajo a la derecha (encima de la ubicación); su aspecto, en app_2.css
  const stack = mlMap.getContainer().querySelector('.maplibregl-ctrl-bottom-right');
  if (stack) stack.insertBefore(btn, stack.firstChild);
  else container.appendChild(btn);

  // Función para actualizar visibilidad según zoom
  const updateVisibility = () => {
    if (!mlMap) return;
    // Visible cuando el zoom es mayor que el de la comunidad actual + margen
    const ccaa = getCurrentCCAA();
    btn.style.display = mlMap.getZoom() > ccaa.zoom + 1 ? 'flex' : 'none';
  };

  // Click: volver a vista regional de la comunidad autónoma actual
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!mlMap) return;

    // 1. Detectar comunidad autónoma según posición actual del mapa
    const ccaa = getCurrentCCAA();

    // 2. Cerrar panel de filtro si está abierto
    closeGradeFilterPanel();

    // 3. Cerrar todos los popups
    if (mlRoutePopup) mlRoutePopup.remove();
    if (mlSectorPopup) mlSectorPopup.remove();
    if (mlParkingPopup) mlParkingPopup.remove();
    if (mlSchoolPopup) mlSchoolPopup.remove();

    // 4. Cerrar bottom sheet
    hideRouteBottomSheet();

    // 5. Resetear escuela activa
    mlCurrentSchool = null;

    // 6. Volar a vista regional de la comunidad autónoma
    mlMap.flyTo({
      center: ccaa.center,
      zoom: ccaa.zoom,
      pitch: 0,
      bearing: 0,
      duration: 1200
    });
  });

  // Listener de zoom para mostrar/ocultar
  mlMap.on('zoom', updateVisibility);
  updateVisibility();
}

/**
 * Inicializa o redimensiona el mapa cuando la vista se hace visible
 * Llamar desde switchView cuando viewId === 'map-view'
 */
function mlEnsureMapReady() {
  if (!USE_MAPLIBRE) return;

  if (!mlMapInitialized) {
    console.log('Inicializando MapLibre por primera vez...');
    initMapLibre();
    mlMapInitialized = true;
  } else if (mlMap) {
    // El mapa ya existe, solo redimensionar
    console.log('Redimensionando MapLibre...');
    setTimeout(() => {
      mlMap.resize();
    }, 100);
  }
}

// Exponer funciones globalmente
window.initMapLibre = initMapLibre;
window.mlLoadSchool = mlLoadSchool;
window.mlLoadPendingSchool = mlLoadPendingSchool;
window.mlToggle3D = mlToggle3D;
window.mlFlyTo = mlFlyTo;
window.mlGetMap = mlGetMap;
window.mlOpenRouteDetails = mlOpenRouteDetails;
window.mlEnsureMapReady = mlEnsureMapReady;
window.getGradeColor = getGradeColor;

// ============================================
// BOTTOM SHEET - Escuelas (Mobile Only)
// Rediseñado según mockups de Flighty/Apple Maps
// ============================================

// Variables globales del Bottom Sheet
let bsCurrentSchool = null;
let bsCurrentState = 'hidden'; // 'hidden', 'summary', 'expanded'
let bsGradeData = null; // Cache de datos de grados

// === Sector Bottom Sheet state ===
let secBsCurrentSector = null;   // { name, props, coords }
let secBsCurrentState = 'hidden';

// === Route Bottom Sheet state ===
let rbsCurrentState = 'hidden';

// Controladores de las hojas (map-ui.js: KXMapSheet). Escuela y sector tienen dos alturas
// reales (resumen y expandida); la vía, una sola con contenido desplazable.
let kxSchoolSheet = null;
let kxSectorSheet = null;
let kxRouteSheet = null;

/**
 * Desplazamiento adaptativo del mapa al abrir un bottom sheet.
 *
 * Comportamiento:
 * - Solo mueve el mapa si el punto queda tapado por el bottom sheet.
 * - Si el punto ya está en zona visible, no hace nada.
 * - Nunca desplaza el punto fuera del viewport (protección superior).
 * - Recalcula todo dinámicamente en cada invocación (sin caché ni estado).
 *
 * CSS del bottom sheet expandido: translateY(3%), max-height: 95vh
 * → El borde superior del sheet está a ~5% desde arriba del viewport.
 * → La zona visible libre queda entre y=0 y y≈5% del viewport.
 *
 * Estrategia: posicionar el punto en el centro del tercio superior
 * visible (por encima del bottom sheet), con protección de bordes.
 *
 * @param {Object} coords - {lng, lat} o [lng, lat]
 */
function adaptiveMapPanForBottomSheet(coords) {
  if (!mlMap) return;

  // --- Recalcular todo dinámicamente ---
  const vh = window.innerHeight;
  const vw = window.innerWidth;

  // El bottom sheet expandido: translateY(3%) con max-height 95vh
  // El borde superior del sheet queda a aproximadamente 3% del viewport desde arriba.
  // Pero el sheet tiene un handle (~30px) que es semi-transparente.
  // Zona libre real para ver el mapa: desde y=0 hasta y = (tope del sheet)
  const sheetTopY = Math.round(vh * 0.08); // ~8% del viewport = zona segura visible
  // Usamos 8% (no 3%) para dar margen al handle y asegurar visibilidad clara

  const marginTop = 20;  // No acercar demasiado al borde superior
  const marginSide = 15;

  // Posición ideal: centrar el punto en la zona visible (entre marginTop y sheetTopY)
  const idealY = Math.round((marginTop + sheetTopY) / 2);

  // --- Proyectar coordenadas a pantalla ---
  const lngLat = Array.isArray(coords)
    ? { lng: coords[0], lat: coords[1] }
    : coords;
  const pointScreen = mlMap.project([lngLat.lng, lngLat.lat]);

  // --- Verificar si el punto ya está en zona segura ---
  const isInSafeZoneY = pointScreen.y >= marginTop && pointScreen.y <= sheetTopY;
  const isInSafeZoneX = pointScreen.x >= marginSide && pointScreen.x <= vw - marginSide;

  if (isInSafeZoneY && isInSafeZoneX) {
    // Punto ya visible por encima del bottom sheet — no mover
    return;
  }

  // --- Calcular desplazamiento vertical ---
  let deltaY = 0;

  if (pointScreen.y > sheetTopY) {
    // Punto tapado por el bottom sheet — subir hasta posición ideal
    deltaY = pointScreen.y - idealY;
  } else if (pointScreen.y < marginTop) {
    // Punto por encima del viewport visible — bajar hasta posición ideal
    deltaY = pointScreen.y - idealY; // Será negativo → panBy moverá mapa hacia abajo
  }

  // --- Protección contra sobre-desplazamiento ---
  // Verificar que tras el pan, el punto no salga por arriba
  const resultY = pointScreen.y - deltaY;
  if (resultY < marginTop) {
    deltaY = pointScreen.y - marginTop;
  } else if (resultY > sheetTopY) {
    deltaY = pointScreen.y - sheetTopY;
  }

  // --- Desplazamiento horizontal (protección lateral) ---
  let deltaX = 0;
  if (pointScreen.x < marginSide) {
    deltaX = pointScreen.x - marginSide;
  } else if (pointScreen.x > vw - marginSide) {
    deltaX = pointScreen.x - (vw - marginSide);
  }

  // --- Umbral mínimo: no mover si el delta es despreciable ---
  if (Math.abs(deltaY) < 5 && Math.abs(deltaX) < 5) {
    return;
  }

  // --- Aplicar desplazamiento mínimo necesario ---
  mlMap.panBy([deltaX, deltaY], {
    duration: 400,
    easing: function(t) { return t * (2 - t); } // ease-out cuadrático
  });
}

/**
 * Detecta si estamos en dispositivo móvil
 */
function isMobileDevice() {
  return window.innerWidth <= 768 ||
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

/**
 * Inicializa el Bottom Sheet
 */
function initBottomSheet() {
  const bottomSheet = document.getElementById('school-bottom-sheet');
  const drag = document.getElementById('bs-school-drag');
  const foot = document.getElementById('bs-school-foot');

  if (!bottomSheet || !drag || !foot || typeof KXMapSheet === 'undefined') {
    console.warn('Bottom Sheet elementos no encontrados');
    return;
  }

  // Cabecera y pie con los constructores compartidos (los mismos ids de siempre)
  drag.innerHTML = kxSheetDragHTML({
    titleId: 'bs-school-name',
    // Tipo de roca y restricciones juntos bajo el nombre (la etiqueta de restricciones se añade al conocer los datos)
    metaHTML: kxTagHTML({ icon: 'mountain', textId: 'bs-rock-type', text: 'Caliza' }) + '<span class="bs-tag-slot" id="bs-restriction-slot"></span>'
  });
  // Puntos de página encima de los botones (fijos en las dos páginas)
  foot.innerHTML =
    `<div class="bs-pdots" role="tablist" aria-label="Páginas de la ficha">
      <button type="button" class="bs-pdot is-on" role="tab" data-page="0" aria-selected="true" aria-controls="bs-page-0" aria-label="Vías y tiempo"></button>
      <button type="button" class="bs-pdot" role="tab" data-page="1" aria-selected="false" aria-controls="bs-page-1" aria-label="Condiciones y actividad"></button>
      <button type="button" class="bs-pdot bs-pdot-admin" role="tab" data-page="2" aria-selected="false" aria-controls="bs-page-2" aria-label="Herramientas de admin"></button>
    </div>` +
    kxButtonHTML({ icon: 'navigation', label: '¿Cómo ir?', variant: 'secondary', size: 'lg', attrs: { id: 'bs-btn-directions' } }) +
    kxButtonHTML({ icon: 'map', label: 'Visitar escuela', variant: 'primary', size: 'lg', attrs: { id: 'bs-btn-visit' } });
  kxInitSchoolPages(bottomSheet, foot);

  kxSchoolSheet = KXMapSheet.create(bottomSheet, {
    snaps: ['summary', 'expanded'],
    // La altura sigue a la página visible: las dos páginas miden lo mismo (el donut absorbe la diferencia);
    // en la 2 sube hasta mostrar todo el contenido. Solo se amplía más si la página 2 no cabe entera
    peek: () => document.getElementById('bs-page-' + (bsPager ? bsPager.current() : 0)),
    peekMax: 0.92,
    expandable: () => !!bsPager && bsPager.current() === 1 && !!kxSchoolSheet && kxSchoolSheet.capped,
    onRequestClose: hideBottomSheet,
    onStateChange: state => { bsCurrentState = state; }
  });
  kxBindScrollCue(bottomSheet);   // si el contenido continúa bajo el pie (móviles bajos), el pie lo indica

  // Botón direcciones
  const btnDirections = document.getElementById('bs-btn-directions');
  if (btnDirections) {
    btnDirections.addEventListener('click', () => {
      if (bsCurrentSchool) {
        const lat = bsCurrentSchool.coords[1];
        const lng = bsCurrentSchool.coords[0];
        const gmapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
        window.open(gmapsUrl, '_blank');
      }
    });
  }

  // Botón visitar
  const btnVisit = document.getElementById('bs-btn-visit');
  if (btnVisit) {
    btnVisit.addEventListener('click', () => {
      console.log('Click en Visitar Escuela. bsCurrentSchool:', bsCurrentSchool);

      if (!bsCurrentSchool) {
        console.error('bsCurrentSchool es null');
        if (typeof showToast === 'function') {
          showToast('Error: No se pudo cargar la información de la escuela', 'error');
        }
        return;
      }

      if (!bsCurrentSchool.id) {
        console.error('bsCurrentSchool no tiene ID:', bsCurrentSchool);
        if (typeof showToast === 'function') {
          showToast('Error: Escuela sin identificador', 'error');
        }
        return;
      }

      const isFirestoreSchool = !MAPLIBRE_SCHOOLS[bsCurrentSchool.id] && mlPendingSchoolsCache.has(bsCurrentSchool.id);

      if (!MAPLIBRE_SCHOOLS[bsCurrentSchool.id] && !isFirestoreSchool) {
        console.warn('Escuela no configurada en MAPLIBRE_SCHOOLS:', bsCurrentSchool.id);
        if (typeof showToast === 'function') {
          showToast('Esta escuela aún no está disponible', 'info');
        }
        return;
      }

      // Todo OK, proceder con la navegación
      const schoolId = bsCurrentSchool.id;
      const schoolName = bsCurrentSchool.nombre;
      const schoolConfig = MAPLIBRE_SCHOOLS[schoolId];
      // hideBottomSheet() deja bsCurrentSchool a null: los datos del vuelo se leen antes de cerrar la hoja
      const flyCenter = schoolConfig ? schoolConfig.center : bsCurrentSchool.coords;
      const flyZoom = schoolConfig ? schoolConfig.zoom : (bsCurrentSchool.zoom || 16);

      hideBottomSheet();
      mlMap.flyTo({
        center: flyCenter,
        zoom: flyZoom,
        duration: 1500
      });

      mlLoadSchool(schoolId, true);

      if (typeof window.currentSchoolId !== 'undefined') {
        window.currentSchoolId = schoolId;
      }
      if (typeof window.currentSchoolName !== 'undefined') {
        window.currentSchoolName = schoolName;
      }
    });
  }

  console.log('Bottom Sheet inicializado');
}

// ============================================
// SECTOR BOTTOM SHEET
// ============================================

/**
 * Inicializa el Sector Bottom Sheet
 */
function initSectorBottomSheet() {
  const sheet = document.getElementById('sector-bottom-sheet');
  const drag = document.getElementById('secbs-drag');
  const foot = document.getElementById('secbs-foot');

  if (!sheet || !drag || !foot || typeof KXMapSheet === 'undefined') {
    console.warn('Sector Bottom Sheet elementos no encontrados');
    return;
  }

  drag.innerHTML = kxSheetDragHTML({ titleId: 'secbs-sector-name' });
  foot.innerHTML = kxButtonHTML({ icon: 'image', label: 'Ver sector', variant: 'primary', size: 'lg', attrs: { id: 'secbs-btn-view' } });

  // Una sola altura: la del contenido (cabecera, tarjetas y gráfico), sin ocupar toda la pantalla
  kxSectorSheet = KXMapSheet.create(sheet, {
    snaps: ['expanded'],
    onRequestClose: hideSectorBottomSheet,
    onStateChange: state => { secBsCurrentState = state; }
  });

  // Click en "Ver Sector"
  const btnView = document.getElementById('secbs-btn-view');
  if (btnView) {
    btnView.addEventListener('click', () => {
      if (secBsCurrentSector) {
        const schoolId = mlCurrentSchool || 'valeria';
        const sectorName = secBsCurrentSector.name;
        hideSectorBottomSheet();
        openSectorImageViewer(schoolId, sectorName);
      }
    });
  }

  console.log('Sector Bottom Sheet inicializado');
}

/**
 * Muestra el Sector Bottom Sheet con datos del sector
 */
function showSectorBottomSheet(props, coords, extraHTML = '') {
  if (!isMobileDevice()) return false;

  const sheet = document.getElementById('sector-bottom-sheet');
  if (!sheet || !kxSectorSheet) return false;

  // Cerrar otros bottom sheets si están abiertos
  hideBottomSheet();
  hideRouteBottomSheet();
  // Cerrar popups de MapLibre
  if (mlSectorPopup) mlSectorPopup.remove();
  if (mlRoutePopup) mlRoutePopup.remove();

  const sectorName = props.nombre || 'Sector sin nombre';
  const restr = (props.restr || '').toUpperCase();
  const hasRestriction = restr === 'SI' || restr === 'SÍ';
  const fechaInicio = props.Fecha_inicio;
  const fechaFin = props.Fecha_fin;
  const exposicion = props.exposicion || '';
  const isRestricted = hasRestriction && isCurrentlyRestricted(fechaInicio, fechaFin);

  const schoolId = mlCurrentSchool || 'valeria';

  // Guardar estado actual del sector
  secBsCurrentSector = { name: sectorName, props: props, coords: coords, schoolId };

  // --- Título y foto de la pared ---
  const titleEl = document.getElementById('secbs-sector-name');
  if (titleEl) titleEl.textContent = sectorName;
  const school = typeof SCHOOL_MARKERS !== 'undefined' ? SCHOOL_MARKERS.find(s => s.id === schoolId) : null;
  kxRenderSheetPhoto(sheet, typeof kxSectorPhoto === 'function' && school ? kxSectorPhoto(school, sectorName) : null);

  // --- Fila de restricción ---
  const restrictionIconEl = document.getElementById('secbs-restriction-icon');
  if (restrictionIconEl) {
    restrictionIconEl.innerHTML = isRestricted
      ? '<img src="icons/prohibido.png" alt="Prohibido" width="36" height="36">'
      : '<img src="icons/permitido.png" alt="Permitido" width="36" height="36">';
  }

  const restrictionStatusEl = document.getElementById('secbs-restriction-status');
  if (restrictionStatusEl) {
    restrictionStatusEl.textContent = isRestricted ? 'Prohibido' : 'Permitido';
    restrictionStatusEl.style.color = isRestricted ? '#dc2626' : '#16a34a';
    restrictionStatusEl.style.fontWeight = '600';
  }

  const restrictionDatesEl = document.getElementById('secbs-restriction-dates');
  if (restrictionDatesEl) {
    restrictionDatesEl.textContent = hasRestriction
      ? `(Restricción: ${fechaInicio} – ${fechaFin})`
      : '';
  }

  // --- Fila de exposición ---
  const exposureIconEl = document.getElementById('secbs-exposure-icon');
  if (exposureIconEl) {
    exposureIconEl.innerHTML = getExposureIcon(exposicion);
  }

  const exposureTextEl = document.getElementById('secbs-exposure-text');
  if (exposureTextEl) {
    exposureTextEl.textContent = exposicion ? exposicion.replace(/_/g, ' ') : 'No especificada';
    exposureTextEl.style.color = '#f59e0b';
    exposureTextEl.style.fontWeight = '500';
  }

  // --- Reset contenedores async ---
  const estadoContainer = document.getElementById('secbs-estado-container');
  if (estadoContainer) estadoContainer.innerHTML = kxSectorEquipHTML({ loading: true });
  kxRenderSectorExplore();


  // --- Mostrar sheet (altura del contenido) ---
  if (kxSectorSheet) kxSectorSheet.open('expanded');

  // --- Cargar datos async ---
  // Gráfico de grados
  kxLoadGradeChart(document.getElementById('secbs-grade-chart'), { schoolId: mlCurrentSchool, sector: sectorName, sectorProps: props, coords: { lng: coords[0], lat: coords[1] }, title: 'Vías por Grado', compactTotal: true, withUngraded: true, static: true });

  // Equipamiento: votos de estado de todas las vías del sector (GeoJSON completo, no solo las dibujadas)
  const current = secBsCurrentSector;
  kxSectorRoutes(schoolId, sectorName)
    .then(routes => routes.map(r => Number(r.id)).filter(id => !isNaN(id)))
    .catch(() => undefined)
    .then(ids => getSectorEstadoAverage(schoolId, sectorName, ids && [...new Set(ids)]))
    .then(result => {
      const container = document.getElementById('secbs-estado-container');
      if (!container || secBsCurrentSector !== current) return;
      container.innerHTML = kxSectorEquipHTML(result);
    });

  // Admin actions
  const adminActionsEl = document.getElementById('secbs-admin-actions');
  if (adminActionsEl) adminActionsEl.innerHTML = extraHTML;

  return true;
}

// ============================================
// FICHA DE SECTOR: EQUIPAMIENTO Y «TU EXPLORACIÓN»
// ============================================

// «Equipamiento»: media de «Estado de la vía» votada por la comunidad (estado_votes). Nunca una cifra inventada:
// sin votos suficientes (getSectorEstadoAverage pide el 40 % de las vías valoradas) dice «Sin valoraciones».
function kxSectorEquipHTML(result) {
  const r = result || {};
  const votes = r.votesCount || 0;
  let value, sub;
  if (r.loading) {
    value = '<span class="secbs-equip-none">Cargando…</span>';
    sub = '';
  } else if (r.avg != null) {
    const avg = r.avg.toLocaleString('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    value = `<span class="secbs-equip-num">${avg}</span>${kxIcon('star', { size: 26, cls: 'secbs-equip-star' })}<span class="secbs-equip-of">/ 5</span>`;
    sub = `${votes} ${votes === 1 ? 'valoración' : 'valoraciones'}`;
  } else {
    value = '<span class="secbs-equip-none">Sin valoraciones</span>';
    sub = r.ratedCount ? `${r.ratedCount} de ${r.totalCount} vías valoradas, aún pocas para una media` : 'Valora el estado de sus vías';
  }
  return `<section class="secbs-card secbs-equip${r.loading ? ' is-loading' : ''}" title="Valoración de la comunidad sobre el estado de las vías; no es una certificación de seguridad">
    <span class="secbs-equip-badge" aria-hidden="true">${kxIcon('shieldCheck', { size: 30 })}</span>
    <div class="secbs-equip-main">
      <h3 class="secbs-card-title">Equipamiento</h3>
      <div class="secbs-equip-value">${value}</div>
      ${sub ? `<p class="secbs-card-sub">${kxEsc(sub)}</p>` : ''}
    </div>
  </section>`;
}

// «Tu exploración». view: resultado de kxSectorProgress o { kind: 'guest' | 'loading' | 'error' }; fromPct: anchura de partida de la barra
function kxSectorExploreHTML(view, fromPct = 0) {
  const head = tag => `<div class="secbs-explore-head"><h3 class="secbs-card-title">Tu exploración</h3>${tag || ''}</div>`;
  const msg = text => `<section class="secbs-card secbs-explore is-msg">${head()}<p class="secbs-explore-msg">${kxEsc(text)}</p></section>`;
  if (!view || view.kind === 'loading') {
    return `<section class="secbs-card secbs-explore is-loading" aria-busy="true">${head()}<div class="secbs-explore-nums"><span class="secbs-skel secbs-skel--num"></span><span class="secbs-skel secbs-skel--pct"></span></div><div class="secbs-explore-bar"></div><div class="secbs-explore-foot"><span class="secbs-skel secbs-skel--line"></span></div></section>`;
  }
  if (view.kind === 'guest') return msg('Inicia sesión y registra tus ascensiones para ver cuántas vías de este sector has encadenado.');
  if (view.kind === 'error') return msg('No se pudo cargar tu progreso. Revisa la conexión.');
  if (view.state === 'no-routes') return msg('Este sector todavía no tiene vías registradas.');
  const tag = view.state === 'progress' ? '<span class="secbs-explore-tag">En progreso</span>'
    : view.state === 'complete' ? '<span class="secbs-explore-tag is-done">Completado</span>' : '';
  const caption = view.state === 'empty' ? '¡Empieza a explorar este sector!'
    : view.state === 'complete' ? '¡Sector completado!' : null;
  const right = view.state === 'complete' ? '' : `<span class="secbs-explore-pending">${view.pending} ${view.pending === 1 ? 'pendiente' : 'pendientes'}</span>`;
  return `<section class="secbs-card secbs-explore is-${view.state}">
    ${head(tag)}
    <div class="secbs-explore-nums">
      <span class="secbs-explore-count"><strong>${view.sent}</strong> / ${view.total} ${view.total === 1 ? 'vía' : 'vías'}</span>
      <span class="secbs-explore-pct">${view.pct}%</span>
    </div>
    <div class="secbs-explore-bar" role="progressbar" aria-label="Vías encadenadas en este sector" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${view.pct}" aria-valuetext="${view.sent} de ${view.total} vías, ${view.pct}%">
      <span class="secbs-explore-fill" style="width:${fromPct}%" data-pct="${view.pct}"></span>
    </div>
    <div class="secbs-explore-foot"><span class="secbs-explore-caption">${caption ? kxEsc(caption) : 'Vías encadenadas<span class="secbs-explore-long"> en este sector</span>'}</span>${right}</div>
  </section>`;
}

let secBsExploreSeq = 0;

// Pinta «Tu exploración» del sector abierto con los ascensos ya cargados (userAscentsCache): sin consultas nuevas.
// Se repinta sola al registrar o borrar un ascenso (evento kx:ascents-changed).
async function kxRenderSectorExplore() {
  const el = document.getElementById('secbs-explore');
  const cur = secBsCurrentSector;
  if (!el || !cur) return;
  const seq = ++secBsExploreSeq;
  const paint = view => {
    if (seq !== secBsExploreSeq || secBsCurrentSector !== cur) return;
    const prevFill = el.querySelector('.secbs-explore-fill');
    const from = prevFill ? parseFloat(prevFill.style.width) || 0 : 0;
    el.innerHTML = kxSectorExploreHTML(view, from);
    const fill = el.querySelector('.secbs-explore-fill');
    if (fill) requestAnimationFrame(() => requestAnimationFrame(() => { fill.style.width = `${fill.dataset.pct}%`; }));
  };
  if (typeof currentUser === 'undefined' || !currentUser) return paint({ kind: 'guest' });
  const cacheState = typeof userAscentsCacheState !== 'undefined' ? userAscentsCacheState : 'ready';
  if (cacheState === 'error') return paint({ kind: 'error' });
  if (cacheState !== 'ready') return paint({ kind: 'loading' });   // al terminar la carga llega kx:ascents-changed
  let routes;
  try {
    routes = await kxSectorRoutes(cur.schoolId, cur.name);
  } catch (e) {
    console.warn('Progreso del sector:', e);
    return paint({ kind: 'error' });
  }
  const schoolId = cur.schoolId;
  // Por id de vía; los ascensos antiguos sin id se guardaron por nombre
  const sent = r => hasUserSentRoute(schoolId, r.id) || (!!r.name && hasUserSentRoute(schoolId, r.name));
  paint(kxSectorProgress(routes, sent));
}

document.addEventListener('kx:ascents-changed', () => { if (secBsCurrentSector) kxRenderSectorExplore(); });

/**
 * Oculta el Sector Bottom Sheet
 */
function hideSectorBottomSheet() {
  if (!kxSectorSheet || secBsCurrentState === 'hidden') return;
  kxSectorSheet.close();

  // Resetear padding del mapa al cerrar el bottom sheet
  if (mlMap) {
    mlMap.easeTo({ padding: { top: 0, bottom: 0, left: 0, right: 0 }, duration: 300 });
  }

  secBsCurrentState = 'hidden';
  secBsCurrentSector = null;
  kxClearSectorSelection();
}

// ============================================
// ROUTE BOTTOM SHEET (Vías - solo móvil)
// ============================================

/**
 * Inicializa el Route Bottom Sheet
 */
// Escritorio: Escape cierra el popup de ficha abierto (vía, sector o escuela)
function kxBindPopupEscape() {
  if (kxBindPopupEscape.done) return;
  kxBindPopupEscape.done = true;
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    if (document.body.classList.contains('kx-sheet-open') || document.body.classList.contains('kx-map-sheet-open')) return;
    if (document.querySelector('.modal:not(.hidden), .ml-contribute-overlay, .sector-image-viewer:not(.hidden)')) return;
    const open = [mlRoutePopup, mlSectorPopup, mlSchoolPopup].find(p => p && p.isOpen());
    if (open) { e.preventDefault(); open.remove(); }
  });
}

function initRouteBottomSheet() {
  kxBindPopupEscape();
  const sheet = document.getElementById('route-bottom-sheet');

  if (!sheet || typeof KXMapSheet === 'undefined') {
    console.warn('Route Bottom Sheet elementos no encontrados');
    return;
  }

  kxRouteSheet = KXMapSheet.create(sheet, {
    snaps: ['expanded'],
    onRequestClose: hideRouteBottomSheet,
    onStateChange: state => { rbsCurrentState = state; }
  });
  kxInitRouteSheetSwipe(sheet);

  console.log('Route Bottom Sheet inicializado');
}

/**
 * Muestra el Route Bottom Sheet con datos de la vía (solo móvil)
 */
async function showRouteBottomSheet(props, coords) {
  if (!isMobileDevice()) return false;

  const sheet = document.getElementById('route-bottom-sheet');
  if (!sheet || !kxRouteSheet) return false;

  // Cerrar otros bottom sheets y popups
  hideBottomSheet();
  hideSectorBottomSheet();
  if (mlRoutePopup) mlRoutePopup.remove();

  kxRemoveRouteVariantBar();
  mlCurrentVariantGroup = null;
  kxFillRouteSheet(props, { isTrinomial: false, contribute: true });

  // --- Mostrar sheet ---
  kxRouteSheet.open('expanded');
  return true;
}

/**
 * Oculta el Route Bottom Sheet
 */
function hideRouteBottomSheet() {
  if (!kxRouteSheet || rbsCurrentState === 'hidden') return;
  kxRouteSheet.close();

  // Resetear padding del mapa al cerrar el bottom sheet
  if (mlMap) {
    mlMap.easeTo({ padding: { top: 0, bottom: 0, left: 0, right: 0 }, duration: 300 });
  }

  rbsCurrentState = 'hidden';
  mlClearHighlightIfRouteClosed();
}

/**
 * Muestra el Bottom Sheet con datos de la escuela
 */
function showBottomSheet(school) {
  console.log('showBottomSheet llamado con:', school);

  if (!isMobileDevice()) {
    return false;
  }

  // Cerrar otros bottom sheets si están abiertos
  hideSectorBottomSheet();
  hideRouteBottomSheet();

  if (!kxSchoolSheet) {
    console.error('Bottom Sheet elementos no encontrados');
    return false;
  }

  bsCurrentSchool = school;
  bsGradeData = null;

  console.log('bsCurrentSchool establecido a:', bsCurrentSchool);

  // Actualizar contenido básico
  updateBottomSheetContent(school);

  // Reset del estado de favorito
  const btnFavorite = document.getElementById('bs-btn-favorite');
  if (btnFavorite) btnFavorite.classList.remove('active');

  // Siempre empieza en la primera página
  if (bsPager) bsPager.go(0, { animate: false });
  kxRenderSchoolPhoto(school);
  kxRenderSchoolConditions(school, null);
  kxRenderSchoolAdminPage(school);

  // Abre en resumen ajustado a la página 1 (donut y tiempo), sin vista completa
  kxSchoolSheet.open('summary');

  // Cargar estadísticas (esto actualiza los gráficos)
  loadBottomSheetStats(school.id);

  // Cargar clima
  loadBottomSheetWeather(school);

  return true;
}

/**
 * Oculta el Bottom Sheet
 */
function hideBottomSheet() {
  if (!kxSchoolSheet) return;
  kxSelectSchool(null);
  kxSchoolSheet.close();

  // Resetear padding del mapa al cerrar el bottom sheet
  if (mlMap) {
    mlMap.easeTo({ padding: { top: 0, bottom: 0, left: 0, right: 0 }, duration: 300 });
  }

  bsCurrentState = 'hidden';
  bsCurrentSchool = null;
  bsGradeData = null;
}

/**
 * Expande el Bottom Sheet a vista completa
 */
function expandBottomSheet() {
  if (kxSchoolSheet && bsCurrentState !== 'hidden') kxSchoolSheet.setState('expanded');
}

/**
 * Colapsa el Bottom Sheet a vista resumen
 */
function collapseBottomSheet() {
  if (kxSchoolSheet && bsCurrentState !== 'hidden') kxSchoolSheet.setState('summary');
}

/**
 * Actualiza el contenido del Bottom Sheet
 */
function updateBottomSheetContent(school) {
  // Título (mayúsculas)
  const titleEl = document.getElementById('bs-school-name');
  if (titleEl) titleEl.textContent = school.nombre;

  // Tipo de roca
  const rockEl = document.getElementById('bs-rock-type');
  if (rockEl) rockEl.textContent = school.rockType || (school.isUserSchool ? 'Roca sin indicar' : 'Caliza');

  kxRenderSchoolCards(school);
}

// ============================================
// DATOS REALES DE LA FICHA: restricciones, actividad del usuario, información práctica
// ============================================
// Solo se muestra lo que existe: restricciones y exposición salen de los sectores de la escuela, el aparcamiento
// de su capa de parkings y la actividad de los ascensos del propio usuario. Un dato ausente no se rellena.
const kxSchoolFactsCache = new Map();
let kxSchoolCardsToken = 0;

async function kxFetchFeatures(path) {
  if (!path) return null;
  try {
    const res = await fetch(path);
    if (!res.ok) return null;
    const json = await res.json();
    return Array.isArray(json.features) ? json.features : null;
  } catch (e) {
    return null;
  }
}

// Con el mapa en reposo se adelantan los datos de la ficha (pastillas y fotos): al abrirla ya están en memoria
function kxPrewarmSchoolSheet() {
  const run = () => {
    try {
      Object.keys(MAPLIBRE_SCHOOLS).forEach(id => { kxLoadSchoolFacts(id).catch(() => {}); });
      if (typeof KX_SCHOOL_PHOTOS !== 'undefined') Object.values(KX_SCHOOL_PHOTOS).forEach(ph => { if (ph && ph.src) { const im = new Image(); im.decoding = 'async'; im.src = ph.src; } });
    } catch (e) { /* adelantar datos es opcional */ }
  };
  if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 3000 }); else setTimeout(run, 1500);
}

// Restricciones y exposición a partir de las propiedades de los sectores (+ exposiciones sueltas, p. ej. la de la escuela)
function kxBuildSchoolFacts(props, parking, extraExposures = []) {
  const facts = { restriction: null, exposures: [], parking };
  const kinds = new Set();
  const addExposure = (raw) => {
    const e = String(raw || '').toLowerCase().trim();
    if (/sombra/.test(e)) kinds.add('shade');
    else if (/ma[ñn]ana/.test(e)) kinds.add('morning');
    else if (/tarde/.test(e)) kinds.add('afternoon');
    else if (/medio/.test(e)) kinds.add('midday');
    else if (e.startsWith('sol')) kinds.add('sun');
  };
  if (props.length) {
    const flags = props.map(p => String(p.restr || '').trim().toUpperCase().replace('Í', 'I'));
    if (flags.includes('SI')) {
      const active = props.some((p, i) => flags[i] === 'SI' && isCurrentlyRestricted(p.Fecha_inicio || p.Fecha_inic, p.Fecha_fin));
      facts.restriction = active ? 'active' : 'seasonal';
    } else if (flags.every(f => f === 'NO')) {
      facts.restriction = 'none';
    }
    props.forEach(p => addExposure(p.exposicion));
  }
  extraExposures.forEach(addExposure);
  // «Sol» a secas solo informa cuando no hay una franja concreta
  if (kinds.has('sun') && ['morning', 'afternoon', 'midday'].some(k => kinds.has(k))) kinds.delete('sun');
  facts.exposures = ['morning', 'midday', 'afternoon', 'sun', 'shade'].filter(k => kinds.has(k));
  return facts;
}

// Escuela de Firestore: su orientación y aparcamiento (los edita un admin) más los sectores aprobados. Sin caché: es una consulta corta
// y un sector nuevo o editado debe verse al abrir la ficha.
async function kxLoadUserSchoolFacts(schoolId) {
  const data = mlApprovedSchoolsCache.get(schoolId);
  if (!data) return null;
  let props = [];
  try {
    const snap = await firebase.firestore().collection('pending_sectors')
      .where('schoolId', '==', schoolId)
      .where('status', '==', 'approved')
      .get();
    props = snap.docs.map(d => d.data());
  } catch (e) {
    console.warn('Error cargando sectores de la escuela:', e);
  }
  const parking = data.aparcamiento === 'si' ? true : data.aparcamiento === 'no' ? false : null;
  return kxBuildSchoolFacts(props, parking, data.exposicion ? [data.exposicion] : []);
}

function kxLoadSchoolFacts(schoolId) {
  const cfg = MAPLIBRE_SCHOOLS[schoolId];
  if (!cfg || !cfg.geojson) return mlApprovedSchoolsCache.has(schoolId) ? kxLoadUserSchoolFacts(schoolId) : Promise.resolve(null);
  if (!kxSchoolFactsCache.has(schoolId)) {
    kxSchoolFactsCache.set(schoolId, Promise.all([kxFetchFeatures(cfg.geojson.sectores), kxFetchFeatures(cfg.geojson.parkings)])
      .then(([sectors, parkings]) => kxBuildSchoolFacts(
        sectors ? sectors.map(f => f.properties || {}) : [],
        parkings ? parkings.length > 0 : null
      )));
  }
  return kxSchoolFactsCache.get(schoolId);
}

// Vías encadenadas (cualquier estilo menos intento), grado máximo y sectores distintos del usuario en la escuela
async function kxLoadSchoolActivity(schoolId) {
  if (typeof currentUser === 'undefined' || !currentUser || typeof db === 'undefined') return null;
  try {
    const snap = await db.collection('ascents')
      .where('userId', '==', currentUser.uid)
      .where('schoolId', '==', schoolId)
      .get();
    const routes = new Set();
    const routeGrade = new Map();   // una vía cuenta una vez en el gráfico por grado
    const sectors = new Set();
    let best = null, bestIdx = -1;
    snap.docs.forEach(d => {
      const a = d.data();
      if (a.style === 'project') return;
      const rk = a.routeId != null ? String(a.routeId) : a.routeName || d.id;
      routes.add(rk);
      if (a.grade) routeGrade.set(rk, String(a.grade).trim());
      if (a.sector) sectors.add(String(a.sector).trim());
      const idx = typeof _rocoGradeIndex === 'function' ? _rocoGradeIndex(a.grade) : -1;
      if (idx > bestIdx) { bestIdx = idx; best = a.grade; }
    });
    const counts = new Map();
    routeGrade.forEach(g => counts.set(g, (counts.get(g) || 0) + 1));
    const byGrade = [...counts].map(([grade, count]) => ({ grade, count }))
      .sort((x, y) => (typeof _rocoGradeIndex === 'function' ? _rocoGradeIndex(x.grade) - _rocoGradeIndex(y.grade) : 0) || x.grade.localeCompare(y.grade));
    return { sends: routes.size, maxGrade: best, sectors: sectors.size, byGrade };
  } catch (e) {
    console.warn('Actividad en la escuela no disponible:', e);
    return null;
  }
}

function kxSchoolCardHTML(cls, icon, title, bodyHTML) {
  return `<section class="bs-kcard ${cls}"><h3 class="bs-kcard-title">${kxIcon(icon, { size: 22 })}<span>${kxEsc(title)}</span></h3>${bodyHTML}</section>`;
}

function kxKStat(value, label) {
  return `<div class="bs-kstat"><span class="bs-kstat-value">${kxEsc(value)}</span><span class="bs-kstat-label">${kxEsc(label)}</span></div>`;
}

// Gráfico «Evolución por grado»: vías encadenadas por el usuario en la escuela, con los colores originales de grado.
// Pulsar una barra muestra cuántas vías ha hecho el usuario de ese grado.
function kxEvoChartHTML(byGrade, total, emptyLabel = 'Todavía no has escalado en esta zona') {
  const scale = typeof GYM_ROCO_GRADE_SCALE !== 'undefined' ? GYM_ROCO_GRADE_SCALE : null;
  if (!scale) return '';
  const counts = new Map();
  (byGrade || []).forEach(g => { const i = _rocoGradeIndex(g.grade); if (i >= 0) counts.set(i, g.count); });
  // Sin ascensiones (o sin sesión): el mismo gráfico vacío, marcado «Sin información»
  const noData = !counts.size;
  // Eje como en las guías: sin los «c+» ni los grados de rocódromo (3, 4, 5+…) salvo que tengan vías
  const axis = scale.map((grade, i) => ({ grade, n: counts.get(i) || 0 }))
    .filter(g => g.n || /^[5-9][ab]\+?$|^[5-9]c$/.test(g.grade));
  // Ventana de al menos 12 grados consecutivos centrada en lo escalado: si el rango es corto, deja margen
  // por debajo y por encima (los grados sin vías quedan vacíos); si es largo, ocupa justo el rango
  const pos = axis.map((g, k) => (g.n ? k : -1)).filter(k => k >= 0);
  const mid = axis.findIndex(g => g.grade === '6b');
  const lo = noData ? mid : pos[0], hi = noData ? mid : pos[pos.length - 1];
  const size = Math.min(axis.length, Math.max(12, hi - lo + 1));
  let start = Math.round((lo + hi) / 2 - (size - 1) / 2);
  start = Math.max(0, Math.min(axis.length - size, start));
  const max = noData ? 1 : Math.max(...counts.values());
  const shown = axis.slice(start, start + size);
  const bars = shown.map(({ grade, n }, k) => {
    const vias = `${n} ${n === 1 ? 'vía' : 'vías'}`;
    const label = `${grade}: ${vias}`;
    const tip = `<span class="bs-gc-tip" aria-hidden="true">${vias}</span>`;
    const bar = n ? `<span class="bs-gc-bar" style="height:${Math.max(6, Math.round(n / max * 100))}%;background:${getGradeColor(grade)}"></span>` : '<span class="bs-gc-bar is-empty"></span>';
    // Burbuja con el número de vías al seleccionar, siempre por encima de la barra más alta; en los extremos se alinea hacia dentro para no salirse de la tarjeta
    const edge = k < 2 ? ' is-first' : k >= shown.length - 2 ? ' is-last' : '';
    return `<button type="button" class="bs-gc-col${n ? '' : ' is-zero'}${edge}" data-count="${n}" data-grade="${kxEsc(grade)}" aria-pressed="false" aria-label="${kxEsc(label)}"${noData ? ' disabled tabindex="-1"' : ''}>
      <span class="bs-gc-track">${tip}${bar}</span><span class="bs-gc-grade">${kxEsc(grade)}</span></button>`;
  }).join('');
  const note = noData
    ? 'Cuando encadenes vías en esta escuela, verás aquí cuántas has hecho de cada grado.'
    : `Vías distintas que has encadenado en esta escuela, por grado (${total} en total). Toca una barra para ver cuántas vías has hecho de ese grado.`;
  return `<section class="bs-gc${noData ? ' is-nodata' : ''}" aria-labelledby="bs-gc-title">
    <header class="bs-gc-head"><h3 class="bs-gc-title" id="bs-gc-title">Evolución por grado (vías)</h3><button type="button" class="bs-info-btn" aria-expanded="false" aria-controls="bs-gc-note" aria-label="Qué muestra este gráfico">${kxIcon('info', { size: 18 })}</button></header>
    <p class="bs-gc-note" id="bs-gc-note" hidden>${note}</p>
    <p class="bs-gc-readout" aria-live="polite"></p>
    <div class="bs-gc-chart" role="group" aria-label="Vías encadenadas por grado">${bars}${noData ? '<span class="bs-gc-empty">${kxEsc(emptyLabel)}</span>' : ''}</div></section>`;
}

function kxBindEvoChart(root) {
  const card = root && root.querySelector('.bs-gc');
  if (!card) return;
  const chart = card.querySelector('.bs-gc-chart');
  const readout = card.querySelector('.bs-gc-readout');
  const info = card.querySelector('.bs-info-btn');
  const note = card.querySelector('.bs-gc-note');
  info.addEventListener('click', () => {
    const open = note.hidden;
    note.hidden = !open;
    info.setAttribute('aria-expanded', String(open));
  });
  chart.addEventListener('click', (e) => {
    const col = e.target.closest('.bs-gc-col');
    if (!col) return;
    const on = col.getAttribute('aria-pressed') !== 'true';
    chart.querySelectorAll('.bs-gc-col').forEach(c => c.setAttribute('aria-pressed', String(c === col && on)));
    chart.classList.toggle('has-sel', on);
    const n = Number(col.dataset.count);
    readout.textContent = on ? `${col.dataset.grade}: ${n} ${n === 1 ? 'vía' : 'vías'}` : '';
  });
}

async function kxRenderSchoolCards(school) {
  const token = ++kxSchoolCardsToken;
  const tagSlot = document.getElementById('bs-restriction-slot');
  const actSlot = document.getElementById('bs-activity-slot');
  [tagSlot, actSlot].forEach(el => { if (el) el.innerHTML = ''; });

  if (actSlot) actSlot.innerHTML = kxSchoolCardHTML('bs-kcard--activity is-loading', 'mountain', `Tu actividad en ${school.nombre}`, kxSkeletonHTML('tiles'));
  // Las pastillas salen en cuanto llegan los datos de la escuela, sin esperar a la actividad (consulta a Firestore)
  const activityTask = kxLoadSchoolActivity(school.id);
  const facts = await kxLoadSchoolFacts(school.id).catch(() => null);
  if (token !== kxSchoolCardsToken) return;   // se abrió otra escuela mientras tanto

  const TAGS = {
    none: { icon: 'shieldCheck', tone: 'forest', text: 'Sin restricciones' },
    seasonal: { icon: 'calendarClock', tone: 'warning', text: 'Restricción estacional' },
    active: { icon: 'ban', tone: 'danger', text: 'Restricción activa' }
  };
  const tag = facts && TAGS[facts.restriction];
  if (tagSlot && facts) {
    // Exposición solar y aparcamiento como símbolos junto a la roca y las restricciones
    const SUN = {
      morning: { icon: 'sunrise', text: 'Mañana', label: 'Sol de mañana' },
      midday: { icon: 'sun', text: 'Mediodía', label: 'Sol a mediodía' },
      afternoon: { icon: 'sunset', text: 'Tarde', label: 'Sol de tarde' },
      sun: { icon: 'sun', text: 'Sol', label: 'Sol' },
      shade: { icon: 'shadeDot', text: 'Sombra', label: 'Sombra' }
    };
    const chips = [];
    if (tag) chips.push(kxTagHTML(tag));
    facts.exposures.forEach(k => chips.push(kxTagHTML({ icon: SUN[k].icon, text: SUN[k].text, attrs: { title: SUN[k].label } })));
    if (facts.parking !== null) chips.push(kxTagHTML({ icon: 'car', text: facts.parking ? 'Sí' : 'No', attrs: { title: facts.parking ? 'Con aparcamiento' : 'Sin aparcamiento' } }));
    tagSlot.innerHTML = chips.join('');
    if (kxSchoolSheet) kxSchoolSheet.refresh();
  }
  const activity = await activityTask;
  if (token !== kxSchoolCardsToken) return;

  // Solo los datos del propio usuario. Sin sesión, sin ascensos o sin conexión: un estado vacío que lo explica
  if (actSlot) {
    const signedIn = typeof currentUser !== 'undefined' && !!currentUser;
    const empty = (title, text) => `<div class="bs-kempty"><p class="bs-kempty-title">${kxEsc(title)}</p><p class="bs-kempty-text">${kxEsc(text)}</p></div>`;
    let body;
    if (!signedIn) body = empty('Todavía no tienes vías registradas', 'Inicia sesión y registra tus ascensiones: tus vías encadenadas, tu grado máximo y los sectores que visites aparecerán aquí.');
    else if (!activity) body = empty('No se pudo cargar tu actividad', 'Revisa la conexión y vuelve a abrir la ficha.');
    else if (!activity.sends) body = empty('Todavía no has escalado en esta zona', 'Cuando encadenes tu primera vía en esta escuela, verás aquí tu progreso.');
    else body = `<div class="bs-kstats bs-kstats--panel">${[
        kxKStat(String(activity.sends), activity.sends === 1 ? 'Vía encadenada' : 'Vías encadenadas'),
        kxKStat(activity.maxGrade || '—', 'Grado máximo'),
        kxKStat(activity.sectors ? String(activity.sectors) : '—', activity.sectors === 1 ? 'Sector visitado' : 'Sectores visitados')
      ].join('')}</div>`;
    actSlot.innerHTML = kxSchoolCardHTML('bs-kcard--activity', 'mountain', `Tu actividad en ${school.nombre}`, body)
      + kxEvoChartHTML(activity && activity.sends ? activity.byGrade : [], activity ? activity.sends : 0, signedIn ? undefined : 'Todavía no tienes vías registradas');
    kxBindEvoChart(actSlot);
  }

  if (kxSchoolSheet) kxSchoolSheet.refresh();
}

// ============================================
// FICHA DE ESCUELA EN DOS PÁGINAS: «Vías y tiempo» y «Condiciones y actividad»
// ============================================
let bsPager = null;
let bsDiscipline = 'sport';
let bsConditionsWeather = null;   // tiempo ya leído de la escuela abierta (para cambiar de modalidad sin pedirlo otra vez)

function kxInitSchoolPages(sheetEl, foot) {
  const stage = document.getElementById('bs-pages');
  const track = document.getElementById('bs-pages-track');
  if (!stage || !track || typeof kxBindPager !== 'function') return;
  const pages = [...track.querySelectorAll('.bs-page')];
  const dots = [...foot.querySelectorAll('.bs-pdot')];
  const sync = (i) => {
    pages.forEach((p, k) => { const on = k === i; p.toggleAttribute('inert', !on); p.setAttribute('aria-hidden', String(!on)); });
    dots.forEach((d, k) => { d.classList.toggle('is-on', k === i); d.setAttribute('aria-selected', String(k === i)); d.tabIndex = k === i ? 0 : -1; });
    sheetEl.dataset.page = String(i);
  };
  // La zona de páginas mide lo que la página visible (sin huecos al desplazar la más corta).
  // Al pasar a una página más corta, el recorte espera a que termine el deslizamiento para no cortar la que sale
  let shrinkT = 0;
  const fit = ({ defer = false } = {}) => {
    const p = pages[bsPager ? bsPager.current() : 0];
    if (!p) return;
    clearTimeout(shrinkT);
    const h = p.offsetHeight;
    if (defer && h < stage.offsetHeight) shrinkT = setTimeout(() => { stage.style.height = `${p.offsetHeight}px`; }, 440);
    else stage.style.height = `${h}px`;
  };
  // Las dos páginas miden lo mismo (la más alta): la hoja no da escalón al pasar de una a otra.
  // La corta reparte el hueco entre sus bloques (el donut queda centrado); el donut no cambia de tamaño
  const equalize = () => {
    pages.forEach(p => { p.style.minHeight = ''; });
    const h = Math.max(...pages.map(p => p.offsetHeight));
    pages.forEach(p => { p.style.minHeight = `${h}px`; });
  };
  // Cambio de página: la hoja sube (página 2) o baja (página 1) a la altura de su contenido, animada
  const resize = () => { if (kxSchoolSheet && kxSchoolSheet.state !== 'hidden') { kxSchoolSheet.measure(); kxSchoolSheet.setState('summary'); } };
  // La tercera hoja (herramientas de admin) solo cuenta cuando la ficha la muestra (.has-admin-page)
  bsPager = kxBindPager(stage, track, { count: () => (sheetEl.classList.contains('has-admin-page') ? pages.length : pages.length - 1), onChange: (i) => { sync(i); fit({ defer: true }); resize(); } });
  sync(0);
  fit();
  // Se observa el contenido, no las páginas (su altura mínima la fijamos nosotros)
  const kids = pages.flatMap(p => [...p.children]);
  const refit = () => { equalize(); fit(); };
  sheetEl._kxRefit = refit;
  if (typeof ResizeObserver === 'function') { const ro = new ResizeObserver(refit); kids.forEach(k => ro.observe(k)); }
  window.addEventListener('resize', refit);
  equalize();
  foot.querySelector('.bs-pdots').addEventListener('click', (e) => {
    const d = e.target.closest('.bs-pdot');
    if (d) bsPager.go(+d.dataset.page);
  });
  foot.querySelector('.bs-pdots').addEventListener('keydown', (e) => {
    const go = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    if (go === undefined) return;
    e.preventDefault();
    bsPager.go(bsPager.current() + go);
    const d = dots[bsPager.current()]; if (d) d.focus();
  });
  // Pasar a otra página vuelve arriba (cada página empieza por su título)
  const body = sheetEl.querySelector('.kx-msheet-body');
  const origGo = bsPager.go;
  bsPager.go = (i, opts) => { const prev = bsPager.current(); origGo(i, opts); if (body && bsPager.current() !== prev) body.scrollTo({ top: 0, behavior: 'smooth' }); };
}

// Escuelas aportadas por la comunidad: tercera hoja de la ficha con sus datos y las herramientas de admin.
// El resto de usuarios no ve ni la hoja ni su punto de página.
const KX_ROCK_OPTIONS = ['Caliza', 'Granito', 'Arenisca', 'Conglomerado', 'Cuarcita', 'Gneis', 'Basalto'];

function kxSchoolAdminHTML(school) {
  const parking = { si: 'Con aparcamiento', no: 'Sin aparcamiento' }[school.aparcamiento] || 'Sin indicar';
  const rows = [
    ['Roca', school.rockType || 'Sin indicar'],
    ['Aparcamiento', parking],
    ['Sol', school.exposicion || 'Sin indicar'],
    ['Descripción', school.descripcion || 'Sin descripción']
  ].map(([k, v]) => `<div class="kx-admin-row"><dt>${kxEscHTML(k)}</dt><dd>${kxEscHTML(v)}</dd></div>`).join('');
  return `
    <section class="kx-admincard" aria-label="Herramientas de admin">
      <h3 class="kx-admincard-title">Herramientas de admin</h3>
      <p class="kx-admincard-sub">Datos de la escuela tal y como los ven los demás</p>
      <dl class="kx-admin-list">${rows}</dl>
      ${kxCommunityFooterHTML({ kind: 'school', docId: school.docId, coords: school.coords, author: school.createdByEmail, isAdmin: true })}
    </section>`;
}

async function kxRenderSchoolAdminPage(school) {
  const sheet = document.getElementById('school-bottom-sheet');
  const slot = document.getElementById('bs-admin-slot');
  if (!sheet || !slot) return;
  sheet.classList.remove('has-admin-page');
  slot.innerHTML = '';
  if (!school || !school.docId) return;
  if (!(await kxIsAdminUser()) || bsCurrentSchool !== school) return;
  slot.innerHTML = kxSchoolAdminHTML(school);
  sheet.classList.add('has-admin-page');
  if (sheet._kxRefit) sheet._kxRefit();
}

// Imagen de la cabecera (school-photos.js): foto real recortada o ilustración genérica según la roca
function kxRenderSchoolPhoto(school) {
  kxRenderSheetPhoto(document.getElementById('school-bottom-sheet'), typeof kxSchoolPhoto === 'function' ? kxSchoolPhoto(school) : null,
    'Ilustración genérica, no es una foto de esta escuela');
}

// Pone (o quita) la imagen recortada arriba a la derecha de una hoja. genericTitle: aviso al pasar el ratón
function kxRenderSheetPhoto(sheet, photo, genericTitle) {
  if (!sheet) return;
  let hero = sheet.querySelector('.bs-hero');
  if (!photo) { if (hero) hero.remove(); sheet.classList.remove('has-hero'); return; }
  if (!hero) {
    hero = document.createElement('div');
    hero.className = 'bs-hero';
    sheet.insertBefore(hero, sheet.firstChild);
  }
  hero.classList.toggle('is-generic', photo.generic);
  hero.style.setProperty('--hero-w', photo.width);
  hero.style.setProperty('--hero-h', photo.height);
  hero.style.setProperty('--hero-x', photo.offsetX);
  hero.style.setProperty('--hero-y', photo.offsetY);
  hero.style.setProperty('--hero-pos', photo.position);
  hero.innerHTML = `<img src="${kxEsc(photo.src)}" alt="${kxEsc(photo.alt)}" title="${kxEsc(photo.generic && genericTitle ? genericTitle : photo.alt)}" decoding="async">`;
  const img = hero.querySelector('img');
  img.addEventListener('error', () => { hero.remove(); sheet.classList.remove('has-hero'); }, { once: true });
  sheet.classList.add('has-hero');
}

// Valoración textual del grip
function kxGripLabel(score) {
  return score >= 80 ? 'Agarre excelente' : score >= 60 ? 'Buen agarre' : score >= 40 ? 'Agarre regular' : 'Agarre pobre';
}

const KX_CONFIDENCE = { high: 'confianza alta', medium: 'confianza media', low: 'confianza baja' };

function kxFactorRowHTML(icon, label, value, rating, tone) {
  return `<div class="bs-frow"><span class="bs-frow-ic">${kxIcon(icon, { size: 18 })}</span><span class="bs-frow-l">${kxEsc(label)}</span>`
    + `<span class="bs-frow-v">${kxEsc(value)}</span><span class="bs-fpill kx-tone-${tone}">${kxEsc(rating)}</span></div>`;
}

// Tarjeta «Condiciones para escalar» (segunda página). weather: kxcWeatherFromOpenMeteo(...) o null mientras carga
async function kxRenderSchoolConditions(school, weather, { loaded = false, error = false } = {}) {
  const slot = document.getElementById('bs-conditions-slot');
  if (!slot || !school) return;
  const cfg = typeof MAPLIBRE_SCHOOLS !== 'undefined' ? MAPLIBRE_SCHOOLS[school.id] : null;
  const disciplines = (cfg && Array.isArray(cfg.disciplines) && cfg.disciplines.length ? cfg.disciplines : ['sport']).filter(d => d === 'sport' || d === 'boulder');
  if (!loaded && !error) { bsConditionsWeather = null; bsDiscipline = disciplines[0] || 'sport'; }
  if (loaded) bsConditionsWeather = weather;
  if (!disciplines.includes(bsDiscipline)) bsDiscipline = disciplines[0] || 'sport';

  const infoBtn = (label) => `<button type="button" class="bs-info-btn" aria-expanded="false" aria-controls="bs-grip-info" aria-label="${kxEsc(label)}">${kxIcon('info', { size: 16 })}</button>`;
  const head = (pill = '', info = '') => `<header class="bs-cond-head">${kxIcon('mountain', { size: 20 })}<h3 class="bs-cond-title" id="bs-cond-title">Condiciones para escalar</h3>${info}${pill}</header>`;
  const wrap = (inner, cls = '') => `<section class="bs-cond${cls}" aria-labelledby="bs-cond-title">${inner}</section>`;

  if (error) {
    slot.innerHTML = wrap(head() + `<p class="bs-cond-msg">No se pudo cargar el tiempo de la escuela, así que no hay estimación. Revisa la conexión y vuelve a abrir la ficha.</p>`);
    return;
  }
  if (!loaded || typeof kxcEstimateSchool !== 'function') {
    slot.innerHTML = wrap(head() + kxSkeletonHTML('lines'), ' is-loading');
    return;
  }

  const facts = await kxLoadSchoolFacts(school.id).catch(() => null);
  if (bsCurrentSchool !== school) return;
  const est = kxcEstimateSchool(weather, { rockType: school.rockType, exposures: facts ? facts.exposures : [] }, bsDiscipline);
  const f = est.factors;

  const cond = est.condition;
  const pill = cond ? `<span class="bs-cond-pill kx-tone-${cond.tone}">${cond.tone === 'success' ? kxIcon('check', { size: 14, stroke: 2.25 }) : ''}${kxEsc(cond.label)}</span>` : '';

  const seg = disciplines.length > 1 && typeof kxSegmentedHTML === 'function'
    ? `<div class="bs-cond-seg">${kxSegmentedHTML({ items: disciplines.map(d => ({ value: d, label: d === 'boulder' ? 'Bloque' : 'Deportiva' })), value: bsDiscipline, label: 'Modalidad' })}</div>`
    : '';

  // Grip: cifra y barra sin contenedor propio; la valoración, la confianza y las notas van en el panel de información
  const scoreHTML = est.display !== null
    ? `<p class="bs-grip-score"><b>${kxEsc(est.display)}</b><span>/100</span></p>
       <div class="bs-grip-bar" role="img" aria-label="${kxEsc(`Grip estimado ${est.display} sobre 100: ${kxGripLabel(est.score).toLowerCase()}, ${KX_CONFIDENCE[est.confidence]}`)}"><span style="--v:${est.score}%"></span></div>`
    : `<p class="bs-grip-score is-limited"><b>—</b></p>
       <p class="bs-grip-conf">Faltan datos de ${kxEsc((est.missing.length ? est.missing : ['tiempo']).join(', '))}</p>`;

  const rockName = typeof kxcRock === 'function' ? kxcRock(school.rockType).label : 'roca';
  const rockPill = f.rock.score === null ? ['Sin datos', 'neutral'] : f.rock.score >= 70 ? ['Buena', 'success'] : f.rock.score >= 40 ? ['Regular', 'warning'] : ['Mala', 'danger'];
  const rows = [
    f.temp ? kxFactorRowHTML('thermometer', 'Temperatura', `${Math.round(f.temp.value)} °C`, f.temp.rating, f.temp.tone) : kxFactorRowHTML('thermometer', 'Temperatura', '—', 'Sin datos', 'neutral'),
    f.humidity ? kxFactorRowHTML('droplet', 'Humedad', `${Math.round(f.humidity.value)} %`, f.humidity.rating, f.humidity.tone) : kxFactorRowHTML('droplet', 'Humedad', '—', 'Sin datos', 'neutral'),
    f.wind ? kxFactorRowHTML('wind', 'Viento', `${Math.round(f.wind.value)} km/h`, f.wind.rating, f.wind.tone) : kxFactorRowHTML('wind', 'Viento', '—', 'Sin datos', 'neutral'),
    kxFactorRowHTML('mountain', `Roca (${rockName.toLowerCase()})`, f.rock.rating, rockPill[0], rockPill[1])
  ].join('');

  const notes = [...est.notes];
  if (est.range) notes.push(`Varía por sector: de ${est.range.lo} (${est.range.worst}) a ${est.range.hi} (${est.range.best})`);
  else if (facts && facts.exposures && facts.exposures.length > 1 && !est.limited) notes.push('Los sectores tienen orientaciones distintas; la estimación es general');

  const summary = est.display !== null
    ? `${kxGripLabel(est.score)} · estimación orientativa, ${KX_CONFIDENCE[est.confidence]}`
    : 'Estimación limitada: no se muestra una cifra';
  const info = `<div class="bs-grip-info" id="bs-grip-info" hidden>
      <p class="bs-grip-sum"><b>${kxEsc(summary)}</b></p>
      ${notes.length ? `<ul class="bs-cond-notes">${notes.map(n => `<li>${kxEsc(n)}</li>`).join('')}</ul>` : ''}
      <p><b>¿Qué es?</b> Una estimación orientativa de lo bien que agarra la roca ahora. No es una medición real del rozamiento.</p>
      <p><b>Qué tiene en cuenta:</b> temperatura (al sol la roca se calienta más que el aire), humedad y punto de rocío, viento, lluvia de las últimas 72 horas y el tiempo de secado según el tipo de roca y la orientación de los sectores. En bloque pesan más la humedad y el frío.</p>
      <p><b>Por qué varía:</b> cambia con la hora, el sol y la lluvia, y cada sector puede estar distinto. Si faltan datos, la confianza baja y no se muestra una cifra.</p>
      <p class="bs-grip-src">Datos meteorológicos: Open-Meteo</p>
    </div>`;

  slot.innerHTML = wrap(head(pill, infoBtn('Qué significan las condiciones para escalar')) + seg + `
    <div class="bs-cond-body">
      <div class="bs-grip">
        <p class="bs-grip-title">Grip de la roca ${infoBtn('Qué significa el grip de la roca')}</p>
        ${scoreHTML}
      </div>
      <div class="bs-factors">${rows}</div>
    </div>
    ${info}`, est.limited ? ' is-limited' : '');

  const box = slot.querySelector('#bs-grip-info');
  const btns = slot.querySelectorAll('.bs-info-btn');
  btns.forEach(btn => btn.addEventListener('click', () => {
    const open = box.hidden; box.hidden = !open;
    btns.forEach(b => b.setAttribute('aria-expanded', String(open)));
  }));
  const segEl = slot.querySelector('.kx-seg');
  if (segEl && typeof kxBindSegmented === 'function') {
    kxBindSegmented(segEl, (v) => { bsDiscipline = v; kxRenderSchoolConditions(school, bsConditionsWeather, { loaded: true }); });
  }
}

// ============================================
// GRÁFICO CIRCULAR DONUT (recuperado del diseño anterior de la ficha de escuela)
// ============================================

/**
 * Renderiza el gráfico donut con total de vías
 */
function renderDonutChart(gradeData) {
  const container = document.getElementById('bs-donut-chart');
  if (!container) return;

  if (!gradeData || Object.keys(gradeData).length === 0) {
    container.innerHTML = '<div class="bs-soon"><span class="bs-soon-badge">Próximamente</span><p class="bs-soon-text">Estamos preparando las vías de esta escuela.</p></div>';
    return;
  }

  const total = Object.values(gradeData).reduce((a, b) => a + b, 0);
  const sortedGrades = sortGrades(Object.keys(gradeData));

  const size = 200;
  const center = size / 2;
  const radius = 76;
  const strokeWidth = 44;
  const circumference = 2 * Math.PI * radius;

  let segments = '';
  let currentOffset = 0;

  sortedGrades.forEach((grade, index) => {
    const count = gradeData[grade];
    const percent = count / total;
    const segmentLength = circumference * percent;
    const color = getGradeColor(grade);
    const delay = index * 0.05;

    segments += `
      <circle
        class="bs-donut-segment"
        data-grade="${grade}"
        data-count="${count}"
        cx="${center}"
        cy="${center}"
        r="${radius}"
        fill="none"
        stroke="${color}"
        stroke-width="${strokeWidth}"
        stroke-dasharray="${segmentLength} ${circumference}"
        stroke-dashoffset="${-currentOffset}"
        stroke-linecap="butt"
        style="--circumference: ${circumference}; --final-offset: ${-currentOffset}; --segment-delay: ${delay}s; cursor: pointer;"
      />
    `;

    currentOffset += segmentLength;
  });

  const defaultCenterContent = `
    <div class="bs-donut-total">${total}</div>
    <div class="bs-donut-label">Vías</div>
  `;

  container.innerHTML = `
    <svg viewBox="0 0 ${size} ${size}">
      <circle cx="${center}" cy="${center}" r="${radius}" fill="none" stroke="#e5e7eb" stroke-width="${strokeWidth}" />
      ${segments}
    </svg>
    <div class="bs-donut-center" id="bs-donut-center">
      ${defaultCenterContent}
    </div>
  `;

  // Añadir interactividad a los segmentos
  const svgEl = container.querySelector('svg');
  const svgSegments = container.querySelectorAll('.bs-donut-segment');
  const centerText = document.getElementById('bs-donut-center');

  const showSegment = (segment) => {
    const grade = segment.getAttribute('data-grade');
    const count = segment.getAttribute('data-count');
    const color = segment.getAttribute('stroke');
    centerText.innerHTML = `
      <div class="bs-donut-total" style="color: ${color};">${grade.toUpperCase()}</div>
      <div class="bs-donut-label">${count} Vías</div>
    `;
  };

  svgSegments.forEach(segment => {
    segment.addEventListener('mouseenter', () => showSegment(segment));
    // Pantallas táctiles: no hay hover, así que tocar un segmento muestra su grado y sus vías
    segment.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse') showSegment(segment); });
  });

  // Táctil: tocar fuera de los segmentos vuelve al total (el equivalente a sacar el ratón del donut)
  container._kxDefaultCenter = defaultCenterContent;
  if (!container._kxTouchBound) {
    container._kxTouchBound = true;
    document.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' || !container.isConnected || e.target.closest('.bs-donut-segment')) return;
      const c = document.getElementById('bs-donut-center');
      if (c) c.innerHTML = container._kxDefaultCenter;
    }, true);
  }

  // Restaurar total cuando el ratón sale del SVG (no de cada segmento)
  if (svgEl) {
    svgEl.addEventListener('mouseleave', () => {
      centerText.innerHTML = defaultCenterContent;
    });
  }
}

// ============================================
// CARGA DE DATOS
// ============================================

/**
 * Carga estadísticas de la escuela para el Bottom Sheet
 */
// Recuento de vías por grado de cada escuela ya abierta: al volver a abrirla el donut sale al instante
const bsGradeCountCache = new Map();
let bsStatsSeq = 0;

async function loadBottomSheetStats(schoolId) {
  const schoolConfig = MAPLIBRE_SCHOOLS[schoolId];
  const seq = ++bsStatsSeq;

  // Referencias a elementos
  const donutSkeleton = document.getElementById('bs-donut-skeleton');
  const donutContainer = document.getElementById('bs-donut-chart');

  // Mostrar skeletons, ocultar gráficos
  const cached = bsGradeCountCache.get(schoolId);
  if (cached) {
    bsGradeData = cached;
    hideSkeletonsShowCharts();
    renderDonutChart(cached);
    if (kxSchoolSheet) kxSchoolSheet.refresh();
    return;
  }

  if (donutSkeleton) donutSkeleton.classList.remove('hidden');
  if (donutContainer) donutContainer.classList.add('hidden');

  if (!schoolConfig && mlApprovedSchoolsCache.has(schoolId)) {
    // Escuela de Firestore: solo cuenta sus vías aprobadas
    const counts = await getSpotterGradeCounts(schoolId).catch(() => ({}));
    if (seq !== bsStatsSeq) return;
    bsGradeData = counts;
    hideSkeletonsShowCharts();
    renderDonutChart(counts);
    if (kxSchoolSheet) kxSchoolSheet.refresh();
    return;
  }

  if (!schoolConfig) {
    console.warn('Escuela no configurada en MAPLIBRE_SCHOOLS:', schoolId);
    hideSkeletonsShowCharts();
    renderDonutChart({});
    if (kxSchoolSheet) kxSchoolSheet.refresh();   // la altura de resumen depende de la tarjeta del donut
    return;
  }

  try {
    // Usar la ruta del GeoJSON de vías desde la configuración
    const viasPath = schoolConfig.geojson?.vias;
    if (!viasPath) {
      throw new Error('No hay ruta de vías configurada');
    }

    // Cartografía y vías de spotters a la vez (antes iban una tras otra)
    const spotterTask = getSpotterGradeCounts(schoolId).catch(() => ({}));
    const response = await fetch(viasPath);
    if (seq !== bsStatsSeq) return;   // se abrió otra escuela mientras tanto

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const geojson = await response.json();

    if (!geojson.features || geojson.features.length === 0) {
      hideSkeletonsShowCharts();
        renderDonutChart({});
    if (kxSchoolSheet) kxSchoolSheet.refresh();   // la altura de resumen depende de la tarjeta del donut
      return;
    }

    // Contar vías por grado
    const gradeCount = {};
    let totalVias = 0;

    geojson.features.forEach(feature => {
      const grade = feature.properties?.grado1;
      if (grade) {
        const normalizedGrade = grade.toLowerCase().trim();
        gradeCount[normalizedGrade] = (gradeCount[normalizedGrade] || 0) + 1;
        totalVias++;
      }
    });

    // Sumar vías aprobadas de Spotters
    const spotterCounts = await spotterTask;
    if (seq !== bsStatsSeq) return;
    Object.entries(spotterCounts).forEach(([grade, count]) => {
      gradeCount[grade] = (gradeCount[grade] || 0) + count;
      totalVias += count;
    });

    // Guardar en cache
    bsGradeData = gradeCount;
    bsGradeCountCache.set(schoolId, gradeCount);

    // Ocultar skeletons, mostrar gráficos
    hideSkeletonsShowCharts();

    // Renderizar gráficos
    renderDonutChart(gradeCount);
    if (kxSchoolSheet) kxSchoolSheet.refresh();   // la altura de resumen depende de la tarjeta del donut

  } catch (error) {
    console.warn('Error cargando stats para Bottom Sheet:', error);
    hideSkeletonsShowCharts();
    renderDonutChart({});
    if (kxSchoolSheet) kxSchoolSheet.refresh();   // la altura de resumen depende de la tarjeta del donut
  }
}

/**
 * Oculta los skeletons y muestra los contenedores de gráficos
 */
function hideSkeletonsShowCharts() {
  const donutSkeleton = document.getElementById('bs-donut-skeleton');
  const donutContainer = document.getElementById('bs-donut-chart');

  if (donutSkeleton) donutSkeleton.classList.add('hidden');
  if (donutContainer) donutContainer.classList.remove('hidden');
}

/**
 * Variable global para almacenar datos del pronóstico semanal del Bottom Sheet
 */
let bsWeatherForecastData = null;
let bsWeatherNow = null;   // tiempo actual de la escuela abierta (tarjeta y cabecera de la previsión)

/**
 * Carga datos meteorológicos para el Bottom Sheet (actual + 7 días)
 */
async function loadBottomSheetWeather(school) {
  const tempEl = document.getElementById('bs-weather-temp');
  const precipEl = document.getElementById('bs-weather-precip');
  const rainEl = document.getElementById('bs-weather-rain');
  const windDirEl = document.getElementById('bs-weather-wind-dir');
  const windSpeedEl = document.getElementById('bs-weather-wind-speed');
  const iconEl = document.getElementById('bs-weather-icon');
  const forecastPanel = document.getElementById('bs-forecast-panel');
  const forecastScroll = document.getElementById('bs-forecast-scroll');

  if (!tempEl || !precipEl || !rainEl) return;

  // Mostrar loading state
  tempEl.textContent = '--°C';
  precipEl.textContent = '--%';
  rainEl.textContent = '-- mm';
  const descEl = document.getElementById('bs-weather-desc');
  if (descEl) descEl.textContent = '\u00a0';
  bsWeatherNow = null;
  if (windDirEl) windDirEl.textContent = '-';
  if (windSpeedEl) windSpeedEl.textContent = '--';

  // Resetear panel de pronóstico
  bsWeatherForecastData = null;
  if (forecastPanel) {
    forecastPanel.classList.add('hidden');
    forecastPanel.classList.remove('visible');
  }
  const nowEl = document.getElementById('bs-forecast-now');
  if (nowEl) nowEl.innerHTML = '';
  const weatherCard = document.getElementById('bs-weather-widget');
  if (weatherCard) {
    weatherCard.classList.remove('expanded');
  }
  if (forecastScroll) {
    forecastScroll.innerHTML = '<p class="bs-forecast-msg">Cargando pronóstico…</p>';
  }

  try {
    const lat = school.coords[1];
    const lng = school.coords[0];
    // Solicitar datos actuales + pronóstico de 7 días
    // Una sola petición para el tiempo, el pronóstico y las condiciones para escalar (humedad, rocío, sol y lluvia de las últimas 72 h)
    const apiUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,relative_humidity_2m,dew_point_2m,precipitation_probability,precipitation,wind_speed_10m,wind_direction_10m,weather_code,is_day,shortwave_radiation&hourly=precipitation&past_hours=72&forecast_hours=1&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,wind_speed_10m_max,wind_direction_10m_dominant&timezone=auto&forecast_days=7`;

    const response = await fetch(apiUrl);
    if (!response.ok) throw new Error('Weather API error');

    const data = await response.json();
    const current = data.current;

    if (current) {
      tempEl.textContent = `${Math.round(current.temperature_2m)}°C`;
      precipEl.textContent = `${current.precipitation_probability || 0}%`;
      rainEl.textContent = `${kxFmtMm(current.precipitation)} mm`;
      if (windDirEl) windDirEl.textContent = getWindDirection(current.wind_direction_10m || 0);
      if (windSpeedEl) windSpeedEl.textContent = `${Math.round(current.wind_speed_10m)}`;
      if (descEl) descEl.textContent = getWeatherDescription(current.weather_code);
      bsWeatherNow = {
        code: current.weather_code,
        temp: Math.round(current.temperature_2m),
        prob: current.precipitation_probability || 0,
        mm: current.precipitation,
        windDir: getWindDirection(current.wind_direction_10m || 0),
        wind: Math.round(current.wind_speed_10m)
      };
      renderBottomSheetForecastNow();

      // Actualizar icono según código del tiempo
      const weatherCode = current.weather_code;
      const iconPath = getWeatherIcon(weatherCode);
      if (iconEl && iconPath) {
        iconEl.src = iconPath;
        iconEl.onerror = () => {
          iconEl.src = 'icons/weather/partly-cloudy.png';
        };
      }
    }

    // Guardar datos del pronóstico y renderizar
    if (data.daily) {
      bsWeatherForecastData = data.daily;
      renderBottomSheetForecast(data.daily);
    }

    // Condiciones para escalar (segunda página), con los mismos datos
    if (bsCurrentSchool === school) kxRenderSchoolConditions(school, typeof kxcWeatherFromOpenMeteo === 'function' ? kxcWeatherFromOpenMeteo(data) : null, { loaded: true });
  } catch (error) {
    console.warn('Error cargando clima para Bottom Sheet:', error);
    if (bsCurrentSchool === school) kxRenderSchoolConditions(school, null, { error: true });
    if (forecastScroll) {
      forecastScroll.innerHTML = '<p class="bs-forecast-msg">No se pudo cargar el pronóstico</p>';
    }
  }
}

/**
 * Renderiza el pronóstico semanal en el panel del Bottom Sheet
 */
function renderBottomSheetForecast(dailyData) {
  const forecastScroll = document.getElementById('bs-forecast-scroll');
  if (!forecastScroll || !dailyData) return;

  let html = '';
  const days = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  const months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

  for (let i = 0; i < Math.min(7, dailyData.time.length); i++) {
    const dateObj = new Date(dailyData.time[i] + 'T00:00:00');
    const dayName = days[dateObj.getDay()];
    const dateStr = `${dateObj.getDate()} ${months[dateObj.getMonth()]}`;
    const maxTemp = Math.round(dailyData.temperature_2m_max[i]);
    const minTemp = Math.round(dailyData.temperature_2m_min[i]);
    const precipProb = dailyData.precipitation_probability_max[i] || 0;
    const precipSum = kxFmtMm(dailyData.precipitation_sum[i]);
    const windSpeed = Math.round(dailyData.wind_speed_10m_max[i]);
    const windDir = getWindDirection(dailyData.wind_direction_10m_dominant[i]);
    const weatherCode = dailyData.weather_code[i];
    const isToday = i === 0;

    html += `
      <div class="bs-forecast-day${isToday ? ' is-today' : ''}"${isToday ? ' aria-current="date"' : ''}>
        <div class="bs-forecast-day-info">
          <div class="bs-forecast-day-name">${isToday ? 'Hoy' : dayName}</div>
          <div class="bs-forecast-day-date">${dateStr}</div>
        </div>
        <div class="bs-forecast-icon-wrap">
          <img src="${getWeatherIcon(weatherCode)}" alt="${getWeatherDescription(weatherCode)}" onerror="this.onerror=null;this.src='icons/weather/partly-cloudy.png'">
        </div>
        <div class="bs-forecast-temps">
          <span class="bs-forecast-temp-max">${maxTemp}°</span>
          <span class="bs-forecast-temp-min">${minTemp}°</span>
        </div>
        <div class="bs-forecast-details">
          <span class="bs-forecast-precip">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/></svg>
            ${precipProb}% · ${precipSum} mm
          </span>
          <span class="bs-forecast-wind">${windDir} ${windSpeed} km/h</span>
        </div>
      </div>
    `;
  }

  forecastScroll.innerHTML = html;
}

// Cabecera de la previsión: el tiempo de ahora, igual que en la tarjeta
function renderBottomSheetForecastNow() {
  const el = document.getElementById('bs-forecast-now');
  const n = bsWeatherNow;
  if (!el || !n) return;
  el.innerHTML = `
    <img class="bs-weather-icon" src="${getWeatherIcon(n.code)}" alt="" onerror="this.onerror=null;this.src='icons/weather/partly-cloudy.png'">
    <span class="bs-weather-sep" aria-hidden="true"></span>
    <div class="bs-weather-temp-wrap"><span class="bs-weather-temp">${n.temp}°C</span><span class="bs-weather-desc">${getWeatherDescription(n.code)}</span></div>
    <span class="bs-weather-sep" aria-hidden="true"></span>
    <div class="bs-weather-right">
      <div class="bs-weather-stat"><svg width="16" height="16" viewBox="0 0 24 24" fill="#3b82f6" aria-hidden="true"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/></svg><span>${n.prob}% · ${kxFmtMm(n.mm)} mm</span></div>
      <div class="bs-weather-stat"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#6b7280" stroke-width="2" aria-hidden="true"><path d="M9.59 4.59A2 2 0 1 1 11 8H2m10.59 11.41A2 2 0 1 0 14 16H2m15.73-8.27A2.5 2.5 0 1 1 19.5 12H2"/></svg><span>${n.windDir} ${n.wind} km/h</span></div>
    </div>`;
}

// Milímetros con coma y como mucho un decimal («0,6», «8»)
function kxFmtMm(v) {
  return (Math.round((Number(v) || 0) * 10) / 10).toLocaleString('es-ES', { maximumFractionDigits: 1 });
}

function getWeatherDescription(code) {
  if (code === 0) return 'Despejado';
  if (code === 1) return 'Mayormente despejado';
  if (code === 2) return 'Parcialmente nuboso';
  if (code === 3) return 'Nublado';
  if (code >= 45 && code <= 48) return 'Niebla';
  if (code >= 51 && code <= 57) return 'Llovizna';
  if (code >= 61 && code <= 67) return 'Lluvia';
  if (code >= 71 && code <= 77) return 'Nieve';
  if (code >= 80 && code <= 82) return 'Chubascos';
  if (code >= 85 && code <= 86) return 'Chubascos de nieve';
  if (code >= 95 && code <= 99) return 'Tormenta';
  return 'Parcialmente nuboso';
}

/**
 * Toggle del panel de pronóstico semanal en el Bottom Sheet
 */
function toggleBottomSheetForecast() {
  const forecastPanel = document.getElementById('bs-forecast-panel');
  const weatherCard = document.getElementById('bs-weather-widget');

  if (!forecastPanel || !weatherCard) return;

  if (forecastPanel.classList.contains('hidden')) {
    forecastPanel.classList.remove('hidden');
    document.body.classList.add('kx-forecast-open');   // la ficha de detrás no se desplaza
    weatherCard.classList.add('expanded');
    // Pequeño delay para la animación
    requestAnimationFrame(() => forecastPanel.classList.add('visible'));
    const close = document.getElementById('bs-forecast-close');
    if (close) setTimeout(() => close.focus({ preventScroll: true }), 60);
  } else {
    forecastPanel.classList.remove('visible');
    document.body.classList.remove('kx-forecast-open');
    weatherCard.classList.remove('expanded');
    // Esperar animación antes de ocultar
    setTimeout(() => {
      if (!forecastPanel.classList.contains('visible')) forecastPanel.classList.add('hidden');
    }, 300);
    weatherCard.focus({ preventScroll: true });
  }
}

/**
 * Inicializa los eventos del panel de pronóstico
 */
function initBottomSheetForecastEvents() {
  const weatherCard = document.getElementById('bs-weather-widget');
  const forecastClose = document.getElementById('bs-forecast-close');
  const panel = document.getElementById('bs-forecast-panel');

  // La previsión es una ventana sobre toda la pantalla: fuera de la hoja (que se desplaza) para no recortarse
  if (panel && panel.parentElement !== document.body) document.body.appendChild(panel);

  if (weatherCard) {
    const open = () => { if (bsWeatherForecastData) toggleBottomSheetForecast(); };
    weatherCard.addEventListener('click', open);
    weatherCard.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
    });
  }

  if (forecastClose) {
    forecastClose.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleBottomSheetForecast();
    });
  }
  if (panel) {
    // Tocar fuera de la tarjeta o pulsar Escape cierra
    panel.addEventListener('click', (e) => { if (e.target === panel) toggleBottomSheetForecast(); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !panel.classList.contains('hidden')) { e.stopPropagation(); toggleBottomSheetForecast(); }
    }, true);
  }
}

// Inicializar eventos cuando el DOM esté listo
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initBottomSheetForecastEvents);
} else {
  initBottomSheetForecastEvents();
}

/**
 * Obtiene el nombre del icono según el código WMO
 */
function getWeatherIconName(code) {
  if (code === 0) return 'clear-day';
  if (code >= 1 && code <= 3) return 'partly-cloudy';
  if (code >= 45 && code <= 48) return 'fog';
  if (code >= 51 && code <= 57) return 'drizzle';
  if (code >= 61 && code <= 67) return 'rain';
  if (code >= 71 && code <= 77) return 'snow';
  if (code >= 80 && code <= 82) return 'rain';
  if (code >= 85 && code <= 86) return 'snow';
  if (code >= 95 && code <= 99) return 'thunderstorm';
  return 'partly-cloudy';
}

// ============================================
// INTEGRACIÓN CON MAPA
// ============================================

/**
 * Modifica setupSchoolLayerInteraction para usar Bottom Sheet en móvil
 */
const originalSetupSchoolLayerInteraction = setupSchoolLayerInteraction;

setupSchoolLayerInteraction = function () {
  // Cursor pointer al hover
  mlMap.on('mouseenter', 'school-markers-layer', () => {
    mlMap.getCanvas().style.cursor = 'pointer';
  });

  mlMap.on('mouseleave', 'school-markers-layer', () => {
    mlMap.getCanvas().style.cursor = '';
  });

  // Click en marker de escuela
  mlMap.on('click', 'school-markers-layer', (e) => {
    if (mlMap.getCanvas().style.cursor === 'crosshair') return;
    if (!e.features || e.features.length === 0) return;

    const feature = e.features[0];
    const props = feature.properties;

    // Reconstruir objeto school desde properties
    const school = {
      id: props.id,
      nombre: props.nombre,
      coords: JSON.parse(props.coords),
      zoom: props.zoom,
      isOpen: props.isOpen,
      rockType: props.rockType
    };

    // En móvil, usar Bottom Sheet
    if (isMobileDevice()) {
      // Cerrar popup existente si hay
      if (mlSchoolPopup) mlSchoolPopup.remove();

      // Desplazamiento adaptativo: solo mover si la escuela queda tapada por el bottom sheet
      adaptiveMapPanForBottomSheet(school.coords);

      showBottomSheet(school);
    } else {
      // En desktop, usar popup tradicional
      mlMap.flyTo({
        center: school.coords,
        zoom: mlMap.getZoom(),
        speed: 0.8,
        curve: 1,
        padding: { top: 450, bottom: 0, left: 0, right: 0 }
      });

      showSchoolPopup(school, null);
    }
    kxSelectSchool(feature.id != null ? feature.id : props.id);
  });
};

// Inicializar Bottom Sheets cuando el DOM esté listo
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    initBottomSheet();
    initSectorBottomSheet();
    initRouteBottomSheet();
  });
} else {
  initBottomSheet();
  initSectorBottomSheet();
  initRouteBottomSheet();
}

// Exponer funciones del Bottom Sheet
window.showBottomSheet = showBottomSheet;
window.hideBottomSheet = hideBottomSheet;
window.expandBottomSheet = expandBottomSheet;
window.collapseBottomSheet = collapseBottomSheet;

// Exponer funciones del Sector Bottom Sheet
window.showSectorBottomSheet = showSectorBottomSheet;
window.hideSectorBottomSheet = hideSectorBottomSheet;

// Exponer funciones del Route Bottom Sheet
window.showRouteBottomSheet = showRouteBottomSheet;
window.hideRouteBottomSheet = hideRouteBottomSheet;

// ============================================
// FUNCIONES AUXILIARES PARA ROUTE DRAWING
// ============================================

/**
 * Verifica si el usuario es admin (para popup de vía)
 */
async function isRoutePopupAdmin() {
  try {
    const user = auth.currentUser;
    if (!user) return false;

    const adminDoc = await db.collection('admins').doc(user.uid).get();
    return adminDoc.exists && (adminDoc.data().role === 'admin' || adminDoc.data().role === 'spotter');
  } catch (error) {
    console.error('[RoutePopup] Error verificando admin:', error);
    return false;
  }
}

/**
 * Abre el editor de dibujo desde el popup de vía
 */
function mlOpenDrawingEditor(routeId) {
  // Cerrar popup
  if (mlRoutePopup) mlRoutePopup.remove();

  // Llamar a función de route-drawing.js
  if (typeof openDrawingEditorForRoute === 'function') {
    openDrawingEditorForRoute(routeId);
  } else {
    console.error('[RoutePopup] openDrawingEditorForRoute no está disponible');
  }
}

// Exponer función
window.mlOpenDrawingEditor = mlOpenDrawingEditor;

// ============================================
// CARGA DE VÍAS APROBADAS DESDE FIRESTORE
// ============================================

/**
 * Carga las vías aprobadas desde Firestore y las añade al mapa
 * @param {string} schoolId - ID de la escuela
 * @param {number} minZoom - Nivel de zoom mínimo para mostrar las vías (mismo que vías oficiales)
 */
async function loadApprovedRoutesFromFirestore(schoolId, minZoom = 14) {
  if (typeof firebase === 'undefined' || !firebase.firestore) {
    console.log('[ApprovedRoutes] Firebase no disponible');
    return;
  }

  // Cancelar listener previo si existiera
  if (mlApprovedRoutesUnsub) { try { mlApprovedRoutesUnsub(); } catch (e) {} mlApprovedRoutesUnsub = null; }

  const db = firebase.firestore();
  const sourceId = 'vias-usuarios-source';
  const layerId = 'vias-usuarios-layer';

  return new Promise((resolve) => {
    let firstFire = true;
    const settle = () => { if (firstFire) { firstFire = false; resolve(); } };

    mlApprovedRoutesUnsub = db.collection('pending_routes')
      .where('schoolId', '==', schoolId)
      .where('status', '==', 'approved')
      .onSnapshot((snapshot) => {
        try {
          // Si el usuario cambió de escuela mientras escuchábamos, cancelar
          if (!mlMap || mlCurrentSchool !== schoolId) {
            if (mlApprovedRoutesUnsub) { try { mlApprovedRoutesUnsub(); } catch (e) {} mlApprovedRoutesUnsub = null; }
            settle();
            return;
          }

          const features = [];
          snapshot.forEach(doc => {
            const data = doc.data();
            let coordinates = null;
            if (data.coordinates && Array.isArray(data.coordinates)) {
              coordinates = data.coordinates;
            } else if (data.geojsonFeature?.geometry) {
              const geom = data.geojsonFeature.geometry;
              if (geom.coordinates) {
                coordinates = geom.coordinates;
              } else if (geom.lng !== undefined && geom.lat !== undefined) {
                coordinates = [geom.lng, geom.lat];
              }
            }
            if (!coordinates) {
              console.warn(`[ApprovedRoutes] Ruta sin coordenadas: ${doc.id}`);
              return;
            }
            features.push({
              type: 'Feature',
              properties: {
                fid: `user_${doc.id}`,
                id: kxCommunityRouteId(doc.id),
                docId: doc.id,
                nombre: data.nombre || data.geojsonFeature?.properties?.nombre || 'Sin nombre',
                grado1: data.grado1 || data.geojsonFeature?.properties?.grado1 || '?',
                sector: data.sector || data.geojsonFeature?.properties?.sector || '',
                exp1: data.exp1 || data.geojsonFeature?.properties?.exp1 || '',
                long1: data.long1 || data.geojsonFeature?.properties?.long1 || '',
                descripcion: data.descripcion || data.geojsonFeature?.properties?.descripcion || '',
                modalidad: data.modalidad || data.geojsonFeature?.properties?.modalidad || 'Simple',
                variante: data.variante || data.geojsonFeature?.properties?.variante || 'NO',
                isUserRoute: true,
                approvedBy: data.approvedBy || '',
                createdByEmail: data.createdByEmail || '',
                lng: coordinates[0],
                lat: coordinates[1]
              },
              geometry: { type: 'Point', coordinates }
            });
          });

          const geojson = { type: 'FeatureCollection', features };
          console.log(`[ApprovedRoutes] Realtime: ${features.length} vías para ${schoolId}`);

          // Si el source ya existe, actualizar datos; si no, crear source + layer
          if (mlMap.getSource(sourceId)) {
            mlMap.getSource(sourceId).setData(geojson);
          } else {
            mlMap.addSource(sourceId, { type: 'geojson', data: geojson });
            mlMap.addLayer({
              id: layerId,
              type: 'circle',
              source: sourceId,
              minzoom: minZoom,
              // Aporte de la comunidad: mismo círculo, con el borde dorado que lo identifica
              paint: kxRoutePaint('#FFD700')
            });
            if (!mlUserViasInteractionAttached) {
              setupUserViasInteraction();
              mlUserViasInteractionAttached = true;
            }
            if (mlGradeFocus || !isFullGradeRange()) applyGradeFilter();
          }
        } catch (err) {
          console.error('[ApprovedRoutes] Error procesando snapshot:', err);
        }
        settle();
      }, (err) => {
        console.error('[ApprovedRoutes] Error onSnapshot:', err);
        settle();
      });
  });
}

/**
 * Id numérico estable para una vía de la comunidad (votos, incidencias, ascensos y proyectos
 * se indexan por id). Rango 1e9+ para no chocar con los ids de las vías oficiales.
 */
function kxCommunityRouteId(docId) {
  let h = 0;
  for (let i = 0; i < docId.length; i++) h = (Math.imul(h, 31) + docId.charCodeAt(i)) | 0;
  return 1000000000 + (Math.abs(h) % 1000000000);
}

/**
 * Configura la interactividad para las vías de usuarios
 */
function setupUserViasInteraction() {
  const layerId = 'vias-usuarios-layer';

  // Cursor pointer al hover
  mlMap.on('mouseenter', layerId, () => {
    mlMap.getCanvas().style.cursor = 'pointer';
  });

  mlMap.on('mouseleave', layerId, () => {
    mlMap.getCanvas().style.cursor = '';
  });

  // Click en vía de usuario
  mlMap.on('click', layerId, (e) => {
    if (mlMap.getCanvas().style.cursor === 'crosshair') return;
    if (!e.features || e.features.length === 0) return;

    const feature = e.features[0];
    const props = feature.properties;
    const coords = feature.geometry.coordinates;

    // Misma ficha que las vías oficiales (bottom sheet en móvil, popup en escritorio)
    if (isMobileDevice()) {
      adaptiveMapPanForBottomSheet(coords);
      showRouteBottomSheet(props, coords);
    } else {
      mlMap.flyTo({
        center: coords,
        zoom: mlMap.getZoom(),
        speed: 0.8,
        curve: 1,
        padding: { top: 450, bottom: 0, left: 0, right: 0 }
      });
      showRoutePopup(props, coords);
    }
  });
}

// ============================================
// LO APORTADO POR LA COMUNIDAD: AUTORÍA Y HERRAMIENTAS DE ADMIN
// ============================================
// Escuelas, sectores y vías creados desde el editor Spotter comparten pie: quién lo propuso y, solo para
// admins, editar la información, moverlo (o ajustar la línea) y eliminarlo.
const KX_ADMIN_COLLECTIONS = { school: 'pending_schools', sector: 'pending_sectors', route: 'pending_routes' };
const kxAdminItems = new Map();   // docId → { kind, coords }

async function kxIsAdminUser() {
  try {
    if ((await checkAdminRole()) === 'admin') return true;
    const u = typeof auth !== 'undefined' ? auth.currentUser : null;
    return !!u && u.email === 'krux.app.info@gmail.com';
  } catch (e) {
    return false;
  }
}

const KX_ADMIN_ICONS = {
  edit: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9a2.1 2.1 0 0 0-4-4L4 16z"/><path d="m13.5 6.5 4 4"/></svg>',
  move: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2.5v19M2.5 12h19"/><path d="m9 5.5 3-3 3 3M9 18.5l3 3 3-3M5.5 9l-3 3 3 3M18.5 9l3 3-3 3"/></svg>',
  trash: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 6.5h17M9.5 6.5V4h5v2.5M6 6.5l1 14h10l1-14"/></svg>'
};

function kxCommunityFooterHTML({ kind, docId, coords, author, isAdmin }) {
  if (!docId) return '';
  kxAdminItems.set(docId, { kind, coords });
  const id = kxEscHTML(docId);
  const who = author ? ` por <strong>${kxEscHTML(author)}</strong>` : ' por la comunidad';
  const tools = isAdmin ? `
    <div class="kx-rcommunity-admin">
      <button type="button" class="kx-radmin is-wide" onclick="kxAdminEdit('${id}')">${KX_ADMIN_ICONS.edit} Editar información</button>
      <button type="button" class="kx-radmin" onclick="kxAdminMove('${id}')">${KX_ADMIN_ICONS.move} ${kind === 'sector' ? 'Ajustar línea' : 'Mover'}</button>
      <button type="button" class="kx-radmin is-danger" onclick="kxAdminDelete('${id}')">${KX_ADMIN_ICONS.trash} Eliminar</button>
    </div>` : '';
  return `
    <div class="kx-rcommunity">
      <p class="kx-rcommunity-by">Propuesta${who}</p>
      ${tools}
    </div>`;
}

// Pie de la ficha de una vía de la comunidad
function kxUserRouteFooterHTML(props, isAdmin) {
  if (!props || !props.docId) return '';
  return kxCommunityFooterHTML({ kind: 'route', docId: props.docId, coords: [Number(props.lng), Number(props.lat)], author: props.createdByEmail, isAdmin });
}

// Cierra cualquier ficha o popup abiertos antes de abrir una herramienta
function kxAdminClose() {
  hideBottomSheet();
  hideSectorBottomSheet();
  hideRouteBottomSheet();
  document.querySelectorAll('.maplibregl-popup').forEach(pp => pp.remove());
}

function kxAdminEdit(docId) {
  const it = kxAdminItems.get(docId);
  if (!it) return;
  kxAdminClose();
  if (typeof window.devEditItem === 'function') window.devEditItem(it.kind, docId);
  else if (typeof showToast === 'function') showToast('El editor no está disponible', 'error');
}

function kxAdminMove(docId) {
  const it = kxAdminItems.get(docId);
  if (!it) return;
  kxAdminClose();
  mlStartEditPending(KX_ADMIN_COLLECTIONS[it.kind], docId, it.kind === 'sector' ? 'LineString' : 'Point', it.coords);
}

// Sectores, vías y puntos de una escuela (para eliminarlos con ella: sin escuela no se pueden ver)
async function kxSchoolChildRefs(schoolId) {
  const db = firebase.firestore();
  const lists = await Promise.all(['pending_sectors', 'pending_routes', 'pending_poi']
    .map(c => db.collection(c).where('schoolId', '==', schoolId).get()));
  return lists.flatMap(snap => snap.docs.map(d => d.ref));
}

async function kxAdminDelete(docId) {
  const it = kxAdminItems.get(docId);
  if (!it) return;
  const db = firebase.firestore();
  try {
    let refs = [];
    let msg;
    if (it.kind === 'school') {
      refs = await kxSchoolChildRefs(docId);
      msg = refs.length
        ? `¿Eliminar la escuela y sus ${refs.length} sectores, vías y puntos de interés? No se puede deshacer.`
        : '¿Eliminar esta escuela? No se puede deshacer.';
    } else if (it.kind === 'sector') {
      msg = '¿Eliminar este sector? Sus vías no se borran. No se puede deshacer.';
    } else {
      msg = '¿Eliminar esta vía del mapa? No se puede deshacer.';
    }
    if (!confirm(msg)) return;
    kxAdminClose();

    refs.push(db.collection(KX_ADMIN_COLLECTIONS[it.kind]).doc(docId));
    // Lotes de 400: el límite de Firestore es 500 operaciones por lote
    for (let i = 0; i < refs.length; i += 400) {
      const batch = db.batch();
      refs.slice(i, i + 400).forEach(r => batch.delete(r));
      await batch.commit();
    }
    kxAdminItems.delete(docId);
    if (it.kind === 'school' && mlCurrentSchool === docId) {
      mlClearSchoolLayers();
      mlCurrentSchool = null;
    }
    if (typeof showToast === 'function') showToast(it.kind === 'school' ? 'Escuela eliminada' : it.kind === 'sector' ? 'Sector eliminado' : 'Vía eliminada', 'success');
  } catch (err) {
    console.error('[Admin] Error eliminando:', err);
    if (typeof showToast === 'function') showToast('No se pudo eliminar: ' + err.message, 'error');
  }
}

// ============================================
// CARGA DE POI, SECTORES Y ESCUELAS APROBADOS DESDE FIRESTORE
// ============================================

/**
 * Carga POIs aprobados desde pending_poi en Firestore y los muestra en el mapa
 * como emojis (misma lógica que mlLoadPuntosInteres pero desde Firestore).
 */
function setupUserPOIInteraction(layerId) {
  mlMap.on('mouseenter', layerId, () => {
    mlMap.getCanvas().style.cursor = 'pointer';
  });
  mlMap.on('mouseleave', layerId, () => {
    mlMap.getCanvas().style.cursor = '';
  });
  mlMap.on('click', layerId, async (e) => {
    if (mlMap.getCanvas().style.cursor === 'crosshair') return;
    if (!e.features || e.features.length === 0) return;
    const props = e.features[0].properties;
    const coords = e.features[0].geometry.coordinates.slice();
    const emoji = props._emoji || '📍';
    const desc = props._poiType || 'Punto de interés';
    const nombre = props.nombre || '';
    const link = props.link || '';

    const adminRole = await checkAdminRole();
    const adminHTML = adminRole === 'admin' && props.docId ? `
      <div style="display:flex;gap:8px;flex-wrap:wrap;padding:8px 0 0;">
        <button onclick="mlDeletePendingItem('pending_poi','${props.docId}');document.querySelectorAll('.maplibregl-popup').forEach(p=>p.remove());"
          style="flex:1;background:#DC2626;color:white;border:none;border-radius:8px;padding:8px 10px;cursor:pointer;font-size:12px;font-weight:600;">
          🗑️ Eliminar
        </button>
        <button onclick="mlStartEditPending('pending_poi','${props.docId}','Point',[${props.lng},${props.lat}]);document.querySelectorAll('.maplibregl-popup').forEach(p=>p.remove());"
          style="flex:1;background:#2563EB;color:white;border:none;border-radius:8px;padding:8px 10px;cursor:pointer;font-size:12px;font-weight:600;">
          ✏️ Mover
        </button>
      </div>` : '';

    const descCapitalized = desc.charAt(0).toUpperCase() + desc.slice(1);
    const poiLat = coords[1];
    const poiLng = coords[0];
    const poiGmapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${poiLat},${poiLng}`;
    const poiBtnId = `poi-user-dir-${Date.now()}`;

    const popupHTML = `
      <div class="poi-popup-content">
        <div class="poi-popup-icon">${emoji}</div>
        <div class="poi-popup-info">
          <div class="poi-popup-type">${descCapitalized}</div>
          ${nombre ? `<div class="poi-popup-name">${nombre}</div>` : ''}
          ${link ? `<div class="poi-popup-name"><a href="${link}" target="_blank" style="color:#4285f4;">Ver enlace</a></div>` : ''}
        </div>
      </div>
      <button class="poi-popup-directions-btn" id="${poiBtnId}">🧭 ¿Cómo llegar?</button>
      ${adminHTML}
    `;

    const userPoiPopup = new maplibregl.Popup({ offset: 18, closeButton: false, className: 'poi-popup' })
      .setLngLat(coords)
      .setHTML(popupHTML)
      .addTo(mlMap);

    setTimeout(() => {
      const btnDir = document.getElementById(poiBtnId);
      if (btnDir) btnDir.onclick = () => window.open(poiGmapsUrl, '_blank');
    }, 50);
  });
}

async function loadApprovedPOIFromFirestore(schoolId) {
  if (typeof firebase === 'undefined' || !firebase.firestore) {
    console.warn('[ApprovedPOI] Firebase no disponible');
    return;
  }

  if (mlApprovedPOIUnsub) { try { mlApprovedPOIUnsub(); } catch (e) {} mlApprovedPOIUnsub = null; }

  const db = firebase.firestore();
  const sourceId = 'poi-usuarios-source';
  const layerId = 'poi-usuarios-layer';

  console.log(`%c[ApprovedPOI] Suscribiendo realtime para schoolId=${schoolId}...`, 'color: #4CAF50; font-weight: bold');

  return new Promise((resolve) => {
    let firstFire = true;
    const settle = () => { if (firstFire) { firstFire = false; resolve(); } };

    mlApprovedPOIUnsub = db.collection('pending_poi')
      .where('status', '==', 'approved')
      .onSnapshot(async (snapshot) => {
        try {
          if (!mlMap || mlCurrentSchool !== schoolId) {
            if (mlApprovedPOIUnsub) { try { mlApprovedPOIUnsub(); } catch (e) {} mlApprovedPOIUnsub = null; }
            settle();
            return;
          }

          const features = [];
          let skippedCoords = 0;
          let skippedSchool = 0;
          snapshot.forEach(doc => {
            const data = doc.data();
            if (!data.coordinates || !Array.isArray(data.coordinates)) {
              skippedCoords++;
              return;
            }
            if (data.schoolId && data.schoolId !== schoolId) {
              skippedSchool++;
              return;
            }

            const desc = data.descripcio || '';

            features.push({
              type: 'Feature',
              properties: {
                docId: doc.id,
                descripcio: desc,
                nombre: data.nombre || '',
                link: data.link || '',
                _poiType: desc,
                _svgIcon: 'poi-svg-' + desc.toLowerCase().trim(),
                isUserPOI: true,
                createdByEmail: data.createdByEmail || '',
                lng: data.coordinates[0],
                lat: data.coordinates[1]
              },
              geometry: { type: 'Point', coordinates: data.coordinates }
            });
          });

          console.log(`%c[ApprovedPOI] Realtime: ${features.length} POI para ${schoolId} (skippedCoords=${skippedCoords}, skippedSchool=${skippedSchool})`, 'color: #4CAF50; font-weight: bold');

          // Registrar iconos SVG necesarios en background (no bloquear el render)
          const usedTypes = new Set(features.map(f => f.properties._poiType.toLowerCase().trim()));
          const typesToLoad = [...usedTypes].filter(t => !mlMap.hasImage('poi-svg-' + t));
          if (!mlMap.hasImage('poi-svg-default')) typesToLoad.push('');
          Promise.all(typesToLoad.map(async poiType => {
            try {
              const img = await createSVGPinImage(poiType);
              const imgId = poiType === '' ? 'poi-svg-default' : 'poi-svg-' + poiType;
              if (!mlMap.hasImage(imgId)) mlMap.addImage(imgId, img, { sdf: false, pixelRatio: _mlDPR });
            } catch (e) {
              console.warn('[ApprovedPOI] Error creando icono para', poiType, e);
            }
          })).then(() => { if (typesToLoad.length) kxReloadSourceData(sourceId); });

          const geojson = { type: 'FeatureCollection', features };

          if (mlMap.getSource(sourceId)) {
            mlMap.getSource(sourceId).setData(geojson);
            kxApplyPoiZoom(layerId, schoolId, 13, 0.7);
          } else {
            mlMap.addSource(sourceId, { type: 'geojson', data: geojson });
            mlMap.addLayer({
              id: layerId,
              type: 'symbol',
              source: sourceId,
              minzoom: kxPoiMinZoom(schoolId, 13),
              layout: {
                'icon-image': ['coalesce', ['image', ['get', '_svgIcon']], ['image', 'poi-svg-default']],
                'icon-size': kxPoiIconSize(kxPoiMinZoom(schoolId, 13), 0.7),
                'icon-allow-overlap': true,
                'icon-ignore-placement': true,
                'icon-anchor': 'center'
              }
            });
            if (!mlUserPOIInteractionAttached) {
              setupUserPOIInteraction(layerId);
              mlUserPOIInteractionAttached = true;
            }
          }
        } catch (err) {
          console.error('[ApprovedPOI] Error procesando snapshot:', err);
        }
        settle();
      }, (err) => {
        console.error('[ApprovedPOI] Error onSnapshot:', err);
        settle();
      });
  });
}

/**
 * Carga sectores aprobados desde pending_sectors en Firestore y los dibuja en el mapa
 * como líneas (misma lógica que los sectores estáticos de GeoJSON).
 */
function setupUserSectorsInteraction(hitLayerId) {
  kxBindSectorEvents(hitLayerId);
}

async function mlOpenUserSector(props, coords) {
    let line = [];
    try { line = JSON.parse(props.verticesCoordsStr || '[]'); } catch (e) { /* sin línea que ajustar */ }
    const adminHTML = props.docId
      ? kxCommunityFooterHTML({ kind: 'sector', docId: props.docId, coords: line, author: props.createdByEmail, isAdmin: await kxIsAdminUser() })
      : '';

    if (isMobileDevice()) {
      adaptiveMapPanForBottomSheet(coords);
      showSectorBottomSheet(props, [coords.lng, coords.lat], adminHTML);
    } else {
      mlMap.flyTo({ center: coords, zoom: mlMap.getZoom(), speed: 0.8, curve: 1, padding: { top: 450, bottom: 0, left: 0, right: 0 } });
      showSectorPopup(props, [coords.lng, coords.lat], adminHTML);
    }
}

async function loadApprovedSectorsFromFirestore(schoolId) {
  if (typeof firebase === 'undefined' || !firebase.firestore) {
    console.warn('[ApprovedSectors] Firebase no disponible');
    return;
  }

  if (mlApprovedSectorsUnsub) { try { mlApprovedSectorsUnsub(); } catch (e) {} mlApprovedSectorsUnsub = null; }

  const db = firebase.firestore();
  const sourceId = 'sectores-usuarios-source';
  const casingLayerId = 'sectores-usuarios-casing-layer';
  const lineLayerId = 'sectores-usuarios-layer';

  console.log(`%c[ApprovedSectors] Suscribiendo realtime para schoolId=${schoolId}...`, 'color: #2196F3; font-weight: bold');

  return new Promise((resolve) => {
    let firstFire = true;
    const settle = () => { if (firstFire) { firstFire = false; resolve(); } };

    mlApprovedSectorsUnsub = db.collection('pending_sectors')
      .where('status', '==', 'approved')
      .onSnapshot((snapshot) => {
        try {
          if (!mlMap || mlCurrentSchool !== schoolId) {
            if (mlApprovedSectorsUnsub) { try { mlApprovedSectorsUnsub(); } catch (e) {} mlApprovedSectorsUnsub = null; }
            settle();
            return;
          }

          const features = [];
          let skippedVertices = 0;
          let skippedSchool = 0;
          snapshot.forEach(doc => {
            const data = doc.data();
            if (data.schoolId && data.schoolId !== schoolId) {
              skippedSchool++;
              return;
            }
            if (!data.vertices || !Array.isArray(data.vertices) || data.vertices.length < 2) {
              skippedVertices++;
              return;
            }

            const coords = data.vertices.map(v => [v.lng, v.lat]);
            const name = data.nombre || `sector-${doc.id}`;
            let hash = 0;
            for (let j = 0; j < name.length; j++) {
              hash = ((hash << 5) - hash) + name.charCodeAt(j);
              hash |= 0;
            }

            features.push({
              type: 'Feature',
              properties: {
                fid: Math.abs(hash),
                docId: doc.id,
                nombre: data.nombre || 'Sin nombre',
                restr: data.restr || 'NO',
                exposicion: data.exposicion || '',
                Fecha_inicio: data.Fecha_inicio || '',
                Fecha_fin: data.Fecha_fin || '',
                isUserSector: true,
                createdByEmail: data.createdByEmail || '',
                verticesCoordsStr: '[' + coords.map(c => `[${c[0]},${c[1]}]`).join(',') + ']'
              },
              geometry: { type: 'LineString', coordinates: coords }
            });
          });

          console.log(`%c[ApprovedSectors] Realtime: ${features.length} sectores para ${schoolId} (skippedVertices=${skippedVertices}, skippedSchool=${skippedSchool})`, 'color: #2196F3; font-weight: bold');

          kxAssignSectorColors(features);
          const geojson = { type: 'FeatureCollection', features };

          if (mlMap.getSource(sourceId)) {
            mlMap.getSource(sourceId).setData(geojson);
          } else {
            mlMap.addSource(sourceId, { type: 'geojson', data: geojson, generateId: true });

            const school = MAPLIBRE_SCHOOLS[schoolId];
            const sectorMinZoom = school?.zoomLevels?.sectores || 12;

            mlMap.addLayer({
              id: casingLayerId,
              type: 'line',
              source: sourceId,
              minzoom: sectorMinZoom,
              layout: { 'line-cap': 'round', 'line-join': 'round' },
              paint: kxSectorCasingPaint()
            });

            mlMap.addLayer({
              id: lineLayerId,
              type: 'line',
              source: sourceId,
              minzoom: sectorMinZoom,
              layout: { 'line-cap': 'round', 'line-join': 'round' },
              paint: kxSectorLinePaint()
            });
            kxAddSectorHitLayer(sourceId, 'sectores-usuarios-hit-layer', sectorMinZoom);

            if (!mlUserSectorsInteractionAttached) {
              setupUserSectorsInteraction('sectores-usuarios-hit-layer');
              mlUserSectorsInteractionAttached = true;
            }
          }
          kxRefreshSectorLabels(sourceId);
        } catch (err) {
          console.error('[ApprovedSectors] Error procesando snapshot:', err);
        }
        settle();
      }, (err) => {
        console.error('[ApprovedSectors] Error onSnapshot:', err);
        settle();
      });
  });
}

/**
 * Carga escuelas aprobadas desde pending_schools en Firestore y las añade
 * como marcadores en el mapa con el mismo icono verde y popup/bottom-sheet
 * que las escuelas estáticas.
 */
// ============================================
// ÍTEMS PENDIENTES DEL SPOTTER (solo el autor los ve)
// ============================================

/**
 * Carga las vías pendientes del usuario en el mapa con estilo diferenciado.
 */
async function loadMyPendingRoutesFromFirestore(schoolId, minZoom = 14) {
  if (typeof firebase === 'undefined' || !firebase.firestore) return;
  const user = firebase.auth().currentUser;
  if (!user) return;

  if (mlMyPendingRoutesUnsub) { try { mlMyPendingRoutesUnsub(); } catch (e) {} mlMyPendingRoutesUnsub = null; }

  const db = firebase.firestore();
  const sourceId = 'pending-my-routes-source';
  const layerId = 'pending-my-routes-layer';

  return new Promise((resolve) => {
    let firstFire = true;
    const settle = () => { if (firstFire) { firstFire = false; resolve(); } };

    mlMyPendingRoutesUnsub = db.collection('pending_routes')
      .where('schoolId', '==', schoolId)
      .where('createdBy', '==', user.uid)
      .where('status', '==', 'pending')
      .onSnapshot((snapshot) => {
        try {
          if (!mlMap || mlCurrentSchool !== schoolId) {
            if (mlMyPendingRoutesUnsub) { try { mlMyPendingRoutesUnsub(); } catch (e) {} mlMyPendingRoutesUnsub = null; }
            settle(); return;
          }

          const features = [];
          snapshot.forEach(doc => {
            const data = doc.data();
            let coordinates = null;
            if (data.coordinates && Array.isArray(data.coordinates)) coordinates = data.coordinates;
            else if (data.geojsonFeature?.geometry?.coordinates) coordinates = data.geojsonFeature.geometry.coordinates;
            if (!coordinates) return;

            features.push({
              type: 'Feature',
              properties: {
                fid: `pending_${doc.id}`,
                nombre: data.nombre || 'Sin nombre',
                grado1: data.grado1 || '?',
                sector: data.sector || '',
                isPending: true
              },
              geometry: { type: 'Point', coordinates }
            });
          });

          const geojson = { type: 'FeatureCollection', features };
          console.log(`[MyPendingRoutes] ${features.length} vías pendientes propias para ${schoolId}`);

          if (mlMap.getSource(sourceId)) {
            mlMap.getSource(sourceId).setData(geojson);
          } else {
            mlMap.addSource(sourceId, { type: 'geojson', data: geojson });
            mlMap.addLayer({
              id: layerId,
              type: 'circle',
              source: sourceId,
              minzoom: minZoom,
              paint: {
                'circle-radius': [
                  'interpolate', ['linear'], ['zoom'],
                  14, isMobileDevice() ? 2 : 3,
                  16, isMobileDevice() ? 3.5 : 5,
                  18, isMobileDevice() ? 5.5 : 8,
                  20, isMobileDevice() ? 9 : 14
                ],
                'circle-color': generateGradeColorExpression('grado1'),
                'circle-stroke-color': '#FF6B00',
                'circle-stroke-width': isMobileDevice() ? 2.5 : 3,
                'circle-opacity': 0.8
              }
            });
            if (!mlMyPendingViasInteractionAttached) {
              mlMap.on('click', layerId, (e) => {
                if (mlMap.getCanvas().style.cursor === 'crosshair') return;
                if (!e.features || e.features.length === 0) return;
                const props = e.features[0].properties;
                const coords = e.features[0].geometry.coordinates;
                new maplibregl.Popup({ closeButton: true, maxWidth: '260px' })
                  .setLngLat(coords)
                  .setHTML(`<div style="padding:8px;font-size:13px;">
                    <strong>⏳ ${props.nombre}</strong><br>
                    Grado: ${props.grado1} · Sector: ${props.sector || '—'}<br>
                    <small style="color:#f97316;font-weight:600;">Pendiente de aprobación</small>
                  </div>`)
                  .addTo(mlMap);
              });
              mlMyPendingViasInteractionAttached = true;
            }
          }
        } catch (err) {
          console.error('[MyPendingRoutes] Error:', err);
        }
        settle();
      }, (err) => { console.error('[MyPendingRoutes] onSnapshot error:', err); settle(); });
  });
}

/**
 * Carga los POIs pendientes del usuario con estilo semi-transparente.
 */
async function loadMyPendingPOIFromFirestore(schoolId) {
  if (typeof firebase === 'undefined' || !firebase.firestore) return;
  const user = firebase.auth().currentUser;
  if (!user) return;

  if (mlMyPendingPOIUnsub) { try { mlMyPendingPOIUnsub(); } catch (e) {} mlMyPendingPOIUnsub = null; }

  const db = firebase.firestore();
  const sourceId = 'pending-my-poi-source';
  const layerId = 'pending-my-poi-layer';

  return new Promise((resolve) => {
    let firstFire = true;
    const settle = () => { if (firstFire) { firstFire = false; resolve(); } };

    mlMyPendingPOIUnsub = db.collection('pending_poi')
      .where('createdBy', '==', user.uid)
      .where('status', '==', 'pending')
      .onSnapshot(async (snapshot) => {
        try {
          if (!mlMap || mlCurrentSchool !== schoolId) {
            if (mlMyPendingPOIUnsub) { try { mlMyPendingPOIUnsub(); } catch (e) {} mlMyPendingPOIUnsub = null; }
            settle(); return;
          }

          const features = [];
          snapshot.forEach(doc => {
            const data = doc.data();
            if (!data.coordinates || !Array.isArray(data.coordinates)) return;
            if (data.schoolId && data.schoolId !== schoolId) return;

            const desc = data.descripcio || '';

            features.push({
              type: 'Feature',
              properties: {
                descripcio: desc, nombre: data.nombre || '',
                _poiType: desc,
                _svgIcon: 'poi-svg-' + desc.toLowerCase().trim(),
                isPending: true
              },
              geometry: { type: 'Point', coordinates: data.coordinates }
            });
          });

          // Registrar iconos SVG
          const usedTypes2 = new Set(features.map(f => f.properties._poiType.toLowerCase().trim()));
          for (const poiType of usedTypes2) {
            const imgId = 'poi-svg-' + poiType;
            if (!mlMap.hasImage(imgId)) {
              try { mlMap.addImage(imgId, await createSVGPinImage(poiType), { sdf: false, pixelRatio: _mlDPR }); } catch (e) {}
            }
          }

          const geojson = { type: 'FeatureCollection', features };
          console.log(`[MyPendingPOI] ${features.length} POIs pendientes propios para ${schoolId}`);

          if (mlMap.getSource(sourceId)) {
            mlMap.getSource(sourceId).setData(geojson);
            kxApplyPoiZoom(layerId, schoolId, 13, 0.7);
          } else {
            mlMap.addSource(sourceId, { type: 'geojson', data: geojson });
            mlMap.addLayer({
              id: layerId,
              type: 'symbol',
              source: sourceId,
              minzoom: kxPoiMinZoom(schoolId, 13),
              paint: { 'icon-opacity': 0.6 },
              layout: {
                'icon-image': ['coalesce', ['image', ['get', '_svgIcon']], ['image', 'poi-svg-default']],
                'icon-size': kxPoiIconSize(kxPoiMinZoom(schoolId, 13), 0.7),
                'icon-allow-overlap': true, 'icon-ignore-placement': true, 'icon-anchor': 'center'
              }
            });
            mlMap.on('click', layerId, (e) => {
              if (mlMap.getCanvas().style.cursor === 'crosshair') return;
              if (!e.features || e.features.length === 0) return;
              const props = e.features[0].properties;
              const coords = e.features[0].geometry.coordinates.slice();
              new maplibregl.Popup({ closeButton: true, maxWidth: '260px' })
                .setLngLat(coords)
                .setHTML(`<div style="padding:8px;font-size:13px;">
                  <strong>${props._emoji || '📍'} ${props._poiType}</strong>
                  ${props.nombre ? `<br>${props.nombre}` : ''}
                  <br><small style="color:#f97316;font-weight:600;">⏳ Pendiente de aprobación</small>
                </div>`)
                .addTo(mlMap);
            });
          }
        } catch (err) {
          console.error('[MyPendingPOI] Error:', err);
        }
        settle();
      }, (err) => { console.error('[MyPendingPOI] onSnapshot error:', err); settle(); });
  });
}

/**
 * Carga los sectores pendientes del usuario con línea punteada naranja.
 */
async function loadMyPendingSectorsFromFirestore(schoolId) {
  if (typeof firebase === 'undefined' || !firebase.firestore) return;
  const user = firebase.auth().currentUser;
  if (!user) return;

  if (mlMyPendingSectorsUnsub) { try { mlMyPendingSectorsUnsub(); } catch (e) {} mlMyPendingSectorsUnsub = null; }

  const db = firebase.firestore();
  const sourceId = 'pending-my-sectors-source';
  const casingLayerId = 'pending-my-sectors-casing-layer';
  const lineLayerId = 'pending-my-sectors-layer';

  return new Promise((resolve) => {
    let firstFire = true;
    const settle = () => { if (firstFire) { firstFire = false; resolve(); } };

    mlMyPendingSectorsUnsub = db.collection('pending_sectors')
      .where('createdBy', '==', user.uid)
      .where('status', '==', 'pending')
      .onSnapshot((snapshot) => {
        try {
          if (!mlMap || mlCurrentSchool !== schoolId) {
            if (mlMyPendingSectorsUnsub) { try { mlMyPendingSectorsUnsub(); } catch (e) {} mlMyPendingSectorsUnsub = null; }
            settle(); return;
          }

          const features = [];
          snapshot.forEach(doc => {
            const data = doc.data();
            if (data.schoolId && data.schoolId !== schoolId) return;
            if (!data.vertices || data.vertices.length < 2) return;

            features.push({
              type: 'Feature',
              properties: { nombre: data.nombre || 'Sin nombre', isPending: true },
              geometry: { type: 'LineString', coordinates: data.vertices.map(v => [v.lng, v.lat]) }
            });
          });

          const geojson = { type: 'FeatureCollection', features };
          console.log(`[MyPendingSectors] ${features.length} sectores pendientes propios para ${schoolId}`);

          if (mlMap.getSource(sourceId)) {
            mlMap.getSource(sourceId).setData(geojson);
          } else {
            const school = MAPLIBRE_SCHOOLS[schoolId];
            const sectorMinZoom = school?.zoomLevels?.sectores || 12;

            mlMap.addSource(sourceId, { type: 'geojson', data: geojson });

            mlMap.addLayer({
              id: casingLayerId,
              type: 'line',
              source: sourceId,
              minzoom: sectorMinZoom,
              layout: { 'line-cap': 'round', 'line-join': 'round' },
              paint: {
                'line-color': '#FF6B00',
                'line-width': ['interpolate', ['linear'], ['zoom'], 12, 4, 14, 6, 16, 10, 18, 14],
                'line-opacity': 0.5,
                'line-dasharray': [3, 2]
              }
            });

            mlMap.addLayer({
              id: lineLayerId,
              type: 'line',
              source: sourceId,
              minzoom: sectorMinZoom,
              layout: { 'line-cap': 'round', 'line-join': 'round' },
              paint: {
                'line-color': '#FF9500',
                'line-width': ['interpolate', ['linear'], ['zoom'], 12, 2, 14, 3, 16, 5, 18, 8],
                'line-opacity': 0.9,
                'line-dasharray': [4, 3]
              }
            });

            if (!mlMyPendingSectorsInteractionAttached) {
              mlMap.on('click', lineLayerId, (e) => {
                if (mlMap.getCanvas().style.cursor === 'crosshair') return;
                if (!e.features || e.features.length === 0) return;
                const props = e.features[0].properties;
                new maplibregl.Popup({ closeButton: true, maxWidth: '260px' })
                  .setLngLat(e.lngLat)
                  .setHTML(`<div style="padding:8px;font-size:13px;">
                    <strong>📐 ${props.nombre}</strong><br>
                    <small style="color:#f97316;font-weight:600;">⏳ Sector pendiente de aprobación</small>
                  </div>`)
                  .addTo(mlMap);
              });
              mlMyPendingSectorsInteractionAttached = true;
            }
          }
        } catch (err) {
          console.error('[MyPendingSectors] Error:', err);
        }
        settle();
      }, (err) => { console.error('[MyPendingSectors] onSnapshot error:', err); settle(); });
  });
}

/**
 * Carga las escuelas pendientes del usuario como marcadores en el mapa.
 * Solo el autor las ve. Al hacer clic permite entrar en contexto de esa escuela.
 */
async function loadMyPendingSchoolsFromFirestore() {
  if (typeof firebase === 'undefined' || !firebase.firestore) return;
  const user = firebase.auth().currentUser;
  if (!user) return;

  try {
    const db = firebase.firestore();
    const snapshot = await db.collection('pending_schools')
      .where('createdBy', '==', user.uid)
      .where('status', '==', 'pending')
      .get();

    if (snapshot.empty) { kxClearSchoolSource('pending-my-schools-source'); return; }

    const features = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      if (!data.coordinates || !Array.isArray(data.coordinates)) return;
      mlPendingSchoolsCache.set(doc.id, { nombre: data.nombre, coordinates: data.coordinates });
      features.push({
        type: 'Feature',
        properties: {
          id: doc.id,
          nombre: data.nombre || 'Escuela pendiente',
          coords: JSON.stringify(data.coordinates),
          isPending: true
        },
        geometry: { type: 'Point', coordinates: data.coordinates }
      });
    });

    if (features.length === 0) { kxClearSchoolSource('pending-my-schools-source'); return; }

    console.log(`[MyPendingSchools] ${features.length} escuelas pendientes propias`);

    if (!mlMap.hasImage('kx-school-pin-pending')) await loadSchoolIcons();

    const sourceId = 'pending-my-schools-source';
    const layerId = 'pending-my-schools-layer';

    if (mlMap.getLayer(layerId)) mlMap.removeLayer(layerId);
    if (mlMap.getSource(sourceId)) mlMap.removeSource(sourceId);

    mlMap.addSource(sourceId, { type: 'geojson', data: { type: 'FeatureCollection', features } });

    mlMap.addLayer({
      id: layerId,
      type: 'symbol',
      source: sourceId,
      minzoom: 5,
      maxzoom: 12,
      layout: {
        'icon-image': 'kx-school-pin-pending',
        'icon-size': kxZoomExpr(KX_SCHOOL_SCALE),
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'icon-anchor': 'bottom',
        'icon-offset': [0, KX_SCHOOL_PIN_TIP_GAP],
        'text-field': ['concat', ['get', 'nombre'], '\n⏳'],
        'text-font': ['Noto Sans Bold'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 7, 10, 12, 13],
        'text-offset': [0, 0.5],
        'text-anchor': 'top'
      },
      paint: {
        'text-color': '#f97316',
        'text-halo-color': 'rgba(255,255,255,0.95)',
        'text-halo-width': 2
      }
    });

    kxMapOnce('mouseenter', layerId, () => { mlMap.getCanvas().style.cursor = 'pointer'; });
    kxMapOnce('mouseleave', layerId, () => { mlMap.getCanvas().style.cursor = ''; });
    kxMapOnce('click', layerId, (e) => {
      if (mlMap.getCanvas().style.cursor === 'crosshair') return;
      if (!e.features || e.features.length === 0) return;
      const props = e.features[0].properties;
      const coords = JSON.parse(props.coords);
      const popupHTML = `
        <div style="padding:10px;font-size:13px;max-width:220px;">
          <strong>${props.nombre}</strong><br>
          <span style="color:#f97316;font-weight:600;">⏳ Pendiente de aprobación</span><br><br>
          <button onclick="mlLoadSchool('${props.id}', true); this.closest('.maplibregl-popup').remove();"
            style="background:#f97316;color:white;border:none;border-radius:6px;padding:6px 12px;cursor:pointer;font-size:12px;width:100%;">
            Añadir sectores y vías
          </button>
        </div>`;
      new maplibregl.Popup({ closeButton: true, maxWidth: '260px' })
        .setLngLat(coords)
        .setHTML(popupHTML)
        .addTo(mlMap);
    });
  } catch (err) {
    console.error('[MyPendingSchools] Error:', err);
  }
}

/**
 * Carga una escuela pendiente (sin datos estáticos) para que el Spotter
 * pueda añadir sectores y vías antes de que sea aprobada.
 */
async function mlLoadPendingSchool(schoolId, coordinates, skipFlyTo = false) {
  mlClearSchoolLayers();
  mlCurrentSchool = schoolId;

  if (!skipFlyTo) {
    mlMap.flyTo({ center: coordinates, zoom: 14, essential: true });
  }

  console.log(`[PendingSchool] Cargando escuela pendiente ${schoolId}`);

  // No hay GeoJSON ni Vector Tiles — solo ítems de Firestore
  await Promise.all([
    loadApprovedRoutesFromFirestore(schoolId),
    loadApprovedSectorsFromFirestore(schoolId),
    loadApprovedPOIFromFirestore(schoolId),
  ]);
  checkAdminRole().then(role => {
    if (role === 'admin') {
      loadAllPendingForAdmin(schoolId);
    } else if (role === 'spotter') {
      loadMyPendingRoutesFromFirestore(schoolId);
      loadMyPendingPOIFromFirestore(schoolId);
      loadMyPendingSectorsFromFirestore(schoolId);
    }
  });
}

// ============================================
// ADMIN: ALL PENDING ITEMS OVERLAY
// ============================================

/**
 * Carga TODOS los ítems pendientes de TODOS los Spotters (solo para admins).
 * Estilo: línea/borde rojo punteado con botones de eliminar y editar en popup.
 */
async function loadAllPendingForAdmin(schoolId, minZoom = 14) {
  if (typeof firebase === 'undefined' || !firebase.firestore) return;
  if (!firebase.auth().currentUser) return;

  if (mlAdminPendingRoutesUnsub) { try { mlAdminPendingRoutesUnsub(); } catch (e) {} mlAdminPendingRoutesUnsub = null; }
  if (mlAdminPendingPOIUnsub) { try { mlAdminPendingPOIUnsub(); } catch (e) {} mlAdminPendingPOIUnsub = null; }
  if (mlAdminPendingSectorsUnsub) { try { mlAdminPendingSectorsUnsub(); } catch (e) {} mlAdminPendingSectorsUnsub = null; }

  const db = firebase.firestore();
  const school = MAPLIBRE_SCHOOLS[schoolId];

  // --- Pending Routes ---
  const routeSourceId = 'admin-pending-routes-source';
  const routeLayerId = 'admin-pending-routes-layer';

  mlAdminPendingRoutesUnsub = db.collection('pending_routes')
    .where('status', '==', 'pending')
    .onSnapshot(snapshot => {
      if (!mlMap || mlCurrentSchool !== schoolId) {
        if (mlAdminPendingRoutesUnsub) { try { mlAdminPendingRoutesUnsub(); } catch (e) {} mlAdminPendingRoutesUnsub = null; }
        return;
      }
      const features = [];
      snapshot.forEach(doc => {
        const data = doc.data();
        if (data.schoolId !== schoolId) return;
        let coords = data.coordinates;
        if (!coords && data.geojsonFeature?.geometry?.coordinates) coords = data.geojsonFeature.geometry.coordinates;
        if (!coords || !Array.isArray(coords)) return;
        features.push({
          type: 'Feature',
          properties: {
            docId: doc.id,
            nombre: data.nombre || 'Sin nombre',
            grado1: data.grado1 || '?',
            sector: data.sector || '',
            createdBy: data.createdBy || '',
            lng: coords[0],
            lat: coords[1]
          },
          geometry: { type: 'Point', coordinates: coords }
        });
      });
      console.log(`[AdminPending] ${features.length} vías pendientes para ${schoolId}`);
      const geojson = { type: 'FeatureCollection', features };
      if (mlMap.getSource(routeSourceId)) {
        mlMap.getSource(routeSourceId).setData(geojson);
      } else {
        mlMap.addSource(routeSourceId, { type: 'geojson', data: geojson });
        mlMap.addLayer({
          id: routeLayerId,
          type: 'circle',
          source: routeSourceId,
          minzoom: minZoom,
          paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 14, isMobileDevice() ? 3 : 4, 18, isMobileDevice() ? 7 : 10],
            'circle-color': '#FEE2E2',
            'circle-stroke-color': '#DC2626',
            'circle-stroke-width': isMobileDevice() ? 2.5 : 3,
            'circle-opacity': 0.9
          }
        });
        if (!mlAdminPendingViasInteractionAttached) {
          mlMap.on('click', routeLayerId, (e) => {
            if (mlMap.getCanvas().style.cursor === 'crosshair') return;
            if (!e.features || !e.features.length) return;
            const props = e.features[0].properties;
            const coords = e.features[0].geometry.coordinates;
            new maplibregl.Popup({ closeButton: true, maxWidth: '290px' })
              .setLngLat(coords)
              .setHTML(`<div style="padding:10px;font-size:13px;">
                <strong style="color:#DC2626;">⏳ ${props.nombre}</strong><br>
                Grado: ${props.grado1} · Sector: ${props.sector || '—'}<br>
                <small style="color:#9ca3af;">Por: ${props.createdBy}</small><br><br>
                <div style="display:flex;gap:8px;flex-wrap:wrap;">
                  <button onclick="mlDeletePendingItem('pending_routes','${props.docId}');this.closest('.maplibregl-popup').remove();"
                    style="flex:1;background:#DC2626;color:white;border:none;border-radius:6px;padding:7px 10px;cursor:pointer;font-size:12px;font-weight:600;">
                    🗑️ Eliminar
                  </button>
                  <button onclick="mlStartEditPending('pending_routes','${props.docId}','Point',[${props.lng},${props.lat}]);this.closest('.maplibregl-popup').remove();"
                    style="flex:1;background:#2563EB;color:white;border:none;border-radius:6px;padding:7px 10px;cursor:pointer;font-size:12px;font-weight:600;">
                    ✏️ Editar
                  </button>
                </div>
              </div>`)
              .addTo(mlMap);
          });
          mlAdminPendingViasInteractionAttached = true;
        }
      }
    }, err => console.error('[AdminPending] routes error:', err));

  // --- Pending POIs ---
  const poiSourceId = 'admin-pending-poi-source';
  const poiLayerId = 'admin-pending-poi-layer';

  mlAdminPendingPOIUnsub = db.collection('pending_poi')
    .where('status', '==', 'pending')
    .onSnapshot(async snapshot => {
      if (!mlMap || mlCurrentSchool !== schoolId) {
        if (mlAdminPendingPOIUnsub) { try { mlAdminPendingPOIUnsub(); } catch (e) {} mlAdminPendingPOIUnsub = null; }
        return;
      }
      const features = [];
      snapshot.forEach(doc => {
        const data = doc.data();
        if (data.schoolId && data.schoolId !== schoolId) return;
        if (!data.coordinates || !Array.isArray(data.coordinates)) return;
        const desc = data.descripcio || '';
        const svgImgId = 'poi-svg-' + desc.toLowerCase().trim();
        features.push({
          type: 'Feature',
          properties: {
            docId: doc.id,
            _poiType: desc,
            _svgIcon: svgImgId,
            nombre: data.nombre || '',
            createdBy: data.createdBy || '',
            lng: data.coordinates[0],
            lat: data.coordinates[1]
          },
          geometry: { type: 'Point', coordinates: data.coordinates }
        });
      });
      // Registrar iconos SVG para admin panel
      const usedTypesAdmin = new Set(features.map(f => f.properties._poiType.toLowerCase().trim()));
      for (const poiType of usedTypesAdmin) {
        const imgId = 'poi-svg-' + poiType;
        if (!mlMap.hasImage(imgId)) {
          try { mlMap.addImage(imgId, await createSVGPinImage(poiType), { sdf: false, pixelRatio: _mlDPR }); } catch (e) {}
        }
      }
      const geojson = { type: 'FeatureCollection', features };
      if (mlMap.getSource(poiSourceId)) {
        mlMap.getSource(poiSourceId).setData(geojson);
        kxApplyPoiZoom(poiLayerId, schoolId, 13, 0.7);
      } else {
        mlMap.addSource(poiSourceId, { type: 'geojson', data: geojson });
        mlMap.addLayer({
          id: poiLayerId,
          type: 'symbol',
          source: poiSourceId,
          minzoom: kxPoiMinZoom(schoolId, 13),
          paint: { 'icon-opacity': 0.8 },
          layout: {
            'icon-image': ['coalesce', ['image', ['get', '_svgIcon']], ['image', 'poi-svg-default']],
            'icon-size': kxPoiIconSize(kxPoiMinZoom(schoolId, 13), 0.7),
            'icon-allow-overlap': true, 'icon-ignore-placement': true, 'icon-anchor': 'center'
          }
        });
        if (!mlAdminPendingPOIInteractionAttached) {
          mlMap.on('click', poiLayerId, (e) => {
            if (mlMap.getCanvas().style.cursor === 'crosshair') return;
            if (!e.features || !e.features.length) return;
            const props = e.features[0].properties;
            const coords = e.features[0].geometry.coordinates.slice();
            new maplibregl.Popup({ closeButton: true, maxWidth: '290px' })
              .setLngLat(coords)
              .setHTML(`<div style="padding:10px;font-size:13px;">
                <strong style="color:#DC2626;">📍 ${props._poiType}</strong>
                ${props.nombre ? `<br>${props.nombre}` : ''}
                <br><small style="color:#9ca3af;">Por: ${props.createdBy}</small><br><br>
                <div style="display:flex;gap:8px;flex-wrap:wrap;">
                  <button onclick="mlDeletePendingItem('pending_poi','${props.docId}');this.closest('.maplibregl-popup').remove();"
                    style="flex:1;background:#DC2626;color:white;border:none;border-radius:6px;padding:7px 10px;cursor:pointer;font-size:12px;font-weight:600;">
                    🗑️ Eliminar
                  </button>
                  <button onclick="mlStartEditPending('pending_poi','${props.docId}','Point',[${props.lng},${props.lat}]);this.closest('.maplibregl-popup').remove();"
                    style="flex:1;background:#2563EB;color:white;border:none;border-radius:6px;padding:7px 10px;cursor:pointer;font-size:12px;font-weight:600;">
                    ✏️ Editar
                  </button>
                </div>
              </div>`)
              .addTo(mlMap);
          });
          mlAdminPendingPOIInteractionAttached = true;
        }
      }
    }, err => console.error('[AdminPending] POI error:', err));

  // --- Pending Sectors ---
  const sectorSourceId = 'admin-pending-sectors-source';
  const sectorCasingId = 'admin-pending-sectors-casing-layer';
  const sectorLineId = 'admin-pending-sectors-layer';
  const sectorMinZoom = school?.zoomLevels?.sectores || 12;

  mlAdminPendingSectorsUnsub = db.collection('pending_sectors')
    .where('status', '==', 'pending')
    .onSnapshot(snapshot => {
      if (!mlMap || mlCurrentSchool !== schoolId) {
        if (mlAdminPendingSectorsUnsub) { try { mlAdminPendingSectorsUnsub(); } catch (e) {} mlAdminPendingSectorsUnsub = null; }
        return;
      }
      const features = [];
      snapshot.forEach(doc => {
        const data = doc.data();
        if (data.schoolId && data.schoolId !== schoolId) return;
        if (!data.vertices || data.vertices.length < 2) return;
        const coords = data.vertices.map(v => [v.lng, v.lat]);
        const verticesCoordsStr = '[' + coords.map(c => `[${c[0]},${c[1]}]`).join(',') + ']';
        features.push({
          type: 'Feature',
          properties: {
            docId: doc.id,
            nombre: data.nombre || 'Sin nombre',
            createdBy: data.createdBy || '',
            verticesCoordsStr
          },
          geometry: { type: 'LineString', coordinates: coords }
        });
      });
      const geojson = { type: 'FeatureCollection', features };
      if (mlMap.getSource(sectorSourceId)) {
        mlMap.getSource(sectorSourceId).setData(geojson);
      } else {
        mlMap.addSource(sectorSourceId, { type: 'geojson', data: geojson });
        mlMap.addLayer({
          id: sectorCasingId,
          type: 'line', source: sectorSourceId, minzoom: sectorMinZoom,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': '#DC2626',
            'line-width': ['interpolate', ['linear'], ['zoom'], 12, 4, 14, 6, 16, 10],
            'line-opacity': 0.35,
            'line-dasharray': [3, 2]
          }
        });
        mlMap.addLayer({
          id: sectorLineId,
          type: 'line', source: sectorSourceId, minzoom: sectorMinZoom,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': '#EF4444',
            'line-width': ['interpolate', ['linear'], ['zoom'], 12, 2, 14, 3, 16, 5],
            'line-opacity': 0.9,
            'line-dasharray': [4, 3]
          }
        });
        if (!mlAdminPendingSectorsInteractionAttached) {
          mlMap.on('click', sectorLineId, (e) => {
            if (mlMap.getCanvas().style.cursor === 'crosshair') return;
            if (!e.features || !e.features.length) return;
            const props = e.features[0].properties;
            new maplibregl.Popup({ closeButton: true, maxWidth: '290px' })
              .setLngLat(e.lngLat)
              .setHTML(`<div style="padding:10px;font-size:13px;">
                <strong style="color:#DC2626;">📐 ${props.nombre}</strong><br>
                <small style="color:#9ca3af;">Por: ${props.createdBy}</small><br><br>
                <div style="display:flex;gap:8px;flex-wrap:wrap;">
                  <button onclick="mlDeletePendingItem('pending_sectors','${props.docId}');this.closest('.maplibregl-popup').remove();"
                    style="flex:1;background:#DC2626;color:white;border:none;border-radius:6px;padding:7px 10px;cursor:pointer;font-size:12px;font-weight:600;">
                    🗑️ Eliminar
                  </button>
                  <button onclick="mlStartEditPending('pending_sectors','${props.docId}','LineString',${props.verticesCoordsStr});this.closest('.maplibregl-popup').remove();"
                    style="flex:1;background:#2563EB;color:white;border:none;border-radius:6px;padding:7px 10px;cursor:pointer;font-size:12px;font-weight:600;">
                    ✏️ Editar
                  </button>
                </div>
              </div>`)
              .addTo(mlMap);
          });
          mlAdminPendingSectorsInteractionAttached = true;
        }
      }
    }, err => console.error('[AdminPending] sectors error:', err));
}

/**
 * Carga TODAS las escuelas pendientes en el mapa (solo para admins).
 */
async function loadAllPendingSchoolsForAdmin() {
  if (typeof firebase === 'undefined' || !firebase.firestore) return;
  try {
    const db = firebase.firestore();
    const snapshot = await db.collection('pending_schools')
      .where('status', '==', 'pending')
      .get();
    if (snapshot.empty) { kxClearSchoolSource('admin-pending-schools-source'); return; }

    const features = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      if (!data.coordinates || !Array.isArray(data.coordinates)) return;
      mlPendingSchoolsCache.set(doc.id, { nombre: data.nombre, coordinates: data.coordinates });
      features.push({
        type: 'Feature',
        properties: {
          id: doc.id,
          docId: doc.id,
          nombre: data.nombre || 'Escuela pendiente',
          createdBy: data.createdBy || '',
          coords: JSON.stringify(data.coordinates),
          lng: data.coordinates[0],
          lat: data.coordinates[1]
        },
        geometry: { type: 'Point', coordinates: data.coordinates }
      });
    });
    if (!features.length) { kxClearSchoolSource('admin-pending-schools-source'); return; }

    if (!mlMap.hasImage('kx-school-pin-pending')) await loadSchoolIcons();

    const sourceId = 'admin-pending-schools-source';
    const layerId = 'admin-pending-schools-layer';
    if (mlMap.getLayer(layerId)) mlMap.removeLayer(layerId);
    if (mlMap.getSource(sourceId)) mlMap.removeSource(sourceId);

    mlMap.addSource(sourceId, { type: 'geojson', data: { type: 'FeatureCollection', features } });
    mlMap.addLayer({
      id: layerId,
      type: 'symbol',
      source: sourceId,
      minzoom: 5,
      maxzoom: 12,
      layout: {
        'icon-image': 'kx-school-pin-pending',
        'icon-size': kxZoomExpr(KX_SCHOOL_SCALE),
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'icon-anchor': 'bottom',
        'icon-offset': [0, KX_SCHOOL_PIN_TIP_GAP],
        'text-field': ['concat', ['get', 'nombre'], '\n⏳'],
        'text-font': ['Noto Sans Bold'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 7, 10, 12, 13],
        'text-offset': [0, 0.5],
        'text-anchor': 'top'
      },
      paint: {
        'text-color': '#DC2626',
        'text-halo-color': 'rgba(255,255,255,0.95)',
        'text-halo-width': 2
      }
    });

    kxMapOnce('mouseenter', layerId, () => { mlMap.getCanvas().style.cursor = 'pointer'; });
    kxMapOnce('mouseleave', layerId, () => { mlMap.getCanvas().style.cursor = ''; });
    kxMapOnce('click', layerId, (e) => {
      if (mlMap.getCanvas().style.cursor === 'crosshair') return;
      if (!e.features || !e.features.length) return;
      const props = e.features[0].properties;
      const coords = JSON.parse(props.coords);
      new maplibregl.Popup({ closeButton: true, maxWidth: '290px' })
        .setLngLat(coords)
        .setHTML(`<div style="padding:10px;font-size:13px;max-width:250px;">
          <strong style="color:#DC2626;">${props.nombre}</strong><br>
          <small style="color:#9ca3af;">Por: ${props.createdBy}</small><br>
          <span style="color:#DC2626;font-weight:600;">⏳ Pendiente de aprobación</span><br><br>
          <div style="display:flex;flex-direction:column;gap:8px;">
            <button onclick="mlLoadSchool('${props.id}',true);this.closest('.maplibregl-popup').remove();"
              style="background:#2563EB;color:white;border:none;border-radius:6px;padding:8px 12px;cursor:pointer;font-size:12px;font-weight:600;">
              Gestionar sectores y vías
            </button>
            <div style="display:flex;gap:8px;">
              <button onclick="mlStartEditPending('pending_schools','${props.docId}','Point',[${props.lng},${props.lat}]);this.closest('.maplibregl-popup').remove();"
                style="flex:1;background:#6b7280;color:white;border:none;border-radius:6px;padding:7px 10px;cursor:pointer;font-size:12px;font-weight:600;">
                ✏️ Mover
              </button>
              <button onclick="mlDeletePendingItem('pending_schools','${props.docId}');this.closest('.maplibregl-popup').remove();"
                style="flex:1;background:#DC2626;color:white;border:none;border-radius:6px;padding:7px 10px;cursor:pointer;font-size:12px;font-weight:600;">
                🗑️ Eliminar
              </button>
            </div>
          </div>
        </div>`)
        .addTo(mlMap);
    });
    console.log(`[AdminPendingSchools] ${features.length} escuelas pendientes cargadas`);
  } catch (err) {
    console.error('[AdminPendingSchools] Error:', err);
  }
}

// ============================================
// ADMIN: GEOMETRY EDITING (drag-to-reposition)
// ============================================

async function mlDeletePendingItem(collection, docId) {
  try {
    await firebase.firestore().collection(collection).doc(docId).delete();
    if (typeof showRDToast === 'function') showRDToast('Propuesta eliminada', 'success');
    else console.log(`[Admin] Eliminado ${collection}/${docId}`);
  } catch (err) {
    console.error('[Admin] Delete error:', err);
    if (typeof showRDToast === 'function') showRDToast('Error al eliminar', 'error');
  }
}

function mlStartEditPending(collection, docId, type, coords) {
  mlCancelPendingEdit();

  // La línea de un sector se ajusta con el editor del dibujo: arrastrar puntos y tocar la línea para añadir
  if (type === 'LineString' && collection === 'pending_sectors' && typeof window.devAdjustSectorLine === 'function') {
    window.devAdjustSectorLine(docId, coords);
    return;
  }

  mlEditState.docId = docId;
  mlEditState.collection = collection;
  mlEditState.type = type;

  if (type === 'Point') {
    const el = document.createElement('div');
    el.style.cssText = 'width:26px;height:26px;background:#DC2626;border:3px solid white;border-radius:50%;cursor:move;box-shadow:0 2px 8px rgba(0,0,0,0.45);';
    const marker = new maplibregl.Marker({ element: el, draggable: true })
      .setLngLat(coords)
      .addTo(mlMap);
    mlEditState.markers.push(marker);
  } else if (type === 'LineString') {
    coords.forEach(c => {
      const el = document.createElement('div');
      el.style.cssText = 'width:16px;height:16px;background:white;border:2.5px solid #DC2626;border-radius:50%;cursor:move;box-shadow:0 1px 5px rgba(0,0,0,0.4);';
      const marker = new maplibregl.Marker({ element: el, draggable: true })
        .setLngLat(c)
        .addTo(mlMap);
      mlEditState.markers.push(marker);
    });
  }

  const toolbar = document.getElementById('admin-edit-toolbar');
  if (toolbar) toolbar.classList.remove('hidden');
}

async function mlSavePendingEdit() {
  if (!mlEditState.docId) return;
  const { docId, collection, type, markers } = mlEditState;
  try {
    if (type === 'Point') {
      const ll = markers[0].getLngLat();
      await firebase.firestore().collection(collection).doc(docId).update({ coordinates: [ll.lng, ll.lat] });
    } else if (type === 'LineString') {
      const vertices = markers.map(m => { const ll = m.getLngLat(); return { lng: ll.lng, lat: ll.lat }; });
      await firebase.firestore().collection(collection).doc(docId).update({ vertices });
    }
    if (typeof showRDToast === 'function') showRDToast('Geometría actualizada', 'success');
    else console.log('[Admin] Geometría guardada');
  } catch (err) {
    console.error('[Admin] Save error:', err);
    if (typeof showRDToast === 'function') showRDToast('Error al guardar', 'error');
  }
  mlCancelPendingEdit();
}

function mlCancelPendingEdit() {
  mlEditState.markers.forEach(m => { try { m.remove(); } catch (e) {} });
  mlEditState.markers = [];
  mlEditState.docId = null;
  mlEditState.collection = null;
  mlEditState.type = null;
  const toolbar = document.getElementById('admin-edit-toolbar');
  if (toolbar) toolbar.classList.add('hidden');
}

// ============================================
// ESCUELAS APROBADAS (capa global y en vivo)
// ============================================
// No dependen de la escuela abierta ni de la sesión: se suscriben una vez, sobreviven a entrar y salir de
// una escuela y a los cambios de usuario, y se actualizan solas cuando un admin aprueba, edita o elimina una.
const mlApprovedSchoolsCache = new Map();   // docId → datos completos de la escuela aprobada
let mlApprovedSchoolsUnsub = null;
let mlApprovedSchoolsReady = null;
let mlApprovedSchoolsClickAttached = false;
const KX_USER_SCHOOL_SOURCE = 'escuelas-usuarios-source';
const KX_USER_SCHOOL_LAYER = 'escuelas-usuarios-layer';
const KX_USER_SCHOOL_LABELS = 'escuelas-usuarios-labels-layer';

// Los eventos por capa sobreviven a removeLayer: se enlazan una sola vez para no abrir la ficha varias veces
const mlBoundLayerEvents = new Set();
function kxMapOnce(type, layerId, fn) {
  const key = `${type}:${layerId}`;
  if (mlBoundLayerEvents.has(key)) return;
  mlBoundLayerEvents.add(key);
  mlMap.on(type, layerId, fn);
}

// Escuela aprobada con la forma de las oficiales (la usan las fichas) más sus datos propios
function kxUserSchool(id) {
  const d = mlApprovedSchoolsCache.get(id);
  if (!d) return null;
  return {
    id, docId: id,
    nombre: d.nombre || 'Sin nombre',
    coords: d.coordinates,
    zoom: 16,
    isOpen: true,
    rockType: d.rockType || '',
    descripcion: d.descripcion || '',
    aparcamiento: d.aparcamiento || '',
    exposicion: d.exposicion || '',
    createdByEmail: d.createdByEmail || '',
    isUserSchool: true
  };
}

function kxOpenUserSchool(id) {
  const school = kxUserSchool(id);
  if (!school) return;
  if (isMobileDevice()) {
    if (mlSchoolPopup) mlSchoolPopup.remove();
    adaptiveMapPanForBottomSheet(school.coords);
    showBottomSheet(school);
  } else {
    mlMap.flyTo({
      center: school.coords,
      zoom: mlMap.getZoom(),
      speed: 0.8,
      curve: 1,
      padding: { top: 450, bottom: 0, left: 0, right: 0 }
    });
    showSchoolPopup(school, null);
  }
}

async function kxApplyUserSchools(features) {
  if (!mlMap) return;
  const data = { type: 'FeatureCollection', features };
  const existing = mlMap.getSource(KX_USER_SCHOOL_SOURCE);
  if (existing) { existing.setData(data); return; }

  // El icono verde lo carga loadSchoolIcons
  if (!mlMap.hasImage('kx-school-pin')) await loadSchoolIcons();
  if (!mlMap) return;
  const again = mlMap.getSource(KX_USER_SCHOOL_SOURCE);   // otro snapshot pudo crearla mientras esperábamos
  if (again) { again.setData(data); return; }

  mlMap.addSource(KX_USER_SCHOOL_SOURCE, { type: 'geojson', data });
  // Mismo icono verde y etiqueta que las escuelas oficiales abiertas
  mlMap.addLayer({
    id: KX_USER_SCHOOL_LAYER,
    type: 'symbol',
    source: KX_USER_SCHOOL_SOURCE,
    minzoom: 5,
    maxzoom: 12,
    layout: {
      'icon-image': 'kx-school-pin',
      'icon-size': kxZoomExpr(KX_SCHOOL_SCALE),
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
      'icon-anchor': 'bottom',
      'icon-offset': [0, KX_SCHOOL_PIN_TIP_GAP]
    }
  });
  mlMap.addLayer(kxSchoolLabelLayer(KX_USER_SCHOOL_LABELS, KX_USER_SCHOOL_SOURCE));

  if (!mlApprovedSchoolsClickAttached) {
    mlApprovedSchoolsClickAttached = true;
    mlMap.on('mouseenter', KX_USER_SCHOOL_LAYER, () => { mlMap.getCanvas().style.cursor = 'pointer'; });
    mlMap.on('mouseleave', KX_USER_SCHOOL_LAYER, () => { mlMap.getCanvas().style.cursor = ''; });
    mlMap.on('click', KX_USER_SCHOOL_LAYER, (e) => {
      if (mlMap.getCanvas().style.cursor === 'crosshair') return;
      if (!e.features || e.features.length === 0) return;
      kxOpenUserSchool(e.features[0].properties.id);
    });
  }
}

// Las marcas «pendiente» (⏳) de quien las propuso se vuelven a pedir cuando cambia el conjunto de aprobadas
function kxClearSchoolSource(sourceId) {
  try { if (mlMap && mlMap.getSource(sourceId)) mlMap.getSource(sourceId).setData({ type: 'FeatureCollection', features: [] }); } catch (e) {}
}

function kxRefreshPendingSchoolMarkers() {
  if (typeof auth === 'undefined' || !auth.currentUser) return;
  checkAdminRole().then(role => {
    if (role === 'admin') loadAllPendingSchoolsForAdmin();
    else if (role === 'spotter') loadMyPendingSchoolsFromFirestore();
  }).catch(() => {});
}

function loadApprovedSchoolsFromFirestore() {
  if (mlApprovedSchoolsReady) return mlApprovedSchoolsReady;
  if (typeof firebase === 'undefined' || !firebase.firestore || !mlMap) return Promise.resolve();

  mlApprovedSchoolsReady = new Promise((resolve) => {
    let first = true;
    const settle = () => { if (first) { first = false; resolve(); } };

    mlApprovedSchoolsUnsub = firebase.firestore().collection('pending_schools')
      .where('status', '==', 'approved')
      .onSnapshot(async (snapshot) => {
        try {
          const isUpdate = !first;
          const seen = new Set();
          const features = [];
          snapshot.forEach(doc => {
            const data = doc.data();
            if (!data.coordinates || !Array.isArray(data.coordinates)) return;
            seen.add(doc.id);
            mlApprovedSchoolsCache.set(doc.id, data);
            // mlLoadSchool la busca aquí para cargarla como escuela de Firestore
            mlPendingSchoolsCache.set(doc.id, { nombre: data.nombre, coordinates: data.coordinates });
            features.push({
              type: 'Feature',
              geometry: { type: 'Point', coordinates: data.coordinates },
              properties: {
                id: doc.id,
                docId: doc.id,
                nombre: data.nombre || 'Sin nombre',
                isUserSchool: true
              }
            });
          });
          [...mlApprovedSchoolsCache.keys()].forEach(id => {
            if (!seen.has(id)) { mlApprovedSchoolsCache.delete(id); mlPendingSchoolsCache.delete(id); }
          });
          console.log(`[ApprovedSchools] Realtime: ${features.length} escuelas aprobadas`);
          await kxApplyUserSchools(features);
          if (isUpdate) kxRefreshPendingSchoolMarkers();
        } catch (err) {
          console.error('[ApprovedSchools] Error procesando snapshot:', err);
        }
        settle();
      }, (err) => {
        // Una escucha que falla no se recupera sola: se reintenta
        console.error('[ApprovedSchools] Error onSnapshot:', err);
        mlApprovedSchoolsUnsub = null;
        mlApprovedSchoolsReady = null;
        settle();
        setTimeout(loadApprovedSchoolsFromFirestore, 5000);
      });
  });
  return mlApprovedSchoolsReady;
}

// ============================================
// FILTRO DE GRADOS (RANGE SLIDER) Y LEYENDA
// ============================================

// Lista ordenada de todos los grados (de menor a mayor dificultad)
const ALL_GRADES_ORDERED = [
  '3a','3b','3c',
  '4a','4b','4c',
  '5a','5a+','5b','5b+','5c','5c+',
  '6a','6a+','6b','6b+',
  '6c','6c+',
  '7a','7a+','7b','7b+','7c','7c+',
  '8a','8a+','8b','8b+','8c','8c+',
  '9a','9a+','9b','9b+','9c','9c+'
];

// Inicializar rango completo
mlGradeRangeMax = ALL_GRADES_ORDERED.length - 1;

/**
 * Comprueba si el rango actual cubre todos los grados (sin filtro activo)
 */
function isFullGradeRange() {
  return mlGradeRangeMin === 0 && mlGradeRangeMax === ALL_GRADES_ORDERED.length - 1;
}

/**
 * Añade el botón de filtro/leyenda en la esquina superior derecha del mapa
 */
function addGradeFilterButton() {
  if (document.getElementById('btn-grade-filter')) return;

  const container = document.getElementById('map');
  if (!container) return;

  // Botón principal
  const btn = document.createElement('button');
  btn.id = 'btn-grade-filter';
  btn.className = 'map-control-btn';
  btn.title = 'Filtrar por grado';
  btn.type = 'button';
  btn.setAttribute('aria-label', 'Filtrar por grado');
  btn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="4" y1="7" x2="20" y2="7"></line><line x1="7" y1="12" x2="17" y2="12"></line><line x1="10" y1="17" x2="14" y2="17"></line></svg>`;
  // Aspecto en app_2.css (MAPA — CONTROLES); la visibilidad la decide updateFilterVisibility
  btn.style.display = 'none';

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleGradeFilterPanel();
  });

  // Columna de controles de abajo a la derecha; su aspecto y su orden, en app_2.css
  btn.classList.add('maplibregl-ctrl');   // la columna de MapLibre solo deja pasar los toques a sus controles
  const stack = mlMap.getContainer().querySelector('.maplibregl-ctrl-bottom-right');
  if (stack) stack.insertBefore(btn, stack.firstChild);
  else (document.getElementById('map-topbar') || container).appendChild(btn);

  // Panel desplegable
  const panel = document.createElement('div');
  panel.id = 'grade-filter-panel';
  panel.className = 'grade-filter-panel';
  panel.innerHTML = buildGradeFilterPanelHTML();
  container.appendChild(panel);

  // Inicializar sliders después de insertar en el DOM
  initRangeSliders();

  // Mostrar/ocultar sincronizado con resetViewBtn (mismo umbral de zoom)
  const updateFilterVisibility = () => {
    if (!mlMap) return;
    const ccaa = getCurrentCCAA();
    const visible = mlMap.getZoom() > ccaa.zoom + 1;
    btn.style.display = visible ? 'flex' : 'none';
    if (!visible) closeGradeFilterPanel();
  };
  mlMap.on('zoom', updateFilterVisibility);
  updateFilterVisibility();

  // Cerrar panel al tocar fuera (pointerdown además de click: en iOS un toque sobre el mapa no siempre genera click)
  const closeFilterOnOutside = (e) => {
    const panelEl = document.getElementById('grade-filter-panel');
    const btnEl = document.getElementById('btn-grade-filter');
    if (panelEl && btnEl && !panelEl.contains(e.target) && !btnEl.contains(e.target)) {
      closeGradeFilterPanel();
    }
  };
  document.addEventListener('click', closeFilterOnOutside);
  document.addEventListener('pointerdown', closeFilterOnOutside);
}

/**
 * Genera el HTML del panel de filtro por grado (range slider)
 */
function buildGradeFilterPanelHTML() {
  const maxIdx = ALL_GRADES_ORDERED.length - 1;

  return `
    <div class="gfp-header">
      <span class="gfp-title">Filtrar por grado</span>
      <button class="gfp-reset-btn" onclick="resetGradeFilter()" title="Mostrar todos">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
        Todos
      </button>
    </div>

    <div class="gfp-range-labels">
      <span class="gfp-range-label" id="gfp-label-min">${ALL_GRADES_ORDERED[0]}</span>
      <span class="gfp-range-separator">—</span>
      <span class="gfp-range-label" id="gfp-label-max">${ALL_GRADES_ORDERED[maxIdx]}</span>
    </div>

    <div class="gfp-range-container" id="gfp-range-container">
      <div class="gfp-range-track" id="gfp-range-track"></div>
      <div class="gfp-range-selected" id="gfp-range-selected"></div>
      <div class="gfp-range-thumb gfp-thumb-min" id="gfp-thumb-min" role="slider" aria-label="Grado mínimo" tabindex="0"></div>
      <div class="gfp-range-thumb gfp-thumb-max" id="gfp-thumb-max" role="slider" aria-label="Grado máximo" tabindex="0"></div>
    </div>

    <div class="gfp-range-ticks" id="gfp-range-ticks"></div>

    <div class="gfp-divider"></div>

    <label class="gfp-myvias-row" id="gfp-myvias-label">
      <input type="checkbox" id="gfp-myvias-checkbox" onchange="toggleShowOnlyMyRoutes(this.checked)">
      <span class="gfp-myvias-icon">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#15803d" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
      </span>
      <span class="gfp-myvias-text">Solo vías hechas</span>
    </label>

    <label class="gfp-myvias-row" id="gfp-projects-label">
      <input type="checkbox" id="gfp-projects-checkbox" onchange="toggleShowOnlyProjects(this.checked)">
      <span class="gfp-myvias-icon">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#b45309" stroke-width="2.5"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
      </span>
      <span class="gfp-myvias-text">Proyectos</span>
    </label>

  `;
}

/**
 * Inicializa los event listeners para los thumbs del range slider
 */
function initRangeSliders() {
  const container = document.getElementById('gfp-range-container');
  const thumbMin = document.getElementById('gfp-thumb-min');
  const thumbMax = document.getElementById('gfp-thumb-max');
  if (!container || !thumbMin || !thumbMax) return;

  // Generar ticks de referencia
  buildRangeTicks();

  // Posicionar thumbs según estado actual
  updateSliderPositions();

  // --- Drag para thumb min ---
  setupThumbDrag(thumbMin, 'min');
  setupThumbDrag(thumbMax, 'max');
}

/**
 * Genera las marcas de referencia debajo del slider
 */
function buildRangeTicks() {
  const ticksEl = document.getElementById('gfp-range-ticks');
  if (!ticksEl) return;

  // Mostrar solo grados principales (sin +) para no saturar
  const tickGrades = ['3a','4a','5a','5c','6a','6b','6c','7a','7b','7c','8a','8c','9a'];
  const maxIdx = ALL_GRADES_ORDERED.length - 1;

  let html = '';
  tickGrades.forEach(grade => {
    const idx = ALL_GRADES_ORDERED.indexOf(grade);
    if (idx === -1) return;
    const pct = (idx / maxIdx) * 100;
    html += `<span class="gfp-tick" style="left:${pct}%">${grade}</span>`;
  });

  ticksEl.innerHTML = html;
}

/**
 * Configura el drag (mouse + touch) para un thumb
 */
function setupThumbDrag(thumbEl, which) {
  let dragging = false;

  const onStart = (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragging = true;
    thumbEl.classList.add('active');
    document.body.style.userSelect = 'none';
  };

  const onMove = (e) => {
    if (!dragging) return;
    e.preventDefault();
    const container = document.getElementById('gfp-range-container');
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    let pct = (clientX - rect.left) / rect.width;
    pct = Math.max(0, Math.min(1, pct));

    const maxIdx = ALL_GRADES_ORDERED.length - 1;
    let idx = Math.round(pct * maxIdx);

    if (mlGradeFocus) kxClearGradeFocus({ apply: false });   // mover el rango sustituye al grado elegido

    if (which === 'min') {
      idx = Math.min(idx, mlGradeRangeMax);
      mlGradeRangeMin = idx;
    } else {
      idx = Math.max(idx, mlGradeRangeMin);
      mlGradeRangeMax = idx;
    }

    updateSliderPositions();
    updateRangeLabels();
    applyGradeFilter();
    updateFilterButtonBadge();
  };

  const onEnd = () => {
    if (!dragging) return;
    dragging = false;
    thumbEl.classList.remove('active');
    document.body.style.userSelect = '';
  };

  // Mouse events
  thumbEl.addEventListener('mousedown', onStart);
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onEnd);

  // Touch events
  thumbEl.addEventListener('touchstart', onStart, { passive: false });
  document.addEventListener('touchmove', onMove, { passive: false });
  document.addEventListener('touchend', onEnd);
}

/**
 * Actualiza las posiciones visuales de los thumbs y la barra seleccionada
 */
function updateSliderPositions() {
  const thumbMin = document.getElementById('gfp-thumb-min');
  const thumbMax = document.getElementById('gfp-thumb-max');
  const selected = document.getElementById('gfp-range-selected');
  if (!thumbMin || !thumbMax || !selected) return;

  const maxIdx = ALL_GRADES_ORDERED.length - 1;
  const pctMin = (mlGradeRangeMin / maxIdx) * 100;
  const pctMax = (mlGradeRangeMax / maxIdx) * 100;

  thumbMin.style.left = pctMin + '%';
  thumbMax.style.left = pctMax + '%';
  selected.style.left = pctMin + '%';
  selected.style.width = (pctMax - pctMin) + '%';

  // Gradiente de color en la barra seleccionada
  const colorMin = MAPLIBRE_GRADE_COLORS[ALL_GRADES_ORDERED[mlGradeRangeMin]] || '#888';
  const colorMax = MAPLIBRE_GRADE_COLORS[ALL_GRADES_ORDERED[mlGradeRangeMax]] || '#888';
  selected.style.background = `linear-gradient(to right, ${colorMin}, ${colorMax})`;
}

/**
 * Actualiza las etiquetas min/max
 */
function updateRangeLabels() {
  const labelMin = document.getElementById('gfp-label-min');
  const labelMax = document.getElementById('gfp-label-max');
  if (!labelMin || !labelMax) return;

  const gradeMin = ALL_GRADES_ORDERED[mlGradeRangeMin];
  const gradeMax = ALL_GRADES_ORDERED[mlGradeRangeMax];

  labelMin.textContent = gradeMin;
  labelMax.textContent = gradeMax;

  // Color de las etiquetas según el grado
  labelMin.style.background = MAPLIBRE_GRADE_COLORS[gradeMin] || '#888';
  labelMax.style.background = MAPLIBRE_GRADE_COLORS[gradeMax] || '#888';

  // Texto claro u oscuro según luminosidad del fondo
  labelMin.style.color = isLightColor(MAPLIBRE_GRADE_COLORS[gradeMin]) ? '#1f2937' : '#fff';
  labelMax.style.color = isLightColor(MAPLIBRE_GRADE_COLORS[gradeMax]) ? '#1f2937' : '#fff';
}

/**
 * Determina si un color hex es claro (para decidir texto oscuro o blanco)
 */
function isLightColor(hex) {
  if (!hex) return true;
  hex = hex.replace('#', '').substring(0, 6);
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  // Luminancia relativa
  return (r * 0.299 + g * 0.587 + b * 0.114) > 160;
}

/**
 * Abre/cierra el panel de filtro
 */
function toggleGradeFilterPanel() {
  const panel = document.getElementById('grade-filter-panel');
  const btn = document.getElementById('btn-grade-filter');
  if (!panel) return;

  mlFilterPanelOpen = !mlFilterPanelOpen;

  if (mlFilterPanelOpen) {
    panel.classList.add('open');
    btn.classList.add('active');
    // Asegurar posiciones correctas al abrir
    updateSliderPositions();
    updateRangeLabels();
  } else {
    panel.classList.remove('open');
    btn.classList.remove('active');
  }
}

function closeGradeFilterPanel() {
  const panel = document.getElementById('grade-filter-panel');
  const btn = document.getElementById('btn-grade-filter');
  if (!panel) return;

  mlFilterPanelOpen = false;
  panel.classList.remove('open');
  if (btn) btn.classList.remove('active');
}

/**
 * Reset: mostrar todos los grados (rango completo)
 */
function resetGradeFilter() {
  kxClearGradeFocus({ apply: false });
  mlGradeRangeMin = 0;
  mlGradeRangeMax = ALL_GRADES_ORDERED.length - 1;
  mlShowOnlyMyRoutes = false;
  mlShowOnlyProjects = false;

  const cb = document.getElementById('gfp-myvias-checkbox');
  if (cb) cb.checked = false;
  const cbProj = document.getElementById('gfp-projects-checkbox');
  if (cbProj) cbProj.checked = false;

  updateSliderPositions();
  updateRangeLabels();
  applyGradeFilter();
  updateFilterButtonBadge();
}

/**
 * Activa/desactiva el filtro "solo mis vías"
 */
function toggleShowOnlyMyRoutes(checked) {
  mlShowOnlyMyRoutes = checked;
  applyGradeFilter();
  updateFilterButtonBadge();
}

/**
 * Activa/desactiva el filtro "proyectos"
 */
function toggleShowOnlyProjects(checked) {
  mlShowOnlyProjects = checked;
  applyGradeFilter();
  updateFilterButtonBadge();
}

/**
 * Aplica el filtro de grados (y opcionalmente "solo mis vías") a la capa vias-layer
 */
function applyGradeFilter() {
  if (!mlMap) return;
  if (!mlMap.getLayer('vias-layer')) return;

  const gradeActive = !isFullGradeRange();

  // Construir filtro de grados (un grado elegido desde el gráfico manda sobre el rango)
  let gradeExpr = null;
  if (mlGradeFocus) {
    gradeExpr = kxGradeFocusExpr(mlGradeFocus);
  } else if (gradeActive) {
    const selectedGrades = ALL_GRADES_ORDERED.slice(mlGradeRangeMin, mlGradeRangeMax + 1);
    gradeExpr = ['in', ['get', 'grado1'], ['literal', selectedGrades]];
  }

  // Construir filtro de "solo vías hechas"
  let myViasExpr = null;
  if (mlShowOnlyMyRoutes && mlCurrentSchool && typeof userAscentsCache !== 'undefined' && userAscentsCache.size > 0) {
    const myRouteIds = [];
    const prefix = mlCurrentSchool + ':';
    for (const key of userAscentsCache.keys()) {
      if (key.startsWith(prefix)) {
        const id = parseInt(key.slice(prefix.length), 10);
        if (!isNaN(id)) myRouteIds.push(id);
      }
    }
    if (myRouteIds.length > 0) {
      myViasExpr = ['in', ['get', 'id'], ['literal', myRouteIds]];
    } else {
      myViasExpr = ['literal', false];
    }
  }

  // Construir filtro de "proyectos"
  let projectsExpr = null;
  if (mlShowOnlyProjects && typeof userProjects !== 'undefined' && userProjects.size > 0) {
    const projectIds = [];
    for (const key of userProjects.keys()) {
      const id = parseInt(key.replace('route_', ''), 10);
      if (!isNaN(id)) projectIds.push(id);
    }
    if (projectIds.length > 0) {
      projectsExpr = ['in', ['get', 'id'], ['literal', projectIds]];
    } else {
      projectsExpr = ['literal', false];
    }
  }

  // Combinar filtros de usuario (union si ambos activos)
  let routeSetExpr = null;
  if (myViasExpr && projectsExpr) {
    routeSetExpr = ['any', myViasExpr, projectsExpr];
  } else {
    routeSetExpr = myViasExpr || projectsExpr;
  }

  // Combinar con filtro de grado
  let combinedFilter = null;
  if (gradeExpr && routeSetExpr) {
    combinedFilter = ['all', gradeExpr, routeSetExpr];
  } else {
    combinedFilter = gradeExpr || routeSetExpr || null;
  }

  // Excluir variantes que se muestran como marcadores concéntricos
  if (mlVariantFeatureIndex.size > 0) {
    const variantIds = [...mlVariantFeatureIndex.keys()];
    const excludeExpr = ['!', ['in', ['get', 'id'], ['literal', variantIds]]];
    combinedFilter = combinedFilter
      ? ['all', combinedFilter, excludeExpr]
      : excludeExpr;
  }

  mlMap.setFilter('vias-layer', combinedFilter);
  if (mlMap.getLayer('vias-shadow-layer')) mlMap.setFilter('vias-shadow-layer', combinedFilter);
  kxApplyGradeToUserRoutes(gradeExpr);
  kxApplyFocusZoom();

  // Sincronizar ticks con filtros:
  // - El filtro "Solo vías hechas" no restringe los ticks (ya son vías hechas por construcción).
  // - El filtro "Proyectos" (activo en solitario) SÍ restringe los ticks: solo se muestran
  //   ticks de vías que también son proyectos, para que no aparezcan ticks sueltos
  //   sobre vías que ya no están visibles.
  let ticksExpr = gradeExpr;
  if (mlShowOnlyProjects && !mlShowOnlyMyRoutes && projectsExpr) {
    ticksExpr = ticksExpr ? ['all', ticksExpr, projectsExpr] : projectsExpr;
  }
  if (mlMap.getLayer('vias-ticks-circle-layer')) {
    mlMap.setFilter('vias-ticks-circle-layer', ticksExpr || null);
  }
  if (mlMap.getLayer('vias-ticks-layer')) {
    mlMap.setFilter('vias-ticks-layer', ticksExpr || null);
  }
}

// ============================================
// FILTRO DE UN GRADO DESDE EL GRÁFICO («Ver las N vías»)
// Filtra las vías del mapa por ese grado (y su sector, si viene de una ficha de sector) sin
// salir del mapa. Mientras está activo, las vías de ese grado se ven desde el zoom de la escuela
// y una píldora sobre el mapa indica el grado: tocarla vuelve al gráfico; la ✕ quita el filtro.
// ============================================
let mlGradeFocus = null;            // { grade, count, schoolId, sector?, sectorProps?, coords? }
const KX_FOCUS_MINZOOM = 12;        // zoom desde el que se ven las vías filtradas (las demás, desde el de la escuela)
const KX_FOCUS_LAYERS = ['vias-layer', 'vias-shadow-layer', 'vias-usuarios-layer'];
let kxUserRoutesBaseFilter;         // filtro propio de vias-usuarios-layer (undefined = aún sin leer)

// Expresión de MapLibre: mismo grado (sin distinguir mayúsculas) y, si hay, mismo sector
function kxGradeFocusExpr(focus) {
  const prop = k => ['downcase', ['to-string', ['coalesce', ['get', k], '']]];
  const byGrade = ['==', prop('grado1'), String(focus.grade).toLowerCase().trim()];
  return focus.sector ? ['all', byGrade, ['==', prop('sector'), String(focus.sector).toLowerCase().trim()]] : byGrade;
}

// La misma regla en JavaScript (encuadre y marcadores de variantes)
function kxRouteMatchesFocus(props, focus) {
  const p = props || {};
  if (String(p.grado1 || '').toLowerCase().trim() !== String(focus.grade).toLowerCase().trim()) return false;
  return !focus.sector || String(p.sector || '').toLowerCase().trim() === String(focus.sector).toLowerCase().trim();
}

async function kxFocusGrade(ctx) {
  if (!mlMap || !ctx || !ctx.schoolId || !ctx.grade) return;
  const known = MAPLIBRE_SCHOOLS[ctx.schoolId] || (typeof mlPendingSchoolsCache !== 'undefined' && mlPendingSchoolsCache.has(ctx.schoolId));
  if (!known) { if (typeof showToast === 'function') showToast('Esta escuela aún no está disponible', 'info'); return; }

  // El mapa pasa a primer plano: se cierran fichas y popups
  hideBottomSheet();
  hideSectorBottomSheet();
  if (mlSchoolPopup) mlSchoolPopup.remove();
  if (mlSectorPopup) mlSectorPopup.remove();

  // Se acerca el mapa antes de cargar o filtrar: lejos de la escuela, la carga automática la descargaría enseguida
  const cfg = MAPLIBRE_SCHOOLS[ctx.schoolId];
  if (cfg && (mlCurrentSchool !== ctx.schoolId || mlMap.getZoom() < MIN_ZOOM_FOR_AUTO_LOAD)) mlMap.jumpTo({ center: cfg.center, zoom: Math.max(cfg.zoom, MIN_ZOOM_FOR_AUTO_LOAD) });
  if (mlCurrentSchool !== ctx.schoolId) await mlLoadSchool(ctx.schoolId, true);

  mlGradeFocus = { ...ctx, grade: String(ctx.grade).toLowerCase().trim() };
  // Un solo filtro de grado a la vez: el rango vuelve a «todos»
  mlGradeRangeMin = 0;
  mlGradeRangeMax = ALL_GRADES_ORDERED.length - 1;
  updateSliderPositions();
  updateRangeLabels();
  applyGradeFilter();
  updateFilterButtonBadge();
  kxRenderGradeFocusChip();
  kxFitToGradeFocus();
}

function kxClearGradeFocus({ apply = true } = {}) {
  if (!mlGradeFocus) return;
  mlGradeFocus = null;
  if (apply && mlMap) {
    applyGradeFilter();
    updateFilterButtonBadge();
  }
  kxRenderGradeFocusChip();
}

// Encuadra todas las vías del filtro (las del GeoJSON y las de spotters)
async function kxFitToGradeFocus() {
  const focus = mlGradeFocus;
  if (!focus || !mlMap) return;
  let feats = [];
  try { feats = await kxSchoolRouteFeatures(focus.schoolId); } catch (_) {}
  if (mlGradeFocus !== focus) return;
  const pts = [...feats, ...(kxSpotterRouteFeatures(focus.schoolId) || [])]
    .filter(f => kxRouteMatchesFocus(f.properties, focus))
    .flatMap(kxFeaturePoints);
  if (!pts.length) return;
  const b = pts.reduce((m, [x, y]) => [Math.min(m[0], x), Math.min(m[1], y), Math.max(m[2], x), Math.max(m[3], y)], [Infinity, Infinity, -Infinity, -Infinity]);
  const padding = isMobileDevice() ? { top: 150, bottom: 120, left: 40, right: 40 } : { top: 150, bottom: 90, left: 90, right: 90 };
  if (b[0] === b[2] && b[1] === b[3]) mlMap.flyTo({ center: [b[0], b[1]], zoom: 18, padding, essential: true });
  else mlMap.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding, maxZoom: 18.5, duration: 1200, essential: true });
}

// Las vías filtradas se ven desde más lejos; al quitar el filtro vuelve el zoom de la escuela
function kxApplyFocusZoom() {
  if (!mlMap) return;
  const school = mlCurrentSchool ? MAPLIBRE_SCHOOLS[mlCurrentSchool] : null;
  const normal = school ? school.zoomLevels.vias : 17;
  const min = mlGradeFocus ? Math.min(KX_FOCUS_MINZOOM, normal) : normal;
  for (const id of KX_FOCUS_LAYERS) if (mlMap.getLayer(id)) mlMap.setLayerZoomRange(id, min, 24);
  if (mlVariantZoomHandler) mlVariantZoomHandler();
}

// Las vías de spotters reciben el mismo filtro de grado que las demás (antes no se filtraban)
function kxApplyGradeToUserRoutes(gradeExpr) {
  if (!mlMap || !mlMap.getLayer('vias-usuarios-layer')) return;
  if (kxUserRoutesBaseFilter === undefined) kxUserRoutesBaseFilter = mlMap.getFilter('vias-usuarios-layer') || null;
  const base = kxUserRoutesBaseFilter;
  mlMap.setFilter('vias-usuarios-layer', gradeExpr ? (base ? ['all', base, gradeExpr] : gradeExpr) : base);
}

// Marcadores de variantes: se ven si alguna de sus vías cumple el filtro de grado activo
function kxVariantPassesGradeFilter(entry) {
  const props = entry.props || [];
  if (mlGradeFocus) return props.some(p => kxRouteMatchesFocus(p, mlGradeFocus));
  if (!isFullGradeRange()) {
    const sel = new Set(ALL_GRADES_ORDERED.slice(mlGradeRangeMin, mlGradeRangeMax + 1));
    return props.some(p => sel.has(String(p.grado1 || '').toLowerCase().trim()));
  }
  return true;
}

// Píldora del filtro activo sobre el mapa
function kxRenderGradeFocusChip() {
  let el = document.getElementById('kx-grade-focus');
  if (!mlGradeFocus) { if (el) el.remove(); return; }
  const host = document.getElementById('map');
  if (!host) return;
  if (!el) {
    el = document.createElement('div');
    el.id = 'kx-grade-focus';
    el.className = 'kx-gfocus';
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-kx-unfocus]')) kxClearGradeFocus();
      else if (e.target.closest('[data-kx-refocus]')) kxReopenGradeChart();
    });
    host.appendChild(el);
  }
  const f = mlGradeFocus;
  const school = MAPLIBRE_SCHOOLS[f.schoolId];
  el.innerHTML = kxGradeFocusChipHTML({ grade: f.grade, count: f.count, where: [school && school.name, f.sector].filter(Boolean).join(' · ') });
}

// Vuelve al gráfico de donde salió el filtro, con el grado ya seleccionado
function kxReopenGradeChart() {
  const f = mlGradeFocus;
  if (!f) return;
  kxPendingChartGrade = f.grade;
  // El gráfico de grados vive en las fichas de sector; la de escuela conserva su donut
  if (f.sector && f.sectorProps && f.coords) mlOpenStaticSector(f.sectorProps, f.coords);
}

/**
 * Actualiza el indicador visual del botón de filtro
 */
function updateFilterButtonBadge() {
  const btn = document.getElementById('btn-grade-filter');
  if (!btn) return;

  if (!isFullGradeRange() || mlGradeFocus || mlShowOnlyMyRoutes || mlShowOnlyProjects) {
    btn.classList.add('has-filter');
  } else {
    btn.classList.remove('has-filter');
  }
}

/**
 * Abre la leyenda unificada (Símbolos + Colores) con tabs
 */
function openGradeLegendModal() { openLegendModal('col'); }
function openSymbolsLegendModal() { openLegendModal('sym'); }

function openLegendModal(initialTab = 'sym') {
  closeGradeFilterPanel();

  const existing = document.getElementById('grade-legend-modal');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'grade-legend-modal';
  overlay.className = 'grade-legend-overlay';
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  const legendGroups = [
    { title: 'Principiante · 3–4', grades: ['3a','3b','3c','4a','4b','4c'] },
    { title: 'Fácil · 5',          grades: ['5a','5a+','5b','5b+','5c','5c+'] },
    { title: 'Medio · 6A–6B',      grades: ['6a','6a+','6b','6b+'] },
    { title: 'Medio-alto · 6C–7A', grades: ['6c','6c+','7a','7a+'] },
    { title: 'Difícil · 7B–7C',    grades: ['7b','7b+','7c','7c+'] },
    { title: 'Muy difícil · 8',    grades: ['8a','8a+','8b','8b+','8c','8c+'] },
    { title: 'Élite · 9',          grades: ['9a','9a+','9b','9b+','9c','9c+'] }
  ];

  let colorsPane = '';
  legendGroups.forEach(group => {
    colorsPane += `<div class="gl2-group">
      <p class="gl2-group-title">${group.title}</p>
      <div class="gl2-pills">`;
    group.grades.forEach(grade => {
      const bg  = MAPLIBRE_GRADE_COLORS[grade] || '#888';
      const col = isLightColor(bg) ? '#1f2937' : '#fff';
      colorsPane += `<span class="gl2-pill" style="background:${bg};color:${col}">${grade}</span>`;
    });
    colorsPane += `</div></div>`;
  });

  const symbols = [
    { title: 'Vía deportiva',        desc: 'Cada círculo es una vía. El color indica el grado de dificultad. Pulsa para ver detalles, fotos y croquis.', svg: `<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="9" fill="#22c55e" stroke="#fff" stroke-width="2"/></svg>` },
    { title: 'Vía hecha (tick)',      desc: 'Vía registrada en tu logbook. El check blanco sobre el círculo de grado indica que ya la has encadenado.', svg: `<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="11" fill="#22c55e" stroke="#fff" stroke-width="2"/><polyline points="10,17 14,21 22,12" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>` },
    { title: 'Vías con variantes',    desc: 'Grupo de vías que comparten salida. El círculo central es la vía principal y cada anillo es una variante con su grado.', svg: `<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="14" fill="none" stroke="#fff" stroke-width="1.5"/><circle cx="16" cy="16" r="13" fill="none" stroke="#3b82f6" stroke-width="2.5"/><circle cx="16" cy="16" r="9.5" fill="none" stroke="#fff" stroke-width="1"/><circle cx="16" cy="16" r="8.5" fill="none" stroke="#f59e0b" stroke-width="2.5"/><circle cx="16" cy="16" r="5" fill="#ef4444"/></svg>` },
    { title: 'Sector',                desc: 'Línea coloreada que delimita un sector de escalada. Pulsa para ver su nombre y la lista de vías.', svg: `<svg viewBox="0 0 32 32"><path d="M3 22 C 9 8, 22 26, 29 10" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" opacity="0.7"/><path d="M3 22 C 9 8, 22 26, 29 10" fill="none" stroke="#a855f7" stroke-width="3.5" stroke-linecap="round"/></svg>` },
    { title: 'Ruta de acceso',        desc: 'Sendero de aproximación al sector representado con línea naranja discontinua.', svg: `<svg viewBox="0 0 32 32"><path d="M3 26 C 10 22, 14 10, 22 8 L 29 6" fill="none" stroke="#FF6B00" stroke-width="3" stroke-linecap="round" stroke-dasharray="4 3"/></svg>` },
    { title: 'Parking',               desc: 'Aparcamiento recomendado para acceder al sector. Pulsa para abrir la navegación.', svg: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="#4285f4" stroke="#fff" stroke-width="2"/><text x="12" y="17" text-anchor="middle" fill="#fff" font-size="14" font-weight="bold" font-family="sans-serif">P</text></svg>` },
    { title: 'Punto de interés (POI)', desc: 'Fuente, refugio, mirador, baño, bar, peligro… El emoji identifica el tipo.', svg: `<svg viewBox="0 0 32 32"><text x="16" y="22" text-anchor="middle" font-size="20">🚰</text></svg>` },
    { title: 'Escuela abierta',        desc: 'Escuela con cartografía publicada. Pulsa el icono verde para entrar y explorar sus sectores y vías.', svg: `<svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="22" fill="#22c55e"/><circle cx="24" cy="24" r="20" fill="none" stroke="rgba(255,255,255,0.4)" stroke-width="2"/><g fill="#fff"><path d="M24 10 L36 32 L12 32 Z" opacity="0.95"/><path d="M16 20 L24 32 L8 32 Z" opacity="0.7"/></g></svg>` },
    { title: 'Escuela en desarrollo',  desc: 'Escuela con datos parciales o en construcción. El martillo indica que falta cartografía.', svg: `<svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="22" fill="#f59e0b"/><circle cx="24" cy="24" r="20" fill="none" stroke="rgba(255,255,255,0.4)" stroke-width="2"/><g fill="#fff"><path d="M24 10 L36 32 L12 32 Z" opacity="0.95"/><path d="M16 20 L24 32 L8 32 Z" opacity="0.7"/></g><g transform="translate(36,10)"><circle cx="0" cy="0" r="8" fill="#fff" stroke="#f59e0b" stroke-width="1.5"/><text x="0" y="3.5" text-anchor="middle" font-size="10">🔨</text></g></svg>` }
  ];

  let symPane = '';
  symbols.forEach(s => {
    symPane += `
      <div class="gl2-sym-row">
        <div class="gl2-sym-icon">${s.svg}</div>
        <div>
          <p class="gl2-sym-title">${s.title}</p>
          <p class="gl2-sym-desc">${s.desc}</p>
        </div>
      </div>`;
  });

  const isSym = initialTab === 'sym';
  overlay.innerHTML = `
    <div class="gl2-content">
      <div class="gl2-header">
        <div style="display:flex;align-items:center;gap:10px;">
          <div class="gl2-header-icon">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6l9-3 9 3v13l-9 3-9-3z"/><path d="M12 3v17"/><path d="M3 6l9 3 9-3"/></svg>
          </div>
          <span class="gl2-header-title">Leyenda del mapa</span>
        </div>
        <button class="gl2-close" onclick="document.getElementById('grade-legend-modal').remove()">✕</button>
      </div>
      <div class="gl2-tabs">
        <button class="gl2-tab ${isSym ? 'gl2-tab--active' : ''}" id="gl2-tab-sym" onclick="legendSwitchTab('sym')">Símbolos</button>
        <button class="gl2-tab ${!isSym ? 'gl2-tab--active' : ''}" id="gl2-tab-col" onclick="legendSwitchTab('col')">Colores</button>
      </div>
      <div id="gl2-pane-sym" class="gl2-pane" style="display:${isSym ? 'flex' : 'none'};flex-direction:column;gap:2px;">
        ${symPane}
      </div>
      <div id="gl2-pane-col" class="gl2-pane" style="display:${!isSym ? 'block' : 'none'};">
        ${colorsPane}
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
}

function legendSwitchTab(tab) {
  const sym = document.getElementById('gl2-pane-sym');
  const col = document.getElementById('gl2-pane-col');
  const tSym = document.getElementById('gl2-tab-sym');
  const tCol = document.getElementById('gl2-tab-col');
  if (!sym) return;
  if (tab === 'sym') {
    sym.style.display = 'flex';
    col.style.display = 'none';
    tSym.classList.add('gl2-tab--active');
    tCol.classList.remove('gl2-tab--active');
  } else {
    sym.style.display = 'none';
    col.style.display = 'block';
    tCol.classList.add('gl2-tab--active');
    tSym.classList.remove('gl2-tab--active');
  }
}

// ============================================================
//  BOTÓN DE INFORMACIÓN / LEYENDA DEL MAPA
// ============================================================

let mlInfoLegendPanelOpen = false;

function addInfoLegendButton() {
  if (document.getElementById('btn-info-legend')) return;

  const container = document.getElementById('map');
  if (!container) return;

  const btn = document.createElement('button');
  btn.id = 'btn-info-legend';
  btn.className = 'map-control-btn info-legend-btn';
  btn.title = 'Leyenda del mapa';
  btn.type = 'button';
  btn.setAttribute('aria-label', 'Leyenda del mapa');
  btn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><line x1="12" y1="16" x2="12" y2="11.5"/><circle cx="12" cy="8.25" r="0.6" fill="currentColor" stroke="none"/></svg>`;
  // Aspecto en app_2.css (MAPA — CONTROLES)

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleLegendPanel();
  });

  // Esquina superior derecha de la barra del mapa
  (document.getElementById('map-topbar') || container).appendChild(btn);

  // Panel de leyenda anclado al botón "i"
  const panel = document.createElement('div');
  panel.id = 'legend-panel';
  panel.className = 'legend-panel';
  panel.innerHTML = buildLegendPanelHTML();
  container.appendChild(panel);

  // Cerrar al pulsar fuera (también con pointerdown, por iOS)
  const closeLegendOnOutside = (e) => {
    const p = document.getElementById('legend-panel');
    const b = document.getElementById('btn-info-legend');
    if (p && b && !p.contains(e.target) && !b.contains(e.target)) {
      closeLegendPanel();
    }
  };
  document.addEventListener('click', closeLegendOnOutside);
  document.addEventListener('pointerdown', closeLegendOnOutside);
}

function buildLegendPanelHTML() {
  const legendGroups = [
    { title: 'Principiante · 3–4', grades: ['3a','3b','3c','4a','4b','4c'] },
    { title: 'Fácil · 5',          grades: ['5a','5a+','5b','5b+','5c','5c+'] },
    { title: 'Medio · 6A–6B',      grades: ['6a','6a+','6b','6b+'] },
    { title: 'Medio-alto · 6C–7A', grades: ['6c','6c+','7a','7a+'] },
    { title: 'Difícil · 7B–7C',    grades: ['7b','7b+','7c','7c+'] },
    { title: 'Muy difícil · 8',    grades: ['8a','8a+','8b','8b+','8c','8c+'] },
    { title: 'Élite · 9',          grades: ['9a','9a+','9b','9b+','9c','9c+'] }
  ];

  let colorsPane = '';
  legendGroups.forEach(group => {
    colorsPane += `<div class="gl2-group"><p class="gl2-group-title">${group.title}</p><div class="gl2-pills">`;
    group.grades.forEach(grade => {
      const bg  = MAPLIBRE_GRADE_COLORS[grade] || '#888';
      const col = isLightColor(bg) ? '#1f2937' : '#fff';
      colorsPane += `<span class="gl2-pill" style="background:${bg};color:${col}">${grade}</span>`;
    });
    colorsPane += `</div></div>`;
  });

  const symbols = [
    { title: 'Vía deportiva',         desc: 'Cada círculo es una vía. El color indica el grado.', svg: `<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="9" fill="#22c55e" stroke="#fff" stroke-width="2"/></svg>` },
    { title: 'Vía hecha (tick)',       desc: 'Vía encadenada registrada en tu logbook.', svg: `<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="11" fill="#22c55e" stroke="#fff" stroke-width="2"/><polyline points="10,17 14,21 22,12" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>` },
    { title: 'Vías con variantes',     desc: 'Grupo con salida común. Cada anillo es una variante.', svg: `<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="13" fill="none" stroke="#3b82f6" stroke-width="2.5"/><circle cx="16" cy="16" r="8.5" fill="none" stroke="#f59e0b" stroke-width="2.5"/><circle cx="16" cy="16" r="5" fill="#ef4444"/></svg>` },
    { title: 'Sector',                 desc: 'Línea coloreada que delimita un sector.', svg: `<svg viewBox="0 0 32 32"><path d="M3 22 C 9 8, 22 26, 29 10" fill="none" stroke="#a855f7" stroke-width="3.5" stroke-linecap="round"/></svg>` },
    { title: 'Ruta de acceso',         desc: 'Sendero de aproximación (línea naranja discontinua).', svg: `<svg viewBox="0 0 32 32"><path d="M3 26 C 10 22, 14 10, 22 8 L 29 6" fill="none" stroke="#FF6B00" stroke-width="3" stroke-linecap="round" stroke-dasharray="4 3"/></svg>` },
    { title: 'Parking',                desc: 'Aparcamiento recomendado. Pulsa para navegación.', svg: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="#4285f4" stroke="#fff" stroke-width="2"/><text x="12" y="17" text-anchor="middle" fill="#fff" font-size="14" font-weight="bold" font-family="sans-serif">P</text></svg>` },
    { title: 'Punto de interés (POI)', desc: 'Fuente, refugio, bar, peligro… El emoji indica el tipo.', svg: `<svg viewBox="0 0 32 32"><text x="16" y="22" text-anchor="middle" font-size="20">🚰</text></svg>` },
    { title: 'Escuela abierta',        desc: 'Cartografía publicada. Pulsa para explorar.', svg: `<svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="22" fill="#22c55e"/><g fill="#fff"><path d="M24 10 L36 32 L12 32 Z" opacity="0.95"/><path d="M16 20 L24 32 L8 32 Z" opacity="0.7"/></g></svg>` },
    { title: 'Escuela en desarrollo',  desc: 'Datos parciales o en construcción.', svg: `<svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="22" fill="#f59e0b"/><g fill="#fff"><path d="M24 10 L36 32 L12 32 Z" opacity="0.95"/><path d="M16 20 L24 32 L8 32 Z" opacity="0.7"/></g></svg>` }
  ];

  let symPane = '';
  symbols.forEach(s => {
    symPane += `<div class="gl2-sym-row"><div class="gl2-sym-icon">${s.svg}</div><div><p class="gl2-sym-title">${s.title}</p><p class="gl2-sym-desc">${s.desc}</p></div></div>`;
  });

  return `
    <div class="lp-header">
      <span class="lp-title">Leyenda del mapa</span>
    </div>
    <div class="lp-tabs">
      <button class="lp-tab lp-tab--active" id="lp-tab-sym" onclick="lpSwitchTab('sym')">Símbolos</button>
      <button class="lp-tab" id="lp-tab-col" onclick="lpSwitchTab('col')">Colores</button>
    </div>
    <div id="lp-pane-sym" class="lp-pane" style="display:flex;flex-direction:column;gap:2px;">${symPane}</div>
    <div id="lp-pane-col" class="lp-pane" style="display:none;">${colorsPane}</div>
  `;
}

function toggleLegendPanel() {
  const panel = document.getElementById('legend-panel');
  if (!panel) return;
  if (panel.classList.contains('open')) {
    closeLegendPanel();
  } else {
    closeGradeFilterPanel();
    panel.classList.add('open');
  }
}

function closeLegendPanel() {
  const panel = document.getElementById('legend-panel');
  if (panel) panel.classList.remove('open');
}

function lpSwitchTab(tab) {
  const sym = document.getElementById('lp-pane-sym');
  const col = document.getElementById('lp-pane-col');
  const tSym = document.getElementById('lp-tab-sym');
  const tCol = document.getElementById('lp-tab-col');
  if (!sym) return;
  if (tab === 'sym') {
    sym.style.display = 'flex'; col.style.display = 'none';
    tSym.classList.add('lp-tab--active'); tCol.classList.remove('lp-tab--active');
  } else {
    sym.style.display = 'none'; col.style.display = 'block';
    tCol.classList.add('lp-tab--active'); tSym.classList.remove('lp-tab--active');
  }
}

// Devuelve color de texto (#000 o #fff) con contraste adecuado sobre un color hex
function ilpContrastColor(hex) {
  if (!hex || hex.length < 7) return '#ffffff';
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.55 ? '#1a1a1a' : '#ffffff';
}

function buildInfoLegendModalHTML() {
  // ---- Tab Colores ----
  const legendGroups = [
    { label: 'PRINCIPIANTE · 3-4', grades: ['3a','3b','3c','4a','4b','4c'] },
    { label: 'FÁCIL · 5',          grades: ['5a','5a+','5b','5b+','5c','5c+'] },
    { label: 'MEDIO · 6A-6B',      grades: ['6a','6a+','6b','6b+'] },
    { label: 'MEDIO-ALTO · 6C-7A', grades: ['6c','6c+','7a','7a+'] },
    { label: 'DIFÍCIL · 7B-7C',    grades: ['7b','7b+','7c','7c+'] },
    { label: 'MUY DIFÍCIL · 8',    grades: ['8a','8a+','8b','8b+','8c','8c+'] },
    { label: 'ÉLITE · 9',          grades: ['9a','9a+','9b','9b+','9c','9c+'] }
  ];

  let colorsHTML = '';
  legendGroups.forEach(group => {
    colorsHTML += `<div class="ilp-grade-group">
      <div class="ilp-grade-group-label">${group.label}</div>
      <div class="ilp-grade-chips">`;
    group.grades.forEach(grade => {
      const bg = typeof MAPLIBRE_GRADE_COLORS !== 'undefined'
        ? (MAPLIBRE_GRADE_COLORS[grade] || '#888')
        : '#888';
      const fg = ilpContrastColor(bg);
      colorsHTML += `<span class="ilp-grade-chip" style="background:${bg};color:${fg}">${grade}</span>`;
    });
    colorsHTML += `</div></div>`;
  });

  // ---- Tab Símbolos ----
  const symbols = [
    {
      title: 'Vía deportiva',
      badge: null,
      desc: 'Cada círculo es una vía. El color indica la dificultad.',
      iconBg: '#dcfce7',
      svg: `<svg viewBox="0 0 32 32" width="32" height="32"><circle cx="16" cy="16" r="9" fill="#22c55e" stroke="#fff" stroke-width="2"/></svg>`
    },
    {
      title: 'Vía hecha',
      badge: 'tick',
      desc: 'Vía encadenada y registrada en tu logbook.',
      iconBg: '#dcfce7',
      svg: `<svg viewBox="0 0 32 32" width="32" height="32"><circle cx="16" cy="16" r="11" fill="#22c55e" stroke="#fff" stroke-width="1.5"/><polyline points="10,17 14,21 22,12" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`
    },
    {
      title: 'Vías con variantes',
      badge: null,
      desc: 'Grupo con salida común. Cada anillo es una variante.',
      iconBg: '#fef9ee',
      svg: `<svg viewBox="0 0 32 32" width="32" height="32"><circle cx="16" cy="16" r="13" fill="none" stroke="#3b82f6" stroke-width="2"/><circle cx="16" cy="16" r="9" fill="none" stroke="#f59e0b" stroke-width="2"/><circle cx="16" cy="16" r="5" fill="#ef4444"/></svg>`
    },
    {
      title: 'Sector',
      badge: null,
      desc: 'Línea coloreada que delimita un sector de escalada.',
      iconBg: '#f3e8ff',
      svg: `<svg viewBox="0 0 32 32" width="32" height="32"><path d="M4 24 C 10 10, 22 28, 28 10" fill="none" stroke="#a855f7" stroke-width="3" stroke-linecap="round"/></svg>`
    },
    {
      title: 'Ruta de acceso',
      badge: null,
      desc: 'Sendero de aproximación (línea naranja discontinua).',
      iconBg: '#fff7ed',
      svg: `<svg viewBox="0 0 32 32" width="32" height="32"><path d="M4 26 C 10 22, 16 10, 28 6" fill="none" stroke="#f97316" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="4 3"/></svg>`
    },
    {
      title: 'Parking',
      badge: null,
      desc: 'Aparcamiento recomendado. Pulsa para ver indicaciones.',
      iconBg: '#dbeafe',
      svg: `<svg viewBox="0 0 32 32" width="32" height="32"><circle cx="16" cy="16" r="12" fill="#4285f4"/><text x="16" y="21" text-anchor="middle" fill="#fff" font-size="14" font-weight="bold" font-family="sans-serif">P</text></svg>`
    },
    {
      title: 'Punto de interés (POI)',
      badge: null,
      desc: 'Fuente, refugio, bar, peligro… El emoji indica el tipo.',
      iconBg: '#f3f4f6',
      svg: `<svg viewBox="0 0 32 32" width="32" height="32"><text x="16" y="23" text-anchor="middle" font-size="20">🚰</text></svg>`
    },
    {
      title: 'Escuela abierta',
      badge: null,
      desc: 'Cartografía publicada. Pulsa para explorar sectores y vías.',
      iconBg: '#dcfce7',
      svg: `<svg viewBox="0 0 48 48" width="32" height="32"><circle cx="24" cy="24" r="22" fill="#22c55e"/><g fill="#fff"><path d="M24 10 L36 32 L12 32 Z" opacity="0.95"/><path d="M16 20 L24 32 L8 32 Z" opacity="0.7"/></g></svg>`
    },
    {
      title: 'Escuela en desarrollo',
      badge: null,
      desc: 'Datos parciales o en construcción.',
      iconBg: '#fef9c3',
      svg: `<svg viewBox="0 0 48 48" width="32" height="32"><circle cx="24" cy="24" r="22" fill="#f59e0b"/><g fill="#fff"><path d="M24 10 L36 32 L12 32 Z" opacity="0.95"/><path d="M16 20 L24 32 L8 32 Z" opacity="0.7"/></g></svg>`
    }
  ];

  let symbolsHTML = '';
  symbols.forEach(s => {
    const badge = s.badge
      ? `<span class="ilp-badge">${s.badge}</span>`
      : '';
    symbolsHTML += `
      <div class="ilp-symbol-item">
        <div class="ilp-symbol-icon-wrap" style="background:${s.iconBg}">${s.svg}</div>
        <div class="ilp-symbol-info">
          <div class="ilp-symbol-title">${s.title}${badge}</div>
          <div class="ilp-symbol-desc">${s.desc}</div>
        </div>
      </div>`;
  });

  return `
    <div class="ilp-header">
      <span class="ilp-map-icon">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/>
          <line x1="8" y1="2" x2="8" y2="18"/>
          <line x1="16" y1="6" x2="16" y2="22"/>
        </svg>
      </span>
      <span class="ilp-title">Leyenda del mapa</span>
      <button class="ilp-close-btn" onclick="closeInfoLegendPanel()">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>

    <div class="ilp-tabs-row">
      <button class="ilp-tab active" onclick="switchInfoLegendTab('symbols', this)">Símbolos</button>
      <button class="ilp-tab" onclick="switchInfoLegendTab('colors', this)">Grados</button>
    </div>

    <div class="ilp-body">
      <div id="ilp-tab-symbols" class="ilp-tab-content">
        ${symbolsHTML}
      </div>
      <div id="ilp-tab-colors" class="ilp-tab-content ilp-hidden">
        ${colorsHTML}
      </div>
    </div>
  `;
}

function toggleInfoLegendPanel() {
  if (mlInfoLegendPanelOpen) {
    closeInfoLegendPanel();
  } else {
    openInfoLegendPanel();
  }
}

function openInfoLegendPanel() {
  const panel = document.getElementById('info-legend-panel');
  const btn   = document.getElementById('btn-info-legend');
  if (!panel) return;
  closeGradeFilterPanel();
  panel.classList.add('open');
  if (btn) btn.classList.add('active');
  mlInfoLegendPanelOpen = true;
}

function closeInfoLegendPanel() {
  const panel = document.getElementById('info-legend-panel');
  const btn   = document.getElementById('btn-info-legend');
  if (!panel) return;
  panel.classList.remove('open');
  if (btn) btn.classList.remove('active');
  mlInfoLegendPanelOpen = false;
}

function switchInfoLegendTab(tab, btnEl) {
  const symbolsPanel = document.getElementById('ilp-tab-symbols');
  const colorsPanel  = document.getElementById('ilp-tab-colors');
  document.querySelectorAll('#info-legend-panel .ilp-tab')
    .forEach(t => t.classList.remove('active'));
  if (btnEl) btnEl.classList.add('active');
  if (tab === 'symbols') {
    symbolsPanel.classList.remove('ilp-hidden');
    colorsPanel.classList.add('ilp-hidden');
  } else {
    colorsPanel.classList.remove('ilp-hidden');
    symbolsPanel.classList.add('ilp-hidden');
  }
}

// Exponer funciones para uso desde HTML onclick
window.resetGradeFilter = resetGradeFilter;
window.openGradeLegendModal = openGradeLegendModal;
window.openSymbolsLegendModal = openSymbolsLegendModal;
window.closeInfoLegendPanel = closeInfoLegendPanel;
window.switchInfoLegendTab = switchInfoLegendTab;

// Exponer función para uso externo
window.loadApprovedRoutesFromFirestore = loadApprovedRoutesFromFirestore;
window.loadApprovedPOIFromFirestore = loadApprovedPOIFromFirestore;
window.loadApprovedSectorsFromFirestore = loadApprovedSectorsFromFirestore;
window.loadApprovedSchoolsFromFirestore = loadApprovedSchoolsFromFirestore;
window.mlPendingSchoolsCache = mlPendingSchoolsCache;
window.updateAscentTicksLayer = updateAscentTicksLayer;
window.mlCloseRoutePopup = () => { if (mlRoutePopup) mlRoutePopup.remove(); };
window.mlDeletePendingItem = mlDeletePendingItem;
window.mlStartEditPending = mlStartEditPending;
window.mlSavePendingEdit = mlSavePendingEdit;
window.mlCancelPendingEdit = mlCancelPendingEdit;

// Debug: llamar desde la consola del navegador con debugApprovedItems()
window.debugApprovedItems = async function() {
  if (typeof firebase === 'undefined' || !firebase.firestore) {
    console.error('Firebase no disponible');
    return;
  }
  const db = firebase.firestore();
  const collections = ['pending_poi', 'pending_sectors', 'pending_schools', 'pending_routes'];
  for (const col of collections) {
    try {
      const snap = await db.collection(col).get();
      console.log(`%c=== ${col} === (${snap.size} docs total)`, 'color: #E91E63; font-weight: bold; font-size: 14px');
      snap.forEach(doc => {
        const d = doc.data();
        console.log(`  ${doc.id}: status=${d.status}, schoolId=${d.schoolId}, coords=${JSON.stringify(d.coordinates || d.vertices?.length + ' vertices')}`);
      });
    } catch (err) {
      console.error(`  ${col}: ERROR - ${err.message}`);
    }
  }
  console.log(`%cEscuela actual: ${mlCurrentSchool}`, 'color: #9C27B0; font-weight: bold');
  console.log(`%cZoom actual: ${mlMap?.getZoom()?.toFixed(1)}`, 'color: #9C27B0; font-weight: bold');
  // Listar capas de usuarios activas
  if (mlMap) {
    const userLayers = mlMap.getStyle().layers.filter(l => l.id.includes('usuario'));
    console.log(`%cCapas de usuarios en el mapa: ${userLayers.length}`, 'color: #9C27B0; font-weight: bold');
    userLayers.forEach(l => console.log(`  - ${l.id} (minzoom: ${l.minzoom || 'none'})`));
  }
};

console.log('MapLibre Map JS cargado');

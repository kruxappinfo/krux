// ================== KRUX MAPA BASE ==================
// Estilo del mapa base en dos vistas que comparten fuentes y capas:
//  - «sat»:  ortofoto del PNOA con senderos, curvas de nivel, picos y rótulos encima.
//  - «topo»: mapa topográfico vectorial con la paleta KRUX (tiza, salvia, bosque) y relieve sombreado.
// Las dos vistas viven en el mismo estilo: cambiar de una a otra solo alterna visibilidad y colores, sin
// `setStyle`, así que las capas de la app (sectores, vías, sol y sombra…) no se pierden.
// Sin clave de MapTiler solo queda la ortofoto, sin rótulos ni selector.
// La construcción del estilo no usa DOM ni red (se prueba en Node); el selector va al final (KxBaseMap).

// ============================================
// CONSTANTES
// ============================================
const KXBASE_DEFAULT = 'sat';
const KXBASE_STORAGE = 'kx-map-base';
const KXBASE_SUN_ANCHOR = 'kx-contour';   // sol y sombra se pinta justo debajo de las curvas de nivel
const KXBASE_PNOA = 'https://www.ign.es/wmts/pnoa-ma?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=OI.OrthoimageCoverage&STYLE=default&TILEMATRIXSET=GoogleMapsCompatible&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/jpeg';
const KXBASE_MAPTILER_ATTR = '© <a href="https://www.maptiler.com/">MapTiler</a> © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

// Colores de cada vista. «topo» sale de los colores corporativos; «sat» es blanco sobre la foto.
const KXBASE_THEME = {
  sat: {
    ink: '#FFFFFF', ink2: 'rgba(255,255,255,0.92)', halo: 'rgba(10,16,13,0.8)', waterInk: '#CFE9F7', peak: '#FFFFFF',
    contour: 'rgba(255,255,255,0.16)', contourIdx: 'rgba(255,255,255,0.34)', contourInk: '#FFFFFF', contourHalo: 'rgba(10,16,13,0.7)',
    path: '#FFFFFF', pathOpacity: 0.7, trackOpacity: 0.75,
    hsShadow: '#0C1A14', hsLight: '#FFF6E0', hsAccent: '#0C1A14', hs: 0.14
  },
  topo: {
    ink: '#202923', ink2: '#44504A', halo: 'rgba(247,246,240,0.92)', waterInk: '#2C69A9', peak: '#153E35',
    contour: 'rgba(120,98,70,0.30)', contourIdx: 'rgba(120,98,70,0.55)', contourInk: '#7A6347', contourHalo: 'rgba(247,246,240,0.92)',
    path: '#153E35', pathOpacity: 0.6, trackOpacity: 0.55,
    hsShadow: '#3B4A40', hsLight: '#FFFFFF', hsAccent: '#5A665F', hs: 0.42,
    bg: '#F1EFE6', wood: '#D5E4D3', grass: '#E4ECD9', farm: '#EFEBDC', rock: '#E6E3D9', water: '#B9D6E2', waterLine: '#8FBCD0',
    road: '#FFFFFF', roadCase: 'rgba(32,41,35,0.22)', major: '#FBE9C8', building: '#DAD5C8'
  }
};

// ============================================
// CAPAS
// ============================================
// Cada capa puede llevar `only` (vista en la que se ve) y `by` (función que da la pintura según el tema).
// kxBaseStyle las resuelve y deja ambas cosas en `metadata` para poder cambiar de vista en caliente.
function kxBaseLayerDefs() {
  const name = ['coalesce', ['get', 'name:es'], ['get', 'name']];
  const cls = c => ['in', ['get', 'class'], ['literal', c]];
  const zoomW = (z0, a, z1, b) => ['interpolate', ['linear'], ['zoom'], z0, a, z1, b];
  const roadW = (a, b) => ['interpolate', ['exponential', 1.5], ['zoom'], 8, a, 17, b];
  const round = { 'line-cap': 'round', 'line-join': 'round' };
  const omt = (id, type, layer, rest) => ({ id, type, source: 'labels-source', 'source-layer': layer, ...rest });
  const fill = (id, layer, filter, key, paint = {}) => omt(id, 'fill', layer, {
    only: 'topo', ...(filter ? { filter } : {}), paint: { 'fill-color': KXBASE_THEME.topo[key], ...paint }
  });
  const text = (c, w = 1.6) => t => ({ 'text-color': t[c], 'text-halo-color': t.halo, 'text-halo-width': w, 'text-halo-blur': 0.5 });
  const contour = (id, rest) => ({ id, source: 'contours-source', 'source-layer': 'contour', ...rest });

  return [
    // --- Fondo ---
    { id: 'kx-topo-bg', type: 'background', only: 'topo', paint: { 'background-color': KXBASE_THEME.topo.bg } },
    { id: 'pnoa-layer', type: 'raster', source: 'pnoa-source', only: 'sat', minzoom: 0, maxzoom: 22,
      paint: { 'raster-saturation': -0.06, 'raster-contrast': 0.06 } },
    fill('kx-topo-farm', 'landcover', cls(['farmland']), 'farm'),
    fill('kx-topo-grass', 'landcover', cls(['grass']), 'grass'),
    fill('kx-topo-wood', 'landcover', cls(['wood']), 'wood'),
    fill('kx-topo-rock', 'landcover', cls(['rock', 'sand']), 'rock'),
    fill('kx-topo-park', 'park', null, 'wood', { 'fill-opacity': 0.25 }),

    // --- Relieve ---
    { id: 'kx-hillshade', type: 'hillshade', source: 'relief-source',
      by: t => ({ 'hillshade-exaggeration': t.hs, 'hillshade-shadow-color': t.hsShadow, 'hillshade-highlight-color': t.hsLight, 'hillshade-accent-color': t.hsAccent }) },
    contour(KXBASE_SUN_ANCHOR, { type: 'line', minzoom: 12, filter: ['!=', ['get', 'nth_line'], 5],
      paint: { 'line-width': 0.6 }, by: t => ({ 'line-color': t.contour }) }),
    contour('kx-contour-index', { type: 'line', minzoom: 11, filter: ['==', ['get', 'nth_line'], 5],
      paint: { 'line-width': zoomW(11, 0.7, 15, 1.3) }, by: t => ({ 'line-color': t.contourIdx }) }),
    contour('kx-contour-label', { type: 'symbol', minzoom: 13, filter: ['==', ['get', 'nth_line'], 5],
      layout: { 'symbol-placement': 'line', 'text-field': ['to-string', ['get', 'height']], 'text-font': ['Noto Sans Regular'], 'text-size': 9.5, 'symbol-spacing': 320 },
      by: t => ({ 'text-color': t.contourInk, 'text-halo-color': t.contourHalo, 'text-halo-width': 1.2 }) }),

    // --- Agua y edificios (solo topográfico: en la ortofoto ya se ven) ---
    omt('kx-topo-waterway', 'line', 'waterway', { only: 'topo', paint: { 'line-color': KXBASE_THEME.topo.waterLine, 'line-width': zoomW(9, 0.5, 16, 2) } }),
    fill('kx-topo-water', 'water', null, 'water'),
    fill('kx-topo-building', 'building', null, 'building', { 'fill-opacity': zoomW(13, 0, 14.5, 1) }),

    // --- Senderos, pistas y carreteras ---
    omt('kx-path-casing', 'line', 'transportation', { only: 'sat', minzoom: 13, filter: cls(['path', 'track']), layout: { 'line-cap': 'round' },
      paint: { 'line-color': 'rgba(10,16,13,0.35)', 'line-width': zoomW(13, 1.4, 17, 4) } }),
    omt('kx-track', 'line', 'transportation', { minzoom: 12.5, filter: cls(['track']),
      paint: { 'line-width': zoomW(12.5, 0.7, 17, 2.2), 'line-dasharray': [5, 2] }, by: t => ({ 'line-color': t.path, 'line-opacity': t.trackOpacity }) }),
    omt('kx-path', 'line', 'transportation', { minzoom: 13, filter: cls(['path']),
      paint: { 'line-width': zoomW(13, 0.6, 17, 2), 'line-dasharray': [2, 1.6] }, by: t => ({ 'line-color': t.path, 'line-opacity': t.pathOpacity }) }),
    omt('kx-sat-road', 'line', 'transportation', { only: 'sat', minzoom: 11, filter: cls(['minor', 'tertiary', 'secondary', 'primary', 'trunk', 'motorway']),
      layout: { 'line-cap': 'round' }, paint: { 'line-color': '#FFFFFF', 'line-opacity': 0.35, 'line-width': zoomW(11, 0.8, 17, 4) } }),
    omt('kx-topo-road-casing', 'line', 'transportation', { only: 'topo', minzoom: 9, filter: cls(['minor', 'service', 'tertiary', 'secondary', 'primary', 'trunk', 'motorway']),
      layout: round, paint: { 'line-color': KXBASE_THEME.topo.roadCase, 'line-width': roadW(1.2, 9) } }),
    omt('kx-topo-road-minor', 'line', 'transportation', { only: 'topo', minzoom: 11, filter: cls(['minor', 'service', 'tertiary']),
      layout: round, paint: { 'line-color': KXBASE_THEME.topo.road, 'line-width': roadW(0.5, 6) } }),
    omt('kx-topo-road-major', 'line', 'transportation', { only: 'topo', filter: cls(['secondary', 'primary', 'trunk', 'motorway']),
      layout: round, paint: { 'line-color': KXBASE_THEME.topo.major, 'line-width': roadW(0.9, 7.5) } }),

    // --- Rótulos (de menor a mayor prioridad) ---
    omt('labels-roads', 'symbol', 'transportation_name', { minzoom: 13.5, filter: cls(['primary', 'secondary', 'tertiary', 'minor', 'track', 'path']),
      layout: { 'text-field': name, 'text-font': ['Noto Sans Regular'], 'text-size': 10.5, 'symbol-placement': 'line', 'text-letter-spacing': 0.04 }, by: text('ink2', 1.3) }),
    omt('labels-water', 'symbol', 'water_name', { minzoom: 10,
      layout: { 'text-field': name, 'text-font': ['Noto Sans Italic'], 'text-size': 12, 'text-max-width': 7, 'text-letter-spacing': 0.06 }, by: text('waterInk') }),
    omt('labels-stream', 'symbol', 'waterway', { minzoom: 13, filter: ['has', 'name'],
      layout: { 'text-field': name, 'text-font': ['Noto Sans Italic'], 'text-size': 10.5, 'symbol-placement': 'line', 'text-letter-spacing': 0.08 }, by: text('waterInk', 1.3) }),
    omt('labels-peak-dot', 'circle', 'mountain_peak', { minzoom: 10.5, filter: ['has', 'name'],
      paint: { 'circle-radius': 2.4, 'circle-stroke-width': 1.2 }, by: t => ({ 'circle-color': t.peak, 'circle-stroke-color': t.halo }) }),
    omt('labels-peak', 'symbol', 'mountain_peak', { minzoom: 10.5, filter: ['has', 'name'],
      layout: {
        'text-field': ['format', name, {}, '\n', {}, ['concat', ['to-string', ['round', ['get', 'ele']]], ' m'], { 'font-scale': 0.82 }],
        'text-font': ['Noto Sans Bold'], 'text-size': zoomW(10.5, 10.5, 15, 13), 'text-max-width': 7,
        'text-offset': [0, 0.5], 'text-anchor': 'top', 'symbol-sort-key': ['get', 'rank']
      }, by: text('peak') }),
    omt('labels-place-village', 'symbol', 'place', { minzoom: 10, maxzoom: 16.5, filter: cls(['village', 'suburb', 'hamlet', 'neighbourhood']),
      layout: { 'text-field': name, 'text-font': ['Noto Sans Regular'], 'text-size': zoomW(10, 11, 15, 14), 'text-max-width': 8 }, by: text('ink') }),
    omt('labels-place-city', 'symbol', 'place', { minzoom: 4, maxzoom: 14, filter: cls(['city', 'town']),
      layout: { 'text-field': name, 'text-font': ['Noto Sans Bold'], 'text-size': zoomW(4, 11, 11, 16), 'text-max-width': 8 },
      by: text('ink', 1.8) })
  ];
}

// ============================================
// ESTILO
// ============================================
function kxBaseNormalize(base) {
  return base === 'topo' ? 'topo' : 'sat';
}

/**
 * Estilo completo de MapLibre para la vista `base` («sat» o «topo»).
 * Sin `key` de MapTiler devuelve solo la ortofoto.
 */
function kxBaseStyle(key, base) {
  const hasKey = !!key && key !== 'get_your_own_key';
  const view = hasKey ? kxBaseNormalize(base) : 'sat';
  const pnoa = { type: 'raster', tiles: [KXBASE_PNOA], tileSize: 256, maxzoom: 20, attribution: '© <a href="https://www.ign.es">IGN España</a> - PNOA' };
  if (!hasKey) {
    return {
      version: 8, name: 'KRUX Base', glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
      sources: { 'pnoa-source': pnoa },
      layers: [{ id: 'pnoa-layer', type: 'raster', source: 'pnoa-source', minzoom: 0, maxzoom: 22 }]
    };
  }

  const mt = path => `https://api.maptiler.com/${path}?key=${key}`;
  const layers = kxBaseLayerDefs().map(({ only, by, ...layer }) => {
    const paintBy = by ? { sat: by(KXBASE_THEME.sat), topo: by(KXBASE_THEME.topo) } : null;
    return {
      ...layer,
      metadata: { ...(only ? { 'kx:only': only } : {}), ...(paintBy ? { 'kx:paint': paintBy } : {}) },
      layout: { ...layer.layout, visibility: only && only !== view ? 'none' : 'visible' },
      paint: { ...layer.paint, ...(paintBy ? paintBy[view] : {}) }
    };
  });

  return {
    version: 8, name: 'KRUX Base', glyphs: mt('fonts/{fontstack}/{range}.pbf'),
    sources: {
      'pnoa-source': pnoa,
      'labels-source': { type: 'vector', url: mt('tiles/v3/tiles.json'), attribution: KXBASE_MAPTILER_ATTR },
      'contours-source': { type: 'vector', url: mt('tiles/contours-v2/tiles.json'), attribution: KXBASE_MAPTILER_ATTR },
      // Fuente propia para el sombreado: la del modo 3D (terrain-source) se crea y destruye con él
      'relief-source': { type: 'raster-dem', url: mt('tiles/terrain-rgb-v2/tiles.json'), tileSize: 512, attribution: KXBASE_MAPTILER_ATTR }
    },
    layers
  };
}

/**
 * Cambios que llevan un estilo ya cargado a la vista `base`: lista de
 * { id, visibility } y { id, paint: { propiedad: valor } } para aplicar con la API del mapa.
 */
function kxBaseSwitchOps(layers, base) {
  const view = kxBaseNormalize(base);
  const ops = [];
  (layers || []).forEach(layer => {
    const meta = layer.metadata || {};
    if (meta['kx:only']) ops.push({ id: layer.id, visibility: meta['kx:only'] === view ? 'visible' : 'none' });
    if (meta['kx:paint'] && meta['kx:paint'][view]) ops.push({ id: layer.id, paint: meta['kx:paint'][view] });
  });
  return ops;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { kxBaseStyle, kxBaseSwitchOps, kxBaseNormalize, kxBaseLayerDefs, KXBASE_SUN_ANCHOR, KXBASE_THEME };
}

// ============================================
// SELECTOR DE VISTA (botón en la columna de controles)
// ============================================
const KxBaseMap = {
  map: null,
  base: KXBASE_DEFAULT,
  _btn: null,
  _hasTopo: false,

  // Vista guardada del usuario (el almacenamiento puede no estar disponible)
  stored() {
    try { return kxBaseNormalize(localStorage.getItem(KXBASE_STORAGE)); } catch (_) { return KXBASE_DEFAULT; }
  },

  // Estilo inicial del mapa, con la vista que el usuario dejó elegida
  initialStyle(key) {
    const style = kxBaseStyle(key, this.stored());
    // Sin las capas vectoriales (falta la clave de MapTiler) no hay vista topográfica que ofrecer
    this._hasTopo = style.layers.some(l => l.id === 'kx-topo-bg');
    this.base = this._hasTopo ? this.stored() : KXBASE_DEFAULT;
    return style;
  },

  init(map) {
    if (!map || this.map) return;
    this.map = map;
    if (!this._hasTopo) return;

    const btn = document.createElement('button');
    btn.id = 'btn-map-base';
    btn.type = 'button';
    btn.className = 'map-control-btn maplibregl-ctrl kx-ctrl-base';
    btn.addEventListener('click', e => { e.stopPropagation(); this.set(this.base === 'sat' ? 'topo' : 'sat'); });
    const stack = map.getContainer().querySelector('.maplibregl-ctrl-bottom-right');
    if (stack) stack.insertBefore(btn, stack.firstChild);
    else map.getContainer().appendChild(btn);
    this._btn = btn;
    this._syncButton();
  },

  set(base) {
    const view = kxBaseNormalize(base);
    if (!this.map || view === this.base) return;
    try {
      kxBaseSwitchOps(this.map.getStyle().layers, view).forEach(op => {
        if (!this.map.getLayer(op.id)) return;
        if (op.visibility) this.map.setLayoutProperty(op.id, 'visibility', op.visibility);
        if (op.paint) Object.keys(op.paint).forEach(prop => this.map.setPaintProperty(op.id, prop, op.paint[prop]));
      });
    } catch (e) {
      console.error('[Mapa base] Error cambiando de vista:', e);
      return;
    }
    this.base = view;
    try { localStorage.setItem(KXBASE_STORAGE, view); } catch (_) { /* sin almacenamiento: no se recuerda */ }
    this._syncButton();
  },

  // El botón enseña la vista a la que se cambia al pulsarlo
  _syncButton() {
    if (!this._btn) return;
    const toTopo = this.base === 'sat';
    const label = toTopo ? 'Ver mapa topográfico' : 'Ver satélite';
    this._btn.title = label;
    this._btn.setAttribute('aria-label', label);
    this._btn.innerHTML = kxIcon(toTopo ? 'map' : 'image', { size: 20 });
  }
};

if (typeof window !== 'undefined') window.KxBaseMap = KxBaseMap;

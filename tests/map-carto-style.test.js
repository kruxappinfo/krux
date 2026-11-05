// Cartografía 2D (Fase 2): el rediseño visual no puede tocar el sistema cromático de grados.
// Fija las dos tablas originales (capa nativa de vías y fichas/variantes/ticks) y comprueba que los estilos
// nuevos de vías y sectores las reutilizan, sin paletas propias.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';

const CONFIG = readFileSync(new URL('../maplibre-config.js', import.meta.url), 'utf8');
const MAP = readFileSync(new URL('../maplibre-map.js', import.meta.url), 'utf8');

// Extrae una declaración `function nombre(...) {...}` completa (llaves equilibradas)
function extractFunction(src, name) {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`No se encuentra ${name}`);
  let i = src.indexOf(') {', start) + 2, depth = 0;   // tras los parámetros (que pueden llevar `{}` por defecto)
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`Llaves sin cerrar en ${name}`);
}

function extractConst(src, name, open = '{', close = '}') {
  const start = src.indexOf(`const ${name} =`);
  let i = src.indexOf(open, start), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === open) depth++;
    else if (src[i] === close && --depth === 0) return src.slice(start, src.indexOf(';', i) + 1);
  }
  throw new Error(`No se encuentra ${name}`);
}

const configCtx = vm.createContext({});
vm.runInContext(CONFIG + ';this.MAPLIBRE_GRADE_COLORS = MAPLIBRE_GRADE_COLORS; this.gen = generateGradeColorExpression;', configCtx);

let mobile = true;
const mapCtx = vm.createContext({
  generateGradeColorExpression: configCtx.gen,
  isMobileDevice: () => mobile
});
vm.runInContext([
  extractFunction(MAP, 'getGradeColor'),
  extractConst(MAP, 'KX_MAP'),
  "const _kxSel = ['boolean', ['feature-state', 'selected'], false];",
  extractConst(MAP, 'KX_ROUTE_RADIUS'),
  'const KX_ROUTE_STROKE = 1.5;',
  extractFunction(MAP, 'kxRouteRadiusStops'),
  extractFunction(MAP, 'kxZoomExpr'),
  extractFunction(MAP, 'kxRoutePaint'),
  extractFunction(MAP, 'kxRouteShadowPaint'),
  extractConst(MAP, 'KX_SECTOR_PALETTE', '[', ']'),
  extractFunction(MAP, 'kxSectorHash'),
  extractFunction(MAP, 'kxAssignSectorColors'),
  extractFunction(MAP, 'kxSectorColorExpr'),
  extractFunction(MAP, 'kxSectorLinePaint'),
  extractFunction(MAP, 'kxSectorCasingPaint'),
  MAP.match(/const KX_SECTOR_HIT_WIDTH = [^;]+;/)[0],
  extractFunction(MAP, 'kxSectorHitPaint'),
  'this.api = { getGradeColor, kxRoutePaint, kxRouteShadowPaint, kxSectorLinePaint, kxSectorCasingPaint, kxSectorHitPaint, kxAssignSectorColors, kxSectorHash, KX_SECTOR_PALETTE, KX_MAP };'
].join('\n'), mapCtx);
const api = mapCtx.api;

// Tabla original de la capa de vías (maplibre-config.js), tal cual estaba antes de la Fase 2
const ORIGINAL_LAYER_COLORS = {
  '3a': '#e0f7fa', '3b': '#b2ebf2', '3c': '#80deea',
  '4a': '#4dd0e1', '4b': '#26c6da', '4c': '#00bcd4',
  '5a': '#d7ffaf', '5a+': '#c5f59a', '5b': '#a8e68f', '5b+': '#8cd97f', '5c': '#46923a', '5c+': '#3d8032',
  '6a': '#fff48d', '6a+': '#ffeb3b', '6b': '#fdd835', '6b+': '#ffc107',
  '6c': '#fda750', '6c+': '#ff9800', '7a': '#ff6161', '7a+': '#f44336',
  '7b': '#e53935', '7b+': '#d32f2f', '7c': '#ce1616', '7c+': '#b71c1c',
  '8a': '#f463ef', '8a+': '#e91e63', '8b': '#d81b60', '8b+': '#c2185b', '8c': '#ad1457', '8c+': '#8b00d9',
  '9a': '#7b00b3', '9a+': '#6a0080', '9b': '#4a0066', '9b+': '#2d004d', '9c': '#1a0033', '9c+': '#0d001a'
};

// Tabla original de getGradeColor (maplibre-map.js): fichas, anillos de variantes y ticks
const ORIGINAL_GETGRADECOLOR = {
  '3': '#e0f7fa', '3a': '#e0f7fa', '3b': '#b2ebf2', '3c': '#80deea', '4a': '#4dd0e1', '4b': '#26c6da', '4c': '#00bcd4', '4+': '#00acc1',
  '5a': '#d7ffaf', '5a+': '#c5f59a', '5b': '#a8e68f', '5b+': '#8cd97f', '5c': '#46923a', '5c+': '#3d8032', '5+': '#3d8032',
  '6a': '#fff48d', '6a+': '#ffeb3b', '6b': '#ffd919', '6b+': '#ffc107', '6c': '#fda750', '6c+': '#ff9800',
  '7a': '#ff6161', '7a+': '#f44336', '7b': '#e53935', '7b+': '#d32f2f', '7c': '#ce1616', '7c+': '#b71c1c',
  '8a': '#f463ef', '8a+': '#e91e63', '8b': '#d81b60', '8b+': '#c2185b', '8c': '#ad1457', '8c+': '#8b00d9',
  '9a': '#7b00b3', '9a+': '#6a0080', '9b': '#4a0066', '9b+': '#2d004d', '9c': '#1a0033', '9c+': '#0d001a',
  // Respaldos por número y sin grado
  '5': '#a8e68f', '6': '#ffd919', '7': '#ff6161', '4': '#4dd0e1', 'No info': '#d1d5db', '?': '#d1d5db'
};

describe('cartografía 2D: colores de grado intactos', () => {
  it('la tabla de la capa de vías no cambia', () => {
    expect({ ...configCtx.MAPLIBRE_GRADE_COLORS }).toEqual(ORIGINAL_LAYER_COLORS);
  });

  it('getGradeColor devuelve exactamente los colores de siempre (incluidos los respaldos)', () => {
    for (const [grade, color] of Object.entries(ORIGINAL_GETGRADECOLOR)) {
      expect(api.getGradeColor(grade), grade).toBe(color);
    }
  });

  it('el círculo de vía usa la expresión original de grado, sin color propio', () => {
    for (const m of [true, false]) {
      mobile = m;
      const paint = api.kxRoutePaint();
      expect(JSON.stringify(paint['circle-color'])).toBe(JSON.stringify(configCtx.gen('grado1')));
      expect(paint['circle-stroke-color']).toBe('#ffffff');
    }
    // Las vías aportadas por la comunidad conservan su borde dorado
    expect(api.kxRoutePaint('#FFD700')['circle-stroke-color']).toBe('#FFD700');
  });

  it('la sombra de contacto es neutra y crece con el radio de la vía', () => {
    mobile = true;
    const shadow = api.kxRouteShadowPaint();
    const route = api.kxRoutePaint();
    expect(shadow['circle-color']).toBe(api.KX_MAP.shadow);
    const r = route['circle-radius'], s = shadow['circle-radius'];
    for (let i = 3; i < r.length; i += 2) expect(s[i + 1]).toBeGreaterThan(r[i + 1]);
  });
});

describe('cartografía 2D: sectores con doble trazo pastel', () => {
  const flat = v => JSON.stringify(v);
  const line = (coords) => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } });
  const sector = (nombre, x, y) => ({ ...line([[x, y], [x + 0.0005, y + 0.0003]]), properties: { nombre } });

  it('la paleta son los seis colores mates del diseño', () => {
    expect([...api.KX_SECTOR_PALETTE]).toEqual(['#579C68', '#299F98', '#438FC5', '#9273B8', '#D98942', '#CC716E']);
  });

  it('el color depende solo del nombre: mismo sector, mismo color en cualquier sesión y orden', () => {
    const a = api.kxAssignSectorColors([sector('Placas', 0, 0), sector('Fisuras', 1, 1), sector('Central', 2, 2)]);
    const b = api.kxAssignSectorColors([sector('Central', 2, 2), sector('Placas', 0, 0), sector('Fisuras', 1, 1)]);
    const byName = list => Object.fromEntries(list.map(f => [f.properties.nombre, f.properties.kxc]));
    expect(byName(a)).toEqual(byName(b));
    // Valores fijos: si cambia la función, todos los sectores cambiarían de color de un día para otro
    expect(api.kxSectorHash('Placas')).toBe(2415795481);
    expect(api.kxSectorHash('Placas') % 6).toBe(1);
    expect(Object.values(byName(a)).every(i => Number.isInteger(i) && i >= 0 && i < 6)).toBe(true);
  });

  it('sectores vecinos no comparten color mientras la paleta alcance', () => {
    const names = ['A', 'B', 'C', 'D', 'E', 'F'].map((n, i) => sector(`Sector ${n}`, i * 0.0001, 0));   // todos pegados
    api.kxAssignSectorColors(names);
    expect(new Set(names.map(f => f.properties.kxc)).size).toBe(6);
  });

  it('con más vecinos que colores se reutiliza la paleta sin fallar', () => {
    const many = Array.from({ length: 9 }, (_, i) => sector(`S${i}`, i * 0.0001, 0));
    expect(() => api.kxAssignSectorColors(many)).not.toThrow();
    many.forEach(f => expect(f.properties.kxc).toBeLessThan(6));
  });

  it('no toca geometrías ni identificadores', () => {
    const f = { ...sector('Intacto', 1, 2), properties: { nombre: 'Intacto', fid: 77 } };
    const before = flat(f.geometry);
    api.kxAssignSectorColors([f]);
    expect(flat(f.geometry)).toBe(before);
    expect(f.properties.fid).toBe(77);
  });

  it('la línea usa la paleta por sector y el color no cambia al seleccionar', () => {
    const paint = api.kxSectorLinePaint();
    const expr = flat(paint['line-color']);
    api.KX_SECTOR_PALETTE.forEach(c => expect(expr).toContain(c));
    expect(expr).not.toContain('feature-state');
    expect(expr).not.toMatch(/#153E35|#2E9A63/);   // ni el verde bosque ni el verde del antiguo seleccionado
  });

  it('línea interior de 3,5–4 px en reposo y de 5–6 px seleccionada en los zooms de escuela', () => {
    const w = api.kxSectorLinePaint()['line-width'];
    const at = z => w[w.indexOf(z) + 1];
    for (const z of [16, 18]) {
      const [, , selected, normal] = at(z);   // ['case', <seleccionado?>, seleccionado, normal]
      expect(normal).toBeGreaterThanOrEqual(3.5);
      expect(normal).toBeLessThanOrEqual(4);
      expect(selected).toBeGreaterThanOrEqual(5);
      expect(selected).toBeLessThanOrEqual(6);
    }
    // Más lejos, más fino: no se vuelve una banda ancha al alejarse
    expect(at(12)[3]).toBeLessThan(at(16)[3]);
  });

  it('borde exterior blanco de 7–8 px, más grueso al seleccionar, sin halo ni desenfoque', () => {
    const casing = api.kxSectorCasingPaint();
    expect(casing['line-color']).toBe('#FFFFFF');
    expect(casing).not.toHaveProperty('line-blur');
    const lw = api.kxSectorLinePaint()['line-width'], cw = casing['line-width'];
    for (let i = 3; i < lw.length; i += 2) {
      expect(cw[i + 1][3]).toBeGreaterThan(lw[i + 1][3]);   // reposo
      expect(cw[i + 1][2]).toBeGreaterThan(lw[i + 1][2]);   // seleccionado
      expect(cw[i + 1][2]).toBeGreaterThan(cw[i + 1][3]);   // y más grueso que en reposo
    }
    for (const z of [16, 18]) {
      const [, , , normal] = cw[cw.indexOf(z) + 1];
      expect(normal).toBeGreaterThanOrEqual(7);
      expect(normal).toBeLessThanOrEqual(8);
    }
    const op = casing['line-opacity'];
    expect(op[op.indexOf(13) + 1][3]).toBeGreaterThanOrEqual(0.9);
    expect(op[op.indexOf(13) + 1][2]).toBe(1);             // seleccionado: borde más visible
  });

  it('el área táctil es una capa aparte: 22–26 px, invisible, sin color propio ni sombra', () => {
    const hit = api.kxSectorHitPaint();
    expect(hit['line-width']).toBeGreaterThanOrEqual(22);
    expect(hit['line-width']).toBeLessThanOrEqual(26);
    expect(hit['line-opacity']).toBe(0);
    expect(hit).not.toHaveProperty('line-blur');
    // y ni el trazo visible ni el borde se engordan para facilitar el toque
    const lw = api.kxSectorLinePaint()['line-width'];
    for (let i = 3; i < lw.length; i += 2) expect(lw[i + 1][2]).toBeLessThan(8);
  });
});

// ---------- Marcador de escuelas: pin con tres estados ----------
describe('marcador de escuelas: un solo pin, tres estados', () => {
  const schoolCtx = vm.createContext({});
  const states = [];                       // feature-states aplicados, en orden
  schoolCtx.mlMap = {
    getSource: () => ({}),
    setFeatureState: (target, st) => states.push({ id: target.id, ...st }),
    once: () => {}
  };
  schoolCtx.window = {};
  vm.runInContext([
    extractConst(MAP, 'KX_MAP'),
    extractConst(MAP, 'KX_SCHOOL_PIN'),
    extractFunction(MAP, 'kxSchoolPinSVG'),
    'let kxSelectedSchool = null, kxFocusedSchool = null, kxFocusTimer = null;',
    extractFunction(MAP, 'kxSetFeatureState'),
    extractFunction(MAP, 'kxSelectSchool'),
    extractFunction(MAP, 'kxFocusSchool'),
    'this.api = { kxSchoolPinSVG, KX_SCHOOL_PIN, kxSelectSchool, kxFocusSchool, get sel() { return kxSelectedSchool; }, get focus() { return kxFocusedSchool; } };'
  ].join('\n'), schoolCtx);
  const api2 = schoolCtx.api;
  const lastState = (id, key) => [...states].reverse().find(s => s.id === id && key in s)?.[key];

  it('colores del diseño: normal #398C62, seleccionada #27A866', () => {
    expect(api2.KX_SCHOOL_PIN.normal).toBe('#398C62');
    expect(api2.KX_SCHOOL_PIN.selected).toBe('#27A866');
  });

  const ORIGINAL_PATHS = [
    'M48 5 C24.3 5 5 24.3 5 48 C5 66 16 78 29 88 L44 105 Q48 110 52 105 L67 88 C80 78 91 66 91 48 C91 24.3 71.7 5 48 5Z',
    'M22 57 L39 32 L49 45 L59 29 L77 57 Z',
    'M22 57 L39 32 L49 45'
  ];
  const squash = svg => svg.replace(/\s+/g, ' ');

  it('usa el SVG original (96×112, mismas tres trazas, contorno blanco de 4)', () => {
    const svg = squash(api2.kxSchoolPinSVG('#398C62'));
    expect(svg).toContain('width="96" height="112" viewBox="0 0 96 112"');
    ORIGINAL_PATHS.forEach(d => expect(svg).toContain(`d="${d}"`));
    expect(svg).toContain('fill="#398C62" stroke="#FFFFFF" stroke-width="4" stroke-linejoin="round"');
    expect(svg).toContain('stroke="#EAF3ED" stroke-width="1.5"');
  });

  it('los estados comparten silueta, montaña y contorno: solo cambia el relleno', () => {
    const strip = svg => squash(svg).replace(/fill="#[0-9A-Fa-f]{6}" stroke="#FFFFFF"/, 'FILL');
    const normal = api2.kxSchoolPinSVG(api2.KX_SCHOOL_PIN.normal);
    const selected = api2.kxSchoolPinSVG(api2.KX_SCHOOL_PIN.selected);
    expect(normal).not.toBe(selected);
    expect(strip(normal)).toBe(strip(selected));
    expect(normal).not.toMatch(/<text|filter|shadow|Gradient/i);   // sin texto, sombras ni efectos
  });

  it('selección y foco son independientes', () => {
    api2.kxSelectSchool('cuenca');
    api2.kxFocusSchool('valeria');
    expect(api2.sel).toBe('cuenca');
    expect(api2.focus).toBe('valeria');
    expect(lastState('cuenca', 'selected')).toBe(true);
    expect(lastState('valeria', 'focus')).toBe(true);
    expect(lastState('valeria', 'selected')).toBeUndefined();
    api2.kxFocusSchool(null);
    expect(lastState('valeria', 'focus')).toBe(false);
    expect(lastState('cuenca', 'selected')).toBe(true);   // quitar el foco no toca la selección
  });

  it('al cambiar de escuela seleccionada se actualizan las dos, sin dejar resaltados', () => {
    api2.kxSelectSchool('cuenca');
    api2.kxSelectSchool('toledo');
    expect(lastState('cuenca', 'selected')).toBe(false);
    expect(lastState('toledo', 'selected')).toBe(true);
    api2.kxSelectSchool(null);
    expect(lastState('toledo', 'selected')).toBe(false);
    expect(api2.sel).toBeNull();
  });

  it('un nuevo foco retira el anterior', () => {
    api2.kxFocusSchool('cuenca');
    api2.kxFocusSchool('mora');
    expect(lastState('cuenca', 'focus')).toBe(false);
    expect(lastState('mora', 'focus')).toBe(true);
    api2.kxFocusSchool(null);
  });
});

// ---------- Selección de sectores: capa táctil, etiquetas y prioridades ----------
describe('selección de sectores', () => {
  const ctx = vm.createContext({});
  let queries, opened, selected, chooser, flags;
  const reset = () => { queries = []; opened = []; selected = []; chooser = null; };
  reset();

  // Fakes mínimos del mapa y del DOM
  const fakeEl = tag => ({ tag, children: [], style: { setProperty() {} }, className: '', textContent: '', setAttribute() {}, addEventListener() {}, appendChild(c) { this.children.push(c); } });
  ctx.document = { createElement: fakeEl };
  ctx.maplibregl = { Popup: class { constructor() { chooser = this; } setLngLat() { return this; } setDOMContent(c) { this.content = c; return this; } addTo() { return this; } on() {} remove() {} } };
  const layersPresent = new Set(['sectores-hit-layer', 'sectores-labels-layer', 'vias-layer', 'school-markers-layer']);
  ctx.mlMap = {
    getLayer: id => (layersPresent.has(id) ? {} : null),
    getSource: () => null,
    queryRenderedFeatures: (geom, opts) => {
      queries.push({ geom, layers: opts.layers });
      const key = opts.layers.join(',');
      return (ctx.__results && ctx.__results[key]) || [];
    }
  };
  ctx.mlOpenStaticSector = (props) => opened.push(props.nombre);
  ctx.mlOpenUserSector = (props) => opened.push('user:' + props.nombre);
  ctx.kxSelectSector = (f) => selected.push(f.properties.nombre);
  ctx.kxClearSectorSelection = () => {};
  ctx.kxCloseSectorChooser = () => {};
  ctx.kxSetFeatureState = () => {};
  ctx.KX_SECTOR_PALETTE = ['#579C68'];
  ctx.kxSectorColorOf = () => '#579C68';
  vm.runInContext([
    "const KX_SECTOR_HIT_LAYERS = ['sectores-hit-layer', 'sectores-usuarios-hit-layer'];",
    "const KX_SECTOR_LABEL_LAYERS = ['sectores-labels-layer', 'sectores-usuarios-labels-layer'];",
    extractConst(MAP, 'KX_ROUTE_LAYERS', '[', ']'),
    extractConst(MAP, 'KX_PRIORITY_LAYERS', '[', ']').replace("KX_ROUTE_LAYERS.concat(", "KX_ROUTE_LAYERS.concat(") ,
    MAP.match(/const KX_LABEL_TAP_PAD = [^;]+;/)[0],
    'let kxSectorChooser = null;',
    extractConst(MAP, 'KX_LINE_SOURCE_OF'),
    extractFunction(MAP, 'kxLineFeatureProps'),
    extractFunction(MAP, 'kxOpenSectorFeature'),
    extractFunction(MAP, 'kxSectorKey'),
    extractFunction(MAP, 'kxHandleSectorTap'),
    'this.tap = kxHandleSectorTap;'
  ].join('\n'), ctx);

  const feat = (nombre, id, source = 'sectores-source') => ({ id, source, properties: { nombre }, layer: { id: 'x' } });
  const tapEvent = (features = []) => ({ point: { x: 100, y: 100 }, lngLat: { lng: 1, lat: 2 }, originalEvent: {}, features });
  const results = (map) => { ctx.__results = map; };

  it('un único sector dentro del área táctil se selecciona y abre directamente', () => {
    reset(); results({ 'sectores-hit-layer': [feat('Placas', 1)] });
    ctx.tap(tapEvent([feat('Placas', 1)]));
    expect(selected).toEqual(['Placas']);
    expect(opened).toEqual(['Placas']);
    expect(chooser).toBeNull();
  });

  it('se consulta la capa táctil invisible en el punto del toque, no el trazo visible', () => {
    reset(); results({ 'sectores-hit-layer': [feat('Placas', 1)] });
    ctx.tap(tapEvent([feat('Placas', 1)]));
    const q = queries.find(x => x.layers.includes('sectores-hit-layer'));
    expect(q.layers).toEqual(['sectores-hit-layer']);
    expect(q.geom).toEqual({ x: 100, y: 100 });
    expect(queries.some(x => x.layers.includes('sectores-layer') || x.layers.includes('sectores-casing-layer'))).toBe(false);
  });

  it('varios sectores candidatos: selector con sus nombres y sin abrir ninguno todavía', () => {
    reset(); results({ 'sectores-hit-layer': [feat('Placas', 1), feat('Fisuras', 2), feat('Placas', 1)] });
    ctx.tap(tapEvent([feat('Placas', 1)]));
    expect(opened).toEqual([]);
    expect(selected).toEqual([]);
    const names = chooser.content.children.filter(c => c.tag === 'button').map(b => b.textContent);
    expect(names).toEqual(['Placas', 'Fisuras']);   // sin duplicados
  });

  it('una vía justo bajo el dedo tiene prioridad: el sector no se abre', () => {
    reset(); results({ 'vias-layer,school-markers-layer': [feat('Vía', 9)], 'sectores-hit-layer': [feat('Placas', 1)] });
    // la consulta de prioridad lista vías y escuelas presentes
    ctx.__results = { [['vias-layer', 'school-markers-layer'].join(',')]: [feat('Vía', 9)], 'sectores-hit-layer': [feat('Placas', 1)] };
    ctx.tap(tapEvent([feat('Placas', 1)]));
    expect(opened).toEqual([]);
    expect(selected).toEqual([]);
  });

  it('tocar una etiqueta (con margen) abre el sector que representa', () => {
    reset(); results({ 'sectores-labels-layer': [feat('Fisuras', 2)], 'sectores-hit-layer': [feat('Placas', 1)] });
    ctx.tap(tapEvent([feat('Placas', 1)]));
    expect(opened).toEqual(['Fisuras']);
    const q = queries.find(x => x.layers.includes('sectores-labels-layer'));
    expect(q.geom).toEqual([[92, 92], [108, 108]]);   // ±8 px
  });

  it('los sectores aportados por usuarios abren su propia ficha', () => {
    reset(); results({ 'sectores-hit-layer': [feat('Mío', 5, 'sectores-usuarios-source')] });
    ctx.tap(tapEvent([feat('Mío', 5, 'sectores-usuarios-source')]));
    expect(opened).toEqual(['user:Mío']);
  });

  it('el mismo toque no se gestiona dos veces (handlers de capa duplicados)', () => {
    reset(); results({ 'sectores-hit-layer': [feat('Placas', 1)] });
    const e = tapEvent([feat('Placas', 1)]);
    ctx.tap(e); ctx.tap(e);
    expect(opened).toEqual(['Placas']);
  });

  it('sin candidatos en el área táctil, un toque no abre nada', () => {
    reset(); results({});
    ctx.tap(tapEvent([]));
    expect(opened).toEqual([]);
  });
});

// ---------- Iconos de puntos de interés (pack «KRUX POI matte») ----------
describe('iconos de puntos de interés', () => {
  const files = (() => {
    const src = extractConst(MAP, 'POI_SVG_FILES');
    const ctx = vm.createContext({});
    vm.runInContext(src + '; this.f = POI_SVG_FILES;', ctx);
    return { ...ctx.f };
  })();
  const PACK = ['agua', 'albergue', 'arroyo', 'banco', 'bar', 'bomberos', 'camping', 'correos', 'cueva', 'cumbre', 'ducha', 'ermita',
    'escalera', 'farmacia', 'fuente', 'gasolinera', 'hospital', 'hotel', 'iglesia', 'informacion', 'merendero', 'mirador', 'parking',
    'peligro', 'piscina', 'policia', 'puente', 'refugio', 'restaurante', 'rio', 'ruina', 'telefono', 'tienda', 'vivac', 'wc'];

  it('los 35 tipos del pack tienen su propio icono, uno por tipo', () => {
    PACK.forEach(t => expect(files[t], t).toBe(`assets/poi-icons/${t}.svg`));
    expect(PACK).toHaveLength(35);
  });

  it('cada fichero existe, es un SVG de 48×48 y no lleva scripts ni imágenes incrustadas', () => {
    for (const [tipo, path] of Object.entries(files)) {
      const abs = new URL(`../${path}`, import.meta.url);
      expect(existsSync(abs), `${tipo}: ${path}`).toBe(true);
      const svg = readFileSync(abs, 'utf8');
      expect(svg).toContain('viewBox="0 0 48 48"');
      expect(svg).not.toMatch(/<script|<image|href=|onload|<foreignObject/i);
    }
  });

  it('el alias «bombero» usa el icono de bomberos', () => {
    expect(files.bombero).toBe('assets/poi-icons/bomberos.svg');
  });

  it('los iconos son discos mates con borde blanco (sin degradados ni sombras)', () => {
    for (const t of PACK) {
      const svg = readFileSync(new URL(`../assets/poi-icons/${t}.svg`, import.meta.url), 'utf8');
      expect(svg, t).toContain('stroke="#FFFFFF"');
      expect(svg, t).not.toMatch(/Gradient|<filter|feDropShadow/i);
    }
  });
});

// ---------- Etiquetas de sector: candidatos y colocación sin tapar nada ----------
describe('etiquetas de sector: colocación inteligente', () => {
  const ctx = vm.createContext({});
  vm.runInContext([
    extractConst(MAP, 'KX_LABEL_NEAR_M', '[', ']'),
    extractConst(MAP, 'KX_LABEL_FRACTIONS', '[', ']'),
    MAP.match(/const KX_LABEL_GAP = [^;]+;/)[0],
    MAP.match(/const KX_LABEL_PAD = [^;]+;/)[0],
    extractFunction(MAP, 'kxSectorLabelCandidates'),
    extractFunction(MAP, 'kxRectsOverlap'),
    extractFunction(MAP, 'kxRectHitsCircle'),
    extractFunction(MAP, 'kxRectHitsSegment'),
    extractFunction(MAP, 'kxChooseLabelSpot'),
    'this.api = { kxSectorLabelCandidates, kxRectsOverlap, kxRectHitsCircle, kxRectHitsSegment, kxChooseLabelSpot };'
  ].join('\n'), ctx);
  const { kxSectorLabelCandidates: cands, kxRectHitsCircle: hitC, kxRectHitsSegment: hitS, kxChooseLabelSpot: choose } = ctx.api;
  const m = 1 / 111320 / Math.cos(40 * Math.PI / 180), mLat = 1 / 110540;
  const horizontal = [[[-2, 40], [-2 + 100 * m, 40]]];   // línea oeste → este de 100 m

  describe('candidatos', () => {
    it('varios puntos del trazado (mitad primero) y los dos lados de cada uno', () => {
      const c = cands(horizontal, []);
      expect(c).toHaveLength(10);
      expect(c[0].point[0]).toBeCloseTo(-2 + 50 * m, 9);          // mitad
      expect(c[2].point[0]).toBeCloseTo(-2 + 35 * m, 9);          // luego un tercio
      expect(c[0].dir[1]).toBeCloseTo(-c[1].dir[1], 9);           // lados opuestos
    });
    it('el primer lado probado es el que tiene menos vías', () => {
      const routes = [[-2 + 50 * m, 40 - 8 * mLat], [-2 + 52 * m, 40 - 6 * mLat]];   // vías al sur
      expect(cands(horizontal, routes)[0].dir[1]).toBeGreaterThan(0);                 // empieza por el norte
      const north = [[-2 + 50 * m, 40 + 8 * mLat]];
      expect(cands(horizontal, north)[0].dir[1]).toBeLessThan(0);
    });
    it('sin trazado válido no hay candidatos', () => {
      expect(cands([[], [[-2, 40]]], [])).toEqual([]);
    });
    it('no modifica la geometría del sector', () => {
      const lines = [[[-2, 40], [-2 + 100 * m, 40]]];
      const copy = JSON.stringify(lines);
      cands(lines, []);
      expect(JSON.stringify(lines)).toBe(copy);
    });
  });

  describe('geometría', () => {
    const R = { left: 0, top: 0, right: 100, bottom: 20 };
    it('círculo junto al rectángulo', () => {
      expect(hitC(R, 50, 25, 6)).toBe(true);
      expect(hitC(R, 50, 30, 6)).toBe(false);
    });
    it('segmento que cruza, que roza con margen y que pasa lejos', () => {
      expect(hitS(R, -10, 10, 110, 10)).toBe(true);
      expect(hitS(R, -10, 24, 110, 24, 5)).toBe(true);
      expect(hitS(R, -10, 40, 110, 40, 5)).toBe(false);
      expect(hitS(R, 50, -50, 50, -5)).toBe(false);
    });
  });

  describe('elección del hueco', () => {
    const size = { w: 80, h: 26 };
    const base = { lineHalf: 4.5, bounds: { left: 0, top: 0, right: 400, bottom: 400 } };
    // Línea horizontal en y = 200; candidatos encima (dir y-) y debajo (dir y+)
    const line = [[100, 200, 300, 200]];
    const c = [{ at: [200, 200], dir: [0, -1] }, { at: [200, 200], dir: [0, 1] }];

    it('se coloca junto a la línea sin pisarla', () => {
      const spot = choose(c, size, { ...base, segments: line });
      expect(spot.index).toBe(0);
      expect(spot.rect.bottom).toBeLessThan(200 - 4.5);
      expect(spot.rect.bottom).toBeGreaterThan(200 - 20);           // y cerca de su sector
    });
    it('si arriba hay vías, se va al otro lado', () => {
      const circles = [[200, 180, 6]];
      const spot = choose(c, size, { ...base, segments: line, circles });
      expect(spot.index).toBe(1);
      expect(spot.rect.top).toBeGreaterThan(200);
    });
    it('evita otras etiquetas ya colocadas', () => {
      const placed = [{ left: 150, top: 160, right: 250, bottom: 190 }];
      expect(choose(c, size, { ...base, segments: line, placed }).index).toBe(1);
    });
    it('evita las zonas de la interfaz y los bordes de pantalla', () => {
      expect(choose(c, size, { ...base, segments: line, excl: [{ left: 0, top: 150, right: 400, bottom: 199 }] }).index).toBe(1);
      expect(choose([{ at: [395, 200], dir: [1, 0] }], size, { ...base })).toBeNull();
    });
    it('si no hay sitio, no se coloca (mejor ocultarla que tapar)', () => {
      const circles = [[200, 180, 6], [200, 220, 6]];
      expect(choose(c, size, { ...base, segments: line, circles })).toBeNull();
    });
    it('conserva la posición anterior si sigue libre (no salta de lado)', () => {
      expect(choose(c, size, { ...base, segments: line }, 1).index).toBe(1);
    });
  });
});

// Cartografía 2D (Fase 2): el rediseño visual no puede tocar el sistema cromático de grados.
// Fija las dos tablas originales (capa nativa de vías y fichas/variantes/ticks) y comprueba que los estilos
// nuevos de vías y sectores las reutilizan, sin paletas propias.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
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
  'this.api = { getGradeColor, kxRoutePaint, kxRouteShadowPaint, kxSectorLinePaint, kxSectorCasingPaint, kxAssignSectorColors, kxSectorHash, KX_SECTOR_PALETTE, KX_MAP };'
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

  it('la paleta son los seis pasteles mates del diseño', () => {
    expect([...api.KX_SECTOR_PALETTE]).toEqual(['#83B982', '#72C3B7', '#78B8DC', '#A99ACF', '#E8A06B', '#E5C36D']);
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
    expect(expr).not.toMatch(/#153E35|#2E9A63/);
  });

  it('línea de 2,5–3,25 px en reposo y 3,5–4,5 px seleccionada en los zooms de escuela', () => {
    const w = api.kxSectorLinePaint()['line-width'];
    const at = z => w[w.indexOf(z) + 1];
    for (const z of [14, 16, 18]) {
      const [, , selected, normal] = at(z);   // ['case', <seleccionado?>, seleccionado, normal]
      expect(normal).toBeGreaterThanOrEqual(2.5);
      expect(normal).toBeLessThanOrEqual(3.25);
      expect(selected).toBeGreaterThanOrEqual(3.5);
      expect(selected).toBeLessThanOrEqual(4.5);
      expect(selected).toBeGreaterThan(normal);
    }
  });

  it('borde exterior blanco (~5 px, 90 %), más ancho que la línea, sin halo ni desenfoque', () => {
    const casing = api.kxSectorCasingPaint();
    expect(casing['line-color']).toBe('#FFFFFF');
    expect(casing).not.toHaveProperty('line-blur');
    const lw = api.kxSectorLinePaint()['line-width'], cw = casing['line-width'];
    for (let i = 3; i < lw.length; i += 2) {
      expect(cw[i + 1][3]).toBeGreaterThan(lw[i + 1][3]);   // reposo
      expect(cw[i + 1][2]).toBeGreaterThan(lw[i + 1][2]);   // seleccionado
    }
    const z16 = cw[cw.indexOf(16) + 1];
    expect(z16[3]).toBeGreaterThanOrEqual(4.5);
    expect(z16[3]).toBeLessThanOrEqual(5.5);
    const op = casing['line-opacity'];
    expect(op[op.indexOf(13) + 1][3]).toBe(0.9);
    expect(op[op.indexOf(13) + 1][2]).toBe(1);             // seleccionado: borde más visible
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

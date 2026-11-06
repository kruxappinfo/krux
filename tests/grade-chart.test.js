// Fase 3 · gráfico de grados interactivo (propuesta): lógica de datos, marcado accesible y fidelidad a los datos reales.
// Los colores se toman de la función original getGradeColor de maplibre-map.js, sin copiarlos.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const read = f => readFileSync(new URL(f, root), 'utf8');
const mapSrc = read('maplibre-map.js');

// Extrae getGradeColor tal cual de maplibre-map.js
const start = mapSrc.indexOf('function getGradeColor(grade) {');
let depth = 0, end = start;
for (let i = mapSrc.indexOf('{', start); i < mapSrc.length; i++) { if (mapSrc[i] === '{') depth++; else if (mapSrc[i] === '}' && --depth === 0) { end = i + 1; break; } }
const ctx = vm.createContext({ console });
vm.runInContext(mapSrc.slice(start, end), ctx);
vm.runInContext(read('map-ui.js'), ctx, { filename: 'map-ui.js' });
const get = n => vm.runInContext(n, ctx);
const stats = (c, o) => get('kxGradeStats')(c, o);

describe('orden de grados', () => {
  it('coincide exactamente con el orden de la tabla de colores de la app', () => {
    const table = mapSrc.slice(start, end).match(/const gradeColors = \{([\s\S]*?)\};/)[1];
    const keys = [...table.matchAll(/'([^']+)':/g)].map(m => m[1]);
    expect([...get('KX_GRADE_ORDER')]).toEqual(keys);
  });

  it('«4+» y «5+» van detrás de su familia; los genéricos («5») y dudosos («7?») al principio de la suya', () => {
    const order = stats({ '4+': 1, '4a': 1, '4c': 1, '5': 1, '5a': 1, '5+': 1, '5c': 1, '7?': 1, '6c+': 1, '7a': 1 }).entries.map(e => e.grade);
    expect(order).toEqual(['4a', '4c', '4+', '5', '5a', '5c', '5+', '6c+', '7?', '7a']);
  });

  it('lo que no tiene número no es un grado: pasa a «sin grado»', () => {
    const s = stats({ 'no info': 2, '?': 1, '': 4, '6a': 5 }, { ungraded: 3 });
    expect(s.entries.map(e => e.grade)).toEqual(['6a']);
    expect(s.ungraded).toBe(2 + 1 + 4 + 3);   // «no info» + «?» + clave vacía + las que el llamador ya contó
  });
});

describe('cifras', () => {
  const s = stats({ '6a': 43, '6A ': 0, '6b': 59, '5c': 35, '7a': 23, 'no info': 1 }, { ungraded: 2 });

  it('normaliza mayúsculas y espacios, y suma sin perder ninguna vía', () => {
    expect(stats({ '6a': 2, '6A': 3, ' 6a ': 1 }).entries).toEqual([expect.objectContaining({ grade: '6a', count: 6 })]);
    expect(s.graded).toBe(43 + 59 + 35 + 23);
    expect(s.ungraded).toBe(3);
    expect(s.total).toBe(s.graded + s.ungraded);
  });

  it('el porcentaje es sobre las vías con grado y suma 100', () => {
    const sum = s.entries.reduce((a, e) => a + e.pct, 0);
    expect(sum).toBeCloseTo(100, 10);
    expect(s.entries.find(e => e.grade === '6a').pct).toBeCloseTo((43 / 160) * 100, 10);
  });

  it('rango, mediana y grado con más vías', () => {
    expect(s.first.grade).toBe('5c');
    expect(s.last.grade).toBe('7a');
    expect(s.mode).toEqual(expect.objectContaining({ grade: '6b', count: 59 }));
    // acumulado: 5c 35, 6a 78, 6b 137 ≥ 80 → la mitad llega hasta 6b
    expect(s.median.grade).toBe('6b');
  });

  it('familias consecutivas para el eje (5, 6, 7)', () => {
    expect(s.families.map(f => [f.family, f.from, f.to])).toEqual([['5', 0, 0], ['6', 1, 2], ['7', 3, 3]]);
  });

  it('formato de porcentaje legible en español', () => {
    const f = get('kxFormatPct');
    expect(f(10.94)).toBe('11 %');
    expect(f(5.82)).toBe('5,8 %');
    expect(f(1.0)).toBe('1 %');
    expect(f(0.02)).toBe('<0,1 %');
  });

  it('marcas del eje limpias que cubren el máximo', () => {
    const t = get('kxNiceTicks');
    expect([...t(59).ticks]).toEqual([0, 20, 40, 60]);
    expect([...t(11).ticks]).toEqual([0, 5, 10, 15]);
    expect([...t(7).ticks]).toEqual([0, 2, 4, 6, 8]);
    expect(t(0).top).toBe(1);
  });
});

describe('marcado', () => {
  const s = stats({ '6a': 43, '6b': 59, '<img src=x>7a': 1 });
  const html = get('kxGradeChartHTML')(s, { id: 'g' });

  it('cada grado es un botón con su cifra exacta y porcentaje para el lector de pantalla', () => {
    expect(html.match(/<button type="button" class="kx-gbar/g)).toHaveLength(3);
    expect(html).toContain('aria-label="6a: 43 vías, 42 %"');
    expect(html).toMatch(/class="kx-gbar is-max"[^>]*data-grade="6b"/);
    expect(html.match(/tabindex="0"/g)).toHaveLength(1);     // un solo punto de tabulación (flechas dentro)
  });

  it('usa los colores originales de la app y escapa los grados que vienen de datos', () => {
    expect(html).toContain(`--c:${get('getGradeColor')('6a')}`);
    expect(html).not.toContain('<img');
  });

  it('incluye la tabla equivalente con totales y «sin grado»', () => {
    const h2 = get('kxGradeChartHTML')(stats({ '6a': 3 }, { ungraded: 2 }));
    expect(h2).toContain('<summary>Ver como tabla</summary>');
    expect(h2).toMatch(/<th scope="row">Con grado<\/th><td>3<\/td>/);
    expect(h2).toMatch(/<th scope="row">Sin grado<\/th><td>2<\/td>/);
  });

  it('sin vías o sin grados muestra un estado vacío que lo explica', () => {
    expect(get('kxGradeChartHTML')(stats({}))).toContain('Todavía no hay vías registradas');
    expect(get('kxGradeChartHTML')(stats({}, { ungraded: 4 }))).toContain('Hay 4 vías, pero ninguna tiene grado registrado');
  });

  it('el código del gráfico no lleva colores de grado escritos a mano', () => {
    const src = read('map-ui.js');
    const chart = src.slice(src.indexOf('// ---- Gráfico de grados interactivo'), src.indexOf('// HOJAS INFERIORES DEL MAPA'));
    expect(chart).not.toMatch(/#[0-9a-fA-F]{6}/);
  });
});

describe('datos reales', () => {
  const schools = {
    valeria: 'Cartografia/Valeria/Valeria_Vias.geojson',
    sanmartin: 'Cartografia/San Martin de ValdeIglesias/SM_Vias.geojson',
    mora: 'Cartografia/Mora/Mora_Vias.geojson',
    cuenca: 'Cartografia/Cuenca/Cuenca_Vias.geojson',
    toledo: 'Cartografia/Toledo/Toledo_Vias.geojson'
  };
  for (const [k, f] of Object.entries(schools)) {
    it(`${k}: ninguna vía se pierde y todos los grados aparecen por separado`, () => {
      const feats = JSON.parse(read(f)).features;
      const counts = {}; let ungraded = 0;
      for (const ft of feats) { const g = String(ft.properties?.grado1 || '').toLowerCase().trim(); if (g) counts[g] = (counts[g] || 0) + 1; else ungraded++; }
      const s = stats(counts, { ungraded });
      expect(s.graded + s.ungraded).toBe(feats.length);
      const gradeKeys = Object.keys(counts).filter(g => /\d/.test(g));
      expect(s.entries.length).toBe(gradeKeys.length);
      const ranks = s.entries.map(e => get('kxGradeRank')(e.grade));
      expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    });
  }
});

describe('orden de grados en la app (arreglo independiente)', () => {
  const extract = (src, name) => {
    const s = src.indexOf(`function ${name}(`); let d = 0, e = s;
    for (let i = src.indexOf('{', s); i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}' && --d === 0) { e = i + 1; break; } }
    return src.slice(s, e);
  };
  vm.runInContext(extract(mapSrc, 'compareGrades') + ';' + extract(read('user-features.js'), 'compareGradesLocal'), ctx);
  const canon = ['3c', '4a', '4c', '4+', '5', '5a', '5c', '5c+', '5+', '6a', '6a+', '6b+', '7?', '7a', '8a'];
  const shuffled = [...canon].reverse();

  for (const fn of ['compareGrades', 'compareGradesLocal', 'kxCompareGrades']) {
    it(`${fn}: mismo orden que la tabla de colores`, () => {
      expect([...shuffled].sort(get(fn))).toEqual(canon);
    });
    it(`${fn}: el grado máximo del perfil ya no falla con «4+», mayúsculas ni «no info»`, () => {
      const max = gs => [...gs].sort(get(fn)).reverse()[0];
      expect(max(['4c', '4+'])).toBe('4+');
      expect(max(['6A', '6a+'])).toBe('6a+');
      expect(max(['no info', '5a'])).toBe('5a');
    });
  }
});

describe('coordenadas de las vías (encuadre del filtro)', () => {
  const pts = f => [...get('kxFeaturePoints')(f)].map(c => [...c]);
  it('lee MultiPoint (GeoJSON de las escuelas) y Point (vías de spotters)', () => {
    expect(pts({ geometry: { type: 'MultiPoint', coordinates: [[-2.1, 39.7]] } })).toEqual([[-2.1, 39.7]]);
    expect(pts({ geometry: { type: 'Point', coordinates: [-2.2, 39.8] } })).toEqual([[-2.2, 39.8]]);
  });
  it('geometrías ausentes o raras no rompen el encuadre', () => {
    for (const f of [null, {}, { geometry: null }, { geometry: { type: 'Point', coordinates: [] } }, { geometry: { type: 'MultiPoint', coordinates: [] } }]) expect(pts(f)).toEqual([]);
  });
  it('todas las vías reales de las escuelas dan al menos un punto', () => {
    for (const f of ['Cartografia/Valeria/Valeria_Vias.geojson', 'Cartografia/Mora/Mora_Vias.geojson', 'Cartografia/Cuenca/Cuenca_Vias.geojson']) {
      for (const ft of JSON.parse(read(f)).features) expect(pts(ft).length, ft.properties?.nombre).toBeGreaterThan(0);
    }
  });
});

describe('píldora del filtro de grado', () => {
  const chip = o => get('kxGradeFocusChipHTML')(o);
  it('dice el grado, las vías y de dónde, con el color original y los dos botones', () => {
    const h = chip({ grade: '6b+', count: 7, where: 'Valeria · Rocas Rojas' });
    expect(h).toContain(`--c:${get('getGradeColor')('6b+')}`);
    expect(h).toContain('<b>6b+</b> · 7 vías');
    expect(h).toContain('<small>Valeria · Rocas Rojas</small>');
    expect(h).toContain('data-kx-refocus');
    expect(h).toContain('data-kx-unfocus');
    expect(h).toContain('aria-label="Quitar el filtro de grado"');
  });
  it('anuncia el filtro a los lectores de pantalla y usa el singular con una sola vía', () => {
    const h = chip({ grade: '5c+', count: 1 });
    expect(h).toContain('role="status">Mapa filtrado: grado 5c+, 1 vía<');
    expect(h).toContain('aria-label="Grado 5c+, 1 vía. Volver al gráfico"');
    expect(h).not.toContain('<small>');
  });
  it('escapa los nombres que vienen de los datos', () => {
    expect(chip({ grade: '6a', count: 2, where: '<img src=x>' })).not.toContain('<img');
  });
});

describe('ficha de escuela: conserva su donut y su tiempo originales', () => {
  const html = read('index.html');
  const school = html.slice(html.indexOf('<div id="school-bottom-sheet"'), html.indexOf('<div id="sector-bottom-sheet"'));
  it('la hoja móvil lleva el donut y el tiempo, no el gráfico de barras', () => {
    for (const id of ['bs-donut-card', 'bs-donut-chart', 'bs-donut-skeleton', 'bs-weather-widget', 'bs-forecast-panel', 'bs-forecast-scroll']) expect(school, id).toContain(`id="${id}"`);
    expect(school).not.toContain('bs-grade-chart');
  });
  it('el popup de escritorio mantiene el donut y el tiempo', () => {
    const popup = mapSrc.slice(mapSrc.indexOf('function buildSchoolPopupHtml'), mapSrc.indexOf('function setupSchoolPopupEvents'));
    expect(popup).toContain("class='ml-grade-chart-container'");
    expect(popup).toContain("class='ml-weather-section'");
    expect(popup).toContain('btn-visit-${school.id}');          // los ids que usa la lógica existente
    expect(popup).toContain('btn-directions-${school.id}');
    expect(popup).not.toContain('kx-gchart');
  });
  it('el donut mantiene sus medidas originales y responde también al toque', () => {
    const f = mapSrc.slice(mapSrc.indexOf('function renderDonutChart'), mapSrc.indexOf('// CARGA DE DATOS'));
    expect(f).toMatch(/const size = 200;/);
    expect(f).toMatch(/const radius = 75;/);
    expect(f).toMatch(/const strokeWidth = 28;/);
    expect(f).toContain("addEventListener('mouseenter'");
    expect(f).toContain("addEventListener('pointerdown'");
  });
  it('la hoja de escuela cuenta como antes: GeoJSON y vías de spotters, solo con grado', () => {
    const f = mapSrc.slice(mapSrc.indexOf('async function loadBottomSheetStats'), mapSrc.indexOf('function hideSkeletonsShowCharts'));
    expect(f).toContain('geojson.features.forEach');
    expect(f).toContain('await getSpotterGradeCounts(schoolId)');
    expect(f).toMatch(/if \(grade\) \{/);
  });
  it('el panel de previsión del tiempo sigue ahí con su lógica', () => {
    expect(mapSrc).toContain('function toggleBottomSheetForecast');
    expect(mapSrc).toContain('function loadBottomSheetWeather');
    expect(mapSrc).toContain('function renderBottomSheetForecast');
  });
});

describe('ficha de escuela en móviles bajos: contenido desplazable y pie fijo', () => {
  const css = read('app_2.css');
  it('el pie de acciones es fijo bajo el contenido y respeta el área segura', () => {
    const foot = css.match(/^\.kx-msheet-foot\s*\{([^}]*)\}/m)[1];
    expect(foot).toMatch(/flex-shrink:\s*0/);
    expect(foot).toMatch(/padding:\s*12px 16px calc\(12px \+ env\(safe-area-inset-bottom, 0px\)\)/);
  });
  it('el contenido se desplaza con el dedo sin que lo arrastre la hoja y termina libre del pie', () => {
    const body = css.match(/\.bottom-sheet\.kx-msheet \.kx-msheet-body\s*\{([^}]*)\}/)[1];
    expect(body).toMatch(/flex:\s*1/);
    expect(body).toMatch(/min-height:\s*0/);
    expect(body).toMatch(/overflow-y:\s*auto/);
    expect(body).toMatch(/overscroll-behavior:\s*contain/);
    expect(css).toMatch(/\.kx-msheet-body:has\(\+ \.kx-msheet-foot\)\s*\{\s*padding-bottom:\s*16px/);
  });
  it('mientras el contenido continúa bajo el pie, el pie lo indica (solo en la ficha de escuela)', () => {
    expect(css).toMatch(/#school-bottom-sheet\.has-more \.kx-msheet-foot\s*\{[^}]*box-shadow/);
    expect(css).not.toMatch(/(^|\n)\.bottom-sheet\.has-more/);
  });
  it('kxBindScrollCue marca .has-more solo si se puede seguir desplazando y no en el resumen', () => {
    const cls = new Set();
    const body = { scrollTop: 0, clientHeight: 400, scrollHeight: 508, children: [], addEventListener() {} };
    const sheet = { classList: { contains: c => cls.has(c), toggle: (c, on) => { on ? cls.add(c) : cls.delete(c); } }, querySelector: () => body };
    const sync = get('kxBindScrollCue')(sheet);
    expect(cls.has('has-more')).toBe(true);
    body.scrollTop = 108; sync(); expect(cls.has('has-more')).toBe(false);       // al final
    body.scrollTop = 0; cls.add('is-summary'); sync(); expect(cls.has('has-more')).toBe(false);   // resumen: no se desplaza
    expect(get('kxBindScrollCue')(sheet)).toBeNull();                              // no se registra dos veces
  });
});

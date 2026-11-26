// Bloques de rocódromo (gym-blocks.js): varita de presas sobre una foto sintética, contornos y limpieza de datos.
// Se carga el archivo tal cual en un contexto aislado; solo se usan sus funciones puras.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SRC = readFileSync(new URL('../gym-blocks.js', import.meta.url), 'utf8');
const ctx = vm.createContext({
  window: {}, console, URL, Math,
  KX_ICON_PATHS: {},
  kxIcon: () => '',
  kxEsc: (v) => String(v ?? ''),
  document: { addEventListener() {} }
});
vm.runInContext(SRC, ctx, { filename: 'gym-blocks.js' });
const get = (n) => vm.runInContext(n, ctx);

// Muro gris claro con ruido, una presa roja (círculo r=14 en 60,50), una azul (elipse en 150,100) y una gris
// casi del color del muro (en 30,120)
function wall(w = 200, h = 150) {
  const d = new Uint8ClampedArray(w * h * 4);
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const n = (rnd() - 0.5) * 14;
      let c = [205 + n, 203 + n, 198 + n];
      if ((x - 60) ** 2 + (y - 50) ** 2 <= 14 * 14) c = [200 + n * 0.5, 40, 38];
      if (((x - 150) / 18) ** 2 + ((y - 100) / 9) ** 2 <= 1) c = [40, 80, 210 + n * 0.5];
      if ((x - 30) ** 2 + (y - 120) ** 2 <= 8 * 8) c = [196 + n, 194 + n, 190 + n];
      d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
    }
  }
  return get('kxbLabImage')(d, w, h);
}

const bbox = (p, w, h) => {
  const xs = p.filter((_, i) => i % 2 === 0).map(v => v * w), ys = p.filter((_, i) => i % 2 === 1).map(v => v * h);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
};

describe('varita de presas', () => {
  const img = wall();
  const seg = get('kxbSegment');
  const inside = get('kxbInside');

  it('la presa roja: contorno que la rodea sin salirse al muro', () => {
    const r = seg(img, 60 / 200, 50 / 150);
    expect(r.ok).toBe(true);
    const [x0, y0, x1, y1] = bbox(r.p, 200, 150);
    expect(x0).toBeGreaterThan(60 - 19); expect(x0).toBeLessThan(60 - 11);
    expect(x1).toBeGreaterThan(60 + 11); expect(x1).toBeLessThan(60 + 19);
    expect(y0).toBeGreaterThan(50 - 19); expect(y1).toBeLessThan(50 + 19);
    expect(inside(r.p, 60 / 200, 50 / 150)).toBe(true);
    expect(inside(r.p, 100 / 200, 50 / 150)).toBe(false);
    expect(r.p.length / 2).toBeLessThanOrEqual(48);
  });

  it('la presa azul alargada: más ancha que alta', () => {
    const r = seg(img, 150 / 200, 100 / 150);
    expect(r.ok).toBe(true);
    const [x0, y0, x1, y1] = bbox(r.p, 200, 150);
    expect(x1 - x0).toBeGreaterThan((y1 - y0) * 1.5);
  });

  it('tocar el muro no lo marca entero: se marca un círculo', () => {
    const r = seg(img, 110 / 200, 20 / 150);
    expect(r.ok).toBe(false);
    expect(r.p.length).toBe(32);
    expect(inside(r.p, 110 / 200, 20 / 150)).toBe(true);
  });

  it('un panel liso del muro (7 % de la foto) tampoco se marca como presa', () => {
    const w = 200, h = 150, d = new Uint8ClampedArray(w * h * 4).fill(200);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const edge = ((x === 120 || x === 180) && y >= 10 && y <= 46) || ((y === 10 || y === 46) && x >= 120 && x <= 180);
      if (edge) { const i = (y * w + x) * 4; d[i] = d[i + 1] = d[i + 2] = 60; }
    }
    const r = seg(get('kxbLabImage')(d, w, h), 150 / 200, 28 / 150);
    expect(r.ok).toBe(false);
  });

  it('el color sugerido de la presa roja es rojo y el de la azul, azul', () => {
    const red = seg(img, 60 / 200, 50 / 150), blue = seg(img, 150 / 200, 100 / 150);
    expect(get('kxbSuggestColor')([red.rgb])).toBe('rojo');
    expect(get('kxbSuggestColor')([blue.rgb])).toBe('azul');
    expect(get('kxbSuggestColor')([])).toBe(null);
  });
});

describe('bloque entero desde un toque', () => {
  // Muro 240×180: rojas (bloque) en tres alturas, una naranja, dos azules, una cinta roja fina y una colchoneta roja enorme
  const w = 240, h = 180, d = new Uint8ClampedArray(w * h * 4);
  let seed = 3;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const RED = [200, 40, 38], ORANGE = [240, 138, 36], BLUE = [40, 80, 210];
  const shapes = [
    [RED, (x, y) => (x - 50) ** 2 + (y - 120) ** 2 <= 100],          // roja baja
    [RED, (x, y) => ((x - 110) / 9) ** 2 + ((y - 80) / 6) ** 2 <= 1], // roja media
    [RED, (x, y) => (x - 160) ** 2 + (y - 30) ** 2 <= 49],            // roja alta → Top
    [ORANGE, (x, y) => (x - 80) ** 2 + (y - 60) ** 2 <= 81],
    [BLUE, (x, y) => (x - 200) ** 2 + (y - 100) ** 2 <= 64],
    [BLUE, (x, y) => (x - 30) ** 2 + (y - 40) ** 2 <= 64],
    [RED, (x, y) => y === 10 && x >= 20 && x <= 120],                 // cinta fina
    [RED, (x, y) => y >= 150 && x >= 120]                             // colchoneta (más del 5 % de la foto)
  ];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const n = (rnd() - 0.5) * 14;
    let c = [205 + n, 203 + n, 198 + n];
    for (const [col, f] of shapes) if (f(x, y)) c = col.map(v => v + n * 0.4);
    const i = (y * w + x) * 4; d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
  }
  const img = get('kxbLabImage')(d, w, h);
  const all = get('kxbSegmentAll');
  const inside = get('kxbInside');

  it('tocando una roja salen las tres rojas, sin la naranja, las azules, la cinta ni la colchoneta', () => {
    const r = all(img, 50 / w, 120 / h);
    expect(r.ok).toBe(true);
    expect(r.holds).toHaveLength(3);
    const has = (x, y) => r.holds.some(hh => inside(hh.p, x / w, y / h));
    expect(has(50, 120) && has(110, 80) && has(160, 30)).toBe(true);
    expect(has(80, 60) || has(200, 100) || has(70, 10) || has(180, 165)).toBe(false);
  });

  it('la más alta es el Top y el resto, manos', () => {
    const r = all(img, 110 / w, 80 / h);
    const top = r.holds.filter(hh => hh.t === 'top');
    expect(top).toHaveLength(1);
    expect(inside(top[0].p, 160 / w, 30 / h)).toBe(true);
    expect(r.holds.filter(hh => hh.t === 'hand')).toHaveLength(2);
  });

  it('las azules se detectan entre ellas', () => {
    const r = all(img, 200 / w, 100 / h);
    expect(r.holds).toHaveLength(2);
  });

  it('presa del color del muro: no se busca en toda la foto', () => {
    const r = all(img, 220 / w, 20 / h);
    expect(r.ok).toBe(false);
    expect(r.neutral).toBe(true);
  });
});

describe('contornos y datos', () => {
  it('seguimiento del borde de un cuadrado y simplificación a sus esquinas', () => {
    const lw = 12, lh = 12, m = new Uint8Array(lw * lh);
    for (let y = 3; y <= 8; y++) for (let x = 3; x <= 8; x++) m[y * lw + x] = 1;
    const pts = get('kxbTrace')(m, lw, lh);
    expect(pts.length).toBe(20);   // perímetro de un cuadrado de 6×6 píxeles
    const simple = get('kxbSimplify')(pts, 0.5);
    expect(simple.length).toBe(4);
  });

  it('escalar mantiene el centro', () => {
    const p = [0.4, 0.4, 0.6, 0.4, 0.6, 0.6, 0.4, 0.6];
    const big = get('kxbScale')(p, 2);
    expect(big).toEqual([0.3, 0.3, 0.7, 0.3, 0.7, 0.7, 0.3, 0.7]);
  });

  it('limpieza antes de guardar: tipos conocidos, sin campos sueltos y como máximo 60 presas', () => {
    const clean = get('kxbCleanHolds');
    const h = { t: 'raro', p: [0.1, 0.1, 0.2, 0.1, 0.2, 0.2], s: [0.15, 0.15], rgb: [1, 2, 3], auto: true };
    const out = clean([h, { t: 'top', p: [0.1, 0.1] }]);
    expect(out).toHaveLength(1);
    expect(Object.keys(out[0]).sort()).toEqual(['p', 's', 't']);
    expect(out[0].t).toBe('hand');
    expect(clean(Array.from({ length: 80 }, () => h))).toHaveLength(60);
  });

  it('trazado SVG cerrado y capa con foto dentro', () => {
    const d = get('kxbPathD')([0.1, 0.1, 0.9, 0.1, 0.5, 0.9], 100, 100);
    expect(d.startsWith('M')).toBe(true);
    expect(d.endsWith('Z')).toBe(true);
    const svg = get('kxbOverlaySVG')([{ t: 'start', p: [0.1, 0.1, 0.9, 0.1, 0.5, 0.9] }], 100, 100, { href: 'x.jpg', fit: 'slice' });
    expect(svg).toContain('xMidYMid slice');
    expect(svg).toContain('<image href="x.jpg"');
    expect(svg).toContain('#2BD46B');
  });
});

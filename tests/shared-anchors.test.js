// Croquis (sector-images.js): numeración correlativa por sector y reuniones compartidas (vías cuyos finales coinciden).
// sector-images.js es un script de navegador sin exports: se evalúa solo el tramo de los helpers.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../sector-images.js', import.meta.url), 'utf8');
const slice = (from, to) => src.slice(src.indexOf(from), src.indexOf(to));
const body = slice('function kxDrawingKey', '// ============================================\n// REUNIONES COMPARTIDAS') +
  slice('// Finales a esta distancia', 'function kxGradeInk');
const { kxSharedAnchors, kxPathEnds, kxTopoNumbers } = new Function(`${body}; return { kxSharedAnchors, kxPathEnds, kxTopoNumbers };`)();

const drawing = (routeId, end, anchorType = 'quimicos', extra = {}) => ({
  routeId, points: [{ x: end.x, y: 900 }, end], anchorType, ...extra
});
const color = d => `c${d.routeId}`;

describe('reuniones compartidas', () => {
  it('finales que coinciden: una sola chapa (la primera) con los colores de todas', () => {
    const map = kxSharedAnchors([drawing(1, { x: 100, y: 50 }), drawing(2, { x: 101, y: 51 })], color);
    expect(map.get('1:0#0')).toEqual({ lead: true, colors: ['c1', 'c2'] });
    expect(map.get('2:0#0')).toEqual({ lead: false, colors: ['c1', 'c2'] });
  });
  it('finales separados: cada vía conserva su chapa', () => {
    expect(kxSharedAnchors([drawing(1, { x: 100, y: 50 }), drawing(2, { x: 160, y: 50 })], color).size).toBe(0);
  });
  it('cuenta también el final de los ramales', () => {
    const trunk = drawing(1, { x: 100, y: 400 }, 'quimicos', {
      branches: [{ branchId: 1, forkPoint: { x: 100, y: 300 }, points: [{ x: 200, y: 60 }], anchorType: 'cadena' }]
    });
    const map = kxSharedAnchors([trunk, drawing(2, { x: 200, y: 61 })], color);
    expect([...map.keys()].sort()).toEqual(['1:0#1', '2:0#0']);
  });
  it('ignora trazados sin reunión', () => {
    expect(kxPathEnds([{ routeId: 1, points: [{ x: 1, y: 1 }, { x: 2, y: 2 }] }])).toEqual([]);
  });
});

describe('numeración del croquis por sector', () => {
  const at = (routeId, x, imageId, y = 900, extra = {}) => ({ routeId, imageId, points: [{ x, y }, { x, y: 100 }], ...extra });
  const order = ['img_a', 'img_b'];

  it('correlativa entre fotos: primero las de la primera foto, de izquierda a derecha', () => {
    const drawings = [at(5, 700, 'img_b'), at(2, 600, 'img_a'), at(1, 100, 'img_a'), at(4, 100, 'img_b'), at(3, 300, 'img_a')];
    const n = kxTopoNumbers(drawings, order);
    expect(['1:0', '3:0', '2:0', '4:0', '5:0'].map(k => n.get(k))).toEqual([1, 2, 3, 4, 5]);
  });
  it('el orden de las fotos manda sobre el orden en el que se guardaron los trazados', () => {
    const n = kxTopoNumbers([at(9, 50, 'img_b'), at(8, 900, 'img_a')], order);
    expect(n.get('8:0')).toBe(1);
    expect(n.get('9:0')).toBe(2);
  });
  it('una vía dibujada en dos fotos conserva el número de la primera y no deja huecos', () => {
    const n = kxTopoNumbers([at(1, 100, 'img_a'), at(2, 200, 'img_b'), at(1, 500, 'img_b'), at(3, 800, 'img_b')], order);
    expect(n.get('1:0')).toBe(1);
    expect(n.get('2:0')).toBe(2);
    expect(n.get('3:0')).toBe(3);
  });
  it('sin trazados con imageId se tratan como la primera foto (legacy_0)', () => {
    const n = kxTopoNumbers([at(2, 400, 'img_b'), at(1, 800, undefined)], ['legacy_0', 'img_b']);
    expect(n.get('1:0')).toBe(1);
  });
  it('sin orden de fotos numera solo por posición, como antes', () => {
    const n = kxTopoNumbers([at(2, 400, 'x'), at(1, 100, 'y')]);
    expect(n.get('1:0')).toBe(1);
  });
});

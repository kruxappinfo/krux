// Reuniones compartidas (sector-images.js): vías cuyos finales coinciden comparten una sola chapa.
// sector-images.js es un script de navegador sin exports: se evalúa solo el tramo de los helpers.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../sector-images.js', import.meta.url), 'utf8');
const slice = (from, to) => src.slice(src.indexOf(from), src.indexOf(to));
const body = slice('function kxDrawingKey', '/**\n * Numera los trazados') +
  slice('// Finales a esta distancia', 'function kxGradeInk');
const { kxSharedAnchors, kxPathEnds } = new Function(`${body}; return { kxSharedAnchors, kxPathEnds };`)();

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

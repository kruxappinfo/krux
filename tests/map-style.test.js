// Mapa base (map-style.js): el estilo de las dos vistas (satélite / topográfico) y el cambio entre ellas.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { kxBaseStyle, kxBaseSwitchOps, kxBaseNormalize, KXBASE_SUN_ANCHOR } = require('../map-style.js');

const visible = style => style.layers.filter(l => l.layout.visibility !== 'none').map(l => l.id);
const byId = (style, id) => style.layers.find(l => l.id === id);

describe('mapa base: estilo', () => {
  it('sin clave de MapTiler queda solo la ortofoto', () => {
    for (const key of [undefined, '', 'get_your_own_key']) {
      const style = kxBaseStyle(key, 'topo');
      expect(style.layers.map(l => l.id)).toEqual(['pnoa-layer']);
      expect(Object.keys(style.sources)).toEqual(['pnoa-source']);
    }
  });

  it('los identificadores de capa son únicos y cada capa usa una fuente declarada', () => {
    const style = kxBaseStyle('k', 'sat');
    const ids = style.layers.map(l => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    style.layers.filter(l => l.type !== 'background').forEach(l => expect(style.sources[l.source], l.id).toBeTruthy());
  });

  it('conserva las capas que el resto de la app usa como referencia', () => {
    const ids = kxBaseStyle('k', 'sat').layers.map(l => l.id);
    // maplibre-map.js inserta capas respecto a estas dos; sun-map.js, respecto a las curvas de nivel
    expect(ids).toEqual(expect.arrayContaining(['pnoa-layer', 'labels-place-city', KXBASE_SUN_ANCHOR]));
    expect(ids.indexOf('pnoa-layer')).toBeLessThan(ids.indexOf(KXBASE_SUN_ANCHOR));
    expect(ids.indexOf('kx-hillshade')).toBeLessThan(ids.indexOf(KXBASE_SUN_ANCHOR));
  });

  it('en satélite se ve la ortofoto y no el fondo topográfico; en topográfico, al revés', () => {
    const sat = visible(kxBaseStyle('k', 'sat')), topo = visible(kxBaseStyle('k', 'topo'));
    expect(sat).toContain('pnoa-layer');
    expect(sat.some(id => id.startsWith('kx-topo-'))).toBe(false);
    expect(topo).not.toContain('pnoa-layer');
    expect(topo).toEqual(expect.arrayContaining(['kx-topo-bg', 'kx-topo-wood', 'kx-topo-water', 'kx-topo-road-minor']));
    // Senderos, curvas de nivel y rótulos están en las dos vistas
    for (const id of ['kx-path', 'kx-contour-index', 'labels-peak', 'labels-place-city']) {
      expect(sat).toContain(id);
      expect(topo).toContain(id);
    }
  });

  it('los rótulos son claros sobre la foto y oscuros sobre el mapa', () => {
    expect(byId(kxBaseStyle('k', 'sat'), 'labels-place-city').paint['text-color']).toBe('#FFFFFF');
    expect(byId(kxBaseStyle('k', 'topo'), 'labels-place-city').paint['text-color']).toBe('#202923');
  });

  it('una vista desconocida cae en satélite', () => {
    expect(kxBaseNormalize('topo')).toBe('topo');
    for (const v of [null, undefined, '', 'dark']) expect(kxBaseNormalize(v)).toBe('sat');
  });
});

describe('mapa base: cambio de vista', () => {
  // Aplica las operaciones sobre una copia del estilo, como haría el mapa
  function apply(style, base) {
    const layers = JSON.parse(JSON.stringify(style.layers));
    kxBaseSwitchOps(layers, base).forEach(op => {
      const layer = layers.find(l => l.id === op.id);
      if (op.visibility) layer.layout.visibility = op.visibility;
      if (op.paint) Object.assign(layer.paint, op.paint);
    });
    return { layers };
  }

  it('cambiar de vista deja el estilo igual que construirlo en esa vista', () => {
    const strip = style => style.layers.map(l => ({ id: l.id, visibility: l.layout.visibility, paint: l.paint }));
    expect(strip(apply(kxBaseStyle('k', 'sat'), 'topo'))).toEqual(strip(kxBaseStyle('k', 'topo')));
    expect(strip(apply(kxBaseStyle('k', 'topo'), 'sat'))).toEqual(strip(kxBaseStyle('k', 'sat')));
  });

  it('no toca las capas ajenas al mapa base', () => {
    const ops = kxBaseSwitchOps([{ id: 'vias-layer', type: 'circle' }, { id: 'kx-sun-layer', type: 'raster', metadata: {} }], 'topo');
    expect(ops).toEqual([]);
  });
});

// Escuelas sin conexión (offline-packs.js): cálculo de teselas, reconocimiento de URLs del mapa y copia de datos.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  kxoffTileXY, kxoffTileKeys, kxoffFeaturePoints, kxoffPnoaKey, kxoffGlyphKey, kxoffAncestorKey,
  kxoffSerialize, kxoffRevive, kxoffFormatBytes
} = require('../offline-packs.js');
const { kxBaseStyle } = require('../map-style.js');

const PNOA = 'https://www.ign.es/wmts/pnoa-ma?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=OI.OrthoimageCoverage&STYLE=default&TILEMATRIXSET=GoogleMapsCompatible&TILEMATRIX=17&TILEROW=49230&TILECOL=63356&FORMAT=image/jpeg';

describe('teselas de una escuela', () => {
  it('convierte coordenadas en la tesela que las contiene', () => {
    expect(kxoffTileXY(0, 0, 1)).toEqual([1, 1]);
    expect(kxoffTileXY(-180, 85, 2)).toEqual([0, 0]);
    // La Pedriza a z14
    expect(kxoffTileXY(-3.879682, 40.75292, 14)).toEqual([8015, 6157]);
  });

  it('cubre la zona entera a zoom medio y solo el entorno de los puntos a zoom alto', () => {
    const bounds = [[-3.74, 39.677], [-3.726, 39.688]];
    const keys = kxoffTileKeys(bounds, [[-3.73, 39.68]]);
    const zooms = new Set(keys.map(k => Number(k.split('/')[1])));
    expect([...zooms].sort((a, b) => a - b)).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18]);
    // 150 m alrededor de un punto a z18 (~120 m por tesela): unas pocas teselas, no la escuela entera
    const z18 = keys.filter(k => k.startsWith('t/18/'));
    expect(z18.length).toBeGreaterThan(3);
    expect(z18.length).toBeLessThan(20);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('agrupa puntos casi iguales sin cambiar el resultado', () => {
    const a = kxoffTileKeys(null, [[-3.73, 39.68]]);
    const b = kxoffTileKeys(null, [[-3.73, 39.68], [-3.73001, 39.68001], [-3.73002, 39.68]]);
    expect(b.sort()).toEqual(a.sort());
  });

  it('baja la máxima resolución solo junto a vías y sectores', () => {
    const keys = kxoffTileKeys(null, [[-3.73, 39.68], [-3.75, 39.70]], { finePoints: [[-3.73, 39.68]] });
    const z19 = keys.filter(k => k.startsWith('t/19/'));
    expect(z19.length).toBeGreaterThan(3);
    expect(z19.length).toBeLessThan(20);
    // todas alrededor del punto de escalada, ninguna junto al otro
    const [x, y] = kxoffTileXY(-3.73, 39.68, 19);
    z19.forEach(k => {
      const [, , kx, ky] = k.split('/').map(Number);
      expect(Math.abs(kx - x) + Math.abs(ky - y)).toBeLessThan(6);
    });
    expect(kxoffAncestorKey('t/21/8/8', k => k === 't/19/2/2')).toBe('t/19/2/2');
  });

  it('saca los puntos de puntos, líneas y polígonos', () => {
    const pts = kxoffFeaturePoints([
      { geometry: { type: 'Point', coordinates: [1, 2] } },
      { geometry: { type: 'LineString', coordinates: [[3, 4], [5, 6]] } },
      { geometry: { type: 'Polygon', coordinates: [[[7, 8], [9, 10]]] } },
      { geometry: null }
    ]);
    expect(pts).toEqual([[1, 2], [3, 4], [5, 6], [7, 8], [9, 10]]);
  });
});

describe('URLs del mapa', () => {
  it('reconoce las teselas del PNOA (columna = x, fila = y)', () => {
    expect(kxoffPnoaKey(PNOA)).toBe('t/17/63356/49230');
    expect(kxoffPnoaKey('https://api.maptiler.com/tiles/v3/14/8015/6150?key=k')).toBeNull();
  });

  it('reconoce los glifos de las fuentes de los rótulos', () => {
    expect(kxoffGlyphKey('https://api.maptiler.com/fonts/Noto%20Sans%20Bold/0-255.pbf?key=k')).toBe('g/Noto Sans Bold/0-255');
    expect(kxoffGlyphKey('https://api.maptiler.com/tiles/v3/tiles.json?key=k')).toBeNull();
  });

  it('encuentra la tesela guardada que contiene a una sin descargar', () => {
    const has = k => k === 't/16/100/200';
    expect(kxoffAncestorKey('t/18/401/803', has)).toBe('t/16/100/200');
    expect(kxoffAncestorKey('t/19/802/1606', has)).toBe('t/16/100/200');
    expect(kxoffAncestorKey('t/18/0/0', has)).toBeNull();
  });
});

describe('copia de datos de Firestore', () => {
  it('guarda fechas y coordenadas de Firestore como valores simples y las recupera', () => {
    const ts = { toMillis: () => 1700000000000, toDate: () => new Date(1700000000000) };
    const geo = { latitude: 40.1, longitude: -3.2, isEqual: () => false };
    const data = { createdAt: ts, where: geo, list: [ts], nested: { n: 1 }, s: 'x', d: null };
    const stored = kxoffSerialize(data);
    expect(JSON.parse(JSON.stringify(stored))).toEqual(stored);   // sin clases: se puede clonar y guardar
    const back = kxoffRevive(stored);
    expect(back.createdAt.getTime()).toBe(1700000000000);        // sin Firebase: Date
    expect(back.where).toEqual({ latitude: 40.1, longitude: -3.2 });
    expect(back.list[0].getTime()).toBe(1700000000000);
    expect(back.nested).toEqual({ n: 1 });
    expect(back.d).toBeNull();
  });

  it('formatea tamaños en español', () => {
    expect(kxoffFormatBytes(45200000)).toBe('45 MB');
    expect(kxoffFormatBytes(4520000)).toBe('4,5 MB');
    expect(kxoffFormatBytes(3000)).toBe('3 KB');
  });
});

describe('mapa base sin conexión', () => {
  it('declara las teselas de MapTiler sin pedir los tiles.json', () => {
    const style = kxBaseStyle('k', 'topo', { offline: true });
    ['labels-source', 'contours-source', 'relief-source'].forEach(id => {
      expect(style.sources[id].url, id).toBeUndefined();
      expect(style.sources[id].tiles[0], id).toMatch(/^https:\/\/api\.maptiler\.com\/tiles\/.+\/\{z\}\/\{x\}\/\{y\}\?key=k$/);
    });
    expect(style.sources['labels-source'].maxzoom).toBe(15);
  });

  it('con conexión sigue usando los tiles.json', () => {
    expect(kxBaseStyle('k', 'sat').sources['labels-source'].url).toMatch(/tiles\.json/);
  });
});

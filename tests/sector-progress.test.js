// «Tu exploración» (sector-progress.js): vías únicas encadenadas frente al total del sector,
// foto de cabecera del sector (school-photos.js) y que ningún script redefina funciones de otro.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { kxSectorProgress, kxIsSendStyle } = require('../sector-progress.js');
const { kxSectorPhoto, KX_SECTOR_PHOTOS } = require('../school-photos.js');

const routes = n => Array.from({ length: n }, (_, i) => ({ id: i + 1, name: `V${i + 1}` }));
const sentIds = ids => r => ids.includes(r.id);

describe('progreso de exploración del sector', () => {
  it('sin ascensiones: 0 %, todas pendientes', () => {
    expect(kxSectorProgress(routes(31), () => false)).toEqual({ total: 31, sent: 0, pending: 31, pct: 0, state: 'empty' });
  });
  it('algunas encadenadas: porcentaje redondeado y pendientes', () => {
    const p = kxSectorProgress(routes(31), sentIds([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]));
    expect(p).toMatchObject({ sent: 12, pending: 19, pct: 39, state: 'progress' });
  });
  it('todas encadenadas: 100 % y completado', () => {
    expect(kxSectorProgress(routes(5), () => true)).toMatchObject({ sent: 5, pending: 0, pct: 100, state: 'complete' });
  });
  it('una vía repetida (varias capas o registros) cuenta una sola vez', () => {
    const list = [...routes(4), { id: 2, name: 'V2' }, { id: '2', name: 'V2' }];
    expect(kxSectorProgress(list, sentIds([2]))).toMatchObject({ total: 4, sent: 1 });
  });
  it('sector sin vías: sin porcentaje', () => {
    expect(kxSectorProgress([], () => true)).toMatchObject({ total: 0, pct: null, state: 'no-routes' });
  });
  it('no muestra 100 % con vías pendientes ni 0 % con alguna hecha', () => {
    expect(kxSectorProgress(routes(300), r => r.id <= 299).pct).toBe(99);
    expect(kxSectorProgress(routes(300), r => r.id === 1).pct).toBe(1);
  });
  it('los proyectos e intentos no cuentan como encadenada', () => {
    expect(kxIsSendStyle('project')).toBe(false);
    ['redpoint', 'onsight', 'flash', 'toprope'].forEach(s => expect(kxIsSendStyle(s)).toBe(true));
  });
});

describe('foto de cabecera del sector', () => {
  const school = { id: 'mora', nombre: 'Mora', rockType: 'Granito' };
  it('sin foto propia usa la de la escuela y no la presenta como foto del sector', () => {
    const p = kxSectorPhoto(school, 'Central');
    expect(p.alt).toMatch(/no es una fotografía del sector Central/);
  });
  it('la foto propia del sector tiene prioridad', () => {
    KX_SECTOR_PHOTOS['mora/central'] = { src: 'assets/sectors/mora-central.webp' };
    const p = kxSectorPhoto(school, 'Central');
    expect(p.src).toBe('assets/sectors/mora-central.webp');
    expect(p.generic).toBe(false);
    delete KX_SECTOR_PHOTOS['mora/central'];
  });
});

describe('scripts globales', () => {
  it('ningún script del mapa redefine una función de otro (la última cargada pisaría a la primera)', () => {
    const files = ['map-ui.js', 'maplibre-map.js', 'user-features.js', 'school-photos.js', 'sector-progress.js', 'climb-conditions.js', 'map-search.js', 'gym-info.js'];
    const seen = new Map();
    const dups = [];
    for (const f of files) {
      const src = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
      for (const m of src.matchAll(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm)) {
        if (seen.has(m[1]) && seen.get(m[1]) !== f) dups.push(`${m[1]}: ${seen.get(m[1])} y ${f}`);
        else seen.set(m[1], f);
      }
    }
    expect(dups).toEqual([]);
  });
});

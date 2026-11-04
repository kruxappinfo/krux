// Buscador del mapa: solo escuelas, sectores y vías; mínimo de letras, límites y prioridad de la escuela abierta.
// Carga map-search.js tal cual en un contexto sin DOM (solo expone la lógica pura).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ctx = vm.createContext({ window: {}, console });
vm.runInContext(readFileSync(new URL('../map-search.js', import.meta.url), 'utf8'), ctx, { filename: 'map-search.js' });
const { suggest, MIN_CHARS } = ctx.window.KruxMapSearchLogic;

const norm = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const mk = (kind, schoolId, name, extra = {}) => ({ kind, schoolId, schoolName: schoolId, name, key: norm(name), ...extra });
const index = {
  schools: [{ kind: 'school', id: 'valeria', name: 'Valeria', key: 'valeria' }, { kind: 'school', id: 'cuenca', name: 'Cuenca', key: 'cuenca' }],
  sectors: [mk('sector', 'cuenca', 'Peña del Cuervo'), mk('sector', 'valeria', 'Peña Alta'), mk('sector', 'valeria', 'Placa')],
  routes: [
    mk('route', 'cuenca', 'La peña verde', { grade: '6a' }), mk('route', 'valeria', 'Peñazo', { grade: '7a' }),
    mk('route', 'valeria', 'Pena negra', { grade: '6a' }), mk('route', 'cuenca', 'Otra', { grade: '5c' })
  ]
};
// Mismas reglas que el índice real: contiene la consulta sin acentos; antes los que empiezan por ella
const rank = (key, q) => (key.startsWith(q) ? 0 : 1);
const api = {
  index, norm,
  matchPlaces: (idx, q) => { const nq = norm(q); return [...idx.schools, ...idx.sectors].filter(p => p.key.includes(nq)).sort((a, b) => rank(a.key, nq) - rank(b.key, nq)); },
  matchRoutes: (idx, q) => { const nq = norm(q); return idx.routes.filter(r => r.key.includes(nq) || norm(r.grade) === nq).sort((a, b) => rank(a.key, nq) - rank(b.key, nq)); }
};

describe('buscador del mapa', () => {
  it('no busca con menos de 2 letras', () => {
    expect(MIN_CHARS).toBe(2);
    for (const q of ['', ' ', 'p', ' p ']) {
      const r = suggest(api, q, null);
      expect(r.schools.length + r.sectors.length + r.routes.length).toBe(0);
    }
  });

  it('devuelve solo escuelas, sectores y vías (nunca personas)', () => {
    const r = suggest(api, 'val', null);
    expect(Object.keys(r).sort()).toEqual(['routes', 'schools', 'sectors']);
    expect(r.schools.map(x => x.name)).toEqual(['Valeria']);
    expect([...r.schools, ...r.sectors, ...r.routes].every(x => ['school', 'sector', 'route'].includes(x.kind))).toBe(true);
  });

  it('ignora acentos y mayúsculas', () => {
    const r = suggest(api, 'PEÑA', null);
    expect(r.sectors.map(x => x.name).sort()).toEqual(['Peña Alta', 'Peña del Cuervo']);
    expect(suggest(api, 'pena', null).routes.map(x => x.name).sort()).toEqual(['La peña verde', 'Pena negra', 'Peñazo']);
  });

  it('encuentra vías por grado exacto', () => {
    expect(suggest(api, '7a', null).routes.map(x => x.name)).toEqual(['Peñazo']);
  });

  it('con una escuela abierta, a igual relevancia sus sectores y vías van primero', () => {
    expect(suggest(api, 'peña', 'valeria').sectors[0].schoolId).toBe('valeria');
    expect(suggest(api, 'peña', 'cuenca').sectors[0].schoolId).toBe('cuenca');
    // Pero lo que empieza por la consulta sigue ganando a lo de la escuela abierta
    expect(suggest(api, 'la peña', 'valeria').routes[0].name).toBe('La peña verde');
  });

  it('respeta los límites por sección', () => {
    const big = {
      ...api,
      index: {
        schools: [], sectors: Array.from({ length: 10 }, (_, i) => mk('sector', 'valeria', `Sector ${i}`)),
        routes: Array.from({ length: 20 }, (_, i) => mk('route', 'valeria', `Sector vía ${i}`, { grade: '6a' }))
      }
    };
    const r = suggest(big, 'sector', null);
    expect(r.sectors.length).toBe(4);
    expect(r.routes.length).toBe(6);
  });

  it('sin coincidencias devuelve todo vacío', () => {
    const r = suggest(api, 'zzzz', null);
    expect(r.schools.length + r.sectors.length + r.routes.length).toBe(0);
  });
});

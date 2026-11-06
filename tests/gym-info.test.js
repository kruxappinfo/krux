// Información de rocódromos (gym-info.js): puntuación, ocultación por votos, versión visible y delta de contadores.
// Se carga el archivo tal cual en un contexto aislado; solo se usan sus funciones puras.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SRC = readFileSync(new URL('../gym-info.js', import.meta.url), 'utf8');
const ctx = vm.createContext({ window: {}, console });
vm.runInContext(SRC, ctx, { filename: 'gym-info.js' });
const get = (n) => vm.runInContext(n, ctx);

describe('moderación por votos', () => {
  const hidden = get('kxgIsHidden');
  it('se oculta con 5 «no me gusta» netos y no antes', () => {
    expect(hidden({ up: 0, down: 4 })).toBe(false);
    expect(hidden({ up: 0, down: 5 })).toBe(true);
    expect(hidden({ up: 3, down: 7 })).toBe(false);
    expect(hidden({ up: 3, down: 8 })).toBe(true);
  });
  it('lo restaurado por un admin sigue visible', () => {
    expect(hidden({ up: 0, down: 9, restored: true })).toBe(false);
  });
});

describe('qué se muestra', () => {
  const build = get('kxgBuildView');
  const items = [
    { id: 'h-old', kind: 'hours', text: 'viejo', up: 0, down: 0, createdAt: 1 },
    { id: 'h-new', kind: 'hours', text: 'nuevo', up: 0, down: 0, createdAt: 2 },
    { id: 'p-top', kind: 'price', text: 'bueno', up: 3, down: 0, createdAt: 1 },
    { id: 'p-new', kind: 'price', text: 'nuevo', up: 0, down: 0, createdAt: 5 },
    { id: 'c-bad', kind: 'contact', text: 'spam', up: 0, down: 6, createdAt: 1 },
    { id: 'f1', kind: 'facility', value: 'parking', up: 1, down: 0, createdAt: 1 },
    { id: 'f2', kind: 'facility', value: 'duchas', up: 4, down: 0, createdAt: 1 },
    { id: 'f3', kind: 'facility', value: 'tienda', up: 0, down: 5, createdAt: 1 },
    { id: 'ph1', kind: 'photo', up: 0, down: 0, createdAt: 1 },
    { id: 'ph2', kind: 'photo', up: 2, down: 0, createdAt: 1 },
    { id: 'x', kind: 'otro', up: 9, down: 0 }
  ];
  const v = build(items);
  it('horario, precio y contacto: solo la versión mejor puntuada; a igualdad, la más reciente', () => {
    expect(v.hours.id).toBe('h-new');
    expect(v.price.id).toBe('p-top');
    expect(v.contact).toBe(null);
  });
  it('instalaciones y fotos: todas las visibles, de más a menos votadas', () => {
    expect(v.facilities.map(f => f.id)).toEqual(['f2', 'f1']);
    expect(v.photos.map(p => p.id)).toEqual(['ph2', 'ph1']);
  });
});

describe('contadores', () => {
  const d = get('kxgVoteDelta');
  it('cambia en una unidad al votar, cambiar o retirar el voto', () => {
    expect({ ...d(0, 1) }).toEqual({ up: 1, down: 0 });
    expect({ ...d(1, -1) }).toEqual({ up: -1, down: 1 });
    expect({ ...d(-1, 0) }).toEqual({ up: 0, down: -1 });
  });
  it('id fijo por instalación', () => {
    expect(get('kxgFacilityId')('roco-1', 'parking')).toBe('roco-1__facility__parking');
  });
});

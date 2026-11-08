// Información de rocódromos (gym-info.js): versión visible, denuncias, instalaciones y enlaces.
// Se carga el archivo tal cual en un contexto aislado; solo se usan sus funciones puras.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SRC = readFileSync(new URL('../gym-info.js', import.meta.url), 'utf8');
const ctx = vm.createContext({ window: {}, console, URL });
vm.runInContext(SRC, ctx, { filename: 'gym-info.js' });
const get = (n) => vm.runInContext(n, ctx);

describe('qué se muestra', () => {
  const build = get('kxgBuildView');
  const items = [
    { id: 'h-old', kind: 'hours', text: 'viejo', createdAt: 1 },
    { id: 'h-new', kind: 'hours', text: 'nuevo', createdAt: 2 },
    { id: 'p-old', kind: 'price', text: 'antiguo', createdAt: 1 },
    { id: 'f1', kind: 'facility', value: 'parking', createdAt: 1 },
    { id: 'f2', kind: 'facility', value: 'duchas', createdAt: 5 },
    { id: 'ph1', kind: 'photo', createdAt: 1 },
    { id: 'ph2', kind: 'photo', createdAt: 9 },
    { id: 'x', kind: 'otro', createdAt: 9 }
  ];
  const v = build(items);
  it('horario, precios y contacto: solo la versión más reciente', () => {
    expect(v.hours.id).toBe('h-new');
    expect(v.price.id).toBe('p-old');
    expect(v.contact).toBe(null);
  });
  it('instalaciones y fotos: todas, de más reciente a más antigua; tipos desconocidos fuera', () => {
    expect(v.facilities.map(f => f.id)).toEqual(['f2', 'f1']);
    expect(v.photos.map(p => p.id)).toEqual(['ph2', 'ph1']);
  });
  it('ya no existe la ocultación por votos: una aportación con muchos «no me gusta» heredados sigue visible', () => {
    expect(build([{ id: 'a', kind: 'hours', text: 'x', up: 0, down: 50, createdAt: 1 }]).hours.id).toBe('a');
  });
});

describe('denuncias', () => {
  it('una denuncia por persona y aportación', () => {
    expect(get('kxgReportId')('info1', 'uidA')).toBe('info1__uidA');
    expect(get('kxgReportId')('info1', 'uidB')).not.toBe(get('kxgReportId')('info1', 'uidA'));
  });
  it('motivos disponibles', () => {
    expect(get('KXG_REASONS').map(r => r.value)).toEqual(['incorrect', 'outdated', 'inappropriate']);
  });
  it('id fijo por instalación', () => {
    expect(get('kxgFacilityId')('roco-1', 'parking')).toBe('roco-1__facility__parking');
  });
});

describe('redes y web', () => {
  const norm = get('kxgNormalizeLink');
  it('acepta usuario o enlace y devuelve siempre https de la red elegida', () => {
    expect(norm('instagram', '@sharma')).toBe('https://www.instagram.com/sharma');
    expect(norm('instagram', 'sharma.climbing')).toBe('https://www.instagram.com/sharma.climbing');
    expect(norm('instagram', 'https://instagram.com/sharma/')).toBe('https://instagram.com/sharma/');
    expect(norm('facebook', 'fb.com/sharma')).toBe('https://fb.com/sharma');
    expect(norm('tiktok', '@sharma')).toBe('https://www.tiktok.com/@sharma');
    expect(norm('youtube', 'youtu.be/abc')).toBe('https://youtu.be/abc');
    expect(norm('web', 'www.rocodromo.es')).toBe('https://www.rocodromo.es/');
    expect(norm('web', 'http://rocodromo.es/tarifas')).toBe('https://rocodromo.es/tarifas');
  });
  it('rechaza enlaces de otra red, esquemas peligrosos y basura', () => {
    expect(norm('instagram', 'https://facebook.com/sharma')).toBe(null);
    expect(norm('instagram', 'https://instagram.com.evil.es/x')).toBe(null);
    expect(norm('web', 'javascript:alert(1)')).toBe(null);
    expect(norm('web', 'data:text/html,hola')).toBe(null);
    expect(norm('web', 'https://user:pw@sitio.es')).toBe(null);
    expect(norm('web', 'sin punto')).toBe(null);
    expect(norm('web', 'localhost')).toBe(null);
    expect(norm('myspace', 'x.com')).toBe(null);
    expect(norm('instagram', '')).toBe(null);
  });
  it('en la ficha sale el enlace válido más reciente de cada red, ordenado por red', () => {
    const v = get('kxgBuildView')([
      { id: 'a', kind: 'link', network: 'web', url: 'https://viejo.es', createdAt: 1 },
      { id: 'b', kind: 'link', network: 'web', url: 'https://nuevo.es', createdAt: 5 },
      { id: 'c', kind: 'link', network: 'instagram', url: 'https://www.instagram.com/sharma', createdAt: 1 },
      { id: 'd', kind: 'link', network: 'instagram', url: 'javascript:alert(1)', createdAt: 9 }
    ]);
    expect(v.links.map(l => l.id)).toEqual(['c', 'b']);
    expect(v.links[1].href).toBe('https://nuevo.es/');
  });
});

describe('comentarios', () => {
  const list = get('kxgCommentList'), ago = get('kxgAgo'), route = get('kxgCommentRoute');
  it('usan la colección de comentarios con una clave propia de rocódromo', () => {
    expect(route('abc')).toBe('gym_abc');
  });
  it('más recientes primero y sin textos vacíos', () => {
    const out = list([{ id: 'a', text: 'viejo', createdAt: 1 }, { id: 'b', text: '  ', createdAt: 9 }, { id: 'c', text: 'nuevo', createdAt: 5 }]);
    expect(out.map(c => c.id)).toEqual(['c', 'a']);
  });
  it('tiempo relativo', () => {
    const now = 10 * 24 * 3600e3;
    expect(ago(now - 20e3, now)).toBe('Ahora');
    expect(ago(now - 5 * 60e3, now)).toBe('Hace 5 min');
    expect(ago(now - 3 * 3600e3, now)).toBe('Hace 3 h');
    expect(ago(now - 2 * 24 * 3600e3, now)).toBe('Hace 2 d');
    expect(ago(0, now)).toBe('');
  });
});

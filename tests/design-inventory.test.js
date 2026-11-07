// Inventario de componentes compartidos (design/inventario.json): cada afirmación se contrasta con el código real.
// Si esta prueba falla porque una pantalla adopta (o deja de usar) un componente, actualiza el inventario.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = f => readFileSync(new URL(f, root), 'utf8');
const inv = JSON.parse(read('design/inventario.json'));
const comps = inv.componentes;

// Archivos de la app: el HTML principal y los scripts de la raíz, sin el propio map-ui.js (donde viven los constructores)
const appFiles = ['index.html', ...readdirSync(root).filter(f => f.endsWith('.js') && f !== 'map-ui.js')];
const appText = appFiles.map(read).join('\n');
const appCss = read('app_2.css');
const used = re => new RegExp(re).test(appText);

describe('inventario de componentes: estructura', () => {
  it('cada componente tiene datos completos y un estado válido', () => {
    const ids = new Set();
    for (const c of comps) {
      expect(ids.has(c.id), `id repetido ${c.id}`).toBe(false);
      ids.add(c.id);
      for (const k of ['grupo', 'nombre', 'donde', 'uso', 'pendiente', 'fase']) expect(typeof c[k], `${c.id}.${k}`).toBe('string');
      expect(['integrado', 'parcial', 'no'], c.id).toContain(c.integracion);
      expect(typeof c.construido, c.id).toBe('boolean');
    }
  });

  it('lo que está por construir no tiene marcas de uso; lo construido las tiene (o prueba en el CSS)', () => {
    for (const c of comps) {
      if (!c.construido) { expect(c.marcas, c.id).toBeUndefined(); expect(c.integracion, c.id).toBe('no'); }
      else expect((c.marcas || c.css || []).length, c.id).toBeGreaterThan(0);
    }
  });

  it('lo pendiente de integrar indica la fase en la que se hará', () => {
    for (const c of comps.filter(c => c.integracion !== 'integrado' || !c.construido)) expect(c.fase, c.id).toMatch(/Fase/);
  });

  it('todo constructor de map-ui.js figura en el inventario', () => {
    const marked = comps.flatMap(c => c.marcas || []).join(' ');
    const internos = new Set(['kxHeaderHTML']); // se usa solo a través de kxSheetDragHTML (componente «cabecera»)
    const ctors = [...read('map-ui.js').matchAll(/^function (kx\w+HTML)\b/gm)].map(m => m[1]);
    expect(ctors.length).toBeGreaterThan(10);
    for (const f of ctors) if (!internos.has(f)) expect(marked, `${f} sin entrada en design/inventario.json`).toContain(f);
  });
});

describe('inventario de componentes: coincide con el código', () => {
  for (const c of comps.filter(c => c.marcas)) {
    it(`${c.nombre}: ${c.integracion === 'no' ? 'no se usa en la app' : 'se usa en la app'}`, () => {
      const hits = c.marcas.filter(used);
      if (c.integracion === 'no') expect(hits, `${c.id} se usa ya en la app: actualiza el inventario`).toEqual([]);
      else expect(hits.length, `${c.id} figura como integrado pero no se encuentra en la app`).toBeGreaterThan(0);
    });
  }

  it('los tokens de diseño se usan de verdad en el CSS', () => {
    for (const c of comps.filter(c => c.css)) for (const re of c.css) expect((appCss.match(new RegExp(re, 'g')) || []).length, c.id).toBeGreaterThan(10);
  });
});

describe('inventario de componentes: cifras de lo pendiente', () => {
  const html = read('index.html');
  const n = re => (html.match(re) || []).length;

  it('botones: 2 de 186 usan el botón común', () => {
    expect(n(/<button\b/g)).toBe(186);
    expect(n(/<button[^>]*\bkx-btn\b/g)).toBe(2);
  });

  it('controles de formulario: 3 de 67 usan el campo común', () => {
    expect(n(/<(?:input|select|textarea)\b/g)).toBe(67);
    expect(n(/<(?:input|select|textarea)[^>]*\bkx-field\b/g)).toBe(3);
  });

  it('modales: 33 por identificador, 11 con la clase .modal', () => {
    expect(n(/id="[^"]*-modal"/g)).toBe(33);
    expect(n(/class="(?:[^"]*\s)?modal(?:\s[^"]*)?"/g)).toBe(11);
  });

  it('avisos: el común (user-features.js) y las tres páginas de administración definen su propio showToast', () => {
    const own = ['admin.js', 'admin-routes.js', 'admin-users.js', 'user-features.js'].filter(f => /function showToast\(/.test(read(f)));
    expect(own).toEqual(['admin.js', 'admin-routes.js', 'admin-users.js', 'user-features.js']);
  });
});

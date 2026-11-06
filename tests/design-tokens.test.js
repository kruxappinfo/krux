// Sistema de tokens de diseño: las variables que usa el CSS existen, la paleta de marca no cambia
// y los colores originales de los grados siguen intactos.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const read = f => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const FILES = ['app_2.css', 'app-mobile.css', 'route-drawing.css'];
const css = Object.fromEntries(FILES.map(f => [f, read(f)]));
const all = Object.values(css).join('\n');
const defined = new Set([...all.matchAll(/(--[a-z0-9-]+)\s*:/g)].map(m => m[1]));

// Bloque :root de la marca (empieza en --kx-forest)
const rootBlock = all.slice(all.indexOf('--kx-forest:'), all.indexOf('--kx-forest:') + 6000);
const tokenValue = name => (rootBlock.match(new RegExp(`${name}:\\s*([^;]+);`)) || [])[1]?.trim();

describe('tokens --kx-*', () => {
  it('toda variable --kx-* que se usa está definida en alguna hoja', () => {
    // --kx-sector la define el JS por elemento (color de cada sector); el resto debe vivir en CSS
    const runtime = new Set(['--kx-sector', '--kx-tone', '--kx-tone-bg', '--kx-sheet-y', '--kx-foot-y']);
    const used = new Set([...all.matchAll(/var\((--kx-[a-z0-9-]+)/g)].map(m => m[1]));
    const missing = [...used].filter(v => !defined.has(v) && !runtime.has(v));
    expect(missing).toEqual([]);
  });

  it('la paleta de marca no ha cambiado', () => {
    expect(tokenValue('--kx-forest')).toBe('#153E35');
    expect(tokenValue('--kx-chalk')).toBe('#F7F6F0');
    expect(tokenValue('--kx-granite')).toBe('#202923');
    expect(tokenValue('--kx-stone-card')).toBe('#F3F4F1');
  });

  it('la escala base está completa: texto, espacios, radios, sombras y movimiento', () => {
    const required = [
      '--kx-fs-display', '--kx-fs-title', '--kx-fs-lead', '--kx-fs-body', '--kx-fs-meta', '--kx-fs-caption', '--kx-fs-micro', '--kx-fs-stat',
      '--kx-fw-text', '--kx-fw-strong', '--kx-fw-heavy', '--kx-ls-tight', '--kx-lh-tight', '--kx-lh-body',
      '--kx-space-1', '--kx-space-2', '--kx-space-3', '--kx-space-4', '--kx-space-5', '--kx-space-6', '--kx-space-7', '--kx-space-8', '--kx-touch',
      '--kx-radius-xs', '--kx-radius-sm', '--kx-radius-md', '--kx-radius-lg', '--kx-radius-card', '--kx-radius-pill', '--kx-radius-sheet',
      '--kx-shadow-card', '--kx-shadow-pop', '--kx-shadow-sheet',
      '--kx-ease', '--kx-ease-in', '--kx-dur-fast', '--kx-dur', '--kx-dur-slow',
      '--kx-success-soft', '--kx-warning-soft', '--kx-danger-soft', '--kx-info-soft', '--kx-stone-hover', '--kx-sage-hover'
    ];
    expect(required.filter(t => tokenValue(t) === undefined)).toEqual([]);
  });

  it('el área táctil mínima es de 44 px y los tiempos de movimiento son rápidos', () => {
    expect(tokenValue('--kx-touch')).toBe('44px');
    for (const t of ['--kx-dur-fast', '--kx-dur', '--kx-dur-slow']) expect(parseInt(tokenValue(t), 10)).toBeLessThanOrEqual(400);
  });
});

describe('alias de Entrena', () => {
  it('los tres valores idénticos a la marca apuntan a los tokens kx (sin duplicar el valor)', () => {
    expect(all).toMatch(/--tr-surface:\s*var\(--kx-surface/);
    expect(all).toMatch(/--tr-red:\s*var\(--kx-danger/);
    expect(all).toMatch(/--tr-ease:\s*var\(--kx-ease/);
  });
});

describe('fichas del mapa', () => {
  it('el bloque de componentes usa tokens para los tonos de estado en vez de colores sueltos', () => {
    const raw = readFileSync(new URL('../app_2.css', import.meta.url), 'utf8');
    const a = raw.indexOf('FICHAS DEL MAPA');
    const b = raw.indexOf('Hoja de escuela: el contenido ya no cambia');
    expect(a).toBeGreaterThan(0);
    const block = raw.slice(a, b).replace(/\/\*[\s\S]*?\*\//g, '');
    for (const hex of ['#E6F2EA', '#F7EEDC', '#F8E6E3', '#E5EEF7', '#ECEDE9', '#CFE0D3']) expect(block).not.toContain(hex);
    expect(block).toContain('var(--kx-stone-card)');
  });
});

describe('colores de grado', () => {
  it('la tabla original de getGradeColor no se ha tocado', () => {
    const src = readFileSync(new URL('../maplibre-map.js', import.meta.url), 'utf8');
    const body = src.slice(src.indexOf('const gradeColors = {'));
    const t = body.slice(0, body.indexOf('};'));
    const pick = g => (t.match(new RegExp(`'${g.replace('+', '\\+')}':\\s*'(#[0-9a-fA-F]{6})'`)) || [])[1];
    expect(pick('5c')).toBe('#46923a');
    expect(pick('6a')).toBe('#fff48d');
    expect(pick('6b')).toBe('#ffd919');
    expect(pick('6c')).toBe('#fda750');
    expect(pick('7a')).toBe('#ff6161');
    expect(pick('7c+')).toBe('#b71c1c');
    expect(pick('8a')).toBe('#f463ef');
  });
});

describe('componentes compartidos: sin fugas entre secciones', () => {
  const app = css['app_2.css'];

  it('un único sistema de botones: un .kx-btn, píldora y peso 600, sin variantes de forma', () => {
    expect(app.match(/^\.kx-btn\s*\{/gm)).toHaveLength(1);
    const base = app.match(/^\.kx-btn\s*\{([^}]*)\}/m)[1];
    expect(base).toMatch(/border-radius:\s*var\(--kx-radius-pill\)/);
    expect(base).toMatch(/font-weight:\s*600/);
    // las variantes cambian color, no forma ni peso
    for (const m of app.matchAll(/^\.kx-btn--(primary|secondary|ghost|tertiary|danger)[^{]*\{([^}]*)\}/gm)) {
      expect(m[2], m[0]).not.toMatch(/border-radius|font-weight/);
    }
    // el sistema paralelo de las fichas ya no existe
    expect(app).not.toMatch(/\.kx-btn-(primary|secondary|ghost)\b/);
    expect(app).not.toMatch(/\.kx-btn:where\(/);
  });

  it('los tamaños pequeño, normal y grande; el pequeño conserva 44 px de área táctil', () => {
    expect(app).toMatch(/^\.kx-btn\s*\{[^}]*min-height:\s*44px/m);
    expect(app).toMatch(/\.kx-btn--lg\s*\{[^}]*min-height:\s*52px/);
    expect(app).toMatch(/\.kx-btn--sm\s*\{[^}]*min-height:\s*36px/);
    expect(app).toMatch(/\.kx-btn--sm::before\s*\{[^}]*inset:\s*-4px 0/);
  });

  it('los avisos usan los tonos semánticos de la marca, sin el índigo heredado', () => {
    const toast = app.slice(app.indexOf('.kx-toast {'), app.indexOf('.kx-toast-body'));
    expect(toast).not.toMatch(/#5B6BE6/i);
    for (const [k, t] of [['success', 'success'], ['error', 'danger'], ['info', 'info'], ['warning', 'warning']]) {
      expect(toast).toMatch(new RegExp(`\\.kx-toast-${k}\\s*\\{\\s*--kx-toast-accent:\\s*var\\(--kx-${t}\\b`));
    }
    expect(toast).toMatch(/\.kx-toast-warning \.kx-toast-icon\s*\{[^}]*clip-path/);
  });

  it('ninguna animación compartida se redefine con otro recorrido', () => {
    for (const name of ['kxShimmer', 'kxSpin', 'kxFade', 'kxSheetUp']) {
      expect(app.match(new RegExp(`@keyframes ${name}\\s*\\{`, 'g')), name).toHaveLength(1);
    }
  });

  it('las dos familias de hojas inferiores comparten tirador, sombra y fondo', () => {
    for (const t of ['--kx-scrim', '--kx-sheet-handle', '--kx-shadow-sheet']) expect(tokenValue(t), t).toBeTruthy();
    expect(app).toMatch(/\.kx-sheet-handle\s*\{[^}]*background:\s*var\(--kx-sheet-handle\)/);
    expect(app).toMatch(/\.kx-msheet-grip::before\s*\{[^}]*background:\s*var\(--kx-sheet-handle\)/);
    expect(app).toMatch(/\.kx-sheet-panel\s*\{[^}]*box-shadow:\s*var\(--kx-shadow-sheet\)/);
  });
});

describe('segmentado, campos y popup: reglas del sistema', () => {
  const app = css['app_2.css'];
  it('el segmentado nunca recorta etiquetas', () => {
    const btn = app.match(/^\.kx-seg-btn\s*\{([^}]*)\}/m)[1];
    expect(btn).not.toMatch(/text-overflow|overflow:\s*hidden/);
    expect(btn).toMatch(/flex:\s*1 0 auto/);
    expect(app).toMatch(/\.kx-seg\.is-chips\s*\{/);
  });

  it('las mejoras de campo solo aplican dentro de .kx-formrow (el .kx-field suelto no cambia)', () => {
    const base = app.match(/^\.kx-field\s*\{([^}]*)\}/m)[1];
    expect(base).toMatch(/background:\s*var\(--kx-surface-2\)/);
    expect(app).toMatch(/\.kx-formrow \.kx-field:disabled\s*\{[^}]*border-style:\s*dashed/);
    expect(app).toMatch(/\.kx-formrow \.kx-field\[aria-invalid="true"\]\s*\{/);
  });

  it('el popup limita su tamaño al hueco disponible y desplaza solo el contenido', () => {
    const pop = app.match(/^\.kx-pop\s*\{([^}]*)\}/m)[1];
    expect(pop).toMatch(/width:\s*min\(var\(--kx-pop-w\), calc\(100vw - 32px\)\)/);
    expect(pop).toMatch(/max-height:\s*min\(var\(--kx-pop-max-h\), calc\(100dvh - 32px\)\)/);
    expect(app).toMatch(/\.kx-pop-body\s*\{[^}]*overflow-y:\s*auto/);
  });

  it('ni los chips ni las acciones del popup recortan etiquetas: pasan a otra línea', () => {
    expect(app).toMatch(/\.kx-seg\.is-chips\s*\{[^}]*flex-wrap:\s*wrap/);
    expect(app).toMatch(/\.kx-pop-foot\s*\{\s*flex-wrap:\s*wrap/);
    const foot = app.match(/^\.kx-pop-foot > \.kx-btn\s*\{([^}]*)\}/m)[1];
    expect(foot).not.toMatch(/min-width:\s*0|ellipsis/);
  });
});

describe('catálogo: regla de títulos de popup', () => {
  it('los títulos de popup no van en mayúsculas completas', () => {
    const cat = readFileSync(new URL('../design/componentes.html', import.meta.url), 'utf8');
    const popups = cat.slice(cat.indexOf('// Popups:'), cat.indexOf("$('sheet-a')"));
    expect(popups).not.toMatch(/upper:\s*true/);
  });
});

describe('tonos, filas, datos y acciones: reglas del sistema', () => {
  const app = css['app_2.css'];
  const lum = hex => { const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
  const tok = n => (app.match(new RegExp(`${n}:\\s*(#[0-9A-Fa-f]{6})`)) || [])[1];

  it('el texto de cada tono semántico llega a 4,5:1 sobre su fondo suave, el blanco y el blanco cálido', () => {
    for (const t of ['success', 'warning', 'danger', 'info']) {
      const ink = tok(`--kx-${t}-ink`), bg = tok(`--kx-${t}-soft`);
      expect(ink, t).toBeTruthy();
      for (const surface of [bg, '#FFFFFF', tok('--kx-chalk')]) expect(ratio(ink, surface), `${t} sobre ${surface}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('cada tono usa su tinta para el texto de la etiqueta', () => {
    for (const t of ['success', 'warning', 'danger', 'info']) expect(app).toMatch(new RegExp(`\\.kx-tone-${t}\\s*\\{[^}]*--kx-tone-ink:\\s*var\\(--kx-${t}-ink\\)`));
    expect(app).toMatch(/\.kx-tag\s*\{[^}]*color:\s*var\(--kx-tone-ink, var\(--kx-tone\)\)/);
  });

  it('etiquetas, filas, datos y acciones no recortan texto: parten líneas', () => {
    expect(app).not.toMatch(/\.kx-tag\s*\{[^}]*white-space:\s*nowrap/);
    expect(app).toMatch(/\.kx-act\s*\{[^}]*white-space:\s*normal/);
    expect(app).toMatch(/\.kx-lact\s*\{[^}]*white-space:\s*normal/);
    expect(app).toMatch(/\.kx-irow-value\s*\{[^}]*overflow-wrap:\s*anywhere/);
    expect(app).toMatch(/\.kx-stat-value\s*\{[^}]*overflow-wrap:\s*break-word/);
    expect(app).toMatch(/\.kx-stat-value\s*\{[^}]*hyphens:\s*manual/);   // sin guiones automáticos
  });

  it('deshabilitado y ocupado no dependen solo del color y el dato ausente tiene borde de 3:1', () => {
    expect(app).toMatch(/\.kx-act:disabled[^{]*\{[^}]*inset 0 0 0 1px/);
    expect(app).toMatch(/\.kx-lact:disabled[^{]*\{[^}]*border-style:\s*dashed/);
    expect(app).toMatch(/\.kx-stat\.is-missing\s*\{[^}]*dashed rgba\(32, 41, 35, 0\.5\)/);
    expect(app).toMatch(/\.kx-act\[aria-busy="true"\] \.kx-act-icon::after/);
  });

  it('los botones nuevos reinician la sombra y el borde del botón global', () => {
    expect(app).toMatch(/\.kx-stat\.is-action, \.kx-irow--action, \.kx-state-retry\s*\{\s*box-shadow:\s*none/);
  });
});

describe('gráfico de grados: sin texto recortado', () => {
  const app = css['app_2.css'];
  it('la píldora del filtro no corta el lugar ni separa el grado del recuento', () => {
    const txt = app.match(/\.kx-gfocus-txt\s*\{([^}]*)\}/)[1];
    const small = app.match(/\.kx-gfocus-txt small\s*\{([^}]*)\}/)[1];
    expect(txt).toMatch(/display:\s*block/);
    expect(small).not.toMatch(/ellipsis|nowrap|overflow:\s*hidden/);
  });
  it('los grados del eje y las cifras no se recortan', () => {
    expect(app.match(/\.kx-gchart-xl\s*\{([^}]*)\}/)[1]).not.toMatch(/ellipsis|overflow:\s*hidden/);
    expect(app.match(/\.kx-gchart-sum b\s*\{([^}]*)\}/)[1]).not.toMatch(/ellipsis|overflow:\s*hidden/);
  });
});

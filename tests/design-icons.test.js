// Familia de iconos KRUX (Fase 1, en revisión): estructura, códigos del tiempo y aislamiento.
// La familia vive en design/ y la app todavía no la usa; estas pruebas lo garantizan.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const read = f => readFileSync(new URL(f, root), 'utf8');
const ctx = vm.createContext({});
vm.runInContext(read('design/krux-icons.js') + ';this.KXI = KXI; this.kxiWeatherFor = kxiWeatherFor; this.kxiSVG = kxiSVG; this.KXI_CSS = KXI_CSS;', ctx);
const { KXI, kxiWeatherFor, kxiSVG, KXI_CSS } = ctx;

describe('familia de iconos', () => {
  it('incluye los 10 iconos meteorológicos pedidos', () => {
    for (const n of ['sol', 'nubes', 'solNubes', 'lluvia', 'lluviaIntensa', 'tormenta', 'nieve', 'viento', 'humedad', 'direccionViento']) {
      expect(KXI[n], n).toBeTruthy();
      expect(KXI[n].g).toBe('tiempo');
    }
  });

  it('cada icono tiene grupo, nombre en español y un cuerpo SVG', () => {
    for (const [k, v] of Object.entries(KXI)) {
      expect(['tiempo', 'escalada', 'interfaz'], k).toContain(v.g);
      expect(v.label.length, k).toBeGreaterThan(1);
      expect(v.body, k).toMatch(/^<(path|circle|rect|ellipse)\b/);
    }
  });

  it('ningún icono fija colores, grosores ni rellenos: todo lo decide el CSS', () => {
    for (const [k, v] of Object.entries(KXI)) {
      expect(v.body, k).not.toMatch(/#[0-9a-fA-F]{3,6}|stroke-width|fill="|stroke="|style=/);
    }
  });

  it('solo usa las capas previstas (p, t, s, w, b, c, r, d, f)', () => {
    for (const [k, v] of Object.entries(KXI)) {
      for (const m of v.body.matchAll(/class="([^"]+)"/g)) {
        for (const c of m[1].split(/\s+/)) expect(['p', 't', 's', 'w', 'b', 'c', 'r', 'd', 'f'], `${k}: ${c}`).toContain(c);
      }
    }
  });

  it('el SVG generado usa la rejilla de 24 y es accesible', () => {
    const decorative = kxiSVG('sol');
    expect(decorative).toMatch(/viewBox="0 0 24 24"/);
    expect(decorative).toMatch(/aria-hidden="true"/);
    expect(kxiSVG('sol', { label: 'Despejado' })).toMatch(/role="img" aria-label="Despejado"/);
    expect(kxiSVG('no-existe')).toBe('');
  });

  it('el trazo base es 1,75 con terminaciones redondeadas', () => {
    expect(KXI_CSS).toMatch(/stroke-width:var\(--kxi-sw,1\.75\)/);
    expect(KXI_CSS).toMatch(/stroke-linecap:round/);
    expect(KXI_CSS).toMatch(/stroke-linejoin:round/);
  });
});

describe('códigos WMO de Open-Meteo', () => {
  const ALL = [0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99];

  it('todo código documentado tiene un icono existente', () => {
    for (const c of ALL) expect(KXI[kxiWeatherFor(c)], String(c)).toBeTruthy();
  });

  it('distingue lluvia de lluvia intensa, nieve y tormenta', () => {
    expect(kxiWeatherFor(0)).toBe('sol');
    expect(kxiWeatherFor(2)).toBe('solNubes');
    expect(kxiWeatherFor(3)).toBe('nubes');
    expect(kxiWeatherFor(61)).toBe('lluvia');
    expect(kxiWeatherFor(80)).toBe('lluvia');
    expect(kxiWeatherFor(65)).toBe('lluviaIntensa');
    expect(kxiWeatherFor(82)).toBe('lluviaIntensa');
    expect(kxiWeatherFor(73)).toBe('nieve');
    expect(kxiWeatherFor(95)).toBe('tormenta');
  });
});

describe('aislamiento: la app todavía no usa la familia', () => {
  it('index.html no carga krux-icons.js', () => {
    expect(read('index.html')).not.toMatch(/krux-icons/);
  });

  it('ningún script de la app llama a la familia nueva', () => {
    const js = readdirSync(root).filter(f => f.endsWith('.js'));
    for (const f of js) expect(read(f), f).not.toMatch(/kxiSVG|KXI\[|kxiWeatherFor/);
  });

  it('la carpeta design/ no se copia a www/ (no se publica en GitHub Pages ni Netlify)', () => {
    const build = read('scripts/build-www.sh');
    expect(build).not.toMatch(/design/);
    expect(build).not.toMatch(/cp -r "\$PROJECT_ROOT"\/\*|rsync/);
  });
});

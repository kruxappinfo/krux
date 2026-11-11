// Sol y sombra (sun-map.js): posición del sol, orto/ocaso y sombreado del relieve sobre mallas sintéticas.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { kxSunPosition, kxSunDateAt, kxSunDayRange, kxSunDecodeTerrain, kxSunShade, kxSunHourSamples, kxSunHeatColor } = require('../sun-map.js');

const MADRID = { lat: 40.4168, lng: -3.7038 };

// Malla plana de `w`×`h` celdas de 30 m con una cresta norte-sur de `ridge` metros en la columna central
function grid({ w = 60, h = 20, ridge = 0 } = {}) {
  const data = new Float32Array(w * h).fill(500);
  if (ridge) for (let y = 0; y < h; y++) data[y * w + w / 2] = 500 + ridge;
  return { data, w, h, cell: 30, max: 500 + ridge };
}

describe('posición del sol', () => {
  it('culmina al sur con la altura esperada en el solsticio de verano', () => {
    let best = { altitude: -90 };
    for (let m = 0; m < 1440; m++) {
      const p = kxSunPosition(new Date(Date.UTC(2026, 5, 21, 0, m)), MADRID.lat, MADRID.lng);
      if (p.altitude > best.altitude) best = p;
    }
    expect(best.altitude).toBeCloseTo(90 - MADRID.lat + 23.44, 0);
    expect(Math.abs(best.azimuth - 180)).toBeLessThan(2);
  });

  it('sale por el este y se pone por el oeste; en invierno culmina mucho más bajo', () => {
    const am = kxSunPosition(new Date(Date.UTC(2026, 2, 20, 7, 0)), MADRID.lat, MADRID.lng);
    const pm = kxSunPosition(new Date(Date.UTC(2026, 2, 20, 17, 0)), MADRID.lat, MADRID.lng);
    expect(am.azimuth).toBeGreaterThan(80); expect(am.azimuth).toBeLessThan(120);
    expect(pm.azimuth).toBeGreaterThan(240); expect(pm.azimuth).toBeLessThan(280);
    const winter = kxSunPosition(new Date(Date.UTC(2026, 11, 21, 12, 15)), MADRID.lat, MADRID.lng);
    expect(winter.altitude).toBeCloseTo(90 - MADRID.lat - 23.44, 0);
  });

  it('el día dura unas 15 h en junio y unas 9 h en diciembre', () => {
    const june = kxSunDayRange('2026-06-21', MADRID.lat, MADRID.lng);
    const dec = kxSunDayRange('2026-12-21', MADRID.lat, MADRID.lng);
    expect((june.set - june.rise) / 60).toBeCloseTo(15.1, 0);
    expect((dec.set - dec.rise) / 60).toBeCloseTo(9.3, 0);
    expect(kxSunPosition(kxSunDateAt('2026-06-21', june.rise + 30), MADRID.lat, MADRID.lng).altitude).toBeGreaterThan(0);
  });
});

describe('relieve y sombreado', () => {
  it('decodifica Terrain-RGB a metros', () => {
    // 1000 m → (1000 + 10000) / 0,1 = 110000 = 0x01ADB0
    expect(kxSunDecodeTerrain(new Uint8ClampedArray([0x01, 0xAD, 0xB0, 255]), 1)[0]).toBeCloseTo(1000, 3);
  });

  it('un llano recibe sol de lleno de día y nada de noche', () => {
    const g = grid();
    expect(Array.from(kxSunShade(g, 135, 40)).every(v => v === 1)).toBe(true);
    expect(Array.from(kxSunShade(g, 135, -5)).every(v => v === 0)).toBe(true);
  });

  it('una cresta da sombra al lado contrario al sol, con la longitud que marca su altura', () => {
    const g = grid({ ridge: 100 });
    const row = 10 * g.w, mid = g.w / 2;
    // Sol al este a 20°: la sombra de 100 m mide 100 / tan 20° ≈ 275 m ≈ 9 celdas hacia el oeste
    const east = kxSunShade(g, 90, 20);
    expect(east[row + mid - 5]).toBe(0);
    expect(east[row + mid - 14]).toBe(1);
    expect(east[row + mid + 5]).toBe(1);
    // Con el sol al oeste la sombra cambia de lado
    const west = kxSunShade(g, 270, 20);
    expect(west[row + mid + 5]).toBe(0);
    expect(west[row + mid - 5]).toBe(1);
    // Sol alto: la sombra casi desaparece
    expect(kxSunShade(g, 90, 80)[row + mid - 5]).toBe(1);
  });

  it('una ladera que mira al norte queda en sombra con el sol bajo al sur', () => {
    const w = 20, h = 20, data = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = y * 30;   // sube hacia el sur a 45°
    const out = kxSunShade({ data, w, h, cell: 30, max: 600 }, 180, 25);
    expect(out[10 * w + 10]).toBe(0);
  });
});

describe('horas de sol', () => {
  it('muestrea el día entre el orto y el ocaso', () => {
    const s = kxSunHourSamples({ rise: 480, set: 1080 }, 20);
    expect(s.length).toBe(30);
    expect(s[0]).toBe(490);
    expect(kxSunHourSamples({ rise: null, set: null })).toEqual([]);
  });

  it('la rampa va de oscuro a claro', () => {
    const lum = c => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    const steps = [0, 0.25, 0.5, 0.75, 1].map(t => lum(kxSunHeatColor(t)));
    for (let i = 1; i < steps.length; i++) expect(steps[i]).toBeGreaterThan(steps[i - 1]);
  });
});

// Condiciones para escalar (climb-conditions.js) y fotos de escuela (school-photos.js): cálculo orientativo
// del grip con datos completos, incompletos o ausentes, diferencias bloque/deportiva y exposición de sectores.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { kxcWeatherFromOpenMeteo, kxcEstimateGrip, kxcEstimateSchool } = require('../climb-conditions.js');
const { kxSchoolPhoto, KX_SCHOOL_PHOTOS } = require('../school-photos.js');

// Respuesta de Open-Meteo: 72 h de histórico con lluvia opcional hace `rainAgo` horas
function om({ t = 12, rh = 45, dew = 0, wind = 10, precip = 0, code = 1, time = '2026-11-07T10:00', rainAgo = null, rainMm = 4, hours = 72, radiation = 0, isDay = 1 } = {}) {
  const now = Date.UTC(2026, 10, 7, 10, 0);
  const times = [], pr = [];
  for (let h = hours; h >= 0; h--) {
    const d = new Date(now - h * 3600000);
    times.push(d.toISOString().slice(0, 16));
    pr.push(rainAgo !== null && h === rainAgo ? rainMm : 0);
  }
  return {
    current: { time, temperature_2m: t, relative_humidity_2m: rh, dew_point_2m: dew, wind_speed_10m: wind, precipitation: precip, precipitation_probability: 10, weather_code: code, is_day: isDay, shortwave_radiation: radiation },
    hourly: { time: times, precipitation: pr }
  };
}

describe('lectura del tiempo', () => {
  it('resume la lluvia de las últimas 72 h y las horas desde la última', () => {
    const w = kxcWeatherFromOpenMeteo(om({ rainAgo: 10, rainMm: 3 }));
    expect(w.rain.hoursSince).toBe(10);
    expect(w.rain.last24).toBe(3);
    expect(w.rh).toBe(45);
  });
  it('sin histórico horario no inventa lluvia ni sequedad', () => {
    const d = om(); delete d.hourly;
    expect(kxcWeatherFromOpenMeteo(d).rain).toBeNull();
    expect(kxcWeatherFromOpenMeteo(null).tempC).toBeNull();
  });
});

describe('grip estimado', () => {
  it('día fresco, seco y con brisa: grip alto y condiciones óptimas', () => {
    const e = kxcEstimateGrip(kxcWeatherFromOpenMeteo(om()), { rockType: 'Caliza', exposure: 'shade' });
    expect(e.score).toBeGreaterThanOrEqual(80);
    expect(e.condition.label).toBe('Óptimas');
    expect(e.confidence).toBe('high');
    expect(e.display).toBe(String(e.score));
  });

  it('lloviendo: roca mojada y condiciones desfavorables', () => {
    const e = kxcEstimateGrip(kxcWeatherFromOpenMeteo(om({ precip: 1.2, code: 61 })), { rockType: 'Caliza', exposure: 'sun' });
    expect(e.factors.rock.state).toBe('wet');
    expect(e.score).toBeLessThanOrEqual(25);
    expect(e.condition.label).toBe('Desfavorables');
  });

  it('tras la lluvia, la sombra tarda más en secar que el sol', () => {
    const w = kxcWeatherFromOpenMeteo(om({ rainAgo: 8, rainMm: 5 }));
    const sun = kxcEstimateGrip(w, { rockType: 'Caliza', exposure: 'sun' });
    const shade = kxcEstimateGrip(w, { rockType: 'Caliza', exposure: 'shade' });
    expect(sun.factors.rock.state).toBe('dry');
    expect(['wet', 'drying']).toContain(shade.factors.rock.state);
    expect(shade.score).toBeLessThan(sun.score);
  });

  it('la arenisca mojada no se da por escalable', () => {
    const e = kxcEstimateGrip(kxcWeatherFromOpenMeteo(om({ rainAgo: 6, rainMm: 5 })), { rockType: 'Arenisca', exposure: 'sun' });
    expect(e.factors.rock.score).toBeLessThanOrEqual(15);
  });

  it('sin histórico de lluvia: confianza baja y sin cifra (no se asume roca seca)', () => {
    const d = om(); delete d.hourly;
    const e = kxcEstimateGrip(kxcWeatherFromOpenMeteo(d), { rockType: 'Caliza', exposure: 'shade' });
    expect(e.factors.rock.state).toBe('unknown');
    expect(e.confidence).toBe('low');
    expect(e.limited).toBe(true);
    expect(e.display).toBeNull();
    expect(e.missing).toContain('lluvia reciente');
  });

  it('sin humedad: estimación limitada', () => {
    const d = om(); delete d.current.relative_humidity_2m;
    const e = kxcEstimateGrip(kxcWeatherFromOpenMeteo(d), { rockType: 'Caliza', exposure: 'shade' });
    expect(e.limited).toBe(true);
    expect(e.factors.humidity).toBeNull();
  });

  it('confianza media redondea la cifra a múltiplos de 5', () => {
    const d = om(); delete d.current.dew_point_2m;
    const e = kxcEstimateGrip(kxcWeatherFromOpenMeteo(d), { rockType: 'Caliza' });   // sin rocío ni orientación
    expect(e.confidence).toBe('medium');
    expect(Number(e.display) % 5).toBe(0);
  });

  it('bloque pide más frío y menos humedad que deportiva', () => {
    const w = kxcWeatherFromOpenMeteo(om({ t: 19, rh: 62, dew: 8 }));
    const sport = kxcEstimateGrip(w, { rockType: 'Granito', exposure: 'shade' }, 'sport');
    const boulder = kxcEstimateGrip(w, { rockType: 'Granito', exposure: 'shade' }, 'boulder');
    expect(boulder.score).toBeLessThan(sport.score);
    expect(boulder.discipline).toBe('boulder');
  });

  it('al sol la roca se calienta: la temperatura efectiva sube con radiación', () => {
    const w = kxcWeatherFromOpenMeteo(om({ t: 20, radiation: 700, time: '2026-11-07T15:00' }));
    const afternoon = kxcEstimateGrip(w, { rockType: 'Caliza', exposure: 'afternoon' });
    const shade = kxcEstimateGrip(w, { rockType: 'Caliza', exposure: 'shade' });
    expect(afternoon.sunOn).toBe(true);
    expect(afternoon.factors.temp.effective).toBeGreaterThan(shade.factors.temp.effective);
    expect(afternoon.score).toBeLessThan(shade.score);
  });

  it('condensación: cerca del punto de rocío la roca está húmeda', () => {
    const e = kxcEstimateGrip(kxcWeatherFromOpenMeteo(om({ t: 6, rh: 95, dew: 5.4 })), { rockType: 'Caliza', exposure: 'shade' });
    expect(e.factors.rock.state).toBe('damp');
  });
});

describe('escuela con sectores de distinta exposición', () => {
  it('informa del rango por sector cuando difiere', () => {
    const w = kxcWeatherFromOpenMeteo(om({ rainAgo: 8, rainMm: 5 }));
    const e = kxcEstimateSchool(w, { rockType: 'Caliza', exposures: ['sun', 'shade'] });
    expect(e.perExposure).toHaveLength(2);
    expect(e.range).not.toBeNull();
    expect(e.range.worst).toBe('sombra');
    expect(e.secondary).not.toContain('orientación');
  });
  it('una sola exposición usa directamente su estimación', () => {
    const w = kxcWeatherFromOpenMeteo(om());
    const e = kxcEstimateSchool(w, { rockType: 'Caliza', exposures: ['shade'] });
    expect(e.exposure).toBe('shade');
  });
});

describe('fotos de escuela', () => {
  it('sin foto propia usa la ilustración genérica de su roca y lo dice', () => {
    const p = kxSchoolPhoto({ id: 'x', nombre: 'Prueba', rockType: 'Granito' });
    expect(p.generic).toBe(true);
    expect(p.src).toMatch(/generic\/granito/);
    expect(p.alt).toMatch(/no es una fotografía/);
  });
  it('roca desconocida: ilustración genérica por defecto', () => {
    expect(kxSchoolPhoto({ id: 'x', nombre: 'P', rockType: 'Ofita' }).src).toMatch(/generic\/roca/);
  });
  it('la foto configurada de una escuela tiene prioridad', () => {
    KX_SCHOOL_PHOTOS.prueba = { src: 'assets/schools/prueba.webp', width: '70%' };
    const p = kxSchoolPhoto({ id: 'prueba', nombre: 'Prueba', rockType: 'Caliza' });
    expect(p.generic).toBe(false);
    expect(p.width).toBe('70%');
    delete KX_SCHOOL_PHOTOS.prueba;
  });
});

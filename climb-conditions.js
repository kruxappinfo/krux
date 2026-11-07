// ================== KRUX CONDICIONES PARA ESCALAR ==================
// Estimación orientativa del «grip» de la roca (0–100) y de las condiciones generales de una escuela a partir
// del tiempo (Open-Meteo) y de las características de la escuela (tipo de roca y exposición de sus sectores).
// NO es una medición física del rozamiento: combina variables meteorológicas con reglas empíricas.
// Sin DOM ni red: la ficha de escuela (maplibre-map.js) le pasa los datos y pinta el resultado.
// Para mejorar el algoritmo basta con cambiar este archivo: la interfaz solo lee el objeto que devuelve.

// ============================================
// PARÁMETROS DEL MODELO
// ============================================

// Temperatura del aire ideal por modalidad (°C). En bloque se busca más frío: la fricción de las presas manda.
const KXC_TEMP_IDEAL = {
  sport: { lo: 8, hi: 18 },
  boulder: { lo: 3, hi: 14 }
};

// Comportamiento de cada roca: desplazamiento de la temperatura ideal, horas de secado tras una lluvia moderada
// y si mojada es frágil (arenisca: no se debe escalar húmeda).
const KXC_ROCKS = {
  caliza: { shift: 0, dryH: 8, fragile: false, label: 'caliza' },
  granito: { shift: -2, dryH: 5, fragile: false, label: 'granito' },
  arenisca: { shift: -1, dryH: 36, fragile: true, label: 'arenisca' },
  conglomerado: { shift: 0, dryH: 14, fragile: false, label: 'conglomerado' },
  cuarcita: { shift: -1, dryH: 6, fragile: false, label: 'cuarcita' },
  gneis: { shift: -2, dryH: 6, fragile: false, label: 'gneis' },
  basalto: { shift: -1, dryH: 6, fragile: false, label: 'basalto' }
};
const KXC_ROCK_DEFAULT = { shift: 0, dryH: 10, fragile: false, label: 'roca' };

// Exposición del sector: horas (locales) con sol directo y cuánto alarga o acorta el secado
const KXC_EXPOSURE = {
  morning: { sunFrom: 7, sunTo: 13, dry: 1.0, label: 'sol de mañana' },
  midday: { sunFrom: 11, sunTo: 16, dry: 0.9, label: 'sol a mediodía' },
  afternoon: { sunFrom: 13, sunTo: 20, dry: 1.0, label: 'sol de tarde' },
  sun: { sunFrom: 8, sunTo: 19, dry: 0.75, label: 'sol' },
  shade: { sunFrom: null, sunTo: null, dry: 1.8, label: 'sombra' }
};

// Peso de cada factor en la puntuación por modalidad
const KXC_WEIGHTS = {
  sport: { temp: 0.35, humidity: 0.25, wind: 0.1, rock: 0.3 },
  boulder: { temp: 0.3, humidity: 0.3, wind: 0.1, rock: 0.3 }
};

const KXC_CONDITIONS = [
  { key: 'optimal', min: 80, label: 'Óptimas', tone: 'success' },
  { key: 'favorable', min: 60, label: 'Favorables', tone: 'success' },
  { key: 'acceptable', min: 40, label: 'Aceptables', tone: 'warning' },
  { key: 'unfavorable', min: -Infinity, label: 'Desfavorables', tone: 'danger' }
];

// ============================================
// UTILIDADES
// ============================================
const kxcNum = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const kxcClamp = (v, a = 0, b = 100) => Math.max(a, Math.min(b, v));

// Interpolación lineal sobre puntos [x, y] ordenados por x
function kxcCurve(x, pts) {
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    if (x <= x1) {
      const [x0, y0] = pts[i - 1];
      return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
    }
  }
  return pts[pts.length - 1][1];
}

function kxcRock(rockType) {
  const k = String(rockType || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  return KXC_ROCKS[k] ? { key: k, ...KXC_ROCKS[k] } : { key: k || null, ...KXC_ROCK_DEFAULT };
}

// Hora local «2026-11-07T15:30» → 15.5 (Open-Meteo con timezone=auto da la hora local de la escuela)
function kxcLocalHour(iso) {
  const m = /T(\d{2}):(\d{2})/.exec(String(iso || ''));
  return m ? Number(m[1]) + Number(m[2]) / 60 : null;
}

// Fechas locales sin zona: se comparan entre sí, así que basta con leerlas igual
function kxcMs(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(iso || ''));
  return m ? Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5]) : null;
}

// ============================================
// LECTURA DEL TIEMPO (respuesta de Open-Meteo de la ficha de escuela)
// ============================================
// Devuelve solo lo que existe; lo ausente queda en null (nunca se rellena con un valor «razonable»).
function kxcWeatherFromOpenMeteo(data) {
  const c = (data && data.current) || {};
  const w = {
    time: c.time || null,
    tempC: kxcNum(c.temperature_2m),
    rh: kxcNum(c.relative_humidity_2m),
    dewC: kxcNum(c.dew_point_2m),
    windKmh: kxcNum(c.wind_speed_10m),
    precipNow: kxcNum(c.precipitation),
    precipProb: kxcNum(c.precipitation_probability),
    weatherCode: kxcNum(c.weather_code),
    isDay: c.is_day === 1 ? true : c.is_day === 0 ? false : null,
    radiation: kxcNum(c.shortwave_radiation),
    rain: null   // { hoursSince, last24, last72 } o null si no hay histórico
  };
  const h = data && data.hourly;
  const now = kxcMs(w.time);
  if (h && Array.isArray(h.time) && Array.isArray(h.precipitation) && now !== null) {
    let last24 = 0, last72 = 0, lastWet = null, valid = 0;
    h.time.forEach((t, i) => {
      const ms = kxcMs(t), mm = kxcNum(h.precipitation[i]);
      if (ms === null || mm === null || ms > now) return;
      valid++;
      const ago = (now - ms) / 3600000;
      if (ago <= 72) last72 += mm;
      if (ago <= 24) last24 += mm;
      if (mm >= 0.2 && (lastWet === null || ago < lastWet)) lastWet = ago;
    });
    // Con menos de un día de histórico no se puede decir que no haya llovido
    if (valid >= 24) w.rain = { hoursSince: lastWet, last24: Math.round(last24 * 10) / 10, last72: Math.round(last72 * 10) / 10, coverH: valid };
  }
  return w;
}

// ============================================
// FACTORES
// ============================================

// ¿Le da el sol ahora a un sector con esa exposición?
function kxcSunOn(exposure, hour, w) {
  const e = KXC_EXPOSURE[exposure];
  if (!e || e.sunFrom === null || hour === null) return false;
  if (w.isDay === false) return false;
  if (w.radiation !== null && w.radiation < 150) return false;   // cubierto o sol muy bajo
  return hour >= e.sunFrom && hour < e.sunTo;
}

function kxcTempFactor(w, rock, discipline, sunOn) {
  if (w.tempC === null) return null;
  const ideal = KXC_TEMP_IDEAL[discipline] || KXC_TEMP_IDEAL.sport;
  // Al sol la roca se calienta por encima del aire (más en bloque, donde el contacto con la presa es mayor)
  const sunBoost = sunOn ? Math.min(10, (w.radiation !== null ? w.radiation / 90 : 5)) * (discipline === 'boulder' ? 1.2 : 1) : 0;
  const eff = w.tempC + sunBoost;
  const lo = ideal.lo + rock.shift, hi = ideal.hi + rock.shift;
  const score = kxcClamp(kxcCurve(eff, [[lo - 14, 0], [lo - 6, 45], [lo, 100], [hi, 100], [hi + 8, 50], [hi + 16, 5]]));
  const rating = eff < lo - 6 ? 'Fría' : eff < lo ? 'Fresca' : eff <= hi ? 'Óptima' : eff <= hi + 8 ? 'Templada' : 'Calurosa';
  return { value: w.tempC, effective: Math.round(eff * 10) / 10, sunOn, score: Math.round(score), rating, tone: kxcTone(score) };
}

function kxcHumidityFactor(w, discipline) {
  if (w.rh === null) return null;
  const pts = discipline === 'boulder'
    ? [[0, 100], [35, 100], [50, 80], [65, 55], [80, 25], [95, 5]]
    : [[0, 100], [40, 100], [55, 85], [70, 60], [85, 30], [97, 10]];
  const score = kxcClamp(kxcCurve(w.rh, pts));
  const rating = w.rh <= 45 ? 'Baja' : w.rh <= 60 ? 'Buena' : w.rh <= 78 ? 'Alta' : 'Muy alta';
  return { value: w.rh, score: Math.round(score), rating, tone: kxcTone(score) };
}

function kxcWindFactor(w) {
  if (w.windKmh === null) return null;
  // Algo de viento seca y refresca; mucho incomoda y es peligroso en vías largas
  const score = kxcClamp(kxcCurve(w.windKmh, [[0, 70], [5, 85], [10, 100], [22, 100], [32, 70], [45, 35], [60, 10]]));
  const rating = w.windKmh < 5 ? 'Calma' : w.windKmh < 15 ? 'Bajo' : w.windKmh < 30 ? 'Moderado' : 'Fuerte';
  return { value: w.windKmh, score: Math.round(score), rating, tone: w.windKmh >= 30 ? 'warning' : 'success' };
}

// Estado de la roca según la lluvia reciente, el secado (roca, exposición, viento, humedad) y la condensación
function kxcRockFactor(w, rock, exposure, discipline, sunOn) {
  // Lluvia medida ahora: mojada. Solo el código del tiempo (llovizna o chubasco sin cantidad): húmeda, no seca
  const rainCode = w.weatherCode !== null && ((w.weatherCode >= 51 && w.weatherCode <= 67) || (w.weatherCode >= 80 && w.weatherCode <= 99));
  if (w.precipNow !== null && w.precipNow >= 0.1) return { state: 'wet', rating: 'Mojada', score: 5, tone: 'danger', note: 'Está lloviendo' };
  if (rainCode) return { state: 'damp', rating: 'Húmeda', score: 30, tone: 'warning', note: 'Lluvia débil o intermitente en la zona' };
  if (!w.rain) return { state: 'unknown', rating: 'Sin datos', score: null, tone: 'neutral', note: 'Sin datos de lluvia reciente: no se puede saber si la roca está seca' };

  // Condensación: el aire está casi en su punto de rocío (más grave en bloque, por la humedad superficial)
  const spread = w.dewC !== null && w.tempC !== null ? w.tempC + (sunOn ? 3 : 0) - w.dewC : null;

  const { hoursSince, last24, last72 } = w.rain;
  if (hoursSince !== null) {
    const amount = Math.max(last24, last72 / 2);
    let need = rock.dryH * kxcClamp(amount / 5, 0.5, 3);
    need *= (KXC_EXPOSURE[exposure] || { dry: 1.2 }).dry;              // sin exposición conocida: algo más prudente
    if (w.windKmh !== null && w.windKmh >= 10) need *= 0.8;
    if (w.rh !== null && w.rh >= 80) need *= 1.4;
    if (discipline === 'boulder') need *= 1.15;                         // las presas bajas y los pies tardan más
    need = Math.round(need);
    const hs = Math.round(hoursSince);
    if (hoursSince < need * 0.5) return { state: 'wet', rating: rock.fragile ? 'Mojada · frágil' : 'Mojada', score: rock.fragile ? 0 : 15, tone: 'danger', note: `Llovió hace ${hs} h; necesita unas ${need} h para secar` };
    if (hoursSince < need) return { state: 'drying', rating: 'Secándose', score: rock.fragile ? 15 : 50, tone: 'warning', note: `Llovió hace ${hs} h; necesita unas ${need} h para secar` };
  }
  if (spread !== null && spread < 2) return { state: 'damp', rating: 'Húmeda', score: discipline === 'boulder' ? 30 : 45, tone: 'warning', note: 'Riesgo de condensación en la superficie' };
  if (spread !== null && spread < 4) return { state: 'dry', rating: 'Seca', score: discipline === 'boulder' ? 70 : 80, tone: 'success', note: 'Seca, con algo de humedad ambiental' };
  return { state: 'dry', rating: 'Seca', score: 100, tone: 'success', note: hoursSince === null ? 'Sin lluvia en las últimas 72 h' : `Sin lluvia desde hace ${Math.round(hoursSince)} h` };
}

function kxcTone(score) {
  return score >= 70 ? 'success' : score >= 40 ? 'warning' : 'danger';
}

// ============================================
// CÁLCULO PRINCIPAL
// ============================================
// w: kxcWeatherFromOpenMeteo(...). site: { rockType, exposure }. discipline: 'sport' | 'boulder'.
// Devuelve { score, display, condition, confidence, limited, factors, missing, notes }.
function kxcEstimateGrip(w, site = {}, discipline = 'sport') {
  if (!w) w = kxcWeatherFromOpenMeteo(null);
  const disc = KXC_WEIGHTS[discipline] ? discipline : 'sport';
  const rock = kxcRock(site.rockType);
  const exposure = KXC_EXPOSURE[site.exposure] ? site.exposure : null;
  const hour = kxcLocalHour(w.time);
  const sunOn = kxcSunOn(exposure, hour, w);

  const factors = {
    temp: kxcTempFactor(w, rock, disc, sunOn),
    humidity: kxcHumidityFactor(w, disc),
    wind: kxcWindFactor(w),
    rock: kxcRockFactor(w, rock, exposure, disc, sunOn)
  };

  // Variables que faltan: las principales (temperatura, humedad, lluvia) bajan la confianza a «baja»
  const missing = [];
  if (w.tempC === null) missing.push('temperatura');
  if (w.rh === null) missing.push('humedad');
  if (!w.rain) missing.push('lluvia reciente');
  const secondary = [];
  if (w.dewC === null) secondary.push('punto de rocío');
  if (w.windKmh === null) secondary.push('viento');
  if (!exposure && !site.exposureKnown) secondary.push('orientación');
  if (!site.rockType) secondary.push('tipo de roca');

  const weights = KXC_WEIGHTS[disc];
  let sum = 0, wsum = 0;
  for (const k of Object.keys(weights)) {
    const f = factors[k];
    if (!f || f.score === null || f.score === undefined) continue;
    sum += f.score * weights[k]; wsum += weights[k];
  }
  let score = wsum >= 0.5 ? sum / wsum : null;

  // La roca mojada o secándose limita la puntuación aunque el resto sea perfecto
  if (score !== null && factors.rock.state === 'wet') score = Math.min(score, 25);
  if (score !== null && factors.rock.state === 'drying') score = Math.min(score, 60);
  if (score !== null && factors.rock.state === 'damp') score = Math.min(score, 65);
  // Sin histórico de lluvia no se da por seca: techo prudente
  if (score !== null && factors.rock.state === 'unknown') score = Math.min(score, 70);
  if (score !== null) score = Math.round(kxcClamp(score));

  const confidence = missing.length || score === null ? 'low' : secondary.length >= 2 ? 'medium' : 'high';
  const limited = confidence === 'low';

  // Lo que se enseña: entero con confianza alta, múltiplo de 5 con media, nada con baja
  const display = score === null || limited ? null : confidence === 'medium' ? String(Math.round(score / 5) * 5) : String(score);

  const notes = [];
  if (factors.rock && factors.rock.note) notes.push(factors.rock.note);
  if (sunOn) notes.push(`Ahora le da el ${KXC_EXPOSURE[exposure].label}: la roca está más caliente que el aire`);

  return { score, display, confidence, limited, condition: kxcCondition(score, w, factors), factors, missing, secondary, discipline: disc, exposure, sunOn, notes };
}

// Condiciones generales: el grip, rebajado si es probable que llueva pronto o el viento es fuerte
function kxcCondition(score, w, factors) {
  if (score === null) return null;
  let i = KXC_CONDITIONS.findIndex(c => score >= c.min);
  if (w && w.precipProb !== null && w.precipProb >= 60) i = Math.min(KXC_CONDITIONS.length - 1, i + 1);
  if (factors && factors.wind && factors.wind.value >= 40) i = Math.min(KXC_CONDITIONS.length - 1, i + 1);
  const c = KXC_CONDITIONS[i];
  return { key: c.key, label: c.label, tone: c.tone };
}

// Una escuela tiene sectores con exposiciones distintas: se estima cada una y se resume.
// exposures: lista de claves de KXC_EXPOSURE (vacía si no se conocen). Devuelve la estimación general
// (exposición desconocida si hay varias, para no fingir una sola orientación) y el rango por exposición.
function kxcEstimateSchool(w, { rockType, exposures = [] } = {}, discipline = 'sport') {
  const list = (exposures || []).filter(e => KXC_EXPOSURE[e]);
  const perExposure = list.map(e => ({ exposure: e, label: KXC_EXPOSURE[e].label, est: kxcEstimateGrip(w, { rockType, exposure: e }, discipline) }));
  const main = list.length === 1 ? perExposure[0].est : kxcEstimateGrip(w, { rockType, exposure: null, exposureKnown: list.length > 1 }, discipline);
  const scores = perExposure.map(p => p.est.score).filter(s => s !== null);
  let range = null;
  if (scores.length >= 2 && !main.limited) {
    const lo = Math.min(...scores), hi = Math.max(...scores);
    if (hi - lo >= 8) {
      const worst = perExposure.find(p => p.est.score === lo), best = perExposure.find(p => p.est.score === hi);
      range = { lo, hi, worst: worst.label, best: best.label };
    }
  }
  return { ...main, perExposure, range };
}

// Para Node (pruebas)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { kxcWeatherFromOpenMeteo, kxcEstimateGrip, kxcEstimateSchool, kxcCondition, kxcRock, kxcLocalHour, KXC_EXPOSURE };
}

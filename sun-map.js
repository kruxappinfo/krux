// ================== KRUX SOL Y SOMBRA ==================
// Capa del mapa que marca dónde da el sol: a una hora y fecha concretas (sol / sombra) o como mapa de calor
// con las horas de sol del día. Se calcula en el dispositivo a partir del relieve (teselas Terrain-RGB de
// MapTiler, ~30 m) y de la posición del sol: orientación de la ladera + sombra arrojada por el relieve.
// Es una estimación: no tiene en cuenta árboles, edificios ni nubes, y el relieve no resuelve paredes pequeñas.
// La parte de cálculo no usa DOM ni red (se prueba en Node); la interfaz y la capa van al final (KxSunMap).

// ============================================
// POSICIÓN DEL SOL
// ============================================
const KXSUN_RAD = Math.PI / 180;
const KXSUN_HORIZON = -0.833;   // altura (°) del centro del sol en el orto y el ocaso (refracción + radio solar)

// Posición del sol para un instante y un lugar: { azimuth: ° desde el norte en sentido horario, altitude: ° sobre el horizonte }
function kxSunPosition(date, lat, lng) {
  const d = date.getTime() / 86400000 - 0.5 + 2440588 - 2451545;   // días desde J2000
  const M = KXSUN_RAD * (357.5291 + 0.98560028 * d);               // anomalía media
  const C = KXSUN_RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const L = M + C + KXSUN_RAD * 102.9372 + Math.PI;                // longitud eclíptica
  const e = KXSUN_RAD * 23.4397;                                   // oblicuidad
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const ra = Math.atan2(Math.sin(L) * Math.cos(e), Math.cos(L));
  const phi = KXSUN_RAD * lat;
  const H = KXSUN_RAD * (280.16 + 360.9856235 * d) + KXSUN_RAD * lng - ra;   // ángulo horario
  const altitude = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
  const azSouth = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi));
  return { azimuth: ((azSouth / KXSUN_RAD + 180) % 360 + 360) % 360, altitude: altitude / KXSUN_RAD };
}

// Instante local de un día ('AAAA-MM-DD') a `minutes` minutos de la medianoche (hora del dispositivo)
function kxSunDateAt(dayStr, minutes) {
  const [y, m, d] = String(dayStr).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 0, minutes, 0, 0);
}

// Día local en formato 'AAAA-MM-DD'
function kxSunDayStr(date) {
  const p = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

// Orto y ocaso de un día local, en minutos desde la medianoche: { rise, set } (null si el sol no sale o no se pone)
function kxSunDayRange(dayStr, lat, lng) {
  let rise = null, set = null, prev = null;
  for (let min = 0; min <= 1440; min++) {
    const up = kxSunPosition(kxSunDateAt(dayStr, min), lat, lng).altitude > KXSUN_HORIZON;
    if (prev !== null && up !== prev) {
      if (up && rise === null) rise = min;
      if (!up) set = min;
    }
    prev = up;
  }
  return { rise, set };
}

// ============================================
// RELIEVE
// ============================================

// Píxeles RGBA de una tesela Terrain-RGB → alturas en metros
function kxSunDecodeTerrain(rgba, count) {
  const out = new Float32Array(count);
  for (let i = 0, p = 0; i < count; i++, p += 4) {
    out[i] = -10000 + (rgba[p] * 65536 + rgba[p + 1] * 256 + rgba[p + 2]) * 0.1;
  }
  return out;
}

// Altura interpolada (bilineal) en la celda (x, y) de una malla { data, w, h }
function kxSunSample(data, w, x, y) {
  const x0 = x | 0, y0 = y | 0;
  const fx = x - x0, fy = y - y0;
  const i = y0 * w + x0;
  const top = data[i] + (data[i + 1] - data[i]) * fx;
  const bot = data[i + w] + (data[i + w + 1] - data[i + w]) * fx;
  return top + (bot - top) * fy;
}

// ============================================
// SOL Y SOMBRA SOBRE LA MALLA
// ============================================
const KXSUN_BIAS = 1.5;      // margen (m) para que una ladera no se dé sombra a sí misma por el redondeo del relieve
const KXSUN_STEP_NEAR = 24;      // celdas que el rayo recorre de una en una (no se salta crestas estrechas)
const KXSUN_STEP_GROW = 0.04;    // después el paso crece con la distancia: lejos solo tapan relieves grandes

// Cuánto sol recibe cada celda con el sol en (azimuth, altitude): 0 = sombra, 1 = sol de lleno.
// dem = { data: Float32Array, w, h, cell (m por celda), max (altura máxima) }; el norte es -y.
function kxSunShade(dem, azimuth, altitude, out) {
  const { data, w, h, cell, max } = dem;
  out = out || new Float32Array(w * h);
  if (altitude <= 0) { out.fill(0); return out; }
  const az = azimuth * KXSUN_RAD, alt = altitude * KXSUN_RAD;
  const ux = Math.sin(az), uy = -Math.cos(az);   // dirección horizontal hacia el sol, en celdas
  const cosAlt = Math.cos(alt), sinAlt = Math.sin(alt);
  const rise = cell * Math.tan(alt);             // metros que sube el rayo por celda recorrida
  const maxX = w - 1.001, maxY = h - 1.001;

  for (let y = 0; y < h; y++) {
    const yu = y > 0 ? y - 1 : y, yd = y < h - 1 ? y + 1 : y;
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const xl = x > 0 ? x - 1 : x, xr = x < w - 1 ? x + 1 : x;
      // Orientación de la ladera: si mira en contra del sol, sombra propia
      const dzdx = (data[y * w + xr] - data[y * w + xl]) / ((xr - xl) * cell);
      const dzdy = (data[yd * w + x] - data[yu * w + x]) / ((yd - yu) * cell);
      const cosInc = (sinAlt - (dzdx * ux + dzdy * uy) * cosAlt) / Math.sqrt(dzdx * dzdx + dzdy * dzdy + 1);
      if (cosInc <= 0) { out[i] = 0; continue; }
      // Sombra arrojada: rayo hacia el sol hasta superar el punto más alto o salir de la malla
      const h0 = data[i] + KXSUN_BIAS;
      let lit = 1;
      for (let t = 1; ; t += t < KXSUN_STEP_NEAR ? 1 : 1 + (t - KXSUN_STEP_NEAR) * KXSUN_STEP_GROW) {
        const rayH = h0 + t * rise;
        if (rayH > max) break;
        const px = x + ux * t, py = y + uy * t;
        if (px < 0 || py < 0 || px > maxX || py > maxY) break;
        if (kxSunSample(data, w, px, py) > rayH) { lit = 0; break; }
      }
      out[i] = lit ? Math.min(1, cosInc / 0.2) : 0;   // el borde sol/sombra de la ladera se suaviza
    }
  }
  return out;
}

// Instantes (minutos desde la medianoche) en los que se muestrea el día para las horas de sol
function kxSunHourSamples(range, stepMin = 20) {
  if (!range || range.rise === null || range.set === null || range.set <= range.rise) return [];
  const out = [];
  for (let m = range.rise + stepMin / 2; m < range.set; m += stepMin) out.push(m);
  return out;
}

// Suaviza una malla con una media 3×3 (borde sol/sombra menos dentado)
function kxSunBlur(src, w, h, out) {
  out = out || new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = y > 0 ? y - 1 : y, y1 = y < h - 1 ? y + 1 : y;
    for (let x = 0; x < w; x++) {
      const x0 = x > 0 ? x - 1 : x, x1 = x < w - 1 ? x + 1 : x;
      out[y * w + x] = (
        src[y0 * w + x0] + src[y0 * w + x] + src[y0 * w + x1] +
        src[y * w + x0] + src[y * w + x] + src[y * w + x1] +
        src[y1 * w + x0] + src[y1 * w + x] + src[y1 * w + x1]
      ) / 9;
    }
  }
  return out;
}

// ============================================
// COLOR
// ============================================
// A una hora: sombra en azul noche, sol en ámbar (RGBA 0–255)
const KXSUN_SHADE_RGBA = [16, 22, 58, 150];
const KXSUN_LIGHT_RGBA = [255, 196, 61, 78];
const KXSUN_HEAT_ALPHA = 165;
// Horas de sol: de azul noche (sin sol) a amarillo (sol todo el día); luminosidad siempre creciente
const KXSUN_HEAT_STOPS = [
  [0, 22, 24, 84],
  [0.25, 98, 38, 140],
  [0.5, 196, 62, 96],
  [0.75, 244, 136, 46],
  [1, 255, 232, 128]
];

// Color [r, g, b] de la rampa de horas de sol para t entre 0 y 1
function kxSunHeatColor(t) {
  const v = t <= 0 ? 0 : t >= 1 ? 1 : t;
  for (let i = 1; i < KXSUN_HEAT_STOPS.length; i++) {
    const a = KXSUN_HEAT_STOPS[i - 1], b = KXSUN_HEAT_STOPS[i];
    if (v <= b[0]) {
      const f = (v - a[0]) / (b[0] - a[0]);
      return [a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f, a[3] + (b[3] - a[3]) * f];
    }
  }
  const last = KXSUN_HEAT_STOPS[KXSUN_HEAT_STOPS.length - 1];
  return [last[1], last[2], last[3]];
}

// Para Node (pruebas)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { kxSunPosition, kxSunDateAt, kxSunDayStr, kxSunDayRange, kxSunDecodeTerrain, kxSunShade, kxSunHourSamples, kxSunBlur, kxSunHeatColor };
}

// ============================================
// CAPA DEL MAPA E INTERFAZ
// ============================================
const KXSUN_MIN_ZOOM = 9.5;      // más lejos el relieve no dice nada útil y el sol cambia dentro de la vista
const KXSUN_DEM_MAXZOOM = 14;    // zoom máximo de Terrain-RGB v2
const KXSUN_TILE = 512;          // píxeles por tesela de relieve
const KXSUN_GRID = 288;          // celdas del lado largo de la malla de cálculo
const KXSUN_MARGIN_M = 800;      // relieve extra alrededor de la vista: da sombra desde fuera de la pantalla
const KXSUN_MAX_TILES = 12;
const KXSUN_CACHE = 18;          // teselas de relieve en memoria

const KxSunMap = {
  map: null,
  active: false,
  mode: 'time',          // 'time' (a una hora) | 'hours' (horas de sol del día)
  day: null,             // 'AAAA-MM-DD'
  minutes: 720,
  range: { rise: null, set: null },
  dem: null,
  _tiles: new Map(),     // 'z/x/y' → Promise<Float32Array>
  _job: 0,
  _raf: 0,
  _moveTimer: 0,
  _canvas: null,
  _lit: null,
  _tmp: null,

  // ---------- Arranque ----------
  init(map) {
    if (!map || this.map) return;
    this.map = map;
    const container = map.getContainer();

    const btn = document.createElement('button');
    btn.id = 'btn-sun-map';
    btn.type = 'button';
    btn.className = 'map-control-btn maplibregl-ctrl kx-ctrl-sun';
    btn.title = 'Sol y sombra';
    btn.setAttribute('aria-label', 'Sol y sombra');
    btn.setAttribute('aria-pressed', 'false');
    btn.innerHTML = kxIcon('sun', { size: 20 });
    btn.addEventListener('click', e => { e.stopPropagation(); this.toggle(); });
    const stack = container.querySelector('.maplibregl-ctrl-bottom-right');
    if (stack) stack.insertBefore(btn, stack.firstChild);
    else container.appendChild(btn);
    this._btn = btn;

    const panel = document.createElement('div');
    panel.id = 'sun-map-panel';
    panel.className = 'kx-sun-panel';
    panel.setAttribute('role', 'region');
    panel.setAttribute('aria-label', 'Sol y sombra');
    panel.innerHTML = this._panelHTML();
    container.appendChild(panel);
    this._panel = panel;
    this._bindPanel();

    map.on('moveend', () => {
      if (!this.active) return;
      clearTimeout(this._moveTimer);
      this._moveTimer = setTimeout(() => this.refresh(), 180);
    });
  },

  _panelHTML() {
    return `
      <div class="kx-sun-head">
        <span class="kx-sun-title">${kxIcon('sun', { size: 18 })}Sol y sombra</span>
        <button type="button" class="kx-sun-close" data-sun="close" aria-label="Cerrar sol y sombra">${kxIcon('x', { size: 18 })}</button>
      </div>
      ${kxSegmentedHTML({
        items: [{ value: 'time', label: 'A una hora' }, { value: 'hours', label: 'Horas de sol' }],
        value: this.mode, label: 'Qué mostrar', attrs: { 'data-sun': 'mode' }
      })}
      <div class="kx-sun-row">
        <input type="date" class="kx-sun-date" data-sun="date" aria-label="Fecha">
        <button type="button" class="kx-sun-today" data-sun="today">Hoy</button>
      </div>
      <div class="kx-sun-time" data-sun="time-block">
        <div class="kx-sun-time-head">
          <span class="kx-sun-label">Hora</span>
          <output class="kx-sun-clock" data-sun="clock" for="sun-map-slider">--:--</output>
        </div>
        <input type="range" id="sun-map-slider" class="kx-sun-slider" data-sun="slider" min="0" max="1440" step="5" value="720" aria-label="Hora del día">
        <div class="kx-sun-ends">
          <span>${kxIcon('sunrise', { size: 14 })}<span data-sun="rise">--:--</span></span>
          <span><span data-sun="set">--:--</span>${kxIcon('sunset', { size: 14 })}</span>
        </div>
      </div>
      <div class="kx-sun-legend" data-sun="legend"></div>
      <p class="kx-sun-status" data-sun="status" role="status" aria-live="polite"></p>
      <p class="kx-sun-note">Estimación según el relieve. No cuenta árboles, edificios ni nubes.</p>`;
  },

  _el(name) { return this._panel.querySelector(`[data-sun="${name}"]`); },

  _bindPanel() {
    const stop = e => e.stopPropagation();
    ['click', 'dblclick', 'mousedown', 'touchstart', 'wheel', 'pointerdown'].forEach(ev =>
      this._panel.addEventListener(ev, stop, { passive: true }));

    this._el('close').addEventListener('click', () => this.toggle(false));
    this._el('mode').addEventListener('click', e => {
      const b = e.target.closest('.kx-seg-btn');
      if (b && b.dataset.value !== this.mode) this.setMode(b.dataset.value);
    });
    this._el('date').addEventListener('change', e => { if (e.target.value) this.setDay(e.target.value); });
    this._el('today').addEventListener('click', () => this.setNow());
    this._el('slider').addEventListener('input', e => {
      this.minutes = Number(e.target.value);
      this._syncClock();
      this._scheduleDraw();
    });
  },

  // ---------- Estado ----------
  toggle(force) {
    const on = typeof force === 'boolean' ? force : !this.active;
    if (on === this.active) return;
    this.active = on;
    this._btn.classList.toggle('is-active', on);
    this._btn.setAttribute('aria-pressed', String(on));
    this._panel.classList.toggle('open', on);
    if (on) {
      if (typeof closeGradeFilterPanel === 'function') closeGradeFilterPanel();
      if (!this.day) this.setNow(true);
      this.refresh();
    } else {
      this._job++;
      this._setLayerVisible(false);
    }
  },

  setNow(silent) {
    const now = new Date();
    this.day = kxSunDayStr(now);
    this.minutes = Math.round((now.getHours() * 60 + now.getMinutes()) / 5) * 5;
    this._el('date').value = this.day;
    this._updateRange();
    if (!silent) this._drawForMode();
  },

  setDay(dayStr) {
    this.day = dayStr;
    this._updateRange();
    this._drawForMode();
  },

  setMode(mode) {
    this.mode = mode === 'hours' ? 'hours' : 'time';
    this._el('mode').querySelectorAll('.kx-seg-btn').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.value === this.mode)));
    this._el('time-block').hidden = this.mode !== 'time';
    this._renderLegend();
    this._drawForMode();
  },

  // Orto y ocaso del día elegido en el centro del mapa; la hora queda siempre dentro del día
  _updateRange() {
    const c = this.map.getCenter();
    this.range = kxSunDayRange(this.day, c.lat, c.lng);
    const { rise, set } = this.range;
    const slider = this._el('slider');
    // 10 min de margen: en el minuto exacto del orto y del ocaso el sol aún no alumbra el relieve
    const lo = rise === null ? 0 : Math.ceil((rise + 10) / 5) * 5;
    const hi = set === null ? 1440 : Math.floor((set - 10) / 5) * 5;
    slider.min = lo;
    slider.max = Math.max(lo, hi);
    this.minutes = Math.min(Math.max(this.minutes, lo), Math.max(lo, hi));
    slider.value = this.minutes;
    this._el('rise').textContent = rise === null ? '--:--' : this._hhmm(rise);
    this._el('set').textContent = set === null ? '--:--' : this._hhmm(set);
    this._syncClock();
    this._renderLegend();
  },

  _hhmm(min) {
    const m = Math.round(min) % 1440;
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  },

  _syncClock() {
    this._el('clock').textContent = this._hhmm(this.minutes);
    this._el('slider').setAttribute('aria-valuetext', this._hhmm(this.minutes));
  },

  _dayHours() {
    const { rise, set } = this.range;
    return rise === null || set === null ? 0 : Math.max(0, (set - rise) / 60);
  },

  _renderLegend() {
    const el = this._el('legend');
    if (this.mode === 'hours') {
      const max = this._dayHours();
      const grad = KXSUN_HEAT_STOPS.map(s => `rgb(${s[1]},${s[2]},${s[3]}) ${s[0] * 100}%`).join(', ');
      el.innerHTML = `
        <span class="kx-sun-ramp" style="background:linear-gradient(90deg, ${grad})"></span>
        <span class="kx-sun-ramp-ends"><span>0 h</span><span>${max ? `${Math.round(max)} h de sol` : 'Sin sol'}</span></span>`;
    } else {
      el.innerHTML = `
        <span class="kx-sun-key"><i class="is-sun"></i>Sol</span>
        <span class="kx-sun-key"><i class="is-shade"></i>Sombra</span>`;
    }
  },

  _status(text) { this._el('status').textContent = text || ''; },

  // ---------- Relieve ----------
  _loadTile(z, x, y) {
    const key = `${z}/${x}/${y}`;
    const hit = this._tiles.get(key);
    if (hit) { this._tiles.delete(key); this._tiles.set(key, hit); return hit; }   // el más reciente, al final
    const url = `https://api.maptiler.com/tiles/terrain-rgb-v2/${z}/${x}/${y}.webp?key=${MAPLIBRE_CONFIG.MAPTILER_KEY}`;
    const p = fetch(url)
      .then(r => { if (!r.ok) throw new Error(`relieve ${r.status}`); return r.blob(); })
      .then(blob => createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' })
        .catch(() => createImageBitmap(blob)))
      .then(bmp => {
        const cv = document.createElement('canvas');
        cv.width = cv.height = KXSUN_TILE;
        const ctx = cv.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(bmp, 0, 0, KXSUN_TILE, KXSUN_TILE);
        if (bmp.close) bmp.close();
        return kxSunDecodeTerrain(ctx.getImageData(0, 0, KXSUN_TILE, KXSUN_TILE).data, KXSUN_TILE * KXSUN_TILE);
      });
    p.catch(() => this._tiles.delete(key));
    this._tiles.set(key, p);
    while (this._tiles.size > KXSUN_CACHE) this._tiles.delete(this._tiles.keys().next().value);
    return p;
  },

  // Malla de alturas de la vista actual (más un margen) y las esquinas geográficas que ocupa
  async _buildDem() {
    const map = this.map;
    const b = map.getBounds();
    const latC = map.getCenter().lat;
    const T = KXSUN_TILE;
    const mercY = lat => (1 - Math.log(Math.tan(lat * KXSUN_RAD) + 1 / Math.cos(lat * KXSUN_RAD)) / Math.PI) / 2;

    let z = Math.min(KXSUN_DEM_MAXZOOM, Math.max(0, Math.floor(map.getZoom()) - 1));
    let world, x0, x1, y0, y1, tx0, tx1, ty0, ty1;
    for (; ; z--) {
      world = T * Math.pow(2, z);
      const vx0 = (b.getWest() + 180) / 360 * world, vx1 = (b.getEast() + 180) / 360 * world;
      const vy0 = mercY(b.getNorth()) * world, vy1 = mercY(b.getSouth()) * world;
      const mPerPx = 40075016.686 * Math.cos(latC * KXSUN_RAD) / world;
      const margin = Math.max(0.3 * Math.max(vx1 - vx0, vy1 - vy0), KXSUN_MARGIN_M / mPerPx);
      x0 = Math.max(0, vx0 - margin); x1 = Math.min(world - 1, vx1 + margin);
      y0 = Math.max(0, vy0 - margin); y1 = Math.min(world - 1, vy1 + margin);
      tx0 = Math.floor(x0 / T); tx1 = Math.floor(x1 / T);
      ty0 = Math.floor(y0 / T); ty1 = Math.floor(y1 / T);
      if ((tx1 - tx0 + 1) * (ty1 - ty0 + 1) <= KXSUN_MAX_TILES || z === 0) break;
    }

    const jobs = [];
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) jobs.push(this._loadTile(z, tx, ty));
    const tiles = await Promise.all(jobs);
    const cols = tx1 - tx0 + 1;

    // Altura en un píxel del mundo (entero), dentro del mosaico de teselas
    const mx1 = (tx1 + 1) * T - 1, my1 = (ty1 + 1) * T - 1;
    const at = (px, py) => {
      const cx = px > mx1 ? mx1 : px, cy = py > my1 ? my1 : py;
      const tx = Math.floor(cx / T), ty = Math.floor(cy / T);
      return tiles[(ty - ty0) * cols + (tx - tx0)][(cy - ty * T) * T + (cx - tx * T)];
    };

    const rw = x1 - x0, rh = y1 - y0;
    const scale = KXSUN_GRID / Math.max(rw, rh);
    const w = Math.max(32, Math.round(rw * scale)), h = Math.max(32, Math.round(rh * scale));
    const data = new Float32Array(w * h);
    let max = -Infinity;
    for (let gy = 0; gy < h; gy++) {
      const wy = Math.max(ty0 * T, y0 + (gy + 0.5) / h * rh - 0.5);
      const iy = Math.floor(wy), fy = wy - iy;
      for (let gx = 0; gx < w; gx++) {
        const wx = Math.max(tx0 * T, x0 + (gx + 0.5) / w * rw - 0.5);
        const ix = Math.floor(wx), fx = wx - ix;
        const top = at(ix, iy) * (1 - fx) + at(ix + 1, iy) * fx;
        const bot = at(ix, iy + 1) * (1 - fx) + at(ix + 1, iy + 1) * fx;
        const v = top * (1 - fy) + bot * fy;
        data[gy * w + gx] = v;
        if (v > max) max = v;
      }
    }

    const lng = x => x / world * 360 - 180;
    const lat = y => Math.atan(Math.sinh(Math.PI * (1 - 2 * y / world))) / KXSUN_RAD;
    const cell = 40075016.686 * Math.cos(latC * KXSUN_RAD) / world * rw / w;
    return {
      data, w, h, cell, max,
      coords: [[lng(x0), lat(y0)], [lng(x1), lat(y0)], [lng(x1), lat(y1)], [lng(x0), lat(y1)]]
    };
  },

  // ---------- Cálculo y pintado ----------
  // Vuelve a cargar el relieve de la vista y recalcula (al activar y al mover el mapa)
  async refresh() {
    if (!this.active) return;
    const job = ++this._job;
    if (this.map.getZoom() < KXSUN_MIN_ZOOM) {
      this._setLayerVisible(false);
      this._status('Acerca el mapa para ver dónde da el sol.');
      return;
    }
    this._status('Cargando el relieve…');
    let dem;
    try {
      dem = await this._buildDem();
    } catch (e) {
      console.error('[Sol] Error cargando el relieve:', e);
      if (job === this._job) {
        this._setLayerVisible(false);
        this._status('No se ha podido cargar el relieve. Revisa la conexión.');
      }
      return;
    }
    if (job !== this._job || !this.active) return;
    this.dem = dem;
    this._lit = new Float32Array(dem.w * dem.h);
    this._tmp = new Float32Array(dem.w * dem.h);
    this._updateRange();
    this._drawForMode();
  },

  _drawForMode() {
    if (!this.active || !this.dem) return;
    if (this.mode === 'hours') this._drawHours();
    else this._drawTime();
  },

  _scheduleDraw() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => { this._raf = 0; this._drawForMode(); });
  },

  _sunAt(minutes) {
    const c = this.map.getCenter();
    return kxSunPosition(kxSunDateAt(this.day, minutes), c.lat, c.lng);
  },

  // Sol / sombra a la hora elegida
  _drawTime() {
    const job = ++this._job;
    const dem = this.dem;
    const sun = this._sunAt(this.minutes);
    kxSunShade(dem, sun.azimuth, sun.altitude, this._tmp);
    kxSunBlur(this._tmp, dem.w, dem.h, this._lit);
    if (job !== this._job) return;
    const S = KXSUN_SHADE_RGBA, L = KXSUN_LIGHT_RGBA;
    this._paint(v => [S[0] + (L[0] - S[0]) * v, S[1] + (L[1] - S[1]) * v, S[2] + (L[2] - S[2]) * v, S[3] + (L[3] - S[3]) * v]);
    this._status(sun.altitude <= 0 ? 'A esta hora el sol está bajo el horizonte.' : '');
  },

  // Mapa de calor: horas de sol de cada punto a lo largo del día (se calcula por tandas para no bloquear)
  async _drawHours() {
    const job = ++this._job;
    const dem = this.dem;
    const samples = kxSunHourSamples(this.range);
    const acc = this._lit;
    acc.fill(0);
    if (!samples.length) {
      this._paint(() => [...kxSunHeatColor(0), KXSUN_HEAT_ALPHA]);
      this._status('Este día no sale el sol aquí.');
      return;
    }
    this._status('Calculando las horas de sol…');
    for (let s = 0; s < samples.length; s++) {
      const sun = this._sunAt(samples[s]);
      kxSunShade(dem, sun.azimuth, sun.altitude, this._tmp);
      for (let i = 0; i < acc.length; i++) if (this._tmp[i] > 0) acc[i]++;
      if (s % 4 === 3) {
        await new Promise(r => setTimeout(r, 0));
        if (job !== this._job || !this.active) return;
      }
    }
    kxSunBlur(acc, dem.w, dem.h, this._tmp);
    acc.set(this._tmp);
    const n = samples.length;
    this._paint(v => { const c = kxSunHeatColor(v / n); return [c[0], c[1], c[2], KXSUN_HEAT_ALPHA]; });
    this._status('');
  },

  // Pinta la malla (this._lit) en el lienzo con la función de color y la manda a la capa del mapa
  _paint(colorOf) {
    const { w, h, coords } = this.dem;
    if (!this._canvas) this._canvas = document.createElement('canvas');
    const cv = this._canvas;
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    const ctx = cv.getContext('2d');
    const img = ctx.createImageData(w, h);
    const px = img.data, src = this._lit;
    for (let i = 0, p = 0; i < src.length; i++, p += 4) {
      const c = colorOf(src[i]);
      px[p] = c[0]; px[p + 1] = c[1]; px[p + 2] = c[2]; px[p + 3] = c[3];
    }
    ctx.putImageData(img, 0, 0);
    this._pushToMap(coords);
  },

  _pushToMap(coords) {
    const map = this.map;
    try {
      let src = map.getSource('kx-sun');
      if (!src) {
        map.addSource('kx-sun', { type: 'canvas', canvas: this._canvas, coordinates: coords, animate: false });
        // Encima de la ortofoto y el sombreado, debajo de etiquetas, sectores y vías
        const first = map.getStyle().layers.find(l => !['raster', 'hillshade', 'background'].includes(l.type));
        map.addLayer({
          id: 'kx-sun-layer', type: 'raster', source: 'kx-sun',
          paint: { 'raster-opacity': 1, 'raster-fade-duration': 0, 'raster-resampling': 'linear' }
        }, first ? first.id : undefined);
        src = map.getSource('kx-sun');
      } else {
        src.setCoordinates(coords);
      }
      this._setLayerVisible(true);
      // Fuente de lienzo sin animación: una reproducción puntual sube el lienzo nuevo a la GPU
      if (src.play && src.pause) { src.play(); src.pause(); }
      map.triggerRepaint();
    } catch (e) {
      console.error('[Sol] Error pintando la capa:', e);
    }
  },

  _setLayerVisible(on) {
    if (this.map.getLayer('kx-sun-layer')) this.map.setLayoutProperty('kx-sun-layer', 'visibility', on ? 'visible' : 'none');
  }
};

if (typeof window !== 'undefined') window.KxSunMap = KxSunMap;

// ================== VARIABLES GLOBALES ==================

// Modo desarrollo - cambiar a false en producción para desactivar logs
const DEBUG_MODE = false;
const log = DEBUG_MODE ? console.log.bind(console) : () => { };

let map;
let marker;
let geocoder;

let userMarker = null;
let userWatchId = null;
let isTrackingUser = false;
let userPulseInterval = null;

let currentSchoolId = "valeria";
let currentSchoolName = ""; // Will be set when school loads
const schoolState = {};

let parkingInfoWindow = null;
let routeInfoWindow = null;
let schoolInfoWindow = null;
let sectorHoverInfoWindow = null;

// Flag para evitar duplicar event listeners globales
let feedDropdownListenerAdded = false;

// ================== DONUT CHART INTERACTION ==================
// Delegated event handler for donut chart segments
document.addEventListener('click', function (e) {
  const path = e.target.closest('path[data-grade]');
  if (path) {
    e.preventDefault();
    e.stopPropagation();

    const svg = path.closest('svg');
    const chartContainer = path.closest('[data-chart-id]');
    if (!svg || !chartContainer) return;

    const chartId = chartContainer.getAttribute('data-chart-id');
    const grade = path.getAttribute('data-grade');
    const count = path.getAttribute('data-count');
    const color = path.getAttribute('data-color');
    const tx = parseFloat(path.getAttribute('data-tx')) || 0;
    const ty = parseFloat(path.getAttribute('data-ty')) || 0;

    // Reset all segments in this chart
    svg.querySelectorAll('path[data-grade]').forEach(function (p) {
      p.style.transform = '';
      p.setAttribute('data-selected', 'false');
    });

    // Highlight selected segment with pop-out effect
    path.style.transform = 'translate(' + tx + 'px, ' + ty + 'px) scale(1.1)';
    path.setAttribute('data-selected', 'true');

    // Update center label
    const valueEl = document.getElementById(chartId + '-value');
    const labelEl = document.getElementById(chartId + '-label');
    if (valueEl) {
      valueEl.textContent = grade;
      valueEl.style.color = color;
    }
    if (labelEl) {
      labelEl.textContent = count + ' Vías';
    }
    return;
  }

  // Click on chart container (not on segment) - reset
  const chartContainer = e.target.closest('[data-chart-id]');
  if (chartContainer && e.target.tagName !== 'path') {
    const chartId = chartContainer.getAttribute('data-chart-id');
    const total = chartContainer.getAttribute('data-total');
    const svg = chartContainer.querySelector('svg');

    if (svg) {
      svg.querySelectorAll('path[data-grade]').forEach(function (p) {
        p.style.transform = '';
        p.setAttribute('data-selected', 'false');
      });
    }

    const valueEl = document.getElementById(chartId + '-value');
    const labelEl = document.getElementById(chartId + '-label');
    if (valueEl) {
      valueEl.textContent = total;
      valueEl.style.color = '#C41E3A';
    }
    if (labelEl) {
      labelEl.textContent = 'Vías';
    }
  }
}, true);




const GRADE_COLORS = {
  // Beginner grades (3a-4c) - Blues
  "3a": "#0fcee8ff",
  "3b": "#08cae4ff",
  "3c": "#048b9dff",
  "4a": "#26aff4ff",
  "4b": "#0878b1ff",
  "4c": "#045781ff",
  // Easy grades (5a-5c) - Greens
  "5a": "#72d310ff",
  "5b": "#9fde61ff",
  "5c": "#46923aff",
  "5c+": "#46923aff",
  // Medium grades (6a-6c) - Yellows/Oranges
  "6a": "#d0c415ff",
  "6a+": "#eed809ff",
  "6b": "#f2d74fff",
  "6b+": "#f6d21dff",
  "6c": "#fda750ff",
  "6c+": "#fda750ff",
  // Hard grades (7a-7c) - Reds
  "7a": "#ff6161ff",
  "7a+": "#ff6161ff",
  "7b": "#e04545ff",
  "7b+": "#e04545ff",
  "7c": "#ce1616ff",
  "7c+": "#9a0808ff",
  // Elite grades (8a+) - Pinks/Magentas
  "8a": "#f463efff",
  "8a+": "#e936e3ff",
  "8b": "#e43dc0ff",
  "8b+": "#c80fa0ff",
  "8c": "#a200ff",
  "8c+": "#8b00d9",
  // World class grades (9a+) - Purples/Black
  "9a": "#7b00b3",
  "9a+": "#5c008c",
  "9b": "#400066",
  "9b+": "#2d004d",
  "9c": "#1a0033",
  "9c+": "#0d001a",
};

// SVGs for icons (Instagram style) - Global definition
const ICONS = {
  check: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`,
  heart: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>`,
  heartFilled: `<svg width="24" height="24" viewBox="0 0 24 24" fill="#ed4956" stroke="#ed4956" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>`,
  bookmark: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path></svg>`,
  bookmarkFilled: `<svg width="24" height="24" viewBox="0 0 24 24" fill="#FFC107" stroke="#FFC107" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path></svg>`,
  comment: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>`,
  share: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>`
};

// Config de zoom por escuela
const SCHOOL_CONFIGS = {
  valeria: {
    zoomLines: 14,       // líneas de sector
    zoomSectorNames: 16, // nombres de sector
    zoomGrades: 18,      // puntos + texto de vía (KML legacy)
    zoomGeoJSON: 20,     // puntos de vía (GeoJSON) - desaparecen antes
    zoomParking: 14,     // parking (visible desde zoom 14)
    center: { lat: 39.785, lng: -2.150 }
  },
  sanmartin: {
    zoomLines: 14,
    zoomSectorNames: 16,
    zoomGrades: 18,
    zoomGeoJSON: 20,
    zoomParking: 16,
    center: { lat: 40.4014, lng: -4.3824 }
  }
};

// GeoJSON paths per school
const SCHOOL_PATHS = {
  valeria: {
    folder: 'Cartografia/Valeria',
    vias: 'Valeria_Vias.geojson',
    sectores: 'Valeria_Sectores.geojson',
    parkings: 'Valeria_Parkings.geojson',
    puntosInteres: 'Valeria_Puntos_interes.geojson',
    rutasAcceso: 'Valeria_Rutas_acceso.geojson'
  },
  sanmartin: {
    folder: 'Cartografia/San Martin de ValdeIglesias',
    vias: 'SM_Vias.geojson',
    sectores: 'SM_Sectores.geojson',
    parkings: 'SM_Parkings.geojson',
    puntosInteres: null, // No disponible aún
    rutasAcceso: null    // No disponible aún
  }
};

// Expose for other modules
window.SCHOOL_PATHS = SCHOOL_PATHS;

// Datos de la escuela (usa tus KML ya cargados desde kmlData.js)
const KML_SECTORS = {};
const KML_GRADES = {};

const SCHOOL_DATA = {
  valeria: {
    sectors: KML_SECTORS,
    grades: KML_GRADES
  },
  sanmartin: {
    sectors: {},
    grades: {}
  }
};

// Orden "lógico" de grados
const GRADE_ORDER = [
  "3a", "3a+", "3b", "3b+", "3c", "3c+",
  "4a", "4a+", "4b", "4b+", "4c", "4c+",
  "5a", "5a+", "5b", "5b+", "5c", "5c+",
  "6a", "6a+", "6b", "6b+", "6c", "6c+",
  "7a", "7a+", "7b", "7b+", "7c", "7c+",
  "8a", "8a+", "8b", "8b+", "8c", "8c+",
  "9a", "9a+", "9b", "9b+", "9c", "9c+"
];

// Helper to fetch and count grades from GeoJSON
async function fetchSchoolStats(schoolId) {
  try {
    const paths = SCHOOL_PATHS[schoolId];
    if (!paths) {
      console.error(`No paths configured for school: ${schoolId}`);
      return null;
    }
    const url = `./${paths.folder}/${paths.vias}?v=${new Date().getTime()}`;

    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

    const data = await response.json();
    const counts = {};

    if (data.features) {
      data.features.forEach(feature => {
        const props = feature.properties || {};
        const grade = props.grado1 || props.Grado || props.grade;
        if (grade && GRADE_COLORS[grade]) {
          counts[grade] = (counts[grade] || 0) + 1;
        }
      });
    }

    return counts;
  } catch (error) {
    console.error('Error fetching school stats:', error);
    return null;
  }
}

function getGradeStatsHTML(schoolId, externalCounts = null) {
  let counts = externalCounts;

  // Fallback to static data if no external counts provided
  if (!counts) {
    const data = SCHOOL_DATA[schoolId];
    if (!data || !data.grades) return "";

    // Contar vías por grado (solo grados con color y al menos 1 vía)
    counts = {};
    Object.entries(data.grades).forEach(([grade, vias]) => {
      if (!GRADE_COLORS[grade]) return; // ignora grados raros sin color
      const n = (vias && vias.length) || 0;
      if (n > 0) {
        counts[grade] = n;
      }
    });
  }

  const entries = Object.entries(counts);
  if (!entries.length) return "";

  // Ordenar por GRADE_ORDER
  entries.sort(([gA], [gB]) => {
    const iA = GRADE_ORDER.indexOf(gA);
    const iB = GRADE_ORDER.indexOf(gB);
    if (iA === -1 && iB === -1) return gA.localeCompare(gB);
    if (iA === -1) return 1;
    if (iB === -1) return -1;
    return iA - iB;
  });

  // Generate pie chart
  const pieChartHtml = generatePieChartForSchool(counts);

  return `
    <div class="school-grade-chart">
      ${pieChartHtml}
    </div>
  `;
}

// Helper to generate Pie Chart for School (similar to sector chart but for full school)
function generatePieChartForSchool(counts) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (total === 0) return '';

  // Sort grades
  const sortedGrades = Object.keys(counts).sort((a, b) => {
    const iA = GRADE_ORDER.indexOf(a);
    const iB = GRADE_ORDER.indexOf(b);
    if (iA === -1 && iB === -1) return a.localeCompare(b);
    if (iA === -1) return 1;
    if (iB === -1) return -1;
    return iA - iB;
  });

  let slices = [];
  let cumulativePercent = 0;
  const uniqueId = 'donut-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5);

  sortedGrades.forEach((grade, index) => {
    const count = counts[grade];
    const percent = count / total;

    const startAngle = 2 * Math.PI * cumulativePercent - Math.PI / 2;
    const endAngle = 2 * Math.PI * (cumulativePercent + percent) - Math.PI / 2;
    const midAngle = (startAngle + endAngle) / 2;

    const x1 = Math.cos(startAngle);
    const y1 = Math.sin(startAngle);
    const x2 = Math.cos(endAngle);
    const y2 = Math.sin(endAngle);

    const largeArc = percent > 0.5 ? 1 : 0;
    const pathData = `M 0 0 L ${x1} ${y1} A 1 1 0 ${largeArc} 1 ${x2} ${y2} Z`;

    const color = GRADE_COLORS[grade] || '#ccc';

    // Calculate translation for "pop out" effect (in pixels)
    const popDistance = 5;
    const tx = (Math.cos(midAngle) * popDistance).toFixed(2);
    const ty = (Math.sin(midAngle) * popDistance).toFixed(2);

    slices.push(`
      <path d="${pathData}" fill="${color}" stroke="white" stroke-width="0.02"
            data-selected="false"
            data-grade="${grade}"
            data-count="${count}"
            data-color="${color}"
            data-tx="${tx}"
            data-ty="${ty}"
            style="cursor: pointer; transform-origin: center; transition: transform 0.2s ease;">
      </path>
    `);

    cumulativePercent += percent;
  });

  return `
    <div style="text-align: center;">
      <h4 style="margin: 0 0 10px 0; font-size: 13px; color: #555;">Vías por Grado</h4>

      <div data-chart-id="${uniqueId}" data-total="${total}" style="position: relative; width: 100px; height: 100px; margin: 0 auto;">
        <svg viewBox="-1.3 -1.3 2.6 2.6" style="width: 100%; height: 100%; overflow: visible;">
          ${slices.join('')}
        </svg>
        <div style="width: 60px; height: 60px; background: white; border-radius: 50%; position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); display: flex; flex-direction: column; align-items: center; justify-content: center; pointer-events: none; box-shadow: inset 0 0 10px rgba(0,0,0,0.05);">
          <span id="${uniqueId}-value" style="font-size: 18px; font-weight: bold; color: #C41E3A; transition: color 0.2s;">${total}</span>
          <span id="${uniqueId}-label" style="font-size: 9px; color: #666;">Vías</span>
        </div>
      </div>
    </div>
  `;
}



const kmlLayers = {};

function nudgeInfoWindowIfOverlapTopBar(attempt = 0) {
  if (!map || attempt > 8) return;

  const topBar = document.querySelector(".top-bar-wrapper");
  // Buscamos el InfoWindow VISIBLE (el que tiene dimensiones)
  const iws = document.querySelectorAll(".gm-style-iw-c");
  let iw = null;
  for (const el of iws) {
    if (el.offsetWidth > 0 && el.offsetHeight > 0) {
      iw = el;
      break;
    }
  }

  if (!topBar || !iw) {
    // Si no encontramos el IW visible, reintentamos un poco (puede estar renderizÃ¡ndose)
    if (attempt < 8) {
      setTimeout(() => nudgeInfoWindowIfOverlapTopBar(attempt + 1), 200);
    }
    return;
  }

  const barRect = topBar.getBoundingClientRect();
  const iwRect = iw.getBoundingClientRect();

  const margin = 10; // margen de seguridad reducido
  const overlap = (barRect.bottom + margin) - iwRect.top;

  if (overlap > 0) {
    // Mueve TODO el solape de golpe para que se lea bien
    map.panBy(0, -overlap);
  } else if (attempt < 8) {
    // Si no choca aún, reintentamos un poco despuÃ©s por si la imagen carga y crece
    setTimeout(() => nudgeInfoWindowIfOverlapTopBar(attempt + 1), 200);
  }
}

// ================== METEO (Open-Meteo) ==================

// FunciÃ³n helper para obtener la ruta de imagen del tiempo segÃºn el código WMO
function getWeatherIconPath(code) {
  if (code === 0) return 'icons/weather/sunny.png';
  if ([1, 2].includes(code)) return 'icons/weather/partly-cloudy.png';
  if (code === 3) return 'icons/weather/cloudy.png';
  if ([45, 48].includes(code)) return 'icons/weather/fog.png';
  if ([51, 53, 55].includes(code)) return 'icons/weather/light-rain.png';
  if ([61, 63, 65].includes(code)) return 'icons/weather/rain.png';
  if ([71, 73, 75].includes(code)) return 'icons/weather/snow.png';
  if ([95, 96, 99].includes(code)) return 'icons/weather/storm.png';
  return 'icons/weather/partly-cloudy.png';
}

async function fetchWeatherSummary(lat, lng) {
  try {
    // Pedimos variables actuales + probabilidad de lluvia horaria
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m&hourly=precipitation_probability&timezone=auto`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("Error HTTP");

    const data = await res.json();
    const current = data.current;

    if (!current) return "Tiempo no disponible ahora mismo.";

    const temp = Math.round(current.temperature_2m);
    const wind = Math.round(current.wind_speed_10m);
    const humidity = Math.round(current.relative_humidity_2m);
    const code = current.weather_code;

    // Probabilidad de lluvia: cogemos la de la hora actual
    // data.hourly.time es un array de ISO strings. Buscamos el Ã­ndice de la hora actual.
    // SimplificaciÃ³n: usamos new Date().getHours() asumiendo que la API devuelve desde las 00:00 de hoy (o cerca)
    // Open-Meteo devuelve 7 dÃ­as por defecto, empezando hoy.
    // El Ã­ndice de "ahora" es aproximadamente la hora actual (0-23).
    const currentHour = new Date().getHours();
    const precipProb = data.hourly && data.hourly.precipitation_probability
      ? (data.hourly.precipitation_probability[currentHour] || 0)
      : 0;

    const weatherIconPath = getWeatherIconPath(code);

    return `
      <div class="weather-widget">
        <div class="weather-left-group">
          <div class="weather-main-row">
            <div class="weather-icon-large"><img src="${weatherIconPath}" alt="Tiempo" class="weather-icon-img"></div>
            <div class="weather-temp-large">${temp}°C</div>
          </div>
        </div>
        <div class="weather-details">
          <div>Precipitaciones: ${precipProb}%</div>
          <div>Humedad: ${humidity}%</div>
          <div class="weather-wind-row">
            <button type="button" class="weather-expand" aria-label="Ampliar">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="6 9 12 15 18 9"></polyline>
              </svg>
            </button>
            <span>Viento: ${wind} km/h</span>
          </div>
        </div>
      </div>
      <div class="weather-week weather-week-hidden"></div>
    `;
  } catch (e) {
    console.error(e);
    return "No se ha podido cargar el parte meteorológico.";
  }
}

// FunciÃ³n auxiliar para convertir direcciÃ³n del viento en flecha
function getWindArrow(degrees) {
  if (degrees === null || degrees === undefined) return "←";
  if (degrees >= 337.5 || degrees < 22.5) return "↓"; // N
  if (degrees >= 22.5 && degrees < 67.5) return "↗"; // NE
  if (degrees >= 67.5 && degrees < 112.5) return "→"; // E
  if (degrees >= 112.5 && degrees < 157.5) return "↘"; // SE
  if (degrees >= 157.5 && degrees < 202.5) return "↓"; // S
  if (degrees >= 202.5 && degrees < 247.5) return "↙"; // SW
  if (degrees >= 247.5 && degrees < 292.5) return "←"; // W
  if (degrees >= 292.5 && degrees < 337.5) return "↖"; // NW
  return "←";
}

async function fetchWeatherWeek(lat, lng) {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&daily=weathercode,temperature_2m_max,temperature_2m_min,windspeed_10m_max,wind_direction_10m_dominant,precipitation_probability_max,precipitation_sum&timezone=auto`;

    const res = await fetch(url);
    if (!res.ok) throw new Error("Error HTTP");

    const data = await res.json();
    const d = data.daily;
    if (!d || !d.time) return "Pronóstico semanal no disponible.";

    const html = d.time.map((iso, i) => {
      const date = new Date(iso);
      const dayName = date.toLocaleDateString("es-ES", { weekday: "long" }).toUpperCase();
      const dayNum = date.getDate();
      const monthName = date.toLocaleDateString("es-ES", { month: "long" }).toUpperCase();

      const tMin = Math.round(d.temperature_2m_min[i]);
      const tMax = Math.round(d.temperature_2m_max[i]);
      const wind = Math.round(d.windspeed_10m_max[i]);
      const windDir = d.wind_direction_10m_dominant ? d.wind_direction_10m_dominant[i] : null;
      const precipProb = d.precipitation_probability_max ? d.precipitation_probability_max[i] : 0;
      const precipAmt = d.precipitation_sum ? d.precipitation_sum[i] : 0;
      const code = d.weathercode[i];

      const weatherIconPath = getWeatherIconPath(code);
      const windArrow = getWindArrow(windDir);

      return `
        <div class="week-day-card">
          <div class="week-day-header">${dayName}, ${dayNum} ${monthName}</div>
          <div class="week-day-content">
            <div class="week-temps">
              <span class="week-temp-max">↑ ${tMax}°</span>
              <span class="week-temp-min">↓ ${tMin}°</span>
            </div>
            <div class="week-icon"><img src="${weatherIconPath}" alt="Tiempo" class="weather-icon-img"></div>
            <div class="week-details">
              <div class="week-precip"><img src="icons/weather/Gota.png" alt="Lluvia" class="precip-icon"> ${precipProb}% | ${precipAmt.toFixed(1)} mm</div>
              <div class="week-wind">${windArrow} ${wind} km/h</div>
            </div>
          </div>
        </div>
      `;
    }).join("");

    return html;
  } catch (e) {
    console.error(e);
    return "No se ha podido cargar el pronóstico semanal.";
  }
}

// ================== FUNCIONES DE GOOGLE MAPS ELIMINADAS ==================
// Las siguientes funciones han sido eliminadas y reemplazadas por MapLibre:
// - loadAllSchools() -> ahora usa loadSchoolMarkers() en maplibre-map.js
// - loadParkingMarkers() -> ahora usa setupParkingsInteraction() en maplibre-map.js
// - loadSchool() -> ahora usa mlLoadSchool() en maplibre-map.js
// =========================================================================
function computeGradeSummary(schoolId) {
  const school = SCHOOL_DATA[schoolId];
  if (!school) return {};

  const out = {};

  Object.entries(school.grades).forEach(([grade, vias]) => {
    out[grade] = vias.length;
  });

  return out;
}

function renderGradeBars(summary) {
  const grades = Object.keys(summary).sort();

  return `
  <div class="grade-bars">
    ${grades
      .map(
        (g) => `
      <div class="grade-bar-item">
        <div class="grade-bar" 
             style="height:${summary[g] * 8}px; background:${GRADE_COLORS[g] || "#999"}">
        </div>
        <span class="grade-label">${g}</span>
      </div>
    `
      )
      .join("")}
  </div>
`;
}

// Helper to count grades for a specific sector
function getSectorGradeCounts(sectorName) {
  const counts = {};
  if (!map || !map.data) return counts;

  map.data.forEach((feature) => {
    const type = feature.getGeometry().getType();
    if (type === 'Point' || type === 'MultiPoint') {
      const s = feature.getProperty('sector');
      if (s && s.toLowerCase() === sectorName.toLowerCase()) {
        const grade = feature.getProperty('grado1') || feature.getProperty('Grado') || feature.getProperty('grade');
        if (grade) {
          counts[grade] = (counts[grade] || 0) + 1;
        }
      }
    }
  });
  return counts;
}

// Helper to generate Bar Chart HTML for Sector
function generatePieChartHtml(counts) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (total === 0) return '';

  // Sort grades
  const sortedGrades = Object.keys(counts).sort((a, b) => {
    const iA = GRADE_ORDER.indexOf(a);
    const iB = GRADE_ORDER.indexOf(b);
    if (iA === -1 && iB === -1) return a.localeCompare(b);
    if (iA === -1) return 1;
    if (iB === -1) return -1;
    return iA - iB;
  });

  const maxCount = Math.max(...sortedGrades.map(g => counts[g]));
  const maxBarHeight = 40;

  const barsHtml = sortedGrades.map(grade => {
    const count = counts[grade];
    const height = Math.max(4, (count / maxCount) * maxBarHeight);
    const color = GRADE_COLORS[grade] || '#ccc';

    return `
      <div style="display: flex; flex-direction: column; align-items: center; gap: 2px;">
        <div style="font-size: 9px; color: #666; font-weight: 600;">${count}</div>
        <div style="width: 16px; height: ${height}px; background: ${color}; border-radius: 3px; transition: transform 0.2s;" 
             onmouseover="this.style.transform='scale(1.1)'" 
             onmouseout="this.style.transform='scale(1)'"></div>
        <div style="font-size: 8px; color: #888; font-weight: 500;">${grade}</div>
      </div>
    `;
  }).join('');

  return `
    <div style="margin-top: 15px; text-align: center; padding-top: 10px; border-top: 1px solid #eee;">
      <h4 style="margin: 0 0 15px 0; font-size: 14px; color: #555; padding-bottom: 8px;">
        Vías por Grado
        <span style="font-weight: normal; color: #888; font-size: 12px;">(${total} total)</span>
      </h4>
      
      <div style="display: flex; justify-content: center; align-items: flex-end; gap: 4px; padding: 10px 0;">
        ${barsHtml}
      </div>
    </div>
  `;
}

// ================== initMap ==================
// NOTA: Google Maps ha sido reemplazado por MapLibre GL JS
// Esta funciÃ³n ahora solo delega a MapLibre cuando USE_MAPLIBRE = true
// El código original de Google Maps ha sido eliminado

function initMap() {
  // Si MapLibre estÃ¡ activo, no hacer nada aquÃ­
  // MapLibre se inicializa desde maplibre-map.js via mlEnsureMapReady()
  if (typeof USE_MAPLIBRE !== 'undefined' && USE_MAPLIBRE) {
    console.log('initMap: Usando MapLibre GL JS (Google Maps desactivado)');
    return;
  }

  // Google Maps ya no estÃ¡ soportado
  console.error('Google Maps ha sido eliminado. Activa USE_MAPLIBRE = true en maplibre-config.js');
}

// ================== CÃƒâ€œDIGO DE GOOGLE MAPS ELIMINADO ==================
// El código original de Google Maps (aprox. 1800 líneas) ha sido eliminado.
// Todas las funciones de mapa ahora estÃ¡n en maplibre-map.js
// Funciones eliminadas:
// - InicializaciÃ³n de google.maps.Map
// - loadSchoolSectors, loadAutonomiasLayer
// - SectorLabelOverlay class
// - Listeners de zoom, click en sectores/vías
// - mainSchoolMarkers, parkingInfoWindow con Google
// - Geocoder y bÃºsqueda con Google Maps
// =====================================================================

// ================== GLOBAL EVENT LISTENERS ==================

// Global delegated event listener for action buttons
document.addEventListener('click', async (e) => {
  // 1. Check Button (Log Ascent)
  const checkBtn = e.target.closest('.check-btn');
  if (checkBtn) {
    const btnSchoolId = checkBtn.dataset.schoolId;
    const btnRouteId = checkBtn.dataset.routeId != null ? Number(checkBtn.dataset.routeId) : undefined;
    const btnRouteName = checkBtn.dataset.routeName;
    const btnGrade = checkBtn.dataset.grade;
    const btnSector = checkBtn.dataset.sector;
    openAscentModal(btnSchoolId, currentSchoolName || btnSchoolId, btnRouteId, btnRouteName, btnGrade, btnSector);
    return;
  }

  // 2. Favorite Button (Heart)
  const favBtn = e.target.closest('.fav-btn');
  if (favBtn) {
    if (!currentUser) {
      showToast('Inicia sesiÃ³n para guardar tus favoritos', 'info');
    }

    const type = favBtn.dataset.type;
    const id = favBtn.dataset.id;
    const name = favBtn.dataset.name;

    // Optimistic update
    const isActive = favBtn.classList.contains('active');
    favBtn.innerHTML = !isActive ? ICONS.heartFilled : ICONS.heart;
    favBtn.classList.toggle('active');

    if (currentUser) {
      await toggleFavorite(type, id, name);
    }
    return;
  }

  // 3. Save Button (Bookmark/Project)
  const saveBtn = e.target.closest('.save-btn');
  if (saveBtn) {
    if (!currentUser) {
      showToast('Inicia sesión para guardar proyectos', 'info');
    }

    const id = saveBtn.dataset.id;
    const name = saveBtn.dataset.name;
    const grade = saveBtn.dataset.grade;

    // Optimistic update
    const isActive = saveBtn.classList.contains('active');
    saveBtn.innerHTML = !isActive ? ICONS.bookmarkFilled : ICONS.bookmark;
    saveBtn.classList.toggle('active');

    if (currentUser) {
      await toggleProject(id, name, grade);
    }
    return;
  }

  // 4. Comment Button
  const commentBtn = e.target.closest('.comment-btn');
  if (commentBtn) {
    const commentRouteId = commentBtn.dataset.routeId != null ? Number(commentBtn.dataset.routeId) : undefined;
    const commentRouteName = commentBtn.dataset.routeName;
    const schoolId = commentBtn.dataset.schoolId || currentSchoolId;

    log('Opening comments for routeId:', commentRouteId, 'name:', commentRouteName);
    if (typeof openCommentsModal === 'function') {
      openCommentsModal(schoolId, commentRouteId, commentRouteName);
    } else {
      console.error('openCommentsModal not found');
    }
    return;
  }

  // 5. Share Button
  const shareBtn = e.target.closest('.share-btn');
  if (shareBtn) {
    const shareData = {
      title: 'Climbmaps',
      text: shareBtn.dataset.text,
      url: window.location.href
    };

    if (navigator.share) {
      try {
        await navigator.share(shareData);
      } catch (err) {
        log('Error sharing:', err);
      }
    } else {
      // Fallback
      navigator.clipboard.writeText(window.location.href);
      showToast('Enlace copiado al portapapeles', 'info');
    }
    return;
  }

  // 6. Upload Photo Button
  const uploadBtn = e.target.closest('.upload-photo-btn');
  if (uploadBtn) {
    const schoolId = uploadBtn.dataset.schoolId;
    const uploadRouteId = uploadBtn.dataset.routeId != null ? Number(uploadBtn.dataset.routeId) : undefined;
    const routeName = uploadBtn.dataset.routeName;

    // Create file input
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.onchange = async (evt) => {
      const file = evt.target.files[0];
      if (!file) return;

      // Show loading toast
      showToast('Subiendo foto...', 'info');

      try {
        if (typeof uploadRoutePhoto === 'function') {
          await uploadRoutePhoto(schoolId, uploadRouteId, routeName, file);
          showToast('Foto subida', 'success');

          // Refresh the popup to show new photo
          // Trigger click on the same feature again
          if (routeInfoWindow) routeInfoWindow.close();
          if (schoolInfoWindow) schoolInfoWindow.close();
        } else {
          console.error('uploadRoutePhoto function not found');
          showToast('Error: función de subida no disponible', 'error');
        }
      } catch (error) {
        console.error('Error uploading photo:', error);
        showToast(error.message || 'Error subiendo foto', 'error');
      }
    };
    fileInput.click();
    return;
  }

  // 7. Photo Click (Enlarge with Carousel)
  const photoImg = e.target.closest('.route-main-photo-img');
  if (photoImg) {
    const container = photoImg.closest('.route-main-photo-container');
    const photosData = container ? container.dataset.photos : null;
    const currentIndex = container ? parseInt(container.dataset.currentIndex || 0) : 0;

    const overlay = document.getElementById('route-photo-overlay');
    const overlayImg = document.getElementById('route-photo-overlay-img');

    if (overlay && overlayImg) {
      if (photosData) {
        // Setup Overlay Carousel
        const photos = JSON.parse(decodeURIComponent(photosData));
        overlay.dataset.photos = photosData;
        overlay.dataset.currentIndex = currentIndex;

        overlayImg.src = photos[currentIndex].url;

        // Add/Update Navigation Buttons in Overlay
        let navContainer = overlay.querySelector('.overlay-nav-container');
        if (!navContainer) {
          navContainer = document.createElement('div');
          navContainer.className = 'overlay-nav-container';
          overlay.appendChild(navContainer);
        }

        if (photos.length > 1) {
          navContainer.innerHTML = `
            <button class="overlay-nav-btn prev" title="Anterior">Ã¢ÂÂ®</button>
            <button class="overlay-nav-btn next" title="Siguiente">Ã¢ÂÂ¯</button>
          `;
          // Set initial arrow visibility
          updateOverlayArrows(overlay, currentIndex, photos.length);
        } else {
          navContainer.innerHTML = '';
        }
      } else {
        // Fallback for single image without container data
        overlayImg.src = photoImg.dataset.fullUrl;
        const nav = overlay.querySelector('.overlay-nav-container');
        if (nav) nav.innerHTML = '';
      }

      overlay.classList.remove('hidden');
    }
    return;
  }

  // 8. Delete Photo Button
  const deletePhotoBtn = e.target.closest('.delete-photo-btn');
  if (deletePhotoBtn) {
    const photoId = deletePhotoBtn.dataset.photoId;
    const uploaderUid = deletePhotoBtn.dataset.uploaderUid;

    if (!confirm('¿Eliminar esta foto?')) return;

    showToast('Eliminando foto...', 'info');

    try {
      if (typeof deleteRoutePhoto === 'function') {
        await deleteRoutePhoto(photoId, uploaderUid);
        showToast('Foto eliminada', 'success');

        // Refresh popup
        if (routeInfoWindow) routeInfoWindow.close();
        if (schoolInfoWindow) schoolInfoWindow.close();
      } else {
        console.error('deleteRoutePhoto function not found');
        showToast('Error: función de eliminación no disponible', 'error');
      }
    } catch (error) {
      console.error('Error deleting photo:', error);
      showToast(error.message || 'Error eliminando foto', 'error');
    }
    return;
  }

  // 9. Carousel Navigation (Popup)
  const navZone = e.target.closest('.photo-nav-zone');
  if (navZone) {
    e.stopPropagation(); // Prevent map click or other bubbling
    const container = navZone.closest('.route-main-photo-container');
    if (!container) return;

    const photos = JSON.parse(decodeURIComponent(container.dataset.photos));
    let currentIndex = parseInt(container.dataset.currentIndex || 0);
    const isNext = navZone.classList.contains('next');

    // Calculate new index without looping
    let newIndex = currentIndex;
    if (isNext && currentIndex < photos.length - 1) {
      newIndex = currentIndex + 1;
    } else if (!isNext && currentIndex > 0) {
      newIndex = currentIndex - 1;
    } else {
      return; // At boundary, do nothing
    }

    // Update State
    container.dataset.currentIndex = newIndex;

    // Update Image
    const img = container.querySelector('.route-main-photo-img');
    const photo = photos[newIndex];
    img.src = photo.url;
    img.dataset.fullUrl = photo.url;

    // Update Delete Button
    const deleteBtn = container.querySelector('.main-delete-btn');
    if (deleteBtn) {
      deleteBtn.dataset.photoId = photo.id;
      deleteBtn.dataset.uploaderUid = photo.uploadedBy;
    }

    // Update arrow visibility
    updateCarouselArrows(container, newIndex, photos.length);
    return;
  }

  // 10. Overlay Navigation
  const overlayNavBtn = e.target.closest('.overlay-nav-btn');
  if (overlayNavBtn) {
    e.stopPropagation();
    const overlay = document.getElementById('route-photo-overlay');
    const overlayImg = document.getElementById('route-photo-overlay-img');

    if (!overlay.dataset.photos) return;

    const photos = JSON.parse(decodeURIComponent(overlay.dataset.photos));
    let currentIndex = parseInt(overlay.dataset.currentIndex || 0);
    const isNext = overlayNavBtn.classList.contains('next');

    // Calculate new index without looping
    let newIndex = currentIndex;
    if (isNext && currentIndex < photos.length - 1) {
      newIndex = currentIndex + 1;
    } else if (!isNext && currentIndex > 0) {
      newIndex = currentIndex - 1;
    } else {
      return; // At boundary, do nothing
    }

    overlay.dataset.currentIndex = newIndex;
    overlayImg.src = photos[newIndex].url;

    // Update arrow visibility
    updateOverlayArrows(overlay, newIndex, photos.length);
    return;
  }

  // 11. Feed Action Buttons (Like, Comment, Share, Bookmark)
  const feedActionBtn = e.target.closest('.feed-action-btn');
  if (feedActionBtn && feedActionBtn.dataset.action) {
    e.stopPropagation();
    const action = feedActionBtn.dataset.action;
    const postId = feedActionBtn.dataset.postId;

    if (!postId) return;

    switch (action) {
      case 'like':
        await handleFeedLike(postId, feedActionBtn);
        break;
      case 'comment':
        await handleFeedComment(postId, feedActionBtn);
        break;
      case 'bookmark':
        await handleFeedBookmark(postId, feedActionBtn);
        break;
    }
    return;
  }

  // 12. Inline Comment Form Submission
  const commentForm = e.target.closest('.feed-comment-form');
  if (commentForm && (e.target.matches('.feed-comment-submit') || e.target.closest('.feed-comment-submit'))) {
    e.preventDefault();
    e.stopPropagation();
    const commentsSection = commentForm.closest('.feed-comments-section');
    const postId = commentsSection?.dataset.postId;
    if (postId) {
      await handleInlineCommentSubmit(postId, commentForm);
    }
    return;
  }
});

// Helper function to update carousel arrow visibility
function updateCarouselArrows(container, currentIndex, totalPhotos) {
  const prevZone = container.querySelector('.photo-nav-zone.prev');
  const nextZone = container.querySelector('.photo-nav-zone.next');

  if (prevZone) {
    prevZone.style.display = currentIndex > 0 ? 'flex' : 'none';
  }
  if (nextZone) {
    nextZone.style.display = currentIndex < totalPhotos - 1 ? 'flex' : 'none';
  }
}

// Helper function to update overlay arrow visibility
function updateOverlayArrows(overlay, currentIndex, totalPhotos) {
  const navContainer = overlay.querySelector('.overlay-nav-container');
  if (!navContainer) return;

  const prevBtn = navContainer.querySelector('.overlay-nav-btn.prev');
  const nextBtn = navContainer.querySelector('.overlay-nav-btn.next');

  if (prevBtn) {
    prevBtn.style.display = currentIndex > 0 ? 'flex' : 'none';
  }
  if (nextBtn) {
    nextBtn.style.display = currentIndex < totalPhotos - 1 ? 'flex' : 'none';
  }
}

// ================== FEED & NAVIGATION LOGIC ==================

document.addEventListener('DOMContentLoaded', () => {
  initFeed();
  initNavigation();
  initProfile();
  initNotifications();
  initMessages();
  initGlobalSearch();
  initImageLightbox(); // Inicializar lightbox de imÃ¡genes
  initProfileBackButton(); // Inicializar botÃ³n de retroceso de perfil
  // Ensure we start in feed view with correct UI state (hidden search bar, etc.)
  switchView('feed-view');

  // Ocultar splash screen cuando la app estÃ© lista (solo en Capacitor)
  setTimeout(() => {
    if (window.hideSplashScreen && typeof window.hideSplashScreen === 'function') {
      window.hideSplashScreen();
      console.log('[App] App completamente cargada - splash screen ocultado');
    }
  }, 500); // PequeÃ±o delay para asegurar que todo estÃ© renderizado
});

// ================== GLOBAL SEARCH ==================
// Panel inferior «Buscar» (lupa de la cabecera del feed). Solo datos reales:
// - Personas: Firestore (searchUsersGlobal) y la lógica de seguir existente (toggleFollow).
// - Escuelas, sectores y vías: MAPLIBRE_SCHOOLS y su cartografía GeoJSON (índice en memoria).
// - Búsquedas recientes: solo en este dispositivo (localStorage).
// No hay hashtags: los posts no guardan hashtags y Firestore no busca dentro del texto.

// Real search for users in Firestore (también la usa el autocompletado de menciones)
async function searchUsersGlobal(query) {
  try {
    const queryLower = query.toLowerCase();
    // Approach 1: Try to search with displayNameLower field
    let snapshot = await db.collection('users')
      .orderBy('displayNameLower')
      .startAt(queryLower)
      .endAt(queryLower + '')
      .limit(10)
      .get();

    if (snapshot.empty) {
      // Approach 2: Fallback to client side filter
      const allUsersSnapshot = await db.collection('users').limit(50).get();
      return allUsersSnapshot.docs
        .map(doc => ({ id: doc.id, ...doc.data() }))
        .filter(user => {
          const name = (user.displayName || '').toLowerCase();
          const email = (user.email || '').toLowerCase();
          return name.includes(queryLower) || email.includes(queryLower);
        })
        .slice(0, 10);
    }
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  } catch (error) {
    console.error('Error searching users:', error);
    // Try fallback approach if index error
    if (error.code === 'failed-precondition' || error.message.includes('index')) {
      try {
        const allUsersSnapshot = await db.collection('users').limit(50).get();
        return allUsersSnapshot.docs
          .map(doc => ({ id: doc.id, ...doc.data() }))
          .filter(user => (user.displayName || '').toLowerCase().includes(query.toLowerCase()))
          .slice(0, 10);
      } catch (e) { throw e; }
    }
    throw error;
  }
}
// Expose searchUsersGlobal globally so MentionAutocomplete can use it
window.searchUsersGlobal = searchUsersGlobal;

function initGlobalSearch() {
  const sheet = document.getElementById('search-sheet');
  const searchBtn = document.getElementById('nav-search-btn');
  const searchInput = document.getElementById('global-search-input');
  const clearBtn = document.getElementById('search-clear');
  const resultsContainer = document.getElementById('search-results');
  const categories = document.getElementById('search-categories');

  if (!sheet || !searchBtn || !searchInput || !resultsContainer) return;

  // Recientes: los destinos que se abren desde los resultados (perfil, escuela, sector, vía), no el texto escrito.
  // Clave nueva: el historial antiguo guardaba texto y no se reutiliza.
  const RECENT_KEY = 'krux-recent-results';
  const RECENT_MAX = 8;
  const MIN_CHARS = 2;
  const SECTION_LIMIT = 5; // por sección en «Todo»
  const ADMIN_UID = 'akqgKt9WmQRNrpPub9xVKiPKmcn2';

  let currentType = 'all';
  let searchTimeout = null;
  let searchSeq = 0;               // descarta respuestas de búsquedas ya superadas
  const userCache = new Map();     // consulta → personas (evita repetir la misma consulta)
  let placesIndexPromise = null;   // índice de escuelas, sectores y vías (se carga una vez)

  const esc = (t) => escapeHtmlMention(String(t ?? ''));
  const norm = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

  // ---------- Recientes (este dispositivo) ----------
  const recentKey = (it) => {
    if (it.type === 'user') return `u:${it.id}`;
    if (it.type === 'school') return `s:${it.id}`;
    if (it.type === 'sector') return `c:${it.schoolId}|${it.name}`;
    return `r:${it.schoolId}|${it.name}|${it.sector || ''}`;
  };
  function getRecent() {
    try {
      return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]')
        .filter(it => it && typeof it === 'object' && ['user', 'school', 'sector', 'route'].includes(it.type));
    } catch (_) { return []; }
  }
  function setRecent(list) {
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_MAX))); } catch (_) { /* almacenamiento no disponible */ }
  }
  function rememberResult(item) {
    if (!item || !item.type) return;
    setRecent([item, ...getRecent().filter(x => recentKey(x) !== recentKey(item))]);
  }

  // ---------- Índice de lugares desde la cartografía ----------
  function centroid(geometry) {
    if (!geometry) return null;
    const pts = [];
    const walk = (c) => {
      if (typeof c[0] === 'number') pts.push(c);
      else c.forEach(walk);
    };
    try { walk(geometry.coordinates); } catch (_) { return null; }
    if (!pts.length) return null;
    const sum = pts.reduce((acc, p) => [acc[0] + p[0], acc[1] + p[1]], [0, 0]);
    return [sum[0] / pts.length, sum[1] / pts.length];
  }

  async function fetchGeoJSON(path) {
    if (!path) return [];
    const res = await fetch(encodeURI(path));
    if (!res.ok) throw new Error(`HTTP ${res.status} en ${path}`);
    const data = await res.json();
    return Array.isArray(data.features) ? data.features : [];
  }

  function loadPlacesIndex() {
    if (placesIndexPromise) return placesIndexPromise;
    const schoolsConfig = typeof MAPLIBRE_SCHOOLS !== 'undefined' ? MAPLIBRE_SCHOOLS : {};
    placesIndexPromise = Promise.all(Object.values(schoolsConfig).map(async (school) => {
      const [sectorFeatures, routeFeatures] = await Promise.all([
        fetchGeoJSON(school.geojson?.sectores),
        fetchGeoJSON(school.geojson?.vias)
      ]);
      return { school, sectorFeatures, routeFeatures };
    })).then(perSchool => {
      const index = { schools: [], sectors: [], routes: [] };
      perSchool.forEach(({ school, sectorFeatures, routeFeatures }) => {
        index.schools.push({
          kind: 'school', id: school.id, name: school.name, key: norm(school.name),
          sectors: sectorFeatures.length, routes: routeFeatures.length
        });
        sectorFeatures.forEach(f => {
          const name = f.properties?.nombre;
          if (!name) return;
          index.sectors.push({
            kind: 'sector', schoolId: school.id, schoolName: school.name, name, key: norm(name),
            props: f.properties, coords: centroid(f.geometry)
          });
        });
        routeFeatures.forEach(f => {
          const name = f.properties?.nombre;
          // Sin letras ni números (p. ej. «.») no es un nombre buscable
          if (!name || !/[\p{L}\p{N}]/u.test(name)) return;
          index.routes.push({
            kind: 'route', schoolId: school.id, schoolName: school.name, name, key: norm(name),
            grade: f.properties?.grado1 || '', sector: f.properties?.sector || '',
            props: f.properties, coords: centroid(f.geometry)
          });
        });
      });
      index.schools.sort((x, y) => x.name.localeCompare(y.name, 'es'));
      return index;
    }).catch(err => {
      placesIndexPromise = null; // se puede reintentar
      throw err;
    });
    return placesIndexPromise;
  }

  const rank = (key, q) => (key.startsWith(q) ? 0 : 1);
  function matchPlaces(index, q) {
    const nq = norm(q);
    const places = [...index.schools, ...index.sectors]
      .filter(p => p.key.includes(nq))
      .sort((x, y) => rank(x.key, nq) - rank(y.key, nq) || (x.kind === 'school' ? -1 : 1) || x.name.localeCompare(y.name, 'es'));
    return places;
  }
  function matchRoutes(index, q) {
    const nq = norm(q);
    // Por nombre o por grado exacto (p. ej. «6a+»)
    return index.routes
      .filter(r => r.key.includes(nq) || norm(r.grade) === nq)
      .sort((x, y) => rank(x.key, nq) - rank(y.key, nq) || x.name.localeCompare(y.name, 'es'));
  }

  // ---------- Pintado ----------
  const ICONS = {
    clock: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><polyline points="12 7 12 12 15 14"></polyline></svg>',
    x: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>',
    chevron: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"></polyline></svg>',
    user: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>',
    mountain: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 20l6.5-11 4 6.5 2.5-4L21 20z"></path></svg>',
    sector: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19l4-12 4 6 3-4 5 10z"></path><circle cx="16.5" cy="5.5" r="1.5"></circle></svg>',
    route: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 21c0-5 10-6 10-11a4 4 0 0 0-8 0"></path><circle cx="9" cy="10" r="1"></circle><circle cx="17" cy="21" r="0.5"></circle></svg>'
  };

  function gradeChip(grade) {
    return kxGradeChipHTML(grade, 'search-grade');
  }

  function sectionHead(title, moreType, total) {
    const more = moreType && total > SECTION_LIMIT
      ? `<button type="button" class="search-more" data-category="${moreType}">Ver todas (${total})</button>`
      : '';
    return `<div class="search-section-head"><h3>${title}</h3>${more}</div>`;
  }

  function userRow(user, isFollowing) {
    const name = esc(user.displayName || 'Usuario');
    const avatar = user.photoURL || generateAvatarFallback(user.displayName || 'Usuario', 96);
    const handle = user.username ? `@${esc(user.username)}` : (user.id === ADMIN_UID ? 'Administrador' : '');
    const followers = typeof user.stats?.followersCount === 'number'
      ? `${formatCount(user.stats.followersCount) || '0'} ${user.stats.followersCount === 1 ? 'seguidor' : 'seguidores'}`
      : '';
    const meta = [handle, followers].filter(Boolean).join(' · ');
    const isMe = currentUser && user.id === currentUser.uid;
    const pending = isFollowing === null; // estado aún por consultar
    const follow = currentUser && !isMe
      ? `<button type="button" class="kx-follow follow-btn ${isFollowing ? 'following' : ''}${pending ? ' is-pending' : ''}" data-follow-id="${esc(user.id)}"${pending ? ' disabled aria-busy="true"' : ''}>${isFollowing ? 'Siguiendo' : 'Seguir'}</button>`
      : '';
    return `
      <div class="search-row" role="button" tabindex="0" data-open="user" data-id="${esc(user.id)}" data-name="${name}" data-photo="${esc(user.photoURL || '')}" data-handle="${esc(user.username || '')}">
        <img class="search-avatar" src="${esc(avatar)}" alt="" referrerPolicy="no-referrer" onerror="this.src='${generateAvatarFallback(user.displayName || 'Usuario', 96)}'; this.onerror=null;">
        <div class="search-info">
          <div class="search-title">${name}</div>
          ${meta ? `<div class="search-meta">${meta}</div>` : ''}
        </div>
        ${follow}
      </div>`;
  }

  function placeRow(p, i) {
    if (p.kind === 'school') {
      const stats = [
        p.sectors ? `${p.sectors} ${p.sectors === 1 ? 'sector' : 'sectores'}` : '',
        p.routes ? `${formatCount(p.routes) || p.routes} ${p.routes === 1 ? 'vía' : 'vías'}` : ''
      ].filter(Boolean).join(' · ');
      return `
        <div class="search-row" role="button" tabindex="0" data-open="school" data-id="${esc(p.id)}">
          <span class="search-thumb">${ICONS.mountain}</span>
          <div class="search-info">
            <div class="search-title">${esc(p.name)}</div>
            <div class="search-meta">Escuela${stats ? ` · ${stats}` : ''}</div>
          </div>
          <span class="search-chevron">${ICONS.chevron}</span>
        </div>`;
    }
    return `
      <div class="search-row" role="button" tabindex="0" data-open="sector" data-index="${i}">
        <span class="search-thumb search-thumb--soft">${ICONS.sector}</span>
        <div class="search-info">
          <div class="search-title">${esc(p.name)}</div>
          <div class="search-meta">Sector · ${esc(p.schoolName)}</div>
        </div>
        <span class="search-chevron">${ICONS.chevron}</span>
      </div>`;
  }

  function routeRow(r, i) {
    const meta = [r.sector ? `Sector ${esc(r.sector)}` : '', esc(r.schoolName)].filter(Boolean).join(' · ');
    return `
      <div class="search-row" role="button" tabindex="0" data-open="route" data-index="${i}">
        ${gradeChip(r.grade)}
        <div class="search-info">
          <div class="search-title">${esc(r.name)}</div>
          <div class="search-meta">${meta}</div>
        </div>
        <span class="search-chevron">${ICONS.chevron}</span>
      </div>`;
  }

  function skeleton(n = 4) {
    return `<div class="search-loading" aria-busy="true">${'<div class="search-skel"><span class="a"></span><span class="b"></span></div>'.repeat(n)}<span class="kx-visually-hidden">Buscando…</span></div>`;
  }

  function stateBox(title, hint, action = '') {
    return `<div class="search-state"><div class="search-state-title">${title}</div>${hint ? `<div class="search-state-hint">${hint}</div>` : ''}${action}</div>`;
  }

  // Resultados pintados: se guardan para abrirlos al tocar (data-index)
  let shownPlaces = [];
  let shownRoutes = [];

  function renderExplore() {
    const recent = getRecent();
    let html = '';
    if (recent.length) {
      html += '<div class="search-section-head"><h3>Recientes</h3></div><div class="search-recent">';
      recent.forEach(it => {
        const key = esc(recentKey(it));
        let lead; let title = esc(it.name || ''); let meta = '';
        if (it.type === 'user') {
          const avatar = it.photo || generateAvatarFallback(it.name || 'Usuario', 96);
          lead = `<img class="search-avatar" src="${esc(avatar)}" alt="" referrerPolicy="no-referrer" onerror="this.src='${generateAvatarFallback(it.name || 'Usuario', 96)}'; this.onerror=null;">`;
          meta = it.handle ? `@${esc(it.handle)}` : 'Perfil';
        } else if (it.type === 'school') {
          lead = `<span class="search-thumb">${ICONS.mountain}</span>`;
          meta = 'Escuela';
        } else if (it.type === 'sector') {
          lead = `<span class="search-thumb search-thumb--soft">${ICONS.sector}</span>`;
          meta = `Sector · ${esc(it.schoolName || '')}`;
        } else {
          lead = gradeChip(it.grade);
          meta = [it.sector ? `Sector ${esc(it.sector)}` : '', esc(it.schoolName || '')].filter(Boolean).join(' · ');
        }
        html += `
          <div class="search-recent-row">
            <div class="search-row search-recent-open" role="button" tabindex="0" data-recent-open="${key}">
              ${lead}
              <div class="search-info">
                <div class="search-title">${title}</div>
                ${meta ? `<div class="search-meta">${meta}</div>` : ''}
              </div>
            </div>
            <button type="button" class="search-recent-remove" data-remove="${key}" aria-label="Quitar de recientes: ${title}">${ICONS.x}</button>
          </div>`;
      });
      html += '</div>';
    }
    html += `
      <div class="search-section-head"><h3>Explorar</h3></div>
      <div class="search-explore">
        <button type="button" class="search-explore-tile" data-category="users">${'<span class="search-explore-icon">' + ICONS.user + '</span>'}<span class="search-explore-title">Personas</span><span class="search-explore-desc">Encuentra escaladores</span></button>
        <button type="button" class="search-explore-tile" data-category="places">${'<span class="search-explore-icon">' + ICONS.mountain + '</span>'}<span class="search-explore-title">Escuelas</span><span class="search-explore-desc">Escuelas y sectores</span></button>
        <button type="button" class="search-explore-tile" data-category="routes">${'<span class="search-explore-icon">' + ICONS.route + '</span>'}<span class="search-explore-title">Vías</span><span class="search-explore-desc">Por nombre o grado</span></button>
      </div>`;
    resultsContainer.innerHTML = html;
  }

  async function renderEmptyCategory(type) {
    // Invalida cualquier carga pendiente (p. ej. la lista de escuelas) antes de pintar
    const seq = ++searchSeq;
    if (type === 'all') { renderExplore(); return; }
    if (type === 'users') {
      resultsContainer.innerHTML = stateBox('Busca personas', 'Escribe al menos dos letras de su nombre.');
      return;
    }
    if (type === 'routes') {
      resultsContainer.innerHTML = stateBox('Busca vías', 'Escribe el nombre de la vía o un grado, por ejemplo «6a+».');
      return;
    }
    // Escuelas sin consulta: listado completo de escuelas
    resultsContainer.innerHTML = skeleton(3);
    try {
      const index = await loadPlacesIndex();
      if (seq !== searchSeq) return;
      shownPlaces = index.schools;
      resultsContainer.innerHTML = '<div class="search-section-head"><h3>Escuelas</h3></div>' + shownPlaces.map(placeRow).join('');
    } catch (err) {
      if (seq !== searchSeq) return;
      console.error('Error cargando escuelas:', err);
      resultsContainer.innerHTML = stateBox('No se pudieron cargar las escuelas', 'Revisa tu conexión e inténtalo de nuevo.', '<button type="button" class="kx-btn kx-btn--secondary search-retry">Reintentar</button>');
    }
  }

  async function performSearch(query, type) {
    if (!query || query.trim().length < MIN_CHARS) {
      renderEmptyCategory(type);
      return;
    }
    const q = query.trim();
    const seq = ++searchSeq;
    resultsContainer.innerHTML = skeleton();

    const wantsUsers = type === 'all' || type === 'users';
    const wantsPlaces = type === 'all' || type === 'places';
    const wantsRoutes = type === 'all' || type === 'routes';

    const usersTask = wantsUsers ? (async () => {
      const key = norm(q);
      if (!userCache.has(key)) userCache.set(key, searchUsersGlobal(q).catch(e => { userCache.delete(key); throw e; }));
      const users = (await userCache.get(key)).filter(u => !(currentUser && u.id === currentUser.uid));
      // El estado de seguimiento llega después (hydrateFollowStates): no bloquea la lista
      return users.map(u => ({ user: u, following: currentUser ? null : false }));
    })() : Promise.resolve([]);
    const indexTask = (wantsPlaces || wantsRoutes) ? loadPlacesIndex() : Promise.resolve(null);

    const [usersRes, indexRes] = await Promise.allSettled([usersTask, indexTask]);
    if (seq !== searchSeq) return; // llegó otra búsqueda

    const failed = (wantsUsers && usersRes.status === 'rejected') || ((wantsPlaces || wantsRoutes) && indexRes.status === 'rejected');
    const users = usersRes.status === 'fulfilled' ? usersRes.value : [];
    const index = indexRes.status === 'fulfilled' ? indexRes.value : null;
    const places = index && wantsPlaces ? matchPlaces(index, q) : [];
    const routes = index && wantsRoutes ? matchRoutes(index, q) : [];

    if (!users.length && !places.length && !routes.length) {
      if (failed) {
        resultsContainer.innerHTML = stateBox('No se pudo completar la búsqueda', 'Revisa tu conexión e inténtalo de nuevo.', '<button type="button" class="kx-btn kx-btn--secondary search-retry">Reintentar</button>');
      } else {
        const hint = type === 'all'
          ? 'Prueba con otra palabra o revisa la ortografía.'
          : 'Prueba en «Todo» o con otra palabra.';
        resultsContainer.innerHTML = stateBox(`Sin resultados para «${esc(q)}»`, hint);
      }
      return;
    }

    const limit = (list) => (type === 'all' ? list.slice(0, SECTION_LIMIT) : list);
    shownPlaces = limit(places);
    shownRoutes = limit(routes);
    let html = '';
    if (users.length) html += sectionHead('Personas', type === 'all' ? 'users' : null, users.length) + limit(users).map(x => userRow(x.user, x.following)).join('');
    if (places.length) html += sectionHead('Escuelas y sectores', type === 'all' ? 'places' : null, places.length) + shownPlaces.map(placeRow).join('');
    if (routes.length) html += sectionHead('Vías', type === 'all' ? 'routes' : null, routes.length) + shownRoutes.map(routeRow).join('');
    if (failed) html += stateBox('Algunos resultados no se pudieron cargar', 'Revisa tu conexión.');
    resultsContainer.innerHTML = html;
    hydrateFollowStates(limit(users), seq);
  }

  // Consulta el estado real de seguimiento de cada persona mostrada y activa su botón
  function hydrateFollowStates(list, seq) {
    if (!currentUser) return;
    list.forEach(({ user }) => {
      db.collection('users').doc(currentUser.uid).collection('following').doc(user.id).get()
        .then(doc => doc.exists)
        .catch(() => false)
        .then(following => {
          if (seq !== searchSeq) return; // ya hay otra búsqueda en pantalla
          const btn = [...resultsContainer.querySelectorAll('[data-follow-id]')].find(b => b.dataset.followId === user.id);
          if (!btn || !btn.classList.contains('is-pending')) return;
          btn.classList.remove('is-pending');
          btn.classList.toggle('following', following);
          btn.textContent = following ? 'Siguiendo' : 'Seguir';
          btn.disabled = false;
          btn.removeAttribute('aria-busy');
        });
    });
  }

  // ---------- Navegación a los destinos ----------
  function waitForMap(timeout = 12000) {
    return new Promise(resolve => {
      const start = Date.now();
      (function check() {
        if (typeof mlMap !== 'undefined' && mlMap && mlMap.isStyleLoaded && mlMap.isStyleLoaded()) return resolve(true);
        if (Date.now() - start > timeout) return resolve(false);
        setTimeout(check, 150);
      })();
    });
  }

  async function openOnMap(item) {
    sheet.classList.add('hidden');
    switchView('map-view');
    const ready = await waitForMap();
    if (!ready || typeof mlLoadSchool !== 'function') {
      showToast('El mapa todavía no está listo. Inténtalo de nuevo.', 'info');
      return;
    }
    const schoolId = item.kind === 'school' ? item.id : item.schoolId;
    await mlLoadSchool(schoolId, item.kind !== 'school' && !!item.coords);
    if (item.kind === 'school' || !item.coords) return;
    mlMap.flyTo({ center: item.coords, zoom: item.kind === 'route' ? 18 : 16.5, essential: true });
    mlMap.once('moveend', () => {
      if (item.kind === 'sector') {
        if (!showSectorBottomSheet(item.props, item.coords)) showSectorPopup(item.props, item.coords);
      } else {
        Promise.resolve(showRouteBottomSheet(item.props, item.coords)).then(shown => {
          if (!shown) showRoutePopup(item.props, item.coords);
        });
      }
    });
  }

  // Abre un reciente: personas directamente; lugares y vías se resuelven contra la cartografía actual
  async function openRecent(item) {
    if (item.type === 'user') {
      rememberResult(item);
      sheet.classList.add('hidden');
      openPublicProfile(item.id);
      return;
    }
    let target = null;
    try {
      const index = await loadPlacesIndex();
      if (item.type === 'school') target = index.schools.find(x => x.id === item.id);
      else if (item.type === 'sector') target = index.sectors.find(x => x.schoolId === item.schoolId && x.name === item.name);
      else target = index.routes.find(x => x.schoolId === item.schoolId && x.name === item.name && (x.sector || '') === (item.sector || ''));
    } catch (err) {
      console.error('Error abriendo reciente:', err);
      showToast('No se pudo cargar la cartografía. Revisa tu conexión.', 'error');
      return;
    }
    if (!target) {
      // Ya no existe en la cartografía: se quita de recientes
      setRecent(getRecent().filter(it => recentKey(it) !== recentKey(item)));
      renderExplore();
      showToast('Ese resultado ya no está disponible', 'info');
      return;
    }
    rememberResult(item);
    openOnMap(target);
  }

  // Desde fuera del buscador (p. ej. el grado de una ascensión publicada): localiza la vía y la abre en el mapa
  window.kxOpenAscentOnMap = async function (ascent) {
    let index;
    try {
      index = await loadPlacesIndex();
    } catch (err) {
      console.error('Error cargando la cartografía:', err);
      showToast('No se pudo cargar la cartografía. Revisa tu conexión.', 'error');
      return;
    }
    const key = norm(ascent.routeName || '');
    const sameName = index.routes.filter(r => r.key === key && (!ascent.schoolId || r.schoolId === ascent.schoolId));
    const target = sameName.find(r => ascent.sector && norm(r.sector) === norm(ascent.sector)) || sameName[0];
    if (!target) {
      showToast('Esa vía ya no está en el mapa', 'info');
      return;
    }
    openOnMap(target);
  };

  // ---------- Eventos ----------
  function setCategory(type) {
    currentType = type;
    categories?.querySelectorAll('.kx-chip').forEach(c => {
      const active = c.dataset.type === type;
      c.classList.toggle('is-active', active);
      c.setAttribute('aria-pressed', String(active));
    });
    performSearch(searchInput.value, currentType);
  }

  function updateClear() {
    if (clearBtn) clearBtn.hidden = searchInput.value.length === 0;
  }

  function openSearchSheet() {
    document.getElementById('messages-dropdown')?.classList.add('hidden');
    document.getElementById('notification-dropdown')?.classList.add('hidden');
    sheet.classList.remove('hidden');
    // Se conserva la última búsqueda; si no hay texto se muestra «Explorar»
    if (searchInput.value.trim().length < MIN_CHARS) renderEmptyCategory(currentType);
    updateClear();
    searchInput.focus({ preventScroll: true });
  }

  searchBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (sheet.classList.contains('hidden')) openSearchSheet();
    else closeFeedSheet(sheet);
  });

  categories?.addEventListener('click', (e) => {
    const chip = e.target.closest('.kx-chip');
    if (chip && chip.dataset.type !== currentType) setCategory(chip.dataset.type);
  });

  searchInput.addEventListener('input', () => {
    updateClear();
    if (searchTimeout) clearTimeout(searchTimeout);
    const query = searchInput.value.trim();
    if (query.length < MIN_CHARS) {
      searchSeq++;
      renderEmptyCategory(currentType);
      return;
    }
    searchTimeout = setTimeout(() => performSearch(query, currentType), 350);
  });

  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (searchTimeout) clearTimeout(searchTimeout);
      performSearch(searchInput.value, currentType);
      searchInput.blur(); // cierra el teclado para ver los resultados
    }
  });

  clearBtn?.addEventListener('click', () => {
    searchInput.value = '';
    updateClear();
    searchSeq++;
    renderEmptyCategory(currentType);
    searchInput.focus();
  });

  resultsContainer.addEventListener('click', async (e) => {
    const followBtn = e.target.closest('[data-follow-id]');
    if (followBtn) {
      e.stopPropagation();
      if (typeof window.toggleFollow === 'function') await window.toggleFollow(followBtn.dataset.followId, followBtn);
      return;
    }
    const more = e.target.closest('[data-category]');
    if (more) { setCategory(more.dataset.category); return; }
    if (e.target.closest('.search-retry')) { performSearch(searchInput.value, currentType); return; }

    const remove = e.target.closest('[data-remove]');
    if (remove) {
      e.stopPropagation();
      setRecent(getRecent().filter(it => recentKey(it) !== remove.dataset.remove));
      renderExplore();
      return;
    }
    const recentRow = e.target.closest('[data-recent-open]');
    if (recentRow) {
      const item = getRecent().find(it => recentKey(it) === recentRow.dataset.recentOpen);
      if (item) openRecent(item);
      return;
    }

    const row = e.target.closest('[data-open]');
    if (!row) return;
    const kind = row.dataset.open;
    if (kind === 'user') {
      rememberResult({ type: 'user', id: row.dataset.id, name: row.dataset.name, photo: row.dataset.photo, handle: row.dataset.handle });
      sheet.classList.add('hidden');
      openPublicProfile(row.dataset.id);
    } else if (kind === 'school') {
      const index = await loadPlacesIndex();
      const school = index.schools.find(sc => sc.id === row.dataset.id);
      if (school) {
        rememberResult({ type: 'school', id: school.id, name: school.name });
        openOnMap(school);
      }
    } else if (kind === 'sector') {
      const item = shownPlaces[Number(row.dataset.index)];
      if (item) {
        rememberResult({ type: 'sector', schoolId: item.schoolId, schoolName: item.schoolName, name: item.name });
        openOnMap(item);
      }
    } else if (kind === 'route') {
      const item = shownRoutes[Number(row.dataset.index)];
      if (item) {
        rememberResult({ type: 'route', schoolId: item.schoolId, schoolName: item.schoolName, name: item.name, grade: item.grade, sector: item.sector });
        openOnMap(item);
      }
    }
  });

  // Teclado: Intro o espacio abren el resultado
  resultsContainer.addEventListener('keydown', (e) => {
    const row = e.target.closest('[data-open], [data-recent-open]');
    if (row && e.target === row && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      row.click();
    }
  });
}

// ================== UNIFIED PROFILE VIEWER ==================
// Store the previous view to return to when viewing other profiles
let previousViewBeforeProfile = 'feed-view';
// Store currently viewed profile userId (null = own profile)
let currentProfileUserId = null;
// Loading state to prevent race conditions
let profileLoadingState = {
  isLoading: false,
  currentLoadId: null, // Track which profile is being loaded to cancel stale requests
  postsLoaded: false,
  likesLoaded: false,
  statsLoaded: false
};

/**
 * Reset all profile state before loading new data
 * FIX #1: Prevents state leak between profiles
 */
function resetProfileState() {
  profileLoadingState.postsLoaded = false;
  profileLoadingState.likesLoaded = false;
  profileLoadingState.statsLoaded = false;

  // Clear avatar immediately to prevent flash of old image
  const avatar = document.getElementById('profile-avatar');
  if (avatar) {
    cancelAvatarLoad(avatar);
    avatar.onerror = null;
    avatar.style.opacity = '1';
    avatar.src = 'https://ui-avatars.com/api/?name=...&background=DCE9DF&color=153E35&size=100';
  }

  // FIX #2: Clear tab contents to prevent data bleeding
  const postsGrid = document.getElementById('profile-grid');
  const likedGrid = document.getElementById('profile-liked-grid');
  const mentionsGrid = document.getElementById('profile-mentions-grid');
  if (postsGrid) postsGrid.innerHTML = '<div class="loading-spinner">Cargando...</div>';
  if (likedGrid) likedGrid.innerHTML = '<div class="loading-spinner">Cargando...</div>';
  if (mentionsGrid) mentionsGrid.innerHTML = '';

  // Reset stats to 0 while loading
  const elements = ['stat-followers', 'stat-following', 'total-ascents', 'max-grade', 'zones-visited'];
  elements.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = id === 'max-grade' ? '-' : '0';
  });

  // Reset tabs to first tab
  const profileView = document.getElementById('profile-view');
  if (profileView) {
    profileView.querySelectorAll('.profile-tab').forEach((tab, i) => {
      tab.classList.toggle('active', i === 0);
    });
    profileView.querySelectorAll('.profile-tab-content').forEach((content, i) => {
      content.classList.toggle('active', i === 0);
    });
  }
}

/**
 * Open a user's profile (own or other) in the unified profile-view
 * @param {string} userId - The user ID to view
 */
window.openPublicProfile = async function (userId) {
  // Generate unique load ID to handle race conditions
  const loadId = Date.now().toString();
  profileLoadingState.currentLoadId = loadId;
  profileLoadingState.isLoading = true;

  // If viewing own profile, just switch to profile view normally
  if (currentUser && currentUser.uid === userId) {
    currentProfileUserId = null;
    resetProfileState();
    switchView('profile-view');
    configureProfileViewForOwnProfile();
    await initProfile();
    profileLoadingState.isLoading = false;
    return;
  }

  // Store current view before navigating
  const currentActiveView = document.querySelector('.view.active:not(.hidden)');
  if (currentActiveView && currentActiveView.id !== 'profile-view') {
    previousViewBeforeProfile = currentActiveView.id;
  }

  // Set the current profile being viewed
  currentProfileUserId = userId;

  // FIX #1: Reset state BEFORE switching view to prevent flash of old data
  resetProfileState();

  // Navigate to profile view
  switchView('profile-view');

  // Configure UI for viewing OTHER user's profile
  configureProfileViewForOtherProfile();

  // Show loading state
  document.getElementById('profile-header-username').textContent = '@...';
  document.getElementById('profile-bio').textContent = '';
  document.getElementById('profile-name').textContent = '';

  try {
    // Check if this request is still valid (prevents race conditions)
    if (profileLoadingState.currentLoadId !== loadId) {
      console.log('Profile load cancelled - newer request in progress');
      return;
    }

    // Fetch user data
    const userDoc = await db.collection('users').doc(userId).get();

    // Check again after async operation
    if (profileLoadingState.currentLoadId !== loadId) {
      return;
    }

    if (!userDoc.exists) {
      showToast('Usuario no encontrado', 'error');
      goBackFromProfile();
      return;
    }

    const userData = userDoc.data();
    const displayName = userData.displayName || 'Usuario';

    // FIX #1: Set avatar with proper fallback
    const avatar = document.getElementById('profile-avatar');
    if (avatar && profileLoadingState.currentLoadId === loadId) {
      setAvatarWithFallback(avatar, userData.photoURL, displayName, 100);
    }

    // Populate header with username and profile with displayname
    document.getElementById('profile-header-username').textContent = `@${userData.username || displayName.toLowerCase().replace(/\s+/g, '')}`;
    document.getElementById('profile-name').textContent = displayName;
    document.getElementById('profile-location').textContent = userData.location || 'España';
    document.getElementById('profile-bio').textContent = userData.bio || 'Sin biografí­a';
    // Mostrar "Administrador" para la cuenta de Krux, "Escalador" para el resto
    const isAdmin = userId === 'akqgKt9WmQRNrpPub9xVKiPKmcn2';
    document.getElementById('profile-category').textContent = isAdmin ? 'Administrador' : '🧗 Escalador';

    // FIX #3: Load stats, follow status, posts, and likes in parallel with Promise.all
    const stats = userData.stats || {};

    // Setup follow button
    const followBtn = document.getElementById('profile-follow-btn');
    followBtn.dataset.userId = userId;

    // FIX: Load real follower/following counts by querying subcollections
    const [isFollowing, realFollowersCount, realFollowingCount] = await Promise.all([
      currentUser ? checkFollowStatus(userId) : Promise.resolve(false),
      getRealFollowersCount(userId),
      getRealFollowingCount(userId)
    ]);

    // Cargar posts, likes, menciones y stats en paralelo
    await Promise.all([
      loadProfilePostsForUser(userId, loadId),
      loadProfileLikedPostsForUser(userId, loadId),
      loadProfileClimbingStatsForUser(userId, loadId),
      Promise.resolve(loadProfileMentionsForUser(userId, loadId))
    ]);

    // Update stats with real counts from subcollections
    document.getElementById('stat-followers').textContent = realFollowersCount;
    document.getElementById('stat-following').textContent = realFollowingCount;

    // Check if still valid after parallel loads
    if (profileLoadingState.currentLoadId !== loadId) {
      return;
    }

    // Update follow button state
    if (isFollowing) {
      followBtn.classList.add('following');
      followBtn.classList.remove('profile-btn-primary');
      followBtn.textContent = 'Siguiendo';
    } else {
      followBtn.classList.remove('following');
      followBtn.classList.add('profile-btn-primary');
      followBtn.textContent = 'Seguir';
    }

    // Follow button click handler (with closure to capture correct userId)
    followBtn.onclick = async function () {
      const targetUserId = this.dataset.userId;
      await window.toggleFollow(targetUserId, followBtn);
      const nowFollowing = followBtn.classList.contains('following');
      if (nowFollowing) {
        followBtn.classList.remove('profile-btn-primary');
      } else {
        followBtn.classList.add('profile-btn-primary');
      }
      // Update follower count
      const currentCount = parseInt(document.getElementById('stat-followers').textContent) || 0;
      document.getElementById('stat-followers').textContent = nowFollowing ? currentCount + 1 : Math.max(0, currentCount - 1);
    };

    // Message button click handler (with closure)
    const messageBtn = document.getElementById('profile-message-btn');
    const cachedUserData = { displayName, photoURL: userData.photoURL || '' };
    messageBtn.onclick = async function () {
      if (window.openChatWithConversation) {
        await window.openChatWithConversation(userId, cachedUserData);
      }
    };

    // Setup social buttons (followers/following)
    setupProfileSocialButtonsForUser(userId);

    // Initialize tabs for profile navigation
    initProfileTabs();

    // Update Spotter UI for the OTHER user's profile (not own profile)
    if (window.updateSpotterUIForProfile) {
      await window.updateSpotterUIForProfile(userId, false);
    }

    profileLoadingState.isLoading = false;

  } catch (error) {
    console.error('Error loading public profile:', error);
    if (profileLoadingState.currentLoadId === loadId) {
      showToast('Error cargando perfil', 'error');
      goBackFromProfile();
    }
    profileLoadingState.isLoading = false;
  }
};

/**
 * Configure profile-view for viewing OWN profile
 */
function configureProfileViewForOwnProfile() {
  // Hide back header
  const backHeader = document.getElementById('profile-back-header');
  if (backHeader) backHeader.classList.add('hidden');

  // Show settings button
  const settingsBtn = document.getElementById('profile-settings-btn');
  if (settingsBtn) settingsBtn.style.display = 'flex';

  // Show own profile actions (Edit/Share)
  const ownActions = document.getElementById('own-profile-actions');
  if (ownActions) ownActions.classList.remove('hidden');

  // Hide other profile actions (Follow/Message)
  const otherActions = document.getElementById('other-profile-actions');
  if (otherActions) otherActions.classList.add('hidden');

  // Update tab labels
  const postsLabel = document.getElementById('profile-tab-posts-label');
  if (postsLabel) postsLabel.textContent = 'Mis Publicaciones';

  currentProfileUserId = null;

  // Update Spotter UI for OWN profile (will show badge/button based on own status)
  if (window.updateSpotterUIForProfile && currentUser) {
    window.updateSpotterUIForProfile(currentUser.uid, true);
  }
}

/**
 * Configure profile-view for viewing OTHER user's profile
 */
function configureProfileViewForOtherProfile() {
  // Show back header
  const backHeader = document.getElementById('profile-back-header');
  if (backHeader) backHeader.classList.remove('hidden');

  // Hide settings button
  const settingsBtn = document.getElementById('profile-settings-btn');
  if (settingsBtn) settingsBtn.style.display = 'none';

  // Hide own profile actions (Edit/Share)
  const ownActions = document.getElementById('own-profile-actions');
  if (ownActions) ownActions.classList.add('hidden');

  // Show other profile actions (Follow/Message)
  const otherActions = document.getElementById('other-profile-actions');
  if (otherActions) otherActions.classList.remove('hidden');

  // Update tab labels
  const postsLabel = document.getElementById('profile-tab-posts-label');
  if (postsLabel) postsLabel.textContent = 'Publicaciones';

  // Reset spotter elements synchronously to avoid flash of stale state
  const spotterBadge = document.getElementById('spotter-badge');
  if (spotterBadge) spotterBadge.classList.add('hidden');
  const spotterPoints = document.getElementById('spotter-points');
  if (spotterPoints) spotterPoints.classList.add('hidden');
  const becomeSpotterBtn = document.getElementById('become-spotter-btn');
  if (becomeSpotterBtn) becomeSpotterBtn.classList.add('hidden');
}

/**
 * Go back from profile to previous view
 */
function goBackFromProfile() {
  // Cancel any pending loads
  profileLoadingState.currentLoadId = null;
  profileLoadingState.isLoading = false;
  currentProfileUserId = null;
  switchView(previousViewBeforeProfile);
}

/**
 * Initialize the back button for profile view
 */
function initProfileBackButton() {
  const backBtn = document.getElementById('profile-back-btn');
  if (backBtn) {
    backBtn.addEventListener('click', goBackFromProfile);
  }
}

/**
 * Load and render posts for a specific user in profile-view
 * FIX #2 & #3: Accepts loadId to prevent stale data rendering
 * @param {string} userId - User ID to load posts for
 * @param {string} loadId - Optional load ID to validate request is still current
 */
async function loadProfilePostsForUser(userId, loadId = null) {
  console.log('[DEBUG loadProfilePostsForUser] userId recibido:', userId);
  console.log('[DEBUG loadProfilePostsForUser] currentProfileUserId:', currentProfileUserId);
  console.log('[DEBUG loadProfilePostsForUser] loadId:', loadId);

  const container = document.getElementById('profile-grid');
  if (!container) return;

  // Don't show loading if already has loading spinner (set by resetProfileState)
  if (!container.innerHTML.includes('loading-spinner')) {
    container.innerHTML = '<div class="loading-spinner">Cargando publicaciones...</div>';
  }

  try {
    const posts = await loadUserPosts(userId);

    // FIX #3: Check if this request is still valid before rendering
    if (loadId && profileLoadingState.currentLoadId !== loadId) {
      console.log('Posts load cancelled - stale request');
      return;
    }

    if (posts.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-message" style="text-align: center; padding: 40px 20px;"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin: 0 auto 16px; opacity: 0.5;"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg><p style="margin: 0; color: #6b7280;">No hay publicaciones aún</p></div>
        </div>
      `;
      profileLoadingState.postsLoaded = true;
      return;
    }

    if (currentUser) {
      try {
        const userDoc = await Promise.race([
          db.collection('users').doc(currentUser.uid).get(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000))
        ]);

        // Check again after async operation
        if (loadId && profileLoadingState.currentLoadId !== loadId) {
          return;
        }

        const userData = userDoc.exists ? userDoc.data() : {};
        const savedPosts = new Set(userData.savedPosts || []);

        posts.forEach(post => {
          const likesArray = post.likes || [];
          post.liked = Array.isArray(likesArray) && likesArray.includes(currentUser.uid);
          post.likesCount = Array.isArray(likesArray) ? likesArray.length : (typeof likesArray === 'number' ? likesArray : 0);
          post.bookmarked = savedPosts.has(post.id);
        });
      } catch (error) {
        console.error('Error loading user interactions:', error);
        // Continue without user interaction data - just set defaults
        posts.forEach(post => {
          const likesArray = post.likes || [];
          post.liked = false;
          post.likesCount = Array.isArray(likesArray) ? likesArray.length : 0;
          post.bookmarked = false;
        });
      }
    }

    // Final check before DOM manipulation
    if (loadId && profileLoadingState.currentLoadId !== loadId) {
      return;
    }

    // FIX #2: Clear container completely before rendering new posts
    container.innerHTML = '';
    posts.forEach(post => {
      renderPostCard(post, container);
    });

    attachFeedEventListeners(container);
    profileLoadingState.postsLoaded = true;

  } catch (error) {
    console.error('Error loading profile posts:', error);
    if (!loadId || profileLoadingState.currentLoadId === loadId) {
      container.innerHTML = '<p class="error-message">Error cargando publicaciones</p>';
    }
  }
}

/**
 * Load and render liked posts for a specific user in profile-view
 * FIX #2 & #3: Accepts loadId to prevent stale data rendering
 * @param {string} userId - User ID to load likes for
 * @param {string} loadId - Optional load ID to validate request is still current
 */
async function loadProfileLikedPostsForUser(userId, loadId = null) {
  const container = document.getElementById('profile-liked-grid');
  if (!container) return;

  // Don't show loading if already has loading spinner
  if (!container.innerHTML.includes('loading-spinner')) {
    container.innerHTML = '<div class="loading-spinner">Cargando me gusta...</div>';
  }

  try {
    const allPostsSnapshot = await Promise.race([
      db.collection('posts')
        .orderBy('createdAt', 'desc')
        .limit(100)
        .get(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 8000))
    ]);

    // FIX #3: Check if this request is still valid
    if (loadId && profileLoadingState.currentLoadId !== loadId) {
      console.log('Likes load cancelled - stale request');
      return;
    }

    const likedPosts = [];
    allPostsSnapshot.forEach(doc => {
      const data = doc.data();
      const likesArray = data.likes || [];

      if (Array.isArray(likesArray) && likesArray.includes(userId)) {
        likedPosts.push({
          id: doc.id,
          ...data,
          liked: currentUser ? likesArray.includes(currentUser.uid) : false,
          likesCount: likesArray.length
        });
      }
    });

    // Check again before rendering
    if (loadId && profileLoadingState.currentLoadId !== loadId) {
      return;
    }

    if (likedPosts.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-message" style="text-align: center; padding: 40px 20px;"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin: 0 auto 16px; opacity: 0.5;"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg><p style="margin: 0; color: #6b7280;">No hay me gusta aún</p></div>
        </div>
      `;
      profileLoadingState.likesLoaded = true;
      return;
    }

    // FIX #2: Clear container completely before rendering
    container.innerHTML = '';
    likedPosts.forEach(post => {
      renderPostCard(post, container);
    });

    attachFeedEventListeners(container);
    profileLoadingState.likesLoaded = true;

  } catch (error) {
    console.error('Error loading profile likes:', error);
    if (!loadId || profileLoadingState.currentLoadId === loadId) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">x</div>
          <div class="empty-state-text">Error al cargar. Verifica tu conexión.</div>
        </div>
      `;
    }
  }
}

// ================== MENTIONS TAB ==================

/**
 * Render posts that mention the current profile user.
 * Queries Firestore for posts where the user's UID is in mentionedUserIds array.
 */
async function renderMentionsPosts() {
  // Use firebase.auth().currentUser to ensure we have the most up-to-date user
  const authUser = firebase.auth().currentUser;

  const grid = document.getElementById('profile-mentions-grid');
  if (!grid) return;

  grid.innerHTML = '<div class="empty-message" style="text-align: center; padding: 20px;">Cargando menciones...</div>';

  if (!authUser || !authUser.uid) {
    grid.innerHTML = '<div class="empty-message" style="text-align: center; padding: 40px 20px;"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin: 0 auto 16px; opacity: 0.5;"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg><p style="margin: 0; color: #6b7280;">No se pudo determinar el usuario</p></div>';
    return;
  }

  // Use loadProfileMentionsForUser for consistency - it handles the query the same way
  // but uses the userId parameter directly instead of relying on global currentUser
  await loadProfileMentionsForUser(authUser.uid, null);
}

/**
 * Load mentions for another user's profile.
 * Queries Firestore for posts where the user's UID is in mentionedUserIds array.
 */
async function loadProfileMentionsForUser(userId, loadId = null) {
  const container = document.getElementById('profile-mentions-grid');
  if (!container) return;

  if (loadId && profileLoadingState.currentLoadId !== loadId) return;

  if (!userId) {
    container.innerHTML = '<div class="empty-message" style="text-align: center; padding: 40px 20px;"><p style="margin: 0; color: #6b7280;">No hay menciones</p></div>';
    return;
  }

  container.innerHTML = '<div class="empty-message" style="text-align: center; padding: 20px;">Cargando menciones...</div>';

  try {
    // Query posts where user is mentioned using mentionedUserIds array
    const mentionsSnapshot = await db.collection('posts')
      .where('mentionedUserIds', 'array-contains', userId)
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get();

    // Check if this request is still valid
    if (loadId && profileLoadingState.currentLoadId !== loadId) return;

    const mentionedPosts = [];
    mentionsSnapshot.forEach(doc => {
      const data = doc.data();
      mentionedPosts.push({
        id: doc.id,
        ...data,
        likesCount: Array.isArray(data.likes) ? data.likes.length : (data.likesCount || 0),
        commentsCount: data.commentsCount || 0
      });
    });

    // Final check before DOM update
    if (loadId && profileLoadingState.currentLoadId !== loadId) return;

    if (mentionedPosts.length === 0) {
      container.innerHTML = `
        <div class="empty-message" style="text-align: center; padding: 40px 20px;">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin: 0 auto 16px; opacity: 0.5;">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
          </svg>
          <p style="margin: 0; color: #6b7280;">No hay menciones aún</p>
        </div>
      `;
      return;
    }

    container.innerHTML = '';
    mentionedPosts.forEach(post => {
      renderPostCard(post, container);
    });

    attachFeedEventListeners(container);
  } catch (error) {
    console.error('Error loading mentions for user:', error);

    if (loadId && profileLoadingState.currentLoadId !== loadId) return;

    container.innerHTML = `
      <div class="empty-message" style="text-align: center; padding: 40px 20px;">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin: 0 auto 16px; opacity: 0.5;">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
        </svg>
        <p style="margin: 0; color: #6b7280;">Error al cargar menciones</p>
      </div>
    `;
  }
}

/**
 * Load climbing statistics for a specific user
 * FIX #3: Accepts loadId to prevent stale data rendering
 * @param {string} userId - User ID to load stats for
 * @param {string} loadId - Optional load ID to validate request is still current
 */
async function loadProfileClimbingStatsForUser(userId, loadId = null) {
  try {
    const ascentsSnapshot = await db.collection('ascents')
      .where('userId', '==', userId)
      .get();

    // FIX #3: Check if this request is still valid before updating DOM
    if (loadId && profileLoadingState.currentLoadId !== loadId) {
      console.log('Stats load cancelled - stale request');
      return;
    }

    let totalAscents = ascentsSnapshot.size;
    let maxGrade = '-';
    const zones = new Set();
    const grades = [];

    ascentsSnapshot.forEach(doc => {
      const data = doc.data();
      if (data.schoolId) zones.add(data.schoolId);
      if (data.grade && data.grade.trim() !== '') {
        grades.push(data.grade);
      }
    });

    if (grades.length > 0) {
      const compareFunc = typeof compareGradesLocal === 'function' ? compareGradesLocal : (a, b) => a.localeCompare(b);
      maxGrade = grades.sort(compareFunc).reverse()[0];
    }

    // Final check before DOM update
    if (loadId && profileLoadingState.currentLoadId !== loadId) {
      return;
    }

    const totalAscentsEl = document.getElementById('total-ascents');
    const maxGradeEl = document.getElementById('max-grade');
    const zonesVisitedEl = document.getElementById('zones-visited');

    if (totalAscentsEl) totalAscentsEl.textContent = totalAscents;
    if (maxGradeEl) maxGradeEl.textContent = maxGrade;
    if (zonesVisitedEl) zonesVisitedEl.textContent = zones.size;

    profileLoadingState.statsLoaded = true;

  } catch (error) {
    console.error('Error loading climbing stats:', error);
    // Set default values even on error to prevent undefined display
    const totalAscentsEl = document.getElementById('total-ascents');
    const maxGradeEl = document.getElementById('max-grade');
    const zonesVisitedEl = document.getElementById('zones-visited');

    if (totalAscentsEl) totalAscentsEl.textContent = '0';
    if (maxGradeEl) maxGradeEl.textContent = '-';
    if (zonesVisitedEl) zonesVisitedEl.textContent = '0';
  }
}

/**
 * Check if current user is following a specific user
 * @param {string} userId - The user ID to check
 * @returns {Promise<boolean>} - True if following, false otherwise
 */
async function checkFollowStatus(userId) {
  const authUser = firebase.auth().currentUser;
  if (!authUser || !userId) return false;

  try {
    const followingDoc = await db.collection('users')
      .doc(authUser.uid)
      .collection('following')
      .doc(userId)
      .get();

    return followingDoc.exists;
  } catch (error) {
    console.error('Error checking follow status:', error);
    return false;
  }
}

/**
 * Get the REAL count of followers (only counting users that actually exist)
 * This fixes the bug where deleted/orphaned users inflate the counter
 * Optimized version with batching to avoid Firestore errors
 */
async function getRealFollowersCount(userId) {
  if (!userId) return 0;

  try {
    const snapshot = await db.collection('users')
      .doc(userId)
      .collection('followers')
      .get();

    if (snapshot.empty) return 0;

    // Get all follower IDs
    const followerIds = snapshot.docs.map(doc => doc.id);

    // Process in batches of 10 to avoid overwhelming Firestore
    const batchSize = 10;
    let existingCount = 0;

    for (let i = 0; i < followerIds.length; i += batchSize) {
      const batch = followerIds.slice(i, i + batchSize);
      const promises = batch.map(uid =>
        db.collection('users').doc(uid).get()
          .then(doc => doc.exists ? 1 : 0)
          .catch(() => 0)
      );
      const results = await Promise.all(promises);
      existingCount += results.reduce((sum, val) => sum + val, 0);
    }

    return existingCount;
  } catch (error) {
    console.error('Error getting real followers count:', error);
    // Fallback: return the count from stats if available
    try {
      const userDoc = await db.collection('users').doc(userId).get();
      return userDoc.data()?.stats?.followersCount || 0;
    } catch (e) {
      return 0;
    }
  }
}

/**
 * Get the REAL count of following (only counting users that actually exist)
 * This fixes the bug where deleted/orphaned users inflate the counter
 * Optimized version with batching to avoid Firestore errors
 */
async function getRealFollowingCount(userId) {
  if (!userId) return 0;

  try {
    const snapshot = await db.collection('users')
      .doc(userId)
      .collection('following')
      .get();

    if (snapshot.empty) return 0;

    // Get all following IDs
    const followingIds = snapshot.docs.map(doc => doc.id);

    // Process in batches of 10 to avoid overwhelming Firestore
    const batchSize = 10;
    let existingCount = 0;

    for (let i = 0; i < followingIds.length; i += batchSize) {
      const batch = followingIds.slice(i, i + batchSize);
      const promises = batch.map(uid =>
        db.collection('users').doc(uid).get()
          .then(doc => doc.exists ? 1 : 0)
          .catch(() => 0)
      );
      const results = await Promise.all(promises);
      existingCount += results.reduce((sum, val) => sum + val, 0);
    }

    return existingCount;
  } catch (error) {
    console.error('Error getting real following count:', error);
    // Fallback: return the count from stats if available
    try {
      const userDoc = await db.collection('users').doc(userId).get();
      return userDoc.data()?.stats?.followingCount || 0;
    } catch (e) {
      return 0;
    }
  }
}

/**
 * Setup social buttons (followers/following) for a specific user
 * Works for both own profile (currentUser) and public profiles
 */
function setupProfileSocialButtonsForUser(userId) {
  if (!userId) {
    console.error('setupProfileSocialButtonsForUser: userId is required');
    return;
  }

  const followersBtn = document.querySelector('[data-modal="followers"]');
  const followingBtn = document.querySelector('[data-modal="following"]');

  if (!followersBtn || !followingBtn) {
    console.warn('Social buttons not found in DOM');
    return;
  }

  // Store userId in data attribute for debugging and reference
  followersBtn.setAttribute('data-user-id', userId);
  followingBtn.setAttribute('data-user-id', userId);

  // Remove all existing listeners by cloning
  const newFollowersBtn = followersBtn.cloneNode(true);
  followersBtn.parentNode.replaceChild(newFollowersBtn, followersBtn);

  // Re-set the data attribute after cloning
  newFollowersBtn.setAttribute('data-user-id', userId);
  newFollowersBtn.onclick = function () {
    const targetUserId = this.getAttribute('data-user-id') || userId;
    console.log('Opening followers for user:', targetUserId);
    openSocialListForUser(targetUserId, 'followers');
  };

  const newFollowingBtn = followingBtn.cloneNode(true);
  followingBtn.parentNode.replaceChild(newFollowingBtn, followingBtn);

  // Re-set the data attribute after cloning
  newFollowingBtn.setAttribute('data-user-id', userId);
  newFollowingBtn.onclick = function () {
    const targetUserId = this.getAttribute('data-user-id') || userId;
    console.log('Opening following for user:', targetUserId);
    openSocialListForUser(targetUserId, 'following');
  };
}

/**
 * Open social list modal for a specific user
 * Optimized with batching to avoid Firestore errors
 */
async function openSocialListForUser(userId, type) {
  console.log('openSocialListForUser called:', { userId, type });

  if (!userId) {
    console.error('openSocialListForUser: userId is required');
    return;
  }

  const modal = document.getElementById('social-list-modal');
  const container = document.getElementById('social-list-container');
  const title = document.getElementById('social-list-title');

  if (!modal || !container) {
    console.error('Modal or container not found');
    return;
  }

  title.textContent = type === 'followers' ? 'Seguidores' : 'Siguiendo';
  container.innerHTML = '<div class="loading-spinner" style="padding: 40px; text-align: center;">Cargando...</div>';
  modal.classList.remove('hidden');

  try {
    const subCollection = type === 'followers' ? 'followers' : 'following';
    console.log(`Fetching ${subCollection} for user:`, userId);

    const snapshot = await db.collection('users')
      .doc(userId)
      .collection(subCollection)
      .get();

    console.log(`Found ${snapshot.size} ${subCollection}`);

    if (snapshot.empty) {
      const emptyText = type === 'followers' ? 'No hay seguidores aún' : 'No sigue a nadie aún';
      container.innerHTML = `
        <div class="social-list-empty">
          <div class="social-list-empty-icon">${type === 'followers' ? '💥' : 'x'}</div>
          <p>${emptyText}</p>
        </div>
      `;
      return;
    }

    const userIds = snapshot.docs.map(doc => doc.id);

    // Process in batches to avoid overwhelming Firestore
    const batchSize = 10;
    const usersData = [];

    for (let i = 0; i < userIds.length; i += batchSize) {
      const batch = userIds.slice(i, i + batchSize);
      const promises = batch.map(async (uid) => {
        try {
          const userDoc = await db.collection('users').doc(uid).get();
          if (userDoc.exists) {
            return { id: uid, ...userDoc.data() };
          }
          return null;
        } catch (e) {
          console.error('Error fetching user:', uid, e);
          return null;
        }
      });
      const results = await Promise.all(promises);
      usersData.push(...results.filter(u => u !== null));
    }

    if (usersData.length === 0) {
      container.innerHTML = `
        <div class="social-list-empty">
          <div class="social-list-empty-icon">😅</div>
          <p>No se pudieron cargar los usuarios</p>
        </div>
      `;
      return;
    }

    // Render users with follow buttons
    // Use firebase.auth().currentUser instead of global currentUser variable
    const authUser = firebase.auth().currentUser;
    let html = '';

    for (const user of usersData) {
      const isMe = authUser && user.id === authUser.uid;
      let isFollowing = false;

      if (!isMe && authUser) {
        isFollowing = await checkFollowStatus(user.id);
      }

      const btnClass = isFollowing ? 'social-list-btn following' : 'social-list-btn follow';
      const btnText = isFollowing ? 'Siguiendo' : 'Seguir';

      html += `
        <div class="social-list-item">
          <img src="${user.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.displayName || 'U')}&background=DCE9DF&color=153E35&size=50`}"
               class="social-list-avatar"
               onclick="document.getElementById('social-list-modal').classList.add('hidden'); openPublicProfile('${user.id}')"
               style="cursor: pointer;">
          <div class="social-list-info" onclick="document.getElementById('social-list-modal').classList.add('hidden'); openPublicProfile('${user.id}')" style="cursor: pointer;">
            <div class="social-list-name">${user.displayName || 'Usuario'}</div>
            <div class="social-list-bio">${user.id === 'akqgKt9WmQRNrpPub9xVKiPKmcn2' ? 'Administrador' : (user.bio || 'Escalador')}</div>
          </div>
          ${!isMe && authUser ? `
            <button class="${btnClass}"
                    onclick="event.stopPropagation(); toggleFollow('${user.id}', this);
                             this.classList.toggle('following');
                             this.classList.toggle('follow');
                             this.textContent = this.classList.contains('following') ? 'Siguiendo' : 'Seguir';">
              ${btnText}
            </button>
          ` : ''}
        </div>
      `;
    }

    container.innerHTML = html;

  } catch (error) {
    console.error('Error loading social list:', error);
    container.innerHTML = `
      <div class="social-list-empty">
        <div class="social-list-empty-icon">x</div>
        <p>Error cargando lista</p>
      </div>
    `;
  }
}

/**
 * Load and render posts for public profile "Publicaciones" tab
 */
async function loadPublicProfilePosts(userId) {
  const container = document.getElementById('pp-ascents-list');
  if (!container) return;

  container.innerHTML = '<div class="loading-spinner">Cargando publicaciones...</div>';

  try {
    // Load posts using the same function as own profile
    const posts = await loadUserPosts(userId);

    if (posts.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-message" style="text-align: center; padding: 40px 20px;"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin: 0 auto 16px; opacity: 0.5;"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg><p style="margin: 0; color: #6b7280;">No hay publicaciones aún</p></div>
        </div>
      `;
      return;
    }

    // Load current user's likes and bookmarks if logged in
    if (currentUser) {
      try {
        const userDoc = await db.collection('users').doc(currentUser.uid).get();
        const userData = userDoc.exists ? userDoc.data() : {};
        const savedPosts = new Set(userData.savedPosts || []);

        posts.forEach(post => {
          const likesArray = post.likes || [];
          post.liked = Array.isArray(likesArray) && likesArray.includes(currentUser.uid);
          post.likesCount = Array.isArray(likesArray) ? likesArray.length : (typeof likesArray === 'number' ? likesArray : 0);
          post.bookmarked = savedPosts.has(post.id);
        });
      } catch (error) {
        console.error('Error loading user interactions:', error);
      }
    }

    // Clear container and render posts using the same component as feed
    container.innerHTML = '';
    posts.forEach(post => {
      renderPostCard(post, container);
    });

    // Attach event listeners for post interactions
    attachFeedEventListeners(container);

  } catch (error) {
    console.error('Error loading public profile posts:', error);
    container.innerHTML = '<p class="error-message">Error cargando publicaciones</p>';
  }
}

/**
 * Load and render posts that the user has liked for "Me gusta" tab
 */
async function loadPublicProfileLikes(userId) {
  const container = document.getElementById('pp-posts-grid');
  if (!container) return;

  container.innerHTML = '<div class="loading-spinner">Cargando me gusta...</div>';

  try {
    // Get all posts where the user has liked (similar to renderLikedPosts)
    const allPostsSnapshot = await db.collection('posts')
      .orderBy('createdAt', 'desc')
      .limit(100)
      .get();

    const likedPosts = [];
    allPostsSnapshot.forEach(doc => {
      const data = doc.data();
      const likesArray = data.likes || [];

      // Check if the visited user liked this post
      if (Array.isArray(likesArray) && likesArray.includes(userId)) {
        likedPosts.push({
          id: doc.id,
          ...data,
          photos: data.photos || (data.photo ? [data.photo] : []),
          time: data.createdAt ? formatTimeAgo(data.createdAt.toDate()) : 'Ahora',
          liked: currentUser && likesArray.includes(currentUser.uid),
          likesCount: likesArray.length
        });
      }
    });

    // Sort by creation date (most recent first)
    likedPosts.sort((a, b) => {
      const aTime = a.createdAt?.toDate?.() || new Date(0);
      const bTime = b.createdAt?.toDate?.() || new Date(0);
      return bTime - aTime;
    });

    if (likedPosts.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">???</div>
          <div class="empty-state-text">No ha dado me gusta a nada aún</div>
        </div>
      `;
      return;
    }

    // Load current user's bookmarks if logged in
    if (currentUser) {
      try {
        const userDoc = await db.collection('users').doc(currentUser.uid).get();
        const userData = userDoc.exists ? userDoc.data() : {};
        const savedPosts = new Set(userData.savedPosts || []);

        likedPosts.forEach(post => {
          post.bookmarked = savedPosts.has(post.id);
        });
      } catch (error) {
        console.error('Error loading user bookmarks:', error);
      }
    }

    // Clear container and render posts
    container.innerHTML = '';
    likedPosts.forEach(post => {
      renderPostCard(post, container);
    });

    // Attach event listeners for post interactions
    attachFeedEventListeners(container);

  } catch (error) {
    console.error('Error loading public profile likes:', error);

    // Fallback without orderBy
    try {
      const allPostsSnapshot = await db.collection('posts')
        .limit(100)
        .get();

      const likedPosts = [];
      allPostsSnapshot.forEach(doc => {
        const data = doc.data();
        const likesArray = data.likes || [];

        if (Array.isArray(likesArray) && likesArray.includes(userId)) {
          likedPosts.push({
            id: doc.id,
            ...data,
            photos: data.photos || (data.photo ? [data.photo] : []),
            time: data.createdAt ? formatTimeAgo(data.createdAt.toDate()) : 'Ahora',
            liked: currentUser && likesArray.includes(currentUser.uid),
            likesCount: likesArray.length
          });
        }
      });

      likedPosts.sort((a, b) => {
        const aTime = a.createdAt?.toDate?.() || new Date(0);
        const bTime = b.createdAt?.toDate?.() || new Date(0);
        return bTime - aTime;
      });

      if (likedPosts.length === 0) {
        container.innerHTML = `
          <div class="empty-state">
            <div class="empty-state-icon">x</div>
            <div class="empty-state-text">No ha dado me gusta a nada aún</div>
        </div>
      `;
        return;
      }

      // Load current user's bookmarks
      if (currentUser) {
        try {
          const userDoc = await db.collection('users').doc(currentUser.uid).get();
          const userData = userDoc.exists ? userDoc.data() : {};
          const savedPosts = new Set(userData.savedPosts || []);
          likedPosts.forEach(post => {
            post.bookmarked = savedPosts.has(post.id);
          });
        } catch (error) {
          console.error('Error loading user bookmarks:', error);
        }
      }

      container.innerHTML = '';
      likedPosts.forEach(post => {
        renderPostCard(post, container);
      });

      attachFeedEventListeners(container);

    } catch (fallbackError) {
      console.error('Fallback also failed:', fallbackError);
      container.innerHTML = '<p class="error-message">Error cargando me gusta</p>';
    }
  }
}

async function loadPublicProfileClimbingStats(userId) {
  try {
    // Get ascents using the helper function from user-features.js
    // The function is exposed globally via window object
    const getUserAscents = window.getUserAscentsByUserId;
    const renderStats = window.renderPublicProfileClimbingStats;

    if (typeof getUserAscents === 'function') {
      const ascents = await getUserAscents(userId, 100);
      if (typeof renderStats === 'function') {
        renderStats(ascents);
      } else {
        console.warn('renderPublicProfileClimbingStats function not found');
      }
    } else {
      console.warn('getUserAscentsByUserId function not found');
    }
  } catch (error) {
    console.error('Error loading public profile climbing stats:', error);
  }
}

function setupPublicProfileTabs(userId) {
  const tabs = document.querySelectorAll('.pp-tab');

  tabs.forEach(tab => {
    tab.onclick = async function () {
      // Update active tab
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      // Show corresponding content
      const targetId = tab.dataset.tab;
      document.querySelectorAll('.pp-tab-content').forEach(content => {
        content.classList.remove('active');
      });
      document.getElementById(targetId)?.classList.add('active');

      // Load content based on active tab
      if (targetId === 'pp-ascents-tab' && userId) {
        // "Publicaciones" tab - load posts
        await loadPublicProfilePosts(userId);
      } else if (targetId === 'pp-posts-tab' && userId) {
        // "Me gusta" tab - load liked posts
        await loadPublicProfileLikes(userId);
      }
    };
  });
}

function initMessages() {
  const btn = document.getElementById('messages-btn');
  const dropdown = document.getElementById('messages-dropdown');
  const list = document.getElementById('messages-list');
  const badge = document.getElementById('messages-badge');
  const notificationDropdown = document.getElementById('notification-dropdown');
  const searchInput = document.getElementById('messages-search');

  if (!btn || !dropdown || !list) return;

  let conversations = [];
  let unsubscribeConversations = null;

  // Update badge with unread count
  function updateBadge() {
    const currentUser = firebase.auth().currentUser;
    if (!currentUser) {
      badge.classList.add('hidden');
      return;
    }

    const unreadCount = conversations.reduce((total, conv) => {
      return total + (conv.unreadCount?.[currentUser.uid] || 0);
    }, 0);

    if (unreadCount > 0) {
      badge.textContent = unreadCount > 99 ? '99+' : unreadCount;
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
    btn.setAttribute('aria-label', unreadCount > 0 ? `Mensajes, ${unreadCount} sin leer` : 'Mensajes');
  }

  // Format time for display
  function formatTime(timestamp) {
    if (!timestamp) return '';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    const now = new Date();
    const diff = now - date;

    if (diff < 60000) return 'Ahora';
    if (diff < 3600000) return `Hace ${Math.floor(diff / 60000)} min`;
    if (diff < 86400000) return `Hace ${Math.floor(diff / 3600000)} h`;
    if (diff < 604800000) return `Hace ${Math.floor(diff / 86400000)} d`;
    return date.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
  }

  // Render conversations list
  function renderConversations() {
    const currentUser = firebase.auth().currentUser;

    if (!currentUser || conversations.length === 0) {
      list.innerHTML = `
        <div class="messages-empty">
          <div class="messages-empty-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg></div>
          <div class="messages-empty-text">No tienes conversaciones</div>
          <div class="messages-empty-hint">Visita el perfil de un usuario para enviarle un mensaje</div>
        </div>
      `;
      return;
    }

    // Buscador del panel: filtra en el cliente las conversaciones ya cargadas por el listener
    const query = (searchInput?.value || '').trim().toLowerCase();
    const visible = conversations.filter(conv => {
      if (!query) return true;
      const other = window.MessagingService?.getOtherParticipant(conv);
      return (other?.displayName || '').toLowerCase().includes(query)
        || (conv.lastMessage || '').toLowerCase().includes(query);
    });

    if (visible.length === 0) {
      list.innerHTML = `
        <div class="messages-empty">
          <div class="messages-empty-text">Sin resultados</div>
          <div class="messages-empty-hint">No hay conversaciones que coincidan con «${escapeHtmlMention(query)}»</div>
        </div>
      `;
      return;
    }

    list.innerHTML = visible.map(conv => {
      const other = window.MessagingService?.getOtherParticipant(conv);
      if (!other) return '';

      const unreadCount = conv.unreadCount?.[currentUser.uid] || 0;
      const isUnread = unreadCount > 0;
      // Nombre y último mensaje vienen de otros usuarios: se escapan antes de insertarlos
      const name = escapeHtmlMention(other.displayName || 'Usuario');
      const preview = escapeHtmlMention(conv.lastMessage || 'Sin mensajes');
      const time = formatTime(conv.lastMessageTime || conv.updatedAt);
      const avatar = other.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(other.displayName)}&background=153E35&color=fff`;

      return `
        <div class="message-item ${isUnread ? 'unread' : ''}" role="button" tabindex="0" aria-label="Conversación con ${name}${isUnread ? `, ${unreadCount} sin leer` : ''}" data-conversation-id="${conv.id}" data-recipient-id="${other.id}" data-recipient-name="${name}" data-recipient-photo="${avatar}">
          <img src="${avatar}" class="message-avatar" alt="" referrerPolicy="no-referrer" onerror="this.src='${generateAvatarFallback(other.displayName, 44)}'; this.onerror=null;">
          <div class="message-content">
            <div class="message-row">
              <span class="message-sender">${name}</span>
              <span class="message-time">${time}</span>
            </div>
            <div class="message-row">
              <span class="message-preview">${preview}</span>
              ${isUnread ? `<span class="message-unread-count">${unreadCount > 99 ? '99+' : unreadCount}</span>` : ''}
            </div>
          </div>
          <button class="message-delete-btn" data-conv-id="${conv.id}" type="button" title="Eliminar conversación" aria-label="Eliminar conversación con ${name}">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
            </svg>
          </button>
        </div>
      `;
    }).join('');

    // Delete button handler
    list.querySelectorAll('.message-delete-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation(); // Prevent opening the chat
        const convId = btn.dataset.convId;
        const confirmed = await showConfirm('¿Eliminar esta conversación? Esta acción no se puede deshacer.', 'Eliminar conversación');
        if (confirmed) {
          if (window.MessagingService) {
            await window.MessagingService.deleteConversation(convId);
          }
        }
      });
    });

    // Click handler to open chat
    list.querySelectorAll('.message-item').forEach(item => {
      item.addEventListener('click', (e) => {
        // Don't open chat if clicking the delete button
        if (e.target.closest('.message-delete-btn')) return;

        const conversationId = item.dataset.conversationId;
        const recipientId = item.dataset.recipientId;
        const recipientName = item.dataset.recipientName;
        const recipientPhoto = item.dataset.recipientPhoto;

        dropdown.classList.add('hidden');

        // Mark as read
        if (window.MessagingService) {
          window.MessagingService.markAsRead(conversationId);
        }

        // Open chat
        if (window.openChatWithUser) {
          window.openChatWithUser({
            id: conversationId,
            recipientId: recipientId,
            sender: recipientName,
            avatar: recipientPhoto,
            isRealConversation: true
          });
        }
      });
      // Teclado: Intro o espacio abren la conversación
      item.addEventListener('keydown', (e) => {
        if ((e.key === 'Enter' || e.key === ' ') && e.target === item) {
          e.preventDefault();
          item.click();
        }
      });
    });
  }

  // Setup real-time listener for conversations
  function setupConversationsListener() {
    const currentUser = firebase.auth().currentUser;
    if (!currentUser) return;

    if (unsubscribeConversations) {
      unsubscribeConversations();
    }

    if (window.MessagingService) {
      unsubscribeConversations = window.MessagingService.subscribeToConversations((convs) => {
        conversations = convs;
        updateBadge();
        if (!dropdown.classList.contains('hidden')) {
          renderConversations();
        }
      });
    }
  }

  // Auth state listener
  firebase.auth().onAuthStateChanged(user => {
    if (user) {
      setupConversationsListener();
    } else {
      if (unsubscribeConversations) {
        unsubscribeConversations();
        unsubscribeConversations = null;
      }
      conversations = [];
      updateBadge();
    }
  });

  // Toggle dropdown
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isHidden = dropdown.classList.contains('hidden');

    // Close notifications if open
    if (notificationDropdown) notificationDropdown.classList.add('hidden');
    document.getElementById('search-sheet')?.classList.add('hidden');

    if (isHidden) {
      if (searchInput) searchInput.value = '';
      dropdown.classList.remove('hidden');
      renderConversations();
    } else {
      dropdown.classList.add('hidden');
    }
  });

  searchInput?.addEventListener('input', () => renderConversations());

  // Close on outside click (la confirmación de borrar una conversación no cuenta como "fuera")
  document.addEventListener('click', (e) => {
    if (e.target.closest('#confirm-modal')) return;
    if (!dropdown.contains(e.target) && !btn.contains(e.target)) {
      dropdown.classList.add('hidden');
    }
  });

  // ---- CHAT MODAL LOGIC ----
  // Conversación a pantalla completa (móvil) o tarjeta (escritorio). Reutiliza MessagingService:
  // un único listener por conversación, que se cancela al salir (también si otra vista oculta el chat).
  const chatModal = document.getElementById('chat-modal');
  const chatAvatar = document.getElementById('chat-avatar');
  const chatUsername = document.getElementById('chat-username');
  const chatMessagesContainer = document.getElementById('chat-messages');
  const chatInput = document.getElementById('chat-input');
  const chatSendBtn = document.getElementById('chat-send-btn');
  const chatCloseBtn = document.getElementById('chat-close-btn');
  const chatBackBtn = document.getElementById('chat-back-btn');
  const chatHeaderUser = document.getElementById('chat-header-user');
  const chatMenuBtn = document.getElementById('chat-menu-btn');
  const chatMenu = document.getElementById('chat-menu');
  const chatBanner = document.getElementById('chat-banner');
  const chatNewPill = document.getElementById('chat-new-pill');
  const chatOverlay = chatModal?.querySelector('.chat-modal-overlay');

  const CHAT_GROUP_MS = 5 * 60 * 1000; // mensajes del mismo autor a menos de 5 min se agrupan
  const CHAT_CLOSE_MS = 180;
  let currentChat = null;
  let unsubscribeMessages = null;
  let chatRenderedIds = null;   // ids ya pintados (para animar solo los nuevos)
  let chatOpener = null;
  let chatMarkReadTimer = null;
  let chatBannerKind = null;

  const chatReducedMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const chatIsNearBottom = () =>
    chatMessagesContainer.scrollHeight - chatMessagesContainer.scrollTop - chatMessagesContainer.clientHeight < 80;
  const chatScrollToBottom = (smooth = false) => {
    chatMessagesContainer.scrollTo({ top: chatMessagesContainer.scrollHeight, behavior: smooth && !chatReducedMotion() ? 'smooth' : 'auto' });
    chatNewPill?.classList.add('hidden');
  };

  // ---- Estado de la barra de escritura ----
  function updateChatComposer() {
    const hasText = chatInput.value.trim().length > 0;
    chatSendBtn.disabled = !hasText;
    // Altura automática (hasta 5 líneas)
    chatInput.style.height = 'auto';
    chatInput.style.height = `${Math.min(chatInput.scrollHeight, 132)}px`;
  }

  function showChatBanner(kind, text) {
    if (!chatBanner) return;
    chatBannerKind = kind;
    chatBanner.textContent = text;
    chatBanner.dataset.kind = kind;
    chatBanner.classList.remove('hidden');
  }

  function hideChatBanner(kind) {
    if (!chatBanner || (kind && chatBannerKind !== kind)) return;
    chatBannerKind = null;
    chatBanner.classList.add('hidden');
  }

  function updateChatConnection() {
    if (navigator.onLine === false) {
      showChatBanner('offline', 'Sin conexión. Los mensajes quedarán pendientes hasta que vuelvas a tener conexión.');
    } else {
      hideChatBanner('offline');
    }
  }

  // ---- Teclado virtual: el chat se ajusta al área visible (visualViewport) ----
  function syncChatViewport() {
    const vv = window.visualViewport;
    if (!vv || !chatModal) return;
    const wasAtBottom = chatIsNearBottom();
    chatModal.style.setProperty('--chat-vh', `${vv.height}px`);
    chatModal.style.setProperty('--chat-top', `${vv.offsetTop}px`);
    chatModal.classList.toggle('kb-open', vv.height < window.innerHeight * 0.85);
    if (wasAtBottom) chatScrollToBottom();
  }

  // ---- Pintado del historial ----
  function chatDate(ts) {
    if (!ts) return null;
    return ts.toDate ? ts.toDate() : new Date(ts);
  }

  function chatDayLabel(date) {
    const today = new Date();
    const startOf = d => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const diffDays = Math.round((startOf(today) - startOf(date)) / 86400000);
    if (diffDays === 0) return 'Hoy';
    if (diffDays === 1) return 'Ayer';
    const opts = diffDays < 7
      ? { weekday: 'long', day: 'numeric', month: 'long' }
      : { day: 'numeric', month: 'long', ...(date.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}) };
    const label = date.toLocaleDateString('es-ES', opts);
    return label.charAt(0).toUpperCase() + label.slice(1);
  }

  // Texto escapado, con enlaces activos y saltos de línea conservados (CSS pre-wrap)
  function chatFormatText(text) {
    return escapeHtmlMention(text || '').replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/g,
      '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
  }

  const CHAT_ICON_SENT = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>';
  const CHAT_ICON_READ = '<svg viewBox="0 0 28 24" width="19" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="17 6 7 17 3 12.5"></polyline><polyline points="25 6 14.5 17 12.5 15"></polyline></svg>';
  const CHAT_ICON_PENDING = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><polyline points="12 7 12 12 15 14"></polyline></svg>';

  function chatIntroHTML() {
    if (!currentChat) return '';
    const name = escapeHtmlMention(currentChat.sender || 'Usuario');
    return `
      <div class="chat-intro">
        <img class="chat-intro-avatar" src="${escapeHtmlMention(currentChat.avatar || '')}" alt="" referrerPolicy="no-referrer" onerror="this.src='${generateAvatarFallback(currentChat.sender || 'Usuario', 120)}'; this.onerror=null;">
        <div class="chat-intro-name">${name}</div>
        <div class="chat-intro-hint">Mensajes directos en KRUX</div>
        ${currentChat.recipientId ? '<button type="button" class="chat-intro-profile" data-chat-action="profile">Ver perfil</button>' : ''}
      </div>`;
  }

  function renderChatLoading() {
    chatMessagesContainer.innerHTML = `
      <div class="chat-state" aria-busy="true">
        <span class="chat-skeleton chat-skeleton--in"></span>
        <span class="chat-skeleton chat-skeleton--out"></span>
        <span class="chat-skeleton chat-skeleton--in short"></span>
        <span class="kx-visually-hidden">Cargando mensajes…</span>
      </div>`;
  }

  function renderChatError() {
    chatMessagesContainer.innerHTML = `
      ${chatIntroHTML()}
      <div class="chat-state chat-state--error">
        <p>No se pudieron cargar los mensajes.</p>
        <button type="button" class="kx-btn kx-btn--secondary" id="chat-retry-btn">Reintentar</button>
      </div>`;
    document.getElementById('chat-retry-btn')?.addEventListener('click', () => subscribeCurrentChat());
  }

  function renderChatMessages(messages) {
    const currentUser = firebase.auth().currentUser;
    if (!currentUser) return;

    const firstRender = chatRenderedIds === null;
    const wasNearBottom = firstRender || chatIsNearBottom();
    const previousIds = chatRenderedIds || new Set();

    if (messages.length === 0) {
      chatMessagesContainer.innerHTML = `
        ${chatIntroHTML()}
        <div class="chat-empty">
          <div class="chat-empty-text">Aún no hay mensajes</div>
          <div class="chat-empty-hint">Escribe el primero para empezar la conversación.</div>
        </div>`;
      chatRenderedIds = new Set();
      return;
    }

    let html = chatIntroHTML() + '<div class="chat-spacer" aria-hidden="true"></div>';
    let lastDayKey = '';
    messages.forEach((msg, i) => {
      const isSent = msg.senderId === currentUser.uid;
      const date = chatDate(msg.timestamp);
      const isPending = !date; // escritura local aún sin hora del servidor
      const effective = date || new Date();
      const dayKey = effective.toDateString();
      if (dayKey !== lastDayKey) {
        html += `<div class="chat-day"><span>${chatDayLabel(effective)}</span></div>`;
        lastDayKey = dayKey;
      }

      const prev = messages[i - 1];
      const next = messages[i + 1];
      const sameGroup = (a, b) => a && b && a.senderId === b.senderId
        && Math.abs((chatDate(b.timestamp) || new Date()) - (chatDate(a.timestamp) || new Date())) < CHAT_GROUP_MS
        && (chatDate(a.timestamp) || new Date()).toDateString() === (chatDate(b.timestamp) || new Date()).toDateString();
      const continuesPrev = sameGroup(prev, msg);
      const continuesNext = sameGroup(msg, next);

      const time = isPending ? '' : effective.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
      let status = '';
      if (isSent) {
        if (isPending) status = `<span class="chat-message-status pending" title="Enviando">${CHAT_ICON_PENDING}<span class="kx-visually-hidden">Enviando</span></span>`;
        else if (msg.status === 'read') status = `<span class="chat-message-status read" title="Leído">${CHAT_ICON_READ}<span class="kx-visually-hidden">Leído</span></span>`;
        else status = `<span class="chat-message-status sent" title="Enviado">${CHAT_ICON_SENT}<span class="kx-visually-hidden">Enviado</span></span>`;
      }
      // Hora y estado solo al final de cada grupo (y siempre si el mensaje está pendiente)
      const showMeta = !continuesNext || isPending;
      const classes = ['chat-message', isSent ? 'sent' : 'received'];
      if (continuesPrev) classes.push('is-cont');
      if (!continuesNext) classes.push('is-tail');
      if (isPending) classes.push('is-pending');
      if (!firstRender && !previousIds.has(msg.id)) classes.push('is-new');

      html += `
        <div class="${classes.join(' ')}" data-id="${msg.id}">
          <div class="chat-message-text">${chatFormatText(msg.text)}</div>
          ${showMeta ? `<div class="chat-message-meta">${time ? `<span class="chat-message-time">${time}</span>` : ''}${status}</div>` : ''}
        </div>`;
    });

    chatMessagesContainer.innerHTML = html;
    chatRenderedIds = new Set(messages.map(m => m.id));

    const last = messages[messages.length - 1];
    const lastIsNewMine = last && last.senderId === currentUser.uid && !previousIds.has(last.id);
    if (wasNearBottom || lastIsNewMine) {
      chatScrollToBottom(!firstRender);
    } else if (messages.some(m => !previousIds.has(m.id))) {
      // El usuario está leyendo mensajes anteriores: no se le mueve, se le avisa
      chatNewPill?.classList.remove('hidden');
    }

    // Mensajes recibidos con el chat abierto: se marcan como leídos (MessagingService.markAsRead)
    const hasUnreadIncoming = messages.some(m => m.senderId !== currentUser.uid && m.status === 'sent');
    if (hasUnreadIncoming && currentChat?.isRealConversation && document.visibilityState === 'visible') {
      clearTimeout(chatMarkReadTimer);
      const id = currentChat.id;
      chatMarkReadTimer = setTimeout(() => {
        if (currentChat?.id === id) window.MessagingService?.markAsRead(id);
      }, 800);
    }
  }

  function subscribeCurrentChat() {
    if (!currentChat?.isRealConversation || !window.MessagingService) return;
    if (unsubscribeMessages) unsubscribeMessages();
    chatRenderedIds = null;
    renderChatLoading();
    unsubscribeMessages = window.MessagingService.subscribeToMessages(
      currentChat.id,
      (messages) => renderChatMessages(messages),
      () => renderChatError()
    );
  }

  function openChat(chatData) {
    if (!chatModal) return;

    chatOpener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    currentChat = chatData;
    chatAvatar.src = chatData.avatar;
    chatAvatar.onerror = () => { chatAvatar.src = generateAvatarFallback(chatData.sender || 'Usuario', 80); chatAvatar.onerror = null; };
    chatUsername.textContent = chatData.sender;
    chatInput.value = '';
    updateChatComposer();
    hideChatBanner();
    closeChatMenu();
    chatNewPill?.classList.add('hidden');
    renderChatLoading();

    chatModal.classList.remove('is-closing');
    chatModal.classList.remove('hidden');
    dropdown.classList.add('hidden');

    // Solo con ratón/teclado físico: en móvil no se abre el teclado sin que la persona lo pida
    if (window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
      chatInput.focus();
    } else {
      chatModal.querySelector('.chat-modal-container')?.focus?.({ preventScroll: true });
    }

    window.visualViewport?.addEventListener('resize', syncChatViewport);
    window.visualViewport?.addEventListener('scroll', syncChatViewport);
    window.addEventListener('online', updateChatConnection);
    window.addEventListener('offline', updateChatConnection);
    syncChatViewport();
    updateChatConnection();

    // Subscribe to real messages if it's a real conversation
    if (chatData.isRealConversation && window.MessagingService) {
      subscribeCurrentChat();
      // Mark as read
      window.MessagingService.markAsRead(chatData.id);
    }
  }

  // Limpieza: listener de mensajes, teclado y conexión. Se llama al cerrar y también si otra
  // parte de la app oculta el chat (switchView → closeAllModals).
  function cleanupChat() {
    if (unsubscribeMessages) {
      unsubscribeMessages();
      unsubscribeMessages = null;
    }
    clearTimeout(chatMarkReadTimer);
    window.visualViewport?.removeEventListener('resize', syncChatViewport);
    window.visualViewport?.removeEventListener('scroll', syncChatViewport);
    window.removeEventListener('online', updateChatConnection);
    window.removeEventListener('offline', updateChatConnection);
    if (chatModal?.classList.contains('kb-open')) chatModal.classList.remove('kb-open');
    closeChatMenu();
    currentChat = null;
    chatRenderedIds = null;
  }

  function closeChat({ animate = true } = {}) {
    if (!chatModal || chatModal.classList.contains('hidden')) return;
    const opener = chatOpener;
    cleanupChat();
    const finish = () => {
      chatModal.classList.add('hidden');
      chatModal.classList.remove('is-closing');
      if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
    };
    if (animate && !chatReducedMotion()) {
      chatModal.classList.add('is-closing');
      setTimeout(finish, CHAT_CLOSE_MS);
    } else {
      finish();
    }
  }

  if (chatModal) {
    new MutationObserver(() => {
      if (chatModal.classList.contains('hidden') && currentChat) cleanupChat();
    }).observe(chatModal, { attributes: true, attributeFilter: ['class'] });
  }

  async function sendMessage() {
    const text = chatInput.value.trim();
    if (!text || !currentChat) return;

    chatInput.value = '';
    updateChatComposer();
    hideChatBanner('send-error');
    const chatAtSend = currentChat;

    if (currentChat.isRealConversation && window.MessagingService) {
      // Sin conexión, Firestore deja la escritura en cola (el mensaje se ve como pendiente):
      // el botón no se queda en "enviando" esperando la confirmación del servidor
      const showSending = navigator.onLine !== false;
      if (showSending) chatSendBtn.classList.add('is-sending');
      try {
        await window.MessagingService.sendMessage(
          currentChat.id,
          text,
          currentChat.recipientId
        );
      } catch (error) {
        console.error('Error sending message:', error);
        if (currentChat === chatAtSend) {
          chatInput.value = text; // Restore text on error
          updateChatComposer();
          showChatBanner('send-error', 'No se pudo enviar el mensaje. Revisa tu conexión e inténtalo de nuevo.');
        }
      } finally {
        chatSendBtn.classList.remove('is-sending');
      }
    }
  }

  // ---- Menú contextual ----
  function closeChatMenu() {
    chatMenu?.classList.add('hidden');
    chatMenuBtn?.setAttribute('aria-expanded', 'false');
  }

  function openChatProfile() {
    const recipientId = currentChat?.recipientId;
    if (!recipientId) return;
    closeChat({ animate: false });
    if (typeof openPublicProfile === 'function') openPublicProfile(recipientId);
  }

  async function deleteCurrentChat() {
    if (!currentChat?.id || !window.MessagingService) return;
    const confirmed = await showConfirm('¿Eliminar esta conversación? Esta acción no se puede deshacer.', 'Eliminar conversación');
    if (!confirmed || !currentChat) return;
    const id = currentChat.id;
    const deleted = await window.MessagingService.deleteConversation(id);
    if (deleted) closeChat();
  }

  chatMenuBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    const willOpen = chatMenu.classList.contains('hidden');
    chatMenu.classList.toggle('hidden', !willOpen);
    chatMenuBtn.setAttribute('aria-expanded', String(willOpen));
    if (willOpen) chatMenu.querySelector('.chat-menu-item')?.focus();
  });

  chatModal?.addEventListener('click', (e) => {
    const action = e.target.closest('[data-chat-action]')?.dataset.chatAction;
    if (action === 'profile') {
      openChatProfile();
      return;
    }
    if (action === 'delete') {
      closeChatMenu();
      deleteCurrentChat();
      return;
    }
    if (!e.target.closest('#chat-menu') && !e.target.closest('#chat-menu-btn')) closeChatMenu();
  });

  // ---- Controles ----
  if (chatCloseBtn) chatCloseBtn.addEventListener('click', () => closeChat());
  if (chatOverlay) chatOverlay.addEventListener('click', () => closeChat());
  chatHeaderUser?.addEventListener('click', openChatProfile);

  // Volver a la bandeja: se cierra el chat y se reabre el panel de mensajes
  chatBackBtn?.addEventListener('click', (e) => {
    e.stopPropagation(); // el clic no debe llegar al "cerrar al pulsar fuera" del panel
    closeChat();
    if (firebase.auth().currentUser) {
      setTimeout(() => btn.click(), chatReducedMotion() ? 0 : CHAT_CLOSE_MS);
    }
  });

  if (chatSendBtn) chatSendBtn.addEventListener('click', sendMessage);
  chatNewPill?.addEventListener('click', () => chatScrollToBottom(true));
  chatMessagesContainer?.addEventListener('scroll', () => {
    if (chatIsNearBottom()) chatNewPill?.classList.add('hidden');
  }, { passive: true });

  if (chatInput) {
    chatInput.addEventListener('input', () => {
      updateChatComposer();
      if (chatInput.value) hideChatBanner('send-error');
    });
    chatInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        sendMessage();
      }
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !chatModal || chatModal.classList.contains('hidden')) return;
    if (!chatMenu.classList.contains('hidden')) {
      closeChatMenu();
      chatMenuBtn.focus();
    } else {
      closeChat();
    }
  });

  // Expose openChat globally
  window.openChatWithUser = openChat;
}

function initNotifications() {
  const btn = document.getElementById('notification-btn');
  const dropdown = document.getElementById('notification-dropdown');
  const list = document.getElementById('notification-list');
  const clearBtn = document.getElementById('clear-notifications');
  const messagesDropdown = document.getElementById('messages-dropdown');
  const bellCount = document.getElementById('notification-count');
  const filtersBar = document.getElementById('notification-filters');
  const footer = document.getElementById('notifications-footer');
  const markAllBtn = document.getElementById('notifications-mark-read');

  // Estado de la campana por CSS (has-unread) y contador con las no leídas de las últimas 20 cargadas
  const setBellUnread = (unread) => {
    const count = unread ? notifications.filter(n => !n.read).length : 0;
    btn?.classList.toggle('has-unread', count > 0);
    if (bellCount) {
      bellCount.textContent = count >= 20 ? '20+' : String(count);
      bellCount.classList.toggle('hidden', count === 0);
    }
    btn?.setAttribute('aria-label', count > 0 ? `Notificaciones, ${count} sin leer` : 'Notificaciones');
    if (footer) footer.hidden = count === 0;
  };

  // Filtros del panel (sobre las notificaciones ya cargadas por el listener)
  const NOTIFICATION_FILTERS = {
    all: null,
    follow: ['follow', 'followers'],
    comment: ['comment', 'reply', 'mention'],
    like: ['like', 'likes']
  };
  let currentFilter = 'all';
  const matchesFilter = (n, filter) => !NOTIFICATION_FILTERS[filter] || NOTIFICATION_FILTERS[filter].includes(n.type);

  if (!btn || !dropdown || !list) return;

  let notifications = [];
  let hasUnread = false;
  let unsubscribe = null;
  const deletingNotificationIds = new Set(); // Track notifications being deleted

  // Wait for auth state
  firebase.auth().onAuthStateChanged(user => {
    if (user) {
      setupNotificationListener(user.uid);
    } else {
      if (unsubscribe) unsubscribe();
      notifications = [];
      hasUnread = false;
      setBellUnread(false);
    }
  });

  function setupNotificationListener(userId) {
    unsubscribe = db.collection('users')
      .doc(userId)
      .collection('notifications')
      .orderBy('createdAt', 'desc')
      .limit(20)
      .onSnapshot(snapshot => {
        notifications = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));

        // Filter out notifications that are currently being deleted
        notifications = notifications.filter(n => !deletingNotificationIds.has(n.id));

        hasUnread = notifications.some(n => !n.read);
        setBellUnread(hasUnread);

        // Only re-render if there are no items currently animating
        // This prevents interrupting the slide-up animation
        const hasAnimatingItems = list.querySelector('.notification-item.is-deleting');
        if (!hasAnimatingItems) {
          renderNotifications();
        }
      }, error => {
        console.error('Error listening to notifications:', error);
      });
  }

  function getTimeAgo(date) {
    if (!date) return '';
    const now = new Date();
    const diff = now - date;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    if (minutes < 1) return 'Ahora';
    if (minutes < 60) return `Hace ${minutes} min`;
    if (hours < 24) return `Hace ${hours}h`;
    if (days === 1) return 'Ayer';
    return `Hace ${days} días`;
  }

  // Render notifications
  function renderNotifications() {
    // Contadores de no leídas por filtro
    filtersBar?.querySelectorAll('.kx-chip').forEach(chip => {
      const unread = notifications.filter(n => !n.read && matchesFilter(n, chip.dataset.filter)).length;
      const badge = chip.querySelector('.kx-chip-count');
      if (badge) {
        badge.textContent = unread > 0 ? String(unread) : '';
        badge.hidden = unread === 0;
      }
    });

    if (notifications.length === 0) {
      list.innerHTML = `
        <div class="notification-empty">
          <div class="notification-empty-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg></div>
          <div class="notification-empty-text">No tienes notificaciones</div>
          <div class="notification-empty-hint">Aquí verás seguidores, comentarios y me gusta</div>
        </div>
      `;
      setBellUnread(false);
      return;
    }

    const visible = notifications.filter(n => matchesFilter(n, currentFilter));
    if (visible.length === 0) {
      list.innerHTML = `
        <div class="notification-empty">
          <div class="notification-empty-text">Nada por aquí</div>
          <div class="notification-empty-hint">No hay notificaciones de este tipo</div>
        </div>
      `;
      setBellUnread(hasUnread);
      return;
    }

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    let lastGroup = '';

    list.innerHTML = visible.map(n => {
      const createdAt = n.createdAt?.toDate ? n.createdAt.toDate() : new Date();
      const group = createdAt >= startOfToday ? 'Hoy' : 'Anteriores';
      const groupHeader = group !== lastGroup ? `<div class="kx-sheet-section">${group}</div>` : '';
      lastGroup = group;

      const timeAgo = getTimeAgo(createdAt);
      const unreadClass = n.read ? '' : 'unread';
      const clickHandler = n.fromUserId ? `onclick="handleNotificationClick('${n.id}', '${n.type}', '${n.fromUserId}', '${n.postId || ''}', '${n.commentId || ''}', '${n.replyId || ''}')"` : '';
      // Use notification ID directly - Firestore IDs are safe for HTML attributes
      const notificationId = String(n.id);
      const fromName = escapeHtmlMention(n.fromUserName || 'Usuario');

      return `${groupHeader}
        <div class="notification-item ${unreadClass}" data-id="${notificationId}" data-notification-id="${notificationId}">
          <div class="notification-clickable-area${n.fromUserId ? ' is-actionable' : ''}" ${clickHandler} ${n.fromUserId ? 'role="button" tabindex="0"' : ''}>
            <span class="notification-avatar-wrap">
              <img src="${n.fromUserPhoto || generateAvatarFallback(n.fromUserName || 'Usuario', 44)}" class="notification-avatar" alt="" referrerPolicy="no-referrer" onerror="this.src='${generateAvatarFallback(n.fromUserName || 'Usuario', 44)}'; this.onerror=null;">
              <span class="notification-type" aria-hidden="true">${getNotificationIcon(n.type)}</span>
            </span>
            <div class="notification-content">
              <div class="notification-text"><strong>${fromName}</strong> ${n.text}</div>
              <div class="notification-time">${timeAgo}${n.read ? '' : '<span class="kx-visually-hidden">, sin leer</span>'}</div>
            </div>
          </div>
          ${n.read ? '' : '<span class="notification-unread-dot" aria-hidden="true"></span>'}
          <button class="notification-delete-btn" data-notification-id="${notificationId}" title="Borrar notificación" type="button" aria-label="Borrar notificación" onclick="event.stopPropagation(); event.preventDefault(); event.stopImmediatePropagation(); return false;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
      `;
    }).join('');

    setBellUnread(hasUnread);
  }

  function getNotificationIcon(type) {
    switch (type) {
      case 'follow':
      case 'followers':
        return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="8.5" cy="7" r="4"></circle><line x1="20" y1="8" x2="20" y2="14"></line><line x1="23" y1="11" x2="17" y2="11"></line></svg>';
      case 'like':
      case 'likes':
        return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>';
      case 'comment':
      case 'messages':
        return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>';
      case 'mention':
        return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"></circle><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.92 7.94"></path></svg>';
      case 'reply':
        return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 17 4 12 9 7"></polyline><path d="M20 18v-2a4 4 0 0 0-4-4H4"></path></svg>';
      default:
        return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="10"></circle></svg>';
    }
  }

  // Toggle dropdown
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isHidden = dropdown.classList.contains('hidden');
    // Close messages dropdown if open
    if (messagesDropdown) messagesDropdown.classList.add('hidden');
    document.getElementById('search-sheet')?.classList.add('hidden');
    if (isHidden) {
      dropdown.classList.remove('hidden');
      renderNotifications();
      // Ya no se marcan todas al abrir: se marcan con «Marcar todas como leídas»
      // o una a una al tocarlas (ver window.markNotificationRead)
    } else {
      dropdown.classList.add('hidden');
    }
  });

  // Close on outside click (but not when clicking delete button)
  document.addEventListener('click', (e) => {
    // Don't close if clicking on delete button or its parent notification item
    const deleteBtn = e.target.closest('.notification-delete-btn');
    if (deleteBtn) {
      return; // Let the delete handler manage this
    }

    if (!dropdown.contains(e.target) && !btn.contains(e.target)) {
      dropdown.classList.add('hidden');
    }
  });

  // Filtros
  filtersBar?.addEventListener('click', (e) => {
    const chip = e.target.closest('.kx-chip');
    if (!chip) return;
    currentFilter = chip.dataset.filter || 'all';
    filtersBar.querySelectorAll('.kx-chip').forEach(c => {
      const active = c === chip;
      c.classList.toggle('is-active', active);
      c.setAttribute('aria-pressed', String(active));
    });
    renderNotifications();
  });

  // Teclado: Intro o espacio ejecutan la acción de la notificación
  list.addEventListener('keydown', (e) => {
    const area = e.target.closest('.notification-clickable-area.is-actionable');
    if (area && (e.key === 'Enter' || e.key === ' ') && e.target === area) {
      e.preventDefault();
      area.click();
    }
  });

  markAllBtn?.addEventListener('click', async () => {
    markAllBtn.disabled = true;
    await markNotificationsAsRead();
    markAllBtn.disabled = false;
    renderNotifications();
  });

  // Marca una notificación como leída (al tocarla)
  window.markNotificationRead = async function (notificationId) {
    if (!currentUser || !notificationId) return;
    const n = notifications.find(x => x.id === notificationId);
    if (!n || n.read) return;
    try {
      await db.collection('users').doc(currentUser.uid).collection('notifications').doc(notificationId).update({ read: true });
    } catch (error) {
      console.error('Error marking notification as read:', error);
    }
  };

  // Delete notification button handler (event delegation - set once)
  // Using capture phase to ensure this runs BEFORE the parent onclick
  list.addEventListener('click', async (e) => {
    const deleteBtn = e.target.closest('.notification-delete-btn');
    if (deleteBtn) {
      // CRITICAL: Stop propagation immediately to prevent navigation and dropdown closing
      e.stopPropagation();
      e.preventDefault();
      e.stopImmediatePropagation();

      const notificationItem = deleteBtn.closest('.notification-item');
      const notificationId = deleteBtn.getAttribute('data-notification-id');

      if (!notificationItem || !notificationId) return;

      // Prevent multiple clicks during animation
      if (notificationItem.classList.contains('is-deleting')) {
        return;
      }

      // Mark as deleting to prevent re-rendering
      deletingNotificationIds.add(notificationId);

      // Add is-deleting class immediately to start animation
      notificationItem.classList.add('is-deleting');

      // Wait for animation to complete (500ms) before deleting from Firestore and DOM
      setTimeout(async () => {
        try {
          // Delete from Firestore
          if (typeof window.deleteNotificationById === 'function') {
            await window.deleteNotificationById(notificationId);
          }

          // Remove from DOM after animation completes
          // Use a small additional delay to ensure animation is fully visible
          setTimeout(() => {
            if (notificationItem && notificationItem.parentNode) {
              notificationItem.remove();
            }
            // Remove from tracking set
            deletingNotificationIds.delete(notificationId);
            // Re-render to ensure list is up to date
            renderNotifications();
          }, 50);

        } catch (error) {
          console.error('Error deleting notification:', error);
          // Remove deleting class on error to restore item
          if (notificationItem) {
            notificationItem.classList.remove('is-deleting');
          }
          deletingNotificationIds.delete(notificationId);
          showToast('No se ha podido borrar la notificación', 'error', { detail: kxFriendlyError(error) });
        }
      }, 500); // Match CSS transition duration
    }
  }, true); // Use capture phase (true) to intercept before bubbling

  // Clear notifications
  if (clearBtn) {
    clearBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!currentUser) return;

      try {
        const batch = db.batch();
        const snapshot = await db.collection('users')
          .doc(currentUser.uid)
          .collection('notifications')
          .get();

        snapshot.docs.forEach(doc => batch.delete(doc.ref));
        await batch.commit();

        notifications = [];
        hasUnread = false;
        setBellUnread(false);
        renderNotifications();
        showToast('Notificaciones borradas', 'success');
      } catch (error) {
        console.error('Error clearing notifications:', error);
      }
    });
  }

  async function markNotificationsAsRead() {
    if (!currentUser || notifications.length === 0) return;
    try {
      const batch = db.batch();
      notifications.filter(n => !n.read).forEach(n => {
        const ref = db.collection('users').doc(currentUser.uid).collection('notifications').doc(n.id);
        batch.update(ref, { read: true });
      });
      await batch.commit();
      hasUnread = false;
      setBellUnread(false);
    } catch (error) {
      console.error('Error marking notifications as read:', error);
    }
  }

  // Initial icon state
  setBellUnread(false);
}

// Handle notification click - navigate to relevant content with deep-link to comment
window.handleNotificationClick = async function (notificationId, type, fromUserId, postId, commentId, replyId) {
  document.getElementById('notification-dropdown')?.classList.add('hidden');
  if (typeof window.markNotificationRead === 'function') window.markNotificationRead(notificationId);
  if (type === 'follow' && fromUserId) {
    openPublicProfile(fromUserId);
  } else if (postId && typeof openPostModal === 'function') {
    // For all post-related notifications (comment, reply, like, mention),
    // open the post modal with deep-link to the specific comment/reply
    switchView('feed-view');
    openPostModal(postId, commentId || '', replyId || '');
  } else if (fromUserId) {
    openPublicProfile(fromUserId);
  }
};

// Create a notification for a user (with idempotency to prevent duplicates)
window.createNotification = async function (targetUserId, type, text, additionalData = {}) {
  if (!currentUser || targetUserId === currentUser.uid) return;

  try {
    // Generate idempotency key based on notification type and context
    // This prevents duplicate notifications for the same action
    // For replies, use replyId to allow multiple reply notifications per post from the same user
    const resourceId = additionalData.replyId || additionalData.postId || additionalData.routeId || additionalData.resourceId || '';
    const idempotencyKey = `${type}_${currentUser.uid}_${resourceId}`.replace(/[^a-zA-Z0-9_]/g, '_');

    const notificationsRef = db.collection('users').doc(targetUserId).collection('notifications');

    // Check if notification already exists (idempotency check)
    const existingDoc = await notificationsRef.doc(idempotencyKey).get();

    if (existingDoc.exists) {
      // For 'like' type: allow recreation if previous was deleted (user unliked then liked again)
      // Check if notification is recent (within 1 hour) to prevent spam
      const existingData = existingDoc.data();
      const createdAt = existingData.createdAt?.toDate?.();
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

      if (createdAt && createdAt > oneHourAgo) {
        // Recent notification exists, skip creation (idempotent)
        return;
      }
      // Old notification exists, update it instead of creating duplicate
    }

    // Get current user's photo from Firestore (might be different from Auth)
    let userPhotoURL = currentUser.photoURL || 'https://ui-avatars.com/api/?name=U&background=DCE9DF&color=153E35&size=44';
    try {
      const userDoc = await db.collection('users').doc(currentUser.uid).get();
      if (userDoc.exists && userDoc.data().photoURL) {
        userPhotoURL = userDoc.data().photoURL;
      }
    } catch (e) {
      console.warn('Could not fetch user photo for notification', e);
    }

    // Use set() with idempotency key instead of add() to prevent duplicates
    await notificationsRef.doc(idempotencyKey).set({
      type: type,
      text: text,
      fromUserId: currentUser.uid,
      fromUserName: currentUser.displayName || 'Usuario',
      fromUserPhoto: userPhotoURL,
      read: false,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      ...additionalData
    });
  } catch (error) {
    console.error('Error creating notification:', error);
  }
};

// Delete a notification (for use when unliking, unfollowing, etc.)
window.deleteNotification = async function (targetUserId, type, resourceId = '') {
  if (!currentUser || targetUserId === currentUser.uid) return;

  try {
    const idempotencyKey = `${type}_${currentUser.uid}_${resourceId}`.replace(/[^a-zA-Z0-9_]/g, '_');
    const notificationRef = db.collection('users').doc(targetUserId).collection('notifications').doc(idempotencyKey);

    const doc = await notificationRef.get();
    if (doc.exists) {
      await notificationRef.delete();
    }
  } catch (error) {
    console.error('Error deleting notification:', error);
  }
};

// Delete a notification by ID (for user-initiated deletion from UI)
window.deleteNotificationById = async function (notificationId) {
  if (!currentUser) {
    console.warn('Cannot delete notification: user not logged in');
    return;
  }

  if (!notificationId) {
    console.warn('Cannot delete notification: no ID provided');
    return;
  }

  try {
    const notificationRef = db.collection('users').doc(currentUser.uid).collection('notifications').doc(notificationId);
    const doc = await notificationRef.get();

    if (!doc.exists) {
      console.warn('Notification not found:', notificationId);
      return;
    }

    await notificationRef.delete();
    console.log('Notification deleted successfully:', notificationId);
  } catch (error) {
    console.error('Error deleting notification:', error);
    // Try to show toast, but fallback to alert if showToast is not available
    showToast('No se ha podido borrar la notificación', 'error', { detail: kxFriendlyError(error) });
    throw error; // Re-throw to let caller handle it
  }
};

function initNavigation() {
  const navItems = document.querySelectorAll('.nav-item');
  navItems.forEach(item => {
    item.addEventListener('click', (e) => {
      const targetId = item.dataset.target;
      if (targetId) {
        switchView(targetId);
      } else if (item.id === 'nav-profile-btn') {
        showToast('Perfil de usuario próximamente', 'info');
      }
    });
  });
}

function closeAllModals() {
  const selectors = [
    '.modal',
    '.chat-modal',
    '.modal-overlay',
    '.route-photo-overlay',
    '.user-dropdown', // Also close user dropdown
    '.messages-dropdown', // Close messages dropdown
    '.notification-dropdown' // Close notifications dropdown
  ];

  selectors.forEach(selector => {
    document.querySelectorAll(selector).forEach(el => {
      el.classList.add('hidden');
    });
  });
}

function switchView(viewId) {
  closeAllModals();

  // Cerrar todos los bottom sheets al cambiar de sección
  if (typeof hideBottomSheet === 'function') hideBottomSheet();
  if (typeof hideSectorBottomSheet === 'function') hideSectorBottomSheet();
  if (typeof hideRouteBottomSheet === 'function') hideRouteBottomSheet();

  // Update Views with smooth transitions
  document.querySelectorAll('.view').forEach(view => {
    if (view.id === viewId) {
      view.classList.remove('hidden');
      // Use requestAnimationFrame for smoother transitions
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          view.classList.add('active');
        });
      });
    } else {
      view.classList.remove('active');
      // Wait for transition to complete before hiding
      setTimeout(() => view.classList.add('hidden'), 200);
    }
  });

  // Update Nav Items
  document.querySelectorAll('.nav-item').forEach(item => {
    if (item.dataset.target === viewId) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });

  // Toggle Map Controls (Search Bar & Profile)
  const topBar = document.querySelector('.top-bar-wrapper');
  const authContainer = document.getElementById('auth-container');

  // Aplicar clase map-active SOLO cuando estamos en map-view
  if (viewId === 'map-view') {
    document.body.classList.add('map-active');
  } else {
    document.body.classList.remove('map-active');
  }

  // El feed se desplaza por debajo de la navegación de cristal (ver FEED REDISEÑO en app_2.css)
  document.body.classList.toggle('feed-active', viewId === 'feed-view');

  if (viewId === 'feed-view' || viewId === 'profile-view' || viewId === 'activity-view' || viewId === 'map-view' || viewId === 'search-view' || viewId === 'train-view') {
    if (topBar) topBar.style.display = 'none';
    if (authContainer) authContainer.style.display = 'none';
  } else {
    if (topBar) topBar.style.display = 'flex';
    if (authContainer) authContainer.style.display = 'block';
  }

  // Refresh train view when navigating to it
  if (viewId === 'train-view') {
    if (typeof window.refreshTrainView === 'function') window.refreshTrainView();
  }

  // Reload activity data when switching to activity view
  if (viewId === 'activity-view') {
    loadActivityData();
    // Re-render líneas cuando la vista esté completamente visible (fin de transición CSS)
    setTimeout(() => {
      const barsContainer = document.getElementById('histogram-bars');
      const svgLines = document.getElementById('histogram-lines');
      if (barsContainer && svgLines && cachedAscentsForHistogram.length > 0) {
        const histData = processHistogramData(cachedAscentsForHistogram, currentHistogramPeriod);
        const maxAscents = Math.max(...histData.map(d => d.ascents), 1);
        const allIdx = histData.flatMap(d => [getGradeIndex(d.maxGrade), getGradeIndex(d.avgGrade), getGradeIndex(d.minGrade)]).filter(i => i >= 0);
        if (allIdx.length > 0) {
          const minGradeIdx = Math.max(0, Math.min(...allIdx) - 2);
          const maxGradeIdx = Math.min(HISTOGRAM_GRADE_ORDER.length - 1, Math.max(...allIdx) + 2);
          measureAndRenderLines(barsContainer, svgLines, histData, minGradeIdx, maxGradeIdx - minGradeIdx || 1, 0);
        }
      }
    }, 220);
  }

  // Specific logic per view
  if (viewId === 'profile-view') {
    // IMPORTANTE: Solo inicializar perfil propio si NO estamos viendo un perfil ajeno
    // currentProfileUserId se establece ANTES de llamar switchView en openPublicProfile
    if (!currentProfileUserId) {
      configureProfileViewForOwnProfile();
      initProfile();
    }
    // Si currentProfileUserId tiene valor, openPublicProfile se encarga de todo
  }

  if (viewId === 'map-view') {
    // MapLibre: inicializar o redimensionar
    if (typeof USE_MAPLIBRE !== 'undefined' && USE_MAPLIBRE) {
      if (typeof mlEnsureMapReady === 'function') {
        // PequeÃ±o delay para asegurar que el contenedor es visible
        setTimeout(() => {
          mlEnsureMapReady();
        }, 50);
      }
    }
    // Google Maps eliminado - MapLibre es el Ãºnico motor de mapas
  }
}

// Mock Feed Data (desactivado para producción)
const MOCK_FEED = [];

// ================== IMAGE LIGHTBOX ==================
// Visor de fotos y vídeos de una publicación: se desliza entre todos en el orden publicado.
// Fotos con zoom: pellizco, doble toque/clic, rueda (o pellizco del trackpad), arrastre para
// mover, botones +/− y teclado (+, −, 0 y flechas). Vídeos con controles propios (sin los
// nativos). Sin zoom, deslizar hacia abajo cierra el visor. La foto se precarga antes de
// mostrarse: así no aparece a medias ni con saltos de tamaño.
const LB = {
  MIN: 1, MAX: 6, DOUBLE_TAP_SCALE: 2.5,
  scale: 1, x: 0, y: 0,
  pointers: new Map(),
  gesture: null,     // { type: 'pinch'|'pan'|'dismiss', ... }
  lastTap: null,     // { t, x, y } para el doble toque
  opener: null,
  token: 0,          // invalida cargas antiguas si se abre otra imagen
  items: [],         // fotos y vídeos de la publicación: { type: 'photo' | 'video', url }
  index: 0,
  busy: false,       // animación de cambio en curso
  peekEl: null,      // foto o vídeo contiguo que entra de lado al deslizar
  peekDir: 0,
  muted: false,      // se mantiene entre vídeos mientras el visor sigue abierto
  idleTimer: null,
  GAP: 24            // separación entre elementos al deslizar
};

function lbEls() {
  return {
    modal: document.getElementById('image-lightbox-modal'),
    stage: document.getElementById('image-lightbox-stage'),
    img: document.getElementById('image-lightbox-img'),
    video: document.getElementById('image-lightbox-video'),
    videoEl: document.getElementById('image-lightbox-video-el'),
    spinner: document.getElementById('image-lightbox-spinner'),
    error: document.getElementById('image-lightbox-error'),
    level: document.querySelector('.image-lightbox-zoom-level'),
    peek: document.getElementById('image-lightbox-peek'),
    peekVideo: document.getElementById('image-lightbox-peek-video'),
    counter: document.getElementById('image-lightbox-counter'),
    prev: document.getElementById('image-lightbox-prev'),
    next: document.getElementById('image-lightbox-next')
  };
}

const lbReduced = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const lbWait = ms => new Promise(resolve => setTimeout(resolve, ms));
const lbIsVideo = () => LB.items[LB.index]?.type === 'video';
// Elemento que se ve ahora: la foto o el contenedor del vídeo
const lbMain = () => (lbIsVideo() ? lbEls().video : lbEls().img);

// Tamaño base de la imagen (sin zoom) y límites de desplazamiento según la escala
function lbBounds(scale = LB.scale) {
  const { stage, img } = lbEls();
  const baseW = img.offsetWidth, baseH = img.offsetHeight;
  return {
    maxX: Math.max(0, (baseW * scale - stage.clientWidth) / 2),
    maxY: Math.max(0, (baseH * scale - stage.clientHeight) / 2)
  };
}

const lbClamp = (v, min, max) => Math.min(max, Math.max(min, v));

function lbApply(animate = false) {
  const { modal, level } = lbEls();
  const el = lbMain();
  el.style.transition = animate && !lbReduced() ? 'transform 0.22s cubic-bezier(0.22, 1, 0.36, 1)' : 'none';
  el.style.transform = `translate3d(${LB.x}px, ${LB.y}px, 0) scale(${LB.scale})`;
  modal.classList.toggle('is-zoomed', LB.scale > 1.01);
  if (level) level.textContent = `${Math.round(LB.scale * 100)}%`;
}

// Ajusta posición y escala a límites válidos (con animación al soltar)
function lbSettle(animate = true) {
  LB.scale = lbClamp(LB.scale, LB.MIN, LB.MAX);
  const { maxX, maxY } = lbBounds();
  LB.x = lbClamp(LB.x, -maxX, maxX);
  LB.y = lbClamp(LB.y, -maxY, maxY);
  if (LB.scale <= 1.001 || lbIsVideo()) { LB.scale = 1; LB.x = 0; LB.y = 0; }
  lbApply(animate);
}

// Cambia la escala manteniendo fijo el punto (cx, cy), en px respecto al centro del escenario.
// Los vídeos no se amplían.
function lbZoomAt(newScale, cx = 0, cy = 0, animate = true) {
  if (lbIsVideo()) return;
  newScale = lbClamp(newScale, LB.MIN, LB.MAX);
  const ratio = newScale / LB.scale;
  LB.x = cx - (cx - LB.x) * ratio;
  LB.y = cy - (cy - LB.y) * ratio;
  LB.scale = newScale;
  lbSettle(animate);
}

// Coordenadas de un puntero respecto al centro del escenario
function lbPoint(e) {
  const { stage } = lbEls();
  const r = stage.getBoundingClientRect();
  return { x: e.clientX - r.left - r.width / 2, y: e.clientY - r.top - r.height / 2 };
}

function lbHidePeek() {
  const { peek, peekVideo } = lbEls();
  [peek, peekVideo].forEach(el => {
    if (!el) return;
    el.hidden = true; el.style.transition = 'none'; el.style.transform = '';
  });
  LB.peekEl = null; LB.peekDir = 0;
}

function lbReset() {
  LB.scale = 1; LB.x = 0; LB.y = 0;
  LB.pointers.clear(); LB.gesture = null; LB.lastTap = null; LB.busy = false;
  const { img, video, modal, level } = lbEls();
  [img, video].forEach(el => { if (el) { el.style.transition = 'none'; el.style.transform = ''; } });
  lbHidePeek();
  modal?.classList.remove('is-zoomed', 'is-dragging', 'is-loaded', 'is-error', 'is-video', 'is-paused', 'is-idle');
  if (modal) modal.style.removeProperty('--lb-dim');
  if (level) level.textContent = '100%';
}

// Contador y flechas según la posición dentro de la publicación
function lbUpdateGallery() {
  const { counter, prev, next } = lbEls();
  const n = LB.items.length;
  const multi = n > 1;
  if (counter) {
    counter.hidden = !multi;
    counter.textContent = multi ? `${LB.index + 1} / ${n}` : '';
  }
  if (prev) { prev.hidden = !multi; prev.disabled = LB.index <= 0; }
  if (next) { next.hidden = !multi; next.disabled = LB.index >= n - 1; }
}

// Precarga y decodifica las fotos contiguas para que el cambio sea inmediato
function lbPreloadNeighbors() {
  [LB.index - 1, LB.index + 1].forEach(i => {
    const item = LB.items[i];
    if (!item || item.type !== 'photo') return;
    const pre = new Image();
    pre.referrerPolicy = 'no-referrer';
    pre.src = item.url;
    pre.decode?.().catch(() => {});
  });
}

function lbShowError(text) {
  const { modal, error, spinner } = lbEls();
  spinner.hidden = true;
  error.textContent = text;
  error.hidden = false;
  modal.classList.add('is-error');
}

// Abre el visor. `items` = fotos y vídeos de la publicación ({ type, url } o URLs de fotos);
// `index` el que se toca (si falta, se busca `src` en la lista)
function openImageLightbox(src, items, index) {
  const { modal, img, error } = lbEls();
  const list = (Array.isArray(items) ? items : [])
    .map(it => (typeof it === 'string' ? { type: 'photo', url: it } : it))
    .filter(it => it && it.url);
  if (!modal || !img || (!src && !list.length)) return;

  LB.items = list.length ? list : [{ type: 'photo', url: src }];
  LB.index = Number.isInteger(index) && LB.items[index] ? index : Math.max(0, LB.items.findIndex(it => it.url === src));

  const token = ++LB.token;
  LB.opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  lbReset();
  error.hidden = true;

  document.body.style.overflow = 'hidden';
  const app = document.getElementById('app');
  app?.setAttribute('inert', '');
  app?.setAttribute('aria-hidden', 'true');
  modal.classList.remove('hidden');
  modal.classList.remove('is-closing');
  document.getElementById('image-lightbox-close')?.focus({ preventScroll: true });

  lbUpdateGallery();
  const item = LB.items[LB.index];
  if (item.type === 'video') {
    lbShowVideo(item.url, item.poster); // se llama dentro del toque: el vídeo puede empezar con sonido
    lbPreloadNeighbors();
  } else {
    lbOpenPhoto(item.url, token);
  }
}

// Precarga: la foto solo se muestra cuando ya está lista (normalmente ya está en caché)
function lbOpenPhoto(url, token) {
  const { modal, img, spinner } = lbEls();
  lbShowPhotoLayer();
  img.removeAttribute('src');
  spinner.hidden = false;
  const loader = new Image();
  loader.referrerPolicy = 'no-referrer';
  loader.onload = async () => {
    if (token !== LB.token) return;
    // decode() evita el parpadeo al pintar; con tope de tiempo por si el navegador no lo resuelve
    try {
      await Promise.race([loader.decode(), lbWait(800)]);
    } catch (_) { /* decode no disponible o ya decodificada */ }
    if (token !== LB.token) return;
    img.src = url;
    spinner.hidden = true;
    modal.classList.add('is-loaded');
    lbApply(false);
    lbUpdateGallery();
    lbPreloadNeighbors();
  };
  loader.onerror = () => {
    if (token !== LB.token) return;
    lbShowError('No se pudo cargar la imagen');
    lbUpdateGallery(); // aunque falle una foto se puede pasar a las demás
  };
  loader.src = url;
}

// Deja visible la capa de foto y detiene el vídeo
function lbShowPhotoLayer() {
  const { modal, img, video } = lbEls();
  lbvPause();
  video.hidden = true;
  img.hidden = false;
  modal.classList.remove('is-video', 'is-paused', 'is-idle');
  clearTimeout(LB.idleTimer);
}

// ---- Vídeo con controles propios ----
function lbvEls() {
  return {
    big: document.getElementById('lbv-big'),
    play: document.getElementById('lbv-play'),
    mute: document.getElementById('lbv-mute'),
    track: document.getElementById('lbv-track'),
    current: document.getElementById('lbv-current'),
    duration: document.getElementById('lbv-duration')
  };
}

function lbvFormat(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function lbShowVideo(url, poster) {
  const { modal, img, video, videoEl, spinner, error } = lbEls();
  img.hidden = true;
  img.removeAttribute('src');
  video.hidden = false;
  error.hidden = true;
  modal.classList.remove('is-error');
  modal.classList.add('is-video', 'is-loaded');
  if (poster) videoEl.poster = poster; else videoEl.removeAttribute('poster');
  if (videoEl.dataset.src !== url) {
    videoEl.dataset.src = url;
    videoEl.src = url;
  }
  videoEl.muted = LB.muted;
  spinner.hidden = videoEl.readyState >= 3;
  lbvUpdate();
  lbvPoke();
  lbvPlay();
}

// Reproduce; si el navegador no deja empezar con sonido, empieza en silencio
function lbvPlay() {
  const { videoEl } = lbEls();
  const attempt = videoEl.play();
  attempt?.catch?.((err) => {
    if (err?.name === 'NotAllowedError' && !videoEl.muted) {
      videoEl.muted = true;
      LB.muted = true;
      videoEl.play()?.catch?.(() => lbvUpdate());
    }
    lbvUpdate();
  });
}

function lbvPause() {
  const { videoEl } = lbEls();
  if (videoEl && !videoEl.paused) videoEl.pause();
}

function lbvToggle() {
  const { videoEl } = lbEls();
  if (videoEl.paused || videoEl.ended) lbvPlay(); else lbvPause();
  lbvPoke();
}

// Muestra los controles; mientras se reproduce se ocultan solos tras unos segundos
function lbvPoke() {
  const { modal, videoEl } = lbEls();
  modal.classList.remove('is-idle');
  clearTimeout(LB.idleTimer);
  if (lbIsVideo() && !videoEl.paused) {
    LB.idleTimer = setTimeout(() => { if (!videoEl.paused) modal.classList.add('is-idle'); }, 2600);
  }
}

// Toque sobre el vídeo: si los controles están ocultos los muestra; si no, pausa o reanuda
function lbvTap() {
  const { modal } = lbEls();
  if (modal.classList.contains('is-idle')) { lbvPoke(); return; }
  lbvToggle();
}

function lbvUpdate() {
  const { modal, videoEl } = lbEls();
  const { big, play, mute, track, current, duration } = lbvEls();
  const paused = videoEl.paused || videoEl.ended;
  modal.classList.toggle('is-paused', paused);
  modal.classList.toggle('is-muted', videoEl.muted);
  const playLabel = paused ? 'Reproducir' : 'Pausar';
  big?.setAttribute('aria-label', playLabel);
  play?.setAttribute('aria-label', playLabel);
  mute?.setAttribute('aria-label', videoEl.muted ? 'Activar sonido' : 'Silenciar');
  lbvProgress();
  if (duration) duration.textContent = lbvFormat(videoEl.duration);
  if (current) current.textContent = lbvFormat(videoEl.currentTime);
  if (track) track.setAttribute('aria-valuemax', String(Math.round(videoEl.duration || 0)));
}

function lbvProgress() {
  const { videoEl } = lbEls();
  const { track, current } = lbvEls();
  const d = videoEl.duration;
  const p = Number.isFinite(d) && d > 0 ? videoEl.currentTime / d : 0;
  if (track) {
    track.style.setProperty('--p', String(lbClamp(p, 0, 1)));
    track.setAttribute('aria-valuenow', String(Math.round(videoEl.currentTime)));
    track.setAttribute('aria-valuetext', `${lbvFormat(videoEl.currentTime)} de ${lbvFormat(d)}`);
  }
  if (current) current.textContent = lbvFormat(videoEl.currentTime);
}

// Primer fotograma listo (o un tope corto para no bloquear el siguiente gesto)
function lbvReady(ms = 400) {
  const { videoEl } = lbEls();
  if (videoEl.readyState >= 2) return Promise.resolve();
  return Promise.race([
    new Promise(resolve => videoEl.addEventListener('loadeddata', resolve, { once: true })),
    lbWait(ms)
  ]);
}

function initLightboxVideo() {
  const { modal, videoEl, spinner } = lbEls();
  const { big, play, mute, track } = lbvEls();
  if (!videoEl) return;

  const isCurrent = () => lbIsVideo() && !modal.classList.contains('hidden');
  ['play', 'pause', 'ended', 'loadedmetadata', 'durationchange', 'volumechange'].forEach(type =>
    videoEl.addEventListener(type, () => { lbvUpdate(); if (type !== 'volumechange') lbvPoke(); }));
  videoEl.addEventListener('timeupdate', lbvProgress);
  videoEl.addEventListener('waiting', () => { if (isCurrent()) spinner.hidden = false; });
  ['playing', 'canplay', 'loadeddata', 'pause'].forEach(type =>
    videoEl.addEventListener(type, () => { if (isCurrent()) spinner.hidden = true; }));
  videoEl.addEventListener('error', () => {
    if (isCurrent() && videoEl.getAttribute('src')) lbShowError('No se pudo cargar el vídeo');
  });

  big?.addEventListener('click', (e) => { e.stopPropagation(); lbvToggle(); });
  play?.addEventListener('click', (e) => { e.stopPropagation(); lbvToggle(); });
  mute?.addEventListener('click', (e) => {
    e.stopPropagation();
    videoEl.muted = !videoEl.muted;
    LB.muted = videoEl.muted;
    lbvPoke();
  });

  // Barra de progreso: se arrastra para avanzar o retroceder
  const seekTo = (clientX) => {
    const r = track.getBoundingClientRect();
    const d = videoEl.duration;
    if (!Number.isFinite(d) || d <= 0 || !r.width) return;
    videoEl.currentTime = lbClamp((clientX - r.left) / r.width, 0, 1) * d;
    lbvProgress();
  };
  let scrubbing = false;
  let wasPlaying = false;
  track?.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    scrubbing = true;
    wasPlaying = !videoEl.paused;
    lbvPause();
    try { track.setPointerCapture(e.pointerId); } catch (_) { /* puntero ya liberado */ }
    modal.classList.add('is-scrubbing');
    seekTo(e.clientX);
    lbvPoke();
  });
  track?.addEventListener('pointermove', (e) => { if (scrubbing) seekTo(e.clientX); });
  const endScrub = () => {
    if (!scrubbing) return;
    scrubbing = false;
    modal.classList.remove('is-scrubbing');
    if (wasPlaying) lbvPlay();
    lbvPoke();
  };
  track?.addEventListener('pointerup', endScrub);
  track?.addEventListener('pointercancel', endScrub);
  track?.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    e.stopPropagation(); // las flechas aquí mueven el vídeo, no pasan de elemento
    const d = videoEl.duration;
    if (!Number.isFinite(d)) return;
    videoEl.currentTime = lbClamp(videoEl.currentTime + (e.key === 'ArrowRight' ? 5 : -5), 0, d);
    lbvPoke();
  });

  // Con ratón, mover el puntero muestra los controles
  modal.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse' && isCurrent()) lbvPoke(); });
}

// ---- Pasar de un elemento a otro ----
// Coloca el elemento contiguo (dir = +1 siguiente, −1 anterior) fuera de pantalla, listo para entrar.
// Si es un vídeo se muestra su primer fotograma.
function lbPreparePeek(dir) {
  const { peek, peekVideo } = lbEls();
  const item = LB.items[LB.index + dir];
  if (!item) { lbHidePeek(); return false; }
  const el = item.type === 'video' ? peekVideo : peek;
  const other = el === peek ? peekVideo : peek;
  other.hidden = true;
  const src = item.type === 'video' ? `${item.url}#t=0.001` : item.url;
  if (item.type === 'video') { if (item.poster) el.poster = item.poster; else el.removeAttribute('poster'); }
  if (el.getAttribute('src') !== src) el.setAttribute('src', src);
  el.hidden = false;
  el.style.transition = 'none';
  LB.peekEl = el;
  LB.peekDir = dir;
  return true;
}

function lbSwipeTo(dx) {
  const { stage } = lbEls();
  const main = lbMain();
  const W = stage.clientWidth + LB.GAP;
  const dir = dx < 0 ? 1 : -1;
  const hasNeighbor = !!LB.items[LB.index + dir];
  const x = hasNeighbor ? dx : dx * 0.3; // resistencia en el primero y el último
  LB.x = x;
  main.style.transition = 'none';
  main.style.transform = `translate3d(${x}px, 0, 0) scale(1)`;
  if (hasNeighbor) {
    if (!LB.peekEl || LB.peekDir !== dir) lbPreparePeek(dir);
    LB.peekEl.style.transform = `translate3d(${x + dir * W}px, 0, 0)`; // el contiguo espera al lado contrario del dedo
  } else {
    lbHidePeek();
  }
}

// Termina el cambio con animación; dir = +1 siguiente, −1 anterior
async function lbCommit(dir) {
  const { stage, img, video, modal, error, spinner } = lbEls();
  const item = LB.items[LB.index + dir];
  if (!item || LB.busy) { lbBounceBack(); return; }
  LB.busy = true;
  const W = stage.clientWidth + LB.GAP;
  const animate = !lbReduced();
  const ease = 'transform 0.22s cubic-bezier(0.22, 1, 0.36, 1)';
  const main = lbMain();

  if (!LB.peekEl || LB.peekDir !== dir) {
    lbPreparePeek(dir);
    LB.peekEl.style.transform = `translate3d(${dir * W + LB.x}px, 0, 0)`;
    void LB.peekEl.offsetWidth; // fija la posición de salida antes de animar
  }
  const peek = LB.peekEl;
  if (animate) { main.style.transition = ease; peek.style.transition = ease; }
  main.style.transform = `translate3d(${-dir * W}px, 0, 0) scale(1)`;
  peek.style.transform = 'translate3d(0, 0, 0)';
  await lbWait(animate ? 220 : 0);

  // Cambio: el contiguo pasa a ser el principal sin parpadeo (sigue encima hasta que el nuevo está listo)
  LB.index += dir;
  lbUpdateGallery(); // contador y flechas al instante
  const myToken = ++LB.token;
  error.hidden = true; spinner.hidden = true;
  modal.classList.remove('is-zoomed', 'is-error');
  if (item.type === 'video') {
    lbShowVideo(item.url, item.poster);
    await lbvReady();
  } else {
    lbShowPhotoLayer();
    img.style.transition = 'none';
    img.src = item.url;
    try { await Promise.race([img.decode(), lbWait(250)]); } catch (_) { /* sin decode */ }
  }
  if (myToken !== LB.token) return;
  LB.scale = 1; LB.x = 0; LB.y = 0;
  [img, video].forEach(el => { el.style.transition = 'none'; el.style.transform = ''; });
  lbHidePeek();
  if (item.type === 'photo' && !img.naturalWidth) lbShowError('No se pudo cargar la imagen');
  lbApply(false);
  lbUpdateGallery();
  lbPreloadNeighbors();
  LB.busy = false;
}

function lbBounceBack() {
  const main = lbMain();
  const W = (lbEls().stage.clientWidth + LB.GAP);
  const dir = LB.peekDir;
  const peek = LB.peekEl;
  LB.x = 0;
  const ease = lbReduced() ? 'none' : 'transform 0.22s cubic-bezier(0.22, 1, 0.36, 1)';
  main.style.transition = ease;
  main.style.transform = 'translate3d(0, 0, 0) scale(1)';
  if (peek && !peek.hidden && dir) {
    peek.style.transition = ease;
    peek.style.transform = `translate3d(${dir * W}px, 0, 0)`;
    setTimeout(() => { if (!LB.busy && LB.x === 0) lbHidePeek(); }, 230);
  }
}

// Cambio desde botones o teclado
function lbGo(dir) {
  if (LB.busy || !LB.items[LB.index + dir]) return;
  if (LB.scale > 1.01) { LB.scale = 1; LB.x = 0; LB.y = 0; lbApply(false); }
  lbCommit(dir);
}

// Cerrar el visor
function closeImageLightbox() {
  const { modal, videoEl, peekVideo } = lbEls();
  if (!modal || modal.classList.contains('hidden') || modal.classList.contains('is-closing')) return;
  lbvPause();
  clearTimeout(LB.idleTimer);

  const finish = () => {
    LB.token++; // cancela cualquier carga pendiente
    LB.items = []; LB.index = 0;
    modal.classList.add('hidden');
    modal.classList.remove('is-closing', 'is-muted', 'is-scrubbing');
    lbReset();
    // Suelta los vídeos para que no sigan descargándose
    [videoEl, peekVideo].forEach(v => {
      if (!v?.getAttribute('src')) return;
      v.removeAttribute('src');
      v.load();
    });
    if (videoEl) delete videoEl.dataset.src;
    document.body.style.overflow = '';
    const app = document.getElementById('app');
    app?.removeAttribute('inert');
    app?.removeAttribute('aria-hidden');
    const opener = LB.opener; LB.opener = null;
    if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
  };

  if (lbReduced()) { finish(); return; }
  modal.classList.add('is-closing');
  setTimeout(finish, 180);
}

// Inicializar event listeners del visor
function initImageLightbox() {
  const { modal, stage, img } = lbEls();
  const closeBtn = document.getElementById('image-lightbox-close');
  if (!modal || !stage || !img) return;

  initLightboxVideo();

  closeBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    closeImageLightbox();
  });

  // Botones de zoom
  document.getElementById('image-lightbox-zoom')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-zoom]');
    if (!btn) return;
    e.stopPropagation();
    if (btn.dataset.zoom === 'in') lbZoomAt(LB.scale * 1.5);
    else if (btn.dataset.zoom === 'out') lbZoomAt(LB.scale / 1.5);
    else lbZoomAt(1);
  });

  // ---- Gestos con Pointer Events ----
  const onDown = (e) => {
    if (LB.busy) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    try { stage.setPointerCapture(e.pointerId); } catch (_) { /* puntero ya liberado */ }
    LB.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY, t: performance.now() });

    if (LB.pointers.size === 2 && !lbIsVideo()) {
      const [a, b] = [...LB.pointers.values()];
      const c = lbPoint({ clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 });
      LB.gesture = {
        type: 'pinch', startDist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        startScale: LB.scale, startX: LB.x, startY: LB.y, startMid: c
      };
    } else if (LB.pointers.size === 1) {
      LB.gesture = { type: LB.scale > 1.01 ? 'pan' : 'dismiss', startX: LB.x, startY: LB.y, moved: false };
    }
  };

  const onMove = (e) => {
    const p = LB.pointers.get(e.pointerId);
    if (!p || !LB.gesture) return;
    p.x = e.clientX; p.y = e.clientY;
    const g = LB.gesture;

    if (g.type === 'pinch' && LB.pointers.size >= 2) {
      const [a, b] = [...LB.pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const mid = lbPoint({ clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 });
      // Permite pasar un poco de los límites durante el gesto; al soltar se reajusta
      const s = lbClamp(g.startScale * dist / g.startDist, 0.7, LB.MAX * 1.15);
      const ratio = s / g.startScale;
      LB.scale = s;
      LB.x = mid.x - (g.startMid.x - g.startX) * ratio;
      LB.y = mid.y - (g.startMid.y - g.startY) * ratio;
      g.moved = true;
      modal.classList.add('is-dragging');
      lbApply(false);
    } else if (g.type === 'pan') {
      const dx = e.clientX - p.startX, dy = e.clientY - p.startY;
      if (Math.hypot(dx, dy) > 4) g.moved = true;
      const { maxX, maxY } = lbBounds();
      // Con resistencia al pasar el borde de la imagen
      const soft = (v, max) => (v > max ? max + (v - max) * 0.3 : v < -max ? -max + (v + max) * 0.3 : v);
      LB.x = soft(g.startX + dx, maxX);
      LB.y = soft(g.startY + dy, maxY);
      modal.classList.add('is-dragging');
      lbApply(false);
    } else if (g.type === 'dismiss') {
      const dy = e.clientY - p.startY, dx = e.clientX - p.startX;
      if (Math.abs(dy) > 6 || Math.abs(dx) > 6) g.moved = true;
      // El eje se fija con el primer movimiento claro: horizontal pasa de elemento, vertical cierra
      if (!g.axis && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
        g.axis = Math.abs(dx) > Math.abs(dy) && LB.items.length > 1 ? 'x' : 'y';
      }
      if (g.axis === 'x') {
        modal.classList.add('is-dragging');
        lbSwipeTo(dx);
      } else if (g.moved && dy > 0 && Math.abs(dy) > Math.abs(dx)) {
        LB.y = dy;
        modal.style.setProperty('--lb-dim', String(Math.max(0.25, 1 - dy / 420)));
        modal.classList.add('is-dragging');
        lbApply(false);
      }
    }
  };

  const onUp = (e) => {
    const p = LB.pointers.get(e.pointerId);
    if (!p) return;
    const g = LB.gesture;
    const now = performance.now();
    const dist = Math.hypot(e.clientX - p.startX, e.clientY - p.startY);
    const isTap = dist < 8 && now - p.t < 350;
    LB.pointers.delete(e.pointerId);
    try { stage.releasePointerCapture?.(e.pointerId); } catch (_) { /* ya liberado */ }

    if (g?.type === 'pinch') {
      if (LB.pointers.size === 0) { modal.classList.remove('is-dragging'); lbSettle(true); LB.gesture = null; }
      else {
        // Queda un dedo: sigue como arrastre desde su posición actual
        const [rest] = [...LB.pointers.values()];
        rest.startX = rest.x; rest.startY = rest.y;
        LB.gesture = { type: 'pan', startX: LB.x, startY: LB.y, moved: true };
      }
      return;
    }

    modal.classList.remove('is-dragging');
    if (LB.pointers.size > 0) return;
    LB.gesture = null;

    if (g?.type === 'dismiss' && g.axis === 'x') {
      const dx = e.clientX - p.startX;
      const velocity = Math.abs(dx) / Math.max(1, now - p.t);
      const W = lbEls().stage.clientWidth;
      const dir = dx < 0 ? 1 : -1;
      if ((Math.abs(dx) > W * 0.22 || (Math.abs(dx) > 30 && velocity > 0.45)) && LB.items[LB.index + dir]) lbCommit(dir);
      else lbBounceBack();
      return;
    }
    if (g?.type === 'dismiss' && g.moved && LB.y > 0) {
      const velocity = LB.y / Math.max(1, now - p.t);
      if (LB.y > 120 || (LB.y > 40 && velocity > 0.6)) { closeImageLightbox(); return; }
      LB.y = 0; modal.style.removeProperty('--lb-dim'); lbApply(true);
      return;
    }
    if (g?.type === 'pan') { lbSettle(true); }

    if (isTap && lbIsVideo()) { lbvTap(); return; }
    if (isTap) {
      const pt = lbPoint(e);
      const last = LB.lastTap;
      if (last && now - last.t < 320 && Math.hypot(pt.x - last.x, pt.y - last.y) < 30) {
        // Doble toque / doble clic: alterna entre ajustar y acercar al punto tocado
        LB.lastTap = null;
        if (LB.scale > 1.01) lbZoomAt(1, pt.x, pt.y); else lbZoomAt(LB.DOUBLE_TAP_SCALE, pt.x, pt.y);
        return;
      }
      LB.lastTap = { t: now, x: pt.x, y: pt.y };
      // Un toque fuera de la imagen (con zoom 1) cierra el visor
      const rect = img.getBoundingClientRect();
      const inside = e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
      if (!inside && LB.scale <= 1.01) closeImageLightbox();
    }
  };

  stage.addEventListener('pointerdown', onDown);
  stage.addEventListener('pointermove', onMove);
  stage.addEventListener('pointerup', onUp);
  stage.addEventListener('pointercancel', (e) => {
    LB.pointers.delete(e.pointerId);
    if (LB.pointers.size === 0) {
      const wasSwipe = LB.gesture?.axis === 'x';
      LB.gesture = null; modal.classList.remove('is-dragging'); modal.style.removeProperty('--lb-dim');
      if (wasSwipe) lbBounceBack(); else lbSettle(true);
    }
  });

  // Flechas visibles (con ratón) para pasar de elemento
  document.getElementById('image-lightbox-prev')?.addEventListener('click', (e) => { e.stopPropagation(); lbGo(-1); });
  document.getElementById('image-lightbox-next')?.addEventListener('click', (e) => { e.stopPropagation(); lbGo(1); });

  // Rueda del ratón y pellizco del trackpad (ctrlKey): zoom hacia el cursor
  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (lbIsVideo()) return;
    const pt = lbPoint(e);
    const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0022));
    lbZoomAt(LB.scale * factor, pt.x, pt.y, false);
  }, { passive: false });

  // La imagen no se arrastra como archivo ni abre menús contextuales de imagen
  img.addEventListener('dragstart', (e) => e.preventDefault());

  // Si cambia el tamaño de la ventana (o gira el móvil) se reajusta a los nuevos límites
  window.addEventListener('resize', () => {
    if (!modal.classList.contains('hidden')) lbSettle(false);
  });

  // Teclado
  document.addEventListener('keydown', (e) => {
    if (modal.classList.contains('hidden')) return;
    if (e.key === 'Escape') { e.preventDefault(); closeImageLightbox(); return; }
    if (lbIsVideo() && (e.key === ' ' || e.key === 'k') && !(e.target instanceof HTMLButtonElement)) {
      e.preventDefault(); lbvToggle(); return;
    }
    if (lbIsVideo() && e.key === 'm') { e.preventDefault(); document.getElementById('lbv-mute')?.click(); return; }
    if (e.key === '+' || e.key === '=') { e.preventDefault(); lbZoomAt(LB.scale * 1.5); }
    else if (e.key === '-' || e.key === '_') { e.preventDefault(); lbZoomAt(LB.scale / 1.5); }
    else if (e.key === '0') { e.preventDefault(); lbZoomAt(1); }
    else if (LB.scale <= 1.01 && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      lbGo(e.key === 'ArrowRight' ? 1 : -1);
    }
    else if (LB.scale > 1.01 && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
      e.preventDefault();
      const step = 60;
      if (e.key === 'ArrowLeft') LB.x += step;
      if (e.key === 'ArrowRight') LB.x -= step;
      if (e.key === 'ArrowUp') LB.y += step;
      if (e.key === 'ArrowDown') LB.y -= step;
      lbSettle(true);
    }
    // El foco se queda dentro del visor
    if (e.key === 'Tab') {
      const focusables = [...modal.querySelectorAll('button:not([disabled]), [tabindex="0"]')].filter(el => el.offsetParent !== null);
      if (!focusables.length) return;
      const first = focusables[0], last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
}

// Tirar hacia abajo desde arriba del todo recarga el feed (solo táctil)
function initFeedPullToRefresh() {
  const container = document.getElementById('feed-container');
  const view = document.getElementById('feed-view');
  if (!container || !view || container._kxPtr) return;
  container._kxPtr = true;

  if (getComputedStyle(view).position === 'static') view.style.position = 'relative';

  const indicator = document.createElement('div');
  indicator.className = 'kx-ptr';
  indicator.setAttribute('aria-hidden', 'true');
  indicator.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/></svg>';
  view.appendChild(indicator);

  const THRESHOLD = 70, MAX = 110;
  let startY = 0, startX = 0, pull = 0, tracking = false, refreshing = false;

  const place = (y, animate) => {
    indicator.style.transition = animate ? 'transform .25s ease, opacity .2s ease' : 'none';
    indicator.style.top = container.offsetTop + 'px';
    indicator.style.transform = `translate(-50%, ${y / 2 - 13}px)`;
    // Centrado en el hueco entre la línea de arriba y la primera publicación (el contenedor deja 14px de aire)
    indicator.style.opacity = y > 4 ? String(Math.min(1, y / 40)) : '0';
  };
  const setContent = (y, animate) => {
    container.style.transition = animate ? 'transform .25s ease' : 'none';
    container.style.transform = y ? `translateY(${y}px)` : '';
  };
  const reset = () => {
    pull = 0;
    indicator.classList.remove('is-ready', 'is-spinning');
    indicator.firstElementChild.style.transform = '';
    setContent(0, true);
    place(0, true);
  };

  container.addEventListener('touchstart', (e) => {
    if (refreshing || e.touches.length !== 1 || container.scrollTop > 0 ||
        document.body.classList.contains('kx-sheet-open')) { tracking = false; return; }
    startY = e.touches[0].clientY;
    startX = e.touches[0].clientX;
    tracking = true;
    pull = 0;
  }, { passive: true });

  container.addEventListener('touchmove', (e) => {
    if (!tracking) return;
    const dy = e.touches[0].clientY - startY;
    const dx = e.touches[0].clientX - startX;
    if (container.scrollTop > 0 || Math.abs(dx) > Math.abs(dy)) {
      if (pull) reset();
      tracking = false;
      return;
    }
    if (dy <= 0) { if (pull) reset(); return; }
    if (e.cancelable) e.preventDefault();
    pull = Math.min(MAX, dy * 0.5);
    setContent(pull, false);
    place(pull, false);
    indicator.classList.toggle('is-ready', pull >= THRESHOLD);
    indicator.firstElementChild.style.transform = `rotate(${pull * 3}deg)`;
  }, { passive: false });

  const end = async () => {
    if (!tracking) return;
    tracking = false;
    if (pull < THRESHOLD) { reset(); return; }
    refreshing = true;
    indicator.classList.add('is-spinning');
    indicator.firstElementChild.style.transform = '';
    setContent(56, true);
    place(56, true);
    try {
      await Promise.all([loadFeed({ silent: true }), new Promise(r => setTimeout(r, 600))]);
    } catch (_) {
      if (typeof showToast === 'function') showToast('No se pudo actualizar', 'error');
    }
    refreshing = false;
    reset();
  };
  container.addEventListener('touchend', end);
  container.addEventListener('touchcancel', end);
}

// Pulsar el logo sube el feed hasta arriba del todo
function initFeedScrollTop() {
  const logo = document.getElementById('feed-wordmark');
  const container = document.getElementById('feed-container');
  if (!logo || !container || logo._kxTop) return;
  logo._kxTop = true;

  const goTop = () => {
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    logo.classList.remove('is-tapped');
    void logo.offsetWidth;
    if (!reduce) logo.classList.add('is-tapped');
    // En escritorio es la propia vista la que se desplaza
    [container, document.getElementById('feed-view')].forEach(el => {
      if (el && el.scrollTop > 0) el.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
    });
  };
  logo.addEventListener('click', goTop);
  logo.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goTop(); }
  });
  logo.addEventListener('animationend', () => logo.classList.remove('is-tapped'));
}

function initFeed() {
  // Load feed from Firebase (will fallback to mock if empty)
  loadFeed();
  initFeedPullToRefresh();
  initFeedScrollTop();

  // Initialize feed tabs
  initFeedTabs();

  initFeedSheets();
  updateFeedComposer();
}

function initFeedTabs() {
  // Filter functionality removed
}

// Fila "¿Qué quieres compartir?": es el propio #nav-create-btn, así que initCreatePost la engancha
// y abre el flujo real de crear publicación (validaciones, fotos y envío incluidos).
// Última sesión conocida: pinta la foto del compositor al instante mientras Firebase restaura la sesión
const KX_LAST_USER_KEY = 'kx-last-user';
function kxReadLastUser() {
  try { return JSON.parse(localStorage.getItem(KX_LAST_USER_KEY) || 'null'); } catch (_) { return null; }
}
function kxWriteLastUser(u) {
  try {
    if (u) localStorage.setItem(KX_LAST_USER_KEY, JSON.stringify({ photo: u.photoURL || '', name: u.displayName || u.email || 'Usuario' }));
    else localStorage.removeItem(KX_LAST_USER_KEY);
  } catch (_) { /* sin almacenamiento */ }
}

function updateFeedComposer(user) {
  const avatar = document.getElementById('feed-composer-avatar');
  if (!avatar) return;
  const u = user || (typeof currentUser !== 'undefined' ? currentUser : null);
  // user === null llega desde auth con la sesión ya resuelta (cerrada); undefined es el arranque
  if (user !== undefined) kxWriteLastUser(user);
  if (!u && user === undefined) {
    const last = kxReadLastUser();
    if (last) {
      // Ya la puso el script de index.html: no la recargamos para que no parpadee
      if (!avatar.getAttribute('src')) setAvatarWithFallback(avatar, last.photo, last.name, 80);
      return;
    }
  }
  // Misma foto ya pintada (script de arranque o sesión anterior): no la recargamos, así no parpadea
  if (u && u.photoURL && avatar.getAttribute('src') === u.photoURL && avatar.complete && avatar.naturalWidth) return;
  setAvatarWithFallback(avatar, u ? u.photoURL : '', u ? (u.displayName || u.email || 'Usuario') : 'Usuario', 80);
}

// Hojas del feed en móvil: mensajes y avisos ocupan la pantalla y se cierran con su botón.
// La lupa abre la vista de Buscar (sus listeners los registra initGlobalSearch).
// ---------- Paneles inferiores del feed: mensajes y notificaciones ----------
// initMessages / initNotifications siguen abriendo y cerrando con la clase .hidden; aquí solo se
// reacciona a esos cambios (MutationObserver) para bloquear el fondo, gestionar el foco y los gestos.
const FEED_SHEET_IDS = ['messages-dropdown', 'notification-dropdown', 'search-sheet', 'route-report-sheet'];
const FEED_SHEET_CLOSE_MS = 200;
let feedSheetOpener = null;
let feedSheetScroll = null;

function feedPrefersReducedMotion() {
  return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function getOpenFeedSheet() {
  return FEED_SHEET_IDS.map(id => document.getElementById(id)).find(el => el && !el.classList.contains('hidden')) || null;
}

// Cierre con animación (botón, fondo, Escape, gesto). El resto del código cierra al instante con .hidden.
function closeFeedSheet(sheet = getOpenFeedSheet()) {
  if (!sheet || sheet.classList.contains('hidden') || sheet.classList.contains('is-closing')) return;
  if (feedPrefersReducedMotion()) {
    sheet.classList.add('hidden');
    return;
  }
  sheet.classList.add('is-closing');
  const panel = sheet.querySelector('.kx-sheet-panel');
  if (panel) panel.style.transform = '';
  setTimeout(() => sheet.classList.add('hidden'), FEED_SHEET_CLOSE_MS);
}

function onFeedSheetsChanged() {
  const open = getOpenFeedSheet();
  const app = document.getElementById('app');
  const feedView = document.getElementById('feed-view');
  const feedList = document.getElementById('feed-container');

  if (open && !document.body.classList.contains('kx-sheet-open')) {
    // Apertura: se guarda el foco y la posición del feed; la app de fondo queda inerte
    // Foco de vuelta: el icono que abre el panel (data-trigger) o, si no, el elemento activo
    const trigger = open.dataset.trigger && document.getElementById(open.dataset.trigger);
    feedSheetOpener = trigger || (document.activeElement instanceof HTMLElement && !open.contains(document.activeElement) ? document.activeElement : null);
    feedSheetScroll = { view: feedView?.scrollTop || 0, list: feedList?.scrollTop || 0 };
    document.body.classList.add('kx-sheet-open');
    app?.setAttribute('inert', '');
    app?.setAttribute('aria-hidden', 'true');
    window.visualViewport?.addEventListener('resize', syncFeedSheetViewport);
    window.visualViewport?.addEventListener('scroll', syncFeedSheetViewport);
  }
  if (open) syncFeedSheetViewport();
  if (open && !open.contains(document.activeElement)) {
    open.querySelector('.kx-sheet-panel')?.focus({ preventScroll: true });
  }

  FEED_SHEET_IDS.forEach(id => {
    const sheet = document.getElementById(id);
    if (sheet && sheet.classList.contains('hidden')) {
      // Solo si está: classList.remove reescribe el atributo aunque no cambie y el observer entraría en bucle
      if (sheet.classList.contains('is-closing')) sheet.classList.remove('is-closing');
      const panel = sheet.querySelector('.kx-sheet-panel');
      if (panel) {
        panel.style.transform = '';
        panel.style.transition = '';
      }
    }
  });

  if (!open && document.body.classList.contains('kx-sheet-open')) {
    // Cierre: se libera la app, se recupera la posición del feed y el foco
    document.body.classList.remove('kx-sheet-open');
    app?.removeAttribute('inert');
    app?.removeAttribute('aria-hidden');
    window.visualViewport?.removeEventListener('resize', syncFeedSheetViewport);
    window.visualViewport?.removeEventListener('scroll', syncFeedSheetViewport);
    if (feedSheetScroll) {
      if (feedView) feedView.scrollTop = feedSheetScroll.view;
      if (feedList) feedList.scrollTop = feedSheetScroll.list;
    }
    if (feedSheetOpener && document.contains(feedSheetOpener)) {
      feedSheetOpener.focus({ preventScroll: true });
    }
    feedSheetOpener = null;
  }
}

// Teclado virtual: el panel se apoya sobre el teclado y su altura se limita al área visible
function syncFeedSheetViewport() {
  const open = getOpenFeedSheet();
  const vv = window.visualViewport;
  if (!open || !vv) return;
  const keyboard = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
  open.style.setProperty('--sheet-kb', `${keyboard}px`);
  open.style.setProperty('--sheet-avail', `${vv.height}px`);
}

// Gesto: arrastrar el tirador o la cabecera hacia abajo cierra el panel
function attachFeedSheetDrag(sheet) {
  const zone = sheet.querySelector('.kx-sheet-drag');
  const panel = sheet.querySelector('.kx-sheet-panel');
  if (!zone || !panel) return;
  let startY = null;
  let startTime = 0;
  let dy = 0;

  zone.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('button, input, a')) return;
    startY = e.clientY;
    startTime = performance.now();
    dy = 0;
    panel.style.transition = 'none';
    try { zone.setPointerCapture(e.pointerId); } catch (_) { /* puntero sintético o ya liberado */ }
  });
  zone.addEventListener('pointermove', (e) => {
    if (startY === null) return;
    dy = Math.max(0, e.clientY - startY);
    panel.style.transform = `translateY(${dy}px)`;
  });
  const end = () => {
    if (startY === null) return;
    const velocity = dy / Math.max(1, performance.now() - startTime);
    startY = null;
    panel.style.transition = '';
    if (dy > 110 || (dy > 30 && velocity > 0.6)) {
      closeFeedSheet(sheet);
    } else {
      panel.style.transform = '';
    }
  };
  zone.addEventListener('pointerup', end);
  zone.addEventListener('pointercancel', end);
}

function initFeedSheetBehavior() {
  const sheets = FEED_SHEET_IDS.map(id => document.getElementById(id)).filter(Boolean);
  if (!sheets.length) return;
  const observer = new MutationObserver(onFeedSheetsChanged);
  sheets.forEach(sheet => {
    observer.observe(sheet, { attributes: true, attributeFilter: ['class'] });
    attachFeedSheetDrag(sheet);
  });

  document.addEventListener('keydown', (e) => {
    const open = getOpenFeedSheet();
    if (!open) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      closeFeedSheet(open);
      return;
    }
    // Foco atrapado dentro del panel
    if (e.key === 'Tab') {
      const focusables = [...open.querySelectorAll('button:not([disabled]), input, [tabindex="0"]')]
        .filter(el => el.offsetParent !== null && !el.closest('[hidden]'));
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && (document.activeElement === first || !open.contains(document.activeElement))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  });
}

function initFeedSheets() {
  initFeedSheetBehavior();

  document.addEventListener('click', (e) => {
    const closeBtn = e.target.closest('[data-sheet-close]');
    if (closeBtn) {
      closeFeedSheet(closeBtn.closest('.kx-sheet'));
      return;
    }
    // En móvil el menú de una publicación es una hoja inferior: tocar el fondo la cierra
    if (e.target.classList && e.target.classList.contains('feed-post-menu-dropdown')) {
      e.target.classList.add('hidden');
    }
  });

}

// Publicaciones de demostración SOLO para localhost sin sesión (datos ficticios, nada se guarda)
function renderLocalPreviewFeed(container) {
  const foto = './Visuales/Sectores/Fotos/Pico%20de%20la%20Muela.JPG';
  const demo = [
    { id: 'demo1', userId: 'demo', userName: 'Diego', time: 'hace 2 h', type: 'photo', photos: [foto],
      location: { name: 'Toledo, Castilla-La Mancha, Spain', lat: 39.86, lng: -4.02 }, likes: new Array(28).fill('x'), liked: true, commentsCount: 3,
      content: 'Fin de semana digitalizando la escuela de Toledo. ¡Qué buen ambiente y vías increíbles!' },
    { id: 'demo2', userId: 'demo', userName: 'Krux', time: 'hace 1 día', type: 'photo', photos: [foto, foto],
      location: 'Valeria, Cuenca', likes: [], commentsCount: 0, bookmarked: true,
      content: 'Fin de semana en Valeria.\nBuen tiempo y compañía.' },
    { id: 'demo3', userId: 'demo', userName: 'Claudia Ballesteros', time: 'hace 3 días', type: 'text', likes: new Array(4).fill('x'), commentsCount: 1,
      content: 'Publicación solo de texto para ver el interlineado y el ancho de lectura en pantallas estrechas.' }
  ];
  demo.forEach(post => renderPostCard(post, container));
  attachFeedEventListeners(container);
}

// Render mock feed using new editorial style
function renderMockFeed() {
  const container = document.getElementById('feed-container');
  if (!container) return;

  container.innerHTML = '';

  MOCK_FEED.forEach(post => {
    // Use unified renderPostCard for consistency
    renderPostCard(post, container);
  });

  // Attach event listeners
  attachFeedEventListeners(container);
}

// ================================
// ENHANCED PROFILE DATA & LOGIC
// ================================

// Mock Profile Data
const MOCK_PROFILE = {
  username: "lillo.climb",
  name: "Jaime Lillo",
  category: "🧗” Escalador · Boulder & Deportiva",
  bio: "Escalador desde 2018\n📍 Madrid, España\nÃ°Å¸Ââ€Ã¯Â¸Â Amante de las paredes de caliza",
  avatar: "https://ui-avatars.com/api/?name=Jaime+Lillo&background=153E35&color=fff&size=200&bold=true",
  stats: {
    posts: 24,
    followers: 1247,
    following: 389
  },
  climbingStats: {
    totalAscents: 156,
    maxGrade: "7c+",
    zonesVisited: 12
  },
  posts: [
    { id: 1, image: "https://images.unsplash.com/photo-1522163182402-834f871fd851?ixlib=rb-1.2.1&auto=format&fit=crop&w=400&q=80" },
    { id: 2, image: "https://images.unsplash.com/photo-1564769662533-4f00a87b4056?ixlib=rb-1.2.1&auto=format&fit=crop&w=400&q=80" },
    { id: 3, image: "https://images.unsplash.com/photo-1601227329356-6c464c489716?ixlib=rb-1.2.1&auto=format&fit=crop&w=400&q=80" },
    { id: 4, image: "https://images.unsplash.com/photo-1516592673884-4a382d1124c2?ixlib=rb-1.2.1&auto=format&fit=crop&w=400&q=80" },
    { id: 5, image: "https://images.unsplash.com/photo-1505567745926-ba89000d255a?ixlib=rb-1.2.1&auto=format&fit=crop&w=400&q=80" },
    { id: 6, image: "https://images.unsplash.com/photo-1459231978203-b7d0c47a2cb7?ixlib=rb-1.2.1&auto=format&fit=crop&w=400&q=80" },
    { id: 7, image: "https://images.unsplash.com/photo-1522163182402-834f871fd851?ixlib=rb-1.2.1&auto=format&fit=crop&w=400&q=80" },
    { id: 8, image: "https://images.unsplash.com/photo-1564769662533-4f00a87b4056?ixlib=rb-1.2.1&auto=format&fit=crop&w=400&q=80" },
    { id: 9, image: "https://images.unsplash.com/photo-1601227329356-6c464c489716?ixlib=rb-1.2.1&auto=format&fit=crop&w=400&q=80" }
  ],
  ascents: [
    { id: 1, name: "La Rambla", grade: "7c+", location: "Siurana", date: "15 Nov 2024", style: "Redpoint" },
    { id: 2, name: "Catxasa", grade: "7b", location: "Margalef", date: "10 Nov 2024", style: "Flash" },
    { id: 3, name: "El Chorro Express", grade: "7a+", location: "El Chorro", date: "5 Nov 2024", style: "Onsight" },
    { id: 4, name: "Desplome del Makinodromo", grade: "7b+", location: "Patones", date: "28 Oct 2024", style: "Redpoint" },
    { id: 5, name: "Fisura del Abuelo", grade: "6c", location: "La Pedriza", date: "20 Oct 2024", style: "Flash" },
    { id: 6, name: "Placas de Valeria", grade: "7a", location: "Valeria, Cuenca", date: "15 Oct 2024", style: "Onsight" },
    { id: 7, name: "Diedro MÃ¡gico", grade: "6b+", location: "Cuenca", date: "10 Oct 2024", style: "Flash" },
    { id: 8, name: "Techo Central", grade: "7c", location: "Rodellar", date: "1 Oct 2024", style: "Redpoint" }
  ],
  saved: [
    { id: 1, name: "Action Directe", grade: "9a", type: "Proyecto" },
    { id: 2, name: "Biographie", grade: "9a+", type: "SueÃ±o" },
    { id: 3, name: "La Dura Dura", grade: "9b+", type: "InspiraciÃ³n" }
  ],
  followers: [
    { id: 1, username: "alex_climber", name: "Alex GarcÃ­a", avatar: "https://ui-avatars.com/api/?name=Alex+Garcia&background=random&size=100" },
    { id: 2, username: "maria_rock", name: "MarÃ­a RodrÃ­guez", avatar: "https://ui-avatars.com/api/?name=Maria+Rodriguez&background=random&size=100" },
    { id: 3, username: "pablo_boulder", name: "Pablo MartÃ­n", avatar: "https://ui-avatars.com/api/?name=Pablo+Martin&background=random&size=100" }
  ],
  following: [
    { id: 1, username: "chris_sharma", name: "Chris Sharma", avatar: "https://ui-avatars.com/api/?name=Chris+Sharma&background=random&size=100" },
    { id: 2, username: "adam_ondra", name: "Adam Ondra", avatar: "https://ui-avatars.com/api/?name=Adam+Ondra&background=random&size=100" },
    { id: 3, username: "alex_megos", name: "Alex Megos", avatar: "https://ui-avatars.com/api/?name=Alex+Megos&background=random&size=100" }
  ]
};

async function initProfile() {
  const authUser = firebase.auth().currentUser;
  if (!authUser) return;

  // FIX: No ejecutar si estamos viendo un perfil ajeno
  if (currentProfileUserId) {
    console.log('[initProfile] Skipped - viewing other profile:', currentProfileUserId);
    return;
  }

  // Configure profile view for own profile (hide back button, show settings)
  configureProfileViewForOwnProfile();

  // 1. Basic Info (from Auth & Firestore)
  const avatarEl = document.getElementById('profile-avatar');
  if (avatarEl) {
    setAvatarWithFallback(avatarEl, authUser.photoURL, authUser.displayName || authUser.email, 150);
  }

  // Fetch full user doc for bio/location/stats
  let userStats = { totalAscents: 0, followersCount: 0, followingCount: 0 };
  try {
    const userDoc = await db.collection('users').doc(authUser.uid).get();
    if (userDoc.exists) {
      const data = userDoc.data();

      const nameEl = document.getElementById('profile-name');
      if (nameEl) nameEl.textContent = data.displayName || authUser.displayName;

      const bioEl = document.getElementById('profile-bio');
      if (bioEl) bioEl.textContent = data.bio || 'Sin biografí­a';

      const locationEl = document.getElementById('profile-location');
      if (locationEl) locationEl.textContent = data.location || 'España';

      const categoryEl = document.getElementById('profile-category');
      if (categoryEl && data.category) {
        categoryEl.innerHTML = `<span>${data.category}</span>`;
      }

      // Update avatar from Firestore (takes priority over Auth)
      const avatarEl = document.getElementById('profile-avatar');
      if (avatarEl) {
        const photoURL = data.photoURL || authUser.photoURL;
        const userName = data.displayName || authUser.displayName || authUser.email;
        setAvatarWithFallback(avatarEl, photoURL, userName, 150);
      }

      if (data.stats) {
        userStats = { ...userStats, ...data.stats };
      }
    }
  } catch (e) {
    console.error("Error loading profile data", e);
  }

  // 2. Stats Counters
  const postsStat = document.getElementById('stat-posts');
  const postsCount = await getUserPostsCount(authUser.uid);
  if (postsStat) postsStat.textContent = postsCount;

  // FIX: Get real follower/following counts (matching actual existing users)
  const [realFollowersCount, realFollowingCount] = await Promise.all([
    getRealFollowersCount(authUser.uid),
    getRealFollowingCount(authUser.uid)
  ]);

  const followersStat = document.getElementById('stat-followers');
  if (followersStat) followersStat.textContent = realFollowersCount;

  const followingStat = document.getElementById('stat-following');
  if (followingStat) followingStat.textContent = realFollowingCount;

  // 3. Climbing Stats (Real calculation)
  const ascents = await getUserAscents();
  const projects = getProjects();

  const totalAscentsEl = document.getElementById('total-ascents');
  if (totalAscentsEl) totalAscentsEl.textContent = ascents.length || userStats.totalAscents || 0;

  // Calculate Max Grade using compareGradesLocal
  let maxGrade = '-';
  if (ascents.length > 0) {
    const grades = ascents
      .map(a => a.grade)
      .filter(g => g && g.trim() !== '');
    if (grades.length > 0) {
      const compareFunc = typeof compareGradesLocal === 'function' ? compareGradesLocal : (a, b) => a.localeCompare(b);
      maxGrade = grades.sort(compareFunc).reverse()[0];
    }
  }

  const maxGradeEl = document.getElementById('max-grade');
  if (maxGradeEl) maxGradeEl.textContent = maxGrade;

  // Unique zones (filter empty schoolNames)
  const zones = new Set(
    ascents.map(a => a.schoolName).filter(z => z && z.trim() !== '')
  );
  const zonesVisitedEl = document.getElementById('zones-visited');
  if (zonesVisitedEl) zonesVisitedEl.textContent = zones.size;

  // Populate Posts Grid - IMPORTANTE: esperar a que termine antes de continuar
  await renderProfileGrid();

  // Tab switching - solo inicializar despuÃ©s de que el grid estÃ© listo
  initProfileTabs();

  // Setup social buttons for own profile
  setupProfileSocialButtonsForUser(authUser.uid);
}

// Load user posts count
async function getUserPostsCount(userId) {
  try {
    const snapshot = await db.collection('posts')
      .where('userId', '==', userId)
      .get();
    return snapshot.size;
  } catch (error) {
    console.error('Error getting posts count:', error);
    return 0;
  }
}

// Load user posts for profile
async function loadUserPosts(userId) {
  const uidToUse = userId;
  const firestore = firebase.firestore();

  // Detectar si estamos en mÃ³vil (Capacitor) - necesita más tiempo de sincronizaciÃ³n
  const isMobile = window.Capacitor !== undefined;
  const baseDelay = isMobile ? 800 : 500;

  const executeQuery = async () => {
    const snapshot = await firestore.collection('posts')
      .where('userId', '==', uidToUse)
      .limit(50)
      .get();
    return snapshot;
  };

  try {
    // Primer intento
    let snapshot = await executeQuery();

    // Si no hay resultados, Firestore puede estar sincronizando - reintentar
    if (snapshot.size === 0) {
      await new Promise(resolve => setTimeout(resolve, baseDelay));
      snapshot = await executeQuery();
    }

    // Segundo reintento
    if (snapshot.size === 0) {
      await new Promise(resolve => setTimeout(resolve, baseDelay * 1.5));
      snapshot = await executeQuery();
    }

    // Tercer reintento (solo mÃ³vil)
    if (snapshot.size === 0 && isMobile) {
      await new Promise(resolve => setTimeout(resolve, baseDelay * 2));
      snapshot = await executeQuery();
    }

    const posts = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      posts.push({
        id: doc.id,
        ...data,
        photos: data.photos || (data.photo ? [data.photo] : []),
        time: data.createdAt ? formatTimeAgo(data.createdAt.toDate()) : 'Ahora'
      });
    });

    // Ordenar por fecha (más reciente primero)
    posts.sort((a, b) => {
      const timeA = a.createdAt?.toDate?.() || a.createdAt || new Date(0);
      const timeB = b.createdAt?.toDate?.() || b.createdAt || new Date(0);
      return timeB - timeA;
    });

    return posts;
  } catch (error) {
    console.error('Error loading user posts:', error);

    // If index error, try without orderBy as fallback
    if (error.code === 'failed-precondition' || error.message.includes('index')) {
      console.warn('Index missing, loading posts without orderBy');
      try {
        const snapshot = await db.collection('posts')
          .where('userId', '==', userId)
          .limit(50)
          .get();

        const posts = [];
        snapshot.forEach(doc => {
          const data = doc.data();
          posts.push({
            id: doc.id,
            ...data,
            photos: data.photos || (data.photo ? [data.photo] : []),
            time: data.createdAt ? formatTimeAgo(data.createdAt.toDate()) : 'Ahora'
          });
        });

        // Sort manually by createdAt
        posts.sort((a, b) => {
          const aTime = a.createdAt?.toDate?.() || new Date(0);
          const bTime = b.createdAt?.toDate?.() || new Date(0);
          return bTime - aTime;
        });

        return posts;
      } catch (fallbackError) {
        console.error('Fallback query also failed:', fallbackError);
        return [];
      }
    }

    return [];
  }
}

async function renderProfileGrid() {
  const grid = document.getElementById('profile-grid');
  if (!grid) return;

  const authUser = firebase.auth().currentUser;

  if (!authUser) {
    grid.innerHTML = '<div class="empty-message" style="text-align: center; padding: 20px;">Inicia sesión para ver tus publicaciones</div>';
    return;
  }

  // Show loading
  grid.innerHTML = '<div class="empty-message" style="text-align: center; padding: 20px;">Cargando publicaciones...</div>';

  try {
    const posts = await loadUserPosts(authUser.uid);

    if (posts.length === 0) {
      grid.innerHTML = '<div class="empty-message" style="text-align: center; padding: 40px 20px;"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin: 0 auto 16px; opacity: 0.5;"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg><p style="margin: 0; color: #6b7280;">No hay publicaciones aún</p><p style="margin: 8px 0 0; color: #9ca3af; font-size: 14px;">Comparte tu primera publicación</p></div>';
      return;
    }

    // Load user's likes and bookmarks if logged in
    if (authUser && posts.length > 0) {
      const userId = authUser.uid;

      try {
        // Get user's savedPosts array (single read instead of multiple)
        const userDoc = await db.collection('users').doc(userId).get();
        const userData = userDoc.exists ? userDoc.data() : {};
        const savedPosts = new Set(userData.savedPosts || []);

        // Check likes from each post's likes array
        posts.forEach(post => {
          // Check if user liked this post (likes is an array of UIDs)
          const likesArray = post.likes || [];
          post.liked = Array.isArray(likesArray) && likesArray.includes(userId);

          // Update likes count to be the array length
          post.likesCount = Array.isArray(likesArray) ? likesArray.length : (typeof likesArray === 'number' ? likesArray : 0);

          // Check if user saved this post
          post.bookmarked = savedPosts.has(post.id);
        });
      } catch (error) {
        console.error('Error loading user interactions:', error);
        // Continue without user interaction data
      }
    }

    grid.innerHTML = '';

    // Render each post using the same component as the feed
    posts.forEach(post => {
      renderPostCard(post, grid);
    });

    // Attach event listeners (same as feed)
    attachFeedEventListeners(grid);

  } catch (error) {
    console.error('Error rendering profile grid:', error);
    grid.innerHTML = '<div class="empty-message" style="text-align: center; padding: 20px; color: #ef4444;">Error al cargar las publicaciones</div>';
  }
}

// Render liked posts
async function renderLikedPosts() {
  const grid = document.getElementById('profile-liked-grid');
  if (!grid) return;

  // Usar firebase.auth().currentUser directamente
  const authUser = firebase.auth().currentUser;

  if (!authUser) {
    grid.innerHTML = '<div class="empty-message" style="text-align: center; padding: 20px;">Inicia sesión para ver tus publicaciones favoritas</div>';
    return;
  }

  // Show loading
  grid.innerHTML = '<div class="empty-message" style="text-align: center; padding: 20px;">Cargando publicaciones...</div>';

  try {
    // Get all posts where the user has liked
    const userId = authUser.uid;
    const allPostsSnapshot = await db.collection('posts')
      .orderBy('createdAt', 'desc')
      .limit(100)
      .get();

    const likedPosts = [];
    allPostsSnapshot.forEach(doc => {
      const data = doc.data();
      const likesArray = data.likes || [];

      // Check if current user liked this post
      if (Array.isArray(likesArray) && likesArray.includes(userId)) {
        likedPosts.push({
          id: doc.id,
          ...data,
          photos: data.photos || (data.photo ? [data.photo] : []),
          time: data.createdAt ? formatTimeAgo(data.createdAt.toDate()) : 'Ahora',
          liked: true,
          likesCount: likesArray.length
        });
      }
    });

    // Sort by creation date (most recent first)
    likedPosts.sort((a, b) => {
      const aTime = a.createdAt?.toDate?.() || new Date(0);
      const bTime = b.createdAt?.toDate?.() || new Date(0);
      return bTime - aTime;
    });

    if (likedPosts.length === 0) {
      grid.innerHTML = '<div class="empty-message" style="text-align: center; padding: 40px 20px;"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin: 0 auto 16px; opacity: 0.5;"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg><p style="margin: 0; color: #6b7280;">No has dado me gusta a ninguna publicación</p><p style="margin: 8px 0 0; color: #9ca3af; font-size: 14px;">Explora el feed para descubrir contenido</p></div>';
      return;
    }

    // Load user's savedPosts for bookmark status
    try {
      const userDoc = await db.collection('users').doc(userId).get();
      const userData = userDoc.exists ? userDoc.data() : {};
      const savedPosts = new Set(userData.savedPosts || []);

      likedPosts.forEach(post => {
        post.bookmarked = savedPosts.has(post.id);
      });
    } catch (error) {
      console.error('Error loading user bookmarks:', error);
    }

    grid.innerHTML = '';

    // Render each liked post using the same component as the feed
    likedPosts.forEach(post => {
      renderPostCard(post, grid);
    });

    // Attach event listeners (same as feed)
    attachFeedEventListeners(grid);

  } catch (error) {
    console.error('Error rendering liked posts:', error);
    grid.innerHTML = '<div class="empty-message" style="text-align: center; padding: 20px; color: #ef4444;">Error al cargar las publicaciones</div>';
  }
}

function renderAscentsListContent(ascents) {
  const list = document.getElementById('ascents-list');
  if (!list) return;

  list.innerHTML = '';

  if (!ascents || ascents.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon"x”</div>
        <div class="empty-state-text">No hay ascensiones registradas</div>
      </div>
    `;
    return;
  }

  ascents.forEach(ascent => {
    const item = document.createElement('div');
    item.className = 'ascent-item';

    // Format date
    const dateObj = ascent.date instanceof Date ? ascent.date : new Date(ascent.date);
    const dateStr = dateObj.toLocaleDateString();

    item.innerHTML = `
      <div class="ascent-grade">${ascent.grade}</div>
      <div class="ascent-info">
        <div class="ascent-name">${ascent.routeName}</div>
        <div class="ascent-location">📍 ${ascent.schoolName} ${ascent.sector ? '• ' + ascent.sector : ''}</div>
      </div>
      <div class="ascent-meta">
        <div class="ascent-date">${dateStr}</div>
        <div class="ascent-style">${ascent.style}</div>
      </div>
    `;
    list.appendChild(item);
  });
}

function renderSavedList(projects) {
  const list = document.getElementById('saved-list');
  if (!list) return;

  if (!projects || projects.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">x“</div>
        <div class="empty-state-text">No tienes proyectos guardados</div>
      </div>
    `;
    return;
  }

  list.innerHTML = '';
  projects.forEach(project => {
    const item = document.createElement('div');
    item.className = 'ascent-item'; // Reuse style
    item.innerHTML = `
      <div class="ascent-grade" style="background: #FFC107; color: #000;">${project.grade || '?'}</div>
      <div class="ascent-info">
        <div class="ascent-name">${project.name}</div>
        <div class="ascent-location">🎯 Intento</div>
      </div>
      <div class="ascent-meta">
        <button class="icon-btn" onclick="toggleProject('${project.id}', '${project.name}', '${project.grade}')">
          x
        </button>
      </div>
    `;
    list.appendChild(item);
  });
}

function initProfileTabs() {
  const tabs = document.querySelectorAll('.profile-tab[data-tab]');
  const contents = document.querySelectorAll('.profile-tab-content');

  tabs.forEach(tab => {
    // Clone and replace to remove old event listeners
    const newTab = tab.cloneNode(true);
    tab.parentNode.replaceChild(newTab, tab);

    newTab.addEventListener('click', async () => {
      const targetTab = newTab.dataset.tab;

      // Update all tabs (including the newly cloned ones)
      const allTabs = document.querySelectorAll('.profile-tab[data-tab]');
      allTabs.forEach(t => t.classList.remove('active'));
      newTab.classList.add('active');

      // Update content
      contents.forEach(content => {
        if (content.id === `tab-${targetTab}`) {
          content.classList.add('active');
        } else {
          content.classList.remove('active');
        }
      });

      // Load content for the selected tab based on current profile context
      if (targetTab === 'liked') {
        if (currentProfileUserId) {
          await loadProfileLikedPostsForUser(currentProfileUserId, profileLoadingState.currentLoadId);
        } else {
          await renderLikedPosts();
        }
      } else if (targetTab === 'posts') {
        if (currentProfileUserId) {
          await loadProfilePostsForUser(currentProfileUserId, profileLoadingState.currentLoadId);
        } else {
          await renderProfileGrid();
        }
      } else if (targetTab === 'mentions') {
        if (currentProfileUserId) {
          loadProfileMentionsForUser(currentProfileUserId, profileLoadingState.currentLoadId);
        } else {
          renderMentionsPosts();
        }
      }
    });
  });
}

// ================== FOLLOWERS/FOLLOWING LISTS ==================

/**
 * Initialize social list modal (close button and backdrop)
 * Called once on page load
 */
function initSocialListModal() {
  const modal = document.getElementById('social-list-modal');
  const closeBtn = document.getElementById('close-social-list-modal');

  if (!modal) return;

  // Close button
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      modal.classList.add('hidden');
    });
  }

  // Close on backdrop click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.classList.add('hidden');
    }
  });
}

// DEPRECATED: Replaced by setupProfileSocialButtonsForUser
function initProfileStatClicks() {
  const modal = document.getElementById('social-list-modal');
  const title = document.getElementById('social-list-title');
  const container = document.getElementById('social-list-container');
  const closeBtn = document.getElementById('close-social-list-modal');

  if (!modal || !container) return;

  // Followers button
  const followersBtn = document.querySelector('[data-modal="followers"]');
  if (followersBtn) {
    followersBtn.addEventListener('click', () => {
      title.textContent = 'Seguidores';
      modal.classList.remove('hidden');
      loadSocialList('followers');
    });
  }

  // Following button
  const followingBtn = document.querySelector('[data-modal="following"]');
  if (followingBtn) {
    followingBtn.addEventListener('click', () => {
      title.textContent = 'Siguiendo';
      modal.classList.remove('hidden');
      loadSocialList('following');
    });
  }

  // Close button
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      modal.classList.add('hidden');
    });
  }

  // Close on backdrop
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.classList.add('hidden');
    }
  });

  async function loadSocialList(type) {
    if (!currentUser) return;

    container.innerHTML = '<div class="loading-spinner" style="padding: 40px; text-align: center;">Cargando...</div>';

    try {
      const subCollection = type === 'followers' ? 'followers' : 'following';
      const snapshot = await db.collection('users')
        .doc(currentUser.uid)
        .collection(subCollection)
        .limit(50)
        .get();

      if (snapshot.empty) {
        const emptyText = type === 'followers'
          ? 'No tienes seguidores aún'
          : 'No sigues a nadie aún';
        container.innerHTML = `
          <div class="social-list-empty">
            <div class="social-list-empty-icon">${type === 'followers' ? '💥' : 'x'}</div>
            <p>${emptyText}</p>
          </div>
        `;
        return;
      }

      // Get user IDs
      const userIds = snapshot.docs.map(doc => doc.id);

      // Fetch user data for each
      const userDataPromises = userIds.map(async (uid) => {
        try {
          const userDoc = await db.collection('users').doc(uid).get();
          if (userDoc.exists) {
            return { id: uid, ...userDoc.data() };
          }
          return null;
        } catch (e) {
          console.error('Error fetching user:', uid, e);
          return null;
        }
      });

      const users = (await Promise.all(userDataPromises)).filter(u => u !== null);

      if (users.length === 0) {
        container.innerHTML = `
          <div class="social-list-empty">
            <div class="social-list-empty-icon">😅</div>
            <p>No se pudieron cargar los usuarios</p>
          </div>
        `;
        return;
      }

      // Render user list
      let html = '';
      for (const user of users) {
        // Check if we follow this user (for the button state)
        let isFollowing = false;
        if (type === 'followers') {
          // For followers, check if we follow them back
          isFollowing = await checkFollowStatus(user.id);
        } else {
          // For following, we definitely follow them
          isFollowing = true;
        }

        const btnClass = isFollowing ? 'social-list-btn following' : 'social-list-btn follow';
        const btnText = isFollowing ? 'Siguiendo' : 'Seguir';
        const isMe = user.id === currentUser.uid;

        html += `
          <div class="social-list-item">
            <img src="${user.photoURL || 'https://ui-avatars.com/api/?name=U&background=DCE9DF&color=153E35&size=50'}" 
                 class="social-list-avatar"
                 alt="${user.displayName}"
                 onclick="openPublicProfile('${user.id}')">
            <div class="social-list-info" onclick="openPublicProfile('${user.id}')">
              <div class="social-list-name">${user.displayName || 'Usuario'}</div>
              <div class="social-list-bio">${user.id === 'akqgKt9WmQRNrpPub9xVKiPKmcn2' ? 'Administrador' : (user.bio || 'Escalador')}</div>
            </div>
            ${!isMe ? `
              <button class="${btnClass}" 
                      onclick="toggleFollow('${user.id}', this); 
                               this.classList.toggle('following'); 
                               this.classList.toggle('follow');
                               this.textContent = this.classList.contains('following') ? 'Siguiendo' : 'Seguir';">
                ${btnText}
              </button>
            ` : ''}
          </div>
        `;
      }

      container.innerHTML = html;

    } catch (error) {
      console.error('Error loading social list:', error);
      container.innerHTML = `
        <div class="social-list-empty">
          <div class="social-list-empty-icon">x</div>
          <p>Error cargando lista</p>
        </div>
      `;
    }
  }
}

// ================== EDIT PROFILE LOGIC ==================
function initEditProfile() {
  const modal = document.getElementById('edit-profile-modal');
  const closeBtn = document.getElementById('close-edit-profile-modal');
  const form = document.getElementById('edit-profile-form');
  const photoPreview = document.getElementById('edit-photo-preview');
  const photoTrigger = document.getElementById('edit-photo-trigger');
  const photoInput = document.getElementById('edit-photo-input');
  const bioTextarea = document.getElementById('edit-bio');
  const bioCharCount = document.getElementById('bio-char-count');

  if (!modal || !form) return;

  let selectedPhotoFile = null;


  // Photo upload trigger - click on photo or overlay opens file selector
  if (photoInput) {
    const photoContainer = document.querySelector('.edit-photo-preview');
    if (photoContainer) {
      photoContainer.addEventListener('click', (e) => {
        e.stopPropagation();
        photoInput.click();
      });
    }

    photoInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        selectedPhotoFile = file;
        const reader = new FileReader();
        reader.onload = (ev) => {
          if (photoPreview) photoPreview.src = ev.target.result;
        };
        reader.readAsDataURL(file);
      }
    });
  }

  // Bio character count
  if (bioTextarea && bioCharCount) {
    bioTextarea.addEventListener('input', () => {
      bioCharCount.textContent = bioTextarea.value.length;
    });
  }

  // Open Modal - Use event delegation for the edit button
  document.addEventListener('click', (e) => {
    if (e.target.id === 'edit-profile-btn' || e.target.closest('#edit-profile-btn')) {
      if (!currentUser) return;
      selectedPhotoFile = null;

      // Pre-fill form with current data
      document.getElementById('edit-display-name').value = currentUser.displayName || '';
      if (photoPreview) {
        photoPreview.src = currentUser.photoURL || 'https://ui-avatars.com/api/?name=U&background=DCE9DF&color=153E35&size=100';
      }

      db.collection('users').doc(currentUser.uid).get().then(doc => {
        if (doc.exists) {
          const data = doc.data();
          document.getElementById('edit-bio').value = data.bio || '';
          document.getElementById('edit-location').value = data.location || '';
          if (bioCharCount) bioCharCount.textContent = (data.bio || '').length;
        }
      });

      modal.classList.remove('hidden');
    }
  });

  // Close Modal
  closeBtn.addEventListener('click', () => {
    modal.classList.add('hidden');
  });

  // Close on backdrop click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.classList.add('hidden');
    }
  });

  // Submit Form
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = form.querySelector('.submit-btn');
    const originalText = submitBtn.textContent;
    submitBtn.textContent = 'Guardando...';
    submitBtn.disabled = true;

    try {
      let photoURL = currentUser.photoURL;

      // Upload new photo if selected
      if (selectedPhotoFile) {
        submitBtn.textContent = 'Subiendo foto...';
        const storageRef = firebase.storage().ref();
        const profilePhoto = await kxPrepareImageForUpload(selectedPhotoFile, { maxSide: 640, quality: 0.85, lightBytes: 150 * 1024 });
        const photoRef = storageRef.child(`profile-photos/${currentUser.uid}/${Date.now()}_${profilePhoto.name}`);
        await kxStoragePut(photoRef, profilePhoto);
        photoURL = await photoRef.getDownloadURL();
      }

      const profileData = {
        displayName: document.getElementById('edit-display-name').value,
        bio: document.getElementById('edit-bio').value,
        location: document.getElementById('edit-location').value,
        photoURL: photoURL
      };

      const success = await updateUserProfile(profileData);

      if (success) {
        modal.classList.add('hidden');
        showToast('Perfil actualizado', 'success');
        // Refresh profile view
        if (typeof loadUserProfile === 'function') {
          loadUserProfile();
        }
      }
    } catch (error) {
      console.error('Error updating profile:', error);
      showToast('Error al guardar', 'error', { detail: kxFriendlyError(error) });
    }

    submitBtn.textContent = originalText;
    submitBtn.disabled = false;
  });
}

// ================== SETTINGS DROPDOWN ==================
let settingsDropdownInitialized = false;

// Handler global para settings dropdown (definido fuera para referencia estable)
async function handleSettingsItemClick(e) {
  const dropdown = document.getElementById('settings-dropdown');
  const item = e.target.closest('.settings-menu-item');
  if (!item || !dropdown) return;

  e.preventDefault();
  e.stopPropagation();

  dropdown.classList.add('hidden');

  const itemId = item.id;

  try {
    switch (itemId) {
      case 'settings-edit-profile':
        const editModal = document.getElementById('edit-profile-modal');
        if (editModal) editModal.classList.remove('hidden');
        break;

      case 'settings-notifications':
        showToast('Configuración de notificaciones próximamente', 'info');
        break;

      case 'settings-privacy':
        showToast('Configuración de privacidad próximamente', 'info');
        break;

      case 'settings-help':
        showToast('Centro de ayuda próximamente', 'info');
        break;

      case 'settings-donate': {
        const kofiUrl = 'https://ko-fi.com/kruxx_';
        if (window.Capacitor !== undefined) {
          window.open(kofiUrl, '_system');
        } else {
          window.open(kofiUrl, '_blank', 'noopener,noreferrer');
        }
        break;
      }

      case 'settings-logout':
        const confirmLogout = await showConfirm('¿Estás seguro de que quieres cerrar sesión?', 'Cerrar sesión', 'Cerrar sesión');
        if (confirmLogout) {
          try {
            await firebase.auth().signOut();
            showToast('Sesión cerrada', 'success');
            window.location.reload();
          } catch (error) {
            console.error('Error signing out:', error);
            showToast('Error al cerrar sesión', 'error');
          }
        }
        break;

      case 'settings-delete-account':
        if (typeof deleteAccount === 'function') {
          await deleteAccount();
        } else {
          showToast('Error: función no disponible', 'error');
        }
        break;

      case 'settings-admin-panel':
        const isCapacitor = window.Capacitor !== undefined;
        if (isCapacitor) {
          openAdminPanelModal();
        } else {
          window.location.href = 'admin.html';
        }
        break;
    }
  } catch (error) {
    console.error('Error en settings menu:', error);
    showToast('Error al ejecutar la acción', 'error');
  }
}

function initSettingsDropdown() {
  const btn = document.getElementById('profile-settings-btn');
  const dropdown = document.getElementById('settings-dropdown');

  if (!btn || !dropdown) return;

  // Solo inicializar listeners globales una vez
  if (!settingsDropdownInitialized) {
    // Toggle dropdown on button click
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      dropdown.classList.toggle('hidden');
    });

    // Close on outside click
    document.addEventListener('click', (e) => {
      if (!dropdown.contains(e.target) && !btn.contains(e.target)) {
        dropdown.classList.add('hidden');
      }
    });

    // Añadir handler de clicks del menú (solo una vez)
    dropdown.addEventListener('click', handleSettingsItemClick);

    settingsDropdownInitialized = true;
  }

  // Admin Panel - Mostrar/ocultar según el usuario (solo para super admin)
  const adminPanelBtn = document.getElementById('settings-admin-panel');
  if (adminPanelBtn) {
    firebase.auth().onAuthStateChanged((user) => {
      if (user && user.email === 'krux.app.info@gmail.com') {
        adminPanelBtn.classList.remove('hidden');
      } else {
        adminPanelBtn.classList.add('hidden');
      }
    });
  }
}

// ==================== ADMIN PANEL MODAL (Mobile) ====================
let adminPanelInitialized = false;
let adminData = {
  routes: [],
  users: [],
  stats: { pending: 0, approved: 0, rejected: 0, admins: 0 },
  currentSection: 'dashboard',
  filters: { school: 'all', status: 'pending' }
};

function openAdminPanelModal() {
  const modal = document.getElementById('admin-panel-modal');
  const body = document.getElementById('admin-modal-body');

  if (!modal || !body) return;

  modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';

  // Inicializar el panel si no está listo
  if (!adminPanelInitialized) {
    initAdminPanelContent();
  } else {
    // Refrescar datos
    loadAdminStats();
    loadAdminRoutes();
  }
}

function closeAdminPanelModal() {
  const modal = document.getElementById('admin-panel-modal');
  if (modal) {
    modal.classList.add('hidden');
    document.body.style.overflow = '';
  }
}

function initAdminPanelContent() {
  const body = document.getElementById('admin-modal-body');
  if (!body) return;

  // Renderizar la estructura del panel
  body.innerHTML = `
    <!-- Tabs de navegación -->
    <div class="admin-tabs">
      <button class="admin-tab active" data-section="dashboard">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
        </svg>
        Dashboard
      </button>
      <button class="admin-tab" data-section="routes">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
        Vías
      </button>
      <button class="admin-tab" data-section="suggestions">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
        </svg>
        Sugerencias
      </button>
      <button class="admin-tab" data-section="spotters">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
        </svg>
        Spotters
      </button>
      <button class="admin-tab" data-section="schools">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0h4" />
        </svg>
        Escuelas
      </button>
      <button class="admin-tab" data-section="sectors">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
        </svg>
        Sectores
      </button>
      <button class="admin-tab" data-section="poi">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
        POI
      </button>
      <button class="admin-tab" data-section="users">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
        </svg>
        Usuarios
      </button>
    </div>

    <!-- Sección Dashboard -->
    <section class="admin-section active" id="admin-section-dashboard">
      <h1 class="admin-page-title">Dashboard</h1>
      <p class="admin-page-desc">Resumen general del panel</p>

      <div class="admin-stats-grid">
        <div class="admin-stat-card">
          <div class="admin-stat-icon pending">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div class="admin-stat-number" id="admin-stat-pending">0</div>
          <div class="admin-stat-label">Pendientes</div>
        </div>
        <div class="admin-stat-card">
          <div class="admin-stat-icon approved">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div class="admin-stat-number" id="admin-stat-approved">0</div>
          <div class="admin-stat-label">Aprobadas</div>
        </div>
        <div class="admin-stat-card">
          <div class="admin-stat-icon rejected">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div class="admin-stat-number" id="admin-stat-rejected">0</div>
          <div class="admin-stat-label">Rechazadas</div>
        </div>
        <div class="admin-stat-card">
          <div class="admin-stat-icon users">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
          </div>
          <div class="admin-stat-number" id="admin-stat-admins">0</div>
          <div class="admin-stat-label">Admins</div>
        </div>
      </div>

      <div class="admin-card">
        <div class="admin-card-header">Acciones Rápidas</div>
        <div class="admin-card-body">
          <div class="admin-actions-row">
            <button class="admin-btn admin-btn-primary" onclick="switchAdminSection('routes')">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
              </svg>
              Ver Pendientes
            </button>
            <button class="admin-btn admin-btn-success" onclick="exportAdminApprovedRoutes()">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Exportar
            </button>
          </div>
        </div>
      </div>
    </section>

    <!-- Sección Vías -->
    <section class="admin-section" id="admin-section-routes">
      <h1 class="admin-page-title">Aprobar Vías</h1>
      <p class="admin-page-desc">Revisa las vías pendientes</p>

      <div class="admin-filter-row">
        <select id="admin-filter-school" onchange="loadAdminRoutes()">
          <option value="all">Todas las escuelas</option>
        </select>
        <select id="admin-filter-status" onchange="loadAdminRoutes()">
          <option value="pending">Pendientes</option>
          <option value="approved">Aprobadas</option>
          <option value="rejected">Rechazadas</option>
          <option value="all">Todas</option>
        </select>
      </div>

      <div id="admin-routes-list">
        <div class="admin-loading">
          <div class="admin-spinner"></div>
          <p>Cargando vías...</p>
        </div>
      </div>
    </section>

    <!-- Sección Sugerencias -->
    <section class="admin-section" id="admin-section-suggestions">
      <h1 class="admin-page-title">Sugerencias de Usuarios</h1>
      <p class="admin-page-desc">Revisa la información sugerida por los usuarios</p>

      <div class="admin-filter-row">
        <select id="admin-filter-suggestion-status" onchange="loadAdminSuggestions()">
          <option value="pending">Pendientes</option>
          <option value="approved">Aprobadas</option>
          <option value="rejected">Rechazadas</option>
          <option value="all">Todas</option>
        </select>
        <select id="admin-filter-suggestion-field" onchange="loadAdminSuggestions()">
          <option value="all">Todos los campos</option>
          <option value="descripcion">Tipo de escalada</option>
          <option value="exp1">Express</option>
          <option value="long1">Metros</option>
          <option value="report">Problemas notificados</option>
        </select>
      </div>

      <div id="admin-suggestions-list">
        <div class="admin-loading">
          <div class="admin-spinner"></div>
          <p>Cargando sugerencias...</p>
        </div>
      </div>
    </section>

    <!-- Sección Spotters -->
    <section class="admin-section" id="admin-section-spotters">
      <h1 class="admin-page-title">Gestión de Spotters</h1>
      <p class="admin-page-desc">Revisa las solicitudes de Spotter</p>

      <div class="admin-card">
        <div class="admin-card-header">
          <span style="display:flex;align-items:center;gap:8px;">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" width="20" height="20" style="color:#f59e0b;">
              <circle cx="12" cy="12" r="10" stroke-width="2"/>
              <polyline points="12 6 12 12 16 14" stroke-width="2"/>
            </svg>
            Solicitudes Pendientes
          </span>
          <span class="admin-badge-pending" id="admin-pending-spotters-count">0</span>
        </div>
        <div class="admin-card-body" id="admin-spotter-requests-list">
          <div class="admin-loading">
            <div class="admin-spinner"></div>
            <p>Cargando solicitudes...</p>
          </div>
        </div>
      </div>

      <div class="admin-card" style="margin-top:16px;">
        <div class="admin-card-header">
          <span style="display:flex;align-items:center;gap:8px;">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" width="20" height="20" style="color:#10b981;">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Spotters Aprobados
          </span>
        </div>
        <div class="admin-card-body" id="admin-approved-spotters-list">
          <div class="admin-loading">
            <div class="admin-spinner"></div>
            <p>Cargando spotters...</p>
          </div>
        </div>
      </div>
    </section>

    <!-- Sección Usuarios -->
    <section class="admin-section" id="admin-section-users">
      <h1 class="admin-page-title">Usuarios</h1>
      <p class="admin-page-desc">Gestiona permisos de usuarios</p>

      <div class="admin-card">
        <div class="admin-card-header">Agregar Usuario</div>
        <div class="admin-card-body">
          <div class="admin-form-group">
            <label class="admin-form-label">Email</label>
            <input type="email" id="admin-new-user-email" class="admin-form-input" placeholder="correo@ejemplo.com">
          </div>
          <div class="admin-form-group">
            <label class="admin-form-label">Rol</label>
            <select id="admin-new-user-role" class="admin-form-select">
              <option value="photo_uploader">Subir Fotos</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <button class="admin-btn admin-btn-primary" onclick="addAdminUser()">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
            Agregar
          </button>
        </div>
      </div>

      <div class="admin-card">
        <div class="admin-card-header">Usuarios Autorizados</div>
        <div class="admin-card-body" id="admin-users-list">
          <div class="admin-loading">
            <div class="admin-spinner"></div>
            <p>Cargando usuarios...</p>
          </div>
        </div>
      </div>
    </section>

    <!-- Seccion Escuelas Pendientes -->
    <section class="admin-section" id="admin-section-schools">
      <h1 class="admin-page-title">Aprobar Escuelas</h1>
      <p class="admin-page-desc">Escuelas propuestas por Spotters</p>

      <div class="admin-filter-row">
        <select id="admin-filter-school-status" onchange="loadAdminPendingSchools()">
          <option value="pending">Pendientes</option>
          <option value="approved">Aprobadas</option>
          <option value="rejected">Rechazadas</option>
          <option value="all">Todas</option>
        </select>
      </div>

      <div class="admin-card">
        <div class="admin-card-body" id="admin-schools-list">
          <div class="admin-loading">
            <div class="admin-spinner"></div>
            <p>Cargando escuelas...</p>
          </div>
        </div>
      </div>
    </section>

    <!-- Seccion Sectores Pendientes -->
    <section class="admin-section" id="admin-section-sectors">
      <h1 class="admin-page-title">Aprobar Sectores</h1>
      <p class="admin-page-desc">Sectores propuestos por Spotters</p>

      <div class="admin-filter-row">
        <select id="admin-filter-sector-status" onchange="loadAdminPendingSectors()">
          <option value="pending">Pendientes</option>
          <option value="approved">Aprobados</option>
          <option value="rejected">Rechazados</option>
          <option value="all">Todos</option>
        </select>
      </div>

      <div class="admin-card">
        <div class="admin-card-body" id="admin-sectors-list">
          <div class="admin-loading">
            <div class="admin-spinner"></div>
            <p>Cargando sectores...</p>
          </div>
        </div>
      </div>
    </section>

    <!-- Seccion POI Pendientes -->
    <section class="admin-section" id="admin-section-poi">
      <h1 class="admin-page-title">Aprobar Puntos de Interes</h1>
      <p class="admin-page-desc">Puntos de interes propuestos por Spotters</p>

      <div class="admin-filter-row">
        <select id="admin-filter-poi-status" onchange="loadAdminPendingPOI()">
          <option value="pending">Pendientes</option>
          <option value="approved">Aprobados</option>
          <option value="rejected">Rechazados</option>
          <option value="all">Todos</option>
        </select>
      </div>

      <div class="admin-card">
        <div class="admin-card-body" id="admin-poi-list">
          <div class="admin-loading">
            <div class="admin-spinner"></div>
            <p>Cargando puntos de interes...</p>
          </div>
        </div>
      </div>
    </section>
  `;

  // Inicializar event listeners
  initAdminEventListeners();

  // Cargar datos
  loadAdminStats();
  loadAdminRoutes();
  loadAdminUsers();
  loadAdminSchools();
  loadAdminSuggestions();
  loadAdminSpotterRequests();
  loadAdminApprovedSpotters();

  adminPanelInitialized = true;
}

function initAdminEventListeners() {
  // Cerrar modal
  const closeBtn = document.getElementById('admin-modal-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', closeAdminPanelModal);
  }

  // Tabs
  document.querySelectorAll('.admin-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const section = tab.dataset.section;
      switchAdminSection(section);
    });
  });
}

function switchAdminSection(section) {
  // Actualizar tabs
  document.querySelectorAll('.admin-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.section === section);
  });

  // Actualizar secciones
  document.querySelectorAll('.admin-section').forEach(sec => {
    sec.classList.toggle('active', sec.id === `admin-section-${section}`);
  });

  adminData.currentSection = section;

  // Cargar datos de la seccion al cambiar
  if (section === 'schools') loadAdminPendingSchools();
  if (section === 'sectors') loadAdminPendingSectors();
  if (section === 'poi') loadAdminPendingPOI();
}

async function loadAdminStats() {
  try {
    const db = firebase.firestore();

    // Contar pendientes, aprobadas y rechazadas (todas las colecciones)
    const collections = ['pending_routes', 'pending_schools', 'pending_sectors', 'pending_poi'];
    let totalPending = 0, totalApproved = 0, totalRejected = 0;

    for (const col of collections) {
      try {
        const pSnap = await db.collection(col).where('status', '==', 'pending').get();
        const aSnap = await db.collection(col).where('status', '==', 'approved').get();
        const rSnap = await db.collection(col).where('status', '==', 'rejected').get();
        totalPending += pSnap.size;
        totalApproved += aSnap.size;
        totalRejected += rSnap.size;
      } catch (e) { /* coleccion puede no existir aun */ }
    }

    const adminsSnap = await db.collection('admins').get();

    adminData.stats = {
      pending: totalPending,
      approved: totalApproved,
      rejected: totalRejected,
      admins: adminsSnap.size
    };

    // Actualizar UI
    const pendingEl = document.getElementById('admin-stat-pending');
    const approvedEl = document.getElementById('admin-stat-approved');
    const rejectedEl = document.getElementById('admin-stat-rejected');
    const adminsEl = document.getElementById('admin-stat-admins');

    if (pendingEl) pendingEl.textContent = adminData.stats.pending;
    if (approvedEl) approvedEl.textContent = adminData.stats.approved;
    if (rejectedEl) rejectedEl.textContent = adminData.stats.rejected;
    if (adminsEl) adminsEl.textContent = adminData.stats.admins;

  } catch (error) {
    console.error('Error loading admin stats:', error);
  }
}

async function loadAdminSchools() {
  try {
    const db = firebase.firestore();
    const routesSnap = await db.collection('pending_routes').get();

    const schools = new Set();
    routesSnap.forEach(doc => {
      const data = doc.data();
      if (data.school) schools.add(data.school);
    });

    const select = document.getElementById('admin-filter-school');
    if (select) {
      select.innerHTML = '<option value="all">Todas las escuelas</option>';
      schools.forEach(school => {
        select.innerHTML += `<option value="${school}">${school}</option>`;
      });
    }
  } catch (error) {
    console.error('Error loading schools:', error);
  }
}

async function loadAdminRoutes() {
  const listEl = document.getElementById('admin-routes-list');
  if (!listEl) return;

  listEl.innerHTML = '<div class="admin-loading"><div class="admin-spinner"></div><p>Cargando vías...</p></div>';

  try {
    const db = firebase.firestore();
    const schoolFilter = document.getElementById('admin-filter-school')?.value || 'all';
    const statusFilter = document.getElementById('admin-filter-status')?.value || 'pending';

    let query = db.collection('pending_routes');

    if (statusFilter !== 'all') {
      query = query.where('status', '==', statusFilter);
    }

    const snapshot = await query.orderBy('createdAt', 'desc').limit(50).get();

    let routes = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      if (schoolFilter === 'all' || data.school === schoolFilter) {
        routes.push({ id: doc.id, ...data });
      }
    });

    adminData.routes = routes;

    if (routes.length === 0) {
      listEl.innerHTML = `
        <div class="admin-empty-state">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p>No hay vías con este filtro</p>
        </div>
      `;
      return;
    }

    listEl.innerHTML = routes.map(route => `
      <div class="admin-route-card" data-route-id="${route.id}">
        <div class="admin-route-name">${route.name || 'Sin nombre'}</div>
        <div class="admin-route-meta">
          ${route.school || 'Escuela desconocida'} · ${route.sector || ''} · ${route.grade || ''}
          ${route.status === 'approved' ? ' · ✅ Aprobada' : route.status === 'rejected' ? ' · ❌ Rechazada' : ''}
        </div>
        ${route.status === 'pending' ? `
          <div class="admin-route-actions">
            <button class="admin-btn-approve" onclick="approveAdminRoute('${route.id}')">Aprobar</button>
            <button class="admin-btn-reject" onclick="rejectAdminRoute('${route.id}')">Rechazar</button>
          </div>
        ` : ''}
      </div>
    `).join('');

  } catch (error) {
    console.error('Error loading routes:', error);
    listEl.innerHTML = '<div class="admin-empty-state"><p>Error al cargar vías</p></div>';
  }
}

async function approveAdminRoute(routeId) {
  try {
    const db = firebase.firestore();
    await db.collection('pending_routes').doc(routeId).update({
      status: 'approved',
      approvedAt: firebase.firestore.FieldValue.serverTimestamp(),
      approvedBy: firebase.auth().currentUser?.email
    });
    showToast('Vía aprobada', 'success');
    loadAdminRoutes();
    loadAdminStats();
  } catch (error) {
    console.error('Error approving route:', error);
    showToast('Error al aprobar vía', 'error');
  }
}

async function rejectAdminRoute(routeId) {
  const reason = prompt('Motivo del rechazo (opcional):');
  try {
    const db = firebase.firestore();
    await db.collection('pending_routes').doc(routeId).update({
      status: 'rejected',
      rejectedAt: firebase.firestore.FieldValue.serverTimestamp(),
      rejectedBy: firebase.auth().currentUser?.email,
      rejectionReason: reason || ''
    });
    showToast('Vía rechazada', 'success');
    loadAdminRoutes();
    loadAdminStats();
  } catch (error) {
    console.error('Error rejecting route:', error);
    showToast('Error al rechazar vía', 'error');
  }
}

async function loadAdminUsers() {
  const listEl = document.getElementById('admin-users-list');
  if (!listEl) return;

  listEl.innerHTML = '<div class="admin-loading"><div class="admin-spinner"></div><p>Cargando usuarios...</p></div>';

  try {
    const db = firebase.firestore();
    const snapshot = await db.collection('admins').get();

    let users = [];
    snapshot.forEach(doc => {
      users.push({ uid: doc.id, ...doc.data() });
    });

    adminData.users = users;

    if (users.length === 0) {
      listEl.innerHTML = '<div class="admin-empty-state"><p>No hay usuarios autorizados</p></div>';
      return;
    }

    listEl.innerHTML = users.map(user => `
      <div class="admin-user-row">
        <div class="admin-user-info">
          <div class="admin-user-email">${user.email || user.uid}</div>
          <div class="admin-user-role">${user.role === 'admin' ? 'Admin' : 'Subir Fotos'}</div>
        </div>
        <div class="admin-user-actions">
          <button onclick="removeAdminUser('${user.uid}')">Eliminar</button>
        </div>
      </div>
    `).join('');

  } catch (error) {
    console.error('Error loading users:', error);
    listEl.innerHTML = '<div class="admin-empty-state"><p>Error al cargar usuarios</p></div>';
  }
}

// ============================================
// ADMIN: ESCUELAS PENDIENTES
// ============================================

async function loadAdminPendingSchools() {
  const listEl = document.getElementById('admin-schools-list');
  if (!listEl) return;
  listEl.innerHTML = '<div class="admin-loading"><div class="admin-spinner"></div><p>Cargando escuelas...</p></div>';

  try {
    const db = firebase.firestore();
    const statusFilter = document.getElementById('admin-filter-school-status')?.value || 'pending';

    let query = db.collection('pending_schools');
    if (statusFilter !== 'all') query = query.where('status', '==', statusFilter);

    const snapshot = await query.limit(50).get();
    let items = [];
    snapshot.forEach(doc => items.push({ id: doc.id, ...doc.data() }));
    items.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));

    if (items.length === 0) {
      listEl.innerHTML = '<div class="admin-empty-state"><p>No hay escuelas con este filtro</p></div>';
      return;
    }

    listEl.innerHTML = items.map(item => `
      <div class="admin-route-card" data-id="${item.id}">
        <div class="admin-route-name">${item.nombre || 'Sin nombre'}</div>
        <div class="admin-route-meta">
          ${item.descripcion || 'Sin descripcion'} · ${item.createdByEmail || ''}
          ${item.coordinates ? ` · [${item.coordinates[1]?.toFixed(4)}, ${item.coordinates[0]?.toFixed(4)}]` : ''}
          ${item.status === 'approved' ? ' · ✅ Aprobada' : item.status === 'rejected' ? ' · ❌ Rechazada' : ''}
        </div>
        ${item.status === 'pending' ? `
          <div class="admin-route-actions">
            <button class="admin-btn-approve" onclick="approveAdminItem('pending_schools','${item.id}','loadAdminPendingSchools')">Aprobar</button>
            <button class="admin-btn-reject" onclick="rejectAdminItem('pending_schools','${item.id}','loadAdminPendingSchools')">Rechazar</button>
          </div>
        ` : ''}
      </div>
    `).join('');
  } catch (error) {
    console.error('Error loading pending schools:', error);
    listEl.innerHTML = '<div class="admin-empty-state"><p>Error al cargar escuelas</p></div>';
  }
}

// ============================================
// ADMIN: SECTORES PENDIENTES
// ============================================

async function loadAdminPendingSectors() {
  const listEl = document.getElementById('admin-sectors-list');
  if (!listEl) return;
  listEl.innerHTML = '<div class="admin-loading"><div class="admin-spinner"></div><p>Cargando sectores...</p></div>';

  try {
    const db = firebase.firestore();
    const statusFilter = document.getElementById('admin-filter-sector-status')?.value || 'pending';

    let query = db.collection('pending_sectors');
    if (statusFilter !== 'all') query = query.where('status', '==', statusFilter);

    const snapshot = await query.limit(50).get();
    let items = [];
    snapshot.forEach(doc => items.push({ id: doc.id, ...doc.data() }));
    items.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));

    if (items.length === 0) {
      listEl.innerHTML = '<div class="admin-empty-state"><p>No hay sectores con este filtro</p></div>';
      return;
    }

    listEl.innerHTML = items.map(item => {
      const vertexCount = item.vertices?.length || item.geometry?.coordinates?.[0]?.length || 0;
      return `
        <div class="admin-route-card" data-id="${item.id}">
          <div class="admin-route-name">${item.nombre || 'Sin nombre'}</div>
          <div class="admin-route-meta">
            Escuela: ${item.schoolId || 'No asignada'} · Restriccion: ${item.restr || 'NO'}
            ${item.exposicion ? ` · ${item.exposicion}` : ''}
            · ${vertexCount} vertices · ${item.createdByEmail || ''}
            ${item.status === 'approved' ? ' · ✅ Aprobado' : item.status === 'rejected' ? ' · ❌ Rechazado' : ''}
          </div>
          ${item.status === 'pending' ? `
            <div class="admin-route-actions">
              <button class="admin-btn-approve" onclick="approveAdminItem('pending_sectors','${item.id}','loadAdminPendingSectors')">Aprobar</button>
              <button class="admin-btn-reject" onclick="rejectAdminItem('pending_sectors','${item.id}','loadAdminPendingSectors')">Rechazar</button>
            </div>
          ` : ''}
        </div>
      `;
    }).join('');
  } catch (error) {
    console.error('Error loading pending sectors:', error);
    listEl.innerHTML = '<div class="admin-empty-state"><p>Error al cargar sectores</p></div>';
  }
}

// ============================================
// ADMIN: PUNTOS DE INTERES PENDIENTES
// ============================================

async function loadAdminPendingPOI() {
  const listEl = document.getElementById('admin-poi-list');
  if (!listEl) return;
  listEl.innerHTML = '<div class="admin-loading"><div class="admin-spinner"></div><p>Cargando POI...</p></div>';

  try {
    const db = firebase.firestore();
    const statusFilter = document.getElementById('admin-filter-poi-status')?.value || 'pending';

    let query = db.collection('pending_poi');
    if (statusFilter !== 'all') query = query.where('status', '==', statusFilter);

    const snapshot = await query.limit(50).get();
    let items = [];
    snapshot.forEach(doc => items.push({ id: doc.id, ...doc.data() }));
    items.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));

    if (items.length === 0) {
      listEl.innerHTML = '<div class="admin-empty-state"><p>No hay puntos de interes con este filtro</p></div>';
      return;
    }

    listEl.innerHTML = items.map(item => {
      const emoji = (typeof getPOIEmoji === 'function') ? getPOIEmoji(item.descripcio) : '📍';
      return `
        <div class="admin-route-card" data-id="${item.id}">
          <div class="admin-route-name">${emoji} ${item.descripcio || 'Sin tipo'} ${item.nombre ? '— ' + item.nombre : ''}</div>
          <div class="admin-route-meta">
            Escuela: ${item.schoolId || 'No asignada'} · ${item.createdByEmail || ''}
            ${item.coordinates ? ` · [${item.coordinates[1]?.toFixed(4)}, ${item.coordinates[0]?.toFixed(4)}]` : ''}
            ${item.link ? ` · <a href="${item.link}" target="_blank">Link</a>` : ''}
            ${item.status === 'approved' ? ' · ✅ Aprobado' : item.status === 'rejected' ? ' · ❌ Rechazado' : ''}
          </div>
          ${item.status === 'pending' ? `
            <div class="admin-route-actions">
              <button class="admin-btn-approve" onclick="approveAdminItem('pending_poi','${item.id}','loadAdminPendingPOI')">Aprobar</button>
              <button class="admin-btn-reject" onclick="rejectAdminItem('pending_poi','${item.id}','loadAdminPendingPOI')">Rechazar</button>
            </div>
          ` : ''}
        </div>
      `;
    }).join('');
  } catch (error) {
    console.error('Error loading pending POI:', error);
    listEl.innerHTML = '<div class="admin-empty-state"><p>Error al cargar puntos de interes</p></div>';
  }
}

// ============================================
// ADMIN: APROBAR/RECHAZAR GENERICO
// ============================================

async function approveAdminItem(collection, docId, reloadFn) {
  try {
    const db = firebase.firestore();
    await db.collection(collection).doc(docId).update({
      status: 'approved',
      approvedAt: firebase.firestore.FieldValue.serverTimestamp(),
      approvedBy: firebase.auth().currentUser?.email
    });
    showToast('Aprobado correctamente', 'success');
    if (typeof window[reloadFn] === 'function') window[reloadFn]();
    loadAdminStats();
  } catch (error) {
    console.error('Error approving item:', error);
    showToast('Error al aprobar', 'error');
  }
}

async function rejectAdminItem(collection, docId, reloadFn) {
  const reason = prompt('Motivo del rechazo (opcional):');
  try {
    const db = firebase.firestore();
    await db.collection(collection).doc(docId).update({
      status: 'rejected',
      rejectedAt: firebase.firestore.FieldValue.serverTimestamp(),
      rejectedBy: firebase.auth().currentUser?.email,
      rejectionReason: reason || ''
    });
    showToast('Rechazado', 'success');
    if (typeof window[reloadFn] === 'function') window[reloadFn]();
    loadAdminStats();
  } catch (error) {
    console.error('Error rejecting item:', error);
    showToast('Error al rechazar', 'error');
  }
}

async function addAdminUser() {
  const emailInput = document.getElementById('admin-new-user-email');
  const roleSelect = document.getElementById('admin-new-user-role');

  const email = emailInput?.value?.trim();
  const role = roleSelect?.value || 'photo_uploader';

  if (!email) {
    showToast('Ingresa un email', 'error');
    return;
  }

  try {
    const db = firebase.firestore();

    // Buscar usuario por email
    const usersSnap = await db.collection('users').where('email', '==', email).get();

    if (usersSnap.empty) {
      showToast('Usuario no encontrado. Debe iniciar sesión al menos una vez.', 'error');
      return;
    }

    const userDoc = usersSnap.docs[0];
    const uid = userDoc.id;

    // Agregar a admins
    await db.collection('admins').doc(uid).set({
      email: email,
      role: role,
      addedAt: firebase.firestore.FieldValue.serverTimestamp(),
      addedBy: firebase.auth().currentUser?.email
    });

    showToast('Usuario agregado', 'success');
    emailInput.value = '';
    loadAdminUsers();
    loadAdminStats();

  } catch (error) {
    console.error('Error adding user:', error);
    showToast('Error al agregar usuario', 'error');
  }
}

async function removeAdminUser(uid) {
  if (!confirm('¿Eliminar este usuario?')) return;

  try {
    const db = firebase.firestore();
    await db.collection('admins').doc(uid).delete();
    showToast('Usuario eliminado', 'success');
    loadAdminUsers();
    loadAdminStats();
  } catch (error) {
    console.error('Error removing user:', error);
    showToast('Error al eliminar usuario', 'error');
  }
}

async function exportAdminApprovedRoutes() {
  try {
    const db = firebase.firestore();
    const snapshot = await db.collection('pending_routes').where('status', '==', 'approved').get();

    let routes = [];
    snapshot.forEach(doc => {
      routes.push({ id: doc.id, ...doc.data() });
    });

    if (routes.length === 0) {
      showToast('No hay vías aprobadas para exportar', 'error');
      return;
    }

    // Crear JSON y descargar
    const dataStr = JSON.stringify(routes, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `rutas-aprobadas-${new Date().toISOString().split('T')[0]}.json`;
    a.click();

    URL.revokeObjectURL(url);
    showToast(`Exportadas ${routes.length} vías`, 'success');

  } catch (error) {
    console.error('Error exporting routes:', error);
    showToast('Error al exportar', 'error');
  }
}

// ================== ADMIN SUGGESTIONS (Mobile) ==================
let adminSuggestions = [];

async function loadAdminSuggestions() {
  const listEl = document.getElementById('admin-suggestions-list');
  if (!listEl) return;

  listEl.innerHTML = '<div class="admin-loading"><div class="admin-spinner"></div><p>Cargando sugerencias...</p></div>';

  try {
    const db = firebase.firestore();
    const statusFilter = document.getElementById('admin-filter-suggestion-status')?.value || 'pending';
    const fieldFilter = document.getElementById('admin-filter-suggestion-field')?.value || 'all';

    let query = db.collection('routeSuggestions');

    if (statusFilter !== 'all') {
      query = query.where('status', '==', statusFilter);
    }

    // La fecha se guarda en "timestamp" y los valores sugeridos dentro de "data" (igual que en admin.js)
    query = query.orderBy('timestamp', 'desc');

    const snapshot = await query.get();
    adminSuggestions = [];
    snapshot.forEach(doc => {
      const raw = doc.data();
      if (raw.kind === 'report') {
        adminSuggestions.push({ id: doc.id, ...raw, createdAt: raw.timestamp || null, field: 'report' });
        return;
      }
      const fields = Object.keys(raw.data || {});
      if (!fields.length) {
        adminSuggestions.push({ id: doc.id, ...raw, createdAt: raw.timestamp || raw.createdAt || null });
        return;
      }
      fields.forEach(field => adminSuggestions.push({
        id: doc.id, routeName: raw.routeName, schoolId: raw.schoolId, userEmail: raw.userEmail,
        status: raw.status, createdAt: raw.timestamp || raw.createdAt || null,
        field, suggestedValue: String(raw.data[field])
      }));
    });
    if (fieldFilter !== 'all') {
      adminSuggestions = adminSuggestions.filter(s => s.field === fieldFilter);
    }

    renderAdminSuggestions();

  } catch (error) {
    console.error('Error loading suggestions:', error);
    listEl.innerHTML = '<div class="admin-empty-state"><p>Error al cargar sugerencias</p></div>';
  }
}

function renderAdminSuggestions() {
  const listEl = document.getElementById('admin-suggestions-list');
  if (!listEl) return;

  if (adminSuggestions.length === 0) {
    listEl.innerHTML = `
      <div class="admin-empty-state">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <p>No hay sugerencias</p>
      </div>
    `;
    return;
  }

  const fieldLabels = {
    descripcion: 'Tipo de escalada',
    exp1: 'Express',
    long1: 'Metros'
  };

  const fieldUnits = {
    descripcion: '',
    exp1: ' express',
    long1: ' m'
  };

  listEl.innerHTML = adminSuggestions.map(suggestion => {
    if (suggestion.kind === 'report') return adminReportCardHTML(suggestion);
    const date = suggestion.createdAt?.toDate?.() ?
      suggestion.createdAt.toDate().toLocaleDateString('es-ES', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit'
      }) : '';

    const userInitial = suggestion.userEmail ?
      suggestion.userEmail.charAt(0).toUpperCase() : '?';

    const fieldLabel = fieldLabels[suggestion.field] || suggestion.field;
    const fieldUnit = fieldUnits[suggestion.field] || '';
    const isPending = suggestion.status === 'pending';

    return `
      <div class="admin-suggestion-card ${suggestion.status}" data-id="${suggestion.id}">
        <div class="admin-suggestion-header">
          <div class="admin-suggestion-route">${escapeHtmlAdmin(suggestion.routeName || 'Vía')}</div>
          <span class="admin-suggestion-badge ${suggestion.field}">${fieldLabel}</span>
        </div>
        <div class="admin-suggestion-school">${escapeHtmlAdmin(suggestion.schoolId || '')}</div>
        <div class="admin-suggestion-value">
          <span class="admin-suggestion-label">Valor sugerido:</span>
          ${isPending ? `
            <input type="${suggestion.field === 'descripcion' ? 'text' : 'number'}"
                   class="admin-suggestion-input"
                   id="admin-sug-input-${suggestion.id}"
                   value="${escapeHtmlAdmin(suggestion.suggestedValue || '')}">
          ` : `
            <span class="admin-suggestion-text">${escapeHtmlAdmin(suggestion.suggestedValue || '')}${fieldUnit}</span>
          `}
        </div>
        <div class="admin-suggestion-meta">
          <div class="admin-suggestion-user">
            <span class="admin-suggestion-avatar">${userInitial}</span>
            <span>${escapeHtmlAdmin(suggestion.userEmail || 'Anónimo')}</span>
          </div>
          <span>${date}</span>
        </div>
        ${isPending ? `
          <div class="admin-suggestion-actions">
            <button class="admin-btn admin-btn-success" onclick="approveAdminSuggestion('${suggestion.id}')">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" width="16" height="16">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
              </svg>
              Aprobar
            </button>
            <button class="admin-btn admin-btn-danger" onclick="rejectAdminSuggestion('${suggestion.id}')">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" width="16" height="16">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
              Rechazar
            </button>
          </div>
        ` : `
          <div class="admin-suggestion-status">
            <span class="admin-status-badge ${suggestion.status}">
              ${suggestion.status === 'approved' ? 'Aprobada' : 'Rechazada'}
            </span>
          </div>
        `}
      </div>
    `;
  }).join('');
}

const ADMIN_REPORT_ISSUE_LABELS = {
  grado: 'Grado incorrecto',
  nombre: 'Nombre incorrecto',
  datos: 'Express, metros o tipo',
  ubicacion: 'Ubicación en el mapa',
  seguridad: 'Chapas o roca en mal estado',
  otro: 'Otro'
};

// Tarjeta de un problema notificado desde la ficha de la vía
function adminReportCardHTML(report) {
  const date = report.createdAt?.toDate?.() ?
    report.createdAt.toDate().toLocaleDateString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
  const userInitial = report.userEmail ? report.userEmail.charAt(0).toUpperCase() : '?';
  const isPending = report.status === 'pending';
  const proposed = report.proposed || {};
  const issues = (report.issues || []).map(i => escapeHtmlAdmin(ADMIN_REPORT_ISSUE_LABELS[i] || i)).join(' · ');
  const changes = [
    proposed.grado1 ? `Grado: ${escapeHtmlAdmin(report.grade || '?')} → <strong>${escapeHtmlAdmin(proposed.grado1)}</strong>` : '',
    proposed.nombre ? `Nombre: <strong>${escapeHtmlAdmin(proposed.nombre)}</strong>` : ''
  ].filter(Boolean).join('<br>');

  return `
    <div class="admin-suggestion-card ${report.status}" data-id="${report.id}">
      <div class="admin-suggestion-header">
        <div class="admin-suggestion-route">${escapeHtmlAdmin(report.routeName || 'Vía')} (${escapeHtmlAdmin(report.grade || '?')})</div>
        <span class="admin-suggestion-badge report">Problema</span>
      </div>
      <div class="admin-suggestion-school">${escapeHtmlAdmin([report.schoolId, report.sector].filter(Boolean).join(' · '))}</div>
      <div class="admin-suggestion-value">
        <span class="admin-suggestion-label">${issues}</span>
        ${changes ? `<span class="admin-suggestion-text">${changes}</span>` : ''}
        ${report.message ? `<span class="admin-suggestion-text" style="white-space:pre-wrap;">${escapeHtmlAdmin(report.message)}</span>` : ''}
      </div>
      <div class="admin-suggestion-meta">
        <div class="admin-suggestion-user">
          <span class="admin-suggestion-avatar">${userInitial}</span>
          <span>${escapeHtmlAdmin(report.userEmail || 'Anónimo')}</span>
        </div>
        <span>${date}</span>
      </div>
      ${isPending ? `
        <div class="admin-suggestion-actions">
          <button class="admin-btn admin-btn-success" onclick="resolveAdminReport('${report.id}')">Marcar resuelto</button>
          <button class="admin-btn admin-btn-danger" onclick="rejectAdminSuggestion('${report.id}')">Descartar</button>
        </div>
      ` : `
        <div class="admin-suggestion-status">
          <span class="admin-status-badge ${report.status}">${report.status === 'approved' ? 'Resuelto' : 'Descartado'}</span>
        </div>
      `}
    </div>
  `;
}

// Marca el problema como resuelto; la vía se corrige a mano en sus datos
async function resolveAdminReport(reportId) {
  const report = adminSuggestions.find(s => s.id === reportId);
  if (!report) return;
  if (!confirm(`¿Marcar como resuelto?\n\nVía: ${report.routeName}\n\nRecuerda corregir los datos de la vía si hace falta.`)) return;
  try {
    await firebase.firestore().collection('routeSuggestions').doc(reportId).update({
      status: 'approved',
      resolvedAt: firebase.firestore.FieldValue.serverTimestamp(),
      resolvedBy: firebase.auth().currentUser?.email || ''
    });
    showToast('Problema marcado como resuelto', 'success');
    loadAdminSuggestions();
  } catch (error) {
    console.error('Error resolving report:', error);
    showToast('Error al marcar como resuelto', 'error');
  }
}

async function approveAdminSuggestion(suggestionId) {
  const suggestion = adminSuggestions.find(s => s.id === suggestionId);
  if (!suggestion) return;

  const inputEl = document.getElementById(`admin-sug-input-${suggestionId}`);
  const finalValue = inputEl ? inputEl.value.trim() : suggestion.suggestedValue;

  if (!finalValue) {
    showToast('El valor no puede estar vacío', 'error');
    return;
  }

  if (!confirm(`¿Aprobar esta sugerencia?\n\nVía: ${suggestion.routeName}\nCampo: ${suggestion.field}\nValor: ${finalValue}`)) {
    return;
  }

  try {
    const db = firebase.firestore();
    const currentUserEmail = firebase.auth().currentUser?.email;

    await db.collection('routeSuggestions').doc(suggestionId).update({
      status: 'approved',
      approvedValue: finalValue,
      approvedAt: firebase.firestore.FieldValue.serverTimestamp(),
      approvedBy: currentUserEmail
    });

    // Actualizar la vía en pending_routes
    const routeQuery = await db.collection('pending_routes')
      .where('nombre', '==', suggestion.routeName)
      .where('schoolId', '==', suggestion.schoolId)
      .get();

    if (!routeQuery.empty) {
      const routeDoc = routeQuery.docs[0];
      const updateData = {};
      updateData[suggestion.field] = finalValue;
      await db.collection('pending_routes').doc(routeDoc.id).update(updateData);
    }

    showToast('Sugerencia aprobada', 'success');
    loadAdminSuggestions();

  } catch (error) {
    console.error('Error approving suggestion:', error);
    showToast('Error al aprobar', 'error');
  }
}

async function rejectAdminSuggestion(suggestionId) {
  const suggestion = adminSuggestions.find(s => s.id === suggestionId);
  if (!suggestion) return;

  if (!confirm(`¿Rechazar esta sugerencia?\n\nVía: ${suggestion.routeName}`)) {
    return;
  }

  try {
    const db = firebase.firestore();
    const currentUserEmail = firebase.auth().currentUser?.email;

    await db.collection('routeSuggestions').doc(suggestionId).update({
      status: 'rejected',
      rejectedAt: firebase.firestore.FieldValue.serverTimestamp(),
      rejectedBy: currentUserEmail
    });

    showToast('Sugerencia rechazada', 'info');
    loadAdminSuggestions();

  } catch (error) {
    console.error('Error rejecting suggestion:', error);
    showToast('Error al rechazar', 'error');
  }
}

// ================== ADMIN SPOTTERS (Mobile) ==================
let adminSpotterRequests = [];
let adminApprovedSpotters = [];

async function loadAdminSpotterRequests() {
  const listEl = document.getElementById('admin-spotter-requests-list');
  const countEl = document.getElementById('admin-pending-spotters-count');
  if (!listEl) return;

  listEl.innerHTML = '<div class="admin-loading"><div class="admin-spinner"></div><p>Cargando solicitudes...</p></div>';

  try {
    const db = firebase.firestore();
    const snapshot = await db.collection('spotter_requests')
      .where('status', '==', 'pending')
      .get();

    adminSpotterRequests = [];
    snapshot.forEach(doc => {
      adminSpotterRequests.push({ id: doc.id, ...doc.data() });
    });

    // Ordenar por fecha
    adminSpotterRequests.sort((a, b) => {
      const dateA = a.createdAt?.toDate?.() || new Date(0);
      const dateB = b.createdAt?.toDate?.() || new Date(0);
      return dateB - dateA;
    });

    if (countEl) {
      countEl.textContent = adminSpotterRequests.length;
    }

    renderAdminSpotterRequests();

  } catch (error) {
    console.error('Error loading spotter requests:', error);
    listEl.innerHTML = '<div class="admin-empty-state"><p>Error al cargar solicitudes</p></div>';
  }
}

function renderAdminSpotterRequests() {
  const listEl = document.getElementById('admin-spotter-requests-list');
  if (!listEl) return;

  if (adminSpotterRequests.length === 0) {
    listEl.innerHTML = `
      <div class="admin-empty-state">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <p>No hay solicitudes pendientes</p>
      </div>
    `;
    return;
  }

  listEl.innerHTML = adminSpotterRequests.map(request => {
    const createdAt = request.createdAt?.toDate?.() ?
      request.createdAt.toDate().toLocaleDateString('es-ES', {
        day: '2-digit',
        month: 'short',
        year: 'numeric'
      }) : '';

    const avatarUrl = request.userPhotoURL ||
      `https://ui-avatars.com/api/?name=${encodeURIComponent((request.firstname || '') + '+' + (request.lastname || ''))}&background=fbbf24&color=1f2937&size=48`;

    const fullName = `${escapeHtmlAdmin(request.firstname || '')} ${escapeHtmlAdmin(request.lastname || '')}`.trim() || 'Usuario';

    return `
      <div class="admin-spotter-card" data-id="${request.id}">
        <div class="admin-spotter-header">
          <img src="${avatarUrl}" alt="${fullName}" class="admin-spotter-avatar" onerror="this.src='https://ui-avatars.com/api/?name=U&background=fbbf24&color=1f2937&size=48'">
          <div class="admin-spotter-info">
            <div class="admin-spotter-name">${fullName}</div>
            <div class="admin-spotter-email">${escapeHtmlAdmin(request.email || '')}</div>
            <div class="admin-spotter-date">Solicitado: ${createdAt}</div>
          </div>
        </div>
        ${request.message ? `
          <div class="admin-spotter-message">
            <div class="admin-spotter-message-label">Motivación:</div>
            <div class="admin-spotter-message-text">${escapeHtmlAdmin(request.message)}</div>
          </div>
        ` : ''}
        <div class="admin-spotter-actions">
          <button class="admin-btn admin-btn-danger" onclick="rejectAdminSpotterRequest('${request.id}')">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" width="16" height="16">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
            Rechazar
          </button>
          <button class="admin-btn admin-btn-success" onclick="approveAdminSpotterRequest('${request.id}')">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" width="16" height="16">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
            </svg>
            Aprobar
          </button>
        </div>
      </div>
    `;
  }).join('');
}

async function approveAdminSpotterRequest(requestId) {
  if (!confirm('¿Aprobar esta solicitud de Spotter?')) return;

  try {
    const db = firebase.firestore();
    const currentUserId = firebase.auth().currentUser?.uid;

    const requestDoc = await db.collection('spotter_requests').doc(requestId).get();
    if (!requestDoc.exists) {
      showToast('Solicitud no encontrada', 'error');
      return;
    }

    const requestData = requestDoc.data();

    // Añadir a admins con rol spotter
    await db.collection('admins').doc(requestData.userId).set({
      email: requestData.email,
      role: 'spotter',
      name: `${requestData.firstname || ''} ${requestData.lastname || ''}`.trim(),
      addedBy: currentUserId,
      addedAt: firebase.firestore.FieldValue.serverTimestamp(),
      approvedFromRequest: requestId
    });

    // Actualizar estado de la solicitud
    await db.collection('spotter_requests').doc(requestId).update({
      status: 'approved',
      approvedAt: firebase.firestore.FieldValue.serverTimestamp(),
      approvedBy: currentUserId
    });

    showToast('Spotter aprobado', 'success');
    loadAdminSpotterRequests();
    loadAdminApprovedSpotters();
    loadAdminStats();

  } catch (error) {
    console.error('Error approving spotter:', error);
    showToast('Error al aprobar', 'error');
  }
}

async function rejectAdminSpotterRequest(requestId) {
  const reason = prompt('Motivo del rechazo (opcional):');

  try {
    const db = firebase.firestore();
    const currentUserId = firebase.auth().currentUser?.uid;

    await db.collection('spotter_requests').doc(requestId).update({
      status: 'rejected',
      rejectedAt: firebase.firestore.FieldValue.serverTimestamp(),
      rejectedBy: currentUserId,
      rejectionReason: reason || ''
    });

    showToast('Solicitud rechazada', 'info');
    loadAdminSpotterRequests();

  } catch (error) {
    console.error('Error rejecting spotter:', error);
    showToast('Error al rechazar', 'error');
  }
}

async function loadAdminApprovedSpotters() {
  const listEl = document.getElementById('admin-approved-spotters-list');
  if (!listEl) return;

  listEl.innerHTML = '<div class="admin-loading"><div class="admin-spinner"></div><p>Cargando spotters...</p></div>';

  try {
    const db = firebase.firestore();
    const snapshot = await db.collection('admins')
      .where('role', '==', 'spotter')
      .get();

    adminApprovedSpotters = [];
    snapshot.forEach(doc => {
      adminApprovedSpotters.push({ id: doc.id, ...doc.data() });
    });

    renderAdminApprovedSpotters();

  } catch (error) {
    console.error('Error loading approved spotters:', error);
    listEl.innerHTML = '<div class="admin-empty-state"><p>Error al cargar spotters</p></div>';
  }
}

function renderAdminApprovedSpotters() {
  const listEl = document.getElementById('admin-approved-spotters-list');
  if (!listEl) return;

  if (adminApprovedSpotters.length === 0) {
    listEl.innerHTML = `
      <div class="admin-empty-state">
        <p>No hay spotters aprobados</p>
      </div>
    `;
    return;
  }

  listEl.innerHTML = adminApprovedSpotters.map(spotter => {
    const addedAt = spotter.addedAt?.toDate?.() ?
      spotter.addedAt.toDate().toLocaleDateString('es-ES', {
        day: '2-digit',
        month: 'short',
        year: 'numeric'
      }) : '';

    return `
      <div class="admin-user-row">
        <div class="admin-user-info">
          <div class="admin-user-email">${escapeHtmlAdmin(spotter.email || spotter.name || 'Usuario')}</div>
          <div class="admin-user-role">Spotter desde ${addedAt}</div>
        </div>
        <div class="admin-user-actions">
          <button onclick="revokeAdminSpotter('${spotter.id}')">Revocar</button>
        </div>
      </div>
    `;
  }).join('');
}

async function revokeAdminSpotter(spotterId) {
  if (!confirm('¿Revocar el rol de Spotter a este usuario?')) return;

  try {
    const db = firebase.firestore();

    // Obtener info del spotter para actualizar la solicitud original
    const spotterDoc = await db.collection('admins').doc(spotterId).get();
    const spotterData = spotterDoc.data();

    // Eliminar de admins
    await db.collection('admins').doc(spotterId).delete();

    // Actualizar la solicitud original si existe
    if (spotterData?.approvedFromRequest) {
      await db.collection('spotter_requests').doc(spotterData.approvedFromRequest).update({
        status: 'revoked',
        revokedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    }

    showToast('Rol de Spotter revocado', 'info');
    loadAdminApprovedSpotters();
    loadAdminStats();

  } catch (error) {
    console.error('Error revoking spotter:', error);
    showToast('Error al revocar', 'error');
  }
}

function escapeHtmlAdmin(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ================== MENTIONS SYSTEM ==================

// Escape HTML for safe rendering
function escapeHtmlMention(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  // innerHTML no escapa comillas: se escapan para poder usar el resultado también en atributos
  return div.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Render text with clickable mention links
function renderTextWithMentions(text, mentions) {
  if (!text) return '';
  if (!mentions || mentions.length === 0) {
    return escapeHtmlMention(text).replace(/\n/g, '<br>');
  }

  // Recalculate indices for each mention to handle trim/offset issues
  const recalculated = [];
  for (const mention of mentions) {
    if (!mention.uid || !mention.displayName) continue;
    const mentionStr = '@' + mention.displayName;

    // Check if stored indices are valid
    const segment = text.slice(mention.startIndex, mention.endIndex);
    if (segment === mentionStr) {
      recalculated.push({ ...mention });
    } else {
      // Fallback: find the mention string in the text
      const idx = text.indexOf(mentionStr);
      if (idx !== -1) {
        const alreadyClaimed = recalculated.some(
          rm => idx >= rm.startIndex && idx < rm.endIndex
        );
        if (!alreadyClaimed) {
          recalculated.push({
            uid: mention.uid,
            displayName: mention.displayName,
            startIndex: idx,
            endIndex: idx + mentionStr.length
          });
        }
      }
    }
  }

  if (recalculated.length === 0) {
    return escapeHtmlMention(text).replace(/\n/g, '<br>');
  }

  // Sort mentions by startIndex ascending
  const sorted = recalculated.sort((a, b) => a.startIndex - b.startIndex);

  let result = '';
  let lastIndex = 0;

  for (const mention of sorted) {
    if (mention.startIndex < lastIndex || mention.startIndex >= text.length) continue;
    // Add escaped text before this mention
    result += escapeHtmlMention(text.slice(lastIndex, mention.startIndex));
    // Add mention link
    const mentionText = text.slice(mention.startIndex, mention.endIndex);
    result += `<span class="mention-link" data-user-id="${escapeHtmlMention(mention.uid)}" onclick="openPublicProfile('${escapeHtmlMention(mention.uid)}')">${escapeHtmlMention(mentionText)}</span>`;
    lastIndex = mention.endIndex;
  }

  // Add remaining text
  result += escapeHtmlMention(text.slice(lastIndex));

  return result.replace(/\n/g, '<br>');
}
window.renderTextWithMentions = renderTextWithMentions;

// Validate and recalculate mention indices to match actual text
// Handles trim offsets and text modifications robustly
function extractMentionsFromText(text, mentionsList) {
  if (!mentionsList || mentionsList.length === 0) return [];
  if (!text) return [];

  const validMentions = [];

  for (const m of mentionsList) {
    const mentionStr = '@' + m.displayName;

    // 1. Try exact index match first (fast path)
    const segment = text.slice(m.startIndex, m.endIndex);
    if (segment === mentionStr) {
      validMentions.push({ ...m });
      continue;
    }

    // 2. Fallback: search for the mention string in the text
    // This handles cases where .trim() shifted indices
    const idx = text.indexOf(mentionStr);
    if (idx !== -1) {
      // Verify this position isn't already claimed by another valid mention
      const alreadyClaimed = validMentions.some(
        vm => idx >= vm.startIndex && idx < vm.endIndex
      );
      if (!alreadyClaimed) {
        validMentions.push({
          uid: m.uid,
          displayName: m.displayName,
          startIndex: idx,
          endIndex: idx + mentionStr.length
        });
      }
    }
  }

  return validMentions;
}

// Send mention notifications to all mentioned users
async function sendMentionNotifications(mentions, context) {
  if (!mentions || mentions.length === 0) return;

  const notifiedUids = new Set();
  for (const mention of mentions) {
    if (notifiedUids.has(mention.uid)) continue;
    if (mention.uid === currentUser?.uid) continue; // Don't notify yourself
    notifiedUids.add(mention.uid);

    const typeText = context.type === 'post' ? 'una publicación' :
                     context.type === 'comment' ? 'un comentario' :
                     'una respuesta';

    await createNotification(
      mention.uid,
      'mention',
      `te mencionó en ${typeText}`,
      { postId: context.postId || '' }
    );
  }
}

// MentionAutocomplete class - attaches to any input or textarea
class MentionAutocomplete {
  constructor(inputElement, options = {}) {
    this.input = inputElement;
    this.mentions = [];
    this.dropdown = null;
    this.searchTimeout = null;
    this.selectedIndex = -1;
    this.isOpen = false;
    this.mentionStart = -1;
    this.results = [];
    this.positionBelow = options.positionBelow || false;
    this.highlight = options.highlight || false;
    this.searchToken = 0;
    this.pendingEnter = false;

    this._init();
  }

  _init() {
    // Create dropdown
    this.dropdown = document.createElement('div');
    this.dropdown.className = 'mention-dropdown' + (this.positionBelow ? ' mention-dropdown-below' : '');

    // Insert dropdown in the input's parent (which should have position:relative)
    const parent = this.input.closest('form') || this.input.parentElement;
    if (parent) {
      parent.appendChild(this.dropdown);
    }

    // Bind event listeners
    this._onInputBound = this._onInput.bind(this);
    this._onKeyDownBound = this._onKeyDown.bind(this);
    this._onBlurBound = this._onBlur.bind(this);

    this.input.addEventListener('input', this._onInputBound);
    this.input.addEventListener('keydown', this._onKeyDownBound);
    this.input.addEventListener('blur', this._onBlurBound);

    // Store reference on the element
    this.input._mentionAutocomplete = this;

    // Capa bajo el texto que pinta las menciones confirmadas en azul (el texto del campo queda transparente)
    if (this.highlight) {
      this.highlightLayer = document.createElement('div');
      this.highlightLayer.className = 'mention-highlight';
      this.highlightLayer.setAttribute('aria-hidden', 'true');
      this.input.before(this.highlightLayer);
      this.input.classList.add('has-mention-highlight');
      this._renderHighlight();
    }
  }

  _renderHighlight() {
    if (!this.highlightLayer) return;
    const text = this.input.value;
    const found = extractMentionsFromText(text, this.mentions).sort((a, b) => a.startIndex - b.startIndex);
    let html = '';
    let last = 0;
    for (const m of found) {
      if (m.startIndex < last) continue;
      html += escapeHtmlMention(text.slice(last, m.startIndex));
      html += `<span class="mention-highlight-name">${escapeHtmlMention(text.slice(m.startIndex, m.endIndex))}</span>`;
      last = m.endIndex;
    }
    // El espacio final mantiene la altura cuando el texto acaba en salto de línea
    this.highlightLayer.innerHTML = html + escapeHtmlMention(text.slice(last)) + ' ';
  }

  _onInput() {
    this._renderHighlight();

    const cursorPos = this.input.selectionStart;
    const text = this.input.value;

    // Tras un espacio o salto de línea no se está escribiendo ninguna mención
    // (al elegir a alguien se añade un espacio: antes se volvía a buscar «@Nombre » y salía «Sin resultados»)
    if (cursorPos === 0 || /\s/.test(text[cursorPos - 1])) {
      this._hide();
      return;
    }

    // Find the last @ before cursor that isn't preceded by a word char
    let atIndex = -1;
    for (let i = cursorPos - 1; i >= 0; i--) {
      if (text[i] === '@') {
        // Check it's at start or preceded by whitespace
        if (i === 0 || /\s/.test(text[i - 1])) {
          atIndex = i;
        }
        break;
      }
      // If we hit whitespace before finding @, stop
      if (/\s/.test(text[i]) && i < cursorPos - 1) break;
    }

    if (atIndex === -1) {
      this._hide();
      return;
    }

    const query = text.slice(atIndex + 1, cursorPos);

    // Need at least 1 character to search
    if (query.length < 1) {
      this._hide();
      return;
    }

    // Una mención ya elegida no vuelve a abrir las sugerencias
    const confirmed = this.mentions.some(m =>
      m.startIndex === atIndex && text.slice(atIndex, m.endIndex) === '@' + m.displayName && cursorPos <= m.endIndex);
    if (confirmed) {
      this._hide();
      return;
    }

    this.mentionStart = atIndex;
    this.query = query;

    // Debounce search
    clearTimeout(this.searchTimeout);
    this.searchTimeout = setTimeout(() => {
      this.searchTimeout = null;
      this._searchUsers(query);
    }, 300);
  }

  _onKeyDown(e) {
    // Enter antes de que lleguen las sugerencias: se busca ya y se elige la primera
    if (e.key === 'Enter' && !e.shiftKey && (this.searchTimeout || (this.isOpen && this.selectedIndex < 0 && this.searching))) {
      e.preventDefault();
      e.stopPropagation();
      this.pendingEnter = true;
      if (this.searchTimeout) {
        clearTimeout(this.searchTimeout);
        this.searchTimeout = null;
        this._searchUsers(this.query);
      }
      return;
    }

    if (!this.isOpen) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      this.selectedIndex = Math.min(this.selectedIndex + 1, this.results.length - 1);
      this._updateSelection();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      this.selectedIndex = Math.max(this.selectedIndex - 1, 0);
      this._updateSelection();
    } else if (e.key === 'Enter' && this.selectedIndex >= 0) {
      e.preventDefault();
      e.stopPropagation();
      this._selectUser(this.results[this.selectedIndex]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      this._hide();
    }
  }

  _onBlur() {
    // Delay hide to allow click on dropdown items
    setTimeout(() => {
      this._hide();
    }, 200);
  }

  async _searchUsers(query) {
    const token = ++this.searchToken;
    this.searching = true;
    this.dropdown.innerHTML = '<div class="mention-dropdown-loading">Buscando...</div>';
    this._show();

    try {
      const users = await searchUsersGlobal(query);
      // Respuesta de una búsqueda anterior o de unas sugerencias ya cerradas
      if (token !== this.searchToken) return;
      this.searching = false;
      this.results = users || [];

      if (this.results.length === 0) {
        if (this.pendingEnter) {
          this._hide();
          return;
        }
        this.dropdown.innerHTML = '<div class="mention-dropdown-empty">Sin resultados</div>';
        return;
      }

      this.selectedIndex = 0;
      if (this.pendingEnter) {
        this._selectUser(this.results[0]);
        return;
      }
      this._renderResults();
    } catch (error) {
      console.error('Error searching users for mention:', error);
      if (token === this.searchToken) this._hide();
    }
  }

  _renderResults() {
    const html = this.results.map((user, index) => {
      const photoUrl = user.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.displayName || 'U')}&background=153E35&color=fff&size=32`;
      const name = escapeHtmlMention(user.displayName || 'Usuario');
      return `
        <div class="mention-dropdown-item ${index === this.selectedIndex ? 'selected' : ''}" data-index="${index}">
          <img src="${photoUrl}" alt="${name}" class="mention-dropdown-avatar" referrerPolicy="no-referrer" onerror="this.src='https://ui-avatars.com/api/?name=U&background=153E35&color=fff&size=32'; this.onerror=null;">
          <div class="mention-dropdown-info">
            <span class="mention-dropdown-name">${name}</span>
          </div>
        </div>
      `;
    }).join('');

    this.dropdown.innerHTML = html;

    // Attach click handlers
    this.dropdown.querySelectorAll('.mention-dropdown-item').forEach(item => {
      item.addEventListener('mousedown', (e) => {
        e.preventDefault(); // Prevent blur
        const idx = parseInt(item.dataset.index);
        this._selectUser(this.results[idx]);
      });
    });
  }

  _updateSelection() {
    this.dropdown.querySelectorAll('.mention-dropdown-item').forEach((item, i) => {
      item.classList.toggle('selected', i === this.selectedIndex);
    });

    // Scroll selected item into view
    const selected = this.dropdown.querySelector('.mention-dropdown-item.selected');
    if (selected) {
      selected.scrollIntoView({ block: 'nearest' });
    }
  }

  _selectUser(user) {
    if (!user) return;

    const text = this.input.value;
    const cursorPos = this.input.selectionStart;
    const displayName = user.displayName || 'Usuario';

    // Replace @query with @displayName
    const before = text.slice(0, this.mentionStart);
    const after = text.slice(cursorPos);
    const mentionText = '@' + displayName;
    const newText = before + mentionText + ' ' + after;

    this.input.value = newText;

    // Set cursor position after the mention + space
    const newCursorPos = this.mentionStart + mentionText.length + 1;
    this.input.setSelectionRange(newCursorPos, newCursorPos);

    // Recalculate indices for existing mentions that come after insertion
    const insertedLength = (mentionText + ' ').length;
    const removedLength = cursorPos - this.mentionStart;
    const delta = insertedLength - removedLength;

    this.mentions.forEach(m => {
      if (m.startIndex >= this.mentionStart) {
        m.startIndex += delta;
        m.endIndex += delta;
      }
    });

    // Store mention
    this.mentions.push({
      uid: user.id,
      displayName: displayName,
      startIndex: this.mentionStart,
      endIndex: this.mentionStart + mentionText.length
    });

    this._hide();

    // Trigger input event for any listeners (like char count)
    this.input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  _show() {
    this.isOpen = true;
    this.dropdown.classList.add('active');
  }

  _hide() {
    this.isOpen = false;
    this.selectedIndex = -1;
    this.results = [];
    this.searching = false;
    this.pendingEnter = false;
    this.searchToken++;
    this.dropdown.classList.remove('active');
    clearTimeout(this.searchTimeout);
    this.searchTimeout = null;
  }

  getMentions() {
    return [...this.mentions];
  }

  clearMentions() {
    this.mentions = [];
    this._renderHighlight();
  }

  destroy() {
    this.input.removeEventListener('input', this._onInputBound);
    this.input.removeEventListener('keydown', this._onKeyDownBound);
    this.input.removeEventListener('blur', this._onBlurBound);
    if (this.dropdown && this.dropdown.parentNode) {
      this.dropdown.parentNode.removeChild(this.dropdown);
    }
    this.highlightLayer?.remove();
    this.input.classList.remove('has-mention-highlight');
    this.input._mentionAutocomplete = null;
  }
}
window.MentionAutocomplete = MentionAutocomplete;

// ================== CREATE POST ==================
// `media` guarda fotos y vídeos en el orden en que se publicarán; photos/videos son vistas de esa lista
let cpMediaSeq = 0;
function newPostData() {
  return {
    text: '',
    media: [],
    ascents: [],
    suggestDismissed: false, // «ascensiones recientes» ocultadas con la X
    location: null,
    get photos() { return this.media.filter(m => m.kind === 'photo').map(m => m.file); },
    get videos() { return this.media.filter(m => m.kind === 'video').map(m => m.file); }
  };
}
let postData = newPostData();
let postMentionAutocomplete = null;

function initCreatePost() {
  const createBtn = document.getElementById('nav-create-btn');
  const modal = document.getElementById('create-post-modal');
  const closeBtn = document.getElementById('close-create-modal');
  const submitBtn = document.getElementById('submit-create-post');
  const textarea = document.getElementById('create-post-text');
  const charCount = document.getElementById('create-post-char-count-num');
  const form = document.getElementById('create-post-form');
  const photoBtn = document.getElementById('add-photo-btn');
  const videoBtn = document.getElementById('add-video-btn');
  const ascentBtn = document.getElementById('add-ascent-btn');
  const locationBtn = document.getElementById('add-location-btn');
  const photoInput = document.getElementById('create-post-photo-input');
  const videoInput = document.getElementById('create-post-video-input');
  const preview = document.getElementById('create-post-preview');

  if (!createBtn || !modal) return;

  // Open modal
  const openCreatePost = () => {
    if (!currentUser) {
      showToast('Inicia sesión para crear publicaciones', 'info');
      return false;
    }
    resetPostData();
    updateUserInfo();
    modal.classList.remove('hidden');
    startCreatePostViewportSync();
    return true;
  };

  createBtn.addEventListener('click', () => {
    if (openCreatePost()) setTimeout(() => textarea?.focus(), 100);
  });

  // Cámara del compositor: abre la cámara del móvil y lo capturado va a una publicación nueva (sin publicarla).
  // Se pasa por los mismos campos de foto y vídeo para que valgan sus límites y avisos.
  const cameraBtn = document.getElementById('feed-camera-btn');
  const cameraInput = document.getElementById('feed-camera-input');
  cameraBtn?.addEventListener('click', () => {
    if (!currentUser) {
      showToast('Inicia sesión para crear publicaciones', 'info');
      return;
    }
    cameraInput?.click();
  });
  cameraInput?.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file || !openCreatePost()) return;
    const isVideo = (file.type || '').startsWith('video/');
    const target = isVideo ? videoInput : photoInput;
    try {
      const transfer = new DataTransfer();
      transfer.items.add(file);
      target.files = transfer.files;
      target.dispatchEvent(new Event('change'));
    } catch (err) {
      console.error('No se pudo añadir lo capturado a la publicación:', err);
      showToast('No se pudo añadir. Prueba con los botones Foto o Vídeo', 'error');
    }
  });

  // Escape cierra primero el buscador de ubicación y después el editor
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || modal.classList.contains('hidden')) return;
    const locationBox = document.getElementById('location-search-container');
    const ascentPicker = document.getElementById('ascent-picker');
    if (ascentPicker && !ascentPicker.classList.contains('hidden')) {
      closeAscentPicker();
    } else if (locationBox && !locationBox.classList.contains('hidden')) {
      locationBox.classList.add('hidden');
      document.getElementById('add-location-btn')?.focus();
    } else {
      closeCreatePostModal();
    }
  });

  // Close modal
  closeBtn?.addEventListener('click', () => {
    closeCreatePostModal();
  });

  // Close on backdrop
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closeCreatePostModal();
    }
  });

  // Textarea input handler
  textarea?.addEventListener('input', (e) => {
    postData.text = e.target.value;
    const count = e.target.value.length;
    charCount.textContent = count;

    // Enable/disable submit button
    updateSubmitButton();

    // Aviso cerca del límite (colores semánticos en CSS)
    const counter = charCount.parentElement;
    counter?.classList.toggle('is-warn', count > 1500 && count <= 1800);
    counter?.classList.toggle('is-limit', count > 1800);

    autoSizeCreatePostText();
  });

  // Attach mention autocomplete to post textarea (dropdown appears below)
  if (textarea && !textarea._mentionAutocomplete) {
    postMentionAutocomplete = new MentionAutocomplete(textarea, { positionBelow: true, highlight: true });
    // La clase la coloca al final del <form>: aquí quedaría bajo fotos y acciones (y tras el teclado)
    const compose = textarea.closest('.create-post-compose');
    if (compose && postMentionAutocomplete.dropdown) compose.appendChild(postMentionAutocomplete.dropdown);
  }

  // Photo button
  photoBtn?.addEventListener('click', () => {
    photoInput?.click();
  });

  photoInput?.addEventListener('change', (e) => {
    const files = Array.from(e.target.files);
    if (files.length > 0) {
      // Se añaden a las ya elegidas («Añadir más fotos»); las fotos y los vídeos conviven en la publicación
      postData.media.push(...files.map(file => ({ id: ++cpMediaSeq, kind: 'photo', file })));
      updatePreview();
      updateSubmitButton();
    }
    e.target.value = '';
  });

  // Video button
  videoBtn?.addEventListener('click', () => {
    videoInput?.click();
  });

  videoInput?.addEventListener('change', (e) => {
    const files = Array.from(e.target.files).filter(f => !f.type || f.type.startsWith('video/'));
    if (files.length > 0) {
      const room = KX_MAX_POST_VIDEOS - postData.videos.length;
      const tooBig = files.filter(f => f.size > KX_VIDEO_MAX_BYTES);
      const accepted = files.filter(f => f.size <= KX_VIDEO_MAX_BYTES).slice(0, Math.max(room, 0));
      if (tooBig.length) showToast(`Los vídeos no pueden pesar más de ${Math.round(KX_VIDEO_MAX_BYTES / 1048576)} MB`, 'error');
      else if (files.length > room) showToast(`Máximo ${KX_MAX_POST_VIDEOS} vídeos por publicación`, 'warning');
      if (accepted.length) {
        postData.media.push(...accepted.map(file => ({ id: ++cpMediaSeq, kind: 'video', file })));
        updatePreview();
        updateSubmitButton();
      }
    }
    e.target.value = '';
  });

  // Ascent button
  ascentBtn?.addEventListener('click', () => openAscentPicker());
  document.getElementById('ascent-picker-back')?.addEventListener('click', closeAscentPicker);
  document.getElementById('ascent-picker-search')?.addEventListener('input', renderAscentPicker);
  document.getElementById('ascent-picker-list')?.addEventListener('click', (e) => {
    if (e.target.closest('[data-goto-map]')) {
      closeAscentPicker();
      showToast('Abre una vía en el mapa para registrar una ascensión', 'info');
      modal.classList.add('hidden');
      switchView('map-view');
      return;
    }
    if (e.target.closest('[data-retry]')) { openAscentPicker(true); return; }
    const row = e.target.closest('[data-ascent-id]');
    if (row) toggleAscentSelection(row.dataset.ascentId);
  });
  document.getElementById('ascent-picker-done')?.addEventListener('click', confirmAscentSelection);

  // Location selector setup
  const locationSearchContainer = document.getElementById('location-search-container');
  const locationSearchInput = document.getElementById('location-search-input');
  const locationResults = document.getElementById('location-results');
  const locationBadge = document.getElementById('location-badge');
  const locationBadgeText = document.getElementById('location-badge-text');
  const locationBadgeRemove = document.getElementById('location-badge-remove');

  let locationSearchTimeout = null;
  let selectedLocationName = null;

  // Toggle search input
  locationBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    const isHidden = locationSearchContainer.classList.contains('hidden');

    // Close other location selectors if any
    document.querySelectorAll('.location-search-container').forEach(container => {
      if (container !== locationSearchContainer) container.classList.add('hidden');
    });

    if (isHidden) {
      locationSearchContainer.classList.remove('hidden');
      // Position container relative to button
      positionLocationContainer();
      locationSearchInput.focus();
      // Show current location option immediately
      showLocationOptions();
    } else {
      locationSearchContainer.classList.add('hidden');
      locationResults.innerHTML = '';
    }
  });

  // Position the search container relative to the button
  function positionLocationContainer() {
    // CSS handles positioning with absolute and left: calc(100% + 8px)
    // No need for manual positioning
  }

  // Close search container when clicking outside
  document.addEventListener('click', (e) => {
    if (!locationSearchContainer.contains(e.target) &&
      e.target !== locationBtn &&
      !locationBtn.contains(e.target)) {
      locationSearchContainer.classList.add('hidden');
      locationResults.innerHTML = '';
    }
  });

  // Show location options (current location + search results)
  function showLocationOptions() {
    if (!locationResults) return;

    // Always show "Current Location" as first option
    const currentLocationOption = document.createElement('li');
    currentLocationOption.className = 'location-result-item location-current-option';
    currentLocationOption.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <polygon points="3 11 22 2 13 21 11 13 3 11"></polygon>
      </svg>
      <span>Usar mi ubicación actual</span>
    `;
    currentLocationOption.addEventListener('click', async () => {
      await useCurrentLocation();
    });

    locationResults.innerHTML = '';
    locationResults.appendChild(currentLocationOption);
  }

  // Use current location
  async function useCurrentLocation() {
    if (!navigator.geolocation) {
      showToast('La geolocalización no está disponible', 'error');
      return;
    }

    // Show loading state
    const currentOption = locationResults.querySelector('.location-current-option');
    if (currentOption) {
      currentOption.style.opacity = '0.6';
      currentOption.style.pointerEvents = 'none';
      const span = currentOption.querySelector('span');
      if (span) span.textContent = 'Obteniendo ubicación…';
    }

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;

        try {
          // Reverse geocoding to get location name
          const response = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=10&addressdetails=1`,
            {
              headers: {
                'User-Agent': 'KRUX App'
              }
            }
          );
          const data = await response.json();

          const locationName = data.display_name || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;

          postData.location = {
            lat: lat,
            lng: lng,
            name: locationName
          };

          selectedLocationName = locationName;
          showLocationBadge(locationName);
          locationSearchContainer.classList.add('hidden');
          locationSearchInput.value = '';
          locationResults.innerHTML = '';
          showToast('Ubicación añadida', 'success');
          updatePreview();
        } catch (error) {
          console.error('Error getting location name:', error);
          // Fallback: use coordinates
          postData.location = {
            lat: lat,
            lng: lng,
            name: `${lat.toFixed(4)}, ${lng.toFixed(4)}`
          };
          selectedLocationName = postData.location.name;
          showLocationBadge(postData.location.name);
          locationSearchContainer.classList.add('hidden');
          locationSearchInput.value = '';
          locationResults.innerHTML = '';
          showToast('Ubicación añadida', 'success');
          updatePreview();
        }
      },
      () => {
        showToast('No se pudo obtener la ubicación', 'error');
        // Restore option
        if (currentOption) {
          currentOption.style.opacity = '1';
          currentOption.style.pointerEvents = 'auto';
          const span = currentOption.querySelector('span');
          if (span) span.textContent = 'Usar mi ubicación actual';
        }
      }
    );
  }

  // Search input with debounce
  locationSearchInput?.addEventListener('input', (e) => {
    const query = e.target.value.trim();

    // Clear previous timeout
    if (locationSearchTimeout) {
      clearTimeout(locationSearchTimeout);
    }

    // If empty, show only current location option
    if (!query) {
      showLocationOptions();
      return;
    }

    // Debounce: wait 400ms before searching
    locationSearchTimeout = setTimeout(async () => {
      await searchLocations(query);
    }, 400);
  });

  // Focus event - show current location option
  locationSearchInput?.addEventListener('focus', () => {
    showLocationOptions();
  });

  // Search locations using Nominatim API
  async function searchLocations(query) {
    if (!query || query.length < 2) {
      showLocationOptions();
      return;
    }

    try {
      // Show current location option + loading
      showLocationOptions();
      const loadingLi = document.createElement('li');
      loadingLi.className = 'location-result-loading';
      loadingLi.textContent = 'Buscando...';
      locationResults.appendChild(loadingLi);

      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5&addressdetails=1`,
        {
          headers: {
            'User-Agent': 'KRUX App'
          }
        }
      );

      const data = await response.json();

      // Remove loading indicator
      const loading = locationResults.querySelector('.location-result-loading');
      if (loading) loading.remove();

      if (data.length === 0) {
        const emptyLi = document.createElement('li');
        emptyLi.className = 'location-result-empty';
        emptyLi.textContent = 'No se encontraron resultados';
        locationResults.appendChild(emptyLi);
        return;
      }

      // Add search results (keep current location option at top)
      data.forEach(place => {
        const li = document.createElement('li');
        li.className = 'location-result-item';
        li.textContent = place.display_name;
        li.addEventListener('click', () => {
          selectLocation(place);
        });
        locationResults.appendChild(li);
      });
    } catch (error) {
      console.error('Error searching locations:', error);
      // Remove loading if exists
      const loading = locationResults.querySelector('.location-result-loading');
      if (loading) loading.remove();

      const errorLi = document.createElement('li');
      errorLi.className = 'location-result-error';
      errorLi.textContent = 'Error al buscar ubicaciones';
      locationResults.appendChild(errorLi);
    }
  }

  // Select location from search results
  function selectLocation(place) {
    const lat = parseFloat(place.lat);
    const lng = parseFloat(place.lon);

    postData.location = {
      lat: lat,
      lng: lng,
      name: place.display_name
    };

    selectedLocationName = place.display_name;
    showLocationBadge(place.display_name);
    locationSearchContainer.classList.add('hidden');
    locationSearchInput.value = '';
    locationResults.innerHTML = '';
    showToast('Ubicación añadida', 'success');
    updatePreview();
  }

  // Show location badge
  function showLocationBadge(name) {
    if (locationBadgeText && locationBadge) {
      locationBadgeText.textContent = name;
      locationBadge.classList.remove('hidden');
    }
  }

  // Initialize location badge if location exists
  if (postData.location && postData.location.name) {
    showLocationBadge(postData.location.name);
  }

  // Remove location badge
  locationBadgeRemove?.addEventListener('click', (e) => {
    e.stopPropagation();
    postData.location = null;
    selectedLocationName = null;
    locationBadge.classList.add('hidden');
    updatePreview();
    showToast('Ubicación eliminada', 'info');
  });

  // Submit form
  submitBtn?.addEventListener('click', async () => {
    await submitPost();
  });

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    await submitPost();
  });
}

function resetPostData() {
  postData = newPostData();
  cpGrabbedId = null;
  const title = document.getElementById('create-post-title');
  if (title) title.textContent = 'Crear publicación';
  const submit = document.getElementById('submit-create-post');
  if (submit && !submit.classList.contains('is-loading')) submit.textContent = 'Publicar';
  document.getElementById('create-post-text').value = '';
  if (postMentionAutocomplete) postMentionAutocomplete.clearMentions();
  document.getElementById('create-post-char-count-num').textContent = '0';
  document.getElementById('create-post-char-count-num').parentElement?.classList.remove('is-warn', 'is-limit');
  document.getElementById('create-post-photo-input').value = '';
  document.getElementById('create-post-video-input').value = '';
  document.getElementById('create-post-preview').innerHTML = '';
  document.getElementById('create-post-preview').classList.add('hidden');

  // Reset location badge
  const locationBadge = document.getElementById('location-badge');
  const locationSearchContainer = document.getElementById('location-search-container');
  const locationSearchInput = document.getElementById('location-search-input');
  const locationResults = document.getElementById('location-results');
  if (locationBadge) locationBadge.classList.add('hidden');
  if (locationSearchContainer) locationSearchContainer.classList.add('hidden');
  if (locationSearchInput) locationSearchInput.value = '';
  if (locationResults) locationResults.innerHTML = '';

  closeAscentPicker();
  cpPickerToken++;
  cpAscentsCache = null;

  autoSizeCreatePostText();
  updateActionStates();
  updateSubmitButton();
}

// ================== ASCENSIÓN EN EL EDITOR (desde el libro de ascensiones) ==================
let cpAscentsCache = null;
let cpPickerToken = 0;
let cpPickerSel = []; // ids elegidos en el selector, en orden de elección

// Chip de grado con el color oficial y texto legible (lo usan el buscador y las tarjetas de ascensión)
function kxGradeChipHTML(grade, className = 'kx-ascent-grade') {
  const g = grade || '?';
  let bg = '#5A665F';
  try { if (typeof getGradeColor === 'function') bg = getGradeColor(g) || bg; } catch (_) { /* sin color de grado */ }
  let fg = '#fff';
  const m = /^#?([0-9a-f]{6})$/i.exec(bg);
  if (m) {
    const n = parseInt(m[1], 16);
    const lum = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
    if (lum > 0.62) fg = '#202923';
  }
  return `<span class="${className}" style="background:${bg};color:${fg}">${escapeHtmlMention(String(g))}</span>`;
}

function kxAscentDate(ascent) {
  const d = ascent && ascent.date;
  if (!d) return null;
  const date = d.toDate ? d.toDate() : (d.seconds ? new Date(d.seconds * 1000) : new Date(d));
  return isNaN(date.getTime()) ? null : date;
}

function kxAscentDateLabel(ascent) {
  const date = kxAscentDate(ascent);
  if (!date) return '';
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString('es-ES', sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' }).replace('.', '');
}

const KX_MAX_POST_ASCENTS = 10;
const KX_ASCENTS_VISIBLE = 3;

// Ascensiones de una publicación: `ascents` (varias) o `ascent` (publicaciones con una sola)
function kxPostAscents(post) {
  const list = Array.isArray(post?.ascents) ? post.ascents : (post?.ascent ? [post.ascent] : []);
  return list.filter(a => a && a.routeName);
}

// Lista de tarjetas. En el feed muestra las primeras y deja el resto plegado
function kxAscentListHTML(ascents, { removable = false } = {}) {
  if (!ascents || ascents.length === 0) return '';
  const card = (a, i) => kxAscentCardHTML(a, { removable, index: i });
  if (removable || ascents.length <= KX_ASCENTS_VISIBLE) {
    return `<div class="kx-ascent-list">${ascents.map(card).join('')}</div>`;
  }
  const rest = ascents.length - KX_ASCENTS_VISIBLE;
  return `<div class="kx-ascent-list">
    ${ascents.slice(0, KX_ASCENTS_VISIBLE).map(card).join('')}
    <details class="kx-ascent-more">
      <summary>Ver ${rest} ${rest === 1 ? 'ascensión más' : 'ascensiones más'}</summary>
      ${ascents.slice(KX_ASCENTS_VISIBLE).map(card).join('')}
    </details>
  </div>`;
}

// Tarjeta de ascensión (editor, feed y publicación abierta)
function kxAscentCardHTML(ascent, { removable = false, index = 0 } = {}) {
  if (!ascent || !ascent.routeName) return '';
  const style = (typeof STYLE_LABELS !== 'undefined' && STYLE_LABELS[ascent.style]) || '';
  const place = [ascent.schoolName, ascent.sector].filter(Boolean).map(escapeHtmlMention).join(' · ');
  const sub = [style, kxAscentDateLabel(ascent)].filter(Boolean).map(escapeHtmlMention).join(' · ');
  const attempt = ascent.style === 'project' ? ' is-attempt' : '';
  // Publicada: el grado lleva a la vía en el mapa
  const grade = removable
    ? kxGradeChipHTML(ascent.grade)
    : `<button type="button" class="kx-ascent-grade-link" data-ascent-map data-route-name="${escapeHtmlMention(ascent.routeName)}" data-school-id="${escapeHtmlMention(ascent.schoolId || '')}" data-sector="${escapeHtmlMention(ascent.sector || '')}" aria-label="Ver ${escapeHtmlMention(ascent.routeName)} en el mapa">${kxGradeChipHTML(ascent.grade)}</button>`;
  return `
    <div class="kx-ascent-card${attempt}${removable ? ' is-removable' : ''}"${removable ? ' role="button" tabindex="0" data-change-ascent aria-label="Editar ascensiones"' : ''}>
      ${grade}
      <div class="kx-ascent-info">
        <span class="kx-ascent-name">${escapeHtmlMention(ascent.routeName)}</span>
        ${place ? `<span class="kx-ascent-meta">${place}</span>` : ''}
        ${sub ? `<span class="kx-ascent-sub">${sub}</span>` : ''}
      </div>
      ${removable ? `<button type="button" class="remove-preview-btn" data-type="ascent" data-index="${index}" aria-label="Quitar ${escapeHtmlMention(ascent.routeName)}">${CP_REMOVE_ICON}</button>` : ''}
    </div>`;
}

// El grado de una ascensión publicada abre la vía en el mapa (captura: no abre además la publicación)
document.addEventListener('click', (e) => {
  const btn = e.target.closest && e.target.closest('[data-ascent-map]');
  if (!btn) return;
  e.preventDefault();
  e.stopPropagation();
  if (typeof window.kxOpenAscentOnMap !== 'function') return;
  window.kxOpenAscentOnMap({
    routeName: btn.dataset.routeName,
    schoolId: btn.dataset.schoolId,
    sector: btn.dataset.sector
  });
}, true);

function kxNormalizeText(t) {
  return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

async function openAscentPicker(forceReload = false) {
  const picker = document.getElementById('ascent-picker');
  const list = document.getElementById('ascent-picker-list');
  const search = document.getElementById('ascent-picker-search');
  if (!picker || !list) return;
  picker.classList.remove('hidden');
  if (search) search.value = '';
  cpPickerSel = (postData.ascents || []).map(a => a.ascentId).filter(Boolean);
  updateAscentPickerFooter();
  if (cpAscentsCache && !forceReload) {
    renderAscentPicker();
    setTimeout(() => search?.focus(), 60);
    return;
  }
  const token = ++cpPickerToken;
  list.innerHTML = '<div class="cp-picker-state" role="status">Cargando tus ascensiones…</div>';
  try {
    const all = await getUserAscentsByUserId(currentUser?.uid, 500);
    if (token !== cpPickerToken) return;
    cpAscentsCache = (all || [])
      .filter(a => a && a.routeName)
      .sort((a, b) => (kxAscentDate(b)?.getTime() || 0) - (kxAscentDate(a)?.getTime() || 0));
    renderAscentPicker();
  } catch (e) {
    console.error('Error cargando ascensiones:', e);
    if (token !== cpPickerToken) return;
    list.innerHTML = '<div class="cp-picker-state">No se han podido cargar tus ascensiones.<button type="button" class="cp-picker-link" data-retry>Reintentar</button></div>';
  }
}

function renderAscentPicker() {
  const list = document.getElementById('ascent-picker-list');
  if (!list || !cpAscentsCache) return;
  const q = kxNormalizeText(document.getElementById('ascent-picker-search')?.value).trim();
  if (cpAscentsCache.length === 0) {
    list.innerHTML = '<div class="cp-picker-state">Aún no tienes ascensiones en tu libro.<button type="button" class="cp-picker-link" data-goto-map>Ir al mapa</button></div>';
    return;
  }
  const items = q
    ? cpAscentsCache.filter(a => kxNormalizeText([a.routeName, a.schoolName, a.sector, a.grade].join(' ')).includes(q))
    : cpAscentsCache;
  if (items.length === 0) {
    list.innerHTML = '<div class="cp-picker-state">Ninguna ascensión coincide con la búsqueda.</div>';
    return;
  }
  list.innerHTML = items.map(a => {
    const on = cpPickerSel.includes(a.id);
    const style = STYLE_LABELS[a.style] || '';
    const place = [a.schoolName, a.sector].filter(Boolean).map(escapeHtmlMention).join(' · ');
    const sub = [style, kxAscentDateLabel(a)].filter(Boolean).map(escapeHtmlMention).join(' · ');
    return `
      <button type="button" class="cp-ascent-row${on ? ' is-selected' : ''}" data-ascent-id="${escapeHtmlMention(a.id)}" aria-pressed="${on}">
        ${kxGradeChipHTML(a.grade)}
        <span class="kx-ascent-info">
          <span class="kx-ascent-name">${escapeHtmlMention(a.routeName)}</span>
          ${place ? `<span class="kx-ascent-meta">${place}</span>` : ''}
          ${sub ? `<span class="kx-ascent-sub">${sub}</span>` : ''}
        </span>
        <span class="cp-ascent-check" aria-hidden="true"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg></span>
      </button>`;
  }).join('');
}

function closeAscentPicker() {
  document.getElementById('ascent-picker')?.classList.add('hidden');
  const btn = document.getElementById('add-ascent-btn');
  if (btn && document.activeElement && document.getElementById('ascent-picker')?.contains(document.activeElement)) btn.focus();
}

function ascentToPostData(a) {
  const date = kxAscentDate(a);
  const ascent = {
    ascentId: a.id,
    routeId: a.routeId,
    routeName: a.routeName,
    grade: a.grade,
    style: a.style,
    schoolId: a.schoolId,
    schoolName: a.schoolName,
    sector: a.sector,
    date: date ? date.toISOString() : null
  };
  // Firestore no admite undefined
  Object.keys(ascent).forEach(k => { if (ascent[k] === undefined || ascent[k] === null) delete ascent[k]; });
  return ascent;
}

function updateAscentPickerFooter() {
  const btn = document.getElementById('ascent-picker-done');
  if (!btn) return;
  const n = cpPickerSel.length;
  btn.disabled = n === 0;
  btn.textContent = n === 0 ? 'Elige una o varias' : n === 1 ? 'Añadir 1 ascensión' : `Añadir ${n} ascensiones`;
}

function toggleAscentSelection(id) {
  const i = cpPickerSel.indexOf(id);
  if (i >= 0) {
    cpPickerSel.splice(i, 1);
  } else {
    if (cpPickerSel.length >= KX_MAX_POST_ASCENTS) {
      showToast(`Máximo ${KX_MAX_POST_ASCENTS} ascensiones por publicación`, 'warning');
      return;
    }
    cpPickerSel.push(id);
  }
  const row = document.querySelector(`#ascent-picker-list [data-ascent-id="${CSS.escape(id)}"]`);
  if (row) {
    row.classList.toggle('is-selected', i < 0);
    row.setAttribute('aria-pressed', String(i < 0));
  }
  updateAscentPickerFooter();
}

function confirmAscentSelection() {
  if (cpPickerSel.length === 0) return;
  const current = new Map((postData.ascents || []).map(a => [a.ascentId, a]));
  postData.ascents = cpPickerSel
    .map(id => {
      const a = (cpAscentsCache || []).find(x => x.id === id);
      return a ? ascentToPostData(a) : current.get(id);
    })
    .filter(Boolean);
  closeAscentPicker();
  updatePreview();
  updateSubmitButton();
}

// ================== RECORTAR VÍDEO ==================
// Se graba el tramo elegido reproduciéndolo (igual que la compresión): hace falta MediaRecorder con MP4.
// El archivo recortado sustituye al del editor y se guarda el original en `orig` para poder reajustar el recorte.
const KX_TRIM_MIN_SECONDS = 1;
const KX_TRIM_FRAMES = 8;
let kxTrimmerEl = null;

function kxCanTrimVideo() {
  return !!kxVideoRecorderMime() && !!(window.AudioContext || window.webkitAudioContext);
}

function kxTrimTime(seconds) {
  const t = Math.max(0, seconds);
  const m = Math.floor(t / 60);
  const sec = t - m * 60;
  return `${m}:${sec < 10 ? '0' : ''}${sec.toFixed(1)}`;
}

// `opts.remote` = { url, poster, onSave(file|null) }: cambia solo la portada de un vídeo ya publicado
// (sin recorte). `onSave` recibe la imagen nueva o null para volver al primer fotograma.
function openVideoTrimmer(mediaId, opener, opts = {}) {
  const remote = opts.remote || null;
  const item = remote ? { kind: 'video', cover: remote.poster ? { time: -1 } : null } : postData.media.find(m => m.id === mediaId);
  if (!item || item.kind !== 'video' || kxTrimmerEl) return;
  const source = remote ? null : (item.orig || item.file); // siempre se recorta desde el original
  const url = remote ? remote.url : URL.createObjectURL(source);

  const el = document.createElement('div');
  el.className = 'kx-trim';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', 'Editar vídeo');
  el.dataset.mode = 'trim';
  el.innerHTML = `
    <div class="kx-trim-head">
      <button type="button" class="kx-trim-cancel" data-trim-cancel>Cancelar</button>
      <h2>${remote ? 'Portada del vídeo' : 'Editar vídeo'}</h2>
      <button type="button" class="kx-trim-apply" data-trim-apply disabled>Aplicar</button>
    </div>
    <div class="kx-trim-tabs" role="tablist" aria-label="Qué quieres cambiar" ${remote ? 'hidden' : ''}>
      <button type="button" role="tab" data-tab="trim" aria-selected="true">Recortar</button>
      <button type="button" role="tab" data-tab="cover" aria-selected="false">Portada</button>
    </div>
    <div class="kx-trim-stage">
      <video playsinline preload="auto" aria-label="Vista previa del vídeo"></video>
      <button type="button" class="kx-trim-play" aria-label="Reproducir">
        <svg class="kx-trim-icon-play" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>
        <svg class="kx-trim-icon-pause" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6.5" y="5" width="4" height="14" rx="1.2"/><rect x="13.5" y="5" width="4" height="14" rx="1.2"/></svg>
      </button>
    </div>
    <div class="kx-trim-panel">
      <div class="kx-trim-times" aria-live="polite">
        <span data-t-start>0:00.0</span>
        <strong data-t-len>Cargando…</strong>
        <span data-t-end>0:00.0</span>
      </div>
      <div class="kx-trim-track" data-track>
        <div class="kx-trim-strip" data-strip></div>
        <div class="kx-trim-shade is-before" data-shade-a></div>
        <div class="kx-trim-shade is-after" data-shade-b></div>
        <div class="kx-trim-window" data-window></div>
        <div class="kx-trim-playhead" data-playhead></div>
        <button type="button" class="kx-cover-thumb" data-cover-thumb role="slider" aria-label="Fotograma de la portada"
          aria-valuemin="0" aria-valuemax="0" aria-valuenow="0"><span></span></button>
        <button type="button" class="kx-trim-handle is-start" data-handle="start" role="slider" aria-label="Inicio del vídeo"
          aria-valuemin="0" aria-valuemax="0" aria-valuenow="0"><span></span></button>
        <button type="button" class="kx-trim-handle is-end" data-handle="end" role="slider" aria-label="Final del vídeo"
          aria-valuemin="0" aria-valuemax="0" aria-valuenow="0"><span></span></button>
      </div>
      <p class="kx-trim-hint" data-hint>Arrastra los extremos para elegir el trozo que se publica.</p>
      <button type="button" class="kx-cover-reset" data-cover-reset hidden>Usar el primer fotograma</button>
    </div>
    <div class="kx-trim-busy" data-busy hidden>
      <div class="kx-trim-spinner" aria-hidden="true"></div>
      <p data-busy-text role="status">Guardando…</p>
      <button type="button" class="kx-trim-cancel" data-busy-cancel>Cancelar</button>
    </div>`;

  const q = (sel) => el.querySelector(sel);
  const video = q('video');
  const track = q('[data-track]');
  const applyBtn = q('[data-trim-apply]');
  const playBtn = q('.kx-trim-play');
  const handles = { start: q('[data-handle="start"]'), end: q('[data-handle="end"]') };
  let D = 0, s = 0, e = 0;
  let mode = 'trim';
  // null = primer fotograma. En un vídeo ya publicado la portada actual no tiene tiempo conocido (time -1)
  let coverTime = item.cover && item.cover.time >= 0 ? item.cover.time : null;
  let coverTouched = false;
  const prevCover = item.cover ? item.cover.time : null;
  // La portada solo vale si cae dentro del tramo; si el recorte la deja fuera se usa el primer fotograma del tramo
  const coverInRange = () => (coverTime !== null && coverTime >= s - 0.01 && coverTime <= e + 0.01 ? coverTime : null);
  const coverIsChanged = () => (prevCover !== null && prevCover < 0 ? coverTouched : coverInRange() !== prevCover);
  let raf = 0;
  let abort = null;
  const app = document.getElementById('create-post-modal');
  if (remote) video.crossOrigin = 'anonymous'; // hace falta para copiar un fotograma a un lienzo
  video.src = url;

  const pct = (t) => (D ? (t / D) * 100 : 0);
  const paint = () => {
    q('[data-t-start]').textContent = kxTrimTime(s);
    q('[data-t-end]').textContent = kxTrimTime(e);
    q('[data-t-len]').textContent = `${kxTrimTime(e - s)} s`;
    q('[data-window]').style.cssText = `left:${pct(s)}%;width:${pct(e - s)}%`;
    q('[data-shade-a]').style.width = `${pct(s)}%`;
    q('[data-shade-b]').style.width = `${100 - pct(e)}%`;
    handles.start.style.left = `${pct(s)}%`;
    handles.end.style.left = `${pct(e)}%`;
    [['start', s], ['end', e]].forEach(([k, v]) => {
      handles[k].setAttribute('aria-valuemax', String(Math.round(D * 10) / 10));
      handles[k].setAttribute('aria-valuenow', String(Math.round(v * 10) / 10));
      handles[k].setAttribute('aria-valuetext', kxTrimTime(v));
    });
    const changed = s > 0.05 || e < D - 0.05;
    const tooLong = changed && e - s > KX_VIDEO_MAX_COMPRESS_SECONDS;
    if (tooLong) q('[data-t-len]').textContent += ` · máx. ${KX_VIDEO_MAX_COMPRESS_SECONDS / 60} min`;
    // Portada: dentro del tramo elegido
    const ct = coverInRange();
    const lost = coverTime !== null && ct === null;
    const thumb = q('[data-cover-thumb]');
    thumb.hidden = ct === null && mode !== 'cover';
    thumb.style.left = `${pct(ct === null ? s : ct)}%`;
    thumb.setAttribute('aria-valuemax', String(Math.round(D * 10) / 10));
    thumb.setAttribute('aria-valuenow', String(Math.round((ct === null ? s : ct) * 10) / 10));
    thumb.setAttribute('aria-valuetext', kxTrimTime(ct === null ? s : ct));
    if (mode === 'cover') {
      q('[data-t-len]').textContent = ct === null ? 'Primer fotograma' : `Portada en ${kxTrimTime(ct)}`;
    }
    q('[data-cover-reset]').hidden = mode !== 'cover' || (coverTime === null && !(prevCover !== null && prevCover < 0 && !coverTouched));
    q('[data-hint]').textContent = lost
      ? 'La portada elegida queda fuera del recorte: se usará el primer fotograma del tramo.'
      : (mode === 'cover'
        ? 'Toca o arrastra por la línea de tiempo para elegir la imagen de la portada.'
        : 'Arrastra los extremos para elegir el trozo que se publica.');
    applyBtn.disabled = !D || tooLong || !(changed || item.orig || coverIsChanged());
  };
  const paintHead = () => {
    q('[data-playhead]').hidden = mode === 'cover';
    q('[data-playhead]').style.left = `${pct(Math.min(Math.max(video.currentTime, s), e))}%`;
  };
  const setPlaying = (on) => {
    el.classList.toggle('is-playing', on);
    playBtn.setAttribute('aria-label', on ? 'Pausar' : 'Reproducir');
  };
  const tick = () => {
    if (video.currentTime >= e - 0.02) { video.pause(); video.currentTime = s; setPlaying(false); paintHead(); return; }
    paintHead();
    raf = requestAnimationFrame(tick);
  };
  const play = () => {
    if (video.currentTime < s || video.currentTime >= e - 0.05) video.currentTime = s;
    video.play().then(() => { setPlaying(true); cancelAnimationFrame(raf); raf = requestAnimationFrame(tick); }).catch(() => {});
  };
  const pause = () => { video.pause(); cancelAnimationFrame(raf); setPlaying(false); };
  playBtn.addEventListener('click', () => (video.paused ? play() : pause()));
  q('.kx-trim-stage').addEventListener('click', (ev) => { if (!ev.target.closest('.kx-trim-play')) (video.paused ? play() : pause()); });

  // Arrastre de los extremos
  const move = (which, t) => {
    if (which === 'start') s = Math.min(Math.max(0, t), Math.max(0, e - KX_TRIM_MIN_SECONDS));
    else e = Math.max(Math.min(D, t), Math.min(D, s + KX_TRIM_MIN_SECONDS));
    pause();
    try { video.currentTime = which === 'start' ? s : Math.max(s, e - 0.05); } catch (_) { /* sin metadatos aún */ }
    paint();
    paintHead();
  };
  Object.entries(handles).forEach(([which, h]) => {
    h.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      try { h.setPointerCapture(ev.pointerId); } catch (_) { /* puntero ya liberado */ }
      h.classList.add('is-dragging');
      const rect = track.getBoundingClientRect();
      const onMove = (m) => move(which, ((m.clientX - rect.left) / rect.width) * D);
      const onUp = () => {
        h.classList.remove('is-dragging');
        h.removeEventListener('pointermove', onMove);
        h.removeEventListener('pointerup', onUp);
        h.removeEventListener('pointercancel', onUp);
      };
      h.addEventListener('pointermove', onMove);
      h.addEventListener('pointerup', onUp);
      h.addEventListener('pointercancel', onUp);
    });
    h.addEventListener('keydown', (ev) => {
      const step = ev.shiftKey ? 1 : 0.1;
      if (ev.key === 'ArrowLeft' || ev.key === 'ArrowDown') { ev.preventDefault(); move(which, (which === 'start' ? s : e) - step); }
      else if (ev.key === 'ArrowRight' || ev.key === 'ArrowUp') { ev.preventDefault(); move(which, (which === 'start' ? s : e) + step); }
    });
  });

  // ---- Pestañas Recortar / Portada ----
  const setMode = (next) => {
    mode = next;
    el.dataset.mode = next;
    pause();
    el.querySelectorAll('[data-tab]').forEach(t => t.setAttribute('aria-selected', String(t.dataset.tab === next)));
    if (next === 'cover' && D) { try { const ct = coverInRange(); video.currentTime = ct === null ? s : ct; } catch (_) { /* sin metadatos */ } }
    paint();
    paintHead();
  };
  el.querySelectorAll('[data-tab]').forEach(t => t.addEventListener('click', () => setMode(t.dataset.tab)));

  const moveCover = (t) => {
    coverTouched = true;
    coverTime = Math.min(Math.max(t, s), e);
    pause();
    try { video.currentTime = coverTime; } catch (_) { /* sin metadatos */ }
    paint();
  };
  track.addEventListener('pointerdown', (ev) => {
    if (mode !== 'cover' || !D) return;
    ev.preventDefault();
    try { track.setPointerCapture(ev.pointerId); } catch (_) { /* puntero ya liberado */ }
    const rect = track.getBoundingClientRect();
    const at = (x) => moveCover(((x - rect.left) / rect.width) * D);
    at(ev.clientX);
    const onMove = (m) => at(m.clientX);
    const onUp = () => {
      track.removeEventListener('pointermove', onMove);
      track.removeEventListener('pointerup', onUp);
      track.removeEventListener('pointercancel', onUp);
    };
    track.addEventListener('pointermove', onMove);
    track.addEventListener('pointerup', onUp);
    track.addEventListener('pointercancel', onUp);
  });
  q('[data-cover-thumb]').addEventListener('keydown', (ev) => {
    const step = ev.shiftKey ? 1 : 0.1;
    const cur = coverInRange() === null ? s : coverTime;
    if (ev.key === 'ArrowLeft' || ev.key === 'ArrowDown') { ev.preventDefault(); moveCover(cur - step); }
    else if (ev.key === 'ArrowRight' || ev.key === 'ArrowUp') { ev.preventDefault(); moveCover(cur + step); }
  });
  q('[data-cover-reset]').addEventListener('click', () => {
    coverTouched = true;
    coverTime = null;
    try { video.currentTime = s; } catch (_) { /* sin metadatos */ }
    paint();
  });

  // Fotograma actual a JPEG para usarlo como portada
  const captureCover = async (t) => {
    await new Promise((resolve) => {
      if (Math.abs(video.currentTime - t) < 0.02 && video.readyState >= 2) { resolve(); return; }
      video.addEventListener('seeked', resolve, { once: true });
      video.currentTime = t;
      setTimeout(resolve, 3000);
    });
    const k = Math.min(1, 1080 / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(2, Math.round(video.videoWidth * k));
    canvas.height = Math.max(2, Math.round(video.videoHeight * k));
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    if (!blob) throw new Error('No se pudo crear la portada');
    return new File([blob], 'portada.jpg', { type: 'image/jpeg' });
  };

  // Miniaturas a lo largo de la línea de tiempo (si falla, la barra queda lisa)
  const buildStrip = async () => {
    try {
      const thumbs = document.createElement('video');
      thumbs.muted = true;
      thumbs.preload = 'auto';
      if (remote) thumbs.crossOrigin = 'anonymous';
      thumbs.src = url;
      await new Promise((resolve, reject) => { thumbs.onloadeddata = resolve; thumbs.onerror = reject; setTimeout(reject, 8000); });
      const strip = q('[data-strip]');
      const ratio = thumbs.videoWidth / thumbs.videoHeight || 1;
      const th = 96;
      const canvas = document.createElement('canvas');
      canvas.height = th;
      canvas.width = Math.round(th * ratio);
      const g = canvas.getContext('2d');
      for (let i = 0; i < KX_TRIM_FRAMES; i++) {
        if (!kxTrimmerEl) return;
        await new Promise((resolve) => {
          thumbs.onseeked = resolve;
          thumbs.currentTime = Math.min(D - 0.05, (D * (i + 0.5)) / KX_TRIM_FRAMES);
          setTimeout(resolve, 1500);
        });
        g.drawImage(thumbs, 0, 0, canvas.width, th);
        const tile = document.createElement('span');
        tile.style.backgroundImage = `url(${canvas.toDataURL('image/jpeg', 0.6)})`;
        strip.appendChild(tile);
      }
      thumbs.removeAttribute('src');
      thumbs.load();
    } catch (_) { /* sin miniaturas */ }
  };

  video.addEventListener('loadedmetadata', () => {
    D = video.duration;
    if (!Number.isFinite(D) || D <= 0) return;
    // Un recorte previo se muestra sobre el original: se reabre con ese tramo
    s = item.trim ? item.trim.start : 0;
    e = item.trim ? Math.min(item.trim.end, D) : D;
    paint();
    paintHead();
    buildStrip();
  });
  video.addEventListener('error', () => { q('[data-t-len]').textContent = 'No se pudo leer el vídeo'; });
  video.addEventListener('ended', () => { video.currentTime = s; setPlaying(false); });

  const close = () => {
    cancelAnimationFrame(raf);
    abort?.abort();
    document.removeEventListener('keydown', onKey, true);
    try { video.pause(); } catch (_) { /* ya detenido */ }
    video.removeAttribute('src');
    video.load();
    if (!remote) URL.revokeObjectURL(url);
    el.remove();
    kxTrimmerEl = null;
    app?.removeAttribute('inert');
    if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
  };
  const onKey = (ev) => {
    if (ev.key === 'Escape') { ev.preventDefault(); ev.stopImmediatePropagation(); if (abort) abort.abort(); else close(); return; }
    if (ev.key === 'Tab') {
      const focusables = [...el.querySelectorAll('button:not([disabled])')].filter(b => b.offsetParent !== null);
      if (!focusables.length) return;
      const first = focusables[0], last = focusables[focusables.length - 1];
      if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
      else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
    }
  };

  q('[data-trim-cancel]').addEventListener('click', close);
  applyBtn.addEventListener('click', async () => {
    pause();
    const full = s <= 0.05 && e >= D - 0.05;
    const coverNow = coverInRange();
    const coverChanged = coverIsChanged();
    const busy = q('[data-busy]');
    const busyText = q('[data-busy-text]');
    busy.hidden = false;
    busyText.textContent = full ? 'Guardando…' : 'Recortando… 0%';
    abort = new AbortController();
    q('[data-busy-cancel]').focus({ preventScroll: true });
    // El audio solo arranca si el contexto se crea y se activa dentro del toque (iOS lo exige): se hace aquí, antes de esperar nada
    const AC = window.AudioContext || window.webkitAudioContext;
    const audioCtx = full ? null : new AC();
    audioCtx?.resume().catch(() => {});
    try {
      // La portada se toma del vídeo original antes de recortar
      const coverFile = coverChanged && coverNow !== null ? await captureCover(coverNow) : null;
      if (full) {
        // Tramo completo = volver al original
        if (item.orig) { item.file = item.orig; delete item.orig; delete item.trim; }
      } else {
        const trimmed = await kxPrepareVideoForUpload(source, (p) => { busyText.textContent = `Recortando… ${p}%`; }, { trim: { start: s, end: e }, signal: abort.signal, audioCtx });
        if (!kxTrimmerEl) return;
        item.orig = source;
        item.trim = { start: s, end: e };
        item.file = trimmed;
      }
      if (coverChanged) {
        if (coverFile) item.cover = { file: coverFile, time: coverNow };
        else delete item.cover;
      }
      if (remote) {
        await remote.onSave(coverFile);
      } else {
        updatePreview();
        updateSubmitButton();
      }
      close();
    } catch (err) {
      if (!kxTrimmerEl) return;
      abort = null;
      busy.hidden = true;
      if (err?.name !== 'AbortError') {
        console.error('Error editando el vídeo:', err);
        showToast('No se pudo guardar el vídeo. Inténtalo de nuevo', 'error');
      }
      applyBtn.focus({ preventScroll: true });
    }
  });
  q('[data-busy-cancel]').addEventListener('click', () => abort?.abort());

  document.addEventListener('keydown', onKey, true);
  app?.setAttribute('inert', '');
  document.body.appendChild(el);
  kxTrimmerEl = el;
  if (remote) setMode('cover');
  q('[data-trim-cancel]').focus({ preventScroll: true });
}

// ================== RECORTAR Y GIRAR FOTOS ==================
// Se trabaja sobre el original (`orig`): el archivo editado lo sustituye en el editor y se puede reabrir para reajustar.
const KX_CROP_MAX_SIDE = 4096; // por encima algunos móviles no pueden crear el lienzo
const KX_CROP_MIN_PX = 48;
const KX_CROP_RATIOS = [
  { key: 'free', label: 'Libre' },
  { key: 'orig', label: 'Original' },
  { key: '1:1', label: '1:1', r: 1 },
  { key: '4:5', label: '4:5', r: 4 / 5 },
  { key: '5:4', label: '5:4', r: 5 / 4 },
  { key: '16:9', label: '16:9', r: 16 / 9 },
  { key: '9:16', label: '9:16', r: 9 / 16 }
];
const CP_CROP_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 2v14a2 2 0 0 0 2 2h14"></path><path d="M18 22V8a2 2 0 0 0-2-2H2"></path></svg>';
let kxCropperEl = null;

async function kxLoadImageBitmapLike(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode(); // respeta la orientación EXIF
    return img;
  } finally {
    // El <img> ya decodificado sigue siendo dibujable tras liberar la URL
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

function openPhotoEditor(mediaId, opener) {
  const item = postData.media.find(m => m.id === mediaId);
  if (!item || item.kind !== 'photo' || kxCropperEl) return;
  const source = item.orig || item.file;

  const el = document.createElement('div');
  el.className = 'kx-trim kx-crop';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', 'Recortar y girar foto');
  const rotIcon = (flip) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${flip ? 'style="transform:scaleX(-1)"' : ''}><path d="M21 12a9 9 0 1 1-3-6.7"></path><polyline points="21 3 21 9 15 9"></polyline></svg>`;
  el.innerHTML = `
    <div class="kx-trim-head">
      <button type="button" class="kx-trim-cancel" data-crop-cancel>Cancelar</button>
      <h2>Editar foto</h2>
      <button type="button" class="kx-trim-apply" data-crop-apply disabled>Aplicar</button>
    </div>
    <div class="kx-crop-stage" data-stage>
      <div class="kx-crop-wrap" data-wrap hidden>
        <canvas data-canvas></canvas>
        <div class="kx-crop-box" data-box tabindex="0" role="group" aria-label="Zona que se conserva. Flechas para moverla">
          <i class="kx-crop-corner is-nw"></i><i class="kx-crop-corner is-ne"></i><i class="kx-crop-corner is-sw"></i><i class="kx-crop-corner is-se"></i>
        </div>
      </div>
      <p class="kx-crop-state" data-state role="status">Cargando foto…</p>
    </div>
    <div class="kx-crop-panel">
      <div class="kx-crop-tools">
        <button type="button" class="kx-crop-tool" data-rotate="-1" aria-label="Girar a la izquierda">${rotIcon(true)}</button>
        <button type="button" class="kx-crop-tool" data-rotate="1" aria-label="Girar a la derecha">${rotIcon(false)}</button>
        <button type="button" class="kx-crop-reset" data-reset>Restablecer</button>
      </div>
      <div class="kx-crop-ratios" role="group" aria-label="Proporción">
        ${KX_CROP_RATIOS.map(r => `<button type="button" class="kx-crop-chip" data-ratio="${r.key}" aria-pressed="false">${r.label}</button>`).join('')}
      </div>
    </div>
    <div class="kx-trim-busy" data-busy hidden>
      <div class="kx-trim-spinner" aria-hidden="true"></div>
      <p role="status">Guardando…</p>
    </div>`;

  const q = (sel) => el.querySelector(sel);
  const stage = q('[data-stage]');
  const wrap = q('[data-wrap]');
  const canvas = q('[data-canvas]');
  const box = q('[data-box]');
  const applyBtn = q('[data-crop-apply]');
  const app = document.getElementById('create-post-modal');

  let img = null;
  let base = null; // lienzo con la foto ya girada (máx. KX_CROP_MAX_SIDE)
  let rot = item.edit ? item.edit.rot : 0; // cuartos de vuelta a la derecha
  let c = item.edit ? { ...item.edit.c } : { x: 0, y: 0, w: 1, h: 1 }; // zona conservada, normalizada sobre la foto girada
  let ratioKey = item.edit ? item.edit.ratio : 'free';
  let dispW = 0, dispH = 0;

  const rotatedDims = () => (rot % 2 ? [img.naturalHeight, img.naturalWidth] : [img.naturalWidth, img.naturalHeight]);
  const ratioValue = () => {
    if (ratioKey === 'free') return null;
    const [W, H] = rotatedDims();
    if (ratioKey === 'orig') return W / H;
    return KX_CROP_RATIOS.find(r => r.key === ratioKey).r;
  };
  // w/h de la zona en coordenadas normalizadas para que en píxeles tenga la proporción pedida
  const normK = () => { const r = ratioValue(); const [W, H] = rotatedDims(); return r ? (r * H) / W : null; };

  const buildBase = () => {
    const [W, H] = rotatedDims();
    const k = Math.min(1, KX_CROP_MAX_SIDE / Math.max(W, H));
    base = document.createElement('canvas');
    base.width = Math.round(W * k);
    base.height = Math.round(H * k);
    const g = base.getContext('2d');
    g.save();
    g.translate(base.width / 2, base.height / 2);
    g.rotate((rot * Math.PI) / 2);
    const dw = (rot % 2 ? base.height : base.width);
    const dh = (rot % 2 ? base.width : base.height);
    g.drawImage(img, -dw / 2, -dh / 2, dw, dh);
    g.restore();
  };

  const layout = () => {
    if (!base) return;
    const r = stage.getBoundingClientRect();
    const availW = Math.max(60, r.width - 32), availH = Math.max(60, r.height - 32);
    const scale = Math.min(availW / base.width, availH / base.height);
    dispW = Math.round(base.width * scale);
    dispH = Math.round(base.height * scale);
    wrap.style.width = `${dispW}px`;
    wrap.style.height = `${dispH}px`;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(dispW * dpr);
    canvas.height = Math.round(dispH * dpr);
    canvas.style.width = `${dispW}px`;
    canvas.style.height = `${dispH}px`;
    canvas.getContext('2d').drawImage(base, 0, 0, canvas.width, canvas.height);
    paintBox();
  };

  const changed = () => rot % 4 !== 0 || c.x > 0.001 || c.y > 0.001 || c.w < 0.999 || c.h < 0.999;
  const paintBox = () => {
    box.style.cssText = `left:${c.x * dispW}px;top:${c.y * dispH}px;width:${c.w * dispW}px;height:${c.h * dispH}px`;
    applyBtn.disabled = !base || !(changed() || item.orig);
    el.querySelectorAll('[data-ratio]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.ratio === ratioKey)));
  };

  // Mayor zona con la proporción pedida, centrada en la actual
  const fitRatio = () => {
    const k = normK();
    if (!k) return;
    let w = k >= 1 ? 1 : k;
    let h = k >= 1 ? 1 / k : 1;
    const cx = c.x + c.w / 2, cy = c.y + c.h / 2;
    c = { w, h, x: Math.min(1 - w, Math.max(0, cx - w / 2)), y: Math.min(1 - h, Math.max(0, cy - h / 2)) };
  };

  // ---- Arrastre: mover la zona, estirar bordes o esquinas ----
  let drag = null;
  const minW = () => Math.min(1, KX_CROP_MIN_PX / Math.max(1, dispW));
  const minH = () => Math.min(1, KX_CROP_MIN_PX / Math.max(1, dispH));
  const hitTest = (px, py) => {
    const bx = c.x * dispW, by = c.y * dispH, bw = c.w * dispW, bh = c.h * dispH;
    const m = Math.min(30, bw / 3, bh / 3);
    const nearL = Math.abs(px - bx) <= m, nearR = Math.abs(px - (bx + bw)) <= m;
    const nearT = Math.abs(py - by) <= m, nearB = Math.abs(py - (by + bh)) <= m;
    const inX = px >= bx - m && px <= bx + bw + m, inY = py >= by - m && py <= by + bh + m;
    if (!inX || !inY) return null;
    const locked = !!normK();
    const l = nearL, r = nearR, t = nearT, b = nearB;
    if ((l || r) && (t || b)) return { l, r, t, b };
    if (locked) return { move: true };
    if (l || r || t || b) return { l, r, t, b };
    return { move: true };
  };

  stage.addEventListener('pointerdown', (ev) => {
    if (!base || ev.target.closest('button')) return;
    const wr = wrap.getBoundingClientRect();
    const px = ev.clientX - wr.left, py = ev.clientY - wr.top;
    const hit = hitTest(px, py);
    if (!hit) return;
    ev.preventDefault();
    try { stage.setPointerCapture(ev.pointerId); } catch (_) { /* puntero ya liberado */ }
    drag = { hit, startX: px, startY: py, c0: { ...c } };
  });
  stage.addEventListener('pointermove', (ev) => {
    if (!drag) return;
    const wr = wrap.getBoundingClientRect();
    const dx = (ev.clientX - wr.left - drag.startX) / dispW;
    const dy = (ev.clientY - wr.top - drag.startY) / dispH;
    const c0 = drag.c0;
    const h = drag.hit;
    const k = normK();
    if (h.move) {
      c = { ...c0, x: Math.min(1 - c0.w, Math.max(0, c0.x + dx)), y: Math.min(1 - c0.h, Math.max(0, c0.y + dy)) };
    } else if (k && (h.l || h.r) && (h.t || h.b)) {
      // Con proporción fija la esquina opuesta se queda quieta
      const ax = h.l ? c0.x + c0.w : c0.x, ay = h.t ? c0.y + c0.h : c0.y;
      const cornerX = (h.l ? c0.x : c0.x + c0.w) + dx, cornerY = (h.t ? c0.y : c0.y + c0.h) + dy;
      const roomX = h.l ? ax : 1 - ax, roomY = h.t ? ay : 1 - ay;
      let w = Math.max(Math.abs(cornerX - ax), Math.abs(cornerY - ay) * k, minW());
      w = Math.min(w, roomX, roomY * k);
      const hh = w / k;
      c = { w, h: hh, x: h.l ? ax - w : ax, y: h.t ? ay - hh : ay };
    } else {
      let x0 = c0.x, y0 = c0.y, x1 = c0.x + c0.w, y1 = c0.y + c0.h;
      if (h.l) x0 = Math.min(Math.max(0, x0 + dx), x1 - minW());
      if (h.r) x1 = Math.max(Math.min(1, x1 + dx), x0 + minW());
      if (h.t) y0 = Math.min(Math.max(0, y0 + dy), y1 - minH());
      if (h.b) y1 = Math.max(Math.min(1, y1 + dy), y0 + minH());
      c = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }
    paintBox();
  });
  const endDrag = () => { drag = null; };
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);

  box.addEventListener('keydown', (ev) => {
    const step = ev.shiftKey ? 0.1 : 0.02;
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[ev.key];
    if (!d) return;
    ev.preventDefault();
    c = { ...c, x: Math.min(1 - c.w, Math.max(0, c.x + d[0])), y: Math.min(1 - c.h, Math.max(0, c.y + d[1])) };
    paintBox();
  });

  // ---- Girar, proporción y restablecer ----
  const rotate = (dir) => {
    if (!img) return;
    // La zona gira con la foto
    const { x, y, w, h } = c;
    c = dir > 0 ? { x: 1 - y - h, y: x, w: h, h: w } : { x: y, y: 1 - x - w, w: h, h: w };
    rot = (rot + dir + 4) % 4;
    if (ratioKey !== 'free') { /* la proporción se mantiene: se reajusta a la nueva orientación */ fitRatio(); }
    buildBase();
    layout();
  };
  el.querySelectorAll('[data-rotate]').forEach(b => b.addEventListener('click', () => rotate(Number(b.dataset.rotate))));
  el.querySelectorAll('[data-ratio]').forEach(b => b.addEventListener('click', () => {
    ratioKey = b.dataset.ratio;
    fitRatio();
    paintBox();
  }));
  q('[data-reset]').addEventListener('click', () => {
    if (!img) return;
    rot = 0; c = { x: 0, y: 0, w: 1, h: 1 }; ratioKey = 'free';
    buildBase();
    layout();
  });

  // ---- Cerrar y aplicar ----
  const close = () => {
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', layout);
    el.remove();
    kxCropperEl = null;
    base = null; img = null;
    app?.removeAttribute('inert');
    if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
  };
  const onKey = (ev) => {
    if (ev.key === 'Escape') { ev.preventDefault(); ev.stopImmediatePropagation(); close(); return; }
    if (ev.key === 'Tab') {
      const focusables = [...el.querySelectorAll('button:not([disabled]), [tabindex="0"]')].filter(b => b.offsetParent !== null);
      if (!focusables.length) return;
      const first = focusables[0], last = focusables[focusables.length - 1];
      if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
      else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
    }
  };
  q('[data-crop-cancel]').addEventListener('click', close);

  applyBtn.addEventListener('click', async () => {
    if (!base) return;
    if (!changed()) {
      // Sin cambios sobre el original: se vuelve a él
      if (item.orig) { item.file = item.orig; delete item.orig; delete item.edit; updatePreview(); updateSubmitButton(); }
      close();
      return;
    }
    q('[data-busy]').hidden = false;
    try {
      const sx = Math.round(c.x * base.width), sy = Math.round(c.y * base.height);
      const sw = Math.max(1, Math.round(c.w * base.width)), sh = Math.max(1, Math.round(c.h * base.height));
      const out = document.createElement('canvas');
      out.width = sw; out.height = sh;
      out.getContext('2d').drawImage(base, sx, sy, sw, sh, 0, 0, sw, sh);
      const blob = await new Promise((resolve) => out.toBlob(resolve, 'image/jpeg', 0.92));
      if (!blob) throw new Error('No se pudo generar la imagen');
      if (!kxCropperEl) return;
      item.orig = source;
      item.edit = { rot, c: { ...c }, ratio: ratioKey };
      item.file = new File([blob], source.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
      updatePreview();
      updateSubmitButton();
      close();
    } catch (err) {
      console.error('Error editando la foto:', err);
      q('[data-busy]').hidden = true;
      showToast('No se pudo guardar la foto. Inténtalo de nuevo', 'error');
    }
  });

  document.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', layout);
  app?.setAttribute('inert', '');
  document.body.appendChild(el);
  kxCropperEl = el;
  q('[data-crop-cancel]').focus({ preventScroll: true });

  kxLoadImageBitmapLike(source).then((image) => {
    if (!kxCropperEl) return;
    img = image;
    buildBase();
    wrap.hidden = false;
    q('[data-state]').hidden = true;
    layout();
  }).catch(() => {
    const state = q('[data-state]');
    if (state) state.textContent = 'No se pudo abrir la foto';
  });
}

// ---- Sugerencia de ascensión al añadir fotos o vídeos ----
// Si la publicación lleva fotos o vídeos y ninguna ascensión, se proponen las de los últimos días
// para añadirlas con un toque (la foto suele ser de lo que acabas de escalar).
const KX_SUGGEST_DAYS = 3;
const KX_SUGGEST_MAX = 3;
let cpSuggestLoading = false;

// Carga el libro de ascensiones una vez (se comparte con el selector) y repinta las sugerencias
async function cpEnsureAscentsForSuggestions() {
  if (cpAscentsCache || cpSuggestLoading || !currentUser?.uid) return;
  cpSuggestLoading = true;
  const token = cpPickerToken;
  try {
    const all = await getUserAscentsByUserId(currentUser.uid, 500);
    if (token !== cpPickerToken || cpAscentsCache) return;
    cpAscentsCache = (all || [])
      .filter(a => a && a.routeName)
      .sort((a, b) => (kxAscentDate(b)?.getTime() || 0) - (kxAscentDate(a)?.getTime() || 0));
    if (!document.getElementById('create-post-modal')?.classList.contains('hidden')) updatePreview();
  } catch (e) {
    console.error('Error cargando ascensiones para sugerir:', e);
  } finally {
    cpSuggestLoading = false;
  }
}

function cpRecentAscentSuggestions() {
  if (!cpAscentsCache || postData.media.length === 0 || postData.ascents.length > 0 || postData.suggestDismissed) return [];
  const since = Date.now() - KX_SUGGEST_DAYS * 86400000;
  return cpAscentsCache
    .filter(a => (kxAscentDate(a)?.getTime() || 0) >= since)
    .slice(0, KX_SUGGEST_MAX);
}

function cpSuggestionsHTML() {
  if (postData.media.length > 0 && !cpAscentsCache) cpEnsureAscentsForSuggestions();
  const items = cpRecentAscentSuggestions();
  if (items.length === 0) return '';
  const plus = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>';
  const rows = items.map(a => {
    const place = [a.schoolName, a.sector].filter(Boolean).map(escapeHtmlMention).join(' · ');
    const when = kxAscentDateLabel(a);
    return `
      <button type="button" class="cp-suggest-item" data-suggest-ascent="${escapeHtmlMention(a.id)}" aria-label="Añadir la ascensión ${escapeHtmlMention(a.routeName)}">
        ${kxGradeChipHTML(a.grade)}
        <span class="kx-ascent-info">
          <span class="kx-ascent-name">${escapeHtmlMention(a.routeName)}</span>
          <span class="kx-ascent-meta">${[place, when].filter(Boolean).join(' · ')}</span>
        </span>
        <span class="cp-suggest-add" aria-hidden="true">${plus}</span>
      </button>`;
  }).join('');
  return `
    <div class="cp-suggest" role="group" aria-label="Ascensiones recientes">
      <div class="cp-suggest-head">
        <span>¿Es de una ascensión reciente?</span>
        <button type="button" class="cp-suggest-dismiss" data-suggest-dismiss aria-label="Ocultar sugerencias">${CP_REMOVE_ICON}</button>
      </div>
      ${rows}
    </div>`;
}

// Altura del texto según su contenido (mínimo tres líneas)
function autoSizeCreatePostText() {
  const textarea = document.getElementById('create-post-text');
  if (!textarea) return;
  textarea.style.height = 'auto';
  textarea.style.height = `${Math.max(textarea.scrollHeight, 84)}px`;
}

// Estado visual de Foto / Vídeo / Ubicación según lo adjuntado
function updateActionStates() {
  const set = (id, on) => {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.classList.toggle('is-active', !!on);
    btn.setAttribute('aria-pressed', String(!!on));
  };
  set('add-photo-btn', postData.photos.length > 0);
  set('add-video-btn', postData.videos.length > 0);
  set('add-location-btn', !!postData.location);
  set('add-ascent-btn', postData.ascents.length > 0);
}

// Teclado virtual en móvil: el editor ocupa el área visible para que la barra de acciones no quede oculta
let createPostViewportSync = null;
function startCreatePostViewportSync() {
  const modal = document.getElementById('create-post-modal');
  const vv = window.visualViewport;
  if (!modal || !vv) return;
  if (!createPostViewportSync) {
    createPostViewportSync = () => {
      if (modal.classList.contains('hidden')) {
        vv.removeEventListener('resize', createPostViewportSync);
        vv.removeEventListener('scroll', createPostViewportSync);
        return;
      }
      modal.style.setProperty('--cp-vh', `${vv.height}px`);
      modal.style.setProperty('--cp-top', `${vv.offsetTop}px`);
    };
  }
  vv.addEventListener('resize', createPostViewportSync);
  vv.addEventListener('scroll', createPostViewportSync);
  createPostViewportSync();
}

function updateUserInfo() {
  if (!currentUser) return;

  const avatar = document.getElementById('create-post-avatar');
  const username = document.getElementById('create-post-username');

  if (avatar) {
    setAvatarWithFallback(avatar, currentUser.photoURL, currentUser.displayName || currentUser.email || 'Usuario', 200);
  }

  if (username) {
    username.textContent = currentUser.displayName || 'Usuario';
  }
}

function updateSubmitButton() {
  const submitBtn = document.getElementById('submit-create-post');
  const hasContent = postData.text.trim().length > 0 || postData.photos.length > 0 || postData.videos.length > 0 || postData.ascents.length > 0;

  if (submitBtn && !submitBtn.classList.contains('is-loading')) {
    submitBtn.disabled = !hasContent;
  }
}

// URL de vista previa por archivo (se reutiliza y se libera al quitarlo)
const createPostPreviewUrls = new Map();
function createPostPreviewUrl(file) {
  if (!createPostPreviewUrls.has(file)) createPostPreviewUrls.set(file, URL.createObjectURL(file));
  return createPostPreviewUrls.get(file);
}
function releaseCreatePostPreviewUrls() {
  const keep = new Set(postData.media.flatMap(m => [m.file, m.cover && m.cover.file]).filter(Boolean));
  createPostPreviewUrls.forEach((url, file) => {
    if (!keep.has(file)) {
      URL.revokeObjectURL(url);
      createPostPreviewUrls.delete(file);
    }
  });
}

// ---- Reordenar fotos y vídeos: arrastrar (ratón o pulsación larga en táctil) y teclado ----
let cpGrabbedId = null;

function cpAnnounce(text) {
  const live = document.querySelector('#create-post-preview .cp-media-live');
  if (live) live.textContent = text;
}

function cpMoveMedia(from, to) {
  const list = postData.media;
  if (to < 0 || to >= list.length || from === to) return false;
  const [item] = list.splice(from, 1);
  list.splice(to, 0, item);
  return true;
}

function cpInitMediaReorder(grid) {
  let drag = null;
  const tiles = () => Array.from(grid.querySelectorAll('.cp-media-tile'));

  // El grabado por teclado sobrevive al repintado de la lista
  const grabbed = cpGrabbedId ? postData.media.findIndex(m => m.id === cpGrabbedId) : -1;
  if (grabbed >= 0 && tiles()[grabbed]) {
    const t = tiles()[grabbed];
    t.classList.add('is-grabbed');
    t.setAttribute('aria-grabbed', 'true');
    t.focus({ preventScroll: true });
  } else {
    cpGrabbedId = null;
  }

  grid.addEventListener('keydown', (e) => {
    const tile = e.target.closest('.cp-media-tile');
    if (!tile || e.target.closest('.remove-preview-btn, .cp-media-trim')) return;
    const index = tiles().indexOf(tile);
    const n = postData.media.length;
    const m = postData.media[index];
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      if (cpGrabbedId === m.id) {
        cpGrabbedId = null;
        tile.classList.remove('is-grabbed');
        tile.removeAttribute('aria-grabbed');
        cpAnnounce(`Soltada en la posición ${index + 1} de ${n}`);
      } else {
        cpGrabbedId = m.id;
        tile.classList.add('is-grabbed');
        tile.setAttribute('aria-grabbed', 'true');
        cpAnnounce(`${m.kind === 'video' ? 'Vídeo' : 'Foto'} ${index + 1} de ${n} agarrado. Usa las flechas para moverlo`);
      }
    } else if (cpGrabbedId === m.id && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
      e.preventDefault();
      const cols = n <= 2 ? n : 3;
      const step = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' ? -cols : cols;
      const to = Math.min(n - 1, Math.max(0, index + step));
      if (cpMoveMedia(index, to)) {
        updatePreview();
        cpAnnounce(`Movido a la posición ${to + 1} de ${n}`);
      }
    } else if (e.key === 'Escape' && cpGrabbedId === m.id) {
      e.preventDefault();
      e.stopPropagation(); // suelta el elemento sin cerrar el editor
      cpGrabbedId = null;
      tile.classList.remove('is-grabbed');
      tile.removeAttribute('aria-grabbed');
      cpAnnounce('Reordenación cancelada');
    }
  });

  // En táctil, una vez agarrado el elemento hay que impedir que la lista haga scroll
  grid.addEventListener('touchmove', (e) => { if (drag && drag.active) e.preventDefault(); }, { passive: false });
  grid.addEventListener('contextmenu', (e) => { if (e.target.closest('.cp-media-tile')) e.preventDefault(); });

  grid.addEventListener('pointerdown', (e) => {
    const tile = e.target.closest('.cp-media-tile');
    if (!tile || e.target.closest('.remove-preview-btn, .cp-media-trim')) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (postData.media.length < 2) return;
    drag = { tile, x: e.clientX, y: e.clientY, active: false, touch: e.pointerType !== 'mouse', timer: null, ghost: null, dx: 0, dy: 0 };
    if (drag.touch) drag.timer = setTimeout(() => startDrag(e.clientX, e.clientY), 260);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
  });

  function startDrag(x, y) {
    if (!drag || drag.active) return;
    drag.active = true;
    const rect = drag.tile.getBoundingClientRect();
    drag.dx = x - rect.left;
    drag.dy = y - rect.top;
    const ghost = drag.tile.cloneNode(true);
    ghost.removeAttribute('tabindex');
    ghost.removeAttribute('role');
    ghost.querySelectorAll('button').forEach(b => b.remove());
    ghost.classList.add('cp-media-ghost');
    ghost.style.width = `${rect.width}px`;
    ghost.style.height = `${rect.height}px`;
    document.body.appendChild(ghost);
    drag.ghost = ghost;
    drag.tile.classList.add('is-dragging');
    grid.classList.add('is-reordering');
    if (navigator.vibrate) { try { navigator.vibrate(12); } catch (_) { /* sin vibración */ } }
    placeGhost(x, y);
  }

  function placeGhost(x, y) {
    drag.ghost.style.transform = `translate(${x - drag.dx}px, ${y - drag.dy}px) scale(1.04)`;
  }

  function scrollContainer() {
    let el = grid.parentElement;
    while (el && el !== document.body) {
      const oy = getComputedStyle(el).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight) return el;
      el = el.parentElement;
    }
    return null;
  }

  function onMove(e) {
    if (!drag) return;
    if (!drag.active) {
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) <= 8) return;
      if (drag.touch) { endDrag(false); return; } // el dedo se movió antes de la pulsación larga: es un scroll
      startDrag(e.clientX, e.clientY);
    }
    e.preventDefault();
    placeGhost(e.clientX, e.clientY);
    // Reordena en el DOM según la casilla sobre la que está el puntero
    const over = tiles().find(t => t !== drag.tile && (() => {
      const r = t.getBoundingClientRect();
      return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    })());
    if (over) {
      const list = tiles();
      if (list.indexOf(over) > list.indexOf(drag.tile)) over.after(drag.tile); else over.before(drag.tile);
    }
    // Scroll automático cerca de los bordes de la zona visible
    const sc = scrollContainer();
    if (sc) {
      const r = sc.getBoundingClientRect();
      if (e.clientY < r.top + 56) sc.scrollTop -= 14;
      else if (e.clientY > r.bottom - 56) sc.scrollTop += 14;
    }
  }

  function onEnd() { endDrag(true); }

  function endDrag(commit) {
    if (!drag) return;
    clearTimeout(drag.timer);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onEnd);
    window.removeEventListener('pointercancel', onEnd);
    const d = drag;
    drag = null;
    if (!d.active) return;
    d.ghost?.remove();
    d.tile.classList.remove('is-dragging');
    grid.classList.remove('is-reordering');
    if (commit) {
      const order = tiles().map(t => parseInt(t.dataset.index));
      const changed = order.some((v, i) => v !== i);
      if (changed) {
        postData.media = order.map(i => postData.media[i]);
        cpAnnounce(`Movido a la posición ${order.indexOf(parseInt(d.tile.dataset.index)) + 1} de ${order.length}`);
      }
    }
    updatePreview();
  }
}

const CP_TRIM_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="6" cy="6" r="3"></circle><circle cx="6" cy="18" r="3"></circle><line x1="20" y1="4" x2="8.12" y2="15.88"></line><line x1="14.47" y1="14.48" x2="20" y2="20"></line><line x1="8.12" y1="8.12" x2="12" y2="12"></line></svg>';
const CP_REMOVE_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';

function updatePreview() {
  const preview = document.getElementById('create-post-preview');
  if (!preview) return;

  releaseCreatePostPreviewUrls();
  let previewHTML = '';

  // Fotos y vídeos en una sola cuadrícula, reordenable arrastrando
  if (postData.media.length > 0) {
    const n = postData.media.length;
    const cols = n <= 2 ? 'is-few' : 'is-many';
    previewHTML += `<p class="cp-media-hint" ${n < 2 ? 'hidden' : ''}>Mantén pulsado y arrastra para cambiar el orden</p>`;
    previewHTML += `<div class="cp-media-grid ${cols}" role="list" aria-label="Fotos y vídeos de la publicación">`;
    postData.media.forEach((m, index) => {
      const url = m.remote ? m.url : createPostPreviewUrl(m.file);
      const coverSrc = m.cover && m.cover.file ? createPostPreviewUrl(m.cover.file) : (m.remote && m.poster ? m.poster : '');
      const name = m.kind === 'video' ? 'Vídeo' : 'Foto';
      previewHTML += `
        <div class="cp-media-tile${m.kind === 'video' ? ' is-video' : ''}" role="listitem" tabindex="0" data-index="${index}"
          aria-roledescription="elemento ordenable" aria-label="${name} ${index + 1} de ${n}">
          ${m.kind === 'video'
            ? `<video src="${url}#t=0.001" preload="metadata" playsinline muted></video>
               ${coverSrc ? `<img class="cp-media-cover" src="${coverSrc}" alt="" draggable="false">` : ''}
               <span class="cp-media-play" aria-hidden="true"><svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><polygon points="7 4 20 12 7 20 7 4"></polygon></svg></span>
               <span class="cp-media-duration" hidden></span>`
            : `<img src="${url}" alt="" draggable="false">`}
          <button type="button" class="remove-preview-btn" data-type="media" data-index="${index}" aria-label="Quitar ${name.toLowerCase()} ${index + 1}">${CP_REMOVE_ICON}</button>
          ${m.remote && m.kind === 'video' ? `<button type="button" class="cp-media-trim${m.cover || m.poster ? ' is-trimmed' : ''}" data-cover-id="${m.id}" aria-label="Elegir la portada del vídeo ${index + 1}">${CP_TRIM_ICON}<span>Portada</span></button>` : ''}
          ${m.kind === 'photo' && !m.remote ? `<button type="button" class="cp-media-trim${m.orig ? ' is-trimmed' : ''}" data-edit-id="${m.id}" aria-label="Editar foto ${index + 1}${m.orig ? ' (ya editada)' : ''}">${CP_CROP_ICON}<span>${m.orig ? 'Editada' : 'Editar'}</span></button>` : ''}
          ${m.kind === 'video' && !m.remote && kxCanTrimVideo() ? `<button type="button" class="cp-media-trim${m.orig || m.cover ? ' is-trimmed' : ''}" data-trim-id="${m.id}" aria-label="Editar vídeo ${index + 1}: recortar y elegir portada${m.orig || m.cover ? ' (ya editado)' : ''}">${CP_TRIM_ICON}<span>${m.orig || m.cover ? 'Editado' : 'Editar'}</span></button>` : ''}
        </div>`;
    });
    const plus = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>';
    previewHTML += `<button type="button" class="create-post-add-more" data-add="photos" aria-label="Añadir más fotos">${plus}<span>Fotos</span></button>`;
    if (postData.videos.length < KX_MAX_POST_VIDEOS) {
      previewHTML += `<button type="button" class="create-post-add-more" data-add="videos" aria-label="Añadir más vídeos">${plus}<span>Vídeos</span></button>`;
    }
    previewHTML += `</div><span class="cp-media-live kx-visually-hidden" role="status" aria-live="polite"></span>`;
  }

  // Ubicación: etiqueta compacta
  if (postData.location) {
    const locationName = escapeHtmlMention(postData.location.name || 'Ubicación añadida');
    previewHTML += `
      <div class="create-post-preview-location">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M12 2a8 8 0 0 0-8 8c0 6 8 12 8 12s8-6 8-12a8 8 0 0 0-8-8zm0 11a3 3 0 1 1 0-6 3 3 0 0 1 0 6z"></path>
        </svg>
        <span title="${locationName}">${locationName}</span>
        <button type="button" class="remove-preview-btn" data-type="location" aria-label="Quitar ubicación">${CP_REMOVE_ICON}</button>
      </div>
    `;
  }

  // Ascensión elegida del libro
  previewHTML += kxAscentListHTML(postData.ascents, { removable: true });
  previewHTML += cpSuggestionsHTML();

  updateActionStates();

  if (previewHTML) {
    preview.innerHTML = previewHTML;
    preview.classList.remove('hidden');

    preview.querySelectorAll('[data-change-ascent]').forEach(ascentCard => {
      ascentCard.addEventListener('click', (e) => { if (!e.target.closest('.remove-preview-btn')) openAscentPicker(); });
      ascentCard.addEventListener('keydown', (e) => {
        if ((e.key === 'Enter' || e.key === ' ') && !e.target.closest('.remove-preview-btn')) { e.preventDefault(); openAscentPicker(); }
      });
    });

    preview.querySelectorAll('[data-suggest-ascent]').forEach(btn => {
      btn.addEventListener('click', () => {
        const a = (cpAscentsCache || []).find(x => x.id === btn.dataset.suggestAscent);
        if (!a) return;
        postData.ascents = [ascentToPostData(a)];
        updatePreview();
        updateSubmitButton();
      });
    });
    preview.querySelector('[data-suggest-dismiss]')?.addEventListener('click', () => {
      postData.suggestDismissed = true;
      updatePreview();
    });

    preview.querySelectorAll('[data-edit-id]').forEach(btn => {
      btn.addEventListener('click', () => openPhotoEditor(Number(btn.dataset.editId), btn));
    });
    // Vídeo ya publicado: solo se puede cambiar la portada
    preview.querySelectorAll('[data-cover-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        const m = postData.media.find(x => x.id === Number(btn.dataset.coverId));
        if (!m) return;
        openVideoTrimmer(null, btn, {
          remote: {
            url: m.url,
            poster: m.cover || m.poster ? 'current' : '',
            onSave: (file) => {
              if (file) m.cover = { file, time: -1 };
              else { delete m.cover; m.poster = null; }
              updatePreview();
            }
          }
        });
      });
    });
    preview.querySelectorAll('[data-trim-id]').forEach(btn => {
      btn.addEventListener('click', () => openVideoTrimmer(Number(btn.dataset.trimId), btn));
    });

    preview.querySelector('[data-add="photos"]')?.addEventListener('click', () => {
      document.getElementById('create-post-photo-input')?.click();
    });

    preview.querySelector('[data-add="videos"]')?.addEventListener('click', () => {
      document.getElementById('create-post-video-input')?.click();
    });

    preview.querySelectorAll('.cp-media-tile video').forEach(video => {
      video.addEventListener('loadedmetadata', () => {
        if (!Number.isFinite(video.duration) || video.duration <= 0) return;
        const total = Math.round(video.duration);
        const label = video.parentElement.querySelector('.cp-media-duration');
        label.textContent = `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
        label.hidden = false;
      });
    });
    const grid = preview.querySelector('.cp-media-grid');
    if (grid) cpInitMediaReorder(grid);

    // Add remove buttons listeners
    preview.querySelectorAll('.remove-preview-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const index = btn.dataset.index;
        const type = btn.dataset.type;

        if (type === 'media') {
          postData.media.splice(parseInt(index), 1);
          document.getElementById('create-post-video-input').value = '';
          document.getElementById('create-post-photo-input').value = '';
        } else if (type === 'ascent') {
          postData.ascents.splice(parseInt(index), 1);
        } else if (type === 'location') {
          postData.location = null;
          const locationBadge = document.getElementById('location-badge');
          if (locationBadge) locationBadge.classList.add('hidden');
        }

        updatePreview();
        updateSubmitButton();
      });
    });
  } else {
    preview.innerHTML = '';
    preview.classList.add('hidden');
  }
}

async function submitPost() {
  if (!currentUser) {
    showToast('Debes iniciar sesión para publicar', 'error');
    return;
  }

  // Verify user is authenticated
  if (!currentUser.uid) {
    showToast('Error de autenticación. Por favor, inicia sesión nuevamente', 'error');
    return;
  }

  // Validate that there's at least some content
  if (!postData.text.trim() && postData.media.length === 0 && postData.ascents.length === 0) {
    showToast('Añade texto, una foto, un vídeo o una ascensión para publicar', 'error');
    return;
  }

  const submitBtn = document.getElementById('submit-create-post');
  submitBtn.disabled = true;
  submitBtn.classList.add('is-loading');
  submitBtn.textContent = postData.editing ? 'Guardando…' : 'Publicando…';

  try {
    // Se sube todo en el orden elegido por el usuario
    const photoUrls = [];
    const videoUrls = [];
    const mediaList = [];
    const total = postData.media.length;
    for (let i = 0; i < total; i++) {
      const item = postData.media[i];
      const storageRef0 = (name) => storage.ref(`posts/${currentUser.uid}/${Date.now()}_${i}_${name}`);
      if (item.remote) {
        // Ya publicado: se conserva su dirección; en vídeos solo puede cambiar la portada
        const entry = { type: item.kind, url: item.url };
        if (item.kind === 'photo') {
          photoUrls.push(item.url);
        } else {
          videoUrls.push(item.url);
          if (item.cover && item.cover.file) {
            submitBtn.textContent = 'Subiendo portada…';
            const posterRef = storageRef0(`portada_${item.cover.file.name}`);
            await kxStoragePut(posterRef, item.cover.file);
            entry.poster = await posterRef.getDownloadURL();
          } else if (item.poster) {
            entry.poster = item.poster;
          }
        }
        mediaList.push(entry);
      } else if (item.kind === 'photo') {
        submitBtn.textContent = total > 1 ? `Subiendo ${i + 1}/${total}…` : 'Subiendo foto…';
        const photo = await kxPrepareImageForUpload(item.file);
        const storageRef = storageRef0(photo.name);
        await kxStoragePut(storageRef, photo);
        const url = await storageRef.getDownloadURL();
        photoUrls.push(url);
        mediaList.push({ type: 'photo', url });
      } else {
        const label = total > 1 ? ` ${i + 1}/${total}` : '';
        // Reduce el peso antes de subir; si no se puede, se sube el original
        const video = await kxPrepareVideoForUpload(item.file, (pct) => {
          submitBtn.textContent = `Optimizando vídeo${label}… ${pct}%`;
        });
        submitBtn.textContent = `Subiendo vídeo${label}…`;
        const storageRef = storageRef0(video.name);
        await storageRef.put(video, { contentType: video.type || undefined, cacheControl: KX_IMAGE_CACHE_CONTROL });
        const url = await storageRef.getDownloadURL();
        videoUrls.push(url);
        const entry = { type: 'video', url };
        // Portada elegida o, si no, el primer fotograma: imagen aparte que se usa como miniatura del vídeo
        const coverFile = item.cover ? item.cover.file : await kxVideoPosterFromFile(video);
        if (coverFile) {
          const posterRef = storageRef0(`portada_${coverFile.name}`);
          await kxStoragePut(posterRef, coverFile);
          entry.poster = await posterRef.getDownloadURL();
        }
        mediaList.push(entry);
      }
    }
    submitBtn.textContent = postData.editing ? 'Guardando…' : 'Publicando…';

    // Determine post type
    let postType = 'text';
    if (photoUrls.length > 0) {
      postType = 'photo';
    } else if (videoUrls.length > 0) {
      postType = 'video';
    }

    // Save post to Firebase
    const postDataToSave = {
      type: postType,
      userId: currentUser.uid,
      userName: currentUser.displayName || 'Usuario',
      userPhoto: currentUser.photoURL || '',
      likes: 0,
      liked: false,
      commentsCount: 0,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    // Only add optional fields if they have values
    if (postData.text.trim()) {
      postDataToSave.content = postData.text.trim();
      // Validate and store mentions
      if (postMentionAutocomplete) {
        const validMentions = extractMentionsFromText(postData.text.trim(), postMentionAutocomplete.getMentions());
        if (validMentions.length > 0) {
          postDataToSave.mentions = validMentions;
          // Store array of mentioned user IDs for efficient querying
          postDataToSave.mentionedUserIds = validMentions.map(m => m.uid);
        }
      }
    }
    if (photoUrls.length > 0) {
      postDataToSave.photos = photoUrls;
    }
    if (mediaList.length > 0) {
      postDataToSave.media = mediaList; // orden de fotos y vídeos
    }
    if (videoUrls.length > 0) {
      postDataToSave.videos = videoUrls;
      postDataToSave.video = videoUrls[0]; // lo leen versiones anteriores de la app
    }
    if (postData.location) {
      postDataToSave.location = postData.location;
    }
    if (postData.ascents.length > 0) {
      postDataToSave.ascents = postData.ascents;
    }

    if (postData.editing) {
      await kxSavePostEdition(postData.editing, postDataToSave, mediaList);
      return;
    }

    log('Saving post data:', postDataToSave);
    log('Current user UID:', currentUser.uid);

    const docRef = await db.collection('posts').add(postDataToSave);

    // Send mention notifications
    if (postDataToSave.mentions && postDataToSave.mentions.length > 0) {
      sendMentionNotifications(postDataToSave.mentions, { type: 'post', postId: docRef.id });
    }

    showToast('Publicación creada', 'success');
    closeCreatePostModal();

    // Reload feed and profile grid after a short delay to ensure data is indexed
    setTimeout(async () => {
      await loadFeed();
      // Update profile grid if we're on profile view
      if (document.getElementById('profile-view') && !document.getElementById('profile-view').classList.contains('hidden')) {
        await renderProfileGrid();
        // Update posts count
        const postsStat = document.getElementById('stat-posts');
        if (postsStat) {
          const count = await getUserPostsCount(currentUser.uid);
          postsStat.textContent = count;
        }
      }
    }, 500);

  } catch (error) {
    console.error('Error creating post:', error);
    console.error('Error code:', error.code);
    console.error('Error message:', error.message);
    console.error('Current user:', currentUser);

    let errorMessage = 'Error al crear la publicación';

    if (error.code === 'permission-denied' || error.code === 'PERMISSION_DENIED') {
      errorMessage = 'No tienes permisos para publicar. Verifica las reglas de Firestore.';
    } else if (error.code === 'storage/unauthorized') {
      errorMessage = 'No tienes permisos para subir archivos';
    } else if (error.code === 'storage/quota-exceeded') {
      errorMessage = 'Se ha excedido la cuota de almacenamiento';
    } else if (error.code === 'unauthenticated') {
      errorMessage = 'Debes iniciar sesión para publicar';
    } else if (error.message) {
      errorMessage = error.message;
    }

    showToast(errorMessage, 'error');
  } finally {
    submitBtn.classList.remove('is-loading');
    submitBtn.textContent = postData.editing ? 'Guardar' : 'Publicar';
    // Se recalcula con la lógica existente (tras publicar, el editor ya está vacío)
    updateSubmitButton();
  }
}

// ================== EDITAR UNA PUBLICACIÓN EN EL EDITOR ==================
// Se abre el mismo editor que al crear, con todo cargado: texto, menciones, fotos y vídeos (en su orden),
// ascensiones y ubicación. Se puede quitar, añadir y reordenar todo; en los vídeos ya publicados
// se puede cambiar la portada. Al guardar se actualiza la publicación y se borran los archivos que ya no usa.
async function openEditPostInComposer(postId, { fromModal = false } = {}) {
  if (!currentUser) {
    showToast('Inicia sesión para editar publicaciones', 'info');
    return;
  }
  let post;
  try {
    const snap = await db.collection('posts').doc(postId).get();
    if (!snap.exists) { showToast('Esta publicación ya no existe', 'error'); return; }
    post = { id: snap.id, ...snap.data() };
  } catch (e) {
    console.error('Error cargando la publicación para editar:', e);
    showToast('No se pudo abrir la publicación. Inténtalo de nuevo', 'error');
    return;
  }
  if (post.userId !== currentUser.uid) {
    showToast('Solo puedes editar tus publicaciones', 'error');
    return;
  }

  const modal = document.getElementById('create-post-modal');
  const textarea = document.getElementById('create-post-text');
  if (!modal || !textarea) return;
  if (fromModal) document.getElementById('view-post-modal')?.classList.add('hidden');

  resetPostData();
  updateUserInfo();
  postData.editing = { postId, post, fromModal };
  postData.suggestDismissed = true; // al editar no se proponen ascensiones
  postData.media = kxPostMedia(post).map(m => ({ id: ++cpMediaSeq, kind: m.type, url: m.url, poster: m.poster || null, remote: true }));
  postData.ascents = kxPostAscents(post).map(a => ({ ...a }));
  postData.location = post.location && typeof post.location === 'object' ? { ...post.location } : null;

  const text = post.content || '';
  textarea.value = text;
  postData.text = text;
  if (postMentionAutocomplete) {
    postMentionAutocomplete.mentions = (post.mentions || []).map(m => ({ ...m }));
  }
  textarea.dispatchEvent(new Event('input', { bubbles: true })); // contador, altura y menciones en azul
  postMentionAutocomplete?._hide?.();

  document.getElementById('create-post-title').textContent = 'Editar publicación';
  document.getElementById('submit-create-post').textContent = 'Guardar';
  modal.classList.remove('hidden');
  startCreatePostViewportSync();
  updatePreview();
  updateSubmitButton();
}

async function kxSavePostEdition(editing, data, mediaList) {
  const { postId, post, fromModal } = editing;
  const del = firebase.firestore.FieldValue.delete();
  const update = {
    type: data.type,
    content: data.content || del,
    mentions: data.mentions || del,
    mentionedUserIds: data.mentionedUserIds || del,
    photos: data.photos || del,
    media: data.media || del,
    videos: data.videos || del,
    video: data.video || del,
    location: data.location || del,
    ascents: data.ascents || del,
    ascent: del, // formato antiguo de una sola ascensión: ahora va en `ascents`
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  };
  await db.collection('posts').doc(postId).update(update);

  // Avisos solo a quien se menciona por primera vez
  const before = new Set(post.mentionedUserIds || []);
  const fresh = (data.mentions || []).filter(m => !before.has(m.uid));
  if (fresh.length) sendMentionNotifications(fresh, { type: 'post', postId });

  // Archivos que la publicación ya no usa (fotos, vídeos y portadas quitados o sustituidos)
  const keep = new Set(mediaList.flatMap(m => [m.url, m.poster]).filter(Boolean));
  const old = kxPostMedia(post).flatMap(m => [m.url, m.poster]).filter(Boolean);
  for (const url of old) {
    if (keep.has(url) || !url.includes('/o/posts%2F')) continue;
    try {
      const path = decodeURIComponent(url.split('/o/')[1].split('?')[0]);
      await storage.ref(path).delete();
    } catch (e) {
      console.warn('No se pudo borrar un archivo que la publicación ya no usa:', e);
    }
  }

  showToast('Publicación actualizada', 'success');
  closeCreatePostModal();
  setTimeout(async () => {
    if (fromModal) await openPostModal(postId);
    await loadFeed();
    if (document.getElementById('profile-view') && !document.getElementById('profile-view').classList.contains('hidden')) {
      await renderProfileGrid();
    }
  }, 300);
}

function closeCreatePostModal() {
  const modal = document.getElementById('create-post-modal');
  modal?.classList.add('hidden');
  resetPostData();
  releaseCreatePostPreviewUrls();
}

// Show empty feed state
function showEmptyFeedState(container) {
  container.innerHTML = `
    <div class="feed-state feed-state-empty">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
        <circle cx="8.5" cy="7" r="4"></circle>
        <line x1="20" y1="8" x2="20" y2="14"></line>
        <line x1="23" y1="11" x2="17" y2="11"></line>
      </svg>
      <h3>Tu timeline está vacío</h3>
      <p>Sigue a otros usuarios para ver sus publicaciones aquí</p>
    </div>
  `;
}

// Load feed from Firebase - Timeline de seguidos
async function loadFeed(opts) {
  const container = document.getElementById('feed-container');
  if (!container) return;
  // silent: recarga por gesto; la lista sigue visible hasta que llegan las publicaciones nuevas
  const silent = !!(opts && opts.silent);

  try {
    if (!silent) container.innerHTML = '<div class="loading-spinner">Cargando publicaciones...</div>';

    // Get the list of users the current user follows
    let followingIds = [];
    if (currentUser) {
      try {
        const followingSnapshot = await db.collection('users')
          .doc(currentUser.uid)
          .collection('following')
          .get();

        followingIds = followingSnapshot.docs.map(doc => doc.id);
      } catch (error) {
        console.error('Error loading following list:', error);
      }
      // Include the current user's own posts in the timeline
      followingIds.push(currentUser.uid);
    }

    if (!silent) container.innerHTML = '';

    // Vista previa local sin sesión: publicaciones de demostración (ver isLocalDevPreview en auth.js)
    if (!currentUser && typeof isLocalDevPreview === 'function' && isLocalDevPreview()) {
      renderLocalPreviewFeed(container);
      return;
    }

    // Sesión aún sin restaurar pero con usuario recordado: auth volverá a llamar a loadFeed, no mostramos «vacío»
    if (!currentUser && kxReadLastUser() && !silent) {
      container.innerHTML = '<div class="loading-spinner">Cargando publicaciones...</div>';
      return;
    }

    // If no user or no following, show empty state (sin posts demo)
    if (!currentUser || followingIds.length === 0) {
      showEmptyFeedState(container);
      return;
    }

    // Fetch posts using batched 'where in' queries (Firestore limit: 30 per query)
    const firebasePosts = [];
    const batchSize = 30;
    const postsPerBatch = Math.ceil(50 / Math.ceil(followingIds.length / batchSize)); // Distribute limit across batches

    for (let i = 0; i < followingIds.length; i += batchSize) {
      const batch = followingIds.slice(i, i + batchSize);

      try {
        const snapshot = await db.collection('posts')
          .where('userId', 'in', batch)
          .orderBy('createdAt', 'desc')
          .limit(postsPerBatch)
          .get();

        snapshot.forEach(doc => {
          const data = doc.data();
          firebasePosts.push({
            id: doc.id,
            ...data,
            time: data.createdAt ? formatTimeAgo(data.createdAt.toDate()) : 'Ahora',
            photos: data.photos || (data.photo ? [data.photo] : [])
          });
        });
      } catch (error) {
        console.error('Error fetching posts batch:', error);
      }
    }

    // Sort all posts by createdAt and limit to 50
    firebasePosts.sort((a, b) => {
      const timeA = a.createdAt?.toDate?.() || a.createdAt || 0;
      const timeB = b.createdAt?.toDate?.() || b.createdAt || 0;
      return timeB - timeA;
    });
    const limitedPosts = firebasePosts.slice(0, 50);

    // Load user's likes and bookmarks if logged in
    if (currentUser && limitedPosts.length > 0) {
      const userId = currentUser.uid;

      try {
        // Get user's savedPosts array (single read instead of multiple)
        const userDoc = await db.collection('users').doc(userId).get();
        const userData = userDoc.exists ? userDoc.data() : {};
        const savedPosts = new Set(userData.savedPosts || []);

        // Check likes from each post's likes array
        limitedPosts.forEach(post => {
          // Check if user liked this post (likes is an array of UIDs)
          const likesArray = post.likes || [];
          post.liked = Array.isArray(likesArray) && likesArray.includes(userId);

          // Update likes count to be the array length
          post.likesCount = Array.isArray(likesArray) ? likesArray.length : (typeof likesArray === 'number' ? likesArray : 0);

          // Check if user saved this post
          post.bookmarked = savedPosts.has(post.id);
        });
      } catch (error) {
        console.error('Error loading user interactions:', error);
        // Continue without user interaction data
      }
    }

    // Use filtered posts (solo datos reales)
    const allPosts = [...limitedPosts];

    if (allPosts.length === 0) {
      showEmptyFeedState(container);
      return;
    }

    if (silent) container.innerHTML = '';
    allPosts.forEach(post => {
      renderPostCard(post, container);
    });

    // Add event listeners
    attachFeedEventListeners(container);

  } catch (error) {
    console.error('Error loading feed:', error);
    if (silent) throw error;

    container.innerHTML = `
        <div class="feed-state feed-state-error">
          <p>Error al cargar el feed: ${error.message}</p>
          <button type="button" class="feed-state-btn" onclick="loadFeed()">Reintentar</button>
        </div>
      `;
  }
}

// Render a single post card - Editorial Hybrid Style (Substack/Twitter/Strava)
// Iconos del feed: mismo trazo (1.75) y mismos terminales en toda la interfaz del feed
const FEED_ICON_PIN = '<svg class="feed-pin-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>';

// Botón de guardar: la lógica vive en handleFeedBookmark (delegación de clics por data-action)
function buildFeedBookmarkButton(postId, bookmarked) {
  return `
      <button class="feed-action-btn feed-action-bookmark ${bookmarked ? 'bookmarked' : ''}" data-action="bookmark" data-post-id="${postId || ''}" aria-label="Guardar publicación" title="Guardar">
        <svg viewBox="0 0 24 24" fill="${bookmarked ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
          <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path>
        </svg>
      </button>`;
}

function renderPostCard(post, container) {
  const card = document.createElement('div');
  card.className = `feed-card feed-card-${post.type || 'text'}`;
  card.dataset.postId = post.id || '';

  const userName = post.userName || post.user || 'Usuario';
  const userPhoto = post.userPhoto || post.avatar || '';

  // Extract location name (can be object with name property or string)
  let locationName = '';
  let locationCoords = null;
  if (post.location) {
    if (typeof post.location === 'object' && post.location.name) {
      locationName = post.location.name;
      locationCoords = {
        lat: post.location.lat || 0,
        lng: post.location.lng || 0
      };
    } else if (typeof post.location === 'string') {
      locationName = post.location;
    }
  } else if (post.locationName) {
    locationName = post.locationName;
  }

  // Support both array (new) and number (legacy) format for likes
  const likesArray = post.likes;
  const likes = post.likesCount || (Array.isArray(likesArray) ? likesArray.length : (typeof likesArray === 'number' ? likesArray : 0));
  const comments = post.commentsCount || 0;
  const shares = post.shares || 0;

  // Helper to format counts
  const formatCount = (num) => {
    if (num >= 1000000) return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
    return num > 0 ? num.toString() : '';
  };

  // Verificar si el usuario actual es el autor del post
  const isPostAuthor = currentUser && post.userId === currentUser.uid;

  // Header - Editorial style with inline meta
  const headerHTML = `
    <div class="feed-card-header">
      <img src="${userPhoto || generateAvatarFallback(userName, 200)}" alt="${userName}" class="feed-avatar feed-avatar-clickable" data-user-id="${post.userId || ''}" referrerPolicy="no-referrer" onerror="this.src='${generateAvatarFallback(userName, 200)}'; this.onerror=null;">
      <div class="feed-header-content">
        <div class="feed-header-row">
          <span class="feed-username feed-username-clickable" data-user-id="${post.userId || ''}">${userName}</span>
        </div>
        ${locationName ? `<div class="feed-location-text">${FEED_ICON_PIN}<span>${locationName}</span></div>` : ''}
        <div class="feed-time-row"><span class="feed-time">${post.time || 'Ahora'}</span></div>
      </div>
      ${currentUser ? `
        <div class="feed-post-menu-wrapper">
          <button class="feed-post-menu-btn" 
                  data-post-id="${post.id || ''}"
                  data-is-owner="${isPostAuthor}"
                  aria-label="Opciones de la publicación"
                  title="Opciones">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="1"></circle>
              <circle cx="19" cy="12" r="1"></circle>
              <circle cx="5" cy="12" r="1"></circle>
            </svg>
          </button>
          <div class="feed-post-menu-dropdown hidden" data-post-id="${post.id || ''}">
            ${isPostAuthor ? `
              <button class="feed-post-menu-item" data-action="edit" data-post-id="${post.id || ''}">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                </svg>
                <span>Editar</span>
              </button>
              <button class="feed-post-menu-item feed-post-menu-item-danger" data-action="delete" data-post-id="${post.id || ''}">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
                <span>Borrar</span>
              </button>
            ` : `
              <button class="feed-post-menu-item" data-action="share" data-post-id="${post.id || ''}">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="18" cy="5" r="3"></circle>
                  <circle cx="6" cy="12" r="3"></circle>
                  <circle cx="18" cy="19" r="3"></circle>
                  <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line>
                  <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line>
                </svg>
                <span>Compartir</span>
              </button>
              <button class="feed-post-menu-item feed-post-menu-item-danger" data-action="report" data-post-id="${post.id || ''}">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                  <line x1="12" y1="9" x2="12" y2="13"></line>
                  <line x1="12" y1="17" x2="12.01" y2="17"></line>
                </svg>
                <span>Denunciar</span>
              </button>
            `}
          </div>
        </div>
      ` : ''}
    </div>
  `;

  // Contenido: la foto va antes que el texto (cabecera -> foto -> descripción -> acciones)
  let contentHTML = '';
  let mediaHTML = '';
  const textContent = post.content || post.caption || '';

  // Texto (descripción)
  if (textContent || post.title) {
    contentHTML += `
      <div class="feed-text-content" data-post-id="${post.id || ''}">
        ${post.title ? `<h2 class="feed-text-title">${post.title}</h2>` : ''}
        ${textContent ? `
          <div class="feed-text-body-wrapper">
            <p class="feed-text-body" data-post-id="${post.id || ''}">${renderTextWithMentions(textContent, post.mentions)}</p>
            <div class="feed-text-edit-wrapper hidden" data-post-id="${post.id || ''}">
              <textarea class="feed-text-edit-input" data-post-id="${post.id || ''}" rows="4">${textContent}</textarea>
              <div class="feed-text-edit-actions">
                <button class="feed-text-edit-cancel" data-post-id="${post.id || ''}">Cancelar</button>
                <button class="feed-text-edit-save" data-post-id="${post.id || ''}">
                  <span class="feed-text-edit-save-text">Guardar</span>
                  <span class="feed-text-edit-save-loading hidden">Guardando...</span>
                </button>
              </div>
            </div>
          </div>
        ` : ''}
      </div>
    `;
  }

  // Contenido multimedia (va antes que el texto)
  const postMedia = kxPostMedia(post);
  if (post.type === 'photo' || post.type === 'video' || postMedia.length > 0) {
    // Etiqueta de cristal sobre la foto (decorativa: la ubicación ya está en la cabecera)
    const photoTag = locationName ? `<span class="feed-photo-tag" aria-hidden="true">${FEED_ICON_PIN}<span>${locationName}</span></span>` : '';
    mediaHTML += kxMediaHTML(postMedia, { tag: photoTag });
    card._lightboxItems = postMedia; // el visor recibe todas las fotos y vídeos, no solo los de la cuadrícula
  } else if (post.type === 'ascensions' && post.ascensions) {
    const ascensionsList = post.ascensions.map(a => `
      <div class="feed-ascension-item">
        <span class="ascension-grade-badge">${a.grade}</span>
        <span class="ascension-route-name">${a.name}</span>
        <span class="ascension-style ${(a.style || 'redpoint').toLowerCase()}">${a.style || 'REDPOINT'}</span>
      </div>
    `).join('');

    mediaHTML += `
      <div class="feed-ascensions-card">
        <h3 class="feed-ascensions-title">${post.ascensions.length} vías completadas</h3>
        <div class="feed-ascensions-list">${ascensionsList}</div>
      </div>
    `;
  } else if (post.type === 'activity') {
    // Strava-style activity stats
    mediaHTML += `
      <div class="feed-activity-stats">
        ${post.distance ? `<div class="activity-stat-item"><span class="activity-stat-label">Distancia</span><span class="activity-stat-value">${post.distance}</span></div>` : ''}
        ${post.elevation ? `<div class="activity-stat-item"><span class="activity-stat-label">Desnivel</span><span class="activity-stat-value">${post.elevation}</span></div>` : ''}
        ${post.duration ? `<div class="activity-stat-item"><span class="activity-stat-label">Tiempo</span><span class="activity-stat-value">${post.duration}</span></div>` : ''}
      </div>
    `;
    if (post.achievement) {
      mediaHTML += `
        <div class="feed-achievement">
          <div class="achievement-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg></div>
          <span class="achievement-text">${post.achievement}</span>
        </div>
      `;
    }
    if (post.mapImage) {
      mediaHTML += `
        <div class="feed-media-wrapper">
          <div class="feed-image-container">
            <img src="${post.mapImage}" alt="Mapa de actividad" class="feed-image feed-image-clickable" data-lightbox-src="${post.mapImage}" loading="lazy">
          </div>
        </div>
      `;
    }
  }

  // Actions bar - Twitter minimal style with counts
  // Determine fill colors based on liked state
  // Like = Red (#ef4444)
  const likeColor = post.liked ? '#ef4444' : 'none';
  const likeStroke = post.liked ? '#ef4444' : 'currentColor';

  const actionsHTML = `
    <div class="feed-actions-bar">
      <button class="feed-action-btn ${post.liked ? 'liked' : ''}" data-action="like" data-post-id="${post.id || ''}" aria-label="Me gusta">
        <svg viewBox="0 0 24 24" fill="${likeColor}" stroke="${likeStroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
        </svg>
        <span class="feed-action-count">${likes > 0 ? formatCount(likes) : ''}</span>
      </button>
      <button class="feed-action-btn" data-action="comment" data-post-id="${post.id || ''}" aria-label="Comentar">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path>
        </svg>
        <span class="feed-action-count">${comments > 0 ? formatCount(comments) : ''}</span>
      </button>
      <span class="feed-actions-spacer"></span>${buildFeedBookmarkButton(post.id, post.bookmarked)}
    </div>
    <!-- Inline Comments Section (hidden by default) -->
    <div class="feed-comments-section hidden" data-post-id="${post.id || ''}">
      <form class="feed-comment-form">
        <img src="${currentUser?.photoURL || generateAvatarFallback(currentUser?.displayName || 'U', 40)}" alt="Tu avatar" class="feed-comment-form-avatar" referrerPolicy="no-referrer" onerror="this.src='${generateAvatarFallback(currentUser?.displayName || 'U', 40)}'; this.onerror=null;">
        <input type="text" class="feed-comment-input" placeholder="Añade un comentario, @ para mencionar" autocomplete="off">
        <button type="submit" class="feed-comment-submit" title="Publicar">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="22" y1="2" x2="11" y2="13"></line>
            <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
        </svg>
      </button>
      </form>
      <div class="feed-comments-list"></div>
    </div>
  `;

  card.innerHTML = headerHTML + mediaHTML + contentHTML + kxAscentListHTML(kxPostAscents(post)) + actionsHTML;

  // La entrada animada va por CSS (@keyframes feedCardFadeIn). Sin transform inline: un transform
  // persistente atraparía las hojas inferiores (position: fixed) dentro de la tarjeta.
  container.appendChild(card);
}

// Attach event listeners to feed
function attachFeedEventListeners(container) {
  // Event Listeners for "Ver en mapa"
  container.querySelectorAll('.feed-map-btn, .feed-location').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const lat = parseFloat(btn.dataset.lat);
      const lng = parseFloat(btn.dataset.lng);
      const zoom = parseInt(btn.dataset.zoom);

      if (!isNaN(lat) && !isNaN(lng)) {
        switchView('map-view');
        if (typeof map !== 'undefined' && map) {
          map.setCenter({ lat, lng });
          map.setZoom(zoom);
        }
      }
    });
  });

  kxBindVideoTiles(container);

  // Event listeners para lightbox de imÃ¡genes
  container.querySelectorAll('.feed-image-clickable').forEach(img => {
    img.addEventListener('click', (e) => {
      e.stopPropagation();
      const imageSrc = img.dataset.lightboxSrc || img.src;
      if (imageSrc) {
        const group = img.closest('.feed-card')?._lightboxItems;
        const index = Number(img.dataset.lightboxIndex);
        openImageLightbox(imageSrc, group, Number.isInteger(index) ? index : undefined);
      }
    });
  });

  // Event listeners para navegaciÃ³n a perfil (avatar y nombre)
  container.querySelectorAll('.feed-avatar-clickable, .feed-username-clickable').forEach(element => {
    element.addEventListener('click', (e) => {
      e.stopPropagation();
      const userId = element.dataset.userId;
      if (userId && typeof openPublicProfile === 'function') {
        openPublicProfile(userId);
      }
    });
  });

  // Event listeners para menÃº de posts
  container.querySelectorAll('.feed-post-menu-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const postId = btn.dataset.postId;
      const dropdown = container.querySelector(`.feed-post-menu-dropdown[data-post-id="${postId}"]`);

      // Cerrar todos los demás dropdowns
      container.querySelectorAll('.feed-post-menu-dropdown').forEach(dd => {
        if (dd !== dropdown) {
          dd.classList.add('hidden');
        }
      });

      // Toggle del dropdown actual
      if (dropdown) {
        dropdown.classList.toggle('hidden');
        kxPlacePostMenu(dropdown);
      }
    });
  });

  // Cerrar dropdowns al hacer clic fuera (solo aÃ±adir una vez)
  if (!feedDropdownListenerAdded) {
    feedDropdownListenerAdded = true;
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.feed-post-menu-wrapper')) {
        document.querySelectorAll('.feed-post-menu-dropdown').forEach(dd => {
          dd.classList.add('hidden');
        });
      }
    });
  }

  // Event listeners para acciones del menÃº de posts
  container.querySelectorAll('.feed-post-menu-item').forEach(item => {
    item.addEventListener('click', async (e) => {
      e.stopPropagation();
      const action = item.dataset.action;
      const postId = item.dataset.postId;

      // Cerrar el dropdown
      const dropdown = item.closest('.feed-post-menu-dropdown');
      if (dropdown) {
        dropdown.classList.add('hidden');
      }

      if (action === 'edit') {
        openEditPostInComposer(postId);
      } else if (action === 'delete') {
        await handleDeletePost(postId, container);
      } else if (action === 'share') {
        await handleFeedShare(postId);
      } else if (action === 'report') {
        await handleReportPost(postId);
      }
    });
  });

  // Event listeners para ediciÃ³n de posts
  container.querySelectorAll('.feed-text-edit-cancel').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const postId = btn.dataset.postId;
      cancelEditPost(postId, container);
    });
  });

  container.querySelectorAll('.feed-text-edit-save').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const postId = btn.dataset.postId;
      await handleUpdatePost(postId, container);
    });
  });
}

// ================== FEED ACTION HANDLERS ==================

// Handle like button click - Uses array likes[] with arrayUnion/arrayRemove
// Colors: Active = Red (#ef4444), Inactive = outline (no fill)
async function handleFeedLike(postId, button) {
  if (!currentUser) {
    showToast('Inicia sesión para dar like', 'info');
    return;
  }

  const isLiked = button.classList.contains('liked');
  const svg = button.querySelector('svg');
  const countSpan = button.querySelector('.feed-action-count');
  let currentCount = parseInt(countSpan?.textContent?.replace(/[KM]/g, '') || '0') || 0;

  // Optimistic UI Update - Immediately update before DB call
  button.classList.toggle('liked');
  if (svg) {
    if (!isLiked) {
      // Activating: Red filled
      svg.setAttribute('fill', '#ef4444');
      svg.setAttribute('stroke', '#ef4444');
    } else {
      // Deactivating: Outline only (no fill)
      svg.setAttribute('fill', 'none');
      svg.setAttribute('stroke', 'currentColor');
    }
  }

  // Update count optimistically
  if (countSpan) {
    if (!isLiked) {
      currentCount++;
    } else {
      currentCount = Math.max(0, currentCount - 1);
    }
    countSpan.textContent = currentCount > 0 ? formatCount(currentCount) : '';
  }

  try {
    const postRef = db.collection('posts').doc(postId);

    // Update likes array using arrayUnion/arrayRemove
    if (isLiked) {
      // Remove like
      await postRef.update({
        likes: firebase.firestore.FieldValue.arrayRemove(currentUser.uid)
      });

      // Delete notification when unliking
      const postDoc = await postRef.get();
      const postData = postDoc.data();
      if (postData && postData.userId && postData.userId !== currentUser.uid) {
        deleteNotification(postData.userId, 'like', postId);
      }
    } else {
      // Add like
      await postRef.update({
        likes: firebase.firestore.FieldValue.arrayUnion(currentUser.uid)
      });

      // Create notification for post author
      const postDoc = await postRef.get();
      const postData = postDoc.data();
      if (postData && postData.userId && postData.userId !== currentUser.uid) {
        createNotification(postData.userId, 'like', `le dio like a tu publicación`, { postId });
      }
    }
  } catch (error) {
    console.error('Error toggling like:', error);
    // Revert optimistic update on error
    button.classList.toggle('liked');
    if (svg) {
      if (isLiked) {
        svg.setAttribute('fill', '#ef4444');
        svg.setAttribute('stroke', '#ef4444');
      } else {
        svg.setAttribute('fill', 'none');
        svg.setAttribute('stroke', 'currentColor');
      }
    }
    if (countSpan) {
      // Revert count
      if (!isLiked) {
        currentCount = Math.max(0, currentCount - 1);
      } else {
        currentCount++;
      }
      countSpan.textContent = currentCount > 0 ? formatCount(currentCount) : '';
    }
    showToast('Error al dar like', 'error');
  }
}

// Handle comment button click - Toggle inline comments section
async function handleFeedComment(postId, button) {
  // Find the parent card and the comments section
  const card = button.closest('.feed-card');

  // If inside modal (no .feed-card), scroll to and focus the comment input
  if (!card) {
    const modalBody = button.closest('.view-post-body');
    if (modalBody) {
      const commentInput = modalBody.querySelector('.feed-comment-input');
      if (commentInput) {
        commentInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
        commentInput.focus();
      }
    }
    return;
  }

  const commentsSection = card.querySelector('.feed-comments-section');
  if (!commentsSection) return;

  // Toggle visibility
  const isHidden = commentsSection.classList.contains('hidden');

  if (isHidden) {
    // Show comments section
    commentsSection.classList.remove('hidden');

    // Load comments if not already loaded
    const commentsList = commentsSection.querySelector('.feed-comments-list');
    if (commentsList && !commentsList.dataset.loaded) {
      await loadInlineComments(postId, commentsList);
      commentsList.dataset.loaded = 'true';
    }

    // Focus on input and attach mention autocomplete
    const input = commentsSection.querySelector('.feed-comment-input');
    if (input) {
      if (!input._mentionAutocomplete) {
        new MentionAutocomplete(input);
      }
      input.focus();
    }
  } else {
    // Hide comments section
    commentsSection.classList.add('hidden');
  }
}

// Load comments for inline display
async function loadInlineComments(postId, container) {
  try {
    container.innerHTML = '<div class="loading-spinner-small">Cargando...</div>';

    // Get post data to check if current user is the post author
    const postDoc = await db.collection('posts').doc(postId).get();
    const postData = postDoc.data();
    const postAuthorId = postData?.userId || null;
    const currentUserId = currentUser?.uid || null;
    const isPostAuthor = currentUserId && postAuthorId && currentUserId === postAuthorId;

    const snapshot = await db.collection('posts')
      .doc(postId)
      .collection('comments')
      .orderBy('createdAt', 'desc')
      .limit(10)
      .get();

    if (snapshot.empty) {
      container.innerHTML = '<p class="no-comments">No hay comentarios aún. Sé el primero!</p>';
      return;
    }

    let html = '';
    snapshot.forEach(doc => {
      const comment = doc.data();
      const date = comment.createdAt ? formatTimeAgo(comment.createdAt.toDate()) : '';
      const photoUrl = comment.userPhoto || `https://ui-avatars.com/api/?name=${encodeURIComponent(comment.userName || 'U')}&background=153E35&color=fff&size=40`;

      // Permisos de UI: Determinar quÃ© opciones mostrar
      const commentAuthorId = comment.userId || null;
      const isCommentAuthor = currentUserId && commentAuthorId && currentUserId === commentAuthorId;
      const canDelete = isCommentAuthor || isPostAuthor;
      const canEdit = isCommentAuthor; // Solo el autor puede editar

      // MenÃº de opciones (tres puntos) - mostrar solo si hay al menos una opciÃ³n disponible
      // El dropdown se renderiza en el portal (#dropdown-portal) para evitar clipping/scroll
      const menuButton = (canEdit || canDelete) ? `
        <div class="feed-comment-menu-wrapper">
          <button class="feed-comment-menu-btn"
                  data-comment-id="${doc.id}"
                  data-post-id="${postId}"
                  data-comment-author-id="${commentAuthorId}"
                  data-post-author-id="${postAuthorId}"
                  data-can-edit="${canEdit}"
                  data-can-delete="${canDelete}"
                  title="Opciones">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="1"></circle>
              <circle cx="19" cy="12" r="1"></circle>
              <circle cx="5" cy="12" r="1"></circle>
            </svg>
          </button>
        </div>
      ` : '';

      // Likes data
      const likes = comment.likes || [];
      const likesCount = likes.length;
      const isLiked = currentUserId && likes.includes(currentUserId);
      const repliesCount = comment.repliesCount || 0;

      html += `
        <div class="feed-comment-item" data-comment-id="${doc.id}" data-post-id="${postId}">
          <img src="${photoUrl}" alt="${comment.userName}" class="feed-comment-avatar" referrerPolicy="no-referrer" onerror="this.src='${generateAvatarFallback(comment.userName || 'U', 40)}'; this.onerror=null;">
          <div class="feed-comment-content">
            <div class="feed-comment-header">
              <span class="feed-comment-username">${comment.userName || 'Usuario'}</span>
              <span class="feed-comment-time">${date}</span>
              ${menuButton}
            </div>
            <div class="feed-comment-text-wrapper">
              <p class="feed-comment-text" data-comment-id="${doc.id}">${renderTextWithMentions(comment.text || '', comment.mentions)}</p>
              <div class="feed-comment-edit-wrapper hidden" data-comment-id="${doc.id}">
                <textarea class="feed-comment-edit-input" data-comment-id="${doc.id}" rows="2">${comment.text || ''}</textarea>
                <div class="feed-comment-edit-actions">
                  <button class="feed-comment-edit-cancel" data-comment-id="${doc.id}">Cancelar</button>
                  <button class="feed-comment-edit-save" data-comment-id="${doc.id}">
                    <span class="feed-comment-edit-save-text">Guardar</span>
                    <span class="feed-comment-edit-save-loading hidden">Guardando...</span>
                  </button>
                </div>
              </div>
            </div>
            <!-- Action Bar: Like, Reply, View Replies -->
            <div class="feed-comment-actions">
              <button class="feed-comment-action-btn feed-comment-like-btn ${isLiked ? 'liked' : ''}"
                      data-comment-id="${doc.id}"
                      data-post-id="${postId}"
                      title="Me gusta">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
                </svg>
                <span class="feed-comment-action-count">${likesCount > 0 ? likesCount : ''}</span>
              </button>
              <button class="feed-comment-action-btn feed-comment-reply-btn"
                      data-comment-id="${doc.id}"
                      data-post-id="${postId}"
                      data-comment-author="${comment.userName || 'Usuario'}"
                      title="Responder">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path>
                </svg>
                <span>Responder</span>
              </button>
              ${repliesCount > 0 ? `
                <button class="feed-comment-action-btn feed-comment-view-replies"
                        data-comment-id="${doc.id}"
                        data-post-id="${postId}">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="6 9 12 15 18 9"></polyline>
                  </svg>
                  <span>Ver ${repliesCount} ${repliesCount === 1 ? 'respuesta' : 'respuestas'}</span>
                </button>
              ` : ''}
            </div>
            <!-- Reply Form (hidden by default) -->
            <div class="feed-comment-reply-form hidden" data-comment-id="${doc.id}" data-post-id="${postId}">
              <input type="text" class="feed-comment-reply-input" placeholder="Escribe una respuesta..." autocomplete="off">
              <button type="button" class="feed-comment-reply-submit" title="Publicar">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13"></line>
                  <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                </svg>
              </button>
            </div>
            <!-- Replies Container -->
            <div class="feed-comment-replies hidden" data-comment-id="${doc.id}" data-post-id="${postId}"></div>
          </div>
        </div>
      `;
    });

    container.innerHTML = html;

    // Portal container for dropdowns
    const dropdownPortal = document.getElementById('dropdown-portal');

    // Function to close any open dropdown in portal
    function closePortalDropdown() {
      if (dropdownPortal) {
        dropdownPortal.innerHTML = '';
      }
    }

    // Function to create and position dropdown in portal
    function openDropdownInPortal(btn) {
      const commentId = btn.dataset.commentId;
      const canEdit = btn.dataset.canEdit === 'true';
      const canDelete = btn.dataset.canDelete === 'true';

      // Close any existing dropdown first
      closePortalDropdown();

      // Get button position using getBoundingClientRect
      const rect = btn.getBoundingClientRect();

      // Create dropdown HTML
      const dropdownHTML = `
        <div class="feed-comment-menu-dropdown feed-comment-menu-dropdown-portal" data-comment-id="${commentId}">
          ${canEdit ? `
            <button class="feed-comment-menu-item" data-action="edit" data-comment-id="${commentId}">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
              </svg>
              <span>Editar</span>
            </button>
          ` : ''}
          ${canDelete ? `
            <button class="feed-comment-menu-item feed-comment-menu-item-danger" data-action="delete" data-comment-id="${commentId}">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              </svg>
              <span>Borrar</span>
            </button>
          ` : ''}
        </div>
      `;

      dropdownPortal.innerHTML = dropdownHTML;
      const dropdown = dropdownPortal.querySelector('.feed-comment-menu-dropdown');

      // Position dropdown with fixed positioning
      // Align to the right of the button
      const dropdownWidth = 180; // min-width from CSS
      let left = rect.right - dropdownWidth;
      let top = rect.bottom + 8;

      // Ensure dropdown doesn't go off-screen (left edge)
      if (left < 8) {
        left = 8;
      }

      // Ensure dropdown doesn't go off-screen (right edge)
      if (left + dropdownWidth > window.innerWidth - 8) {
        left = window.innerWidth - dropdownWidth - 8;
      }

      // If dropdown would go below viewport, position above button
      const dropdownHeight = dropdown.offsetHeight || 100;
      if (top + dropdownHeight > window.innerHeight - 8) {
        top = rect.top - dropdownHeight - 8;
      }

      dropdown.style.position = 'fixed';
      dropdown.style.top = `${top}px`;
      dropdown.style.left = `${left}px`;
      dropdown.style.zIndex = '9999';

      // Attach click listeners to dropdown items
      dropdown.querySelectorAll('.feed-comment-menu-item').forEach(item => {
        item.addEventListener('click', async (e) => {
          e.stopPropagation();
          const action = item.dataset.action;
          const itemCommentId = item.dataset.commentId;
          const commentItem = container.querySelector(`.feed-comment-item[data-comment-id="${itemCommentId}"]`);
          const postId = commentItem?.dataset.postId;

          // Close dropdown
          closePortalDropdown();

          if (action === 'edit') {
            await handleEditComment(itemCommentId, commentItem);
          } else if (action === 'delete') {
            const menuBtn = container.querySelector(`.feed-comment-menu-btn[data-comment-id="${itemCommentId}"]`);
            const commentAuthorId = menuBtn?.dataset.commentAuthorId;
            const postAuthorId = menuBtn?.dataset.postAuthorId;

            if (typeof showConfirm === 'function') {
              const confirmed = await showConfirm('Â¿Eliminar este comentario?', 'Eliminar comentario');
              if (confirmed) {
                await deleteInlineComment(postId, itemCommentId, container, commentAuthorId, postAuthorId);
              }
            } else {
              if (confirm('Â¿Eliminar este comentario?')) {
                await deleteInlineComment(postId, itemCommentId, container, commentAuthorId, postAuthorId);
              }
            }
          }
        });
      });
    }

    // Attach menu button event listeners
    container.querySelectorAll('.feed-comment-menu-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const commentId = btn.dataset.commentId;
        const existingDropdown = dropdownPortal?.querySelector(`.feed-comment-menu-dropdown[data-comment-id="${commentId}"]`);

        if (existingDropdown) {
          // Toggle off if same dropdown
          closePortalDropdown();
        } else {
          // Open new dropdown
          openDropdownInPortal(btn);
        }
      });
    });

    // Click-outside listener to close dropdown
    function handleClickOutside(e) {
      // Don't close if clicking on a menu button or inside the dropdown
      if (e.target.closest('.feed-comment-menu-btn') || e.target.closest('.feed-comment-menu-dropdown')) {
        return;
      }
      closePortalDropdown();
    }

    // Use capture phase to ensure we catch the event
    document.addEventListener('click', handleClickOutside, true);

    // Attach edit action listeners
    container.querySelectorAll('.feed-comment-edit-cancel').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const commentId = btn.dataset.commentId;
        cancelEditComment(commentId, container);
      });
    });

    container.querySelectorAll('.feed-comment-edit-save').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const commentId = btn.dataset.commentId;
        const commentItem = container.querySelector(`.feed-comment-item[data-comment-id="${commentId}"]`);
        const postId = commentItem?.dataset.postId;
        await handleUpdateComment(postId, commentId, container);
      });
    });

    // Like button listeners
    container.querySelectorAll('.feed-comment-like-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const commentId = btn.dataset.commentId;
        const postId = btn.dataset.postId;
        await handleCommentLike(postId, commentId, btn);
      });
    });

    // Reply button listeners (toggle reply form)
    container.querySelectorAll('.feed-comment-reply-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const commentId = btn.dataset.commentId;
        toggleReplyForm(commentId, container);
      });
    });

    // Reply form input listeners (submit on Enter)
    container.querySelectorAll('.feed-comment-reply-input').forEach(input => {
      // Submit on Enter
      input.addEventListener('keypress', async (e) => {
        if (e.key === 'Enter' && input.value.trim()) {
          e.preventDefault();
          const form = input.closest('.feed-comment-reply-form');
          const commentId = form?.dataset.commentId;
          const postId = form?.dataset.postId;
          await handleSubmitReply(postId, commentId, input.value.trim(), container);
          input.value = '';
        }
      });
    });

    // Reply submit button listeners
    container.querySelectorAll('.feed-comment-reply-submit').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const form = btn.closest('.feed-comment-reply-form');
        const input = form?.querySelector('.feed-comment-reply-input');
        const commentId = form?.dataset.commentId;
        const postId = form?.dataset.postId;
        if (input?.value.trim()) {
          await handleSubmitReply(postId, commentId, input.value.trim(), container);
          input.value = '';
        }
      });
    });

    // View replies button listeners
    container.querySelectorAll('.feed-comment-view-replies').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const commentId = btn.dataset.commentId;
        const postId = btn.dataset.postId;
        await toggleReplies(postId, commentId, btn, container);
      });
    });

  } catch (error) {
    console.error('Error loading comments:', error);
    container.innerHTML = '<p class="comments-error">Error al cargar comentarios</p>';
  }
}

// Handle comment like toggle
async function handleCommentLike(postId, commentId, btn) {
  if (!currentUser) {
    showToast('Inicia sesión para dar like', 'info');
    return;
  }

  const commentRef = db.collection('posts').doc(postId).collection('comments').doc(commentId);
  const countSpan = btn.querySelector('.feed-comment-action-count');

  try {
    const isLiked = btn.classList.contains('liked');

    if (isLiked) {
      // Remove like
      await commentRef.update({
        likes: firebase.firestore.FieldValue.arrayRemove(currentUser.uid)
      });
      btn.classList.remove('liked');
      const currentCount = parseInt(countSpan.textContent) || 1;
      countSpan.textContent = currentCount > 1 ? currentCount - 1 : '';
    } else {
      // Add like
      await commentRef.update({
        likes: firebase.firestore.FieldValue.arrayUnion(currentUser.uid)
      });
      btn.classList.add('liked');
      const currentCount = parseInt(countSpan.textContent) || 0;
      countSpan.textContent = currentCount + 1;
    }
  } catch (error) {
    console.error('Error toggling comment like:', error);
    showToast('Error al procesar like', 'error');
  }
}

// Toggle reply form visibility
function toggleReplyForm(commentId, container) {
  const form = container.querySelector(`.feed-comment-reply-form[data-comment-id="${commentId}"]`);
  if (!form) return;

  const isHidden = form.classList.contains('hidden');

  // Close all other reply forms first
  container.querySelectorAll('.feed-comment-reply-form').forEach(f => {
    f.classList.add('hidden');
    // Limpiar input al cerrar
    const input = f.querySelector('.feed-comment-reply-input');
    if (input) {
      input.value = '';
    }
  });

  if (isHidden) {
    // Obtener el username del autor del comentario desde el botÃ³n
    const replyBtn = container.querySelector(`.feed-comment-reply-btn[data-comment-id="${commentId}"]`);
    const replyToUserName = replyBtn?.dataset.commentAuthor || '';

    // Guardar el username en el atributo data del formulario
    if (replyToUserName) {
      form.setAttribute('data-reply-to-user', replyToUserName);
    }

    form.classList.remove('hidden');
    const input = form.querySelector('.feed-comment-reply-input');
    if (input) {
      input.value = '';
      // Attach mention autocomplete if not already attached
      if (!input._mentionAutocomplete) {
        new MentionAutocomplete(input);
      } else {
        input._mentionAutocomplete.clearMentions();
      }
      input.focus();
    }
  }
}

// Handle submit reply
async function handleSubmitReply(postId, commentId, text, container) {
  if (!currentUser) {
    showToast('Inicia sesión para responder', 'info');
    return;
  }

  if (!text.trim()) return;

  try {
    // Get user photo from Firestore (might be different from Auth)
    let userPhotoURL = currentUser.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(currentUser.displayName || 'U')}&background=153E35&color=fff&size=40`;
    try {
      const userDoc = await db.collection('users').doc(currentUser.uid).get();
      if (userDoc.exists && userDoc.data().photoURL) {
        userPhotoURL = userDoc.data().photoURL;
      }
    } catch (e) {
      console.warn('Could not fetch user photo for reply', e);
    }

    // Obtener el username del destinatario desde el atributo data del formulario
    const form = container.querySelector(`.feed-comment-reply-form[data-comment-id="${commentId}"]`);
    const replyToUserName = form?.getAttribute('data-reply-to-user') || '';

    // Limpiar el texto de menciones (@username)
    let cleanText = text.trim();
    if (replyToUserName) {
      // Eliminar menciones que empiecen con @ seguido del username
      const mentionPattern = new RegExp(`@${replyToUserName}\\s*`, 'gi');
      cleanText = cleanText.replace(mentionPattern, '').trim();
    }

    // Extract mentions from autocomplete
    const replyInput = form?.querySelector('.feed-comment-reply-input');
    const mentionAC = replyInput?._mentionAutocomplete;
    const mentions = mentionAC ? mentionAC.getMentions() : [];
    const validMentions = extractMentionsFromText(cleanText, mentions);

    // Crear objeto para guardar en Firestore
    const replyData = {
      text: cleanText,
      userId: currentUser.uid,
      userName: currentUser.displayName || 'Usuario',
      userPhoto: userPhotoURL,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      likes: []
    };
    if (validMentions.length > 0) {
      replyData.mentions = validMentions;
    }

    // AÃ±adir replyToUserName si existe
    if (replyToUserName) {
      replyData.replyToUserName = replyToUserName;
    }

    // Create reply in subcollection
    const replyRef = db.collection('posts').doc(postId).collection('comments').doc(commentId).collection('replies');
    const newReplyDoc = await replyRef.add(replyData);

    // Get parent comment data to notify its author
    const commentRef = db.collection('posts').doc(postId).collection('comments').doc(commentId);
    const commentDoc = await commentRef.get();
    const commentData = commentDoc.exists ? commentDoc.data() : null;

    // Update repliesCount on parent comment
    await commentRef.update({
      repliesCount: firebase.firestore.FieldValue.increment(1)
    });

    // Send reply notification to the comment author
    if (commentData && commentData.userId && commentData.userId !== currentUser.uid) {
      createNotification(commentData.userId, 'reply', `respondió a tu comentario`, { postId, commentId, replyId: newReplyDoc.id });
    }

    // Hide reply form and clear mentions
    form?.classList.add('hidden');
    if (mentionAC) mentionAC.clearMentions();

    // Show replies container and load replies
    const repliesContainer = container.querySelector(`.feed-comment-replies[data-comment-id="${commentId}"]`);
    const viewRepliesBtn = container.querySelector(`.feed-comment-view-replies[data-comment-id="${commentId}"]`);

    if (repliesContainer) {
      repliesContainer.classList.remove('hidden');
      await loadReplies(postId, commentId, repliesContainer);
    }

    // Update or create view replies button
    if (viewRepliesBtn) {
      const currentCount = parseInt(viewRepliesBtn.textContent.match(/\d+/)?.[0] || '0') + 1;
      viewRepliesBtn.querySelector('span').textContent = `Ver ${currentCount} ${currentCount === 1 ? 'respuesta' : 'respuestas'}`;
    } else {
      // Create view replies button if it doesn't exist (inside actions div)
      const commentItem = container.querySelector(`.feed-comment-item[data-comment-id="${commentId}"]`);
      const actionsDiv = commentItem?.querySelector('.feed-comment-actions');
      if (actionsDiv && !viewRepliesBtn) {
        const newBtn = document.createElement('button');
        newBtn.className = 'feed-comment-action-btn feed-comment-view-replies';
        newBtn.dataset.commentId = commentId;
        newBtn.dataset.postId = postId;
        newBtn.innerHTML = `
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
          <span>Ver 1 respuesta</span>
        `;
        newBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          await toggleReplies(postId, commentId, newBtn, container);
        });
        // Append inside the actions div (after Reply button)
        actionsDiv.appendChild(newBtn);
      }
    }

    showToast('Respuesta publicada', 'success');

    // Send mention notifications
    if (validMentions.length > 0) {
      sendMentionNotifications(validMentions, { type: 'reply', postId });
    }
  } catch (error) {
    console.error('Error submitting reply:', error);
    showToast('Error al publicar respuesta', 'error');
  }
}

// Toggle replies visibility and load if needed
async function toggleReplies(postId, commentId, btn, container) {
  const repliesContainer = container.querySelector(`.feed-comment-replies[data-comment-id="${commentId}"]`);
  if (!repliesContainer) return;

  const isHidden = repliesContainer.classList.contains('hidden');

  if (isHidden) {
    repliesContainer.classList.remove('hidden');
    btn.querySelector('svg')?.setAttribute('style', 'transform: rotate(180deg)');

    // Load replies if not loaded yet
    if (!repliesContainer.dataset.loaded) {
      await loadReplies(postId, commentId, repliesContainer);
      repliesContainer.dataset.loaded = 'true';
    }
  } else {
    repliesContainer.classList.add('hidden');
    btn.querySelector('svg')?.setAttribute('style', '');
  }
}

// Load replies for a comment
async function loadReplies(postId, commentId, container) {
  try {
    container.innerHTML = '<div class="feed-comment-replies-loading">Cargando respuestas...</div>';

    const snapshot = await db.collection('posts')
      .doc(postId)
      .collection('comments')
      .doc(commentId)
      .collection('replies')
      .orderBy('createdAt', 'asc')
      .limit(20)
      .get();

    if (snapshot.empty) {
      container.innerHTML = '';
      return;
    }

    const currentUserId = currentUser?.uid || null;
    let html = '';

    snapshot.forEach(doc => {
      const reply = doc.data();
      const date = reply.createdAt ? formatTimeAgo(reply.createdAt.toDate()) : '';
      const photoUrl = reply.userPhoto || `https://ui-avatars.com/api/?name=${encodeURIComponent(reply.userName || 'U')}&background=153E35&color=fff&size=28`;

      // Likes data
      const likes = reply.likes || [];
      const likesCount = likes.length;
      const isLiked = currentUserId && likes.includes(currentUserId);

      // Permissions
      const isReplyAuthor = currentUserId && reply.userId === currentUserId;

      const replyUserName = reply.userName || 'Usuario';
      const replyToUserName = reply.replyToUserName || '';

      html += `
        <div class="feed-comment-item feed-reply-item"
             data-reply-id="${doc.id}"
             data-parent-id="${commentId}"
             data-post-id="${postId}"
             data-username="${replyUserName}">
          <img src="${photoUrl}" alt="${replyUserName}" class="feed-comment-avatar" referrerPolicy="no-referrer" onerror="this.src='${generateAvatarFallback(replyUserName, 28)}'; this.onerror=null;">
          <div class="feed-comment-content">
            <div class="feed-comment-header">
              <span class="feed-comment-username">${replyUserName}</span>
              ${replyToUserName ? `
                <svg class="feed-reply-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="9 18 15 12 9 6"></polyline>
                </svg>
                <span class="feed-reply-to-username">${replyToUserName}</span>
              ` : ''}
              <span class="feed-comment-time">${date}</span>
              ${isReplyAuthor ? `
                <div class="feed-comment-menu-wrapper">
                  <button class="feed-comment-menu-btn feed-reply-menu-btn"
                          data-reply-id="${doc.id}"
                          data-comment-id="${commentId}"
                          data-post-id="${postId}"
                          title="Opciones">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <circle cx="12" cy="12" r="1"></circle>
                      <circle cx="19" cy="12" r="1"></circle>
                      <circle cx="5" cy="12" r="1"></circle>
                    </svg>
                  </button>
                </div>
              ` : ''}
            </div>
            <p class="feed-comment-text">${renderTextWithMentions(reply.text || '', reply.mentions)}</p>
            <div class="feed-comment-actions">
              <button class="feed-comment-action-btn feed-reply-like-btn ${isLiked ? 'liked' : ''}"
                      data-reply-id="${doc.id}"
                      data-comment-id="${commentId}"
                      data-post-id="${postId}"
                      title="Me gusta">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
                </svg>
                <span class="feed-comment-action-count">${likesCount > 0 ? likesCount : ''}</span>
              </button>
              <button class="feed-comment-action-btn feed-reply-to-reply-btn"
                      data-reply-id="${doc.id}"
                      data-parent-id="${commentId}"
                      data-post-id="${postId}"
                      data-username="${replyUserName}"
                      title="Responder">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path>
                </svg>
                <span>Responder</span>
              </button>
            </div>
            <!-- Reply-to-reply form (hidden by default) -->
            <div class="feed-comment-reply-form feed-reply-to-reply-form hidden"
                 data-reply-id="${doc.id}"
                 data-parent-id="${commentId}"
                 data-post-id="${postId}">
              <input type="text" class="feed-comment-reply-input" placeholder="Escribe una respuesta..." autocomplete="off">
              <button type="button" class="feed-comment-reply-submit" title="Publicar">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13"></line>
                  <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                </svg>
              </button>
            </div>
          </div>
        </div>
      `;
    });

    container.innerHTML = html;

    // Attach like listeners for replies
    container.querySelectorAll('.feed-reply-like-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const replyId = btn.dataset.replyId;
        const commentId = btn.dataset.commentId;
        const postId = btn.dataset.postId;
        await handleReplyLike(postId, commentId, replyId, btn);
      });
    });

    // Attach delete listeners for replies
    container.querySelectorAll('.feed-reply-menu-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const replyId = btn.dataset.replyId;
        const commentId = btn.dataset.commentId;
        const postId = btn.dataset.postId;

        if (typeof showConfirm === 'function') {
          const confirmed = await showConfirm('Â¿Eliminar esta respuesta?', 'Eliminar respuesta');
          if (confirmed) {
            await deleteReply(postId, commentId, replyId, container);
          }
        } else {
          if (confirm('Â¿Eliminar esta respuesta?')) {
            await deleteReply(postId, commentId, replyId, container);
          }
        }
      });
    });

    // Attach "Reply to reply" button listeners
    container.querySelectorAll('.feed-reply-to-reply-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const replyId = btn.dataset.replyId;
        const parentId = btn.dataset.parentId;
        const username = btn.dataset.username;
        toggleReplyToReplyForm(replyId, parentId, username, container);
      });
    });

    // Attach input listeners for reply-to-reply forms (submit on Enter)
    container.querySelectorAll('.feed-reply-to-reply-form .feed-comment-reply-input').forEach(input => {
      // Submit on Enter
      input.addEventListener('keypress', async (e) => {
        if (e.key === 'Enter' && input.value.trim()) {
          e.preventDefault();
          const form = input.closest('.feed-reply-to-reply-form');
          const replyId = form?.dataset.replyId;
          const parentId = form?.dataset.parentId;
          const postId = form?.dataset.postId;
          await handleSubmitReplyToReply(postId, parentId, replyId, input.value.trim(), container);
          input.value = '';
        }
      });
    });

    // Attach submit button listeners for reply-to-reply forms
    container.querySelectorAll('.feed-reply-to-reply-form .feed-comment-reply-submit').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const form = btn.closest('.feed-reply-to-reply-form');
        const input = form?.querySelector('.feed-comment-reply-input');
        const replyId = form?.dataset.replyId;
        const parentId = form?.dataset.parentId;
        const postId = form?.dataset.postId;
        if (input?.value.trim()) {
          await handleSubmitReplyToReply(postId, parentId, replyId, input.value.trim(), container);
          input.value = '';
        }
      });
    });

  } catch (error) {
    console.error('Error loading replies:', error);
    container.innerHTML = '<p class="comments-error">Error al cargar respuestas</p>';
  }
}

// Handle reply like toggle
async function handleReplyLike(postId, commentId, replyId, btn) {
  if (!currentUser) {
    showToast('Inicia sesión para dar like', 'info');
    return;
  }

  const replyRef = db.collection('posts').doc(postId).collection('comments').doc(commentId).collection('replies').doc(replyId);
  const countSpan = btn.querySelector('.feed-comment-action-count');

  try {
    const isLiked = btn.classList.contains('liked');

    if (isLiked) {
      await replyRef.update({
        likes: firebase.firestore.FieldValue.arrayRemove(currentUser.uid)
      });
      btn.classList.remove('liked');
      const currentCount = parseInt(countSpan.textContent) || 1;
      countSpan.textContent = currentCount > 1 ? currentCount - 1 : '';
    } else {
      await replyRef.update({
        likes: firebase.firestore.FieldValue.arrayUnion(currentUser.uid)
      });
      btn.classList.add('liked');
      const currentCount = parseInt(countSpan.textContent) || 0;
      countSpan.textContent = currentCount + 1;
    }
  } catch (error) {
    console.error('Error toggling reply like:', error);
    showToast('Error al procesar like', 'error');
  }
}

// Delete a reply
async function deleteReply(postId, commentId, replyId, container) {
  if (!currentUser) {
    showToast('Inicia sesión para eliminar', 'info');
    return;
  }

  try {
    // Delete reply
    await db.collection('posts').doc(postId).collection('comments').doc(commentId).collection('replies').doc(replyId).delete();

    // Update repliesCount on parent comment
    await db.collection('posts').doc(postId).collection('comments').doc(commentId).update({
      repliesCount: firebase.firestore.FieldValue.increment(-1)
    });

    // Remove from DOM
    const replyItem = container.querySelector(`.feed-reply-item[data-reply-id="${replyId}"]`);
    replyItem?.remove();

    showToast('Respuesta eliminada', 'success');
  } catch (error) {
    console.error('Error deleting reply:', error);
    showToast('Error al eliminar respuesta', 'error');
  }
}

// Toggle reply-to-reply form visibility (sin pre-llenar con @username)
function toggleReplyToReplyForm(replyId, parentId, username, container) {
  const form = container.querySelector(`.feed-reply-to-reply-form[data-reply-id="${replyId}"]`);
  if (!form) return;

  const isHidden = form.classList.contains('hidden');

  // Close all other reply-to-reply forms first
  container.querySelectorAll('.feed-reply-to-reply-form').forEach(f => {
    f.classList.add('hidden');
    // Clear inputs when closing
    const input = f.querySelector('.feed-comment-reply-input');
    if (input && f !== form) {
      input.value = '';
    }
  });

  if (isHidden) {
    // Guardar el username en el atributo data del formulario
    if (username) {
      form.setAttribute('data-reply-to-user', username);
    }

    form.classList.remove('hidden');
    const input = form.querySelector('.feed-comment-reply-input');
    if (input) {
      input.value = '';
      // Attach mention autocomplete if not already attached
      if (!input._mentionAutocomplete) {
        new MentionAutocomplete(input);
      } else {
        input._mentionAutocomplete.clearMentions();
      }
      input.focus();
    }
  }
}

// Handle submit reply to a reply (nested level 2)
async function handleSubmitReplyToReply(postId, parentCommentId, replyToId, text, container) {
  if (!currentUser) {
    showToast('Inicia sesión para responder', 'info');
    return;
  }

  if (!text.trim()) return;

  try {
    // Get user photo from Firestore
    let userPhotoURL = currentUser.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(currentUser.displayName || 'U')}&background=153E35&color=fff&size=40`;
    try {
      const userDoc = await db.collection('users').doc(currentUser.uid).get();
      if (userDoc.exists && userDoc.data().photoURL) {
        userPhotoURL = userDoc.data().photoURL;
      }
    } catch (e) {
      console.warn('Could not fetch user photo for reply', e);
    }

    // Obtener el username del destinatario desde el atributo data del formulario
    const form = container.querySelector(`.feed-reply-to-reply-form[data-reply-id="${replyToId}"]`);
    const replyToUserName = form?.getAttribute('data-reply-to-user') || '';

    // Limpiar el texto de menciones (@username)
    let cleanText = text.trim();
    if (replyToUserName) {
      // Eliminar menciones que empiecen con @ seguido del username
      const mentionPattern = new RegExp(`@${replyToUserName}\\s*`, 'gi');
      cleanText = cleanText.replace(mentionPattern, '').trim();
    }

    // Extract mentions from autocomplete
    const replyInput = form?.querySelector('.feed-comment-reply-input');
    const mentionAC = replyInput?._mentionAutocomplete;
    const mentions = mentionAC ? mentionAC.getMentions() : [];
    const validMentions = extractMentionsFromText(cleanText, mentions);

    // Crear objeto para guardar en Firestore
    const replyData = {
      text: cleanText,
      userId: currentUser.uid,
      userName: currentUser.displayName || 'Usuario',
      userPhoto: userPhotoURL,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      likes: [],
      replyToId: replyToId // Reference to the reply being responded to
    };
    if (validMentions.length > 0) {
      replyData.mentions = validMentions;
    }

    // AÃ±adir replyToUserName si existe
    if (replyToUserName) {
      replyData.replyToUserName = replyToUserName;
    }

    // Save to the SAME subcollection as the parent comment's replies (no sub-sub-collections)
    const repliesRef = db.collection('posts').doc(postId).collection('comments').doc(parentCommentId).collection('replies');
    const newReplyDoc = await repliesRef.add(replyData);

    // Get the reply being responded to, to notify its author
    const replyToDoc = await db.collection('posts').doc(postId).collection('comments').doc(parentCommentId).collection('replies').doc(replyToId).get();
    const replyToData = replyToDoc.exists ? replyToDoc.data() : null;

    // Update repliesCount on parent comment
    const commentRef = db.collection('posts').doc(postId).collection('comments').doc(parentCommentId);
    await commentRef.update({
      repliesCount: firebase.firestore.FieldValue.increment(1)
    });

    // Send reply notification to the author of the reply being responded to
    if (replyToData && replyToData.userId && replyToData.userId !== currentUser.uid) {
      createNotification(replyToData.userId, 'reply', `respondió a tu comentario`, { postId, commentId: parentCommentId, replyId: newReplyDoc.id });
    }

    // Hide the reply form and clear mentions
    if (form) {
      form.classList.add('hidden');
      const input = form.querySelector('.feed-comment-reply-input');
      if (input) {
        input.value = '';
      }
      if (mentionAC) mentionAC.clearMentions();
    }

    // Reload replies to show the new one
    await loadReplies(postId, parentCommentId, container);

    showToast('Respuesta publicada', 'success');

    // Send mention notifications
    if (validMentions.length > 0) {
      sendMentionNotifications(validMentions, { type: 'reply', postId });
    }
  } catch (error) {
    console.error('Error submitting reply to reply:', error);
    showToast('Error al publicar respuesta', 'error');
  }
}

// Handle edit comment - switch to edit mode
async function handleEditComment(commentId, commentItem) {
  const textWrapper = commentItem.querySelector('.feed-comment-text-wrapper');
  const textElement = textWrapper.querySelector('.feed-comment-text');
  const editWrapper = textWrapper.querySelector('.feed-comment-edit-wrapper');
  const editInput = editWrapper.querySelector('.feed-comment-edit-input');

  if (!textElement || !editWrapper || !editInput) return;

  // Hide text, show edit form
  textElement.classList.add('hidden');
  editWrapper.classList.remove('hidden');

  // Focus and select text
  editInput.focus();
  editInput.setSelectionRange(editInput.value.length, editInput.value.length);
}

// Cancel edit comment - switch back to view mode
function cancelEditComment(commentId, container) {
  const commentItem = container.querySelector(`.feed-comment-item[data-comment-id="${commentId}"]`);
  if (!commentItem) return;

  const textWrapper = commentItem.querySelector('.feed-comment-text-wrapper');
  const textElement = textWrapper.querySelector('.feed-comment-text');
  const editWrapper = textWrapper.querySelector('.feed-comment-edit-wrapper');
  const editInput = editWrapper.querySelector('.feed-comment-edit-input');

  if (!textElement || !editWrapper || !editInput) return;

  // Reset input to original text
  editInput.value = textElement.textContent;

  // Hide edit form, show text
  editWrapper.classList.add('hidden');
  textElement.classList.remove('hidden');
}

// Handle update comment - save edited comment to Firestore
async function handleUpdateComment(postId, commentId, container) {
  if (!currentUser) {
    showToast('Inicia sesión para editar comentarios', 'info');
    return;
  }

  const commentItem = container.querySelector(`.feed-comment-item[data-comment-id="${commentId}"]`);
  if (!commentItem) return;

  const editWrapper = commentItem.querySelector(`.feed-comment-edit-wrapper[data-comment-id="${commentId}"]`);
  const editInput = editWrapper.querySelector('.feed-comment-edit-input');
  const saveBtn = editWrapper.querySelector('.feed-comment-edit-save');
  const saveText = saveBtn.querySelector('.feed-comment-edit-save-text');
  const saveLoading = saveBtn.querySelector('.feed-comment-edit-save-loading');
  const textElement = commentItem.querySelector(`.feed-comment-text[data-comment-id="${commentId}"]`);

  if (!editInput || !saveBtn || !textElement) return;

  const newText = editInput.value.trim();

  if (!newText) {
    showToast('El comentario no puede estar vací­o', 'error');
    return;
  }

  // Verificar permisos antes de actualizar
  try {
    const commentDoc = await db.collection('posts').doc(postId).collection('comments').doc(commentId).get();

    if (!commentDoc.exists) {
      showToast('El comentario no existe', 'error');
      return;
    }

    const commentData = commentDoc.data();
    const commentAuthorId = commentData?.userId;

    if (!commentAuthorId || currentUser.uid !== commentAuthorId) {
      showToast('No tienes permisos para editar este comentario', 'error');
      return;
    }

    // Show loading state
    saveBtn.disabled = true;
    saveText.classList.add('hidden');
    saveLoading.classList.remove('hidden');
    editInput.disabled = true;

    // Update comment in Firestore
    await db.collection('posts').doc(postId).collection('comments').doc(commentId).update({
      text: newText,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    // Update UI - hide edit form, show updated text
    textElement.textContent = newText;
    editWrapper.classList.add('hidden');
    textElement.classList.remove('hidden');

    showToast('Comentario actualizado', 'success');
  } catch (error) {
    console.error('Error updating comment:', error);

    // Restore UI state
    saveText.classList.remove('hidden');
    saveLoading.classList.add('hidden');
    saveBtn.disabled = false;
    editInput.disabled = false;

    // Handle specific errors
    if (error.code === 'permission-denied') {
      showToast('No tienes permisos para editar este comentario', 'error');
    } else if (error.code === 'not-found') {
      showToast('El comentario no existe', 'error');
    } else {
      showToast('Error al actualizar comentario', 'error', { detail: kxFriendlyError(error) });
    }
  }
}

// Delete inline comment
async function deleteInlineComment(postId, commentId, container, commentAuthorId, postAuthorId) {
  if (!currentUser) {
    showToast('Inicia sesión para eliminar comentarios', 'info');
    return;
  }

  const currentUserId = currentUser.uid;

  // Verificar permisos antes de intentar eliminar
  const isCommentAuthor = commentAuthorId && currentUserId === commentAuthorId;
  const isPostAuthor = postAuthorId && currentUserId === postAuthorId;
  const hasPermission = isCommentAuthor || isPostAuthor;

  if (!hasPermission) {
    showToast('No tienes permisos para eliminar este comentario', 'error');
    console.error('Permission denied: User does not have permission to delete this comment');
    return;
  }

  try {
    // Obtener el comentario antes de eliminarlo para verificar que existe
    const commentDoc = await db.collection('posts').doc(postId).collection('comments').doc(commentId).get();

    if (!commentDoc.exists) {
      showToast('El comentario no existe', 'error');
      return;
    }

    // Verificar permisos nuevamente con los datos del documento
    const commentData = commentDoc.data();
    const actualCommentAuthorId = commentData?.userId;
    const isActualCommentAuthor = actualCommentAuthorId && currentUserId === actualCommentAuthorId;
    const isActualPostAuthor = postAuthorId && currentUserId === postAuthorId;

    if (!isActualCommentAuthor && !isActualPostAuthor) {
      showToast('No tienes permisos para eliminar este comentario', 'error');
      console.error('Permission denied: User does not have permission to delete this comment');
      return;
    }

    // Eliminar comentario de la subcolecciÃ³n
    await db.collection('posts').doc(postId).collection('comments').doc(commentId).delete();

    // OperaciÃ³n atÃ³mica: Decrementar commentsCount en el documento padre del post
    // Usar increment(-1) para asegurar que el contador se mantenga sincronizado
    await db.collection('posts').doc(postId).update({
      commentsCount: firebase.firestore.FieldValue.increment(-1)
    });

    // Recargar comentarios
    await loadInlineComments(postId, container);

    // Actualizar contador en el botÃ³n
    const card = container.closest('.feed-card');
    const countSpan = card?.querySelector('[data-action="comment"] .feed-action-count');
    if (countSpan) {
      // Obtener documento actualizado del post para leer el nuevo commentsCount
      const postDoc = await db.collection('posts').doc(postId).get();
      const updatedCommentsCount = postDoc.data()?.commentsCount || 0;
      countSpan.textContent = updatedCommentsCount > 0 ? formatCount(updatedCommentsCount) : '';
    }

    showToast('Comentario eliminado', 'success');
  } catch (error) {
    console.error('Error deleting comment:', error);

    // Gestionar errores especÃ­ficos
    if (error.code === 'permission-denied') {
      showToast('No tienes permisos para eliminar este comentario', 'error');
    } else if (error.code === 'not-found') {
      showToast('El comentario no existe', 'error');
    } else {
      showToast('Error al eliminar comentario', 'error', { detail: kxFriendlyError(error) });
    }
  }
}

// ================== POST EDIT/DELETE FUNCTIONS ==================

// Handle edit post - show edit form
function handleEditPost(postId, container) {
  if (!currentUser) {
    showToast('Inicia sesión para editar publicaciones', 'info');
    return;
  }

  const card = container.querySelector(`.feed-card[data-post-id="${postId}"]`);
  if (!card) return;

  const textBody = card.querySelector(`.feed-text-body[data-post-id="${postId}"]`);
  const editWrapper = card.querySelector(`.feed-text-edit-wrapper[data-post-id="${postId}"]`);
  const editInput = editWrapper?.querySelector('.feed-text-edit-input');

  if (!textBody || !editWrapper || !editInput) {
    showToast('No se puede editar esta publicaciÃ³n', 'error');
    return;
  }

  // Obtener el texto actual (sin los <br> convertidos)
  const currentText = textBody.textContent || textBody.innerText || '';

  // Mostrar formulario de ediciÃ³n
  textBody.classList.add('hidden');
  editWrapper.classList.remove('hidden');
  editInput.value = currentText;
  editInput.focus();
  editInput.setSelectionRange(editInput.value.length, editInput.value.length);
}

// Cancel edit post - hide edit form
function cancelEditPost(postId, container) {
  const card = container.querySelector(`.feed-card[data-post-id="${postId}"]`);
  if (!card) return;

  const textBody = card.querySelector(`.feed-text-body[data-post-id="${postId}"]`);
  const editWrapper = card.querySelector(`.feed-text-edit-wrapper[data-post-id="${postId}"]`);
  const editInput = editWrapper?.querySelector('.feed-text-edit-input');

  if (!textBody || !editWrapper || !editInput) return;

  // Restaurar valor original
  const originalText = textBody.textContent || textBody.innerText || '';
  editInput.value = originalText;

  // Ocultar formulario de ediciÃ³n
  editWrapper.classList.add('hidden');
  textBody.classList.remove('hidden');
}

// Handle update post - save changes to Firestore
async function handleUpdatePost(postId, container) {
  if (!currentUser) {
    showToast('Inicia sesión para editar publicaciones', 'info');
    return;
  }

  const card = container.querySelector(`.feed-card[data-post-id="${postId}"]`);
  if (!card) return;

  const editWrapper = card.querySelector(`.feed-text-edit-wrapper[data-post-id="${postId}"]`);
  const editInput = editWrapper?.querySelector('.feed-text-edit-input');
  const saveBtn = editWrapper?.querySelector('.feed-text-edit-save');
  const saveText = saveBtn?.querySelector('.feed-text-edit-save-text');
  const saveLoading = saveBtn?.querySelector('.feed-text-edit-save-loading');
  const textBody = card.querySelector(`.feed-text-body[data-post-id="${postId}"]`);

  if (!editInput || !saveBtn || !textBody) return;

  const newText = editInput.value.trim();

  if (!newText) {
    showToast('La publicación no puede estar vací­a', 'error');
    return;
  }

  // Verificar permisos antes de actualizar
  try {
    const postDoc = await db.collection('posts').doc(postId).get();

    if (!postDoc.exists) {
      showToast('La publicación no existe', 'error');
      return;
    }

    const postData = postDoc.data();
    const postAuthorId = postData?.userId;

    if (!postAuthorId || currentUser.uid !== postAuthorId) {
      showToast('No tienes permisos para editar esta publicación', 'error');
      return;
    }

    // Show loading state
    saveBtn.disabled = true;
    saveText.classList.add('hidden');
    saveLoading.classList.remove('hidden');
    editInput.disabled = true;

    // Update post in Firestore
    await db.collection('posts').doc(postId).update({
      content: newText,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    // Update UI - hide edit form, show updated text
    textBody.innerHTML = newText.replace(/\n/g, '<br>');
    editWrapper.classList.add('hidden');
    textBody.classList.remove('hidden');

    showToast('Publicación actualizada', 'success');
  } catch (error) {
    console.error('Error updating post:', error);

    // Restore UI state
    saveText.classList.remove('hidden');
    saveLoading.classList.add('hidden');
    saveBtn.disabled = false;
    editInput.disabled = false;

    // Handle specific errors
    if (error.code === 'permission-denied') {
      showToast('No tienes permisos para editar esta publicación', 'error');
    } else if (error.code === 'not-found') {
      showToast('La publicación no existe', 'error');
    } else {
      showToast('Error al actualizar publicación', 'error', { detail: kxFriendlyError(error) });
    }
  }
}

// Handle delete post - delete from Firestore
async function handleDeletePost(postId, container) {
  if (!currentUser) {
    showToast('Inicia sesión para eliminar publicaciones', 'info');
    return;
  }

  // ConfirmaciÃ³n antes de eliminar
  const confirmed = await showConfirm(
    '¿Estás seguro de que quieres eliminar esta publicación? Esta acción no se puede deshacer.',
    'Eliminar Publicación'
  );

  if (!confirmed) return;

  try {
    // Verificar permisos antes de eliminar
    const postDoc = await db.collection('posts').doc(postId).get();

    if (!postDoc.exists) {
      showToast('La publicaciÃ³n no existe', 'error');
      return;
    }

    const postData = postDoc.data();
    const postAuthorId = postData?.userId;

    if (!postAuthorId || currentUser.uid !== postAuthorId) {
      showToast('No tienes permisos para eliminar esta publicaciÃ³n', 'error');
      return;
    }

    // Eliminar el post de Firestore
    await db.collection('posts').doc(postId).delete();

    // Eliminar el post de la UI
    const card = container.querySelector(`.feed-card[data-post-id="${postId}"]`);
    if (card) {
      // AnimaciÃ³n de salida
      card.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
      card.style.opacity = '0';
      card.style.transform = 'translateY(-10px)';

      setTimeout(() => {
        card.remove();

        // Si no quedan posts, mostrar estado vacÃ­o
        const remainingPosts = container.querySelectorAll('.feed-card');
        if (remainingPosts.length === 0) {
          showEmptyFeedState(container);
        }
      }, 300);
    }

    showToast('Publicación eliminada', 'success');
  } catch (error) {
    console.error('Error deleting post:', error);

    // Handle specific errors
    if (error.code === 'permission-denied') {
      showToast('No tienes permisos para eliminar esta publicación', 'error');
    } else if (error.code === 'not-found') {
      showToast('La publicación no existe', 'error');
    } else {
      showToast('Error al eliminar publicación', 'error', { detail: kxFriendlyError(error) });
    }
  }
}

// Handle inline comment form submission
async function handleInlineCommentSubmit(postId, form) {
  if (!currentUser) {
    showToast('Inicia sesión para comentar', 'info');
    return;
  }

  const input = form.querySelector('.feed-comment-input');
  const text = input?.value?.trim();

  if (!text) return;

  try {
    // Disable form while submitting
    input.disabled = true;

    // Extract mentions from autocomplete
    const mentionAC = input?._mentionAutocomplete;
    const mentions = mentionAC ? mentionAC.getMentions() : [];
    const validMentions = extractMentionsFromText(text, mentions);

    // Build comment data
    const commentData = {
      userId: currentUser.uid,
      userName: currentUser.displayName || 'Usuario',
      userPhoto: currentUser.photoURL || '',
      text: text,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    if (validMentions.length > 0) {
      commentData.mentions = validMentions;
    }

    // Add comment to Firestore subcollection
    const newCommentDoc = await db.collection('posts').doc(postId).collection('comments').add(commentData);

    // Atomically increment commentsCount in the parent post document
    await db.collection('posts').doc(postId).update({
      commentsCount: firebase.firestore.FieldValue.increment(1)
    });

    // Clear input and mentions
    input.value = '';
    input.disabled = false;
    if (mentionAC) mentionAC.clearMentions();

    // Reload comments
    const commentsList = form.parentElement.querySelector('.feed-comments-list');
    if (commentsList) {
      await loadInlineComments(postId, commentsList);
    }

    // Get updated post document (for both count update and notification)
    const postDoc = await db.collection('posts').doc(postId).get();
    const postData = postDoc.data();

    // Update comment count in button - read from updated post data
    const card = form.closest('.feed-card');
    const countSpan = card?.querySelector('[data-action="comment"] .feed-action-count');
    if (countSpan) {
      const updatedCommentsCount = postData?.commentsCount || 0;
      countSpan.textContent = updatedCommentsCount > 0 ? formatCount(updatedCommentsCount) : '';
    }

    // Create notification for post author
    if (postData && postData.userId && postData.userId !== currentUser.uid) {
      createNotification(postData.userId, 'comment', `comentó en tu publicación`, { postId, commentId: newCommentDoc.id });
    }

    // Send mention notifications
    if (validMentions.length > 0) {
      sendMentionNotifications(validMentions, { type: 'comment', postId });
    }

  } catch (error) {
    console.error('Error posting comment:', error);
    input.disabled = false;
    showToast('Error al enviar comentario', 'error');
  }
}

// Handle bookmark/save button click - Uses savedPosts array in users/{uid}
// Colors: Active = Amber (#f59e0b), Inactive = outline (no fill)
async function handleFeedBookmark(postId, button) {
  if (!currentUser) {
    showToast('Inicia sesión para guardar', 'info');
    return;
  }

  const isBookmarked = button.classList.contains('bookmarked');
  const svg = button.querySelector('svg');

  // Optimistic UI Update - Immediately update before DB call
  button.classList.toggle('bookmarked');
  if (svg) {
    if (!isBookmarked) {
      // Activating: Amber filled
      svg.setAttribute('fill', '#f59e0b');
      svg.setAttribute('stroke', '#f59e0b');
    } else {
      // Deactivating: Outline only (no fill)
      svg.setAttribute('fill', 'none');
      svg.setAttribute('stroke', 'currentColor');
    }
  }

  try {
    const userRef = db.collection('users').doc(currentUser.uid);

    // Update savedPosts array using arrayUnion/arrayRemove
    if (isBookmarked) {
      // Remove from saved
      await userRef.update({
        savedPosts: firebase.firestore.FieldValue.arrayRemove(postId)
      });
    } else {
      // Add to saved
      await userRef.update({
        savedPosts: firebase.firestore.FieldValue.arrayUnion(postId)
      });
    }
  } catch (error) {
    console.error('Error toggling bookmark:', error);
    // Revert optimistic update on error
    button.classList.toggle('bookmarked');
    if (svg) {
      if (isBookmarked) {
        svg.setAttribute('fill', '#f59e0b');
        svg.setAttribute('stroke', '#f59e0b');
      } else {
        svg.setAttribute('fill', 'none');
        svg.setAttribute('stroke', 'currentColor');
      }
    }
    showToast('No se ha podido guardar la publicación', 'error', { detail: kxFriendlyError(error) });
  }
}

// Handle share button click - navigator.share for mobile, clipboard fallback for desktop
async function handleFeedShare(postId) {
  const shareUrl = `${window.location.origin}${window.location.pathname}?post=${postId}`;

  try {
    // Get post data for share text
    const postDoc = await db.collection('posts').doc(postId).get();
    const postData = postDoc.exists ? postDoc.data() : {};

    const shareText = postData?.content
      ? `${postData.userName || 'Usuario'}: ${postData.content.substring(0, 100)}${postData.content.length > 100 ? '...' : ''}`
      : `Mira esta publicación de ${postData?.userName || 'Usuario'} en Climbmaps`;

    const shareData = {
      title: 'Climbmaps',
      text: shareText,
      url: shareUrl
    };

    // Try native share API (mobile)
    if (navigator.share && navigator.canShare && navigator.canShare(shareData)) {
      try {
        await navigator.share(shareData);
        return; // Success, exit
      } catch (err) {
        if (err.name === 'AbortError') {
          return; // User cancelled, don't show error
        }
        // Fall through to clipboard fallback
      }
    }

    // Fallback: Copy URL to clipboard (desktop)
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(shareUrl);
      showToast('Enlace copiado al portapapeles', 'info');
    } else {
      // Legacy fallback for older browsers
      const textArea = document.createElement('textarea');
      textArea.value = shareUrl;
      textArea.style.position = 'fixed';
      textArea.style.left = '-9999px';
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      showToast('Enlace copiado al portapapeles', 'info');
    }
  } catch (error) {
    console.error('Error sharing post:', error);
    showToast('Error al compartir', 'error');
  }
}

// Handle report post - Basic implementation (pending backend)
async function handleReportPost(postId) {
  if (!currentUser) {
    showToast('Inicia sesión para denunciar', 'info');
    return;
  }

  try {
    // For now, just show a confirmation and log
    const confirmed = await showConfirm(
      '¿Estás seguro de que quieres denunciar esta publicación?',
      'Denunciar Publicación'
    );

    if (confirmed) {
      // TODO: Implement backend logic to save report
      console.log('Report submitted for post:', postId, 'by user:', currentUser.uid);

      // Show success message
      showToast('Publicación denunciada. Revisaremos el contenido.', 'success');

      // In the future, this would call:
      // await db.collection('reports').add({
      //   postId: postId,
      //   reportedBy: currentUser.uid,
      //   createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      //   status: 'pending'
      // });
    }
  } catch (error) {
    console.error('Error reporting post:', error);
    showToast('Error al denunciar la publicación', 'error');
  }
}

// Helper function to format counts (reused from renderPostCard)
function formatCount(num) {
  if (num >= 1000000) return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  return num > 0 ? num.toString() : '';
}

// ================== OPTIMIZACIÓN DE IMÁGENES AL SUBIR ==================
// Las fotos del móvil pesan 3–5 MB y se mostraban a ~360 px. Antes de subirlas se reducen
// (lado largo máx. 1600 px; 640 px para fotos de perfil) y se recodifican; además se suben con
// Cache-Control de un año (los nombres llevan marca de tiempo, así que nunca cambian) para que
// el navegador no las vuelva a descargar. Si algo falla se sube el archivo original sin tocar.
const KX_IMAGE_CACHE_CONTROL = 'public,max-age=31536000,immutable';

async function kxLoadImageSource(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      // 'from-image' aplica la orientación EXIF (las fotos de móvil suelen venir giradas)
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { src: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close && bmp.close() };
    } catch (_) { /* navegador sin opciones: se usa <img> */ }
  }
  const url = URL.createObjectURL(file);
  const img = new Image();
  await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = url; });
  return { src: img, width: img.naturalWidth, height: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
}

async function kxPrepareImageForUpload(file, { maxSide = 1600, quality = 0.82, lightBytes = 600 * 1024 } = {}) {
  try {
    // Solo JPEG, PNG, WebP y HEIC/HEIF; GIF (animados), SVG y otros se suben tal cual
    if (!(file instanceof Blob) || !/^image\/(jpe?g|png|webp|heic|heif)$/i.test(file.type || '')) return file;

    const source = await kxLoadImageSource(file);
    try {
      const scale = Math.min(1, maxSide / Math.max(source.width, source.height));
      if (scale === 1 && file.size <= lightBytes) return file; // ya es ligera

      const width = Math.max(1, Math.round(source.width * scale));
      const height = Math.max(1, Math.round(source.height * scale));
      const isPng = /png/i.test(file.type);
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return file;
      if (!isPng) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, width, height); } // sin fondo negro al aplanar transparencias
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(source.src, 0, 0, width, height);

      const outType = isPng ? 'image/png' : 'image/jpeg';
      const blob = await new Promise(resolve => canvas.toBlob(resolve, outType, quality));
      canvas.width = canvas.height = 0; // libera memoria (iOS limita los lienzos vivos)
      if (!blob || blob.size >= file.size) return file; // nunca se sube algo más pesado que el original

      const base = (file.name || 'foto').replace(/\.[^.]+$/, '');
      return new File([blob], `${base}.${isPng ? 'png' : 'jpg'}`, { type: outType, lastModified: Date.now() });
    } finally {
      source.close();
    }
  } catch (error) {
    console.warn('No se pudo optimizar la imagen; se sube el original:', error);
    return file;
  }
}

// Subida a Storage con tipo y caché correctos (v8: ref.put(data, metadata))
function kxStoragePut(ref, file) {
  return ref.put(file, { contentType: file.type || undefined, cacheControl: KX_IMAGE_CACHE_CONTROL });
}

// ================== VÍDEOS EN PUBLICACIONES ==================
const KX_MAX_POST_VIDEOS = 3;
const KX_VIDEO_MAX_BYTES = 300 * 1024 * 1024;
const KX_VIDEO_MIN_COMPRESS_BYTES = 8 * 1024 * 1024; // por debajo no merece la pena recodificar
const KX_VIDEO_MAX_COMPRESS_SECONDS = 180;           // se recodifica en tiempo real: más largo se sube tal cual
const KX_VIDEO_MAX_SIDE = 1280;
const KX_VIDEO_BITRATE = 2500000;

// Vídeos de una publicación: `videos` (varios) o `video` (publicaciones con uno solo)
function kxPostVideos(post) {
  const list = Array.isArray(post?.videos) ? post.videos : (post?.video ? [post.video] : []);
  return list.filter(Boolean);
}

// Fotos y vídeos de una publicación en su orden: `media` si existe; si no, fotos y luego vídeos
function kxPostMedia(post) {
  if (Array.isArray(post?.media) && post.media.length > 0) {
    return post.media.filter(m => m && m.url && (m.type === 'photo' || m.type === 'video'));
  }
  const photos = post?.photos || (post?.image ? [post.image] : []);
  return [...photos.map(url => ({ type: 'photo', url })), ...kxPostVideos(post).map(url => ({ type: 'video', url }))];
}

// HTML de fotos y vídeos en un único collage, en el orden de la publicación.
// `modal` = publicación abierta (muestra todo); si no, se ven 4 casillas como máximo.
// Cada casilla lleva su posición entre todos los elementos: el visor se abre ahí y se desliza por todos.
function kxMediaHTML(items, { modal = false, tag = '' } = {}) {
  if (!items.length) return '';
  const wrapClass = modal ? 'feed-media-wrapper feed-media-modal' : 'feed-media-wrapper';
  const tiles = items.map((item, index) => ({ video: item.type === 'video', url: item.url, poster: item.poster, index }));
  const hasVideo = tiles.some(t => t.video);
  const imgAttrs = (t) => modal
    ? `class="feed-image feed-image-clickable" data-lightbox-src="${t.url}" data-lightbox-index="${t.index}"`
    : `class="feed-image feed-image-clickable" data-lightbox-src="${t.url}" data-lightbox-index="${t.index}" loading="lazy" decoding="async"`;
  const tileHTML = (t) => t.video
    ? kxVideoTileHTML(t.url, t.index, t.poster)
    : `<img src="${t.url}" alt="Foto de la publicación" ${imgAttrs(t)}>`;

  if (tiles.length === 1 && !hasVideo) {
    return `
        <div class="${wrapClass}">
          <div class="feed-image-container">
            ${tileHTML(tiles[0])}
            ${tag}
          </div>
        </div>`;
  }
  const visible = modal ? tiles : tiles.slice(0, 4);
  const hidden = tiles.length - visible.length;
  const gridClass = modal ? 'grid-modal' : `grid-${visible.length}`;
  return `
        <div class="${wrapClass}">
          <div class="feed-images-grid ${gridClass}">
            ${visible.map(tileHTML).join('')}
          </div>
          ${tag}
          ${hidden > 0 ? `<span class="feed-photos-more" aria-label="${hidden} más">+${hidden}</span>` : ''}
        </div>`;
}

// Casilla de vídeo del collage: primer fotograma + botón de reproducir. Al pulsarla se abre el visor.
// Fotograma inicial del vídeo como JPEG ligero: se sube como portada para que el feed lo pinte al instante
// sin descargar el vídeo. Devuelve null si el navegador no puede decodificarlo.
async function kxVideoPosterFromFile(file) {
  const objUrl = URL.createObjectURL(file);
  try {
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    v.src = objUrl;
    await new Promise((resolve, reject) => { v.onloadeddata = resolve; v.onerror = reject; setTimeout(reject, 8000); });
    const t = Math.min(0.1, (v.duration || 0) / 2);
    if (t > 0) {
      await new Promise((resolve) => { v.onseeked = resolve; v.currentTime = t; setTimeout(resolve, 3000); });
    }
    if (!v.videoWidth || !v.videoHeight) return null;
    const k = Math.min(1, 960 / Math.max(v.videoWidth, v.videoHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(2, Math.round(v.videoWidth * k));
    canvas.height = Math.max(2, Math.round(v.videoHeight * k));
    canvas.getContext('2d').drawImage(v, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.8));
    return blob ? new File([blob], 'portada.jpg', { type: 'image/jpeg' }) : null;
  } catch (_) {
    return null;
  } finally {
    URL.revokeObjectURL(objUrl);
  }
}

function kxVideoTileHTML(url, index, poster) {
  const src = escapeHtmlMention(url);
  // Con portada elegida se ve esa imagen; si no, el primer fotograma del propio vídeo
  const cover = poster
    ? `<img class="feed-video-poster" src="${escapeHtmlMention(poster)}" alt="" loading="lazy" decoding="async" draggable="false">`
    : `<video src="${src}#t=0.001" muted playsinline preload="metadata" tabindex="-1" aria-hidden="true"></video>`;
  return `<button type="button" class="feed-video-tile" data-video-src="${src}" data-lightbox-index="${index}" aria-label="Reproducir vídeo">
              ${cover}
              <span class="feed-video-play" aria-hidden="true"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg></span>
            </button>`;
}

// Los vídeos del collage abren el visor en su posición; desde ahí se desliza también por las fotos
function kxBindVideoTiles(root) {
  root.querySelectorAll('.feed-video-tile').forEach(tile => {
    tile.addEventListener('click', (e) => {
      e.stopPropagation();
      const url = tile.dataset.videoSrc;
      const items = tile.closest('.feed-card')?._lightboxItems || root._lightboxItems || [{ type: 'video', url }];
      const index = Number(tile.dataset.lightboxIndex);
      openImageLightbox(url, items, Number.isInteger(index) ? index : undefined);
    });
  });
}

// MP4 con H.264: es lo que reproducen todos los dispositivos. Sin soporte, no se recodifica
function kxVideoRecorderMime() {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return null;
  const candidates = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4;codecs=avc1'];
  return candidates.find(t => MediaRecorder.isTypeSupported(t)) || null;
}

// Reduce el vídeo a como máximo 720p/1280 px y ~2,5 Mbps. Se graba reproduciéndolo, así que dura
// lo que dura el vídeo. Ante cualquier fallo, límite o poco ahorro devuelve el archivo original.
// Con `opts.trim` ({ start, end } en segundos) graba solo ese tramo y no devuelve nunca el original:
// si no puede recortar lanza un error (publicar el vídeo entero sería peor que avisar).
// `opts.signal` permite cancelar.
async function kxPrepareVideoForUpload(file, onProgress, opts = {}) {
  const trim = opts.trim || null;
  const mime = kxVideoRecorderMime();
  if (trim && (!file || !mime)) throw new Error('Este navegador no puede recortar vídeos');
  if (!file || !mime || (!trim && file.size < KX_VIDEO_MIN_COMPRESS_BYTES)) return file;
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  let audioCtx = null;
  let recorder = null;
  let timer = null;
  const cleanup = () => {
    clearInterval(timer);
    try { video.pause(); } catch (_) { /* ya detenido */ }
    try { recorder?.stream?.getTracks().forEach(t => t.stop()); } catch (_) { /* sin pistas */ }
    try { audioCtx?.close(); } catch (_) { /* ya cerrado */ }
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  };
  try {
    video.src = url;
    video.playsInline = true;
    video.preload = 'auto';
    await new Promise((resolve, reject) => {
      video.onloadedmetadata = resolve;
      video.onerror = () => reject(new Error('No se pudo leer el vídeo'));
      setTimeout(() => reject(new Error('Tiempo agotado leyendo el vídeo')), 10000);
    });
    const total = video.duration;
    const from = trim ? Math.max(0, trim.start) : 0;
    const to = trim ? Math.min(trim.end, total) : total;
    const duration = to - from; // lo que se graba
    const bail = (reason) => { if (trim) throw new Error(reason); return file; };
    if (!Number.isFinite(total) || !(duration > 0) || duration > KX_VIDEO_MAX_COMPRESS_SECONDS) return bail('Tramo no válido');
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) return bail('No se pudo leer el vídeo');
    const scale = Math.min(1, KX_VIDEO_MAX_SIDE / Math.max(w, h));
    const bitrate = (file.size * 8) / duration;
    if (!trim && scale === 1 && bitrate < KX_VIDEO_BITRATE * 1.4) return file; // ya es ligero
    const cw = Math.max(2, Math.round((w * scale) / 2) * 2);
    const ch = Math.max(2, Math.round((h * scale) / 2) * 2);
    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d');
    const stream = canvas.captureStream(30);
    // El audio pasa por WebAudio: funciona también donde video.captureStream no existe (Safari)
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) {
      audioCtx = opts.audioCtx || new AC(); // con recorte llega ya creado y activado dentro del toque del usuario
      const dest = audioCtx.createMediaStreamDestination();
      audioCtx.createMediaElementSource(video).connect(dest);
      dest.stream.getAudioTracks().forEach(t => stream.addTrack(t));
      // Sin gesto del usuario el navegador deja el audio en pausa y el vídeo saldría mudo: se sube el original
      if (audioCtx.state !== 'running') {
        await Promise.race([audioCtx.resume().catch(() => {}), new Promise(r => setTimeout(r, 600))]);
        if (audioCtx.state !== 'running') return bail('Audio no disponible');
      }
    }
    recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: KX_VIDEO_BITRATE, audioBitsPerSecond: 128000 });
    const chunks = [];
    recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    const stopRecording = () => { try { recorder.stop(); } catch (_) { /* ya detenido */ } };
    const finished = new Promise((resolve, reject) => {
      recorder.onstop = resolve;
      recorder.onerror = () => reject(new Error('Error al grabar el vídeo'));
      video.onended = stopRecording;
      // Red de seguridad: si la pestaña se pausa o el vídeo se atasca, se sube el original
      setTimeout(() => reject(new Error('Tiempo agotado optimizando el vídeo')), duration * 1500 + 15000);
      opts.signal?.addEventListener('abort', () => reject(new DOMException('Cancelado', 'AbortError')));
    });
    if (trim && from > 0) {
      // Se coloca el vídeo al inicio del tramo antes de grabar
      await new Promise((resolve) => {
        video.addEventListener('seeked', resolve, { once: true });
        video.currentTime = from;
        setTimeout(resolve, 3000);
      });
    }
    recorder.start(1000);
    await video.play();
    timer = setInterval(() => {
      ctx.drawImage(video, 0, 0, cw, ch);
      if (onProgress) onProgress(Math.min(99, Math.round(((video.currentTime - from) / duration) * 100)));
      if (trim && video.currentTime >= to - 0.03) stopRecording();
    }, 1000 / 30);
    await finished;
    clearInterval(timer);
    const blob = new Blob(chunks, { type: 'video/mp4' });
    if (blob.size === 0 || (!trim && blob.size > file.size * 0.75)) return bail('No se pudo grabar el tramo');
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.mp4', { type: 'video/mp4' });
  } catch (e) {
    if (trim) throw e;
    console.warn('No se pudo optimizar el vídeo, se sube el original:', e);
    return file;
  } finally {
    cleanup();
  }
}

// ================== AVATAR HELPER FUNCTIONS ==================
// Generate fallback avatar URL based on name
function generateAvatarFallback(name, size = 200) {
  const encodedName = encodeURIComponent(name || 'Usuario');
  return `https://ui-avatars.com/api/?name=${encodedName}&background=153E35&color=fff&size=${size}`;
}

// Set avatar with error handling and fallback
function setAvatarWithFallback(imgElement, photoURL, userName, size = 200) {
  if (!imgElement) return;

  // Default fallback
  const fallback = generateAvatarFallback(userName, size);

  // Set referrerPolicy to avoid CORS issues with Google/Facebook images
  imgElement.referrerPolicy = 'no-referrer';

  // Cada llamada invalida las anteriores sobre este <img> (p. ej. #profile-avatar se
  // reutiliza para todos los perfiles): sin esto, cargas y temporizadores viejos
  // pisaban la foto del perfil que se acaba de abrir con iniciales de otro usuario.
  const reqId = cancelAvatarLoad(imgElement);
  const isCurrent = () => imgElement._avatarReqId === reqId;

  const useFallback = () => {
    if (!isCurrent()) return;
    clearTimeout(imgElement._avatarTimer);
    imgElement.onerror = null; // Prevent infinite loop
    imgElement.src = fallback;
    imgElement.style.opacity = '1';
  };

  // If no photoURL, use fallback immediately
  if (!photoURL || photoURL.trim() === '') {
    imgElement.style.opacity = '1';
    useFallback();
    return;
  }

  // Set loading state
  imgElement.style.opacity = '0.5';
  imgElement.style.transition = 'opacity 0.3s ease';

  // Create new image to test if URL is valid
  const testImg = new Image();
  testImg.referrerPolicy = 'no-referrer';

  testImg.onload = () => {
    if (!isCurrent()) return;
    clearTimeout(imgElement._avatarTimer);
    imgElement.onerror = useFallback; // Keep error handler for future errors
    imgElement.src = photoURL;
    imgElement.style.opacity = '1';
  };

  testImg.onerror = useFallback;

  // Timeout fallback (if image takes too long to load)
  imgElement._avatarTimer = setTimeout(useFallback, 5000);

  // Start loading test image
  testImg.src = photoURL;
}

// Invalida cualquier carga/temporizador de avatar pendiente sobre este <img>
function cancelAvatarLoad(imgElement) {
  clearTimeout(imgElement._avatarTimer);
  imgElement._avatarReqId = (imgElement._avatarReqId || 0) + 1;
  return imgElement._avatarReqId;
}

// Update all avatar instances for current user
function updateAllUserAvatars(photoURL, userName) {
  const selectors = [
    '#profile-avatar',
    '.nav-avatar-img',
    '#user-photo',
    '#user-photo-dropdown',
    '#create-post-avatar',
    '#pp-avatar'
  ];

  selectors.forEach(selector => {
    const img = document.querySelector(selector);
    if (img) {
      setAvatarWithFallback(img, photoURL, userName);
    }
  });
}

// Format time ago helper
function formatTimeAgo(date) {
  const now = new Date();
  const diff = now - date;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return 'Ahora';
  if (minutes < 60) return `Hace ${minutes}m`;
  if (hours < 24) return `Hace ${hours}h`;
  if (days < 7) return `Hace ${days}d`;
  return date.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
}

// ================== VIEW POST MODAL ==================
async function openPostModal(postId, targetCommentId, targetReplyId) {
  const modal = document.getElementById('view-post-modal');
  const body = document.getElementById('view-post-body');

  if (!modal || !body) return;

  // Show loading
  body.innerHTML = '<div class="feed-state"><p>Cargando publicación...</p></div>';
  modal.classList.remove('hidden');

  try {
    // Get post from Firebase
    const postDoc = await db.collection('posts').doc(postId).get();

    if (!postDoc.exists) {
      body.innerHTML = '<div class="feed-state feed-state-error"><p>Publicación no encontrada</p></div>';
      return;
    }

    const postData = postDoc.data();
    const post = {
      id: postDoc.id,
      ...postData,
      photos: postData.photos || (postData.photo ? [postData.photo] : []),
      time: postData.createdAt ? formatTimeAgo(postData.createdAt.toDate()) : 'Ahora'
    };

    // Render post in modal
    renderPostInModal(post, body);

    // Load comments section inside modal
    await loadModalComments(postId, body, targetCommentId, targetReplyId);

  } catch (error) {
    console.error('Error loading post:', error);
    body.innerHTML = '<div class="feed-state feed-state-error"><p>Error al cargar la publicación</p></div>';
  }
}

function renderPostInModal(post, container) {
  container.innerHTML = '';

  // Check if current user is the author
  const isAuthor = currentUser && post.userId === currentUser.uid;
  const postId = post.id;

  const userName = post.userName || post.user || 'Usuario';
  const userPhoto = post.userPhoto || post.avatar || '';

  // Extract location name
  let locationName = '';
  if (post.location) {
    if (typeof post.location === 'object' && post.location.name) {
      locationName = post.location.name;
    } else if (typeof post.location === 'string') {
      locationName = post.location;
    }
  } else if (post.locationName) {
    locationName = post.locationName;
  }

  // Header - Matches feed card layout: avatar, user+time, location, three-dot menu
  const headerHTML = `
    <div class="feed-card-header">
      <img src="${userPhoto || generateAvatarFallback(userName, 200)}" alt="${userName}" class="feed-avatar" referrerPolicy="no-referrer" onerror="this.src='${generateAvatarFallback(userName, 200)}'; this.onerror=null;">
      <div class="feed-header-content">
        <div class="feed-header-row">
          <span class="feed-username">${userName}</span>
        </div>
        ${locationName ? `<div class="feed-location-text">${FEED_ICON_PIN}<span>${locationName}</span></div>` : ''}
        <div class="feed-time-row"><span class="feed-time">${post.time || 'Ahora'}</span></div>
      </div>
      ${currentUser ? `
        <div class="feed-post-menu-wrapper">
          <button class="feed-post-menu-btn modal-post-menu-btn"
                  data-post-id="${postId}"
                  data-is-owner="${isAuthor}"
                  title="Opciones">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="1"></circle>
              <circle cx="19" cy="12" r="1"></circle>
              <circle cx="5" cy="12" r="1"></circle>
            </svg>
          </button>
          <div class="feed-post-menu-dropdown hidden" data-post-id="${postId}">
            ${isAuthor ? `
              <button class="feed-post-menu-item modal-menu-action" data-action="edit" data-post-id="${postId}">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                </svg>
                <span>Editar</span>
              </button>
              <button class="feed-post-menu-item feed-post-menu-item-danger modal-menu-action" data-action="delete" data-post-id="${postId}">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
                <span>Borrar</span>
              </button>
            ` : `
              <button class="feed-post-menu-item modal-menu-action" data-action="share" data-post-id="${postId}">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="18" cy="5" r="3"></circle>
                  <circle cx="6" cy="12" r="3"></circle>
                  <circle cx="18" cy="19" r="3"></circle>
                  <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line>
                  <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line>
                </svg>
                <span>Compartir</span>
              </button>
              <button class="feed-post-menu-item feed-post-menu-item-danger modal-menu-action" data-action="report" data-post-id="${postId}">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                  <line x1="12" y1="9" x2="12" y2="13"></line>
                  <line x1="12" y1="17" x2="12.01" y2="17"></line>
                </svg>
                <span>Denunciar</span>
              </button>
            `}
          </div>
        </div>
      ` : ''}
    </div>
  `;

  // Content based on type
  let contentHTML = '';

  const modalMedia = kxPostMedia(post);
  if (modalMedia.length > 0 || post.type === 'photo' || post.type === 'video') {
    const modalPhotoTag = locationName ? `<span class="feed-photo-tag" aria-hidden="true">${FEED_ICON_PIN}<span>${locationName}</span></span>` : '';
    contentHTML = kxMediaHTML(modalMedia, { modal: true, tag: modalPhotoTag });
    // Add text content if exists
    if (post.content) {
      contentHTML += `
        <div class="feed-text-content">
          <p class="feed-text-body">${renderTextWithMentions(post.content, post.mentions)}</p>
        </div>
      `;
    }
  } else if (post.type === 'text' || post.content) {
    contentHTML = `
      <div class="feed-text-content">
        ${post.title ? `<h3 class="feed-text-title">${post.title}</h3>` : ''}
        <p class="feed-text-body">${renderTextWithMentions(post.content || '', post.mentions)}</p>
      </div>
    `;
  }

  // Support both array (new) and number (legacy) format for likes
  const likesArray = post.likes;
  const likesCount = post.likesCount || (Array.isArray(likesArray) ? likesArray.length : (typeof likesArray === 'number' ? likesArray : 0));
  const commentsCount = post.commentsCount || 0;

  const formatCount = (num) => {
    if (num >= 1000000) return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
    return num > 0 ? num.toString() : '';
  };

  const likeColor = post.liked ? '#ef4444' : 'none';
  const likeStroke = post.liked ? '#ef4444' : 'currentColor';

  // Actions bar - matching feed card layout (like + count, comment + count)
  const actionsHTML = `
    <div class="feed-actions-bar modal-actions-bar">
      <button class="feed-action-btn ${post.liked ? 'liked' : ''}" data-action="like" data-post-id="${post.id || ''}" aria-label="Me gusta">
        <svg viewBox="0 0 24 24" fill="${likeColor}" stroke="${likeStroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
        </svg>
        <span class="feed-action-count">${likesCount > 0 ? formatCount(likesCount) : ''}</span>
      </button>
      <button class="feed-action-btn" data-action="comment" data-post-id="${post.id || ''}" aria-label="Comentar">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path>
        </svg>
        <span class="feed-action-count">${commentsCount > 0 ? formatCount(commentsCount) : ''}</span>
      </button>
    </div>
  `;

  container.innerHTML = headerHTML + contentHTML + kxAscentListHTML(kxPostAscents(post)) + actionsHTML;

  // Fotos y vídeos de la publicación ampliada se abren en el visor, en el orden publicado
  container._lightboxItems = modalMedia;
  kxBindVideoTiles(container);
  container.querySelectorAll('.feed-media-modal .feed-image[data-lightbox-index]').forEach(img => {
    img.addEventListener('click', (e) => {
      e.stopPropagation();
      openImageLightbox(img.dataset.lightboxSrc, modalMedia, Number(img.dataset.lightboxIndex));
    });
  });

  // Attach three-dot menu listeners in modal
  const menuBtn = container.querySelector('.modal-post-menu-btn');
  if (menuBtn) {
    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const dropdown = container.querySelector(`.feed-post-menu-dropdown[data-post-id="${postId}"]`);
      if (dropdown) {
        dropdown.classList.toggle('hidden');
        kxPlacePostMenu(dropdown);
      }
    });
  }

  // Attach menu action listeners (edit, delete, share, report)
  container.querySelectorAll('.modal-menu-action').forEach(item => {
    item.addEventListener('click', async (e) => {
      e.stopPropagation();
      const action = item.dataset.action;

      // Close dropdown
      const dropdown = item.closest('.feed-post-menu-dropdown');
      if (dropdown) dropdown.classList.add('hidden');

      if (action === 'edit') {
        openEditPostInComposer(postId, { fromModal: true });
      } else if (action === 'delete') {
        confirmDeletePost(postId, post);
      } else if (action === 'share') {
        await handleFeedShare(postId);
      } else if (action === 'report') {
        await handleReportPost(postId);
      }
    });
  });

  // Close dropdown on outside click
  const closeModalDropdown = (e) => {
    if (!e.target.closest('.feed-post-menu-wrapper')) {
      container.querySelectorAll('.feed-post-menu-dropdown').forEach(dd => {
        dd.classList.add('hidden');
      });
    }
  };
  document.addEventListener('click', closeModalDropdown);

  // Clean up listener when modal is closed
  const modal = document.getElementById('view-post-modal');
  if (modal) {
    const observer = new MutationObserver(() => {
      if (modal.classList.contains('hidden')) {
        document.removeEventListener('click', closeModalDropdown);
        observer.disconnect();
      }
    });
    observer.observe(modal, { attributes: true, attributeFilter: ['class'] });
  }
}

// Load comments inside the post modal with deep-link support
async function loadModalComments(postId, container, targetCommentId, targetReplyId) {
  // Create comments section container
  const commentsSection = document.createElement('div');
  commentsSection.className = 'modal-comments-section';
  commentsSection.innerHTML = `
    <div style="padding: 12px 16px 8px; border-top: 1px solid #f3f4f6;">
      <h4 style="margin: 0; font-size: 15px; font-weight: 600; color: #374151;">Comentarios</h4>
    </div>
    <div class="feed-comments-section" data-post-id="${postId}" style="display: block;">
      <form class="feed-comment-form">
        <img src="${currentUser?.photoURL || generateAvatarFallback(currentUser?.displayName || 'U', 40)}" alt="Tu avatar" class="feed-comment-form-avatar" referrerPolicy="no-referrer" onerror="this.src='${generateAvatarFallback(currentUser?.displayName || 'U', 40)}'; this.onerror=null;">
        <input type="text" class="feed-comment-input" placeholder="Añade un comentario, @ para mencionar" autocomplete="off">
        <button type="submit" class="feed-comment-submit" title="Publicar">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="22" y1="2" x2="11" y2="13"></line>
            <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
          </svg>
        </button>
      </form>
      <div class="feed-comments-list"></div>
    </div>
  `;
  container.appendChild(commentsSection);

  // Setup comment form submission
  const form = commentsSection.querySelector('.feed-comment-form');
  const input = commentsSection.querySelector('.feed-comment-input');
  if (input && !input._mentionAutocomplete) {
    new MentionAutocomplete(input);
  }
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      await handleInlineCommentSubmit(postId, form);
    });
  }

  // Load comments
  const commentsList = commentsSection.querySelector('.feed-comments-list');
  if (commentsList) {
    await loadInlineComments(postId, commentsList);
    commentsList.dataset.loaded = 'true';
  }

  // Deep-link: position target comment in viewport instantly (no delayed animation)
  if (targetCommentId && commentsList) {
    await scrollToTargetComment(commentsList, targetCommentId, targetReplyId);
  }
}

// Scroll to a specific comment (or reply) inside a comments list, highlight it, and expand replies if needed
async function scrollToTargetComment(commentsList, targetCommentId, targetReplyId) {
  const commentEl = commentsList.querySelector(`.feed-comment-item[data-comment-id="${targetCommentId}"]`);
  if (!commentEl) return;

  if (targetReplyId) {
    // Need to expand replies first, then position the specific reply in viewport
    const viewRepliesBtn = commentEl.querySelector('.feed-comment-view-replies');
    const repliesContainer = commentsList.querySelector(`.feed-comment-replies[data-comment-id="${targetCommentId}"]`);

    if (repliesContainer) {
      // Expand replies immediately (thread already visible)
      repliesContainer.classList.remove('hidden');
      if (viewRepliesBtn) {
        viewRepliesBtn.querySelector('svg')?.setAttribute('style', 'transform: rotate(180deg)');
      }

      // Load replies if not loaded yet
      if (!repliesContainer.dataset.loaded) {
        const postId = commentEl.dataset.postId;
        await loadReplies(postId, targetCommentId, repliesContainer);
        repliesContainer.dataset.loaded = 'true';
      }

      // Position reply in viewport instantly
      requestAnimationFrame(() => {
        const replyEl = repliesContainer.querySelector(`.feed-reply-item[data-reply-id="${targetReplyId}"]`);
        if (replyEl) {
          replyEl.scrollIntoView({ behavior: 'instant', block: 'center' });
        } else {
          commentEl.scrollIntoView({ behavior: 'instant', block: 'center' });
        }
      });
    }
  } else {
    // Position comment in viewport instantly
    commentEl.scrollIntoView({ behavior: 'instant', block: 'center' });
  }
}

// Confirm and delete post
async function confirmDeletePost(postId, post) {
  // Use the existing confirm modal
  const confirmModal = document.getElementById('confirm-modal');
  const confirmTitle = document.getElementById('confirm-title');
  const confirmMessage = document.getElementById('confirm-message');
  const confirmCancel = document.getElementById('confirm-cancel');
  const confirmOk = document.getElementById('confirm-ok');

  if (!confirmModal) {
    // If no confirm modal, use browser confirm
    if (confirm('¿Estás seguro de que quieres eliminar esta publicación? Esta acción no se puede deshacer.')) {
      await deletePost(postId, post);
    }
    return;
  }

  confirmTitle.textContent = 'Eliminar publicación';
  confirmMessage.textContent = '¿Estás seguro de que quieres eliminar esta publicación? Esta acción no se puede deshacer.';
  confirmOk.textContent = 'Eliminar';
  confirmModal.classList.remove('hidden');

  // Remove old listeners
  const newConfirmOk = confirmOk.cloneNode(true);
  confirmOk.parentNode.replaceChild(newConfirmOk, confirmOk);

  newConfirmOk.addEventListener('click', async () => {
    confirmModal.classList.add('hidden');
    await deletePost(postId, post);
  });

  confirmCancel.addEventListener('click', () => {
    confirmModal.classList.add('hidden');
  });

  // Close on backdrop
  confirmModal.addEventListener('click', (e) => {
    if (e.target === confirmModal) {
      confirmModal.classList.add('hidden');
    }
  });
}

async function deletePost(postId, post) {
  if (!currentUser) {
    showToast('Debes iniciar sesión para eliminar', 'error');
    return;
  }

  try {
    // Delete photos from Storage if they exist
    if (post.photos && post.photos.length > 0) {
      for (const photoUrl of post.photos) {
        try {
          // Extract path from URL
          const urlParts = photoUrl.split('/');
          const encodedPath = urlParts.slice(urlParts.indexOf('posts')).join('/');
          const decodedPath = decodeURIComponent(encodedPath.split('?')[0]);
          const storageRef = storage.ref(decodedPath);
          await storageRef.delete();
        } catch (error) {
          console.warn('Error deleting photo from storage:', error);
          // Continue even if photo deletion fails
        }
      }
    }

    // Delete videos from Storage if they exist
    for (const videoUrl of kxPostVideos(post)) {
      try {
        const urlParts = videoUrl.split('/');
        const encodedPath = urlParts.slice(urlParts.indexOf('posts')).join('/');
        const decodedPath = decodeURIComponent(encodedPath.split('?')[0]);
        const storageRef = storage.ref(decodedPath);
        await storageRef.delete();
      } catch (error) {
        console.warn('Error deleting video from storage:', error);
        // Continue even if video deletion fails
      }
    }

    // Portadas de vídeo
    for (const m of kxPostMedia(post)) {
      if (!m.poster) continue;
      try {
        const urlParts = m.poster.split('/');
        const encodedPath = urlParts.slice(urlParts.indexOf('posts')).join('/');
        await storage.ref(decodeURIComponent(encodedPath.split('?')[0])).delete();
      } catch (error) {
        console.warn('Error deleting video cover from storage:', error);
      }
    }

    // Delete post from Firestore
    await db.collection('posts').doc(postId).delete();

    showToast('Publicación eliminada', 'success');

    // Close modal
    const viewModal = document.getElementById('view-post-modal');
    if (viewModal) viewModal.classList.add('hidden');

    // Reload profile grid if on profile view
    if (document.getElementById('profile-view') && !document.getElementById('profile-view').classList.contains('hidden')) {
      await renderProfileGrid();
      // Update posts count
      const postsStat = document.getElementById('stat-posts');
      if (postsStat) {
        const count = await getUserPostsCount(currentUser.uid);
        postsStat.textContent = count;
      }
    }

    // Reload feed if on feed view
    if (document.getElementById('feed-view') && !document.getElementById('feed-view').classList.contains('hidden')) {
      await loadFeed();
    }

  } catch (error) {
    console.error('Error deleting post:', error);
    showToast('Error al eliminar la publicación', 'error', { detail: kxFriendlyError(error) });
  }
}

// Menú de la publicación: pequeño y pegado a los tres puntos. Si abajo no cabe (queda tapado por la
// botonera de ventanas o el borde de la pantalla) se abre hacia arriba.
function kxPlacePostMenu(dropdown) {
  dropdown.classList.remove('opens-up');
  if (dropdown.classList.contains('hidden')) return;
  const nav = document.querySelector('.bottom-nav');
  const limit = Math.min(window.innerHeight, nav && getComputedStyle(nav).display !== 'none' ? nav.getBoundingClientRect().top : window.innerHeight) - 8;
  if (dropdown.getBoundingClientRect().bottom > limit) dropdown.classList.add('opens-up');
}

// Enable edit mode for post
function enablePostEditMode(post, container) {
  const postId = post.id;

  // Store original content
  const originalContent = post.content || '';
  const originalPhotos = post.photos || [];
  const originalVideos = kxPostVideos(post);
  const videoPosters = new Map(kxPostMedia(post).filter(m => m.type === 'video' && m.poster).map(m => [m.url, m.poster]));

  // Create edit form
  const editFormHTML = `
    <div class="post-edit-form" style="padding: 20px;">
      <div style="margin-bottom: 16px;">
        <label style="display: block; margin-bottom: 8px; font-weight: 600; color: #111827;">Contenido</label>
        <textarea id="edit-post-content" rows="6" style="width: 100%; padding: 12px; border: 1px solid #e5e7eb; border-radius: 8px; font-size: 15px; font-family: inherit; resize: vertical;" placeholder="Escribe tu publicación...">${originalContent}</textarea>
        <div style="text-align: right; margin-top: 4px; font-size: 13px; color: #6b7280;">
          <span id="edit-char-count">${originalContent.length}</span>/2000
        </div>
      </div>
      
      ${originalPhotos.length > 0 ? `
        <div style="margin-bottom: 16px;">
          <label style="display: block; margin-bottom: 8px; font-weight: 600; color: #111827;">Fotos</label>
          <div id="edit-photos-preview" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(100px, 1fr)); gap: 8px; margin-bottom: 8px;">
            ${originalPhotos.map((photo, index) => `
              <div style="position: relative; aspect-ratio: 1; border-radius: 8px; overflow: hidden;">
                <img src="${photo}" alt="Photo ${index + 1}" style="width: 100%; height: 100%; object-fit: cover;">
                <button type="button" class="remove-photo-btn" data-index="${index}" style="position: absolute; top: 4px; right: 4px; width: 24px; height: 24px; border-radius: 50%; background: rgba(0,0,0,0.6); color: white; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 16px;">x”</button>
              </div>
            `).join('')}
          </div>
          <button type="button" id="add-more-photos-btn" style="padding: 8px 16px; background: #f3f4f6; border: 1px solid #e5e7eb; border-radius: 8px; cursor: pointer; font-size: 14px;">Añadir más fotos</button>
          <input type="file" id="edit-post-photos-input" accept="image/*" multiple style="display: none;">
        </div>
      ` : ''}
      
      ${originalVideos.length > 0 ? `
        <div id="edit-videos-section" style="margin-bottom: 16px;">
          <label style="display: block; margin-bottom: 8px; font-weight: 600; color: #111827;">Vídeos</label>
          ${originalVideos.map((url, index) => `
            <div class="edit-video-item" data-index="${index}" style="position: relative; border-radius: 8px; overflow: hidden; background: #000; margin-bottom: 8px;">
              <video src="${url}" ${videoPosters.get(url) ? `poster="${videoPosters.get(url)}"` : ''} controls style="width: 100%; max-height: 300px; display: block;"></video>
              <button type="button" class="remove-video-btn" data-url="${url}" style="position: absolute; top: 8px; right: 8px; padding: 6px 12px; background: rgba(0,0,0,0.6); color: white; border: none; border-radius: 8px; cursor: pointer; font-size: 14px;">Eliminar vídeo</button>
              <button type="button" class="edit-cover-btn" data-url="${url}" style="position: absolute; top: 8px; left: 8px; padding: 6px 12px; background: rgba(0,0,0,0.6); color: white; border: none; border-radius: 8px; cursor: pointer; font-size: 14px;">Cambiar portada</button>
            </div>
          `).join('')}
        </div>
      ` : ''}
      
      <div style="display: flex; gap: 12px; margin-top: 20px;">
        <button type="button" id="cancel-edit-btn" style="flex: 1; padding: 12px; background: #f3f4f6; border: 1px solid #e5e7eb; border-radius: 8px; cursor: pointer; font-weight: 600; color: #111827;">Cancelar</button>
        <button type="button" id="save-edit-btn" style="flex: 1; padding: 12px; background: #1d9bf0; border: none; border-radius: 8px; cursor: pointer; font-weight: 600; color: white;">Guardar cambios</button>
      </div>
    </div>
  `;

  // Replace content with edit form
  const contentSection = container.querySelector('.feed-text-content, .feed-image-container, .feed-video-container');
  if (contentSection) {
    contentSection.outerHTML = editFormHTML;
  } else {
    // If no content section, insert after header
    const header = container.querySelector('.feed-card-header');
    if (header) {
      header.insertAdjacentHTML('afterend', editFormHTML);
    }
  }

  // Hide actions and footer
  const actionsBar = container.querySelector('.feed-actions-bar');
  const footer = container.querySelector('.feed-likes')?.parentElement;
  if (actionsBar) actionsBar.style.display = 'none';
  if (footer) footer.style.display = 'none';

  // Setup edit form handlers
  setupEditFormHandlers(postId, originalContent, originalPhotos, originalVideos, videoPosters);
}

function setupEditFormHandlers(postId, originalContent, originalPhotos, originalVideos, videoPosters = new Map()) {
  const contentTextarea = document.getElementById('edit-post-content');
  const charCount = document.getElementById('edit-char-count');
  const cancelBtn = document.getElementById('cancel-edit-btn');
  const saveBtn = document.getElementById('save-edit-btn');
  const addPhotosBtn = document.getElementById('add-more-photos-btn');
  const photosInput = document.getElementById('edit-post-photos-input');

  let currentPhotos = [...originalPhotos];
  let currentVideos = [...originalVideos];
  let newPhotos = [];
  // Portadas cambiadas: url del vídeo → { file } nueva, o null para volver al primer fotograma. Se aplican al guardar
  const coverChanges = new Map();

  // Character counter
  contentTextarea?.addEventListener('input', (e) => {
    const count = e.target.value.length;
    if (charCount) charCount.textContent = count;

    if (count > 2000) {
      e.target.value = e.target.value.substring(0, 2000);
      if (charCount) charCount.textContent = '2000';
    }
  });

  // Cancel button
  cancelBtn?.addEventListener('click', async () => {
    // Reload post
    await openPostModal(postId);
  });

  // Add more photos
  addPhotosBtn?.addEventListener('click', () => {
    photosInput?.click();
  });

  photosInput?.addEventListener('change', (e) => {
    const files = Array.from(e.target.files);
    if (files.length > 0) {
      newPhotos = [...newPhotos, ...files];
      updatePhotosPreview();
    }
  });

  // Remove photo
  document.querySelectorAll('.remove-photo-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const index = parseInt(btn.dataset.index);
      currentPhotos.splice(index, 1);
      updatePhotosPreview();
    });
  });

  // Cambiar la portada de un vídeo ya publicado
  document.querySelectorAll('.edit-cover-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const url = btn.dataset.url;
      const hasPoster = coverChanges.has(url) ? !!coverChanges.get(url) : videoPosters.has(url);
      openVideoTrimmer(null, btn, {
        remote: {
          url,
          poster: hasPoster ? 'current' : '',
          onSave: (file) => {
            coverChanges.set(url, file ? { file } : null);
            const player = btn.closest('.edit-video-item')?.querySelector('video');
            if (!player) return;
            if (file) player.poster = URL.createObjectURL(file);
            else player.removeAttribute('poster');
          }
        }
      });
    });
  });

  // Remove video
  document.querySelectorAll('.remove-video-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      currentVideos = currentVideos.filter(url => url !== btn.dataset.url);
      btn.closest('.edit-video-item')?.remove();
    });
  });

  function updatePhotosPreview() {
    const preview = document.getElementById('edit-photos-preview');
    if (!preview) return;

    let html = '';

    // Existing photos
    currentPhotos.forEach((photo, index) => {
      html += `
        <div style="position: relative; aspect-ratio: 1; border-radius: 8px; overflow: hidden;">
          <img src="${photo}" alt="Photo ${index + 1}" style="width: 100%; height: 100%; object-fit: cover;">
          <button type="button" class="remove-photo-btn" data-index="${index}" style="position: absolute; top: 4px; right: 4px; width: 24px; height: 24px; border-radius: 50%; background: rgba(0,0,0,0.6); color: white; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 16px;"x”</button>
        </div>
      `;
    });

    // New photos
    newPhotos.forEach((file, index) => {
      const url = URL.createObjectURL(file);
      html += `
        <div style="position: relative; aspect-ratio: 1; border-radius: 8px; overflow: hidden;">
          <img src="${url}" alt="New photo ${index + 1}" style="width: 100%; height: 100%; object-fit: cover;">
          <button type="button" class="remove-new-photo-btn" data-index="${index}" style="position: absolute; top: 4px; right: 4px; width: 24px; height: 24px; border-radius: 50%; background: rgba(0,0,0,0.6); color: white; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 16px;"x”</button>
        </div>
      `;
    });

    preview.innerHTML = html;

    // Re-attach remove listeners
    document.querySelectorAll('.remove-photo-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const index = parseInt(btn.dataset.index);
        currentPhotos.splice(index, 1);
        updatePhotosPreview();
      });
    });

    document.querySelectorAll('.remove-new-photo-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const index = parseInt(btn.dataset.index);
        newPhotos.splice(index, 1);
        updatePhotosPreview();
      });
    });
  }

  // Save button
  saveBtn?.addEventListener('click', async () => {
    await savePostEdit(postId, contentTextarea?.value || '', currentPhotos, newPhotos, currentVideos, coverChanges);
  });
}

async function savePostEdit(postId, content, existingPhotos, newPhotos, videos, coverChanges = new Map()) {
  if (!currentUser) {
    showToast('Debes iniciar sesión para editar', 'error');
    return;
  }

  const saveBtn = document.getElementById('save-edit-btn');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Guardando...';

  try {
    let photoUrls = [...existingPhotos];

    // Upload new photos
    if (newPhotos.length > 0) {
      showToast('Subiendo nuevas fotos...', 'info');
      for (let i = 0; i < newPhotos.length; i++) {
        const photo = await kxPrepareImageForUpload(newPhotos[i]);
        const timestamp = Date.now();
        const filename = `${timestamp}_${i}_${photo.name}`;
        const storageRef = storage.ref(`posts/${currentUser.uid}/${filename}`);

        await kxStoragePut(storageRef, photo);
        const url = await storageRef.getDownloadURL();
        photoUrls.push(url);
      }
    }

    // Orden: se conserva el de la publicación para lo que sigue y las fotos nuevas van al final
    let previous = [];
    try {
      const snap = await db.collection('posts').doc(postId).get();
      previous = snap.exists ? kxPostMedia(snap.data()) : [];
    } catch (_) { /* sin orden previo: fotos y luego vídeos */ }
    const keptUrls = new Set([...existingPhotos, ...videos]);
    const mediaList = previous.filter(m => keptUrls.has(m.url));
    const listed = new Set(mediaList.map(m => m.url));
    existingPhotos.forEach(url => { if (!listed.has(url)) mediaList.push({ type: 'photo', url }); });
    videos.forEach(url => { if (!listed.has(url)) mediaList.push({ type: 'video', url }); });
    photoUrls.filter(url => !keptUrls.has(url)).forEach(url => mediaList.push({ type: 'photo', url }));

    // Portadas de vídeo: las cambiadas se suben y las de vídeos o portadas sustituidas se borran
    const deletePoster = async (posterUrl) => {
      try {
        const parts = posterUrl.split('/');
        const path = decodeURIComponent(parts.slice(parts.indexOf('posts')).join('/').split('?')[0]);
        await storage.ref(path).delete();
      } catch (error) {
        console.warn('Error deleting video cover from storage:', error);
      }
    };
    for (const [url, change] of coverChanges) {
      const entry = mediaList.find(m => m.type === 'video' && m.url === url);
      if (!entry) continue;
      const oldPoster = entry.poster;
      if (change) {
        const posterRef = storage.ref(`posts/${currentUser.uid}/${Date.now()}_portada_${change.file.name}`);
        await kxStoragePut(posterRef, change.file);
        entry.poster = await posterRef.getDownloadURL();
      } else {
        delete entry.poster;
      }
      if (oldPoster) await deletePoster(oldPoster);
    }
    for (const m of previous) {
      if (m.type === 'video' && m.poster && !keptUrls.has(m.url)) await deletePoster(m.poster);
    }

    // Determine post type
    let postType = 'text';
    if (photoUrls.length > 0) {
      postType = 'photo';
    } else if (videos.length > 0) {
      postType = 'video';
    }

    // Update post in Firebase
    const updateData = {
      type: postType,
      content: content.trim() || null,
      photos: photoUrls.length > 0 ? photoUrls : null,
      media: mediaList.length > 0 ? mediaList : null,
      videos: videos.length > 0 ? videos : null,
      video: videos[0] || null,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    await db.collection('posts').doc(postId).update(updateData);

    showToast('Publicación actualizada', 'success');

    // Reload post in modal
    await openPostModal(postId);

    // Reload profile grid if on profile view
    if (document.getElementById('profile-view') && !document.getElementById('profile-view').classList.contains('hidden')) {
      await renderProfileGrid();
    }

    // Reload feed if on feed view
    if (document.getElementById('feed-view') && !document.getElementById('feed-view').classList.contains('hidden')) {
      await loadFeed();
    }

  } catch (error) {
    console.error('Error updating post:', error);
    showToast('Error al actualizar la publicación', 'error', { detail: kxFriendlyError(error) });
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Guardar cambios';
  }
}

function initViewPostModal() {
  const modal = document.getElementById('view-post-modal');
  const closeBtn = document.getElementById('close-view-post-modal');

  if (!modal) return;

  // Close button
  closeBtn?.addEventListener('click', () => {
    modal.classList.add('hidden');
  });

  // Close on backdrop
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.classList.add('hidden');
    }
  });

  // Close on ESC key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.classList.contains('hidden')) {
      modal.classList.add('hidden');
    }
  });
}

// ================================
// ACTIVITY VIEW
// ================================

function initActivityView() {
  // Toggle Roca / Rocódromo
  let currentActivityMode = 'roca';
  document.querySelectorAll('.act-mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      currentActivityMode = btn.dataset.mode;
      document.querySelectorAll('.act-mode-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('content-roca').style.display = currentActivityMode === 'roca' ? '' : 'none';
      document.getElementById('content-rocodromo').style.display = currentActivityMode === 'rocodromo' ? '' : 'none';
    });
  });

  // Timeline filter chips
  document.querySelectorAll('.act-tf').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.act-tf').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      filterActivitySessions(chip.dataset.filter);
    });
  });

  // FAB nueva ascensión
  const fabBtn = document.getElementById('new-ascent-btn');
  if (fabBtn) {
    fabBtn.addEventListener('click', () => {
      if (currentActivityMode === 'rocodromo') {
        openNewGymAscent();
      } else {
        showToast('Funcionalidad de nueva ascensión próximamente', 'info');
      }
    });
  }

  // Período selector (legacy, mantener por compatibilidad)
  initPeriodSelector();

  // Load user activity data
  loadActivityData();

  // Start live test header subscriptions
  initTestHeader();
}


// Stats Carousel functionality
let currentStatsSlide = 0;
let statsCarouselTouchStartX = 0;
let statsCarouselTouchEndX = 0;

function initStatsCarousel() {
  const carousel = document.getElementById('stats-carousel');
  const indicators = document.querySelectorAll('.carousel-indicator');

  if (!carousel) return;

  // Click on indicators
  indicators.forEach(indicator => {
    indicator.addEventListener('click', () => {
      const slideIndex = parseInt(indicator.dataset.slide);
      goToStatsSlide(slideIndex);
    });
  });

  // Touch/swipe support
  carousel.addEventListener('touchstart', (e) => {
    statsCarouselTouchStartX = e.changedTouches[0].screenX;
  }, { passive: true });

  carousel.addEventListener('touchend', (e) => {
    statsCarouselTouchEndX = e.changedTouches[0].screenX;
    handleStatsCarouselSwipe();
  }, { passive: true });

  // Mouse drag support for desktop
  let isDragging = false;
  let startX = 0;

  carousel.addEventListener('mousedown', (e) => {
    isDragging = true;
    startX = e.clientX;
    carousel.style.cursor = 'grabbing';
  });

  carousel.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    e.preventDefault();
  });

  carousel.addEventListener('mouseup', (e) => {
    if (!isDragging) return;
    isDragging = false;
    carousel.style.cursor = 'grab';
    const diff = startX - e.clientX;
    if (Math.abs(diff) > 50) {
      if (diff > 0) {
        goToStatsSlide(Math.min(currentStatsSlide + 1, 2));
      } else {
        goToStatsSlide(Math.max(currentStatsSlide - 1, 0));
      }
    }
  });

  carousel.addEventListener('mouseleave', () => {
    isDragging = false;
    carousel.style.cursor = 'grab';
  });

  carousel.style.cursor = 'grab';
}

function handleStatsCarouselSwipe() {
  const diff = statsCarouselTouchStartX - statsCarouselTouchEndX;
  const threshold = 50;

  if (Math.abs(diff) > threshold) {
    if (diff > 0) {
      // Swipe left - next slide
      goToStatsSlide(Math.min(currentStatsSlide + 1, 2));
    } else {
      // Swipe right - previous slide
      goToStatsSlide(Math.max(currentStatsSlide - 1, 0));
    }
  }
}

function goToStatsSlide(index) {
  const carousel = document.getElementById('stats-carousel');
  const indicators = document.querySelectorAll('.carousel-indicator');

  if (!carousel) return;

  currentStatsSlide = index;
  carousel.style.transform = `translateX(-${index * 100}%)`;

  // Update indicators
  indicators.forEach((indicator, i) => {
    indicator.classList.toggle('active', i === index);
  });
}

// Period selector (Día/Mes/Año)
let currentStatsPeriod = 'month'; // 'day', 'month', 'year'

function initPeriodSelector() {
  const periodBtn = document.getElementById('activity-period-btn');
  const periodText = document.getElementById('activity-period-text');

  if (!periodBtn || !periodText) return;

  // Create dropdown menu
  const dropdown = document.createElement('div');
  dropdown.className = 'period-dropdown hidden';
  dropdown.innerHTML = `
    <button class="period-option" data-period="day">Hoy</button>
    <button class="period-option active" data-period="month">Este mes</button>
    <button class="period-option" data-period="year">Este año</button>
  `;
  periodBtn.parentElement.appendChild(dropdown);

  // Toggle dropdown
  periodBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    dropdown.classList.toggle('hidden');
  });

  // Close dropdown when clicking outside
  document.addEventListener('click', () => {
    dropdown.classList.add('hidden');
  });

  // Period selection
  dropdown.querySelectorAll('.period-option').forEach(option => {
    option.addEventListener('click', (e) => {
      e.stopPropagation();
      const period = option.dataset.period;

      // Update active state
      dropdown.querySelectorAll('.period-option').forEach(opt => {
        opt.classList.remove('active');
      });
      option.classList.add('active');

      // Update button text
      const periodLabels = {
        day: 'Hoy',
        month: 'Este mes',
        year: 'Este año'
      };
      periodText.textContent = periodLabels[period];

      // Update current period and reload stats
      currentStatsPeriod = period;
      dropdown.classList.add('hidden');

      // Reload activity data with new period
      loadActivityData();
    });
  });
}

function updateActivityChart(period) {
  const chartContainer = document.getElementById('activity-chart');
  if (!chartContainer) return;

  const now = new Date();
  const nowY = now.getFullYear();
  const nowM = now.getMonth();
  const ascents = cachedAscentsForHistogram;

  let data = [];

  if (period === 'week') {
    const dayOfWeek = now.getDay(); // 0=Sun
    const mondayOffset = (dayOfWeek === 0 ? -6 : 1 - dayOfWeek);
    const monday = new Date(now);
    monday.setHours(0, 0, 0, 0);
    monday.setDate(now.getDate() + mondayOffset);

    const dayLabels = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
    data = dayLabels.map((label, i) => {
      const day = new Date(monday);
      day.setDate(monday.getDate() + i);
      const dY = day.getFullYear(), dM = day.getMonth(), dD = day.getDate();
      const count = ascents.filter(a => {
        const d = parseAscentDate(a.date);
        return d && d.getFullYear() === dY && d.getMonth() === dM && d.getDate() === dD;
      }).length;
      return { label, value: count };
    });

  } else if (period === 'month') {
    const weekRanges = [[1, 7], [8, 14], [15, 21], [22, 31]];
    data = weekRanges.map(([start, end], i) => {
      const count = ascents.filter(a => {
        const d = parseAscentDate(a.date);
        if (!d) return false;
        const dom = d.getDate();
        return d.getFullYear() === nowY && d.getMonth() === nowM && dom >= start && dom <= end;
      }).length;
      return { label: 'S' + (i + 1), value: count };
    });

  } else {
    const monthLabels = ['E', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
    data = monthLabels.map((label, m) => {
      const count = ascents.filter(a => {
        const d = parseAscentDate(a.date);
        return d && d.getFullYear() === nowY && d.getMonth() === m;
      }).length;
      return { label, value: count };
    });
  }

  const total = data.reduce((sum, d) => sum + d.value, 0);
  const maxValue = Math.max(...data.map(d => d.value), 1);

  chartContainer.innerHTML = data.map(item => {
    const height = (item.value / maxValue) * 100;
    const isHighlight = item.value === maxValue && item.value > 0;
    return '<div class="chart-bar-wrapper">' +
      '<div class="chart-bar ' + (isHighlight ? 'chart-bar-highlight' : '') + '"' +
      ' style="height: ' + height + '%;"' +
      ' data-value="' + item.value + '"></div>' +
      '<span class="chart-label">' + item.label + '</span>' +
      '</div>';
  }).join('');

  const avg = (total / data.length).toFixed(1);
  const chartTotal = document.getElementById('chart-total');
  const chartAvg = document.getElementById('chart-avg');
  if (chartTotal) chartTotal.textContent = total;
  if (chartAvg) chartAvg.textContent = avg;

  const summaryLabels = document.querySelectorAll('.summary-label');
  if (summaryLabels.length >= 2) {
    const periodLabels = {
      week: ['vías esta semana', 'media diaria'],
      month: ['vías este mes', 'media semanal'],
      year: ['vías este año', 'media mensual']
    };
    summaryLabels[0].textContent = periodLabels[period] ? periodLabels[period][0] : 'total';
    summaryLabels[1].textContent = periodLabels[period] ? periodLabels[period][1] : 'media';
  }
}

function filterActivities(filter) {
  const activityList = document.getElementById('activity-list');
  if (!activityList) return;

  // This would filter the activities based on the selected filter
  // For now, just show a message
  log('Filtering by:', filter);
}

// ========== COMBINED HISTOGRAM (Bars + Lines) ==========
let currentHistogramPeriod = 'month';
let cachedAscentsForHistogram = [];

const HISTOGRAM_GRADE_ORDER = ['4', '4+', '5a', '5b', '5c', '6a', '6a+', '6b', '6b+', '6c', '6c+',
  '7a', '7a+', '7b', '7b+', '7c', '7c+', '8a', '8a+', '8b', '8b+', '8c', '8c+', '9a'];

// Single canonical date parser used by ALL filtering logic
function parseAscentDate(dateField) {
  if (!dateField) return null;
  const d = dateField.toDate ? dateField.toDate() : new Date(dateField);
  return isNaN(d.getTime()) ? null : d;
}

function getGradeIndex(grade) {
  if (!grade) return -1;
  return HISTOGRAM_GRADE_ORDER.indexOf(grade.toLowerCase().trim());
}

function getGradeFromIndex(index) {
  if (index < 0 || index >= HISTOGRAM_GRADE_ORDER.length) return null;
  return HISTOGRAM_GRADE_ORDER[index];
}

function initCombinedHistogram() {
  const histogramTabs = document.querySelectorAll('[data-histogram]');
  histogramTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      histogramTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentHistogramPeriod = tab.dataset.histogram;
      updateCombinedHistogram(cachedAscentsForHistogram);

      // Also update grade distribution chart with the new period
      updateGradeDistributionChart(cachedAscentsForHistogram);

      const title = document.getElementById('histogram-title');
      if (title) {
        const titles = { week: 'Progreso semanal', month: 'Progreso mensual', year: 'Progreso anual' };
        title.textContent = titles[currentHistogramPeriod] || 'Progreso';
      }
    });
  });

  renderEmptyHistogram();
  initHistogramTooltips();
}

function updateCombinedHistogram(ascents) {
  cachedAscentsForHistogram = ascents || [];

  const barsContainer = document.getElementById('histogram-bars');
  const xAxisContainer = document.getElementById('histogram-x-axis');
  const barLabelsContainer = document.getElementById('histogram-bar-labels');
  const svgLines = document.getElementById('histogram-lines');
  const gradeAxis = document.getElementById('histogram-grade-axis');
  const ascentAxis = document.getElementById('histogram-ascent-axis');

  if (!barsContainer || !svgLines) return;

  if (!ascents || ascents.length === 0) {
    renderEmptyHistogram();
    return;
  }

  const histogramData = processHistogramData(ascents, currentHistogramPeriod);

  const maxAscents = Math.max(...histogramData.map(d => d.ascents), 1);
  const allGradeIndices = histogramData.flatMap(d => [
    getGradeIndex(d.maxGrade), getGradeIndex(d.avgGrade), getGradeIndex(d.minGrade)
  ]).filter(i => i >= 0);

  if (allGradeIndices.length === 0) {
    renderEmptyHistogram();
    return;
  }

  const minGradeIdx = Math.max(0, Math.min(...allGradeIndices) - 2);
  const maxGradeIdx = Math.min(HISTOGRAM_GRADE_ORDER.length - 1, Math.max(...allGradeIndices) + 2);
  const gradeRange = maxGradeIdx - minGradeIdx || 1;

  updateGradeAxis(gradeAxis, minGradeIdx, maxGradeIdx);
  updateAscentAxis(ascentAxis, maxAscents);

  // Escalar las barras al mismo máximo redondeado que usa el eje Y derecho
  const { adjustedMax: ascentAxisMax } = computeAscentAxisMax(maxAscents);

  barsContainer.innerHTML = histogramData.map(item => {
    const height = ascentAxisMax > 0 ? (item.ascents / ascentAxisMax) * 100 : 0;
    return `<div class="histogram-bar-wrapper">
      <div class="histogram-bar" style="height: ${height}%;"></div>
    </div>`;
  }).join('');

  if (barLabelsContainer) {
    barLabelsContainer.innerHTML = histogramData.map(item =>
      `<span class="histogram-bar-count">${item.ascents > 0 ? item.ascents : ''}</span>`
    ).join('');
  }

  // En mobile con muchas barras, mostrar solo cada N etiquetas
  const isMobile = window.innerWidth <= 640;
  const labelStep = isMobile && histogramData.length > 15 ? (histogramData.length > 20 ? 5 : 3) : 1;
  xAxisContainer.innerHTML = histogramData.map((item, i) =>
    `<span class="histogram-x-label">${i % labelStep === 0 ? item.label : ''}</span>`
  ).join('');

  renderHistogramGrid(document.getElementById('histogram-grid'), minGradeIdx, maxGradeIdx);
  measureAndRenderLines(barsContainer, svgLines, histogramData, minGradeIdx, gradeRange);
}

function measureAndRenderLines(barsContainer, svgLines, histogramData, minGradeIdx, gradeRange, attempt) {
  attempt = attempt || 0;
  const chartArea = document.getElementById('histogram-chart-area');
  if (!chartArea) return;

  const doMeasure = () => {
    const areaRect = chartArea.getBoundingClientRect();
    // Si el área no es visible todavía, reintentar (máx 10 veces, ~300ms)
    if (areaRect.width === 0 && attempt < 10) {
      setTimeout(() => measureAndRenderLines(barsContainer, svgLines, histogramData, minGradeIdx, gradeRange, attempt + 1), 30);
      return;
    }
    const barEls = barsContainer.querySelectorAll('.histogram-bar');
    const xPositions = Array.from(barEls).map(el => {
      const r = el.getBoundingClientRect();
      return r.left + r.width / 2 - areaRect.left;
    });
    renderHistogramLines(svgLines, histogramData, minGradeIdx, gradeRange, xPositions);
  };

  requestAnimationFrame(doMeasure);
}

function renderHistogramGrid(svg, minGradeIdx, maxGradeIdx) {
  if (!svg) return;
  const parent = svg.parentElement;
  const width = parent?.clientWidth || svg.clientWidth || 0;
  const height = parent?.clientHeight || svg.clientHeight || 0;
  if (!width || !height) {
    requestAnimationFrame(() => renderHistogramGrid(svg, minGradeIdx, maxGradeIdx));
    return;
  }
  const topPadding = 10;
  const effectiveHeight = height - 20;
  const range = (maxGradeIdx - minGradeIdx) || 1;

  // Limit grid lines to avoid clutter when range is large
  const maxLines = 8;
  const step = Math.max(1, Math.ceil(range / maxLines));

  let lines = '';
  for (let i = minGradeIdx; i <= maxGradeIdx; i += step) {
    const y = effectiveHeight - ((i - minGradeIdx) / range) * effectiveHeight + topPadding;
    lines += `<line class="histogram-grid-line" x1="0" y1="${y.toFixed(2)}" x2="${width}" y2="${y.toFixed(2)}"/>`;
  }
  svg.innerHTML = lines;
}

function processHistogramData(ascents, period) {
  const now = new Date();
  let data = [];

  if (period === 'week') {
    // Mostrar los días de la semana actual (lun-dom)
    const dayLabels = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];
    const currentDay = now.getDay(); // 0=domingo, 1=lunes, etc.
    const mondayOffset = currentDay === 0 ? -6 : 1 - currentDay;
    const monday = new Date(now);
    monday.setDate(now.getDate() + mondayOffset);
    monday.setHours(0, 0, 0, 0);

    for (let i = 0; i < 7; i++) {
      const date = new Date(monday);
      date.setDate(monday.getDate() + i);
      const dY = date.getFullYear(), dM = date.getMonth(), dD = date.getDate();
      const dayAscents = (ascents || []).filter(a => {
        const ad = parseAscentDate(a.date);
        return ad && ad.getFullYear() === dY && ad.getMonth() === dM && ad.getDate() === dD;
      });
      data.push(processAscentsForPeriod(dayAscents, dayLabels[i]));
    }
  } else if (period === 'month') {
    const year = now.getFullYear();
    const month = now.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    for (let day = 1; day <= daysInMonth; day++) {
      const dayAscents = (ascents || []).filter(a => {
        const ad = parseAscentDate(a.date);
        return ad && ad.getFullYear() === year && ad.getMonth() === month && ad.getDate() === day;
      });
      data.push(processAscentsForPeriod(dayAscents, day.toString()));
    }
  } else {
    const monthLabels = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    for (let i = 0; i < 12; i++) {
      const monthAscents = (ascents || []).filter(a => {
        const ad = parseAscentDate(a.date);
        return ad && ad.getFullYear() === now.getFullYear() && ad.getMonth() === i;
      });
      data.push(processAscentsForPeriod(monthAscents, monthLabels[i]));
    }
  }
  return data;
}

function processAscentsForPeriod(ascents, label) {
  if (!ascents || ascents.length === 0) {
    return { label, ascents: 0, maxGrade: null, avgGrade: null, minGrade: null };
  }
  const gradeIndices = ascents.map(a => getGradeIndex(a.grade)).filter(i => i >= 0);
  let maxGrade = null, avgGrade = null, minGrade = null;
  if (gradeIndices.length > 0) {
    maxGrade = getGradeFromIndex(Math.max(...gradeIndices));
    minGrade = getGradeFromIndex(Math.min(...gradeIndices));
    avgGrade = getGradeFromIndex(Math.round(gradeIndices.reduce((a, b) => a + b, 0) / gradeIndices.length));
  }
  return { label, ascents: ascents.length, maxGrade, avgGrade, minGrade };
}

function updateGradeAxis(container, minIdx, maxIdx) {
  if (!container) return;
  const labels = [];

  // Mostrar TODOS los grados en el rango (incluyendo los +)
  for (let i = maxIdx; i >= minIdx; i--) {
    labels.push(HISTOGRAM_GRADE_ORDER[i] || '');
  }

  container.innerHTML = labels.map(l => `<span class="y-label">${l}</span>`).join('');
}

function computeAscentAxisMax(maxValue) {
  // Calcular step "bonito" basado en el máximo
  let step;
  if (maxValue <= 5) step = 1;
  else if (maxValue <= 10) step = 2;
  else if (maxValue <= 25) step = 5;
  else if (maxValue <= 50) step = 10;
  else if (maxValue <= 100) step = 20;
  else if (maxValue <= 250) step = 50;
  else step = Math.ceil(maxValue / 5 / 10) * 10; // Múltiplos de 10

  const adjustedMax = Math.ceil(maxValue / step) * step;
  return { adjustedMax, step };
}

function updateAscentAxis(container, maxValue) {
  if (!container) return;
  const { adjustedMax, step } = computeAscentAxisMax(maxValue);
  const labels = [];
  for (let i = adjustedMax; i >= 0; i -= step) {
    labels.push(i);
  }
  container.innerHTML = labels.map(l => `<span class="y-label">${l}</span>`).join('');
}

function renderHistogramLines(svg, data, minGradeIdx, gradeRange, xPositions) {
  if (!svg || !data || data.length === 0) return;

  const parent = svg.parentElement;
  let height = parent?.clientHeight || svg.clientHeight;
  if (!height) {
    requestAnimationFrame(() => renderHistogramLines(svg, data, minGradeIdx, gradeRange, xPositions));
    return;
  }
  const effectiveHeight = height - 20;
  const topPadding = 10;

  const maxPts = [], avgPts = [], minPts = [];

  data.forEach((item, index) => {
    const x = xPositions ? xPositions[index] : 0;
    if (item.maxGrade) {
      const y = effectiveHeight - ((getGradeIndex(item.maxGrade) - minGradeIdx) / gradeRange) * effectiveHeight + topPadding;
      maxPts.push({ x, y });
    }
    if (item.avgGrade) {
      const y = effectiveHeight - ((getGradeIndex(item.avgGrade) - minGradeIdx) / gradeRange) * effectiveHeight + topPadding;
      avgPts.push({ x, y });
    }
    if (item.minGrade) {
      const y = effectiveHeight - ((getGradeIndex(item.minGrade) - minGradeIdx) / gradeRange) * effectiveHeight + topPadding;
      minPts.push({ x, y });
    }
  });

  // Generate smooth spline paths and circle points
  const maxPath = smoothSplinePath(maxPts);
  const avgPath = smoothSplinePath(avgPts);
  const minPath = smoothSplinePath(minPts);

  const maxPoints = maxPts.map((p, i) => `<circle class="histogram-point histogram-point-max" cx="${p.x}" cy="${p.y}" r="4" data-grade="${data.filter(d => d.maxGrade)[i]?.maxGrade || ''}" data-type="max"/>`).join('');
  const avgPoints = avgPts.map((p, i) => `<circle class="histogram-point histogram-point-avg" cx="${p.x}" cy="${p.y}" r="4" data-grade="${data.filter(d => d.avgGrade)[i]?.avgGrade || ''}" data-type="avg"/>`).join('');
  const minPoints = minPts.map((p, i) => `<circle class="histogram-point histogram-point-min" cx="${p.x}" cy="${p.y}" r="4" data-grade="${data.filter(d => d.minGrade)[i]?.minGrade || ''}" data-type="min"/>`).join('');

  svg.innerHTML = `
    <path class="histogram-line histogram-line-max" d="${maxPath}"/>
    <path class="histogram-line histogram-line-avg" d="${avgPath}"/>
    <path class="histogram-line histogram-line-min" d="${minPath}"/>
    ${maxPoints}${avgPoints}${minPoints}
  `;
}

// Generate smooth cubic Bézier spline path through points (Catmull-Rom to Bézier)
function smoothSplinePath(points, tension = 0.1) {
  if (!points || points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  if (points.length === 2) return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;

  let path = `M ${points[0].x} ${points[0].y}`;

  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] || points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || p2;

    // Control points for cubic Bézier
    const cp1x = p1.x + (p2.x - p0.x) * tension;
    const cp1y = p1.y + (p2.y - p0.y) * tension;
    const cp2x = p2.x - (p3.x - p1.x) * tension;
    const cp2y = p2.y - (p3.y - p1.y) * tension;

    path += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
  }

  return path;
}

function renderEmptyHistogram() {
  const now = new Date();
  let slots = [];

  if (currentHistogramPeriod === 'week') {
    const dayLabels = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];
    slots = dayLabels.map(label => ({ label }));
  } else if (currentHistogramPeriod === 'month') {
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    for (let day = 1; day <= daysInMonth; day++) slots.push({ label: day.toString() });
  } else {
    ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
      .forEach(label => slots.push({ label }));
  }

  const barsContainer = document.getElementById('histogram-bars');
  const xAxisContainer = document.getElementById('histogram-x-axis');
  const svgLines = document.getElementById('histogram-lines');
  const gradeAxis = document.getElementById('histogram-grade-axis');
  const ascentAxis = document.getElementById('histogram-ascent-axis');

  if (!barsContainer) return;

  updateGradeAxis(gradeAxis, getGradeIndex('5c'), getGradeIndex('7a'));
  updateAscentAxis(ascentAxis, 10);

  barsContainer.innerHTML = slots.map(() =>
    `<div class="histogram-bar-wrapper"><div class="histogram-bar" style="height: 0%;"></div></div>`
  ).join('');

  if (xAxisContainer) {
    xAxisContainer.innerHTML = slots.map(s =>
      `<span class="histogram-x-label">${s.label}</span>`
    ).join('');
  }

  if (svgLines) svgLines.innerHTML = '';

  renderHistogramGrid(document.getElementById('histogram-grid'), getGradeIndex('5c'), getGradeIndex('7a'));
}

// ========== HISTOGRAM TOOLTIPS ==========
function initHistogramTooltips() {
  const container = document.getElementById('combined-histogram-container');
  const tooltip = document.getElementById('histogram-tooltip');
  if (!container || !tooltip) return;

  const typeLabels = { max: 'Grado máximo', avg: 'Grado medio', min: 'Grado mínimo' };

  function placeTooltip(e) {
    const cRect = container.getBoundingClientRect();
    let left = e.clientX - cRect.left + 12;
    let top = e.clientY - cRect.top - 36;
    const tw = tooltip.offsetWidth || 90;
    if (left + tw > container.offsetWidth - 4) left = e.clientX - cRect.left - tw - 8;
    if (top < 4) top = e.clientY - cRect.top + 10;
    tooltip.style.left = left + 'px';
    tooltip.style.top = top + 'px';
  }

  function showTooltip(text, e) {
    tooltip.textContent = text;
    tooltip.classList.remove('hidden');
    placeTooltip(e);
  }

  function hideTooltip() {
    tooltip.classList.add('hidden');
  }

  container.addEventListener('mouseleave', hideTooltip);

  // SVG points — delegated on the SVG
  const svgLines = document.getElementById('histogram-lines');
  if (svgLines) {
    svgLines.addEventListener('mousemove', e => {
      const pt = e.target.closest('.histogram-point');
      if (!pt) { hideTooltip(); return; }
      const grade = pt.dataset.grade;
      const type = pt.dataset.type;
      if (!grade) { hideTooltip(); return; }
      showTooltip((typeLabels[type] || 'Grado') + ': ' + grade, e);
    });
    svgLines.addEventListener('mouseleave', hideTooltip);
  }
}

// ========== HISTOGRAM CAROUSEL ==========
let currentHistogramSlide = 0;

function initHistogramCarousel() {
  const carousel = document.getElementById('histogram-carousel');
  const indicators = document.querySelectorAll('.histogram-carousel-indicator');

  if (!carousel || indicators.length === 0) return;

  // Set up indicator clicks
  indicators.forEach(indicator => {
    indicator.addEventListener('click', () => {
      const slideIndex = parseInt(indicator.dataset.histogramSlide);
      goToHistogramSlide(slideIndex);
    });
  });

  // Set up touch/swipe support
  let startX = 0;
  let isDragging = false;

  carousel.addEventListener('touchstart', (e) => {
    startX = e.touches[0].clientX;
    isDragging = true;
  }, { passive: true });

  carousel.addEventListener('touchmove', (e) => {
    if (!isDragging) return;
  }, { passive: true });

  carousel.addEventListener('touchend', (e) => {
    if (!isDragging) return;
    isDragging = false;

    const endX = e.changedTouches[0].clientX;
    const diff = startX - endX;
    const threshold = 50;

    if (Math.abs(diff) > threshold) {
      if (diff > 0 && currentHistogramSlide < 1) {
        goToHistogramSlide(currentHistogramSlide + 1);
      } else if (diff < 0 && currentHistogramSlide > 0) {
        goToHistogramSlide(currentHistogramSlide - 1);
      }
    }
  }, { passive: true });
}

function goToHistogramSlide(index) {
  const carousel = document.getElementById('histogram-carousel');
  const indicators = document.querySelectorAll('.histogram-carousel-indicator');

  if (!carousel) return;

  currentHistogramSlide = Math.max(0, Math.min(index, 1));
  carousel.style.transform = `translateX(-${currentHistogramSlide * 100}%)`;

  indicators.forEach((ind, i) => {
    ind.classList.toggle('active', i === currentHistogramSlide);
  });

  // Update grade distribution when switching to slide 1
  if (currentHistogramSlide === 1) {
    updateGradeDistributionChart(cachedAscentsForHistogram);
  }
}

// ========== GRADE DISTRIBUTION CHART ==========
function updateGradeDistributionChart(ascents) {
  const barsContainer = document.getElementById('grade-distribution-bars');
  const xAxisContainer = document.getElementById('grade-distribution-x-axis');
  const yAxisContainer = document.getElementById('grade-distribution-y-axis');

  if (!barsContainer) return;

  // Filter ascents by current period
  const filteredAscents = filterAscentsForPeriod(ascents, currentHistogramPeriod);

  if (!filteredAscents || filteredAscents.length === 0) {
    renderEmptyGradeDistribution();
    return;
  }

  // Count ascents by grade
  const gradeCount = {};
  filteredAscents.forEach(ascent => {
    const grade = ascent.grade?.toLowerCase?.()?.trim?.();
    if (grade) {
      gradeCount[grade] = (gradeCount[grade] || 0) + 1;
    }
  });

  // Get sorted grades that exist in data
  const sortedGrades = Object.keys(gradeCount).sort((a, b) => {
    const indexA = HISTOGRAM_GRADE_ORDER.indexOf(a);
    const indexB = HISTOGRAM_GRADE_ORDER.indexOf(b);
    return indexA - indexB;
  });

  if (sortedGrades.length === 0) {
    renderEmptyGradeDistribution();
    return;
  }

  const maxCount = Math.max(...Object.values(gradeCount));

  // Render bars
  barsContainer.innerHTML = sortedGrades.map(grade => {
    const count = gradeCount[grade];
    const height = (count / maxCount) * 100;
    return `<div class="grade-distribution-bar" style="height: ${height}%;" data-value="${count}"></div>`;
  }).join('');

  // Render X axis (grades)
  xAxisContainer.innerHTML = sortedGrades.map(grade =>
    `<span class="grade-distribution-x-label">${grade}</span>`
  ).join('');

  // Render Y axis (ascent counts)
  updateGradeDistributionYAxis(yAxisContainer, maxCount);
}

function filterAscentsForPeriod(ascents, period) {
  if (!ascents || ascents.length === 0) return [];

  const now = new Date();

  const nowY = now.getFullYear(), nowM = now.getMonth();

  return ascents.filter(ascent => {
    const ad = parseAscentDate(ascent.date);
    if (!ad) return false;

    if (period === 'week') {
      const currentDay = now.getDay();
      const mondayOffset = currentDay === 0 ? -6 : 1 - currentDay;
      const monday = new Date(now);
      monday.setDate(now.getDate() + mondayOffset);
      monday.setHours(0, 0, 0, 0);
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      sunday.setHours(23, 59, 59, 999);
      return ad >= monday && ad <= sunday;
    } else if (period === 'month') {
      return ad.getFullYear() === nowY && ad.getMonth() === nowM;
    } else {
      return ad.getFullYear() === nowY;
    }
  });
}

function updateGradeDistributionYAxis(container, maxCount) {
  if (!container) return;

  // Create nice round numbers for Y axis
  const steps = 5;
  const stepSize = Math.ceil(maxCount / steps);
  const labels = [];

  for (let i = steps; i >= 0; i--) {
    labels.push(i * stepSize);
  }

  container.innerHTML = labels.map(val =>
    `<span class="y-label">${val}</span>`
  ).join('');
}

function renderEmptyGradeDistribution() {
  const barsContainer = document.getElementById('grade-distribution-bars');
  const xAxisContainer = document.getElementById('grade-distribution-x-axis');
  const yAxisContainer = document.getElementById('grade-distribution-y-axis');

  if (!barsContainer) return;
  barsContainer.innerHTML = '<p class="chart-empty-msg">Sin ascensiones registradas</p>';
  if (xAxisContainer) xAxisContainer.innerHTML = '';
  if (yAxisContainer) yAxisContainer.innerHTML = '';
}

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  initCombinedHistogram();
  initHistogramCarousel();
  renderEmptyGradeDistribution();
});
// ========== END COMBINED HISTOGRAM ==========

async function loadActivityData() {
  const user = firebase.auth().currentUser;
  if (!user) return;

  try {
    // Load user's ascents from the main 'ascents' collection (same as logAscent uses)
    const ascentsRef = firebase.firestore()
      .collection('ascents')
      .where('userId', '==', user.uid)
      .orderBy('date', 'desc')
      .limit(500);

    const snapshot = await ascentsRef.get();

    if (snapshot.empty) {
      const emptyState = document.getElementById('activity-empty');
      if (emptyState) emptyState.style.display = 'flex';
      resetAllStats();
      buildGymMisRocodromos([]);
      return;
    }

    const now = new Date();
    const nowY = now.getFullYear();
    const nowM = now.getMonth();
    const nowD = now.getDate();

    // Process all ascents and filter by period using local date components
    // Build all three buckets in one pass — same parseAscentDate used everywhere
    const allAscents = [], yearAscents = [], monthAscents = [], dayAscents = [];

    snapshot.forEach(doc => {
      const data = doc.data();
      const ascentData = { id: doc.id, ...data };
      allAscents.push(ascentData);

      const d = parseAscentDate(data.date);
      if (!d) return;
      if (d.getFullYear() !== nowY) return;
      yearAscents.push(ascentData);
      if (d.getMonth() !== nowM) return;
      monthAscents.push(ascentData);
      if (d.getDate() === nowD) dayAscents.push(ascentData);
    });

    // Strict period filtering: show only data for the selected period.
    // If empty, calculateAndUpdateStats shows zeros — no fallback to a broader period.
    let statsAscents;
    switch (currentStatsPeriod) {
      case 'day':   statsAscents = dayAscents;   break;
      case 'year':  statsAscents = yearAscents;  break;
      case 'month':
      default:      statsAscents = monthAscents; break;
    }
    calculateAndUpdateStats(statsAscents);

    // Build new activity components from real data
    requestAnimationFrame(() => {
      buildActivityHeroCard(allAscents, yearAscents);
      buildActivityPyramid(allAscents);
      buildGymPyramid(allAscents);
      buildActivityHeatmap(allAscents);
      buildGymStats(allAscents);
      buildGymMisRocodromos(allAscents);
      updateActivityRecords(allAscents);
      updateCombinedHistogram(allAscents);
      renderProgressCards(_pcCurrentPeriod || 'month', allAscents);
      updatePcTimeNav(_pcCurrentPeriod || 'month');
      const activeChartTab = document.querySelector('.chart-tab.active');
      updateActivityChart(activeChartTab ? activeChartTab.dataset.chart : 'week');
    });

    // Activity list grouped by session
    renderActivityList(allAscents.slice(0, 100));

    // Show/hide empty state
    const emptyState = document.getElementById('activity-empty');
    if (emptyState) {
      emptyState.style.display = allAscents.length === 0 ? 'flex' : 'none';
    }

  } catch (error) {
    console.error('Error loading activity data:', error);
  }
}

// ========================================
// ACTIVITY REDESIGN — New builder functions
// ========================================

// GRADE_ORDER already declared at top of file — reuse it

function isGymAscent(ascent) {
  const type = (ascent.climbType || ascent.type || '').toLowerCase();
  const school = (ascent.schoolName || ascent.school || '').toLowerCase();
  return type === 'indoor' || type === 'boulder'
    || school.includes('rocódromo') || school.includes('rocodromo')
    || school.includes('gym') || school.includes('indoor')
    || school.includes('boulder') || school.includes('escalada');
}

// ============================================
// GYM PICKER — selector de rocódromo para nueva ascensión libre
// ============================================

const MIN_GYM_NEARBY_M = 1000; // metros: distancia máxima para auto-detectar gym

let _gymPickerSchoolsCache = null; // caché de pending_schools aprobados
let _gymPickerSelectedId   = null;
let _gymPickerSelectedName = null;
let _gymPickerSelectedCity = null;

function _haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function _loadPendingSchools() {
  if (_gymPickerSchoolsCache) return _gymPickerSchoolsCache;
  try {
    const snap = await db.collection('pending_schools').where('status', '==', 'approved').get();
    _gymPickerSchoolsCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) {
    _gymPickerSchoolsCache = [];
  }
  return _gymPickerSchoolsCache;
}

async function _reverseGeocodeCity(lat, lng) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=10&addressdetails=1`;
    const res = await fetch(url, { headers: { 'Accept-Language': 'es' } });
    if (!res.ok) return '';
    const data = await res.json();
    return data.address?.city || data.address?.town || data.address?.village || data.address?.municipality || '';
  } catch {
    return '';
  }
}

function _gymGradeOptions(type) {
  const grades = type === 'boulder' ? GYM_BOULDER_GRADES : GYM_VIA_GRADES;
  return grades.map(g => `<option value="${g}">${g}</option>`).join('');
}

function _populateGymGradeSelect(type) {
  const sel = document.getElementById('gm-grade-select');
  if (!sel) return;
  sel.innerHTML = _gymGradeOptions(type);
  // Default to a mid-range grade
  const mid = type === 'boulder' ? '6B' : '6b';
  if (sel.querySelector(`option[value="${mid}"]`)) sel.value = mid;
}

function openNewGymAscent() {
  if (typeof openAscentModal !== 'function') return;

  const modal  = document.getElementById('ascent-modal');
  const form   = document.getElementById('ascent-form');
  const title  = document.getElementById('ascent-modal-title');
  if (!modal || !form) return;

  // Reset the form first via a lightweight close
  form.reset();
  delete form.dataset.ascentId;
  delete form.dataset.editMode;
  delete form.dataset.routeId;

  // Reset hidden fields
  document.getElementById('ascent-school-id').value   = '';
  document.getElementById('ascent-school-name').value  = '';
  document.getElementById('ascent-route-name').value   = '';
  document.getElementById('ascent-grade').value        = '';
  document.getElementById('ascent-sector').value       = '';
  document.getElementById('ascent-school-city').value  = '';
  document.getElementById('ascent-climb-type').value   = 'indoor';

  _gymPickerSelectedId   = null;
  _gymPickerSelectedName = null;
  _gymPickerSelectedCity = null;

  // Gym mode flag
  form.dataset.gymMode = 'true';

  // Show gym fields, hide static route display
  document.getElementById('route-display-group')?.classList.add('hidden');
  ['gm-gym-group', 'gm-type-group', 'gm-grade-group', 'gm-route-group'].forEach(id => {
    document.getElementById(id)?.classList.remove('hidden');
  });

  // Populate grade select (default: via)
  _populateGymGradeSelect('via');

  // Reset gym label
  const lbl = document.getElementById('gm-gym-label');
  if (lbl) lbl.textContent = 'Selecciona un rocódromo';

  // Pre-fill today's date
  const dateInput = document.getElementById('ascent-date');
  if (dateInput) {
    const today = new Date().toISOString().split('T')[0];
    dateInput.max = today;
    dateInput.value = today;
  }

  // Reset style dropdown to redpoint
  document.getElementById('ascent-style').value = 'redpoint';
  document.querySelectorAll('.style-dropdown-menu .style-option').forEach(o => {
    o.classList.toggle('selected', o.dataset.value === 'redpoint');
  });
  const styleToggle = document.getElementById('style-dropdown-toggle');
  if (styleToggle) {
    styleToggle.querySelector('.style-icon').textContent = '🔴';
    styleToggle.querySelector('.style-dropdown-label').innerHTML = '<strong>Redpoint</strong> — Encadenada tras haberla probado antes';
  }

  if (title) title.textContent = 'Nueva sesión rocódromo';

  modal.classList.remove('hidden');

  // Wire up gym picker trigger (once)
  const trigger = document.getElementById('gm-gym-trigger');
  if (trigger && !trigger._gymPickerWired) {
    trigger._gymPickerWired = true;
    trigger.addEventListener('click', openGymPickerSheet);
  }

  // Wire up type toggle (once)
  const typeSeg = document.getElementById('gm-type-seg');
  if (typeSeg && !typeSeg._wired) {
    typeSeg._wired = true;
    typeSeg.addEventListener('click', e => {
      const btn = e.target.closest('.gm-type-btn');
      if (!btn) return;
      typeSeg.querySelectorAll('.gm-type-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const gtype = btn.dataset.gtype;
      document.getElementById('ascent-climb-type').value = gtype === 'boulder' ? 'boulder' : 'indoor';
      _populateGymGradeSelect(gtype);
    });
  }
}

function openGymPickerSheet() {
  const sheet = document.getElementById('gym-picker-sheet');
  if (!sheet) return;
  sheet.classList.remove('hidden');

  // Wire close button (once)
  const closeBtn = document.getElementById('gym-picker-close');
  if (closeBtn && !closeBtn._wired) {
    closeBtn._wired = true;
    closeBtn.addEventListener('click', closeGymPickerSheet);
  }
  sheet.addEventListener('click', e => {
    if (e.target === sheet) closeGymPickerSheet();
  }, { once: false });

  // Wire GPS button (once)
  const gpsBtn = document.getElementById('gym-picker-gps');
  if (gpsBtn && !gpsBtn._wired) {
    gpsBtn._wired = true;
    gpsBtn.addEventListener('click', detectGymByGPS);
  }

  // Wire search input
  const searchInput = document.getElementById('gym-picker-search');
  if (searchInput) {
    searchInput.value = '';
    searchInput.focus();
    if (!searchInput._wired) {
      searchInput._wired = true;
      searchInput.addEventListener('input', () => _renderGymPickerList(searchInput.value.trim()));
      searchInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const q = searchInput.value.trim();
          if (q) {
            selectGymFromPicker(q.toLowerCase().replace(/\s+/g, '_'), q, '');
          }
        }
      });
    }
  }

  _renderGymPickerList('');
}

function closeGymPickerSheet() {
  document.getElementById('gym-picker-sheet')?.classList.add('hidden');
}

async function _renderGymPickerList(query) {
  const listEl = document.getElementById('gym-picker-list');
  if (!listEl) return;

  // Gyms from user's own ascents
  const gymAscents = (_allActivityAscents || []).filter(a => isGymAscent(a));
  const seenIds = new Map();
  gymAscents.forEach(a => {
    const id = a.schoolId || a.schoolName?.toLowerCase().replace(/\s+/g, '_') || '';
    if (!id || seenIds.has(id)) return;
    seenIds.set(id, { id, name: a.schoolName || id, city: a.schoolCity || '' });
  });
  const pastGyms = [...seenIds.values()];

  // Schools from Firestore (load async, non-blocking)
  const schools = await _loadPendingSchools();

  // Merge: add Firestore schools not already in past gyms
  const allGyms = [...pastGyms];
  schools.forEach(s => {
    if (!allGyms.some(g => g.id === s.id)) {
      allGyms.push({ id: s.id, name: s.nombre || s.name || s.id, city: s.schoolCity || '' });
    }
  });

  // Filter by query
  const lq = query.toLowerCase();
  const filtered = query
    ? allGyms.filter(g => g.name.toLowerCase().includes(lq))
    : allGyms;

  if (filtered.length === 0 && !query) {
    listEl.innerHTML = '<div class="gym-picker-empty">Sin rocódromos visitados aún.<br>Escribe el nombre para añadir uno.</div>';
    return;
  }

  const items = filtered.map(g => {
    const citySpan = g.city ? `<span class="gym-picker-city">${g.city}</span>` : '';
    return `<div class="gym-picker-item" data-id="${g.id}" data-name="${g.name}" data-city="${g.city}">
      <div class="gym-picker-item-avatar">${g.name.slice(0, 2).toUpperCase()}</div>
      <div class="gym-picker-item-info">
        <div class="gym-picker-item-name">${g.name}</div>
        ${citySpan}
      </div>
    </div>`;
  });

  // If query doesn't match any, offer to create it
  if (query && !filtered.some(g => g.name.toLowerCase() === lq)) {
    items.push(`<div class="gym-picker-item gym-picker-add" data-id="" data-name="${query}" data-city="">
      <div class="gym-picker-item-avatar gym-picker-add-icon">+</div>
      <div class="gym-picker-item-info">
        <div class="gym-picker-item-name">Añadir "<strong>${query}</strong>"</div>
      </div>
    </div>`);
  }

  listEl.innerHTML = items.join('');
  listEl.querySelectorAll('.gym-picker-item').forEach(item => {
    item.addEventListener('click', () => {
      const id   = item.dataset.id || item.dataset.name.toLowerCase().replace(/\s+/g, '_');
      const name = item.dataset.name;
      const city = item.dataset.city;
      selectGymFromPicker(id, name, city);
    });
  });
}

function selectGymFromPicker(id, name, city) {
  _gymPickerSelectedId   = id;
  _gymPickerSelectedName = name;
  _gymPickerSelectedCity = city;

  document.getElementById('ascent-school-id').value  = id;
  document.getElementById('ascent-school-name').value = name;
  document.getElementById('ascent-school-city').value = city;

  const lbl = document.getElementById('gm-gym-label');
  if (lbl) lbl.textContent = name;

  closeGymPickerSheet();
}

async function detectGymByGPS() {
  const gpsBtn = document.getElementById('gym-picker-gps');
  if (!navigator.geolocation) {
    showToast('Geolocalización no disponible en este dispositivo', 'warning');
    return;
  }

  if (gpsBtn) {
    gpsBtn.disabled = true;
    gpsBtn.textContent = 'Obteniendo ubicación…';
  }

  navigator.geolocation.getCurrentPosition(
    async pos => {
      const { latitude: lat, longitude: lng } = pos.coords;

      // Reverse geocode for city
      const city = await _reverseGeocodeCity(lat, lng);

      // Find nearest school from Firestore schools
      const schools = await _loadPendingSchools();
      let nearest = null;
      let nearestDist = Infinity;
      schools.forEach(s => {
        if (!s.coordinates || s.coordinates.length < 2) return;
        const d = _haversineMeters(lat, lng, s.coordinates[1], s.coordinates[0]);
        if (d < nearestDist) { nearestDist = d; nearest = s; }
      });

      // Also check user's past gyms (no coords, skip)

      if (gpsBtn) {
        gpsBtn.disabled = false;
        gpsBtn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="3"/><path d="M12 1v3.5M12 19.5V23M1 12h3.5M19.5 12H23"/><circle cx="12" cy="12" r="9" opacity=".25" stroke-width="1.5"/></svg> Detectar mi ubicación`;
      }

      if (nearest && nearestDist <= MIN_GYM_NEARBY_M) {
        selectGymFromPicker(nearest.id, nearest.nombre || nearest.name || nearest.id, city || nearest.schoolCity || '');
        showToast(`Rocódromo detectado: ${nearest.nombre || nearest.name}`, 'success');
      } else {
        // Pre-fill city in search and let user type the name
        const searchInput = document.getElementById('gym-picker-search');
        if (searchInput) {
          searchInput.value = city ? `${city} ` : '';
          searchInput.focus();
          _renderGymPickerList(searchInput.value.trim());
        }
        document.getElementById('ascent-school-city').value = city;
        _gymPickerSelectedCity = city;
        if (city) showToast(`Ciudad detectada: ${city}. Elige o escribe el nombre del rocódromo`, 'info');
        else showToast('Ubicación obtenida. Elige o escribe el rocódromo', 'info');
      }
    },
    err => {
      if (gpsBtn) {
        gpsBtn.disabled = false;
        gpsBtn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="3"/><path d="M12 1v3.5M12 19.5V23M1 12h3.5M19.5 12H23"/><circle cx="12" cy="12" r="9" opacity=".25" stroke-width="1.5"/></svg> Detectar mi ubicación`;
      }
      const msgs = { 1: 'Permiso de ubicación denegado', 2: 'Ubicación no disponible', 3: 'Tiempo de espera agotado' };
      showToast(msgs[err.code] || 'Error al obtener ubicación', 'error');
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
  );
}

const HERO_MILESTONES = [
  { m: 33,    name: 'Coloso de Rodas',         emoji: '🗿' },
  { m: 93,    name: 'Estatua de la Libertad',  emoji: '🗽' },
  { m: 138,   name: 'Pirámide de Guiza',       emoji: '🔺' },
  { m: 172,   name: 'Sagrada Familia',         emoji: '⛪' },
  { m: 324,   name: 'Torre Eiffel',            emoji: '🗼' },
  { m: 443,   name: 'Empire State',            emoji: '🏙️' },
  { m: 508,   name: 'Taipei 101',              emoji: '🏢' },
  { m: 828,   name: 'Burj Khalifa',            emoji: '🏗️' },
  { m: 914,   name: 'El Capitán',              emoji: '🧗' },
  { m: 2428,  name: 'Peñalara',                emoji: '🗻' },
  { m: 2519,  name: 'Naranjo de Bulnes',       emoji: '⛰️' },
  { m: 3478,  name: 'Mulhacén',                emoji: '🏔️' },
  { m: 3718,  name: 'Teide',                   emoji: '🌋' },
  { m: 4810,  name: 'Mont Blanc',              emoji: '🏔️' },
  { m: 5895,  name: 'Kilimanjaro',             emoji: '🌍' },
  { m: 6962,  name: 'Aconcagua',               emoji: '🏔️' },
  { m: 8091,  name: 'Annapurna',               emoji: '❄️' },
  { m: 8611,  name: 'K2',                      emoji: '⛏️' },
  { m: 8848,  name: 'Everest',                 emoji: '🏔️' },
  { m: 12000, name: 'Troposfera',              emoji: '☁️' },
  { m: 50000, name: 'Estratosfera',            emoji: '🌌' },
  { m: 85000, name: 'Mesoesfera',              emoji: '🌠' },
  { m: 408000,name: 'ISS',                     emoji: '🛰️' },
];

function estimateRouteMeters(grade) {
  if (!grade) return 20;
  const g = String(grade).toLowerCase();
  if (g.startsWith('3') || g.startsWith('4')) return 15;
  if (g.startsWith('5')) return 18;
  if (g.startsWith('6')) return 22;
  if (g.startsWith('7')) return 25;
  return 28;
}

function buildActivityHeroMilestone(allAscents) {
  const rockAscents = allAscents.filter(a => !isGymAscent(a) && a.grade && a.style !== 'project');
  const totalMeters = rockAscents.reduce((sum, a) => {
    const fromRoute = parseFloat(a.routeLength || a.long1);
    const m = !isNaN(fromRoute) && fromRoute > 0 ? fromRoute : estimateRouteMeters(a.grade);
    return sum + m;
  }, 0);

  const metersEl = document.getElementById('hero-meters');
  if (metersEl) metersEl.textContent = `${Math.round(totalMeters).toLocaleString('es-ES')} m`;

  let currentIdx = -1;
  for (let i = HERO_MILESTONES.length - 1; i >= 0; i--) {
    if (totalMeters >= HERO_MILESTONES[i].m) { currentIdx = i; break; }
  }
  const current = currentIdx >= 0 ? HERO_MILESTONES[currentIdx] : null;
  const next = HERO_MILESTONES[currentIdx + 1] || null;

  const nameEl = document.getElementById('hero-milestone-name');
  const fillEl = document.getElementById('hero-progress-fill');
  const nextEl = document.getElementById('hero-milestone-next');

  if (totalMeters === 0) {
    if (nameEl) nameEl.textContent = '· registra vías para ver hitos';
    if (fillEl) fillEl.style.width = '0%';
    if (nextEl) nextEl.textContent = '';
    return;
  }

  if (nameEl) {
    nameEl.innerHTML = current
      ? `· ${current.emoji} <strong>${current.name}</strong>`
      : `· camino al primer hito`;
  }

  if (next) {
    const baseM = current ? current.m : 0;
    const pct = Math.max(0, Math.min(100, ((totalMeters - baseM) / (next.m - baseM)) * 100));
    if (fillEl) fillEl.style.width = `${pct}%`;
    const remaining = Math.max(0, Math.round(next.m - totalMeters));
    if (nextEl) nextEl.innerHTML = `Próximo: ${next.emoji} <strong>${next.name}</strong> · faltan <strong>${remaining.toLocaleString('es-ES')} m</strong>`;
  } else {
    if (fillEl) fillEl.style.width = '100%';
    if (nextEl) nextEl.innerHTML = '🎉 Todos los hitos alcanzados';
  }
}

function buildActivityHeroCard(allAscents, yearAscents) {
  buildActivityHeroMilestone(allAscents);
  const rockAscents = allAscents.filter(a => !isGymAscent(a));
  const rockYear = yearAscents.filter(a => !isGymAscent(a));

  // Max grade as "proyecto activo" (highest grade attempted this year)
  const grades = rockYear.map(a => a.grade).filter(Boolean);
  const maxGrade = findMaxGrade(grades) || '-';
  const gradeEl = document.getElementById('hero-project-grade');
  if (gradeEl) gradeEl.textContent = maxGrade;

  // Route name of that grade
  const topAscent = rockYear.find(a => a.grade && a.grade.toLowerCase() === (maxGrade || '').toLowerCase());
  const nameEl = document.getElementById('hero-project-name');
  if (nameEl) {
    const loc = [topAscent?.routeName, topAscent?.sectorName || topAscent?.sector, topAscent?.schoolName || topAscent?.school].filter(Boolean).join(' · ');
    nameEl.textContent = loc || (maxGrade !== '-' ? 'Mejor encadenamiento del año' : 'Sin ascensiones este año');
  }

  // Streak
  const streak = calculateStreak(rockAscents);
  const flashCount = rockYear.filter(a => a.style === 'flash' || a.style === 'onsight').length;
  const flashRate = rockYear.length > 0 ? Math.round((flashCount / rockYear.length) * 100) : 0;

  const badgesEl = document.getElementById('hero-badges-roca');
  if (badgesEl) {
    badgesEl.innerHTML = [
      streak > 2 ? `<span class="act-badge act-badge-orange">🔥 Racha ${streak} días</span>` : '',
      rockYear.length > 0 ? `<span class="act-badge act-badge-blue">${rockYear.length} vías este año</span>` : '',
      flashRate > 0 ? `<span class="act-badge act-badge-green">Flash ${flashRate}%</span>` : '',
    ].join('');
  }

  // Comparison vs previous year
  const now = new Date();
  const prevYear = now.getFullYear() - 1;
  const prevYearAscents = allAscents.filter(a => {
    const d = parseAscentDate(a.date);
    return d && d.getFullYear() === prevYear && !isGymAscent(a);
  });
  const compareEl = document.getElementById('hero-compare-roca');
  if (compareEl) {
    if (prevYearAscents.length > 0 && rockYear.length > 0) {
      const pct = Math.round(((rockYear.length - prevYearAscents.length) / prevYearAscents.length) * 100);
      const sign = pct >= 0 ? '+' : '';
      const prevMax = findMaxGrade(prevYearAscents.map(a => a.grade).filter(Boolean));
      compareEl.innerHTML = `Vs. ${prevYear}:<br><strong>${sign}${pct}% vías</strong><br>Grado máximo: <strong>${prevMax || '-'} → ${maxGrade}</strong>`;
    } else if (rockYear.length > 0) {
      compareEl.innerHTML = `<strong>${rockYear.length} vías</strong> este año<br>Flash rate: <strong>${flashRate}%</strong>`;
    } else {
      compareEl.innerHTML = 'Registra ascensiones<br>para ver tu progreso.';
    }
  }

  // Sparkline — últimas 30 sesiones agrupadas por día
  buildSparkline(rockAscents, 'hero-sparkline-roca', '#6366f1', '#e0e7ff');
}

function buildSparkline(ascents, svgId, strokeColor, fillColor) {
  const svgEl = document.getElementById(svgId);
  if (!svgEl) return;

  const byDay = {};
  ascents.slice(0, 210).forEach(a => {
    const d = parseAscentDate(a.date);
    if (!d) return;
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    byDay[key] = (byDay[key] || 0) + 1;
  });

  const days = Object.values(byDay).slice(0, 30).reverse();
  if (days.length < 2) { svgEl.innerHTML = ''; return; }

  const maxV = Math.max(...days);
  const w = 200, h = 48, pad = 4;
  const pts = days.map((v, i) => {
    const x = (i / (days.length - 1)) * w;
    const y = h - pad - ((v / maxV) * (h - pad * 2));
    return `${x},${y}`;
  }).join(' ');

  svgEl.innerHTML = `
    <polyline points="${pts}" fill="none" stroke="${strokeColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    <polyline points="${pts} ${w},${h} 0,${h}" fill="${fillColor}" stroke="none" opacity="0.5"/>
  `;
}

function buildActivityPyramid(allAscents) {
  const el = document.getElementById('act-pyramid-roca');
  if (!el) return;

  const rockAscents = allAscents.filter(a => !isGymAscent(a) && a.style !== 'project' && a.grade);

  const gradeCounts = {};
  rockAscents.forEach(a => {
    const g = a.grade.toLowerCase();
    if (GRADE_ORDER.includes(g)) gradeCounts[g] = (gradeCounts[g] || 0) + 1;
  });

  const sorted = GRADE_ORDER
    .filter(g => gradeCounts[g] > 0)
    .reverse();

  if (sorted.length === 0) {
    el.innerHTML = '<div style="text-align:center;padding:1rem;font-size:12px;color:var(--text-muted)">Sin ascensiones encadenadas</div>';
    const consolidatedEl = document.getElementById('act-consolidated-grade');
    if (consolidatedEl) consolidatedEl.textContent = '-';
    return;
  }

  const maxCount = Math.max(...sorted.map(g => gradeCounts[g]));

  el.innerHTML = sorted.map(grade => {
    const count = gradeCounts[grade];
    const pct = Math.max(8, Math.round((count / maxCount) * 100));
    const bg = typeof getGradeColor === 'function' ? getGradeColor(grade) : '#818cf8';
    return `<div class="act-pyramid-row">
      <div class="act-pyramid-label">${grade}</div>
      <div class="act-pyramid-bar-wrap">
        <div class="act-pyramid-bar" style="width:${pct}%;background:${bg};"></div>
        <div class="act-pyramid-count">${count}</div>
      </div>
    </div>`;
  }).join('');

  // Consolidated grade: highest grade with ≥5 ascents
  const consolidated = sorted.find(g => gradeCounts[g] >= 5);
  const consolidatedEl = document.getElementById('act-consolidated-grade');
  if (consolidatedEl) consolidatedEl.textContent = consolidated || '-';
}

function buildActivityHeatmap(allAscents) {
  buildHeatmapFor(allAscents.filter(a => !isGymAscent(a)), 'act-heatmap-weeks-roca', 'act-heatmap-months-roca', 'hm-r');

  const gymAscents = allAscents.filter(a => isGymAscent(a));
  if (window._gymActivityHeatmap) window._gymActivityHeatmap.destroy();
  window._gymActivityHeatmap = new ActivityHeatmap('gym-activity-heatmap');
  window._gymActivityHeatmap.initWithData(gymAscents);
}

function getHmTooltip() {
  let tip = document.getElementById('hm-tooltip');
  if (!tip) {
    tip = document.createElement('div');
    tip.id = 'hm-tooltip';
    tip.className = 'hm-tooltip';
    document.body.appendChild(tip);
  }
  return tip;
}

function buildHeatmapFor(ascents, weeksId, monthsId, colorPrefix) {
  const weeksEl = document.getElementById(weeksId);
  const monthsEl = document.getElementById(monthsId);
  if (!weeksEl || !monthsEl) return;
  weeksEl.innerHTML = '';
  monthsEl.innerHTML = '';

  const dayCount = {};
  ascents.forEach(a => {
    const d = parseAscentDate(a.date);
    if (!d) return;
    const key = `${d.getFullYear()}-${String(d.getMonth()).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    dayCount[key] = (dayCount[key] || 0) + 1;
  });

  const today = new Date();
  const year = today.getFullYear();
  const months = ['E','F','M','A','M','J','J','A','S','O','N','D'];
  const currentMonth = today.getMonth();

  // Render each month as its own block of week-columns, with empty cells
  // padding the start/end so each month shows EXACTLY its real days.
  for (let m = 0; m <= currentMonth; m++) {
    const firstDay = new Date(year, m, 1);
    const daysInMonth = new Date(year, m + 1, 0).getDate();
    const fdDow = firstDay.getDay();
    const fdGridDay = fdDow === 0 ? 6 : fdDow - 1; // 0=Mon..6=Sun
    const totalCells = fdGridDay + daysInMonth;
    const weeksInMonth = Math.ceil(totalCells / 7);

    for (let w = 0; w < weeksInMonth; w++) {
      const weekDiv = document.createElement('div');
      weekDiv.className = 'act-heatmap-week';
      if (w === 0 && m > 0) weekDiv.classList.add('hm-month-start');

      for (let d = 0; d < 7; d++) {
        const dayOfMonth = w * 7 + d - fdGridDay + 1;
        const inMonth = dayOfMonth >= 1 && dayOfMonth <= daysInMonth;
        const cell = document.createElement('div');

        if (!inMonth) {
          cell.className = 'act-heatmap-cell hm-empty';
        } else {
          const date = new Date(year, m, dayOfMonth);
          const afterToday = date > today;
          if (afterToday) {
            cell.className = 'act-heatmap-cell hm-empty';
          } else {
            const key = `${year}-${String(m).padStart(2,'0')}-${String(dayOfMonth).padStart(2,'0')}`;
            const count = dayCount[key] || 0;
            const level = count === 0 ? 0 : count <= 2 ? 1 : count <= 4 ? 2 : count <= 7 ? 3 : 4;
            cell.className = `act-heatmap-cell ${level === 0 ? 'hm-0' : colorPrefix + level}`;
            if (count > 0) {
              const label = `${count} ${count === 1 ? 'vía' : 'vías'} · ${date.toLocaleDateString('es-ES', { day:'numeric', month:'short' })}`;
              cell.addEventListener('mouseenter', e => {
                const tip = getHmTooltip();
                tip.textContent = label;
                const r = cell.getBoundingClientRect();
                tip.style.left = `${r.left + r.width / 2}px`;
                tip.style.top = `${r.top - 8}px`;
                tip.style.transform = 'translateX(-50%) translateY(-100%)';
                tip.classList.add('visible');
              });
              cell.addEventListener('mouseleave', () => {
                getHmTooltip().classList.remove('visible');
              });
            }
          }
        }
        weekDiv.appendChild(cell);
      }
      weeksEl.appendChild(weekDiv);

      const span = document.createElement('div');
      span.className = 'act-heatmap-month';
      span.textContent = (w === 0) ? months[m] : '';
      monthsEl.appendChild(span);
    }
  }
}

function calculateStreak(ascents) {
  if (!ascents || ascents.length === 0) return 0;
  const days = new Set();
  ascents.forEach(a => {
    const d = parseAscentDate(a.date);
    if (d) days.add(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`);
  });

  const sorted = Array.from(days).sort().reverse();
  let streak = 0;
  const today = new Date();
  let cursor = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  for (const dayKey of sorted) {
    const [y, m, d] = dayKey.split('-').map(Number);
    const dayDate = new Date(y, m, d);
    const diff = Math.round((cursor - dayDate) / 86400000);
    if (diff <= 1) {
      streak++;
      cursor = dayDate;
    } else {
      break;
    }
  }
  return streak;
}

// ============================================
// PIRÁMIDE DE GRADOS — Rocódromo
// ============================================

const GYM_VIA_GRADES = [
  '4', '4+', '5', '5+',
  '5a', '5a+', '5b', '5b+', '5c', '5c+',
  '6a', '6a+', '6b', '6b+', '6c', '6c+',
  '7a', '7a+', '7b', '7b+', '7c', '7c+',
  '8a', '8a+', '8b', '8b+', '8c', '8c+', '9a',
];

const GYM_BOULDER_GRADES = [
  '3', '4', '4+', '5', '5+',
  '6A', '6A+', '6B', '6B+', '6C', '6C+',
  '7A', '7A+', '7B', '7B+', '7C', '7C+',
  '8A', '8A+', '8B', '8B+', '8C', '8C+',
];

function buildGymPyramid(allAscents) {
  const wrap = document.getElementById('gym-pyramid-wrap');
  if (!wrap) return;

  const gymAscents = allAscents.filter(a => isGymAscent(a));

  function isBoulder(a) {
    return (a.climbType || a.type || '').toLowerCase() === 'boulder';
  }

  function normalizeGrade(g, view) {
    if (!g) return '';
    const s = g.trim();
    if (view === 'via') return s.toLowerCase();
    // Fontainebleau: uppercase letter suffix, e.g. "6b+" → "6B+"
    return s.replace(/([a-c])(\+?)$/i, (_, l, p) => l.toUpperCase() + p);
  }

  let activeView = 'via';

  function getViewData() {
    const grades = activeView === 'via' ? GYM_VIA_GRADES : GYM_BOULDER_GRADES;
    const viewAscents = gymAscents.filter(a =>
      activeView === 'via' ? !isBoulder(a) : isBoulder(a)
    );
    const sendAscents = viewAscents.filter(a => a.style !== 'project' && a.grade);
    const projects = viewAscents.filter(a => a.style === 'project');

    const flashMap = {}, redMap = {};
    sendAscents.forEach(a => {
      const g = normalizeGrade(a.grade, activeView);
      if (!grades.includes(g)) return;
      if (a.style === 'flash' || a.style === 'onsight') flashMap[g] = (flashMap[g] || 0) + 1;
      else redMap[g] = (redMap[g] || 0) + 1;
    });

    const activeGrades = grades.filter(g => (flashMap[g]||0)+(redMap[g]||0) > 0).reverse();
    const max = activeGrades.reduce((m, g) => Math.max(m, (flashMap[g]||0)+(redMap[g]||0)), 1);

    // Consolidation: highest grade with ≥5 combined sends
    let conso = null;
    for (let i = grades.length - 1; i >= 0; i--) {
      if ((flashMap[grades[i]]||0) + (redMap[grades[i]]||0) >= 5) { conso = grades[i]; break; }
    }

    return { activeGrades, flashMap, redMap, max, conso, projects };
  }

  function renderPyramid() {
    const { activeGrades, flashMap, redMap, max, conso, projects } = getViewData();

    const pyramidEl = wrap.querySelector('#gp-pyramid');
    const consoVal  = wrap.querySelector('#gp-conso-val');
    const projectsEl = wrap.querySelector('#gp-projects');

    if (activeGrades.length === 0) {
      pyramidEl.innerHTML = '<div class="gp-empty">Sin ascensiones registradas</div>';
      consoVal.textContent = '-';
    } else {
      pyramidEl.innerHTML = activeGrades.map(g => {
        const flash = flashMap[g] || 0;
        const red   = redMap[g]   || 0;
        const total = flash + red;
        const w     = Math.max(7, Math.round(total / max * 100));
        let bars = '';
        if (flash > 0) bars += `<div style="width:${Math.round(flash/total*100)}%;background:#1D9E75;height:100%;"></div>`;
        if (red   > 0) bars += `<div style="width:${Math.round(red/total*100)}%;background:#378ADD;height:100%;"></div>`;
        return `<div class="gp-row">
          <span class="gp-label">${g}</span>
          <div class="gp-bar-wrap"><div class="gp-bar" style="width:${w}%;">${bars}</div></div>
          <span class="gp-count">${total}</span>
        </div>`;
      }).join('');
      consoVal.textContent = conso || '-';
    }

    if (projects.length === 0) {
      projectsEl.innerHTML = '<div class="gp-empty">Sin proyectos activos</div>';
    } else {
      projectsEl.innerHTML = projects.slice(0, 10).map(p => {
        const g     = p.grade || '?';
        const name  = p.routeName || p.name || 'Sin nombre';
        const tries = p.attempts || p.tries || 0;
        const best  = p.bestAttempt || p.best_attempt || '';
        const sub   = tries > 0
          ? `${tries} pegue${tries !== 1 ? 's' : ''}${best ? ' · Mejor: ' + best : ''}`
          : 'Sin intentos registrados';
        return `<div class="gp-project">
          <span class="gp-proj-grade">${g}</span>
          <div class="gp-proj-info">
            <div class="gp-proj-name">${name}</div>
            <div class="gp-proj-sub">${sub}</div>
          </div>
          <i class="ti ti-chevron-right gp-proj-chevron" aria-hidden="true"></i>
        </div>`;
      }).join('');
    }
  }

  wrap.innerHTML = `
<div class="gp-root">
  <div class="act-section-title">Pirámide de grados</div>
  <div class="gp-seg" id="gp-seg">
    <button class="gp-tab active" data-v="via">Vías indoor</button>
    <button class="gp-tab" data-v="boulder">Boulder</button>
  </div>
  <div class="gp-legend">
    <span class="gp-legend-dot" style="background:#1D9E75;"></span><span>Flash</span>
    <span class="gp-legend-dot gp-legend-gap" style="background:#378ADD;"></span><span>Encadenada</span>
  </div>
  <div id="gp-pyramid"></div>
  <div class="gp-conso">
    <i class="ti ti-award gp-conso-icon" aria-hidden="true"></i>
    <div>
      <div class="gp-conso-label">Grado de consolidación</div>
      <div class="gp-conso-val" id="gp-conso-val">-</div>
      <div class="gp-conso-sub">≥5 vías encadenadas</div>
    </div>
  </div>
  <div class="gp-proj-section">
    <div class="gp-proj-title"><i class="ti ti-target-arrow" aria-hidden="true"></i> Proyectos activos</div>
    <div id="gp-projects"></div>
  </div>
</div>`;

  wrap.querySelector('#gp-seg').addEventListener('click', e => {
    const tab = e.target.closest('.gp-tab');
    if (!tab) return;
    activeView = tab.dataset.v;
    wrap.querySelectorAll('.gp-tab').forEach(t => t.classList.toggle('active', t === tab));
    renderPyramid();
  });

  renderPyramid();
}

function buildGymStats(allAscents) {
  const gymAscents = allAscents.filter(a => isGymAscent(a));

  // This week gym routes
  const now = new Date();
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - now.getDay());
  startOfWeek.setHours(0,0,0,0);
  const weekGym = gymAscents.filter(a => {
    const d = parseAscentDate(a.date);
    return d && d >= startOfWeek;
  });

  const weekRoutesEl = document.getElementById('hero-gym-week-routes');
  if (weekRoutesEl) weekRoutesEl.textContent = weekGym.length > 0 ? `${weekGym.length} vías` : '- vías';

  const goalEl = document.getElementById('hero-gym-goal');
  if (goalEl) goalEl.textContent = gymAscents.length === 0 ? 'Registra sesiones para ver tu progreso' : `${gymAscents.length} vías totales en rocódromo`;

  // Flash rate
  const flashGym = gymAscents.filter(a => a.style === 'flash' || a.style === 'onsight').length;
  const flashRateGym = gymAscents.length > 0 ? Math.round((flashGym / gymAscents.length) * 100) + '%' : '-';

  // Sessions per week (last 8 weeks)
  const eightWeeksAgo = new Date(now);
  eightWeeksAgo.setDate(now.getDate() - 56);
  const recentGym = gymAscents.filter(a => {
    const d = parseAscentDate(a.date);
    return d && d >= eightWeeksAgo;
  });
  const gymDays = new Set(recentGym.map(a => {
    const d = parseAscentDate(a.date);
    return d ? `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}` : null;
  }).filter(Boolean));
  const sessionsPerWeek = gymDays.size > 0 ? (gymDays.size / 8).toFixed(1) : '-';

  // Max grade in gym
  const gymGrades = gymAscents.map(a => a.grade).filter(Boolean);
  const gymMaxGrade = findMaxGrade(gymGrades) || '-';

  // Unique gym session days total
  const allGymDays = new Set(gymAscents.map(a => {
    const d = parseAscentDate(a.date);
    return d ? `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}` : null;
  }).filter(Boolean));

  const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  setVal('gym-sessions-week', sessionsPerWeek);
  setVal('gym-flash-rate', flashRateGym);
  setVal('gym-max-grade', gymMaxGrade);
  setVal('gym-total-sessions', allGymDays.size > 0 ? allGymDays.size : '-');

  // Sparkline gym
  buildSparkline(gymAscents, 'hero-sparkline-gym', '#7c3aed', '#ede9fe');

  // Gym timeline
  renderGymTimeline(gymAscents.slice(0, 50));
}

// ============================================================
// MIS ROCÓDROMOS — sección en tab Rocódromo de Actividad
// ============================================================

// Umbral mínimo de vías en cada gym para mostrar calibración
const MIN_VIAS_CALIBRACION = 5;

// Escala unificada: via indoor + boulder (normalizado a minúsculas)
const GYM_ROCO_GRADE_SCALE = [
  '3', '4', '4+', '5', '5+',
  '5a', '5a+', '5b', '5b+', '5c', '5c+',
  '6a', '6a+', '6b', '6b+', '6c', '6c+',
  '7a', '7a+', '7b', '7b+', '7c', '7c+',
  '8a', '8a+', '8b', '8b+', '8c', '8c+', '9a'
];

function _rocoGradeIndex(grade) {
  if (!grade) return -1;
  return GYM_ROCO_GRADE_SCALE.indexOf(grade.toLowerCase().trim());
}

function _rocoMaxGrade(grades) {
  let max = -1;
  let maxGrade = null;
  grades.forEach(g => {
    const idx = _rocoGradeIndex(g);
    if (idx > max) { max = idx; maxGrade = GYM_ROCO_GRADE_SCALE[idx]; }
  });
  return maxGrade;
}

function _rocoAvgGrade(grades) {
  const indices = grades.map(_rocoGradeIndex).filter(i => i >= 0);
  if (!indices.length) return null;
  const avg = Math.round(indices.reduce((s, i) => s + i, 0) / indices.length);
  return GYM_ROCO_GRADE_SCALE[avg] || null;
}

function _rocoRelDate(date) {
  const d = parseAscentDate(date);
  if (!d) return '–';
  const diffMs  = Date.now() - d.getTime();
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffDays === 0)  return 'hoy';
  if (diffDays === 1)  return 'ayer';
  if (diffDays < 7)   return `hace ${diffDays} d`;
  const weeks = Math.floor(diffDays / 7);
  if (weeks < 5)      return `hace ${weeks} sem`;
  const months = Math.floor(diffDays / 30);
  if (months < 12)    return `hace ${months} ${months === 1 ? 'mes' : 'meses'}`;
  const years = Math.floor(diffDays / 365);
  return `hace ${years} ${years === 1 ? 'año' : 'años'}`;
}

const _ROCO_AVATAR_COLORS = ['#534AB7', '#1D9E75', '#378ADD', '#E05A5A', '#BA7517', '#6B4E9E'];
function _rocoAvatarColor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return _ROCO_AVATAR_COLORS[h % _ROCO_AVATAR_COLORS.length];
}

function buildGymMisRocodromos(allAscents) {
  const wrap = document.getElementById('gym-mis-rocodromos');
  if (!wrap) return;

  // Solo ascensos de gym, excluir proyectos sin encadenar
  const gymSends = allAscents.filter(a => isGymAscent(a) && a.style !== 'project');

  if (gymSends.length === 0) {
    wrap.innerHTML = `
<div class="roco-section">
  <div class="roco-header">
    <span class="roco-title">Mis rocódromos</span>
    <button class="roco-map-btn" onclick="switchView('map-view')">Ver mapa</button>
  </div>
  <div class="roco-empty">
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity=".4"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
    <p>Sin sesiones en rocódromo</p>
    <span>Registra vías para ver tus estadísticas aquí</span>
  </div>
</div>`;
    return;
  }

  // Agrupar por schoolId (fallback a nombre normalizado)
  const gyms = new Map();
  gymSends.forEach(a => {
    const id   = a.schoolId || (a.schoolName || '').toLowerCase().replace(/\s+/g, '_') || 'unknown';
    const name = a.schoolName || id;
    const city = a.schoolCity || '';
    if (!gyms.has(id)) gyms.set(id, { id, name, city, sends: [] });
    gyms.get(id).sends.push(a);
  });

  // Métricas por gym  — orden: nº vías desc (criterio principal), luego última visita desc
  const gymList = [...gyms.values()].map(g => {
    const grades = g.sends.map(a => a.grade).filter(Boolean);
    const dates  = g.sends.map(a => parseAscentDate(a.date)).filter(Boolean);
    const lastDate = dates.length ? new Date(Math.max(...dates)) : null;
    return {
      id:        g.id,
      name:      g.name,
      city:      g.city,
      count:     g.sends.length,
      maxGrade:  _rocoMaxGrade(grades),
      avgGrade:  _rocoAvgGrade(grades),
      lastDate,
      lastDateRel: _rocoRelDate(lastDate),
      grades,
    };
  }).sort((a, b) => b.count - a.count || (b.lastDate || 0) - (a.lastDate || 0));

  // Agregados globales
  const allGrades = gymSends.map(a => a.grade).filter(Boolean);
  const globalMax   = _rocoMaxGrade(allGrades) || '–';
  const favoriteGym = gymList[0];
  const totalSends  = gymSends.length;

  // ── HTML de cards ──────────────────────────────────────────
  const cards = gymList.map(g => {
    const color    = _rocoAvatarColor(g.name);
    const initials = g.name.trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
    const isFav    = g.id === favoriteGym.id;
    const subLine  = [g.city, `${g.count} vía${g.count !== 1 ? 's' : ''}`].filter(Boolean).join(' · ');
    const favStar  = isFav ? '<span class="roco-card-star" aria-label="Favorito">★</span>' : '';

    return `<div class="roco-card" data-gym-id="${g.id}" role="button" tabindex="0">
  <div class="roco-card-top">
    <div class="roco-card-avatar" style="background:${color}">${initials}</div>
    <div class="roco-card-info">
      <div class="roco-card-name">${g.name}${favStar}</div>
      <div class="roco-card-sub">${subLine}</div>
    </div>
    <svg class="roco-card-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>
  </div>
  <div class="roco-card-stats">
    <div class="roco-stat"><div class="roco-stat-label">Más duro</div><div class="roco-stat-val">${g.maxGrade || '–'}</div></div>
    <div class="roco-stat"><div class="roco-stat-label">Promedio</div><div class="roco-stat-val">${g.avgGrade || '–'}</div></div>
    <div class="roco-stat"><div class="roco-stat-label">Última visita</div><div class="roco-stat-val">${g.lastDateRel}</div></div>
  </div>
</div>`;
  }).join('');

  // ── Calibración entre gimnasios ────────────────────────────
  let calibHtml = '';
  const calibGyms = gymList.filter(g => g.count >= MIN_VIAS_CALIBRACION && g.avgGrade);
  if (calibGyms.length >= 2) {
    const [a, b] = calibGyms;
    const idxA = _rocoGradeIndex(a.avgGrade);
    const idxB = _rocoGradeIndex(b.avgGrade);
    const diff = idxA - idxB; // positivo: A es más difícil
    if (Math.abs(diff) >= 1) {
      const [harder, easier, adjIdx] = diff > 0
        ? [a, b, idxA - diff]  // A más duro → un X en A = X-diff en B
        : [b, a, idxB + diff];
      const eqGrade = GYM_ROCO_GRADE_SCALE[Math.max(0, adjIdx)] || harder.avgGrade;
      calibHtml = `<div class="roco-calib">
  <div class="roco-calib-title">
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
    Calibración entre gimnasios
  </div>
  <div class="roco-calib-text">Tu <strong>${harder.avgGrade}</strong> en ${harder.name} equivale a un <strong>${eqGrade}</strong> en ${easier.name}</div>
</div>`;
    }
  }

  wrap.innerHTML = `
<div class="roco-section">
  <div class="roco-header">
    <div>
      <div class="roco-title">Mis rocódromos</div>
      <div class="roco-subtitle">${gymList.length} visitado${gymList.length !== 1 ? 's' : ''} · ${totalSends} vías encadenadas</div>
    </div>
    <button class="roco-map-btn" onclick="switchView('map-view')">Ver mapa
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="11" r="3"/><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/></svg>
    </button>
  </div>

  <div class="roco-summary">
    <div class="roco-sum-card">
      <div class="roco-sum-label">Grado tope</div>
      <div class="roco-sum-val">${globalMax}</div>
    </div>
    <div class="roco-sum-card">
      <div class="roco-sum-label">Favorito</div>
      <div class="roco-sum-fav">${favoriteGym.name}</div>
    </div>
  </div>

  <div class="roco-cards">${cards}</div>

  ${calibHtml}
</div>`;

  // Tap en card → mapa centrado en el gym
  wrap.querySelectorAll('.roco-card').forEach(card => {
    card.addEventListener('click', () => _navigateToGymOnMap(card.dataset.gymId));
    card.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') card.click();
    });
  });
}

// Navega al mapa y carga el gym. Reintenta hasta que el cache de
// pending_schools esté disponible (se rellena async al iniciar el mapa).
function _navigateToGymOnMap(gymId) {
  switchView('map-view');
  if (!gymId || typeof mlLoadSchool !== 'function') return;

  let attempts = 0;
  const MAX_ATTEMPTS = 8;   // ~2.8 s máx
  const INTERVAL_MS  = 350;

  const tryLoad = () => {
    const inCache  = window.mlPendingSchoolsCache?.has(gymId);
    const inStatic = typeof MAPLIBRE_SCHOOLS !== 'undefined' && !!MAPLIBRE_SCHOOLS[gymId];

    if (inCache || inStatic) {
      mlLoadSchool(gymId);
      return;
    }

    attempts++;
    if (attempts < MAX_ATTEMPTS) {
      setTimeout(tryLoad, INTERVAL_MS);
    }
    // Si agota reintentos: el mapa ya está abierto, el usuario puede navegar manualmente
  };

  // Pequeño delay inicial para que mlEnsureMapReady() haya arrancado
  setTimeout(tryLoad, 120);
}

// ============================================================
// GYM TEST HEADER — vanilla JS implementation
// ============================================================

let _gthUnsubDefs = null;
let _gthUnsubMeasures = null;
let _gthDefs = [];
let _gthMeasures = [];
let _gthAuthHooked = false;

// Built-in test templates (9 tests imprescindibles — Lattice/Eva López/Beastmaker)
const _GTH_TEMPLATES = [
  { key: 'max_hang',         name: 'Max Hangs',           unit: 'kg',     progressDirection: 'higher_is_better', requiredContext: ['edgeMm', 'bodyWeightKg'], defaults: { edgeMm: 20 }, description: 'Fuerza máxima de dedos en regleta de referencia' },
  { key: 'min_edge_7s',      name: 'Regleta mínima 7s',   unit: 'mm',     progressDirection: 'lower_is_better',  requiredContext: ['bodyWeightKg'],            description: 'Fuerza máxima relativa' },
  { key: 'repeaters_7_3',    name: 'Repeaters 7/3',       unit: 'reps',   progressDirection: 'higher_is_better', requiredContext: ['edgeMm', 'bodyWeightKg'], defaults: { edgeMm: 20 }, description: 'Resistencia de fuerza local' },
  { key: 'forty_sec_hang',   name: '40s en regleta',      unit: 'mm',     progressDirection: 'lower_is_better',  requiredContext: ['bodyWeightKg'],            description: 'Resistencia anaeróbica' },
  { key: 'max_pull_ups',     name: 'Dominadas máximas',   unit: 'reps',   progressDirection: 'higher_is_better', requiredContext: [],                          description: 'Fuerza tracción' },
  { key: 'weighted_pull_up', name: 'Dominada con lastre', unit: 'kg',     progressDirection: 'higher_is_better', requiredContext: ['bodyWeightKg'],            description: 'Potencia tracción' },
  { key: 'campus_1_5_9',     name: 'Campus 1-5-9',        unit: 'custom', customUnitLabel: 'listón', progressDirection: 'higher_is_better', requiredContext: [], description: 'Potencia de contacto' },
  { key: 'foot_on_campus',   name: 'Foot-on campus',      unit: 'custom', customUnitLabel: 'combo',  progressDirection: 'higher_is_better', requiredContext: [], description: 'Potencia controlada' },
  { key: 'boulder_test',     name: 'Test de bloque',      unit: 'grade',  progressDirection: 'higher_is_better', requiredContext: ['gymId'],                   description: 'Grado consolidado' },
];

function initTestHeader() {
  if (_gthAuthHooked) return;
  _gthAuthHooked = true;

  // Render an immediate skeleton/empty state so the section is visible
  _gthRender();

  firebase.auth().onAuthStateChanged((user) => {
    _gthTeardown();
    _gthDefs = [];
    _gthMeasures = [];

    if (!user) {
      _gthRender();
      return;
    }

    const db = firebase.firestore();
    const defsRef = db.collection('users').doc(user.uid).collection('test_definitions');
    const measRef = db.collection('users').doc(user.uid).collection('test_measurements');

    _gthUnsubDefs = defsRef.onSnapshot(
      async (snap) => {
        _gthDefs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        // Seed defaults if the user has never had any test definitions
        if (_gthDefs.length === 0) {
          await _gthSeedDefaults(defsRef);
        }
        _gthRender();
      },
      (err) => { console.error('[TestHeader] defs error', err); _gthRender(); }
    );

    _gthUnsubMeasures = measRef.onSnapshot(
      (snap) => {
        _gthMeasures = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        _gthRender();
      },
      (err) => console.error('[TestHeader] measures error', err)
    );
  });
}

async function _gthSeedDefaults(defsRef) {
  try {
    const now = firebase.firestore.FieldValue.serverTimestamp();
    const batch = firebase.firestore().batch();
    const DEFAULT_PINNED = new Set(['max_hang', 'min_edge_7s', 'forty_sec_hang']);
    _GTH_TEMPLATES.forEach((tpl, i) => {
      const docRef = defsRef.doc();
      const pinned = DEFAULT_PINNED.has(tpl.key);
      const data = {
        templateKey: tpl.key,
        name: tpl.name,
        description: tpl.description || '',
        unit: tpl.unit,
        progressDirection: tpl.progressDirection,
        requiredContext: tpl.requiredContext,
        defaults: tpl.defaults || {},
        pinned,
        order: pinned ? i : 1000 + i,
        enabledAt: now,
      };
      if (tpl.customUnitLabel) data.customUnitLabel = tpl.customUnitLabel;
      batch.set(docRef, data);
    });
    await batch.commit();
    console.log('[TestHeader] seeded default tests');
  } catch (e) {
    console.error('[TestHeader] seed failed', e);
  }
}

function _gthTeardown() {
  if (_gthUnsubDefs) { _gthUnsubDefs(); _gthUnsubDefs = null; }
  if (_gthUnsubMeasures) { _gthUnsubMeasures(); _gthUnsubMeasures = null; }
}

function _gthUnitLabel(def) {
  switch (def.unit) {
    case 'kg': return 'kg';
    case 'mm': return 'mm';
    case 'seconds': return 's';
    case 'reps': return 'reps';
    case 'percent_bw': return '% PC';
    case 'grade': return '';
    case 'custom': return def.customUnitLabel || '';
    default: return '';
  }
}

function _gthFormatDays(days) {
  if (days === null || days === undefined) return '';
  if (days === 0) return 'hoy';
  if (days === 1) return 'ayer';
  if (days < 30) return `hace ${days}d`;
  if (days < 365) return `hace ${Math.floor(days / 30)}m`;
  return `hace ${Math.floor(days / 365)}a`;
}

function _gthSparkline(values) {
  if (!values || values.length < 2) return '';
  const VW = 120, VH = 28, PAD = 2;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const pts = values.map((v, i) => {
    const x = PAD + (i / (values.length - 1)) * (VW - PAD * 2);
    const y = VH - PAD - ((v - min) / range) * (VH - PAD * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const lastV = values[values.length - 1];
  const dotY = (VH - PAD - ((lastV - min) / range) * (VH - PAD * 2)).toFixed(1);
  const dotX = (VW - PAD).toFixed(1);
  return `<svg class="gth-sparkline" viewBox="0 0 ${VW} ${VH}" aria-hidden="true">` +
    `<polyline points="${pts}" fill="none" stroke="var(--gym-color)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<circle cx="${dotX}" cy="${dotY}" r="2.2" fill="var(--gym-color)"/>` +
    `</svg>`;
}

function _gthBuildCardState(def, allMeasures) {
  const now = new Date().toISOString();
  const MS = 1000 * 60 * 60 * 24;
  const sorted = allMeasures
    .filter(m => m.testId === def.id)
    .map(m => {
      // Firestore Timestamp or ISO string
      const ts = m.measuredAt && m.measuredAt.toDate ? m.measuredAt.toDate().toISOString() : m.measuredAt;
      return { ...m, _iso: ts };
    })
    .sort((a, b) => a._iso < b._iso ? -1 : 1);

  if (sorted.length === 0) {
    return { def, latest: null, previous: null, delta: null, daysSince: null, sparkline: [] };
  }
  const latest = sorted[sorted.length - 1];
  const previous = sorted.length > 1 ? sorted[sorted.length - 2] : null;
  let delta = null;
  if (previous !== null) {
    const raw = latest.value - previous.value;
    delta = def.progressDirection === 'higher_is_better' ? raw : -raw;
  }
  const daysSince = Math.floor((new Date(now) - new Date(latest._iso)) / MS);
  const sparkline = sorted.slice(-8).map(m => m.value);
  return { def, latest, previous, delta, daysSince, sparkline };
}

function _gthCardHTML(state) {
  const { def, latest, delta, daysSince, sparkline } = state;
  const unit = _gthUnitLabel(def);
  const ctx = def.defaults && def.defaults.edgeMm
    ? `${def.defaults.edgeMm}mm`
    : (def.requiredContext && def.requiredContext.includes('bodyWeightKg') ? 'a PC' : '');

  let numStr = '—';
  let unitStr = '';
  if (latest) {
    if (def.unit === 'grade' && latest.gradeValue) {
      numStr = latest.gradeValue;
    } else {
      numStr = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 }).format(latest.value);
      unitStr = unit;
    }
  }

  let badgeClass = 'gth-badge--neutral';
  let badgeText = '= Sin datos';
  if (delta !== null) {
    if (delta > 0)  { badgeClass = 'gth-badge--positive'; badgeText = `↑ +${new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 }).format(delta)}${unit ? ' ' + unit : ''}`; }
    else if (delta < 0) { badgeClass = 'gth-badge--negative'; badgeText = `↓ ${new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 }).format(delta)}${unit ? ' ' + unit : ''}`; }
    else { badgeText = `= 0${unit ? ' ' + unit : ''}`; }
  }

  const daysStr = _gthFormatDays(daysSince);

  return `<article class="gth-card" data-test-id="${def.id}" role="button" tabindex="0" aria-label="${def.name}: ${numStr} ${unitStr}">
    <div class="gth-card-top">
      <span class="gth-card-name">${def.name.toUpperCase()}</span>
      ${ctx ? `<span class="gth-card-ctx">${ctx}</span>` : ''}
    </div>
    <div class="gth-card-value">${numStr}${unitStr ? `<span class="gth-card-unit"> ${unitStr}</span>` : ''}</div>
    <div class="gth-card-meta">
      <span class="gth-badge ${badgeClass}">${badgeText}</span>
      ${daysStr ? `<span class="gth-card-days">${daysStr}</span>` : ''}
    </div>
    ${_gthSparkline(sparkline)}
  </article>`;
}

function _gthRender() {
  const root = document.getElementById('test-header-root');
  if (!root) return;

  const pinned = _gthDefs
    .filter(d => d.pinned)
    .sort((a, b) => (a.order || 0) - (b.order || 0));

  const cardsHTML = pinned.map(def => {
    const state = _gthBuildCardState(def, _gthMeasures);
    return _gthCardHTML(state);
  }).join('');

  const addCardHTML = `<button class="gth-add-card" id="btn-gth-add" aria-label="Añadir test al header">
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" stroke-width="1.5" stroke-linecap="round" aria-hidden="true">
      <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
    </svg>
    <span class="gth-add-card-label">Añadir test<br>al header</span>
  </button>`;

  root.innerHTML = `<div class="gth-root">
    <div class="gth-header-row">
      <p class="gth-section-title">TESTS DE RENDIMIENTO</p>
      <button class="gth-btn-outline" id="btn-gth-configure">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="3"/>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
        </svg>
        Configurar tests
      </button>
    </div>
    <div class="gth-grid">
      ${pinned.length === 0 && _gthDefs.length === 0
        ? `<div class="gth-empty" style="grid-column:1/-1">Cargando tests…</div>`
        : cardsHTML + addCardHTML
      }
    </div>
    <button class="gth-btn-register" id="btn-gth-register">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true">
        <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
      </svg>
      Registrar nueva medición
    </button>
  </div>`;

  // Wire up click events after DOM update
  root.querySelector('#btn-gth-configure')?.addEventListener('click', _gthOpenConfigure);
  root.querySelector('#btn-gth-add')?.addEventListener('click', _gthOpenConfigure);
  root.querySelector('#btn-gth-register')?.addEventListener('click', () => _gthOpenRecord(null));
  root.querySelectorAll('.gth-card').forEach(card => {
    card.addEventListener('click', () => _gthOpenRecord(card.dataset.testId));
  });
}

// ============================================================
// Modal: Configurar tests (pin/unpin from catalogue)
// ============================================================
function _gthOpenConfigure() {
  const user = firebase.auth().currentUser;
  if (!user) return;

  // Index existing defs by templateKey
  const byKey = {};
  _gthDefs.forEach(d => { if (d.templateKey) byKey[d.templateKey] = d; });

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay gth-modal-overlay';
  overlay.innerHTML = `
    <div class="gth-modal">
      <div class="gth-modal-header">
        <h3>Configurar tests</h3>
        <button class="gth-modal-close" aria-label="Cerrar">×</button>
      </div>
      <p class="gth-modal-sub">Activa los tests que quieres ver en tu header.</p>
      <div class="gth-modal-list">
        ${_GTH_TEMPLATES.map(tpl => {
          const def = byKey[tpl.key];
          const pinned = def ? !!def.pinned : false;
          return `<label class="gth-modal-row">
            <div>
              <div class="gth-modal-row-name">${tpl.name}</div>
              <div class="gth-modal-row-desc">${tpl.description || ''}</div>
            </div>
            <input type="checkbox" data-tpl-key="${tpl.key}" ${pinned ? 'checked' : ''}>
          </label>`;
        }).join('')}
      </div>
      <div class="gth-modal-footer">
        <button class="gth-modal-btn-secondary" id="gth-cfg-cancel">Cancelar</button>
        <button class="gth-modal-btn-primary" id="gth-cfg-save">Guardar</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  overlay.querySelector('.gth-modal-close').onclick = close;
  overlay.querySelector('#gth-cfg-cancel').onclick = close;
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  overlay.querySelector('#gth-cfg-save').onclick = async () => {
    const db = firebase.firestore();
    const defsRef = db.collection('users').doc(user.uid).collection('test_definitions');
    const batch = db.batch();
    let order = 0;

    for (const tpl of _GTH_TEMPLATES) {
      const cb = overlay.querySelector(`input[data-tpl-key="${tpl.key}"]`);
      const wantPinned = cb.checked;
      const existing = byKey[tpl.key];

      if (existing) {
        if (existing.pinned !== wantPinned) {
          batch.update(defsRef.doc(existing.id), {
            pinned: wantPinned,
            order: wantPinned ? order++ : 1000 + order++,
          });
        } else if (wantPinned) {
          order++;
        }
      } else if (wantPinned) {
        // Create new definition for a template the user never had
        const docRef = defsRef.doc();
        const data = {
          templateKey: tpl.key,
          name: tpl.name,
          description: tpl.description || '',
          unit: tpl.unit,
          progressDirection: tpl.progressDirection,
          requiredContext: tpl.requiredContext,
          defaults: tpl.defaults || {},
          pinned: true,
          order: order++,
          enabledAt: firebase.firestore.FieldValue.serverTimestamp(),
        };
        if (tpl.customUnitLabel) data.customUnitLabel = tpl.customUnitLabel;
        batch.set(docRef, data);
      }
    }

    try {
      await batch.commit();
      close();
    } catch (e) {
      console.error('[TestHeader] save config failed', e);
      showToast('No se ha podido guardar', 'error', { detail: kxFriendlyError(e) });
    }
  };
}

// ============================================================
// Modal: Registrar nueva medición
// ============================================================
function _gthOpenRecord(preselectedTestId) {
  const user = firebase.auth().currentUser;
  if (!user) return;

  const pinned = _gthDefs.filter(d => d.pinned).sort((a, b) => (a.order || 0) - (b.order || 0));
  if (pinned.length === 0) {
    showToast('Primero configura algún test desde «Configurar tests»', 'warning');
    return;
  }
  const selectedId = preselectedTestId && pinned.find(d => d.id === preselectedTestId)
    ? preselectedTestId
    : pinned[0].id;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay gth-modal-overlay';
  overlay.innerHTML = `
    <div class="gth-modal">
      <div class="gth-modal-header">
        <h3>Registrar medición</h3>
        <button class="gth-modal-close" aria-label="Cerrar">×</button>
      </div>
      <div class="gth-modal-body">
        <label class="gth-field">
          <span>Test</span>
          <select id="gth-rec-test">
            ${pinned.map(d => `<option value="${d.id}" ${d.id === selectedId ? 'selected' : ''}>${d.name}</option>`).join('')}
          </select>
        </label>
        <div id="gth-rec-fields"></div>
        <label class="gth-field">
          <span>Fecha</span>
          <input type="date" id="gth-rec-date" value="${new Date().toISOString().slice(0, 10)}">
        </label>
      </div>
      <div class="gth-modal-footer">
        <button class="gth-modal-btn-secondary" id="gth-rec-cancel">Cancelar</button>
        <button class="gth-modal-btn-primary" id="gth-rec-save">Guardar</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  overlay.querySelector('.gth-modal-close').onclick = close;
  overlay.querySelector('#gth-rec-cancel').onclick = close;
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  const sel = overlay.querySelector('#gth-rec-test');
  const fieldsDiv = overlay.querySelector('#gth-rec-fields');

  function renderFields() {
    const def = pinned.find(d => d.id === sel.value);
    if (!def) return;
    const unit = _gthUnitLabel(def);
    let fieldsHTML = `<label class="gth-field">
      <span>Valor${unit ? ' (' + unit + ')' : ''}</span>
      <input type="${def.unit === 'grade' ? 'text' : 'number'}" step="any" id="gth-rec-value" required>
    </label>`;

    (def.requiredContext || []).forEach(ctx => {
      if (ctx === 'edgeMm') {
        const dflt = def.defaults && def.defaults.edgeMm ? def.defaults.edgeMm : '';
        fieldsHTML += `<label class="gth-field">
          <span>Regleta (mm)</span>
          <input type="number" step="1" id="gth-rec-ctx-edgeMm" value="${dflt}">
        </label>`;
      } else if (ctx === 'bodyWeightKg') {
        fieldsHTML += `<label class="gth-field">
          <span>Peso corporal (kg)</span>
          <input type="number" step="0.1" id="gth-rec-ctx-bodyWeightKg">
        </label>`;
      } else if (ctx === 'gymId') {
        fieldsHTML += `<label class="gth-field">
          <span>Rocódromo</span>
          <input type="text" id="gth-rec-ctx-gymId" placeholder="Nombre del rocódromo">
        </label>`;
      }
    });
    fieldsDiv.innerHTML = fieldsHTML;
  }

  sel.addEventListener('change', renderFields);
  renderFields();

  overlay.querySelector('#gth-rec-save').onclick = async () => {
    const def = pinned.find(d => d.id === sel.value);
    const valEl = overlay.querySelector('#gth-rec-value');
    const dateEl = overlay.querySelector('#gth-rec-date');
    const rawVal = valEl.value.trim();
    if (!rawVal) { valEl.focus(); return; }

    const context = {};
    (def.requiredContext || []).forEach(ctx => {
      const el = overlay.querySelector(`#gth-rec-ctx-${ctx}`);
      if (el && el.value !== '') {
        context[ctx] = ctx === 'gymId' ? el.value : parseFloat(el.value);
      }
    });

    const payload = {
      testId: def.id,
      value: def.unit === 'grade' ? 0 : parseFloat(rawVal),
      measuredAt: firebase.firestore.Timestamp.fromDate(new Date(dateEl.value)),
    };
    if (def.unit === 'grade') payload.gradeValue = rawVal;
    if (Object.keys(context).length > 0) payload.context = context;

    try {
      await firebase.firestore()
        .collection('users').doc(user.uid)
        .collection('test_measurements')
        .add(payload);
      close();
    } catch (e) {
      console.error('[TestHeader] save measurement failed', e);
      showToast('No se ha podido guardar', 'error', { detail: kxFriendlyError(e) });
    }
  };
}

function renderGymTimeline(ascents) {
  const listEl = document.getElementById('activity-list-gym');
  if (!listEl) return;
  if (ascents.length === 0) return;
  listEl.innerHTML = '';
  renderSessionCards(ascents, listEl, true);
}

function updateActivityRecords(allAscents) {
  const rockAscents = allAscents.filter(a => !isGymAscent(a));
  if (rockAscents.length === 0) return;

  const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

  // Highest grade
  const grades = rockAscents.map(a => a.grade).filter(Boolean);
  const maxGrade = findMaxGrade(grades) || '-';
  setEl('record-highest-grade', maxGrade);
  const topAscent = rockAscents.find(a => a.grade && a.grade.toLowerCase() === maxGrade.toLowerCase());
  setEl('record-highest-route', [topAscent?.routeName, topAscent?.schoolName || topAscent?.school].filter(Boolean).join(' · ') || '-');

  // Highest flash
  const flashAscents = rockAscents.filter(a => a.style === 'flash' || a.style === 'onsight');
  const flashGrades = flashAscents.map(a => a.grade).filter(Boolean);
  const maxFlash = findMaxGrade(flashGrades) || '-';
  setEl('record-highest-flash', maxFlash);
  const topFlash = flashAscents.find(a => a.grade && a.grade.toLowerCase() === maxFlash.toLowerCase());
  setEl('record-flash-route', [topFlash?.routeName, topFlash?.schoolName || topFlash?.school].filter(Boolean).join(' · ') || '-');

  // Streak
  const streak = calculateStreak(rockAscents);
  setEl('record-streak', streak > 0 ? streak + ' días' : '-');

  // Most routes in a day
  const dayMap = {};
  rockAscents.forEach(a => {
    const d = parseAscentDate(a.date);
    if (!d) return;
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    if (!dayMap[key]) dayMap[key] = { count: 0, date: d };
    dayMap[key].count++;
  });
  const bestDay = Object.values(dayMap).sort((a, b) => b.count - a.count)[0];
  if (bestDay) {
    setEl('record-most-day', bestDay.count);
    setEl('record-most-date', bestDay.date.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' }));
  }
}

// ========================================

function resetAllStats() {
  // Reset to empty state when user has no ascents
  // Slide 1: Rendimiento
  updateStatValue('stat-total-routes', '0');
  updateStatValue('stat-placeholder-1', '0');
  updateStatValue('stat-max-grade', '-');
  updateStatValue('stat-avg-grade', '-');
  updateStatValue('stat-flash-rate', '0%');
  updateStatValue('stat-main-style', '-');

  // Slide 2: Intentos y Valoración
  updateStatValue('stat-total-tries', '0');
  updateStatValue('stat-avg-tries', '0');
  updateStatValue('stat-rated-routes', '0');
  updateStatValue('stat-avg-rating', '-');

  // Slide 3: Escuelas y Sectores
  updateStatValue('stat-top-school', '-');
  updateStatValue('stat-schools-count', '0');
  updateStatValue('stat-top-sector', '-');
  updateStatValue('stat-sectors-count', '0');
}

function calculateAndUpdateStats(ascents) {
  if (!ascents || ascents.length === 0) {
    resetAllStats();
    return;
  }

  // Grade order for comparison
  const gradeOrder = ['4', '4+', '5', '5+', '6a', '6a+', '6b', '6b+', '6c', '6c+',
    '7a', '7a+', '7b', '7b+', '7c', '7c+', '8a', '8a+', '8b', '8b+', '8c', '8c+', '9a'];

  // Initialize counters
  const grades = [];
  const styles = {};
  const schools = {};
  const sectors = {};
  const climbingDays = new Set();
  let totalTries = 0;
  let totalRating = 0;
  let ratedCount = 0;
  let flashCount = 0;

  // Process each ascent
  ascents.forEach(ascent => {
    // Grades
    if (ascent.grade) grades.push(ascent.grade.toLowerCase());

    // Styles count
    if (ascent.style) {
      styles[ascent.style] = (styles[ascent.style] || 0) + 1;
      if (ascent.style === 'flash' || ascent.style === 'onsight') flashCount++;
    }

    // Climbing days (unique calendar dates)
    const d = parseAscentDate(ascent.date);
    if (d) climbingDays.add(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`);

    // Tries
    if (ascent.tries && ascent.tries > 0) totalTries += ascent.tries;

    // Rating
    if (ascent.rating && ascent.rating > 0) {
      totalRating += ascent.rating;
      ratedCount++;
    }

    // Schools and Sectors
    if (ascent.schoolName || ascent.school) {
      const schoolName = ascent.schoolName || ascent.school;
      schools[schoolName] = (schools[schoolName] || 0) + 1;
    }
    if (ascent.sectorName || ascent.sector) {
      const sectorName = ascent.sectorName || ascent.sector;
      sectors[sectorName] = (sectors[sectorName] || 0) + 1;
    }
  });

  // === SLIDE 1: Rendimiento ===
  updateStatValue('stat-total-routes', ascents.length);
  updateStatValue('stat-placeholder-1', climbingDays.size);

  const maxGrade = findMaxGrade(grades);
  updateStatValue('stat-max-grade', maxGrade || '-');

  const avgGrade = calculateAverageGrade(grades, gradeOrder);
  updateStatValue('stat-avg-grade', avgGrade || '-');

  const flashRate = ascents.length > 0 ? Math.round((flashCount / ascents.length) * 100) : 0;
  updateStatValue('stat-flash-rate', flashRate + '%');

  const mainStyle = getMainStyle(styles);
  updateStatValue('stat-main-style', mainStyle);

  // === SLIDE 2: Intentos y Valoración ===
  updateStatValue('stat-total-tries', totalTries);

  const avgTries = ascents.length > 0 ? (totalTries / ascents.length).toFixed(1) : 0;
  updateStatValue('stat-avg-tries', avgTries);

  updateStatValue('stat-rated-routes', ratedCount);

  const avgRating = ratedCount > 0 ? (totalRating / ratedCount).toFixed(1) : '-';
  updateStatValue('stat-avg-rating', avgRating !== '-' ? avgRating + '<small>/5</small>' : '-');

  // === SLIDE 3: Escuelas y Sectores ===
  // Escuela más visitada
  const topSchool = getTopItem(schools);
  updateStatValue('stat-top-school', topSchool || '-');

  // Nº de escuelas
  updateStatValue('stat-schools-count', Object.keys(schools).length);

  // Sector más visitado
  const topSector = getTopItem(sectors);
  updateStatValue('stat-top-sector', topSector || '-');

  // Nº de sectores
  updateStatValue('stat-sectors-count', Object.keys(sectors).length);
}

function calculateAverageGrade(grades, gradeOrder) {
  if (!grades || grades.length === 0) return null;

  let totalIndex = 0;
  let validGrades = 0;

  grades.forEach(grade => {
    const index = gradeOrder.indexOf(grade.toLowerCase());
    if (index !== -1) {
      totalIndex += index;
      validGrades++;
    }
  });

  if (validGrades === 0) return null;

  const avgIndex = Math.round(totalIndex / validGrades);
  return gradeOrder[avgIndex] || null;
}

function getMainStyle(styles) {
  if (!styles || Object.keys(styles).length === 0) return '-';

  const styleLabels = {
    flash: 'Flash',
    redpoint: 'Redpoint',
    onsight: 'A vista',
    project: 'Intento',
    toprope: 'Top rope'
  };

  let maxCount = 0;
  let mainStyle = null;

  Object.entries(styles).forEach(([style, count]) => {
    if (count > maxCount) {
      maxCount = count;
      mainStyle = style;
    }
  });

  return styleLabels[mainStyle] || mainStyle || '-';
}

function getTopItem(items) {
  if (!items || Object.keys(items).length === 0) return null;

  let maxCount = 0;
  let topItem = null;

  Object.entries(items).forEach(([item, count]) => {
    if (count > maxCount) {
      maxCount = count;
      topItem = item;
    }
  });

  return topItem;
}

function updateStatValue(id, value) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = value;
}

function findMaxGrade(grades) {
  // Simple grade comparison (Spanish/French grades)
  const gradeOrder = ['4', '4+', '5', '5+', '6a', '6a+', '6b', '6b+', '6c', '6c+',
    '7a', '7a+', '7b', '7b+', '7c', '7c+', '8a', '8a+', '8b', '8b+', '8c', '8c+', '9a'];

  let maxIndex = -1;
  let maxGrade = null;

  grades.forEach(grade => {
    const index = gradeOrder.indexOf(grade.toLowerCase());
    if (index > maxIndex) {
      maxIndex = index;
      maxGrade = grade;
    }
  });

  return maxGrade;
}

let _allActivityAscents = [];

function filterActivitySessions(filter) {
  if (!_allActivityAscents.length) return;
  const filtered = filter === 'all'
    ? _allActivityAscents
    : _allActivityAscents.filter(a => a.style === filter);
  const listEl = document.getElementById('activity-list');
  if (!listEl) return;
  listEl.innerHTML = '';
  if (filtered.length === 0) {
    listEl.innerHTML = '<div class="activity-empty-state"><h3>Sin ascensiones para este filtro</h3></div>';
    return;
  }
  renderSessionCards(filtered, listEl, false);
}

function renderSessionCards(ascents, container, isGym) {
  const styleMap = { flash: 'F', redpoint: 'R', onsight: 'O', project: 'P', toprope: 'T' };
  const styleDot = { flash: 'act-sd-yellow', redpoint: 'act-sd-red', onsight: 'act-sd-blue', project: 'act-sd-gray', toprope: 'act-sd-gray' };

  const sessions = {};
  ascents.forEach(a => {
    const d = parseAscentDate(a.date);
    const dateKey = d
      ? d.getFullYear() + '-' + String(d.getMonth()).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0')
      : 'unknown';
    const sector = a.sectorName || a.sector || 'Sector desconocido';
    const key = dateKey + '__' + sector;
    if (!sessions[key]) sessions[key] = { date: d, sector, school: a.schoolName || a.school || '', ascents: [] };
    sessions[key].ascents.push(a);
  });

  Object.values(sessions).forEach(function(session) {
    const grades = session.ascents.map(a => a.grade).filter(Boolean);
    const topGrade = findMaxGrade(grades) || '-';
    const styles = [...new Set(session.ascents.map(a => a.style).filter(Boolean))];
    const dateStr = session.date
      ? session.date.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })
      : '';
    const locationStr = [dateStr, session.school, session.sector].filter(Boolean).join(' · ');

    let avgGrade = '-';
    if (grades.length > 0) {
      const avgIdx = Math.round(grades.reduce(function(acc, g) { return acc + (GRADE_ORDER.indexOf(g.toLowerCase()) || 0); }, 0) / grades.length);
      avgGrade = GRADE_ORDER[avgIdx] || '-';
    }

    const dotsHtml = styles.map(s =>
      '<div class="act-style-dot ' + (styleDot[s] || 'act-sd-gray') + '" title="' + s + '">' + (styleMap[s] || '?') + '</div>'
    ).join('');

    const card = document.createElement('div');
    card.className = 'act-session-card';
    card.innerHTML =
      '<div class="act-session-left">' +
        '<div class="act-session-date">' + locationStr + '</div>' +
        '<div class="act-session-sector">' + session.sector + '</div>' +
        '<div class="act-session-meta">' + session.ascents.length + ' vía' + (session.ascents.length !== 1 ? 's' : '') + ' · Grado medio ' + avgGrade + '</div>' +
      '</div>' +
      '<div class="act-session-right">' +
        '<div class="act-session-grade">' + topGrade + '</div>' +
        '<div class="act-session-styles">' + dotsHtml + '</div>' +
      '</div>';
    container.appendChild(card);
  });
}

function renderActivityList(ascents) {
  _allActivityAscents = ascents.filter(a => !isGymAscent(a));
  const activityList = document.getElementById('activity-list');
  if (!activityList) return;

  const emptyState = activityList.querySelector('.activity-empty-state');
  activityList.innerHTML = '';

  if (_allActivityAscents.length === 0) {
    if (emptyState) activityList.appendChild(emptyState);
    return;
  }

  renderSessionCards(_allActivityAscents, activityList, false);
}


// ========================================
// ASCENT LOGBOOK
// ========================================

let logbookAscents = []; // Full list fetched from Firestore
let logbookFiltered = []; // Currently filtered subset

const STYLE_LABELS = {
  redpoint: 'Redpoint',
  onsight: 'A vista',
  flash: 'Flash',
  toprope: 'Top Rope',
  project: 'Intento'
};

function initLogbook() {
  // Make climbing stats card clickable
  const statsCard = document.querySelector('.profile-card-ig');
  if (statsCard) {
    statsCard.classList.add('clickable');
    const header = statsCard.querySelector('.profile-card-header-ig');
    if (header) {
      header.classList.add('clickable-header');
      // Add chevron indicator
      if (!header.querySelector('.logbook-chevron')) {
        const chevron = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        chevron.setAttribute('class', 'logbook-chevron');
        chevron.setAttribute('width', '14');
        chevron.setAttribute('height', '14');
        chevron.setAttribute('viewBox', '0 0 24 24');
        chevron.setAttribute('fill', 'none');
        chevron.setAttribute('stroke', 'currentColor');
        chevron.setAttribute('stroke-width', '2');
        chevron.setAttribute('stroke-linecap', 'round');
        chevron.setAttribute('stroke-linejoin', 'round');
        const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
        polyline.setAttribute('points', '9 18 15 12 9 6');
        chevron.appendChild(polyline);
        header.appendChild(chevron);
      }
    }
    statsCard.addEventListener('click', openLogbook);
  }

  // Close button
  const closeBtn = document.getElementById('close-logbook-btn');
  if (closeBtn) {
    closeBtn.addEventListener('click', closeLogbook);
  }

  // Filters
  const schoolFilter = document.getElementById('logbook-filter-school');
  const sectorFilter = document.getElementById('logbook-filter-sector');
  const gradeFilter = document.getElementById('logbook-filter-grade');
  const styleFilter = document.getElementById('logbook-filter-style');
  if (schoolFilter) schoolFilter.addEventListener('change', () => {
    populateSectorFilter(logbookAscents);
    applyLogbookFilters();
  });
  if (sectorFilter) sectorFilter.addEventListener('change', applyLogbookFilters);
  if (gradeFilter) gradeFilter.addEventListener('change', applyLogbookFilters);
  if (styleFilter) styleFilter.addEventListener('change', applyLogbookFilters);

}

function showConfirmModal(title, message, onConfirm) {
  const modal = document.getElementById('confirm-modal');
  const titleEl = document.getElementById('confirm-title');
  const msgEl = document.getElementById('confirm-message');
  const okBtn = document.getElementById('confirm-ok');
  const cancelBtn = document.getElementById('confirm-cancel');
  if (!modal || !okBtn || !cancelBtn) return;

  if (titleEl) titleEl.textContent = title;
  if (msgEl) msgEl.textContent = message;
  modal.classList.remove('hidden');

  const close = () => modal.classList.add('hidden');

  const handleOk = () => { close(); onConfirm(); cleanup(); };
  const handleCancel = () => { close(); cleanup(); };
  const handleBackdrop = (e) => { if (e.target === modal) { close(); cleanup(); } };

  const cleanup = () => {
    okBtn.removeEventListener('click', handleOk);
    cancelBtn.removeEventListener('click', handleCancel);
    modal.removeEventListener('click', handleBackdrop);
  };

  okBtn.addEventListener('click', handleOk);
  cancelBtn.addEventListener('click', handleCancel);
  modal.addEventListener('click', handleBackdrop);
}

async function openLogbook() {
  const modal = document.getElementById('ascent-logbook-modal');
  if (!modal) return;

  modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';

  // Show loading state
  const list = document.getElementById('logbook-list');
  if (list) {
    list.innerHTML = '<div style="display:flex;justify-content:center;padding:40px;"><div class="spinner"></div></div>';
  }

  try {
    // Fetch all ascents for the current profile user
    const userId = getCurrentProfileUserId();
    if (!userId) {
      renderLogbookEmpty('No se pudo identificar al usuario');
      return;
    }

    const ascents = await getUserAscentsByUserId(userId, 500);

    // Sort by date descending (most recent first)
    ascents.sort((a, b) => {
      const dateA = a.date instanceof Date ? a.date : new Date(a.date);
      const dateB = b.date instanceof Date ? b.date : new Date(b.date);
      return dateB - dateA;
    });

    logbookAscents = ascents;
    logbookFiltered = ascents;

    populateSchoolFilter(ascents);
    populateSectorFilter(ascents);
    populateGradeFilter(ascents);
    applyLogbookFilters();

  } catch (error) {
    console.error('Error loading logbook:', error);
    renderLogbookEmpty('Error al cargar las ascensiones');
  }
}

function closeLogbook() {
  const modal = document.getElementById('ascent-logbook-modal');
  if (modal) {
    modal.classList.add('hidden');
    document.body.style.overflow = '';
  }
}

function getCurrentProfileUserId() {
  // If viewing another user's profile, return their ID
  if (currentProfileUserId) {
    return currentProfileUserId;
  }
  // Otherwise return logged-in user's ID
  if (typeof currentUser !== 'undefined' && currentUser && currentUser.uid) {
    return currentUser.uid;
  }
  return null;
}

function populateSchoolFilter(ascents) {
  const select = document.getElementById('logbook-filter-school');
  if (!select) return;

  const schools = [...new Set(ascents.map(a => a.schoolName).filter(s => s && s.trim() !== ''))];
  schools.sort((a, b) => a.localeCompare(b, 'es'));

  const currentVal = select.value;
  select.innerHTML = '<option value="">Todas las escuelas</option>';
  schools.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s;
    opt.textContent = s;
    select.appendChild(opt);
  });
  if (currentVal && schools.includes(currentVal)) {
    select.value = currentVal;
  }
}

function populateSectorFilter(ascents) {
  const select = document.getElementById('logbook-filter-sector');
  if (!select) return;

  const schoolVal = document.getElementById('logbook-filter-school')?.value || '';
  const filtered = schoolVal ? ascents.filter(a => a.schoolName === schoolVal) : ascents;
  const sectors = [...new Set(filtered.map(a => a.sector).filter(s => s && s.trim() !== ''))];
  sectors.sort((a, b) => a.localeCompare(b, 'es'));

  const currentVal = select.value;
  select.innerHTML = '<option value="">Todos los sectores</option>';
  sectors.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s;
    opt.textContent = s;
    select.appendChild(opt);
  });
  if (currentVal && sectors.includes(currentVal)) {
    select.value = currentVal;
  }
}

function populateGradeFilter(ascents) {
  const gradeSelect = document.getElementById('logbook-filter-grade');
  if (!gradeSelect) return;

  const grades = [...new Set(ascents.map(a => a.grade).filter(g => g && g.trim() !== ''))];
  const compareFunc = typeof compareGradesLocal === 'function' ? compareGradesLocal : (a, b) => a.localeCompare(b);
  grades.sort(compareFunc);

  // Keep selected value if possible
  const currentVal = gradeSelect.value;
  gradeSelect.innerHTML = '<option value="">Todos los grados</option>';
  grades.forEach(g => {
    const opt = document.createElement('option');
    opt.value = g;
    opt.textContent = g;
    gradeSelect.appendChild(opt);
  });
  if (currentVal && grades.includes(currentVal)) {
    gradeSelect.value = currentVal;
  }
}

function applyLogbookFilters() {
  const schoolVal = document.getElementById('logbook-filter-school')?.value || '';
  const sectorVal = document.getElementById('logbook-filter-sector')?.value || '';
  const gradeVal = document.getElementById('logbook-filter-grade')?.value || '';
  const styleVal = document.getElementById('logbook-filter-style')?.value || '';

  logbookFiltered = logbookAscents.filter(a => {
    if (schoolVal && a.schoolName !== schoolVal) return false;
    if (sectorVal && a.sector !== sectorVal) return false;
    if (gradeVal && a.grade !== gradeVal) return false;
    if (styleVal && a.style !== styleVal) return false;
    return true;
  });

  const hasFilter = schoolVal || sectorVal || gradeVal || styleVal;

  // Update result count
  const countEl = document.getElementById('logbook-result-count');
  if (countEl) {
    const total = logbookAscents.length;
    const shown = logbookFiltered.length;
    countEl.textContent = hasFilter
      ? `${shown} de ${total} ascensiones`
      : `${total} ascensiones`;
  }

  renderLogbookList(logbookFiltered);
}

function renderLogbookList(ascents) {
  const list = document.getElementById('logbook-list');
  if (!list) return;

  if (!ascents || ascents.length === 0) {
    const schoolVal = document.getElementById('logbook-filter-school')?.value || '';
    const sectorVal = document.getElementById('logbook-filter-sector')?.value || '';
    const gradeVal = document.getElementById('logbook-filter-grade')?.value || '';
    const styleVal = document.getElementById('logbook-filter-style')?.value || '';
    const isFiltered = schoolVal || sectorVal || gradeVal || styleVal;

    renderLogbookEmpty(
      isFiltered ? 'No hay ascensiones con esos filtros' : null
    );
    return;
  }

  let html = '';
  ascents.forEach(ascent => {
    const dateObj = ascent.date instanceof Date ? ascent.date : new Date(ascent.date);
    const dateStr = dateObj.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });

    const styleSVG = typeof getAscentStyleSVG === 'function' ? getAscentStyleSVG(ascent.style) : '';
    const styleLabel = STYLE_LABELS[ascent.style] || ascent.style || '';
    const styleClass = ascent.style ? `ascent-style-${ascent.style}` : '';
    const isProject = ascent.style === 'project';
    const isChained = !isProject && ascent.style && ascent.style !== 'project';

    const checkHtml = isChained ? `
      <span class="logbook-item-check">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
      </span>
    ` : '';

    html += `
      <div class="logbook-item">
        <div class="logbook-item-grade ${isProject ? 'grade-project' : ''}">${ascent.grade || '?'}</div>
        <div class="logbook-item-body">
          <div class="logbook-item-name">${ascent.routeName || 'Sin nombre'}</div>
          <div class="logbook-item-location">${ascent.schoolName || ''}${ascent.sector ? ' · ' + ascent.sector : ''}</div>
        </div>
        <div class="logbook-item-right">
          <div class="logbook-item-date">${dateStr}</div>
          <div class="logbook-item-style ${styleClass}">
            ${styleSVG}
            <span>${styleLabel}</span>
            ${checkHtml}
          </div>
        </div>
        ${!currentProfileUserId ? `<button class="logbook-item-delete" data-ascent-id="${ascent.id}" data-school-id="${ascent.schoolId || ''}" data-route-id="${ascent.routeId || ''}" title="Eliminar ascensión">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path>
            <path d="M10 11v6M14 11v6"></path>
            <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path>
          </svg>
        </button>` : ''}
      </div>
    `;
  });

  list.innerHTML = html;

  // Attach delete listeners directly to each button
  list.querySelectorAll('.logbook-item-delete').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const { ascentId, schoolId, routeId } = btn.dataset;
      showConfirmModal('Eliminar ascensión', '¿Seguro que quieres eliminar esta ascensión?', async () => {
        const ok = await deleteAscent(ascentId, schoolId, routeId);
        if (ok) {
          logbookAscents = logbookAscents.filter(a => a.id !== ascentId);
          logbookFiltered = logbookFiltered.filter(a => a.id !== ascentId);
          const countEl = document.getElementById('logbook-result-count');
          if (countEl) {
            const total = logbookFiltered.length;
            countEl.textContent = total === 1 ? '1 ascensión' : `${total} ascensiones`;
          }
          renderLogbookList(logbookFiltered);
        }
      });
    });
  });
}

function renderLogbookEmpty(message) {
  const list = document.getElementById('logbook-list');
  if (!list) return;

  list.innerHTML = `
    <div class="logbook-empty">
      <div class="logbook-empty-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="m8 3 4 8 5-5 5 15H2L8 3z" />
        </svg>
      </div>
      <div class="logbook-empty-title">${message || 'Sin ascensiones'}</div>
      <div class="logbook-empty-text">${message ? 'Prueba a cambiar los filtros' : 'Registra tu primera ascensión desde la ficha de una vía'}</div>
    </div>
  `;
}

// Initialize on load
document.addEventListener('DOMContentLoaded', () => {
  initEditProfile();
  initSocialListModal(); // Initialize social list modal listeners
  initSettingsDropdown();
  initCreatePost();
  initViewPostModal();
  initActivityView();
  initLogbook();
  initProgressCards();
  initTrainView();
});

// ── Datos compartidos de sesión (train view ↔ session module) ──────────
// Sin plan activo se muestra esta sesión marcada como «Ejemplo» para poder probar el modo activo.
window.kruxTrainData = {
  name: 'Fuerza en media llave',
  demo: true,
  exercises: [
    { name: 'Max hang · 20mm',      sets: 4, workSec: 10, reps: 0,  weight: 20, restSec: 180, rpeTarget: 8 },
    { name: 'Campus board · 1-5-9', sets: 3, workSec: 0,  reps: 5,  weight: 0,  restSec: 120, rpeTarget: 7 },
    { name: 'Pullover isométrico',  sets: 3, workSec: 7,  reps: 0,  weight: 0,  restSec: 120, rpeTarget: 6 },
    { name: 'Manguito rotador',     sets: 2, workSec: 0,  reps: 15, weight: 0,  restSec: 60,  rpeTarget: 0 },
  ]
};
const KRUX_TRAIN_DEMO = window.kruxTrainData;

// Sesiones realizadas (se cargan de la cuenta al iniciar sesión)
window.kruxTrainLog = window.kruxTrainLog || [];

// Interruptor de la arquitectura de múltiples planes (users/{uid}/training_plans). Activado por defecto.
// Apagado en un dispositivo (?multiplan=0): Entrena vuelve a usar users/{uid}/training_plan/active, que nunca se modifica.
window.KRUX_MULTIPLAN = (() => {
  // ?multiplan=0 lo apaga en este dispositivo (se recuerda); ?multiplan=1 lo vuelve a encender
  try {
    const q = new URLSearchParams(location.search).get('multiplan');
    if (q === '0') localStorage.setItem('krux.multiplan', '0');
    else if (q === '1') localStorage.removeItem('krux.multiplan');
    return q === '0' ? false : q === '1' ? true : localStorage.getItem('krux.multiplan') !== '0';
  } catch (_) { return new URLSearchParams(location.search).get('multiplan') !== '0'; }
})();


// ============================================
// PERSISTENCIA DE ENTRENA (Firestore)
// ============================================
// users/{uid}/training_plan/active        → plan activo
// users/{uid}/training_sessions/{autoId}  → sesiones realizadas
const KruxTrainStore = (() => {
  const SESSION_WEEKS = 12; // historial que se carga al iniciar sesión
  let planTouched = false;  // el usuario guardó un plan antes de que terminase la carga

  const uid = () => (firebase.auth().currentUser || {}).uid || null;
  const userRef = () => db.collection('users').doc(uid());

  // Sin red, Firestore deja la escritura en cola y la promesa no se resuelve nunca: se corta a
  // los 15 s para poder avisar. La escritura puede aplicarse luego; reintentar es seguro porque
  // el plan es un único documento y cada sesión conserva su propio id.
  const ACK_MS = 15000;
  const ack = (promise, ms) => Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error('Sin respuesta del servidor'), { code: 'kx/timeout' })), ms || ACK_MS))
  ]);
  const int = v => Math.max(0, Math.round(Number(v) || 0));
  const str = (v, max) => String(v ?? '').slice(0, max);

  // Transacción con límite de tiempo que NO se aplica más tarde: si falla o se agota el tiempo (sin red), se
  // marca como cancelada. El SDK puede reintentarla o reanudar sus lecturas al volver la conexión, y entonces
  // cualquier lectura o escritura aborta en vez de ejecutar una acción (archivar, borrar, activar…) de la que
  // ya se avisó que había fallado. Cada intento tiene además un plazo propio.
  function txRun(run) {
    if (navigator.onLine === false) return Promise.reject(Object.assign(new Error('Sin conexión'), { code: 'kx/offline' }));
    let cancelled = false;
    const deadline = Date.now() + 12000;
    const dead = () => cancelled || Date.now() > deadline;
    const stop = () => Object.assign(new Error('Cancelada'), { code: 'kx/cancelled' });
    const p = db.runTransaction(async tx => {
      if (dead()) throw stop();
      const safe = {
        get: async (...a) => { const r = await tx.get(...a); if (dead()) throw stop(); return r; },
        set: (...a) => { if (dead()) throw stop(); return tx.set(...a); },
        update: (...a) => { if (dead()) throw stop(); return tx.update(...a); },
        delete: (...a) => { if (dead()) throw stop(); return tx.delete(...a); }
      };
      return run(safe);
    });
    return ack(p).then(r => r, error => { cancelled = true; throw error; });
  }

  // Prescripción plana (compatible con planes e historial anteriores) + referencia opcional a la ficha.
  // La ficha nunca se copia: solo exerciseId y la versión de contenido con la que se añadió.
  function exercisePayload(e) {
    const out = { name: str(e.name, 80), sets: Math.max(1, int(e.sets)), workSec: int(e.workSec), reps: int(e.reps), weight: Math.max(0, Number(e.weight) || 0), restSec: int(e.restSec), rpeTarget: Math.min(10, int(e.rpeTarget)) };
    if (e.exerciseId) {
      out.exerciseId = str(e.exerciseId, 80);
      out.exerciseContentVersion = Math.max(1, int(e.exerciseContentVersion) || 1);
    }
    if (e.notes) out.notes = str(e.notes, 300);
    if (Number(e.assistanceKg) > 0) out.assistanceKg = Math.min(80, Number(e.assistanceKg));
    if (Number(e.distanceM) > 0) out.distanceM = Math.min(5000, int(e.distanceM));
    if (Number(e.recoverySec) > 0) out.recoverySec = Math.min(1800, int(e.recoverySec));
    if (typeof e.tempo === 'string' && /^\d{1,2}(-\d{1,2}){1,3}$/.test(e.tempo)) out.tempo = e.tempo;
    return out;
  }

  function planPayload(plan) {
    const out = {
      name: str(plan.name || 'Mi plan', 80),
      weeks: Math.min(16, Math.max(1, int(plan.weeks) || 4)),
      activeDays: Array.from({ length: 7 }, (_, i) => !!(plan.activeDays || [])[i]),
      sessions: (plan.sessions || []).slice(0, 7).map(sess => ({
        day: str(sess.day, 2),
        name: str(sess.name, 80),
        exercises: (sess.exercises || []).slice(0, 30).map(exercisePayload)
      }))
    };
    // Respuestas del asistente (opcionales): permiten reabrir el plan con su contexto
    if (plan.goal) out.goal = str(plan.goal, 20);
    if (plan.level >= 1 && plan.level <= 3) out.level = Math.round(plan.level);
    if (Array.isArray(plan.equipment)) out.equipment = plan.equipment.slice(0, 10).map(x => str(x, 20));
    return out;
  }

  function sessionPayload(rec) {
    return {
      dateKey: str(rec.dateKey, 10),
      sessionName: str(rec.sessionName, 80),
      ...(rec.planId ? { planId: str(rec.planId, 60), planName: str(rec.planName, 80) } : {}),
      ...(rec.planRevision ? { planRevision: int(rec.planRevision) } : {}),
      ...(rec.planSessionId ? { planSessionId: str(rec.planSessionId, 60) } : {}),
      startedAt: Number(rec.startedAt) || Date.now(),
      durationSec: int(rec.durationSec),
      exercises: rec.exercises.slice(0, 30).map(e => ({
        name: str(e.name, 80),
        ...(e.exerciseId ? { exerciseId: str(e.exerciseId, 80), exerciseContentVersion: Math.max(1, int(e.exerciseContentVersion) || 1) } : {}),
        target: exercisePayload({ name: e.name, ...e.target }),
        sets: e.sets.slice(0, 50).map(st => ({
          n: int(st.n), workSec: int(st.workSec), reps: int(st.reps), weight: Math.max(0, Number(st.weight) || 0), rpe: Math.min(10, int(st.rpe)), time: str(st.time, 5),
          ...(Number(st.assistanceKg) > 0 ? { assistanceKg: Math.min(80, Number(st.assistanceKg)) } : {})
        }))
      }))
    };
  }

  function reportError(title, error) {
    console.error(title, error);
    if (typeof showToast === 'function') {
      showToast(title, 'error', { detail: typeof kxFriendlyError === 'function' ? kxFriendlyError(error) : 'Inténtalo de nuevo.' });
    }
  }


  // ══════════════════════════════════════════════════════════════════
  // MÚLTIPLES PLANES  (solo con window.KRUX_MULTIPLAN)
  //   training_plans/{planId}        un documento por plan (modelo: train-plans.js)
  //   training_state/current         { activePlanId } → el plan activo es un puntero
  // Todo cambio que afecta a varios documentos va en una transacción: nunca queda un plan archivado
  // apuntado como activo, ni dos activos. Ninguna operación escribe en training_plan/active.
  // ══════════════════════════════════════════════════════════════════
  const MULTI = () => !!window.KRUX_MULTIPLAN && !!window.KruxPlans;
  const PL = () => window.KruxPlans;
  const plansCol = () => userRef().collection('training_plans');
  const stateRef = () => userRef().collection('training_state').doc('current');
  const legacyRef = () => userRef().collection('training_plan').doc('active');
  const stamp = () => firebase.firestore.FieldValue.serverTimestamp();
  const kxError = (code, message) => Object.assign(new Error(message || code), { code });
  const fromDoc = d => ({ id: d.id, ...d.data() });

  function publish(plans, state) {
    window.kruxPlans = plans;
    window.kruxPlanState = state || { activePlanId: null };
    // Vista del plan activo: el resto de Entrena sigue leyendo window.kruxActivePlan
    window.kruxActivePlan = PL().resolveActive(plans, window.kruxPlanState);
  }

  function clearPlans() {
    window.kruxPlans = [];
    window.kruxPlanState = { activePlanId: null };
    window.kruxPlanNotice = null;
  }

  // Cambiar de plan o destruir datos no se puede hacer a mitad de un entrenamiento
  function sessionBlocks() {
    if (window.KruxTrainSession && window.KruxTrainSession.isRunning()) {
      if (typeof showToast === 'function') showToast('Hay un entrenamiento en curso', 'info', { detail: 'Termínalo o abandónalo antes de cambiar de plan.' });
      return true;
    }
    return false;
  }

  const stateFor = (prev, activePlanId) => ({
    activePlanId,
    migratedAt: (prev && prev.migratedAt) || stamp(),
    migratedFrom: prev && prev.migratedFrom !== undefined ? prev.migratedFrom : null,
    updatedAt: stamp()
  });

  // Migración perezosa del documento antiguo. Idempotente: id fijo + transacción; nunca sobrescribe
  // un plan existente ni toca training_plan/active. Devuelve 'migrated' | 'already' | 'nothing' | 'completed'.
  async function migrate() {
    return txRun(async tx => {
      const planRef = plansCol().doc(PL().LEGACY_PLAN_ID);
      const [st, legacy, existing] = await Promise.all([tx.get(stateRef()), tx.get(legacyRef()), tx.get(planRef)]);
      const prev = st.exists ? st.data() : null;
      if (prev && prev.migratedAt) return 'already';
      if (!legacy.exists) return 'nothing';
      if (existing.exists) {
        // Un intento anterior creó el plan pero no el marcador: solo se completa el marcador
        if (existing.data().migratedFrom !== 'training_plan/active') throw kxError('kx/migration-conflict', 'Ya existe un plan con el identificador de la migración y no procede de ella.');
        tx.set(stateRef(), { ...stateFor({ migratedFrom: 'training_plan/active' }, prev && prev.activePlanId ? prev.activePlanId : PL().LEGACY_PLAN_ID) });
        return 'completed';
      }
      tx.set(planRef, PL().fromLegacy(legacy.data(), stamp()));
      tx.set(stateRef(), stateFor({ migratedFrom: 'training_plan/active' }, prev && prev.activePlanId ? prev.activePlanId : PL().LEGACY_PLAN_ID));
      return 'migrated';
    });
  }

  // ¿Hay cambios en el documento antiguo hechos después de migrar (con una versión antigua de la app)?
  async function detectLegacyDrift(state) {
    try {
      if (!state || !state.migratedAt || state.migratedFrom !== 'training_plan/active') return false;
      const doc = await legacyRef().get();
      const t = doc.exists && doc.data().updatedAt;
      return !!(t && t.seconds != null && t.seconds > state.migratedAt.seconds + 1);
    } catch (_) { return false; }
  }

  // Tras una escritura que YA se confirmó en el servidor, recargar la vista no puede convertirla en un error:
  // si falla la lectura (p. ej. se perdió la conexión justo después), se aplica el cambio en memoria.
  const nowTs = () => ({ seconds: Math.floor(Date.now() / 1000), nanoseconds: 0 });
  async function settle(patch) {
    try { await refreshPlans(); }
    catch (_) {
      const plans = (window.kruxPlans || []).map(p => ({ ...p }));
      const state = { ...(window.kruxPlanState || { activePlanId: null }) };
      patch(plans, state);
      publish(plans, state);
    }
  }

  async function refreshPlans() {
    const [stateDoc, snap] = await Promise.all([stateRef().get(), plansCol().get()]);
    const state = stateDoc.exists ? stateDoc.data() : null;
    publish(snap.docs.map(fromDoc), state);
    writeCache();
    return state;
  }

  async function loadPlans() {
    planTouched = false;
    window.kruxPlanNotice = null;
    try {
      await q.migrate();
    } catch (error) {
      // Conflicto o fallo: no se elige una versión en silencio; se avisa y se puede reintentar
      window.kruxPlanNotice = { type: 'migration-error', code: error.code || '' };
      reportError('No se han podido preparar tus planes', error);
    }
    const state = await refreshPlans();
    if (!window.kruxPlanNotice && await detectLegacyDrift(state)) window.kruxPlanNotice = { type: 'legacy-drift' };
    await announceSchedule(await q.applySchedule());
  }

  function announceSchedule(res) {
    if (res && res.applied && typeof showToast === 'function') showToast(`Hoy empieza «${res.applied.name}»`, 'success', { detail: 'Ya es tu plan activo.' });
  }

  async function createPlan(content, opts) {
    if (!uid()) return null;
    const activate = !!(opts && opts.activate);
    const ref = plansCol().doc();
    try {
      await txRun(async tx => {
        const st = await tx.get(stateRef());
        const prev = st.exists ? st.data() : null;
        tx.set(ref, PL().createPlan(content, stamp(), (opts && opts.extra) || {}));
        // El puntero solo se escribe si se activa el plan nuevo o si todavía no existía el documento de estado
        if (activate || !prev) tx.set(stateRef(), stateFor(prev, activate ? ref.id : null));
      });
      await settle((plans, state) => {
        plans.push({ id: ref.id, ...PL().createPlan(content, nowTs(), (opts && opts.extra) || {}) });
        if (activate) state.activePlanId = ref.id;
      });
      return ref.id;
    } catch (error) {
      reportError('No se ha podido crear el plan', error);
      return null;
    }
  }

  // Guardado con control de revisión: si otro dispositivo cambió el plan, no se pisa
  async function updatePlanContent(planId, content, loadedRevision) {
    if (!uid()) return null;
    const ref = plansCol().doc(planId);
    try {
      const next = await txRun(async tx => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw kxError('kx/plan-missing');
        const cur = snap.data();
        if (cur.status === 'trashed') throw kxError('kx/plan-trashed');
        if (!PL().checkRevision(loadedRevision, cur.revision)) throw kxError('kx/conflict');
        const norm = PL().normalizeContent(content);
        const doc = { ...cur, ...norm, revision: cur.revision + 1, updatedAt: stamp() };
        ['goal', 'level', 'equipment', 'minutes', 'startDate'].forEach(k => { if (!(k in norm)) delete doc[k]; });
        tx.set(ref, doc);
        return { revision: doc.revision, sessions: norm.sessions };
      });
      return next;
    } catch (error) {
      window.kruxLastPlanError = error.code || '';
      reportError('No se ha podido guardar el plan', error);
      return null;
    }
  }

  async function setPlanStatus(planId, action) {
    if (!uid()) return false;
    if (action !== 'restore' && sessionBlocks()) return false;
    const ref = plansCol().doc(planId);
    try {
      await txRun(async tx => {
        const [snap, st] = await Promise.all([tx.get(ref), tx.get(stateRef())]);
        if (!snap.exists) throw kxError('kx/plan-missing');
        const cur = snap.data();
        if (!PL().canDo(cur, action) || action === 'purge') throw kxError('kx/not-allowed');
        const patch = PL().transition(cur, action, stamp());
        tx.set(ref, { ...cur, ...patch, revision: cur.revision + 1, updatedAt: stamp() });
        // El plan activo que se archiva o se envía a la papelera deja Entrena sin plan activo, en la misma escritura
        if (st.exists && st.data().activePlanId === planId && patch.status !== 'ready') tx.set(stateRef(), stateFor(st.data(), null));
      });
      await settle((plans, state) => {
        const p = plans.find(x => x.id === planId);
        if (p) {
          Object.assign(p, PL().transition(p, action, nowTs()), { revision: (p.revision || 1) + 1 });
          if (state.activePlanId === planId && p.status !== 'ready') state.activePlanId = null;
        }
      });
      return true;
    } catch (error) {
      reportError('No se ha podido cambiar el plan', error);
      return false;
    }
  }

  async function activatePlan(planId) {
    if (!uid() || sessionBlocks()) return false;
    try {
      await txRun(async tx => {
        const [snap, st] = await Promise.all([tx.get(plansCol().doc(planId)), tx.get(stateRef())]);
        if (!snap.exists) throw kxError('kx/plan-missing');
        if (!PL().canActivate(snap.data())) throw kxError('kx/not-allowed');
        tx.set(stateRef(), stateFor(st.exists ? st.data() : null, planId));
        // Si estaba programado, activarlo a mano consume la programación
        if (snap.data().startDate) tx.set(plansCol().doc(planId), { ...snap.data(), startDate: null, revision: snap.data().revision + 1, updatedAt: stamp() });
      });
      await settle((plans, state) => {
        state.activePlanId = planId;
        const p = plans.find(x => x.id === planId);
        if (p && p.startDate) { p.startDate = null; p.revision = (p.revision || 1) + 1; }
      });
      return true;
    } catch (error) {
      reportError('No se ha podido activar el plan', error);
      return false;
    }
  }

  // Inicio programado: cuando llega la fecha de inicio de un plan, pasa a ser el activo. Es una sola
  // transacción: puntero + consumo de la programación (el plan queda sin fecha, así que no se vuelve a aplicar
  // si más tarde eliges otro plan). Sin conexión o con un entrenamiento abierto no se hace nada: se reintenta al volver.
  async function applySchedule() {
    if (!uid() || !MULTI() || navigator.onLine === false) return null;
    if (window.KruxTrainSession && window.KruxTrainSession.isRunning()) return null;
    const today = trDateKey(new Date());
    const first = PL().dueSchedule(window.kruxPlans || [], window.kruxPlanState, today);
    if (!first.apply && !first.clear.length) return null;
    const ids = [first.apply, ...first.clear].filter(Boolean).map(p => p.id);
    try {
      const result = await txRun(async tx => {
        const [st, ...snaps] = await Promise.all([tx.get(stateRef()), ...ids.map(id => tx.get(plansCol().doc(id)))]);
        const cur = snaps.filter(x => x.exists).map(fromDoc);
        const prev = st.exists ? st.data() : null;
        // Se vuelve a decidir con lo que hay ahora en el servidor
        const now = PL().dueSchedule(cur, prev, today);
        if (!now.apply && !now.clear.length) return null;
        if (now.apply) tx.set(stateRef(), stateFor(prev, now.apply.id));
        [now.apply, ...now.clear].filter(Boolean).forEach(p => {
          const { id, ...rest } = p;
          tx.set(plansCol().doc(id), { ...rest, startDate: null, revision: p.revision + 1, updatedAt: stamp() });
        });
        return { applied: now.apply ? { id: now.apply.id, name: now.apply.name } : null, consumed: [now.apply, ...now.clear].filter(Boolean).map(p => p.id) };
      });
      if (!result) return null;
      await settle((plans, state) => {
        plans.forEach(p => { if (result.consumed.includes(p.id)) { p.startDate = null; p.revision = (p.revision || 1) + 1; } });
        if (result.applied) state.activePlanId = result.applied.id;
      });
      return result;
    } catch (error) {
      // Silencioso: la programación sigue en el plan y se reintenta en la próxima carga
      return null;
    }
  }

  async function duplicatePlan(planId, name) {
    if (!uid()) return null;
    const target = plansCol().doc();
    try {
      await txRun(async tx => {
        const snap = await tx.get(plansCol().doc(planId));
        if (!snap.exists) throw kxError('kx/plan-missing');
        tx.set(target, PL().duplicatePlan(snap.data(), planId, stamp(), name));
      });
      await settle(plans => {
        const src = plans.find(x => x.id === planId);
        if (src) plans.push({ id: target.id, ...PL().duplicatePlan(src, planId, nowTs(), name) });
      });
      return target.id;
    } catch (error) {
      reportError('No se ha podido duplicar el plan', error);
      return null;
    }
  }

  // Borrado definitivo (solo desde la papelera). El historial no se toca: guarda planId y planName.
  async function purgePlan(planId) {
    if (!uid() || sessionBlocks()) return false;
    try {
      await txRun(async tx => {
        const ref = plansCol().doc(planId);
        const [snap, st] = await Promise.all([tx.get(ref), tx.get(stateRef())]);
        if (!snap.exists) return;
        if (!PL().canDo(snap.data(), 'purge')) throw kxError('kx/not-allowed');
        if (st.exists && st.data().activePlanId === planId) throw kxError('kx/not-allowed');
        tx.delete(ref);
      });
      await settle(plans => { const i = plans.findIndex(x => x.id === planId); if (i >= 0) plans.splice(i, 1); });
      return true;
    } catch (error) {
      reportError('No se ha podido eliminar el plan', error);
      return false;
    }
  }

  // Importa el documento antiguo como plan NUEVO (nunca sustituye nada). Para cambios hechos con una app antigua.
  async function importLegacyAsNew() {
    if (!uid()) return null;
    try {
      const doc = await legacyRef().get();
      if (!doc.exists) return null;
      const plan = PL().fromLegacy(doc.data(), stamp());
      plan.sessions.forEach(s => { s.id = PL().newSessionId(); });
      plan.name = `${plan.name} (importado)`.slice(0, 80);
      const ref = plansCol().doc();
      await ack(ref.set(plan));
      window.kruxPlanNotice = null;
      await settle(plans => { plans.push({ id: ref.id, ...plan, createdAt: nowTs(), updatedAt: nowTs() }); });
      return ref.id;
    } catch (error) {
      reportError('No se ha podido importar el plan', error);
      return null;
    }
  }

  // Las operaciones sobre planes se ejecutan de una en una (cola): evita transacciones solapadas del
  // mismo cliente (pulsaciones repetidas, guardar mientras se migra) y estados intermedios en pantalla.
  let planQueue = Promise.resolve();
  const serial = fn => { const run = planQueue.then(fn, fn); planQueue = run.catch(() => {}); return run; };
  const q = {
    migrate: () => serial(migrate),
    create: (c, o) => serial(() => createPlan(c, o)),
    update: (id, c, r) => serial(() => updatePlanContent(id, c, r)),
    setStatus: (id, a) => serial(() => setPlanStatus(id, a)),
    activate: id => serial(() => activatePlan(id)),
    duplicate: (id, n) => serial(() => duplicatePlan(id, n)),
    purge: id => serial(() => purgePlan(id)),
    importLegacy: () => serial(importLegacyAsNew),
    applySchedule: () => serial(applySchedule)
  };

  // Traspasa lo guardado a la vista en memoria (ids de sesión y revisión nuevos)
  function adopt(plan, saved) {
    plan.revision = saved.revision;
    saved.sessions.forEach((s, i) => { if (plan.sessions[i]) plan.sessions[i].id = s.id; });
  }


  // ══════════════════════════════════════════════════════════════════
  // SIN CONEXIÓN  (solo con window.KRUX_MULTIPLAN; no activa la persistencia global de Firestore)
  //   · Copia local del plan activo y del historial reciente: Entrena arranca y se puede entrenar sin cobertura.
  //   · Cola persistente de sesiones pendientes: cada sesión tiene un id estable, así que reintentar nunca duplica.
  //   · Nada se da por sincronizado hasta que el servidor lo confirma. Un rechazo del servidor (no de red)
  //     queda como «conflicto» y no se reintenta solo ni se descarta en silencio.
  //   · Todo va por cuenta (uid): otra cuenta del mismo dispositivo no ve ni sincroniza datos ajenos.
  //   · Editar planes sigue necesitando conexión (la revisión del servidor evita pisar a otro dispositivo).
  // ══════════════════════════════════════════════════════════════════
  const OFFLINE = () => MULTI();
  const LS = 'krux.train.v1.';
  const lsGet = (kind, u) => { try { const raw = localStorage.getItem(`${LS}${kind}.${u}`); return raw ? JSON.parse(raw) : null; } catch (_) { return null; } };
  const lsSet = (kind, u, value) => { try { localStorage.setItem(`${LS}${kind}.${u}`, JSON.stringify(value)); return true; } catch (_) { return false; } };
  const lsDel = (kind, u) => { try { localStorage.removeItem(`${LS}${kind}.${u}`); } catch (_) { /* sin almacenamiento */ } };
  const memQueue = {};            // respaldo en memoria si el almacenamiento local falla (cuota, modo privado)
  let lastUid = null;
  const emit = () => { try { window.dispatchEvent(new Event('krux-train-sync')); } catch (_) { /* nada */ } };
  const isNetworkError = e => /unavailable|network|timeout|deadline|offline|aborted|internal|resource-exhausted|failed to get/i.test(`${(e && e.code) || ''} ${(e && e.message) || ''}`);

  function queueOf(u) { return (memQueue[u] !== undefined ? memQueue[u] : lsGet('pending', u)) || []; }
  function saveQueue(u, list) {
    memQueue[u] = list;
    let ok = true;
    if (list.length) ok = lsSet('pending', u, list); else lsDel('pending', u);
    if (!ok && typeof showToast === 'function') {
      showToast('No hay espacio para guardar la sesión en este dispositivo', 'error', { detail: 'Se intentará sincronizar igualmente: no cierres la app hasta que termine.' });
    }
    emit();
    return ok;
  }

  // Copia del plan activo y del historial reciente (para arrancar sin red)
  function writeCache() {
    const u = uid();
    if (!u || !OFFLINE()) return;
    lsSet('cache', u, {
      savedAt: Date.now(),
      state: { activePlanId: (window.kruxPlanState && window.kruxPlanState.activePlanId) || null },
      plan: window.kruxActivePlan || null,
      log: (window.kruxTrainLog || []).filter(e => e.id && !e.demo).slice(-200)
    });
  }

  function restoreFromCache() {
    const u = uid();
    const c = u && lsGet('cache', u);
    if (!c) return false;
    window.kruxPlans = c.plan ? [c.plan] : [];
    window.kruxPlanState = c.state || { activePlanId: null };
    window.kruxActivePlan = c.plan && c.plan.status === 'ready' ? c.plan : null;
    window.kruxTrainLog = (c.log || []).concat(pendingRecords(u));
    window.kruxPlanNotice = { type: 'offline', since: c.savedAt };
    return true;
  }

  // Sesiones aún no confirmadas, con la forma de un registro del historial (cuentan en el calendario)
  function pendingRecords(u) {
    return queueOf(u).filter(e => e.kind === 'session').map(e => ({
      ...e.payload, ...(e.log || {}), demo: false, pendingId: e.id, pendingState: e.state
    }));
  }

  function mergePending(u, loaded) {
    const ids = new Set(loaded.map(d => d.id));
    return loaded.concat(pendingRecords(u).filter(r => !ids.has(r.pendingId)));
  }

  // ── Sincronización ──────────────────────────────────────────────────
  let flushing = null;
  let flushTimer = null;
  function flush() {
    if (!OFFLINE() || !uid()) return Promise.resolve();
    if (!flushing) flushing = doFlush().catch(() => {}).then(() => { flushing = null; emit(); });
    return flushing;
  }

  async function doFlush() {
    const u = uid();
    if (navigator.onLine === false) return;                  // sin red conocida: ni se intenta (la sesión ya está a salvo en la cola)
    for (const e of queueOf(u).slice()) {
      if (uid() !== u) return;
      if (e.state === 'conflict') continue;                  // no se reintentan solos
      const ref = userRef().collection('training_sessions').doc(e.id);
      try {
        e.attempts = (e.attempts || 0) + 1;
        if (e.kind === 'session') {
          // Mismo contenido y misma fecha en cada intento: si el primero ya se aplicó, el reintento es inocuo
          await ack(ref.set({ ...e.payload, ...(e.log || {}), createdAt: firebase.firestore.Timestamp.fromMillis(e.createdAtMs) }), 8000);
        } else {
          await ack(ref.update(e.fields), 8000);
        }
        // Confirmado por el servidor: sale de la cola y el registro en memoria pasa a «guardado»
        saveQueue(u, queueOf(u).filter(x => x.id !== e.id));
        (window.kruxTrainLog || []).forEach(r => { if (r.pendingId === e.id) { r.id = e.id; delete r.pendingId; delete r.pendingState; } });
        (liveRecords.get(e.id) || []).forEach(rec => { rec.id = e.id; rec.syncState = 'synced'; });
        liveRecords.delete(e.id);
      } catch (error) {
        if (isNetworkError(error)) {                                                                                  // sin red: se queda pendiente
          e.lastError = String(error.code || 'network');
          saveQueue(u, queueOf(u));
          // Con la red «disponible» pero sin respuesta, se reintenta pronto (5 s, 10 s, 20 s… hasta 60 s)
          if (navigator.onLine !== false) { clearTimeout(flushTimer); flushTimer = setTimeout(flush, Math.min(60000, 5000 * 2 ** Math.min(4, (e.attempts || 1) - 1))); }
          return;
        }
        e.state = 'conflict';                                                                                           // rechazo del servidor
        e.lastError = String(error.code || error.message || 'error');
        saveQueue(u, queueOf(u));
        (liveRecords.get(e.id) || []).forEach(rec => { rec.syncState = 'conflict'; });
        console.error('Sesión pendiente rechazada por el servidor:', error);
      }
    }
  }

  const liveRecords = new Map();     // id de la cola → registros en pantalla que esperan confirmación

  function enqueueSession(rec) {
    const u = uid();
    if (!rec.pendingId) {
      const id = userRef().collection('training_sessions').doc().id;
      Object.defineProperty(rec, 'pendingId', { value: id, enumerable: false, writable: true });
      const entry = { id, uid: u, kind: 'session', payload: JSON.parse(JSON.stringify(sessionPayload(rec))), createdAtMs: Date.now(), log: null, state: 'pending', attempts: 0, lastError: '', queuedAt: Date.now() };
      saveQueue(u, queueOf(u).concat(entry));
      liveRecords.set(id, [rec]);
    }
    Object.defineProperty(rec, 'syncState', { value: 'pending', enumerable: false, writable: true, configurable: true });
    return rec.pendingId;
  }

  // Estado visible de lo pendiente (Entrena muestra un aviso con estas cifras)
  function syncInfo() {
    const u = uid();
    const list = u ? queueOf(u) : [];
    return {
      pending: list.filter(e => e.state === 'pending').length,
      conflicts: list.filter(e => e.state === 'conflict').length,
      offline: navigator.onLine === false || !!(window.kruxPlanNotice && window.kruxPlanNotice.type === 'offline'),
      since: window.kruxPlanNotice && window.kruxPlanNotice.since,
      entries: list.map(e => ({ id: e.id, state: e.state, name: e.payload && e.payload.sessionName, lastError: e.lastError }))
    };
  }

  function retryConflicts() {
    const u = uid();
    saveQueue(u, queueOf(u).map(e => (e.state === 'conflict' ? { ...e, state: 'pending', lastError: '' } : e)));
    return flush();
  }

  function discardEntry(id) {
    const u = uid();
    saveQueue(u, queueOf(u).filter(e => e.id !== id));
    window.kruxTrainLog = (window.kruxTrainLog || []).filter(r => r.pendingId !== id);
    liveRecords.delete(id);
    if (typeof window.refreshTrainView === 'function') window.refreshTrainView();
  }

  window.addEventListener('online', () => { flush(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    flush();
    // Si la app llevaba abierta desde ayer, puede haber llegado la fecha de inicio de un plan
    if (MULTI()) q.applySchedule().then(res => { if (res && res.applied) { announceSchedule(res); if (typeof window.refreshTrainView === 'function') window.refreshTrainView(); } }).catch(() => {});
  });
  setInterval(() => { if (OFFLINE() && uid() && queueOf(uid()).some(e => e.state === 'pending')) flush(); }, 60000);

  // Guardar el plan en memoria. Con planes múltiples escribe el documento de ese plan (con control de
  // revisión); sin él, el documento antiguo de siempre.
  async function savePlan(plan) {
    if (!uid() || !plan) return false;
    planTouched = true;
    if (MULTI()) {
      if (plan.id) {
        const saved = await q.update(plan.id, plan, plan.revision);
        if (!saved) return false;
        adopt(plan, saved);
        return true;
      }
      // Plan nuevo sin identificador: se crea (y se activa) sin tocar los planes existentes
      const id = await q.create(plan, { activate: true });
      if (!id) return false;
      const created = (window.kruxPlans || []).find(p => p.id === id);
      if (created) { plan.id = id; plan.revision = created.revision; created.sessions.forEach((s, i) => { if (plan.sessions[i]) plan.sessions[i].id = s.id; }); window.kruxActivePlan = plan; }
      return true;
    }
    try {
      await ack(userRef().collection('training_plan').doc('active').set({
        ...planPayload(plan),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }));
      return true;
    } catch (error) {
      reportError('No se ha podido guardar el plan', error);
      return false;
    }
  }

  async function saveSession(rec) {
    if (!uid()) return false;
    // Una sesión empezada con una cuenta no se guarda en otra distinta
    if (rec.ownerUid && rec.ownerUid !== uid()) {
      reportError('Esta sesión es de otra cuenta', Object.assign(new Error('owner mismatch'), { code: 'kx/other-account' }));
      return false;
    }
    if (rec.id) return true;   // ya confirmada por el servidor: reintentar no la vuelve a escribir
    if (OFFLINE()) {
      // Primero se guarda en este dispositivo (cola persistente) y después se intenta sincronizar
      enqueueSession(rec);
      await flush();
      return rec.syncState === 'synced';
    }
    try {
      // El id se fija una vez: si se reintenta tras un corte de red no se duplica la sesión
      if (!rec._ref) Object.defineProperty(rec, '_ref', { value: userRef().collection('training_sessions').doc(), enumerable: false, writable: true });
      // Fecha fijada una vez: un reintento escribe exactamente lo mismo (las reglas lo aceptan aunque la primera ya se aplicara)
      if (!rec._createdAt) Object.defineProperty(rec, '_createdAt', { value: firebase.firestore.Timestamp.now(), enumerable: false, writable: true });
      await ack(rec._ref.set({
        ...sessionPayload(rec),
        createdAt: rec._createdAt
      }));
      rec.id = rec._ref.id;
      return true;
    } catch (error) {
      reportError('No se ha podido guardar la sesión', error);
      return false;
    }
  }

  async function updateSession(rec, fields) {
    if (!uid()) return false;
    const log = { feel: str(fields.feel, 10), rpe: Math.min(10, int(fields.rpe)), notes: str(fields.notes, 1000), tags: (fields.tags || []).slice(0, 10).map(t => str(t, 40)) };
    if (OFFLINE()) {
      const u = uid();
      const list = queueOf(u);
      const queued = rec.pendingId && list.find(e => e.id === rec.pendingId);
      if (queued) {                                         // aún sin confirmar: se escribe todo junto
        queued.log = log;
        saveQueue(u, list);
        await flush();
        return rec.syncState === 'synced';
      }
      if (!rec.id) return false;
      try { await ack(userRef().collection('training_sessions').doc(rec.id).update(log)); return true; }
      catch (error) {
        if (!isNetworkError(error)) { reportError('No se ha podido guardar el registro', error); return false; }
        saveQueue(u, list.concat({ id: rec.id, uid: u, kind: 'patch', fields: log, state: 'pending', attempts: 0, lastError: '', queuedAt: Date.now() }));
        return false;
      }
    }
    if (!rec.id) return false;
    try {
      await ack(userRef().collection('training_sessions').doc(rec.id).update({
        feel: str(fields.feel, 10),
        rpe: Math.min(10, int(fields.rpe)),
        notes: str(fields.notes, 1000),
        tags: (fields.tags || []).slice(0, 10).map(t => str(t, 40))
      }));
      return true;
    } catch (error) {
      reportError('No se ha podido guardar el registro', error);
      return false;
    }
  }

  async function load() {
    if (!uid()) return;
    planTouched = false;
    // Sin conexión conocida: se arranca ya con la copia local (no se espera a que Firestore agote el tiempo)
    if (OFFLINE() && navigator.onLine === false && restoreFromCache()) {
      if (typeof window.refreshTrainView === 'function') window.refreshTrainView();
      emit();
      return;
    }
    const from = new Date();
    from.setDate(from.getDate() - SESSION_WEEKS * 7);
    const fromKey = trDateKey(from);
    try {
      if (MULTI()) await loadPlans();
      const [planDoc, sessSnap] = await Promise.all([
        MULTI() ? Promise.resolve({ exists: false }) : userRef().collection('training_plan').doc('active').get(),
        userRef().collection('training_sessions').where('dateKey', '>=', fromKey).orderBy('dateKey').get()
      ]);
      if (!planTouched && !MULTI()) {
        const data = planDoc.exists ? planDoc.data() : null;
        window.kruxActivePlan = data && Array.isArray(data.sessions)
          ? {
              name: data.name, weeks: data.weeks, activeDays: data.activeDays, sessions: data.sessions,
              ...(data.goal ? { goal: data.goal } : {}),
              ...(data.level ? { level: data.level } : {}),
              ...(Array.isArray(data.equipment) ? { equipment: data.equipment } : {})
            }
          : null;
      }
      const loaded = sessSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      if (OFFLINE()) {
        // Lo pendiente de sincronizar cuenta en el calendario; lo ya confirmado llega con su id del servidor
        const u = uid();
        window.kruxTrainLog = [...mergePending(u, loaded), ...window.kruxTrainLog.filter(e => !e.id && !e.pendingId)];
        writeCache();
        flush();
      } else {
        // Conserva lo registrado en esta apertura que aún no tenga id
        window.kruxTrainLog = [...loaded, ...window.kruxTrainLog.filter(e => !e.id)];
      }
      reloadTry = 0;
    } catch (error) {
      console.error('Error cargando Entrena:', error);
      // Con planes múltiples un fallo de carga no debe parecer «no tengo planes»: se avisa y se reintenta
      if (MULTI()) {
        if (!restoreFromCache()) window.kruxPlanNotice = { type: 'load-error' };   // sin copia: se avisa; con copia: se trabaja con ella
        scheduleReload();
      }
    }
    if (typeof window.refreshTrainView === 'function') window.refreshTrainView();
  }

  // Reintentos automáticos de la carga (3 s, 8 s, 20 s) y al volver la conexión
  let reloadTimer = null;
  let reloadTry = 0;
  function scheduleReload() {
    clearTimeout(reloadTimer);
    const wait = [3000, 8000, 20000][reloadTry++];
    const who = uid();
    if (wait == null || !who) return;
    reloadTimer = setTimeout(() => { if (uid() === who) load(); }, wait);
  }
  window.addEventListener('online', () => {
    if (uid() && window.kruxPlanNotice && (window.kruxPlanNotice.type === 'load-error' || window.kruxPlanNotice.type === 'offline')) { reloadTry = 0; load(); }
  });

  firebase.auth().onAuthStateChanged(user => {
    if (user) { lastUid = user.uid; load(); return; }
    if (lastUid && OFFLINE()) lsDel('cache', lastUid);
    window.kruxActivePlan = null;
    window.kruxTrainLog = [];
    clearPlans();
    if (typeof window.refreshTrainView === 'function') window.refreshTrainView();
  });

  return {
    savePlan, saveSession, updateSession, isSignedIn: () => !!uid(), currentUid: uid,
    // Planes múltiples (requieren window.KRUX_MULTIPLAN)
    sync: { info: syncInfo, flush, retryConflicts, discard: discardEntry, offline: OFFLINE },
    plans: { enabled: MULTI, reload: refreshPlans, retryLoad: () => { reloadTry = 0; return load(); }, ...q }
  };
})();
window.KruxTrainStore = KruxTrainStore;

function trEsc(text) {
  return String(text ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function trDateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// «10 s», «2 min», «1 min 30 s»
function trFmtDuration(sec) {
  if (!sec) return '';
  if (sec < 60) return `${sec} s`;
  const m = Math.floor(sec / 60), s = sec % 60;
  return s ? `${m} min ${s} s` : `${m} min`;
}

// «4 × 10 s», «3 × 5 rep», «3 series»
function trFmtWork(ex) {
  if (ex.workSec > 0) return `${ex.sets} × ${trFmtDuration(ex.workSec)}`;
  if (ex.reps > 0) return `${ex.sets} × ${ex.reps} rep`;
  return `${ex.sets} series`;
}

// Duración aproximada: trabajo (≈3 s por repetición) + descansos entre series
function trEstimateMinutes(exercises) {
  const sec = exercises.reduce((acc, ex) => {
    const work = ex.workSec > 0 ? ex.workSec : (ex.reps || 0) * 3;
    return acc + ex.sets * work + Math.max(0, ex.sets - 1) * (ex.restSec || 0);
  }, 0);
  return Math.max(5, Math.round(sec / 300) * 5);
}

// Genera la descripción corta a partir de los parámetros del ejercicio
function buildExDetail(ex) {
  const parts = [trFmtWork(ex)];
  if (ex.weight > 0) parts.push(`+${ex.weight} kg`);
  if (ex.assistanceKg > 0) parts.push(`−${ex.assistanceKg} kg asistencia`);
  if (ex.distanceM > 0) parts.push(`${ex.distanceM} m`);
  if (ex.tempo) parts.push(`tempo ${ex.tempo}`);
  if (ex.restSec > 0) parts.push(`descanso ${trFmtDuration(ex.restSec)}`);
  return parts.join(' · ');
}

// ================== TRAIN VIEW ==================
function initTrainView() {
  const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const DAY_LABELS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
  const DAY_NAMES = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

  const ICONS = {
    timer: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 1.5"/><path d="M9.5 2.5h5"/></svg>`,
    reps: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 2.5l3 3-3 3"/><path d="M4 11.5v-1a5 5 0 0 1 5-5h11"/><path d="M7 21.5l-3-3 3-3"/><path d="M20 12.5v1a5 5 0 0 1-5 5H4"/></svg>`,
    check: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>`,
    chevron: `<svg class="train-ex-chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"></polyline></svg>`,
    record: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/></svg>`,
  };

  let weekOffset = 0;
  let selectedIdx = todayIdx();

  function todayIdx() { return (new Date().getDay() + 6) % 7; } // 0 = lunes

  function mondayOf(offset) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - todayIdx() + offset * 7);
    return d;
  }

  function dateAt(offset, idx) {
    const d = mondayOf(offset);
    d.setDate(d.getDate() + idx);
    return d;
  }

  // Plan que rige en una fecha: el activo; en fechas futuras, el programado cuya fecha de inicio ya habrá llegado
  function planAt(date) {
    const active = window.kruxActivePlan;
    if (!date || !multiPlans() || !window.KruxPlans) return active;
    const t = new Date(); t.setHours(0, 0, 0, 0);
    if (date <= t) return active;
    return window.KruxPlans.planOnDate(window.kruxPlans || [], trDateKey(date)) || active;
  }

  function planSessionFor(label, date) {
    const plan = planAt(date);
    if (!plan || !plan.sessions) return null;
    return plan.sessions.find(s => s.day === label) || null;
  }

  function nextPlannedAfter(idx) {
    for (let i = 1; i <= 7; i++) {
      const j = (idx + i) % 7;
      const s = planSessionFor(DAY_LABELS[j]);
      if (s) return { idx: j, session: s };
    }
    return null;
  }

  // sessionId: id de la sesión del plan (preferente); sin él, el nombre (registros antiguos)
  function logFor(dateKey, name, sessionId) {
    const log = window.kruxTrainLog;
    for (let i = log.length - 1; i >= 0; i--) {
      const e = log[i];
      if (e.demo || e.dateKey !== dateKey) continue;
      if (sessionId && e.planSessionId) { if (e.planSessionId === sessionId) return e; continue; }
      if (!name || e.sessionName === name) return e;
    }
    return null;
  }

  // Con planes múltiples el pasado muestra lo realmente registrado, no la estructura del plan actual
  const multiPlans = () => !!window.KRUX_MULTIPLAN;
  const isPastDate = d => { const t = new Date(); t.setHours(0, 0, 0, 0); return d < t; };
  const entriesOn = dateKey => (window.kruxTrainLog || []).filter(e => !e.demo && e.dateKey === dateKey);
  const hasAnyReadyPlan = () => (window.kruxPlans || []).some(p => p.status === 'ready');
  const planGone = e => multiPlans() && !!e.planId && !(window.kruxPlans || []).some(p => p.id === e.planId);

  function isSelectedToday() { return weekOffset === 0 && selectedIdx === todayIdx(); }

  // ── Resumen semanal ─────────────────────────────────────────────────
  function renderHero() {
    const plan = window.kruxActivePlan;
    const title = document.getElementById('train-hero-title');
    const sub = document.getElementById('train-hero-sub');
    const meter = document.getElementById('train-hero-meter');
    const note = document.getElementById('train-hero-note');
    const cta = document.getElementById('train-hero-cta');
    if (!title) return;

    if (!plan && multiPlans() && window.kruxPlanNotice && window.kruxPlanNotice.type === 'load-error') {
      title.textContent = 'No se han podido cargar tus planes';
      sub.textContent = 'Revisa tu conexión. Tus planes y tu historial no se han tocado.';
      meter.innerHTML = ''; meter.hidden = true; note.textContent = ''; note.hidden = true;
      cta.textContent = 'Reintentar';
      cta.classList.remove('hidden');
      return;
    }
    if (!plan) {
      title.textContent = 'Sin plan activo';
      const pick = hasReadyPlans();
      sub.textContent = pick ? 'Elige uno de tus planes o crea uno nuevo.' : 'Crea un plan para organizar tus sesiones de la semana.';
      cta.textContent = pick ? 'Mis planes' : 'Crear plan';
      meter.innerHTML = '';
      meter.hidden = true;
      note.textContent = '';
      note.hidden = true;
      cta.classList.remove('hidden');
      return;
    }

    cta.classList.add('hidden');
    const planned = DAY_LABELS.filter(l => planSessionFor(l)).length;
    const monday = mondayOf(0);
    const doneKeys = new Set(window.kruxTrainLog
      .filter(e => !e.demo)
      .filter(e => { const d = new Date(e.dateKey + 'T00:00'); return d >= monday && (d - monday) < 7 * 864e5; })
      .map(e => e.dateKey));
    let done = doneKeys.size;
    let others = 0;
    if (multiPlans()) {
      // Solo cuentan las sesiones del plan activo (las antiguas, sin plan, cuentan para el activo);
      // las de otros planes se indican aparte para no mostrar resultados como «3 de 2»
      const weekEntries = (window.kruxTrainLog || []).filter(e => !e.demo)
        .filter(e => { const d = new Date(e.dateKey + 'T00:00'); return d >= monday && (d - monday) < 7 * 864e5; });
      const mine = weekEntries.filter(e => !e.planId || e.planId === plan.id);
      done = new Set(mine.map(e => e.dateKey)).size;
      others = new Set(weekEntries.filter(e => e.planId && e.planId !== plan.id).map(e => e.dateKey)).size;
      done = Math.min(done, planned);
    }

    title.textContent = done > 0 ? `${done} de ${planned} sesiones` : `${planned} ${planned === 1 ? 'sesión' : 'sesiones'}`;
    sub.textContent = `${done > 0 ? 'completadas' : 'planificadas'} esta semana · ${plan.name || 'Mi plan'}`;

    meter.hidden = planned === 0;
    meter.innerHTML = Array.from({ length: planned }, (_, i) => `<span class="${i < done ? 'is-done' : ''}"></span>`).join('');

    const todaySess = planSessionFor(DAY_LABELS[todayIdx()]);
    if (todaySess) {
      note.textContent = logFor(trDateKey(new Date()), todaySess.name, todaySess.id) ? `Hoy: ${todaySess.name} · hecha` : `Hoy: ${todaySess.name}`;
    } else {
      const next = nextPlannedAfter(todayIdx());
      note.textContent = next ? `Hoy descansas · ${DAY_NAMES[next.idx]}: ${next.session.name}` : 'Hoy descansas';
    }
    if (others > 0) note.textContent += ` · ${others === 1 ? '1 día de otro plan no se cuenta' : `${others} días de otros planes no se cuentan`}`;
    note.hidden = false;
  }

  // ── Calendario ──────────────────────────────────────────────────────
  function renderWeek() {
    const daysRow = document.getElementById('train-days-row');
    const weekTitle = document.getElementById('train-week-title');
    if (!daysRow || !weekTitle) return;

    const monday = mondayOf(weekOffset);
    const sunday = dateAt(weekOffset, 6);
    const range = monday.getMonth() === sunday.getMonth()
      ? `${monday.getDate()}–${sunday.getDate()} ${MONTHS[sunday.getMonth()]}`
      : `${monday.getDate()} ${MONTHS[monday.getMonth()]} – ${sunday.getDate()} ${MONTHS[sunday.getMonth()]}`;
    weekTitle.textContent = weekOffset === 0 ? `Esta semana · ${range}` : range;

    daysRow.innerHTML = DAY_LABELS.map((label, i) => {
      const d = dateAt(weekOffset, i);
      const hasPlan = !!planAt(d);
      const isToday = weekOffset === 0 && i === todayIdx();
      const past = multiPlans() && isPastDate(d);
      const sess = hasPlan && !past ? planSessionFor(label, d) : null;
      const isDone = !!logFor(trDateKey(d));
      const isSelected = i === selectedIdx;
      const cls = ['train-day', isToday && 'is-today', (sess || (past && isDone)) && 'has-session', isDone && 'is-done', isSelected && 'is-selected']
        .filter(Boolean).join(' ');
      const desc = [`${DAY_NAMES[i]} ${d.getDate()}`, isToday && 'hoy', sess ? `sesión: ${sess.name}` : (hasPlan && !past && 'descanso'), isDone && 'completada']
        .filter(Boolean).join(', ');
      return `<button type="button" class="${cls}" data-idx="${i}" aria-pressed="${isSelected}" aria-label="${trEsc(desc)}">
        <span class="train-day-name">${label}</span>
        <span class="train-day-num">${isDone ? ICONS.check : d.getDate()}</span>
        <span class="train-day-mark"></span>
      </button>`;
    }).join('');
  }

  // ── Sesión del día seleccionado ─────────────────────────────────────
  function selectedState() {
    const date = dateAt(weekOffset, selectedIdx);
    const plan = planAt(date);
    if (multiPlans()) {
      if (isPastDate(date)) {
        const entries = entriesOn(trDateKey(date));
        return entries.length ? { kind: 'history', date, entries } : { kind: 'past', date };
      }
      if (!plan && hasAnyReadyPlan()) return { kind: 'noplan', date };
    }
    if (!plan) return { kind: 'demo', date };
    const sess = planSessionFor(DAY_LABELS[selectedIdx], date);
    return sess ? { kind: 'session', date, sess, plan } : { kind: 'rest', date };
  }

  function loadSelectedSession() {
    const nameEl = document.getElementById('train-session-name');
    const metaEl = document.getElementById('train-session-meta');
    const badgeEl = document.getElementById('train-session-badge');
    const st = selectedState();

    if (st.kind === 'demo') {
      window.kruxTrainData = KRUX_TRAIN_DEMO;
      badgeEl.textContent = 'Ejemplo';
      badgeEl.className = 'train-session-badge is-demo';
    } else if (st.kind === 'session') {
      // Misma referencia que el plan: las ediciones del ejercicio se quedan en el plan
      const plan = st.plan || window.kruxActivePlan || {};
      window.kruxTrainData = {
        name: st.sess.name, exercises: st.sess.exercises, demo: false,
        planId: plan.id || null, planName: plan.name || '', planRevision: plan.revision || null, planSessionId: st.sess.id || null
      };
      badgeEl.textContent = isSelectedToday() ? 'Hoy' : DAY_NAMES[selectedIdx];
      badgeEl.className = 'train-session-badge' + (isSelectedToday() ? ' is-today' : '');
    } else if (st.kind === 'history') {
      window.kruxTrainData = { name: st.entries.map(e => e.sessionName).join(' + '), exercises: [], demo: false };
      badgeEl.textContent = 'Hecha';
      badgeEl.className = 'train-session-badge is-today';
    } else if (st.kind === 'past') {
      window.kruxTrainData = { name: 'Sin entrenamiento', exercises: [], demo: false };
      badgeEl.textContent = 'Pasado';
      badgeEl.className = 'train-session-badge is-rest';
    } else if (st.kind === 'noplan') {
      window.kruxTrainData = { name: 'Sin plan activo', exercises: [], demo: false };
      badgeEl.textContent = 'Sin plan';
      badgeEl.className = 'train-session-badge is-rest';
    } else {
      window.kruxTrainData = { name: 'Descanso', exercises: [], demo: false };
      badgeEl.textContent = 'Descanso';
      badgeEl.className = 'train-session-badge is-rest';
    }

    const data = window.kruxTrainData;
    nameEl.textContent = st.kind === 'rest' ? `Descanso · ${DAY_NAMES[selectedIdx].toLowerCase()}` : data.name;
    if (st.kind === 'rest') {
      metaEl.textContent = 'No hay sesión planificada este día.';
    } else if (st.kind === 'history') {
      const sets = st.entries.reduce((n, e) => n + e.exercises.reduce((m, x) => m + x.sets.length, 0), 0);
      const mins = Math.max(1, Math.round(st.entries.reduce((n, e) => n + (e.durationSec || 0), 0) / 60));
      const plans = Array.from(new Set(st.entries.map(e => e.planName ? `${e.planName}${planGone(e) ? ' (plan eliminado)' : ''}` : ''))).filter(Boolean);
      metaEl.textContent = `${sets} ${sets === 1 ? 'serie' : 'series'} · ${mins} min${plans.length ? ` · ${plans.join(', ')}` : ''}`;
    } else if (st.kind === 'past') {
      metaEl.textContent = 'No hay ningún entrenamiento registrado este día.';
    } else if (st.kind === 'noplan') {
      metaEl.textContent = 'Elige uno de tus planes para ver tus sesiones.';
    } else {
      const n = data.exercises.length;
      metaEl.textContent = n ? `${n} ${n === 1 ? 'ejercicio' : 'ejercicios'} · ≈ ${trEstimateMinutes(data.exercises)} min` : 'Sin ejercicios';
      // Fecha futura que ya pertenece a un plan programado: se indica de qué plan es
      if (st.kind === 'session' && st.plan && window.kruxActivePlan && st.plan.id !== window.kruxActivePlan.id) metaEl.textContent += ` · Plan «${st.plan.name}»`;
    }
    renderExercises();
    renderSuggestion();
    renderCta();
  }

  function renderExercises() {
    const list = document.getElementById('train-exercise-list');
    if (!list) return;
    const st = selectedState();

    if (st.kind === 'history') {
      list.innerHTML = st.entries.map(entry => {
        const rows = entry.exercises.filter(x => x.sets.length).map(x => {
          const first = x.sets[0];
          const part = first.workSec ? trFmtDuration(first.workSec) : first.reps ? `${first.reps} rep` : 'hecha';
          const maxW = Math.max(...x.sets.map(t => t.weight || 0));
          const rpes = x.sets.map(t => t.rpe).filter(Boolean);
          const spec = [`${x.sets.length} × ${part}`, maxW > 0 ? `+${maxW} kg` : ''].filter(Boolean).join(' · ');
          return `<div class="train-ex-item is-done" role="listitem"><div class="train-ex-row train-ex-row--static is-done">
            <span class="train-ex-glyph">${ICONS.check}</span>
            <span class="train-ex-info"><span class="train-ex-name">${trEsc(x.name)}</span><span class="train-ex-spec">${trEsc(spec)}</span></span>
            ${rpes.length ? `<span class="train-ex-rpe">RPE ${Math.round(rpes.reduce((a, b) => a + b, 0) / rpes.length * 10) / 10}</span>` : '<span></span>'}
            <span></span></div></div>`;
        }).join('');
        return (st.entries.length > 1 ? `<p class="train-hist-title" role="listitem">${trEsc(entry.sessionName)}</p>` : '') + (rows || '<div class="train-empty" role="listitem"><p class="train-empty-text">No se registró ninguna serie.</p></div>');
      }).join('');
      return;
    }
    if (st.kind === 'past') {
      list.innerHTML = `<div class="train-empty" role="listitem"><p class="train-empty-title">Nada registrado</p><p class="train-empty-text">Este día no se registró ninguna sesión.</p></div>`;
      return;
    }
    if (st.kind === 'noplan') {
      list.innerHTML = `<div class="train-empty" role="listitem"><p class="train-empty-title">Elige un plan</p><p class="train-empty-text">Tienes planes guardados: elige cuál usar o crea uno nuevo.</p><button type="button" class="train-empty-btn" data-open-plans="1">Mis planes</button></div>`;
      return;
    }
    if (st.kind === 'rest') {
      const next = nextPlannedAfter(selectedIdx);
      list.innerHTML = `<div class="train-empty" role="listitem">
        <p class="train-empty-title">Día de recuperación</p>
        <p class="train-empty-text">${next ? `Próxima sesión: ${DAY_NAMES[next.idx].toLowerCase()}, ${trEsc(next.session.name)}.` : 'Tu plan no tiene sesiones con día asignado.'}</p>
        ${next ? `<button type="button" class="train-empty-btn" data-goto="${next.idx}">Ver ${DAY_NAMES[next.idx].toLowerCase()}</button>` : ''}
      </div>`;
      return;
    }

    const data = window.kruxTrainData;
    if (!data.exercises.length) {
      list.innerHTML = `<div class="train-empty" role="listitem"><p class="train-empty-title">Sin ejercicios</p><p class="train-empty-text">Añade ejercicios a esta sesión desde el editor de planes.</p></div>`;
      return;
    }

    // Estado real: solo cuenta lo registrado en una sesión hecha ese día
    const entry = st.kind === 'session' ? logFor(trDateKey(st.date), data.name) : null;
    const doneSets = i => (entry && entry.exercises[i] && entry.exercises[i].name === data.exercises[i].name) ? entry.exercises[i].sets.length : 0;
    const nextIdx = data.exercises.findIndex((ex, i) => doneSets(i) < ex.sets);

    list.innerHTML = data.exercises.map((ex, i) => {
      const done = doneSets(i);
      const state = done >= ex.sets ? 'is-done' : i === nextIdx ? 'is-next' : '';
      const spec = [trFmtWork(ex), ex.weight > 0 ? `+${ex.weight} kg` : ''].filter(Boolean).join(' · ');
      const status = done >= ex.sets ? 'Hecho' : done > 0 ? `${done}/${ex.sets} series` : '';
      const gid = window.KruxGuide ? window.KruxGuide.idFor(ex) : null;
      return `<div class="train-ex-item ${state}${gid ? ' has-guide' : ''}" role="listitem"><button type="button" class="train-ex-row ${state}" data-idx="${i}" aria-label="${trEsc(`Editar ${ex.name}. ${spec}${ex.restSec ? `, descanso ${trFmtDuration(ex.restSec)}` : ''}${ex.rpeTarget ? `, RPE ${ex.rpeTarget}` : ''}${status ? `, ${status}` : ''}`)}">
        <span class="train-ex-glyph">${done >= ex.sets ? ICONS.check : (ex.workSec > 0 ? ICONS.timer : ICONS.reps)}</span>
        <span class="train-ex-info">
          <span class="train-ex-name">${trEsc(ex.name)}</span>
          <span class="train-ex-spec">${trEsc(spec)}</span>
          ${ex.restSec || status ? `<span class="train-ex-rest">${[ex.restSec ? `Descanso ${trFmtDuration(ex.restSec)}` : '', status].filter(Boolean).join(' · ')}</span>` : ''}
        </span>
        ${ex.rpeTarget ? `<span class="train-ex-rpe">RPE ${ex.rpeTarget}</span>` : ''}
        ${ICONS.chevron}
      </button>${gid ? window.KruxGuide.button(gid) : ''}</div>`;
    }).join('');
  }

  // Último registro real de algún ejercicio de esta sesión (sin progresiones automáticas)
  function renderSuggestion() {
    const box = document.getElementById('train-suggestion');
    if (!box) return;
    const data = window.kruxTrainData;
    const log = window.kruxTrainLog;
    let found = null;
    for (let i = log.length - 1; i >= 0 && !found; i--) {
      if (log[i].demo) continue;
      for (const ex of log[i].exercises) {
        if (!ex.sets.length) continue;
        const current = data.exercises.find(e => e.name === ex.name);
        if (current) { found = { entry: log[i], ex, current }; break; }
      }
    }
    if (!found) { box.classList.add('hidden'); box.innerHTML = ''; return; }

    const { entry, ex, current } = found;
    const last = ex.sets[ex.sets.length - 1];
    const rpes = ex.sets.map(s => s.rpe).filter(Boolean);
    const unit = ex.target.workSec > 0 ? trFmtDuration(ex.target.workSec) : `${ex.target.reps} rep`;
    const lastLine = [`${ex.sets.length} × ${unit}`, last.weight > 0 ? `+${last.weight} kg` : '', rpes.length ? `RPE ${Math.round(rpes.reduce((a, b) => a + b, 0) / rpes.length * 10) / 10}` : '']
      .filter(Boolean).join(' · ');
    const goal = [trFmtWork(current), current.weight > 0 ? `+${current.weight} kg` : '', current.rpeTarget ? `RPE ${current.rpeTarget}` : '']
      .filter(Boolean).join(' · ');
    const when = entry.dateKey === trDateKey(new Date()) ? 'hoy' : `el ${new Date(entry.dateKey + 'T00:00').getDate()} de ${MONTHS[new Date(entry.dateKey + 'T00:00').getMonth()]}`;

    box.innerHTML = `
      <span class="train-suggestion-icon">${ICONS.record}</span>
      <div class="train-suggestion-body">
        <p class="train-suggestion-title">Último registro · ${trEsc(ex.name)}</p>
        <p class="train-suggestion-text">${trEsc(lastLine)} <span class="train-suggestion-when">(${when})</span></p>
        <p class="train-suggestion-goal">Plan para hoy: ${trEsc(goal)}</p>
      </div>`;
    box.classList.remove('hidden');
  }

  function renderCta() {
    const btn = document.getElementById('train-start-btn');
    const label = document.getElementById('train-start-label');
    if (!btn || !label) return;
    const st = selectedState();
    const data = window.kruxTrainData;
    let text = 'Comenzar entrenamiento';
    let disabled = false;
    if (st.kind === 'rest') { text = 'Día de descanso'; disabled = true; }
    else if (st.kind === 'history') { text = 'Entrenamiento realizado'; disabled = true; }
    else if (st.kind === 'past') { text = 'Día pasado'; disabled = true; }
    else if (st.kind === 'noplan') { text = 'Sin plan activo'; disabled = true; }
    else if (!data.exercises.length) { text = 'Sin ejercicios'; disabled = true; }
    else if (st.kind === 'demo') text = 'Probar sesión de ejemplo';
    else if (logFor(trDateKey(st.date), data.name, data.planSessionId)) text = 'Repetir entrenamiento';
    label.textContent = text;
    btn.disabled = disabled;
  }

  // Aviso de sincronización: sin conexión, sesiones pendientes o rechazadas por el servidor
  function renderSync() {
    const box = document.getElementById('train-sync');
    if (!box) return;
    const sync = multiPlans() && window.KruxTrainStore && KruxTrainStore.sync;
    const i = sync ? sync.info() : null;
    if (!i || (!i.pending && !i.conflicts && !i.offline)) { box.classList.add('hidden'); box.innerHTML = ''; return; }
    const n = (k, a, b) => `${k} ${k === 1 ? a : b}`;
    const since = i.since ? new Date(i.since).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
    let html = '';
    box.classList.toggle('is-error', i.conflicts > 0);
    if (i.conflicts) {
      html = `<p><b>${n(i.conflicts, 'sesión no se ha podido sincronizar', 'sesiones no se han podido sincronizar')}.</b> El servidor no la ha aceptado; sigue guardada en este dispositivo.</p>
        <div class="mp-notice-actions"><button type="button" class="mp-notice-btn" data-sync="retry">Reintentar</button><button type="button" class="mp-notice-btn is-quiet" data-sync="discard">Descartar</button></div>`;
    } else if (i.pending) {
      html = `<p><b>${n(i.pending, 'sesión pendiente de sincronizar', 'sesiones pendientes de sincronizar')}.</b> ${i.offline ? 'Se enviará cuando vuelva la conexión.' : 'Se está enviando…'}</p>
        <div class="mp-notice-actions"><button type="button" class="mp-notice-btn" data-sync="flush"${i.offline ? ' disabled' : ''}>Sincronizar ahora</button></div>`;
    } else {
      html = `<p><b>Sin conexión.</b> Usas la copia guardada${since ? ` el ${since}` : ''}. Puedes entrenar; para cambiar tus planes necesitas conexión.</p>`;
    }
    box.innerHTML = html;
    box.classList.remove('hidden');
  }

  function renderAll() {
    renderHero();
    renderWeek();
    loadSelectedSession();
    renderSync();
  }

  // ── Eventos ─────────────────────────────────────────────────────────
  const gearBtn = document.getElementById('train-new-plan-btn');
  const gearMenu = document.getElementById('train-gear-menu');

  function closeGearMenu() {
    if (gearMenu) gearMenu.classList.add('hidden');
    if (gearBtn) gearBtn.setAttribute('aria-expanded', 'false');
  }

  function openPlanEditor() {
    closeGearMenu();
    if (typeof window.openPlanEditor === 'function') window.openPlanEditor();
  }

  function editActivePlan() {
    const plan = window.kruxActivePlan;
    if (!plan || !Array.isArray(plan.sessions)) {
      if (typeof showToast === 'function') showToast('Aún no tienes un plan activo', 'info', { detail: 'Crea uno desde «Crear plan» o con el asistente.' });
      return;
    }
    if (typeof window.openPlanEditor === 'function') window.openPlanEditor({ edit: true });
  }

  function openLibrary() {
    closeGearMenu();
    if (window.KruxLibrary) window.KruxLibrary.open({ mode: 'browse' });
  }

  if (gearBtn && gearMenu) {
    gearBtn.addEventListener('click', e => {
      e.stopPropagation();
      const open = gearMenu.classList.toggle('hidden') === false;
      gearBtn.setAttribute('aria-expanded', String(open));
    });
    document.getElementById('train-gear-new')?.addEventListener('click', openPlanEditor);
    document.getElementById('train-gear-wizard')?.addEventListener('click', () => {
      closeGearMenu();
      if (window.KruxWizard) window.KruxWizard.open();
    });
    document.getElementById('train-gear-edit')?.addEventListener('click', () => {
      closeGearMenu();
      editActivePlan();
    });
    document.getElementById('train-gear-library')?.addEventListener('click', openLibrary);
    const plansItem = document.getElementById('train-gear-plans');
    if (plansItem && window.KRUX_MULTIPLAN) {
      plansItem.hidden = false;
      plansItem.addEventListener('click', () => { closeGearMenu(); if (window.KruxPlansUI) window.KruxPlansUI.open(); });
    }
    document.addEventListener('click', e => {
      if (!e.target.closest('.train-gear-wrap')) closeGearMenu();
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeGearMenu(); });
  }

  // Con planes guardados pero ninguno activo, el botón lleva a «Mis planes»; si no hay planes, a crearlos
  const hasReadyPlans = () => !!window.KRUX_MULTIPLAN && (window.kruxPlans || []).some(p => p.status === 'ready');
  window.addEventListener('krux-train-sync', () => { renderSync(); renderWeek(); renderHero(); });
  window.addEventListener('online', renderSync);
  window.addEventListener('offline', renderSync);
  document.getElementById('train-sync')?.addEventListener('click', e => {
    const b = e.target.closest('[data-sync]');
    if (!b) return;
    const sync = KruxTrainStore.sync;
    if (b.dataset.sync === 'flush') sync.flush();
    else if (b.dataset.sync === 'retry') sync.retryConflicts();
    else if (b.dataset.sync === 'discard') {
      const bad = sync.info().entries.filter(x => x.state === 'conflict');
      window.kruxConfirm('¿Descartar de este dispositivo?', `Se eliminará${bad.length === 1 ? '' : 'n'} ${bad.length} ${bad.length === 1 ? 'sesión' : 'sesiones'} que el servidor no aceptó. No se podrá recuperar.`,
        () => bad.forEach(x => sync.discard(x.id)), 'Descartar', true);
    }
  });
  document.getElementById('train-hero-cta')?.addEventListener('click', () => {
    if (multiPlans() && window.kruxPlanNotice && window.kruxPlanNotice.type === 'load-error') { KruxTrainStore.plans.retryLoad(); return; }
    if (hasReadyPlans() && window.KruxPlansUI) { window.KruxPlansUI.open(); return; }
    openPlanEditor();
  });
  document.getElementById('train-lib-link')?.addEventListener('click', openLibrary);

  document.getElementById('train-days-row')?.addEventListener('click', e => {
    const day = e.target.closest('.train-day');
    if (!day) return;
    selectedIdx = parseInt(day.dataset.idx, 10);
    renderWeek();
    loadSelectedSession();
  });

  document.getElementById('train-exercise-list')?.addEventListener('click', e => {
    const go = e.target.closest('[data-goto]');
    if (go) {
      const target = parseInt(go.dataset.goto, 10);
      if (target <= selectedIdx) weekOffset++; // la próxima sesión cae en la semana siguiente
      selectedIdx = target;
      renderWeek();
      loadSelectedSession();
      return;
    }
    if (e.target.closest('[data-open-plans]')) { if (window.KruxPlansUI) window.KruxPlansUI.open(); return; }
    const row = e.target.closest('.train-ex-row:not(.train-ex-row--static)');
    if (row && typeof window.openExerciseEditor === 'function') window.openExerciseEditor(parseInt(row.dataset.idx, 10));
  });

  document.getElementById('train-week-prev')?.addEventListener('click', () => { weekOffset--; renderWeek(); loadSelectedSession(); });
  document.getElementById('train-week-next')?.addEventListener('click', () => { weekOffset++; renderWeek(); loadSelectedSession(); });

  document.getElementById('train-start-btn')?.addEventListener('click', () => {
    if (typeof window.openActiveSession === 'function') window.openActiveSession();
  });

  // Refresco tras guardar un plan, editar un ejercicio o terminar una sesión
  window.refreshTrainView = () => renderAll();
  window.kruxRenderTrainExercises = () => { loadSelectedSession(); };

  renderAll();
}

// ================== EXERCISE EDITOR ==================
// Edita la prescripción de un ejercicio del plan (el de Entrena o el de un plan en edición).
// Los parámetros básicos siempre se ven; los propios de la ficha del ejercicio (asistencia,
// distancia, tempo…) aparecen debajo solo cuando aplican.
(function () {
  let editingIdx = -1;
  let ctx = null;          // { exercise, onSave, onReplace } cuando se edita fuera de Entrena
  let extraParams = [];
  const $ = id => document.getElementById(id);
  const BASE = { sets: 'ex-field-sets', reps: 'ex-field-reps', workSec: 'ex-field-work', weight: 'ex-field-weight', restSec: 'ex-field-rest', rpeTarget: 'ex-field-rpe' };
  const kx = () => window.KruxExercises;
  const catalog = () => (window.KruxLibrary ? window.KruxLibrary.catalog() : null);
  const num = (id, parse) => parse($(id).value.replace(',', '.'));

  function current() {
    return ctx ? ctx.exercise : (window.kruxTrainData && window.kruxTrainData.exercises[editingIdx]);
  }

  function readFields() {
    const out = {
      name:      $('ex-field-name').value.trim(),
      sets:      Math.max(1, num('ex-field-sets', parseInt) || 1),
      reps:      Math.max(0, num('ex-field-reps', parseInt) || 0),
      workSec:   Math.max(0, num('ex-field-work', parseInt) || 0),
      weight:    Math.max(0, num('ex-field-weight', parseFloat) || 0),
      restSec:   Math.max(0, num('ex-field-rest', parseInt) || 0),
      rpeTarget: Math.min(10, Math.max(0, num('ex-field-rpe', parseInt) || 0)),
      notes:     $('ex-field-notes').value.trim().slice(0, 300)
    };
    extraParams.forEach(p => {
      const el = $('ex-extra-' + p.key);
      if (!el) return;
      if (p.type === 'text') {
        const v = el.value.trim();
        out[p.key] = kx().TEMPO_RE.test(v) ? v : '';
        out['_invalid_' + p.key] = !!v && !out[p.key];
      } else {
        const n = parseFloat(el.value.replace(',', '.'));
        out[p.key] = isFinite(n) ? Math.max(p.min || 0, Math.min(p.max, n)) : 0;
      }
    });
    return out;
  }

  function updatePreview() {
    const preview = $('ex-preview-text');
    if (!preview) return;
    preview.textContent = buildExDetail(readFields()) || '—';
  }

  // Etiquetas y campos según la ficha del ejercicio (p. ej. «Intentos» en lugar de «Repeticiones»)
  function renderParams(ex) {
    const cat = catalog();
    const params = cat && kx() ? kx().paramsForPlanItem(cat, ex) : [];
    Object.keys(BASE).forEach(key => {
      const field = $(BASE[key]).closest('.ex-field');
      const label = field.querySelector('.ex-field-label');
      const def = params.find(p => p.key === key);
      // Con ficha, los básicos que no le corresponden se ocultan (salvo que ya tengan un valor)
      field.classList.toggle('hidden', !!def && !def.applies && !(Number(ex[key]) > 0));
      const defaults = { sets: 'Series', reps: 'Repeticiones', workSec: 'Tiempo trabajo (seg)', weight: 'Peso adicional (kg)', restSec: 'Descanso (seg)', rpeTarget: 'RPE objetivo (0 = ninguno)' };
      label.textContent = def && (key === 'reps' || key === 'workSec') && def.label !== (kx().PARAMS[key === 'reps' ? 'repetitions' : 'workDurationSeconds'].label)
        ? `${def.label}${def.unit ? ` (${def.unit})` : ''}` : defaults[key];
    });
    extraParams = params.filter(p => !BASE[p.key]);
    const box = $('ex-extra');
    const wrap = $('ex-extra-fields');
    wrap.innerHTML = extraParams.map(p => `
      <div class="ex-field">
        <label class="ex-field-label" for="ex-extra-${p.key}">${trEsc(p.label)}${p.unit ? ` (${p.unit})` : ''}</label>
        ${p.type === 'text'
          ? `<input class="ex-field-input ex-field-num" id="ex-extra-${p.key}" type="text" inputmode="numeric" maxlength="11" placeholder="3-1-1">`
          : `<input class="ex-field-input ex-field-num" id="ex-extra-${p.key}" type="number" min="${p.min}" max="${p.max}" step="${p.step}" inputmode="decimal" placeholder="0">`}
      </div>`).join('');
    box.classList.toggle('hidden', !extraParams.length);
    extraParams.forEach(p => {
      const el = $('ex-extra-' + p.key);
      const v = ex[p.key];
      el.value = p.type === 'text' ? (v || '') : (v > 0 ? v : '');
      el.addEventListener('input', updatePreview);
    });
  }

  function renderLinks(ex) {
    const box = $('ex-links');
    const items = [];
    if (ex.exerciseId && window.KruxLibrary) items.push('<button type="button" class="ex-link-btn" data-act="sheet">Ver ficha del ejercicio</button>');
    if (ctx && ctx.onReplace) items.push('<button type="button" class="ex-link-btn" data-act="replace">Sustituir ejercicio</button>');
    box.innerHTML = items.join('');
    box.classList.toggle('hidden', !items.length);
  }

  function open(idx, opts) {
    ctx = opts && opts.exercise ? opts : null;
    const ex = ctx ? ctx.exercise : window.kruxTrainData && window.kruxTrainData.exercises[idx];
    if (!ex) return;
    editingIdx = typeof idx === 'number' ? idx : -1;
    // Enlace en memoria con la ficha (por nombre exacto); se guarda al guardar el plan
    const cat = catalog();
    if (cat && kx()) kx().linkPlanItem(cat, ex);
    $('ex-field-name').value   = ex.name;
    $('ex-field-sets').value   = ex.sets;
    $('ex-field-reps').value   = ex.reps   || 0;
    $('ex-field-work').value   = ex.workSec;
    $('ex-field-weight').value = ex.weight || 0;
    $('ex-field-rest').value   = ex.restSec;
    $('ex-field-rpe').value    = ex.rpeTarget;
    $('ex-field-notes').value  = ex.notes || '';
    renderParams(ex);
    renderLinks(ex);
    updatePreview();
    $('ex-editor-sheet').classList.remove('hidden');
    setTimeout(() => $('ex-field-name').focus(), 320);
  }

  function close() {
    $('ex-editor-sheet').classList.add('hidden');
    editingIdx = -1;
    ctx = null;
  }

  function reRenderList() {
    if (typeof window.kruxRenderTrainExercises === 'function') window.kruxRenderTrainExercises();
  }

  function save() {
    const ex = current();
    if (!ex) return;
    const f = readFields();
    const bad = extraParams.find(p => f['_invalid_' + p.key]);
    if (bad) {
      if (typeof showToast === 'function') showToast('El tempo no es válido', 'error', { detail: 'Usa números separados por guiones, por ejemplo 3-1-1.' });
      return;
    }
    if (f.name) ex.name = f.name;
    ['sets', 'reps', 'workSec', 'weight', 'restSec', 'rpeTarget'].forEach(k => { ex[k] = f[k]; });
    if (f.notes) ex.notes = f.notes; else delete ex.notes;
    extraParams.forEach(p => { if (f[p.key]) ex[p.key] = f[p.key]; else delete ex[p.key]; });

    if (ctx) {
      const done = ctx.onSave;
      close();
      if (done) done();
      return;
    }
    close();
    reRenderList();
    if (typeof showToast === 'function') showToast('Ejercicio actualizado', 'success');
    if (!window.kruxTrainData.demo && window.kruxActivePlan) KruxTrainStore.savePlan(window.kruxActivePlan);
  }

  document.addEventListener('DOMContentLoaded', () => {
    ['ex-field-sets', 'ex-field-reps', 'ex-field-work', 'ex-field-weight', 'ex-field-rest', 'ex-field-rpe'].forEach(id => {
      const el = $(id);
      if (el) el.addEventListener('input', updatePreview);
    });
    const closeBtn = $('ex-editor-close');
    const backdrop = $('ex-editor-backdrop');
    const saveBtn  = $('ex-editor-save');
    if (closeBtn) closeBtn.addEventListener('click', close);
    if (backdrop) backdrop.addEventListener('click', close);
    if (saveBtn)  saveBtn.addEventListener('click', save);
    $('ex-editor-sheet')?.addEventListener('focusin', e => {
      if (!e.target.matches('input, textarea')) return;
      setTimeout(() => e.target.scrollIntoView({ block: 'center', behavior: 'smooth' }), 320);
    });
    $('ex-links')?.addEventListener('click', e => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const ex = current();
      if (btn.dataset.act === 'sheet' && ex && ex.exerciseId) {
        window.KruxLibrary.openSheet(ex.exerciseId);
      } else if (btn.dataset.act === 'replace' && ctx && ctx.onReplace) {
        const done = ctx.onReplace;
        close();
        done();
      }
    });
  });

  window.openExerciseEditor = open;
  window.closeExerciseEditor = close;
})();

// Re-initialize activity when user logs in
firebase.auth().onAuthStateChanged(user => {
  if (user) {
    setTimeout(() => loadActivityData(), 1000);
  }
});

// ========== PROGRESS CARDS ==========
let _pcAscents = [];
let _pcCurrentPeriod = 'month';
let _pcCurrentSlide = 0;
let _pcPageCount = 1;
let _pcNavContext = null; // {year} for month, {year, month} for week, {year} for year

function updatePcTimeNav(period) {
  const sel = document.getElementById('pc-time-nav');
  if (!sel) return;
  sel.innerHTML = '';

  const now = new Date();
  const monthLabels = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

  if (period === 'month') {
    const years = [...new Set(_pcAscents.map(a => {
      const d = parseAscentDate(a.date);
      return d ? d.getFullYear() : null;
    }).filter(Boolean))].sort((a,b) => b - a);
    if (!years.length) years.push(now.getFullYear());
    years.forEach(y => {
      const opt = document.createElement('option');
      opt.value = y;
      opt.textContent = y;
      if (y === (_pcNavContext?.year ?? now.getFullYear())) opt.selected = true;
      sel.appendChild(opt);
    });
    sel.style.display = '';
    _pcNavContext = { year: parseInt(sel.value) };

  } else if (period === 'week') {
    const monthsSet = new Set();
    _pcAscents.forEach(a => {
      const d = parseAscentDate(a.date);
      if (d) monthsSet.add(`${d.getFullYear()}-${String(d.getMonth()).padStart(2,'0')}`);
    });
    const sortedMonths = [...monthsSet].sort().reverse();
    if (!sortedMonths.length) sortedMonths.push(`${now.getFullYear()}-${String(now.getMonth()).padStart(2,'0')}`);
    sortedMonths.forEach(key => {
      const [y, m] = key.split('-').map(Number);
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = `${monthLabels[m]} ${y}`;
      const curKey = `${_pcNavContext?.year ?? now.getFullYear()}-${String(_pcNavContext?.month ?? now.getMonth()).padStart(2,'0')}`;
      if (key === curKey) opt.selected = true;
      sel.appendChild(opt);
    });
    sel.style.display = '';
    const [y, m] = sel.value.split('-').map(Number);
    _pcNavContext = { year: y, month: m };

  } else {
    sel.style.display = 'none';
    _pcNavContext = null;
  }
}

function initProgressCards() {
  const tabs = document.querySelectorAll('[data-pc]');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const period = tab.dataset.pc;
      if (period === 'custom') {
        openProgressCardCustom();
        return;
      }
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      _pcCurrentPeriod = period;
      _pcNavContext = null;
      document.getElementById('pc-custom-banner')?.classList.add('hidden');
      updatePcTimeNav(period);
      renderProgressCards(period, _pcAscents);
    });
  });

  document.getElementById('pc-time-nav')?.addEventListener('change', e => {
    const val = e.target.value;
    if (_pcCurrentPeriod === 'month') {
      _pcNavContext = val ? { year: parseInt(val) } : null;
    } else if (_pcCurrentPeriod === 'week') {
      if (val) { const [y, m] = val.split('-').map(Number); _pcNavContext = { year: y, month: m }; }
      else _pcNavContext = null;
    }
    renderProgressCards(_pcCurrentPeriod, _pcAscents);
  });

  document.getElementById('pc-overlay')?.addEventListener('click', e => {
    if (e.target === document.getElementById('pc-overlay')) closePcPopup();
  });
  document.getElementById('pc-btn-cancel')?.addEventListener('click', closePcPopup);
  document.getElementById('pc-btn-apply')?.addEventListener('click', applyPcCustom);
  document.getElementById('pc-banner-clear')?.addEventListener('click', clearPcCustom);

  document.querySelectorAll('.pc-preset').forEach(btn => {
    btn.addEventListener('click', () => {
      const days = parseInt(btn.dataset.days);
      const today = new Date();
      const from = new Date();
      from.setDate(from.getDate() - days);
      document.getElementById('pc-date-from').value = from.toISOString().split('T')[0];
      document.getElementById('pc-date-to').value = today.toISOString().split('T')[0];
    });
  });

  // Swipe support — listeners attached once, handlers read up-to-date globals
  const outer = document.getElementById('pc-carousel-outer');
  if (outer) {
    let startX = 0;
    outer.addEventListener('touchstart', e => { startX = e.touches[0].clientX; }, { passive: true });
    outer.addEventListener('touchend', e => {
      const dx = e.changedTouches[0].clientX - startX;
      if (Math.abs(dx) > 40) {
        goPcSlide(Math.max(0, Math.min(_pcPageCount - 1, _pcCurrentSlide + (dx < 0 ? 1 : -1))));
      }
    }, { passive: true });
  }

  document.getElementById('pc-arrow-prev')?.addEventListener('click', () => {
    if (_pcCurrentSlide > 0) goPcSlide(_pcCurrentSlide - 1);
  });
  document.getElementById('pc-arrow-next')?.addEventListener('click', () => {
    if (_pcCurrentSlide < _pcPageCount - 1) goPcSlide(_pcCurrentSlide + 1);
  });
}

function openProgressCardCustom() {
  const today = new Date().toISOString().split('T')[0];
  const from = new Date(); from.setMonth(from.getMonth() - 1);
  document.getElementById('pc-date-from').value = from.toISOString().split('T')[0];
  document.getElementById('pc-date-to').value = today;
  document.getElementById('pc-overlay').classList.remove('hidden');
}

function closePcPopup() {
  document.getElementById('pc-overlay')?.classList.add('hidden');
}

function applyPcCustom() {
  const from = document.getElementById('pc-date-from').value;
  const to = document.getElementById('pc-date-to').value;
  if (!from || !to || from > to) return;
  closePcPopup();

  document.querySelectorAll('[data-pc]').forEach(t => t.classList.remove('active'));
  const banner = document.getElementById('pc-custom-banner');
  if (banner) {
    banner.classList.remove('hidden');
    document.getElementById('pc-banner-text').textContent = `${fmtPcDate(from)} – ${fmtPcDate(to)}`;
  }
  renderProgressCards('custom', _pcAscents, from, to);
}

function clearPcCustom() {
  document.getElementById('pc-custom-banner')?.classList.add('hidden');
  const monthTab = document.querySelector('[data-pc="month"]');
  if (monthTab) {
    document.querySelectorAll('[data-pc]').forEach(t => t.classList.remove('active'));
    monthTab.classList.add('active');
  }
  _pcCurrentPeriod = 'month';
  renderProgressCards('month', _pcAscents);
}

function fmtPcDate(s) {
  const [y, m, d] = s.split('-');
  const months = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
  return `${parseInt(d)} ${months[parseInt(m) - 1]}`;
}

function renderProgressCards(period, ascents, customFrom, customTo) {
  if (ascents) _pcAscents = ascents;
  const carouselEl = document.getElementById('pc-carousel');
  const dotsEl = document.getElementById('pc-carousel-dots');
  if (!carouselEl) return;

  const cards = buildPcCardData(_pcAscents, period, customFrom, customTo, _pcNavContext);

  if (!cards.length) {
    carouselEl.innerHTML = `<div class="pc-carousel-slide"><div class="pc-cards-grid"><div class="pc-empty-card" style="grid-column:1/-1">Sin ascensiones en este periodo</div></div></div>`;
    if (dotsEl) dotsEl.innerHTML = '';
    _pcPageCount = 1;
    return;
  }

  const maxIdx = Math.max(...cards.map(c => getGradeIndex(c.max)).filter(i => i >= 0));

  // Chunk cards into pages of 4
  const pages = [];
  for (let i = 0; i < cards.length; i += 4) pages.push(cards.slice(i, i + 4));
  _pcPageCount = pages.length;

  carouselEl.innerHTML = pages.map(page =>
    `<div class="pc-carousel-slide"><div class="pc-cards-grid">${
      page.map(c => makePcCard(c, getGradeIndex(c.max) === maxIdx && c.count > 0)).join('')
    }</div></div>`
  ).join('');

  if (dotsEl) {
    dotsEl.innerHTML = pages.length > 1
      ? pages.map((_, i) => `<button class="pc-carousel-dot" data-pc-slide="${i}"></button>`).join('')
      : '';
    dotsEl.querySelectorAll('.pc-carousel-dot').forEach(dot =>
      dot.addEventListener('click', () => goPcSlide(parseInt(dot.dataset.pcSlide)))
    );
  }

  const target = Math.min(getPcInitialSlide(period, cards), pages.length - 1);
  goPcSlide(target, false);
}

function getPcInitialSlide(period, cards) {
  const now = new Date();
  if (period === 'week') {
    const dow = now.getDay();
    const dayIndex = dow === 0 ? 6 : dow - 1; // 0=Mon..6=Sun
    return Math.floor(dayIndex / 4);
  }
  if (period === 'month') {
    return Math.floor(now.getMonth() / 4);
  }
  if (period === 'year') {
    const currentYear = String(now.getFullYear());
    const idx = cards.findIndex(c => c.label === currentYear);
    return idx >= 0 ? Math.floor(idx / 4) : Math.max(0, Math.floor((cards.length - 1) / 4));
  }
  return 0;
}

function goPcSlide(index, animate = true) {
  _pcCurrentSlide = index;
  const carouselEl = document.getElementById('pc-carousel');
  if (!carouselEl) return;
  if (!animate) {
    carouselEl.style.transition = 'none';
    carouselEl.style.transform = `translateX(-${index * 100}%)`;
    carouselEl.offsetHeight; // force reflow
    carouselEl.style.transition = '';
  } else {
    carouselEl.style.transform = `translateX(-${index * 100}%)`;
  }
  document.querySelectorAll('.pc-carousel-dot').forEach((d, i) =>
    d.classList.toggle('active', i === index)
  );
  const onlyOne = _pcPageCount <= 1;
  document.getElementById('pc-arrow-prev')?.classList.toggle('pc-arrow-hidden', onlyOne || index === 0);
  document.getElementById('pc-arrow-next')?.classList.toggle('pc-arrow-hidden', onlyOne || index >= _pcPageCount - 1);
}


function buildPcCardData(ascents, period, customFrom, customTo, navContext) {
  const now = new Date();
  const monthLabels = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  const dayLabels = ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'];
  let groups = [];

  if (period === 'week') {
    const selYear = navContext?.year ?? now.getFullYear();
    const selMonth = navContext?.month ?? now.getMonth();
    const daysInMonth = new Date(selYear, selMonth + 1, 0).getDate();
    for (let startDay = 1; startDay <= daysInMonth; startDay += 7) {
      const endDay = Math.min(startDay + 6, daysInMonth);
      const from = new Date(selYear, selMonth, startDay, 0, 0, 0, 0);
      const to = new Date(selYear, selMonth, endDay, 23, 59, 59, 999);
      const weekAscents = ascents.filter(a => {
        const d = parseAscentDate(a.date);
        return d && d >= from && d <= to;
      });
      if (weekAscents.length) groups.push({ label: `${startDay}–${endDay} ${monthLabels[selMonth]}`, ascents: weekAscents });
    }

  } else if (period === 'month') {
    const selYear = navContext?.year ?? now.getFullYear();
    for (let m = 0; m < 12; m++) {
      const monthAscents = ascents.filter(a => {
        const d = parseAscentDate(a.date);
        return d && d.getFullYear() === selYear && d.getMonth() === m;
      });
      if (monthAscents.length) groups.push({ label: monthLabels[m], ascents: monthAscents });
    }

  } else if (period === 'year') {
    const allYears = [...new Set(ascents.map(a => {
      const d = parseAscentDate(a.date);
      return d ? d.getFullYear() : null;
    }).filter(Boolean))].sort();
    const filteredYears = navContext?.year ? allYears.filter(y => y === navContext.year) : allYears;
    filteredYears.forEach(y => {
      const yAscents = ascents.filter(a => {
        const d = parseAscentDate(a.date);
        return d && d.getFullYear() === y;
      });
      if (yAscents.length) groups.push({ label: String(y), ascents: yAscents });
    });

  } else if (period === 'custom' && customFrom && customTo) {
    const from = new Date(customFrom);
    const to = new Date(customTo);
    to.setHours(23,59,59,999);
    const rangeAscents = ascents.filter(a => {
      const d = parseAscentDate(a.date);
      return d && d >= from && d <= to;
    });
    if (rangeAscents.length) groups.push({ label: `${fmtPcDate(customFrom)} – ${fmtPcDate(customTo)}`, ascents: rangeAscents });
  }

  return groups.map(g => {
    const grades = g.ascents.map(a => getGradeIndex(a.grade)).filter(i => i >= 0);
    if (!grades.length) return null;
    const maxGrade = getGradeFromIndex(Math.max(...grades));
    const minGrade = getGradeFromIndex(Math.min(...grades));
    const avgGrade = getGradeFromIndex(Math.round(grades.reduce((a,b) => a+b,0) / grades.length));
    return { label: g.label, count: g.ascents.length, max: maxGrade, min: minGrade, avg: avgGrade };
  }).filter(Boolean);
}

function makePcCard(d, isTop) {
  const total = HISTOGRAM_GRADE_ORDER.length - 1;
  const maxI = getGradeIndex(d.max);
  const minI = getGradeIndex(d.min);
  const avgI = getGradeIndex(d.avg);
  const isPoint = maxI === minI;
  const leftPct = Math.round((minI / total) * 100);
  const widthPct = isPoint ? 0 : Math.max(4, Math.round(((maxI - minI) / total) * 100));
  const avgPct = Math.round((avgI / total) * 100);

  return `<div class="pc-card${isTop ? ' pc-card-top' : ''}">
    <div class="pc-card-head">
      <span class="pc-card-period">${d.label}</span>
      <span class="pc-card-count${isTop ? ' pc-card-count-top' : ''}">${d.count} ${d.count === 1 ? 'vía' : 'vías'}</span>
    </div>
    <div class="pc-grade-labels">
      <span class="pc-grade-min">${d.min}</span>
      <span class="pc-grade-max">${d.max}</span>
    </div>
    <div class="pc-prog-track">
      ${!isPoint ? `<div class="pc-prog-range" style="left:${leftPct}%;width:${widthPct}%"></div>` : ''}
      <div class="pc-prog-avg" style="left:${avgPct}%"></div>
    </div>
    <div class="pc-card-footer">
      <span class="pc-avg-label">Grado medio</span>
      <span class="pc-avg-val">${d.avg}</span>
    </div>
  </div>`;
}
// ========== END PROGRESS CARDS ==========

// Reutiliza el diálogo de confirmación con un botón propio (no destructivo por defecto).
// Se muestra por encima de las pantallas de Entrena (sesión, planes, biblioteca).
window.kruxConfirm = function confirmThen(title, message, fn, okLabel = 'Finalizar', danger = false) {
  const $ = id => document.getElementById(id);
  const ok = $('confirm-ok');
  const cancel = $('confirm-cancel');
  if (typeof showConfirmModal !== 'function' || !ok || !cancel) {
    if (window.confirm(`${title}\n${message}`)) fn();
    return;
  }
  const prev = { text: ok.textContent, cls: ok.className };
  const restore = () => {
    ok.textContent = prev.text;
    ok.className = prev.cls;
    ok.removeEventListener('click', restore);
    cancel.removeEventListener('click', restore);
    $('confirm-modal')?.removeEventListener('click', onBackdrop);
    $('confirm-modal')?.classList.remove('kx-above');
  };
  const onBackdrop = e => { if (e.target.id === 'confirm-modal') restore(); };
  ok.textContent = okLabel;
  ok.className = danger ? 'btn-danger' : 'btn-primary kx-confirm-primary';
  $('confirm-modal')?.classList.add('kx-above');
  showConfirmModal(title, message, fn);
  ok.addEventListener('click', restore);
  cancel.addEventListener('click', restore);
  $('confirm-modal')?.addEventListener('click', onBackdrop);
};

// ================== ACTIVE SESSION MODULE ==================
(function () {
  // La sesión trabaja SIEMPRE con la copia tomada al empezar (run), nunca con el plan editable:
  // refrescar Entrena, editar el plan, cargar datos o cambiar de cuenta no alteran lo que se ejecuta.
  //   run.exercises     copia de trabajo (la carga puede ajustarse durante la sesión, solo en esta copia)
  //   run.prescription  copia congelada de la prescripción original (es lo que se guarda como objetivo)
  let run = null;
  function EXERCISES() { return run ? run.exercises : []; }

  function deepFreeze(o) {
    Object.values(o).forEach(v => { if (v && typeof v === 'object') deepFreeze(v); });
    return Object.freeze(o);
  }

  function takeSnapshot(data) {
    const copy = () => {
      const items = JSON.parse(JSON.stringify(data.exercises || []));
      // Enlace en memoria con la ficha (por nombre exacto) antes de congelar: el historial guarda exerciseId
      const cat = window.KruxLibrary && window.KruxLibrary.catalog();
      if (cat && window.KruxExercises) items.forEach(it => window.KruxExercises.linkPlanItem(cat, it));
      return items;
    };
    return {
      planId: data.planId || null,
      planName: data.planName || '',
      planRevision: data.planRevision || null,
      planSessionId: data.planSessionId || null,
      sessionName: data.name,
      demo: !!data.demo,
      ownerUid: (window.KruxTrainStore && KruxTrainStore.currentUid && KruxTrainStore.currentUid()) || null,
      exercises: copy(),
      prescription: deepFreeze(copy())
    };
  }

  // ¿Hay un entrenamiento en curso? Lo consultan las acciones sobre planes
  window.KruxTrainSession = {
    isRunning: () => !!run,
    info: () => (run ? { planId: run.planId, planName: run.planName, sessionName: run.sessionName } : null)
  };

  const RING = 314;
  const SVG = {
    play:  `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15a1 1 0 0 0 1.5.86l12-7.5a1 1 0 0 0 0-1.72l-12-7.5A1 1 0 0 0 7 4.5z"/></svg>`,
    pause: `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="4.5" width="4" height="15" rx="1.2"></rect><rect x="14" y="4.5" width="4" height="15" rx="1.2"></rect></svg>`,
    skip:  `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M5 5.5v13a1 1 0 0 0 1.53.85L16 13.2V18a1 1 0 0 0 2 0V6a1 1 0 0 0-2 0v4.8L6.53 4.65A1 1 0 0 0 5 5.5z"/></svg>`,
    check: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>`,
    flag:  `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 21V4"/><path d="M5 4h11l-1.5 4L16 12H5"/></svg>`,
  };

  // ── Audio (Web Audio API, sin archivos externos) ──────────────────────
  let audioCtx = null;

  function getAudioCtx() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    // Reanudar si fue suspendido por política de autoplay
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }

  function beep({ freq = 880, duration = 0.08, volume = 0.4, type = 'sine', delay = 0 } = {}) {
    try {
      const ctx = getAudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = type;
      osc.frequency.setValueAtTime(freq, ctx.currentTime + delay);
      gain.gain.setValueAtTime(volume, ctx.currentTime + delay);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + duration);
      osc.start(ctx.currentTime + delay);
      osc.stop(ctx.currentTime + delay + duration + 0.01);
    } catch (_) { /* silencioso si el navegador bloquea audio */ }
  }

  // Tick sutil cada segundo durante trabajo
  function soundTick()    { beep({ freq: 660, duration: 0.04, volume: 0.2 }); }
  // Pitidos urgentes en los últimos 3 segundos de trabajo
  function soundUrgent()  { beep({ freq: 1100, duration: 0.07, volume: 0.5, type: 'square' }); }
  // Triple pitido al completar una serie / fin de trabajo
  function soundDone() {
    beep({ freq: 880,  duration: 0.1, volume: 0.6, delay: 0.0 });
    beep({ freq: 1100, duration: 0.1, volume: 0.6, delay: 0.13 });
    beep({ freq: 1320, duration: 0.18, volume: 0.7, delay: 0.26 });
  }
  // Pitido suave al terminar el descanso
  function soundRestEnd() {
    beep({ freq: 660,  duration: 0.12, volume: 0.5, delay: 0.0 });
    beep({ freq: 880,  duration: 0.18, volume: 0.6, delay: 0.16 });
  }
  // ─────────────────────────────────────────────────────────────────────

  // mode: idle | work | paused | rest | between (ejercicio terminado, esperando al siguiente)
  let exIdx, setsDone, mode, timerSec, targetSec, intervalId, elapsedSec, elapsedId, record, rpeOpen;
  let TEMPLATE = '';

  function $ (id) { return document.getElementById(id); }
  function fmt2(n) { return String(n).padStart(2, '0'); }
  function clock(sec) { return `${Math.floor(sec / 60)}:${fmt2(sec % 60)}`; }
  function hms(sec) { return `${fmt2(Math.floor(sec / 3600))}:${fmt2(Math.floor(sec / 60) % 60)}:${fmt2(sec % 60)}`; }
  function nowHM() { const d = new Date(); return `${fmt2(d.getHours())}:${fmt2(d.getMinutes())}`; }
  function esc(t) { return typeof trEsc === 'function' ? trEsc(t) : String(t ?? ''); }
  function dur(sec) { return typeof trFmtDuration === 'function' ? trFmtDuration(sec) : `${sec} s`; }

  function announce(text) {
    const el = $('session-sr-status');
    if (el) el.textContent = text;
  }

  function doneSetsTotal() { return record ? record.exercises.reduce((a, e) => a + e.sets.length, 0) : 0; }
  function plannedSetsTotal() { return EXERCISES().reduce((a, e) => a + e.sets, 0); }
  function curSets() { return record.exercises[exIdx].sets; }

  function open() {
    if (run) return;   // ya hay un entrenamiento abierto: no se reinicia
    const source = window.kruxTrainData;
    if (!source || !(source.exercises || []).length) {
      if (typeof showToast === 'function') showToast('Esta sesión no tiene ejercicios', 'info');
      return;
    }
    const modal = $('session-modal');
    const screen = $('session-screen');
    if (!modal || !screen) return;
    run = takeSnapshot(source);

    // Restaurar la pantalla si la sustituyó el resumen final
    if (TEMPLATE && !screen.querySelector('.session-hero')) screen.innerHTML = TEMPLATE;

    exIdx = 0; setsDone = 0; mode = 'idle';
    timerSec = 0; targetSec = 0; intervalId = null;
    elapsedSec = 0; elapsedId = null; rpeOpen = false;

    const data = run;
    record = {
      dateKey: typeof trDateKey === 'function' ? trDateKey(new Date()) : new Date().toISOString().slice(0, 10),
      sessionName: data.sessionName,
      demo: data.demo,
      startedAt: Date.now(),
      ownerUid: data.ownerUid,
      planId: data.planId, planName: data.planName, planRevision: data.planRevision, planSessionId: data.planSessionId,
      exercises: data.prescription.map(ex => ({
        name: ex.name,
        exerciseId: ex.exerciseId || null,
        exerciseContentVersion: ex.exerciseContentVersion || null,
        // Prescripción objetivo congelada al empezar: no cambia aunque luego se edite el plan,
        // ni por los ajustes hechos durante la sesión (esos quedan en cada serie realizada)
        target: {
          sets: ex.sets, workSec: ex.workSec, reps: ex.reps, weight: ex.weight, restSec: ex.restSec, rpeTarget: ex.rpeTarget,
          assistanceKg: ex.assistanceKg, distanceM: ex.distanceM, tempo: ex.tempo, recoverySec: ex.recoverySec, notes: ex.notes
        },
        sets: []
      }))
    };

    modal.classList.remove('hidden');
    document.body.classList.add('session-open');

    $('session-elapsed').textContent = hms(0);
    elapsedId = setInterval(() => {
      elapsedSec++;
      const el = $('session-elapsed');
      if (el) el.textContent = hms(elapsedSec);
    }, 1000);

    $('session-session-name').textContent = data.demo ? `${data.sessionName} · ejemplo` : data.sessionName;
    renderExercise();
    // Foco en el título del ejercicio para lectores de pantalla (sin anillo visible)
    setTimeout(() => $('session-ex-name')?.focus({ preventScroll: true }), 350);
  }

  function close() {
    clearInterval(intervalId);
    clearInterval(elapsedId);
    const modal = $('session-modal');
    if (modal) modal.classList.add('hidden');
    document.body.classList.remove('session-open');
    run = null;
    if (typeof window.refreshTrainView === 'function') window.refreshTrainView();
  }

  // Diálogo de confirmación compartido (window.kruxConfirm)
  const confirmThen = (...args) => window.kruxConfirm(...args);

  function requestClose() {
    const n = doneSetsTotal();
    if (!n || !$('session-screen').querySelector('.session-hero')) return close();
    confirmThen('¿Salir sin terminar?', `Se perderán las ${n} ${n === 1 ? 'serie registrada' : 'series registradas'}.`, close, 'Salir', true);
  }

  function requestFinish() {
    const n = doneSetsTotal();
    const total = plannedSetsTotal();
    if (!n) return confirmThen('¿Salir del entrenamiento?', 'Todavía no has completado ninguna serie.', close, 'Salir');
    if (n >= total) return showCompletion();
    confirmThen('¿Finalizar el entrenamiento?', `Llevas ${n} de ${total} series. Pasarás al resumen con lo que has hecho.`, showCompletion);
  }

  // ── Render ──────────────────────────────────────────────────────────
  function renderExercise() {
    const ex = EXERCISES()[exIdx];
    const total = EXERCISES().length;
    $('session-ex-counter').textContent = `Ejercicio ${exIdx + 1} de ${total}`;
    $('session-ex-name').textContent = ex.name;
    renderSpecs();
    const guideBtn = $('session-guide-btn');
    if (guideBtn) {
      const gid = window.KruxGuide ? window.KruxGuide.idFor(ex) : null;
      guideBtn.hidden = !gid;
      guideBtn.dataset.guide = gid || '';
    }

    const rpe = $('session-ex-rpe');
    rpe.textContent = ex.rpeTarget ? `RPE ${ex.rpeTarget}` : '';
    rpe.classList.toggle('hidden', !ex.rpeTarget);

    $('session-steps').innerHTML = EXERCISES().map((e, i) => {
      const st = i < exIdx ? 'is-done' : i === exIdx ? 'is-current' : '';
      return `<li class="${st}"><span class="sr-only">${esc(e.name)}${i < exIdx ? ', hecho' : i === exIdx ? ', en curso' : ''}</span></li>`;
    }).join('');

    renderNext();
    rpeOpen = false;
    setMode('idle');
    announce(`Ejercicio ${exIdx + 1} de ${total}: ${ex.name}`);
  }

  function renderSpecs() {
    const ex = EXERCISES()[exIdx];
    const parts = [typeof trFmtWork === 'function' ? trFmtWork(ex) : `${ex.sets} series`];
    if (ex.weight > 0) parts.push(`+${ex.weight} kg`);
    if (ex.restSec > 0) parts.push(`Descanso ${dur(ex.restSec)}`);
    $('session-ex-detail').textContent = parts.join(' · ');
  }

  function renderNext() {
    const next = EXERCISES()[exIdx + 1];
    $('session-next-label').textContent = next ? 'Siguiente' : 'Último ejercicio';
    $('session-next-name').textContent = next ? next.name : 'Terminar sesión';
    $('session-skip-btn').setAttribute('aria-label', next ? `Pasar a ${next.name}` : 'Terminar sesión');
  }

  function renderDots() {
    const ex = EXERCISES()[exIdx];
    let html = '';
    for (let i = 0; i < ex.sets; i++) {
      const cls = i < setsDone ? 'is-done' : (i === setsDone && mode !== 'between') ? 'is-current' : '';
      html += `<span class="${cls}"></span>`;
    }
    $('session-sets-row').innerHTML = html;
    const shown = Math.min(setsDone + (mode === 'between' ? 0 : 1), ex.sets);
    $('session-set-chip').textContent = `Serie ${Math.max(1, shown)} / ${ex.sets}`;
  }

  function renderMetrics() {
    const ex = EXERCISES()[exIdx];
    $('session-load-val').textContent = ex.weight > 0 ? `+${ex.weight} kg` : '0 kg';
    $('session-load-minus').disabled = !(ex.weight > 0);
    $('session-rest-val').textContent = ex.restSec > 0 ? dur(ex.restSec) : 'Sin descanso';

    const sets = curSets();
    const last = sets[sets.length - 1];
    const btn = $('session-rpe-btn');
    $('session-rpe-lbl').textContent = last ? `RPE serie ${last.n}` : 'RPE';
    $('session-rpe-val').textContent = last && last.rpe ? String(last.rpe) : (last ? 'Anotar' : '—');
    btn.classList.toggle('is-empty', !(last && last.rpe));
    btn.setAttribute('aria-expanded', String(rpeOpen));

    const sec = $('session-rpe-section');
    sec.classList.toggle('hidden', !(rpeOpen && last));
    if (rpeOpen && last) {
      $('session-rpe-label').textContent = `¿Cómo ha ido la serie ${last.n}?${ex.rpeTarget ? ` Objetivo: RPE ${ex.rpeTarget}` : ''}`;
      $('session-rpe-dots').innerHTML = [5, 6, 7, 8, 9, 10].map(v => {
        const tone = v >= 9 ? ' is-hi' : v >= 8 ? ' is-warn' : '';
        return `<button type="button" class="session-rpe-dot${tone}${v === last.rpe ? ' is-selected' : ''}" data-rpe="${v}" aria-pressed="${v === last.rpe}">${v}</button>`;
      }).join('');
    }
  }

  function renderHistory() {
    const ex = EXERCISES()[exIdx];
    const sets = curSets();
    const rows = [];
    for (let i = 0; i < ex.sets; i++) {
      const s = sets[i];
      if (s) {
        const val = s.workSec ? dur(s.workSec) : s.reps ? `${s.reps} rep` : 'Hecha';
        const meta = [val, s.weight > 0 ? `+${s.weight} kg` : '', s.rpe ? `RPE ${s.rpe}` : ''].filter(Boolean).join(' · ');
        rows.push(`<li class="is-done"><span class="session-h-mark">${SVG.check}</span><span class="session-h-text"><strong>Serie ${i + 1}</strong><span>${esc(meta)}</span></span><time>${s.time}</time></li>`);
      } else {
        const current = i === setsDone && mode !== 'between';
        const txt = current ? (mode === 'work' ? 'En curso' : mode === 'rest' ? 'Después del descanso' : 'Preparada') : 'Pendiente';
        rows.push(`<li class="${current ? 'is-current' : ''}"><span class="session-h-mark"></span><span class="session-h-text"><strong>Serie ${i + 1}</strong><span>${txt}</span></span><time>–</time></li>`);
      }
    }
    $('session-history').innerHTML = rows.join('');
  }

  function setRing(fraction) {
    const arc = $('session-ring-arc');
    arc.style.strokeDashoffset = String(Math.max(0, Math.min(RING, RING - RING * fraction)));
    arc.classList.toggle('is-empty', fraction <= 0);
  }

  function showBig(sec, longLabel = 'restantes') {
    const t = $('session-ring-time');
    t.textContent = sec < 60 ? String(sec) : clock(sec);
    $('session-ring-lbl').textContent = sec < 60 ? (sec === 1 ? 'segundo' : 'segundos') : longLabel;
  }

  function setMainBtn(icon, text, primary = true) {
    $('session-btn-main').removeAttribute('aria-label');
    $('session-btn-icon').innerHTML = icon;
    $('session-btn-label').textContent = text;
    $('session-btn-main').classList.toggle('is-quiet', !primary);
  }

  function setMode(m) {
    mode = m;
    clearInterval(intervalId);
    const ex = EXERCISES()[exIdx];
    const block = $('session-timer-block');
    const time = $('session-ring-time');
    block.classList.toggle('is-rest', m === 'rest');
    block.classList.toggle('is-between', m === 'between');
    time.classList.remove('is-urgent');
    $('session-btn-reset').disabled = m === 'between';
    $('session-btn-set').disabled = m === 'between';

    if (m === 'idle') {
      $('session-timer-label').textContent = 'Preparado';
      setRing(0);
      if (ex.workSec > 0) { showBig(ex.workSec, 'minutos'); setMainBtn(SVG.play, 'Iniciar'); }
      else {
        time.textContent = ex.reps > 0 ? String(ex.reps) : '—';
        $('session-ring-lbl').textContent = ex.reps > 0 ? 'repeticiones' : 'serie libre';
        setMainBtn(SVG.check, 'Serie hecha');
      }
    } else if (m === 'work') {
      $('session-timer-label').textContent = 'Trabajo';
      timerSec = 0; targetSec = ex.workSec;
      showBig(targetSec);
      setMainBtn(SVG.pause, 'Pausar');
      intervalId = setInterval(tickWork, 1000);
    } else if (m === 'rest') {
      $('session-timer-label').textContent = 'Descanso';
      timerSec = ex.restSec; targetSec = ex.restSec;
      showBig(timerSec, 'de descanso');
      setRing(1);
      setMainBtn(SVG.skip, 'Saltar', false);
      $('session-btn-main').setAttribute('aria-label', 'Saltar descanso');
      intervalId = setInterval(tickRest, 1000);
    } else if (m === 'between') {
      const last = exIdx + 1 >= EXERCISES().length;
      $('session-timer-label').textContent = 'Ejercicio completado';
      setRing(1);
      time.textContent = String(ex.sets);
      $('session-ring-lbl').textContent = ex.sets === 1 ? 'serie hecha' : 'series hechas';
      setMainBtn(last ? SVG.flag : SVG.skip, last ? 'Terminar' : 'Siguiente');
    }
    renderDots();
    renderMetrics();
    renderHistory();
  }

  function tickWork() {
    timerSec++;
    setRing(timerSec / targetSec);
    const remaining = Math.max(0, targetSec - timerSec);
    showBig(remaining);
    const time = $('session-ring-time');
    if (remaining <= 3 && remaining > 0) {
      time.classList.add('is-urgent');
      soundUrgent();
    } else if (remaining > 3) {
      soundTick();
    }
    if (timerSec >= targetSec) completeSet();
  }

  function tickRest() {
    timerSec--;
    setRing(timerSec / targetSec);
    showBig(Math.max(0, timerSec), 'de descanso');
    const time = $('session-ring-time');
    if (timerSec <= 3 && timerSec > 0) {
      time.classList.add('is-urgent');
      soundUrgent();
    }
    if (timerSec <= 0) {
      clearInterval(intervalId);
      soundRestEnd();
      setMode('idle');
      announce(`Fin del descanso. Serie ${setsDone + 1}.`);
    }
  }

  function toggleTimer() {
    const ex = EXERCISES()[exIdx];
    if (mode === 'idle') {
      if (ex.workSec > 0) setMode('work'); else completeSet();
    } else if (mode === 'work') {
      clearInterval(intervalId);
      mode = 'paused';
      $('session-timer-label').textContent = 'En pausa';
      setMainBtn(SVG.play, 'Reanudar');
      announce('Cronómetro en pausa');
    } else if (mode === 'paused') {
      mode = 'work';
      $('session-timer-label').textContent = 'Trabajo';
      setMainBtn(SVG.pause, 'Pausar');
      intervalId = setInterval(tickWork, 1000);
    } else if (mode === 'rest') {
      setMode('idle');
    } else if (mode === 'between') {
      nextExercise();
    }
  }

  function completeSet() {
    const ex = EXERCISES()[exIdx];
    if (mode === 'between' || setsDone >= ex.sets) return;
    // Tiempo real sostenido si se marca la serie con el cronómetro en marcha
    const held = (mode === 'work' || mode === 'paused') && timerSec > 0 ? timerSec : ex.workSec;
    clearInterval(intervalId);
    soundDone();
    curSets().push({
      n: setsDone + 1, workSec: ex.workSec > 0 ? held : 0, reps: ex.workSec > 0 ? 0 : ex.reps, weight: ex.weight || 0, rpe: 0, time: nowHM(),
      ...(ex.assistanceKg > 0 ? { assistanceKg: ex.assistanceKg } : {})
    });
    setsDone++;
    rpeOpen = true;
    if (setsDone >= ex.sets) {
      setMode('between');
      announce(`Ejercicio completado: ${ex.name}`);
    } else if (ex.restSec > 0) {
      setMode('rest');
      announce(`Serie ${setsDone} hecha. Descanso de ${dur(ex.restSec)}.`);
    } else {
      setMode('idle');
      announce(`Serie ${setsDone} hecha.`);
    }
  }

  function nextExercise() {
    clearInterval(intervalId);
    if (exIdx + 1 >= EXERCISES().length) {
      requestFinish();
      return;
    }
    exIdx++;
    setsDone = 0;
    renderExercise();
  }

  function changeLoad(delta) {
    const ex = EXERCISES()[exIdx];
    // Solo cambia la copia de esta sesión: el plan original no se toca
    ex.weight = Math.max(0, Math.min(200, (ex.weight || 0) + delta));
    renderSpecs();
    renderMetrics();
  }

  function setRpe(v) {
    const sets = curSets();
    const last = sets[sets.length - 1];
    if (!last) return;
    last.rpe = v;
    renderMetrics();
    renderHistory();
    announce(`RPE ${v} en la serie ${last.n}`);
  }

  // ── Resumen final ───────────────────────────────────────────────────
  function showCompletion() {
    clearInterval(intervalId);
    clearInterval(elapsedId);
    const screen = $('session-screen');
    if (!screen) return;

    const doneSets = doneSetsTotal();
    const plannedSets = plannedSetsTotal();
    const exCount = EXERCISES().length;
    const exDone = record.exercises.filter((e, i) => e.sets.length >= (EXERCISES()[i]?.sets || 0)).length;
    const setRpes = record.exercises.flatMap(e => e.sets.map(s => s.rpe)).filter(Boolean);
    const mins = Math.max(1, Math.round(elapsedSec / 60));
    record.durationSec = elapsedSec;
    // Las sesiones de ejemplo (sin plan) no se guardan en la cuenta
    let saved = Promise.resolve(false);
    if (doneSets > 0) {
      window.kruxTrainLog.push(record);
      if (!record.demo) saved = KruxTrainStore.saveSession(record);
    }
    const saveHint = record.demo
      ? 'Es una sesión de ejemplo: no se guarda. Crea un plan para registrar tus entrenamientos.'
      : !KruxTrainStore.isSignedIn() ? 'Inicia sesión para guardar tus entrenamientos en tu cuenta.' : '';

    let logFeel = null, logRpe = null;
    const logTags = new Set();
    const PRESET_TAGS = ['Poleas tensas', 'Buena adherencia', 'Sin dolor', 'Hombro cargado', 'Mucho calor', 'Bien descansado', 'Sin energía'];
    const FEELS = [['beast', 'Muy fuerte'], ['great', 'Bien'], ['ok', 'Normal'], ['bad', 'Cansado']];

    function updateSaveBtn() {
      const btn = document.getElementById('plog-save-btn');
      if (btn) btn.disabled = !(logFeel && logRpe);
    }

    function buildFeel() {
      const row = document.getElementById('plog-feel-row');
      row.innerHTML = FEELS.map(([k, l]) => `<button type="button" class="plog-feel-btn${k === logFeel ? ' is-selected' : ''}" data-feel="${k}" aria-pressed="${k === logFeel}">${l}</button>`).join('');
    }

    function buildRpe() {
      const row = document.getElementById('plog-rpe-row');
      row.innerHTML = [5, 6, 7, 8, 9, 10].map(v => {
        const tone = v >= 9 ? ' is-hi' : v >= 8 ? ' is-warn' : '';
        return `<button type="button" class="session-rpe-dot${tone}${v === logRpe ? ' is-selected' : ''}" data-rpe="${v}" aria-pressed="${v === logRpe}">${v}</button>`;
      }).join('');
    }

    function buildTags() {
      const row = document.getElementById('plog-tags-row');
      row.innerHTML = PRESET_TAGS.map(t => `<button type="button" class="plog-tag${logTags.has(t) ? ' is-selected' : ''}" aria-pressed="${logTags.has(t)}">${t}</button>`).join('');
    }

    function showSaved() {
      const notes = (document.getElementById('plog-notes') || {}).value || '';
      const feelLabel = (FEELS.find(f => f[0] === logFeel) || [])[1] || '';
      Object.assign(record, { feel: logFeel, rpe: logRpe, notes, tags: [...logTags] });
      // Guardado confirmado por el servidor; si falla, se puede reintentar sin duplicar la sesión
      const sync = pending => pending.then(ok => ((ok || record.syncState === 'pending') ? KruxTrainStore.updateSession(record, record) : false)).then(ok => {
        const hint = document.getElementById('plog-done-hint');
        const retry = document.getElementById('plog-retry');
        const otherAccount = !ok && record.ownerUid && record.ownerUid !== KruxTrainStore.currentUid();
        const queued = !ok && record.syncState === 'pending';
        const conflict = !ok && record.syncState === 'conflict';
        if (hint) hint.textContent = ok ? 'Guardada en tu cuenta.'
          : otherAccount ? 'Esta sesión era de otra cuenta y no se ha guardado en la actual.'
          : queued ? 'Guardada en este dispositivo. Se sincronizará cuando haya conexión.'
          : conflict ? 'El servidor no ha aceptado esta sesión. Sigue guardada en este dispositivo; puedes reintentarlo desde Entrena.'
          : 'No se ha podido confirmar el guardado en tu cuenta. Comprueba tu conexión.';
        if (retry) { retry.hidden = !!ok || !!otherAccount || queued || conflict; retry.disabled = false; }
      });
      if (!saveHint) sync(saved);
      screen.innerHTML = `
        <div class="plog-done">
          <span class="plog-done-mark">${SVG.check}</span>
          <h2 class="plog-done-title" id="plog-done-title" tabindex="-1">Sesión completada</h2>
          <p class="plog-done-sub">${mins} min · ${doneSets} ${doneSets === 1 ? 'serie' : 'series'} · ${feelLabel} · RPE ${logRpe}</p>
          ${notes ? `<p class="plog-done-notes">${esc(notes)}</p>` : ''}
          <p class="plog-done-hint" id="plog-done-hint" aria-live="polite">${saveHint || 'Guardando…'}</p>
          <button type="button" class="plog-save-btn plog-retry" id="plog-retry" hidden>Reintentar guardado</button>
          <button type="button" class="plog-save-btn" id="plog-close-done">Volver a Entrena</button>
        </div>`;
      document.getElementById('plog-retry').addEventListener('click', e => {
        e.currentTarget.disabled = true;
        document.getElementById('plog-done-hint').textContent = 'Guardando…';
        sync(KruxTrainStore.saveSession(record));
      });
      document.getElementById('plog-close-done').addEventListener('click', close);
      document.getElementById('plog-done-title').focus({ preventScroll: true });
    }

    screen.innerHTML = `
      <div class="session-topbar">
        <h2 class="plog-title">Resumen de la sesión</h2>
        <button type="button" class="plog-skip" id="plog-skip">Omitir</button>
      </div>
      <div class="plog-scroll">
        <div class="plog-stats-grid">
          <div class="plog-stat"><div class="plog-stat-val">${mins} min</div><div class="plog-stat-lbl">Duración</div></div>
          <div class="plog-stat"><div class="plog-stat-val">${doneSets}<small> / ${plannedSets}</small></div><div class="plog-stat-lbl">Series</div></div>
          <div class="plog-stat"><div class="plog-stat-val">${exDone}<small> / ${exCount}</small></div><div class="plog-stat-lbl">Ejercicios completos</div></div>
          <div class="plog-stat"><div class="plog-stat-val">${setRpes.length ? Math.round(setRpes.reduce((a, b) => a + b, 0) / setRpes.length * 10) / 10 : '—'}</div><div class="plog-stat-lbl">RPE medio por serie</div></div>
        </div>
        <div class="plog-sec">
          <h3 class="plog-sec-label" id="plog-feel-lbl">¿Cómo te sientes?</h3>
          <div class="plog-feel-row" id="plog-feel-row" role="group" aria-labelledby="plog-feel-lbl"></div>
        </div>
        <div class="plog-sec">
          <h3 class="plog-sec-label" id="plog-rpe-lbl">RPE global de la sesión</h3>
          <div class="session-rpe-dots plog-rpe-row" id="plog-rpe-row" role="group" aria-labelledby="plog-rpe-lbl"></div>
        </div>
        <div class="plog-sec">
          <h3 class="plog-sec-label"><label for="plog-notes">Notas</label></h3>
          <textarea class="plog-notes" id="plog-notes" rows="3" maxlength="1000" placeholder="Sensaciones, molestias, contexto… (opcional)"></textarea>
          <div class="plog-tags-row" id="plog-tags-row"></div>
        </div>
      </div>
      <div class="plog-footer">
        <button type="button" class="plog-save-btn" id="plog-save-btn" disabled>Guardar sesión</button>
        <p class="plog-footer-hint">Elige cómo te sientes y el RPE global para guardar.</p>
      </div>`;

    buildFeel();
    buildRpe();
    buildTags();
    document.getElementById('plog-feel-row').addEventListener('click', e => {
      const b = e.target.closest('[data-feel]'); if (!b) return;
      logFeel = b.dataset.feel; buildFeel(); updateSaveBtn();
    });
    document.getElementById('plog-rpe-row').addEventListener('click', e => {
      const b = e.target.closest('[data-rpe]'); if (!b) return;
      logRpe = parseInt(b.dataset.rpe, 10); buildRpe(); updateSaveBtn();
    });
    document.getElementById('plog-tags-row').addEventListener('click', e => {
      const b = e.target.closest('.plog-tag'); if (!b) return;
      const t = b.textContent; logTags.has(t) ? logTags.delete(t) : logTags.add(t); buildTags();
    });
    document.getElementById('plog-skip').addEventListener('click', close);
    document.getElementById('plog-save-btn').addEventListener('click', () => { if (logFeel && logRpe) showSaved(); });
  }

  // Eventos delegados: siguen funcionando aunque se restaure el marcado de la pantalla
  document.addEventListener('DOMContentLoaded', () => {
    const modal = $('session-modal');
    const screen = $('session-screen');
    if (!modal || !screen) return;
    TEMPLATE = screen.innerHTML;

    modal.addEventListener('click', e => {
      const rpe = e.target.closest('#session-rpe-dots [data-rpe]');
      if (rpe) { setRpe(parseInt(rpe.dataset.rpe, 10)); return; }
      const btn = e.target.closest('button[id]');
      if (!btn || btn.disabled) return;
      switch (btn.id) {
        case 'session-close-btn': requestClose(); break;
        case 'session-finish-btn': requestFinish(); break;
        case 'session-btn-main': toggleTimer(); break;
        case 'session-btn-reset': setMode('idle'); announce('Cronómetro reiniciado'); break;
        case 'session-btn-set': completeSet(); break;
        case 'session-skip-btn': nextExercise(); break;
        case 'session-load-minus': changeLoad(-1); break;
        case 'session-load-plus': changeLoad(1); break;
        case 'session-rpe-btn':
          if (!curSets().length) { announce('Completa una serie para anotar su RPE'); if (typeof showToast === 'function') showToast('Completa una serie para anotar su RPE', 'info'); break; }
          rpeOpen = !rpeOpen; renderMetrics(); break;
      }
    });

    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape' || modal.classList.contains('hidden')) return;
      if (!$('confirm-modal')?.classList.contains('hidden')) return;
      if (document.body.classList.contains('xg-open')) return;   // Escape cierra la guía, no el entrenamiento
      requestClose();
    });
  });

  window.openActiveSession = open;
  window.closeActiveSession = close;
})();

// ================== PLAN EDITOR MODULE ==================
(function () {
  const DAYS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
  const DAY_NAMES = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
  const MIN_WEEKS = 1;
  const MAX_WEEKS = 16;

  const MAX_SESSIONS = 7; // límite de las reglas de Firestore (training_plan.sessions)

  const ico = (body, size = 18, sw = 2) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

  const SVG = {
    back: ico('<polyline points="15 18 9 12 15 6"></polyline>', 22, 2.2),
    close: ico('<line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>', 18),
    clear: ico('<circle cx="12" cy="12" r="9"></circle><path d="M15 9l-6 6M9 9l6 6"></path>', 18, 1.8),
    chev: ico('<polyline points="6 9 12 15 18 9"></polyline>', 18),
    plus: ico('<line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line>', 18, 2.2),
    minus: ico('<line x1="5" y1="12" x2="19" y2="12"></line>', 18, 2.2),
    save: ico('<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>', 17),
    edit: ico('<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>', 17),
    trash: ico('<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/>', 17),
    check: ico('<polyline points="20 6 9 17 4 12"></polyline>', 12, 3),
    checkBig: ico('<polyline points="20 6 9 17 4 12"></polyline>', 30, 2.6),
    up: ico('<polyline points="18 15 12 9 6 15"></polyline>', 18),
    down: ico('<polyline points="6 9 12 15 18 9"></polyline>', 18),
    timer: ico('<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 1.5"/><path d="M9.5 2.5h5"/>', 18, 1.8),
    reps: ico('<path d="M17 2.5l3 3-3 3"/><path d="M4 11.5v-1a5 5 0 0 1 5-5h11"/><path d="M7 21.5l-3-3 3-3"/><path d="M20 12.5v1a5 5 0 0 1-5 5H4"/>', 18, 1.8),
  };

  // Icono de cada plantilla (por su etiqueta, sin tocar el modelo de datos)
  const TEMPLATE_ICONS = {
    'Fuerza máxima': ico('<rect x="2.5" y="9" width="2.5" height="6" rx="1.25"/><rect x="5.5" y="6" width="3" height="12" rx="1.5"/><line x1="8.5" y1="12" x2="15.5" y2="12"/><rect x="15.5" y="6" width="3" height="12" rx="1.5"/><rect x="19" y="9" width="2.5" height="6" rx="1.25"/>', 26, 1.8),
    'Resistencia': ico('<path d="M3 20h18"/><rect x="5" y="12" width="3" height="6" rx="1"/><rect x="10.5" y="8" width="3" height="10" rx="1"/><rect x="16" y="4" width="3" height="14" rx="1"/>', 26, 1.8),
    'Periodización lineal': ico('<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>', 26, 1.8),
    'Bloque específico': ico('<path d="M12 2l9 5v10l-9 5-9-5V7z"/><path d="M3 7l9 5 9-5"/><path d="M12 12v10"/>', 26, 1.8),
    'Desde cero': ico('<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>', 26, 1.8),
  };

  const TEMPLATES = [
    {
      label: 'Fuerza máxima', name: 'Fuerza máx. 4 semanas', weeks: 4,
      activeDays: [true, false, true, false, true, false, false],
      sessions: [
        { day: 'L', name: 'Fuerza dedos', expanded: true, exercises: [
          { name: 'Max hang · 20mm', sets: 4, workSec: 10, reps: 0, weight: 20, restSec: 180, rpeTarget: 8 },
          { name: 'Campus board · 1-5-9', sets: 3, workSec: 0, reps: 5, weight: 0, restSec: 120, rpeTarget: 7 },
          { name: 'Pullover isométrico', sets: 3, workSec: 7, reps: 0, weight: 0, restSec: 120, rpeTarget: 6 },
        ]},
        { day: 'X', name: 'Potencia', expanded: false, exercises: [
          { name: 'Dynos a dedo', sets: 5, workSec: 0, reps: 3, weight: 0, restSec: 180, rpeTarget: 8 },
        ]},
        { day: 'V', name: 'Resistencia + antagonistas', expanded: false, exercises: [
          { name: 'ARC · panel 45°', sets: 2, workSec: 1200, reps: 0, weight: 0, restSec: 300, rpeTarget: 6 },
          { name: 'Manguito rotador', sets: 3, workSec: 0, reps: 15, weight: 0, restSec: 60, rpeTarget: 5 },
        ]},
      ]
    },
    {
      label: 'Resistencia', name: 'Resistencia 6 sem', weeks: 6,
      activeDays: [false, true, false, true, false, true, false],
      sessions: [
        { day: 'M', name: 'ARC largo', expanded: true, exercises: [
          { name: 'ARC · panel 30°', sets: 2, workSec: 1800, reps: 0, weight: 0, restSec: 300, rpeTarget: 5 },
        ]},
        { day: 'J', name: '4×4 bloque', expanded: false, exercises: [
          { name: '4×4 bloque', sets: 4, workSec: 0, reps: 4, weight: 0, restSec: 240, rpeTarget: 7 },
        ]},
        { day: 'S', name: 'Capacidad aeróbica', expanded: false, exercises: [
          { name: 'Travesías largas', sets: 3, workSec: 600, reps: 0, weight: 0, restSec: 300, rpeTarget: 6 },
        ]},
      ]
    },
    {
      label: 'Periodización lineal', name: 'Periodización lineal 8 sem', weeks: 8,
      activeDays: [true, true, false, true, true, false, false],
      sessions: [
        { day: 'L', name: 'Hipertrofia tracción', expanded: true, exercises: [
          { name: 'Dominadas lastradas', sets: 4, workSec: 0, reps: 8, weight: 10, restSec: 120, rpeTarget: 7 },
        ]},
        { day: 'M', name: 'Fuerza dedos', expanded: false, exercises: [
          { name: 'Max hang · 20mm', sets: 4, workSec: 10, reps: 0, weight: 15, restSec: 180, rpeTarget: 8 },
        ]},
        { day: 'J', name: 'Potencia', expanded: false, exercises: [
          { name: 'Campus 1-5-9', sets: 4, workSec: 0, reps: 4, weight: 0, restSec: 180, rpeTarget: 8 },
        ]},
        { day: 'V', name: 'Resistencia específica', expanded: false, exercises: [
          { name: '4×4', sets: 4, workSec: 0, reps: 4, weight: 0, restSec: 240, rpeTarget: 7 },
        ]},
      ]
    },
    {
      label: 'Bloque específico', name: 'Bloque proyecto', weeks: 3,
      activeDays: [true, false, true, false, true, false, false],
      sessions: [
        { day: 'L', name: 'Pegues del proyecto', expanded: true, exercises: [
          { name: 'Intentos al proyecto', sets: 5, workSec: 0, reps: 1, weight: 0, restSec: 600, rpeTarget: 9 },
        ]},
        { day: 'X', name: 'Trabajo de movimientos', expanded: false, exercises: [
          { name: 'Repetir secciones clave', sets: 4, workSec: 0, reps: 3, weight: 0, restSec: 300, rpeTarget: 8 },
        ]},
        { day: 'V', name: 'Mantenimiento + antagonistas', expanded: false, exercises: [
          { name: 'Manguito rotador', sets: 3, workSec: 0, reps: 15, weight: 0, restSec: 60, rpeTarget: 5 },
        ]},
      ]
    },
    {
      label: 'Desde cero', name: '', weeks: 4,
      activeDays: [true, false, true, false, true, false, false],
      sessions: []
    },
  ];

  let planData = null;
  let templateIdx = 0;
  let sessEditMode = false;
  let pendingDeleteSi = -1;
  let saving = false;
  let mode = 'new';   // 'new' | 'draft' | 'edit'
  let editId = null;          // plan guardado que se edita (planes múltiples)
  let editRevision = null;    // revisión con la que se abrió: si cambia en el servidor, no se pisa
  let onCloseCb = null;       // p. ej. volver a «Mis planes»

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  // La fecha de inicio solo tiene sentido con varios planes y para un plan que todavía no es el activo
  function canSchedule() {
    if (!window.KRUX_MULTIPLAN || !firebase.auth().currentUser) return false;
    const active = window.kruxPlanState && window.kruxPlanState.activePlanId;
    return !(mode === 'edit' && editId && active === editId);
  }

  function renderStart() {
    const input = document.getElementById('pe-start-input');
    if (!input) return;
    const hint = document.getElementById('pe-start-hint');
    const clear = document.getElementById('pe-start-clear');
    const v = window.KruxPlans && window.KruxPlans.isDateKey(planData.startDate) ? planData.startDate : '';
    input.value = v;
    clear.hidden = !v;
    const active = window.kruxActivePlan;
    if (!v) hint.textContent = 'Opcional. Ese día este plan pasará a ser tu plan activo automáticamente' + (active ? ' y sustituirá a «' + active.name + '».' : '.');
    else {
      const d = new Date(v + 'T00:00');
      const label = `${d.getDate()} de ${['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'][d.getMonth()]}`;
      hint.textContent = v <= trDateKey(new Date())
        ? 'Empezará en cuanto lo guardes: será tu plan activo.'
        : `Hasta el ${label} seguirás con ${active ? '«' + active.name + '»' : 'tu plan actual'}; ese día empieza este automáticamente.`;
    }
  }

  const catalog = () => (window.KruxLibrary ? window.KruxLibrary.catalog() : null);

  // Enlaza (en memoria) los ejercicios con su ficha cuando el nombre coincide exactamente
  function linkAll(plan) {
    const cat = catalog();
    if (!cat || !window.KruxExercises) return plan;
    plan.sessions.forEach(s => s.exercises.forEach(ex => window.KruxExercises.linkPlanItem(cat, ex)));
    return plan;
  }

  function loadTemplate(idx) {
    templateIdx = idx;
    const t = clone(TEMPLATES[idx]);
    planData = linkAll({
      name: t.name,
      weeks: t.weeks,
      activeDays: t.activeDays,
      sessions: t.sessions,
    });
  }

  // opts.edit  → abre el plan activo guardado
  // opts.draft → abre una propuesta (asistente) para revisarla antes de guardar
  // sin opts   → plan nuevo desde la primera plantilla
  function open(opts) {
    const o = opts || {};
    sessEditMode = false;
    pendingDeleteSi = -1;
    saving = false;
    mode = 'new';
    editId = null; editRevision = null;
    onCloseCb = typeof o.onClose === 'function' ? o.onClose : null;
    // Planes múltiples: se edita el plan indicado (activo, inactivo o archivado)
    const multi = !!window.KRUX_MULTIPLAN;
    const planId = o.planId || (multi && o.edit && window.kruxActivePlan ? window.kruxActivePlan.id : null);
    const source = planId ? (window.kruxPlans || []).find(p => p.id === planId) : null;
    if (planId && (!source || source.status === 'trashed')) {
      if (typeof showToast === 'function') showToast('Este plan no se puede editar', 'info', { detail: source ? 'Está en la papelera: restáuralo primero.' : 'Ya no existe.' });
      const cb = onCloseCb; onCloseCb = null; if (cb) cb();
      return;
    }
    if (source) {
      mode = 'edit';
      templateIdx = -1;
      editId = source.id; editRevision = source.revision;
      const p = clone(source);
      p.sessions.forEach((s, i) => { s.expanded = i === 0; s.exercises = s.exercises || []; });
      planData = linkAll(p);
    } else if (o.edit && window.kruxActivePlan && Array.isArray(window.kruxActivePlan.sessions)) {
      mode = 'edit';
      templateIdx = -1;
      const p = clone(window.kruxActivePlan);
      p.sessions.forEach((s, i) => { s.expanded = i === 0; s.exercises = s.exercises || []; });
      planData = linkAll(p);
    } else if (o.draft) {
      mode = 'draft';
      templateIdx = -1;
      const p = clone(o.draft);
      p.sessions.forEach((s, i) => { s.expanded = i === 0; });
      planData = linkAll(p);
    } else {
      loadTemplate(0);
    }
    const modal = document.getElementById('plan-editor-modal');
    if (!modal) return;
    renderModal();
    document.body.classList.add('plan-editor-open');
    modal.classList.remove('hidden');
    requestAnimationFrame(() => modal.classList.add('pe-open'));
  }

  function close() {
    const modal = document.getElementById('plan-editor-modal');
    if (!modal) return;
    modal.classList.remove('pe-open');
    document.body.classList.remove('plan-editor-open');
    setTimeout(() => modal.classList.add('hidden'), 280);
    const cb = onCloseCb; onCloseCb = null;
    if (cb) cb();
  }

  const MODE_TEXT = {
    new:   ['Nuevo plan', 'Diseña tu entrenamiento'],
    draft: ['Plan propuesto', 'Revísalo y ajústalo antes de guardar'],
    edit:  ['Editar plan', 'Cambia tu planificación activa']
  };

  function renderModal() {
    const modal = document.getElementById('plan-editor-modal');
    const [title, subtitle] = MODE_TEXT[mode];
    modal.innerHTML = `
      <div class="pe-screen">
        <header class="pe-topbar">
          <button type="button" class="pe-icon-btn pe-back-btn" id="pe-back-btn" aria-label="Volver">${SVG.back}</button>
          <div class="pe-heading">
            <h2 class="pe-title" id="pe-title">${title}</h2>
            <p class="pe-subtitle">${subtitle}</p>
          </div>
          <button type="button" class="pe-save-btn" id="pe-save-top">${SVG.save}<span>Guardar</span></button>
        </header>

        <div class="pe-scroll" id="pe-scroll">
          ${mode !== 'edit' && !window.KRUX_MULTIPLAN && window.kruxActivePlan && Array.isArray(window.kruxActivePlan.sessions) ? `
          <p class="pe-replace-note" role="note">Al guardar sustituirás tu plan activo «${trEsc(window.kruxActivePlan.name)}». Para cambiarlo sin perderlo, usa «Editar plan activo».</p>` : ''}
          <section class="pe-name-card" aria-labelledby="pe-name-label">
            <label class="pe-label pe-label--light" id="pe-name-label" for="pe-name-input">Nombre del plan</label>
            <div class="pe-name-field">
              <input class="pe-name-input" id="pe-name-input" type="text" maxlength="60" placeholder="Ej: Fuerza máx. 4 semanas" autocomplete="off" enterkeyhint="done">
              <button type="button" class="pe-name-clear" id="pe-name-clear" aria-label="Borrar nombre">${SVG.clear}</button>
            </div>
          </section>

          ${mode === 'new' ? `
          <section class="pe-card" aria-labelledby="pe-tpl-label">
            <h3 class="pe-label" id="pe-tpl-label">Empezar desde plantilla</h3>
            <div class="pe-tpl-row" id="pe-tpl-row" role="radiogroup" aria-labelledby="pe-tpl-label">
              ${TEMPLATES.map((t, i) => `
                <button type="button" class="pe-tpl-card" role="radio" data-tidx="${i}">
                  <span class="pe-tpl-icon">${TEMPLATE_ICONS[t.label] || TEMPLATE_ICONS['Desde cero']}</span>
                  <span class="pe-tpl-name">${trEsc(t.label)}</span>
                  <span class="pe-tpl-check">${SVG.check}</span>
                </button>`).join('')}
            </div>
            <p class="pe-hint">Aplicar una plantilla reemplaza las sesiones actuales.</p>
          </section>` : ''}

          <section class="pe-card" aria-label="Configuración del plan">
            <div class="pe-row-head">
              <h3 class="pe-label" id="pe-weeks-label">Duración del plan</h3>
            </div>
            <div class="pe-stepper" role="group" aria-labelledby="pe-weeks-label">
              <button type="button" class="pe-step-btn" id="pe-step-minus" aria-label="Una semana menos">${SVG.minus}</button>
              <div class="pe-step-val" aria-live="polite"><span class="pe-step-num" id="pe-step-num"></span> <span class="pe-step-unit" id="pe-step-unit">semanas</span></div>
              <button type="button" class="pe-step-btn" id="pe-step-plus" aria-label="Una semana más">${SVG.plus}</button>
            </div>

            <div class="pe-divider" aria-hidden="true"></div>

            <div class="pe-row-head">
              <h3 class="pe-label" id="pe-days-label">Días de entrenamiento</h3>
              <span class="pe-meta" id="pe-days-count"></span>
            </div>
            <div class="pe-days-grid" id="pe-days-grid" role="group" aria-labelledby="pe-days-label"></div>
            <p class="pe-hint">Las sesiones se asignan a los días activos en orden. Para cambiar el día de una sesión, actívalo aquí o súbela o bájala desde «Editar».</p>
            <div class="pe-assign" id="pe-assign" aria-live="polite"></div>
            ${canSchedule() ? `
            <div class="pe-divider" aria-hidden="true"></div>
            <div class="pe-row-head">
              <h3 class="pe-label" id="pe-start-label">Empezar este plan el</h3>
            </div>
            <div class="pe-start" id="pe-start">
              <input type="date" class="pe-start-input" id="pe-start-input" aria-labelledby="pe-start-label" min="${trDateKey(new Date())}">
              <button type="button" class="pe-start-clear" id="pe-start-clear" aria-label="Quitar la fecha de inicio" hidden>${SVG.close || '×'}</button>
            </div>
            <p class="pe-hint" id="pe-start-hint"></p>` : ''}
          </section>

          <section class="pe-sessions" aria-labelledby="pe-sess-label">
            <div class="pe-row-head pe-row-head--sessions">
              <h3 class="pe-label" id="pe-sess-label">Sesiones</h3>
              <span class="pe-meta" id="pe-sess-count"></span>
              <button type="button" class="pe-edit-toggle" id="pe-sess-gear" aria-pressed="false">Editar</button>
            </div>
            <div class="pe-session-list" id="pe-session-list"></div>
            <button type="button" class="pe-add-session-btn" id="pe-add-session-btn">${SVG.plus}<span>Añadir sesión</span></button>
            <p class="pe-hint pe-hint--center" id="pe-sess-limit" hidden>Máximo ${MAX_SESSIONS} sesiones por semana.</p>
          </section>
        </div>
      </div>`;

    const nameInput = document.getElementById('pe-name-input');
    nameInput.value = planData.name;

    document.getElementById('pe-back-btn').onclick = close;
    document.getElementById('pe-save-top').onclick = savePlan;
    nameInput.oninput = () => { planData.name = nameInput.value; updateNameClear(); };
    nameInput.onkeydown = e => { if (e.key === 'Enter') nameInput.blur(); };
    document.getElementById('pe-name-clear').onclick = () => {
      nameInput.value = '';
      planData.name = '';
      updateNameClear();
      nameInput.focus();
    };

    const startInput = document.getElementById('pe-start-input');
    if (startInput) {
      startInput.onchange = () => { planData.startDate = startInput.value || null; renderStart(); };
      document.getElementById('pe-start-clear').onclick = () => { planData.startDate = null; renderStart(); };
      renderStart();
    }

    const tplRow = document.getElementById('pe-tpl-row');
    if (tplRow) tplRow.onclick = e => {
      const card = e.target.closest('.pe-tpl-card');
      if (!card) return;
      const keepStart = planData.startDate || null;
      loadTemplate(parseInt(card.dataset.tidx));
      if (keepStart) planData.startDate = keepStart;
      nameInput.value = planData.name;
      pendingDeleteSi = -1;
      updateNameClear();
      renderTemplates();
      renderWeeks();
      renderDays();
      renderSessions();
    };

    document.getElementById('pe-step-minus').onclick = () => {
      if (planData.weeks > MIN_WEEKS) { planData.weeks--; renderWeeks(); }
    };
    document.getElementById('pe-step-plus').onclick = () => {
      if (planData.weeks < MAX_WEEKS) { planData.weeks++; renderWeeks(); }
    };

    document.getElementById('pe-sess-gear').onclick = () => {
      sessEditMode = !sessEditMode;
      pendingDeleteSi = -1;
      renderSessions();
    };

    document.getElementById('pe-add-session-btn').onclick = () => {
      if (planData.sessions.length >= MAX_SESSIONS) return;
      planData.sessions.push({ day: '?', name: 'Nueva sesión', expanded: true, exercises: [] });
      syncSessionDays();
      renderSessions();
    };

    // Un único manejador delegado para la lista (no se acumulan)
    document.getElementById('pe-session-list').onclick = handleSessionListClick;

    updateNameClear();
    renderTemplates();
    renderWeeks();
    renderDays();
    renderSessions();
  }

  function updateNameClear() {
    const btn = document.getElementById('pe-name-clear');
    if (btn) btn.hidden = !planData.name;
  }

  function renderTemplates() {
    document.querySelectorAll('#pe-tpl-row .pe-tpl-card').forEach((c, i) => {
      const on = i === templateIdx;
      c.classList.toggle('is-active', on);
      c.setAttribute('aria-checked', on ? 'true' : 'false');
    });
  }

  function renderWeeks() {
    const num = document.getElementById('pe-step-num');
    if (!num) return;
    num.textContent = planData.weeks;
    document.getElementById('pe-step-unit').textContent = planData.weeks === 1 ? 'semana' : 'semanas';
    document.getElementById('pe-step-minus').disabled = planData.weeks <= MIN_WEEKS;
    document.getElementById('pe-step-plus').disabled = planData.weeks >= MAX_WEEKS;
  }

  function move(list, from, to) {
    if (to < 0 || to >= list.length || from === to) return false;
    list.splice(to, 0, list.splice(from, 1)[0]);
    return true;
  }

  function handleSessionListClick(e) {
    // Campo de nombre en edición: no propagar
    if (e.target.closest('.pe-session-name-input')) return;
    const num = (el, key) => parseInt(el.dataset[key], 10);

    // Parámetros del ejercicio
    const open = e.target.closest('.pe-ex-open');
    if (open) {
      const si = num(open, 'si'), ei = num(open, 'ei');
      const ex = planData.sessions[si].exercises[ei];
      window.openExerciseEditor(ei, {
        exercise: ex,
        onSave: () => renderSessions(),
        onReplace: () => replaceExercise(si, ei)
      });
      return;
    }

    // Subir o bajar ejercicio
    const exMove = e.target.closest('.pe-ex-up, .pe-ex-down');
    if (exMove) {
      const si = num(exMove, 'si'), ei = num(exMove, 'ei');
      if (move(planData.sessions[si].exercises, ei, ei + (exMove.classList.contains('pe-ex-up') ? -1 : 1))) renderSessions();
      return;
    }

    // Eliminar ejercicio
    const delBtn = e.target.closest('.pe-ex-del');
    if (delBtn) {
      planData.sessions[num(delBtn, 'si')].exercises.splice(num(delBtn, 'ei'), 1);
      renderSessions();
      return;
    }

    // Añadir ejercicio (biblioteca en modo selección)
    const addBtn = e.target.closest('.pe-add-ex-btn');
    if (addBtn) {
      addExercises(num(addBtn, 'si'));
      return;
    }

    // Subir o bajar sesión (cambia el día que le toca)
    const sMove = e.target.closest('.pe-session-up, .pe-session-down');
    if (sMove) {
      const si = num(sMove, 'si');
      if (move(planData.sessions, si, si + (sMove.classList.contains('pe-session-up') ? -1 : 1))) {
        pendingDeleteSi = -1;
        syncSessionDays();
        renderSessions();
      }
      return;
    }

    // Cancelar eliminación pendiente
    if (e.target.closest('.pe-del-cancel')) {
      pendingDeleteSi = -1;
      renderSessions();
      return;
    }

    // Eliminar sesión (doble confirmación)
    const delSess = e.target.closest('.pe-session-del');
    if (delSess) {
      const si = num(delSess, 'si');
      if (pendingDeleteSi === si) {
        planData.sessions.splice(si, 1);
        syncSessionDays();
        pendingDeleteSi = -1;
      } else {
        pendingDeleteSi = si;
      }
      renderSessions();
      return;
    }

    // Renombrar sesión
    const editName = e.target.closest('.pe-session-edit');
    if (editName) {
      const si = num(editName, 'si');
      const nameEl = document.querySelector(`.pe-session-card[data-si="${si}"] .pe-session-name`);
      if (!nameEl) return;
      const current = planData.sessions[si].name;
      nameEl.innerHTML = `<input class="pe-session-name-input" type="text" maxlength="40" aria-label="Nombre de la sesión" enterkeyhint="done">`;
      const inp = nameEl.querySelector('input');
      inp.value = current;
      inp.focus();
      inp.select();
      inp.onblur = () => {
        planData.sessions[si].name = inp.value.trim() || 'Sin nombre';
        renderSessions();
      };
      inp.onkeydown = ev => {
        if (ev.key === 'Enter') inp.blur();
        if (ev.key === 'Escape') { inp.value = current; inp.blur(); }
      };
      return;
    }

    // Desplegar o plegar (prioridad más baja)
    const hdr = e.target.closest('.pe-session-toggle');
    if (hdr) {
      const si = num(hdr, 'si');
      planData.sessions[si].expanded = !planData.sessions[si].expanded;
      renderSessions();
    }
  }

  const MAX_EXERCISES = 30; // igual que el límite que guarda KruxTrainStore

  function addExercises(si) {
    if (!window.KruxLibrary) return;
    const sess = planData.sessions[si];
    window.KruxLibrary.open({
      mode: 'pick',
      title: sess.name,
      onPick: item => {
        if (sess.exercises.length >= MAX_EXERCISES) {
          if (typeof showToast === 'function') showToast(`Máximo ${MAX_EXERCISES} ejercicios por sesión`, 'info');
          return false;
        }
        sess.exercises.push(item);
        sess.expanded = true;
        renderSessions();
        return true;
      }
    });
  }

  function replaceExercise(si, ei) {
    if (!window.KruxLibrary) return;
    const old = planData.sessions[si].exercises[ei];
    const cat = catalog();
    const ficha = cat && old.exerciseId ? cat.byId.get(old.exerciseId) : null;
    window.KruxLibrary.open({
      mode: 'pick',
      single: true,
      title: `Sustituir: ${old.name}`,
      categoryId: ficha ? ficha.primaryCategoryId : null,
      onPick: item => {
        planData.sessions[si].exercises[ei] = item;
        renderSessions();
        return true;
      }
    });
  }

  function syncSessionDays() {
    const active = DAYS.filter((_, i) => planData.activeDays[i]);
    planData.sessions.forEach((s, i) => { s.day = active[i] || '?'; });
  }

  function renderAssign() {
    const box = document.getElementById('pe-assign');
    if (!box) return;
    const sessions = planData.sessions;
    if (!sessions.length) { box.innerHTML = ''; return; }
    const orphans = sessions.filter(s => !s.day || s.day === '?').length;
    box.innerHTML = `
      <ul class="pe-assign-list">
        ${sessions.map(s => `<li class="${s.day && s.day !== '?' ? '' : 'is-orphan'}"><b>${s.day && s.day !== '?' ? s.day : '?'}</b><span>${trEsc(s.name)}</span></li>`).join('')}
      </ul>
      ${orphans ? `<p class="pe-assign-warn">${orphans === 1 ? '1 sesión no tiene día' : `${orphans} sesiones no tienen día`}: activa más días o elimínalas antes de guardar.</p>` : ''}`;
  }

  function renderDays() {
    const grid = document.getElementById('pe-days-grid');
    if (!grid) return;
    grid.innerHTML = '';
    DAYS.forEach((d, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pe-day-pill' + (planData.activeDays[i] ? ' on' : '');
      btn.textContent = d;
      btn.setAttribute('aria-pressed', planData.activeDays[i] ? 'true' : 'false');
      btn.setAttribute('aria-label', DAY_NAMES[i]);
      btn.onclick = () => {
        planData.activeDays[i] = !planData.activeDays[i];
        syncSessionDays();
        renderDays();
        renderSessions();
      };
      grid.appendChild(btn);
    });
    const count = planData.activeDays.filter(Boolean).length;
    const countEl = document.getElementById('pe-days-count');
    if (countEl) countEl.textContent = `${count} ${count === 1 ? 'día' : 'días'}/sem`;
  }

  function renderSessions() {
    const list = document.getElementById('pe-session-list');
    if (!list) return;
    renderAssign();
    const n = planData.sessions.length;
    document.getElementById('pe-sess-count').textContent = `${n} ${n === 1 ? 'sesión' : 'sesiones'}`;

    const gear = document.getElementById('pe-sess-gear');
    gear.hidden = n === 0;
    gear.textContent = sessEditMode ? 'Listo' : 'Editar';
    gear.setAttribute('aria-pressed', sessEditMode ? 'true' : 'false');
    gear.classList.toggle('is-active', sessEditMode);

    const full = n >= MAX_SESSIONS;
    document.getElementById('pe-add-session-btn').disabled = full;
    document.getElementById('pe-sess-limit').hidden = !full;

    if (n === 0) {
      list.innerHTML = `
        <div class="pe-empty">
          <p class="pe-empty-title">Aún no hay sesiones</p>
          <p class="pe-empty-text">Añade una sesión y se asignará al primer día activo libre.</p>
        </div>`;
      return;
    }

    const rpeTag = rpe => rpe ? `<span class="pe-ex-rpe${rpe >= 9 ? ' hi' : ''}">RPE ${rpe}</span>` : '';
    const cat = catalog();

    list.innerHTML = planData.sessions.map((s, si) => {
      const hasDay = s.day && s.day !== '?';
      const exCount = s.exercises.length;
      const meta = [`${exCount} ejercicio${exCount !== 1 ? 's' : ''}`];
      if (exCount && typeof trEstimateMinutes === 'function') meta.push(`≈ ${trEstimateMinutes(s.exercises)} min`);
      const pending = pendingDeleteSi === si;

      const exHTML = s.expanded ? `
        <div class="pe-ex-list" id="pe-ex-list-${si}">
          ${exCount === 0 ? '<p class="pe-ex-empty">Sin ejercicios todavía.</p>' : s.exercises.map((ex, ei) => {
            const ficha = cat && ex.exerciseId ? cat.byId.get(ex.exerciseId) : null;
            return `
            <div class="pe-ex-row">
              <button type="button" class="pe-ex-open" data-si="${si}" data-ei="${ei}" aria-label="Editar ${trEsc(ex.name)}">
                <span class="pe-ex-icon">${ficha && window.KruxLibrary ? window.KruxLibrary.categoryIcon(ficha.primaryCategoryId, 20) : (ex.workSec > 0 ? SVG.timer : SVG.reps)}</span>
                <span class="pe-ex-info">
                  <span class="pe-ex-name">${trEsc(ex.name)}</span>
                  <span class="pe-ex-detail">${trEsc(typeof buildExDetail === 'function' ? buildExDetail(ex) : '')}</span>
                </span>
                ${sessEditMode ? '' : rpeTag(ex.rpeTarget)}
              </button>
              ${sessEditMode ? `
                <button type="button" class="pe-icon-btn pe-ex-up" data-si="${si}" data-ei="${ei}" aria-label="Subir ${trEsc(ex.name)}"${ei === 0 ? ' disabled' : ''}>${SVG.up}</button>
                <button type="button" class="pe-icon-btn pe-ex-down" data-si="${si}" data-ei="${ei}" aria-label="Bajar ${trEsc(ex.name)}"${ei === exCount - 1 ? ' disabled' : ''}>${SVG.down}</button>` : ''}
              <button type="button" class="pe-icon-btn pe-ex-del" data-si="${si}" data-ei="${ei}" aria-label="Quitar ${trEsc(ex.name)}">${SVG.close}</button>
              ${window.KruxGuide && window.KruxGuide.idFor(ex) ? `<div class="pe-ex-guide">${window.KruxGuide.button(window.KruxGuide.idFor(ex))}</div>` : ''}
            </div>`;
          }).join('')}
          <button type="button" class="pe-add-ex-btn" data-si="${si}">${SVG.plus}<span>Añadir ejercicio</span></button>
        </div>` : '';

      const tools = sessEditMode ? `
        <div class="pe-session-tools">
          <button type="button" class="pe-tool-btn pe-session-up" data-si="${si}"${si === 0 ? ' disabled' : ''}>${SVG.up}<span>Subir</span></button>
          <button type="button" class="pe-tool-btn pe-session-down" data-si="${si}"${si === n - 1 ? ' disabled' : ''}>${SVG.down}<span>Bajar</span></button>
          <button type="button" class="pe-tool-btn pe-session-edit" data-si="${si}">${SVG.edit}<span>Renombrar</span></button>
          <button type="button" class="pe-tool-btn pe-tool-btn--danger pe-session-del" data-si="${si}">${SVG.trash}<span>Eliminar</span></button>
        </div>` : '';

      const confirmBanner = pending ? `
        <div class="pe-del-confirm" role="alert">
          <span class="pe-del-confirm-text">¿Eliminar «${trEsc(s.name)}»?</span>
          <button type="button" class="pe-del-cancel">Cancelar</button>
          <button type="button" class="pe-session-del pe-del-yes" data-si="${si}">Eliminar</button>
        </div>` : '';

      return `
        <article class="pe-session-card${s.expanded ? ' is-open' : ''}${pending ? ' pending-del' : ''}" data-si="${si}">
          <div class="pe-session-header">
            <button type="button" class="pe-session-toggle" data-si="${si}" aria-expanded="${s.expanded ? 'true' : 'false'}"${s.expanded ? ` aria-controls="pe-ex-list-${si}"` : ''}>
              <span class="pe-session-badge${hasDay ? '' : ' orphan'}" title="${hasDay ? DAY_NAMES[DAYS.indexOf(s.day)] : 'Sin día asignado'}">${hasDay ? s.day : '?'}</span>
              <span class="pe-session-info">
                <span class="pe-session-name">${trEsc(s.name)}</span>
                <span class="pe-session-count">${hasDay ? '' : 'Sin día asignado · '}${meta.join(' · ')}</span>
              </span>
              <span class="pe-session-chev">${SVG.chev}</span>
            </button>
          </div>
          ${tools}
          ${confirmBanner}
          ${exHTML}
        </article>`;
    }).join('');
  }

  async function savePlan() {
    if (saving) return;
    const name = planData.name.trim() || 'Mi plan';
    const activeDayLabels = DAYS.filter((_, i) => planData.activeDays[i]);
    const totalEx = planData.sessions.reduce((a, s) => a + s.exercises.length, 0);
    const btn = document.getElementById('pe-save-top');

    if (planData.sessions.some(s => !s.day || s.day === '?')) {
      if (typeof showToast === 'function') showToast('Hay sesiones sin día', 'error', { detail: 'Activa más días o elimina las sesiones sobrantes.' });
      return;
    }

    const content = {
      name, sessions: planData.sessions, activeDays: planData.activeDays, weeks: planData.weeks,
      ...(planData.goal ? { goal: planData.goal, level: planData.level, equipment: planData.equipment } : {}),
      ...(planData.minutes ? { minutes: planData.minutes } : {}),
      ...(window.KruxPlans && window.KruxPlans.isDateKey(planData.startDate) && canSchedule() ? { startDate: planData.startDate } : {})
    };
    const signedIn = !!(firebase.auth().currentUser);
    const multi = !!window.KRUX_MULTIPLAN && signedIn;
    let savedNote = '';

    if (multi) {
      // Varios planes: cada plan es un documento. Si es nuevo se pregunta, siempre, si se activa.
      let activate = false;
      // Con fecha de inicio no se pregunta: el plan se activa solo ese día (o ahora, si la fecha es hoy)
      if (mode !== 'edit' && !content.startDate) {
        activate = window.KruxPlansUI ? await window.KruxPlansUI.askActivate(name) : false;
        if (activate === null) return;     // canceló: no se guarda nada
      }
      saving = true;
      btn.disabled = true;
      btn.classList.add('is-busy');
      btn.querySelector('span').textContent = 'Guardando…';
      window.kruxLastPlanError = '';
      let ok;
      if (mode === 'edit') {
        const saved = await KruxTrainStore.plans.update(editId, content, editRevision);
        ok = !!saved;
        if (ok) { editRevision = saved.revision; try { await KruxTrainStore.plans.reload(); } catch (_) { /* ya guardado: se verá al recargar */ } }
      } else {
        ok = !!(await KruxTrainStore.plans.create(content, { activate }));
      }
      saving = false;
      if (!ok) {
        btn.disabled = false;
        btn.classList.remove('is-busy');
        btn.querySelector('span').textContent = 'Guardar';
        if (window.kruxLastPlanError === 'kx/conflict' || window.kruxLastPlanError === 'kx/plan-missing') showConflictBanner();
        return;
      }
      let started = null;
      if (content.startDate && content.startDate <= trDateKey(new Date())) started = await KruxTrainStore.plans.applySchedule();
      const when = content.startDate && !started ? new Date(content.startDate + 'T00:00').toLocaleDateString('es-ES', { day: 'numeric', month: 'long' }) : '';
      savedNote = started ? 'Guardado y activado.'
        : when ? (mode === 'edit' ? 'Cambios guardados.' : 'Guardado.') + ` Empezará el ${when}.`
        : mode === 'edit' ? 'Cambios guardados.' : activate ? 'Guardado y activado.' : 'Guardado sin activar. Puedes activarlo desde «Mis planes».';
      if (typeof window.refreshTrainView === 'function') window.refreshTrainView();
    } else {
    // Plan activo en memoria (Entrena lo usa aunque no haya sesión iniciada)
    window.kruxActivePlan = {
      ...content,
      // Con un solo plan, editar conserva su identificador y revisión
      ...(planData.id && window.KRUX_MULTIPLAN ? { id: planData.id, revision: planData.revision } : {})
    };

    if (signedIn) {
      saving = true;
      btn.disabled = true;
      btn.classList.add('is-busy');
      btn.querySelector('span').textContent = 'Guardando…';
      const ok = await KruxTrainStore.savePlan(window.kruxActivePlan);
      saving = false;
      if (!ok) {
        // El toast de error lo muestra KruxTrainStore; se puede reintentar
        btn.disabled = false;
        btn.classList.remove('is-busy');
        btn.querySelector('span').textContent = 'Guardar';
        if (typeof window.refreshTrainView === 'function') window.refreshTrainView();
        return;
      }
    }
    if (typeof window.refreshTrainView === 'function') window.refreshTrainView();
    }

    const screen = document.querySelector('#plan-editor-modal .pe-screen');
    if (!screen) return;
    screen.innerHTML = `
      <header class="pe-topbar">
        <button type="button" class="pe-icon-btn pe-back-btn" id="pe-saved-back" aria-label="Cerrar">${SVG.back}</button>
      </header>
      <div class="pe-saved-wrap">
        <div class="pe-saved-icon">${SVG.checkBig}</div>
        <h2 class="pe-saved-title">${trEsc(name)}</h2>
        <p class="pe-saved-sub">${planData.weeks} ${planData.weeks === 1 ? 'semana' : 'semanas'} · ${planData.sessions.length} ${planData.sessions.length === 1 ? 'sesión' : 'sesiones'} · ${totalEx} ejercicios${activeDayLabels.length ? `<br>${activeDayLabels.join(' · ')}` : ''}</p>
        <p class="pe-saved-note">${signedIn ? (savedNote || 'Guardado en tu cuenta.') : 'Inicia sesión para guardarlo en tu cuenta; si no, se perderá al cerrar KRUX.'}</p>
        <button type="button" class="pe-save-btn pe-save-btn--wide" id="pe-saved-done"><span>${onCloseCb ? 'Volver a Mis planes' : 'Ir a Entrena'}</span></button>
      </div>`;
    document.getElementById('pe-saved-back').onclick = close;
    document.getElementById('pe-saved-done').onclick = close;
  }

  // Otro dispositivo cambió o borró el plan mientras se editaba: no se pisa, se ofrece recargarlo
  function showConflictBanner() {
    const scroll = document.getElementById('pe-scroll');
    if (!scroll || document.getElementById('pe-conflict')) return;
    const box = document.createElement('div');
    box.id = 'pe-conflict';
    box.className = 'pe-replace-note pe-conflict';
    box.setAttribute('role', 'alert');
    const gone = window.kruxLastPlanError === 'kx/plan-missing';
    box.innerHTML = `<span>${gone ? 'Este plan ya no existe. Tus cambios no se han guardado.' : 'Este plan se modificó en otro dispositivo. Tus cambios no se han guardado para no pisar los de allí.'}</span>
      ${gone ? '' : '<button type="button" class="pe-conflict-btn" id="pe-conflict-reload">Recargar el plan</button>'}`;
    scroll.insertBefore(box, scroll.firstChild);
    scroll.scrollTop = 0;
    const reload = document.getElementById('pe-conflict-reload');
    if (reload) reload.onclick = async () => {
      reload.disabled = true;
      await KruxTrainStore.plans.reload().catch(() => {});
      const cb = onCloseCb; const id = editId;
      onCloseCb = null;
      open({ planId: id, onClose: cb });
    };
  }

  window.openPlanEditor = open;
})();

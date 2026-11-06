// ================== KRUX · FAMILIA DE ICONOS (Fase 1, en revisión) ==================
// Todavía NO se usa en la app: vive en design/ hasta que se apruebe.
// Rejilla de 24 × 24, margen de 2 px, trazo 1,75, terminaciones y uniones redondeadas.
// Los iconos del tiempo se construyen con módulos fijos (sol, nube, nube elevada) para que
// toda la familia comparta proporciones.
//
// Capas por clase (el color lo decide el CSS, así cambian con el texto y el tema):
//   p  → panel: relleno suave siempre visible (paredes)
//   t  → relleno tonal (currentColor con opacidad --kxi-tone; 0 en el modo «línea»)
//   s  → acento solar      w → agua        b → rayo        c → frío/nieve
//   r  → punto rojo (encadenada)            d → trazo discontinuo
//   f  → relleno sólido pequeño (puntos)

// ============================================
// MÓDULOS COMPARTIDOS
// ============================================
const KXI_CLOUD = 'M17 19H7.2A3.6 3.6 0 0 1 6.92 11.81A5.2 5.2 0 0 1 17.24 10.61A4.2 4.2 0 0 1 17 19Z';
// Nube elevada (precipitación): misma nube, 3,4 px más arriba
const KXI_CLOUD_HIGH = 'M17 15.6H7.2A3.6 3.6 0 0 1 6.92 8.41A5.2 5.2 0 0 1 17.24 7.21A4.2 4.2 0 0 1 17 15.6Z';
const KXI_CLOUD_SMALL = 'M18.24 19.98H10.2A2.95 2.95 0 0 1 9.97 14.09A4.26 4.26 0 0 1 18.44 13.1A3.44 3.44 0 0 1 18.24 19.98Z';
const KXI_CLOUD_BACK = 'M13.39 6.36A3.7 3.7 0 1 1 18.93 11.07';
const cloudFull = d => `<path class="t" d="${d}"/><path d="${d}"/>`;

// ============================================
// ICONOS
// ============================================
const KXI = {
  // ---------- TIEMPO ----------
  sol: { g: 'tiempo', label: 'Sol', body:
    '<circle class="t s" cx="12" cy="12" r="4.2"/><circle class="s" cx="12" cy="12" r="4.2"/>' +
    '<path class="s" d="M12 2.6v2.2M12 19.2v2.2M2.6 12h2.2M19.2 12h2.2M17.16 6.84l1.13-1.13M5.71 18.29l1.13-1.13M6.84 6.84 5.71 5.71M18.29 18.29l-1.13-1.13"/>' },
  nubes: { g: 'tiempo', label: 'Nubes', body: `<path d="${KXI_CLOUD_BACK}"/>` + cloudFull(KXI_CLOUD) },
  solNubes: { g: 'tiempo', label: 'Sol y nubes', body:
    '<circle class="t s" cx="8.5" cy="8.6" r="3.3"/><circle class="s" cx="8.5" cy="8.6" r="3.3"/>' +
    '<path class="s" d="M8.5 3.5V2M3.4 8.6H1.9M4.89 4.99l-.77-.77M12.11 4.99l.77-.77M4.89 12.21l-.77.77"/>' + cloudFull(KXI_CLOUD_SMALL) },
  lluvia: { g: 'tiempo', label: 'Lluvia', body: cloudFull(KXI_CLOUD_HIGH) +
    '<path class="w" d="M8.6 18.4l-.9 2.4M12.6 18.4l-.9 2.4M16.6 18.4l-.9 2.4"/>' },
  lluviaIntensa: { g: 'tiempo', label: 'Lluvia intensa', body: cloudFull(KXI_CLOUD_HIGH) +
    '<path class="w" d="M7.9 18l-1.5 4M11.4 18l-1.5 4M14.9 18l-1.5 4M18.4 18l-1.5 4"/>' },
  tormenta: { g: 'tiempo', label: 'Tormenta', body: cloudFull(KXI_CLOUD_HIGH) +
    '<path class="t b" d="M13.9 16.4 10.2 20.2h3.6l-2.6 2.6"/><path class="b" d="M13.9 16.4 10.2 20.2h3.6l-2.6 2.6"/><path class="w" d="M7.6 18.4l-.8 2.2"/>' },
  nieve: { g: 'tiempo', label: 'Nieve', body: cloudFull(KXI_CLOUD_HIGH) +
    '<path class="c" d="M8.2 17.6v4.6M6.2 18.75l4 2.3M6.2 21.05l4-2.3M15.8 17.6v4.6M13.8 18.75l4 2.3M13.8 21.05l4-2.3"/>' },
  viento: { g: 'tiempo', label: 'Viento', body:
    '<path d="M3 9h11a2.75 2.75 0 1 0-2.75-2.75"/><path d="M3 13h15.25a2.75 2.75 0 1 1-2.75 2.75"/><path d="M3 17h7.5"/>' },
  humedad: { g: 'tiempo', label: 'Humedad', body:
    '<path class="t w" d="M12 3.2c0 0-6 6.4-6 11a6 6 0 0 0 12 0c0-4.6-6-11-6-11Z"/><path d="M12 3.2c0 0-6 6.4-6 11a6 6 0 0 0 12 0c0-4.6-6-11-6-11Z"/>' +
    '<path class="w" d="M9 15.4c1-.8 2-.8 3 0s2 .8 3 0"/>' },
  direccionViento: { g: 'tiempo', label: 'Dirección del viento', rotate: true, body:
    '<path class="t" d="M12 3 18.3 20 12 16.5 5.7 20Z"/><path d="M12 3 18.3 20 12 16.5 5.7 20Z"/>' },
  niebla: { g: 'tiempo', label: 'Niebla', extra: true, body:
    '<path d="M5 7.5h14M3.5 11.5h17M6 15.5h12M9 19.5h6"/>' },

  // ---------- ESCALADA · tipo de pared ----------
  placa: { g: 'escalada', sub: 'Tipo de pared', label: 'Placa', body:
    '<path class="t" d="M7.5 21 14 3h7v18Z"/><path d="M7.5 21 14 3M3 21h18"/><path class="f" d="M11.4 12.6h.01M13 8.2h.01"/>' },
  pared: { g: 'escalada', sub: 'Tipo de pared', label: 'Vertical', body:
    '<path class="t" d="M10 21V3h11v18Z"/><path d="M10 21V3M3 21h18"/><path class="f" d="M10 14h.01M10 8.5h.01"/>' },
  desplome: { g: 'escalada', sub: 'Tipo de pared', label: 'Desplome', body:
    '<path class="t" d="M14 21 7 3h14v18Z"/><path d="M14 21 7 3M3 21h18"/><path class="f" d="M11.2 12.2h.01M9.4 7.6h.01"/>' },
  fisura: { g: 'escalada', sub: 'Tipo de pared', label: 'Fisura', body:
    '<path class="t" d="M5 3h14v18H5Z"/><path d="M5 3h14v18H5Z"/><path d="m12.6 3-1.4 4 1.8 3-1.8 4 1.4 3-.9 4"/>' },
  diedro: { g: 'escalada', sub: 'Tipo de pared', label: 'Diedro', body:
    '<path class="t" d="M12 3 4 7v14h8Z"/><path d="M12 3v18M12 3 4 7v14M12 3l8 4v14M3 21h18"/>' },

  // ---------- ESCALADA · vía y material ----------
  via: { g: 'escalada', sub: 'Vía y material', label: 'Vía', body:
    '<path class="p" d="M11.2 21 16.4 9.4 19.6 3.2H21.4V21Z"/>' +
    '<path d="M3.6 21Q5.4 20.33 5.87 18.47M7.74 15.67Q7.31 14.02 8.86 13.33M10.62 10.44Q12.58 9.66 12.78 7.56M15.07 5.07Q15.7 3.44 17.4 3"/>' +
    '<circle class="t" cx="7" cy="17.2" r="1.7"/><circle cx="7" cy="17.2" r="1.7"/><circle class="t" cx="9.6" cy="11.8" r="1.7"/><circle cx="9.6" cy="11.8" r="1.7"/><circle class="t" cx="13.8" cy="6.2" r="1.7"/><circle cx="13.8" cy="6.2" r="1.7"/>' },
  express: { g: 'escalada', sub: 'Vía y material', label: 'Express', body:
    '<path d="M9.9 8.8H9.6A1.2 1.2 0 0 1 8.4 7.6V5.8A3.6 3.6 0 0 1 15.6 5.8"/><path d="M15.6 7.4V7.6A1.2 1.2 0 0 1 14.4 8.8H14.1"/>' +
    '<path d="M14.1 15.2H14.4A1.2 1.2 0 0 1 15.6 16.4V18.2A3.6 3.6 0 0 1 8.4 18.2"/><path d="M8.4 16.6V16.4A1.2 1.2 0 0 1 9.6 15.2H9.9"/>' +
    '<rect class="p" x="9.9" y="8.8" width="4.2" height="6.4" rx=".7"/><rect x="9.9" y="8.8" width="4.2" height="6.4" rx=".7"/><path d="M9.9 14 14.1 12.2M9.9 11.6 14.1 9.8"/>' },
  longitud: { g: 'escalada', sub: 'Vía y material', label: 'Longitud', body:
    '<path d="M7 3h10M7 21h10M12 6.2v11.6M9.6 8.6 12 6.2l2.4 2.4M9.6 15.4 12 17.8l2.4-2.4"/>' },
  multilargo: { g: 'escalada', sub: 'Vía y material', label: 'Multilargo', body:
    '<path d="M8.6 21 13.6 16.4M12.4 14.6 10.4 12.2M11.4 9.2 13.2 6.6"/><circle class="t" cx="13.8" cy="15.6" r="1.6"/><circle cx="13.8" cy="15.6" r="1.6"/><circle class="t" cx="9.6" cy="10.6" r="1.6"/><circle cx="9.6" cy="10.6" r="1.6"/><circle class="t" cx="14" cy="4.8" r="1.6"/><circle cx="14" cy="4.8" r="1.6"/>' },
  boulder: { g: 'escalada', sub: 'Vía y material', label: 'Boulder', body:
    '<path class="t" d="M3.4 19.4 4.8 13.2 8.4 9.4 11.6 10.2 15 6.6 19.2 9.8 20.6 15.2 20 19.4Z"/><path d="M3.4 19.4 4.8 13.2 8.4 9.4 11.6 10.2 15 6.6 19.2 9.8 20.6 15.2 20 19.4Z"/><path d="M11.6 10.2l1.2 3.4-1 2.4M5 21.8h14"/>' },
  rapel: { g: 'escalada', sub: 'Vía y material', label: 'Rápel', body:
    '<path d="M8 3h8M12 3v13.6M8.6 13.4 12 16.8l3.4-3.4M7 21h10"/>' },
  grapas: { g: 'escalada', sub: 'Vía y material', label: 'Grapas', body:
    '<path d="M8 3.4v2.8h8V3.4M8 10.4v2.8h8v-2.8M8 17.4v2.8h8v-2.8"/>' },

  // ---------- ESCALADA · reuniones ----------
  anillas: { g: 'escalada', sub: 'Reuniones', label: 'Anillas', body:
    '<path d="M3 4h18M8.6 4v3.4M15.4 4v3.4"/><circle cx="8.6" cy="11" r="3.4"/><circle cx="15.4" cy="11" r="3.4"/>' },
  cadena: { g: 'escalada', sub: 'Reuniones', label: 'Cadena', body:
    '<path d="M3 4h18M12 4v1.6"/><ellipse cx="12" cy="9" rx="2.2" ry="3.2"/><path d="M12 12.4v3"/><ellipse cx="12" cy="18.6" rx="2.2" ry="3"/>' },
  mosqueton: { g: 'escalada', sub: 'Reuniones', label: 'Mosquetón', body:
    '<path d="M3 4h18M12 4v2.4"/><path d="M9 11V9.6a3.2 3.2 0 0 1 3.2-3.2h.4a4 4 0 0 1 4 4.2l-.4 6.6a4 4 0 0 1-4 3.8h-.4A2.8 2.8 0 0 1 9 18.2v-1.6"/><path d="M9 11l1.6 5"/>' },
  quimicos: { g: 'escalada', sub: 'Reuniones', label: 'Químicos', body:
    '<path d="M3 4h18"/><path d="M8.6 4v7.6a3.4 3.4 0 0 0 6.8 0V4"/><path class="d" d="M12 17.6v3.4"/>' },
  sinTerminar: { g: 'escalada', sub: 'Reuniones', label: 'Sin terminar', body:
    '<path d="M3 21h18M12 21v-8.6"/><path class="d" d="M12 9.6V3"/><circle class="t" cx="12" cy="12.4" r="1.6"/><circle cx="12" cy="12.4" r="1.6"/>' },

  // ---------- ESCALADA · acceso ----------
  permitido: { g: 'escalada', sub: 'Acceso', label: 'Permitido', body:
    '<path class="t" d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>' },
  prohibido: { g: 'escalada', sub: 'Acceso', label: 'Prohibido', body:
    '<circle class="t" cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/>' },
  temporal: { g: 'escalada', sub: 'Acceso', label: 'Restricción temporal', body:
    '<path d="M20.5 9.5V6.5a2 2 0 0 0-2-2h-13a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h4M16 2.5v4M8 2.5v4M3.5 10h6"/><circle class="t" cx="16.5" cy="16.5" r="5.2"/><circle cx="16.5" cy="16.5" r="5.2"/><path d="M16.5 14.2v2.5l1.6 1"/>' },
  sinInfo: { g: 'escalada', sub: 'Acceso', label: 'Sin información', body:
    '<circle cx="12" cy="12" r="9"/><path d="M9.3 9.3a2.8 2.8 0 0 1 5.4 1c0 1.9-2.7 2.5-2.7 4"/><path d="M12 17.4h.01"/>' },

  // ---------- ESCALADA · exposición ----------
  solManana: { g: 'escalada', sub: 'Exposición', label: 'Sol de mañana', body:
    '<path d="M2.5 18.5h19"/><path class="t s" d="M7 18.5a5 5 0 0 1 10 0Z"/><path class="s" d="M7 18.5a5 5 0 0 1 10 0M3.8 14.2l1.4.8M20.2 14.2l-1.4.8M12 9.4V6.4M9.8 4.6 12 2.4l2.2 2.2"/>' },
  solTarde: { g: 'escalada', sub: 'Exposición', label: 'Sol de tarde', body:
    '<path d="M2.5 18.5h19"/><path class="t s" d="M7 18.5a5 5 0 0 1 10 0Z"/><path class="s" d="M7 18.5a5 5 0 0 1 10 0M3.8 14.2l1.4.8M20.2 14.2l-1.4.8M12 2.4v3M9.8 4.2 12 6.4l2.2-2.2"/>' },
  solTodoDia: { g: 'escalada', sub: 'Exposición', label: 'Sol todo el día', body:
    '<path class="d" d="M3.5 13.5a8.5 8.5 0 0 1 17 0"/><circle class="t s" cx="12" cy="14" r="3.6"/><circle class="s" cx="12" cy="14" r="3.6"/><path d="M3 21h18"/>' },
  sombra: { g: 'escalada', sub: 'Exposición', label: 'Sombra', body:
    '<path class="p" d="M9.8 21 20 3.8V21Z"/><path d="M12.6 19.4l5-5.2M15.6 19.6l2.6-2.8"/>' +
    '<path d="M3 21l2.2-4.8 2.6-1.6 1.5-3.6 3-1.7 1.6-3.4L20 3.8V21"/>' },

  // ---------- ESCALADA · estilo de ascenso ----------
  encadenada: { g: 'escalada', sub: 'Estilo de ascenso', label: 'Encadenada', body:
    '<circle class="t" cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="9"/><path d="m8 12.2 2.8 2.8L16.4 9.4"/>' },
  redpoint: { g: 'escalada', sub: 'Estilo de ascenso', label: 'Redpoint', body:
    '<circle cx="12" cy="12" r="8.4"/><circle class="r f" cx="12" cy="12" r="3.6"/>' },
  onsight: { g: 'escalada', sub: 'Estilo de ascenso', label: 'A vista', body:
    '<path d="M2.4 12.4a.9.9 0 0 1 0-.8 10.6 10.6 0 0 1 19.2 0 .9.9 0 0 1 0 .8 10.6 10.6 0 0 1-19.2 0"/><circle class="t" cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="3"/>' },
  flash: { g: 'escalada', sub: 'Estilo de ascenso', label: 'Flash', body:
    '<path class="t b" d="M13.4 2.6 5 13.4h6.2L10.4 21.4 19 10.4h-6.2Z"/><path class="b" d="M13.4 2.6 5 13.4h6.2L10.4 21.4 19 10.4h-6.2Z"/>' },
  topRope: { g: 'escalada', sub: 'Estilo de ascenso', label: 'Top rope', body:
    '<path class="p" d="M2 21V3H3.6L3 9 3.9 14 3.2 21Z"/>' +
    '<path d="M9.2 2.2h7.6M13 2.2v2"/><rect class="t" x="11.4" y="4.4" width="3.2" height="4" rx="1.6"/><rect x="11.4" y="4.4" width="3.2" height="4" rx="1.6"/>' +
    '<path d="M12 8.2 9.6 12"/><path d="M14 8.2C16 10.2 17 14.6 17 20.6"/>' +
    '<circle cx="5.6" cy="11.4" r="1.3"/><path d="M6.2 13 7.2 16.2M6.6 13.6 9.6 12M6.1 13.4 3.4 14M7.2 16.2 4.4 18.2M7.2 16.2 8.2 20.2"/>' },
  proyecto: { g: 'escalada', sub: 'Estilo de ascenso', label: 'Proyecto', body:
    '<circle class="d" cx="12" cy="12" r="8.6"/><circle cx="12" cy="12" r="3.6"/><path d="M12 2v2.6M12 19.4V22M2 12h2.6M19.4 12H22"/>' },

  // ---------- ESCALADA · mapa ----------
  escuela: { g: 'escalada', sub: 'Mapa', label: 'Escuela', body:
    '<path class="t" d="M2.5 20 8.8 8.4l3.4 5.4 3-4.4 6.3 10.6Z"/><path d="M2.5 20 8.8 8.4l3.4 5.4 3-4.4 6.3 10.6Z"/><path d="M8.8 8.4V3.6l3.4 1.4-3.4 1.4"/>' },
  sector: { g: 'escalada', sub: 'Mapa', label: 'Sector', body:
    '<path d="M4.6 16.4c2.8-.8 4.2-5.8 7.6-5.8s5-3.6 7.2-4.4"/><circle class="t" cx="4" cy="16.8" r="1.9"/><circle cx="4" cy="16.8" r="1.9"/><circle class="t" cx="20" cy="6" r="1.9"/><circle cx="20" cy="6" r="1.9"/><path d="M6 21h12"/>' },
  aparcamiento: { g: 'escalada', sub: 'Mapa', label: 'Aparcamiento', body:
    '<rect class="t" x="3" y="3" width="18" height="18" rx="4"/><rect x="3" y="3" width="18" height="18" rx="4"/><path d="M9.6 17V7h3.6a3 3 0 0 1 0 6H9.6"/>' },
  trazado: { g: 'escalada', sub: 'Mapa', label: 'Trazado sobre foto', body:
    '<rect x="3" y="3" width="18" height="18" rx="3"/><path class="d" d="M8 18c0-3 2.6-4 2.6-7S9.4 7 10.6 6"/><circle class="t" cx="10.6" cy="6" r="1.5"/><circle cx="10.6" cy="6" r="1.5"/><path d="M14.6 17.2l4.6-4.6a1.2 1.2 0 0 0-1.7-1.7l-4.6 4.6-.6 2.3Z"/>' },

  // ---------- INTERFAZ ----------
  cerrar: { g: 'interfaz', label: 'Cerrar', body: '<path d="M18 6 6 18M6 6l12 12"/>' },
  check: { g: 'interfaz', label: 'Hecho', body: '<path d="M20 6 9 17l-5-5"/>' },
  mas: { g: 'interfaz', label: 'Añadir', body: '<path d="M12 5v14M5 12h14"/>' },
  menos: { g: 'interfaz', label: 'Quitar', body: '<path d="M5 12h14"/>' },
  atras: { g: 'interfaz', label: 'Atrás', body: '<path d="M19 12H5M12 19l-7-7 7-7"/>' },
  chevronDerecha: { g: 'interfaz', label: 'Siguiente', body: '<path d="m9 18 6-6-6-6"/>' },
  chevronIzquierda: { g: 'interfaz', label: 'Anterior', body: '<path d="m15 18-6-6 6-6"/>' },
  chevronAbajo: { g: 'interfaz', label: 'Desplegar', body: '<path d="m6 9 6 6 6-6"/>' },
  chevronArriba: { g: 'interfaz', label: 'Plegar', body: '<path d="m18 15-6-6-6 6"/>' },
  buscar: { g: 'interfaz', label: 'Buscar', body: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/>' },
  filtros: { g: 'interfaz', label: 'Filtros', body: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>' },
  capas: { g: 'interfaz', label: 'Capas', body: '<path class="t" d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65M22 17.65l-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/>' },
  ubicacion: { g: 'interfaz', label: 'Mi ubicación', body: '<circle cx="12" cy="12" r="7.5"/><circle class="t" cx="12" cy="12" r="2.6"/><circle cx="12" cy="12" r="2.6"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22"/>' },
  restablecer: { g: 'interfaz', label: 'Restablecer vista', body: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>' },
  puntoMapa: { g: 'interfaz', label: 'Lugar', body: '<path class="t" d="M20 10c0 5-5.54 10.19-7.4 11.8a1 1 0 0 1-1.2 0C9.54 20.19 4 15 4 10a8 8 0 0 1 16 0"/><path d="M20 10c0 5-5.54 10.19-7.4 11.8a1 1 0 0 1-1.2 0C9.54 20.19 4 15 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>' },
  mapa: { g: 'interfaz', label: 'Mapa', body: '<path d="M14.11 5.55a2 2 0 0 0 1.78 0l3.66-1.83A1 1 0 0 1 21 4.62v12.76a1 1 0 0 1-.55.9l-4.56 2.27a2 2 0 0 1-1.78 0l-4.22-2.1a2 2 0 0 0-1.78 0l-3.66 1.83A1 1 0 0 1 3 19.38V6.62a1 1 0 0 1 .55-.9l4.56-2.27a2 2 0 0 1 1.78 0z"/><path d="M15 5.76v15M9 3.24v15"/>' },
  comoIr: { g: 'interfaz', label: 'Cómo ir', body: '<path class="t" d="M3 11 22 2l-9 19-2-8Z"/><path d="M3 11 22 2l-9 19-2-8Z"/>' },
  foto: { g: 'interfaz', label: 'Foto', body: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>' },
  camara: { g: 'interfaz', label: 'Cámara', body: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z"/><circle cx="12" cy="13" r="3.2"/>' },
  guardar: { g: 'interfaz', label: 'Guardar', body: '<path class="t" d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2Z"/><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2Z"/>' },
  meGusta: { g: 'interfaz', label: 'Me gusta', body: '<path class="t" d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>' },
  comentar: { g: 'interfaz', label: 'Comentar', body: '<path class="t" d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>' },
  compartir: { g: 'interfaz', label: 'Compartir', body: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/>' },
  notificaciones: { g: 'interfaz', label: 'Notificaciones', body: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>' },
  mensajes: { g: 'interfaz', label: 'Mensajes', body: '<rect x="2" y="4" width="20" height="16" rx="3"/><path d="m22 7.5-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7.5"/>' },
  perfil: { g: 'interfaz', label: 'Perfil', body: '<circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 0 0-16 0"/>' },
  comunidad: { g: 'interfaz', label: 'Comunidad', body: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>' },
  ajustes: { g: 'interfaz', label: 'Ajustes', body: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>' },
  editar: { g: 'interfaz', label: 'Editar', body: '<path d="M12 20h9"/><path d="M16.38 3.62a1 1 0 0 1 3 3L7.37 18.64a2 2 0 0 1-.86.51l-2.87.84a.5.5 0 0 1-.62-.62l.84-2.87a2 2 0 0 1 .51-.86z"/>' },
  borrar: { g: 'interfaz', label: 'Eliminar', body: '<path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2M10 11v6M14 11v6"/>' },
  notificar: { g: 'interfaz', label: 'Notificar un problema', body: '<path class="t" d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22v-7"/>' },
  info: { g: 'interfaz', label: 'Información', body: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4.6M12 8h.01"/>' },
  aviso: { g: 'interfaz', label: 'Aviso', body: '<path class="t" d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3M12 9v4M12 17h.01"/>' },
  recargar: { g: 'interfaz', label: 'Reintentar', body: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8M21 3v5h-5M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16M8 16H3v5"/>' },
  sinConexion: { g: 'interfaz', label: 'Sin conexión', body: '<path d="M12 20h.01M8.5 16.43a5 5 0 0 1 7 0M5 12.86a10 10 0 0 1 5.17-2.69M19 12.86a10 10 0 0 0-2-1.52M2 8.82a15 15 0 0 1 4.18-2.64M22 8.82a15 15 0 0 0-11.29-3.76M2 2l20 20"/>' },
  entrar: { g: 'interfaz', label: 'Iniciar sesión', body: '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3"/>' },
  calendario: { g: 'interfaz', label: 'Fecha', body: '<rect x="3" y="4" width="18" height="18" rx="3"/><path d="M16 2v4M8 2v4M3 10h18"/>' },
  reloj: { g: 'interfaz', label: 'Hora', body: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.2 1.8"/>' },
  candado: { g: 'interfaz', label: 'Privado', body: '<rect x="4" y="11" width="16" height="10" rx="2.5"/><path d="M8 11V7.5a4 4 0 0 1 8 0V11"/>' },
  ver: { g: 'interfaz', label: 'Ver', body: '<path d="M2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 19.88 0 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-19.88 0"/><circle cx="12" cy="12" r="3"/>' },
  mas3: { g: 'interfaz', label: 'Más opciones', body: '<circle class="f" cx="5" cy="12" r="1.5"/><circle class="f" cx="12" cy="12" r="1.5"/><circle class="f" cx="19" cy="12" r="1.5"/>' },
  estrella: { g: 'interfaz', label: 'Valoración', body: '<path class="t" d="M11.53 2.3a.53.53 0 0 1 .95 0l2.31 4.67a2.12 2.12 0 0 0 1.6 1.16l5.16.76a.53.53 0 0 1 .3.9l-3.74 3.64a2.12 2.12 0 0 0-.61 1.88l.88 5.14a.53.53 0 0 1-.77.56l-4.62-2.43a2.12 2.12 0 0 0-1.97 0L6.4 21.01a.53.53 0 0 1-.77-.56l.88-5.14a2.12 2.12 0 0 0-.61-1.88L2.16 9.8a.53.53 0 0 1 .3-.9l5.16-.76a2.12 2.12 0 0 0 1.6-1.16z"/><path d="M11.53 2.3a.53.53 0 0 1 .95 0l2.31 4.67a2.12 2.12 0 0 0 1.6 1.16l5.16.76a.53.53 0 0 1 .3.9l-3.74 3.64a2.12 2.12 0 0 0-.61 1.88l.88 5.14a.53.53 0 0 1-.77.56l-4.62-2.43a2.12 2.12 0 0 0-1.97 0L6.4 21.01a.53.53 0 0 1-.77-.56l.88-5.14a2.12 2.12 0 0 0-.61-1.88L2.16 9.8a.53.53 0 0 1 .3-.9l5.16-.76a2.12 2.12 0 0 0 1.6-1.16z"/>' }
};

// Código WMO de Open-Meteo → icono (lo que hoy hacen getWeatherIconName y getWeatherIcon)
function kxiWeatherFor(code) {
  if (code === 0) return 'sol';
  if (code === 1 || code === 2) return 'solNubes';
  if (code === 3) return 'nubes';
  if (code === 45 || code === 48) return 'niebla';
  if (code >= 51 && code <= 57) return 'lluvia';           // llovizna
  if (code === 61 || code === 63 || code === 66 || code === 80 || code === 81) return 'lluvia';
  if (code === 65 || code === 67 || code === 82) return 'lluviaIntensa';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'nieve';
  if (code >= 95 && code <= 99) return 'tormenta';
  return 'nubes';
}

// SVG de un icono. variant: 'linea' (solo trazo), 'duo' (relleno tonal), 'color' (acentos de tiempo y estado)
function kxiSVG(name, { size = 24, variant = 'duo', cls = '', label = '', rotate = 0 } = {}) {
  const ic = KXI[name];
  if (!ic) return '';
  const a11y = label ? `role="img" aria-label="${label}"` : 'aria-hidden="true" focusable="false"';
  const rot = rotate ? ` style="transform:rotate(${rotate}deg)"` : '';
  return `<svg class="kxi kxi-${variant}${cls ? ' ' + cls : ''}" width="${size}" height="${size}" viewBox="0 0 24 24" ${a11y}${rot}>${ic.body}</svg>`;
}

// Estilos de la familia (en la app irán a app_2.css en la Fase 2)
const KXI_CSS = `
.kxi{fill:none;stroke:currentColor;stroke-width:var(--kxi-sw,1.75);stroke-linecap:round;stroke-linejoin:round;flex:none;vertical-align:middle}
.kxi .t{fill:currentColor;fill-opacity:var(--kxi-tone,0);stroke:none}
.kxi .f{fill:currentColor;stroke:none}
.kxi .p{fill:currentColor;fill-opacity:var(--kxi-panel,.12);stroke:none}
.kxi .d{stroke-dasharray:1.6 2.6}
.kxi-duo,.kxi-color{--kxi-tone:.14}
.kxi-color .s{stroke:var(--kxi-sun)}.kxi-color .t.s{fill:var(--kxi-sun);fill-opacity:.2}
.kxi-color .w{stroke:var(--kxi-water)}.kxi-color .t.w{fill:var(--kxi-water);fill-opacity:.14}
.kxi-color .b{stroke:var(--kxi-bolt)}.kxi-color .t.b{fill:var(--kxi-bolt);fill-opacity:.3}
.kxi-color .c{stroke:var(--kxi-cold)}
.kxi-color .r{fill:var(--kxi-red)}
:root{--kxi-sun:#B26F06;--kxi-water:#2F6FB3;--kxi-bolt:#B26F06;--kxi-cold:#3D7CB8;--kxi-red:#C2362B}
.kxi-on-dark{--kxi-panel:.2;--kxi-sun:#F4BC52;--kxi-water:#8DC0F0;--kxi-bolt:#F4BC52;--kxi-cold:#B9D7F4;--kxi-red:#FF8F80}
.kxi-on-dark .kxi-duo,.kxi-on-dark .kxi-color{--kxi-tone:.22}
`;

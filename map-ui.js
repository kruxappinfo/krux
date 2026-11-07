// ================== KRUX MAP UI ==================
// Componentes compartidos de las fichas del mapa (escuela, sector y vía),
// controles comunes para el resto de la app (segmentado, campos, estados) y
// controlador de las hojas inferiores móviles.
// Móvil y escritorio usan los mismos constructores de contenido: solo cambia
// el contenedor (hoja inferior en móvil, popup de MapLibre en escritorio).
// Sin dependencias: cadenas HTML + DOM nativo.

// ============================================
// UTILIDADES
// ============================================
function kxEsc(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

// Atributos HTML a partir de un objeto ({ id, 'data-x': 1, onclick }); false/null se omiten
function kxAttrs(attrs) {
  if (!attrs) return '';
  return Object.entries(attrs)
    .filter(([, v]) => v !== false && v !== null && v !== undefined)
    .map(([k, v]) => (v === true ? ` ${k}` : ` ${k}="${kxEsc(v)}"`))
    .join('');
}

// ============================================
// ICONOS (Lucide, ISC — trazo único, 24×24)
// ============================================
const KX_ICON_PATHS = {
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  chevronRight: '<path d="m9 18 6-6-6-6"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  mapPin: '<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>',
  mountain: '<path d="m8 3 4 8 5-5 5 15H2L8 3z"/>',
  navigation: '<polygon points="3 11 22 2 13 21 11 13 3 11"/>',
  map: '<path d="M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z"/><path d="M15 5.764v15"/><path d="M9 3.236v15"/>',
  image: '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
  images: '<path d="M18 22H4a2 2 0 0 1-2-2V6"/><path d="m22 13-1.296-1.296a2.41 2.41 0 0 0-3.408 0L11 18"/><circle cx="12" cy="8" r="2"/><rect width="16" height="16" x="6" y="2" rx="2"/>',
  triangleAlert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  bookmark: '<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/>',
  messageCircle: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" x2="15.42" y1="13.51" y2="17.49"/><line x1="15.41" x2="8.59" y1="6.51" y2="10.49"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
  sunrise: '<path d="M12 2v8"/><path d="m4.93 10.93 1.41 1.41"/><path d="M2 18h2"/><path d="M20 18h2"/><path d="m19.07 10.93-1.41 1.41"/><path d="M22 22H2"/><path d="m8 6 4-4 4 4"/><path d="M16 18a4 4 0 0 0-8 0"/>',
  sunset: '<path d="M12 10V2"/><path d="m4.93 10.93 1.41 1.41"/><path d="M2 18h2"/><path d="M20 18h2"/><path d="m19.07 10.93-1.41 1.41"/><path d="M22 22H2"/><path d="m16 6-4 4-4-4"/><path d="M16 18a4 4 0 0 0-8 0"/>',
  cloud: '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
  shieldCheck: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
  ban: '<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>',
  calendarClock: '<path d="M21 7.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3.5"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h5"/><path d="M17.5 17.5 16 16.3V14"/><circle cx="16" cy="16" r="6"/>',
  circleHelp: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
  star: '<path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"/>',
  droplet: '<path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z"/>',
  wind: '<path d="M12.8 19.6A2 2 0 1 0 14 16H2"/><path d="M17.5 8a2.5 2.5 0 1 1 2 4H2"/><path d="M9.8 4.4A2 2 0 1 1 11 8H2"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  ruler: '<path d="M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.41 2.41 0 0 1 0-3.4l2.6-2.6a2.41 2.41 0 0 1 3.4 0Z"/><path d="m14.5 12.5 2-2"/><path d="m11.5 9.5 2-2"/><path d="m8.5 6.5 2-2"/><path d="m17.5 15.5 2-2"/>',
  flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
  route: '<circle cx="6" cy="19" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/><circle cx="18" cy="5" r="3"/>',
  pen: '<path d="M12 20h9"/><path d="M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  wifiOff: '<path d="M12 20h.01"/><path d="M8.5 16.429a5 5 0 0 1 7 0"/><path d="M5 12.859a10 10 0 0 1 5.17-2.69"/><path d="M19 12.859a10 10 0 0 0-2.007-1.523"/><path d="M2 8.82a15 15 0 0 1 4.177-2.643"/><path d="M22 8.82a15 15 0 0 0-11.288-3.764"/><path d="m2 2 20 20"/>',
  thumbsUp: '<path d="M7 10v12"/><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z"/>',
  thumbsDown: '<path d="M17 14V2"/><path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  instagram: '<rect width="20" height="20" x="2" y="2" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" x2="17.51" y1="6.5" y2="6.5"/>',
  facebook: '<path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/>',
  youtube: '<path d="M2.5 17a24.12 24.12 0 0 1 0-10 2 2 0 0 1 1.4-1.4 49.56 49.56 0 0 1 16.2 0A2 2 0 0 1 21.5 7a24.12 24.12 0 0 1 0 10 2 2 0 0 1-1.4 1.4 49.55 49.55 0 0 1-16.2 0A2 2 0 0 1 2.5 17"/><path d="m10 15 5-3-5-3z"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
  music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  externalLink: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  arrowUpDown: '<path d="m8 6 4-4 4 4"/><path d="M12 2v20"/><path d="m8 18 4 4 4-4"/>',
  chartBar: '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
  compass: '<circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>',
  car: '<path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/>',
  thermometer: '<path d="M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0Z"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  shadeDot: '<circle cx="12" cy="12" r="8" stroke="none" style="fill: var(--kx-ink)"/>',
  logIn: '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" x2="3" y1="12" y2="12"/>'
};

function kxIcon(name, { size = 20, cls = '', stroke = 1.75 } = {}) {
  const body = KX_ICON_PATHS[name];
  if (!body) return '';
  return `<svg class="kx-ic${cls ? ' ' + cls : ''}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
}

// ============================================
// CONSTRUCTORES DE CONTENIDO
// ============================================

// Cabecera de ficha: título (opcionalmente en mayúsculas), línea secundaria y cierre
function kxHeaderHTML({ title = '', titleId, upper = false, metaHTML = '', asideHTML = '', closeLabel = 'Cerrar', close = true } = {}) {
  return `<header class="kx-fhead">
    <div class="kx-fhead-main">
      <h2 class="kx-fhead-title${upper ? ' is-upper' : ''}"${kxAttrs({ id: titleId })}>${kxEsc(title)}</h2>
      ${metaHTML ? `<div class="kx-fhead-meta">${metaHTML}</div>` : ''}
    </div>
    ${asideHTML}
    ${close ? `<button type="button" class="kx-close" data-kx-close aria-label="${kxEsc(closeLabel)}">${kxIcon('x', { size: 20, stroke: 2 })}</button>` : ''}
  </header>`;
}

// Zona de arrastre de una hoja: tirador (botón accesible) + cabecera
function kxSheetDragHTML(headerOpts = {}) {
  return `<button type="button" class="kx-msheet-grip" aria-label="Ampliar ficha" aria-expanded="false"></button>${kxHeaderHTML(headerOpts)}`;
}

// Etiqueta compacta (tipo de roca, estado). tone: neutral | forest | success | warning | danger | info
// solid: relleno de énfasis (un único estado por pantalla). Si el texto no cabe, pasa a otra línea.
function kxTagHTML({ icon, text = '', textId, tone = 'neutral', solid = false, attrs } = {}) {
  return `<span class="kx-tag kx-tone-${tone}${solid ? ' kx-tag--solid' : ''}"${kxAttrs(attrs)}>${icon ? kxIcon(icon, { size: 16 }) : ''}<span${kxAttrs({ id: textId })}>${kxEsc(text)}</span></span>`;
}

// Sección con título y dato a la derecha («Vías por grado · 344 vías»)
function kxSectionHTML({ title = '', meta = '', metaId, body = '', id, cls = '' } = {}) {
  return `<section class="kx-fsec${cls ? ' ' + cls : ''}"${kxAttrs({ id })}>
    ${title ? `<div class="kx-fsec-head"><h3 class="kx-fsec-title">${kxEsc(title)}</h3><span class="kx-fsec-meta"${kxAttrs({ id: metaId })}>${kxEsc(meta)}</span></div>` : ''}
    ${body}
  </section>`;
}

// Fila de información: icono + etiqueta + valor (acceso, exposición, estado medio)
// action: la fila es un botón (abre algo) y lleva flecha
function kxInfoRowHTML({ icon, label = '', value = '', valueHTML = '', tone = 'neutral', action = false, attrs } = {}) {
  const tag = action ? 'button' : 'div';
  return `<${tag} class="kx-irow kx-tone-${tone}${action ? ' kx-irow--action' : ''}"${action ? ' type="button"' : ''}${kxAttrs(attrs)}>
    <span class="kx-irow-icon">${icon ? kxIcon(icon, { size: 20 }) : ''}</span>
    <span class="kx-irow-label">${kxEsc(label)}</span>
    ${valueHTML || value ? `<span class="kx-irow-value">${valueHTML || kxEsc(value)}</span>` : ''}
    ${action ? kxIcon('chevronRight', { size: 18, cls: 'kx-irow-chev' }) : ''}
  </${tag}>`;
}

// Dato técnico: icono + valor + etiqueta. missing → atenuado y pulsable para completarlo;
// action → el dato existe y además se puede corregir (botón)
function kxStatTileHTML({ icon, value = '', label = '', missing = false, missingText = 'Añadir', action = false, attrs } = {}) {
  const tag = missing || action ? 'button' : 'div';
  return `<${tag} class="kx-stat${missing ? ' is-missing' : ''}${action && !missing ? ' is-action' : ''}"${missing || action ? ' type="button"' : ''}${kxAttrs(attrs)}>
    <span class="kx-stat-icon">${icon ? kxIcon(icon, { size: 22 }) : ''}</span>
    <span class="kx-stat-value">${missing ? kxEsc(missingText) : kxEsc(value)}</span>
    <span class="kx-stat-label">${kxEsc(label)}</span>
  </${tag}>`;
}

// Acción en rejilla (Ascenso, Proyecto, Comentarios, Compartir). primary → protagonismo
// active → ya marcada (aria-pressed) · disabled → no disponible · busy → en curso
function kxActionTileHTML({ icon, iconHTML = '', label = '', badge = '', primary = false, active = false, disabled = false, busy = false, attrs } = {}) {
  const state = `${active ? ' aria-pressed="true"' : ''}${disabled ? ' disabled' : ''}${busy ? ' aria-busy="true"' : ''}`;
  return `<button type="button" class="kx-act${primary ? ' is-primary' : ''}${active ? ' is-active' : ''}"${state}${kxAttrs(attrs)}>
    <span class="kx-act-icon">${iconHTML || kxIcon(icon, { size: 22 })}${badge !== '' && badge !== null && badge !== undefined ? `<span class="kx-act-badge">${kxEsc(badge)}</span>` : ''}</span>
    <span class="kx-act-label">${kxEsc(label)}</span>
  </button>`;
}

// Acción secundaria en lista («Ver en el sector», «Notificar un problema»)
function kxListActionHTML({ icon, label = '', tone = 'neutral', disabled = false, attrs } = {}) {
  return `<button type="button" class="kx-lact kx-tone-${tone}"${disabled ? ' disabled' : ''}${kxAttrs(attrs)}>
    <span class="kx-lact-icon">${icon ? kxIcon(icon, { size: 20 }) : ''}</span>
    <span class="kx-lact-label">${kxEsc(label)}</span>
    ${kxIcon('chevronRight', { size: 18, cls: 'kx-lact-chev' })}
  </button>`;
}

// Botón de acción: un único sistema (.kx-btn, píldora). La jerarquía la da el color.
// variant: primary | secondary | tertiary | danger · size: sm | md | lg (lg en los pies de hoja)
function kxButtonHTML({ icon, label = '', variant = 'primary', size = 'md', attrs } = {}) {
  const v = variant === 'ghost' ? 'tertiary' : variant;
  const sizeCls = size === 'md' ? '' : ` kx-btn--${size}`;
  const iconSize = size === 'sm' ? 16 : 20;
  return `<button type="button" class="kx-btn kx-btn--${v}${sizeCls}"${kxAttrs(attrs)}>${icon ? kxIcon(icon, { size: iconSize }) : ''}<span>${kxEsc(label)}</span></button>`;
}

// ---- Estados de interfaz ----
function kxSkeletonHTML(kind = 'lines') {
  if (kind === 'bars') {
    const h = [34, 58, 82, 64, 46, 72, 40, 22];
    return `<div class="kx-skel kx-skel-bars" aria-hidden="true">${h.map(v => `<span style="height:${v}%"></span>`).join('')}</div>`;
  }
  if (kind === 'donut') return '<div class="kx-skel kx-skel-donut" aria-hidden="true"><span></span></div>';
  if (kind === 'tiles') return '<div class="kx-skel kx-skel-tiles" aria-hidden="true"><span></span><span></span><span></span></div>';
  if (kind === 'media') return '<div class="kx-skel kx-skel-media" aria-hidden="true"></div>';
  if (kind === 'rows') return `<div class="kx-skel-rows" aria-hidden="true">${'<div><span></span><span></span></div>'.repeat(3)}</div>`;
  return '<div class="kx-skel kx-skel-lines" aria-hidden="true"><span></span><span></span></div>';
}

// action: { label, attrs } añade un botón secundario para salir del vacío («Añadir la primera vía»)
function kxEmptyHTML({ icon = 'chartBar', text = 'Sin información', action } = {}) {
  const btn = action ? kxButtonHTML({ label: action.label, variant: 'secondary', size: 'sm', attrs: action.attrs }) : '';
  return `<div class="kx-state kx-state-empty">${kxIcon(icon, { size: 22 })}<span>${kxEsc(text)}</span>${btn}</div>`;
}

function kxErrorHTML({ text = 'No se pudo cargar. Revisa la conexión.', retryLabel = 'Reintentar', retryAttrs } = {}) {
  return `<div class="kx-state kx-state-error" role="status">${kxIcon('wifiOff', { size: 22 })}<span>${kxEsc(text)}</span>${retryAttrs ? `<button type="button" class="kx-state-retry"${kxAttrs(retryAttrs)}>${kxIcon('refresh', { size: 16 })}${kxEsc(retryLabel)}</button>` : ''}</div>`;
}

// action: { label, attrs } añade el botón que abre el inicio de sesión
function kxSignInNoticeHTML({ text = 'Inicia sesión para votar', action, attrs } = {}) {
  const btn = action ? kxButtonHTML({ label: action.label, variant: 'tertiary', size: 'sm', attrs: action.attrs }) : '';
  return `<div class="kx-state kx-state-auth"${kxAttrs(attrs)}>${kxIcon('logIn', { size: 18 })}<span>${kxEsc(text)}</span>${btn}</div>`;
}

// Estado de una acción en curso o terminada. state: pending | done | error
function kxStatusHTML({ state = 'pending', text = '' } = {}) {
  const icon = state === 'done' ? kxIcon('check', { size: 16 }) : state === 'error' ? kxIcon('triangleAlert', { size: 16 }) : '';
  return `<span class="kx-status kx-status-${state}" role="status">${icon}<span>${kxEsc(text)}</span></span>`;
}

// ---- Controles compartidos (Fase 2) ----

// Selector segmentado: opciones excluyentes; la elegida lleva aria-pressed="true".
// items: [{ value, label, count?, disabled? }] · disabled: todo el grupo
function kxSegmentedHTML({ items = [], value, label = '', disabled = false, attrs } = {}) {
  const btns = items.map(it => {
    const on = String(it.value) === String(value);
    const count = it.count != null ? `<span class="kx-seg-count">${kxEsc(it.count)}</span>` : '';
    const off = disabled || it.disabled ? ' disabled' : '';
    return `<button type="button" class="kx-seg-btn" data-value="${kxEsc(it.value)}" aria-pressed="${on}"${off}>${kxEsc(it.label)}${count}</button>`;
  }).join('');
  return `<div class="kx-seg" role="group"${label ? ` aria-label="${kxEsc(label)}"` : ''}${disabled ? ' aria-disabled="true"' : ''}${kxAttrs(attrs)}>${btns}</div>`;
}

// Si las opciones no caben en una fila, el selector pasa a chips (nunca se cortan etiquetas).
function kxFitSegmented(el) {
  if (!el) return false;
  el.classList.remove('is-chips');
  const overflow = el.scrollWidth > el.clientWidth + 1;
  el.classList.toggle('is-chips', overflow);
  return overflow;
}

// Activa un selector segmentado: marca la opción pulsada y avisa con su valor.
// Flechas izquierda/derecha mueven la selección (saltando las deshabilitadas).
// Se ajusta solo a chips cuando cambia el ancho disponible.
function kxBindSegmented(el, onChange) {
  if (!el || el._kxSeg) return;
  el._kxSeg = true;
  const btns = () => [...el.querySelectorAll('.kx-seg-btn')];
  const enabled = () => btns().filter(b => !b.disabled);
  const select = (btn) => {
    if (!btn || btn.disabled || btn.getAttribute('aria-pressed') === 'true') return;
    btns().forEach(b => b.setAttribute('aria-pressed', String(b === btn)));
    if (onChange) onChange(btn.dataset.value);
  };
  el.addEventListener('click', (e) => select(e.target.closest('.kx-seg-btn')));
  el.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const list = enabled();
    const i = list.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    const next = list[(i + (e.key === 'ArrowRight' ? 1 : list.length - 1)) % list.length];
    next.focus();
    next.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    select(next);
  });
  kxFitSegmented(el);
  if (typeof ResizeObserver === 'function') {
    let w = 0;
    new ResizeObserver(([entry]) => {
      const nw = Math.round(entry.contentRect.width);
      if (nw !== w) { w = nw; kxFitSegmented(el); }
    }).observe(el.parentElement || el);
  }
}

// Campo con etiqueta, ayuda y error. type: text | number | email | search | textarea | select
// options (select): [{ value, label }]
function kxFieldHTML({ id, label = '', type = 'text', value = '', placeholder = '', help = '', error = '', optional = false, disabled = false, required = false, options = [], attrs } = {}) {
  const helpId = help ? `${id}-help` : '';
  const errId = `${id}-error`;
  const described = [helpId, error ? errId : ''].filter(Boolean).join(' ');
  const common = `id="${kxEsc(id)}"${described ? ` aria-describedby="${described}"` : ''}${error ? ' aria-invalid="true"' : ''}${required ? ' required' : ''}${disabled ? ' disabled' : ''}${kxAttrs(attrs)}`;
  let control;
  if (type === 'textarea') {
    control = `<textarea class="kx-field kx-field--area" ${common}${placeholder ? ` placeholder="${kxEsc(placeholder)}"` : ''}>${kxEsc(value)}</textarea>`;
  } else if (type === 'select') {
    const opts = options.map(o => `<option value="${kxEsc(o.value)}"${String(o.value) === String(value) ? ' selected' : ''}>${kxEsc(o.label)}</option>`).join('');
    control = `<select class="kx-field kx-field--select" ${common}>${opts}</select>`;
  } else {
    control = `<input class="kx-field" type="${kxEsc(type)}" ${common} value="${kxEsc(value)}"${placeholder ? ` placeholder="${kxEsc(placeholder)}"` : ''}>`;
  }
  return `<div class="kx-formrow">`
    + `<label class="kx-label" for="${kxEsc(id)}">${kxEsc(label)}${optional ? ' <span class="kx-label-optional">(opcional)</span>' : ''}</label>`
    + control
    + (help ? `<p class="kx-help" id="${helpId}">${kxEsc(help)}</p>` : '')
    + `<p class="kx-field-error" id="${errId}"${error ? '' : ' hidden'}>${kxIcon('triangleAlert', { size: 14 })}<span>${kxEsc(error)}</span></p>`
    + `</div>`;
}

// Muestra u oculta el error de un campo creado con kxFieldHTML (texto + icono + aria-invalid)
function kxSetFieldError(id, message = '') {
  const control = document.getElementById(id);
  const box = document.getElementById(`${id}-error`);
  if (!control || !box) return;
  const help = document.getElementById(`${id}-help`) ? `${id}-help` : '';
  box.querySelector('span').textContent = message;
  box.hidden = !message;
  if (message) control.setAttribute('aria-invalid', 'true'); else control.removeAttribute('aria-invalid');
  const described = [help, message ? box.id : ''].filter(Boolean).join(' ');
  if (described) control.setAttribute('aria-describedby', described); else control.removeAttribute('aria-describedby');
}

// ---- Popup de escritorio (carcasa común) ----

// Cabecera fija (kxHeaderHTML), contenido desplazable y acciones fijas.
// size: sm (280) | md (360) | lg (420) · header: opciones de kxHeaderHTML · actions: HTML de botones
function kxPopoverHTML({ size = 'md', header = {}, body = '', actions = '', attrs } = {}) {
  const labelled = header.titleId ? ` aria-labelledby="${kxEsc(header.titleId)}"` : '';
  return `<div class="kx-pop${size === 'md' ? '' : ` kx-pop--${size}`}" role="dialog" tabindex="-1"${labelled}${kxAttrs(attrs)}>`
    + `<div class="kx-pop-head">${kxHeaderHTML(header)}</div>`
    + `<div class="kx-pop-body">${body}</div>`
    + (actions ? `<div class="kx-pop-foot">${actions}</div>` : '')
    + `</div>`;
}

// Activa un popup: cierre con ✕ y Escape, separadores solo cuando hay desplazamiento.
function kxBindPopover(el, { onClose } = {}) {
  if (!el || el._kxPop) return null;
  el._kxPop = true;
  const body = el.querySelector('.kx-pop-body');
  const sync = () => {
    if (!body) return;
    el.classList.toggle('is-scrolled', body.scrollTop > 0);
    el.classList.toggle('has-more', body.scrollTop + body.clientHeight < body.scrollHeight - 1);
  };
  const close = () => { if (onClose) onClose(); };
  const onKey = (e) => { if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); close(); } };
  el.addEventListener('click', (e) => { if (e.target.closest('[data-kx-close]')) close(); });
  el.addEventListener('keydown', onKey);
  if (body) body.addEventListener('scroll', sync, { passive: true });
  let ro = null;
  if (typeof ResizeObserver === 'function' && body) { ro = new ResizeObserver(sync); ro.observe(body); }
  sync();
  return { update: sync, destroy() { el.removeEventListener('keydown', onKey); if (ro) ro.disconnect(); el._kxPop = false; } };
}

// ---- Gráficos por grado (colores originales: getGradeColor de maplibre-map.js) ----
function kxGradeColor(grade) {
  return typeof getGradeColor === 'function' ? getGradeColor(grade) : '#9CA3AF';
}

// ---- Gráfico de grados interactivo (Fase 3): fichas de escuela y sector, móvil y escritorio ----

// Orden canónico de grados: el de la tabla de colores de getGradeColor (una prueba lo mantiene igual)
const KX_GRADE_ORDER = ['3', '3a', '3b', '3c', '4a', '4b', '4c', '4+', '5a', '5a+', '5b', '5b+', '5c', '5c+', '5+',
  '6a', '6a+', '6b', '6b+', '6c', '6c+', '7a', '7a+', '7b', '7b+', '7c', '7c+', '8a', '8a+', '8b', '8b+', '8c', '8c+',
  '9a', '9a+', '9b', '9b+', '9c', '9c+'];

// Posición de un grado en la escala. Los genéricos o dudosos («5», «7?») van al principio de su familia.
// Sin número («no info», «?», vacío) → null: no es un grado y no se dibuja como barra.
function kxGradeRank(grade) {
  const g = String(grade ?? '').toLowerCase().trim();
  const exact = KX_GRADE_ORDER.indexOf(g);
  if (exact >= 0) return exact;
  const num = (g.match(/\d+/) || [])[0];
  if (!num) return null;
  const first = KX_GRADE_ORDER.findIndex(x => x.startsWith(num));
  return (first >= 0 ? first : KX_GRADE_ORDER.length) - 0.5;
}

// Coordenadas [lng, lat] de una vía: los GeoJSON de las escuelas usan MultiPoint y las vías de spotters, Point
function kxFeaturePoints(feature) {
  const g = feature && feature.geometry;
  if (!g || !Array.isArray(g.coordinates)) return [];
  const isPt = c => Array.isArray(c) && typeof c[0] === 'number' && typeof c[1] === 'number';
  if (g.type === 'Point') return isPt(g.coordinates) ? [g.coordinates] : [];
  return g.coordinates.flat(Infinity).length >= 2 && g.type === 'MultiPoint' ? g.coordinates.filter(isPt) : [];
}

// Comparador común de grados (orden de la tabla de colores, sin distinguir mayúsculas).
// Lo usan el mapa, el perfil y los gráficos. Lo que no es un grado («no info», «?») queda antes
// que cualquier grado, así nunca cuenta como grado máximo.
function kxCompareGrades(a, b) {
  const ra = kxGradeRank(a), rb = kxGradeRank(b);
  if (ra === null || rb === null) return ra === rb ? 0 : ra === null ? -1 : 1;
  return ra - rb;
}

// Porcentaje legible: entero desde 10 %, un decimal por debajo («2,3 %»), «<0,1 %» si no llega
function kxFormatPct(p) {
  if (p > 0 && p < 0.05) return '<0,1 %';
  return (p >= 10 ? String(Math.round(p)) : p.toFixed(1).replace('.', ',').replace(',0', '')) + ' %';
}

// Estadística de grados a partir de { grado: vías }. ungraded: vías sin grado que el llamador ya conoce.
// Los porcentajes se calculan sobre las vías con grado; las demás se informan aparte.
function kxGradeStats(gradeCounts, { ungraded = 0 } = {}) {
  const merged = {};
  let noGrade = ungraded;
  for (const [raw, n] of Object.entries(gradeCounts || {})) {
    const c = Number(n) || 0;
    if (c <= 0) continue;
    const g = String(raw).toLowerCase().trim();
    if (kxGradeRank(g) === null) { noGrade += c; continue; }
    merged[g] = (merged[g] || 0) + c;
  }
  const graded = Object.values(merged).reduce((s, c) => s + c, 0);
  const entries = Object.keys(merged)
    .sort((a, b) => kxGradeRank(a) - kxGradeRank(b) || a.localeCompare(b))
    .map(g => ({ grade: g, count: merged[g], pct: graded ? (merged[g] / graded) * 100 : 0, family: (g.match(/\d+/) || [''])[0] }));
  const max = entries.reduce((m, e) => Math.max(m, e.count), 0);
  const mode = entries.find(e => e.count === max) || null;
  let acc = 0;
  const median = entries.find(e => (acc += e.count) >= graded / 2) || null;
  const families = [];
  entries.forEach((e, i) => {
    const last = families[families.length - 1];
    if (last && last.family === e.family) last.to = i; else families.push({ family: e.family, from: i, to: i });
  });
  return { entries, graded, ungraded: noGrade, total: graded + noGrade, max, mode, median, families,
    first: entries[0] || null, last: entries[entries.length - 1] || null };
}

// Escala del eje: máximo redondeado y 2–4 marcas limpias (0, 10, 20…)
function kxNiceTicks(max) {
  if (max <= 0) return { top: 1, ticks: [0] };
  const steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000];
  const step = steps.find(s => max / s <= 4) || Math.ceil(max / 4);
  const top = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = 0; v <= top; v += step) ticks.push(v);
  return { top, ticks };
}

// Gráfico de barras por grado: cada grado es un botón (selección, teclado y lector de pantalla).
// Muestra todos los grados por separado; la tabla equivalente va debajo.
function kxGradeChartHTML(stats, { id = 'kx-gchart', title = 'Vías por grado', viewLabel = 'Ver las vías' } = {}) {
  if (!stats || !stats.entries.length) {
    return `<section class="kx-gchart" id="${kxEsc(id)}">${kxEmptyHTML({ text: stats && stats.ungraded ? `Hay ${stats.ungraded} vías, pero ninguna tiene grado registrado` : 'Todavía no hay vías registradas' })}</section>`;
  }
  const { entries, ticks, top } = { entries: stats.entries, ...kxNiceTicks(stats.max) };
  const n = entries.length;
  const bars = entries.map((e, i) => {
    const h = Math.max(1.5, (e.count / Math.max(top, 4)) * 100); // mínimo 4: con pocas vías las barras no se disparan
    const label = `${e.grade}: ${e.count} ${e.count === 1 ? 'vía' : 'vías'}, ${kxFormatPct(e.pct)}`;
    return `<button type="button" class="kx-gbar${e.count === stats.max ? ' is-max' : ''}" data-i="${i}" data-grade="${kxEsc(e.grade)}" aria-pressed="false" aria-label="${kxEsc(label)}" tabindex="${i === 0 ? 0 : -1}" style="--h:${h.toFixed(2)}%;--c:${kxGradeColor(e.grade)}">`
      + `<span class="kx-gbar-val" aria-hidden="true">${e.count}</span><span class="kx-gbar-fill" aria-hidden="true"></span></button>`;
  }).join('');
  const grid = ticks.map(t => `<span class="kx-gchart-tick" style="--y:${((t / top) * 100).toFixed(2)}%"><span>${t}</span></span>`).join('');
  const labels = entries.map((e, i) => `<span class="kx-gchart-xl" data-i="${i}">${kxEsc(e.grade)}</span>`).join('');
  const rows = entries.map(e => `<tr><th scope="row"><span class="kx-gchart-sw" style="--c:${kxGradeColor(e.grade)}"></span>${kxEsc(e.grade)}</th><td>${e.count}</td><td>${kxFormatPct(e.pct)}</td></tr>`).join('');
  return `<section class="kx-gchart" id="${kxEsc(id)}" data-n="${n}" data-graded="${stats.graded}" data-view-label="${kxEsc(viewLabel)}">
    <div class="kx-gchart-head"><h3 class="kx-gchart-title">${kxEsc(title)}</h3><span class="kx-gchart-total">${stats.graded} ${stats.graded === 1 ? 'vía' : 'vías'}</span></div>
    <div class="kx-gchart-readout" aria-live="polite"></div>
    <div class="kx-gchart-plot">
      <div class="kx-gchart-grid" aria-hidden="true">${grid}</div>
      <div class="kx-gchart-bars" role="group" aria-label="${kxEsc(title)}. Usa las flechas para recorrer los grados" style="--n:${n}">${bars}</div>
      <div class="kx-gchart-x" aria-hidden="true" style="--n:${n}">${labels}</div>
    </div>
    <details class="kx-gchart-table"><summary>Ver como tabla</summary>
      <table><thead><tr><th scope="col">Grado</th><th scope="col">Vías</th><th scope="col">%</th></tr></thead><tbody>${rows}</tbody>
      <tfoot><tr><th scope="row">Con grado</th><td>${stats.graded}</td><td>100 %</td></tr>${stats.ungraded ? `<tr><th scope="row">Sin grado</th><td>${stats.ungraded}</td><td>—</td></tr>` : ''}</tfoot></table>
    </details>
  </section>`;
}

// Píldora del filtro de un grado sobre el mapa: grado activo (toque = volver al gráfico) y ✕ para quitarlo
function kxGradeFocusChipHTML({ grade = '', count = 0, where = '' } = {}) {
  const n = `${count} ${count === 1 ? 'vía' : 'vías'}`;
  return `<span class="kx-visually-hidden" role="status">Mapa filtrado: grado ${kxEsc(grade)}, ${n}</span>`
    + `<button type="button" class="kx-gfocus-main" data-kx-refocus aria-label="${kxEsc(`Grado ${grade}, ${n}${where ? ` en ${where}` : ''}. Volver al gráfico`)}">`
    + `<span class="kx-gchart-sw" style="--c:${kxGradeColor(grade)}"></span>`
    + `<span class="kx-gfocus-txt"><b>${kxEsc(grade)}</b> · ${n}${where ? `<small>${kxEsc(where)}</small>` : ''}</span></button>`
    + `<button type="button" class="kx-gfocus-x" data-kx-unfocus aria-label="Quitar el filtro de grado">${kxIcon('x', { size: 18 })}</button>`;
}

// Estados del gráfico mientras carga o si falla la lectura (misma cabecera y altura aproximada)
function kxGradeChartStateHTML(kind, { title = 'Vías por grado' } = {}) {
  const head = `<div class="kx-gchart-head"><h3 class="kx-gchart-title">${kxEsc(title)}</h3>${kind === 'loading' ? '<span class="kx-gchart-total">Cargando…</span>' : ''}</div>`;
  const body = kind === 'loading'
    ? kxSkeletonHTML('tiles') + kxSkeletonHTML('bars')
    : kxErrorHTML({ text: 'No se pudieron cargar las vías. Revisa la conexión.', retryAttrs: { 'data-kx-retry': true } });
  return `<section class="kx-gchart${kind === 'loading' ? ' is-loading' : ''}" aria-busy="${kind === 'loading'}">${head}${body}</section>`;
}

// Activa el gráfico: pulsar o arrastrar selecciona el grado más cercano; pulsar el mismo o «Quitar» lo retira.
// Flechas ←/→ recorren, Inicio/Fin van a los extremos, Escape quita la selección.
// onSelect(entry|null) al cambiar; onViewRoutes(entry) desde la acción «Ver las N vías».
function kxBindGradeChart(el, stats, { onSelect, onViewRoutes } = {}) {
  if (!el || el._kxGchart || !stats || !stats.entries.length) return null;
  el._kxGchart = true;
  const bars = [...el.querySelectorAll('.kx-gbar')];
  const xls = [...el.querySelectorAll('.kx-gchart-xl')];
  const plot = el.querySelector('.kx-gchart-bars');
  const readout = el.querySelector('.kx-gchart-readout');
  const viewLabel = el.dataset.viewLabel || 'Ver las vías';
  let sel = -1;

  const summary = () => {
    const s = stats;
    const range = s.first === s.last ? s.first.grade : `${s.first.grade}–${s.last.grade}`;
    readout.innerHTML = `<div class="kx-gchart-sum">
      <span title="Del grado más fácil al más difícil"><b>${kxEsc(range)}</b><small>Rango</small></span>
      <span title="La mitad de las vías es de este grado o más fácil"><b>${kxEsc(s.median.grade)}</b><small>50 % hasta</small></span>
      <span title="El grado con más vías y cuántas tiene"><b>${kxEsc(s.mode.grade)} (${s.mode.count})</b><small>Más vías</small></span>
    </div>${s.ungraded ? `<p class="kx-gchart-note">${s.ungraded} ${s.ungraded === 1 ? 'vía' : 'vías'} sin grado, fuera del gráfico</p>` : '<p class="kx-gchart-note">Toca un grado para ver sus vías</p>'}`;
  };

  const detail = (e) => {
    const view = onViewRoutes ? kxButtonHTML({ icon: 'route', label: e.count === 1 ? 'Ver la vía' : `Ver las ${e.count} vías`, variant: 'secondary', size: 'sm', attrs: { 'data-view': e.grade } }) : '';
    readout.innerHTML = `<div class="kx-gchart-sel">
      <span class="kx-gchart-chip"><span class="kx-gchart-sw" style="--c:${kxGradeColor(e.grade)}"></span>${kxEsc(e.grade)}</span>
      <span class="kx-gchart-num"><b>${e.count}</b> ${e.count === 1 ? 'vía' : 'vías'} <span>· ${kxFormatPct(e.pct)} de ${stats.graded}</span></span>
      <button type="button" class="kx-gchart-step" data-clear aria-label="Quitar selección">${kxIcon('x', { size: 18 })}</button>
    </div>
    <div class="kx-gchart-acts">${view}<span class="kx-gchart-nav">
      <button type="button" class="kx-gchart-step" data-step="-1" aria-label="Grado anterior"${sel === 0 ? ' disabled' : ''}>${kxIcon('chevronRight', { size: 18, cls: 'is-prev' })}</button>
      <button type="button" class="kx-gchart-step" data-step="1" aria-label="Grado siguiente"${sel === bars.length - 1 ? ' disabled' : ''}>${kxIcon('chevronRight', { size: 18 })}</button>
    </span></div>`;
  };

  const select = (i, { focus = false } = {}) => {
    sel = i;
    el.classList.toggle('has-sel', i >= 0);
    bars.forEach((b, k) => { b.setAttribute('aria-pressed', String(k === i)); b.tabIndex = (i >= 0 ? k === i : k === 0) ? 0 : -1; });
    xls.forEach((x, k) => x.classList.toggle('is-sel', k === i));
    if (i >= 0) detail(stats.entries[i]); else summary();
    if (focus && i >= 0) bars[i].focus();
    if (onSelect) onSelect(i >= 0 ? stats.entries[i] : null);
  };

  // Pulsar o arrastrar: el grado más cercano al dedo, aunque la barra sea estrecha
  const nearest = (x) => {
    const r = plot.getBoundingClientRect();
    return Math.max(0, Math.min(bars.length - 1, Math.floor(((x - r.left) / r.width) * bars.length)));
  };
  let drag = null;
  plot.addEventListener('pointerdown', (e) => { if (e.button !== 0) return; drag = { x: e.clientX, i: nearest(e.clientX), moved: false }; });
  plot.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (Math.abs(e.clientX - drag.x) > 6) drag.moved = true;
    if (drag.moved) { const i = nearest(e.clientX); if (i !== sel) select(i); }
  });
  const end = (e) => {
    if (!drag) return;
    const i = nearest(e.clientX);
    if (!drag.moved) select(i === sel ? -1 : i);
    drag = null;
  };
  plot.addEventListener('pointerup', end);
  plot.addEventListener('pointercancel', () => { drag = null; });
  plot.addEventListener('click', (e) => { if (e.detail === 0) { const b = e.target.closest('.kx-gbar'); if (b) select(+b.dataset.i === sel ? -1 : +b.dataset.i); } }); // Intro / espacio
  plot.addEventListener('keydown', (e) => {
    const cur = sel >= 0 ? sel : Math.max(0, bars.indexOf(document.activeElement));
    const go = { ArrowRight: cur + 1, ArrowLeft: cur - 1, Home: 0, End: bars.length - 1 }[e.key];
    if (go !== undefined) { e.preventDefault(); select(Math.max(0, Math.min(bars.length - 1, go)), { focus: true }); }
    else if (e.key === 'Escape' && sel >= 0) { e.preventDefault(); const k = sel; select(-1); bars[k].focus(); }
  });
  readout.addEventListener('click', (e) => {
    const step = e.target.closest('[data-step]');
    if (step) { select(Math.max(0, Math.min(bars.length - 1, sel + Number(step.dataset.step)))); return; }
    if (e.target.closest('[data-clear]')) { const k = sel; select(-1); if (bars[k]) bars[k].focus(); return; }
    if (e.target.closest('[data-view]') && onViewRoutes && sel >= 0) onViewRoutes(stats.entries[sel]);
  });

  // Etiquetas: siempre todas los grados; si no caben a tamaño normal, se reducen (.is-dense)
  const fit = () => el.classList.toggle('is-dense', plot.getBoundingClientRect().width / bars.length < 22);
  fit();
  let ro = null;
  if (typeof ResizeObserver === 'function') { ro = new ResizeObserver(fit); ro.observe(plot); }
  summary();
  return { select, clear: () => select(-1), destroy() { if (ro) ro.disconnect(); el._kxGchart = false; } };
}

// ---- Páginas deslizables (ficha de escuela): la pista sigue al dedo y se asienta con una animación suave ----
// stage: zona que recibe el gesto (touch-action: pan-y, así el desplazamiento vertical sigue siendo nativo);
// track: fila de páginas (100 % de ancho cada una). onChange(i) al cambiar de página.
// Solo un gesto claramente horizontal pasa página; uno vertical lo gestiona la hoja o el contenido.
function kxBindPager(stage, track, { count, onChange } = {}) {
  if (!stage || !track || stage._kxPager) return stage && stage._kxPager;
  const n = () => (typeof count === 'function' ? count() : count) || track.children.length;
  const reduce = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let idx = 0, x0 = 0, y0 = 0, t0 = 0, dx = 0, down = false, drag = false, lastSwipe = 0;
  const place = (i, extra = 0) => { track.style.transform = `translate3d(calc(${-i * 100}% + ${extra}px), 0, 0)`; };
  const go = (i, { animate = true } = {}) => {
    i = Math.max(0, Math.min(n() - 1, i));
    track.style.transition = animate && !reduce() ? 'transform 0.42s cubic-bezier(0.22, 0.9, 0.28, 1)' : 'none';
    place(i);
    if (i !== idx) { idx = i; if (onChange) onChange(i); }
  };
  stage.addEventListener('pointerdown', (e) => {
    if (e.button != null && e.button > 0) return;
    if (e.target.closest('[data-kx-nopage]')) return;
    down = true; drag = false; dx = 0; x0 = e.clientX; y0 = e.clientY; t0 = performance.now();
  });
  stage.addEventListener('pointermove', (e) => {
    if (!down) return;
    const mx = e.clientX - x0, my = e.clientY - y0;
    if (!drag) {
      if (Math.abs(my) > 10 && Math.abs(my) > Math.abs(mx)) { down = false; return; }   // gesto vertical
      if (Math.abs(mx) < 10 || Math.abs(mx) < Math.abs(my) * 1.3) return;
      drag = true; track.style.transition = 'none';
      try { stage.setPointerCapture(e.pointerId); } catch (_) {}
    }
    const last = n() - 1;
    dx = (idx === 0 && mx > 0) || (idx === last && mx < 0) ? mx * 0.3 : mx;   // rebote en los extremos
    place(idx, dx);
  });
  const end = () => {
    if (!down) return;
    down = false;
    if (!drag) return;
    drag = false; lastSwipe = Date.now();
    const w = stage.clientWidth || 1, v = dx / Math.max(1, performance.now() - t0);
    let target = idx;
    if (dx < -w * 0.18 || v < -0.4) target = idx + 1;
    else if (dx > w * 0.18 || v > 0.4) target = idx - 1;
    go(target);
  };
  stage.addEventListener('pointerup', end);
  stage.addEventListener('pointercancel', end);
  // Solo la captura propia: la implícita de un hijo (al tocar un botón) se pierde al empezar a arrastrar
  stage.addEventListener('lostpointercapture', (e) => { if (e.target === stage) end(); });
  // Tras deslizar no se activa lo que quedó bajo el dedo
  stage.addEventListener('click', (e) => { if (Date.now() - lastSwipe < 350) { e.stopPropagation(); e.preventDefault(); } }, true);
  // Teclado: flechas con el foco en la zona de páginas
  stage.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea, select, [role="group"]')) return;
    if (e.key === 'ArrowRight') { go(idx + 1); } else if (e.key === 'ArrowLeft') { go(idx - 1); }
  });
  const api = { go, current: () => idx };
  stage._kxPager = api;
  return api;
}

// ============================================
// HOJAS INFERIORES DEL MAPA (móvil)
// Dos alturas reales (resumen y expandida) movidas con el gesto, o una sola.
// La hoja mide siempre su altura completa y se desplaza con translateY;
// el pie de acciones se contrarresta para quedar siempre a la vista.
// ============================================

// Decide la posición final tras soltar. y: desplazamiento actual (px, 0 = expandida);
// vy: velocidad (px/ms, positiva hacia abajo); H: alto de la hoja; summaryY: posición del resumen o null
function kxResolveSheetSnap({ y, vy = 0, H, summaryY = null }) {
  const hasSummary = summaryY !== null && summaryY > 0;
  const lowest = hasSummary ? summaryY : 0;
  const projected = y + vy * 180;
  const closeAt = lowest + Math.min(120, Math.max(48, (H - lowest) * 0.45));
  if (projected > closeAt || (vy > 0.9 && y > lowest + 12)) return 'closed';
  if (!hasSummary) return 'expanded';
  if (vy < -0.5) return 'expanded';
  if (vy > 0.5 && y > 12) return 'summary';
  return projected < summaryY / 2 ? 'expanded' : 'summary';
}

// Altura visible del resumen: hasta el final del elemento «peek» más el pie, con límites
function kxSummaryPeek({ peekBottom, footH = 0, vh, min = 220, maxRatio = 0.62 }) {
  return Math.round(Math.min(vh * maxRatio, Math.max(min, peekBottom + footH + 12)));
}

// Aviso de que la hoja tiene más contenido debajo del pie fijo: añade .has-more a la hoja mientras
// el contenido se puede seguir desplazando (no en la altura de resumen, donde no se desplaza).
function kxBindScrollCue(sheetEl) {
  const body = sheetEl && sheetEl.querySelector('.kx-msheet-body');
  if (!body || sheetEl._kxCue) return null;
  const sync = () => {
    const more = !sheetEl.classList.contains('is-summary') && body.scrollTop + body.clientHeight < body.scrollHeight - 1;
    sheetEl.classList.toggle('has-more', more);
  };
  sheetEl._kxCue = sync;
  body.addEventListener('scroll', sync, { passive: true });
  if (typeof ResizeObserver === 'function') { const ro = new ResizeObserver(sync); ro.observe(body); [...body.children].forEach(c => ro.observe(c)); }
  if (typeof MutationObserver === 'function') new MutationObserver(sync).observe(sheetEl, { attributes: true, attributeFilter: ['class'] });
  sync();
  return sync;
}

const KXMapSheet = (() => {
  const sheets = new Set();
  let escBound = false;

  const reduceMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const overlay = () => document.getElementById('bottom-sheet-overlay');
  const anyOpen = () => [...sheets].find(s => s.state !== 'hidden');

  function syncChrome() {
    const open = anyOpen();
    const ov = overlay();
    document.body.classList.toggle('kx-map-sheet-open', !!open);
    if (!ov) return;
    if (open) {
      ov.classList.remove('hidden');
      ov.classList.toggle('is-peek', open.state === 'summary');
      requestAnimationFrame(() => ov.classList.add('visible'));
    } else {
      ov.classList.remove('visible', 'is-peek');
      clearTimeout(ov._kxHideT);
      ov._kxHideT = setTimeout(() => { if (!anyOpen()) ov.classList.add('hidden'); }, 320);
    }
  }

  function bindGlobal() {
    if (escBound) return;
    escBound = true;
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      // Un panel o modal por encima (mensajes, notificar, ascenso…) tiene prioridad
      if (document.body.classList.contains('kx-sheet-open')) return;
      if (document.querySelector('.modal:not(.hidden), .ml-contribute-overlay, .sector-image-viewer:not(.hidden)')) return;
      const open = anyOpen();
      if (open) { e.preventDefault(); open.requestClose(); }
    });
    const ov = overlay();
    if (ov) ov.addEventListener('click', () => { const open = anyOpen(); if (open) open.requestClose(); });
  }

  // expandable(): si devuelve false, la hoja se queda en el resumen (no se puede subir a la vista completa)
  function create(el, { snaps = ['expanded'], peek = null, peekMax, initial = null, expandable = null, onRequestClose = null, onStateChange = null } = {}) {
    if (!el) return null;
    bindGlobal();
    el.classList.add('kx-msheet');
    if (snaps.includes('summary')) el.classList.add('kx-msheet-fixed');
    const body = () => el.querySelector('.kx-msheet-body');
    const foot = () => el.querySelector('.kx-msheet-foot');
    const grip = () => el.querySelector('.kx-msheet-grip');

    const sheet = {
      el, state: 'hidden', summaryY: null, capped: false, H: 0, y: 0,
      requestClose() { if (onRequestClose) onRequestClose(); else sheet.close(); },
      open, close, setState, measure, refresh: () => { measure(); if (sheet.state !== 'hidden') place(sheet.state === 'summary' ? sheet.summaryY : 0, false); }
    };
    sheets.add(sheet);
    const canExpand = () => sheet.summaryY === null || !expandable || !!expandable();

    function measure() {
      sheet.H = el.offsetHeight || window.innerHeight * 0.9;
      sheet.summaryY = null;
      sheet.capped = false;
      if (!snaps.includes('summary')) return;
      const peekEl = typeof peek === 'function' ? peek() : (peek ? el.querySelector(peek) : null);
      if (!peekEl) return;
      const b = body();
      const prevScroll = b ? b.scrollTop : 0;
      if (b) b.scrollTop = 0;
      const peekBottom = peekEl.getBoundingClientRect().bottom - el.getBoundingClientRect().top;
      if (b) b.scrollTop = prevScroll;
      const f = foot();
      const footH = f ? f.offsetHeight : 0;
      const visible = kxSummaryPeek({ peekBottom, footH, vh: window.innerHeight, ...(peekMax ? { maxRatio: peekMax } : {}) });
      sheet.capped = peekBottom + footH + 12 > visible;   // el contenido no cabe entero en el resumen
      const y = sheet.H - visible;
      // Si el resumen apenas se diferencia de la vista completa, la hoja tiene una sola altura; con bloqueo
      // (expandable) se respeta la altura exacta del contenido para no dejar hueco bajo él
      sheet.summaryY = y > 72 || (expandable && y > 0) ? y : null;
    }

    // Coloca la hoja en y (px). El pie se mantiene en el borde inferior visible
    function place(y, animate) {
      sheet.y = y;
      el.classList.toggle('is-dragging', !animate);
      const lowest = sheet.summaryY ?? 0;
      el.style.setProperty('--kx-sheet-y', `${Math.round(y)}px`);
      el.style.setProperty('--kx-foot-y', `${-Math.round(Math.min(Math.max(y, 0), lowest))}px`);
    }

    function setState(next, { animate = true } = {}) {
      if (next === 'summary' && sheet.summaryY === null) next = 'expanded';
      if (next === 'expanded' && !canExpand()) next = 'summary';
      const prev = sheet.state;
      sheet.state = next;
      el.classList.toggle('snap-summary', next === 'summary');
      el.classList.toggle('snap-expanded', next === 'expanded');
      el.classList.toggle('is-summary', next === 'summary');
      if (next === 'summary' && body()) body().scrollTop = 0;
      const g = grip();
      if (g) {
        const single = sheet.summaryY === null || !canExpand();   // una sola altura: el tirador solo indica que se puede arrastrar
        g.classList.toggle('is-single', single);
        g.tabIndex = single ? -1 : 0;
        if (single) {
          g.removeAttribute('aria-expanded');
          g.setAttribute('aria-label', 'Arrastra hacia abajo para cerrar');
        } else {
          g.setAttribute('aria-expanded', String(next === 'expanded'));
          g.setAttribute('aria-label', next === 'expanded' ? 'Reducir ficha' : 'Ampliar ficha');
        }
      }
      place(next === 'summary' ? sheet.summaryY : 0, animate && !reduceMotion());
      syncChrome();
      if (prev !== next && onStateChange) onStateChange(next, prev);
    }

    function open(state = initial || snaps[0]) {
      clearTimeout(el._kxHideT);
      el.classList.remove('hidden', 'is-closing');
      if (sheet.state === 'hidden') {
        // Entrada desde fuera de la pantalla
        el.classList.add('is-dragging');
        el.style.setProperty('--kx-sheet-y', `${window.innerHeight}px`);
        el.style.setProperty('--kx-foot-y', '0px');
        void el.offsetHeight;
      }
      measure();
      requestAnimationFrame(() => setState(state));
    }

    function close() {
      if (sheet.state === 'hidden') return;
      const prev = sheet.state;
      sheet.state = 'hidden';
      el.classList.remove('snap-summary', 'snap-expanded', 'is-summary');
      el.classList.add('is-closing');
      place(Math.max(sheet.H, window.innerHeight * 0.5) + 24, !reduceMotion());
      syncChrome();
      clearTimeout(el._kxHideT);
      el._kxHideT = setTimeout(() => {
        if (sheet.state === 'hidden') { el.classList.add('hidden'); el.classList.remove('is-closing'); }
      }, reduceMotion() ? 0 : 320);
      if (onStateChange) onStateChange('hidden', prev);
    }

    // ---- Gestos ----
    let g = null;   // { x0, y0, t0, startY, mode: null|'sheet'|'native', samples }
    const isInteractive = t => t.closest('input, select, textarea, [data-kx-nodrag]');

    function begin(x, y, target) {
      if (sheet.state === 'hidden') return;
      g = { x0: x, y0: y, t0: performance.now(), startY: sheet.y, mode: null, target, samples: [[performance.now(), y]] };
    }

    function move(x, y, e) {
      if (!g) return;
      const dx = x - g.x0, dy = y - g.y0;
      if (!g.mode) {
        if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
        if (Math.abs(dx) > Math.abs(dy)) { g.mode = 'native'; return; }   // deslizamiento horizontal (variantes, gráficos)
        const inDrag = !!g.target.closest('.kx-msheet-drag, .kx-msheet-foot');
        const b = body();
        const atTop = !b || b.scrollTop <= 0;
        if (isInteractive(g.target) && !inDrag) g.mode = 'native';
        else if (inDrag || sheet.state === 'summary') g.mode = 'sheet';
        else g.mode = (atTop && dy > 0) ? 'sheet' : 'native';
        if (g.mode === 'sheet') { g.y0 = y; g.startY = sheet.y; }
      }
      if (g.mode !== 'sheet') return;
      if (e && e.cancelable) e.preventDefault();
      let next = g.startY + (y - g.y0);
      const top = canExpand() ? 0 : sheet.summaryY;   // sin vista completa, el tope es el resumen
      if (next < top) next = top - Math.sqrt(top - next) * 2;   // resistencia por encima del tope
      place(next, false);
      g.samples.push([performance.now(), y]);
      if (g.samples.length > 5) g.samples.shift();
    }

    function end() {
      if (!g) return;
      const cur = g; g = null;
      if (cur.mode !== 'sheet') {
        // Toque sin arrastre en el tirador o en la cabecera del resumen: alterna la altura
        if (!cur.mode && performance.now() - cur.t0 < 350 && !cur.target.closest('button:not(.kx-msheet-grip), a, input')) {
          if (sheet.summaryY !== null && canExpand() && (cur.target.closest('.kx-msheet-grip') || (sheet.state === 'summary' && cur.target.closest('.kx-msheet-drag')))) {
            setState(sheet.state === 'summary' ? 'expanded' : 'summary');
          }
        }
        return;
      }
      const s = cur.samples;
      const [t1, y1] = s[0], [t2, y2] = s[s.length - 1];
      const vy = t2 > t1 ? (y2 - y1) / (t2 - t1) : 0;
      const target = kxResolveSheetSnap({ y: sheet.y, vy, H: sheet.H, summaryY: sheet.summaryY });
      if (target === 'closed') sheet.requestClose();
      else setState(target);
    }

    el.addEventListener('touchstart', e => { if (e.touches.length === 1) begin(e.touches[0].clientX, e.touches[0].clientY, e.target); else g = null; }, { passive: true });
    el.addEventListener('touchmove', e => { if (g && e.touches.length === 1) move(e.touches[0].clientX, e.touches[0].clientY, e); }, { passive: false });
    el.addEventListener('touchend', end, { passive: true });
    el.addEventListener('touchcancel', () => { if (g && g.mode === 'sheet') { g = null; setState(sheet.state); } else g = null; }, { passive: true });

    // Ratón (escritorio estrecho o pruebas): solo desde el tirador y la cabecera
    el.addEventListener('pointerdown', e => {
      if (e.pointerType === 'touch' || e.button !== 0 || !e.target.closest('.kx-msheet-drag')) return;
      begin(e.clientX, e.clientY, e.target);
      const mv = ev => move(ev.clientX, ev.clientY, ev);
      const up = () => { document.removeEventListener('pointermove', mv); document.removeEventListener('pointerup', up); end(); };
      document.addEventListener('pointermove', mv);
      document.addEventListener('pointerup', up);
    });

    // Teclado: el tirador es un botón
    el.addEventListener('click', e => {
      if (e.target.closest('[data-kx-close]')) { e.preventDefault(); sheet.requestClose(); return; }
      const gripBtn = e.target.closest('.kx-msheet-grip');
      if (gripBtn && e.detail === 0 && sheet.summaryY !== null && canExpand()) setState(sheet.state === 'summary' ? 'expanded' : 'summary');
    });

    // El contenido asíncrono (gráficos, votos) cambia la altura del resumen
    if (typeof ResizeObserver === 'function') {
      let raf = 0;
      const ro = new ResizeObserver(() => {
        if (sheet.state === 'hidden' || g) return;
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => { measure(); setState(sheet.state); });
      });
      const b = body();
      if (b) [...b.children].forEach(c => ro.observe(c));
      ro.observe(el);
    }
    window.addEventListener('resize', () => { if (sheet.state !== 'hidden') { measure(); setState(sheet.state, { animate: false }); } });

    return sheet;
  }

  return { create, anyOpen };
})();

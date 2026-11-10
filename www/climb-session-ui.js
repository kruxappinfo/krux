// ================== KRUX — SESIONES DE ESCALADA: INTERFAZ ==================
// Botón flotante, tarjeta de sesión activa, hoja de inicio, panel de sesión, registro de vías, resumen.
// Reutiliza los componentes compartidos de map-ui.js y la hoja inferior KXMapSheet (en escritorio, la misma
// hoja se muestra como modal centrado por CSS). La lógica y los datos están en climb-session.js.

Object.assign(KX_ICON_PATHS, {
  timer: '<line x1="10" x2="14" y1="2" y2="2"/><line x1="12" x2="15" y1="14" y2="11"/><circle cx="12" cy="14" r="8"/>',
  play: '<polygon points="6 3 20 12 6 21 6 3"/>',
  pause: '<rect x="14" y="4" width="4" height="16" rx="1"/><rect x="6" y="4" width="4" height="16" rx="1"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  circleCheck: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  activity: '<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/>'
});

const KXS_STYLE_LABEL = { redpoint: 'Redpoint', onsight: 'A vista', flash: 'Flash', toprope: 'Top rope', project: 'Proyecto' };

// ============================================
// FORMATOS (puros)
// ============================================
const kxsPlural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const kxsTime = (ms) => new Date(ms).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
const kxsDate = (ms) => new Date(ms).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' }).replace('.', '');
function kxsFormatDistance(m) {
  return m >= 1000 ? `${(m / 1000).toFixed(1).replace('.', ',')} km` : `${Math.round(m)} m`;
}

// Fila de una vía registrada (panel y resumen): grado, nombre, sector · hora y resultado
function kxsEntryRowHTML(e, { index = -1, action = false } = {}) {
  const send = e.style !== 'project';
  const grade = e.grade && e.grade !== '?' ? e.grade : '';
  const tag = kxTagHTML({ text: KXS_STYLE_LABEL[e.style] || '', tone: send ? 'forest' : 'neutral' });
  const sub = [e.sector, kxsTime(e.at)].filter(Boolean).join(' · ');
  const body = `<span class="kxs-grade${grade ? '' : ' is-none'}"${grade ? ` style="--c:${kxGradeColor(grade)}"` : ''}>${kxEsc(grade || '—')}</span>
    <span class="kxs-entry-text"><strong>${kxEsc(e.routeName || 'Vía')}</strong><small>${kxEsc(sub)}</small></span>${tag}`;
  return action
    ? `<button type="button" class="kxs-entry" data-kxs="goto" data-i="${index}">${body}</button>`
    : `<div class="kxs-entry">${body}</div>`;
}

// Cuerpo del resumen de una sesión finalizada (también el detalle de Actividad)
function kxsSummaryBodyHTML(session, entries) {
  const st = session.stats || kxsStats(entries);
  const empty = (tile) => tile.replace('class="kx-stat"', 'class="kx-stat kxs-stat-empty"');
  const tile = (icon, value, label) => (value ? kxStatTileHTML({ icon, value, label }) : empty(kxStatTileHTML({ icon, value: 'Sin datos', label })));
  const gps = session.gps || {};
  const kcal = kxsEstimateKcal(session.activeMs || kxsActiveMs(session));
  const hasDist = gps.enabled && gps.distanceM > 0;
  const tiles = [
    kxStatTileHTML({ icon: 'clock', value: kxsFormatDuration(session.activeMs || kxsActiveMs(session)), label: 'Duración' }),
    kxStatTileHTML({ icon: 'mountain', value: String(st.routes), label: 'Vías registradas' }),
    tile('arrowUpDown', st.meters > 0 ? `${st.meters} m` : '', 'Metros escalados'),
    kxStatTileHTML({ icon: 'circleCheck', value: String(st.sends), label: 'Encadenadas' }),
    tile('flame', kcal > 0 ? `${kcal} kcal` : '', 'Calorías (est.)'),
    tile('route', hasDist ? kxsFormatDistance(gps.distanceM) : '', gps.enabled ? 'Recorrido (GPS)' : 'GPS no utilizado')
  ];
  const notes = [];
  if (kcal > 0) notes.push('Las calorías son una estimación a partir del tiempo activo (referencia de 70 kg); no son un dato medido.');
  if (st.meters > 0) notes.push('Los metros suman la longitud de las vías encadenadas (también a vista, flash y top rope); los intentos no cuentan.');
  if (st.meters > 0 && st.metersUnknown > 0) notes.push(`${kxsPlural(st.metersUnknown, 'vía encadenada no tiene', 'vías encadenadas no tienen')} longitud registrada y no suma metros.`);
  const note = notes.map(n => `<p class="kxs-note">${kxEsc(n)}</p>`).join('');
  const chart = st.routes > 0
    ? `<section class="kxs-chart" id="kxs-chart">
        <div class="kxs-chart-head"><h3 class="kxs-chart-title">Vías de la sesión</h3>
          <button type="button" class="kxs-chart-more" data-kxs="to-list" aria-label="Ver la lista de vías">${st.routes}${kxIcon('chevronRight', { size: 18 })}</button></div>
        ${kxGradeChartHTML(kxGradeStats(st.gradeCounts, { ungraded: st.ungraded }), { id: 'kxs-gchart', title: 'Vías de la sesión' })}</section>` : '';
  const list = entries.length
    ? kxSectionHTML({ title: 'Lista de vías', meta: String(entries.length), id: 'kxs-list', body: `<div class="kxs-entries">${entries.map(e => kxsEntryRowHTML(e)).join('')}</div>` })
    : `<p class="kxs-empty">No se registró ninguna vía en esta sesión.</p>`;
  return `<div class="kxs-stats kxs-stats--sum">${tiles.join('')}</div>${chart}${note}${list}`;
}

// ============================================
// INTERFAZ
// ============================================
const KruxSessionUI = (() => {
  let el = null, sheet = null, view = null, ctx = {};
  let fab = null, card = null, tickTimer = 0, trackDrawn = 0;
  let followed = null;                      // [{ id, name }] (se carga al abrir el selector de compañeros)
  let gpsToggle = false;

  const S = () => window.KruxSession;
  const toast = (msg, type = 'info') => { if (typeof showToast === 'function') showToast(msg, type); };
  const signedIn = () => !!(typeof firebase !== 'undefined' && firebase.auth && firebase.auth().currentUser);

  // ---------- Hoja ----------
  function ensureSheet() {
    if (el) return;
    el = document.createElement('div');
    el.id = 'kx-sess-sheet';
    el.className = 'bottom-sheet hidden';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-labelledby', 'kx-sess-title');
    el.innerHTML = '<div class="kx-msheet-drag" id="kx-sess-drag"></div><div class="bottom-sheet-content kx-msheet-body" id="kx-sess-body"></div><div class="kx-msheet-foot" id="kx-sess-foot"></div>';
    document.body.appendChild(el);
    sheet = KXMapSheet.create(el, {
      snaps: ['expanded'],
      onStateChange: (s) => document.body.classList.toggle('kx-sess-open', s !== 'hidden')
    });
    el.addEventListener('click', onClick);
  }

  function isOpen() { return !!(sheet && sheet.state !== 'hidden'); }
  function close() { if (sheet) sheet.close(); view = null; }

  function setView(name, data = {}) {
    ensureSheet();
    view = name; ctx = data;
    const v = VIEWS[name](data);
    const body = el.querySelector('#kx-sess-body');
    const keep = body.scrollTop;
    el.querySelector('#kx-sess-drag').innerHTML = v.head
      ? `<button type="button" class="kx-msheet-grip" aria-label="Ampliar ficha" aria-expanded="false"></button>${v.head}`
      : kxSheetDragHTML({ title: v.title, titleId: 'kx-sess-title', metaHTML: v.meta || '', asideHTML: v.aside || '' });
    el.dataset.view = name;   // la hoja reescribe sus clases al cambiar de altura: la vista va en un atributo
    body.innerHTML = v.body;
    el.querySelector('#kx-sess-foot').innerHTML = v.foot || '';
    el.querySelector('#kx-sess-foot').hidden = !v.foot;
    body.scrollTop = data.keepScroll ? keep : 0;
    if (v.after) v.after(el);
    if (!isOpen()) sheet.open('expanded'); else sheet.refresh();
    tick();
  }

  // ---------- Vistas ----------
  const VIEWS = {
    start() {
      const gps = gpsToggle;
      return {
        title: 'Nueva sesión',
        body: `<p class="kxs-lead">Registra tu jornada de escalada y guarda tus ascensos sobre el mapa.</p>
          <div class="kxs-type" aria-current="true">
            <span class="kxs-type-ic">${kxIcon('mountain', { size: 24 })}</span>
            <span class="kxs-type-text"><strong>Escalada en roca</strong><small>Registra las vías que vas escalando en sectores reales.</small></span>
            <span class="kxs-type-ok">${kxIcon('check', { size: 16, stroke: 3 })}</span>
          </div>
          <div class="kxs-switchrow">
            <span class="kxs-switchrow-ic">${kxIcon('mapPin', { size: 22 })}</span>
            <span class="kxs-type-text"><strong id="kxs-gps-label">Seguimiento GPS</strong><small>Opcional. Guarda tu recorrido y calcula la distancia.</small></span>
            <button type="button" class="kxs-switch" role="switch" aria-checked="${gps}" aria-labelledby="kxs-gps-label" data-kxs="gps"><span></span></button>
          </div>
          <p class="kxs-note" id="kxs-gps-note"${gps ? '' : ' hidden'}>Al iniciar, KRUX te pedirá permiso de ubicación. Funciona solo con la app abierta; si lo deniegas, la sesión sigue igual con cronómetro y vías.</p>`,
        foot: kxButtonHTML({ icon: 'play', label: 'Iniciar sesión', size: 'lg', attrs: { 'data-kxs': 'start' } })
      };
    },

    active({ paused = S().isPaused() } = {}) {
      const item = S().get();
      if (!item) return VIEWS.start();
      const s = item.session, st = S().stats();
      const school = s.schoolName || '';
      const gpsLine = s.gps.enabled
        ? (s.gps.status === 'denied' ? 'GPS sin permiso de ubicación'
          : s.gps.status === 'error' ? 'GPS no disponible'
          : `GPS activo${s.gps.distanceM > 0 ? ' · ' + kxsFormatDistance(s.gps.distanceM) : ''}`)
        : '';
      const entries = item.entries.slice().reverse();
      const pending = S().pendingCount();
      return {
        title: paused ? 'Sesión en pausa' : 'Sesión en curso',
        meta: `<span class="kxs-live${paused ? ' is-paused' : ''}"></span>${kxEsc(school || 'Escalada en roca')}`,
        body: `<div class="kxs-clock${paused ? ' is-paused' : ''}" data-kxs-clock aria-label="Tiempo transcurrido">${kxsFormatClock(S().elapsedMs())}</div>
          <div class="kxs-stats kxs-stats--3">
            ${kxStatTileHTML({ icon: 'mountain', value: String(st.routes), label: st.routes === 1 ? 'Vía' : 'Vías' })}
            ${st.meters > 0 ? kxStatTileHTML({ icon: 'ruler', value: `${st.meters} m`, label: 'Escalados' }) : kxStatTileHTML({ icon: 'circleCheck', value: String(st.sends), label: 'Encadenadas' })}
            ${st.meters > 0 ? kxStatTileHTML({ icon: 'circleCheck', value: String(st.sends), label: 'Encadenadas' }) : kxStatTileHTML({ icon: 'calendarClock', value: kxsTime(s.startedAt), label: 'Inicio' })}
          </div>
          ${gpsLine ? `<p class="kxs-gps${s.gps.status === 'denied' || s.gps.status === 'error' ? ' is-warn' : ''}">${kxIcon('mapPin', { size: 16 })}<span data-kxs-gps>${kxEsc(gpsLine)}</span></p>` : ''}
          ${pending ? `<p class="kxs-gps">${kxIcon('wifiOff', { size: 16 })}<span>${kxEsc(kxsPlural(pending, 'registro pendiente', 'registros pendientes'))} de sincronizar; se subirán al volver la conexión.</span></p>` : ''}
          ${kxSectionHTML({
            title: 'Vías registradas', meta: String(st.routes), cls: 'kxs-sec',
            body: entries.length
              ? `<div class="kxs-entries">${entries.map((e, i) => kxsEntryRowHTML(e, { index: item.entries.length - 1 - i, action: true })).join('')}</div>`
              : '<p class="kxs-empty">Aún no has registrado ninguna vía. Abre una vía en el mapa y pulsa «Registrar ascenso».</p>'
          })}`,
        foot: kxButtonHTML({ icon: paused ? 'play' : 'pause', label: paused ? 'Reanudar' : 'Pausar', variant: 'secondary', size: 'lg', attrs: { 'data-kxs': 'toggle' } })
          + kxButtonHTML({ icon: 'circleCheck', label: 'Finalizar', size: 'lg', attrs: { 'data-kxs': 'confirm-finish' } })
      };
    },

    confirm() {
      const n = S().stats() ? S().stats().routes : 0;
      return {
        title: '¿Finalizar la sesión?',
        body: `<p class="kxs-lead">Se detendrá el cronómetro${S().get() && S().get().session.gps.enabled ? ' y el seguimiento GPS' : ''} y verás el resumen de la jornada.</p>
          <p class="kxs-note">${n ? `Tus ${kxsPlural(n, 'vía', 'vías')} ya están guardadas como ascensos y se conservan.` : 'No has registrado ninguna vía: la sesión se guardará igualmente en tu historial.'}</p>`,
        foot: kxButtonHTML({ label: 'Seguir en la sesión', variant: 'secondary', size: 'lg', attrs: { 'data-kxs': 'back' } })
          + kxButtonHTML({ label: 'Finalizar sesión', size: 'lg', attrs: { 'data-kxs': 'finish' } })
      };
    },

    register({ info, result = 'send', style = 'redpoint', companions = [] }) {
      const grade = info.grade && info.grade !== '?' ? info.grade : '';
      const peerLabel = companions.length ? kxsPlural(companions.length, 'compañero', 'compañeros') : 'Añadir compañeros';
      return {
        title: info.routeName || 'Vía',
        meta: kxEsc([info.sector, info.schoolName].filter(Boolean).join(' · ')),
        aside: grade ? `<span class="kxs-grade kxs-grade--lg" style="--c:${kxGradeColor(grade)}">${kxEsc(grade)}</span>` : '',
        body: `<div class="kxs-field"><h3 class="kxs-label">Resultado</h3>
            ${kxSegmentedHTML({ items: [{ value: 'send', label: 'Encadenada' }, { value: 'project', label: 'Proyecto' }], value: result, label: 'Resultado', attrs: { id: 'kxs-result' } })}</div>
          <div class="kxs-field" id="kxs-style-field"${result === 'project' ? ' hidden' : ''}><h3 class="kxs-label">Estilo</h3>
            ${kxSegmentedHTML({ items: ['redpoint', 'onsight', 'flash', 'toprope'].map(v => ({ value: v, label: KXS_STYLE_LABEL[v] })), value: style, label: 'Estilo', attrs: { id: 'kxs-style' } })}</div>
          <div class="kxs-field"><h3 class="kxs-label">Compañeros</h3>
            ${kxInfoRowHTML({ icon: 'users', label: peerLabel, action: true, attrs: { 'data-kxs': 'peers', 'aria-expanded': 'false' } })}
            <div class="kxs-peers" id="kxs-peers" hidden></div></div>`,
        foot: kxButtonHTML({ icon: 'check', label: 'Registrar ascenso', size: 'lg', attrs: { 'data-kxs': 'register' } }),
        after(root) {
          kxBindSegmented(root.querySelector('#kxs-result'), (v) => {
            ctx.result = v;
            root.querySelector('#kxs-style-field').hidden = v === 'project';
            sheet.refresh();
          });
          kxBindSegmented(root.querySelector('#kxs-style'), (v) => { ctx.style = v; });
        }
      };
    },

    summary({ item, history = false }) {
      const s = item.session;
      return {
        // Cabecera centrada con cierre a la izquierda y bloque de portada (icono, título, escuela · fecha)
        head: `<header class="kxs-sumhead"><button type="button" class="kx-close" data-kx-close aria-label="Cerrar">${kxIcon('x', { size: 20, stroke: 2 })}</button>
          <h2 class="kxs-sumhead-title" id="kx-sess-title">Sesión de roca</h2><span aria-hidden="true"></span></header>`,
        body: `<div class="kxs-hero"><h3 class="kxs-hero-title">${kxEsc(history ? (s.schoolName || 'Sesión de escalada') : 'Sesión completada')}</h3>
          <p class="kxs-hero-meta">${kxEsc([history ? '' : s.schoolName, kxsDate(s.startedAt)].filter(Boolean).join(' · '))}</p></div>
          ${kxsSummaryBodyHTML(s, item.entries)}`,
        foot: history
          ? kxButtonHTML({ label: 'Cerrar', variant: 'secondary', size: 'lg', attrs: { 'data-kx-close': true } })
          : kxButtonHTML({ icon: 'chartBar', label: 'Ver en Actividad', size: 'lg', attrs: { 'data-kxs': 'to-activity' } })
            + kxButtonHTML({ label: 'Cerrar', variant: 'secondary', size: 'lg', attrs: { 'data-kx-close': true } }),
        after(root) {
          const chart = root.querySelector('#kxs-gchart');
          const st = s.stats || kxsStats(item.entries);
          if (chart) kxBindGradeChart(chart, kxGradeStats(st.gradeCounts, { ungraded: st.ungraded }), {});
        }
      };
    }
  };

  // ---------- Acciones ----------
  const ACTIONS = {
    gps(btn) {
      gpsToggle = btn.getAttribute('aria-checked') !== 'true';
      btn.setAttribute('aria-checked', String(gpsToggle));
      const note = el.querySelector('#kxs-gps-note');
      if (note) note.hidden = !gpsToggle;
      sheet.refresh();
    },

    async start(btn) {
      if (btn.getAttribute('aria-busy') === 'true') return;
      btn.setAttribute('aria-busy', 'true');
      try {
        const session = await S().start({ gps: gpsToggle });
        gpsToggle = false;
        close();
        if (session.gps.enabled && session.gps.status === 'denied') toast('Sin permiso de ubicación: la sesión sigue sin GPS.', 'info');
        else toast('Sesión iniciada', 'success');
      } catch (e) {
        btn.removeAttribute('aria-busy');
        if (e && e.code === 'exists') { setView('active'); return; }
        if (e && e.code === 'remote-active') {
          // Ya hay una sesión en curso en otro dispositivo: se continúa esa en lugar de crear otra
          await S().adopt();
          if (S().isActive()) { setView('active'); toast('Ya tenías una sesión en curso en otro dispositivo: la has retomado aquí.', 'info'); return; }
        }
        toast('Inicia sesión para registrar tus sesiones', 'info');
      }
    },

    toggle() { if (S().isPaused()) S().resume(); else S().pause(); },
    'confirm-finish'() { setView('confirm'); },
    back() { setView('active'); },

    async finish(btn) {
      if (btn.getAttribute('aria-busy') === 'true') return;
      btn.setAttribute('aria-busy', 'true');
      const item = await S().finish();
      if (!item) { close(); return; }
      setView('summary', { item });
    },

    goto(btn) {
      const item = S().get();
      const entry = item && item.entries[Number(btn.dataset.i)];
      if (!entry) return;
      close();
      const prev = typeof mlCurrentSchool !== 'undefined' ? mlCurrentSchool : null;
      if (prev !== entry.schoolId) toast(`Abre ${entry.schoolName || 'la escuela'} en el mapa para ver la vía`, 'info');
      else if (typeof mlHighlightRouteOnMap === 'function') mlHighlightRouteOnMap(entry.routeId);
    },

    async peers(btn) {
      const box = el.querySelector('#kxs-peers');
      const open = box.hidden;
      box.hidden = !open;
      btn.setAttribute('aria-expanded', String(open));
      if (open && !box.dataset.ready) {
        box.innerHTML = kxSkeletonHTML('rows');
        sheet.refresh();
        const list = await loadFollowed();
        box.dataset.ready = '1';
        box.innerHTML = list.length
          ? list.map(u => `<label class="kxs-peer"><input type="checkbox" value="${kxEsc(u.id)}" data-kxs-peer ${ctx.companions.includes(u.id) ? 'checked' : ''}><span>${kxEsc(u.name)}</span></label>`).join('')
          : '<p class="kxs-empty">Aún no sigues a nadie. Podrás elegir compañeros entre las personas que sigues.</p>';
      }
      sheet.refresh();
    },

    async register(btn) {
      if (btn.getAttribute('aria-busy') === 'true') return;
      btn.setAttribute('aria-busy', 'true');
      const style = ctx.result === 'project' ? 'project' : (ctx.style || 'redpoint');
      const entry = await S().addAscent({ ...ctx.info, style, companions: ctx.companions });
      close();
      if (!entry) { toast('La sesión ya no está activa. El ascenso no se ha registrado.', 'error'); return; }
      toast('Ascenso registrado en la sesión', 'success');
    },

    'to-list'() {
      const list = el.querySelector('#kxs-list');
      if (list) list.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
    'to-activity'() {
      close();
      const nav = document.getElementById('nav-activity-btn');
      if (nav) nav.click();
      const id = ctx.item && ctx.item.session.id;
      if (id && window.KruxActivity && KruxActivity.openClimbSession) setTimeout(() => KruxActivity.openClimbSession(id), 350);
    }
  };

  function onClick(e) {
    const peer = e.target.closest('[data-kxs-peer]');
    if (peer) {
      const set = new Set(ctx.companions);
      if (peer.checked) { if (set.size >= 10) { peer.checked = false; toast('Máximo 10 compañeros', 'info'); return; } set.add(peer.value); } else set.delete(peer.value);
      ctx.companions = [...set];
      const row = el.querySelector('[data-kxs="peers"] .kx-irow-label');
      if (row) row.textContent = ctx.companions.length ? kxsPlural(ctx.companions.length, 'compañero', 'compañeros') : 'Añadir compañeros';
      return;
    }
    const a = e.target.closest('[data-kxs]');
    if (a && ACTIONS[a.dataset.kxs]) { e.preventDefault(); ACTIONS[a.dataset.kxs](a); }
  }

  async function loadFollowed() {
    if (followed) return followed;
    try {
      const uid = firebase.auth().currentUser.uid;
      const snap = await db.collection('users').doc(uid).collection('following').get();
      const docs = await Promise.all(snap.docs.slice(0, 60).map(d => db.collection('users').doc(d.id).get()));
      followed = docs.filter(d => d.exists).map(d => {
        const u = d.data();
        return { id: d.id, name: u.displayName || u.username || u.name || 'Usuario' };
      }).sort((a, b) => a.name.localeCompare(b.name, 'es'));
    } catch (e) { return []; }
    return followed;
  }

  // ---------- Entradas públicas ----------
  function openStart() {
    if (!signedIn()) { toast('Inicia sesión para registrar tus sesiones', 'info'); return; }
    if (S().isActive()) setView('active'); else setView('start');
  }

  // Desde las fichas de vía: con sesión activa, «Registrar ascenso» abre esta hoja en lugar del formulario
  function openRegister(info) {
    setView('register', { info, result: 'send', style: 'redpoint', companions: [] });
  }

  function openSummary(item, { history = false } = {}) {
    setView('summary', { item, history });
  }

  // ---------- Reloj, tarjeta y botón ----------
  function tick() {
    if (!S()) return;
    const active = S().isActive();
    if (!active) { clearInterval(tickTimer); tickTimer = 0; return; }
    if (!tickTimer) tickTimer = setInterval(tick, 1000);
    if (document.visibilityState === 'hidden') return;
    const txt = kxsFormatClock(S().elapsedMs());
    document.querySelectorAll('[data-kxs-clock]').forEach(n => { if (n.textContent !== txt) n.textContent = txt; });
  }

  function updateCard() {
    if (!card) return;
    const item = S().get();
    card.hidden = !item;
    if (fab) fab.classList.toggle('is-live', !!item);
    if (fab) fab.setAttribute('aria-label', item ? 'Abrir sesión en curso' : 'Iniciar una sesión de escalada');
    if (!item) return;
    const paused = item.session.status === 'paused';
    const st = S().stats();
    card.classList.toggle('is-paused', paused);
    card.querySelector('[data-kxs-title]').textContent = paused ? 'Sesión en pausa' : 'Sesión en curso';
    card.querySelector('[data-kxs-sub]').textContent = [kxsPlural(st.routes, 'vía', 'vías'), st.meters > 0 ? `${st.meters} m` : ''].filter(Boolean).join(' · ');
    tick();
  }

  function mountMap(map) {
    const root = document.getElementById('map-view');
    if (!root || fab) return;
    // Botón flotante: al final de la columna inferior derecha, distinto de los controles cartográficos
    fab = document.createElement('button');
    fab.type = 'button';
    fab.id = 'btn-session';
    fab.className = 'kx-sess-fab maplibregl-ctrl';
    fab.setAttribute('aria-label', 'Iniciar una sesión de escalada');
    fab.title = 'Sesión de escalada';
    fab.innerHTML = kxIcon('timer', { size: 24, stroke: 1.75 }) + '<span class="kx-sess-fab-dot" aria-hidden="true"></span>';
    fab.addEventListener('click', (e) => { e.stopPropagation(); openStart(); });
    const stack = map.getContainer().querySelector('.maplibregl-ctrl-bottom-right');
    const geo = stack && stack.querySelector('.maplibregl-ctrl-geolocate');
    if (geo && geo.parentElement.parentElement === stack) stack.insertBefore(fab, geo.parentElement.nextSibling);   // justo bajo «Mi ubicación», encima de la atribución
    else (stack || root).appendChild(fab);

    // Tarjeta de sesión activa, bajo el buscador
    card = document.createElement('button');
    card.type = 'button';
    card.id = 'kx-sess-card';
    card.className = 'kx-sess-card';
    card.hidden = true;
    card.setAttribute('aria-label', 'Abrir el panel de la sesión en curso');
    card.innerHTML = `<span class="kx-sess-card-main"><span class="kx-sess-card-title"><span class="kxs-live"></span><span data-kxs-title>Sesión en curso</span></span><span class="kx-sess-card-sub" data-kxs-sub></span></span>
      <span class="kx-sess-card-clock" data-kxs-clock>00:00:00</span>${kxIcon('chevronDown', { size: 18, cls: 'kx-sess-card-chev' })}`;
    card.addEventListener('click', () => setView('active'));
    root.appendChild(card);
    updateCard();
    drawTrack(true);
  }

  // Línea del recorrido sobre el mapa (solo con GPS activo)
  function drawTrack(force) {
    if (typeof kxSessionDrawTrack !== 'function') return;
    const now = Date.now();
    if (!force && now - trackDrawn < 2000) return;
    trackDrawn = now;
    const item = S().get();
    const pts = item && item.session.gps.enabled && item.track.length > 1 ? item.track : [];
    kxSessionDrawTrack(pts);
  }

  function init() {
    if (!window.KruxSession) return;
    S().on((type) => {
      if (type === 'track') {
        drawTrack(false);
        const g = document.querySelector('[data-kxs-gps]');
        const item = S().get();
        if (g && item) g.textContent = `GPS activo${item.session.gps.distanceM > 0 ? ' · ' + kxsFormatDistance(item.session.gps.distanceM) : ''}`;
        return;
      }
      if (type === 'conflict') {
        toast('Tienes otra sesión de escalada en curso en otro dispositivo. Finaliza una de las dos para no duplicar tu actividad.', 'error');
        return;
      }
      if (type === 'gps-error') { toast(S().gpsError() || 'No se pudo obtener la ubicación', 'info'); }
      updateCard();
      drawTrack(true);
      if (view === 'active' && isOpen()) {
        if (S().isActive()) setView('active', { keepScroll: true }); else close();   // otro dispositivo la finalizó
      }
    });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') tick(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

  return { mountMap, openStart, openRegister, openSummary, close, isOpen, _views: () => VIEWS };
})();

window.KruxSessionUI = KruxSessionUI;

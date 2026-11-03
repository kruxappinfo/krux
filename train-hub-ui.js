// ================== ENTRENA — PANTALLA VISUAL: SESIÓN · PLAN · EJERCICIOS · PROGRESIÓN ==================
// Solo presentación: reorganiza Entrena en cuatro apartados con los datos que ya existen (plan activo, historial de sesiones,
// catálogo de ejercicios y estado del perfil). No guarda nada ni cambia el flujo de sesiones, que sigue en app_3.js.
//
// Solo se activa con KRUX_COACH (desactivado por defecto; ver train-coach-ui.js). Sin él, Entrena queda como estaba.
(function () {
  'use strict';
  if (!window.KRUX_COACH) return;

  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const svg = (body, size) => `<svg width="${size || 22}" height="${size || 22}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  const IC = {
    cal: svg('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>', 20),
    clock: svg('<circle cx="12" cy="13.5" r="7"/><path d="M12 10v3.5l2 1.5M9.5 3h5M12 3v3.5"/>', 20),
    chev: svg('<polyline points="9 18 15 12 9 6"/>', 18),
    brain: svg('<path d="M9.5 3.5a3 3 0 0 0-3 3 3 3 0 0 0-2.5 4.4A3.2 3.2 0 0 0 5.5 17a3 3 0 0 0 4 3.2V3.9a3 3 0 0 0 0-.4z"/><path d="M14.5 3.5a3 3 0 0 1 3 3 3 3 0 0 1 2.5 4.4 3.2 3.2 0 0 1-1.5 6.1 3 3 0 0 1-4 3.2V3.9"/>', 26),
    search: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>', 18),
    chart: svg('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>', 30)
  };
  const TABS = [['sesion', 'Sesión'], ['plan', 'Plan'], ['ejercicios', 'Ejercicios'], ['progresion', 'Progresión']];
  const DAYS = [['L', 'Lunes'], ['M', 'Martes'], ['X', 'Miércoles'], ['J', 'Jueves'], ['V', 'Viernes'], ['S', 'Sábado'], ['D', 'Domingo']];
  const GOAL_NAME = { fuerza: 'Fuerza', resistencia: 'Resistencia', potencia: 'Potencia', tecnica: 'Técnica', general: 'Condición general' };
  const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

  let tab = 'sesion', exCat = '', exQ = '';

  const view = () => $('train-view');
  const catalog = () => { const l = window.KruxLibrary; return l && l.catalog ? l.catalog() : null; };
  const guideId = it => (window.KruxGuide ? window.KruxGuide.idFor(it) : null);
  const exOf = it => { const c = catalog(), g = guideId(it); return c && g ? c.byId.get(g) : null; };
  const plan = () => window.kruxActivePlan || null;
  const log = () => (window.kruxTrainLog || []).filter(e => e && !e.demo && e.dateKey);
  const coach = () => (window.KruxCoach ? window.KruxCoach.state() : null);
  const catShort = c => c.name.split(/,| y /)[0];
  const catIcon = (id, size) => (window.KruxLibrary && window.KruxLibrary.categoryIcon ? window.KruxLibrary.categoryIcon(id, size || 24) : '');
  const minutesOf = exs => (typeof trEstimateMinutes === 'function' ? trEstimateMinutes(exs || []) : 0);
  const work = ex => (typeof trFmtWork === 'function' ? trFmtWork(ex) : `${ex.sets} series`);
  const plural = (n, a, b) => `${n} ${n === 1 ? a : b}`;
  const dayMs = 864e5;
  const midnight = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  const parseKey = k => new Date(k + 'T00:00');
  const mondayOf = d => { const x = midnight(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };

  // Semana actual del programa: solo si el plan tiene fecha de inicio (no se inventa)
  function programWeek(p) {
    if (!p || !p.startDate || !p.weeks) return null;
    const n = Math.floor((midnight(new Date()) - parseKey(p.startDate)) / (7 * dayMs)) + 1;
    return { n, total: p.weeks, state: n < 1 ? 'before' : n > p.weeks ? 'done' : 'on' };
  }
  function weekDone(p) {
    const monday = mondayOf(new Date());
    const keys = new Set(log().filter(e => { const d = parseKey(e.dateKey); return d >= monday && d - monday < 7 * dayMs && (!e.planId || !p || e.planId === p.id); }).map(e => e.dateKey));
    return keys.size;
  }

  // ── Montaje ─────────────────────────────────────────────────────────
  function mount() {
    const v = view(), wrap = v && v.querySelector('.train-wrap'), content = v && v.querySelector('.train-content');
    if (!wrap || !content || $('cxh-tabs')) return !!$('cxh-tabs');
    const nav = document.createElement('nav');
    nav.id = 'cxh-tabs'; nav.className = 'cxh-tabs'; nav.setAttribute('aria-label', 'Secciones de Entrena');
    nav.innerHTML = TABS.map(t => `<button type="button" class="cxh-tab${t[0] === tab ? ' is-on' : ''}" data-cxh-tab="${t[0]}" aria-pressed="${t[0] === tab}">${t[1]}</button>`).join('');
    wrap.insertBefore(nav, content);
    const mk = (id, cls) => { const el = document.createElement('section'); el.id = id; el.className = cls; return el; };
    content.insertBefore(mk('cxh-plan-card', 'cxh-s cxh-plan-card'), content.firstChild);
    const before = $('train-lib-link') || null;
    ['cxh-mental', 'cxh-focus'].forEach(id => content.insertBefore(mk(id, 'cxh-s cxh-' + id.slice(4)), before));
    ['plan', 'ejercicios', 'progresion'].forEach(t => content.appendChild(mk('cxh-p-' + t, 'cxh-panel cxh-panel--' + t)));
    v.classList.add('cxh-on'); v.dataset.cxh = tab;
    nav.addEventListener('click', e => { const b = e.target.closest('[data-cxh-tab]'); if (b) setTab(b.dataset.cxhTab); });
    content.addEventListener('click', onClick);
    content.addEventListener('input', e => { if (e.target.id === 'cxh-q') { exQ = e.target.value; renderExList(); } });
    // «Comenzar sesión»: misma acción que el botón de siempre, con el texto del nuevo diseño
    const lab = $('train-start-label');
    if (lab) { const fix = () => { if (lab.textContent === 'Comenzar entrenamiento') lab.textContent = 'Comenzar sesión'; }; fix(); new MutationObserver(fix).observe(lab, { childList: true, characterData: true, subtree: true }); }
    return true;
  }

  function setTab(t) {
    tab = t;
    const v = view(); if (v) v.dataset.cxh = t;
    document.querySelectorAll('#cxh-tabs .cxh-tab').forEach(b => { const on = b.dataset.cxhTab === t; b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', on); });
    refresh();
    const c = v && v.querySelector('.train-content'); if (c) c.scrollTop = 0;
  }

  function onClick(e) {
    const sess = e.target.closest('[data-plan-sess]');
    if (sess) { if (window.KruxCoach) window.KruxCoach.openPlanSession(sess.dataset.planSess); return; }
    const chip = e.target.closest('[data-cxh-cat]');
    if (chip) { exCat = chip.dataset.cxhCat; renderEx(); return; }
    const a = e.target.closest('[data-cxh-act]');
    if (!a) return;
    const act = a.dataset.cxhAct;
    if (act === 'create') { const b = $('train-hero-cta'); if (b) b.click(); }
    else if (act === 'plans') { if (window.KruxPlansUI) window.KruxPlansUI.open(); else { const b = $('train-hero-cta'); if (b) b.click(); } }
    else if (act === 'edit') { if (typeof window.openPlanEditor === 'function') window.openPlanEditor({ edit: true }); }
    else if (act === 'library') { if (window.KruxLibrary) window.KruxLibrary.open({ mode: 'browse' }); }
    else if (act === 'mental') { if (window.KruxMentalUI) window.KruxMentalUI.open(); }
    else if (act === 'mental-on') { if (window.KruxCoach) window.KruxCoach.openMental(); }
    else if (act === 'sesion') setTab('sesion');
  }

  // ── Sesión: tarjeta del plan, entrenamiento mental y enfoque ────────
  function renderPlanCard() {
    const el = $('cxh-plan-card'); if (!el) return;
    const p = plan();
    if (!p) {
      const pick = (window.kruxPlans || []).some(x => x.status === 'ready');
      el.innerHTML = `<div class="cxh-pc-tx"><p class="cxh-kicker">Tu plan</p><h2 class="cxh-pc-title">Sin plan activo</h2>
        <p class="cxh-pc-sub">${pick ? 'Elige uno de tus planes o crea uno nuevo.' : 'Crea un plan para organizar tus sesiones de la semana.'}</p>
        <button type="button" class="cxh-btn" data-cxh-act="${pick ? 'plans' : 'create'}">${pick ? 'Mis planes' : 'Crear plan'}</button></div>`;
      return;
    }
    const sessions = (p.sessions || []).length, avg = sessions ? Math.round((p.sessions || []).reduce((n, s) => n + minutesOf(s.exercises), 0) / sessions) : 0;
    const pw = programWeek(p);
    let prog;
    if (pw && pw.state === 'on') prog = { label: `Semana ${pw.n} de ${pw.total}`, pct: Math.round(pw.n / pw.total * 100) };
    else if (pw && pw.state === 'done') prog = { label: 'Programa completado', pct: 100 };
    else { const d = weekDone(p); prog = { label: `Esta semana: ${d} de ${sessions}`, pct: sessions ? Math.min(100, Math.round(d / sessions * 100)) : 0 }; }
    el.innerHTML = `<div class="cxh-pc-tx"><p class="cxh-kicker">Tu plan activo</p><h2 class="cxh-pc-title">${esc(p.name || 'Mi plan')}</h2>
      <ul class="cxh-pc-rows"><li>${IC.cal}<span>${plural(sessions, 'sesión', 'sesiones')} / semana</span></li>${avg ? `<li>${IC.clock}<span>~${avg} min / sesión</span></li>` : ''}</ul>
      <div class="cxh-prog"><span>${esc(prog.label)}</span><i role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${prog.pct}"><b style="width:${prog.pct}%"></b></i></div></div>`;
  }

  function renderMental() {
    const el = $('cxh-mental'); if (!el) return;
    const st = coach(), PR = window.KruxProfile;
    if (!st || !st.loaded || !PR) { el.hidden = true; return; }
    const on = PR.mentalAnswered(st.mental) > 0;
    if (on) {
      el.hidden = false;
      el.innerHTML = `<button type="button" class="cxh-mental-btn" data-cxh-act="mental"><span class="cxh-mental-ic">${IC.brain}</span>
        <span class="cxh-mental-tx"><b>Entrenamiento mental</b><small>Confianza, concentración y gestión del miedo</small></span><span class="cxh-chev">${IC.chev}</span></button>`;
    } else if (st.profile && st.profile.status === 'completed') {
      el.hidden = false;
      el.innerHTML = `<button type="button" class="cxh-mental-btn is-quiet" data-cxh-act="mental-on"><span class="cxh-mental-ic">${IC.brain}</span>
        <span class="cxh-mental-tx"><b>Añadir entrenamiento mental</b><small>Opcional · confianza, concentración y miedo</small></span><span class="cxh-chev">${IC.chev}</span></button>`;
    } else el.hidden = true;
  }

  // Áreas que trabaja el plan: las categorías de sus ejercicios (sin contar la movilidad de calentamiento)
  function focusAreas() {
    const cat = catalog(); if (!cat) return [];
    const count = {};
    const add = ex => { if (ex && ex.primaryCategoryId !== 'movilidad') count[ex.primaryCategoryId] = (count[ex.primaryCategoryId] || 0) + 1; };
    const p = plan();
    if (p) (p.sessions || []).forEach(s => (s.exercises || []).forEach(it => add(exOf(it))));
    return Object.keys(count).sort((a, b) => count[b] - count[a]).slice(0, 3).map(id => cat.catById.get(id)).filter(Boolean);
  }
  function renderFocus() {
    const el = $('cxh-focus'); if (!el) return;
    const areas = focusAreas();
    if (!areas.length) { el.hidden = true; return; }
    el.hidden = false;
    el.innerHTML = `<h3 class="cxh-h">Tu enfoque</h3><div class="cxh-focus-row">${areas.map(c => `<div class="cxh-focus-tile cx-art--${esc(c.id)}"><span>${catIcon(c.id, 28)}</span><b>${esc(catShort(c))}</b></div>`).join('')}</div>`;
  }

  // ── Plan ────────────────────────────────────────────────────────────
  function renderPlanTab() {
    const el = $('cxh-p-plan'); if (!el) return;
    const p = plan();
    if (!p) {
      el.innerHTML = `<div class="cxh-empty"><span class="cxh-empty-ic">${IC.cal}</span><h2>Aún no tienes un plan activo</h2><p>Crea un plan o elige uno de los que ya tienes para ver aquí tu semana.</p>
        <button type="button" class="cxh-btn" data-cxh-act="create">Crear plan</button></div>`;
      return;
    }
    const sessions = p.sessions || [], avg = sessions.length ? Math.round(sessions.reduce((n, s) => n + minutesOf(s.exercises), 0) / sessions.length) : 0;
    const pw = programWeek(p), cat = catalog();
    const status = pw ? (pw.state === 'on' ? `Semana ${pw.n} de ${pw.total}` : pw.state === 'done' ? 'Programa completado' : `Empieza el ${parseKey(p.startDate).getDate()} ${MONTHS[parseKey(p.startDate).getMonth()]}`) : 'Activo';
    const weeks = p.weeks ? `<ol class="cxh-weeks" aria-label="Semanas del programa">${Array.from({ length: p.weeks }, (_, i) => `<li class="${pw && pw.state !== 'before' && i + 1 < pw.n ? 'is-past' : ''}${pw && pw.state === 'on' && i + 1 === pw.n ? ' is-now' : ''}">${i + 1}</li>`).join('')}</ol>` : '';
    const rows = DAYS.map(([k, name]) => {
      const list = sessions.filter(s => s.day === k);
      if (!list.length) return `<li class="cxh-day is-rest"><span class="cxh-day-n">${k}</span><span class="cxh-day-rest">${name} · descanso</span></li>`;
      return list.map(s => {
        const exs = s.exercises || [], main = exs.map(exOf).filter(Boolean).find(x => x.primaryCategoryId !== 'movilidad') || exOf(exs[0]);
        const cid = main ? main.primaryCategoryId : 'general';
        const mentalN = (s.mental || []).length;
        return `<li class="cxh-day"><span class="cxh-day-n">${k}</span><button type="button" class="cxh-sess" data-plan-sess="${esc(s.id || s.name)}" aria-label="${esc(`${name}: ${s.name}. Ver sesión`)}">
          <span class="cxh-sess-art cx-art--${esc(cid)}" aria-hidden="true">${catIcon(cid, 22)}</span>
          <span class="cxh-sess-tx"><b>${esc(s.name)}</b><small>${esc(name)} · ${plural(exs.length, 'ejercicio', 'ejercicios')} · ~${minutesOf(exs)} min</small>${mentalN ? `<span class="cxh-mtag">${IC.brain.replace(/width="26" height="26"/, 'width="14" height="14"')} ${plural(mentalN, 'práctica mental', 'prácticas mentales')}</span>` : ''}</span>
          <span class="cxh-chev">${IC.chev}</span></button></li>`;
      }).join('');
    }).join('');
    const goal = p.goal && GOAL_NAME[p.goal] ? GOAL_NAME[p.goal] : '';
    el.innerHTML = `<section class="cxh-card"><p class="cxh-kicker">Programa</p><h2 class="cxh-pc-title">${esc(p.name || 'Mi plan')}</h2>
        <ul class="cxh-facts"><li><span>Objetivo</span><b>${esc(goal || 'Sin indicar')}</b></li><li><span>Duración</span><b>${p.weeks ? plural(p.weeks, 'semana', 'semanas') : '—'}</b></li>
          <li><span>Sesiones</span><b>${sessions.length} / semana</b></li><li><span>Estado</span><b>${esc(status)}</b></li></ul>
        ${weeks}${avg ? `<p class="cxh-note">Cada sesión dura unos ${avg} min de media.</p>` : ''}</section>
      <section><h3 class="cxh-h">Tu semana</h3><ul class="cxh-week">${rows}</ul></section>
      <div class="cxh-actions"><button type="button" class="cxh-btn cxh-btn--ghost" data-cxh-act="edit">Editar plan</button>${window.KRUX_MULTIPLAN ? '<button type="button" class="cxh-btn cxh-btn--ghost" data-cxh-act="plans">Mis planes</button>' : ''}</div>`;
  }

  // ── Ejercicios ──────────────────────────────────────────────────────
  function renderEx() {
    const el = $('cxh-p-ejercicios'); if (!el) return;
    const cat = catalog();
    if (!cat) { el.innerHTML = '<div class="cxh-empty"><p>El catálogo de ejercicios no está disponible ahora mismo.</p></div>'; return; }
    el.innerHTML = `<label class="cxh-search">${IC.search}<input type="search" id="cxh-q" placeholder="Buscar ejercicio" value="${esc(exQ)}" autocomplete="off" aria-label="Buscar ejercicio"></label>
      <div class="cxh-chips" role="group" aria-label="Categorías"><button type="button" class="cxh-chip${exCat ? '' : ' is-on'}" data-cxh-cat="" aria-pressed="${!exCat}">Todos</button>${cat.categories.map(c => `<button type="button" class="cxh-chip${exCat === c.id ? ' is-on' : ''}" data-cxh-cat="${esc(c.id)}" aria-pressed="${exCat === c.id}">${esc(catShort(c))}</button>`).join('')}</div>
      <div id="cxh-ex-list" class="cxh-ex-list"></div>
      <button type="button" class="cxh-btn cxh-btn--ghost" data-cxh-act="library">Abrir biblioteca completa</button>`;
    renderExList();
  }
  function renderExList() {
    const box = $('cxh-ex-list'), cat = catalog(), X = window.KruxExercises; if (!box || !cat) return;
    const q = X && X.normalize ? X.normalize(exQ) : exQ.toLowerCase();
    const list = cat.exercises.filter(ex => ex.status === 'published' && (!exCat || ex.categoryIds.includes(exCat)) && (!q || (X && X.normalize ? X.normalize(ex.name + ' ' + (ex.shortDescription || '')) : ex.name.toLowerCase()).includes(q)));
    box.innerHTML = list.length ? list.map(ex => {
      const it = X && X.planItemFromExercise ? X.planItemFromExercise(ex) : null, c = cat.catById.get(ex.primaryCategoryId);
      return `<button type="button" class="cx-ex cxh-ex" data-guide="${esc(ex.id)}" aria-label="${esc(`${ex.name}. Ver instrucciones`)}">
        <span class="cx-ex-art cx-art--${esc(ex.primaryCategoryId)}" aria-hidden="true">${catIcon(ex.primaryCategoryId, 24)}</span>
        <span class="cx-ex-body"><b>${esc(ex.name)}</b><span class="cx-ex-spec">${esc([c ? catShort(c) : '', X && X.LEVEL_LABELS[ex.technicalLevel] || ''].filter(Boolean).join(' · '))}</span>${it ? `<small>${esc(work(it))}</small>` : ''}</span>
        <span class="cxh-chev">${IC.chev}</span></button>`;
    }).join('') : '<p class="cxh-note">No hay ejercicios con ese filtro.</p>';
  }

  // ── Progresión: solo con el historial real ──────────────────────────
  function renderProg() {
    const el = $('cxh-p-progresion'); if (!el) return;
    const L = log();
    if (!L.length) {
      el.innerHTML = `<div class="cxh-empty"><span class="cxh-empty-ic">${IC.chart}</span><h2>Aún no hay datos de progreso</h2><p>Cuando registres tus primeros entrenamientos verás aquí tus sesiones, tu regularidad y cómo evolucionan tus cargas.</p>
        <button type="button" class="cxh-btn" data-cxh-act="sesion">Ir a mi sesión</button></div>`;
      return;
    }
    const monday = mondayOf(new Date());
    const weekN = k => Math.floor((monday - mondayOf(parseKey(k))) / (7 * dayMs));            // 0 = esta semana
    const N = 8, perWeek = Array(N).fill(0);
    L.forEach(e => { const w = weekN(e.dateKey); if (w >= 0 && w < N) perWeek[N - 1 - w]++; });
    const active = perWeek.filter(n => n > 0).length, maxW = Math.max(1, ...perWeek);
    const secs = L.reduce((n, e) => n + (e.durationSec || 0), 0);
    const rp = L.flatMap(e => (e.exercises || []).flatMap(x => (x.sets || []).map(s => Number(s.rpe)).filter(n => n > 0)));
    const stats = [[L.length, L.length === 1 ? 'sesión registrada' : 'sesiones registradas'], [perWeek[N - 1], 'esta semana'], [secs >= 60 ? Math.round(secs / 60) : null, 'minutos entrenados'], [rp.length ? (rp.reduce((a, b) => a + b, 0) / rp.length).toFixed(1) : null, 'RPE medio']].filter(x => x[0] != null);
    // Cargas: ejercicios con peso registrado en al menos dos sesiones (máximo por sesión)
    const by = {};
    L.slice().sort((a, b) => a.dateKey.localeCompare(b.dateKey)).forEach(e => (e.exercises || []).forEach(x => {
      const w = Math.max(0, ...(x.sets || []).map(s => Number(s.weight) || 0));
      if (w > 0) (by[x.name] = by[x.name] || []).push(w);
    }));
    const loads = Object.keys(by).filter(n => by[n].length >= 2).sort((a, b) => by[b].length - by[a].length).slice(0, 3);
    const spark = vals => { const lo = Math.min(...vals), hi = Math.max(...vals), r = hi - lo || 1; return `<svg viewBox="0 0 100 28" preserveAspectRatio="none" class="cxh-spark" aria-hidden="true"><polyline points="${vals.map((v, i) => `${vals.length === 1 ? 50 : Math.round(i / (vals.length - 1) * 100)},${Math.round(24 - (v - lo) / r * 20)}`).join(' ')}" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`; };
    // Dónde se ha puesto el trabajo (últimos 30 días, series por categoría)
    const cat = catalog(), sets = {}; let tot = 0;
    L.filter(e => (midnight(new Date()) - parseKey(e.dateKey)) / dayMs <= 30).forEach(e => (e.exercises || []).forEach(x => {
      const ex = exOf(x), n = (x.sets || []).length; if (!ex || !n) return; sets[ex.primaryCategoryId] = (sets[ex.primaryCategoryId] || 0) + n; tot += n;
    }));
    const dist = Object.keys(sets).sort((a, b) => sets[b] - sets[a]).slice(0, 5);
    const st = coach(), goalId = st && st.profile && st.profile.goalPrimary, PR = window.KruxProfile;
    const goalName = goalId && PR ? PR.labelOf(PR.GOALS, goalId) : '';
    el.innerHTML = `<ul class="cxh-stats">${stats.map(s => `<li><b>${esc(s[0])}</b><span>${esc(s[1])}</span></li>`).join('')}</ul>
      <section class="cxh-card"><h3 class="cxh-h">Regularidad</h3><p class="cxh-note">${plural(active, 'semana', 'semanas')} con entrenamiento de las últimas ${N}.</p>
        <div class="cxh-bars" role="img" aria-label="Sesiones por semana, de la más antigua a la actual: ${perWeek.join(', ')}">${perWeek.map((n, i) => `<div class="cxh-bar${i === N - 1 ? ' is-now' : ''}"><i style="height:${Math.round(n / maxW * 100)}%"></i><span>${n}</span></div>`).join('')}</div></section>
      ${loads.length ? `<section class="cxh-card"><h3 class="cxh-h">Evolución de cargas</h3><ul class="cxh-loads">${loads.map(n => { const v = by[n], d = v[v.length - 1] - v[0]; return `<li><span class="cxh-load-tx"><b>${esc(n)}</b><small>${v[0]} → ${v[v.length - 1]} kg${d ? ` · ${d > 0 ? '+' : ''}${d} kg` : ''}</small></span>${spark(v)}</li>`; }).join('')}</ul></section>` : ''}
      ${dist.length ? `<section class="cxh-card"><h3 class="cxh-h">Dónde has puesto el trabajo</h3><p class="cxh-note">Series de los últimos 30 días por tipo de ejercicio${goalName ? ` · tu objetivo principal: ${esc(goalName.toLowerCase())}` : ''}.</p>
        <ul class="cxh-dist">${dist.map(id => { const c = cat && cat.catById.get(id); return `<li><span class="cxh-dist-n">${esc(c ? catShort(c) : id)}</span><i><b style="width:${Math.round(sets[id] / tot * 100)}%"></b></i><span class="cxh-dist-v">${sets[id]}</span></li>`; }).join('')}</ul></section>` : ''}`;
  }

  function refresh() {
    if (!mount()) return;
    renderPlanCard(); renderMental(); renderFocus();
    if (tab === 'plan') renderPlanTab();
    else if (tab === 'ejercicios') renderEx();
    else if (tab === 'progresion') renderProg();
  }

  function init() {
    const v = view(); if (!v) return;
    refresh();
    ['krux:train-refresh', 'krux-train-sync', 'krux:coach-change'].forEach(ev => (ev === 'krux-train-sync' ? window : document).addEventListener(ev, refresh));
    new MutationObserver(() => { if (v.classList.contains('active')) refresh(); }).observe(v, { attributes: true, attributeFilter: ['class'] });
    window.KruxHub = { setTab, refresh, tab: () => tab };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
}());

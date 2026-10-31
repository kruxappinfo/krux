// ================== ENTRENA — BIBLIOTECA MENTAL ==================
// Interfaz sobre el catálogo empaquetado (train-mental-data.js): categorías, fichas de lecciones y ejercicios,
// ejercicios guiados paso a paso y ejercicios mentales dentro de las sesiones (sessions[].mental[], aparte de exercises[]).
//
// Solo se activa con KRUX_COACH (desactivado por defecto; ?coach=1 lo enciende en este navegador).
// El contenido es orientativo y está pendiente de revisión profesional: el aviso se muestra siempre.
//
// Persistencia: el catálogo va empaquetado (funciona sin conexión). Lo completado se guarda solo en este dispositivo
// (localStorage, por usuario): no hay escritura en Firestore ni cola nueva. Sin sesión iniciada se guarda bajo «anon»
// y ese progreso NO se transfiere a la cuenta al iniciar sesión (de momento). Añadir o quitar un ejercicio de una sesión
// usa el guardado de planes de siempre (KruxTrainStore.savePlan, con control de revisión) a través de KruxMentalOps:
// el plan en memoria solo cambia cuando el servidor confirma. La lógica vive en train-mental-ops.js.
(function () {
  'use strict';

  const D = window.KRUX_MENTAL_DATA;
  const OPS = window.KruxMentalOps;
  if (!D || !OPS || !window.KRUX_COACH) return;

  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = (title, type, opts) => { if (typeof showToast === 'function') showToast(title, type || 'info', opts); };
  const PL = () => window.KruxPlans;
  const MAX_MENTAL = (PL() && PL().LIMITS.mental) || 5;

  const ALL = [...D.lessons, ...D.exercises];
  const BY_ID = new Map(ALL.map(c => [c.id, c]));
  const CAT = new Map(D.categories.map(c => [c.id, c]));
  const DIFF = { 1: 'Fácil', 2: 'Media', 3: 'Difícil' };
  const DAY_NAMES = { L: 'Lunes', M: 'Martes', X: 'Miércoles', J: 'Jueves', V: 'Viernes', S: 'Sábado', D: 'Domingo' };

  const svg = (body, size) => `<svg width="${size || 20}" height="${size || 20}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  const I = {
    back: svg('<polyline points="15 18 9 12 15 6"/>', 22),
    close: svg('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>'),
    chev: svg('<polyline points="9 18 15 12 9 6"/>', 18),
    check: svg('<polyline points="20 6 9 17 4 12"/>', 14),
    clock: svg('<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/>', 14),
    book: svg('<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>'),
    play: svg('<polygon points="6 4 20 12 6 20 6 4"/>', 16),
    warn: svg('<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>', 18)
  };
  const CAT_ICON = {
    shield: svg('<path d="M12 2 4 5v6c0 5 3.4 9.3 8 11 4.6-1.7 8-6 8-11V5z"/>'),
    focus: svg('<circle cx="12" cy="12" r="3"/><path d="M3 9V5a2 2 0 0 1 2-2h4M15 3h4a2 2 0 0 1 2 2v4M21 15v4a2 2 0 0 1-2 2h-4M9 21H5a2 2 0 0 1-2-2v-4"/>'),
    wave: svg('<path d="M2 12c2.5-4 5-4 7.5 0s5 4 7.5 0 3-3 5-1"/>'),
    user: svg('<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>'),
    bolt: svg('<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>'),
    route: svg('<circle cx="6" cy="18" r="2"/><circle cx="18" cy="6" r="2"/><path d="M8 18h5a4 4 0 0 0 0-8h-2a4 4 0 0 1 0-8h5"/>'),
    flow: svg('<path d="M3 12h4l2-6 4 12 2-6h6"/>')
  };

  // ============================================
  // LO COMPLETADO (solo en este dispositivo)
  // ============================================
  const uid = () => { try { const u = firebase.auth().currentUser; return u ? u.uid : null; } catch (_) { return null; } };
  const todayKey = () => (typeof trDateKey === 'function' ? trDateKey(new Date()) : new Date().toISOString().slice(0, 10));
  const progress = OPS.createProgress({ storage: () => window.localStorage, uid, today: todayKey });
  const readDone = progress.read;
  const markDone = progress.mark;
  const doneToday = progress.doneToday;

  // Guardado de sessions[].mental[]: en fila y sin tocar el plan en memoria hasta que el servidor confirme
  const ops = OPS.createOps({
    limit: MAX_MENTAL,
    isMulti: () => !!window.KRUX_MULTIPLAN,
    plans: () => [window.kruxActivePlan].concat(window.kruxPlans || []).filter(Boolean),
    savePlan: plan => window.KruxTrainStore.savePlan(plan)
  });
  const FAIL = {
    guardado: ['No se ha podido guardar', 'Inténtalo de nuevo cuando haya conexión.'],
    error: ['No se ha podido guardar', 'Ha ocurrido un error inesperado. Inténtalo de nuevo.'],
    plan: ['El plan ha cambiado', 'Vuelve a abrir Entrena e inténtalo de nuevo.'],
    limite: [`Esta sesión ya tiene ${MAX_MENTAL} ejercicios mentales`, 'Quita alguno para añadir otro.']
  };

  // ============================================
  // MODAL Y NAVEGACIÓN
  // ============================================
  let view = null;      // { type:'home'|'cat'|'detail'|'run'|'done', ... }
  let stack = [];       // vistas anteriores para «Volver»
  let filter = 'all';   // all | lesson | exercise
  const modal = () => $('mental-modal');

  function openModal() {
    const m = modal(); if (!m) return;
    m.classList.remove('hidden');
    requestAnimationFrame(() => m.classList.add('pe-open'));
    document.body.classList.add('plan-editor-open');
  }
  function closeModal() {
    const m = modal(); if (!m) return;
    view = null; stack = [];
    m.classList.remove('pe-open');
    document.body.classList.remove('plan-editor-open');
    setTimeout(() => { if (!view) { m.classList.add('hidden'); m.innerHTML = ''; } }, 280);
    renderSession(lastSession);
  }
  function go(next, replace) {
    if (view && !replace) stack.push(view);
    view = next; render(); openModal();
  }
  function back() {
    if (view && view.type === 'run' && view.step > 0) { view.step--; render(); return; }
    if (stack.length) { view = stack.pop(); render(); } else closeModal();
  }

  function shell(o) {
    return `
      <div class="pe-screen xl-screen">
        <header class="pe-topbar xl-topbar">
          <button type="button" class="pe-icon-btn pe-back-btn" data-mx="back" aria-label="Volver">${o.close ? I.close : I.back}</button>
          <div class="pe-heading">${o.sub ? `<p class="pe-subtitle xl-step">${esc(o.sub)}</p>` : ''}<h2 class="pe-title xl-wz-title" id="mx-title" tabindex="-1">${esc(o.title)}</h2></div>
        </header>
        ${o.progress != null ? `<div class="xl-progress" aria-hidden="true"><span style="width:${o.progress}%"></span></div>` : ''}
        <div class="xl-scroll xl-wz-scroll" id="mx-scroll">${o.body}</div>
        ${o.footer ? `<div class="xl-pickbar cx-pickbar">${o.footer}</div>` : ''}
      </div>`;
  }

  const disclaimerHTML = () => `<p class="mx-disclaimer" role="note">${I.warn}<span>${esc(D.disclaimer)}</span></p>`;
  const list = (items, cls) => `<ul class="${cls || 'mx-list'}">${items.map(t => `<li>${esc(t)}</li>`).join('')}</ul>`;
  const block = (label, text) => text ? `<section class="mx-block"><h3 class="pe-label">${esc(label)}</h3><p class="xl-text">${esc(text)}</p></section>` : '';

  function itemRow(c) {
    const done = c.type === 'exercise' && readDone()[c.id];
    return `<button type="button" class="mx-row" data-open="${esc(c.id)}">
      <span class="mx-row-text"><b>${esc(c.title)}</b>
        <small>${c.type === 'lesson' ? 'Lección' : 'Ejercicio'} · ${I.clock} ${esc(c.durationLabel)}${done ? ` · <span class="mx-done">${I.check} Hecho</span>` : ''}</small></span>
      <span class="mx-row-chev">${I.chev}</span></button>`;
  }

  function homeScreen() {
    const counts = id => ALL.filter(c => c.categoryId === id && (filter === 'all' || c.type === filter)).length;
    const seg = [['all', 'Todo'], ['lesson', 'Lecciones'], ['exercise', 'Ejercicios']];
    const cats = D.categories.slice().sort((a, b) => a.order - b.order).filter(c => counts(c.id));
    return shell({
      title: 'Biblioteca mental', sub: 'Entrena', close: true,
      body: `
        ${disclaimerHTML()}
        <div class="mx-seg" role="tablist" aria-label="Tipo de contenido">${seg.map(([k, l]) => `<button type="button" role="tab" aria-selected="${filter === k}" class="mx-seg-btn${filter === k ? ' is-on' : ''}" data-filter="${k}">${l}</button>`).join('')}</div>
        <div class="mx-cats">${cats.map(c => `
          <button type="button" class="mx-cat" data-cat="${c.id}">
            <span class="mx-cat-icon">${CAT_ICON[c.icon] || CAT_ICON.flow}</span>
            <span class="mx-row-text"><b>${esc(c.name)}</b><small>${esc(c.description)}</small></span>
            <span class="mx-count">${counts(c.id)}</span></button>`).join('')}</div>`
    });
  }

  function catScreen() {
    const c = CAT.get(view.cat);
    const items = ALL.filter(x => x.categoryId === c.id && (filter === 'all' || x.type === filter));
    const les = items.filter(x => x.type === 'lesson'), ex = items.filter(x => x.type === 'exercise');
    const group = (label, arr) => arr.length ? `<h3 class="mx-group">${label}</h3><div class="mx-rows">${arr.map(itemRow).join('')}</div>` : '';
    return shell({ title: c.name, sub: 'Biblioteca mental', body: `<p class="xl-text">${esc(c.description)}</p>${group('Lecciones', les)}${group('Ejercicios guiados', ex)}` });
  }

  function metaChips(c) {
    const chips = [`${I.clock} ${esc(c.durationLabel)}`, c.moments.map(m => D.moments[m]).join(' · ')];
    if (c.type === 'exercise') chips.push(`Dificultad: ${DIFF[c.difficulty]}`);
    return `<p class="mx-meta">${chips.filter(Boolean).map(t => `<span>${t}</span>`).join('')}</p>`;
  }
  const precautionsHTML = c => (c.precautions && c.precautions.length) ? `
    <section class="mx-block mx-caution${c.safetyLevel === 'reinforced' ? ' is-reinforced' : ''}"><h3 class="pe-label">${I.warn} Precauciones</h3>${list(c.precautions)}</section>` : '';
  function relatedHTML(c) {
    const rel = (c.related || []).map(id => BY_ID.get(id)).filter(Boolean);
    return rel.length ? `<section class="mx-block"><h3 class="pe-label">Relacionado</h3><div class="mx-rows">${rel.map(itemRow).join('')}</div></section>` : '';
  }

  function detailScreen() {
    const c = BY_ID.get(view.id);
    const cat = CAT.get(c.categoryId);
    let body, footer = '';
    if (c.type === 'lesson') {
      body = `${metaChips(c)}${block('Objetivo', c.objective)}${block('Introducción', c.introduction)}${block('Qué ocurre', c.explanation)}${block('Cómo se nota al escalar', c.application)}
        <section class="mx-block"><h3 class="pe-label">Recomendaciones</h3>${list(c.recommendations)}</section>${block('En resumen', c.summary)}${precautionsHTML(c)}${relatedHTML(c)}${disclaimerHTML()}`;
    } else {
      body = `${metaChips(c)}${block('Objetivo', c.objective)}${block('De qué trata', c.description)}${precautionsHTML(c)}
        <section class="mx-block"><h3 class="pe-label">Pasos</h3><ol class="mx-list mx-steps">${c.steps.map(t => `<li>${esc(t)}</li>`).join('')}</ol></section>
        ${c.variants && c.variants.roca ? block('En roca', c.variants.roca) : ''}${block('Cuándo darlo por hecho', c.completionCriteria)}${relatedHTML(c)}${disclaimerHTML()}`;
      footer = `<div class="cx-footer-stack"><button type="button" class="cx-btn cx-btn--primary" data-mx="run">${I.play}<span>Empezar ejercicio guiado</span></button>
        <button type="button" class="cx-btn cx-btn--secondary" data-mx="add">Añadir a una sesión</button></div>`;
    }
    return shell({ title: c.title, sub: cat ? cat.name : '', body, footer });
  }

  // Ejercicio guiado: aviso previo → un paso por pantalla → cierre con criterio y preguntas de reflexión
  function runSteps(c) {
    return [{ kind: 'intro' }, ...c.steps.map((t, i) => ({ kind: 'step', i, t })), { kind: 'end' }];
  }
  function runScreen() {
    const c = BY_ID.get(view.id);
    const steps = runSteps(c);
    const s = steps[view.step];
    const last = view.step === steps.length - 1;
    let body;
    if (s.kind === 'intro') {
      body = `<div class="mx-card"><p class="mx-big">${esc(c.objective)}</p><p class="xl-text">${esc(c.description)}</p><p class="mx-meta"><span>${I.clock} ${esc(c.durationLabel)}</span></p></div>
        ${precautionsHTML(c) || '<p class="xl-text">Si algo no te resulta cómodo o seguro, para: la decisión de parar siempre prima.</p>'}`;
    } else if (s.kind === 'step') {
      body = `<div class="mx-card mx-card--step"><span class="mx-stepno">Paso ${s.i + 1} de ${c.steps.length}</span><p class="mx-big">${esc(s.t)}</p></div>`;
    } else {
      body = `<div class="mx-card"><h3 class="pe-label">Cuándo darlo por hecho</h3><p class="xl-text">${esc(c.completionCriteria)}</p></div>
        <section class="mx-block"><h3 class="pe-label">Para pensar (opcional)</h3>${list(c.reflectionQuestions)}<p class="cx-note">No se guarda nada de lo que respondas: son preguntas para ti.</p></section>${disclaimerHTML()}`;
    }
    const footer = last
      ? `<div class="cx-footer-stack"><button type="button" class="cx-btn cx-btn--primary" data-mx="finish">${I.check}<span>Marcar como hecho</span></button></div>`
      : `<div class="cx-footer-stack"><button type="button" class="cx-btn cx-btn--primary" data-mx="next"><span>${s.kind === 'intro' ? 'Empezar' : 'Siguiente'}</span></button></div>`;
    return shell({ title: c.title, sub: s.kind === 'step' ? `Paso ${s.i + 1} de ${c.steps.length}` : s.kind === 'intro' ? 'Antes de empezar' : 'Final', progress: Math.round(view.step / (steps.length - 1) * 100), body, footer });
  }

  function doneScreen() {
    const c = BY_ID.get(view.id);
    // Solo se dice que queda anotado si el dispositivo lo ha guardado de verdad
    const note = view.saved
      ? 'Queda anotado en este dispositivo. Puedes repetirlo cuando quieras.'
      : 'No se ha podido anotar en este dispositivo (el almacenamiento no está disponible), así que no constará como hecho. Puedes repetirlo cuando quieras.';
    return shell({
      title: view.saved ? 'Ejercicio completado' : 'Ejercicio terminado', sub: c.title, close: true,
      body: `<div class="mx-card"><p class="mx-big">${view.saved ? 'Hecho. Gracias por dedicarle un rato.' : 'Has llegado al final del ejercicio.'}</p><p class="xl-text">${note}</p></div>${relatedHTML(c)}`,
      footer: `<div class="cx-footer-stack"><button type="button" class="cx-btn cx-btn--primary" data-mx="home">Volver a la biblioteca</button></div>`
    });
  }

  function render() {
    const m = modal(); if (!m || !view) return;
    const t = view.type;
    m.innerHTML = t === 'cat' ? catScreen() : t === 'detail' ? detailScreen() : t === 'run' ? runScreen() : t === 'done' ? doneScreen() : t === 'add' ? addScreen() : homeScreen();
    const sc = $('mx-scroll'); if (sc) sc.scrollTop = 0;
    const title = $('mx-title'); if (title) title.focus({ preventScroll: true });
  }

  // ============================================
  // AÑADIR A UNA SESIÓN (sessions[].mental[])
  // ============================================
  const targetPlan = () => window.kruxActivePlan && Array.isArray(window.kruxActivePlan.sessions) ? window.kruxActivePlan : null;

  function addScreen() {
    const c = BY_ID.get(view.id);
    const plan = targetPlan();
    let body;
    if (!plan || !plan.sessions.length) {
      body = `<div class="mx-card"><p class="mx-big">Aún no tienes un plan activo.</p><p class="xl-text">Crea o activa un plan en Entrena y podrás añadir este ejercicio a una de sus sesiones.</p></div>`;
    } else {
      body = `<p class="xl-text">Elige la sesión de «${esc(plan.name)}». El ejercicio mental se muestra aparte de los ejercicios físicos.</p>
        <div class="mx-rows">${plan.sessions.map((s, i) => {
          const has = (s.mental || []).some(m => m.id === c.id);
          const full = (s.mental || []).length >= MAX_MENTAL;
          return `<button type="button" class="mx-row" data-addto="${i}" ${has || full ? 'disabled' : ''}>
            <span class="mx-row-text"><b>${esc(s.name || 'Sesión')}</b><small>${esc(DAY_NAMES[s.day] || 'Sin día')}${has ? ' · Ya añadido' : full ? ` · Máximo ${MAX_MENTAL}` : ''}</small></span>
            <span class="mx-row-chev">${I.chev}</span></button>`;
        }).join('')}</div>`;
    }
    return shell({ title: 'Añadir a una sesión', sub: c.title, body });
  }

  async function addToSession(i) {
    const plan = targetPlan(); const c = BY_ID.get(view.id);
    const sess = plan && plan.sessions[i];
    if (!sess) return;
    if (!window.KruxTrainStore || !firebase.auth().currentUser) { toast('Inicia sesión para guardarlo en tu plan', 'info'); return; }
    const res = await ops.add(plan, sess, c.id, c.contentVersion || 1);
    const here = view && view.type === 'add' && view.id === c.id;
    if (!res.ok) {
      if (FAIL[res.reason]) toast(FAIL[res.reason][0], 'error', { detail: FAIL[res.reason][1] });
      if (here) render();
      return;
    }
    toast('Añadido a la sesión', 'success');
    if (typeof window.refreshTrainView === 'function') window.refreshTrainView();
    if (here) back();
  }

  async function removeFromSession(planRef, sess, id) {
    if (!window.KruxTrainStore) return;
    const res = await ops.remove(planRef, sess, id);
    if (!res.ok && FAIL[res.reason]) toast(FAIL[res.reason][0], 'error', { detail: FAIL[res.reason][1] });
    if (typeof window.refreshTrainView === 'function') window.refreshTrainView(); else renderSession(lastSession);
  }

  // ============================================
  // BLOQUE EN LA SESIÓN DEL DÍA (pantalla de Entrena)
  // ============================================
  let lastSession = null;     // { sess, plan } de la sesión mostrada
  function renderSession(st) {
    lastSession = st || null;
    const el = $('train-mental-session');
    if (!el) return;
    const items = st && st.sess && Array.isArray(st.sess.mental) ? st.sess.mental.map(m => BY_ID.get(m.id)).filter(Boolean) : [];
    if (!items.length) { el.classList.add('hidden'); el.innerHTML = ''; return; }
    el.innerHTML = `<h3 class="mx-session-title">Entrenamiento mental</h3>
      <div class="mx-rows">${items.map(c => `
        <div class="mx-row mx-row--session">
          <button type="button" class="mx-row-main" data-session-open="${esc(c.id)}">
            <span class="mx-row-text"><b>${esc(c.title)}</b><small>${I.clock} ${esc(c.durationLabel)}${doneToday(c.id) ? ` · <span class="mx-done">${I.check} Hecho hoy</span>` : ''}</small></span>
            <span class="mx-row-chev">${I.chev}</span></button>
          <button type="button" class="mx-row-x" data-session-remove="${esc(c.id)}" aria-label="${esc(`Quitar ${c.title} de la sesión`)}">${I.close}</button>
        </div>`).join('')}</div>`;
    el.classList.remove('hidden');
  }

  // ============================================
  // EVENTOS
  // ============================================
  function bind() {
    const m = modal();
    if (m && !m._mxBound) {
      m._mxBound = true;
      m.addEventListener('click', e => {
        if (!view) return;
        const f = e.target.closest('[data-filter]');
        if (f) { filter = f.dataset.filter; render(); return; }
        const cat = e.target.closest('[data-cat]');
        if (cat) { go({ type: 'cat', cat: cat.dataset.cat }); return; }
        const op = e.target.closest('[data-open]');
        if (op && BY_ID.has(op.dataset.open)) { go({ type: 'detail', id: op.dataset.open }); return; }
        const at = e.target.closest('[data-addto]');
        if (at && !at.disabled) { addToSession(parseInt(at.dataset.addto, 10)); return; }
        const b = e.target.closest('[data-mx]');
        if (!b) return;
        switch (b.dataset.mx) {
          case 'back': if (view.type === 'home' || (view.type === 'done')) closeModal(); else back(); break;
          case 'run': go({ type: 'run', id: view.id, step: 0 }); break;
          case 'next': view.step++; render(); break;
          case 'finish': {
            const id = view.id;
            const saved = markDone(id);
            if (!saved) toast('No se ha podido anotar en este dispositivo', 'info');
            view = { type: 'done', id, saved }; stack = stack.filter(v => v.type !== 'run'); render();
            break;
          }
          case 'add': go({ type: 'add', id: view.id }); break;
          case 'home': stack = []; view = { type: 'home' }; render(); break;
        }
      });
      document.addEventListener('keydown', e => { if (e.key === 'Escape' && view) closeModal(); });
    }
    const sessionBox = $('train-mental-session');
    if (sessionBox && !sessionBox._mxBound) {
      sessionBox._mxBound = true;
      sessionBox.addEventListener('click', e => {
        const op = e.target.closest('[data-session-open]');
        if (op) { stack = []; view = null; go({ type: 'detail', id: op.dataset.sessionOpen }); return; }
        const rm = e.target.closest('[data-session-remove]');
        if (rm && lastSession && lastSession.sess) {
          const id = rm.dataset.sessionRemove;
          const plan = lastSession.plan || window.kruxActivePlan;
          const run = () => removeFromSession(plan, lastSession.sess, id);
          const c = BY_ID.get(id);
          if (typeof window.kruxConfirm === 'function') window.kruxConfirm('¿Quitar de la sesión?', `«${c ? c.title : 'Este ejercicio'}» dejará de aparecer en esta sesión. Sigue disponible en la biblioteca.`, run, 'Quitar', true);
          else run();
        }
      });
    }
  }

  function open() { stack = []; view = null; go({ type: 'home' }); }

  function init() {
    bind();
    ['train-gear-mental', 'train-mental-link'].forEach(id => {
      const el = $(id); if (!el) return;
      el.hidden = false;
      el.addEventListener('click', () => {
        const menu = $('train-gear-menu'); if (menu) menu.classList.add('hidden');
        const btn = $('train-new-plan-btn'); if (btn) btn.setAttribute('aria-expanded', 'false');
        open();
      });
    });
    renderSession(lastSession);
  }

  window.KruxMentalUI = { open, renderSession, catalog: () => ({ lessons: D.lessons.length, exercises: D.exercises.length }) };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
}());

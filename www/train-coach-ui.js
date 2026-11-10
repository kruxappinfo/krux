// ================== ENTRENA — PERFIL DEL ESCALADOR: ONBOARDING Y EVALUACIÓN MENTAL ==================
// Interfaz y persistencia del perfil de entrenamiento (users/{uid}/training_profile/current) y de la evaluación
// mental inicial (users/{uid}/mental_profile/current). El modelo y la validación viven en train-profile.js.
//
// Solo se activa con KRUX_COACH (desactivado por defecto; ?coach=1 lo enciende en este navegador y ?coach=0 lo apaga).
// No bloquea Entrena: se puede saltar, completar más tarde y editar siempre. Los datos solo los lee su propietario.
//
// Persistencia: se guarda cada paso (guardado progresivo). Hay una copia en este dispositivo (localStorage, por usuario)
// y, si no hay conexión o el servidor no responde, el cambio queda pendiente y se reintenta al volver la conexión.
(function () {
  'use strict';

  // ============================================
  // INTERRUPTOR
  // ============================================
  window.KRUX_COACH = (() => {
    try {
      const q = new URLSearchParams(location.search).get('coach');
      if (q === '1') localStorage.setItem('krux.coach', '1');
      else if (q === '0') localStorage.removeItem('krux.coach');
      return q === '1' || (q !== '0' && localStorage.getItem('krux.coach') === '1');
    } catch (_) { return new URLSearchParams(location.search).get('coach') === '1'; }
  })();

  const PR = window.KruxProfile;
  if (!PR) return;

  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ENABLED = () => !!window.KRUX_COACH;
  const ACK_MS = 8000;
  const toast = (title, type, opts) => { if (typeof showToast === 'function') showToast(title, type || 'info', opts); };

  // ============================================
  // ICONOS
  // ============================================
  const svg = (body, size) => `<svg width="${size || 24}" height="${size || 24}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  const I = {
    back: svg('<polyline points="15 18 9 12 15 6"/>', 22),
    check: svg('<polyline points="20 6 9 17 4 12"/>', 14),
    close: svg('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>', 20),
    user: svg('<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>', 18),
    goal: {
      grado: svg('<polyline points="3 17 9 11 13 15 21 7"/><polyline points="15 7 21 7 21 13"/>'),
      fuerza: svg('<path d="M6.5 6.5v11M17.5 6.5v11M3 9.5v5M21 9.5v5M6.5 12h11"/>'),
      resistencia: svg('<path d="M3 12h4l2-6 4 12 2-6h6"/>'),
      tecnica: svg('<circle cx="6" cy="18" r="2"/><circle cx="18" cy="6" r="2"/><path d="M8 18h5a4 4 0 0 0 0-8h-2a4 4 0 0 1 0-8h5"/>'),
      competicion: svg('<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>'),
      forma: svg('<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z"/>')
    },
    modality: {
      deportiva: svg('<path d="M12 2v6M9 8h6l-1 14h-4z"/>'),
      bloque: svg('<path d="M4 20 9 8l4 6 3-4 4 10z"/>'),
      ambas: svg('<path d="M3 20 9 8l4 6M13 14l3-4 5 10z"/>')
    },
    exp: {
      lt1: svg('<path d="m4 19 8-12 8 12z"/>'),
      '1-2': svg('<path d="m2 19 6-9 3 4 3-5 8 10z"/>'),
      '2-4': svg('<path d="m2 20 7-11 3 4 3-6 7 13z"/><path d="M15 7V3l4 1.5L15 6"/>'),
      gt4: svg('<path d="m2 20 6-10 3 5 4-9 7 14z"/><path d="M15 6V2l4 1.5L15 5"/>')
    },
    stopwatch: svg('<circle cx="12" cy="13.5" r="7"/><path d="M12 10v3.5l2 1.5M9.5 3h5M12 3v3.5"/>', 22),
    env: {
      rocodromo: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1"/><circle cx="15" cy="9" r="1"/><circle cx="12" cy="15" r="1"/>'),
      roca: svg('<path d="m3 20 6-11 4 6 3-4 5 9z"/>'),
      ambos: svg('<path d="m2 20 5-9 3 5M10 16l3-5 4 6 5 3z"/>')
    }
  };

  // ============================================
  // ESTADO Y PERSISTENCIA
  // ============================================
  let uid = null;
  let profile = null;        // perfil normalizado (+ completedAtMs); null = sin empezar
  let mental = null;         // { schemaVersion, answers }; null = sin hacer
  let dirty = { profile: false, mental: false };
  let limits = null;         // limitaciones (opcionales): SOLO en este dispositivo, ver limRead/limWrite
  let loaded = false;
  let loadFailed = false;
  let queue = Promise.resolve();

  const lsKey = () => 'krux.coach.v1.' + uid;
  function lsRead() { try { return JSON.parse(localStorage.getItem(lsKey()) || 'null'); } catch (_) { return null; } }
  function lsWrite() {
    if (!uid) return;
    try { localStorage.setItem(lsKey(), JSON.stringify({ profile, mental, dirty })); } catch (_) { /* cuota o modo privado: sigue en memoria */ }
  }
  // Limitaciones: las reglas de Firestore solo admiten los campos del perfil en training_profile, así que no se sincronizan con la cuenta.
  const limKey = () => 'krux.coach.limits.v1.' + uid;
  function limRead() { try { const r = JSON.parse(localStorage.getItem(limKey()) || 'null'); return r ? PR.normalizeLimits(r) : null; } catch (_) { return null; } }
  function limWrite() {
    if (!uid) return false;
    try { if (limits) localStorage.setItem(limKey(), JSON.stringify(limits)); else localStorage.removeItem(limKey()); return true; } catch (_) { return false; }
  }
  // Grados de rocódromo cuando escala en ambos entornos: las reglas solo admiten grades.sport/boulder (los de roca), así que van en este dispositivo.
  const gymKey = () => 'krux.coach.gym.v1.' + uid;
  function gymRead() { try { const r = JSON.parse(localStorage.getItem(gymKey()) || 'null'); return r && typeof r === 'object' ? r : null; } catch (_) { return null; } }
  function gymWrite() {
    if (!uid || !profile) return;
    try { if (profile.gradesGym) localStorage.setItem(gymKey(), JSON.stringify(profile.gradesGym)); else localStorage.removeItem(gymKey()); } catch (_) { /* sigue en memoria */ }
  }
  // Solo lo que admite el servidor: sin gradesGym. Con rocódromo como único entorno, «grades» son los de rocódromo y no tienen objetivo:
  // un perfil completado exige uno, así que se guarda «No lo sé» (no se inventa ningún grado).
  function serverGrades(out) {
    delete out.gradesGym;
    if (out.status === 'completed' && out.environment === 'rocodromo' && out.grades) {
      ['sport', 'boulder'].forEach(sc => { if (out.grades[sc] && !out.grades[sc].target) out.grades[sc] = Object.assign({}, out.grades[sc], { target: PR.GRADE_UNKNOWN }); });
    }
    return out;
  }
  // Perfil guardado antes de separar los grados por entorno (sin copia local de rocódromo): los grados guardados se leen como de roca/rocódromo según su entorno; no se reescribe nada.
  function attachGym(p) {
    if (!p) return p;
    if (p.environment === 'ambos') { const g = gymRead(); if (g) { const n = PR.normalizeProfile(Object.assign({}, p, { gradesGym: g })); if (n.gradesGym) p.gradesGym = n.gradesGym; } }
    else delete p.gradesGym;
    return p;
  }
  const col = name => firebase.firestore().collection('users').doc(uid).collection(name).doc('current');
  const offline = () => navigator.onLine === false;
  function withTimeout(promise, ms) {
    return Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms || ACK_MS))]);
  }

  function profilePayload() {
    const { completedAtMs, ...rest } = profile;
    const out = serverGrades({ ...PR.normalizeProfile(rest), updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
    if (out.status === 'completed') out.completedAt = firebase.firestore.Timestamp.fromMillis(completedAtMs || Date.now());
    return out;
  }

  // Escribe lo pendiente con lo último que hay en memoria (idempotente: reintentar escribe lo mismo)
  async function writeDirty() {
    if (!uid || offline()) return false;
    if (dirty.profile && !profile) dirty.profile = false;
    try {
      if (dirty.profile && profile) { await withTimeout(col('training_profile').set(profilePayload())); dirty.profile = false; }
      if (dirty.mental) {
        if (mental) await withTimeout(col('mental_profile').set({ ...PR.normalizeMental(mental), updatedAt: firebase.firestore.FieldValue.serverTimestamp() }));
        else await withTimeout(col('mental_profile').delete());
        dirty.mental = false;
      }
      lsWrite();
      return !dirty.profile && !dirty.mental;
    } catch (_) { return false; }
  }

  // Cambio local inmediato + intento de envío (en serie para no cruzar escrituras)
  function persist(kind) {
    dirty[kind] = true;
    if (kind === 'profile') gymWrite();
    lsWrite();
    queue = queue.then(writeDirty, writeDirty);
    return queue.then(ok => { renderCard(); return ok; });
  }

  async function loadAll() {
    loaded = false; loadFailed = false;
    const local = lsRead();
    if (local) {
      profile = local.profile ? attachGym({ ...local.profile }) : null;
      mental = local.mental || null;
      dirty = { profile: !!(local.dirty && local.dirty.profile), mental: !!(local.dirty && local.dirty.mental) };
    } else { profile = null; mental = null; dirty = { profile: false, mental: false }; }
    renderCard();
    if (offline()) { loaded = true; loadFailed = !local; renderCard(); return; }
    try {
      const [pSnap, mSnap] = await Promise.all([withTimeout(col('training_profile').get()), withTimeout(col('mental_profile').get())]);
      if (!dirty.profile) {
        if (pSnap.exists) {
          const d = pSnap.data();
          profile = PR.normalizeProfile(d);
          if (d.completedAt && d.completedAt.toMillis) profile.completedAtMs = d.completedAt.toMillis();
          attachGym(profile);
        } else profile = null;
      }
      if (!dirty.mental) mental = mSnap.exists ? PR.normalizeMental(mSnap.data()) : null;
      lsWrite();
    } catch (_) { loadFailed = !local; }
    loaded = true;
    renderCard();
    maybeWelcome();
    if (dirty.profile || dirty.mental) persist(dirty.profile ? 'profile' : 'mental');
  }

  function onUser(user) {
    if (uid && (!user || user.uid !== uid)) {
      // Cierre de sesión o cambio de cuenta: la copia local solo se conserva si hay algo sin enviar
      if (!dirty.profile && !dirty.mental) { try { localStorage.removeItem(lsKey()); } catch (_) { /* nada */ } }
      closeModal(true); hideWelcome(true);
    }
    uid = user ? user.uid : null;
    profile = null; mental = null; dirty = { profile: false, mental: false }; loaded = false;
    limits = uid ? limRead() : null;
    const item = $('train-gear-profile');
    if (item) item.hidden = !(ENABLED() && uid);
    if (!uid || !ENABLED()) { renderCard(); return; }
    loadAll();
  }

  // ============================================
  // TARJETA «PARA TI» (pantalla principal de Entrena)
  // ============================================
  // ── Recomendaciones (train-recommender.js) ──
  let recs = null;
  const todayKey = () => (typeof trDateKey === 'function' ? trDateKey(new Date()) : new Date().toISOString().slice(0, 10));
  function computeRecs() {
    const RC = window.KruxRecommender, X = window.KruxExercises, lib = window.KruxLibrary;
    const cat = lib && lib.catalog && lib.catalog();
    if (!RC || !X || !cat || !profile) return null;
    const md = window.KRUX_MENTAL_DATA;
    try {
      return RC.recommend({
        catalog: cat, X, profile, mental, limits, history: window.kruxTrainLog || [], today: todayKey(), equipment: PR.catalogEquipment(profile),
        practices: PR.practices(profile).map(pr => { const g = PR.gradesFor(profile, pr.env, pr.scale) || {}; return { key: pr.key, label: pr.label, env: pr.env, scale: pr.scale, usual: g.usualFrom, max: g.max }; }),
        mentalItems: md ? md.exercises.map(e => ({ id: e.id, title: e.title, minutes: e.durationMin, categoryId: e.categoryId })) : []
      });
    } catch (e) { console.error('Recomendador:', e); return null; }
  }
  function recsHTML(r) {
    if (!r) return '<p class="cx-note">Las recomendaciones no están disponibles ahora mismo.</p>';
    const cards = r.items.map(i => recCard(i)).join('');
    return `${cards}${r.empty ? `<p class="cx-note">${esc(r.empty)}</p>` : ''}<p class="cx-note">${esc(r.note)}</p>`;
  }
  function startRecommendation(id) {
    const r = recs && recs.items.find(i => i.id === id);
    if (!r) return;
    if (r.kind === 'mental') { if (window.KruxMentalUI && window.KruxMentalUI.openItem) window.KruxMentalUI.openItem(r.mentalId); return; }
    if (window.KruxTrainSession && window.KruxTrainSession.isRunning()) { toast('Ya tienes un entrenamiento abierto', 'info'); return; }
    // Mismo flujo que una sesión de plan: el entrenamiento en curso y su registro final los gestiona app_3.js (sin plan asociado)
    window.kruxTrainData = {
      name: r.session.name, exercises: JSON.parse(JSON.stringify(r.session.exercises)).map(e => { delete e.why; return e; }), demo: false,
      planId: null, planName: '', planRevision: null, planSessionId: null
    };
    if (typeof window.openActiveSession === 'function') window.openActiveSession();
  }

  function renderCard() {
    const el = $('train-foryou');
    if (!el) return;
    if (!ENABLED() || !uid || !loaded) { el.classList.add('hidden'); el.innerHTML = ''; return; }
    const pending = (dirty.profile || dirty.mental) ? '<p class="cx-note" role="status">Guardado en este dispositivo. Se enviará cuando haya conexión.</p>' : '';
    const status = profile ? profile.status : null;
    let html = '';
    if (status === 'in_progress' || status === 'skipped') {
      // Sin perfil no hay tarjeta: la bienvenida es el modal. Aquí solo queda el acceso para retomar o empezar tras «Ahora no».
      const started = status === 'in_progress';
      html = `
        <p class="cx-kicker">Para ti</p>
        <h2 class="cx-card-title">${started ? 'Sigue donde lo dejaste' : 'Personaliza tu entrenamiento'}</h2>
        <p class="cx-card-text">${started ? 'Te quedan unas pocas preguntas para personalizar Entrena.' : 'Cuéntanos cómo escalas y Krux preparará entrenamientos adaptados a ti.'}</p>
        <div class="cx-card-actions">
          <button type="button" class="cx-btn cx-btn--primary" data-cx="start">${started ? 'Continuar' : 'Empezar'}</button>${started ? '\n          <button type="button" class="cx-btn cx-btn--ghost" data-cx="later">Ahora no</button>' : ''}
        </div>${pending}`;
    } else if (status === 'completed') {
      const rows = PR.summarize(profile).filter(r => ['goal', 'availability'].includes(r.key));
      const mentalLine = PR.mentalIsComplete(mental) ? '' : '<p class="cx-note">Evaluación mental pendiente · opcional</p>';
      recs = computeRecs();
      html = `
        <p class="cx-kicker">Para ti</p>
        <h2 class="cx-card-title">Entrenamientos recomendados</h2>
        ${recsHTML(recs)}
        <div class="cx-profile-line"><div><b>Tu perfil de escalador</b><span>${esc(rows.map(r => r.value).join(' · '))}</span></div>
          <button type="button" class="cx-btn cx-btn--secondary" data-cx="profile">Ver y editar</button></div>
        ${mentalLine}${pending}`;
    }
    el.innerHTML = html;
    el.classList.toggle('hidden', !html);
    document.dispatchEvent(new CustomEvent('krux:coach-change'));
  }

  document.addEventListener('click', e => {
    const go = e.target.closest && e.target.closest('#train-foryou [data-rec]');
    if (go) { startRecommendation(go.dataset.rec); return; }
    const op = e.target.closest && e.target.closest('#train-foryou [data-rec-open]');
    if (op) { openRec(op.dataset.recOpen, 'card'); return; }
    const b = e.target.closest && e.target.closest('#train-foryou [data-cx]');
    if (!b) return;
    const act = b.dataset.cx;
    if (act === 'start') openWizard(profile ? PR.firstIncompleteStep(profile) : 1);
    else if (act === 'profile') openHub();
    else if (act === 'later') {
      profile = Object.assign(PR.normalizeProfile(profile || {}), { status: 'skipped' });
      persist('profile');
      toast('Perfil pendiente', 'info', { detail: 'Lo encontrarás en el menú de Entrena cuando quieras.' });
    }
  });

  // ============================================
  // BIENVENIDA (popup de primera vez en Entrena)
  // ============================================
  // Aparece (también si la carga del servidor falla: el perfil queda en local y se reintenta) solo si no existe ningún perfil (ni en curso, ni saltado): «Ahora no» guarda el perfil como «skipped» (igual que «Ahora no» de la
  // tarjeta), y abandonar el cuestionario lo deja «en curso» (se retoma desde la tarjeta o el menú), así que no vuelve a salir.
  const reduceMotion = () => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) { return false; } };
  let welcomeEl = null;
  const trainActive = () => { const v = $('train-view'); return !!v && v.classList.contains('active') && !v.classList.contains('hidden'); };
  function welcomeOpen() { return !!welcomeEl; }
  function maybeWelcome() {
    if (!ENABLED() || !uid || !loaded || profile || welcomeEl || view || !trainActive()) return;
    if (window.KruxTrainSession && window.KruxTrainSession.isRunning()) return;
    showWelcome();
  }
  function showWelcome() {
    const el = document.createElement('div');
    el.id = 'coach-welcome'; el.className = 'cw-backdrop';
    el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-labelledby', 'cw-title'); el.setAttribute('aria-describedby', 'cw-text');
    el.innerHTML = `<div class="cw-card">
      <div class="cw-hero" aria-hidden="true"><span class="cw-mark">${svg('<path d="m3 20 6-11 4 6 3-4 5 9z"/><path d="M14.5 5.5l1.2 2.3 2.3 1.2-2.3 1.2-1.2 2.3-1.2-2.3L11 9l2.3-1.2z" stroke-width="1.4"/>', 30)}</span></div>
      <h2 class="cw-title" id="cw-title">Entrena a tu manera.</h2>
      <p class="cw-text" id="cw-text">Un plan de entrenamiento que evoluciona contigo y con tu escalada.</p>
      <ul class="cw-points">
        <li><span class="cw-pt-ic">${svg('<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>', 22)}</span><span class="cw-pt-tx"><b>Conoce tu nivel</b><small>Tu experiencia y modalidad.</small></span></li>
        <li><span class="cw-pt-ic">${svg('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2"/>', 22)}</span><span class="cw-pt-tx"><b>Define tus objetivos</b><small>Qué quieres mejorar.</small></span></li>
        <li><span class="cw-pt-ic">${svg('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>', 22)}</span><span class="cw-pt-tx"><b>Adapta tu entrenamiento</b><small>Tu tiempo y disponibilidad.</small></span></li>
      </ul>
      <button type="button" class="pe-save-btn pe-save-btn--wide cw-go" data-cw="go"><span>Personalizar mi entrenamiento</span></button>
      <button type="button" class="cx-btn cx-btn--ghost cw-later" data-cw="later">Ahora no</button>
    </div>`;
    document.body.appendChild(el);
    document.documentElement.classList.add('cw-lock');
    welcomeEl = el;
    el.addEventListener('click', e => {
      const b = e.target.closest('[data-cw]');
      if (b) { b.dataset.cw === 'go' ? welcomeGo() : welcomeLater(); }
    });
    requestAnimationFrame(() => requestAnimationFrame(() => { el.classList.add('is-open'); const g = el.querySelector('.cw-go'); if (g) g.focus({ preventScroll: true }); }));
  }
  function hideWelcome(now) {
    const el = welcomeEl; if (!el) return;
    welcomeEl = null;
    document.documentElement.classList.remove('cw-lock');
    el.classList.remove('is-open');
    if (now || reduceMotion()) el.remove(); else setTimeout(() => el.remove(), 260);
  }
  function welcomeGo() { hideWelcome(); openWizard(1); }
  function welcomeLater() {
    hideWelcome();
    profile = Object.assign(PR.normalizeProfile(profile || {}), { status: 'skipped' });
    persist('profile');
    toast('Perfil pendiente', 'info', { detail: 'Lo encontrarás en el menú de Entrena cuando quieras.' });
  }

  // ============================================
  // MODAL
  // ============================================
  let view = null;   // { type:'wizard'|'summary'|'mental'|'mental-done'|'hub', step, q, steps, editing }
  const modal = () => $('coach-modal');

  function openModal() {
    const m = modal();
    if (!m) return;
    m.classList.remove('hidden');
    requestAnimationFrame(() => m.classList.add('pe-open'));
    document.body.classList.add('plan-editor-open');
  }
  function closeModal(now) {
    const m = modal();
    if (!m) return;
    view = null;
    m.classList.remove('pe-open');
    document.body.classList.remove('plan-editor-open');
    if (now) { m.classList.add('hidden'); m.innerHTML = ''; } else setTimeout(() => { if (!view) { m.classList.add('hidden'); m.innerHTML = ''; } }, 280);
    renderCard();
  }

  function openWizard(step, editSteps) {
    if (!profile) profile = Object.assign(PR.normalizeProfile({}), { status: 'in_progress', step: 1 });
    view = { type: 'wizard', step: step || 1, steps: editSteps || null };
    render(); openModal();
  }
  function openHub() { view = { type: 'hub' }; render(); openModal(); }

  function shell(opts) {
    if (opts.wz) return wzShell(opts);
    const sub = opts.sub ? `<p class="pe-subtitle xl-step">${opts.sub}</p>` : '';
    const skip = opts.skip ? `<button type="button" class="cx-skip" data-cx="skip">${opts.skip}</button>` : '';
    return `
      <div class="pe-screen xl-screen">
        <header class="pe-topbar xl-topbar">
          <button type="button" class="pe-icon-btn pe-back-btn" data-cx="back" aria-label="${esc(opts.backLabel || 'Volver')}">${opts.close ? I.close : I.back}</button>
          <div class="pe-heading">${sub}<h2 class="pe-title xl-wz-title" id="cx-title" tabindex="-1">${opts.title}</h2></div>
          ${skip}
        </header>
        ${opts.progress != null ? `<div class="xl-progress" aria-hidden="true"><span style="width:${opts.progress}%;--from:${(view && view._prog) || 0}%"></span></div>` : ''}
        <div class="xl-scroll xl-wz-scroll" id="cx-scroll">${opts.body}</div>
        ${opts.footer ? `<div class="xl-pickbar cx-pickbar">${opts.footer}</div>` : ''}
      </div>`;
  }

  // Cabecera del cuestionario: volver + «Paso X de N» + Saltar, barra segmentada y título con texto de apoyo
  function wzShell(opts) {
    const segs = Array.from({ length: opts.total }, (_, i) => `<span class="cx-seg${i < opts.pos ? ' is-on' : ''}${i === opts.pos - 1 ? ' is-cur' : ''}"></span>`).join('');
    return `
      <div class="pe-screen xl-screen cx-wz">
        <header class="cx-wz-top">
          <button type="button" class="cx-wz-back" data-cx="back" aria-label="${esc(opts.backLabel || 'Volver')}">${I.back}</button>
          <span class="cx-wz-step" id="cx-step">${opts.sub}</span>
          ${opts.skip ? `<button type="button" class="cx-skip" data-cx="skip">${opts.skip}</button>` : ''}
        </header>
        <div class="cx-segs" role="progressbar" aria-valuemin="1" aria-valuemax="${opts.total}" aria-valuenow="${opts.pos}" aria-labelledby="cx-step">${segs}</div>
        <div class="xl-scroll xl-wz-scroll" id="cx-scroll">
          <div class="cx-wz-head"><h2 class="cx-wz-title" id="cx-title" tabindex="-1">${opts.title}</h2>${opts.lead ? `<p class="cx-wz-lead">${opts.lead}</p>` : ''}</div>
          ${opts.body}
        </div>
        ${opts.footer ? `<div class="xl-pickbar cx-pickbar">${opts.footer}</div>` : ''}
      </div>`;
  }

  function render(focusSel) {
    const m = modal();
    if (!m || !view) return;
    const scroll = $('cx-scroll');
    const keepTop = scroll ? scroll.scrollTop : 0;
    const prevLast = view._last || '';
    const keepType = prevLast === view.type + ':' + (view.step || view.q || '');
    let html = '';
    if (view.type === 'wizard') html = wizardScreen();
    else if (view.type === 'mental-ask') html = mentalAskScreen();
    else if (view.type === 'ready') html = readyScreen();
    else if (view.type === 'rec') html = recScreen();
    else if (view.type === 'summary') html = summaryScreen();
    else if (view.type === 'mental') html = mentalScreen();
    else if (view.type === 'mental-done') html = mentalDoneScreen();
    else if (view.type === 'preparing') html = preparingScreen();
    else if (view.type === 'limits') html = limitsScreen();
    else html = hubScreen();
    m.innerHTML = html;
    view._last = view.type + ':' + (view.step || view.q || '');
    const sc = $('cx-scroll');
    if (sc && keepType) sc.scrollTop = keepTop;
    // Transición entre preguntas: la nueva entra desde el lado de la dirección del avance (solo opacidad y transform)
    if (sc && !keepType && !reduceMotion()) {
      const cur = view.step || view.q || 0, prev = parseInt((prevLast.split(':')[1] || '0'), 10) || 0;
      const same = prevLast.split(':')[0] === view.type;
      if (view.type === 'summary') sc.classList.add('cx-reveal');
      else if (same && prev && cur) sc.classList.add(cur >= prev ? 'cx-in-fwd' : 'cx-in-back');
      else sc.classList.add('cx-in-up');
    }
    if (view.type === 'wizard' || view.type === 'mental') { const pr = document.querySelector('#coach-modal .xl-progress span'); view._prog = pr ? parseFloat(pr.style.width) : 0; }
    const keep = focusSel && m.querySelector(focusSel);
    const t = $('cx-title');
    if (keep) keep.focus({ preventScroll: true });
    else if (t && !keepType) t.focus({ preventScroll: true });
  }

  // ============================================
  // ONBOARDING (6 pasos)
  // ============================================
  const STEP_TITLES = {
    1: '¿Cuál es tu objetivo?', 2: '¿Cómo y dónde escalas?', 3: '¿Cuál es tu nivel?',
    4: '¿Cuál es tu grado objetivo?', 5: '¿Cuánto tiempo tienes?', 6: '¿Con qué material cuentas?'
  };
  const STEP_LEADS = {
    1: 'Elige lo que más quieres mejorar y, si quieres, hasta dos aspectos más.',
    2: 'Selecciona las opciones que practicas.',
    3: 'Así ajustaremos la intensidad y la progresión del plan.',
    4: 'Una aspiración personal, no una predicción de tu rendimiento.',
    5: 'Sé realista: así el plan será sostenible.',
    6: 'Solo te propondremos lo que puedas hacer con lo que marques.'
  };
  // Pasos que se recorren: el 4 (grado objetivo, solo roca) se omite si no escala en roca
  const flow = p => [1, 2, 3, 4, 5, 6].filter(n => n !== 4 || p.environment !== 'rocodromo');

  function gradeSelect(pr, key, label, opts) {
    const g = PR.gradesFor(profile, pr.env, pr.scale) || {};
    const list = PR.SCALES[pr.scale];
    const optional = opts && opts.optional;
    return `
      <label class="cx-field"><span class="pe-label">${esc(label)}</span>
        <select class="cx-select" data-grade="${pr.key}.${key}">
          <option value=""${g[key] ? '' : ' selected'}>${optional ? 'Sin indicar' : 'Elige un grado'}</option>
          ${list.map(x => `<option value="${esc(x)}"${g[key] === x ? ' selected' : ''}>${esc(x)}</option>`).join('')}
          <option value="unknown"${g[key] === 'unknown' ? ' selected' : ''}>No lo sé</option>
        </select></label>`;
  }

  function optList(items, current, attr, iconFn) {
    return `<div class="xl-opts" role="radiogroup">${items.map(o => `
      <button type="button" class="xl-opt${current === o.id ? ' is-on' : ''}" role="radio" aria-checked="${current === o.id}" data-${attr}="${o.id}">
        ${iconFn ? `<span class="xl-opt-icon">${iconFn(o.id) || ''}</span>` : ''}
        <span class="xl-opt-text"><b>${esc(o.label)}</b>${o.desc ? `<small>${esc(o.desc)}</small>` : ''}</span>
        <span class="xl-opt-check">${I.check}</span>
      </button>`).join('')}</div>`;
  }

  // Selector numérico: círculos (días) o tarjetas con cronómetro (minutos)
  function gridSeg(values, current, attr, unit, kind) {
    const cls = kind === 'time' ? 'cx-grid cx-grid--time' : 'cx-grid cx-grid--dots';
    return `<div class="${cls}" role="radiogroup" aria-labelledby="${attr === 'min' ? 'cx-min-label' : attr === 'days' ? 'cx-days-label' : 'cx-rock-label'}">${values.map(v => `<button type="button" class="xl-seg-btn${current === v ? ' is-on' : ''}" role="radio" aria-checked="${current === v}" data-${attr}="${v}">${kind === 'time' ? `<span class="cx-time-ic">${I.stopwatch}</span><b>${v}</b><small>min</small><span class="cx-badge">${I.check}</span>` : v}</button>`).join('')}</div>`;
  }

  function modTiles(current) {
    const tile = o => `<button type="button" class="cx-mod${current === o.id ? ' is-on' : ''}" role="radio" aria-checked="${current === o.id}" data-mod="${o.id}">
        <span class="cx-mod-art cx-mod-art--${esc(o.id)}" aria-hidden="true"></span>
        <span class="cx-mod-row"><span class="cx-mod-tx"><b>${esc(o.label)}</b><small>${esc(o.desc)}</small></span><span class="xl-opt-check">${I.check}</span></span>
      </button>`;
    const both = PR.MODALITY.filter(o => o.id === 'ambas'), two = PR.MODALITY.filter(o => o.id !== 'ambas');
    return `<div class="cx-mods" role="radiogroup" aria-labelledby="cx-mod-label">${two.map(tile).join('')}</div>${optList(both, current, 'mod', id => I.modality[id])}`;
  }

  function envTiles(current) {
    return `<div class="cx-tiles" role="radiogroup" aria-labelledby="cx-env-label">${PR.ENVIRONMENT.map(o => `
      <button type="button" class="cx-tile${current === o.id ? ' is-on' : ''}" role="radio" aria-checked="${current === o.id}" data-env="${o.id}">
        <span class="cx-tile-ic">${I.env[o.id]}</span><b>${esc(o.label)}</b><span class="cx-badge">${I.check}</span>
      </button>`).join('')}</div>`;
  }

  // Objetivos: principal (obligatorio) y hasta dos secundarios que no pueden repetir el principal
  function goalsBody(p) {
    const secondary = p.goalsSecondary || [];
    const name = id => PR.labelOf(PR.GOALS, id);
    const sel = p.goalPrimary ? `<div class="cx-sel" id="cx-sel" role="status" aria-live="polite">
        <div class="cx-sel-row"><span class="cx-sel-k">Principal</span><span class="cx-pill cx-pill--main">${esc(name(p.goalPrimary))}</span></div>
        <div class="cx-sel-row"><span class="cx-sel-k">Secundarios</span>${secondary.length
          ? secondary.map(id => `<button type="button" class="cx-pill" data-sec="${id}" aria-label="Quitar ${esc(name(id))}">${esc(name(id))}<span aria-hidden="true">${I.close}</span></button>`).join('')
          : '<span class="cx-sel-none">Ninguno</span>'}</div></div>` : '';
    return `${sel}
      <div class="pe-card"><h3 class="pe-label" id="cx-main-label">Objetivo principal</h3>
        <p class="pe-hint cx-sub">Lo que más quieres mejorar. Elige uno.</p>
        ${optList(PR.GOALS, p.goalPrimary, 'goal', id => I.goal[id])}</div>
      <div class="pe-card"><h3 class="pe-label" id="cx-sec-label">Objetivos secundarios <span class="cx-opt">(opcional, hasta 2)</span></h3>
        <p class="pe-hint cx-sub">Otros aspectos que también quieres trabajar.</p>
        <div class="xl-fchips" role="group" aria-labelledby="cx-sec-label">${PR.GOALS.map(g => {
          const isMain = g.id === p.goalPrimary, on = secondary.includes(g.id);
          return `<button type="button" class="xl-chip xl-chip--lg${on ? ' is-on' : ''}${isMain ? ' is-disabled' : ''}" aria-pressed="${on}"${isMain ? ' aria-disabled="true" data-sec-main="1" title="Ya es tu objetivo principal"' : ` data-sec="${g.id}"`}>${esc(g.label)}</button>`;
        }).join('')}</div>
        ${p.goalPrimary ? '<p class="pe-hint">El objetivo principal no puede ser también secundario.</p>' : ''}</div>`;
  }

  function gradeCards(p, withTarget) {
    return PR.practices(p).filter(x => !withTarget || x.target).map(pr => `
      <div class="pe-card cx-group">
        <h3 class="pe-label">${esc(pr.label)} <span class="cx-opt">(${esc(PR.SCALE_NAMES[pr.scale].replace(/^Escala /, '').replace(/ \(.*\)/, ''))})</span></h3>
        ${withTarget
          ? gradeSelect(pr, 'target', 'Grado objetivo')
          : `${gradeSelect(pr, 'usualFrom', 'Grado habitual (desde)')}${gradeSelect(pr, 'usualTo', 'Grado habitual (hasta)', { optional: true })}${gradeSelect(pr, 'max', 'Máximo encadenado')}`}
      </div>`).join('');
  }

  function stepBody(step) {
    const p = profile;
    if (step === 1) return goalsBody(p);
    if (step === 2) {
      let out = `<div class="pe-card cx-group"><h3 class="pe-label cx-cap" id="cx-mod-label">¿Qué escalas?</h3>${modTiles(p.modality)}</div>
        <div class="pe-card cx-group"><h3 class="pe-label cx-cap" id="cx-env-label">¿Dónde sueles escalar?</h3>${envTiles(p.environment)}</div>`;
      if (PR.asksRock(p)) {
        out += `<div class="pe-card cx-group" id="cx-rock-card"><h3 class="pe-label" id="cx-rock-label">¿Cuántos días a la semana escalas en roca?</h3>${gridSeg([1, 2, 3, 4, 5, 6, 7], p.rockFrequency, 'rock')}
          <div class="pe-divider" aria-hidden="true"></div>
          <h3 class="pe-label" id="cx-prio-label">¿Qué quieres priorizar? <span class="cx-opt">(opcional)</span></h3>
          <div class="xl-fchips" role="radiogroup" aria-labelledby="cx-prio-label">${PR.ROCK_PRIORITY.map(o => `<button type="button" class="xl-chip xl-chip--lg${p.rockPriority === o.id ? ' is-on' : ''}" role="radio" aria-checked="${p.rockPriority === o.id}" data-prio="${o.id}">${esc(o.label)}</button>`).join('')}</div></div>`;
      }
      return out;
    }
    if (step === 3) {
      const cards = gradeCards(p, false);
      return `<div class="pe-card"><h3 class="pe-label" id="cx-exp-label">¿Cuánto tiempo llevas escalando?</h3>
          ${optList(PR.EXPERIENCE, p.experience, 'exp', id => I.exp[id])}</div>
        ${cards}${cards ? '<p class="pe-hint">El grado habitual es con el que escalas con regularidad; el máximo es el más difícil que has encadenado. Los grados de roca y de rocódromo no son comparables, así que se piden por separado y Krux nunca los convierte.</p>' : ''}`;
    }
    if (step === 4) {
      return `${gradeCards(p, true)}<p class="pe-hint">Solo pedimos el grado objetivo en roca. Es una aspiración personal, no una predicción de tu rendimiento, y puedes cambiarla cuando quieras.</p>`;
    }
    if (step === 5) {
      return `<div class="pe-card">
        <h3 class="pe-label" id="cx-days-label">¿Cuántos días tienes disponibles para escalar a la semana?</h3>${gridSeg([1, 2, 3, 4, 5, 6, 7], p.daysPerWeek, 'days')}
        <p class="pe-hint">Cuenta los días en que podrías escalar, no los de entrenamiento complementario: Krux decide aparte cuánto entrenar fuera de la pared.</p>
        <div class="pe-divider" aria-hidden="true"></div>
        <h3 class="pe-label" id="cx-min-label">Duración de cada sesión</h3>${gridSeg(PR.MINUTES, p.minutesPerSession, 'min', '', 'time')}
        <p class="pe-hint">Podrás ajustarlo después. Sirve para proponerte entrenamientos que quepan en tu semana.</p></div>`;
    }
    const eq = p.equipment || [];
    return `<div class="pe-card"><div class="xl-fchips" role="group" aria-label="Material disponible">${PR.EQUIPMENT.map(o => `
      <button type="button" class="xl-chip xl-chip--lg${eq.includes(o.id) ? ' is-on' : ''}" aria-pressed="${eq.includes(o.id)}" data-eq="${o.id}">${esc(o.label)}</button>`).join('')}</div>
      ${eq.includes('otro') ? `<label class="cx-field"><span class="pe-label">¿Qué otro material?</span><input type="text" class="cx-input" id="cx-other" maxlength="60" value="${esc(p.equipmentOther || '')}" autocomplete="off"></label>` : ''}
      <p class="pe-hint">Solo se te propondrá lo que puedas hacer con lo que marques. El peso corporal siempre cuenta.</p></div>`;
  }

  function wizardScreen() {
    const editing = !!view.steps;
    const list = editing ? view.steps : flow(profile);
    const ask = askMental();
    const total = list.length + (ask ? 1 : 0);
    const pos = Math.max(1, list.indexOf(view.step) + 1);
    const last = pos === total;
    const ok = PR.stepIsValid(view.step, profile);
    return shell({
      wz: true, pos, total, lead: STEP_LEADS[view.step],
      title: STEP_TITLES[view.step],
      sub: editing ? `Editar perfil · ${pos} de ${total}` : `Paso ${pos} de ${total}`,
      backLabel: pos === 1 ? 'Cerrar' : 'Paso anterior',
      skip: (editing || view.adjust) ? '' : 'Saltar',
      body: stepBody(view.step),
      footer: `<button type="button" class="pe-save-btn pe-save-btn--wide" id="cx-next" data-cx="next"${ok ? '' : ' disabled'}><span>${last ? (editing ? 'Guardar' : 'Terminar') : 'Siguiente'}</span></button>`
    });
  }

  function refreshNext() {
    const b = $('cx-next');
    if (b && view && view.type === 'wizard') b.disabled = !PR.stepIsValid(view.step, profile);
  }

  function setGrade(path, value) {
    const [env, scale, key] = path.split('.');
    PR.setGradeFor(profile, env, scale, key, value);
  }

  // Al elegir «Ambos» aparecen las preguntas de roca debajo: la tarjeta entra con fundido y la pantalla baja suavemente hasta ella
  function revealRock() {
    const card = $('cx-rock-card'), sc = $('cx-scroll');
    if (!card || !sc) return;
    if (!reduceMotion()) card.classList.add('cx-rock-in');
    setTimeout(() => {
      const top = sc.scrollTop + card.getBoundingClientRect().top - sc.getBoundingClientRect().top - 12;
      try { sc.scrollTo({ top, behavior: reduceMotion() ? 'auto' : 'smooth' }); } catch (_) { sc.scrollTop = top; }
    }, reduceMotion() ? 0 : 220);
  }

  function onWizardClick(e) {
    const el = e.target.closest('[data-sec-main],[data-goal],[data-sec],[data-exp],[data-days],[data-min],[data-mod],[data-env],[data-rock],[data-prio],[data-eq]');
    if (!el) return false;
    const d = el.dataset;
    const hadRock = profile ? PR.asksRock(profile) : false;
    if (d.secMain) { toast('Ya es tu objetivo principal', 'info'); return true; }
    if (d.goal) { profile.goalPrimary = d.goal; profile.goalsSecondary = (profile.goalsSecondary || []).filter(x => x !== d.goal); if (!profile.goalsSecondary.length) delete profile.goalsSecondary; }
    else if (d.sec) {
      const cur = profile.goalsSecondary || [];
      const next = cur.includes(d.sec) ? cur.filter(x => x !== d.sec) : (cur.length < 2 ? cur.concat(d.sec) : cur);
      if (next.length === cur.length && !cur.includes(d.sec)) toast('Máximo dos objetivos secundarios', 'info');
      if (next.length) profile.goalsSecondary = next; else delete profile.goalsSecondary;
    }
    else if (d.exp) profile.experience = d.exp;
    else if (d.days) profile.daysPerWeek = parseInt(d.days, 10);
    else if (d.min) profile.minutesPerSession = parseInt(d.min, 10);
    else if (d.mod) profile.modality = d.mod;
    else if (d.env) {
      PR.withEnvironment(profile, d.env);           // los grados de cada entorno se conservan en su entorno
      if (d.env !== 'ambos') { delete profile.rockFrequency; delete profile.rockPriority; }
    }
    else if (d.rock) profile.rockFrequency = parseInt(d.rock, 10);
    else if (d.prio) profile.rockPriority = profile.rockPriority === d.prio ? undefined : d.prio;
    else if (d.eq) {
      let eq = profile.equipment || [];
      if (d.eq === 'ninguno') eq = eq.includes('ninguno') ? [] : ['ninguno'];
      else {
        eq = eq.filter(x => x !== 'ninguno');
        eq = eq.includes(d.eq) ? eq.filter(x => x !== d.eq) : eq.concat(d.eq);
      }
      if (eq.length) profile.equipment = eq; else delete profile.equipment;
      if (!eq.includes('otro')) delete profile.equipmentOther;
    }
    if (profile.rockPriority === undefined) delete profile.rockPriority;
    const attr = Object.keys(d)[0];
    render(`[data-${attr.replace(/[A-Z]/g, c => '-' + c.toLowerCase())}="${d[attr]}"]`);
    if (d.env && !hadRock && PR.asksRock(profile)) revealRock();
    return true;
  }

  // 2-4) breve transición de preparación y, después, el recomendador (el mismo de «Para ti», con sus filtros de seguridad)
  function goPreparing() {
    const token = view = { type: 'preparing', _prog: 100 }; render();
    setTimeout(() => { if (view === token) { view = { type: 'ready' }; render(); } }, reduceMotion() ? 250 : 1900);
  }

  // Última pantalla del cuestionario físico: ¿incluir entrenamiento mental? (no se guarda nada si responde que no)
  const askMental = () => !!view && view.type === 'wizard' && !view.steps && !view.adjust && !PR.mentalAnswered(mental);
  function mentalAskScreen() {
    const total = flow(profile).length + 1, pick = view.pick;
    const card = (id, title, text, icon) => `<button type="button" class="xl-opt cx-ask${pick === id ? ' is-on' : ''}" role="radio" aria-checked="${pick === id}" data-mental-ask="${id}">
        <span class="xl-opt-icon">${icon}</span><span class="xl-opt-text"><b>${title}</b><small>${text}</small></span><span class="xl-opt-check">${I.check}</span></button>`;
    return wzShell({
      pos: total, total, sub: `Paso ${total} de ${total}`, skip: 'Saltar', backLabel: 'Paso anterior',
      title: '¿Quieres incluir entrenamiento mental?',
      lead: 'La escalada no es solo fuerza y técnica. También podemos ayudarte a trabajar la confianza, la concentración y la gestión del miedo.',
      body: `<div class="xl-opts" role="radiogroup" aria-label="Entrenamiento mental">
          ${card('yes', 'Sí, incluirlo', 'Quiero trabajar también mi preparación psicológica.', BRAIN)}
          ${card('no', 'No por ahora', 'Prefiero centrarme inicialmente en el entrenamiento físico.', svg('<path d="M6.5 6.5v11M17.5 6.5v11M3 9.5v5M21 9.5v5M6.5 12h11"/>', 26))}</div>
        <p class="cx-ask-note">${svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>', 20)}<span>Siempre podrás activar el entrenamiento mental más adelante desde tu plan.</span></p>
        <p class="pe-hint">Si lo incluyes, tus respuestas son privadas: solo las ves tú. Esto es contenido educativo y deportivo, no sustituye apoyo profesional.</p>`,
      footer: `<button type="button" class="pe-save-btn pe-save-btn--wide" id="cx-next" data-cx="next"${pick ? '' : ' disabled'}><span>${pick === 'yes' ? 'Continuar' : 'Crear mi plan'}</span></button>`
    });
  }

  async function wizardNext() {
    if (!PR.stepIsValid(view.step, profile)) return;
    const editing = !!view.steps;
    const lastEdit = editing && view.step === view.steps[view.steps.length - 1];
    const fl = flow(profile);
    const lastStep = !editing && view.step === fl[fl.length - 1];
    profile = Object.assign(PR.normalizeProfile(profile), { completedAtMs: profile.completedAtMs });
    if (editing) {
      // Guardar la edición no cambia el estado del perfil; si estaba completo, sigue completo
      if (profile.status !== 'completed') profile.step = Math.max(profile.step || 1, view.step);
      // Un cambio puede dejar el perfil incompleto (p. ej. pasar de solo deportiva a bloque): se pide lo que falta
      if (lastEdit && profile.status === 'completed' && !PR.isComplete(profile)) {
        profile.status = 'in_progress'; profile.step = PR.firstIncompleteStep(profile);
        persist('profile'); toast('Falta un dato', 'info', { detail: 'Completa lo que falta para terminar el perfil.' });
        openWizard(profile.step); return;
      }
      persist('profile');
      if (lastEdit) { view = { type: 'hub' }; render(); toast('Cambios guardados', 'success'); return; }
      view.step = view.steps[view.steps.indexOf(view.step) + 1];
      render(); return;
    }
    if (lastStep) {
      profile.status = 'completed'; profile.step = PR.STEPS; profile.completedAtMs = Date.now();
      persist('profile');                              // 1) se guarda el perfil
      // Antes de preparar el plan se ofrece (sin obligar) el entrenamiento mental, salvo que ya haya respuestas
      if (!PR.mentalAnswered(mental) && !view.adjust) { view = { type: 'mental-ask', pick: null }; render(); return; }
      goPreparing();
      return;
    }
    const nx = fl[fl.indexOf(view.step) + 1] || view.step + 1;
    if (!view.adjust) { profile.status = 'in_progress'; profile.step = nx; }   // al ajustar, el perfil sigue completo
    persist('profile');
    view.step = nx;
    render();
  }

  function wizardBack() {
    if (view.steps) {
      const i = view.steps.indexOf(view.step);
      if (i > 0) { view.step = view.steps[i - 1]; render(); } else { view = { type: 'hub' }; render(); }
      return;
    }
    const fl = flow(profile), i = fl.indexOf(view.step);
    if (i > 0) { view.step = fl[i - 1]; render(); return; }
    if (view.adjust) { view = { type: 'ready' }; render(); return; }
    saveDraftAndClose();
  }

  // Cerrar a mitad: lo respondido ya está guardado (guardado progresivo); queda «en curso»
  function saveDraftAndClose() {
    if (profile && profile.status !== 'completed') { profile = Object.assign(PR.normalizeProfile(profile), { status: 'in_progress' }); persist('profile'); }
    closeModal();
  }

  // ============================================
  // RESUMEN
  // ============================================
  // Tarjeta resumida de una recomendación (Entrena y fin del onboarding): qué hacer de un vistazo. El porqué y el cómo, en su ficha.
  const libCat = () => { const l = window.KruxLibrary; return l && l.catalog ? l.catalog() : null; };
  const BRAIN = svg('<path d="M9.5 3.5a3 3 0 0 0-3 3 3 3 0 0 0-2.5 4.4A3.2 3.2 0 0 0 5.5 17a3 3 0 0 0 4 3.2V3.9a3 3 0 0 0 0-.4z"/><path d="M14.5 3.5a3 3 0 0 1 3 3 3 3 0 0 1 2.5 4.4 3.2 3.2 0 0 1-1.5 6.1 3 3 0 0 1-4 3.2V3.9"/>', 26);
  const CHEV = svg('<polyline points="9 18 15 12 9 6"/>', 20);
  function focusIcon(focus, size) {
    if (focus === 'mental') return BRAIN;
    const l = window.KruxLibrary, cat = focus === 'recuperacion' ? 'movilidad' : focus;
    return l && l.categoryIcon ? l.categoryIcon(cat, size || 26) : '';
  }
  const recFocus = i => (i.kind === 'mental' ? 'mental' : (i.soft ? 'recuperacion' : i.focus || 'general'));
  const recMeta = i => [`~${i.minutes} min`, i.kind === 'mental' ? '' : `Dificultad ${i.level.toLowerCase()}`, i.kind === 'mental' ? i.demand : `Exigencia ${i.demand.toLowerCase()}`].filter(Boolean);
  function recCard(i, o) {
    o = o || {};
    const f = recFocus(i);
    const act = i.kind === 'mental' ? `data-rec="${esc(i.id)}"` : `data-rec-open="${esc(i.id)}"`;
    return `<button type="button" class="cx-rec${i.soft ? ' is-soft' : ''}${o.featured ? ' is-featured' : ''}" data-rec-id="${esc(i.id)}" ${act} aria-label="${esc(`${i.title}. ${recMeta(i).join(', ')}. ${i.kind === 'mental' ? 'Abrir práctica' : 'Ver entrenamiento'}`)}">
      <span class="cx-rec-art cx-art--${esc(f)}" aria-hidden="true">${focusIcon(f, 28)}</span>
      <span class="cx-rec-body">
        ${o.featured ? '<span class="cx-rec-badge">Tu primer entrenamiento</span>' : ''}
        <b class="cx-rec-title">${esc(i.title)}</b>
        <span class="cx-rec-meta">${esc(recMeta(i).join(' · '))}</span>
        ${i.objective.toLowerCase() !== i.title.toLowerCase() ? `<small class="cx-rec-obj">${esc(i.objective)}</small>` : ''}
      </span>
      <span class="cx-rec-chev" aria-hidden="true">${CHEV}</span>
    </button>`;
  }

  // ============================================
  // FICHA DE UN ENTRENAMIENTO (Resumen · Ejercicios · Consejos)
  // ============================================
  // Bloques de la sesión según sus ejercicios: la movilidad del principio es el calentamiento y la del final, la vuelta a la calma
  function sessionBlocks(exs) {
    const cat = libCat();
    const catEx = it => { const g = window.KruxGuide ? window.KruxGuide.idFor(it) : null; return cat && g ? cat.byId.get(g) : null; };
    const mob = it => { const ex = catEx(it); return !!ex && ex.categoryIds.includes('movilidad'); };
    let a = 0; while (a < exs.length - 1 && mob(exs[a])) a++;
    let b = exs.length; while (b > a + 1 && mob(exs[b - 1])) b--;
    return [
      { key: 'warm', name: 'Calentamiento', items: exs.slice(0, a) },
      { key: 'main', name: 'Bloque principal', items: exs.slice(a, b) },
      { key: 'cool', name: 'Vuelta a la calma', items: exs.slice(b) }
    ].filter(x => x.items.length);
  }
  const BLOCK_ICON = {
    warm: svg('<circle cx="12" cy="13.5" r="7"/><path d="M12 10v3.5l2 1.5M9.5 3h5M12 3v3.5"/>', 22),
    main: svg('<path d="M6.5 6.5v11M17.5 6.5v11M3 9.5v5M21 9.5v5M6.5 12h11"/>', 22),
    cool: svg('<circle cx="13" cy="4.5" r="1.8"/><path d="M7 21l3-6 3 2v4M10 15l1-5 4 3 3-1M11 10l-3 1-2 3"/>', 22)
  };
  const minutesOf = items => { const X = window.KruxExercises; return X && X.estimateMinutes ? X.estimateMinutes(items) : 0; };
  const workOf = ex => (typeof trFmtWork === 'function' ? trFmtWork(ex) : `${ex.sets} series`);
  const durOf = sec => (typeof trFmtDuration === 'function' ? trFmtDuration(sec) : `${sec} s`);

  function exCard(ex) {
    const cat = libCat(), gid = window.KruxGuide ? window.KruxGuide.idFor(ex) : null, c = cat && gid ? cat.byId.get(gid) : null;
    const parts = [workOf(ex), ex.weight > 0 ? `+${ex.weight} kg` : ''].filter(Boolean).join(' · ');
    const inner = `<span class="cx-ex-art cx-art--${esc(c ? c.primaryCategoryId : 'general')}"${gid ? ` style="--ex-img:url('assets/train/ex/${esc(gid)}.jpg')"` : ''} aria-hidden="true">${focusIcon(c ? c.primaryCategoryId : 'general', 24)}</span>
      <span class="cx-ex-body"><b>${esc(ex.name)}</b><span class="cx-ex-spec">${esc(parts)}</span>${ex.restSec ? `<small>Descanso ${esc(durOf(ex.restSec))}</small>` : ''}</span>
      ${gid ? `<span class="cx-ex-how">Cómo hacerlo</span>` : ''}`;
    return gid
      ? `<button type="button" class="cx-ex" data-guide="${esc(gid)}" aria-label="${esc(`${ex.name}. ${parts}${ex.restSec ? `, descanso ${durOf(ex.restSec)}` : ''}. Ver instrucciones`)}">${inner}</button>`
      : `<div class="cx-ex">${inner}</div>`;
  }

  function openRec(id, from) {
    const i = recs && recs.items.find(x => x.id === id);
    if (!i || i.kind !== 'session') return;
    view = { type: 'rec', id, tab: 'resumen', from: from || 'card' };
    render();
    if (from !== 'summary') openModal();
  }

  // Ficha de una sesión del plan activo: misma pantalla que las recomendaciones, con los ejercicios reales del plan
  function planPseudoRec(sess, plan) {
    const cat = libCat(), G = window.KruxGuide;
    const exs = sess.exercises || [];
    const cx = exs.map(it => { const g = G ? G.idFor(it) : null; return cat && g ? cat.byId.get(g) : null; }).filter(Boolean);
    const count = {};
    cx.forEach(e => { if (e.primaryCategoryId !== 'movilidad') count[e.primaryCategoryId] = (count[e.primaryCategoryId] || 0) + 1; });
    const focus = Object.keys(count).sort((a, b) => count[b] - count[a])[0] || (cx[0] && cx[0].primaryCategoryId) || 'general';
    const fc = cat && cat.catById ? cat.catById.get(focus) : null, X = window.KruxExercises;
    const lvl = cx.length ? Math.max(...cx.map(e => e.technicalLevel)) : 0, dem = cx.length ? Math.max(...cx.map(e => e.physicalDemand)) : 0;
    const eq = [...new Set(cx.flatMap(e => (e.equipment && e.equipment.required) || []))].filter(id => id !== 'peso-corporal').map(id => (cat.eqById.get(id) || { name: id }).name.toLowerCase());
    const DAYS = { L: 'lunes', M: 'martes', X: 'miércoles', J: 'jueves', V: 'viernes', S: 'sábado', D: 'domingo' };
    return {
      pseudo: true, kind: 'session', id: 'plan-' + (sess.id || sess.name), focus, title: sess.name, objective: fc ? fc.name : (plan.name || 'Sesión'),
      minutes: typeof trEstimateMinutes === 'function' ? trEstimateMinutes(exs) : 0, level: X && lvl ? X.LEVEL_LABELS[lvl] : '', demand: X && dem ? X.DEMAND_LABELS[dem] : '',
      equipment: eq, reason: '', safety: null, soft: false, practice: null, dayName: DAYS[sess.day] || '',
      session: { name: sess.name, exercises: exs }, _sess: sess, _plan: plan
    };
  }
  function openPlanSession(sessId) {
    const plan = window.kruxActivePlan;
    const sess = plan && (plan.sessions || []).find(x => (x.id || x.name) === sessId);
    if (!sess) return;
    view = { type: 'rec', id: 'plan-' + sessId, pseudo: planPseudoRec(sess, plan), tab: 'resumen', from: 'plan' };
    render(); openModal();
  }
  function startPlanSession() {
    const i = view && view.pseudo; if (!i) return;
    if (window.KruxTrainSession && window.KruxTrainSession.isRunning()) { toast('Ya tienes un entrenamiento abierto', 'info'); return; }
    const plan = i._plan, sess = i._sess;
    closeModal(true);
    // Mismo flujo que «Comenzar entrenamiento» de Entrena (app_3.js): el registro lo gestiona el módulo de sesión
    window.kruxTrainData = { name: sess.name, exercises: sess.exercises, demo: false, planId: plan.id || null, planName: plan.name || '', planRevision: plan.revision || null, planSessionId: sess.id || null };
    if (typeof window.openActiveSession === 'function') window.openActiveSession();
  }

  function recScreen() {
    const i = view.pseudo || (recs && recs.items.find(x => x.id === view.id));
    if (!i) return shell({ title: 'Entrenamiento', close: true, body: '<div class="pe-card"><p class="xl-text">Esta propuesta ya no está disponible.</p></div>' });
    const exs = i.session.exercises, blocks = sessionBlocks(exs), tab = view.tab;
    const practice = i.practice && profile ? (PR.practices(profile).find(p => p.key === i.practice) || {}).label : '';
    const tabs = [['resumen', 'Resumen'], ['ejercicios', 'Ejercicios'], ['consejos', 'Consejos']];
    let body = '';
    if (tab === 'resumen') {
      const eq = i.equipment.length ? i.equipment.join(', ') : 'Sin material';
      const facts = [['Duración', `~${i.minutes} min`], i.level ? ['Dificultad', i.level] : null, i.demand ? ['Exigencia', i.demand] : null, practice ? ['Modalidad', practice] : null, ['Material', eq.charAt(0).toUpperCase() + eq.slice(1)]].filter(Boolean);
      const cat = libCat(), fc = cat && cat.catById ? cat.catById.get(i.focus) : null;
      const main = blocks.find(b => b.key === 'main');
      body = `<div class="cx-d-card cx-d-goal"><span class="cx-d-goal-ic">${svg('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2"/>', 26)}</span>
          <div><b>Objetivo</b><p>${esc(i.objective)}${fc && fc.description ? ` · ${esc(fc.description)}` : ''}${i.soft ? ' · sesión suave para recuperar' : ''}</p></div></div>
        <ul class="cx-d-facts">${facts.map(f => `<li><span>${esc(f[0])}</span><b>${esc(f[1])}</b></li>`).join('')}</ul>
        <section class="cx-d-card"><h3 class="cx-d-h">Estructura de la sesión</h3>
          <ul class="cx-blocks">${blocks.map(b => `<li class="cx-block cx-block--${b.key}"><span class="cx-block-ic">${BLOCK_ICON[b.key]}</span><b>${esc(b.name)}</b><span>~${minutesOf(b.items)} min</span></li>`).join('')}</ul></section>
        ${main ? `<section class="cx-d-card"><h3 class="cx-d-h">Ejercicios principales</h3><div class="cx-ex-list">${main.items.map(exCard).join('')}</div></section>` : ''}`;
    } else if (tab === 'ejercicios') {
      body = blocks.map(b => `<section class="cx-d-sec"><h3 class="cx-d-h">${esc(b.name)} <span>· ~${minutesOf(b.items)} min</span></h3><div class="cx-ex-list">${b.items.map(exCard).join('')}</div></section>`).join('')
        + '<p class="cx-d-foot">Pulsa un ejercicio para ver cómo se hace. La prescripción es la base del catálogo: subir la carga es decisión tuya.</p>';
    } else {
      const why = (i.reason || '').split('. ').map((t, k, a) => (k < a.length - 1 ? t + '.' : t)).filter(Boolean);
      const notes = i.pseudo ? exs.filter(e => e.notes || e.rpeTarget) : [];
      body = (why.length ? `<section class="cx-d-card"><h3 class="cx-d-h">Por qué te lo recomendamos</h3><ul class="cx-d-list">${why.map(t => `<li>${esc(t)}</li>`).join('')}</ul></section>` : '')
        + (notes.length ? `<section class="cx-d-card"><h3 class="cx-d-h">Notas de tu plan</h3><ul class="cx-d-list">${notes.map(e => `<li><b>${esc(e.name)}</b>${e.rpeTarget ? ` · RPE ${esc(e.rpeTarget)}` : ''}${e.notes ? `: ${esc(e.notes)}` : ''}</li>`).join('')}</ul></section>` : '')
        + (i.safety ? `<section class="cx-d-card cx-d-safe cx-rec-safety--${esc(i.safety.state)}"><h3 class="cx-d-h">Limitaciones</h3><p>${esc(i.safety.text)}</p></section>` : '')
        + (!i.pseudo && recs && recs.note ? `<section class="cx-d-card"><h3 class="cx-d-h">Sobre estas propuestas</h3><p>${esc(recs.note)}</p></section>` : '');
      if (!body) body = '<section class="cx-d-card"><p>Esta sesión no tiene consejos propios. Pulsa un ejercicio en la pestaña Ejercicios para ver cómo se hace.</p></section>';
    }
    return `
      <div class="pe-screen xl-screen cx-d">
        <div class="xl-scroll cx-d-scroll" id="cx-scroll">
          <header class="cx-d-hero cx-art--${esc(recFocus(i))}">
            <button type="button" class="cx-d-back" data-cx="back" aria-label="${view.from === 'summary' ? 'Volver a las propuestas' : 'Volver a Entrena'}">${I.back}</button>
            <div class="cx-d-hero-tx">
              <p class="cx-d-kicker">${i.pseudo ? (i.dayName ? 'Tu plan · ' + esc(i.dayName) : 'Sesión de tu plan') : i.soft ? 'Recuperación' : 'Recomendado para ti'}</p>
              <h2 class="cx-d-title" id="cx-title" tabindex="-1">${esc(i.title)}</h2>
              <p class="cx-d-meta"><span>${BLOCK_ICON.warm} ~${i.minutes} min</span>${i.demand ? `<span>${svg('<path d="M5 20v-5M12 20v-9M19 20V5"/>', 20)} Exigencia ${esc(i.demand.toLowerCase())}</span>` : ''}</p>
            </div>
          </header>
          <div class="cx-d-tabs" role="tablist" aria-label="Secciones del entrenamiento">${tabs.map(t => `<button type="button" role="tab" class="cx-d-tab${tab === t[0] ? ' is-on' : ''}" aria-selected="${tab === t[0]}" data-cx-tab="${t[0]}">${t[1]}</button>`).join('')}</div>
          <div class="cx-d-body" role="tabpanel">${body}</div>
        </div>
        <div class="xl-pickbar cx-pickbar cx-d-foot-bar"><button type="button" class="pe-save-btn pe-save-btn--wide cx-d-start" ${i.pseudo ? 'data-plan-start="1"' : `data-rec="${esc(i.id)}"`}>${svg('<path d="M7 4.5v15l12-7.5z" fill="currentColor" stroke="none"/>', 18)}<span>Comenzar sesión</span></button></div>
      </div>`;
  }

  function preparingScreen() {
    const steps = ['Revisando tu perfil', 'Aplicando tus limitaciones', 'Eligiendo los ejercicios'];
    return shell({
      title: 'Preparando tu entrenamiento', close: true, backLabel: 'Cerrar',
      body: `<div class="cx-prep" role="status" aria-live="polite">
        <div class="cx-prep-orb" aria-hidden="true"><span></span><span></span>${svg('<path d="m3 20 6-11 4 6 3-4 5 9z"/>', 34)}</div>
        <p class="cx-prep-title">Estamos preparando un entrenamiento para ti</p>
        <ul class="cx-prep-steps">${steps.map((t, i) => `<li style="--i:${i}">${esc(t)}</li>`).join('')}</ul></div>`
    });
  }

  // ============================================
  // PLAN LISTO
  // ============================================
  // Entre la preparación y las propuestas: resume lo que el usuario ha respondido (datos reales del perfil)
  function readyScreen() {
    const p = profile, total = flow(p).length;
    const names = [p.goalPrimary].concat(p.goalsSecondary || []).filter(Boolean).map(id => PR.labelOf(PR.GOALS, id));
    const rows = [
      [svg('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>', 24), `${p.daysPerWeek} ${p.daysPerWeek === 1 ? 'día disponible' : 'días disponibles'} a la semana`],
      [I.stopwatch.replace('width="22" height="22"', 'width="24" height="24"'), `~${p.minutesPerSession} minutos por sesión`],
      [svg('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2"/>', 24), `Objetivo: ${names.join(', ')}`],
      [svg('<path d="m2 20 6-10 3 5 4-9 7 14z"/>', 24), `Experiencia: ${PR.labelOf(PR.EXPERIENCE, p.experience).toLowerCase()}`]
    ].filter(r => !/undefined|NaN|: $/.test(r[1]));
    const flag = `<svg class="cx-flag" viewBox="0 0 220 110" aria-hidden="true"><path d="M0 110c14-26 34-34 58-26 14-16 34-18 52-4 24-30 50-26 64 6 16-8 32-4 46 24z" fill="#E3ECE5"/><path d="M52 110 108 34l54 76z" fill="#8CB099"/><path d="M92 110l22-30 24 30z" fill="#6E9C80"/><path d="M60 110l26-34 16 22 8-12 14 24z" fill="#A9C5B2"/><path d="M108 34V8" stroke="#153E35" stroke-width="3" stroke-linecap="round"/><path d="M108 8l26 8-26 8z" fill="#153E35"/></svg>`;
    return `
      <div class="pe-screen xl-screen cx-wz cx-ready">
        <header class="cx-wz-top">
          <button type="button" class="cx-wz-back" data-cx="adjust" aria-label="Ajustar respuestas">${I.back}</button>
          <span class="cx-wz-step" id="cx-step">Paso ${total} de ${total}</span>
        </header>
        <div class="cx-segs" role="progressbar" aria-valuemin="1" aria-valuemax="${total}" aria-valuenow="${total}" aria-labelledby="cx-step">${Array.from({ length: total }, () => '<span class="cx-seg is-on"></span>').join('')}</div>
        <div class="xl-scroll xl-wz-scroll cx-reveal" id="cx-scroll">
          ${flag}
          <div class="cx-wz-head cx-wz-head--c"><h2 class="cx-wz-title" id="cx-title" tabindex="-1">¡Plan listo!</h2><p class="cx-wz-lead">Hemos creado tu entrenamiento personalizado según tus respuestas.</p></div>
          <ul class="cx-facts">${rows.map(r => `<li><span class="cx-fact-ic">${r[0]}</span><b>${esc(r[1])}</b></li>`).join('')}</ul>
          ${dirty.profile ? '<p class="cx-note" role="status">Guardado en este dispositivo. Se enviará cuando haya conexión.</p>' : ''}
        </div>
        <div class="xl-pickbar cx-pickbar"><div class="cx-footer-stack">
          <button type="button" class="pe-save-btn pe-save-btn--wide" data-cx="to-recs"><span>Ver mi plan</span></button>
          <button type="button" class="cx-btn cx-btn--ghost cx-adjust" data-cx="adjust">Ajustar respuestas</button>
        </div></div>
      </div>`;
  }

  // Fin del onboarding: perfil guardado → recomendador (el mismo de «Para ti», con sus filtros de seguridad) → propuestas inmediatas
  function summaryScreen() {
    const r = recs = computeRecs();
    const main = r && r.items.find(i => i.kind === 'session');
    const rest = r ? r.items.filter(i => i !== main) : [];
    const warn = PR.gradeWarnings(profile).length
      ? '<p class="pe-hint">Tu grado habitual figura por encima de tu máximo encadenado. Si es correcto, no pasa nada: puedes corregirlo desde tu perfil.</p>' : '';
    const pendingSave = (dirty.profile) ? '<p class="cx-note" role="status">Guardado en este dispositivo. Se enviará cuando haya conexión.</p>' : '';
    let body;
    if (!r) body = '<div class="pe-card"><p class="xl-text">Las recomendaciones no están disponibles ahora mismo. Tu perfil ya está guardado.</p></div>';
    else {
      body = (main ? `<p class="cx-hero-k">Krux ha preparado esto para ti</p>${recCard(main, { featured: true, noButton: true })}` : `<div class="pe-card"><p class="xl-text">${esc(r.empty || 'Ahora mismo no hay entrenamientos compatibles que proponerte.')}</p></div>`)
        + (rest.length ? `<h3 class="cx-more">${main ? 'Otras propuestas' : 'Propuestas'}</h3>${rest.map(i => recCard(i)).join('')}` : '')
        + `<p class="cx-note">${esc(r.note)}</p>`;
    }
    const mentalDone = PR.mentalAnswered(mental) > 0;
    body += `${warn}${pendingSave}
      <div class="pe-card"><h3 class="pe-label">Entrenamiento mental <span class="cx-opt">(opcional)</span></h3>
        <p class="xl-text">Cinco preguntas breves para sugerirte lecciones y ejercicios de entrenamiento mental. No es un test ni un diagnóstico. Puedes saltarte cualquier pregunta.</p>
        <div class="cx-card-actions"><button type="button" class="cx-btn cx-btn--secondary" data-cx="mental-start">${mentalDone ? 'Revisar mis respuestas' : 'Hacer la evaluación'}</button></div></div>
      <div class="cx-card-actions cx-card-actions--end"><button type="button" class="cx-btn cx-btn--ghost" data-cx="to-hub">${main ? 'Revisar mi perfil' : 'Revisar mi perfil y mis limitaciones'}</button></div>`;
    return shell({
      title: 'Tu perfil está listo', sub: 'Perfil guardado', close: true, backLabel: 'Volver a Entrena',
      body,
      footer: `<div class="cx-footer-stack">${main ? `<button type="button" class="pe-save-btn pe-save-btn--wide" data-rec="${esc(main.id)}"><span>Empezar entrenamiento</span></button>` : ''}
        <button type="button" class="cx-btn cx-btn--ghost" data-cx="close">Volver a Entrena</button></div>`
    });
  }

  // ============================================
  // EVALUACIÓN MENTAL
  // ============================================
  function startMental(from) {
    mental = mental || { schemaVersion: 1, answers: {} };
    view = { type: 'mental', q: 0, from: from || 'summary' };
    render();
  }

  function mentalScreen() {
    const qn = PR.MENTAL_QUESTIONS[view.q];
    const cur = mental && mental.answers ? mental.answers[qn.id] : undefined;
    const levels = [1, 2, 3, 4, 5];
    const onb = view.from === 'onboard';
    const body = `<div class="pe-card">
        ${onb ? '' : `<h3 class="cx-question" id="cx-q">${esc(qn.text)}</h3>`}
        <div class="cx-scale" role="radiogroup" aria-labelledby="${onb ? 'cx-title' : 'cx-q'}">${levels.map(n => `<button type="button" class="xl-seg-btn${cur === n ? ' is-on' : ''}" role="radio" aria-checked="${cur === n}" data-ans="${n}">${n}</button>`).join('')}</div>
        <div class="cx-scale-ends" aria-hidden="true"><span>1 · ${esc(qn.low)}</span><span>5 · ${esc(qn.high)}</span></div>
        <div class="cx-special">
          <button type="button" class="cx-btn cx-btn--secondary${cur === 'unknown' ? ' is-on' : ''}" aria-pressed="${cur === 'unknown'}" data-ans="unknown">${esc(PR.MENTAL_SPECIAL.unknown)}</button>
          <button type="button" class="cx-btn cx-btn--secondary${cur === 'skip' ? ' is-on' : ''}" aria-pressed="${cur === 'skip'}" data-ans="skip">${esc(PR.MENTAL_SPECIAL.skip)}</button>
        </div></div>
        <p class="pe-hint">Tus respuestas son privadas: solo las ves tú. No se muestran en tu perfil público ni se comparan con nadie.</p>`;
    if (onb) return wzShell({ pos: view.q + 1, total: PR.MENTAL_QUESTIONS.length, sub: `Entrenamiento mental · pregunta ${view.q + 1} de ${PR.MENTAL_QUESTIONS.length}`, skip: 'Saltar evaluación', backLabel: view.q === 0 ? 'Paso anterior' : 'Pregunta anterior', title: esc(qn.text), body });
    return shell({
      title: 'Evaluación mental', sub: `Pregunta ${view.q + 1} de ${PR.MENTAL_QUESTIONS.length}`,
      progress: Math.round(((view.q + 1) / PR.MENTAL_QUESTIONS.length) * 100),
      backLabel: view.q === 0 ? 'Cerrar' : 'Pregunta anterior', skip: 'Saltar evaluación',
      body
    });
  }

  function answerMental(value) {
    const qn = PR.MENTAL_QUESTIONS[view.q];
    mental.answers = Object.assign({}, mental.answers, { [qn.id]: value });
    persist('mental');
    if (view.q < PR.MENTAL_QUESTIONS.length - 1) { view.q++; render(); }
    else { view = { type: 'mental-done', from: view.from }; render(); }
  }

  function mentalDoneScreen() {
    const onb = view.from === 'onboard';
    return shell({
      title: 'Gracias, ya está guardado', close: true, backLabel: 'Cerrar',
      body: `<div class="pe-card"><p class="xl-text">Usaremos tus respuestas solo para sugerirte lecciones y ejercicios de entrenamiento mental. No generan ninguna puntuación ni etiqueta sobre ti.</p>
        <p class="pe-hint">Puedes cambiarlas, repetirlas o borrarlas cuando quieras desde tu perfil. Esto es contenido educativo y deportivo: no sustituye la ayuda de un profesional si la necesitas.</p></div>`,
      footer: `<button type="button" class="pe-save-btn pe-save-btn--wide" data-cx="${onb ? 'prepare' : view.from === 'hub' ? 'to-hub' : 'to-recs'}"><span>${onb ? 'Crear mi plan' : view.from === 'hub' ? 'Hecho' : 'Ver mis recomendaciones'}</span></button>`
    });
  }

  // ============================================
  // PERFIL (consulta y edición)
  // ============================================
  const EDIT_STEPS = { goal: [1], experience: [3], availability: [5], where: [2], equipment: [6] };
  // Grados: habitual y máximo (paso 3) y, solo en roca, objetivo (paso 4)
  const editStepsFor = key => /^grade\.roca\./.test(key) ? [3, 4] : /^grade\./.test(key) ? [3] : EDIT_STEPS[key];

  function hubScreen() {
    const complete = profile && profile.status === 'completed';
    const rows = profile ? PR.summarize(profile) : [];
    const answered = PR.mentalAnswered(mental);
    const banner = !complete ? `<div class="xl-alert xl-alert--soft" role="note"><p class="xl-text">${profile ? 'Tu perfil está a medias.' : 'Todavía no has creado tu perfil.'}</p>
      <button type="button" class="cx-btn cx-btn--primary" data-cx="start-wizard">${profile ? 'Continuar' : 'Empezar'}</button></div>` : '';
    return shell({
      title: 'Mi perfil de escalador', close: true, backLabel: 'Cerrar',
      body: `${banner}
        ${rows.length ? `<div class="pe-card"><ul class="cx-rows cx-rows--edit">${rows.map(r => `<li><span>${esc(r.label)}</span><b>${esc(r.value)}</b>
          ${editStepsFor(r.key) ? `<button type="button" class="cx-edit" data-edit="${r.key}" aria-label="Editar ${esc(r.label.toLowerCase())}">Editar</button>` : ''}</li>`).join('')}</ul></div>` : ''}
        <div class="pe-card"><h3 class="pe-label">Limitaciones <span class="cx-opt">(opcional)</span></h3>
          <p class="xl-text" id="cx-lim-text">${PR.limitsAnswered(limits) ? esc(PR.limitsText(limits)) : 'Sin indicar.'}</p>
          <div class="cx-card-actions"><button type="button" class="cx-btn cx-btn--secondary" data-cx="limits">${PR.limitsAnswered(limits) ? 'Editar' : 'Indicar'}</button></div>
          <p class="pe-hint">Zonas con molestias o lesiones que conviene tener en cuenta. Se guardan solo en este dispositivo.</p></div>
        <div class="pe-card"><h3 class="pe-label">Entrenamiento mental</h3>
          <p class="xl-text">${answered ? `${answered} de ${PR.MENTAL_QUESTIONS.length} preguntas respondidas.` : 'Evaluación inicial sin hacer.'} Tus respuestas son privadas.</p>
          <div class="cx-card-actions">
            <button type="button" class="cx-btn cx-btn--secondary" data-cx="mental-hub">${answered ? 'Revisar o repetir' : 'Hacer la evaluación'}</button>
            ${mental ? '<button type="button" class="cx-btn cx-btn--ghost" data-cx="mental-delete">Borrar mis respuestas</button>' : ''}
          </div></div>
        ${profile ? `<div class="cx-card-actions cx-card-actions--end"><button type="button" class="cx-btn cx-btn--ghost" data-cx="restart">Volver a empezar el cuestionario</button></div>` : ''}
        <p class="pe-hint">Los datos de tu perfil solo los ves tú. Las copias de seguridad locales de KRUX pueden incluirlos: no las compartas.</p>`
    });
  }

  function limitsScreen() {
    const d = view.draft;
    const chips = PR.LIMITS.map(o => `<button type="button" class="xl-chip xl-chip--lg${d.items.includes(o.id) ? ' is-on' : ''}" aria-pressed="${d.items.includes(o.id)}" data-lim="${o.id}">${esc(o.label)}</button>`).join('')
      + `<button type="button" class="xl-chip xl-chip--lg${d.none ? ' is-on' : ''}" aria-pressed="${!!d.none}" data-lim="none">Ninguna</button>`;
    return shell({
      title: 'Limitaciones', sub: 'Opcional',
      body: `<div class="pe-card"><div class="xl-fchips" role="group" aria-label="Zonas con molestias o lesiones">${chips}</div>
        ${d.items.includes('otra') ? `<label class="cx-field"><span class="pe-label">¿Cuál?</span><input type="text" class="cx-input" id="cx-lim-other" maxlength="60" value="${esc(d.other || '')}" autocomplete="off"></label>` : ''}
        <p class="pe-hint">Marca lo que quieras o déjalo en blanco. Se guarda solo en este dispositivo y puedes cambiarlo cuando quieras.</p></div>`,
      footer: `${limits ? '<button type="button" class="cx-btn cx-btn--ghost" data-cx="limits-clear">Quitar</button>' : ''}<button type="button" class="cx-btn cx-btn--primary" data-cx="limits-save">Guardar</button>`
    });
  }
  function openLimits() {
    const l = limits || {};
    view = { type: 'limits', draft: { items: [...(l.items || [])], none: !!l.none, other: l.other || '' } };
    render();
  }
  function toggleLimit(id) {
    const d = view.draft;
    if (id === 'none') { d.none = !d.none; if (d.none) { d.items = []; d.other = ''; } }
    else { d.items = d.items.includes(id) ? d.items.filter(x => x !== id) : d.items.concat(id); if (d.items.length) d.none = false; if (!d.items.includes('otra')) d.other = ''; }
    render('[data-lim="' + id + '"]');
  }
  function saveLimits(clear) {
    const d = view.draft;
    const next = clear ? null : PR.normalizeLimits({ items: d.items, other: d.other, none: d.none });
    limits = next && PR.limitsAnswered(next) ? next : null;
    if (!limWrite()) { limits = limRead(); toast('No se pudo guardar en este dispositivo', 'error'); return; }
    view = { type: 'hub' }; render();
    toast(limits ? 'Limitaciones guardadas' : 'Limitaciones quitadas', 'success');
  }

  function mentalDelete() {
    const run = () => { mental = null; persist('mental'); render(); toast('Respuestas borradas', 'success'); };
    if (typeof window.kruxConfirm === 'function') window.kruxConfirm('¿Borrar tus respuestas?', 'Se eliminará tu evaluación mental. Puedes volver a hacerla cuando quieras.', run, 'Borrar', true);
    else run();
  }

  function restart() {
    const run = () => { profile = Object.assign(PR.normalizeProfile(profile), { status: 'in_progress', step: 1 }); delete profile.completedAtMs; persist('profile'); openWizard(1); };
    if (typeof window.kruxConfirm === 'function') window.kruxConfirm('¿Volver a empezar?', 'Verás de nuevo las seis preguntas con tus respuestas actuales y podrás cambiarlas. No se borra nada hasta que las guardes.', run, 'Volver a empezar', false);
    else run();
  }

  // ============================================
  // EVENTOS DEL MODAL
  // ============================================
  function bindModal() {
    const m = modal();
    if (!m || m._cxBound) return;
    m._cxBound = true;
    m.addEventListener('click', e => {
      if (!view) return;
      const rec = e.target.closest('[data-rec]');
      if (rec) { const id = rec.dataset.rec; closeModal(true); startRecommendation(id); return; }
      const ps = e.target.closest('[data-plan-start]');
      if (ps && view.type === 'rec') { startPlanSession(); return; }
      const ro = e.target.closest('[data-rec-open]');
      if (ro) { openRec(ro.dataset.recOpen, view.type === 'summary' ? 'summary' : 'card'); return; }
      const tb = e.target.closest('[data-cx-tab]');
      if (tb && view.type === 'rec') { view.tab = tb.dataset.cxTab; render('[data-cx-tab="' + view.tab + '"]'); const sc = $('cx-scroll'), tl = m.querySelector('.cx-d-tabs'); if (sc && tl && sc.scrollTop > tl.offsetTop) sc.scrollTop = tl.offsetTop; return; }
      const ma = e.target.closest('[data-mental-ask]');
      if (ma && view.type === 'mental-ask') { view.pick = ma.dataset.mentalAsk; render('[data-mental-ask="' + view.pick + '"]'); return; }
      if (view.type === 'wizard' && onWizardClick(e)) return;
      if (view.type === 'mental') { const a = e.target.closest('[data-ans]'); if (a) { const v = a.dataset.ans; answerMental(/^[1-5]$/.test(v) ? parseInt(v, 10) : v); return; } }
      if (view.type === 'limits') { const c = e.target.closest('[data-lim]'); if (c) { toggleLimit(c.dataset.lim); return; } }
      const ed = e.target.closest('[data-edit]');
      if (ed) { const st = editStepsFor(ed.dataset.edit); openWizard(st[0], st); return; }
      const b = e.target.closest('[data-cx]');
      if (!b) return;
      switch (b.dataset.cx) {
        case 'next':
          if (view.type === 'mental-ask') { if (view.pick === 'yes') startMental('onboard'); else if (view.pick === 'no') goPreparing(); }
          else wizardNext();
          break;
        case 'prepare': goPreparing(); break;
        case 'back':
          if (view.type === 'wizard') wizardBack();
          else if (view.type === 'mental-ask') { view = { type: 'wizard', step: flow(profile)[flow(profile).length - 1] }; render(); }
          else if (view.type === 'mental') { if (view.q > 0) { view.q--; render(); } else if (view.from === 'hub') { view = { type: 'hub' }; render(); } else if (view.from === 'onboard') { view = { type: 'mental-ask', pick: 'yes' }; render(); } else { view = { type: 'summary' }; render(); } }
          else if (view.type === 'limits') { view = { type: 'hub' }; render(); }
          else if (view.type === 'mental-done' && view.from === 'hub') { view = { type: 'hub' }; render(); }
          else if (view.type === 'rec' && view.from === 'summary') { view = { type: 'summary' }; render(); }
          else closeModal();
          break;
        case 'skip':
          if (view.type === 'mental-ask') goPreparing();
          else if (view.type === 'mental' && view.from === 'onboard') goPreparing();
          else if (view.type === 'mental') { view = { type: view.from === 'hub' ? 'hub' : 'summary' }; render(); }
          else { profile = Object.assign(PR.normalizeProfile(profile || {}), { status: 'skipped' }); persist('profile'); closeModal(); toast('Perfil pendiente', 'info', { detail: 'Lo encontrarás en el menú de Entrena cuando quieras.' }); }
          break;
        case 'close': closeModal(); break;
        case 'to-hub': view = { type: 'hub' }; render(); break;
        case 'adjust': view = { type: 'wizard', step: 1, adjust: true }; render(); break;
        case 'to-recs': view = { type: 'summary' }; render(); break;
        case 'mental-start': startMental('summary'); break;
        case 'mental-hub': startMental('hub'); break;
        case 'mental-delete': mentalDelete(); break;
        case 'start-wizard': openWizard(profile ? PR.firstIncompleteStep(profile) : 1); break;
        case 'restart': restart(); break;
        case 'limits': openLimits(); break;
        case 'limits-save': saveLimits(false); break;
        case 'limits-clear': saveLimits(true); break;
      }
    });
    m.addEventListener('change', e => {
      const sel = e.target.closest('[data-grade]');
      if (!sel || !profile) return;
      setGrade(sel.dataset.grade, sel.value);
      refreshNext();
    });
    m.addEventListener('input', e => {
      if (e.target.id === 'cx-lim-other' && view && view.type === 'limits') { view.draft.other = e.target.value.slice(0, 60); return; }
      if (e.target.id !== 'cx-other') return;
      profile.equipmentOther = e.target.value.slice(0, 60);
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && welcomeEl) { welcomeLater(); return; } if (e.key === 'Escape' && view) { if (view.type === 'wizard') saveDraftAndClose(); else closeModal(); } });
  }

  // ============================================
  // ARRANQUE
  // ============================================
  function init() {
    if (!ENABLED()) return;
    bindModal();
    const item = $('train-gear-profile');
    if (item) {
      item.addEventListener('click', () => {
        const menu = $('train-gear-menu'); if (menu) menu.classList.add('hidden');
        const btn = $('train-new-plan-btn'); if (btn) btn.setAttribute('aria-expanded', 'false');
        if (!loaded) { toast('Cargando tu perfil…', 'info'); return; }
        if (!profile) openWizard(1); else openHub();
      });
    }
    firebase.auth().onAuthStateChanged(onUser);
    const tv = $('train-view');
    if (tv && window.MutationObserver) new MutationObserver(() => maybeWelcome()).observe(tv, { attributes: true, attributeFilter: ['class'] });
    document.addEventListener('krux:train-refresh', () => { if (ENABLED() && uid && loaded) renderCard(); });
    window.addEventListener('online', () => { if (uid && (dirty.profile || dirty.mental)) persist(dirty.profile ? 'profile' : 'mental'); });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && uid && (dirty.profile || dirty.mental)) persist(dirty.profile ? 'profile' : 'mental'); });
  }

  window.KruxCoach = {
    enabled: ENABLED,
    state: () => ({ uid, profile, mental, limits, dirty: { ...dirty }, loaded, loadFailed }),
    openProfile: () => { if (!profile) openWizard(1); else openHub(); },
    openMental: () => { if (!profile) { openWizard(1); return; } startMental('hub'); openModal(); },
    openPlanSession,
    recommendations: () => recs,
    reload: loadAll,
    flush: () => persist(dirty.profile ? 'profile' : 'mental')
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
}());

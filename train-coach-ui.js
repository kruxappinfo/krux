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
  let loaded = false;
  let loadFailed = false;
  let queue = Promise.resolve();

  const lsKey = () => 'krux.coach.v1.' + uid;
  function lsRead() { try { return JSON.parse(localStorage.getItem(lsKey()) || 'null'); } catch (_) { return null; } }
  function lsWrite() {
    if (!uid) return;
    try { localStorage.setItem(lsKey(), JSON.stringify({ profile, mental, dirty })); } catch (_) { /* cuota o modo privado: sigue en memoria */ }
  }
  const col = name => firebase.firestore().collection('users').doc(uid).collection(name).doc('current');
  const offline = () => navigator.onLine === false;
  function withTimeout(promise, ms) {
    return Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms || ACK_MS))]);
  }

  function profilePayload() {
    const { completedAtMs, ...rest } = profile;
    const out = { ...PR.normalizeProfile(rest), updatedAt: firebase.firestore.FieldValue.serverTimestamp() };
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
    lsWrite();
    queue = queue.then(writeDirty, writeDirty);
    return queue.then(ok => { renderCard(); return ok; });
  }

  async function loadAll() {
    loaded = false; loadFailed = false;
    const local = lsRead();
    if (local) {
      profile = local.profile ? { ...local.profile } : null;
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
        } else profile = null;
      }
      if (!dirty.mental) mental = mSnap.exists ? PR.normalizeMental(mSnap.data()) : null;
      lsWrite();
    } catch (_) { loadFailed = !local; }
    loaded = true;
    renderCard();
    if (dirty.profile || dirty.mental) persist(dirty.profile ? 'profile' : 'mental');
  }

  function onUser(user) {
    if (uid && (!user || user.uid !== uid)) {
      // Cierre de sesión o cambio de cuenta: la copia local solo se conserva si hay algo sin enviar
      if (!dirty.profile && !dirty.mental) { try { localStorage.removeItem(lsKey()); } catch (_) { /* nada */ } }
      closeModal(true);
    }
    uid = user ? user.uid : null;
    profile = null; mental = null; dirty = { profile: false, mental: false }; loaded = false;
    const item = $('train-gear-profile');
    if (item) item.hidden = !(ENABLED() && uid);
    if (!uid || !ENABLED()) { renderCard(); return; }
    loadAll();
  }

  // ============================================
  // TARJETA «PARA TI» (pantalla principal de Entrena)
  // ============================================
  function renderCard() {
    const el = $('train-foryou');
    if (!el) return;
    if (!ENABLED() || !uid || !loaded) { el.classList.add('hidden'); el.innerHTML = ''; return; }
    const pending = (dirty.profile || dirty.mental) ? '<p class="cx-note" role="status">Guardado en este dispositivo. Se enviará cuando haya conexión.</p>' : '';
    const status = profile ? profile.status : null;
    let html = '';
    if (!profile || status === 'in_progress') {
      const started = !!profile;
      html = `
        <p class="cx-kicker">Para ti</p>
        <h2 class="cx-card-title">${started ? 'Sigue donde lo dejaste' : 'Cuéntanos cómo escalas'}</h2>
        <p class="cx-card-text">${started ? 'Te quedan unas pocas preguntas para personalizar Entrena.' : 'Seis preguntas rápidas para personalizar Entrena. Puedes saltarlas y hacerlas cuando quieras.'}</p>
        <div class="cx-card-actions">
          <button type="button" class="cx-btn cx-btn--primary" data-cx="start">${started ? 'Continuar' : 'Empezar'}</button>
          <button type="button" class="cx-btn cx-btn--ghost" data-cx="later">Ahora no</button>
        </div>${pending}`;
    } else if (status === 'completed') {
      const rows = PR.summarize(profile).filter(r => ['goal', 'sport', 'boulder', 'availability'].includes(r.key));
      const mentalLine = PR.mentalIsComplete(mental) ? '' : '<p class="cx-note">Evaluación mental pendiente · opcional</p>';
      html = `
        <p class="cx-kicker">Para ti</p>
        <h2 class="cx-card-title">Tu perfil de escalador</h2>
        <ul class="cx-card-rows">${rows.map(r => `<li><span>${esc(r.label)}</span><b>${esc(r.value)}</b></li>`).join('')}</ul>
        ${mentalLine}
        <div class="cx-card-actions"><button type="button" class="cx-btn cx-btn--secondary" data-cx="profile">Ver y editar perfil</button></div>${pending}`;
    }
    // Saltado: no se insiste. El perfil sigue disponible en el menú.
    el.innerHTML = html;
    el.classList.toggle('hidden', !html);
  }

  document.addEventListener('click', e => {
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
    const sub = opts.sub ? `<p class="pe-subtitle xl-step">${opts.sub}</p>` : '';
    const skip = opts.skip ? `<button type="button" class="cx-skip" data-cx="skip">${opts.skip}</button>` : '';
    return `
      <div class="pe-screen xl-screen">
        <header class="pe-topbar xl-topbar">
          <button type="button" class="pe-icon-btn pe-back-btn" data-cx="back" aria-label="${esc(opts.backLabel || 'Volver')}">${opts.close ? I.close : I.back}</button>
          <div class="pe-heading">${sub}<h2 class="pe-title xl-wz-title" id="cx-title" tabindex="-1">${opts.title}</h2></div>
          ${skip}
        </header>
        ${opts.progress != null ? `<div class="xl-progress" aria-hidden="true"><span style="width:${opts.progress}%"></span></div>` : ''}
        <div class="xl-scroll xl-wz-scroll" id="cx-scroll">${opts.body}</div>
        ${opts.footer ? `<div class="xl-pickbar cx-pickbar">${opts.footer}</div>` : ''}
      </div>`;
  }

  function render(focusSel) {
    const m = modal();
    if (!m || !view) return;
    const scroll = $('cx-scroll');
    const keepTop = scroll ? scroll.scrollTop : 0;
    const keepType = view._last === view.type + ':' + (view.step || view.q || '');
    let html = '';
    if (view.type === 'wizard') html = wizardScreen();
    else if (view.type === 'summary') html = summaryScreen();
    else if (view.type === 'mental') html = mentalScreen();
    else if (view.type === 'mental-done') html = mentalDoneScreen();
    else html = hubScreen();
    m.innerHTML = html;
    view._last = view.type + ':' + (view.step || view.q || '');
    const sc = $('cx-scroll');
    if (sc && keepType) sc.scrollTop = keepTop;
    const keep = focusSel && m.querySelector(focusSel);
    const t = $('cx-title');
    if (keep) keep.focus({ preventScroll: true });
    else if (t && !keepType) t.focus({ preventScroll: true });
  }

  // ============================================
  // ONBOARDING (6 pasos)
  // ============================================
  const STEP_TITLES = {
    1: '¿Cuál es tu objetivo?', 2: '¿Cuál es tu nivel?', 3: '¿Cuál es tu grado objetivo?',
    4: '¿Cuánto tiempo tienes?', 5: '¿Cómo y dónde escalas?', 6: '¿Con qué material cuentas?'
  };

  function gradeSelect(scale, key, label, opts) {
    const g = (profile.grades && profile.grades[scale]) || {};
    const list = PR.SCALES[scale];
    const optional = opts && opts.optional;
    return `
      <label class="cx-field"><span class="pe-label">${esc(label)}</span>
        <select class="cx-select" data-grade="${scale}.${key}" ${opts && opts.id ? `id="${opts.id}"` : ''}>
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

  function gridSeg(values, current, attr, unit) {
    return `<div class="cx-grid" role="radiogroup">${values.map(v => `<button type="button" class="xl-seg-btn${current === v ? ' is-on' : ''}" role="radio" aria-checked="${current === v}" data-${attr}="${v}">${v}${unit || ''}</button>`).join('')}</div>`;
  }

  function stepBody(step) {
    const p = profile;
    if (step === 1) {
      const secondary = p.goalsSecondary || [];
      return `${optList(PR.GOALS, p.goalPrimary, 'goal', id => I.goal[id])}
        <div class="pe-card"><h3 class="pe-label" id="cx-sec-label">Objetivos secundarios <span class="cx-opt">(opcional, hasta 2)</span></h3>
          <div class="xl-fchips" role="group" aria-labelledby="cx-sec-label">${PR.GOALS.filter(g => g.id !== p.goalPrimary).map(g => `
            <button type="button" class="xl-chip xl-chip--lg${secondary.includes(g.id) ? ' is-on' : ''}" aria-pressed="${secondary.includes(g.id)}" data-sec="${g.id}">${esc(g.label)}</button>`).join('')}</div></div>`;
    }
    if (step === 2) {
      const sportBlock = PR.needsSport(p) ? `
        <div class="pe-card">
          <h3 class="pe-label">${esc(PR.SCALE_NAMES.sport)}</h3>
          ${gradeSelect('sport', 'usualFrom', 'Grado habitual (desde)')}
          ${gradeSelect('sport', 'usualTo', 'Grado habitual (hasta)', { optional: true })}
          ${gradeSelect('sport', 'max', 'Máximo encadenado')}
          <p class="pe-hint">El grado habitual es con el que escalas con regularidad. El máximo es el más difícil que has encadenado: son dos datos distintos.</p>
        </div>` : '<div class="xl-alert xl-alert--soft" role="note"><p class="xl-text">Como solo practicas bloque, tus grados los indicas en el paso «Cómo y dónde escalas».</p></div>';
      return `${sportBlock}
        <div class="pe-card"><h3 class="pe-label" id="cx-exp-label">¿Cuánto tiempo llevas escalando?</h3>
          ${optList(PR.EXPERIENCE, p.experience, 'exp')}</div>`;
    }
    if (step === 3) {
      if (!PR.needsSport(p)) return '<div class="xl-alert xl-alert--soft" role="note"><p class="xl-text">Como solo practicas bloque, tu grado objetivo lo indicas en el paso «Cómo y dónde escalas».</p></div>';
      return `<div class="pe-card">${gradeSelect('sport', 'target', 'Grado objetivo (escala francesa)')}
        <p class="pe-hint">Es una aspiración personal, no una predicción de tu rendimiento. Puedes cambiarla cuando quieras.</p></div>`;
    }
    if (step === 4) {
      return `<div class="pe-card">
        <h3 class="pe-label" id="cx-days-label">Días por semana</h3>${gridSeg([1, 2, 3, 4, 5, 6, 7], p.daysPerWeek, 'days')}
        <div class="pe-divider" aria-hidden="true"></div>
        <h3 class="pe-label" id="cx-min-label">Duración de cada sesión</h3>${gridSeg(PR.MINUTES, p.minutesPerSession, 'min', ' min')}
        <p class="pe-hint">Podrás ajustarlo después. Sirve para proponerte planes que quepan en tu semana.</p></div>`;
    }
    if (step === 5) {
      let out = `<div class="pe-card"><h3 class="pe-label">¿Qué escalas?</h3>${optList(PR.MODALITY, p.modality, 'mod', id => I.modality[id])}</div>
        <div class="pe-card"><h3 class="pe-label">¿Dónde sueles escalar?</h3>${optList(PR.ENVIRONMENT, p.environment, 'env', id => I.env[id])}</div>`;
      if (PR.asksRock(p)) {
        out += `<div class="pe-card"><h3 class="pe-label" id="cx-rock-label">¿Cuántos días a la semana escalas en roca?</h3>${gridSeg([1, 2, 3, 4, 5, 6, 7], p.rockFrequency, 'rock')}
          <div class="pe-divider" aria-hidden="true"></div>
          <h3 class="pe-label" id="cx-prio-label">¿Qué quieres priorizar? <span class="cx-opt">(opcional)</span></h3>
          <div class="xl-fchips" role="radiogroup" aria-labelledby="cx-prio-label">${PR.ROCK_PRIORITY.map(o => `<button type="button" class="xl-chip xl-chip--lg${p.rockPriority === o.id ? ' is-on' : ''}" role="radio" aria-checked="${p.rockPriority === o.id}" data-prio="${o.id}">${esc(o.label)}</button>`).join('')}</div></div>`;
      }
      if (PR.needsBoulder(p)) {
        out += `<div class="pe-card"><h3 class="pe-label">${esc(PR.SCALE_NAMES.boulder)}</h3>
          ${gradeSelect('boulder', 'usualFrom', 'Grado habitual (desde)')}
          ${gradeSelect('boulder', 'usualTo', 'Grado habitual (hasta)', { optional: true })}
          ${gradeSelect('boulder', 'max', 'Máximo encadenado')}
          ${gradeSelect('boulder', 'target', 'Grado objetivo')}
          <p class="pe-hint">La escala de bloque es independiente de la de deportiva: no se mezclan.</p></div>`;
      }
      return out;
    }
    const eq = p.equipment || [];
    return `<div class="pe-card"><div class="xl-fchips" role="group" aria-label="Material disponible">${PR.EQUIPMENT.map(o => `
      <button type="button" class="xl-chip xl-chip--lg${eq.includes(o.id) ? ' is-on' : ''}" aria-pressed="${eq.includes(o.id)}" data-eq="${o.id}">${esc(o.label)}</button>`).join('')}</div>
      ${eq.includes('otro') ? `<label class="cx-field"><span class="pe-label">¿Qué otro material?</span><input type="text" class="cx-input" id="cx-other" maxlength="60" value="${esc(p.equipmentOther || '')}" autocomplete="off"></label>` : ''}
      <p class="pe-hint">Solo se te propondrá lo que puedas hacer con lo que marques. El peso corporal siempre cuenta.</p></div>`;
  }

  function wizardScreen() {
    const editing = !!view.steps;
    const total = editing ? view.steps.length : PR.STEPS;
    const pos = editing ? view.steps.indexOf(view.step) + 1 : view.step;
    const last = editing ? pos === total : view.step === PR.STEPS;
    const ok = PR.stepIsValid(view.step, profile);
    return shell({
      title: STEP_TITLES[view.step],
      sub: editing ? `Editar perfil · ${pos} de ${total}` : `Paso ${view.step} de ${PR.STEPS}`,
      progress: Math.round((pos / total) * 100),
      backLabel: pos === 1 ? 'Cerrar' : 'Paso anterior',
      skip: editing ? '' : 'Saltar',
      body: stepBody(view.step),
      footer: `<button type="button" class="pe-save-btn pe-save-btn--wide" id="cx-next" data-cx="next"${ok ? '' : ' disabled'}><span>${last ? (editing ? 'Guardar' : 'Terminar') : 'Siguiente'}</span></button>`
    });
  }

  function refreshNext() {
    const b = $('cx-next');
    if (b && view && view.type === 'wizard') b.disabled = !PR.stepIsValid(view.step, profile);
  }

  function setGrade(path, value) {
    const [scale, key] = path.split('.');
    const grades = Object.assign({}, profile.grades);
    const g = Object.assign({}, grades[scale]);
    if (value) g[key] = value; else delete g[key];
    if (Object.keys(g).length) grades[scale] = g; else delete grades[scale];
    if (Object.keys(grades).length) profile.grades = grades; else delete profile.grades;
  }

  function onWizardClick(e) {
    const el = e.target.closest('[data-goal],[data-sec],[data-exp],[data-days],[data-min],[data-mod],[data-env],[data-rock],[data-prio],[data-eq]');
    if (!el) return false;
    const d = el.dataset;
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
      profile.environment = d.env;
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
    return true;
  }

  async function wizardNext() {
    if (!PR.stepIsValid(view.step, profile)) return;
    const editing = !!view.steps;
    const lastEdit = editing && view.step === view.steps[view.steps.length - 1];
    const lastStep = !editing && view.step === PR.STEPS;
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
      persist('profile');
      view = { type: 'summary' }; render(); return;
    }
    profile.status = 'in_progress';
    profile.step = view.step + 1;
    persist('profile');
    view.step++;
    render();
  }

  function wizardBack() {
    if (view.steps) {
      const i = view.steps.indexOf(view.step);
      if (i > 0) { view.step = view.steps[i - 1]; render(); } else { view = { type: 'hub' }; render(); }
      return;
    }
    if (view.step > 1) { view.step--; render(); return; }
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
  function summaryRows(p) {
    return `<ul class="cx-rows">${PR.summarize(p).map(r => `<li><span>${esc(r.label)}</span><b>${esc(r.value)}</b></li>`).join('')}</ul>`;
  }

  function summaryScreen() {
    const warn = PR.gradeWarnings(profile).length
      ? '<p class="pe-hint">Tu grado habitual figura por encima de tu máximo encadenado. Si es correcto, no pasa nada: puedes dejarlo así o corregirlo desde tu perfil.</p>' : '';
    return shell({
      title: 'Tu perfil está listo', close: true, backLabel: 'Cerrar',
      body: `<div class="pe-card">${summaryRows(profile)}${warn}</div>
        <div class="pe-card"><h3 class="pe-label">Entrenamiento mental <span class="cx-opt">(opcional)</span></h3>
          <p class="xl-text">Cinco preguntas breves para sugerirte lecciones y ejercicios de entrenamiento mental. No es un test ni un diagnóstico: son contenidos educativos y deportivos. Puedes saltarte cualquier pregunta.</p></div>`,
      footer: `<div class="cx-footer-stack"><button type="button" class="pe-save-btn pe-save-btn--wide" data-cx="mental-start"><span>${mental && PR.mentalAnswered(mental) ? 'Revisar mis respuestas' : 'Hacer la evaluación'}</span></button>
        <button type="button" class="cx-btn cx-btn--ghost" data-cx="close">Ahora no</button></div>`
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
    return shell({
      title: 'Evaluación mental', sub: `Pregunta ${view.q + 1} de ${PR.MENTAL_QUESTIONS.length}`,
      progress: Math.round(((view.q + 1) / PR.MENTAL_QUESTIONS.length) * 100),
      backLabel: view.q === 0 ? 'Cerrar' : 'Pregunta anterior', skip: 'Saltar evaluación',
      body: `<div class="pe-card">
        <h3 class="cx-question" id="cx-q">${esc(qn.text)}</h3>
        <div class="cx-scale" role="radiogroup" aria-labelledby="cx-q">${levels.map(n => `<button type="button" class="xl-seg-btn${cur === n ? ' is-on' : ''}" role="radio" aria-checked="${cur === n}" data-ans="${n}">${n}</button>`).join('')}</div>
        <div class="cx-scale-ends" aria-hidden="true"><span>1 · ${esc(qn.low)}</span><span>5 · ${esc(qn.high)}</span></div>
        <div class="cx-special">
          <button type="button" class="cx-btn cx-btn--secondary${cur === 'unknown' ? ' is-on' : ''}" aria-pressed="${cur === 'unknown'}" data-ans="unknown">${esc(PR.MENTAL_SPECIAL.unknown)}</button>
          <button type="button" class="cx-btn cx-btn--secondary${cur === 'skip' ? ' is-on' : ''}" aria-pressed="${cur === 'skip'}" data-ans="skip">${esc(PR.MENTAL_SPECIAL.skip)}</button>
        </div></div>
        <p class="pe-hint">Tus respuestas son privadas: solo las ves tú. No se muestran en tu perfil público ni se comparan con nadie.</p>`
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
    return shell({
      title: 'Gracias, ya está guardado', close: true, backLabel: 'Cerrar',
      body: `<div class="pe-card"><p class="xl-text">Usaremos tus respuestas solo para sugerirte lecciones y ejercicios de entrenamiento mental. No generan ninguna puntuación ni etiqueta sobre ti.</p>
        <p class="pe-hint">Puedes cambiarlas, repetirlas o borrarlas cuando quieras desde tu perfil. Esto es contenido educativo y deportivo: no sustituye la ayuda de un profesional si la necesitas.</p></div>`,
      footer: `<button type="button" class="pe-save-btn pe-save-btn--wide" data-cx="${view.from === 'hub' ? 'to-hub' : 'close'}"><span>Hecho</span></button>`
    });
  }

  // ============================================
  // PERFIL (consulta y edición)
  // ============================================
  const EDIT_STEPS = { goal: [1], sport: [2, 3], boulder: [5], experience: [2], availability: [4], where: [5], equipment: [6] };

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
          ${EDIT_STEPS[r.key] ? `<button type="button" class="cx-edit" data-edit="${r.key}" aria-label="Editar ${esc(r.label.toLowerCase())}">Editar</button>` : ''}</li>`).join('')}</ul></div>` : ''}
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
      if (view.type === 'wizard' && onWizardClick(e)) return;
      if (view.type === 'mental') { const a = e.target.closest('[data-ans]'); if (a) { const v = a.dataset.ans; answerMental(/^[1-5]$/.test(v) ? parseInt(v, 10) : v); return; } }
      const ed = e.target.closest('[data-edit]');
      if (ed) { openWizard(EDIT_STEPS[ed.dataset.edit][0], EDIT_STEPS[ed.dataset.edit]); return; }
      const b = e.target.closest('[data-cx]');
      if (!b) return;
      switch (b.dataset.cx) {
        case 'next': wizardNext(); break;
        case 'back':
          if (view.type === 'wizard') wizardBack();
          else if (view.type === 'mental') { if (view.q > 0) { view.q--; render(); } else if (view.from === 'hub') { view = { type: 'hub' }; render(); } else { view = { type: 'summary' }; render(); } }
          else if (view.type === 'mental-done' && view.from === 'hub') { view = { type: 'hub' }; render(); }
          else closeModal();
          break;
        case 'skip':
          if (view.type === 'mental') { view.from === 'hub' ? (view = { type: 'hub' }, render()) : closeModal(); }
          else { profile = Object.assign(PR.normalizeProfile(profile || {}), { status: 'skipped' }); persist('profile'); closeModal(); toast('Perfil pendiente', 'info', { detail: 'Lo encontrarás en el menú de Entrena cuando quieras.' }); }
          break;
        case 'close': closeModal(); break;
        case 'to-hub': view = { type: 'hub' }; render(); break;
        case 'mental-start': startMental('summary'); break;
        case 'mental-hub': startMental('hub'); break;
        case 'mental-delete': mentalDelete(); break;
        case 'start-wizard': openWizard(profile ? PR.firstIncompleteStep(profile) : 1); break;
        case 'restart': restart(); break;
      }
    });
    m.addEventListener('change', e => {
      const sel = e.target.closest('[data-grade]');
      if (!sel || !profile) return;
      setGrade(sel.dataset.grade, sel.value);
      refreshNext();
    });
    m.addEventListener('input', e => {
      if (e.target.id !== 'cx-other') return;
      profile.equipmentOther = e.target.value.slice(0, 60);
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && view) { if (view.type === 'wizard') saveDraftAndClose(); else closeModal(); } });
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
    window.addEventListener('online', () => { if (uid && (dirty.profile || dirty.mental)) persist(dirty.profile ? 'profile' : 'mental'); });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && uid && (dirty.profile || dirty.mental)) persist(dirty.profile ? 'profile' : 'mental'); });
  }

  window.KruxCoach = {
    enabled: ENABLED,
    state: () => ({ uid, profile, mental, dirty: { ...dirty }, loaded, loadFailed }),
    openProfile: () => { if (!profile) openWizard(1); else openHub(); },
    reload: loadAll,
    flush: () => persist(dirty.profile ? 'profile' : 'mental')
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
}());

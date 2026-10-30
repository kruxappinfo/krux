// ================== ENTRENA — «MIS PLANES» ==================
// Pantalla para gestionar varios planes (solo con window.KRUX_MULTIPLAN): listar, activar, editar,
// duplicar, archivar, papelera y borrado definitivo. Reutiliza los estilos de la biblioteca de
// ejercicios (xl-*) y del editor de planes (pe-*). Toda la persistencia pasa por KruxTrainStore.plans.
(function () {
  'use strict';
  const P = window.KruxPlans;
  if (!P) return;

  const $ = id => document.getElementById(id);
  const esc = t => (typeof trEsc === 'function' ? trEsc(t) : String(t == null ? '' : t));
  const toast = (m, t, o) => { if (typeof showToast === 'function') showToast(m, t, o); };
  const ico = (body, size, sw) => `<svg width="${size || 18}" height="${size || 18}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw || 2}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  const I = {
    back: ico('<polyline points="15 18 9 12 15 6"></polyline>', 22, 2.2),
    plus: ico('<line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line>', 18, 2.2),
    more: '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>',
    dumbbell: ico('<rect x="2.5" y="9" width="2.5" height="6" rx="1.25"/><rect x="5.5" y="6" width="3" height="12" rx="1.5"/><line x1="8.5" y1="12" x2="15.5" y2="12"/><rect x="15.5" y="6" width="3" height="12" rx="1.5"/><rect x="19" y="9" width="2.5" height="6" rx="1.25"/>', 26, 1.7),
    check: ico('<polyline points="20 6 9 17 4 12"></polyline>', 18, 2.4),
    edit: ico('<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>', 18),
    copy: ico('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>', 18),
    archive: ico('<rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9"/><path d="M10 13h4"/>', 18),
    restore: ico('<path d="M3 12a9 9 0 1 0 3-6.7"/><polyline points="3 4 3 10 9 10"/>', 18),
    trash: ico('<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/>', 18),
    play: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15a1 1 0 0 0 1.5.86l12-7.5a1 1 0 0 0 0-1.72l-12-7.5A1 1 0 0 0 7 4.5z"/></svg>'
  };

  const GOALS = { fuerza: 'Fuerza', resistencia: 'Resistencia', potencia: 'Potencia', tecnica: 'Técnica', general: 'Mejora general' };
  const LEVELS = { 1: 'Principiante', 2: 'Intermedio', 3: 'Avanzado' };
  const TABS = { ready: 'Planes', archived: 'Archivados', trashed: 'Papelera' };

  let tab = 'ready';
  let busy = false;

  const modal = () => $('my-plans-modal');
  const store = () => window.KruxTrainStore && window.KruxTrainStore.plans;
  const plansList = () => window.kruxPlans || [];
  const activeId = () => (window.kruxPlanState && window.kruxPlanState.activePlanId) || null;
  const plural = (n, a, b) => `${n} ${n === 1 ? a : b}`;

  function dateText(ts) {
    const d = ts && (ts.toDate ? ts.toDate() : (ts.seconds != null ? new Date(ts.seconds * 1000) : null));
    return d ? d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  }

  // ── Información de cada plan ────────────────────────────────────────
  function equipmentNames(plan) {
    const cat = window.KruxLibrary && window.KruxLibrary.catalog();
    return (plan.equipment || []).map(id => (cat && cat.eqById.get(id) ? cat.eqById.get(id).short : null)).filter(Boolean);
  }

  function metaLine(plan) {
    const s = P.summarize(plan, typeof trEstimateMinutes === 'function' ? trEstimateMinutes : null);
    return [plan.goal && GOALS[plan.goal], plan.level && LEVELS[plan.level], plural(plan.weeks, 'semana', 'semanas'), plural(s.sessions, 'sesión', 'sesiones')].filter(Boolean).join(' · ');
  }

  function cardHTML(plan) {
    const isActive = plan.id === activeId() && plan.status === 'ready';
    const s = P.summarize(plan, typeof trEstimateMinutes === 'function' ? trEstimateMinutes : null);
    const eq = equipmentNames(plan);
    const badge = isActive ? '<span class="mp-badge is-active">Activo</span>'
      : plan.status === 'archived' ? '<span class="mp-badge">Archivado</span>'
      : plan.status === 'trashed' ? '<span class="mp-badge is-trash">En la papelera</span>' : '';
    const extra = plan.status === 'trashed' && plan.trashedAt ? `Eliminado el ${dateText(plan.trashedAt)} · se puede restaurar`
      : plan.status === 'archived' && plan.archivedAt ? `Archivado el ${dateText(plan.archivedAt)}` : '';
    return `
      <article class="xl-card mp-card${isActive ? ' is-active' : ''}${plan.status !== 'ready' ? ' is-' + plan.status : ''}" data-plan="${esc(plan.id)}">
        <button type="button" class="xl-card-main mp-main" data-act-menu="${esc(plan.id)}" aria-label="${esc(plan.name)}${isActive ? ', plan activo' : ''}. Abrir acciones">
          <span class="xl-thumb">${I.dumbbell}</span>
          <span class="xl-card-body">
            <span class="xl-card-name">${esc(plan.name)}${badge}</span>
            <span class="xl-card-meta">${esc(metaLine(plan))}</span>
            <span class="xl-card-tags">
              ${eq.slice(0, 3).map(n => `<span class="xl-pill">${esc(n)}</span>`).join('')}
              ${s.avgMinutes ? `<span class="xl-pill">≈ ${s.avgMinutes} min/sesión</span>` : ''}
            </span>
            ${extra ? `<span class="mp-extra">${esc(extra)}</span>` : ''}
          </span>
        </button>
        <button type="button" class="mp-more" data-act-menu="${esc(plan.id)}" aria-label="Acciones de ${esc(plan.name)}">${I.more}</button>
      </article>`;
  }

  // ── Pantalla ────────────────────────────────────────────────────────
  function noticeHTML() {
    const n = window.kruxPlanNotice;
    if (!n) return '';
    if (n.type === 'legacy-drift') {
      return `<div class="mp-notice" role="note">
        <p><b>Hay cambios hechos con una versión antigua de la app.</b> Tu plan actual no se ha modificado. Puedes importarlos como un plan nuevo.</p>
        <div class="mp-notice-actions"><button type="button" class="mp-notice-btn" data-notice="import">Importar como plan nuevo</button><button type="button" class="mp-notice-btn is-quiet" data-notice="dismiss">Ignorar</button></div>
      </div>`;
    }
    if (n.type === 'load-error') {
      return `<div class="mp-notice is-error" role="alert">
        <p><b>No se han podido cargar tus planes.</b> Revisa tu conexión: no se ha cambiado nada.</p>
        <div class="mp-notice-actions"><button type="button" class="mp-notice-btn" data-notice="reload">Reintentar</button></div>
      </div>`;
    }
    if (n.type === 'migration-error') {
      return `<div class="mp-notice is-error" role="alert">
        <p><b>No se han podido preparar tus planes.</b> No se ha cambiado nada. Puedes volver a intentarlo.</p>
        <div class="mp-notice-actions"><button type="button" class="mp-notice-btn" data-notice="retry">Reintentar</button></div>
      </div>`;
    }
    return '';
  }

  function render() {
    const groups = P.groupPlans(plansList(), window.kruxPlanState);
    const list = groups[tab];
    const total = groups.ready.length + groups.archived.length;
    const empty = {
      ready: ['Aún no tienes planes', 'Crea uno desde cero, con una plantilla o con el asistente.'],
      archived: ['No hay planes archivados', 'Archiva los planes que ya no uses para tenerlos a mano sin que estorben.'],
      trashed: ['La papelera está vacía', 'Los planes que elimines estarán aquí hasta que los borres definitivamente.']
    }[tab];
    modal().innerHTML = `
      <div class="pe-screen xl-screen">
        <header class="pe-topbar xl-topbar">
          <button type="button" class="pe-icon-btn pe-back-btn" id="mp-back" aria-label="Volver">${I.back}</button>
          <div class="pe-heading">
            <h2 class="pe-title" id="mp-title" tabindex="-1">Mis planes</h2>
            <p class="pe-subtitle">${esc(plural(total, 'plan guardado', 'planes guardados'))}</p>
          </div>
          <button type="button" class="xl-filter-btn" id="mp-new">${I.plus}<span>Nuevo</span></button>
        </header>
        <div class="xl-toolbar">
          <div class="xl-chips mp-tabs" role="tablist" aria-label="Estado de los planes">
            ${Object.entries(TABS).map(([k, label]) => `<button type="button" class="xl-chip${tab === k ? ' is-on' : ''}" role="tab" aria-selected="${tab === k}" data-tab="${k}">${label}${groups[k].length ? ` · ${groups[k].length}` : ''}</button>`).join('')}
          </div>
        </div>
        <div class="xl-scroll" id="mp-scroll">
          ${noticeHTML()}
          <div class="xl-list" id="mp-list">
            ${list.length ? list.map(cardHTML).join('') : `<div class="pe-empty"><p class="pe-empty-title">${empty[0]}</p><p class="pe-empty-text">${empty[1]}</p>${tab === 'ready' ? '<button type="button" class="pe-add-ex-btn mp-empty-btn" id="mp-empty-new">Crear un plan</button>' : ''}</div>`}
          </div>
          ${tab === 'trashed' && list.length ? '<p class="pe-hint pe-hint--center">Un plan eliminado no se borra del todo hasta que lo elimines definitivamente. Tus entrenamientos realizados se conservan siempre.</p>' : ''}
        </div>
      </div>`;
    bind();
  }

  function bind() {
    $('mp-back').onclick = close;
    $('mp-new').onclick = newPlan;
    const emptyBtn = $('mp-empty-new');
    if (emptyBtn) emptyBtn.onclick = newPlan;
    modal().querySelectorAll('[data-tab]').forEach(b => { b.onclick = () => { tab = b.dataset.tab; render(); }; });
    modal().querySelectorAll('[data-act-menu]').forEach(b => { b.onclick = () => openActions(b.dataset.actMenu); });
    modal().querySelectorAll('[data-notice]').forEach(b => { b.onclick = () => onNotice(b.dataset.notice); });
  }

  async function onNotice(kind) {
    if (kind === 'dismiss') { window.kruxPlanNotice = null; render(); return; }
    if (kind === 'import') {
      const id = await store().importLegacy();
      if (id) { toast('Plan importado', 'success', { detail: 'Se ha guardado como un plan nuevo. Tu plan actual no ha cambiado.' }); }
      render();
      return;
    }
    if (kind === 'reload') { await store().retryLoad(); render(); return; }
    if (kind === 'retry') {
      await store().reload().catch(() => {});
      try { await store().migrate(); window.kruxPlanNotice = null; await store().reload(); } catch (e) { /* el aviso permanece */ }
      render();
    }
  }

  // ── Acciones de un plan ─────────────────────────────────────────────
  function sheet(title, items) {
    closeSheet(true);
    const el = document.createElement('div');
    el.id = 'mp-sheet';
    el.className = 'pe-lib-sheet xl-sheet';
    el.innerHTML = `
      <div class="pe-lib-backdrop" data-close></div>
      <div class="pe-lib-panel" role="dialog" aria-modal="true" aria-labelledby="mp-sheet-title">
        <div class="pe-lib-handle" aria-hidden="true"></div>
        <div class="pe-lib-head"><h3 class="pe-lib-title" id="mp-sheet-title">${esc(title)}</h3>
          <button type="button" class="pe-icon-btn" data-close aria-label="Cerrar">${ico('<line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>', 18)}</button></div>
        <div class="xl-sheet-body">${items}</div>
      </div>`;
    modal().appendChild(el);
    el.addEventListener('click', e => { if (e.target.closest('[data-close]')) closeSheet(); });
    requestAnimationFrame(() => el.classList.add('pe-lib-open'));
    return el;
  }
  function closeSheet(immediate) {
    const el = $('mp-sheet');
    if (!el) return;
    el.id = '';
    if (immediate) { el.remove(); return; }
    el.classList.remove('pe-lib-open');
    setTimeout(() => el.remove(), 250);
  }

  const actionBtn = (act, icon, label, hint, danger) => `<button type="button" class="mp-action${danger ? ' is-danger' : ''}" data-do="${act}"><span class="mp-action-icon">${icon}</span><span class="mp-action-text"><b>${label}</b>${hint ? `<small>${hint}</small>` : ''}</span></button>`;

  function openActions(id) {
    const plan = plansList().find(p => p.id === id);
    if (!plan) return;
    const isActive = plan.id === activeId() && plan.status === 'ready';
    let items = '';
    if (plan.status === 'ready') {
      if (!isActive) items += actionBtn('activate', I.play, 'Activar', 'Entrena usará este plan');
      items += actionBtn('edit', I.edit, 'Editar', 'Sesiones, ejercicios y parámetros');
      items += actionBtn('duplicate', I.copy, 'Duplicar', 'Crea una copia independiente');
      items += actionBtn('archive', I.archive, 'Archivar', isActive ? 'Entrena se quedará sin plan activo' : 'Lo guardas sin borrarlo');
      items += actionBtn('trash', I.trash, 'Enviar a la papelera', 'Podrás restaurarlo', true);
    } else if (plan.status === 'archived') {
      items += actionBtn('restore', I.restore, 'Recuperar', 'Vuelve a tus planes (sin activarlo)');
      items += actionBtn('edit', I.edit, 'Editar', '');
      items += actionBtn('duplicate', I.copy, 'Duplicar', '');
      items += actionBtn('trash', I.trash, 'Enviar a la papelera', 'Podrás restaurarlo', true);
    } else {
      items += actionBtn('restore', I.restore, 'Restaurar', 'Vuelve a tus planes (sin activarlo)');
      items += actionBtn('purge', I.trash, 'Eliminar definitivamente', 'No se puede deshacer', true);
    }
    const el = sheet(plan.name, items);
    el.querySelector('.xl-sheet-body').onclick = e => {
      const b = e.target.closest('[data-do]');
      if (b) { closeSheet(); run(b.dataset.do, plan); }
    };
  }

  async function run(act, plan) {
    if (busy) return;
    const isActive = plan.id === activeId() && plan.status === 'ready';
    const after = async (ok, message, detail) => { busy = false; if (ok) toast(message, 'success', detail ? { detail } : undefined); if (typeof window.refreshTrainView === 'function') window.refreshTrainView(); render(); };
    const confirm = (title, message, fn, label, danger) => window.kruxConfirm(title, message, fn, label, danger);
    switch (act) {
      case 'activate':
        busy = true; return after(await store().activate(plan.id), `«${plan.name}» es tu plan activo`);
      case 'edit':
        return edit(plan.id);
      case 'duplicate':
        busy = true; { const id = await store().duplicate(plan.id); return after(!!id, 'Copia creada', 'La copia es independiente del original.'); }
      case 'restore':
        busy = true; return after(await store().setStatus(plan.id, 'restore'), `«${plan.name}» recuperado`, 'No está activo: actívalo cuando quieras.');
      case 'archive':
        return confirm('¿Archivar este plan?', isActive ? 'Entrena se quedará sin plan activo hasta que elijas otro. Tus entrenamientos realizados se conservan.' : 'Se guardará en «Archivados» y podrás recuperarlo cuando quieras.',
          async () => { busy = true; after(await store().setStatus(plan.id, 'archive'), `«${plan.name}» archivado`); }, 'Archivar', false);
      case 'trash':
        return confirm('¿Enviar a la papelera?', (isActive ? 'Entrena se quedará sin plan activo. ' : '') + 'Podrás restaurarlo desde la papelera. Tus entrenamientos realizados se conservan.',
          async () => { busy = true; after(await store().setStatus(plan.id, 'trash'), `«${plan.name}» está en la papelera`); }, 'Enviar a la papelera', true);
      case 'purge':
        return confirm('¿Eliminar definitivamente?', `«${plan.name}» se borrará para siempre y no se podrá recuperar. Tus entrenamientos realizados se conservan con el nombre del plan.`,
          async () => { busy = true; after(await store().purge(plan.id), 'Plan eliminado'); }, 'Eliminar definitivamente', true);
    }
  }

  function edit(id) {
    close(true);
    window.openPlanEditor({ planId: id, onClose: () => open() });
  }

  function newPlan() {
    close(true);
    window.openPlanEditor({ onClose: () => open() });
  }

  // ── Abrir y cerrar ──────────────────────────────────────────────────
  function open(opts) {
    if (!window.KRUX_MULTIPLAN || !modal()) return;
    tab = (opts && opts.tab) || tab || 'ready';
    render();
    const m = modal();
    m.classList.remove('hidden');
    requestAnimationFrame(() => m.classList.add('pe-open'));
    setTimeout(() => $('mp-title') && $('mp-title').focus({ preventScroll: true }), 320);
    // Refresca desde el servidor sin bloquear la pantalla (otro dispositivo puede haber cambiado algo)
    if (store() && store().reload) store().reload().then(() => { if (modal().classList.contains('pe-open')) render(); }).catch(() => {});
  }

  function close(immediate) {
    closeSheet(true);
    const m = modal();
    if (!m) return;
    m.classList.remove('pe-open');
    if (immediate === true) m.classList.add('hidden'); else setTimeout(() => m.classList.add('hidden'), 280);
  }

  // Pregunta explícita al guardar un plan nuevo: ¿activarlo? (devuelve true / false / null si se cancela)
  function askActivate(newName) {
    return new Promise(resolve => {
      const current = window.kruxActivePlan;
      const text = current
        ? `Ahora tu plan activo es «${esc(current.name)}». Si activas «${esc(newName)}», Entrena usará el nuevo. El anterior se conserva en «Mis planes».`
        : 'Ahora mismo no tienes ningún plan activo. Si lo activas, Entrena lo usará desde ahora.';
      const host = $('plan-editor-modal') || document.body;
      const el = document.createElement('div');
      el.id = 'mp-ask';
      el.className = 'pe-lib-sheet xl-sheet pe-lib-open';
      el.innerHTML = `
        <div class="pe-lib-backdrop" data-ask="cancel"></div>
        <div class="pe-lib-panel" role="dialog" aria-modal="true" aria-labelledby="mp-ask-title">
          <div class="pe-lib-handle" aria-hidden="true"></div>
          <div class="pe-lib-head"><h3 class="pe-lib-title" id="mp-ask-title">¿Activar este plan?</h3></div>
          <div class="xl-sheet-body"><p class="xl-text">${text}</p></div>
          <div class="mp-ask-actions">
            <button type="button" class="pe-save-btn pe-save-btn--wide" data-ask="yes"><span>Activar y guardar</span></button>
            <button type="button" class="mp-ask-btn" data-ask="no">Guardar sin activar</button>
            <button type="button" class="mp-ask-btn is-quiet" data-ask="cancel">Cancelar</button>
          </div>
        </div>`;
      host.appendChild(el);
      const done = v => { el.remove(); resolve(v); };
      el.addEventListener('click', e => {
        const b = e.target.closest('[data-ask]');
        if (!b) return;
        done(b.dataset.ask === 'yes' ? true : b.dataset.ask === 'no' ? false : null);
      });
      const first = el.querySelector('[data-ask="yes"]');
      setTimeout(() => first && first.focus({ preventScroll: true }), 50);
    });
  }

  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || !modal() || !modal().classList.contains('pe-open')) return;
    if (document.body.classList.contains('xg-open')) return;
    if ($('mp-sheet')) { closeSheet(); return; }
    close();
  });

  window.KruxPlansUI = { open, close, askActivate, edit };
})();

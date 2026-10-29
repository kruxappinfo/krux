// ================== ENTRENA — MODELO DE PLANES (múltiples planes) ==================
// Lógica pura (sin DOM ni Firebase), compartida por la interfaz, el almacén y las pruebas.
//
//   users/{uid}/training_plans/{planId}   un documento por plan
//   users/{uid}/training_state/current    { activePlanId } — el plan activo es un puntero
//   users/{uid}/training_sessions/{id}    historial (no depende de que el plan exista)
//
// PLAN (schemaVersion 2)
//   name, weeks (1-16), activeDays[7], sessions[{ id, day, name, exercises[] }],
//   goal?, level?, equipment?[], minutes?,
//   status: 'ready' | 'archived' | 'trashed'     (papelera recuperable)
//   revision (entero; sube 1 en cada guardado → control de concurrencia)
//   sourcePlanId? (duplicado), migratedFrom? ('training_plan/active')
//   createdAt, updatedAt, archivedAt?, trashedAt?, trashedFrom?
//
// Un plan activo es el que apunta training_state/current.activePlanId; solo puede serlo un plan
// 'ready'. Archivar o enviar a la papelera el plan activo vacía el puntero en la MISMA escritura.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KruxPlans = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SCHEMA_VERSION = 2;
  const STATUS = { READY: 'ready', ARCHIVED: 'archived', TRASHED: 'trashed' };
  const LIMITS = { name: 80, weeks: [1, 16], days: 7, sessions: 7, exercises: 30, notes: 300, equipment: 10 };
  const LEGACY_PLAN_ID = 'legacy-active';       // id fijo: la migración nunca duplica
  const DAYS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
  const TEMPO_RE = /^\d{1,2}(-\d{1,2}){1,3}$/;

  const int = v => Math.max(0, Math.round(Number(v) || 0));
  const str = (v, max) => String(v == null ? '' : v).slice(0, max);
  const clone = o => JSON.parse(JSON.stringify(o));

  // ── Identificadores ─────────────────────────────────────────────────
  function randomId(prefix, len) {
    const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let out = '';
    const n = len || 8;
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      const bytes = new Uint8Array(n);
      crypto.getRandomValues(bytes);
      bytes.forEach(b => { out += alphabet[b % alphabet.length]; });
    } else {
      for (let i = 0; i < n; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    return `${prefix}_${out}`;
  }
  const newSessionId = () => randomId('s');

  // ── Ejercicio y plan canónicos ──────────────────────────────────────
  // Misma prescripción plana que usan Entrena, el modo de entrenamiento y el historial.
  function normalizeExercise(e) {
    const out = {
      name: str(e.name, 80), sets: Math.max(1, int(e.sets)), workSec: int(e.workSec), reps: int(e.reps),
      weight: Math.max(0, Number(e.weight) || 0), restSec: int(e.restSec), rpeTarget: Math.min(10, int(e.rpeTarget))
    };
    if (e.exerciseId) {
      out.exerciseId = str(e.exerciseId, 80);
      out.exerciseContentVersion = Math.max(1, int(e.exerciseContentVersion) || 1);
    }
    if (e.notes) out.notes = str(e.notes, LIMITS.notes);
    if (Number(e.assistanceKg) > 0) out.assistanceKg = Math.min(80, Number(e.assistanceKg));
    if (Number(e.distanceM) > 0) out.distanceM = Math.min(5000, int(e.distanceM));
    if (Number(e.recoverySec) > 0) out.recoverySec = Math.min(1800, int(e.recoverySec));
    if (typeof e.tempo === 'string' && TEMPO_RE.test(e.tempo)) out.tempo = e.tempo;
    return out;
  }

  // Normaliza el contenido editable de un plan (no toca estado, revisión ni fechas)
  function normalizeContent(plan) {
    const used = new Set();
    const sessions = (plan.sessions || []).slice(0, LIMITS.sessions).map(s => {
      let id = typeof s.id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(s.id) && !used.has(s.id) ? s.id : newSessionId();
      while (used.has(id)) id = newSessionId();
      used.add(id);
      return { id, day: str(s.day, 2), name: str(s.name, LIMITS.name), exercises: (s.exercises || []).slice(0, LIMITS.exercises).map(normalizeExercise) };
    });
    const out = {
      name: str(plan.name || 'Mi plan', LIMITS.name).trim() || 'Mi plan',
      weeks: Math.min(LIMITS.weeks[1], Math.max(LIMITS.weeks[0], int(plan.weeks) || 4)),
      activeDays: Array.from({ length: LIMITS.days }, (_, i) => !!(plan.activeDays || [])[i]),
      sessions
    };
    if (plan.goal) out.goal = str(plan.goal, 20);
    if (plan.level >= 1 && plan.level <= 3) out.level = Math.round(plan.level);
    if (Array.isArray(plan.equipment)) out.equipment = plan.equipment.slice(0, LIMITS.equipment).map(x => str(x, 20));
    if (plan.minutes >= 10 && plan.minutes <= 240) out.minutes = Math.round(plan.minutes);
    return out;
  }

  // ── Validación (misma lógica que las reglas, para fallar antes de escribir) ──
  function validatePlan(plan) {
    const errors = [];
    const err = m => errors.push(m);
    if (!plan || typeof plan !== 'object') return ['el plan no es un objeto'];
    if (typeof plan.name !== 'string' || !plan.name.trim() || plan.name.length > LIMITS.name) err('nombre inválido');
    if (!Number.isInteger(plan.weeks) || plan.weeks < LIMITS.weeks[0] || plan.weeks > LIMITS.weeks[1]) err('semanas fuera de 1-16');
    if (!Array.isArray(plan.activeDays) || plan.activeDays.length !== LIMITS.days) err('activeDays debe tener 7 días');
    if (!Array.isArray(plan.sessions) || plan.sessions.length > LIMITS.sessions) err('máximo 7 sesiones');
    else {
      const ids = new Set();
      plan.sessions.forEach((s, i) => {
        if (!s.id || ids.has(s.id)) err(`sesión ${i + 1} sin id único`);
        ids.add(s.id);
        if (!Array.isArray(s.exercises) || s.exercises.length > LIMITS.exercises) err(`sesión ${i + 1}: máximo 30 ejercicios`);
        if (s.day !== '?' && s.day !== '' && !DAYS.includes(s.day)) err(`sesión ${i + 1}: día inválido`);
      });
    }
    if (!Object.values(STATUS).includes(plan.status)) err('estado inválido');
    if (!Number.isInteger(plan.revision) || plan.revision < 1) err('revisión inválida');
    if (plan.schemaVersion !== SCHEMA_VERSION) err('schemaVersion inválido');
    return errors;
  }

  // ── Creación, duplicado y migración ─────────────────────────────────
  // `now` es la marca de tiempo que aporta quien escribe (Firestore Timestamp o Date)
  function createPlan(content, now, extra) {
    const plan = Object.assign(normalizeContent(content), {
      schemaVersion: SCHEMA_VERSION, status: STATUS.READY, revision: 1, createdAt: now, updatedAt: now
    }, extra || {});
    return plan;
  }

  // Copia independiente: ids de sesión nuevos, sin estado de archivo, revisión 1
  function duplicatePlan(plan, sourcePlanId, now, name) {
    const base = normalizeContent(clone(plan));
    base.sessions.forEach(s => { s.id = newSessionId(); });
    base.name = str(name || `Copia de ${plan.name}`, LIMITS.name);
    return Object.assign(base, {
      schemaVersion: SCHEMA_VERSION, status: STATUS.READY, revision: 1, createdAt: now, updatedAt: now, sourcePlanId: sourcePlanId || null
    });
  }

  // Documento antiguo users/{uid}/training_plan/active → plan nuevo (no modifica el original)
  function fromLegacy(legacy, now) {
    const content = normalizeContent(clone(legacy));
    // Ids de sesión deterministas (por posición): migrar dos veces da el mismo resultado
    content.sessions.forEach((s, i) => { s.id = `s_legacy${i + 1}`; });
    return Object.assign(content, {
      schemaVersion: SCHEMA_VERSION, status: STATUS.READY, revision: 1, createdAt: now, updatedAt: now, migratedFrom: 'training_plan/active'
    });
  }

  // ── Estados ─────────────────────────────────────────────────────────
  // Acciones: archive, restore (archivo o papelera → ready), trash, purge (borrado definitivo)
  const TRANSITIONS = {
    ready:    { archive: 'archived', trash: 'trashed' },
    archived: { restore: 'ready', trash: 'trashed' },
    trashed:  { restore: 'ready', purge: null }
  };
  function canDo(plan, action) { return !!plan && Object.prototype.hasOwnProperty.call(TRANSITIONS[plan.status] || {}, action); }
  function canActivate(plan) { return !!plan && plan.status === STATUS.READY; }

  // Cambio de estado: devuelve los campos a escribir (la revisión y la fecha las añade el almacén)
  function transition(plan, action, now) {
    if (!canDo(plan, action) || action === 'purge') throw new Error(`Acción no permitida: ${action} sobre ${plan && plan.status}`);
    const next = TRANSITIONS[plan.status][action];
    const patch = { status: next, archivedAt: null, trashedAt: null, trashedFrom: null };
    if (next === STATUS.ARCHIVED) patch.archivedAt = now;
    if (next === STATUS.TRASHED) { patch.trashedAt = now; patch.trashedFrom = plan.status; }
    return patch;
  }

  // ── Resumen para «Mis planes» ───────────────────────────────────────
  function summarize(plan, estimateMinutes) {
    const sessions = plan.sessions || [];
    const exercises = sessions.reduce((n, s) => n + (s.exercises || []).length, 0);
    const days = (plan.activeDays || []).filter(Boolean).length;
    const minutes = estimateMinutes && sessions.length
      ? Math.round(sessions.reduce((n, s) => n + estimateMinutes(s.exercises || []), 0) / sessions.length) : null;
    return { sessions: sessions.length, exercises, days, weeks: plan.weeks, avgMinutes: minutes };
  }

  // Plan activo según el puntero; tolera punteros colgando (plan inexistente, archivado o en papelera)
  function resolveActive(plans, state) {
    const id = state && state.activePlanId;
    if (!id) return null;
    const plan = plans.find(p => p.id === id);
    return plan && plan.status === STATUS.READY ? plan : null;
  }

  // Listado: activo primero, luego por última modificación; la papelera y el archivo van aparte
  function groupPlans(plans, state) {
    const time = p => (p.updatedAt && (p.updatedAt.seconds != null ? p.updatedAt.seconds : +p.updatedAt)) || 0;
    const byRecent = (a, b) => time(b) - time(a) || String(a.name).localeCompare(String(b.name), 'es');
    const activeId = state && state.activePlanId;
    const list = s => plans.filter(p => p.status === s).sort(byRecent);
    const ready = list(STATUS.READY);
    ready.sort((a, b) => (b.id === activeId) - (a.id === activeId));
    return { ready, archived: list(STATUS.ARCHIVED), trashed: list(STATUS.TRASHED) };
  }

  // Control de concurrencia: la edición solo vale si nadie cambió el plan desde que se abrió
  function checkRevision(loadedRevision, storedRevision) {
    return Number.isInteger(loadedRevision) && loadedRevision === storedRevision;
  }

  return {
    SCHEMA_VERSION, STATUS, LIMITS, LEGACY_PLAN_ID, DAYS, TRANSITIONS,
    randomId, newSessionId, normalizeExercise, normalizeContent, validatePlan,
    createPlan, duplicatePlan, fromLegacy, canDo, canActivate, transition,
    summarize, resolveActive, groupPlans, checkRevision
  };
}));

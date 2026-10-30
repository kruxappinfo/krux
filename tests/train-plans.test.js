// Modelo de múltiples planes (lógica pura): validación, duplicado, migración, estados y listado.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const P = require('../train-plans.js');
const NOW = { seconds: 1000 };

const content = () => ({
  name: 'Plan antiguo', weeks: 6, activeDays: [true, false, true, true, true, false, false],
  sessions: [
    { day: 'L', name: 'Fuerza dedos', exercises: [{ name: 'Max hang · 20mm', sets: 4, workSec: 10, reps: 0, weight: 20, restSec: 180, rpeTarget: 8 }, { name: 'Ejercicio mío', sets: 3, workSec: 0, reps: 8, weight: 0, restSec: 90, rpeTarget: 0 }] },
    { day: 'X', name: 'Potencia', exercises: [] }
  ]
});

// Referencia: la normalización que hacía KruxTrainStore antes de los planes múltiples
const int = v => Math.max(0, Math.round(Number(v) || 0));
const str = (v, max) => String(v ?? '').slice(0, max);
function legacyExercisePayload(e) {
  const out = { name: str(e.name, 80), sets: Math.max(1, int(e.sets)), workSec: int(e.workSec), reps: int(e.reps), weight: Math.max(0, Number(e.weight) || 0), restSec: int(e.restSec), rpeTarget: Math.min(10, int(e.rpeTarget)) };
  if (e.exerciseId) { out.exerciseId = str(e.exerciseId, 80); out.exerciseContentVersion = Math.max(1, int(e.exerciseContentVersion) || 1); }
  if (e.notes) out.notes = str(e.notes, 300);
  if (Number(e.assistanceKg) > 0) out.assistanceKg = Math.min(80, Number(e.assistanceKg));
  if (Number(e.distanceM) > 0) out.distanceM = Math.min(5000, int(e.distanceM));
  if (Number(e.recoverySec) > 0) out.recoverySec = Math.min(1800, int(e.recoverySec));
  if (typeof e.tempo === 'string' && /^\d{1,2}(-\d{1,2}){1,3}$/.test(e.tempo)) out.tempo = e.tempo;
  return out;
}

describe('normalización', () => {
  it('la prescripción de un ejercicio es idéntica a la que ya guardaba Entrena', () => {
    const samples = [
      { name: 'x', sets: 0, workSec: -3, reps: '7', weight: '12.5', restSec: 1e9, rpeTarget: 15 },
      { name: 'y'.repeat(200), sets: 3, exerciseId: 'max-hang', exerciseContentVersion: 0, notes: 'n'.repeat(400), assistanceKg: 200, distanceM: 99999, recoverySec: 99999, tempo: '3-1-1' },
      { name: 'z', tempo: 'rápido', assistanceKg: 0, distanceM: -2 },
      { name: null, sets: null }
    ];
    samples.forEach(s => expect(P.normalizeExercise(s)).toEqual(legacyExercisePayload(s)));
  });

  it('respeta los límites del plan', () => {
    const big = { name: 'p', weeks: 99, activeDays: [true], sessions: Array(10).fill({ day: 'L', name: 's', exercises: Array(40).fill({ name: 'e', sets: 1 }) }), equipment: Array(20).fill('x'), level: 7, minutes: 5 };
    const n = P.normalizeContent(big);
    expect(n.weeks).toBe(16);
    expect(n.activeDays).toHaveLength(7);
    expect(n.sessions).toHaveLength(7);
    expect(n.sessions[0].exercises).toHaveLength(30);
    expect(n.equipment).toHaveLength(10);
    expect(n.level).toBeUndefined();
    expect(n.minutes).toBeUndefined();
    expect(P.normalizeContent({ name: '   ', sessions: [] }).name).toBe('Mi plan');
  });

  it('cada sesión tiene un id único y estable', () => {
    const n = P.normalizeContent({ name: 'p', sessions: [{ id: 's_a', name: 'a' }, { id: 's_a', name: 'b' }, { name: 'c' }] });
    const ids = n.sessions.map(s => s.id);
    expect(new Set(ids).size).toBe(3);
    expect(ids[0]).toBe('s_a');
    expect(P.normalizeContent(n).sessions.map(s => s.id)).toEqual(ids);   // normalizar dos veces no cambia ids
  });
});

describe('validación', () => {
  const plan = () => P.createPlan(content(), NOW);

  it('un plan creado es válido', () => { expect(P.validatePlan(plan())).toEqual([]); });

  it('detecta planes inválidos', () => {
    const bad = plan();
    bad.weeks = 17; bad.status = 'activo'; bad.revision = 0; bad.activeDays = [true];
    bad.sessions = Array(8).fill({ id: 'a', day: 'L', exercises: [] });
    const e = P.validatePlan(bad).join('|');
    ['semanas', 'estado', 'revisión', 'activeDays', 'máximo 7 sesiones'].forEach(t => expect(e).toContain(t));
    expect(P.validatePlan(null)).toHaveLength(1);
  });

  it('detecta ids de sesión repetidos y días inválidos', () => {
    const p = plan(); p.sessions[1].id = p.sessions[0].id; p.sessions[0].day = 'Z';
    const e = P.validatePlan(p).join('|');
    expect(e).toContain('id único'); expect(e).toContain('día inválido');
  });
});

describe('duplicar', () => {
  it('crea una copia independiente: ids nuevos, revisión 1, sin estado de archivo', () => {
    const src = Object.assign(P.createPlan(content(), NOW), { status: 'archived', archivedAt: NOW, revision: 9, migratedFrom: 'training_plan/active' });
    const copy = P.duplicatePlan(src, 'abc', { seconds: 2000 });
    expect(copy.name).toBe('Copia de Plan antiguo');
    expect(copy.status).toBe('ready'); expect(copy.revision).toBe(1);
    expect(copy.sourcePlanId).toBe('abc');
    expect(copy.archivedAt).toBeUndefined(); expect(copy.migratedFrom).toBeUndefined();
    expect(copy.sessions.map(s => s.id)).not.toEqual(src.sessions.map(s => s.id));
    expect(copy.sessions.map(s => s.name)).toEqual(src.sessions.map(s => s.name));
    expect(P.validatePlan(copy)).toEqual([]);
  });

  it('modificar la copia no toca el original', () => {
    const src = P.createPlan(content(), NOW);
    const before = JSON.stringify(src);
    const copy = P.duplicatePlan(src, 'x', NOW);
    copy.sessions[0].exercises[0].sets = 99; copy.sessions[0].name = 'Cambiada'; copy.weeks = 1;
    expect(JSON.stringify(src)).toBe(before);
  });

  it('respeta el nombre indicado y el máximo de 80 caracteres', () => {
    const src = P.createPlan(Object.assign(content(), { name: 'x'.repeat(80) }), NOW);
    expect(P.duplicatePlan(src, 'a', NOW).name).toHaveLength(80);
    expect(P.duplicatePlan(src, 'a', NOW, 'Mi copia').name).toBe('Mi copia');
  });
});

describe('migración desde training_plan/active', () => {
  const legacy = () => Object.assign(content(), { updatedAt: 'ignorado' });

  it('conserva nombre, semanas, días, sesiones y prescripciones', () => {
    const plan = P.fromLegacy(legacy(), NOW);
    const src = content();
    expect(plan.name).toBe(src.name); expect(plan.weeks).toBe(src.weeks); expect(plan.activeDays).toEqual(src.activeDays);
    expect(plan.sessions.map(s => ({ day: s.day, name: s.name, exercises: s.exercises }))).toEqual(src.sessions.map(s => ({ day: s.day, name: s.name, exercises: s.exercises.map(legacyExercisePayload) })));
    expect(plan.status).toBe('ready'); expect(plan.revision).toBe(1); expect(plan.migratedFrom).toBe('training_plan/active');
    expect(P.validatePlan(plan)).toEqual([]);
  });

  it('es determinista: migrar dos veces produce el mismo contenido', () => {
    const a = P.fromLegacy(legacy(), NOW), b = P.fromLegacy(legacy(), NOW);
    expect(a).toEqual(b);
    expect(a.sessions.map(s => s.id)).toEqual(['s_legacy1', 's_legacy2']);
  });

  it('no modifica el documento antiguo', () => {
    const src = legacy(); const before = JSON.stringify(src);
    P.fromLegacy(src, NOW);
    expect(JSON.stringify(src)).toBe(before);
  });

  it('conserva objetivo, nivel y material del asistente si los hay', () => {
    const plan = P.fromLegacy(Object.assign(legacy(), { goal: 'fuerza', level: 2, equipment: ['barra'] }), NOW);
    expect([plan.goal, plan.level, plan.equipment]).toEqual(['fuerza', 2, ['barra']]);
  });

  it('tolera documentos antiguos incompletos', () => {
    [{}, { name: 'solo nombre' }, { sessions: [{ name: 'x' }] }, { weeks: 'tres', activeDays: null, sessions: null }].forEach(l => {
      const p = P.fromLegacy(l, NOW);
      expect(P.validatePlan(Object.assign({}, p, { sessions: p.sessions.map(s => Object.assign({}, s, { day: s.day || '?' })) }))).toEqual([]);
    });
  });
  it('el id fijo de la migración está definido', () => { expect(P.LEGACY_PLAN_ID).toBe('legacy-active'); });
});

describe('estados', () => {
  const plan = status => Object.assign(P.createPlan(content(), NOW), { status });

  it('transiciones permitidas', () => {
    expect(P.canDo(plan('ready'), 'archive')).toBe(true);
    expect(P.canDo(plan('ready'), 'trash')).toBe(true);
    expect(P.canDo(plan('ready'), 'restore')).toBe(false);
    expect(P.canDo(plan('ready'), 'purge')).toBe(false);          // el borrado definitivo solo desde la papelera
    expect(P.canDo(plan('archived'), 'restore')).toBe(true);
    expect(P.canDo(plan('archived'), 'purge')).toBe(false);
    expect(P.canDo(plan('trashed'), 'restore')).toBe(true);
    expect(P.canDo(plan('trashed'), 'purge')).toBe(true);
    expect(P.canDo(plan('trashed'), 'archive')).toBe(false);
    expect(P.canDo(null, 'archive')).toBe(false);
  });

  it('solo un plan disponible puede activarse', () => {
    expect(P.canActivate(plan('ready'))).toBe(true);
    expect(P.canActivate(plan('archived'))).toBe(false);
    expect(P.canActivate(plan('trashed'))).toBe(false);
    expect(P.canActivate(null)).toBe(false);
  });

  it('transition devuelve los campos a escribir y rechaza lo no permitido', () => {
    expect(P.transition(plan('ready'), 'archive', NOW)).toEqual({ status: 'archived', archivedAt: NOW, trashedAt: null, trashedFrom: null });
    expect(P.transition(plan('archived'), 'trash', NOW)).toEqual({ status: 'trashed', archivedAt: null, trashedAt: NOW, trashedFrom: 'archived' });
    expect(P.transition(plan('trashed'), 'restore', NOW)).toEqual({ status: 'ready', archivedAt: null, trashedAt: null, trashedFrom: null });
    expect(() => P.transition(plan('ready'), 'purge', NOW)).toThrow();
    expect(() => P.transition(plan('ready'), 'restore', NOW)).toThrow();
  });
});

describe('listado y plan activo', () => {
  const mk = (id, status, seconds, name) => Object.assign(P.createPlan(content(), { seconds }), { id, status, name: name || id, updatedAt: { seconds } });
  const plans = [mk('a', 'ready', 10), mk('b', 'ready', 30), mk('c', 'archived', 20), mk('d', 'trashed', 5), mk('e', 'ready', 20)];

  it('el plan activo va primero y el resto por fecha', () => {
    const g = P.groupPlans(plans, { activePlanId: 'a' });
    expect(g.ready.map(p => p.id)).toEqual(['a', 'b', 'e']);
    expect(g.archived.map(p => p.id)).toEqual(['c']);
    expect(g.trashed.map(p => p.id)).toEqual(['d']);
    expect(P.groupPlans(plans, null).ready.map(p => p.id)).toEqual(['b', 'e', 'a']);
  });

  it('cada plan está en un único grupo', () => {
    const g = P.groupPlans(plans, { activePlanId: 'b' });
    expect(g.ready.length + g.archived.length + g.trashed.length).toBe(plans.length);
  });

  it('resolveActive tolera punteros colgando', () => {
    expect(P.resolveActive(plans, { activePlanId: 'b' }).id).toBe('b');
    expect(P.resolveActive(plans, { activePlanId: 'c' })).toBeNull();      // archivado
    expect(P.resolveActive(plans, { activePlanId: 'd' })).toBeNull();      // en la papelera
    expect(P.resolveActive(plans, { activePlanId: 'zzz' })).toBeNull();    // inexistente
    expect(P.resolveActive(plans, { activePlanId: null })).toBeNull();
    expect(P.resolveActive(plans, null)).toBeNull();
    expect(P.resolveActive([], { activePlanId: 'a' })).toBeNull();
  });

  it('resumen de un plan', () => {
    const s = P.summarize(plans[0], items => items.length * 10);
    expect(s).toMatchObject({ sessions: 2, exercises: 2, days: 4, weeks: 6 });
    expect(s.avgMinutes).toBe(10);
    expect(P.summarize({ sessions: [], activeDays: [] }).avgMinutes).toBeNull();
  });
});

describe('concurrencia y ids', () => {
  it('la edición solo vale con la revisión con la que se abrió', () => {
    expect(P.checkRevision(3, 3)).toBe(true);
    expect(P.checkRevision(3, 4)).toBe(false);
    expect(P.checkRevision(undefined, 1)).toBe(false);
  });
  it('los ids generados no se repiten', () => {
    const ids = new Set(Array.from({ length: 2000 }, () => P.newSessionId()));
    expect(ids.size).toBe(2000);
    [...ids].forEach(id => expect(id).toMatch(/^s_[a-z0-9]{8}$/));
  });
});

describe('inicio programado', () => {
  const rd = (id, startDate, extra) => ({ id, status: 'ready', startDate, ...(extra || {}) });
  it('valida el formato de la fecha y que exista en el calendario', () => {
    expect(P.isDateKey('2026-11-02')).toBe(true);
    ['2026-02-30', '2/11/2026', '2026-1-2', '', null, 20261102].forEach(v => expect(P.isDateKey(v)).toBe(false));
  });
  it('normalizeContent conserva una fecha válida y descarta una inválida', () => {
    const base = { name: 'X', weeks: 4, activeDays: [true, false, false, false, false, false, false], sessions: [] };
    expect(P.normalizeContent({ ...base, startDate: '2026-11-02' }).startDate).toBe('2026-11-02');
    expect('startDate' in P.normalizeContent({ ...base, startDate: 'mañana' })).toBe(false);
    expect('startDate' in P.normalizeContent({ ...base, startDate: null })).toBe(false);
  });
  it('un duplicado no hereda la programación', () => {
    const src = { ...P.createPlan({ name: 'X', weeks: 4, activeDays: [true, false, false, false, false, false, false], sessions: [], startDate: '2026-11-02' }, 1) };
    expect(src.startDate).toBe('2026-11-02');
    expect('startDate' in P.duplicatePlan(src, 'src', 2)).toBe(false);
  });
  it('archivar o enviar a la papelera un plan programado quita la programación', () => {
    const NOW = 123, plain = { status: 'ready' };
    const scheduledPlan = { ...plain, startDate: '2026-11-02' };
    expect(P.transition(scheduledPlan, 'archive', NOW).startDate).toBeNull();
    expect(P.transition(scheduledPlan, 'trash', NOW).startDate).toBeNull();
    expect('startDate' in P.transition(plain, 'archive', NOW)).toBe(false);
  });
  it('validatePlan rechaza una fecha mal formada', () => {
    const ok = P.createPlan({ name: 'X', weeks: 4, activeDays: [true, false, false, false, false, false, false], sessions: [] }, 1);
    expect(P.validatePlan({ ...ok, startDate: '2026-11-02' })).toEqual([]);
    expect(P.validatePlan({ ...ok, startDate: null })).toEqual([]);
    expect(P.validatePlan({ ...ok, startDate: '02-11-2026' }).length).toBe(1);
  });
  it('dueSchedule: antes de la fecha no hace nada; el día de inicio activa el plan', () => {
    const plans = [rd('a', undefined), rd('b', '2026-11-02')];
    expect(P.dueSchedule(plans, { activePlanId: 'a' }, '2026-11-01')).toEqual({ apply: null, clear: [] });
    const r = P.dueSchedule(plans, { activePlanId: 'a' }, '2026-11-02');
    expect(r.apply.id).toBe('b'); expect(r.clear).toEqual([]);
  });
  it('dueSchedule: pasadas varias fechas gana la más reciente y consume las demás', () => {
    const plans = [rd('a', undefined), rd('b', '2026-11-02'), rd('c', '2026-11-09'), rd('d', '2026-12-01')];
    const r = P.dueSchedule(plans, { activePlanId: 'a' }, '2026-11-20');
    expect(r.apply.id).toBe('c'); expect(r.clear.map(p => p.id)).toEqual(['b']);
  });
  it('dueSchedule: si el plan ya es el activo solo se consume la programación', () => {
    const plans = [rd('a', '2026-11-02'), rd('b', undefined)];
    const r = P.dueSchedule(plans, { activePlanId: 'a' }, '2026-11-05');
    expect(r.apply).toBeNull(); expect(r.clear.map(p => p.id)).toEqual(['a']);
  });
  it('dueSchedule: si el activo tiene una fecha posterior a la del otro, no se cambia de plan', () => {
    const plans = [rd('a', '2026-11-09'), rd('b', '2026-11-02')];
    const r = P.dueSchedule(plans, { activePlanId: 'a' }, '2026-11-20');
    expect(r.apply).toBeNull(); expect(r.clear.map(p => p.id).sort()).toEqual(['a', 'b']);
  });
  it('dueSchedule ignora planes archivados o en la papelera', () => {
    const plans = [rd('a', undefined), rd('b', '2026-11-02', { status: 'archived' }), rd('c', '2026-11-02', { status: 'trashed' })];
    expect(P.dueSchedule(plans, { activePlanId: 'a' }, '2026-11-05')).toEqual({ apply: null, clear: [] });
  });
  it('planOnDate: rige el programado cuya fecha de inicio ya habrá llegado', () => {
    const plans = [rd('a', undefined), rd('b', '2026-11-02'), rd('c', '2026-12-01')];
    expect(P.planOnDate(plans, '2026-11-01')).toBeNull();
    expect(P.planOnDate(plans, '2026-11-02').id).toBe('b');
    expect(P.planOnDate(plans, '2026-12-15').id).toBe('c');
  });
});

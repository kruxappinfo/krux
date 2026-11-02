// Pruebas del recomendador de Entrena («Para ti»): seguridad, compatibilidad, recuperación e historial (lógica pura).
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const X = require('../train-exercises.js');
const R = require('../train-recommender.js');
const P = require('../train-profile.js');
const catalog = X.createCatalog(require('../train-catalog-data.js'));
const MENTAL = [{ id: 'm05-respiracion-ante-el-miedo', title: 'Respiración ante el miedo', minutes: 3 }, { id: 'p01-inventario-de-fortalezas', title: 'Inventario de fortalezas', minutes: 8 }];

const prof = (o = {}) => P.normalizeProfile({
  status: 'completed', goalPrimary: 'grado', experience: '2-4', daysPerWeek: 3, minutesPerSession: 60, modality: 'ambas', environment: 'ambos',
  rockFrequency: 1, equipment: ['multipresa', 'gimnasio', 'bandas'], grades: { sport: { usualFrom: '6a', max: '6b', target: '6c' }, boulder: { usualFrom: '6A', max: '6B', target: '7A' } }, ...o
});
const rec = (o = {}) => {
  const profile = o.profile || prof();
  return R.recommend({ catalog, X, profile, limits: o.limits || null, history: o.history || [], today: '2026-11-02', equipment: P.catalogEquipment(profile), mental: o.mental, mentalItems: MENTAL });
};
const names = r => r.items.filter(i => i.kind === 'session').flatMap(i => i.session.exercises.map(e => e.name));
const exOf = name => catalog.exercises.find(e => e.name === name);
const entry = (dateKey, rpe, extra = {}) => ({ dateKey, sessionName: 'Sesión', rpe, exercises: [], ...extra });

describe('seguridad: las limitaciones son filtros obligatorios', () => {
  ['dedos', 'hombros', 'codos', 'munecas', 'espalda', 'rodillas'].forEach(zone => {
    it(`con «${zone}» no se recomienda nada que cargue esa zona (en ningún objetivo ni nivel)`, () => {
      ['grado', 'fuerza', 'resistencia', 'tecnica', 'competicion', 'forma'].forEach(goal => ['lt1', '2-4', 'gt4'].forEach(experience => {
        const r = rec({ profile: prof({ goalPrimary: goal, experience }), limits: { items: [zone] } });
        names(r).forEach(n => expect(R.loadsZone(zone, exOf(n)), `${zone}/${goal}/${experience}: ${n}`).toBe(false));
      }));
    });
  });
  it('varias limitaciones se suman', () => {
    const r = rec({ limits: { items: ['dedos', 'hombros', 'codos'] } });
    names(r).forEach(n => ['dedos', 'hombros', 'codos'].forEach(z => expect(R.loadsZone(z, exOf(n))).toBe(false)));
  });
  it('lo que se agarra con las manos (barra, pesas, gomas, poleas) cuenta como carga de dedos, codos y muñecas', () => {
    const jalon = exOf('Jalón en polea');
    ['dedos', 'codos', 'munecas'].forEach(z => expect(R.loadsZone(z, jalon), z).toBe(true));
    expect(names(rec({ limits: { items: ['dedos'] } }))).not.toContain('Jalón en polea');
  });
  it('un ejercicio sin datos de zona no se da por seguro', () => {
    expect(R.loadsZone('dedos', { bodyAreas: [], movementPatterns: [], equipment: { required: [] } })).toBe(true);
  });
  it('«otra» limitación no se puede comprobar: ninguna propuesta se presenta como segura', () => {
    const r = rec({ limits: { items: ['otra'], other: 'cuello' } });
    expect(r.items.length).toBeGreaterThan(0);
    r.items.filter(i => i.kind === 'session').forEach(i => { expect(i.safety.state).toBe('unverified'); expect(i.safety.text).toContain('cuello'); expect(i.safety.text).toContain('no podemos comprobar'); });
  });
  it('sin limitaciones indicadas se avisa en lugar de dar por bueno el filtro', () => {
    rec().items.forEach(i => expect(['unknown', 'mental']).toContain(i.safety.state));
    expect(rec().items.find(i => i.kind === 'session').safety.text).toContain('No has indicado limitaciones');
  });
  it('si no queda nada compatible se dice y no se inventa una sesión', () => {
    const r = rec({ profile: prof({ environment: 'roca', equipment: ['ninguno'], experience: 'lt1' }), limits: { items: ['dedos', 'hombros', 'codos', 'munecas', 'espalda', 'rodillas'] } });
    expect(r.items.filter(i => i.kind === 'session')).toHaveLength(0);
    expect(r.empty).toContain('no hay entrenamientos compatibles');
  });
});

describe('compatibilidad: nivel, material y tiempo', () => {
  it('un principiante no recibe ejercicios de nivel mínimo superior ni de exigencia alta', () => {
    const r = rec({ profile: prof({ experience: 'lt1', goalPrimary: 'fuerza' }) });
    names(r).forEach(n => { expect(exOf(n).safety.minLevel).toBe(1); expect(exOf(n).physicalDemand).toBeLessThanOrEqual(2); });
  });
  it('solo usa material que la persona tiene (peso corporal siempre cuenta)', () => {
    const profile = prof({ environment: 'roca', equipment: ['bandas'] });
    const have = P.catalogEquipment(profile).concat('peso-corporal');
    names(rec({ profile })).forEach(n => exOf(n).equipment.required.forEach(id => expect(have.includes(id) || exOf(n).equipment.alternatives.some(a => have.includes(a))).toBe(true)));
  });
  it('cabe en el tiempo disponible', () => {
    const r = rec({ profile: prof({ minutesPerSession: 30 }) });
    r.items.filter(i => i.kind === 'session').forEach(i => expect(i.minutes).toBeLessThanOrEqual(30));
  });
  it('el objetivo cambia el enfoque', () => {
    const focus = (goal, experience) => rec({ profile: prof({ goalPrimary: goal, experience }) }).items.find(i => i.kind === 'session').focus;
    expect(focus('tecnica', '2-4')).toBe('tecnica');
    expect(focus('resistencia', '2-4')).toBe('resistencia');
    expect(['dedos', 'traccion', 'general']).toContain(focus('fuerza', '2-4'));
    expect(focus('forma', '2-4')).toBe('general');
  });
  it('cada propuesta trae los datos que se muestran', () => {
    rec().items.forEach(i => ['title', 'objective', 'minutes', 'level', 'demand', 'equipment', 'reason', 'safety'].forEach(k => expect(i[k], k).toBeDefined()));
    expect(rec().items[0].session.exercises.every(e => e.name && e.sets >= 1)).toBe(true);
  });
  it('la explicación cita datos del perfil, no frases genéricas', () => {
    const t = rec({ profile: prof({ minutesPerSession: 45, goalPrimary: 'tecnica' }) }).items[0].reason;
    expect(t).toContain('mejorar tu técnica'); expect(t).toContain('45');
  });
});

describe('historial y recuperación', () => {
  it('sin historial usa el perfil y lo dice', () => {
    const r = rec();
    expect(r.note).toContain('Aún no tienes sesiones registradas'); expect(r.context.sessions).toBe(0);
  });
  it('tras una sesión intensa ayer propone una sesión suave, sin ejercicios de exigencia alta', () => {
    const r = rec({ history: [entry('2026-11-01', 9)] });
    const s = r.items.filter(i => i.kind === 'session');
    expect(s).toHaveLength(1); expect(s[0].soft).toBe(true); expect(s[0].title).toContain('suave');
    expect(s[0].reason).toContain('ayer'); expect(s[0].reason).toContain('RPE 9');
    names(r).forEach(n => expect(exOf(n).physicalDemand).toBe(1));
  });
  it('dos días seguidos entrenando también activa la recuperación', () => {
    expect(rec({ history: [entry('2026-11-01', 6), entry('2026-10-31', 6)] }).items[0].soft).toBe(true);
  });
  it('con la frecuencia semanal cumplida propone algo suave', () => {
    const r = rec({ history: [entry('2026-10-31', 5), entry('2026-10-29', 5), entry('2026-10-27', 5)] });
    expect(r.items[0].soft).toBe(true); expect(r.items[0].reason).toContain('3 sesiones');
  });
  it('si la última sesión fue hace días y cómoda no se fuerza la recuperación', () => {
    expect(rec({ history: [entry('2026-10-28', 5)] }).items[0].soft).toBe(false);
  });
  it('el enfoque va hacia lo menos trabajado en las dos últimas semanas', () => {
    const tecnica = catalog.exercises.find(e => e.primaryCategoryId === 'tecnica');
    const h = [entry('2026-10-27', 5, { exercises: [{ name: tecnica.name, exerciseId: tecnica.id, sets: [] }] })];
    expect(rec({ history: h }).items.find(i => i.kind === 'session').focus).not.toBe('tecnica');
  });
  it('no repite los ejercicios de los últimos días si hay alternativas', () => {
    const first = rec().items[0].session.exercises.map(e => e.name);
    const ex = first.map(n => ({ name: n, exerciseId: exOf(n).id, sets: [] }));
    const again = rec({ history: [entry('2026-10-30', 5, { exercises: ex })] }).items[0].session.exercises.map(e => e.name);
    expect(again.filter(n => !first.includes(n)).length).toBeGreaterThan(0);
  });
  it('nunca sube la carga: la prescripción no supera la del catálogo', () => {
    rec({ history: [entry('2026-10-25', 3), entry('2026-10-22', 3), entry('2026-10-20', 3)] }).items.filter(i => i.kind === 'session').forEach(i => i.session.exercises.forEach(it => {
      const base = X.planItemFromExercise(exOf(it.name));
      expect(it.sets).toBeLessThanOrEqual(base.sets); expect(it.weight).toBeLessThanOrEqual(base.weight);
    }));
  });
  it('sesiones cómodas recientes: solo se sugiere, no se aplica', () => {
    const r = rec({ history: [entry('2026-10-25', 4), entry('2026-10-22', 5), entry('2026-10-20', 4)] });
    expect(r.note).toContain('Krux no lo hace automáticamente');
  });
  it('ignora registros de ejemplo y fechas futuras o inválidas', () => {
    const r = rec({ history: [entry('2026-11-01', 9, { demo: true }), entry('2026-11-20', 9), entry('mal', 9)] });
    expect(r.context.sessions).toBe(0); expect(r.items[0].soft).toBe(false);
  });
});

describe('confianza y miedo a caer (evaluación mental)', () => {
  it('sin evaluación mental no se recomienda nada mental', () => {
    expect(rec().items.some(i => i.kind === 'mental')).toBe(false);
    expect(rec({ mental: { answers: { fear: 'skip', confidence: 'unknown' } } }).items.some(i => i.kind === 'mental')).toBe(false);
  });
  it('miedo alto → práctica de respiración, citando la respuesta', () => {
    const m = rec({ mental: { answers: { fear: 4 } } }).items.find(i => i.kind === 'mental');
    expect(m.mentalId).toBe('m05-respiracion-ante-el-miedo'); expect(m.reason).toContain('4 de 5'); expect(m.safety.text).toContain('no sustituye');
  });
  it('poca confianza → inventario de fortalezas', () => {
    expect(rec({ mental: { answers: { confidence: 2 } } }).items.find(i => i.kind === 'mental').mentalId).toBe('p01-inventario-de-fortalezas');
  });
  it('respuestas moderadas no generan recomendación', () => {
    expect(rec({ mental: { answers: { fear: 3, confidence: 3 } } }).items.some(i => i.kind === 'mental')).toBe(false);
  });
});

describe('grados por entorno y disponibilidad para escalar', () => {
  const practices = (profile) => P.practices(profile).map(pr => { const g = P.gradesFor(profile, pr.env, pr.scale) || {}; return { key: pr.key, label: pr.label, env: pr.env, scale: pr.scale, usual: g.usualFrom, max: g.max }; });
  const run = (profile, limits) => R.recommend({ catalog, X, profile, practices: practices(profile), limits: limits || null, history: [], today: '2026-11-02', equipment: P.catalogEquipment(profile), mentalItems: MENTAL });
  it('el grado se toma de la modalidad y entorno de la sesión, sin convertir entre roca y rocódromo', () => {
    expect(R.gradeLevel('sport', '5c')).toBe(1);
    expect(R.gradeLevel('sport', '6b')).toBe(2);
    expect(R.gradeLevel('boulder', '7A')).toBe(3);
    expect(R.gradeLevel('sport', 'unknown')).toBeNull();
    const p = prof({ experience: 'gt4', modality: 'deportiva', environment: 'ambos', grades: { sport: { usualFrom: '7b', max: '7c', target: '8a' } }, gradesGym: { sport: { usualFrom: '5c', max: '6a' } } });
    const r = run(p);
    const [first, second] = r.items.filter(i => i.kind === 'session');
    expect(first.practice).toBe('roca.sport');
    expect(second.practice).toBe('rocodromo.sport');
    expect(first.reason).toContain('deportiva en roca');
    expect(second.reason).toContain('deportiva en rocódromo');
    expect(second.level.toLowerCase()).not.toBe(first.level.toLowerCase());   // el nivel del rocódromo (5c) no hereda el de roca (7b)
  });
  it('un grado bajo nunca sube el nivel que da la experiencia', () => {
    const p = prof({ experience: 'lt1', modality: 'deportiva', environment: 'roca', grades: { sport: { usualFrom: '7b', max: '7c', target: '8a' } } });
    expect(run(p).context.level).toBe(1);
  });
  it('los días para escalar no se confunden con la frecuencia de entrenamiento', () => {
    expect([1, 2, 3, 4, 5, 6, 7].map(R.trainPerWeek)).toEqual([1, 1, 2, 2, 3, 3, 3]);
    const p = prof({ daysPerWeek: 6 });
    const hist = [entry('2026-11-01', 5), entry('2026-10-30', 5), entry('2026-10-29', 5)].map(e => ({ ...e, exercises: [] }));
    // 3 sesiones de entrenamiento = frecuencia complementaria de 6 días de escalada → sesión suave; antes 3 sesiones con 6 días no la activaban
    const r = R.recommend({ catalog, X, profile: p, practices: practices(p), limits: null, history: hist, today: '2026-11-03', equipment: P.catalogEquipment(p), mentalItems: MENTAL });
    expect(r.context.climbDays).toBe(6);
    expect(r.context.planned).toBe(3);
    expect(r.context.soft).toBe(true);
  });
  it('mantiene los filtros de seguridad con grados por entorno', () => {
    const p = prof({ modality: 'ambas', environment: 'ambos', gradesGym: { sport: { usualFrom: '6a', max: '6b' }, boulder: { usualFrom: '6A', max: '6B' } } });
    names(run(p, { items: ['dedos'] })).forEach(n => expect(R.loadsZone('dedos', exOf(n))).toBe(false));
  });
});

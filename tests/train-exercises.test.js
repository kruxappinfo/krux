// Pruebas del catálogo y del recomendador de Entrena (lógica pura, sin DOM ni Firebase).
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const DATA = require('../train-catalog-data.js');
const K = require('../train-exercises.js');
const catalog = K.createCatalog(DATA);

describe('catálogo', () => {
  it('es válido: campos, rangos, categorías, material y relaciones', () => {
    expect(K.validateCatalog(DATA)).toEqual([]);
  });

  it('cubre las 10 categorías y todas tienen ejercicios', () => {
    expect(catalog.categories).toHaveLength(10);
    catalog.categories.forEach(c => {
      expect(catalog.exercises.some(e => e.primaryCategoryId === c.id), c.id).toBe(true);
    });
  });

  it('las fichas no están validadas hasta que alguien las revise', () => {
    expect(catalog.exercises.every(e => e.review.status === 'pending')).toBe(true);
  });

  it('no inventa multimedia', () => {
    expect(catalog.exercises.every(e => e.media.items.length === 0 && e.media.primaryMediaId === null)).toBe(true);
  });

  it('detecta fichas inválidas', () => {
    const bad = JSON.parse(JSON.stringify(DATA));
    bad.exercises[0].relations.progressions = [{ exerciseId: 'no-existe', reason: 'x', order: 1 }];
    bad.exercises[1].primaryCategoryId = 'inventada';
    bad.exercises[2].prescriptionSchema[0].default = 999;
    bad.exercises[3].id = bad.exercises[4].id;
    const errors = K.validateCatalog(bad).join('\n');
    expect(errors).toContain('inexistente: no-existe');
    expect(errors).toContain('categoría principal inexistente');
    expect(errors).toContain('fuera de rango');
    expect(errors).toContain('repetido');
  });

  it('detecta ciclos de progresión', () => {
    const bad = JSON.parse(JSON.stringify(DATA));
    const a = bad.exercises.find(e => e.id === 'plancha');
    const b = bad.exercises.find(e => e.id === 'hollow-body');
    b.relations.progressions = [{ exerciseId: 'plancha', reason: 'x', order: 1 }];
    expect(a.relations.progressions.some(r => r.exerciseId === 'hollow-body')).toBe(true);
    expect(K.validateCatalog(bad).join('\n')).toContain('ciclo en progresiones');
  });

  it('una ficha revisada exige quién y cuándo', () => {
    const ex = JSON.parse(JSON.stringify(DATA.exercises[0]));
    ex.review = { status: 'reviewed', reviewedBy: null, reviewedAt: null, notes: '' };
    expect(K.validateExercise(ex, catalog).join()).toContain('reviewedBy');
  });
});

describe('búsqueda y filtros', () => {
  const names = list => list.map(e => e.id);

  it('encuentra por nombre, alias y sinónimos sin tildes', () => {
    expect(names(K.filterExercises(catalog, { query: 'dominadas' }))).toContain('dominada-estricta');
    expect(names(K.filterExercises(catalog, { query: 'pull up' }))).toContain('dominada-estricta');
    expect(names(K.filterExercises(catalog, { query: 'colgarse' }))).toContain('suspension-pasiva');
    expect(names(K.filterExercises(catalog, { query: 'plank' }))[0]).toBe('plancha');
    expect(names(K.filterExercises(catalog, { query: 'MUNECA' }))).toContain('estiramiento-muneca');
  });

  it('tolera una errata en palabras largas', () => {
    expect(names(K.filterExercises(catalog, { query: 'plancah' }))).toContain('plancha');
    expect(names(K.filterExercises(catalog, { query: 'sentadila' }))).toContain('sentadilla');
  });

  it('los nombres exactos van primero', () => {
    expect(K.filterExercises(catalog, { query: 'max hang' })[0].id).toBe('max-hang');
  });

  it('sin resultados devuelve lista vacía', () => {
    expect(K.filterExercises(catalog, { query: 'xyzqwerty' })).toEqual([]);
  });

  it('los filtros se combinan (AND entre grupos, OR dentro)', () => {
    const r = K.filterExercises(catalog, { categoryId: 'core', technicalLevel: [1] });
    expect(r.length).toBeGreaterThan(0);
    r.forEach(e => { expect(e.categoryIds).toContain('core'); expect(e.technicalLevel).toBe(1); });

    const eq = K.filterExercises(catalog, { equipment: ['barra', 'gomas'] });
    eq.forEach(e => expect(e.equipment.required.concat(e.equipment.alternatives).some(x => ['barra', 'gomas'].includes(x))).toBe(true));

    const none = K.filterExercises(catalog, { equipment: ['ninguno'] });
    none.forEach(e => expect(e.equipment.required.every(x => x === 'peso-corporal') || e.equipment.required.length === 0).toBe(true));

    const mixed = K.filterExercises(catalog, { query: 'goma', bodyAreas: ['hombros'], durations: ['corto'] });
    mixed.forEach(e => { expect(e.bodyAreas).toContain('hombros'); expect(e.durationMin).toBeLessThanOrEqual(10); });
  });

  it('filtra por favoritos', () => {
    const r = K.filterExercises(catalog, { favoritesOnly: true, favoriteIds: ['plancha', 'arc'] });
    expect(r.map(e => e.id).sort()).toEqual(['arc', 'plancha']);
  });
});

describe('relaciones', () => {
  it('devuelve solo relaciones con ejercicios existentes y por orden', () => {
    const rels = K.getRelations(catalog, catalog.byId.get('max-hang'));
    expect(rels.map(r => r.type)).toEqual(expect.arrayContaining(['regressions', 'progressions']));
    rels.forEach(g => g.items.forEach(i => expect(i.ex).toBeTruthy()));
  });
});

describe('compatibilidad con planes antiguos', () => {
  const LEGACY_LIBRARY = ['Max hang', 'Campus board 1-5-9', 'Block pull · máx', 'Dynos a dedo', 'ARC en panel', 'Pullover isométrico', 'Manguito rotador', 'Core · plancha', 'Estiramiento muñecas'];
  const LEGACY_TEMPLATES = ['Max hang · 20mm', 'Campus board · 1-5-9', 'Pullover isométrico', 'Dynos a dedo', 'ARC · panel 45°', 'Manguito rotador', 'ARC · panel 30°', '4×4 bloque', 'Travesías largas', 'Dominadas lastradas', 'Intentos al proyecto', 'Repetir secciones clave', 'Campus 1-5-9', '4×4'];

  it('todos los ejercicios de la biblioteca anterior tienen ficha', () => {
    LEGACY_LIBRARY.forEach(n => expect(K.resolveByName(catalog, n), n).toBeTruthy());
  });

  it('los ejercicios de las plantillas se enlazan sin cambiar nombre ni prescripción', () => {
    LEGACY_TEMPLATES.forEach(n => {
      const item = { name: n, sets: 4, workSec: 10, reps: 0, weight: 20, restSec: 180, rpeTarget: 8 };
      const before = JSON.stringify(item);
      K.linkPlanItem(catalog, item);
      expect(item.exerciseId, n).toBeTruthy();
      const { exerciseId, exerciseContentVersion, ...rest } = item;
      expect(JSON.stringify(rest)).toBe(before);
    });
  });

  it('los nombres desconocidos no se enlazan por parecido', () => {
    expect(K.resolveByName(catalog, 'Mi ejercicio raro')).toBeNull();
    expect(K.resolveByName(catalog, 'Max hang de pie')).toBeNull();
  });

  it('un ejercicio ya enlazado no se vuelve a resolver', () => {
    const item = { name: 'Max hang', exerciseId: 'plancha', exerciseContentVersion: 3 };
    K.linkPlanItem(catalog, item);
    expect(item.exerciseId).toBe('plancha');
    expect(item.exerciseContentVersion).toBe(3);
  });
});

describe('prescripción', () => {
  it('cada ejercicio crea un elemento de plan con los valores de su ficha', () => {
    const item = K.planItemFromExercise(catalog.byId.get('max-hang'));
    expect(item).toMatchObject({ name: 'Max hang', exerciseId: 'max-hang', exerciseContentVersion: 1, sets: 5, workSec: 10, restSec: 180, rpeTarget: 8 });
  });

  it('los parámetros editables dependen del ejercicio', () => {
    const keys = id => K.paramsForPlanItem(catalog, K.planItemFromExercise(catalog.byId.get(id))).map(p => p.key);
    expect(keys('dominada-asistida')).toContain('assistanceKg');
    expect(keys('plancha')).not.toContain('assistanceKg');
    const attempts = K.paramsForPlanItem(catalog, K.planItemFromExercise(catalog.byId.get('dino'))).find(p => p.key === 'reps');
    expect(attempts.label).toBe('Intentos');
    expect(K.paramsForPlanItem(catalog, { name: 'Libre', sets: 3 }).map(p => p.key)).toEqual(['sets', 'reps', 'workSec', 'weight', 'restSec', 'rpeTarget']);
  });

  it('mantiene visible un parámetro extra ya guardado aunque la ficha no lo pida', () => {
    const item = { name: 'Libre', sets: 3, tempo: '3-1-1' };
    expect(K.paramsForPlanItem(catalog, item).map(p => p.key)).toContain('tempo');
  });

  it('el tempo tiene un formato válido', () => {
    expect(K.TEMPO_RE.test('3-1-1')).toBe(true);
    expect(K.TEMPO_RE.test('3-1-1-0')).toBe(true);
    expect(K.TEMPO_RE.test('rápido')).toBe(false);
  });
});

describe('recomendador', () => {
  const base = { goal: 'fuerza', level: 2, days: 3, minutes: 60, equipment: ['multipresa', 'barra', 'gomas', 'pesas'] };

  it('es determinista', () => {
    expect(JSON.stringify(K.recommendPlan(catalog, base))).toBe(JSON.stringify(K.recommendPlan(catalog, base)));
  });

  it('genera una sesión por día y asigna los días en orden', () => {
    const plan = K.recommendPlan(catalog, base);
    expect(plan.sessions).toHaveLength(3);
    expect(plan.sessions.map(s => s.day)).toEqual(['L', 'X', 'V']);
    expect(plan.activeDays).toEqual([true, false, true, false, true, false, false]);
    expect(plan.weeks).toBeGreaterThanOrEqual(1);
    expect(plan.weeks).toBeLessThanOrEqual(16);
  });

  it('respeta el material y el nivel', () => {
    const plan = K.recommendPlan(catalog, { goal: 'potencia', level: 1, days: 4, minutes: 60, equipment: [] });
    plan.sessions.forEach(s => s.exercises.forEach(item => {
      const ex = catalog.byId.get(item.exerciseId);
      expect(ex.safety.minLevel).toBeLessThanOrEqual(1);
      expect(K.equipmentOk(ex, [])).toBe(true);
    }));
  });

  it('no recomienda ejercicios intensos de dedos, campus ni lastre a principiantes', () => {
    ['fuerza', 'potencia', 'general', 'resistencia', 'tecnica'].forEach(goal => {
      const plan = K.recommendPlan(catalog, { goal, level: 1, days: 5, minutes: 90, equipment: ['rocodromo', 'multipresa', 'campus', 'barra', 'gomas', 'pesas', 'maquinas'] });
      const ids = plan.sessions.flatMap(s => s.exercises.map(i => i.exerciseId));
      ['max-hang', 'repeaters', 'campus-board', 'suspension-lastrada', 'dominada-lastrada', 'block-pull'].forEach(x => expect(ids, `${goal}: ${x}`).not.toContain(x));
    });
  });

  it('un avanzado con todo el material sí puede recibir trabajo intenso', () => {
    const plan = K.recommendPlan(catalog, { goal: 'fuerza', level: 3, days: 4, minutes: 90, equipment: ['rocodromo', 'multipresa', 'campus', 'barra', 'gomas', 'pesas', 'maquinas'] });
    const ids = plan.sessions.flatMap(s => s.exercises.map(i => i.exerciseId));
    expect(ids.some(i => ['max-hang', 'suspension-lastrada', 'dominada-lastrada', 'block-pull'].includes(i))).toBe(true);
  });

  it('evita repetir el mismo ejercicio principal entre sesiones cuando hay alternativas', () => {
    const plan = K.recommendPlan(catalog, { ...base, days: 4, level: 3, equipment: ['rocodromo', 'multipresa', 'campus', 'barra', 'gomas', 'pesas', 'maquinas'] });
    const main = plan.sessions.flatMap(s => s.exercises.filter(i => !['movilidad'].includes(catalog.byId.get(i.exerciseId).primaryCategoryId)).map(i => i.exerciseId));
    const repeats = main.length - new Set(main).size;
    expect(repeats).toBeLessThanOrEqual(1);
  });

  it('cada ejercicio explica por qué se recomienda', () => {
    K.recommendPlan(catalog, base).sessions.forEach(s => s.exercises.forEach(i => expect(i.why).toMatch(/\S/)));
  });

  it('respeta el tiempo disponible', () => {
    const plan = K.recommendPlan(catalog, { ...base, minutes: 30, days: 3 });
    plan.sessions.forEach(s => { if (s.exercises.length > 2) expect(K.estimateMinutes(s.exercises)).toBeLessThanOrEqual(30); });
  });

  it('avisa cuando faltan datos o material', () => {
    const plan = K.recommendPlan(catalog, { goal: 'fuerza', level: 1, days: 3, minutes: 60, equipment: [] });
    expect(plan.notes.join(' ')).toMatch(/Con el material elegido no hay ejercicios de/);
    expect(plan.notes.join(' ')).toMatch(/No conocemos tu rendimiento/);
  });

  it('normaliza entradas fuera de rango', () => {
    const plan = K.recommendPlan(catalog, { goal: 'rara', level: 9, days: 99, minutes: 1, equipment: ['multipresa'] });
    expect(plan.sessions.length).toBeLessThanOrEqual(7);
    expect(plan.level).toBe(1);
  });
});

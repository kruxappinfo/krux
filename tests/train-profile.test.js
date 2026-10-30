import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const P = createRequire(import.meta.url)('../train-profile.js');

const base = () => ({
  status: 'in_progress', goalPrimary: 'grado', experience: '1-2', daysPerWeek: 2, minutesPerSession: 90,
  modality: 'deportiva', environment: 'ambos', rockFrequency: 1, rockPriority: 'roca', equipment: ['multipresa'],
  grades: { sport: { usualFrom: '6a', usualTo: '6b', max: '6b', target: '6c+' } }
});

describe('escalas de grados', () => {
  it('la escala francesa y la Fontainebleau son distintas y están ordenadas', () => {
    expect(P.SPORT_GRADES.slice(0, 3)).toEqual(['4a', '4a+', '4b']);
    expect(P.SPORT_GRADES.at(-1)).toBe('9c');
    expect(P.BOULDER_GRADES.slice(0, 5)).toEqual(['3', '4', '4+', '5', '5+']);
    expect(P.BOULDER_GRADES.at(-1)).toBe('9A');
    expect(P.SPORT_GRADES.includes('6A')).toBe(false);
    expect(P.BOULDER_GRADES.includes('6a')).toBe(false);
  });
  it('rechaza un grado de la otra escala', () => {
    const p = P.normalizeProfile({ grades: { sport: { usualFrom: '6A', max: '6b' }, boulder: { max: '6c' } } });
    expect(p.grades.sport).toEqual({ max: '6b' });
    expect(p.grades.boulder).toBeUndefined();
  });
  it('acepta «no lo sé» como valor de grado', () => {
    const p = P.normalizeProfile({ grades: { sport: { usualFrom: 'unknown', max: 'unknown', target: '6c' } } });
    expect(p.grades.sport.usualFrom).toBe('unknown');
  });
});

describe('normalizeProfile', () => {
  it('conserva un perfil válido', () => {
    const n = P.normalizeProfile(base());
    expect(n).toMatchObject({ goalPrimary: 'grado', experience: '1-2', daysPerWeek: 2, minutesPerSession: 90, rockFrequency: 1, rockPriority: 'roca' });
    expect(n.grades.sport).toEqual({ usualFrom: '6a', usualTo: '6b', max: '6b', target: '6c+' });
  });
  it('descarta lo inválido y lo desconocido sin lanzar', () => {
    const n = P.normalizeProfile({ goalPrimary: 'volar', daysPerWeek: 9, minutesPerSession: 5, experience: 'mucha', modality: 'x', hack: 1, equipment: ['jetpack'] });
    expect(n).toEqual({ schemaVersion: 1, status: 'in_progress' });
    expect(P.normalizeProfile(null)).toEqual({ schemaVersion: 1, status: 'in_progress' });
    expect(P.normalizeProfile('texto')).toEqual({ schemaVersion: 1, status: 'in_progress' });
  });
  it('objetivos secundarios: sin repetir el principal y máximo dos', () => {
    const n = P.normalizeProfile({ goalPrimary: 'grado', goalsSecondary: ['grado', 'fuerza', 'fuerza', 'tecnica', 'forma'] });
    expect(n.goalsSecondary).toEqual(['fuerza', 'tecnica']);
  });
  it('«Ninguno» es excluyente', () => {
    expect(P.normalizeProfile({ equipment: ['multipresa', 'ninguno'] }).equipment).toEqual(['ninguno']);
  });
  it('la frecuencia en roca solo existe si escala en ambos entornos', () => {
    expect(P.normalizeProfile({ environment: 'roca', rockFrequency: 2, rockPriority: 'roca' }).rockFrequency).toBeUndefined();
    expect(P.normalizeProfile({ environment: 'ambos', rockFrequency: 2 }).rockFrequency).toBe(2);
  });
  it('el texto de «otro material» se recorta y solo se guarda si se marca «otro»', () => {
    expect(P.normalizeProfile({ equipment: ['otro'], equipmentOther: '  ' + 'x'.repeat(100) }).equipmentOther.length).toBe(60);
    expect(P.normalizeProfile({ equipment: ['multipresa'], equipmentOther: 'cuerda' }).equipmentOther).toBeUndefined();
  });
});

describe('pasos y compleción', () => {
  it('el caso de prueba de la especificación queda completo', () => {
    const p = { ...base(), equipment: ['multipresa'] };
    expect(P.missing(p)).toEqual([]);
    expect(P.isComplete(p)).toBe(true);
    expect(P.firstIncompleteStep(p)).toBe(7);
  });
  it('cada paso exige lo suyo', () => {
    expect(P.missingForStep(1, {})).toEqual(['goalPrimary']);
    expect(P.missingForStep(2, {})).toEqual(['sport.usualFrom', 'sport.max', 'experience']);
    expect(P.missingForStep(3, {})).toEqual(['sport.target']);
    expect(P.missingForStep(4, {})).toEqual(['daysPerWeek', 'minutesPerSession']);
    expect(P.missingForStep(5, {})).toEqual(['modality', 'environment']);
    expect(P.missingForStep(6, {})).toEqual(['equipment']);
  });
  it('bloque o ambas piden también la escala Fontainebleau', () => {
    expect(P.missingForStep(5, { modality: 'bloque', environment: 'roca' })).toEqual(['boulder.usualFrom', 'boulder.max', 'boulder.target']);
    expect(P.missingForStep(5, { modality: 'ambas', environment: 'roca', grades: { boulder: { usualFrom: '6A', max: '6B', target: '6C' } } })).toEqual([]);
  });
  it('solo bloque no exige la escala francesa', () => {
    const p = { modality: 'bloque' };
    expect(P.missingForStep(2, p)).toEqual(['experience']);
    expect(P.missingForStep(3, p)).toEqual([]);
  });
  it('ambos entornos piden la frecuencia en roca', () => {
    expect(P.missingForStep(5, { modality: 'deportiva', environment: 'ambos' })).toEqual(['rockFrequency']);
  });
  it('reanuda en el primer paso incompleto', () => {
    expect(P.firstIncompleteStep({ goalPrimary: 'grado' })).toBe(2);
  });
});

describe('validateProfile', () => {
  it('un perfil en curso incompleto es válido', () => {
    expect(P.validateProfile(P.normalizeProfile({ goalPrimary: 'fuerza' }))).toEqual([]);
  });
  it('un perfil «completed» con datos pendientes no es válido', () => {
    expect(P.validateProfile({ schemaVersion: 1, status: 'completed', goalPrimary: 'grado' }).length).toBe(1);
  });
  it('detecta campos inválidos', () => {
    expect(P.validateProfile({ schemaVersion: 1, status: 'in_progress', daysPerWeek: 12 })).toContain('campo inválido: daysPerWeek');
  });
  it('avisos de grados (no impiden guardar)', () => {
    const w = P.gradeWarnings({ grades: { sport: { usualFrom: '6c', usualTo: '6a', max: '5c' } } });
    expect(w.length).toBe(2);
    expect(P.gradeWarnings(base())).toEqual([]);
  });
});

describe('material, resumen y objetivo', () => {
  it('«Gimnasio» se expande a los ids del catálogo y el rocódromo entra por el entorno', () => {
    const ids = P.catalogEquipment({ equipment: ['gimnasio', 'bandas'], environment: 'ambos' });
    expect(ids.sort()).toEqual(['barra', 'gomas', 'maquinas', 'pesas', 'rocodromo']);
    expect(P.catalogEquipment({ equipment: ['ninguno'], environment: 'roca' })).toEqual([]);
  });
  it('el resumen solo muestra las escalas de las modalidades elegidas', () => {
    const keys = p => P.summarize(p).map(r => r.key);
    expect(keys({ ...base(), modality: 'deportiva' })).toContain('sport');
    expect(keys({ ...base(), modality: 'deportiva' })).not.toContain('boulder');
    const b = { ...base(), modality: 'bloque', grades: { sport: { max: '6a' }, boulder: { usualFrom: '6A', max: '6B', target: '6C' } } };
    expect(keys(b)).toContain('boulder'); expect(keys(b)).not.toContain('sport');
  });
  it('el resumen del caso de prueba no atribuye déficits ni niveles', () => {
    const text = P.summarize(base()).map(r => r.label + r.value).join(' ').toLowerCase();
    ['principiante', 'avanzado', 'débil', 'déficit', 'nivel'].forEach(w => expect(text).not.toContain(w));
    expect(text).toContain('6a–6b');
  });
});

describe('evaluación mental', () => {
  it('son las cinco preguntas con extremos propios', () => {
    expect(P.MENTAL_QUESTIONS.length).toBe(5);
    P.MENTAL_QUESTIONS.forEach(q => { expect(q.text).toMatch(/\?$/); expect(q.low).toBeTruthy(); expect(q.high).toBeTruthy(); });
  });
  it('admite 1-5, «no lo sé» y «prefiero no responder» y descarta el resto', () => {
    const m = P.normalizeMental({ answers: { fear: 3, confidence: 'unknown', focus: 'skip', frustration: 6, pressure: 0, extra: 2 } });
    expect(m.answers).toEqual({ fear: 3, confidence: 'unknown', focus: 'skip' });
    expect(P.mentalAnswered(m)).toBe(3);
    expect(P.mentalIsComplete(m)).toBe(false);
  });
  it('respuestas parciales y vacías son válidas; las inválidas no', () => {
    expect(P.validateMental({ schemaVersion: 1, answers: {} })).toEqual([]);
    expect(P.validateMental({ schemaVersion: 1, answers: { fear: 9 } })).toEqual(['respuesta inválida: fear']);
    expect(P.validateMental({ schemaVersion: 1, answers: { otra: 1 } })).toEqual(['pregunta desconocida: otra']);
  });
  it('no existe ninguna puntuación global', () => {
    const exported = Object.keys(P).join(' ').toLowerCase();
    ['score', 'puntuacion', 'level', 'fortaleza'].forEach(w => expect(exported).not.toContain(w));
  });
});

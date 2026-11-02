import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const P = createRequire(import.meta.url)('../train-profile.js');

const base = () => ({
  status: 'in_progress', goalPrimary: 'grado', experience: '1-2', daysPerWeek: 2, minutesPerSession: 90,
  modality: 'deportiva', environment: 'ambos', rockFrequency: 1, rockPriority: 'roca', equipment: ['multipresa'],
  grades: { sport: { usualFrom: '6a', usualTo: '6b', max: '6b', target: '6c+' } },
  gradesGym: { sport: { usualFrom: '6b', max: '6c' } }
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
    expect(P.missingForStep(2, {})).toEqual(['modality', 'environment']);
    expect(P.missingForStep(3, {})).toEqual(['experience']);
    expect(P.missingForStep(4, {})).toEqual([]);
    expect(P.missingForStep(5, {})).toEqual(['daysPerWeek', 'minutesPerSession']);
    expect(P.missingForStep(6, {})).toEqual(['equipment']);
  });
  it('solo se piden los grados de las modalidades y entornos que practica', () => {
    expect(P.practices({ modality: 'bloque', environment: 'roca' }).map(x => x.key)).toEqual(['roca.boulder']);
    expect(P.practices({ modality: 'deportiva', environment: 'rocodromo' }).map(x => x.key)).toEqual(['rocodromo.sport']);
    expect(P.practices({ modality: 'ambas', environment: 'ambos' }).map(x => x.key)).toEqual(['roca.sport', 'roca.boulder', 'rocodromo.sport', 'rocodromo.boulder']);
    expect(P.missingForStep(3, { modality: 'bloque', environment: 'roca', experience: '1-2' })).toEqual(['roca.boulder.usualFrom', 'roca.boulder.max']);
    expect(P.missingForStep(3, { modality: 'deportiva', environment: 'rocodromo', experience: '1-2' })).toEqual(['rocodromo.sport.usualFrom', 'rocodromo.sport.max']);
  });
  it('el grado objetivo solo se pide en roca', () => {
    expect(P.missingForStep(4, { modality: 'ambas', environment: 'roca' })).toEqual(['roca.sport.target', 'roca.boulder.target']);
    expect(P.missingForStep(4, { modality: 'ambas', environment: 'rocodromo' })).toEqual([]);
    expect(P.missingForStep(4, { modality: 'bloque', environment: 'ambos' })).toEqual(['roca.boulder.target']);
  });
  it('ambos entornos piden la frecuencia en roca y los grados de rocódromo aparte', () => {
    expect(P.missingForStep(2, { modality: 'deportiva', environment: 'ambos' })).toEqual(['rockFrequency']);
    expect(P.missingForStep(3, { modality: 'deportiva', environment: 'ambos', experience: '1-2', grades: { sport: { usualFrom: '6a', max: '6b' } } })).toEqual(['rocodromo.sport.usualFrom', 'rocodromo.sport.max']);
  });
  it('los grados de roca y de rocódromo no se convierten ni se mezclan', () => {
    const p = P.normalizeProfile({ modality: 'deportiva', environment: 'ambos', grades: { sport: { usualFrom: '6a', max: '6b', target: '7a' } }, gradesGym: { sport: { usualFrom: '6c', max: '7a' } } });
    expect(P.gradesFor(p, 'roca', 'sport').usualFrom).toBe('6a');
    expect(P.gradesFor(p, 'rocodromo', 'sport').usualFrom).toBe('6c');
    expect(P.gradesFor(p, 'rocodromo', 'boulder')).toBeNull();
  });
  it('migración: un perfil guardado antes se lee según su entorno y no pierde datos', () => {
    const legacyRoca = P.normalizeProfile({ modality: 'deportiva', environment: 'roca', grades: { sport: { usualFrom: '6a', max: '6b', target: '6c' } } });
    expect(P.gradesFor(legacyRoca, 'roca', 'sport')).toEqual({ usualFrom: '6a', max: '6b', target: '6c' });
    expect(P.gradesFor(legacyRoca, 'rocodromo', 'sport')).toBeNull();
    const legacyGym = P.normalizeProfile({ modality: 'deportiva', environment: 'rocodromo', grades: { sport: { usualFrom: '6a', max: '6b', target: '6c' } } });
    expect(P.gradesFor(legacyGym, 'rocodromo', 'sport').max).toBe('6b');
    expect(P.gradesFor(legacyGym, 'roca', 'sport')).toBeNull();
    const legacyAmbos = P.normalizeProfile({ modality: 'deportiva', environment: 'ambos', rockFrequency: 1, grades: { sport: { usualFrom: '6a', max: '6b', target: '6c' } } });
    expect(P.gradesFor(legacyAmbos, 'roca', 'sport').max).toBe('6b');
    expect(P.missingForStep(3, { ...legacyAmbos, experience: '1-2' })).toEqual(['rocodromo.sport.usualFrom', 'rocodromo.sport.max']);   // se pide lo que falta
  });
  it('cambiar de entorno conserva cada grado en su entorno', () => {
    const p = P.normalizeProfile({ modality: 'deportiva', environment: 'roca', grades: { sport: { usualFrom: '6a', max: '6b', target: '6c' } } });
    P.withEnvironment(p, 'ambos');
    expect(P.gradesFor(p, 'roca', 'sport').max).toBe('6b');
    expect(P.gradesFor(p, 'rocodromo', 'sport')).toBeNull();
    P.setGradeFor(p, 'rocodromo', 'sport', 'usualFrom', '6c');
    expect(p.gradesGym.sport).toEqual({ usualFrom: '6c' });
    expect(p.grades.sport.usualFrom).toBe('6a');
    P.withEnvironment(p, 'rocodromo');
    expect(P.gradesFor(p, 'rocodromo', 'sport')).toEqual({ usualFrom: '6c' });
  });
  it('reanuda en el primer paso incompleto', () => {
    expect(P.firstIncompleteStep({ goalPrimary: 'grado' })).toBe(2);
    expect(P.firstIncompleteStep({ goalPrimary: 'grado', modality: 'deportiva', environment: 'roca' })).toBe(3);
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
    const w = P.gradeWarnings({ modality: 'deportiva', environment: 'roca', grades: { sport: { usualFrom: '6c', usualTo: '6a', max: '5c' } } });
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
  it('el resumen solo muestra las modalidades y entornos que practica', () => {
    const keys = p => P.summarize(p).map(r => r.key).filter(k => k.startsWith('grade.'));
    expect(keys({ ...base(), modality: 'deportiva' })).toEqual(['grade.roca.sport', 'grade.rocodromo.sport']);
    const b = { ...base(), modality: 'bloque', environment: 'roca', gradesGym: undefined, grades: { sport: { max: '6a' }, boulder: { usualFrom: '6A', max: '6B', target: '6C' } } };
    expect(keys(b)).toEqual(['grade.roca.boulder']);
    expect(P.summarize(b).find(r => r.key === 'grade.roca.boulder').label).toBe('Bloque en roca');
  });
  it('en rocódromo el resumen no muestra objetivo', () => {
    const p = { modality: 'bloque', environment: 'rocodromo', grades: { boulder: { usualFrom: '6A', max: '6B', target: 'unknown' } } };
    expect(P.summarize(p).find(r => r.key === 'grade.rocodromo.boulder').value).not.toContain('objetivo');
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

describe('limitaciones (opcionales, solo en el dispositivo)', () => {
  it('sin indicar no es lo mismo que «sin limitaciones»', () => {
    expect(P.limitsAnswered(P.normalizeLimits(null))).toBe(false);
    expect(P.limitsAnswered(P.normalizeLimits({ none: true }))).toBe(true);
    expect(P.limitsText(P.normalizeLimits({ none: true }))).toBe('Sin limitaciones');
    expect(P.limitsText(P.normalizeLimits(null))).toBe('');
  });
  it('descarta ids desconocidos y repetidos; «sin limitaciones» no convive con zonas', () => {
    expect(P.normalizeLimits({ items: ['hombros', 'x', 'hombros', 'codos'] }).items).toEqual(['hombros', 'codos']);
    const l = P.normalizeLimits({ none: true, items: ['dedos'] });
    expect(l.none).toBeUndefined(); expect(l.items).toEqual(['dedos']);
  });
  it('el texto de «Otra» solo cuenta si «Otra» está marcada y se recorta a 60', () => {
    expect(P.normalizeLimits({ items: ['codos'], other: 'cuello' }).other).toBeUndefined();
    const l = P.normalizeLimits({ items: ['otra'], other: ' ' + 'x'.repeat(80) + ' ' });
    expect(l.other.length).toBe(60);
    expect(P.limitsText(P.normalizeLimits({ items: ['dedos', 'otra'], other: 'cuello' }))).toBe('Dedos o poleas, cuello');
  });
  it('no entran en el perfil que se guarda en Firestore', () => {
    const p = P.normalizeProfile({ ...base(), limitations: { items: ['dedos'] }, limits: { none: true } });
    expect(Object.keys(p)).not.toContain('limitations'); expect(Object.keys(p)).not.toContain('limits');
  });
});

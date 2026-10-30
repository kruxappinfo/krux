import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const D = createRequire(import.meta.url)('../train-mental-data.js');

const all = [...D.lessons, ...D.exercises];
const ids = all.map(c => c.id);
const code = c => c.id.slice(0, 3).replace('-', '').toUpperCase();   // «m01», «c04»…

describe('catálogo mental: primera entrega', () => {
  it('son exactamente 27 contenidos: 10 lecciones y 17 ejercicios', () => {
    expect(D.lessons.length).toBe(10);
    expect(D.exercises.length).toBe(17);
    expect(all.length).toBe(27);
  });
  it('contiene los 26 marcados con ★ más C04, y no P04, T05, D08 ni M07', () => {
    const codes = all.map(code).sort();
    const expected = ['M01', 'M02', 'M03', 'M04', 'M05', 'M08', 'C01', 'C02', 'C03', 'C04', 'C05', 'F01', 'F02', 'F04', 'F05', 'P01',
      'D01', 'D03', 'D04', 'D05', 'D06', 'T01', 'T03', 'G01', 'G02', 'G03', 'G05'].sort();
    expect(codes).toEqual(expected);
    ['P04', 'T05', 'D08', 'M07'].forEach(c => expect(codes).not.toContain(c));
  });
  it('los ids son únicos y las referencias cruzadas existen', () => {
    expect(new Set(ids).size).toBe(ids.length);
    all.forEach(c => c.related.forEach(r => expect(ids, `${c.id} → ${r}`).toContain(r)));
  });
  it('cada contenido tiene los campos comunes y una categoría válida', () => {
    const cats = D.categories.map(c => c.id);
    all.forEach(c => {
      expect(cats, c.id).toContain(c.categoryId);
      expect(c.title && c.objective && c.durationLabel, c.id).toBeTruthy();
      expect(c.durationMin, c.id).toBeGreaterThan(0);
      expect(c.moments.length, c.id).toBeGreaterThan(0);
      c.moments.forEach(m => expect(Object.keys(D.moments), c.id).toContain(m));
      expect([...c.environments].sort(), c.id).toEqual(['roca', 'rocodromo']);
      expect(['none', 'standard', 'reinforced'], c.id).toContain(c.safetyLevel);
      expect(Array.isArray(c.precautions), c.id).toBe(true);
      expect(c.status, c.id).toBe('published');
    });
  });
  it('todo está marcado como pendiente de revisión profesional y hay aviso general', () => {
    all.forEach(c => { expect(c.review.status, c.id).toBe('pending'); expect(c.review.reviewedBy, c.id).toBeNull(); });
    expect(D.disclaimer).toMatch(/pendiente de revisión profesional/);
    expect(D.disclaimer).toMatch(/no sustituye la formación técnica/);
  });
  it('las lecciones traen introducción, explicación, aplicación, recomendaciones y resumen', () => {
    D.lessons.forEach(l => {
      expect(l.introduction && l.explanation && l.application && l.summary, l.id).toBeTruthy();
      expect(l.recommendations.length, l.id).toBeGreaterThan(0);
    });
  });
  it('los ejercicios traen descripción, pasos, dificultad, criterio de finalización y reflexión', () => {
    D.exercises.forEach(e => {
      expect(e.description, e.id).toBeTruthy();
      expect(e.steps.length, e.id).toBeGreaterThan(0);
      expect([1, 2, 3], e.id).toContain(e.difficulty);
      expect(e.completionCriteria, e.id).toBeTruthy();
      expect(e.reflectionQuestions.length, e.id).toBeGreaterThan(0);
      expect(e.dimension, e.id).toBe(e.categoryId);
    });
  });
});

describe('seguridad', () => {
  const byCode = c => all.find(x => code(x) === c);
  it('M03, M04 y M08 tienen precaución reforzada', () => {
    ['M03', 'M04', 'M08'].forEach(c => expect(byCode(c).safetyLevel, c).toBe('reinforced'));
  });
  it('los contenidos de miedo y seguridad llevan advertencias explícitas', () => {
    ['M01', 'M02', 'M03', 'M04', 'M08', 'D05', 'D06'].forEach(c => {
      const text = byCode(c).precautions.join(' ').toLowerCase();
      expect(byCode(c).safetyLevel, c).not.toBe('none');
      expect(text, c).toMatch(/formación|supervis|seguridad|instructor|ayuda/);
    });
  });
  it('M03 y M08 dicen que no sustituyen la formación y que no se provoquen caídas ni se improvise', () => {
    expect(byCode('M03').precautions.join(' ')).toMatch(/no enseña ni sustituye/i);
    expect(byCode('M03').precautions.join(' ')).toMatch(/caídas de prueba/i);
    expect(byCode('M08').precautions.join(' ')).toMatch(/improvises/i);
    expect(byCode('M04').precautions.join(' ')).toMatch(/no es una lista de seguridad ni sustituye tu formación/i);
  });
  it('ningún contenido propone provocar caídas', () => {
    const text = JSON.stringify(all).toLowerCase();
    expect(text).not.toMatch(/(provoca|provocar|practica|prueba|haz|hazte)[^.]{0,40}caída/);
  });
  it('no hay diagnósticos ni etiquetas sobre la persona', () => {
    const text = JSON.stringify(all).toLowerCase();
    ['diagnóstico de', 'trastorno', 'patológic', 'eres inseguro', 'débil mental'].forEach(w => expect(text).not.toContain(w));
  });
  it('los respiratorios (M05 y G02) avisan de mareo, de no retener el aire y de que no es terapia', () => {
    ['M05', 'G02'].forEach(c => {
      const t = byCode(c).precautions.join(' ').toLowerCase();
      expect(t, c).toMatch(/mareo|marees|mareas/);
      expect(t, c).toMatch(/retener|retengas/);
      expect(t, c).toMatch(/terapia/);
    });
  });
});

describe('diferenciación de ejercicios parecidos', () => {
  const get = id => all.find(c => c.id === id);
  it('M05, D04 y G02 tienen objetivos distintos y se remiten entre sí', () => {
    const m05 = get('m05-respiracion-ante-el-miedo'), d04 = get('d04-calmar-el-cuerpo-antes-del-intento'), g02 = get('g02-exhalacion-larga-entre-movimientos');
    expect(new Set([m05.objective, d04.objective, g02.objective]).size).toBe(3);
    expect(m05.moments).toEqual(['antes']); expect(d04.moments).toEqual(['antes']); expect(g02.moments).toEqual(['durante']);
    expect(m05.related).toContain('d04-calmar-el-cuerpo-antes-del-intento');
    expect(g02.related).toContain('m05-respiracion-ante-el-miedo');
  });
  it('F04 (estado físico y emocional) y D05 (criterios de seguridad) se remiten y D05 prevalece', () => {
    const f04 = get('f04-fatiga-y-frustracion'), d05 = get('d05-cuando-abandonar-un-intento');
    expect(f04.related).toContain('d05-cuando-abandonar-un-intento');
    expect(d05.related).toContain('f04-fatiga-y-frustracion');
    expect(f04.objective).toMatch(/tienen prioridad/);
    expect(d05.explanation).toMatch(/prevalecen sobre cualquier objetivo/);
  });
});

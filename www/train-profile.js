// ================== ENTRENA — PERFIL DEL ESCALADOR (MODELO) ==================
// Módulo puro (sin DOM ni Firebase): opciones, escalas de grados, normalización y validación del perfil de
// entrenamiento y de la evaluación mental inicial. Lo usan el onboarding, la edición del perfil y, más adelante,
// el recomendador. Los datos viven en users/{uid}/training_profile/current y users/{uid}/mental_profile/current
// (solo el propietario puede leerlos).
//
// PERFIL (schemaVersion 1) — todos los campos son opcionales mientras el perfil está «en curso»
//   status 'in_progress'|'completed'|'skipped', step (1-6)
//   goalPrimary, goalsSecondary[≤2], experience, daysPerWeek, minutesPerSession,
//   modality, environment, rockFrequency, rockPriority, equipment[], equipmentOther,
//   grades { sport:{ usualFrom, usualTo?, max, target }, boulder:{ …igual… } }   (escalas separadas)
//   gradesGym { sport, boulder }   solo en memoria / este dispositivo (ver «Grados por entorno»)
//
// GRADOS POR ENTORNO. Los grados de roca y de rocódromo no son comparables y nunca se convierten. Las reglas de Firestore solo admiten
// grades.sport y grades.boulder, así que «grades» guarda los del entorno principal: ROCA si escala en roca (roca/ambos) y ROCÓDROMO si
// solo escala en rocódromo. Con «ambos», los de rocódromo van en gradesGym (copia local del dispositivo). Un perfil guardado antes de
// esta separación se interpreta con la misma regla (no se pierde ni se reescribe ningún dato). Objetivo: solo en roca.
//
// EVALUACIÓN MENTAL (schemaVersion 1)
//   answers { fear, confidence, focus, frustration, pressure }  cada una 1-5 | 'unknown' | 'skip'
//   No se calcula ninguna puntuación global ni se etiqueta al usuario.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KruxProfile = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SCHEMA_VERSION = 1;
  const STATUSES = ['in_progress', 'completed', 'skipped'];
  const STEPS = 6;

  // ── Opciones (id → texto) ───────────────────────────────────────────
  const GOALS = [
    { id: 'grado', label: 'Mejorar mi grado', desc: 'Encadenar vías más difíciles' },
    { id: 'fuerza', label: 'Ganar fuerza', desc: 'Dedos, tracción y potencia' },
    { id: 'resistencia', label: 'Mejorar mi resistencia', desc: 'Aguantar más tiempo escalando' },
    { id: 'tecnica', label: 'Mejorar mi técnica', desc: 'Moverme mejor con menos esfuerzo' },
    { id: 'competicion', label: 'Prepararme para competir', desc: 'Rendir en un evento concreto' },
    { id: 'forma', label: 'Mantenerme en forma', desc: 'Escalar con salud y constancia' }
  ];
  const EXPERIENCE = [
    { id: 'lt1', label: 'Menos de un año' },
    { id: '1-2', label: 'Entre 1 y 2 años' },
    { id: '2-4', label: 'Entre 2 y 4 años' },
    { id: 'gt4', label: 'Más de 4 años' }
  ];
  const MODALITY = [
    { id: 'deportiva', label: 'Escalada deportiva', desc: 'Vías con cuerda' },
    { id: 'bloque', label: 'Bloque', desc: 'Problemas sin cuerda' },
    { id: 'ambas', label: 'Ambas', desc: 'Deportiva y bloque' }
  ];
  const ENVIRONMENT = [
    { id: 'rocodromo', label: 'Rocódromo', desc: 'Escalada indoor' },
    { id: 'roca', label: 'Roca', desc: 'Escalada outdoor' },
    { id: 'ambos', label: 'Ambos', desc: 'Rocódromo y roca' }
  ];
  const ROCK_PRIORITY = [
    { id: 'roca', label: 'Mejorar en roca' },
    { id: 'rocodromo', label: 'Mejorar en rocódromo' },
    { id: 'ninguna', label: 'Sin prioridad' }
  ];
  // «Ninguno» es excluyente. `catalog` indica los ids del catálogo de ejercicios que cubre cada opción.
  const EQUIPMENT = [
    { id: 'ninguno', label: 'Ninguno', catalog: [] },
    { id: 'multipresa', label: 'Multipresa', catalog: ['multipresa'] },
    { id: 'gimnasio', label: 'Gimnasio', catalog: ['barra', 'pesas', 'maquinas'] },
    { id: 'bandas', label: 'Bandas elásticas', catalog: ['gomas'] },
    { id: 'pesas', label: 'Mancuernas o pesas', catalog: ['pesas'] },
    { id: 'otro', label: 'Otro material', catalog: [] }
  ];
  const MINUTES = [30, 45, 60, 75, 90, 105, 120, 150, 180];

  // ── Limitaciones (opcionales) ───────────────────────────────────────
  // Se guardan SOLO en este dispositivo (ver train-coach-ui.js): las reglas de Firestore limitan training_profile a los campos del perfil.
  // { schemaVersion, none?:true } = «sin limitaciones»; { items:[ids], other? } = zonas con molestias; null/ausente = sin indicar.
  const LIMITS = [
    { id: 'dedos', label: 'Dedos o poleas' },
    { id: 'hombros', label: 'Hombros' },
    { id: 'codos', label: 'Codos' },
    { id: 'munecas', label: 'Muñecas' },
    { id: 'espalda', label: 'Espalda' },
    { id: 'rodillas', label: 'Rodillas' },
    { id: 'otra', label: 'Otra' }
  ];

  // ── Escalas de grados (separadas: deportiva francesa y bloque Fontainebleau) ──
  const SPORT_GRADES = [];
  ['4', '5', '6', '7', '8', '9'].forEach(n => ['a', 'b', 'c'].forEach(l => { SPORT_GRADES.push(n + l, n + l + '+'); }));
  SPORT_GRADES.length = SPORT_GRADES.indexOf('9c') + 1;   // hasta 9c
  const BOULDER_GRADES = ['3', '4', '4+', '5', '5+'];
  ['6', '7', '8', '9'].forEach(n => ['A', 'B', 'C'].forEach(l => { BOULDER_GRADES.push(n + l, n + l + '+'); }));
  BOULDER_GRADES.length = BOULDER_GRADES.indexOf('9A') + 1;   // hasta 9A
  const SCALES = { sport: SPORT_GRADES, boulder: BOULDER_GRADES };
  const SCALE_NAMES = { sport: 'Escala francesa (deportiva)', boulder: 'Escala Fontainebleau (bloque)' };
  const GRADE_UNKNOWN = 'unknown';

  // ── Limitaciones ────────────────────────────────────────────────────
  function normalizeLimits(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const out = { schemaVersion: SCHEMA_VERSION };
    const items = Array.isArray(r.items) ? [...new Set(r.items.filter(i => has(LIMITS, i)))] : [];
    if (items.length) {
      out.items = items;
      if (items.includes('otra') && typeof r.other === 'string') { const t = r.other.trim().slice(0, 60); if (t) out.other = t; }
    } else if (r.none === true) out.none = true;
    return out;
  }
  const limitsAnswered = l => !!l && (l.none === true || (Array.isArray(l.items) && l.items.length > 0));
  function limitsText(l) {
    if (!limitsAnswered(l)) return '';
    if (l.none) return 'Sin limitaciones';
    return l.items.map(id => (id === 'otra' && l.other) ? l.other : labelOf(LIMITS, id)).join(', ');
  }

  // ── Evaluación mental ───────────────────────────────────────────────
  // Redacción y extremos de la escala adaptados a cada pregunta (sin juicios sobre quien responde).
  const MENTAL_QUESTIONS = [
    { id: 'fear', text: '¿Te preocupa caerte cuando escalas de primero?', low: 'Nada', high: 'Mucho' },
    { id: 'confidence', text: '¿Confías en tus capacidades cuando afrontas una vía difícil?', low: 'Poco', high: 'Mucho' },
    { id: 'focus', text: '¿Te cuesta mantener la concentración mientras escalas?', low: 'Casi nunca', high: 'Casi siempre' },
    { id: 'frustration', text: '¿Cómo reaccionas cuando no consigues encadenar?', low: 'Con calma, sigo', high: 'Me frustro mucho' },
    { id: 'pressure', text: '¿Te afecta la presión de escalar delante de otras personas?', low: 'Nada', high: 'Mucho' }
  ];
  const MENTAL_IDS = MENTAL_QUESTIONS.map(q => q.id);
  const MENTAL_SPECIAL = { unknown: 'No lo sé', skip: 'Prefiero no responder' };

  // ── Utilidades ──────────────────────────────────────────────────────
  const ids = list => list.map(o => o.id);
  const has = (list, id) => ids(list).includes(id);
  const int = (v, min, max) => { const n = Number(v); return Number.isInteger(n) && n >= min && n <= max ? n : null; };
  const labelOf = (list, id) => { const o = list.find(x => x.id === id); return o ? o.label : ''; };
  const gradeIndex = (scale, g) => SCALES[scale].indexOf(g);
  const validGrade = (scale, g) => g === GRADE_UNKNOWN || gradeIndex(scale, g) >= 0;

  const needsSport = p => p.modality !== 'bloque';
  const needsBoulder = p => p.modality === 'bloque' || p.modality === 'ambas';
  const asksRock = p => p.environment === 'ambos';
  const hasRock = p => p.environment === 'roca' || p.environment === 'ambos';
  const hasGym = p => p.environment === 'rocodromo' || p.environment === 'ambos';

  // ── Grados por entorno ──────────────────────────────────────────────
  const ENV_NAMES = { roca: 'roca', rocodromo: 'rocódromo' };
  const SCALE_MODALITY = { sport: 'deportiva', boulder: 'bloque' };
  const SCALE_LABEL = { sport: 'Deportiva', boulder: 'Bloque' };
  // Modalidades que practica: [{ env, scale, key:'roca.sport', label:'Deportiva en roca', target }] (solo las que practica; roca primero)
  function practices(p) {
    const out = [];
    [['roca', hasRock(p)], ['rocodromo', hasGym(p)]].forEach(([env, on]) => {
      if (!on) return;
      [['sport', needsSport(p)], ['boulder', needsBoulder(p)]].forEach(([scale, ok]) => {
        if (ok) out.push({ env, scale, key: env + '.' + scale, label: `${SCALE_LABEL[scale]} en ${ENV_NAMES[env]}`, target: env === 'roca' });
      });
    });
    return out;
  }
  // ¿En qué campo guardado vive cada entorno? 'grades' (sincronizado) o 'gradesGym' (local, solo con «ambos»)
  const gradeField = (p, env) => (env === 'roca' || p.environment === 'rocodromo') ? 'grades' : 'gradesGym';
  function gradesFor(p, env, scale) {
    if (env === 'roca' && !hasRock(p)) return null;
    if (env === 'rocodromo' && !hasGym(p)) return null;
    const f = p[gradeField(p, env)];
    return (f && f[scale]) || null;
  }
  function setGradeFor(p, env, scale, key, value) {
    const field = gradeField(p, env);
    const all = Object.assign({}, p[field]);
    const g = Object.assign({}, all[scale]);
    if (value) g[key] = value; else delete g[key];
    if (Object.keys(g).length) all[scale] = g; else delete all[scale];
    if (Object.keys(all).length) p[field] = all; else delete p[field];
  }
  // Cambio de entorno sin perder datos: los grados de cada entorno siguen siendo de ese entorno (no se convierten).
  // Los de un entorno que ya no practica se descartan.
  function withEnvironment(p, env) {
    const before = { roca: { sport: gradesFor(p, 'roca', 'sport'), boulder: gradesFor(p, 'roca', 'boulder') }, rocodromo: { sport: gradesFor(p, 'rocodromo', 'sport'), boulder: gradesFor(p, 'rocodromo', 'boulder') } };
    p.environment = env;
    delete p.grades; delete p.gradesGym;
    ['roca', 'rocodromo'].forEach(e => ['sport', 'boulder'].forEach(sc => {
      const g = before[e][sc];
      if (g && (e === 'roca' ? hasRock(p) : hasGym(p))) Object.keys(g).forEach(k => setGradeFor(p, e, sc, k, g[k]));
    }));
    return p;
  }

  function normalizeScale(scale, raw) {
    if (!raw || typeof raw !== 'object') return null;
    const out = {};
    ['usualFrom', 'usualTo', 'max', 'target'].forEach(k => { if (validGrade(scale, raw[k])) out[k] = raw[k]; });
    return Object.keys(out).length ? out : null;
  }

  // Devuelve solo lo válido; nunca lanza. Lo desconocido o fuera de rango se descarta.
  function normalizeProfile(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const p = {};
    p.schemaVersion = SCHEMA_VERSION;
    p.status = STATUSES.includes(r.status) ? r.status : 'in_progress';
    const step = int(r.step, 1, STEPS); if (step) p.step = step;
    if (has(GOALS, r.goalPrimary)) p.goalPrimary = r.goalPrimary;
    if (Array.isArray(r.goalsSecondary)) {
      const sec = [...new Set(r.goalsSecondary.filter(g => has(GOALS, g) && g !== p.goalPrimary))].slice(0, 2);
      if (sec.length) p.goalsSecondary = sec;
    }
    if (has(EXPERIENCE, r.experience)) p.experience = r.experience;
    const days = int(r.daysPerWeek, 1, 7); if (days) p.daysPerWeek = days;
    const min = int(r.minutesPerSession, 20, 240); if (min) p.minutesPerSession = min;
    if (has(MODALITY, r.modality)) p.modality = r.modality;
    if (has(ENVIRONMENT, r.environment)) p.environment = r.environment;
    if (p.environment === 'ambos') {
      const f = int(r.rockFrequency, 1, 7); if (f) p.rockFrequency = f;
      if (has(ROCK_PRIORITY, r.rockPriority)) p.rockPriority = r.rockPriority;
    }
    if (Array.isArray(r.equipment)) {
      let eq = [...new Set(r.equipment.filter(e => has(EQUIPMENT, e)))];
      if (eq.includes('ninguno')) eq = ['ninguno'];
      if (eq.length) p.equipment = eq;
    }
    if (p.equipment && p.equipment.includes('otro') && typeof r.equipmentOther === 'string') {
      const t = r.equipmentOther.trim().slice(0, 60); if (t) p.equipmentOther = t;
    }
    const sport = normalizeScale('sport', r.grades && r.grades.sport);
    const boulder = normalizeScale('boulder', r.grades && r.grades.boulder);
    if (sport || boulder) p.grades = Object.assign({}, sport ? { sport } : {}, boulder ? { boulder } : {});
    if (p.environment === 'ambos') {
      const gs = normalizeScale('sport', r.gradesGym && r.gradesGym.sport), gb = normalizeScale('boulder', r.gradesGym && r.gradesGym.boulder);
      if (gs || gb) p.gradesGym = Object.assign({}, gs ? { sport: gs } : {}, gb ? { boulder: gb } : {});
    }
    return p;
  }

  // Avisos que no impiden guardar (el usuario conoce mejor su nivel)
  function gradeWarnings(p) {
    const w = [];
    practices(p).forEach(pr => {
      const g = gradesFor(p, pr.env, pr.scale), scale = pr.scale;
      if (!g) return;
      const top = g.usualTo || g.usualFrom;
      if (gradeIndex(scale, g.usualFrom) >= 0 && gradeIndex(scale, g.usualTo) >= 0 && gradeIndex(scale, g.usualTo) < gradeIndex(scale, g.usualFrom)) w.push(`${pr.key}: el grado habitual «hasta» es menor que «desde»`);
      if (gradeIndex(scale, top) >= 0 && gradeIndex(scale, g.max) >= 0 && gradeIndex(scale, top) > gradeIndex(scale, g.max)) w.push(`${pr.key}: el grado habitual supera al máximo encadenado`);
    });
    return w;
  }

  // Pasos: 1 objetivos · 2 cómo y dónde escalas · 3 nivel (experiencia y grados habitual/máximo de cada modalidad) ·
  //        4 grados objetivo (solo roca) · 5 días disponibles para escalar y duración · 6 material
  const STEP_ORDER = { goals: 1, where: 2, level: 3, targets: 4, availability: 5, equipment: 6 };
  // Campos obligatorios de cada paso (con los datos ya conocidos del perfil)
  function missingForStep(step, p) {
    const m = [];
    if (step === 1 && !p.goalPrimary) m.push('goalPrimary');
    if (step === 2) {
      if (!p.modality) m.push('modality');
      if (!p.environment) m.push('environment');
      if (asksRock(p) && !p.rockFrequency) m.push('rockFrequency');
    }
    if (step === 3) {
      if (!p.experience) m.push('experience');
      practices(p).forEach(pr => { const g = gradesFor(p, pr.env, pr.scale) || {}; if (!g.usualFrom) m.push(pr.key + '.usualFrom'); if (!g.max) m.push(pr.key + '.max'); });
    }
    if (step === 4) practices(p).filter(pr => pr.target).forEach(pr => { if (!(gradesFor(p, pr.env, pr.scale) || {}).target) m.push(pr.key + '.target'); });
    if (step === 5) { if (!p.daysPerWeek) m.push('daysPerWeek'); if (!p.minutesPerSession) m.push('minutesPerSession'); }
    if (step === 6 && !(p.equipment && p.equipment.length)) m.push('equipment');
    return m;
  }

  const stepIsValid = (step, p) => missingForStep(step, p).length === 0;
  function missing(p) { const all = []; for (let s = 1; s <= STEPS; s++) all.push(...missingForStep(s, p)); return all; }
  const isComplete = p => !!p && missing(p).length === 0;

  // Primer paso con datos pendientes (para reanudar); STEPS + 1 si no falta nada
  function firstIncompleteStep(p) {
    for (let s = 1; s <= STEPS; s++) if (!stepIsValid(s, p)) return s;
    return STEPS + 1;
  }

  // Errores de un perfil que se va a guardar (lo no informado no es un error: el perfil puede estar en curso)
  function validateProfile(p) {
    const errors = [];
    if (!p || typeof p !== 'object') return ['el perfil no es un objeto'];
    if (p.schemaVersion !== SCHEMA_VERSION) errors.push('schemaVersion inválido');
    if (!STATUSES.includes(p.status)) errors.push('estado inválido');
    if (p.status === 'completed' && !isComplete(p)) errors.push('perfil completado con datos pendientes: ' + missing(p).join(', '));
    const n = normalizeProfile(p);
    Object.keys(p).forEach(k => {
      if (['schemaVersion', 'status', 'updatedAt', 'completedAt', 'gradesGym'].includes(k)) return;
      if (JSON.stringify(n[k]) !== JSON.stringify(p[k])) errors.push(`campo inválido: ${k}`);
    });
    return errors;
  }

  // Ids del catálogo de ejercicios que el usuario tiene a mano (Gimnasio → barra, pesas, máquinas…)
  function catalogEquipment(p, environmentHasWall) {
    const out = new Set();
    (p.equipment || []).forEach(id => { const o = EQUIPMENT.find(e => e.id === id); if (o) o.catalog.forEach(c => out.add(c)); });
    if (environmentHasWall !== false && (p.environment === 'rocodromo' || p.environment === 'ambos')) out.add('rocodromo');
    return [...out];
  }

  // Resumen legible (una línea por dato); solo lo que corresponde a las modalidades elegidas
  function gradeText(scale, g, withTarget) {
    if (!g) return '';
    const t = x => (x === GRADE_UNKNOWN ? 'sin indicar' : x);
    const usual = g.usualFrom ? (g.usualTo && g.usualTo !== g.usualFrom ? `${t(g.usualFrom)}–${t(g.usualTo)}` : t(g.usualFrom)) : '';
    return [usual && `habitual ${usual}`, g.max && `máximo ${t(g.max)}`, withTarget !== false && g.target && `objetivo ${t(g.target)}`].filter(Boolean).join(' · ');
  }

  function summarize(p) {
    const rows = [];
    if (p.goalPrimary) {
      const sec = (p.goalsSecondary || []).map(id => labelOf(GOALS, id).toLowerCase());
      rows.push({ key: 'goal', label: 'Objetivo', value: labelOf(GOALS, p.goalPrimary) + (sec.length ? ` (y ${sec.join(', ')})` : '') });
    }
    practices(p).forEach(pr => {
      const t = gradeText(pr.scale, gradesFor(p, pr.env, pr.scale), pr.target);
      if (t) rows.push({ key: 'grade.' + pr.key, label: pr.label, value: t });
    });
    if (p.experience) rows.push({ key: 'experience', label: 'Experiencia', value: labelOf(EXPERIENCE, p.experience) });
    if (p.daysPerWeek && p.minutesPerSession) rows.push({ key: 'availability', label: 'Disponibilidad', value: `${p.daysPerWeek} ${p.daysPerWeek === 1 ? 'día' : 'días'} para escalar a la semana · ${p.minutesPerSession} min por sesión` });
    if (p.modality || p.environment) {
      let v = [labelOf(MODALITY, p.modality), labelOf(ENVIRONMENT, p.environment)].filter(Boolean).join(' · ');
      if (p.rockFrequency) v += ` · roca ${p.rockFrequency} ${p.rockFrequency === 1 ? 'día' : 'días'}/sem`;
      if (p.rockPriority && p.rockPriority !== 'ninguna') v += ` · ${labelOf(ROCK_PRIORITY, p.rockPriority).toLowerCase()}`;
      rows.push({ key: 'where', label: 'Modalidad y entorno', value: v });
    }
    if (p.equipment) rows.push({ key: 'equipment', label: 'Material', value: p.equipment.map(id => (id === 'otro' && p.equipmentOther) ? p.equipmentOther : labelOf(EQUIPMENT, id)).join(', ') });
    return rows;
  }

  // ── Evaluación mental ───────────────────────────────────────────────
  const validAnswer = v => v === 'unknown' || v === 'skip' || (Number.isInteger(v) && v >= 1 && v <= 5);

  function normalizeMental(raw) {
    const a = raw && raw.answers && typeof raw.answers === 'object' ? raw.answers : {};
    const answers = {};
    MENTAL_IDS.forEach(id => { if (validAnswer(a[id])) answers[id] = a[id]; });
    return { schemaVersion: SCHEMA_VERSION, answers };
  }
  const mentalAnswered = m => MENTAL_IDS.filter(id => m && m.answers && id in m.answers).length;
  const mentalIsComplete = m => mentalAnswered(m) === MENTAL_IDS.length;
  function validateMental(m) {
    const errors = [];
    if (!m || typeof m !== 'object') return ['la evaluación no es un objeto'];
    if (m.schemaVersion !== SCHEMA_VERSION) errors.push('schemaVersion inválido');
    const a = m.answers;
    if (!a || typeof a !== 'object') return errors.concat('faltan las respuestas');
    Object.keys(a).forEach(k => { if (!MENTAL_IDS.includes(k)) errors.push(`pregunta desconocida: ${k}`); else if (!validAnswer(a[k])) errors.push(`respuesta inválida: ${k}`); });
    return errors;
  }

  return {
    SCHEMA_VERSION, STATUSES, STEPS, GOALS, EXPERIENCE, MODALITY, ENVIRONMENT, ROCK_PRIORITY, EQUIPMENT, MINUTES,
    LIMITS, normalizeLimits, limitsAnswered, limitsText,
    SPORT_GRADES, BOULDER_GRADES, SCALES, SCALE_NAMES, GRADE_UNKNOWN, MENTAL_QUESTIONS, MENTAL_IDS, MENTAL_SPECIAL,
    needsSport, needsBoulder, asksRock, hasRock, hasGym, practices, gradesFor, setGradeFor, withEnvironment, STEP_ORDER, labelOf, gradeIndex,
    normalizeProfile, validateProfile, gradeWarnings, missingForStep, stepIsValid, missing, isComplete, firstIncompleteStep,
    catalogEquipment, summarize, gradeText, normalizeMental, validateMental, mentalAnswered, mentalIsComplete, validAnswer
  };
}));

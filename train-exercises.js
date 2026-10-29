// ================== ENTRENA — LÓGICA DEL CATÁLOGO DE EJERCICIOS ==================
// Módulo puro (sin DOM ni Firebase): taxonomía, validación, búsqueda, filtros,
// relaciones, enlace con ejercicios de planes antiguos y recomendador por reglas.
// Los datos viven en train-catalog-data.js (window.KRUX_CATALOG_DATA).
//
// ESQUEMA DE FICHA (schemaVersion 1)
//   Identidad     id, slug, name, aliases[], shortDescription, purpose,
//                 primaryCategoryId, categoryIds[], status ('published'|'draft'|'archived'),
//                 schemaVersion, contentVersion, createdAt?, updatedAt?
//   Clasificación abilities[], bodyAreas[], movementPatterns[], climbingDisciplines[],
//                 trainingContexts[], technicalLevel (1-3), physicalDemand (1-3),
//                 durationMin (minutos típicos del bloque)
//   instructions  { setup, executionSteps[{order,title,description}], breathing,
//                 keyCues[], commonMistakes[{name,correction}], completionCriteria[],
//                 stopCriteria[], coachingNotes }
//   media         { primaryMediaId|null, items[{id,type,storagePath|externalUrl,posterPath,
//                 caption,phase,order,attribution,reviewStatus}] }  (solo metadatos)
//   equipment     { required[ids], optional[ids], alternatives[ids], setupNotes }
//   prescriptionSchema  [{ param, label?, unit?, required?, default, min, max, step,
//                 editableInSession?, formats? }]   param ∈ PARAMS (nombres del modelo)
//   relations     { variants|regressions|progressions|alternatives|prerequisites|relatedExercises:
//                 [{ exerciseId, reason, conditions?, order }] }
//   safety        { warnings[], stopCriteria[], prerequisites[], supervisionRequired,
//                 sourceReferences[], minLevel (1-3: nivel mínimo recomendado) }
//   review        { status ('pending'|'reviewed'), reviewedBy, reviewedAt, notes }
//
// Un ejercicio de un plan guarda SOLO su prescripción (campos planos del modelo de
// Entrena) + exerciseId + exerciseContentVersion + notes. Nunca copia la ficha.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KruxExercises = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SCHEMA_VERSION = 1;
  const STATUSES = ['published', 'draft', 'archived'];
  const REVIEW_STATUSES = ['pending', 'reviewed'];
  const RELATION_TYPES = ['variants', 'regressions', 'progressions', 'alternatives', 'prerequisites', 'relatedExercises'];
  const MAX_PLAN_NOTES = 300;

  // Parámetros de prescripción: nombre del modelo → clave plana que ya usa Entrena.
  const PARAMS = {
    sets:                    { key: 'sets',       label: 'Series',              unit: '',    min: 1, max: 20,   step: 1 },
    repetitions:             { key: 'reps',       label: 'Repeticiones',        unit: '',    min: 0, max: 200,  step: 1 },
    workDurationSeconds:     { key: 'workSec',    label: 'Tiempo de trabajo',   unit: 's',   min: 0, max: 3600, step: 1 },
    holdDurationSeconds:     { key: 'workSec',    label: 'Tiempo de suspensión', unit: 's',  min: 0, max: 3600, step: 1 },
    restDurationSeconds:     { key: 'restSec',    label: 'Descanso',            unit: 's',   min: 0, max: 900,  step: 5 },
    externalLoadKg:          { key: 'weight',     label: 'Carga adicional',     unit: 'kg',  min: 0, max: 200,  step: 0.5 },
    assistanceKg:            { key: 'assistanceKg', label: 'Asistencia',        unit: 'kg',  min: 0, max: 80,   step: 0.5 },
    rpeTarget:               { key: 'rpeTarget',  label: 'RPE objetivo',        unit: '',    min: 0, max: 10,   step: 1 },
    distanceMeters:          { key: 'distanceM',  label: 'Distancia',           unit: 'm',   min: 0, max: 5000, step: 5 },
    attempts:                { key: 'reps',       label: 'Intentos',            unit: '',    min: 1, max: 50,   step: 1 },
    tempo:                   { key: 'tempo',      label: 'Tempo',               unit: '',    type: 'text' },
    recoveryDurationSeconds: { key: 'recoverySec', label: 'Recuperación',       unit: 's',   min: 0, max: 1800, step: 5 }
  };
  // Claves del plan que no existían antes y se guardan solo si el ejercicio las usa
  const EXTRA_KEYS = ['assistanceKg', 'distanceM', 'tempo', 'recoverySec'];
  const TEMPO_RE = /^\d{1,2}(-\d{1,2}){1,3}$/;

  const LEVEL_LABELS = { 1: 'Principiante', 2: 'Intermedio', 3: 'Avanzado' };
  const DEMAND_LABELS = { 1: 'Baja', 2: 'Media', 3: 'Alta' };

  // Etiquetas normalizadas (id → nombre en español)
  const TAGS = {
    abilities: {
      'fuerza-maxima': 'Fuerza máxima', potencia: 'Potencia', resistencia: 'Resistencia',
      tecnica: 'Técnica', movilidad: 'Movilidad', coordinacion: 'Coordinación', 'control-corporal': 'Control corporal'
    },
    bodyAreas: {
      dedos: 'Dedos', antebrazo: 'Antebrazo', espalda: 'Espalda', hombros: 'Hombros',
      core: 'Core', piernas: 'Piernas', tobillos: 'Tobillos', caderas: 'Caderas'
    },
    movementPatterns: {
      traccion: 'Tracción', empuje: 'Empuje', isometrico: 'Isométrico', unilateral: 'Unilateral',
      dinamico: 'Dinámico', locomocion: 'Locomoción'
    },
    climbingDisciplines: { bloque: 'Bloque', deportiva: 'Deportiva', competicion: 'Competición', general: 'General' },
    trainingContexts: {
      calentamiento: 'Calentamiento', principal: 'Ejercicio principal', accesorio: 'Accesorio',
      tecnica: 'Técnica', recuperacion: 'Recuperación'
    }
  };

  const DURATION_BUCKETS = {
    corto: { label: 'Hasta 10 min', test: m => m <= 10 },
    medio: { label: '10–20 min', test: m => m > 10 && m <= 20 },
    largo: { label: 'Más de 20 min', test: m => m > 20 }
  };

  // Sinónimos para la búsqueda (todos normalizados: minúsculas y sin tildes)
  const SYNONYM_GROUPS = [
    ['dominada', 'dominadas', 'pullup', 'pullups', 'pull-up', 'chinup'],
    ['suspension', 'suspensiones', 'colgarse', 'colgado', 'hang', 'hangs', 'cuelgue'],
    ['regleta', 'regletas', 'canto', 'crimp', 'edge'],
    ['goma', 'gomas', 'banda', 'bandas', 'elastico', 'theraband'],
    ['plancha', 'plank'],
    ['campus', 'campusing', 'campuseo'],
    ['dino', 'dinos', 'dyno', 'dynos', 'lanzamiento', 'lanzamientos'],
    ['lastre', 'lastrada', 'lastrado', 'peso', 'weighted'],
    ['sentadilla', 'sentadillas', 'squat', 'squats'],
    ['zancada', 'zancadas', 'lunge', 'lunges'],
    ['flexion', 'flexiones', 'pushup', 'pushups'],
    ['hombro', 'hombros', 'manguito', 'escapula', 'escapular'],
    ['pie', 'pies', 'pisada', 'precision'],
    ['aerobica', 'aerobico', 'arc', 'capilarizacion'],
    ['traccion', 'tirar', 'jalar'],
    ['calentamiento', 'calentar', 'warmup', 'activacion'],
    ['movilidad', 'flexibilidad', 'estiramiento', 'estiramientos'],
    ['muneca', 'munecas', 'antebrazo', 'extensores']
  ];
  const SYNONYMS = new Map();
  SYNONYM_GROUPS.forEach(group => group.forEach(w => SYNONYMS.set(w, group)));

  // ── Utilidades ──────────────────────────────────────────────────────
  function normalize(text) {
    return String(text == null ? '' : text)
      .toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
  const isStr = (v, max) => typeof v === 'string' && v.trim().length > 0 && (!max || v.length <= max);
  const arr = v => (Array.isArray(v) ? v : []);

  // Distancia de edición ≤ 1 (inserción, borrado, sustitución o transposición)
  function withinOneEdit(a, b) {
    if (a === b) return true;
    const la = a.length, lb = b.length;
    if (Math.abs(la - lb) > 1) return false;
    let i = 0;
    while (i < la && i < lb && a[i] === b[i]) i++;
    if (la === lb) {
      if (a.slice(i + 1) === b.slice(i + 1)) return true;
      return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2);
    }
    return la > lb ? a.slice(i + 1) === b.slice(i) : b.slice(i + 1) === a.slice(i);
  }

  // ── Catálogo: construcción e índices ────────────────────────────────
  function createCatalog(data) {
    const categories = arr(data.categories).slice().sort((a, b) => a.order - b.order);
    const equipment = arr(data.equipment);
    const exercises = arr(data.exercises).filter(e => e && e.status !== 'archived' && e.status !== 'draft');
    const catById = new Map(categories.map(c => [c.id, c]));
    const eqById = new Map(equipment.map(e => [e.id, e]));
    const byId = new Map();
    const byName = new Map();

    exercises.forEach(ex => {
      byId.set(ex.id, ex);
      [ex.name].concat(arr(ex.aliases)).forEach(n => {
        const key = normalize(n);
        if (key && !byName.has(key)) byName.set(key, ex);
      });
      ex._index = buildIndex(ex, catById, eqById);
    });

    return { categories, equipment, exercises, catById, eqById, byId, byName, schemaVersion: data.schemaVersion || SCHEMA_VERSION };
  }

  function buildIndex(ex, catById, eqById) {
    const cat = catById.get(ex.primaryCategoryId);
    const tagNames = [];
    Object.keys(TAGS).forEach(group => arr(ex[group]).forEach(id => tagNames.push(TAGS[group][id] || id)));
    const nameN = normalize(ex.name);
    const aliasN = arr(ex.aliases).map(normalize);
    const eqNames = arr(ex.equipment && ex.equipment.required).concat(arr(ex.equipment && ex.equipment.alternatives)).map(id => {
      const e = eqById && eqById.get(id);
      return e ? e.name + ' ' + (e.short || '') : id;
    });
    if (!arr(ex.equipment && ex.equipment.required).filter(id => id !== 'peso-corporal').length) eqNames.push('sin material');
    const restN = normalize([ex.shortDescription, cat && cat.name, tagNames.join(' '), eqNames.join(' '), LEVEL_LABELS[ex.technicalLevel]].join(' '));
    return {
      nameN,
      aliasN,
      nameTokens: nameN.split(' ').filter(Boolean),
      tokens: new Set((nameN + ' ' + aliasN.join(' ') + ' ' + restN).split(' ').filter(Boolean))
    };
  }

  // ── Validación ──────────────────────────────────────────────────────
  function inRange(n, min, max) { return typeof n === 'number' && isFinite(n) && n >= min && n <= max; }

  function validateExercise(ex, catalog) {
    const errors = [];
    const err = msg => errors.push(`${ex && ex.id ? ex.id : '(sin id)'}: ${msg}`);
    if (!isObj(ex)) return ['ejercicio no es un objeto'];

    if (!isStr(ex.id, 80) || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(ex.id)) err('id inválido (kebab-case)');
    if (ex.slug !== ex.id) err('slug debe coincidir con id');
    if (!isStr(ex.name, 100)) err('name obligatorio (≤100)');
    if (!isStr(ex.shortDescription, 200)) err('shortDescription obligatorio (≤200)');
    if (!isStr(ex.purpose, 400)) err('purpose obligatorio (≤400)');
    if (!STATUSES.includes(ex.status)) err('status inválido');
    if (ex.schemaVersion !== SCHEMA_VERSION) err('schemaVersion inválido');
    if (!Number.isInteger(ex.contentVersion) || ex.contentVersion < 1) err('contentVersion inválido');

    if (catalog && !catalog.catById.has(ex.primaryCategoryId)) err(`categoría principal inexistente: ${ex.primaryCategoryId}`);
    if (!arr(ex.categoryIds).includes(ex.primaryCategoryId)) err('categoryIds debe incluir la categoría principal');
    if (catalog) arr(ex.categoryIds).forEach(c => { if (!catalog.catById.has(c)) err(`categoría inexistente: ${c}`); });

    Object.keys(TAGS).forEach(group => {
      if (!arr(ex[group]).length && group !== 'climbingDisciplines') err(`${group} vacío`);
      arr(ex[group]).forEach(id => { if (!TAGS[group][id]) err(`etiqueta desconocida en ${group}: ${id}`); });
    });
    if (!inRange(ex.technicalLevel, 1, 3) || !Number.isInteger(ex.technicalLevel)) err('technicalLevel fuera de 1-3');
    if (!inRange(ex.physicalDemand, 1, 3) || !Number.isInteger(ex.physicalDemand)) err('physicalDemand fuera de 1-3');
    if (!inRange(ex.durationMin, 1, 180)) err('durationMin fuera de 1-180');

    const ins = ex.instructions;
    if (!isObj(ins)) err('instructions obligatorio');
    else {
      if (!arr(ins.executionSteps).length) err('executionSteps vacío');
      arr(ins.executionSteps).forEach((s, i) => {
        if (s.order !== i + 1) err(`executionSteps[${i}].order debe ser ${i + 1}`);
        if (!isStr(s.title) || !isStr(s.description)) err(`executionSteps[${i}] sin título o descripción`);
      });
      arr(ins.commonMistakes).forEach((m, i) => { if (!isStr(m.name) || !isStr(m.correction)) err(`commonMistakes[${i}] incompleto`); });
      if (!arr(ins.stopCriteria).length && !arr(ex.safety && ex.safety.stopCriteria).length) err('falta criterio para detener el ejercicio');
    }

    const eq = ex.equipment;
    if (!isObj(eq)) err('equipment obligatorio');
    else if (catalog) ['required', 'optional', 'alternatives'].forEach(k => arr(eq[k]).forEach(id => {
      if (!catalog.eqById.has(id)) err(`material inexistente en ${k}: ${id}`);
    }));

    const media = ex.media;
    if (!isObj(media) || !Array.isArray(media.items)) err('media.items obligatorio (puede estar vacío)');
    else {
      const ids = new Set();
      media.items.forEach((m, i) => {
        if (!isStr(m.id) || ids.has(m.id)) err(`media[${i}].id inválido o repetido`);
        ids.add(m.id);
        if (!['image', 'video', 'animation'].includes(m.type)) err(`media[${i}].type inválido`);
        if (!['pending', 'verified', 'rejected'].includes(m.reviewStatus)) err(`media[${i}].reviewStatus inválido`);
        if (m.reviewStatus === 'verified' && !isStr(m.attribution, 200)) err(`media[${i}] verificado sin atribución`);
        if (!m.storagePath && !m.externalUrl) err(`media[${i}] sin storagePath ni externalUrl`);
      });
      if (media.primaryMediaId != null && !ids.has(media.primaryMediaId)) err('primaryMediaId no existe en items');
    }

    const schema = arr(ex.prescriptionSchema);
    if (!schema.length) err('prescriptionSchema vacío');
    const seenKeys = new Set();
    schema.forEach((p, i) => {
      const def = PARAMS[p.param];
      if (!def) { err(`prescriptionSchema[${i}].param desconocido: ${p.param}`); return; }
      if (seenKeys.has(def.key)) err(`prescriptionSchema repite la clave ${def.key}`);
      seenKeys.add(def.key);
      if (def.type === 'text') {
        if (p.default != null && p.default !== '' && !TEMPO_RE.test(p.default)) err(`default de ${p.param} no es un tempo válido`);
      } else {
        const min = p.min != null ? p.min : def.min;
        const max = p.max != null ? p.max : def.max;
        if (min < def.min || max > def.max || min > max) err(`rango de ${p.param} fuera de los límites del modelo`);
        if (p.default != null && !inRange(p.default, min, max)) err(`default de ${p.param} fuera de rango`);
        if (p.step != null && !(p.step > 0)) err(`step de ${p.param} inválido`);
      }
    });
    if (!seenKeys.has('sets')) err('prescriptionSchema debe incluir sets');

    const rel = ex.relations;
    if (!isObj(rel)) err('relations obligatorio');
    else RELATION_TYPES.forEach(type => arr(rel[type]).forEach((r, i) => {
      if (!isStr(r.exerciseId)) err(`relations.${type}[${i}] sin exerciseId`);
      else if (r.exerciseId === ex.id) err(`relations.${type}[${i}] apunta a sí mismo`);
      else if (catalog && !catalog.byId.has(r.exerciseId)) err(`relations.${type}[${i}] apunta a un ejercicio inexistente: ${r.exerciseId}`);
      if (!isStr(r.reason)) err(`relations.${type}[${i}] sin reason`);
    }));

    const safety = ex.safety;
    if (!isObj(safety) || !inRange(safety.minLevel, 1, 3)) err('safety.minLevel fuera de 1-3');
    if (!isObj(ex.review) || !REVIEW_STATUSES.includes(ex.review.status)) err('review.status inválido');
    else if (ex.review.status === 'reviewed' && (!isStr(ex.review.reviewedBy) || !ex.review.reviewedAt)) err('una ficha revisada necesita reviewedBy y reviewedAt');

    return errors;
  }

  function validateCatalog(data) {
    const errors = [];
    const catIds = new Set();
    arr(data.categories).forEach(c => {
      if (!isStr(c.id) || catIds.has(c.id)) errors.push(`categoría con id inválido o repetido: ${c && c.id}`);
      catIds.add(c.id);
      if (!isStr(c.name)) errors.push(`categoría sin nombre: ${c.id}`);
    });
    const eqIds = new Set();
    arr(data.equipment).forEach(e => {
      if (!isStr(e.id) || eqIds.has(e.id)) errors.push(`material con id inválido o repetido: ${e && e.id}`);
      eqIds.add(e.id);
    });
    const ids = new Set();
    arr(data.exercises).forEach(e => {
      if (ids.has(e.id)) errors.push(`ejercicio repetido: ${e.id}`);
      ids.add(e.id);
    });
    const catalog = createCatalog({ ...data, exercises: arr(data.exercises) });
    arr(data.exercises).forEach(ex => errors.push(...validateExercise(ex, catalog)));
    errors.push(...findProgressionCycles(catalog));
    return errors;
  }

  // Ciclos en progresiones/prerrequisitos (A requiere B y B requiere A)
  function findProgressionCycles(catalog) {
    const errors = [];
    const state = new Map();
    const visit = (id, path) => {
      if (state.get(id) === 2) return;
      if (state.get(id) === 1) { errors.push(`ciclo en progresiones: ${path.concat(id).join(' → ')}`); return; }
      state.set(id, 1);
      const ex = catalog.byId.get(id);
      if (ex) arr(ex.relations && ex.relations.progressions).forEach(r => visit(r.exerciseId, path.concat(id)));
      state.set(id, 2);
    };
    catalog.exercises.forEach(ex => visit(ex.id, []));
    return errors;
  }

  // ── Búsqueda y filtros ──────────────────────────────────────────────
  function expandToken(token) {
    const group = SYNONYMS.get(token);
    return group ? group : [token];
  }

  function tokenMatches(variants, ex) {
    const idx = ex._index;
    for (const v of variants) {
      for (const t of idx.tokens) {
        if (t.indexOf(v) === 0 || (v.length >= 4 && t.indexOf(v) > 0)) return true;
        if (v.length >= 5 && t.length >= 5 && withinOneEdit(v, t)) return true;
      }
    }
    return false;
  }

  // Devuelve un número > 0 si el ejercicio coincide con la consulta, 0 si no
  function searchScore(ex, query) {
    const q = normalize(query);
    if (!q) return 1;
    const tokens = q.split(' ').filter(t => t.length > 1);
    if (!tokens.length) return 1;
    const idx = ex._index;
    if (!tokens.every(t => tokenMatches(expandToken(t), ex))) return 0;
    let score = 1;
    if (idx.nameN === q) score += 12;
    else if (idx.nameN.indexOf(q) === 0) score += 8;
    else if (idx.nameN.indexOf(q) > -1) score += 6;
    if (idx.aliasN.some(a => a === q)) score += 7;
    else if (idx.aliasN.some(a => a.indexOf(q) > -1)) score += 4;
    tokens.forEach(t => { if (idx.nameTokens.some(n => n.indexOf(t) === 0)) score += 2; });
    return score;
  }

  function matchesAny(selected, values) {
    return !selected || !selected.length || selected.some(s => values.includes(s));
  }

  // Los filtros se combinan con AND entre grupos y OR dentro de cada grupo
  function filterExercises(catalog, f) {
    const filters = f || {};
    const list = [];
    catalog.exercises.forEach(ex => {
      if (filters.categoryId && !ex.categoryIds.includes(filters.categoryId)) return;
      if (filters.favoritesOnly && !(filters.favoriteIds || []).includes(ex.id)) return;
      if (!matchesAny(filters.abilities, ex.abilities)) return;
      if (!matchesAny(filters.bodyAreas, ex.bodyAreas)) return;
      if (!matchesAny(filters.contexts, ex.trainingContexts)) return;
      if (!matchesAny(filters.disciplines, ex.climbingDisciplines)) return;
      if (filters.technicalLevel && filters.technicalLevel.length && !filters.technicalLevel.includes(ex.technicalLevel)) return;
      if (filters.physicalDemand && filters.physicalDemand.length && !filters.physicalDemand.includes(ex.physicalDemand)) return;
      if (filters.durations && filters.durations.length && !filters.durations.some(k => DURATION_BUCKETS[k] && DURATION_BUCKETS[k].test(ex.durationMin))) return;
      if (filters.equipment && filters.equipment.length) {
        const used = ex.equipment.required.concat(ex.equipment.alternatives || []);
        const none = filters.equipment.includes('ninguno') && !ex.equipment.required.length;
        if (!none && !filters.equipment.some(e => used.includes(e))) return;
      }
      const score = searchScore(ex, filters.query);
      if (!score) return;
      list.push({ ex, score });
    });
    list.sort((a, b) => b.score - a.score || a.ex.name.localeCompare(b.ex.name, 'es'));
    return list.map(x => x.ex);
  }

  // ── Multimedia ──────────────────────────────────────────────────────
  // Solo se muestra material verificado (reviewStatus 'verified'), con atribución y con una
  // ubicación utilizable: ruta de Storage o URL https. Cualquier otra cosa se ignora.
  const MEDIA_TYPES = ['image', 'video', 'animation'];
  function verifiedMedia(ex) {
    const items = ex && ex.media && Array.isArray(ex.media.items) ? ex.media.items : [];
    const ok = items.filter(m => m && MEDIA_TYPES.includes(m.type) && m.reviewStatus === 'verified'
      && isStr(m.attribution, 200)
      && ((typeof m.storagePath === 'string' && m.storagePath.trim()) || (typeof m.externalUrl === 'string' && /^https:\/\//i.test(m.externalUrl))));
    const primary = ex && ex.media ? ex.media.primaryMediaId : null;
    return ok.slice().sort((a, b) => (a.id === primary ? -1 : b.id === primary ? 1 : 0) || (a.order || 0) - (b.order || 0));
  }

  // ── Relaciones ──────────────────────────────────────────────────────
  function getRelations(catalog, ex) {
    const out = [];
    RELATION_TYPES.forEach(type => {
      const items = arr(ex.relations && ex.relations[type])
        .slice()
        .sort((a, b) => (a.order || 0) - (b.order || 0))
        .map(r => ({ rel: r, ex: catalog.byId.get(r.exerciseId) }))
        .filter(x => x.ex);
      if (items.length) out.push({ type, items });
    });
    return out;
  }

  // ── Enlace con ejercicios de planes antiguos (en memoria, sin escribir) ──
  function resolveByName(catalog, name) {
    const full = normalize(name);
    if (!full) return null;
    if (catalog.byName.has(full)) return catalog.byName.get(full);
    // «Max hang · 20mm»: la parte tras «·» es una configuración del mismo ejercicio solo si lleva
    // cifras (20mm, 1-5-9, 45°). «ARC · intervalos» o «Core · Hollow» no se enlazan por parecido.
    const parts = String(name).split('·');
    if (parts.length > 1 && /\d/.test(parts.slice(1).join(' '))) {
      const base = normalize(parts[0]);
      if (base && base !== full && catalog.byName.has(base)) return catalog.byName.get(base);
    }
    return null;
  }

  function planItemFromExercise(ex) {
    const item = { name: ex.name, exerciseId: ex.id, exerciseContentVersion: ex.contentVersion, sets: 3, workSec: 0, reps: 0, weight: 0, restSec: 0, rpeTarget: 0, notes: '' };
    arr(ex.prescriptionSchema).forEach(p => {
      const def = PARAMS[p.param];
      if (!def || p.default == null) return;
      item[def.key] = p.default;
    });
    return item;
  }

  function linkPlanItem(catalog, item) {
    if (!item || item.exerciseId) return item;
    const ex = resolveByName(catalog, item.name);
    if (ex) {
      item.exerciseId = ex.id;
      item.exerciseContentVersion = ex.contentVersion;
    }
    return item;
  }

  // Parámetros editables para un ejercicio del plan (los de su ficha, o los básicos si no hay ficha)
  function paramsForPlanItem(catalog, item) {
    const ex = item && item.exerciseId ? catalog.byId.get(item.exerciseId) : null;
    const base = ['sets', 'repetitions', 'workDurationSeconds', 'externalLoadKg', 'restDurationSeconds', 'rpeTarget'];
    const schemaKeys = new Set(ex ? arr(ex.prescriptionSchema).map(p => PARAMS[p.param] && PARAMS[p.param].key) : []);
    const out = [];
    const seen = new Set();
    const push = (param, label) => {
      const def = PARAMS[param];
      if (seen.has(def.key)) return;
      seen.add(def.key);
      // applies: el parámetro es propio de la ficha (sin ficha, los seis básicos aplican)
      out.push({ param, key: def.key, label: label || def.label, unit: def.unit, min: def.min, max: def.max, step: def.step, type: def.type || 'number', applies: !ex || schemaKeys.has(def.key) });
    };
    base.forEach(p => push(p));
    if (ex) arr(ex.prescriptionSchema).forEach(p => {
      const def = PARAMS[p.param];
      if (!def) return;
      if (seen.has(def.key)) {
        const found = out.find(o => o.key === def.key);
        if (found && (p.label || p.param !== found.param)) { found.label = p.label || def.label; found.param = p.param; }
        if (found) found.applies = true;
        if (found && p.min != null) found.min = p.min;
        if (found && p.max != null) found.max = p.max;
        if (found && p.step != null) found.step = p.step;
        return;
      }
      push(p.param, p.label);
      const added = out[out.length - 1];
      added.applies = true;
      if (p.min != null) added.min = p.min;
      if (p.max != null) added.max = p.max;
      if (p.step != null) added.step = p.step;
    });
    EXTRA_KEYS.forEach(key => {
      if (seen.has(key) || item[key] == null || item[key] === 0 || item[key] === '') return;
      const param = Object.keys(PARAMS).find(k => PARAMS[k].key === key);
      if (param) push(param);
    });
    return out;
  }

  // ── Recomendador por reglas (determinista, sin IA) ──────────────────
  const GOALS = {
    fuerza:      { label: 'Fuerza',          abilities: ['fuerza-maxima'] },
    resistencia: { label: 'Resistencia',     abilities: ['resistencia'] },
    potencia:    { label: 'Potencia',        abilities: ['potencia'] },
    tecnica:     { label: 'Técnica',         abilities: ['tecnica', 'coordinacion'] },
    general:     { label: 'Mejora general',  abilities: ['fuerza-maxima', 'resistencia', 'tecnica'] }
  };

  // Enfoques de sesión: cada hueco pide una categoría y cuántos ejercicios
  const FOCUS = {
    dedos:       { name: 'Dedos y agarre',      slots: [{ cat: 'movilidad', ctx: 'calentamiento', n: 1 }, { cat: 'dedos', n: 2 }, { cat: 'antagonistas', n: 1 }] },
    traccion:    { name: 'Fuerza de tracción',  slots: [{ cat: 'movilidad', ctx: 'calentamiento', n: 1 }, { cat: 'traccion', n: 2 }, { cat: 'core', n: 1 }] },
    potencia:    { name: 'Potencia',            slots: [{ cat: 'movilidad', ctx: 'calentamiento', n: 1 }, { cat: 'potencia', n: 2 }, { cat: 'antagonistas', n: 1 }] },
    resistencia: { name: 'Resistencia',         slots: [{ cat: 'resistencia', n: 2 }, { cat: 'core', n: 1 }, { cat: 'movilidad', ctx: 'recuperacion', n: 1 }] },
    piernas:     { name: 'Piernas y pies',      slots: [{ cat: 'movilidad', ctx: 'calentamiento', n: 1 }, { cat: 'piernas', n: 3 }, { cat: 'core', n: 1 }] },
    tecnica:     { name: 'Técnica',             slots: [{ cat: 'movilidad', ctx: 'calentamiento', n: 1 }, { cat: 'tecnica', n: 3 }, { cat: 'movilidad', ctx: 'recuperacion', n: 1 }] },
    general:     { name: 'Fuerza general',      slots: [{ cat: 'movilidad', ctx: 'calentamiento', n: 1 }, { cat: 'general', n: 3 }, { cat: 'core', n: 1 }] }
  };

  const GOAL_ROTATION = {
    fuerza:      ['dedos', 'traccion', 'piernas', 'dedos', 'general', 'tecnica', 'traccion'],
    resistencia: ['resistencia', 'tecnica', 'resistencia', 'piernas', 'resistencia', 'traccion', 'tecnica'],
    potencia:    ['potencia', 'traccion', 'tecnica', 'potencia', 'piernas', 'dedos', 'tecnica'],
    tecnica:     ['tecnica', 'resistencia', 'tecnica', 'piernas', 'tecnica', 'potencia', 'dedos'],
    general:     ['dedos', 'resistencia', 'traccion', 'tecnica', 'piernas', 'general', 'tecnica']
  };

  const DAY_PATTERNS = {
    1: [0], 2: [0, 3], 3: [0, 2, 4], 4: [0, 1, 3, 4], 5: [0, 1, 2, 3, 4], 6: [0, 1, 2, 3, 4, 5], 7: [0, 1, 2, 3, 4, 5, 6]
  };

  const ALWAYS_EQUIPMENT = ['peso-corporal'];

  function equipmentOk(ex, available) {
    const have = new Set(available.concat(ALWAYS_EQUIPMENT));
    const req = arr(ex.equipment.required);
    if (req.every(id => have.has(id))) return true;
    return arr(ex.equipment.alternatives).some(id => have.has(id));
  }

  function estimateMinutes(items) {
    const sec = items.reduce((acc, it) => {
      const work = it.workSec > 0 ? it.workSec : (it.reps || 0) * 3;
      return acc + it.sets * work + Math.max(0, it.sets - 1) * (it.restSec || 0);
    }, 0);
    return Math.max(5, Math.round(sec / 300) * 5);
  }

  function shrinkLongest(items, catalog) {
    const longest = items.slice().sort((a, b) => estimateMinutes([b]) - estimateMinutes([a]))[0];
    if (!longest) return false;
    const ex = catalog.byId.get(longest.exerciseId);
    const sets = ex && arr(ex.prescriptionSchema).find(p => p.param === 'sets');
    const work = ex && arr(ex.prescriptionSchema).find(p => PARAMS[p.param] && PARAMS[p.param].key === 'workSec');
    if (longest.sets > ((sets && sets.min) || 1)) { longest.sets--; return true; }
    const min = (work && work.min) || 0;
    if (longest.workSec - 300 >= Math.max(min, 300)) { longest.workSec -= 300; return true; }
    return false;
  }

  function whyText(ex, goal, level, catalog) {
    const g = GOALS[goal];
    const hit = g.abilities.filter(a => ex.abilities.includes(a)).map(a => TAGS.abilities[a].toLowerCase());
    const parts = [];
    if (hit.length) parts.push(`trabaja ${hit.join(' y ')}`);
    else parts.push(`complementa el objetivo con ${TAGS.abilities[ex.abilities[0]].toLowerCase()}`);
    const req = arr(ex.equipment.required).map(id => catalog.eqById.get(id)).filter(Boolean).map(e => e.name.toLowerCase());
    parts.push(req.length ? `usa ${req.join(' y ')}` : 'no necesita material');
    parts.push(`nivel ${LEVEL_LABELS[ex.technicalLevel].toLowerCase()}`);
    const text = parts.join(' · ');
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  // answers: { goal, level (1-3), days (1-7), minutes (20-120), equipment: [ids] }
  function recommendPlan(catalog, answers) {
    const goal = GOALS[answers.goal] ? answers.goal : 'general';
    const level = inRange(answers.level, 1, 3) ? Math.round(answers.level) : 1;
    const days = Math.min(7, Math.max(1, Math.round(answers.days) || 3));
    const minutes = Math.min(180, Math.max(20, Math.round(answers.minutes) || 60));
    const available = arr(answers.equipment);

    const eligible = catalog.exercises.filter(ex =>
      ex.safety.minLevel <= level && ex.technicalLevel <= Math.min(3, level + 1) && equipmentOk(ex, available));

    const used = new Map();   // ejercicio → veces usado en el plan (evita repetir el mismo estímulo)
    const notes = [];
    const gaps = [];
    const rotation = GOAL_ROTATION[goal];
    const dayIdx = DAY_PATTERNS[days];
    const sessions = [];

    const score = (ex, slot) => {
      let s = 0;
      const g = GOALS[goal];
      s += g.abilities.filter(a => ex.abilities.includes(a)).length * 3;
      if (slot.ctx && ex.trainingContexts.includes(slot.ctx)) s += 4;
      if (!slot.ctx && ex.trainingContexts.includes('principal')) s += 2;
      s -= Math.abs(ex.technicalLevel - level) * 1.5;
      s -= (used.get(ex.id) || 0) * 4;
      return s;
    };

    dayIdx.forEach((day, i) => {
      const focusKey = rotation[i % rotation.length];
      const focus = FOCUS[focusKey];
      const items = [];
      const picked = new Set();
      focus.slots.forEach(slot => {
        const pool = eligible.filter(ex => ex.categoryIds.includes(slot.cat) && !picked.has(ex.id)
          && (!slot.ctx || ex.trainingContexts.includes(slot.ctx)));
        const ranked = pool.map(ex => ({ ex, s: score(ex, slot) }))
          .sort((a, b) => b.s - a.s || a.ex.id.localeCompare(b.ex.id));
        const take = ranked.slice(0, slot.n);
        if (!take.length) {
          const catName = catalog.catById.get(slot.cat).name;
          if (!gaps.includes(catName) && slot.cat !== 'movilidad') gaps.push(catName);
          return;
        }
        take.forEach(({ ex }) => {
          picked.add(ex.id);
          used.set(ex.id, (used.get(ex.id) || 0) + 1);
          const item = planItemFromExercise(ex);
          item.why = whyText(ex, goal, level, catalog);
          items.push(item);
        });
      });

      // Ajuste al tiempo disponible: se quitan primero los accesorios del final y, con dos
      // ejercicios, se acorta el más largo (series y después duración) hasta que quepa
      while (estimateMinutes(items) > minutes) {
        if (items.length > 2) { items.pop(); continue; }
        if (!shrinkLongest(items, catalog)) break;
      }
      if (items.length) sessions.push({ day: 'L', name: focus.name, exercises: items, focus: focusKey, _day: day });
    });

    // Los ids de día se asignan en orden a los días activos
    const DAYS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
    const activeDays = DAYS.map((_, i) => dayIdx.includes(i));
    sessions.forEach((s, i) => { s.day = DAYS[dayIdx[i]] || '?'; delete s._day; });

    if (level === 1) notes.push('Para principiantes no se incluyen ejercicios intensos de dedos, campus ni cargas altas.');
    if (gaps.length) notes.push(`Con el material elegido no hay ejercicios de: ${gaps.join(', ')}.`);
    if (!sessions.length) notes.push('No hay ejercicios compatibles con esta combinación. Prueba a añadir material o a bajar la exigencia.');
    notes.push('No conocemos tu rendimiento actual: ajusta las cargas con el RPE y empieza por debajo de tu límite.');

    const weeks = goal === 'tecnica' ? 4 : level === 1 ? 4 : 6;
    return {
      name: `${GOALS[goal].label} · ${days} ${days === 1 ? 'día' : 'días'}/sem`,
      goal, level, weeks, activeDays, sessions, notes, equipment: available, minutes
    };
  }

  return {
    SCHEMA_VERSION, PARAMS, EXTRA_KEYS, TAGS, GOALS, LEVEL_LABELS, DEMAND_LABELS, DURATION_BUCKETS, RELATION_TYPES, TEMPO_RE, MAX_PLAN_NOTES,
    normalize, createCatalog, validateExercise, validateCatalog, findProgressionCycles,
    searchScore, filterExercises, getRelations, verifiedMedia, resolveByName, planItemFromExercise, linkPlanItem,
    paramsForPlanItem, recommendPlan, estimateMinutes, equipmentOk
  };
}));

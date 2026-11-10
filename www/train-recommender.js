// ================== ENTRENA — RECOMENDADOR DE ENTRENAMIENTO («PARA TI») ==================
// Módulo puro (sin DOM ni Firebase). Propone sesiones concretas con los ejercicios del catálogo (train-exercises.js) y, si la evaluación
// mental lo justifica, una práctica de la biblioteca mental. Es determinista y por reglas: no usa IA ni inventa datos.
//
//   recommend({ catalog, X, profile, mental, limits, history, today, mentalItems }) → { items, context }
//     catalog      createCatalog(...) de train-exercises.js        X  el módulo KruxExercises
//     profile      perfil normalizado (train-profile.js)           mental  evaluación mental ({answers})
//     limits       limitaciones (solo en el dispositivo) o null    history  registros de sesiones (kruxTrainLog)
//     mentalItems  [{ id, title, minutes, categoryId }]            today  'YYYY-MM-DD'
//     practices    [{ key, label, env, scale, usual?, max? }]  modalidades que practica (train-profile.js · practices + gradesFor).
//                  Cada sesión se piensa para UNA modalidad y entorno y usa el grado de esa modalidad y entorno; los grados de roca y de
//                  rocódromo no se convierten ni se mezclan.
//
// Criterios, por orden de prioridad:
//  1. SEGURIDAD. Las limitaciones son filtros obligatorios: se excluye todo ejercicio que cargue la zona indicada (LOAD_RULES) o cuya
//     carga no se pueda determinar. «Otra» limitación no se puede comprobar: ninguna recomendación se presenta como segura.
//  2. COMPATIBILIDAD. Nivel (experiencia y, si se conoce, grado habitual de la modalidad y entorno de la sesión: se usa el menor),
//     material disponible y tiempo por sesión. Los días «para escalar» son disponibilidad de escalada, no frecuencia de entrenamiento:
//     el entrenamiento complementario se calcula aparte (TRAIN_PER_WEEK).
//  3. RECUPERACIÓN. Tras una sesión intensa reciente (RPE ≥ 8, ejercicios de exigencia alta) o con la frecuencia semanal ya cumplida,
//     la propuesta es una sesión suave. Nunca dos sesiones intensas seguidas.
//  4. UTILIDAD. El enfoque sale del objetivo principal (y del secundario) y de lo menos trabajado en las últimas dos semanas.
// Nunca se sube la carga: la prescripción es la base del catálogo (o menor), y la persona decide si progresa.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KruxRecommender = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ── Tablas ──────────────────────────────────────────────────────────
  const LEVEL_OF_EXPERIENCE = { lt1: 1, '1-2': 1, '2-4': 2, gt4: 3 };      // conservador: hasta 2 años se parte de principiante
  // Enfoques por objetivo del perfil (claves de FOCUS de train-exercises.js, en orden de preferencia)
  const PREFERENCE = {
    grado: ['tecnica', 'resistencia', 'traccion', 'dedos'],
    fuerza: ['dedos', 'traccion', 'general'],
    resistencia: ['resistencia', 'tecnica', 'piernas'],
    tecnica: ['tecnica', 'piernas', 'resistencia'],
    competicion: ['potencia', 'resistencia', 'tecnica', 'dedos'],
    forma: ['general', 'resistencia', 'tecnica']
  };
  // Disponibilidad para escalar (días/semana) → sesiones de entrenamiento complementario por semana: como mucho la mitad de los días, entre 1 y 3
  const trainPerWeek = climbDays => Math.min(3, Math.max(1, Math.round((climbDays || 3) / 2)));
  // Nivel por grado habitual: deportiva < 6a / < 7a; bloque < 6A / < 7A (escalas independientes). «No lo sé» no cuenta.
  function gradeLevel(scale, g) {
    const m = /^(\d)([abcABC]?)/.exec(g || '');
    if (!m) return null;
    const n = +m[1];
    return n < 6 ? 1 : n < 7 ? 2 : 3;
  }
  const SECONDARY_FOCUS = { grado: 'tecnica', fuerza: 'traccion', resistencia: 'resistencia', tecnica: 'tecnica', competicion: 'potencia', forma: 'general' };
  const GOAL_TEXT = { grado: 'mejorar tu grado', fuerza: 'ganar fuerza', resistencia: 'mejorar tu resistencia', tecnica: 'mejorar tu técnica', competicion: 'prepararte para competir', forma: 'mantenerte en forma' };
  const OBJECTIVE = {
    tecnica: 'Técnica', resistencia: 'Resistencia y continuidad', dedos: 'Fuerza de dedos', traccion: 'Fuerza de tracción',
    general: 'Fuerza general', potencia: 'Potencia', piernas: 'Piernas y pies', recuperacion: 'Recuperación', mental: 'Confianza y miedo a caer'
  };
  const HARD_FOCUS = ['dedos', 'traccion', 'potencia', 'general'];            // enfoques que no se proponen en modo suave
  const RECOVERY = { name: 'Sesión suave', slots: [{ cat: 'movilidad', ctx: 'recuperacion', n: 2 }, { cat: 'tecnica', n: 1 }, { cat: 'antagonistas', n: 1 }] };
  const ZONE_NAME = { dedos: 'dedos o poleas', hombros: 'hombros', codos: 'codos', munecas: 'muñecas', espalda: 'espalda', rodillas: 'rodillas' };

  // Qué cargan los ejercicios. Un ejercicio carga una zona si coincide en áreas corporales, patrones de movimiento o material de agarre.
  // La taxonomía del catálogo no tiene «codos» ni «muñecas»: se infiere de lo que las carga (tracción, empuje, agarre, apoyo de manos),
  // siempre del lado conservador.
  const GRIP_EQUIPMENT = ['barra', 'multipresa', 'campus', 'pesas', 'gomas', 'maquinas'];   // todo lo que se agarra con las manos, poleas y máquinas incluidas
  const LOAD_RULES = {
    dedos:    { areas: ['dedos', 'antebrazo'], patterns: [], equipment: GRIP_EQUIPMENT },
    hombros:  { areas: ['hombros'], patterns: ['traccion', 'empuje'], equipment: ['barra', 'multipresa', 'campus'] },
    codos:    { areas: ['antebrazo', 'dedos'], patterns: ['traccion', 'empuje'], equipment: GRIP_EQUIPMENT },
    munecas:  { areas: ['antebrazo', 'dedos'], patterns: ['empuje'], equipment: GRIP_EQUIPMENT, coreIsometric: true },
    espalda:  { areas: ['espalda'], patterns: ['traccion'], equipment: [] },
    rodillas: { areas: ['piernas'], patterns: [], equipment: [] }
  };

  const arr = v => (Array.isArray(v) ? v : []);
  const parseDay = k => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(k || ''); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null; };
  const daysBetween = (a, b) => { const x = parseDay(a), y = parseDay(b); return x == null || y == null ? null : Math.round((y - x) / 86400000); };
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  // ── Limitaciones ────────────────────────────────────────────────────
  function limitZones(limits) { return arr(limits && limits.items).filter(z => LOAD_RULES[z]); }
  const hasOtherLimit = limits => arr(limits && limits.items).includes('otra');

  // true = carga la zona o no se puede descartar
  function loadsZone(zone, ex) {
    const r = LOAD_RULES[zone];
    if (!r) return true;
    const areas = arr(ex.bodyAreas), pats = arr(ex.movementPatterns), req = arr(ex.equipment && ex.equipment.required);
    if (!areas.length && !pats.length) return true;                          // sin datos: no se puede determinar → no es seguro
    if (areas.some(a => r.areas.includes(a)) || pats.some(p => r.patterns.includes(p))) return true;
    if (req.some(e => r.equipment.includes(e))) return true;
    if (r.coreIsometric && areas.includes('core') && pats.includes('isometrico')) return true;
    return false;
  }
  const blockedZones = (ex, zones) => zones.filter(z => loadsZone(z, ex));

  // ── Historial ───────────────────────────────────────────────────────
  function entryRpe(e) {
    if (Number.isFinite(Number(e.rpe)) && Number(e.rpe) > 0) return Number(e.rpe);
    const rp = arr(e.exercises).flatMap(x => arr(x.sets).map(s => Number(s.rpe))).filter(n => n > 0);
    return rp.length ? rp.reduce((a, b) => a + b, 0) / rp.length : null;
  }

  function analyzeHistory(history, catalog, today, X) {
    const real = arr(history).filter(e => e && !e.demo && e.dateKey && daysBetween(e.dateKey, today) != null && daysBetween(e.dateKey, today) >= 0)
      .map(e => {
        const ago = daysBetween(e.dateKey, today);
        const exs = arr(e.exercises).map(x => (x.exerciseId && catalog.byId.get(x.exerciseId)) || catalog.byName.get(X.normalize(String(x.name || '')))).filter(Boolean);
        const rpe = entryRpe(e);
        const heavy = (rpe != null && rpe >= 8) || exsHeavy(exs);
        return { ago, rpe, heavy, exs, name: e.sessionName || '' };
      })
      .sort((a, b) => a.ago - b.ago);
    const last14 = real.filter(e => e.ago <= 13);
    const week = real.filter(e => e.ago <= 6);
    const catCount = {};
    last14.forEach(e => new Set(e.exs.map(x => x.primaryCategoryId)).forEach(c => { catCount[c] = (catCount[c] || 0) + 1; }));
    const recentIds = new Set(real.filter(e => e.ago <= 3).flatMap(e => e.exs.map(x => x.id)));
    const rated = real.slice(0, 3).filter(e => e.rpe != null);
    return {
      count: real.length, last: real[0] || null, week: week.length, catCount, recentIds,
      avgRpe: rated.length >= 3 ? rated.reduce((a, e) => a + e.rpe, 0) / rated.length : null,
      heavyRecently: real.some(e => e.ago <= 1 && e.heavy) || real.filter(e => e.ago <= 2).length >= 2
    };
  }
  const exsHeavy = exs => exs.filter(x => x.physicalDemand >= 3).length >= 2;
  const agoText = n => (n === 0 ? 'hoy' : n === 1 ? 'ayer' : `hace ${n} días`);

  // ── Construcción de una sesión ──────────────────────────────────────
  function buildSession(focus, ctx) {
    const { catalog, X, level, minutes, equipment, modality, hist, zones, cap } = ctx;
    const items = [];
    const picked = new Set();
    const excluded = new Set();
    const eligible = catalog.exercises.filter(ex => {
      if (ex.safety.minLevel > level || ex.technicalLevel > Math.min(3, level + 1) || ex.physicalDemand > cap) return false;
      if (!X.equipmentOk(ex, equipment)) return false;
      if (zones.length && blockedZones(ex, zones).length) { excluded.add(ex.id); return false; }
      return true;
    });
    const score = ex => {
      let s = 0;
      if (modality === 'bloque' || modality === 'deportiva') s += ex.climbingDisciplines.includes(modality) ? 2 : (ex.climbingDisciplines.includes('general') ? 1 : -2);
      else s += ex.climbingDisciplines.includes('bloque') || ex.climbingDisciplines.includes('deportiva') ? 1 : 0;
      s -= Math.abs(ex.technicalLevel - level);
      if (hist.recentIds.has(ex.id)) s -= 3;                                  // no repetir lo hecho hace pocos días
      return s;
    };
    focus.slots.forEach(slot => {
      const pool = eligible.filter(ex => ex.categoryIds.includes(slot.cat) && !picked.has(ex.id) && (!slot.ctx || ex.trainingContexts.includes(slot.ctx)));
      pool.map(ex => ({ ex, s: score(ex) })).sort((a, b) => b.s - a.s || a.ex.id.localeCompare(b.ex.id)).slice(0, slot.n)
        .forEach(({ ex }) => { picked.add(ex.id); const it = X.planItemFromExercise(ex); it._ex = ex; items.push(it); });
    });
    // Ajuste al tiempo: se quitan accesorios del final
    while (items.length > 1 && X.estimateMinutes(items) > minutes) items.pop();
    return { items, excluded: excluded.size };
  }

  // ── Recomendaciones ─────────────────────────────────────────────────
  function recommend(o) {
    const { catalog, X } = o;
    const profile = o.profile || {};
    const limits = o.limits || null;
    const today = o.today;
    const expLevel = LEVEL_OF_EXPERIENCE[profile.experience] || 1;
    const level = expLevel;
    const minutes = Math.min(180, Math.max(20, profile.minutesPerSession || 45));
    const climbDays = profile.daysPerWeek || 3;
    const planned = trainPerWeek(climbDays);
    const practices = arr(o.practices);
    const zones = limitZones(limits);
    const other = hasOtherLimit(limits);
    const hist = analyzeHistory(o.history, catalog, today, X);
    const equipment = o.equipment || [];
    const modality = profile.modality || null;

    const soft = hist.heavyRecently || hist.week >= planned;
    const softWhy = hist.last && hist.last.heavy && hist.last.ago <= 1
      ? `Tu última sesión (${agoText(hist.last.ago)}) fue intensa${hist.last.rpe != null ? ` (RPE ${Math.round(hist.last.rpe)})` : ''}, así que hoy toca recuperar en lugar de encadenar otra sesión exigente`
      : hist.heavyRecently
        ? 'Has entrenado varios días seguidos, así que hoy toca una sesión suave para recuperar'
        : `Esta semana ya llevas ${plural(hist.week, 'sesión', 'sesiones')} de entrenamiento complementario, suficiente para tus ${plural(climbDays, 'día', 'días')} de escalada, así que hoy te proponemos algo suave`;

    const items = [];
    const ctx = { catalog, X, level, minutes, equipment, modality, hist, zones, cap: soft ? 1 : (level === 1 ? 2 : 3) };
    let excludedTotal = 0;

    // — Sesiones físicas —
    const prefs = (PREFERENCE[profile.goalPrimary] || PREFERENCE.forma).slice();
    const sec = arr(profile.goalsSecondary)[0];
    if (sec && SECONDARY_FOCUS[sec] && !prefs.includes(SECONDARY_FOCUS[sec])) prefs.push(SECONDARY_FOCUS[sec]);
    const order = prefs.map((f, i) => ({ f, i })).sort((a, b) => (hist.catCount[a.f] || 0) - (hist.catCount[b.f] || 0) || a.i - b.i).map(x => x.f);

    const candidates = soft ? [{ key: 'recuperacion', focus: RECOVERY }] : order.map(f => ({ key: f, focus: X.FOCUS[f] })).filter(c => c.focus);
    for (const c of candidates) {
      if (items.length >= 2) break;
      // Cada sesión se piensa para una modalidad y entorno concretos, con el grado habitual de esa modalidad y entorno
      const pr = practices.length ? practices[items.length % practices.length] : null;
      const gl = pr ? gradeLevel(pr.scale, pr.usual) : null;
      const sctx = pr ? { ...ctx, level: gl ? Math.min(expLevel, gl) : expLevel, modality: pr.scale === 'boulder' ? 'bloque' : 'deportiva' } : ctx;
      if (pr) sctx.cap = soft ? 1 : (sctx.level === 1 ? 2 : 3);
      const b = buildSession(c.focus, sctx);
      excludedTotal = Math.max(excludedTotal, b.excluded);
      const onFocus = c.key === 'recuperacion' || b.items.some(it => it._ex.categoryIds.includes(c.key));   // al menos un ejercicio del enfoque (no solo calentamiento)
      if (b.items.length < 2 || !onFocus) continue;
      items.push(sessionCard(c, b.items, { ...sctx, practice: pr, profile, limits, zones, other, soft, softWhy, hist, planned, primary: items.length === 0, isSecondary: items.length > 0, climbDays }));
    }

    // — Práctica mental (solo si la evaluación lo indica) —
    const m = mentalCard(o.mental, o.mentalItems, hist);
    if (m) items.push(m);

    let note;
    if (!hist.count) note = 'Aún no tienes sesiones registradas: estas propuestas se basan solo en tu perfil. Mejorarán a medida que registres entrenamientos.';
    else if (hist.avgRpe != null && hist.avgRpe <= 5 && !soft) note = `Tus últimas sesiones han sido cómodas (RPE medio ${hist.avgRpe.toFixed(1)}). Subir la carga es decisión tuya: Krux no lo hace automáticamente.`;
    else note = `Basado en tu perfil y en tus ${plural(hist.count, 'sesión registrada', 'sesiones registradas')}.`;

    let empty = null;
    if (!items.filter(i => i.kind === 'session').length) {
      empty = zones.length && excludedTotal
        ? 'Con tus limitaciones, tu material y tu nivel no hay entrenamientos compatibles que podamos proponerte con seguridad. Puedes revisar el material o las limitaciones en tu perfil.'
        : 'Con tu material y tu nivel no hay entrenamientos compatibles ahora mismo. Puedes revisar el material en tu perfil.';
    }
    return { items, note, empty, context: { level, minutes, planned, climbDays, soft, sessions: hist.count, weekSessions: hist.week } };
  }

  function sessionCard(c, items, k) {
    const { X, catalog, profile, limits, zones, other, soft, softWhy, hist, planned } = k;
    const exs = items.map(it => it._ex);
    const minutes = X.estimateMinutes(items.map(({ _ex, ...rest }) => rest));
    const lvl = Math.max(...exs.map(e => e.technicalLevel));
    const dem = Math.max(...exs.map(e => e.physicalDemand));
    const eqIds = [...new Set(exs.flatMap(e => arr(e.equipment.required)))].filter(id => id !== 'peso-corporal');
    const equipmentNames = eqIds.map(id => (catalog.eqById.get(id) || { name: id }).name.toLowerCase());
    // Prescripción: la del catálogo. En modo suave, una serie menos como máximo (nunca más carga).
    const clean = items.map(({ _ex, ...rest }) => { const it = { ...rest }; if (soft && it.sets > 1) it.sets -= 1; return it; });

    const parts = [];
    const goal = GOAL_TEXT[profile.goalPrimary] || 'entrenar con constancia';
    const done = hist.catCount[c.key] || 0;
    const secMatch = arr(profile.goalsSecondary).find(g => SECONDARY_FOCUS[g] === c.key);
    if (soft) parts.push(softWhy + '.');
    else if (k.primary) {
      parts.push(`Tu objetivo principal es ${goal}: hoy toca ${OBJECTIVE[c.key].toLowerCase()}${!hist.count ? ', un buen punto de partida' : done ? `, que has trabajado ${plural(done, 'vez', 'veces')} en las últimas dos semanas` : ', que no aparece en tus sesiones de las últimas dos semanas'}.`);
    } else {
      parts.push(secMatch ? `Marcaste ${GOAL_TEXT[secMatch]} como objetivo secundario y ${OBJECTIVE[c.key].toLowerCase()} es la forma de trabajarlo.` : `Complementa tu objetivo (${goal}) con ${OBJECTIVE[c.key].toLowerCase()}${done ? ` (${plural(done, 'vez', 'veces')} en las últimas dos semanas)` : ''}.`);
    }
    if (k.practice) parts.push(`Orientado a tu escalada: ${k.practice.label.toLowerCase()}${k.practice.usual && k.practice.usual !== 'unknown' ? ` (tu grado habitual allí: ${k.practice.usual})` : ''}.`);
    parts.push(`Dura unos ${minutes} min, dentro de tus ${profile.minutesPerSession || 45}${equipmentNames.length ? `, y usa ${equipmentNames.join(' y ')}` : ' y no necesita material'}.`);

    const safety = safetyNote(limits, zones, other);
    return {
      kind: 'session', id: 'rec-' + c.key, focus: c.key, title: soft ? 'Sesión suave de recuperación' : c.focus.name,
      objective: OBJECTIVE[c.key], minutes, level: X.LEVEL_LABELS[lvl], demand: X.DEMAND_LABELS[dem],
      equipment: equipmentNames, reason: parts.join(' '), safety, soft, practice: k.practice ? k.practice.key : null,
      session: { name: soft ? 'Sesión suave' : c.focus.name, exercises: clean }
    };
  }

  function safetyNote(limits, zones, other) {
    if (other) return { state: 'unverified', text: `Indicaste otra limitación${limits.other ? ` («${limits.other}»)` : ''}: no podemos comprobar si estos ejercicios la cargan. ${zones.length ? `Sí hemos excluido los que cargan ${zones.map(z => ZONE_NAME[z]).join(', ')}. ` : ''}Si tienes dudas, consúltalo con un profesional.` };
    if (zones.length) return { state: 'filtered', text: `Excluye los ejercicios que cargan ${zones.map(z => ZONE_NAME[z]).join(', ')}, según lo que indicaste. Es orientación deportiva, no médica.` };
    if (limits && limits.none) return { state: 'declared', text: 'Indicaste que no tienes limitaciones. Escucha a tu cuerpo: es orientación deportiva, no médica.' };
    return { state: 'unknown', text: 'No has indicado limitaciones, así que no hemos podido filtrar por ellas. Puedes añadirlas en tu perfil.' };
  }

  function mentalCard(mental, items, hist) {
    const a = (mental && mental.answers) || {};
    const byId = id => arr(items).find(i => i.id === id);
    let pick = null, why = '';
    if (Number.isInteger(a.fear) && a.fear >= 4 && byId('m05-respiracion-ante-el-miedo')) { pick = byId('m05-respiracion-ante-el-miedo'); why = `En la evaluación mental indicaste que caerte te preocupa bastante (${a.fear} de 5). Esta práctica de respiración sirve para gestionarlo antes de escalar.`; }
    else if (Number.isInteger(a.confidence) && a.confidence <= 2 && byId('p01-inventario-de-fortalezas')) { pick = byId('p01-inventario-de-fortalezas'); why = `En la evaluación mental indicaste poca confianza ante vías difíciles (${a.confidence} de 5). Este ejercicio te ayuda a apoyarte en lo que ya haces bien.`; }
    if (!pick) return null;
    return {
      kind: 'mental', id: 'rec-mental', mentalId: pick.id, title: pick.title, objective: OBJECTIVE.mental, minutes: pick.minutes,
      level: 'Suave', demand: 'Sin carga física', equipment: [], reason: why,
      safety: { state: 'mental', text: 'Práctica de entrenamiento mental: no sustituye apoyo psicológico profesional.' }
    };
  }

  return { LEVEL_OF_EXPERIENCE, PREFERENCE, trainPerWeek, gradeLevel, LOAD_RULES, OBJECTIVE, loadsZone, blockedZones, analyzeHistory, recommend };
}));

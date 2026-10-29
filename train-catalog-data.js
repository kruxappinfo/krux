// ================== ENTRENA — CATÁLOGO BASE DE EJERCICIOS ==================
// Datos empaquetados (funcionan sin conexión). Esquema documentado en train-exercises.js.
// Para añadir un ejercicio basta una entrada nueva en EXERCISES: la interfaz lee el catálogo.
//
// Contenido orientativo de carácter general. Todas las fichas están marcadas como
// «pendiente de revisión»: hasta que las revise una persona cualificada
// (review.status = 'reviewed' con reviewedBy y reviewedAt) la app lo indica.
// No contiene vídeos ni imágenes: media.items queda vacío hasta disponer de recursos propios o con licencia.
(function (root) {
  'use strict';

  const CATEGORIES = [
    { id: 'dedos', order: 1, name: 'Dedos y agarre', icon: 'finger', description: 'Fuerza y resistencia de los dedos y el antebrazo.' },
    { id: 'traccion', order: 2, name: 'Fuerza de tracción', icon: 'pull', description: 'Espalda, brazos y hombros al tirar.' },
    { id: 'potencia', order: 3, name: 'Potencia y explosividad', icon: 'bolt', description: 'Fuerza aplicada con rapidez.' },
    { id: 'resistencia', order: 4, name: 'Resistencia específica', icon: 'wave', description: 'Aguantar escalando durante más tiempo.' },
    { id: 'piernas', order: 5, name: 'Piernas y trabajo de pies', icon: 'foot', description: 'Fuerza de piernas y precisión al pisar.' },
    { id: 'core', order: 6, name: 'Core y tensión corporal', icon: 'core', description: 'Tronco estable para transmitir fuerza.' },
    { id: 'tecnica', order: 7, name: 'Técnica y coordinación', icon: 'route', description: 'Mover mejor con menos esfuerzo.' },
    { id: 'antagonistas', order: 8, name: 'Antagonistas, hombros y prevención', icon: 'shield', description: 'Equilibrio muscular y salud articular.' },
    { id: 'movilidad', order: 9, name: 'Movilidad, calentamiento y recuperación', icon: 'flow', description: 'Preparar el cuerpo y recuperarlo.' },
    { id: 'general', order: 10, name: 'Fuerza general y acondicionamiento', icon: 'dumbbell', description: 'Base de fuerza y forma física.' }
  ];

  const EQUIPMENT = [
    { id: 'rocodromo', name: 'Rocódromo o pared', short: 'Pared' },
    { id: 'multipresa', name: 'Multipresa o regletas', short: 'Multipresa' },
    { id: 'campus', name: 'Campus board', short: 'Campus' },
    { id: 'barra', name: 'Barra de dominadas', short: 'Barra' },
    { id: 'gomas', name: 'Gomas elásticas', short: 'Gomas' },
    { id: 'pesas', name: 'Pesas y mancuernas', short: 'Pesas' },
    { id: 'maquinas', name: 'Máquinas y poleas', short: 'Máquinas' },
    { id: 'peso-corporal', name: 'Peso corporal', short: 'Sin material' }
  ];

  // ── Perfiles de prescripción ───────────────────────────────────────
  // [param, valor inicial, mínimo, máximo, paso, etiqueta]  (omitidos = límites del modelo)
  const P = (param, def, min, max, step, label) => {
    const o = { param, default: def };
    if (min != null) o.min = min;
    if (max != null) o.max = max;
    if (step != null) o.step = step;
    if (label) o.label = label;
    return o;
  };
  const RX = {
    hold: (sets, sec, rest, rpe, extra) => [P('sets', sets, 1, 10), P('holdDurationSeconds', sec, 3, 60, 1), P('restDurationSeconds', rest, 30, 300, 15), P('externalLoadKg', 0, 0, 80, 0.5)].concat(extra || [], [P('rpeTarget', rpe, 0, 10, 1)]),
    reps: (sets, reps, rest, rpe, extra) => [P('sets', sets, 1, 8), P('repetitions', reps, 1, 30), P('restDurationSeconds', rest, 30, 300, 15), P('externalLoadKg', 0, 0, 100, 0.5)].concat(extra || [], [P('rpeTarget', rpe, 0, 10, 1)]),
    bodyReps: (sets, reps, rest, rpe, extra) => [P('sets', sets, 1, 8), P('repetitions', reps, 1, 40), P('restDurationSeconds', rest, 15, 240), P('rpeTarget', rpe, 0, 10, 1)].concat(extra || []),
    timed: (sets, sec, rest, rpe) => [P('sets', sets, 1, 8), P('workDurationSeconds', sec, 10, 600, 5), P('restDurationSeconds', rest, 15, 240, 5), P('rpeTarget', rpe, 0, 10, 1)],
    endurance: (sets, sec, rest, rpe) => [P('sets', sets, 1, 6), P('workDurationSeconds', sec, 300, 3600, 60), P('restDurationSeconds', rest, 0, 600, 30), P('rpeTarget', rpe, 0, 10, 1)],
    attempts: (sets, att, rest, rpe) => [P('sets', sets, 1, 10), P('attempts', att, 1, 10, 1), P('restDurationSeconds', rest, 60, 600, 15), P('rpeTarget', rpe, 0, 10, 1)],
    mobility: (sets, sec, rest) => [P('sets', sets, 1, 4), P('workDurationSeconds', sec, 15, 120, 5), P('restDurationSeconds', rest, 0, 60, 5)]
  };

  const EXERCISES = [];
  // Constructor compacto → ficha completa del esquema
  function ex(id, name, cat, o) {
    const rel = (list) => (list || []).map((r, i) => ({ exerciseId: r[0], reason: r[1], order: i + 1 }));
    const r = o.rel || {};
    EXERCISES.push({
      id, slug: id, name, aliases: o.al || [], shortDescription: o.desc, purpose: o.purpose,
      primaryCategoryId: cat, categoryIds: [cat].concat(o.cats || []), status: 'published',
      schemaVersion: 1, contentVersion: 1,
      abilities: o.ab, bodyAreas: o.body, movementPatterns: o.pat, climbingDisciplines: o.disc || ['general'],
      trainingContexts: o.ctx, technicalLevel: o.tl, physicalDemand: o.pd, durationMin: o.min,
      instructions: {
        setup: o.setup,
        executionSteps: o.steps.map((s, i) => ({ order: i + 1, title: s[0], description: s[1] })),
        breathing: o.br || '',
        keyCues: o.cues || [],
        commonMistakes: (o.mis || []).map(m => ({ name: m[0], correction: m[1] })),
        completionCriteria: o.done || [],
        stopCriteria: o.stop || [],
        coachingNotes: o.notes || ''
      },
      media: { primaryMediaId: null, items: [] },
      equipment: { required: o.eq || [], optional: o.eqo || [], alternatives: o.eqa || [], setupNotes: o.eqn || '' },
      prescriptionSchema: o.rx,
      relations: {
        variants: rel(r.var), regressions: rel(r.reg), progressions: rel(r.prog),
        alternatives: rel(r.alt), prerequisites: rel(r.pre), relatedExercises: rel(r.rel)
      },
      safety: {
        warnings: o.warn || [], stopCriteria: o.stop || [], prerequisites: o.prereq || [],
        supervisionRequired: !!o.sup, sourceReferences: [], minLevel: o.minLevel || 1
      },
      review: { status: 'pending', reviewedBy: null, reviewedAt: null, notes: '' }
    });
  }

  const DOLOR = 'Dolor agudo, punzante o que aumenta durante el ejercicio.';
  const DEDO_WARN = 'Los ejercicios de dedos cargan poleas y tendones: sube la intensidad poco a poco y descansa entre sesiones intensas.';

  // ═══ 1. DEDOS Y AGARRE ═══
  ex('suspension-pasiva', 'Suspensión pasiva en agarre amplio', 'dedos', {
    al: ['colgarse de la barra', 'suspensión pasiva', 'hang pasivo'],
    desc: 'Colgarte con los brazos estirados para acostumbrar dedos, antebrazos y hombros.',
    purpose: 'Introducir la carga sobre los dedos y los hombros con una intensidad baja y controlada.',
    ab: ['fuerza-maxima', 'resistencia'], body: ['dedos', 'antebrazo', 'hombros'], pat: ['isometrico', 'traccion'], ctx: ['principal', 'accesorio'],
    tl: 1, pd: 1, min: 8, eq: ['barra'], eqa: ['multipresa'],
    setup: 'Barra a una altura que permita colgarte sin tocar el suelo con los pies. Agarre amplio y cómodo.',
    steps: [['Agarra la barra', 'Manos algo más separadas que los hombros, pulgares rodeando la barra.'], ['Cuélgate', 'Deja que el peso del cuerpo estire los brazos, con los hombros activos y no encogidos hacia las orejas.'], ['Mantén y baja', 'Aguanta el tiempo marcado y baja los pies al suelo con control.']],
    br: 'Respira con normalidad; no aguantes el aire.',
    cues: ['Hombros alejados de las orejas', 'Cuerpo quieto, sin balanceo'],
    mis: [['Hombros encogidos', 'Empuja ligeramente la barra hacia arriba con los hombros hasta sentir la espalda activa.'], ['Soltarse de golpe', 'Termina la serie antes de que el agarre falle del todo.']],
    done: ['Brazos estirados', 'Tiempo completado sin balanceo'],
    stop: [DOLOR, 'Hormigueo o pérdida de fuerza en los brazos.', 'Dolor en el hombro.'],
    rx: RX.hold(3, 15, 90, 5),
    rel: { prog: [['suspension-regleta', 'Cuando la pasiva te resulte cómoda, pasa a un agarre más pequeño.']], alt: [['suspension-asistida', 'Si te cuesta aguantar el tiempo, reduce el peso con una goma.']], rel: [['trabajo-escapular', 'Mejora el control de los hombros colgado.']] },
    warn: ['Si tienes molestias en hombros o codos, consúltalo antes de colgarte.']
  });
  ex('suspension-regleta', 'Suspensión en regleta', 'dedos', {
    al: ['suspensiones en regleta', 'hang en regleta', 'colgarse de regleta', 'canto', 'crimp'],
    desc: 'Suspensión con los dedos sobre un canto en lugar de una barra.',
    purpose: 'Desarrollar la fuerza de los dedos con un agarre cercano al de la escalada.',
    ab: ['fuerza-maxima'], body: ['dedos', 'antebrazo'], pat: ['isometrico'], disc: ['bloque', 'deportiva'], ctx: ['principal'],
    tl: 2, pd: 2, min: 12, eq: ['multipresa'], eqn: 'Empieza con cantos profundos (≥20 mm) y avanza a otros más pequeños con el tiempo.',
    setup: 'Regleta fija, estable y a una altura que permita colgarte sin apoyar los pies.',
    steps: [['Coloca los dedos', 'Dedos sobre el canto, pulgar sin cruzarse por encima, muñecas neutras.'], ['Cuélgate sin saltar', 'Eleva los pies suavemente o pasa de un apoyo asistido a la suspensión completa.'], ['Aguanta con hombros activos', 'Mantén el tiempo marcado con los hombros estables.'], ['Suelta con control', 'Apoya los pies antes de que el agarre ceda.']],
    br: 'Respiración constante, sin bloquear.',
    cues: ['Dedos relajados pero firmes', 'Hombros activos'],
    mis: [['Colgarse de golpe', 'Carga de forma gradual: primero con los pies apoyados.'], ['Muñecas dobladas', 'Alinea antebrazo y mano.']],
    done: ['Tiempo completado con la técnica estable', 'Sin dolor en los dedos'],
    stop: [DOLOR, 'Dolor en las articulaciones o poleas de los dedos.'],
    rx: RX.hold(4, 10, 120, 7),
    rel: { reg: [['suspension-pasiva', 'Agarre más amplio y menos exigente.'], ['suspension-asistida', 'Reduce la carga con una goma.']], prog: [['max-hang', 'Trabajo de fuerza máxima con más carga.'], ['repeaters', 'Mayor volumen con intervalos.']] },
    warn: [DEDO_WARN], minLevel: 2
  });
  ex('max-hang', 'Max hang', 'dedos', {
    al: ['max hangs', 'suspensión máxima', 'hang máximo', 'colgarse al máximo', 'max hang media llave'],
    desc: 'Suspensiones cortas con carga alta para trabajar la fuerza máxima de dedos.',
    purpose: 'Aumentar la fuerza máxima de los dedos con series cortas y descansos largos.',
    ab: ['fuerza-maxima'], body: ['dedos', 'antebrazo'], pat: ['isometrico'], disc: ['bloque', 'deportiva', 'competicion'], ctx: ['principal'],
    tl: 2, pd: 3, min: 20, eq: ['multipresa'], eqo: ['pesas'], eqn: 'La carga se añade con un cinturón de lastre o se reduce con una goma.',
    setup: 'Calentamiento previo completo. Regleta de tamaño conocido. Controla el tiempo de cada suspensión.',
    steps: [['Prepara la carga', 'Ajusta lastre o asistencia para que la suspensión sea exigente pero técnicamente limpia.'], ['Cuélgate con control', 'Agarre fijo, hombros activos y cuerpo estable.'], ['Aguanta el tiempo marcado', 'Mantén la posición sin balanceo hasta completar el tiempo.'], ['Descansa por completo', 'Respeta el descanso largo: es parte del trabajo.']],
    br: 'Respira con calma; no contengas el aire.',
    cues: ['Calidad antes que carga', 'Termina con margen, no hasta el fallo'],
    mis: [['Subir la carga demasiado deprisa', 'Aumenta poco a poco y solo si la técnica se mantiene.'], ['Descansos cortos', 'Espera el tiempo recomendado entre series.'], ['Entrenar con los dedos cansados', 'Hazlo al principio de la sesión, con el cuerpo descansado.']],
    done: ['Todas las series con la técnica estable', 'Sin dolor articular'],
    stop: [DOLOR, 'Dolor en la polea o en una articulación del dedo.', 'La técnica se rompe: baja la carga o termina.'],
    rx: RX.hold(5, 10, 180, 8),
    rel: { reg: [['suspension-regleta', 'Misma idea con menos carga.'], ['suspension-asistida', 'Con goma para ir más ligero.']], prog: [['suspension-lastrada', 'Mayor carga externa.']], alt: [['repeaters', 'Más volumen y menos intensidad por serie.']], pre: [['suspension-regleta', 'Domina antes la suspensión sin carga adicional.']] },
    warn: [DEDO_WARN, 'No lo hagas en días consecutivos.'], prereq: ['Experiencia previa con suspensiones en regleta.'], minLevel: 2
  });
  ex('repeaters', 'Repeaters', 'dedos', {
    al: ['repeaters en regleta', 'suspensiones repetidas', 'hangs repetidos'],
    desc: 'Series de suspensiones cortas con pausas muy breves, repetidas varias veces.',
    purpose: 'Acumular volumen de trabajo de dedos con una intensidad moderada.',
    ab: ['fuerza-maxima', 'resistencia'], body: ['dedos', 'antebrazo'], pat: ['isometrico'], disc: ['bloque', 'deportiva'], ctx: ['principal'],
    tl: 2, pd: 3, min: 20, eq: ['multipresa'],
    setup: 'Calentamiento previo. Regleta cómoda y un temporizador de intervalos.',
    steps: [['Cuélgate', 'Agarre estable con hombros activos.'], ['Aguanta el intervalo de trabajo', 'Mantén la suspensión el tiempo marcado.'], ['Pausa breve', 'Apoya los pies o descuelga unos segundos y repite.'], ['Completa la serie', 'Haz todas las repeticiones y descansa por completo antes de la siguiente serie.']],
    br: 'Respiración constante.', cues: ['Misma técnica de la primera a la última repetición'],
    mis: [['Elegir un agarre demasiado difícil', 'Escoge uno con el que puedas completar todas las repeticiones.']],
    done: ['Serie completa sin perder la técnica'],
    stop: [DOLOR, 'Pérdida de control del agarre.'],
    rx: RX.hold(3, 7, 180, 7, [P('repetitions', 6, 2, 10, 1, 'Repeticiones por serie')]),
    rel: { reg: [['suspension-regleta', 'Menos volumen y más sencillo.']], alt: [['max-hang', 'Más intensidad con menos volumen.']] },
    warn: [DEDO_WARN], minLevel: 2
  });
  ex('suspension-asistida', 'Suspensión asistida con goma', 'dedos', {
    al: ['hang asistido', 'suspensión con goma', 'colgarse con goma'],
    desc: 'Suspensión con una goma que reduce el peso que soportan los dedos.',
    purpose: 'Trabajar el agarre con una carga ajustable y más baja.',
    ab: ['fuerza-maxima'], body: ['dedos', 'antebrazo'], pat: ['isometrico'], ctx: ['principal', 'accesorio'],
    tl: 1, pd: 2, min: 12, eq: ['gomas', 'barra'], eqa: ['multipresa'],
    setup: 'Goma resistente anclada en un punto alto y estable, con un lazo donde apoyar el pie o la rodilla.',
    steps: [['Apoya en la goma', 'Pie o rodilla en el lazo; manos en el agarre.'], ['Suelta peso a la goma', 'Cuélgate dejando que la goma soporte parte del cuerpo.'], ['Aguanta', 'Mantén el tiempo marcado con los hombros activos.'], ['Baja con control', 'Apoya los pies antes de soltar el agarre.']],
    cues: ['Más goma = menos carga'], mis: [['Anclaje poco fiable', 'Comprueba el anclaje antes de cada serie.']],
    done: ['Tiempo completado con el agarre firme'],
    stop: [DOLOR, 'La goma o el anclaje parecen dañados.'],
    rx: RX.hold(3, 10, 120, 6, [P('assistanceKg', 10, 0, 40, 0.5)]),
    rel: { prog: [['suspension-regleta', 'Retira la goma y cuélgate con tu peso.']], alt: [['suspension-pasiva', 'Sin goma, con agarre amplio.']] }
  });
  ex('suspension-lastrada', 'Suspensión con lastre', 'dedos', {
    al: ['hang lastrado', 'suspensión lastrada', 'colgarse con peso'],
    desc: 'Suspensión en regleta añadiendo peso al cuerpo.',
    purpose: 'Seguir aumentando la carga de dedos cuando el peso corporal ya no es suficiente.',
    ab: ['fuerza-maxima'], body: ['dedos', 'antebrazo'], pat: ['isometrico'], disc: ['bloque', 'deportiva', 'competicion'], ctx: ['principal'],
    tl: 3, pd: 3, min: 20, eq: ['multipresa', 'pesas'],
    setup: 'Cinturón de lastre bien ajustado. Calentamiento previo. Superficie libre bajo los pies.',
    steps: [['Ajusta el lastre', 'Añade el peso en pasos pequeños.'], ['Cuélgate', 'Hombros activos y agarre firme.'], ['Aguanta', 'Mantén el tiempo marcado sin balanceo.'], ['Baja y descansa', 'Descuelga con control y descansa por completo.']],
    cues: ['Aumenta el lastre en pasos pequeños'], mis: [['Saltar con el lastre puesto', 'Apoya los pies para colgarte y para soltarte.']],
    done: ['Series completas con la técnica estable'],
    stop: [DOLOR, 'Pérdida de control del agarre.'],
    rx: RX.hold(5, 10, 180, 8),
    rel: { reg: [['max-hang', 'Versión con menos carga.']], pre: [['max-hang', 'Trabaja antes con peso corporal o asistencia.']] },
    warn: [DEDO_WARN], prereq: ['Experiencia previa con max hangs.'], minLevel: 3
  });
  ex('agarres-especificos', 'Entrenamiento de agarres específicos', 'dedos', {
    al: ['agarres específicos', 'pinza', 'bolsillos', 'tipos de agarre', 'agarre en pinza'],
    desc: 'Trabajo de agarres distintos: pinza, bolsillos, regleta abierta o cerrada.',
    purpose: 'Preparar los dedos para los tipos de presa que aparecen en las vías.',
    ab: ['fuerza-maxima', 'coordinacion'], body: ['dedos', 'antebrazo'], pat: ['isometrico'], disc: ['bloque', 'deportiva'], ctx: ['accesorio', 'principal'],
    tl: 2, pd: 2, min: 15, eq: ['multipresa'],
    setup: 'Multipresa con distintos tipos de agarre. Empieza con los que te resulten más cómodos.',
    steps: [['Elige el agarre', 'Selecciona uno por serie y mantén los hombros activos.'], ['Cuélgate con apoyo', 'Cárgalo de forma gradual, con los pies en el suelo si lo necesitas.'], ['Aguanta', 'Mantén el tiempo marcado.'], ['Cambia de agarre', 'Descansa y pasa al siguiente.']],
    mis: [['Agarres demasiado pequeños', 'Elige agarres con los que puedas mantener la técnica.']],
    done: ['Todos los agarres trabajados con técnica estable'],
    stop: [DOLOR, 'Molestia en una articulación concreta del dedo.'],
    rx: RX.hold(3, 7, 120, 6),
    rel: { reg: [['suspension-pasiva', 'Agarre amplio y más seguro.']], alt: [['suspension-regleta', 'Un único tipo de agarre.']] },
    warn: [DEDO_WARN], minLevel: 2
  });
  ex('block-pull', 'Block pull', 'dedos', {
    al: ['block pull · máx', 'block pull', 'tirón de bloque', 'bloque con peso'],
    desc: 'Tirar con los dedos de un bloque cargado de peso sin levantar el cuerpo.',
    purpose: 'Trabajar la fuerza máxima de dedos con una carga externa muy precisa.',
    ab: ['fuerza-maxima'], body: ['dedos', 'antebrazo', 'espalda'], pat: ['isometrico', 'traccion'], disc: ['bloque', 'competicion'], ctx: ['principal'],
    tl: 3, pd: 3, min: 20, eq: ['multipresa', 'pesas'],
    setup: 'Bloque o canto con una cuerda y un sistema de carga estable. Calentamiento completo.',
    steps: [['Prepara la carga', 'Fija el peso y comprueba el sistema.'], ['Agarra el bloque', 'Dedos sobre el canto, espalda neutra.'], ['Tira con control', 'Eleva el peso de forma progresiva, sin tirones.'], ['Suelta con control', 'Baja el peso y descansa.']],
    mis: [['Tirones bruscos', 'Aplica la fuerza de forma progresiva.']],
    done: ['Series completas con la técnica estable'],
    stop: [DOLOR, 'Molestias en la espalda baja.'],
    rx: RX.hold(4, 7, 180, 8),
    rel: { reg: [['max-hang', 'Suspensión con peso corporal.']] },
    warn: [DEDO_WARN], prereq: ['Experiencia previa con trabajo intenso de dedos.'], sup: false, minLevel: 3
  });

  // ═══ 2. FUERZA DE TRACCIÓN ═══
  ex('dominada-estricta', 'Dominada estricta', 'traccion', {
    al: ['dominadas', 'dominadas estrictas', 'pull up', 'pull-up'],
    desc: 'Subir el cuerpo hasta pasar la barbilla de la barra, sin impulso.',
    purpose: 'Desarrollar fuerza de tracción de espalda y brazos.',
    ab: ['fuerza-maxima'], body: ['espalda', 'hombros'], pat: ['traccion'], ctx: ['principal'],
    tl: 1, pd: 2, min: 12, eq: ['barra'],
    setup: 'Barra estable. Agarre algo más ancho que los hombros, palmas hacia delante.',
    steps: [['Cuélgate con hombros activos', 'Brazos estirados y escápulas ligeramente bajas.'], ['Sube', 'Lleva el pecho hacia la barra tirando con codos y espalda.'], ['Pasa la barbilla', 'Sin balanceo ni impulso de piernas.'], ['Baja con control', 'Vuelve a la posición inicial con los brazos estirados.']],
    br: 'Expulsa el aire al subir y toma aire al bajar.',
    cues: ['Codos hacia el suelo', 'Cuerpo en bloque'],
    mis: [['Balancearse', 'Contrae el core y mantén el cuerpo recto.'], ['Recorrido incompleto', 'Baja hasta estirar los brazos y sube hasta pasar la barbilla.']],
    done: ['Barbilla sobre la barra', 'Brazos estirados abajo'],
    stop: [DOLOR, 'Dolor en el codo o en el hombro.'],
    rx: RX.reps(4, 5, 150, 7),
    rel: { reg: [['dominada-asistida', 'Con goma o apoyo.'], ['remo-invertido', 'Tracción horizontal más sencilla.']], prog: [['dominada-lastrada', 'Añade peso.'], ['dominada-explosiva', 'Tracción con velocidad.']], alt: [['jalon-polea', 'Movimiento similar en máquina.']] },
    warn: ['Si notas molestias en el codo, reduce el volumen y consulta con un profesional.']
  });
  ex('dominada-lastrada', 'Dominada lastrada', 'traccion', {
    al: ['dominadas lastradas', 'dominada con peso', 'weighted pull up', 'weighted pullup'],
    desc: 'Dominada añadiendo peso al cuerpo.',
    purpose: 'Seguir progresando en fuerza de tracción cuando la dominada con peso corporal ya es cómoda.',
    ab: ['fuerza-maxima'], body: ['espalda', 'hombros'], pat: ['traccion'], ctx: ['principal'],
    tl: 2, pd: 3, min: 15, eq: ['barra', 'pesas'],
    setup: 'Cinturón de lastre o mochila bien sujeta. Calentamiento previo.',
    steps: [['Ajusta el lastre', 'Empieza con poco peso y sube de forma gradual.'], ['Cuélgate con hombros activos', 'Sin balanceo.'], ['Sube con control', 'Barbilla sobre la barra sin impulso.'], ['Baja completo', 'Hasta estirar los brazos.']],
    mis: [['Demasiado peso', 'Si pierdes recorrido o técnica, reduce el lastre.']],
    done: ['Recorrido completo en todas las repeticiones'],
    stop: [DOLOR, 'Dolor en codos u hombros.'],
    rx: RX.reps(4, 4, 180, 8),
    rel: { reg: [['dominada-estricta', 'Sin peso adicional.']], pre: [['dominada-estricta', 'Domina antes varias dominadas con peso corporal.']] },
    warn: ['Aumenta el peso poco a poco.'], prereq: ['Varias dominadas estrictas con buena técnica.'], minLevel: 2
  });
  ex('dominada-asistida', 'Dominada asistida', 'traccion', {
    al: ['dominadas asistidas', 'dominada con goma', 'dominada asistida con goma'],
    desc: 'Dominada con ayuda de una goma o una máquina que reduce el peso a levantar.',
    purpose: 'Aprender el movimiento y ganar fuerza hasta poder hacer dominadas con tu peso.',
    ab: ['fuerza-maxima'], body: ['espalda', 'hombros'], pat: ['traccion'], ctx: ['principal', 'accesorio'],
    tl: 1, pd: 1, min: 10, eq: ['barra', 'gomas'], eqa: ['maquinas'],
    setup: 'Goma resistente en la barra, con el pie o la rodilla en el lazo. También se puede usar una máquina asistida.',
    steps: [['Colócate en la goma', 'Pie o rodilla en el lazo y manos en la barra.'], ['Sube', 'Tira con los codos hacia el suelo hasta pasar la barbilla.'], ['Baja con control', 'Hasta estirar los brazos.']],
    mis: [['Rebotar con la goma', 'Controla la bajada.']],
    done: ['Recorrido completo'], stop: [DOLOR],
    rx: RX.reps(3, 6, 120, 6, [P('assistanceKg', 15, 0, 60, 0.5)]),
    rel: { prog: [['dominada-estricta', 'Reduce la asistencia hasta quitarla.']], alt: [['remo-invertido', 'Tracción horizontal.']] }
  });
  ex('bloqueo-isometrico', 'Bloqueo isométrico', 'traccion', {
    al: ['lock off', 'lock-off', 'bloqueos isométricos', 'bloqueo de brazo'],
    desc: 'Mantener el cuerpo en una posición fija con el brazo flexionado.',
    purpose: 'Ganar fuerza para sostener posiciones de bloqueo en pared.',
    ab: ['fuerza-maxima', 'control-corporal'], body: ['espalda', 'hombros'], pat: ['isometrico', 'traccion'], disc: ['bloque', 'deportiva'], ctx: ['principal', 'accesorio'],
    tl: 2, pd: 2, min: 10, eq: ['barra'], eqa: ['multipresa'],
    setup: 'Barra estable y espacio libre para subir y bajar.',
    steps: [['Sube a la posición', 'Lleva la barbilla sobre la barra o el codo a 90°.'], ['Mantén', 'Aguanta la posición sin balanceo.'], ['Baja con control', 'Hasta estirar los brazos.']],
    mis: [['Encoger los hombros', 'Mantén las escápulas activas.']],
    done: ['Posición mantenida el tiempo marcado'], stop: [DOLOR, 'Dolor en el codo.'],
    rx: RX.hold(3, 5, 120, 7),
    rel: { reg: [['dominada-asistida', 'Con asistencia.']], prog: [['dominada-lastrada', 'Con peso.']] }, minLevel: 1
  });
  ex('remo-invertido', 'Remo invertido', 'traccion', {
    al: ['remo horizontal', 'remo en barra baja', 'inverted row'],
    desc: 'Tracción horizontal tumbado bajo una barra baja.',
    purpose: 'Construir fuerza de espalda con un movimiento más accesible que la dominada.',
    ab: ['fuerza-maxima'], body: ['espalda', 'hombros'], pat: ['traccion'], ctx: ['principal', 'accesorio'],
    tl: 1, pd: 1, min: 10, eq: ['barra'], eqa: ['maquinas'],
    setup: 'Barra a la altura de la cadera. Cuerpo recto bajo la barra.',
    steps: [['Colócate bajo la barra', 'Agarre algo más ancho que los hombros, cuerpo recto.'], ['Tira', 'Lleva el pecho hacia la barra juntando las escápulas.'], ['Baja con control', 'Hasta estirar los brazos.']],
    mis: [['Caderas caídas', 'Aprieta glúteos y abdomen.']],
    done: ['Pecho cerca de la barra con el cuerpo recto'], stop: [DOLOR],
    rx: RX.reps(3, 8, 90, 6),
    rel: { prog: [['dominada-asistida', 'Tracción vertical asistida.']], alt: [['jalon-polea', 'Movimiento similar en máquina.']] }
  });
  ex('jalon-polea', 'Jalón en polea', 'traccion', {
    al: ['jalones', 'jalón al pecho', 'lat pulldown'],
    desc: 'Tirar de una barra desde arriba hacia el pecho en una máquina de poleas.',
    purpose: 'Trabajar la tracción vertical con una carga fácil de regular.',
    ab: ['fuerza-maxima'], body: ['espalda', 'hombros'], pat: ['traccion'], ctx: ['principal', 'accesorio'],
    tl: 1, pd: 1, min: 10, eq: ['maquinas'],
    setup: 'Ajusta el asiento para que los muslos queden fijos bajo el apoyo.',
    steps: [['Agarra la barra', 'Algo más ancho que los hombros.'], ['Tira hacia el pecho', 'Lleva los codos hacia abajo y atrás.'], ['Vuelve con control', 'Sin dejar que el peso tire de ti.']],
    mis: [['Echarse hacia atrás', 'Mantén el tronco casi vertical.']],
    done: ['Recorrido completo y controlado'], stop: [DOLOR],
    rx: RX.reps(3, 10, 90, 6),
    rel: { prog: [['dominada-asistida', 'Con tu peso corporal.']] }
  });
  ex('pullover-isometrico', 'Pullover isométrico', 'traccion', {
    al: ['pullover isométrico', 'pullover'],
    desc: 'Mantener una posición de pullover con tensión continua en dorsales y hombros.',
    purpose: 'Reforzar la zona dorsal y del hombro de forma controlada.',
    ab: ['fuerza-maxima', 'control-corporal'], body: ['espalda', 'hombros', 'core'], pat: ['isometrico', 'traccion'], ctx: ['accesorio'],
    tl: 1, pd: 1, min: 8, eq: ['gomas'], eqa: ['maquinas', 'pesas'],
    setup: 'Goma anclada en un punto alto o una polea. Postura estable.',
    steps: [['Colócate', 'Brazos extendidos agarrando la goma o la polea.'], ['Tira hacia abajo', 'Con los brazos casi estirados, lleva la resistencia hacia las caderas.'], ['Mantén', 'Aguanta la tensión el tiempo marcado.'], ['Vuelve con control', 'Sin perder la posición del tronco.']],
    mis: [['Arquear la espalda', 'Mantén el abdomen firme.']],
    done: ['Tensión mantenida sin compensar con el tronco'], stop: [DOLOR, 'Dolor en el hombro.'],
    rx: RX.hold(3, 7, 90, 6),
    rel: { rel: [['trabajo-escapular', 'Control de las escápulas.']] }
  });

  // ═══ 3. POTENCIA Y EXPLOSIVIDAD ═══
  ex('campus-board', 'Campus board', 'potencia', {
    al: ['campus board · 1-5-9', 'campus 1-5-9', 'campuseo', 'campusing', 'campus'],
    desc: 'Subir por peldaños con las manos y sin apoyo de pies para trabajar potencia de dedos y brazos.',
    purpose: 'Mejorar la capacidad de generar fuerza con rapidez en los dedos y los brazos.',
    ab: ['potencia'], body: ['dedos', 'antebrazo', 'espalda', 'hombros'], pat: ['dinamico', 'traccion'], disc: ['bloque', 'competicion'], ctx: ['principal'],
    tl: 3, pd: 3, min: 20, eq: ['campus'],
    setup: 'Calentamiento muy completo. Peldaños de tamaño cómodo. Colchoneta debajo.',
    steps: [['Cuélgate', 'Dedos en el peldaño inicial, cuerpo estable.'], ['Sube con control', 'Mueve una mano al siguiente peldaño con un tirón firme.'], ['Alterna', 'Continúa con la otra mano siguiendo el patrón de la serie.'], ['Baja con control', 'Suelta y cae sobre la colchoneta o baja con los pies.']],
    mis: [['Empezar sin calentar', 'Dedica antes tiempo al calentamiento.'], ['Peldaños demasiado pequeños', 'Elige peldaños con los que puedas mantener el control.']],
    done: ['Serie completa con movimientos controlados'],
    stop: [DOLOR, 'Dolor en los dedos o en los hombros.', 'Pérdida de coordinación por fatiga.'],
    rx: RX.reps(4, 5, 180, 8),
    rel: { reg: [['dino', 'Menos exigente para los dedos.'], ['dominada-explosiva', 'Potencia de tracción sin cargar los dedos al límite.']], pre: [['max-hang', 'Una base sólida de fuerza de dedos.'], ['dominada-estricta', 'Una base de tracción.']] },
    warn: ['Es de las prácticas más exigentes para los dedos y los hombros.', DEDO_WARN], prereq: ['Varios años de escalada y fuerza de dedos desarrollada.'], sup: true, minLevel: 3
  });
  ex('dino', 'Dino (lanzamiento dinámico)', 'potencia', {
    al: ['dynos a dedo', 'dynos', 'dyno', 'dinos', 'lanzamientos dinámicos', 'lanzamiento dinámico'],
    desc: 'Lanzarte de un agarre a otro con un impulso explosivo.',
    purpose: 'Entrenar la coordinación y la potencia de los movimientos dinámicos.',
    ab: ['potencia', 'coordinacion'], body: ['espalda', 'hombros', 'piernas', 'dedos'], pat: ['dinamico'], disc: ['bloque', 'competicion'], ctx: ['principal'],
    tl: 2, pd: 2, min: 15, eq: ['rocodromo'],
    setup: 'Pared con buena colchoneta y agarres fáciles de coger. Calentamiento previo.',
    steps: [['Elige el movimiento', 'Un agarre inicial cómodo y uno final alcanzable.'], ['Carga con las piernas', 'Flexiona y empuja desde los pies para ganar impulso.'], ['Lanza', 'Estira el brazo hacia el agarre final.'], ['Controla la caída', 'Cae sobre la colchoneta o frena el balanceo.']],
    mis: [['Tirar solo con los brazos', 'Empieza el movimiento desde las piernas.'], ['Agarre final muy pequeño', 'Elige agarres amplios.']],
    done: ['Agarre final alcanzado con control'],
    stop: [DOLOR, 'Caídas fuera de la colchoneta.'],
    rx: RX.attempts(4, 3, 120, 7),
    rel: { reg: [['movimientos-contacto', 'Misma coordinación con menos impacto.']], prog: [['campus-board', 'Potencia en peldaños.']] },
    warn: ['Asegura una zona de caída libre y colchonetas.'], minLevel: 2
  });
  ex('dominada-explosiva', 'Dominada explosiva', 'potencia', {
    al: ['dominadas explosivas', 'pull up explosivo'],
    desc: 'Dominada subiendo con la máxima velocidad posible.',
    purpose: 'Desarrollar potencia de tracción.',
    ab: ['potencia', 'fuerza-maxima'], body: ['espalda', 'hombros'], pat: ['traccion', 'dinamico'], ctx: ['principal'],
    tl: 2, pd: 3, min: 12, eq: ['barra'],
    setup: 'Barra estable. Calentamiento previo y buena técnica de dominada.',
    steps: [['Cuélgate', 'Brazos estirados y hombros activos.'], ['Sube con rapidez', 'Tira con fuerza buscando llevar el pecho a la barra.'], ['Baja con control', 'Vuelve sin caer de golpe.']],
    mis: [['Perder la técnica por la velocidad', 'Detén la serie si el movimiento se descontrola.']],
    done: ['Subida rápida con técnica limpia'], stop: [DOLOR, 'Dolor en codos u hombros.'],
    rx: RX.reps(4, 3, 150, 8),
    rel: { pre: [['dominada-estricta', 'Varias dominadas estrictas con control.']], alt: [['campus-board', 'Potencia en peldaños.']] },
    warn: ['Exige tendones y articulaciones preparados.'], prereq: ['Dominada estricta controlada.'], minLevel: 2
  });
  ex('movimientos-contacto', 'Movimientos de contacto', 'potencia', {
    al: ['coordinación y contacto', 'ejercicios de coordinación', 'tocar y soltar', 'contacto en pared'],
    desc: 'Ejercicios de coordinación en pared que trabajan la velocidad de movimiento con poco impacto.',
    purpose: 'Mejorar la coordinación entre manos y pies antes de pasar a movimientos más explosivos.',
    ab: ['coordinacion', 'potencia'], body: ['hombros', 'core', 'piernas'], pat: ['dinamico'], disc: ['bloque', 'deportiva'], ctx: ['tecnica', 'accesorio'],
    tl: 1, pd: 1, min: 10, eq: ['rocodromo'],
    setup: 'Pared con buenos agarres y una pendiente moderada.',
    steps: [['Colócate cómodo', 'Pies y manos en agarres amplios.'], ['Toca un punto', 'Toca otro agarre con una mano sin soltar el resto.'], ['Vuelve', 'Regresa a la posición inicial y repite alternando.']],
    mis: [['Ir demasiado rápido', 'Prioriza la precisión sobre la velocidad.']],
    done: ['Contactos precisos sin perder el equilibrio'], stop: [DOLOR],
    rx: RX.attempts(3, 6, 90, 5),
    rel: { prog: [['dino', 'Movimiento dinámico completo.']], rel: [['cambios-centro-gravedad', 'Cambios de peso.']] }
  });

  // ═══ 4. RESISTENCIA ESPECÍFICA ═══
  ex('arc', 'ARC (resistencia aeróbica)', 'resistencia', {
    al: ['arc en panel', 'arc · panel 45°', 'arc · panel 30°', 'arc panel', 'aerobic restoration and capillarity', 'resistencia aeróbica'],
    desc: 'Escalar de forma continua a baja intensidad durante mucho tiempo.',
    purpose: 'Mejorar la capacidad de aguantar escalando sin acumular fatiga excesiva.',
    ab: ['resistencia'], body: ['antebrazo', 'espalda', 'piernas'], pat: ['locomocion'], disc: ['deportiva', 'bloque'], ctx: ['principal'],
    tl: 1, pd: 2, min: 30, eq: ['rocodromo'],
    setup: 'Panel o pared con agarres cómodos y una inclinación moderada. Sin objetivos de dificultad.',
    steps: [['Elige un recorrido fácil', 'Que puedas escalar sin sentir el antebrazo muy cargado.'], ['Escala sin parar', 'Traversa o sube y baja de forma continua.'], ['Mantén la intensidad baja', 'Si notas bombeo excesivo, reduce la dificultad.'], ['Termina con calma', 'Acaba el tiempo y descansa.']],
    br: 'Respiración regular y calmada.', cues: ['Fluidez continua', 'Sin quedarte colgado'],
    mis: [['Ir demasiado fuerte', 'Debe ser cómodo: baja la dificultad.'], ['Parar a descansar a menudo', 'Busca reposos mientras sigues moviéndote.']],
    done: ['Tiempo completo sin parar', 'Sensación de esfuerzo moderado'], stop: [DOLOR, 'Mareo o malestar.'],
    rx: RX.endurance(2, 1200, 300, 5),
    rel: { prog: [['circuito-4x4', 'Intensidad mayor.']], alt: [['travesias-continuas', 'Mismo concepto en travesía.']] }
  });
  ex('travesias-continuas', 'Travesías continuas', 'resistencia', {
    al: ['travesías largas', 'travesías', 'traversar', 'travesía continua'],
    desc: 'Recorrer la pared lateralmente sin parar, a un ritmo constante.',
    purpose: 'Desarrollar la resistencia con un trabajo continuo en pared.',
    ab: ['resistencia', 'tecnica'], body: ['antebrazo', 'piernas', 'core'], pat: ['locomocion'], disc: ['bloque', 'deportiva'], ctx: ['principal', 'accesorio'],
    tl: 1, pd: 2, min: 20, eq: ['rocodromo'],
    setup: 'Zona de pared con espacio para traversar y agarres cómodos.',
    steps: [['Empieza cómodo', 'Elige una línea fácil y mantén los pies cerca del suelo si es posible.'], ['Traversa sin parar', 'Muévete con un ritmo estable.'], ['Cambia de sentido', 'Al llegar al final, vuelve sin detenerte.']],
    mis: [['Acelerar y fatigarse pronto', 'Mantén un ritmo constante.']],
    done: ['Tiempo marcado completado'], stop: [DOLOR, 'Malestar o mareo.'],
    rx: RX.endurance(3, 600, 240, 6),
    rel: { alt: [['arc', 'Mismo concepto con más intensidad baja.']], prog: [['circuito-4x4', 'Más intensidad.']] }
  });
  ex('circuito-4x4', 'Circuito 4×4', 'resistencia', {
    al: ['4×4 bloque', '4x4 bloque', '4x4', 'cuatro por cuatro', '4×4'],
    desc: 'Cuatro problemas de bloque encadenados, repetidos cuatro veces con descanso entre rondas.',
    purpose: 'Entrenar la resistencia de fuerza en pared con intensidad media-alta.',
    ab: ['resistencia', 'fuerza-maxima'], body: ['antebrazo', 'espalda', 'core'], pat: ['locomocion'], disc: ['bloque'], ctx: ['principal'],
    tl: 2, pd: 3, min: 30, eq: ['rocodromo'],
    setup: 'Cuatro problemas de bloque de dificultad moderada, que puedas completar con seguridad aunque estés cansado.',
    steps: [['Elige los problemas', 'Cuatro bloques de dificultad similar y por debajo de tu límite.'], ['Encadénalos', 'Escala los cuatro seguidos sin descanso.'], ['Descansa', 'Descansa lo indicado entre rondas.'], ['Repite', 'Completa las cuatro rondas.']],
    mis: [['Elegir bloques demasiado duros', 'Deben poder repetirse con control.']],
    done: ['Cuatro rondas completadas'], stop: [DOLOR, 'La técnica se deteriora con riesgo de caída.'],
    rx: RX.attempts(4, 4, 240, 7),
    rel: { reg: [['arc', 'Menor intensidad.']], prog: [['intervalos-pared', 'Intervalos específicos.']] }, minLevel: 2
  });
  ex('intervalos-pared', 'Intervalos en pared', 'resistencia', {
    al: ['intervalos en pared', 'intervalos de escalada'],
    desc: 'Bloques de escalada intensa alternados con descanso, siguiendo tiempos fijos.',
    purpose: 'Mejorar la capacidad de recuperar y volver a esforzarte durante la escalada.',
    ab: ['resistencia'], body: ['antebrazo', 'espalda', 'core'], pat: ['locomocion'], disc: ['deportiva', 'bloque'], ctx: ['principal'],
    tl: 2, pd: 3, min: 25, eq: ['rocodromo'],
    setup: 'Línea o circuito que puedas repetir. Cronómetro de intervalos.',
    steps: [['Prepárate', 'Colócate al inicio de la línea.'], ['Escala el intervalo', 'Escala de forma continua durante el tiempo marcado.'], ['Descansa', 'Descansa lo indicado.'], ['Repite', 'Completa las series previstas.']],
    mis: [['Intervalos demasiado largos', 'Ajusta el tiempo para mantener la calidad.']],
    done: ['Todos los intervalos completados'], stop: [DOLOR, 'Pérdida de control por fatiga.'],
    rx: RX.timed(4, 60, 120, 7),
    rel: { reg: [['circuito-4x4', 'Estructura más sencilla.']] }, minLevel: 2
  });
  ex('repeticion-secciones', 'Repetición de secciones', 'resistencia', {
    al: ['repetir secciones clave', 'repetir secciones', 'secciones clave'],
    desc: 'Repetir una parte concreta de una vía o problema para mejorarla.',
    purpose: 'Afinar los movimientos clave y acumular volumen específico.',
    ab: ['resistencia', 'tecnica'], body: ['antebrazo', 'espalda', 'piernas'], pat: ['locomocion'], disc: ['bloque', 'deportiva'], ctx: ['principal', 'tecnica'],
    tl: 2, pd: 2, min: 20, eq: ['rocodromo'],
    setup: 'Identifica la sección que quieres trabajar y asegura una caída segura.',
    steps: [['Elige la sección', 'Un tramo de pocos movimientos.'], ['Escala con calidad', 'Concéntrate en la forma de cada movimiento.'], ['Descansa y repite', 'Descansa lo suficiente para mantener la calidad.']],
    mis: [['Repetir sin pensar', 'Cambia algo en cada intento.']],
    done: ['Sección repetida con fluidez'], stop: [DOLOR],
    rx: RX.attempts(4, 3, 180, 7),
    rel: { alt: [['trabajo-proyecto', 'Trabajar un proyecto completo.']] }
  });

  // ═══ 5. PIERNAS Y TRABAJO DE PIES ═══
  ex('sentadilla-una-pierna-goma', 'Sentadilla a una pierna con goma', 'piernas', {
    al: ['sentadilla a una pierna', 'sentadilla unilateral con goma', 'sentadilla con goma'],
    desc: 'Sentadilla sobre una pierna con una goma que ayuda a controlar el movimiento.',
    purpose: 'Ganar fuerza y estabilidad unilateral de pierna.',
    ab: ['fuerza-maxima', 'control-corporal'], body: ['piernas', 'caderas', 'tobillos'], pat: ['unilateral', 'empuje'], ctx: ['principal', 'accesorio'],
    tl: 2, pd: 2, min: 10, eq: ['gomas'],
    setup: 'Goma anclada en un punto alto y estable, sujeta con las manos para ayudarte.',
    steps: [['Apoya en una pierna', 'La otra queda adelantada, sin apoyar.'], ['Baja con control', 'Flexiona la rodilla manteniendo el pie firme.'], ['Sube', 'Empuja con el pie y estira la pierna, usando la goma para ayudar.']],
    mis: [['Rodilla hacia dentro', 'Alinea la rodilla con la punta del pie.']],
    done: ['Recorrido controlado sin perder el equilibrio'], stop: [DOLOR, 'Dolor en la rodilla.'],
    rx: RX.bodyReps(3, 6, 90, 6),
    rel: { prog: [['pistol-asistida', 'Más recorrido con ayuda.']], alt: [['sentadilla-bulgara', 'Otra opción unilateral.']] }
  });
  ex('pistol-asistida', 'Pistol squat asistida', 'piernas', {
    al: ['pistol squat', 'pistol', 'sentadilla pistol'],
    desc: 'Sentadilla a una pierna con recorrido completo, con ayuda de agarre.',
    purpose: 'Trabajar la fuerza y la movilidad de cadera y tobillo en un solo ejercicio.',
    ab: ['fuerza-maxima', 'control-corporal', 'movilidad'], body: ['piernas', 'caderas', 'tobillos', 'core'], pat: ['unilateral', 'empuje'], ctx: ['principal'],
    tl: 3, pd: 3, min: 10, eq: ['gomas'], eqa: ['peso-corporal'],
    setup: 'Un punto de agarre estable (anilla, goma o poste) para ayudarte.',
    steps: [['Agárrate', 'Sujétate con las dos manos y apoya en una pierna.'], ['Baja', 'Flexiona hasta la mayor profundidad controlada, con la otra pierna estirada delante.'], ['Sube', 'Empuja con el pie reduciendo poco a poco la ayuda.']],
    mis: [['Talón que se levanta', 'Trabaja antes la movilidad de tobillo.']],
    done: ['Recorrido controlado'], stop: [DOLOR, 'Dolor en la rodilla.'],
    rx: RX.bodyReps(3, 4, 120, 7),
    rel: { reg: [['sentadilla-una-pierna-goma', 'Menos recorrido.']], rel: [['movilidad-tobillos', 'Prepara el tobillo.']] },
    warn: ['Si tienes molestias de rodilla, consulta antes con un profesional.'], prereq: ['Buena movilidad de tobillo y cadera.'], minLevel: 2
  });
  ex('zancadas', 'Zancadas', 'piernas', {
    al: ['zancada', 'lunge', 'lunges', 'estocadas'],
    desc: 'Paso largo hacia delante o atrás flexionando ambas rodillas.',
    purpose: 'Fortalecer las piernas y mejorar el equilibrio.',
    ab: ['fuerza-maxima', 'control-corporal'], body: ['piernas', 'caderas'], pat: ['unilateral', 'empuje'], ctx: ['principal', 'accesorio'],
    tl: 1, pd: 2, min: 10, eq: ['peso-corporal'], eqo: ['pesas'],
    cats: ['general'],
    setup: 'Espacio libre. Postura erguida y pies a la anchura de la cadera.',
    steps: [['Da el paso', 'Avanza o retrocede con una pierna.'], ['Baja', 'Flexiona ambas rodillas con el tronco erguido.'], ['Vuelve', 'Empuja con la pierna adelantada para volver al inicio.']],
    mis: [['Rodilla delantera hacia dentro', 'Mantenla alineada con el pie.']],
    done: ['Repeticiones controladas en ambas piernas'], stop: [DOLOR, 'Dolor en la rodilla.'],
    rx: RX.bodyReps(3, 10, 60, 6, [P('externalLoadKg', 0, 0, 60, 0.5)]),
    rel: { prog: [['sentadilla-bulgara', 'Mayor exigencia unilateral.']], alt: [['sentadilla', 'Patrón de sentadilla.']] }
  });
  ex('elevaciones-gemelos', 'Elevaciones de gemelos', 'piernas', {
    al: ['elevaciones de talones', 'gemelos', 'calf raises'],
    desc: 'Subir sobre las puntas de los pies para fortalecer los gemelos.',
    purpose: 'Reforzar el tobillo y la pantorrilla, útiles para pisar con precisión.',
    ab: ['fuerza-maxima', 'control-corporal'], body: ['piernas', 'tobillos'], pat: ['empuje'], ctx: ['accesorio'],
    tl: 1, pd: 1, min: 6, eq: ['peso-corporal'], eqo: ['pesas'],
    setup: 'Un escalón o una superficie estable.',
    steps: [['Colócate', 'Puntas de los pies en el borde, talones fuera.'], ['Sube', 'Eleva los talones lo más alto posible.'], ['Baja con control', 'Hasta estirar los gemelos.']],
    mis: [['Rebotar', 'Haz el movimiento lento y controlado.']],
    done: ['Recorrido completo'], stop: [DOLOR, 'Calambres intensos.'],
    rx: RX.bodyReps(3, 15, 60, 6),
    rel: { rel: [['movilidad-tobillos', 'Tobillos móviles y fuertes.']] }
  });
  ex('precision-pies', 'Precisión de pies', 'piernas', {
    al: ['trabajo de pies', 'pisadas precisas', 'foot precision', 'pies silenciosos'],
    desc: 'Colocar el pie con exactitud sobre pequeños apoyos, sin tocar de más.',
    purpose: 'Mejorar la colocación del pie y reducir el esfuerzo en brazos y dedos.',
    ab: ['tecnica', 'coordinacion'], body: ['piernas', 'tobillos'], pat: ['locomocion', 'unilateral'], disc: ['bloque', 'deportiva'], ctx: ['tecnica', 'calentamiento'],
    tl: 1, pd: 1, min: 10, eq: ['rocodromo'],
    setup: 'Pared vertical con apoyos pequeños y bien visibles.',
    steps: [['Mira el apoyo', 'Fija la vista en el apoyo hasta que el pie lo toque.'], ['Coloca el pie', 'Pisa con la punta y con precisión, sin golpear.'], ['Carga con control', 'Transfiere el peso sin arrastrar el pie.']],
    mis: [['Mirar a las manos', 'Mira siempre el pie hasta posarlo.']],
    done: ['Pisadas silenciosas y exactas'], stop: [DOLOR],
    rx: RX.timed(3, 120, 60, 4),
    rel: { alt: [['escalada-silenciosa', 'Mismo objetivo con feedback sonoro.']], rel: [['cambios-apoyo', 'Cambios de pie sobre un mismo apoyo.']] }
  });
  ex('cambios-apoyo', 'Cambios de apoyo', 'piernas', {
    al: ['cambios de pie', 'cambio de pie', 'foot swap'],
    desc: 'Intercambiar un pie por otro sobre el mismo apoyo.',
    purpose: 'Aprender a reorganizar los pies cuando el apoyo es pequeño.',
    ab: ['tecnica', 'coordinacion'], body: ['piernas', 'tobillos'], pat: ['locomocion', 'unilateral'], disc: ['bloque', 'deportiva'], ctx: ['tecnica'],
    tl: 2, pd: 1, min: 10, eq: ['rocodromo'],
    setup: 'Pared vertical con apoyos amplios para empezar.',
    steps: [['Elige un apoyo', 'Uno amplio y cómodo.'], ['Cambia el pie', 'Pisa con el segundo pie mientras el primero se libera.'], ['Estabiliza', 'Comprueba el equilibrio antes de continuar.']],
    mis: [['Saltar el cambio', 'Hazlo con control y sin perder la tensión.']],
    done: ['Cambios limpios en ambos lados'], stop: [DOLOR],
    rx: RX.attempts(3, 6, 60, 4),
    rel: { reg: [['precision-pies', 'Más sencillo.']] }
  });

  // ═══ 6. CORE Y TENSIÓN CORPORAL ═══
  ex('plancha', 'Plancha', 'core', {
    al: ['core · plancha', 'plancha frontal', 'plank'],
    desc: 'Mantener el cuerpo recto apoyado en antebrazos y puntas de los pies.',
    purpose: 'Fortalecer el tronco para mantener el cuerpo estable al escalar.',
    ab: ['control-corporal', 'resistencia'], body: ['core', 'hombros'], pat: ['isometrico'], ctx: ['principal', 'accesorio', 'calentamiento'],
    tl: 1, pd: 1, min: 6, eq: ['peso-corporal'],
    setup: 'Superficie cómoda. Codos bajo los hombros.',
    steps: [['Colócate', 'Apoya antebrazos y puntas de los pies.'], ['Alinea el cuerpo', 'Cuerpo recto de la cabeza a los talones.'], ['Mantén', 'Aprieta abdomen y glúteos durante el tiempo marcado.']],
    br: 'Respira de forma regular.', cues: ['Cuerpo en línea', 'Abdomen firme'],
    mis: [['Caderas caídas', 'Aprieta abdomen y glúteos.'], ['Caderas muy altas', 'Alinea el cuerpo.']],
    done: ['Posición mantenida sin perder la alineación'], stop: [DOLOR, 'Dolor lumbar o en el hombro.'],
    rx: RX.timed(3, 30, 45, 5),
    rel: { prog: [['hollow-body', 'Mayor tensión abdominal.']], alt: [['tension-corporal-pared', 'Tensión específica de escalada.']] }
  });
  ex('hollow-body', 'Hollow body', 'core', {
    al: ['hollow', 'posición hollow', 'cuerpo hueco'],
    desc: 'Tumbado, elevar hombros y piernas manteniendo la espalda baja pegada al suelo.',
    purpose: 'Trabajar la tensión corporal necesaria para mantener los pies en la pared.',
    ab: ['control-corporal'], body: ['core'], pat: ['isometrico'], ctx: ['principal', 'accesorio'],
    tl: 2, pd: 2, min: 6, eq: ['peso-corporal'],
    setup: 'Superficie cómoda en el suelo.',
    steps: [['Túmbate', 'Boca arriba, brazos junto a las orejas.'], ['Eleva', 'Levanta hombros y piernas del suelo con la zona lumbar pegada.'], ['Mantén', 'Aguanta el tiempo marcado.']],
    mis: [['Arquear la zona lumbar', 'Baja las piernas hasta una altura que puedas controlar.']],
    done: ['Zona lumbar en contacto con el suelo'], stop: [DOLOR, 'Dolor lumbar.'],
    rx: RX.timed(3, 20, 45, 6),
    rel: { reg: [['plancha', 'Más sencillo.']], prog: [['l-sit', 'Más exigente.']] }
  });
  ex('elevacion-piernas', 'Elevaciones de piernas', 'core', {
    al: ['elevaciones de piernas', 'leg raises'],
    desc: 'Elevar las piernas rectas colgado o tumbado.',
    purpose: 'Fortalecer el abdomen inferior y la flexión de cadera.',
    ab: ['control-corporal', 'fuerza-maxima'], body: ['core', 'caderas'], pat: ['dinamico'], ctx: ['accesorio'],
    tl: 2, pd: 2, min: 6, eq: ['barra'], eqa: ['peso-corporal'],
    setup: 'Barra estable o superficie para tumbarte.',
    steps: [['Colócate', 'Colgado de la barra o tumbado, piernas estiradas.'], ['Eleva', 'Sube las piernas con control.'], ['Baja', 'Sin balanceo.']],
    mis: [['Balancearse', 'Controla el movimiento.']],
    done: ['Repeticiones sin balanceo'], stop: [DOLOR, 'Dolor lumbar.'],
    rx: RX.bodyReps(3, 8, 60, 6),
    rel: { prog: [['toes-to-bar', 'Recorrido completo.']] }
  });
  ex('toes-to-bar', 'Toes-to-bar', 'core', {
    al: ['pies a la barra', 'toes to bar'],
    desc: 'Colgado de la barra, llevar los pies hasta tocarla.',
    purpose: 'Combinar fuerza de agarre, core y control del cuerpo.',
    ab: ['control-corporal', 'fuerza-maxima'], body: ['core', 'hombros', 'antebrazo'], pat: ['dinamico'], ctx: ['principal'],
    tl: 3, pd: 3, min: 10, eq: ['barra'],
    setup: 'Barra estable, espacio libre y calentamiento de hombros.',
    steps: [['Cuélgate', 'Hombros activos y cuerpo estable.'], ['Eleva', 'Lleva los pies hacia la barra con las piernas casi rectas.'], ['Baja con control', 'Sin balanceo excesivo.']],
    mis: [['Balanceo descontrolado', 'Reduce la amplitud y controla el movimiento.']],
    done: ['Repeticiones controladas'], stop: [DOLOR, 'Dolor en hombro o en la zona lumbar.'],
    rx: RX.bodyReps(3, 5, 90, 7),
    rel: { reg: [['elevacion-piernas', 'Menor recorrido.']] }, minLevel: 2
  });
  ex('l-sit', 'L-sit', 'core', {
    al: ['l sit', 'lsit'],
    desc: 'Mantener el cuerpo en L con las manos apoyadas y las piernas extendidas.',
    purpose: 'Desarrollar fuerza de core y de hombros en posición compacta.',
    ab: ['control-corporal', 'fuerza-maxima'], body: ['core', 'hombros'], pat: ['isometrico'], ctx: ['principal', 'accesorio'],
    tl: 3, pd: 3, min: 8, eq: ['peso-corporal'],
    setup: 'Dos apoyos estables (paralelas o suelo).',
    steps: [['Apoya las manos', 'Brazos estirados y hombros hacia abajo.'], ['Eleva las piernas', 'Lleva las piernas al frente, rectas.'], ['Mantén', 'Aguanta el tiempo marcado.']],
    mis: [['Hombros encogidos', 'Empuja el suelo y baja los hombros.']],
    done: ['Posición mantenida con las piernas elevadas'], stop: [DOLOR, 'Dolor en muñecas u hombros.'],
    rx: RX.timed(3, 10, 60, 7),
    rel: { reg: [['hollow-body', 'Menos exigente.']] }, minLevel: 2
  });
  ex('tension-corporal-pared', 'Tensión corporal en pared', 'core', {
    al: ['tensión corporal', 'body tension', 'tensión en pared'],
    desc: 'Mantener el cuerpo tenso y los pies en la pared mientras te mueves por agarres.',
    purpose: 'Aprender a conservar el cuerpo cerca de la pared al escalar en desplome.',
    ab: ['control-corporal', 'tecnica'], body: ['core', 'hombros'], pat: ['isometrico', 'locomocion'], disc: ['bloque', 'deportiva'], ctx: ['tecnica', 'principal'],
    tl: 2, pd: 2, min: 12, eq: ['rocodromo'],
    setup: 'Pared con ligera inclinación y agarres cómodos.',
    steps: [['Colócate', 'Manos y pies en agarres cómodos, cuerpo cerca de la pared.'], ['Tensa', 'Aprieta abdomen y glúteos para mantener los pies pegados.'], ['Mueve', 'Cambia una mano o un pie sin perder la tensión.']],
    mis: [['Pies que se despegan', 'Aprieta el core y carga más los pies.']],
    done: ['Movimientos limpios con los pies en la pared'], stop: [DOLOR],
    rx: RX.timed(3, 45, 90, 6),
    rel: { alt: [['plancha', 'Versión en suelo.']] }
  });

  // ═══ 7. TÉCNICA Y COORDINACIÓN ═══
  ex('escalada-silenciosa', 'Escalada silenciosa', 'tecnica', {
    al: ['silent feet', 'pies silenciosos', 'escalada sin ruido'],
    desc: 'Escalar sin hacer ruido con los pies ni con el cuerpo.',
    purpose: 'Mejorar la precisión y el control del movimiento.',
    ab: ['tecnica', 'coordinacion'], body: ['piernas', 'core'], pat: ['locomocion'], disc: ['bloque', 'deportiva'], ctx: ['tecnica', 'calentamiento'],
    tl: 1, pd: 1, min: 12, eq: ['rocodromo'],
    setup: 'Recorridos fáciles con buenos agarres.',
    steps: [['Elige un recorrido fácil', 'Que no te exija esfuerzo.'], ['Escala sin ruido', 'Coloca los pies con suavidad y sin golpear.'], ['Repite', 'Repite el recorrido buscando más suavidad.']],
    mis: [['Ir deprisa', 'Reduce la velocidad.']],
    done: ['Recorrido completado sin ruido'], stop: [DOLOR],
    rx: RX.timed(3, 180, 60, 3),
    rel: { alt: [['precision-pies', 'Trabajo específico de pies.']] }
  });
  ex('equilibrio-pared', 'Equilibrio en pared', 'tecnica', {
    al: ['equilibrio', 'trabajo de equilibrio'],
    desc: 'Mantener posiciones de equilibrio con poco peso en las manos.',
    purpose: 'Aprender a cargar los pies y reducir la fatiga de los brazos.',
    ab: ['tecnica', 'control-corporal'], body: ['piernas', 'core'], pat: ['locomocion', 'isometrico'], disc: ['bloque', 'deportiva'], ctx: ['tecnica'],
    tl: 1, pd: 1, min: 10, eq: ['rocodromo'],
    setup: 'Pared vertical o con poca inclinación.',
    steps: [['Elige una postura', 'Con las manos en agarres amplios.'], ['Carga los pies', 'Lleva el peso del cuerpo sobre las piernas.'], ['Suelta una mano', 'Mantén el equilibrio unos segundos.']],
    mis: [['Colgarse de los brazos', 'Estira los brazos y carga las piernas.']],
    done: ['Equilibrio mantenido con una mano suelta'], stop: [DOLOR],
    rx: RX.attempts(3, 6, 60, 3),
    rel: { rel: [['cambios-centro-gravedad', 'Desplazar el peso.']] }
  });
  ex('cambios-centro-gravedad', 'Cambios de centro de gravedad', 'tecnica', {
    al: ['centro de gravedad', 'desplazamiento de cadera', 'cadera pegada'],
    desc: 'Mover la cadera para cambiar el reparto del peso entre manos y pies.',
    purpose: 'Mejorar la eficiencia de los movimientos.',
    ab: ['tecnica', 'coordinacion'], body: ['core', 'caderas', 'piernas'], pat: ['locomocion'], disc: ['bloque', 'deportiva'], ctx: ['tecnica'],
    tl: 2, pd: 1, min: 12, eq: ['rocodromo'],
    setup: 'Pared vertical con agarres amplios.',
    steps: [['Colócate', 'Manos y pies en agarres cómodos.'], ['Desplaza la cadera', 'Lleva la cadera hacia un lado o hacia la pared.'], ['Libera una mano', 'Comprueba cómo cambia el peso en los brazos.']],
    mis: [['Mover solo los brazos', 'Inicia el movimiento desde la cadera.']],
    done: ['Peso desplazado con control'], stop: [DOLOR],
    rx: RX.attempts(3, 8, 60, 3),
    rel: { rel: [['equilibrio-pared', 'Equilibrio en pared.']] }
  });
  ex('practica-reposos', 'Práctica de reposos', 'tecnica', {
    al: ['reposos', 'descansar en pared', 'rest'],
    desc: 'Buscar posiciones para soltar los brazos y recuperar durante la escalada.',
    purpose: 'Aprender a recuperarte escalando para aguantar más en las vías.',
    ab: ['tecnica', 'resistencia'], body: ['antebrazo', 'piernas'], pat: ['locomocion'], disc: ['deportiva'], ctx: ['tecnica', 'principal'],
    tl: 2, pd: 1, min: 15, eq: ['rocodromo'],
    setup: 'Vía o circuito con zonas de descanso posibles.',
    steps: [['Localiza el reposo', 'Busca un lugar con buenos agarres y apoyos.'], ['Colócate', 'Carga las piernas y relaja los brazos.'], ['Recupera', 'Sacude cada mano de forma alterna y respira.'], ['Continúa', 'Sigue cuando notes la recuperación.']],
    mis: [['No descansar de verdad', 'Estira los brazos y carga más las piernas.']],
    done: ['Recuperación notable antes de seguir'], stop: [DOLOR],
    rx: RX.attempts(3, 4, 120, 5),
    rel: { alt: [['arc', 'Resistencia continua.']] }
  });
  ex('trabajo-proyecto', 'Trabajo de proyecto', 'tecnica', {
    al: ['intentos al proyecto', 'pegues', 'trabajar un proyecto', 'proyecto'],
    desc: 'Intentos concentrados sobre una vía o bloque cercano a tu límite.',
    purpose: 'Resolver los movimientos de una vía difícil con descansos completos.',
    ab: ['tecnica', 'fuerza-maxima'], body: ['dedos', 'espalda', 'core'], pat: ['locomocion', 'dinamico'], disc: ['bloque', 'deportiva', 'competicion'], ctx: ['principal'],
    tl: 3, pd: 3, min: 40, eq: ['rocodromo'],
    setup: 'Calentamiento completo. Elige una vía o bloque con caída segura.',
    steps: [['Analiza', 'Observa la secuencia antes de intentar.'], ['Intenta', 'Realiza un intento con calidad.'], ['Descansa por completo', 'Espera entre intentos para recuperar.'], ['Ajusta', 'Cambia la secuencia según lo aprendido.']],
    mis: [['Intentos con poco descanso', 'Descansa lo suficiente para mantener la calidad.']],
    done: ['Intentos realizados con descansos completos'], stop: [DOLOR, 'Cansancio que compromete la seguridad.'],
    rx: RX.attempts(5, 1, 300, 9),
    rel: { alt: [['repeticion-secciones', 'Repetir tramos concretos.']] },
    warn: ['Intensidad alta: calienta bien y para si pierdes calidad.'], minLevel: 2
  });

  // ═══ 8. ANTAGONISTAS, HOMBROS Y PREVENCIÓN ═══
  ex('rotacion-externa-goma', 'Rotación externa con goma', 'antagonistas', {
    al: ['manguito rotador', 'rotación externa', 'external rotation'],
    desc: 'Rotar el antebrazo hacia fuera con una goma, con el codo pegado al cuerpo.',
    purpose: 'Reforzar el manguito rotador y proteger el hombro.',
    ab: ['control-corporal', 'fuerza-maxima'], body: ['hombros'], pat: ['isometrico'], ctx: ['accesorio', 'calentamiento'],
    tl: 1, pd: 1, min: 6, eq: ['gomas'],
    setup: 'Goma ligera anclada a la altura del codo.',
    steps: [['Colócate', 'Codo pegado al cuerpo, doblado a 90°.'], ['Rota hacia fuera', 'Abre el antebrazo sin separar el codo.'], ['Vuelve con control', 'Sin dejar que la goma te arrastre.']],
    mis: [['Separar el codo', 'Coloca una toalla bajo el codo para mantenerlo pegado.']],
    done: ['Repeticiones controladas'], stop: [DOLOR, 'Dolor en el hombro.'],
    rx: RX.bodyReps(3, 15, 45, 5),
    rel: { rel: [['face-pull', 'Trabajo complementario de hombro.']] }
  });
  ex('face-pull', 'Face pull', 'antagonistas', {
    al: ['face pulls', 'tirón a la cara'],
    desc: 'Tirar de una goma o polea hacia la cara con los codos altos.',
    purpose: 'Fortalecer la parte posterior del hombro y la espalda alta.',
    ab: ['control-corporal', 'fuerza-maxima'], body: ['hombros', 'espalda'], pat: ['traccion'], ctx: ['accesorio', 'calentamiento'],
    tl: 1, pd: 1, min: 8, eq: ['gomas'], eqa: ['maquinas'],
    setup: 'Goma o polea a la altura de la cara.',
    steps: [['Agarra la goma', 'Brazos estirados al frente.'], ['Tira hacia la cara', 'Codos altos y manos hacia las orejas.'], ['Vuelve con control', 'Sin perder la postura.']],
    mis: [['Encoger los hombros', 'Mantén los hombros bajos.']],
    done: ['Recorrido completo y controlado'], stop: [DOLOR, 'Dolor en el hombro.'],
    rx: RX.bodyReps(3, 15, 45, 5),
    rel: { rel: [['rotacion-externa-goma', 'Rotadores del hombro.']] }
  });
  ex('trabajo-escapular', 'Trabajo escapular', 'antagonistas', {
    al: ['escápulas', 'control escapular', 'retracción escapular', 'scapular pulls'],
    desc: 'Mover solo las escápulas, colgado o en el suelo, para controlar el hombro.',
    purpose: 'Mejorar el control de las escápulas y la salud del hombro.',
    ab: ['control-corporal'], body: ['hombros', 'espalda'], pat: ['traccion', 'isometrico'], ctx: ['accesorio', 'calentamiento'],
    tl: 1, pd: 1, min: 6, eq: ['barra'], eqa: ['peso-corporal'],
    setup: 'Barra estable o suelo.',
    steps: [['Cuélgate', 'Brazos estirados.'], ['Activa', 'Baja y junta las escápulas sin doblar los codos.'], ['Relaja', 'Vuelve despacio a la posición inicial.']],
    mis: [['Doblar los codos', 'Mueve solo las escápulas.']],
    done: ['Movimiento escapular controlado'], stop: [DOLOR, 'Dolor en el hombro.'],
    rx: RX.bodyReps(3, 10, 45, 4),
    rel: { rel: [['suspension-pasiva', 'Mejora la suspensión.']] }
  });
  ex('extensores-muneca', 'Extensores de muñeca', 'antagonistas', {
    al: ['extensión de muñeca', 'wrist extension', 'antebrazo antagonista'],
    desc: 'Extender la muñeca contra una resistencia ligera.',
    purpose: 'Equilibrar el antebrazo, que trabaja sobre todo en flexión al escalar.',
    ab: ['control-corporal', 'fuerza-maxima'], body: ['antebrazo'], pat: ['empuje'], ctx: ['accesorio', 'recuperacion'],
    tl: 1, pd: 1, min: 6, eq: ['gomas'], eqa: ['pesas'],
    setup: 'Goma ligera o una pesa pequeña. Antebrazo apoyado sobre una superficie.',
    steps: [['Apoya el antebrazo', 'Con la palma hacia abajo y la muñeca fuera del borde.'], ['Extiende', 'Sube la mano de forma lenta.'], ['Baja con control', 'Hasta la posición inicial.']],
    mis: [['Usar demasiada resistencia', 'Empieza con una carga muy ligera.']],
    done: ['Recorrido completo y controlado'], stop: [DOLOR, 'Molestias en el codo.'],
    rx: RX.bodyReps(3, 15, 45, 4),
    rel: { rel: [['estiramiento-muneca', 'Estiramiento posterior.']] }
  });
  ex('control-hombro', 'Control del hombro', 'antagonistas', {
    al: ['estabilidad de hombro', 'activación de hombro', 'ytw'],
    desc: 'Movimientos lentos de brazo que trabajan la estabilidad del hombro.',
    purpose: 'Preparar el hombro para el esfuerzo de escalar.',
    ab: ['control-corporal', 'movilidad'], body: ['hombros', 'espalda'], pat: ['isometrico'], ctx: ['calentamiento', 'accesorio'],
    tl: 1, pd: 1, min: 6, eq: ['peso-corporal'], eqo: ['gomas'],
    setup: 'De pie o tumbado boca abajo, con espacio libre.',
    steps: [['Colócate', 'Postura neutra.'], ['Mueve los brazos', 'Dibuja las letras Y, T y W con control.'], ['Mantén', 'Mantén cada posición un par de segundos.']],
    mis: [['Compensar con la espalda baja', 'Mantén el tronco estable.']],
    done: ['Movimientos controlados'], stop: [DOLOR, 'Dolor en el hombro.'],
    rx: RX.bodyReps(2, 8, 30, 3),
    rel: { rel: [['trabajo-escapular', 'Control de escápulas.']] }
  });

  // ═══ 9. MOVILIDAD, CALENTAMIENTO Y RECUPERACIÓN ═══
  ex('movilidad-tobillos', 'Movilidad de tobillos', 'movilidad', {
    al: ['tobillos', 'movilidad de tobillo', 'ankle mobility'],
    desc: 'Mover el tobillo en todo su rango para mejorar la flexión y la estabilidad.',
    purpose: 'Facilitar apoyos precisos y sentadillas profundas.',
    ab: ['movilidad'], body: ['tobillos', 'piernas'], pat: ['unilateral'], ctx: ['calentamiento', 'recuperacion'],
    tl: 1, pd: 1, min: 5, eq: ['peso-corporal'],
    setup: 'Una pared o apoyo para mantener el equilibrio.',
    steps: [['Colócate', 'Un pie adelantado, el talón en el suelo.'], ['Lleva la rodilla adelante', 'Sin levantar el talón.'], ['Vuelve', 'Repite con control.']],
    mis: [['Levantar el talón', 'Reduce el recorrido.']],
    done: ['Rango suave y sin dolor'], stop: [DOLOR],
    rx: RX.mobility(2, 30, 10),
    rel: { rel: [['pistol-asistida', 'Mejora la profundidad.']] }
  });
  ex('movilidad-caderas', 'Movilidad de caderas', 'movilidad', {
    al: ['caderas', 'apertura de cadera', 'hip mobility'],
    desc: 'Movimientos de apertura de cadera para ganar rango en los pasos altos.',
    purpose: 'Facilitar posiciones de pie alto y de rodilla hacia fuera.',
    ab: ['movilidad'], body: ['caderas'], pat: ['unilateral'], ctx: ['calentamiento', 'recuperacion'],
    tl: 1, pd: 1, min: 6, eq: ['peso-corporal'],
    setup: 'Superficie cómoda.',
    steps: [['Colócate', 'En cuadrupedia o de pie.'], ['Abre la cadera', 'Lleva la rodilla hacia fuera con control.'], ['Mantén suave', 'Sin forzar el final del rango.']],
    mis: [['Forzar el rango', 'Mueve hasta una tensión suave y sin dolor.']],
    done: ['Rango suave y sin dolor'], stop: [DOLOR],
    rx: RX.mobility(2, 30, 10),
    rel: { rel: [['zancadas', 'Fuerza en la cadera.']] }
  });
  ex('movilidad-toracica', 'Movilidad torácica', 'movilidad', {
    al: ['espalda alta', 'rotación torácica', 'thoracic mobility'],
    desc: 'Rotaciones y extensiones de la zona alta de la espalda.',
    purpose: 'Mejorar la postura de los hombros y la capacidad de girar el tronco.',
    ab: ['movilidad'], body: ['espalda', 'hombros'], pat: ['dinamico'], ctx: ['calentamiento', 'recuperacion'],
    tl: 1, pd: 1, min: 5, eq: ['peso-corporal'],
    setup: 'Suelo o colchoneta.',
    steps: [['Colócate', 'En cuadrupedia con una mano detrás de la cabeza.'], ['Gira', 'Abre el codo hacia el techo siguiendo con la mirada.'], ['Vuelve', 'Cierra el movimiento y repite.']],
    mis: [['Mover la zona lumbar', 'Gira desde la parte alta de la espalda.']],
    done: ['Giro suave en ambos lados'], stop: [DOLOR],
    rx: RX.mobility(2, 30, 10),
    rel: { rel: [['control-hombro', 'Prepara el hombro.']] }
  });
  ex('calentamiento-progresivo', 'Calentamiento progresivo', 'movilidad', {
    al: ['calentamiento', 'calentar', 'warm up', 'activación general'],
    desc: 'Activación gradual de todo el cuerpo antes de escalar o entrenar.',
    purpose: 'Elevar la temperatura corporal y preparar tendones y articulaciones.',
    ab: ['movilidad', 'coordinacion'], body: ['hombros', 'dedos', 'piernas', 'core'], pat: ['dinamico', 'locomocion'], disc: ['general'], ctx: ['calentamiento'],
    tl: 1, pd: 1, min: 12, eq: ['peso-corporal'], eqo: ['rocodromo', 'gomas'],
    setup: 'Un espacio libre. Empieza con intensidad muy baja.',
    steps: [['Activa', 'Cinco minutos de movimiento suave: marcha, círculos de brazos y sentadillas sin carga.'], ['Moviliza', 'Hombros, muñecas, caderas y tobillos en todo su rango.'], ['Prepara los dedos', 'Escalada muy fácil o suspensiones suaves, aumentando poco a poco.'], ['Sube la intensidad', 'Acércate poco a poco al esfuerzo de la sesión.']],
    mis: [['Calentar muy deprisa', 'Aumenta la intensidad de forma gradual.']],
    done: ['Cuerpo caliente y articulaciones móviles'], stop: [DOLOR],
    rx: RX.mobility(1, 120, 0),
    rel: { rel: [['vuelta-calma', 'Cierre de la sesión.']] }
  });
  ex('vuelta-calma', 'Vuelta a la calma', 'movilidad', {
    al: ['enfriamiento', 'cool down', 'recuperación', 'estiramientos finales'],
    desc: 'Cierre suave de la sesión con movimientos tranquilos y respiración.',
    purpose: 'Bajar el ritmo de forma gradual y favorecer la recuperación.',
    ab: ['movilidad'], body: ['espalda', 'hombros', 'piernas', 'antebrazo'], pat: ['dinamico'], ctx: ['recuperacion'],
    tl: 1, pd: 1, min: 8, eq: ['peso-corporal'],
    setup: 'Un lugar tranquilo.',
    steps: [['Baja el ritmo', 'Camina o escala muy suave durante unos minutos.'], ['Estira con suavidad', 'Antebrazos, hombros y piernas sin forzar.'], ['Respira', 'Respiraciones profundas hasta recuperar el ritmo.']],
    mis: [['Estirar con dolor', 'Busca una tensión suave y mantenida.']],
    done: ['Ritmo cardíaco normalizado'], stop: [DOLOR],
    rx: RX.mobility(1, 60, 0),
    rel: { rel: [['estiramiento-muneca', 'Estiramiento de antebrazo.']] }
  });
  ex('estiramiento-muneca', 'Estiramiento de muñecas', 'movilidad', {
    al: ['estiramiento muñecas', 'estiramiento de antebrazos', 'flexores y extensores'],
    desc: 'Estirar flexores y extensores de muñeca y antebrazo.',
    purpose: 'Aliviar la tensión del antebrazo y mantener el rango de muñeca.',
    ab: ['movilidad'], body: ['antebrazo'], pat: ['isometrico'], ctx: ['recuperacion', 'calentamiento'],
    tl: 1, pd: 1, min: 4, eq: ['peso-corporal'],
    setup: 'De pie o sentado.',
    steps: [['Extiende el brazo', 'Palma hacia arriba o hacia abajo.'], ['Tira con la otra mano', 'Lleva los dedos hacia atrás con suavidad.'], ['Mantén', 'Una tensión suave y sin dolor.']],
    mis: [['Estirar con fuerza', 'La tensión debe ser suave.']],
    done: ['Estiramiento mantenido sin dolor'], stop: [DOLOR, 'Hormigueo.'],
    rx: RX.mobility(2, 30, 10),
    rel: { rel: [['extensores-muneca', 'Fortalecimiento del antebrazo.']] }
  });

  // ═══ 10. FUERZA GENERAL Y ACONDICIONAMIENTO ═══
  ex('sentadilla', 'Sentadilla', 'general', {
    al: ['sentadillas', 'squat', 'sentadilla con barra'],
    desc: 'Flexionar cadera y rodillas para bajar y subir con control.',
    purpose: 'Desarrollar la fuerza de piernas y glúteos como base general.',
    ab: ['fuerza-maxima'], body: ['piernas', 'caderas', 'core'], pat: ['empuje'], ctx: ['principal'],
    tl: 1, pd: 2, min: 15, eq: ['peso-corporal'], eqo: ['pesas'],
    setup: 'Pies a la anchura de los hombros y puntas ligeramente abiertas.',
    steps: [['Colócate', 'Pecho alto y mirada al frente.'], ['Baja', 'Cadera atrás y rodillas alineadas con los pies.'], ['Sube', 'Empuja el suelo y estira cadera y rodillas.']],
    mis: [['Rodillas hacia dentro', 'Empújalas ligeramente hacia fuera.'], ['Espalda redondeada', 'Mantén el pecho alto.']],
    done: ['Profundidad cómoda con técnica estable'], stop: [DOLOR, 'Dolor en rodilla o espalda baja.'],
    rx: RX.reps(3, 8, 90, 6),
    rel: { alt: [['zancadas', 'Patrón unilateral.']], prog: [['sentadilla-bulgara', 'Mayor exigencia.']] }
  });
  ex('peso-muerto', 'Peso muerto', 'general', {
    al: ['deadlift', 'peso muerto rumano'],
    desc: 'Levantar una carga del suelo extendiendo cadera y rodillas.',
    purpose: 'Fortalecer la cadena posterior: espalda, glúteos y piernas.',
    ab: ['fuerza-maxima'], body: ['espalda', 'caderas', 'piernas', 'core'], pat: ['traccion'], ctx: ['principal'],
    tl: 2, pd: 3, min: 15, eq: ['pesas'],
    setup: 'Barra o mancuernas en el suelo. Pies bajo la cadera.',
    steps: [['Colócate', 'Barra cerca de las espinillas, espalda neutra.'], ['Levanta', 'Empuja con las piernas y estira la cadera.'], ['Baja con control', 'Deja la carga en el suelo manteniendo la espalda recta.']],
    mis: [['Espalda redondeada', 'Mantén la espalda neutra y reduce la carga.']],
    done: ['Series con la espalda neutra'], stop: [DOLOR, 'Dolor lumbar.'],
    rx: RX.reps(3, 6, 120, 7),
    rel: { reg: [['sentadilla', 'Menos exigente técnicamente.']] },
    warn: ['La técnica es importante: empieza con poca carga.'], minLevel: 2
  });
  ex('flexiones', 'Flexiones', 'general', {
    al: ['flexión', 'push up', 'pushups', 'push-up'],
    desc: 'Empujar el suelo con los brazos, manteniendo el cuerpo recto.',
    purpose: 'Equilibrar la tracción con empuje de pecho, hombros y tríceps.',
    ab: ['fuerza-maxima', 'control-corporal'], body: ['hombros', 'core'], pat: ['empuje'], ctx: ['principal', 'accesorio'],
    tl: 1, pd: 2, min: 8, eq: ['peso-corporal'],
    setup: 'Manos algo más abiertas que los hombros.',
    steps: [['Colócate en plancha', 'Cuerpo recto de la cabeza a los pies.'], ['Baja', 'Pecho hacia el suelo con codos a unos 45°.'], ['Sube', 'Empuja el suelo hasta estirar los brazos.']],
    mis: [['Caderas caídas', 'Aprieta abdomen y glúteos.']],
    done: ['Recorrido completo con el cuerpo recto'], stop: [DOLOR, 'Dolor en muñecas u hombros.'],
    rx: RX.bodyReps(3, 10, 60, 6),
    rel: { prog: [['press-banca', 'Con carga.']] }
  });
  ex('press-banca', 'Press de empuje', 'general', {
    al: ['press', 'press de banca', 'press con mancuernas', 'bench press'],
    desc: 'Empujar una carga desde el pecho estando tumbado en un banco.',
    purpose: 'Trabajar el empuje con carga para equilibrar la fuerza de tracción.',
    ab: ['fuerza-maxima'], body: ['hombros', 'core'], pat: ['empuje'], ctx: ['principal', 'accesorio'],
    tl: 2, pd: 3, min: 15, eq: ['pesas'],
    setup: 'Banco estable y mancuernas o barra. Ayuda de una persona si usas carga alta.',
    steps: [['Colócate', 'Espalda apoyada y pies firmes en el suelo.'], ['Baja la carga', 'Hasta el pecho con control.'], ['Empuja', 'Estira los brazos sin bloquear con fuerza los codos.']],
    mis: [['Rebotar la carga', 'Controla la bajada.']],
    done: ['Series con recorrido controlado'], stop: [DOLOR, 'Dolor en el hombro.'],
    rx: RX.reps(3, 8, 120, 7),
    rel: { reg: [['flexiones', 'Sin carga externa.']] }, minLevel: 2
  });
  ex('sentadilla-bulgara', 'Sentadilla búlgara', 'general', {
    al: ['sentadilla unilateral', 'bulgarian split squat', 'ejercicios unilaterales'],
    desc: 'Sentadilla con el pie trasero elevado sobre un banco.',
    purpose: 'Fortalecer cada pierna por separado y mejorar el equilibrio.',
    ab: ['fuerza-maxima', 'control-corporal'], body: ['piernas', 'caderas'], pat: ['unilateral', 'empuje'], ctx: ['principal'],
    cats: ['piernas'],
    tl: 2, pd: 2, min: 12, eq: ['peso-corporal'], eqo: ['pesas'],
    setup: 'Un banco o escalón estable detrás de ti.',
    steps: [['Colócate', 'Apoya el empeine trasero en el banco.'], ['Baja', 'Flexiona la rodilla delantera con el tronco erguido.'], ['Sube', 'Empuja con el pie delantero.']],
    mis: [['Pie delantero muy cerca del banco', 'Da un paso más largo.']],
    done: ['Repeticiones controladas en ambas piernas'], stop: [DOLOR, 'Dolor en la rodilla.'],
    rx: RX.bodyReps(3, 8, 90, 6, [P('externalLoadKg', 0, 0, 60, 0.5)]),
    rel: { reg: [['zancadas', 'Más sencillo.']], prog: [['pistol-asistida', 'A una pierna con recorrido completo.']] }
  });
  ex('acondicionamiento-cardio', 'Acondicionamiento cardiovascular', 'general', {
    al: ['cardio', 'correr', 'bici', 'trote', 'aeróbico'],
    desc: 'Actividad continua de intensidad moderada: correr, bicicleta, remo, etc.',
    purpose: 'Mejorar la base aeróbica y la recuperación entre esfuerzos.',
    ab: ['resistencia'], body: ['piernas', 'core'], pat: ['locomocion'], ctx: ['principal', 'recuperacion'],
    tl: 1, pd: 1, min: 30, eq: ['peso-corporal'],
    setup: 'Elige la actividad que prefieras y un ritmo con el que puedas hablar.',
    steps: [['Empieza suave', 'Cinco minutos de ritmo fácil.'], ['Mantén el ritmo', 'Intensidad moderada sostenida.'], ['Termina con calma', 'Reduce el ritmo los últimos minutos.']],
    mis: [['Ir demasiado fuerte', 'Debes poder mantener una conversación.']],
    done: ['Tiempo completado a ritmo cómodo'], stop: [DOLOR, 'Mareo o dolor en el pecho.'],
    rx: RX.endurance(1, 1800, 0, 4),
    rel: { alt: [['arc', 'Resistencia específica en pared.']] }
  });

  const DATA = { schemaVersion: 1, categories: CATEGORIES, equipment: EQUIPMENT, exercises: EXERCISES };
  if (typeof module === 'object' && module.exports) module.exports = DATA;
  else root.KRUX_CATALOG_DATA = DATA;
}(typeof self !== 'undefined' ? self : this));

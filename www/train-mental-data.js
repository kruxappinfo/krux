// ================== ENTRENA — CATÁLOGO BASE DE ENTRENAMIENTO MENTAL ==================
// Datos empaquetados (funcionan sin conexión). Primera entrega: 27 contenidos (10 lecciones y 17 ejercicios guiados).
// Para añadir un contenido basta una entrada nueva en LESSONS o EXERCISES: la interfaz leerá este catálogo.
//
// CONTENIDO ORIENTATIVO, PENDIENTE DE REVISIÓN PROFESIONAL. Es educativo y deportivo: no es un diagnóstico, no es
// terapia y no sustituye la formación técnica de seguridad ni la supervisión de una persona cualificada.
// Todas las entradas llevan review.status = 'pending' hasta que las revise una persona cualificada.
//
// ESQUEMA (schemaVersion 1)
//   Común        id, type ('lesson'|'exercise'), title, categoryId, objective, durationMin, durationLabel,
//                moments[] ('antes'|'durante'|'despues'), environments[] ('rocodromo'|'roca'),
//                precautions[], safetyLevel ('none'|'standard'|'reinforced'), related[] (ids), contentVersion, status,
//                review { status:'pending'|'reviewed', reviewedBy, reviewedAt }
//   Lección      introduction, explanation, application, recommendations[], summary
//   Ejercicio    dimension (= categoryId), description, steps[], difficulty (1-3), completionCriteria,
//                reflectionQuestions[], variants? { roca }
// safetyLevel 'reinforced': nunca proponer provocar caídas ni sustituir formación técnica o supervisión.
// Fase 2 (biblioteca) leerá este archivo; todavía no está cargado por la aplicación.
(function (root) {
  'use strict';

  const DISCLAIMER = 'Contenido orientativo, pendiente de revisión profesional. Es educativo y deportivo: no es un diagnóstico, ' +
    'no es terapia y no sustituye la formación técnica de seguridad ni la supervisión de una persona cualificada.';

  const CATEGORIES = [
    { id: 'miedo', order: 1, name: 'Miedo y confianza', icon: 'shield', description: 'Entender el miedo a caer y construir confianza con criterio y seguridad.' },
    { id: 'concentracion', order: 2, name: 'Concentración', icon: 'focus', description: 'Leer, preparar y mantener la atención al escalar.' },
    { id: 'frustracion', order: 3, name: 'Frustración y fracaso', icon: 'wave', description: 'Aprender de los intentos fallidos y decidir cuándo insistir o parar.' },
    { id: 'confianza', order: 4, name: 'Confianza personal', icon: 'user', description: 'Reconocer fortalezas y avanzar con autonomía.' },
    { id: 'presion', order: 5, name: 'Presión y decisiones', icon: 'bolt', description: 'Escalar con público, afrontar intentos importantes y decidir con calma.' },
    { id: 'motivacion', order: 6, name: 'Motivación y constancia', icon: 'route', description: 'Mantener un ritmo sostenible y conectar con tus motivos.' },
    { id: 'emocional', order: 7, name: 'Gestión emocional', icon: 'flow', description: 'Reconocer y regular las emociones al escalar.' }
  ];

  const MOMENTS = { antes: 'Antes de escalar', durante: 'Durante la escalada', despues: 'Después de escalar' };
  const ENVIRONMENTS = { rocodromo: 'Rocódromo', roca: 'Roca' };
  const BOTH = ['rocodromo', 'roca'];
  const PENDING = { status: 'pending', reviewedBy: null, reviewedAt: null };

  const lesson = o => Object.assign({ type: 'lesson', environments: BOTH, safetyLevel: 'none', related: [], contentVersion: 1, status: 'published', review: PENDING }, o);
  const exercise = o => Object.assign({ type: 'exercise', dimension: o.categoryId, environments: BOTH, safetyLevel: 'none', related: [], contentVersion: 1, status: 'published', review: PENDING }, o);

  // ─────────────────────────── LECCIONES ───────────────────────────
  const LESSONS = [
    lesson({
      id: 'm01-miedo-a-caer', title: 'El miedo a caer: qué es y para qué sirve', categoryId: 'miedo', durationMin: 4, durationLabel: '4 min',
      moments: ['antes'], safetyLevel: 'standard', related: ['m05-respiracion-ante-el-miedo', 'm02-riesgo-real-y-miedo-percibido'],
      objective: 'Entender el miedo a caer como una señal útil del cuerpo y no como un defecto.',
      introduction: 'Casi todas las personas que escalan sienten miedo en algún momento. No significa que escales mal ni que no sirvas para esto.',
      explanation: 'El miedo es una respuesta de alerta: acelera el pulso, tensa los músculos y estrecha la atención. Su función es que prestes atención a un posible riesgo. El problema aparece cuando la alarma es más fuerte que el riesgo real: entonces te agarrota, te hace escalar con rigidez y puede empeorar tu movimiento.',
      application: 'En la pared el miedo suele notarse como brazos rígidos, respiración corta, mirada fija hacia abajo o ganas de agarrarte «por si acaso». Notarlo a tiempo es el primer paso para decidir qué hacer.',
      recommendations: [
        'Ponle nombre: «noto miedo».',
        'Pregúntate qué te avisa: ¿hay algo que revisar (material, aseguramiento, condiciones) o es una sensación?',
        'Si hay un riesgo real, actúa sobre él antes de seguir.',
        'Si no lo hay, usa una herramienta de calma (ver «Respiración ante el miedo»).',
        'Avanza por pasos pequeños y con tu compañero informado.'
      ],
      summary: 'El miedo avisa; tú decides qué haces con el aviso. Escucharlo y revisar los hechos funciona mejor que ignorarlo o pelearte con él.',
      precautions: [
        'No te expongas a caídas ni a situaciones de riesgo para «perder el miedo».',
        'Este contenido no sustituye formación técnica ni supervisión.',
        'Si el miedo es muy intenso o limita tu vida diaria, consulta con un profesional.'
      ]
    }),
    lesson({
      id: 'm02-riesgo-real-y-miedo-percibido', title: 'Riesgo real frente a miedo percibido', categoryId: 'miedo', durationMin: 5, durationLabel: '5 min',
      moments: ['antes'], safetyLevel: 'standard', related: ['m01-miedo-a-caer', 'd05-cuando-abandonar-un-intento'],
      objective: 'Distinguir el peligro objetivo de la sensación de peligro para decidir con más claridad.',
      introduction: 'Dos situaciones pueden dar el mismo miedo y tener riesgos muy distintos.',
      explanation: 'El riesgo en escalada no depende de una única variable. Para valorarlo hay que tener en cuenta las condiciones del entorno, el estado del material, la protección, la competencia técnica de las personas implicadas y el contexto concreto. La sensación de peligro puede coincidir con un riesgo real, ser mayor o ser menor. Ninguna de las dos cosas debe ignorarse: sentir miedo no demuestra por sí solo que exista un peligro, y sentirse tranquilo tampoco demuestra que una situación sea segura.',
      application: 'Antes de empezar, separa lo que has comprobado de lo que estás sintiendo. Revisa las condiciones y los elementos de seguridad dentro de lo que sabes hacer. Si tienes dudas sobre algo que excede tus conocimientos, consulta a una persona cualificada o elige otra vía.',
      recommendations: [
        'Dilo en voz alta con tu compañero: «lo que sé es…», «lo que siento es…».',
        'Si un hecho te preocupa, no lo rebajes: revísalo o elige otra vía.',
        'Pide la opinión de una persona con más experiencia o de quien conozca la zona.',
        'En roca, consulta guías y condiciones antes de salir.'
      ],
      summary: 'Los hechos dicen qué es seguro; las sensaciones dicen cómo estás. Las dos importan, pero no son lo mismo.',
      precautions: [
        'Sentir calma no garantiza que sea seguro, y sentir miedo no siempre indica peligro.',
        'Esta lección no sustituye la valoración de riesgos de una persona formada, ni la formación técnica, ni la supervisión de una persona cualificada.'
      ]
    }),
    lesson({
      id: 'm03-confianza-en-las-maniobras-de-seguridad', title: 'Confianza en las maniobras de seguridad', categoryId: 'miedo', durationMin: 5, durationLabel: '5 min',
      moments: ['antes'], safetyLevel: 'reinforced', related: ['m04-rutina-de-comprobacion', 'm01-miedo-a-caer'],
      objective: 'Entender de dónde sale una confianza razonable en tu sistema de seguridad y cómo reforzarla de forma correcta.',
      introduction: 'Escalar con tranquilidad depende en parte de confiar en el sistema que te asegura. Esa confianza debe apoyarse en formación y comprobación, no en las ganas.',
      explanation: 'La confianza razonable se construye con cuatro pilares: haber aprendido las maniobras con una persona o curso cualificado; practicarlas en situaciones controladas; comprobar siempre el sistema antes de empezar; y comunicarte bien con tu compañero. Si falta alguno, la mente lo nota y aparece la duda. Esa duda es información útil.',
      application: 'Si te cuesta confiar, no intentes «pensar en positivo». Pregúntate qué te falta saber o practicar, qué comprobación no haces y con quién puedes repasarlo. Responder con acciones concretas calma más que animarte.',
      recommendations: [
        'Repasa tus dudas con un instructor, un club o una escuela.',
        'Practica con alguien de confianza y siempre en un entorno controlado.',
        'Acordad las señales y la forma de comunicaros.',
        'Si no confías en el sistema o en quien te asegura, no escales hasta resolverlo.'
      ],
      summary: 'La confianza en la seguridad se gana con formación, práctica y comprobación; no se fabrica con ánimo.',
      precautions: [
        'Este contenido no enseña ni sustituye ninguna técnica de seguridad ni formación oficial.',
        'No pruebes maniobras ni «caídas de prueba» para ganar confianza sin la supervisión de una persona cualificada.',
        'Ante la duda, para y pide ayuda.'
      ]
    }),
    lesson({
      id: 'f01-intentos-fallidos', title: 'Intentos fallidos: qué te dicen y qué no', categoryId: 'frustracion', durationMin: 4, durationLabel: '4 min',
      moments: ['despues'], related: ['f02-ficha-de-analisis-de-un-intento', 'f04-fatiga-y-frustracion'],
      objective: 'Interpretar un intento fallido como información, no como juicio sobre ti.',
      introduction: 'Cuando un intento no sale, es fácil vivirlo como un fracaso personal.',
      explanation: 'Un intento fallido te informa de una secuencia, un reposo, un agarre o tu estado ese día (cansancio, condiciones, nervios, hora). No dice nada sobre tu valor como persona ni predice que no podrás. Un mismo fallo puede tener muchas causas.',
      application: 'Tras un fallo, separa hechos («me solté en el tercer paso») de juicios («soy un desastre»).',
      recommendations: [
        'Espera unos minutos antes de analizar.',
        'Anota un hecho, una causa probable y un ajuste.',
        'Pregúntate si el objetivo era realista para hoy.',
        'Recuerda intentos previos que mejoraron con práctica.'
      ],
      summary: 'Un intento fallido es un dato: sirve para aprender, no para etiquetarte.',
      precautions: [
        'Si el malestar tras los fallos es persistente (tristeza o ansiedad intensas, ganas de dejar de escalar), considera hablarlo con un profesional.',
        'Esto no es un diagnóstico.'
      ]
    }),
    lesson({
      id: 'f04-fatiga-y-frustracion', title: 'Fatiga y frustración: ¿insistir o parar?', categoryId: 'frustracion', durationMin: 4, durationLabel: '4 min',
      moments: ['durante'], related: ['d05-cuando-abandonar-un-intento', 'g02-exhalacion-larga-entre-movimientos', 'f05-objetivos-de-proceso'],
      objective: 'Decidir si seguir o parar según tu estado físico y emocional. Los criterios de seguridad para abandonar un intento (condiciones, material, posición) están en «Decidir cuándo abandonar un intento: criterios de seguridad» y tienen prioridad.',
      introduction: 'Insistir un poco puede ayudar. Insistir sin criterio suele empeorar el intento y aumentar la frustración.',
      explanation: 'Señales de fatiga: antebrazos que no recuperan, errores técnicos repetidos, pérdida de precisión. Señales de frustración: rabia, apretar de más, repetir lo mismo sin cambiar nada, el pensamiento «tiene que salir ya».',
      application: 'No existe un número universal de intentos a partir del cual debas parar. Observa cómo evoluciona tu estado: si recuperas entre intentos, mantienes la precisión y sigues tomando buenas decisiones, puedes continuar si las condiciones lo permiten. Si la fatiga se acumula, empeora la calidad de tus movimientos o la frustración te lleva a repetir intentos sin criterio, descansa, cambia de actividad o termina la sesión.',
      recommendations: [
        'Decide tus descansos según la intensidad del intento y tu recuperación. No continúes únicamente porque te hayas marcado un número de intentos.',
        'Descansa lo necesario para recuperar el pulso y los antebrazos.',
        'Si notas rabia, haz una pausa antes de reintentar (ver «Objetivos de proceso, no solo de resultado» y «Exhalación larga entre movimientos»).'
      ],
      summary: 'Parar a tiempo es parte del entrenamiento, no una derrota.',
      precautions: [
        'La fatiga aumenta el riesgo de errores y de lesión.',
        'Si notas dolor articular o tendinoso, para y consulta con un profesional sanitario.',
        'Los criterios de seguridad para abandonar un intento tienen prioridad sobre esta lección.'
      ]
    }),
    lesson({
      id: 'd01-escalar-delante-de-otras-personas', title: 'Escalar delante de otras personas', categoryId: 'presion', durationMin: 4, durationLabel: '4 min',
      moments: ['antes'], related: ['d04-calmar-el-cuerpo-antes-del-intento', 'd03-plan-para-un-intento-importante'],
      objective: 'Entender qué cambia cuando te observan y cómo prepararte.',
      introduction: 'Escalar con público puede cambiar tu forma de moverte, aunque nadie te esté juzgando.',
      explanation: 'Sentirte observado divide tu atención: parte se va a cómo te ven y menos a lo que haces. Aparecen tensión, prisa y ganas de «quedar bien».',
      application: 'Ocurre en el rocódromo (amistades, público) y en roca (grupo esperando, cámaras).',
      recommendations: [
        'Elige qué parte controlas: tu plan, tu respiración, tu rutina.',
        'Recuerda que la mayoría de la gente está atenta a lo suyo.',
        'Cuéntale a tu compañero qué necesitas.',
        'Empieza por intentos con poca audiencia y ve subiendo.'
      ],
      summary: 'La presión social se gestiona volviendo a lo que controlas.',
      precautions: ['La presión de las demás personas nunca debe llevarte a asumir riesgos ni a saltarte comprobaciones de seguridad.']
    }),
    lesson({
      id: 'd05-cuando-abandonar-un-intento', title: 'Decidir cuándo abandonar un intento: criterios de seguridad', categoryId: 'presion', durationMin: 5, durationLabel: '5 min',
      moments: ['durante'], safetyLevel: 'standard', related: ['d06-tres-decisiones-antes-de-empezar', 'f04-fatiga-y-frustracion', 'm08-protocolo-ante-un-bloqueo'],
      objective: 'Conocer los criterios objetivos de seguridad que justifican abandonar un intento. Cómo gestionar la fatiga o la frustración está en «Fatiga y frustración: ¿insistir o parar?».',
      introduction: 'Abandonar un intento por seguridad es una buena decisión, no un fracaso.',
      explanation: 'Son motivos para parar: algo no está como esperabas con el material o el sistema de aseguramiento; las condiciones cambian (lluvia, viento, humedad, tormenta, oscuridad); apoyos o roca dudosos, o protección insuficiente o poco clara; la comunicación con tu compañero falla; sientes pérdida de control o pánico; notas un dolor súbito. Estas señales prevalecen sobre cualquier objetivo. Detectar una señal de riesgo no significa que debas improvisar una maniobra para salir de la situación. La forma de detener el intento o resolver el problema depende de tu posición, del sistema utilizado y de la formación técnica que hayas recibido.',
      application: 'Define tus criterios de parada antes de empezar (ver «Tres decisiones antes de empezar») y respétalos sin negociar en caliente.',
      recommendations: [
        'Comunica la situación con claridad a tu compañero.',
        'No improvises maniobras ni soluciones técnicas que no domines.',
        'Actúa siguiendo los procedimientos que has aprendido y pide ayuda cuando sea necesario.',
        'No permitas que el objetivo de encadenar, la presión del grupo o el tiempo invertido pesen más que la seguridad.'
      ],
      summary: 'La seguridad manda: ningún proyecto justifica ignorar una señal.',
      precautions: [
        'No sustituye la formación ni el criterio de personas cualificadas.',
        'En roca, consulta la previsión y las guías de la zona.'
      ]
    }),
    lesson({
      id: 't03-constancia-sin-obsesion', title: 'Constancia sin obsesión', categoryId: 'motivacion', durationMin: 4, durationLabel: '4 min',
      moments: ['despues'], related: ['t01-por-que-escalas'],
      objective: 'Mantener un ritmo sostenible sin pasarte.',
      introduction: 'Constancia es regularidad, no hacer cuanto más mejor.',
      explanation: 'Señales de exceso: cansancio persistente, molestias que no ceden, irritabilidad, entrenar con dolor, culpa por descansar. El descanso forma parte del entrenamiento.',
      application: 'Planifica días de descanso y respeta las semanas más ligeras.',
      recommendations: [
        'Programa tus descansos igual que tus sesiones.',
        'Si una molestia dura varios días, baja la carga.',
        'Prefiere sesiones de calidad a más sesiones.'
      ],
      summary: 'Escalar mucho tiempo gana a escalar mucho de golpe.',
      precautions: ['El dolor persistente requiere valoración de un profesional sanitario.', 'Esto no es un diagnóstico.']
    }),
    lesson({
      id: 'g01-emociones-en-la-pared', title: 'Emociones en la pared', categoryId: 'emocional', durationMin: 5, durationLabel: '5 min',
      moments: ['durante'], related: ['g02-exhalacion-larga-entre-movimientos', 'g03-relajacion-rapida'],
      objective: 'Reconocer las emociones que aparecen al escalar y qué hacen con tu movimiento.',
      introduction: 'Escalar activa emociones: ansiedad, rabia, euforia, aburrimiento. Todas son normales.',
      explanation: 'Las emociones pueden influir en cómo escalas. La ansiedad puede aumentar la tensión, la rabia puede llevarte a hacer movimientos precipitados y la euforia puede reducir tu percepción del riesgo en determinadas situaciones. No ocurre siempre ni de la misma manera en todas las personas. Reconocer cómo te afecta cada emoción te ayuda a decidir con más claridad.',
      application: 'Aprende tus señales físicas: mandíbula, hombros, respiración, prisa.',
      recommendations: [
        'Nombra la emoción.',
        'Regúlala con una herramienta breve (ver «Exhalación larga entre movimientos» y «Relajación rápida de manos, antebrazos y hombros»).',
        'Después decide el siguiente paso.'
      ],
      summary: 'No se trata de eliminar emociones, sino de decidir con ellas presentes.',
      precautions: ['Si las emociones son muy intensas o frecuentes, o te limitan, considera hablar con un profesional.', 'Esto no es un diagnóstico.']
    }),
    lesson({
      id: 'g05-nerviosismo-previo', title: 'Gestionar el nerviosismo previo', categoryId: 'emocional', durationMin: 4, durationLabel: '4 min',
      moments: ['antes'], related: ['c03-rutina-previa-al-intento', 'm05-respiracion-ante-el-miedo'],
      objective: 'Llegar a la pared con una activación útil, sin intentar eliminar los nervios.',
      introduction: 'Notar nervios antes de escalar es habitual y no significa que vayas a fallar.',
      explanation: 'El nerviosismo es activación del cuerpo. Un poco ayuda a rendir; demasiada estorba. Intentar suprimirlo suele aumentarlo.',
      application: 'Cambia «tengo miedo» por «estoy activado» y usa tu rutina previa y la respiración.',
      recommendations: [
        'Acepta los nervios como parte de la preparación.',
        'Mantén una rutina previa constante.',
        'Céntrate en tu primer movimiento.'
      ],
      summary: 'Los nervios acompañan; tú decides hacia dónde miras.',
      precautions: ['Si el nerviosismo te impide escalar de forma habitual, considera consultar a un profesional.', 'Esto no es un diagnóstico.']
    })
  ];

  // ─────────────────────────── EJERCICIOS GUIADOS ───────────────────────────
  const EXERCISES = [
    exercise({
      id: 'm04-rutina-de-comprobacion', title: 'Rutina de comprobación antes de salir', categoryId: 'miedo', durationMin: 2, durationLabel: '2 min',
      moments: ['antes'], difficulty: 1, safetyLevel: 'reinforced', related: ['m03-confianza-en-las-maniobras-de-seguridad'],
      objective: 'Convertir en hábito tranquilo y constante la comprobación de seguridad que ya conoces.',
      description: 'Un ritual mental breve para no saltarte ninguna comprobación y para que la calma de hacerlo bien forme parte de tu preparación. El contenido de la lista lo marca tu formación; este ejercicio solo te ayuda a hacerla siempre igual.',
      steps: [
        'Para y respira una vez antes de empezar.',
        'Repasa, siempre en el mismo orden, la lista de comprobaciones que aprendiste en tu formación.',
        'Hazlo con tu compañero: cada uno revisa al otro y lo dice en voz alta.',
        'Si algo no te cuadra, no sigas: corrígelo o pide ayuda.',
        'Cuando todo está revisado, di una frase de cierre: «revisado, empezamos».'
      ],
      completionCriteria: 'Habéis repasado toda la lista y los dos estáis de acuerdo en empezar.',
      reflectionQuestions: ['¿Qué paso me salto con más facilidad?', '¿Cómo me siento después de hacerlo con calma?'],
      precautions: [
        'Esto no es una lista de seguridad ni sustituye tu formación.',
        'Si no tienes una lista aprendida, apúntate a un curso antes de escalar.',
        'Nunca la acortes por prisa o por presión.'
      ]
    }),
    exercise({
      id: 'm05-respiracion-ante-el-miedo', title: 'Respiración ante el miedo', categoryId: 'miedo', durationMin: 3, durationLabel: '2–3 min',
      moments: ['antes'], difficulty: 1, related: ['d04-calmar-el-cuerpo-antes-del-intento', 'g02-exhalacion-larga-entre-movimientos'],
      objective: 'Bajar la activación del miedo ante un tramo concreto que te impone, antes de empezarlo. No sirve para soltar tensión corporal ante público (ver «Calmar el cuerpo antes del intento») ni para regular emociones intensas en plena escalada (ver «Exhalación larga entre movimientos»).',
      description: 'Respiración pautada más un anclaje en lo que tocas, para llegar al tramo con el cuerpo más tranquilo y con un primer movimiento decidido.',
      steps: [
        'Colócate en una posición estable: en el suelo o en un reposo seguro.',
        'Inhala por la nariz contando 4.',
        'Exhala por la boca, despacio, contando 6.',
        'Repite 5 ciclos, notando tus pies y tus manos en contacto con el suelo o la pared.',
        'Pregúntate: «¿cuál es mi primer movimiento?» y decídelo.',
        'Empieza solo si estás de acuerdo con esa decisión.'
      ],
      completionCriteria: 'Has hecho 5 ciclos y has decidido tu primer movimiento.',
      reflectionQuestions: ['¿Qué cambió en mi cuerpo tras los ciclos?', '¿Mi miedo hablaba de un hecho o de una sensación?'],
      precautions: [
        'Respira con suavidad y sin forzar. No retengas la respiración.',
        'Si notas mareo, hormigueo o falta de aire, para y respira con normalidad.',
        'Hazlo solo en una posición estable (en el suelo o en un reposo seguro) y nunca mientras se maniobra con material.',
        'La calma no cambia el riesgo real: no la uses para obligarte a seguir si algo te parece inseguro; si no puedes continuar, para o baja (ver «Decidir cuándo abandonar un intento: criterios de seguridad»).',
        'Si tienes problemas respiratorios o cardiacos, consulta antes con un profesional sanitario.',
        'No es terapia ni tratamiento de la ansiedad.'
      ]
    }),
    exercise({
      id: 'm08-protocolo-ante-un-bloqueo', title: 'Protocolo ante un bloqueo', categoryId: 'miedo', durationMin: 2, durationLabel: '1–2 min',
      moments: ['durante'], difficulty: 2, safetyLevel: 'reinforced', related: ['d05-cuando-abandonar-un-intento', 'm03-confianza-en-las-maniobras-de-seguridad'],
      objective: 'Tener decidido de antemano un plan simple para cuando te quedes paralizado.',
      description: 'Un bloqueo es quedarte sin poder avanzar por miedo o tensión. Prepararlo en el suelo evita improvisar en caliente. La parte técnica la aprendes y practicas con tu formación; esto solo ordena tu decisión. Se prepara antes de escalar y se recuerda durante.',
      steps: [
        'Reconoce lo que ocurre: «Estoy bloqueado».',
        'Evita tomar decisiones precipitadas. Si puedes hacerlo sin comprometer tu posición, intenta recuperar la calma.',
        'Comunica a tu compañero cómo estás y qué necesitas, utilizando las señales acordadas.',
        'Valora la situación teniendo en cuenta tu posición, las condiciones y las maniobras que conoces.',
        'Decide cómo proceder únicamente dentro de lo que sabes hacer y de las indicaciones de seguridad que has aprendido. Si no sabes cómo continuar o resolver la situación, pide ayuda.',
        'No te obligues a seguir escalando por vergüenza, presión o miedo a decepcionar a alguien.'
      ],
      completionCriteria: 'Has comunicado el bloqueo y has tomado una decisión acorde con tu posición, tus conocimientos y las condiciones de seguridad.',
      reflectionQuestions: ['¿Qué señales noto justo antes de bloquearme?', '¿Qué decisión me costó más tomar?'],
      precautions: [
        'No es una técnica de seguridad. Prepara estas decisiones con un instructor.',
        'Nunca te obligues a continuar bloqueado ni improvises maniobras que no domines.',
        'Pedir ayuda o terminar el intento es siempre válido.',
        'En roca, valora además el entorno (clima, terreno, acceso) antes de decidir.'
      ]
    }),
    exercise({
      id: 'c01-lectura-de-via', title: 'Lectura de vía paso a paso', categoryId: 'concentracion', durationMin: 4, durationLabel: '3–5 min',
      moments: ['antes'], difficulty: 2, related: ['c02-visualizacion-de-una-via', 'c03-rutina-previa-al-intento'],
      objective: 'Observar la vía con orden antes de empezar para tener un plan claro.',
      description: 'Una lectura en pasos que convierte la mirada en un plan.',
      steps: [
        'Desde el suelo, mira la vía de abajo arriba, sin juzgar, unos 20 segundos.',
        'Localiza los reposos y las zonas clave (el paso más duro, los cambios de dirección).',
        'Divídela en 3 o 4 tramos y ponles nombre.',
        'En cada tramo decide agarres, mano y colocación de pies.',
        'Elige dónde descansarás y qué harás si el plan falla.',
        'Resume el plan en una frase y empieza.'
      ],
      variants: { roca: 'En roca, añade orientación, tipo de roca, humedad y posibles descansos. Si ves mal desde el suelo, prueba otro ángulo.' },
      completionCriteria: 'Tienes la vía dividida en tramos y has decidido dónde descansar.',
      reflectionQuestions: ['¿En qué coincidió mi plan con la realidad?', '¿Qué me sorprendió?'],
      precautions: [
        'Lee también las condiciones (roca húmeda, protección, zona de caída). Si algo no te encaja, cambia de vía.',
        'No dejes que el plan te haga escalar con rigidez: adáptalo.'
      ]
    }),
    exercise({
      id: 'c02-visualizacion-de-una-via', title: 'Visualización de una vía', categoryId: 'concentracion', durationMin: 4, durationLabel: '3–5 min',
      moments: ['antes'], difficulty: 2, related: ['c01-lectura-de-via'],
      objective: 'Preparar mentalmente una secuencia antes de escalar.',
      description: 'Imaginar la vía de forma realista, a ritmo real y con sensaciones corporales. Puedes cerrar los ojos e imaginar también lo que notarías (el tacto de los agarres, el esfuerzo, tu respiración).',
      steps: [
        'Observa la vía.',
        'Identifica movimientos y reposos.',
        'Imagínate la secuencia de forma realista, a la velocidad a la que la harás.',
        'Identifica posibles dificultades y qué harías en cada una.',
        'Comienza el intento con un objetivo concreto.'
      ],
      completionCriteria: 'Has recorrido mentalmente toda la vía y tienes un objetivo para el intento.',
      reflectionQuestions: ['¿En qué tramo se me hizo difícil imaginar?', '¿Qué me dice eso sobre qué leer mejor?'],
      precautions: [
        'La visualización no sustituye al entrenamiento físico ni técnico.',
        'Si la imagen te genera angustia, vuelve a la respiración y a la lectura.',
        'No imagines maniobras que no hayas aprendido.'
      ]
    }),
    exercise({
      id: 'c03-rutina-previa-al-intento', title: 'Rutina previa al intento', categoryId: 'concentracion', durationMin: 2, durationLabel: '2 min',
      moments: ['antes'], difficulty: 1, related: ['g05-nerviosismo-previo', 'c01-lectura-de-via'],
      objective: 'Entrar siempre igual en cada intento para llegar con foco.',
      description: 'Una mini-rutina de tres gestos que repites antes de cada intento.',
      steps: [
        'Respira: una exhalación larga.',
        'Objetivo: una frase corta («pies precisos en el primer tramo»).',
        'Señal de inicio: un gesto fijo (por ejemplo, frotarte las manos o tocar la pared).',
        'Repite la misma rutina antes de cada intento.'
      ],
      completionCriteria: 'La haces sin pensarla, durante toda la sesión.',
      reflectionQuestions: ['¿La rutina me calma o me acelera?', '¿Qué gesto me funciona mejor?'],
      precautions: [
        'Las comprobaciones de seguridad van antes que la rutina y nunca se acortan.',
        'No alargues la rutina hasta enfriarte.'
      ]
    }),
    exercise({
      id: 'c04-atencion-a-los-apoyos', title: 'Atención a los apoyos', categoryId: 'concentracion', durationMin: 8, durationLabel: '5–10 min (dentro del calentamiento)',
      moments: ['durante'], difficulty: 1, related: ['c05-volver-al-presente-tras-un-error'],
      objective: 'Dirigir tu atención a dónde colocas los pies y cómo los cargas.',
      description: 'Escalar vías o bloques fáciles con un único foco: los pies.',
      steps: [
        'Elige un itinerario claramente fácil y controlado para ti, en el que puedas concentrarte en la colocación de los pies sin que la dificultad física o técnica te distraiga.',
        'Antes de mover una mano, mira el pie y elige el apoyo.',
        'Colócalo con precisión, mirándolo hasta que haga contacto.',
        'Traslada el peso sobre ese pie antes de mover la mano.',
        'Si te distraes, vuelve al paso 2.',
        'Repite en 4–6 ascensos. Reto opcional: «pies silenciosos», sin ruido al pisar.'
      ],
      completionCriteria: 'Completaste al menos 4 ascensos con la atención en los pies.',
      reflectionQuestions: ['¿Qué apoyo se me escapa más?', '¿Qué cambia cuando miro el pie antes de moverme?'],
      precautions: [
        'Elige itinerarios que domines y un aseguramiento en el que confíes.',
        'En roca, comprueba que el apoyo está firme antes de confiar en él.'
      ]
    }),
    exercise({
      id: 'c05-volver-al-presente-tras-un-error', title: 'Volver al presente tras un error', categoryId: 'concentracion', durationMin: 1, durationLabel: '1 min',
      moments: ['durante'], difficulty: 1, related: ['c04-atencion-a-los-apoyos'],
      objective: 'Recuperar el foco tras un fallo sin quedarte atrapado en él.',
      description: 'Un «ancla» de tres pasos para usar en la pared. Practica los tres pasos después de recordar un error habitual o al terminar un intento fácil. No necesitas provocar fallos ni realizar movimientos incorrectos deliberadamente para entrenar esta habilidad.',
      steps: [
        'Nombra el error sin adjetivos: «el pie se resbaló».',
        'Respira una vez y suelta una parte tensa (por ejemplo, la mano libre).',
        'Decide: «¿cuál es mi siguiente movimiento?» y hazlo.'
      ],
      completionCriteria: 'Aplicas los tres pasos en menos de 10 segundos.',
      reflectionQuestions: ['¿Qué pensamiento aparece justo después de un error?'],
      precautions: [
        'Si el error afecta a tu seguridad (material, posición inestable), resuélvelo primero.',
        'No ignores una señal de seguridad por «mantener el foco».'
      ]
    }),
    exercise({
      id: 'f02-ficha-de-analisis-de-un-intento', title: 'Ficha de análisis de un intento', categoryId: 'frustracion', durationMin: 5, durationLabel: '5 min',
      moments: ['despues'], difficulty: 1, related: ['f01-intentos-fallidos', 'd05-cuando-abandonar-un-intento'],
      objective: 'Sacar una enseñanza concreta de un intento.',
      description: 'Cinco preguntas para convertir lo ocurrido en un ajuste.',
      steps: [
        'Qué pasó (el hecho, sin juicios).',
        'En qué punto (movimiento concreto).',
        'Qué influyó: físico, técnico, mental, condiciones.',
        'Qué cambiaré en el próximo intento (una sola cosa).',
        'Qué hice bien.'
      ],
      completionCriteria: 'Has anotado un único ajuste concreto.',
      reflectionQuestions: ['¿Qué parte me costó más escribir sin juzgarme?'],
      precautions: [
        'Analiza intentos, no personas. Si el análisis te hace sentir peor, déjalo para otro momento.',
        'No uses esta ficha para decidir si es seguro reintentar: eso se decide con criterios de seguridad (ver «Decidir cuándo abandonar un intento: criterios de seguridad»).'
      ]
    }),
    exercise({
      id: 'f05-objetivos-de-proceso', title: 'Objetivos de proceso, no solo de resultado', categoryId: 'frustracion', durationMin: 3, durationLabel: '3 min',
      moments: ['antes'], difficulty: 1, related: ['f04-fatiga-y-frustracion', 'd03-plan-para-un-intento-importante'],
      objective: 'Fijar metas que dependan de ti, para valorar la sesión más allá de si encadenas.',
      description: 'Pasar de «¿lo encadeno?» a «¿hice lo que dependía de mí?».',
      steps: [
        'Escribe tu objetivo de resultado (por ejemplo, encadenar la vía).',
        'Escribe dos objetivos de proceso que dependan de ti: «respirar en cada reposo», «mirar los pies antes de moverlos», «esperar 5 segundos antes del paso clave».',
        'Elige uno para este intento.',
        'Al terminar, valóralo con sí o no, sin importar el resultado.'
      ],
      completionCriteria: 'Elegiste un objetivo de proceso y lo valoraste al acabar.',
      reflectionQuestions: ['¿Cómo cambia mi sensación si valoro el proceso y no solo el resultado?'],
      precautions: ['Un objetivo de proceso nunca debe implicar asumir riesgos («no soltarme pase lo que pase»).']
    }),
    exercise({
      id: 'p01-inventario-de-fortalezas', title: 'Inventario de fortalezas', categoryId: 'confianza', durationMin: 8, durationLabel: '8 min',
      moments: ['despues'], difficulty: 1, related: [],
      objective: 'Reconocer lo que ya haces bien.',
      description: 'Una lista breve de fortalezas reales, con ejemplos recientes.',
      steps: [
        'Escribe cinco cosas que haces bien al escalar: técnicas, físicas, de actitud («leo bien los reposos», «no me rindo»).',
        'Para cada una, apunta un ejemplo reciente.',
        'Elige una que quieras usar en tu próxima sesión.',
        'Guarda la lista.'
      ],
      completionCriteria: 'Tienes cinco fortalezas con un ejemplo cada una.',
      reflectionQuestions: ['¿Cuál me costó más reconocer?'],
      precautions: ['No es una evaluación psicológica.', 'Si no encuentras fortalezas, pide a alguien de confianza que te señale algunas.']
    }),
    exercise({
      id: 'd03-plan-para-un-intento-importante', title: 'Plan para un intento importante', categoryId: 'presion', durationMin: 8, durationLabel: '8 min',
      moments: ['antes'], difficulty: 2, related: ['c03-rutina-previa-al-intento', 'f05-objetivos-de-proceso', 'd06-tres-decisiones-antes-de-empezar'],
      objective: 'Preparar con calma un proyecto, una cita o una competición.',
      description: 'Una hoja de seis puntos para llegar al intento con un plan claro.',
      steps: [
        'Qué es importante para ti y por qué.',
        'Qué depende de ti (y qué no).',
        'Preparación: calentamiento, lectura, rutina previa.',
        'Objetivo de proceso del intento.',
        'Plan B por si hoy no es el día (otro intento, otra vía, otra jornada).',
        'Qué haré después, salga como salga.'
      ],
      completionCriteria: 'Tienes los seis puntos escritos.',
      reflectionQuestions: ['¿Qué parte del plan me tranquiliza más?'],
      precautions: ['Incluye siempre condiciones y seguridad en el plan.', 'Tener un plan B, incluido volver otro día, forma parte del plan.']
    }),
    exercise({
      id: 'd04-calmar-el-cuerpo-antes-del-intento', title: 'Calmar el cuerpo antes del intento', categoryId: 'presion', durationMin: 2, durationLabel: '1–2 min',
      moments: ['antes'], difficulty: 1, related: ['m05-respiracion-ante-el-miedo', 'g03-relajacion-rapida', 'd01-escalar-delante-de-otras-personas'],
      objective: 'Soltar la tensión corporal que genera la presión (postura, cara, hombros, mirada) en el minuto previo a un intento importante. No usa técnica de respiración (ver «Respiración ante el miedo») ni trabaja la emoción durante la escalada (ver «Exhalación larga entre movimientos»).',
      description: 'Un repaso corporal muy breve, de pie, justo antes de empezar.',
      steps: [
        'Postura: pies a la anchura de las caderas y el peso repartido.',
        'Cara: separa los dientes y relaja la mandíbula.',
        'Hombros: bájalos, lejos de las orejas.',
        'Mirada suave: mira un punto neutro unos 5 segundos.',
        'Frase: «hago mi plan». Empieza.'
      ],
      completionCriteria: 'Notas la mandíbula y los hombros más sueltos.',
      reflectionQuestions: ['¿Dónde acumulo más tensión cuando me miran?'],
      precautions: ['Si notas molestia articular al relajar o mover, para y consulta a un profesional.']
    }),
    exercise({
      id: 'd06-tres-decisiones-antes-de-empezar', title: 'Tres decisiones antes de empezar', categoryId: 'presion', durationMin: 3, durationLabel: '3 min',
      moments: ['antes'], difficulty: 2, safetyLevel: 'standard', related: ['d05-cuando-abandonar-un-intento', 'f04-fatiga-y-frustracion'],
      objective: 'Decidir con calma, antes del intento, cuándo seguir y cuándo parar.',
      description: 'Tres decisiones, dichas en voz alta con tu compañero, que ordenan el intento antes de empezar.',
      steps: [
        'Señal de seguir: qué tiene que cumplirse para continuar.',
        'Señal de parar: criterios concretos de seguridad (ver «Decidir cuándo abandonar un intento: criterios de seguridad») y de estado físico o emocional (ver «Fatiga y frustración: ¿insistir o parar?») que paran el intento.',
        'Plan de salida: cómo terminarás el intento de forma segura y qué comunicarás a tu compañero.',
        'Dilo en voz alta con tu compañero y comprobad que lo entendéis igual.'
      ],
      completionCriteria: 'Tienes las tres decisiones y las has hablado con tu compañero.',
      reflectionQuestions: ['¿Qué señal de parar me costaría más respetar?'],
      precautions: [
        'La señal de parar de seguridad no se negocia durante el intento.',
        'El ejercicio no sustituye la formación técnica.'
      ]
    }),
    exercise({
      id: 't01-por-que-escalas', title: 'Por qué escalas', categoryId: 'motivacion', durationMin: 5, durationLabel: '5 min',
      moments: ['antes'], difficulty: 1, related: ['t03-constancia-sin-obsesion'],
      objective: 'Conectar con tus motivos propios para sostener el entrenamiento.',
      description: 'Tres razones propias, clasificadas, para recordarlas cuando entrenar cueste.',
      steps: [
        'Escribe tres razones por las que escalas.',
        'Marca cuáles son internas (disfrutar, retarte, estar en la naturaleza) y cuáles externas (aprobación, comparación).',
        'Elige la razón que recordarás cuando entrenar cueste.'
      ],
      completionCriteria: 'Tienes tres razones y has elegido una.',
      reflectionQuestions: ['¿Han cambiado mis motivos con el tiempo?'],
      precautions: ['No hay motivos «buenos» o «malos»: solo conocerlos.']
    }),
    exercise({
      id: 'g02-exhalacion-larga-entre-movimientos', title: 'Exhalación larga entre movimientos', categoryId: 'emocional', durationMin: 2, durationLabel: '1–2 min',
      moments: ['durante'], difficulty: 2, related: ['m05-respiracion-ante-el-miedo', 'g01-emociones-en-la-pared'],
      objective: 'Regular una emoción intensa en pleno recorrido (rabia, nervios) para volver a decidir con claridad. A diferencia de «Respiración ante el miedo», no se hace antes de un tramo con miedo ni usa conteo fijo.',
      description: 'Se hace en un reposo estable, entre movimientos.',
      steps: [
        'Busca la posición más estable que tengas.',
        'Inhala suavemente por la nariz.',
        'Exhala por la boca el doble de tiempo, sin forzar.',
        'Repite entre 3 y 5 veces.',
        'Decide tu siguiente movimiento.'
      ],
      completionCriteria: 'Hiciste las exhalaciones y elegiste el siguiente movimiento.',
      reflectionQuestions: ['¿Qué emoción estaba intentando regular?'],
      precautions: [
        'Solo en una posición estable y con el aseguramiento en el que confías: no te distraigas si eso te deja en una posición comprometida.',
        'Exhala sin forzar y sin retener el aire; si te mareas o te hormiguean las manos, respira con normalidad.',
        'No lo uses para forzarte a seguir si algo no es seguro: la decisión de parar prima (ver «Decidir cuándo abandonar un intento: criterios de seguridad»).',
        'Si las emociones intensas se repiten y te limitan, consulta con un profesional.',
        'No es terapia.'
      ]
    }),
    exercise({
      id: 'g03-relajacion-rapida', title: 'Relajación rápida de manos, antebrazos y hombros', categoryId: 'emocional', durationMin: 2, durationLabel: '1–2 min',
      moments: ['durante'], difficulty: 1, related: ['g01-emociones-en-la-pared', 'd04-calmar-el-cuerpo-antes-del-intento'],
      objective: 'Soltar la tensión acumulada entre intentos o en un reposo.',
      description: 'Tensar y soltar para notar la diferencia. Se usa entre intentos o en un reposo estable.',
      steps: [
        'Aprieta un puño 3 segundos y suéltalo.',
        'Extiende los dedos y sacúdelos suavemente.',
        'Sube los hombros 3 segundos y suéltalos.',
        'Repite dos veces.'
      ],
      completionCriteria: 'Notas manos y hombros más sueltos.',
      reflectionQuestions: ['¿Qué zona tarda más en soltar?'],
      precautions: ['No aprietes con fuerza si tienes dolor o una lesión.', 'En la pared, solo en una posición estable.']
    })
  ];

  const DATA = { schemaVersion: 1, disclaimer: DISCLAIMER, categories: CATEGORIES, moments: MOMENTS, environments: ENVIRONMENTS, lessons: LESSONS, exercises: EXERCISES };

  if (typeof module === 'object' && module.exports) module.exports = DATA;
  else root.KRUX_MENTAL_DATA = DATA;
}(typeof self !== 'undefined' ? self : this));

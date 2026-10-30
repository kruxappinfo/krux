const path = require('node:path');
const ROOT = path.resolve(__dirname, '../../..');
// Reglas del perfil del escalador y de la evaluación mental contra el emulador local (proyecto demo, sin producción).
const firebase = require(path.join(ROOT, 'node_modules/firebase/compat/app'));
require(path.join(ROOT, 'node_modules/firebase/compat/auth'));
require(path.join(ROOT, 'node_modules/firebase/compat/firestore'));
const FV = firebase.firestore.FieldValue;

const mk = async (name, email) => {
  const app = firebase.initializeApp({ apiKey: 'fake', projectId: 'demo-krux-audit', authDomain: 'x' }, name);
  app.auth().useEmulator('http://127.0.0.1:9109', { disableWarnings: true });
  const db = app.firestore(); db.useEmulator('127.0.0.1', 8089);
  let cred;
  try { cred = await app.auth().createUserWithEmailAndPassword(email, 'password123'); }
  catch (e) { cred = await app.auth().signInWithEmailAndPassword(email, 'password123'); }
  return { db, uid: cred.user.uid, app };
};
const results = [];
const expectOp = async (label, fn, shouldPass) => {
  let ok;
  try { await fn(); ok = true; } catch (e) { ok = false; if (!/permission|PERMISSION/i.test(String(e.code + e.message))) label += ` (error inesperado: ${e.code} ${e.message.slice(0, 80)})`; }
  results.push({ label, pass: ok === shouldPass, expected: shouldPass ? 'permitido' : 'denegado', got: ok ? 'permitido' : 'denegado' });
};

(async () => {
  const t = Date.now();
  const A = await mk('a' + t, `pa${t}@test.dev`);
  const B = await mk('b' + t, `pb${t}@test.dev`);
  const prof = (u, owner) => u.db.collection('users').doc((owner || u).uid).collection('training_profile').doc('current');
  const ment = (u, owner) => u.db.collection('users').doc((owner || u).uid).collection('mental_profile').doc('current');
  const P = over => Object.assign({ schemaVersion: 1, status: 'in_progress', updatedAt: FV.serverTimestamp() }, over || {});
  const complete = over => P(Object.assign({
    status: 'completed', completedAt: FV.serverTimestamp(), step: 6, goalPrimary: 'grado', experience: '1-2', daysPerWeek: 2, minutesPerSession: 90,
    modality: 'deportiva', environment: 'ambos', rockFrequency: 1, rockPriority: 'roca', equipment: ['multipresa'],
    grades: { sport: { usualFrom: '6a', usualTo: '6b', max: '6b', target: '6c+' } }
  }, over || {}));
  const M = (answers, over) => Object.assign({ schemaVersion: 1, answers, updatedAt: FV.serverTimestamp() }, over || {});

  // ── perfil de entrenamiento
  await expectOp('perfil: crear vacío en curso', () => prof(A).set(P()), true);
  await expectOp('perfil: guardado progresivo (paso 2 con grados)', () => prof(A).set(P({ step: 2, goalPrimary: 'fuerza', grades: { sport: { usualFrom: '6a', max: '6b' } } })), true);
  await expectOp('perfil: completado con el caso de prueba', () => prof(A).set(complete()), true);
  await expectOp('perfil: completado con bloque y escala Fontainebleau', () => prof(A).set(complete({ modality: 'ambas', grades: { sport: { max: '6b' }, boulder: { usualFrom: '6A', max: '6B+', target: '7A' } } })), true);
  await expectOp('perfil: grado «no lo sé»', () => prof(A).set(P({ grades: { sport: { usualFrom: 'unknown', max: 'unknown' } } })), true);
  await expectOp('perfil: saltado', () => prof(A).set(P({ status: 'skipped' })), true);
  await expectOp('perfil: otro usuario no lo lee', () => prof(B, A).get(), false);
  await expectOp('perfil: otro usuario no lo escribe', () => prof(B, A).set(P()), false);
  await expectOp('perfil: el propietario lo lee', () => prof(A).get(), true);
  await expectOp('perfil: id distinto de «current»', () => A.db.collection('users').doc(A.uid).collection('training_profile').doc('otro').set(P()), false);
  await expectOp('perfil: updatedAt que no es la hora del servidor', () => prof(A).set(P({ updatedAt: firebase.firestore.Timestamp.fromMillis(1) })), false);
  await expectOp('perfil: clave desconocida', () => prof(A).set(P({ rol: 'admin' })), false);
  await expectOp('perfil: estado inválido', () => prof(A).set(P({ status: 'hecho' })), false);
  await expectOp('perfil: schemaVersion 2', () => prof(A).set(P({ schemaVersion: 2 })), false);
  await expectOp('perfil: objetivo desconocido', () => prof(A).set(P({ goalPrimary: 'volar' })), false);
  await expectOp('perfil: tres objetivos secundarios', () => prof(A).set(P({ goalsSecondary: ['fuerza', 'tecnica', 'forma'] })), false);
  await expectOp('perfil: objetivo secundario inválido', () => prof(A).set(P({ goalsSecondary: ['volar'] })), false);
  await expectOp('perfil: días por semana 8', () => prof(A).set(P({ daysPerWeek: 8 })), false);
  await expectOp('perfil: días por semana decimal', () => prof(A).set(P({ daysPerWeek: 2.5 })), false);
  await expectOp('perfil: minutos 5', () => prof(A).set(P({ minutesPerSession: 5 })), false);
  await expectOp('perfil: minutos 300', () => prof(A).set(P({ minutesPerSession: 300 })), false);
  await expectOp('perfil: experiencia inválida', () => prof(A).set(P({ experience: 'mucha' })), false);
  await expectOp('perfil: modalidad inválida', () => prof(A).set(P({ modality: 'otra' })), false);
  await expectOp('perfil: material inválido', () => prof(A).set(P({ equipment: ['jetpack'] })), false);
  await expectOp('perfil: material con más de 6 elementos', () => prof(A).set(P({ equipment: ['ninguno', 'multipresa', 'gimnasio', 'bandas', 'pesas', 'otro', 'otro'] })), false);
  await expectOp('perfil: texto de otro material de 61 caracteres', () => prof(A).set(P({ equipment: ['otro'], equipmentOther: 'x'.repeat(61) })), false);
  await expectOp('perfil: texto de otro material de 60 caracteres', () => prof(A).set(P({ equipment: ['otro'], equipmentOther: 'x'.repeat(60) })), true);
  await expectOp('perfil: grado deportivo con formato de bloque (6A)', () => prof(A).set(P({ grades: { sport: { max: '6A' } } })), false);
  await expectOp('perfil: grado de bloque con formato deportivo (6a)', () => prof(A).set(P({ grades: { boulder: { max: '6a' } } })), false);
  await expectOp('perfil: grado inexistente', () => prof(A).set(P({ grades: { sport: { max: '12z' } } })), false);
  await expectOp('perfil: clave desconocida en una escala', () => prof(A).set(P({ grades: { sport: { max: '6a', peor: '5a' } } })), false);
  await expectOp('perfil: escala desconocida', () => prof(A).set(P({ grades: { hielo: { max: 'WI4' } } })), false);
  await expectOp('perfil: completado sin material', () => prof(A).set(complete({ equipment: undefined })), false);
  await expectOp('perfil: completado sin fecha de compleción', () => prof(A).set(complete({ completedAt: undefined })), false);
  await expectOp('perfil: frecuencia en roca 9', () => prof(A).set(P({ rockFrequency: 9 })), false);
  await expectOp('perfil: paso 7', () => prof(A).set(P({ step: 7 })), false);
  await expectOp('perfil: el propietario lo borra', () => prof(A).delete(), true);
  await expectOp('perfil: otro usuario no lo borra', async () => { await prof(A).set(P()); await prof(B, A).delete(); }, false);

  // ── evaluación mental
  await expectOp('mental: respuestas completas', () => ment(A).set(M({ fear: 3, confidence: 4, focus: 2, frustration: 5, pressure: 1 })), true);
  await expectOp('mental: respuestas parciales', () => ment(A).set(M({ fear: 3 })), true);
  await expectOp('mental: sin respuestas', () => ment(A).set(M({})), true);
  await expectOp('mental: «no lo sé» y «prefiero no responder»', () => ment(A).set(M({ fear: 'unknown', confidence: 'skip', focus: 4 })), true);
  await expectOp('mental: otro usuario no la lee', () => ment(B, A).get(), false);
  await expectOp('mental: otro usuario no la escribe', () => ment(B, A).set(M({ fear: 1 })), false);
  await expectOp('mental: el propietario la lee', () => ment(A).get(), true);
  await expectOp('mental: respuesta 6', () => ment(A).set(M({ fear: 6 })), false);
  await expectOp('mental: respuesta 0', () => ment(A).set(M({ fear: 0 })), false);
  await expectOp('mental: respuesta decimal', () => ment(A).set(M({ fear: 2.5 })), false);
  await expectOp('mental: respuesta de texto libre', () => ment(A).set(M({ fear: 'mucho' })), false);
  await expectOp('mental: pregunta desconocida', () => ment(A).set(M({ nota: 3 })), false);
  await expectOp('mental: puntuación global añadida', () => ment(A).set(M({ fear: 3 }, { score: 40 })), false);
  await expectOp('mental: sin respuestas (campo ausente)', () => ment(A).set({ schemaVersion: 1, updatedAt: FV.serverTimestamp() }), false);
  await expectOp('mental: updatedAt falso', () => ment(A).set(M({ fear: 3 }, { updatedAt: firebase.firestore.Timestamp.fromMillis(1) })), false);
  await expectOp('mental: id distinto de «current»', () => A.db.collection('users').doc(A.uid).collection('mental_profile').doc('x').set(M({ fear: 3 })), false);
  await expectOp('mental: el propietario la borra', () => ment(A).delete(), true);
  await expectOp('mental: otro usuario no la borra', async () => { await ment(A).set(M({ fear: 1 })); await ment(B, A).delete(); }, false);

  // privacidad: tampoco se pueden listar
  await expectOp('privacidad: otro usuario no lista training_profile', () => B.db.collection('users').doc(A.uid).collection('training_profile').get(), false);
  await expectOp('privacidad: otro usuario no lista mental_profile', () => B.db.collection('users').doc(A.uid).collection('mental_profile').get(), false);
  await expectOp('privacidad: sin sesión no se lee', async () => { await A.app.auth().signOut(); await prof(A).get(); }, false);

  results.forEach(r => console.log(`${r.pass ? 'OK  ' : 'FALLA'}  ${r.label}${r.pass ? '' : `  → esperado ${r.expected}, obtenido ${r.got}`}`));
  const bad = results.filter(r => !r.pass);
  console.log(`\n${results.length - bad.length}/${results.length} correctas`);
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });

const path = require('node:path');
const ROOT = path.resolve(__dirname, '../../..');
// Matriz de reglas contra el emulador local (proyecto demo, sin producción).
const firebase = require(path.join(ROOT, 'node_modules/firebase/compat/app'));
require(path.join(ROOT, 'node_modules/firebase/compat/auth'));
require(path.join(ROOT, 'node_modules/firebase/compat/firestore'));
const D = require(path.join(ROOT, 'train-catalog-data.js'));

const mk = async (name, email) => {
  const app = firebase.initializeApp({ apiKey: 'fake', projectId: 'demo-krux-audit', authDomain: 'x' }, name);
  app.auth().useEmulator('http://127.0.0.1:9109', { disableWarnings: true });
  const db = app.firestore(); db.useEmulator('127.0.0.1', 8089);
  let cred;
  try { cred = await app.auth().createUserWithEmailAndPassword(email, 'password123'); }
  catch (e) { cred = await app.auth().signInWithEmailAndPassword(email, 'password123'); }
  return { db, uid: cred.user.uid };
};

const results = [];
const expect = async (label, promise, shouldPass) => {
  let ok;
  try { await promise; ok = true; } catch (e) { ok = false; if (!/permission|PERMISSION/i.test(String(e.code + e.message))) label += ` (error inesperado: ${e.code})`; }
  results.push({ label, pass: ok === shouldPass, expected: shouldPass ? 'permitido' : 'denegado', got: ok ? 'permitido' : 'denegado' });
};

(async () => {
  const stamp = Date.now();
  const A = await mk('a' + stamp, `a${stamp}@test.dev`);
  const B = await mk('b' + stamp, `b${stamp}@test.dev`);
  const SU = await mk('su' + stamp, 'krux.app.info@gmail.com');
  const ADM = await mk('adm' + stamp, `adm${stamp}@test.dev`);
  await SU.db.collection('admins').doc(ADM.uid).set({ role: 'admin' });

  const plan = (over) => Object.assign({ name: 'Plan', weeks: 4, activeDays: [true, false, true, false, true, false, false], sessions: [{ day: 'L', name: 'S', exercises: [{ name: 'Max hang', sets: 4, workSec: 10, reps: 0, weight: 20, restSec: 180, rpeTarget: 8, exerciseId: 'max-hang', exerciseContentVersion: 1, notes: 'x', assistanceKg: 0 }] }] }, over || {});
  const ref = (u, c, d) => u.db.collection('users').doc(A.uid).collection(c).doc(d);

  // ── plan activo
  await expect('plan: dueño crea active válido', ref(A, 'training_plan', 'active').set(plan()), true);
  await expect('plan: dueño con goal/level/equipment (asistente)', ref(A, 'training_plan', 'active').set(plan({ goal: 'fuerza', level: 2, equipment: ['barra'] })), true);
  await expect('plan: otro usuario no escribe', ref(B, 'training_plan', 'active').set(plan()), false);
  await expect('plan: otro usuario no lee', ref(B, 'training_plan', 'active').get(), false);
  await expect('plan: id distinto de active', ref(A, 'training_plan', 'otro').set(plan()), false);
  await expect('plan: 17 semanas', ref(A, 'training_plan', 'active').set(plan({ weeks: 17 })), false);
  await expect('plan: 0 semanas', ref(A, 'training_plan', 'active').set(plan({ weeks: 0 })), false);
  await expect('plan: semanas decimales', ref(A, 'training_plan', 'active').set(plan({ weeks: 4.5 })), false);
  await expect('plan: activeDays de 6', ref(A, 'training_plan', 'active').set(plan({ activeDays: [true, true, true, true, true, true] })), false);
  await expect('plan: 8 sesiones', ref(A, 'training_plan', 'active').set(plan({ sessions: Array(8).fill({ day: 'L', name: 'S', exercises: [] }) })), false);
  await expect('plan: 7 sesiones', ref(A, 'training_plan', 'active').set(plan({ sessions: Array(7).fill({ day: 'L', name: 'S', exercises: [] }) })), true);
  await expect('plan: nombre de 81 caracteres', ref(A, 'training_plan', 'active').set(plan({ name: 'x'.repeat(81) })), false);
  await expect('plan: lectura del dueño', ref(A, 'training_plan', 'active').get(), true);

  // ── sesiones realizadas
  const sess = (over) => Object.assign({ dateKey: '2026-10-29', sessionName: 'Fuerza', durationSec: 600, exercises: [{ name: 'Max hang', exerciseId: 'max-hang', exerciseContentVersion: 1, target: { sets: 4 }, sets: [] }] }, over || {});
  const sRef = ref(A, 'training_sessions', 's1');
  await expect('sesión: dueño crea con exerciseId', sRef.set(sess()), true);
  await expect('sesión: otro usuario no lee', ref(B, 'training_sessions', 's1').get(), false);
  await expect('sesión: más de 30 ejercicios', ref(A, 'training_sessions', 's2').set(sess({ exercises: Array(31).fill({ name: 'x' }) })), false);
  await expect('sesión: update solo feel/rpe/notes', sRef.update({ feel: 'bien', rpe: 7, notes: 'ok' }), true);
  await expect('sesión: update de exercises prohibido (historial inmutable)', sRef.update({ exercises: [] }), false);
  await expect('sesión: update de durationSec prohibido', sRef.update({ durationSec: 1 }), false);

  // ── favoritos
  await expect('favorito: dueño crea con id válido', ref(A, 'exercise_favorites', 'max-hang').set({ exerciseId: 'max-hang' }), true);
  await expect('favorito: exerciseId no coincide', ref(A, 'exercise_favorites', 'plancha').set({ exerciseId: 'otro' }), false);
  await expect('favorito: id con mayúsculas', ref(A, 'exercise_favorites', 'Max_Hang').set({ exerciseId: 'Max_Hang' }), false);
  await expect('favorito: otro usuario no crea en mi espacio', ref(B, 'exercise_favorites', 'plancha').set({ exerciseId: 'plancha' }), false);
  await expect('favorito: otro usuario no lee', ref(B, 'exercise_favorites', 'max-hang').get(), false);
  await expect('favorito: dueño lista', A.db.collection('users').doc(A.uid).collection('exercise_favorites').get(), true);
  await expect('favorito: dueño borra', ref(A, 'exercise_favorites', 'max-hang').delete(), true);

  // ── catálogo global
  const ficha = JSON.parse(JSON.stringify(D.exercises.find(e => e.id === 'plancha')));
  const exRef = (u, id) => u.db.collection('exercises').doc(id);
  await expect('catálogo: usuario normal no crea', exRef(A, 'plancha').set(ficha), false);
  await expect('catálogo: admin crea ficha válida', exRef(ADM, 'plancha').set(ficha), true);
  await expect('catálogo: super-admin crea otra', exRef(SU, 'hollow-body').set(Object.assign({}, D.exercises.find(e => e.id === 'hollow-body'))), true);
  await expect('catálogo: usuario lee ficha publicada', exRef(A, 'plancha').get(), true);
  await expect('catálogo: usuario lista solo publicadas', A.db.collection('exercises').where('status', '==', 'published').get(), true);
  await expect('catálogo: usuario NO lista sin filtro (incluiría borradores)', A.db.collection('exercises').get(), false);
  const draft = Object.assign({}, ficha, { id: 'borrador', slug: 'borrador', status: 'draft' });
  await expect('catálogo: admin crea borrador', exRef(ADM, 'borrador').set(draft), true);
  await expect('catálogo: usuario no lee borrador', exRef(A, 'borrador').get(), false);
  await expect('catálogo: admin lee borrador', exRef(ADM, 'borrador').get(), true);
  await expect('catálogo: admin con status inválido', exRef(ADM, 'x1').set(Object.assign({}, ficha, { id: 'x1', status: 'publicado' })), false);
  await expect('catálogo: admin con id distinto del documento', exRef(ADM, 'x2').set(Object.assign({}, ficha, { id: 'otro' })), false);
  await expect('catálogo: admin con id mal formado', exRef(ADM, 'Mala_Id').set(Object.assign({}, ficha, { id: 'Mala_Id' })), false);
  await expect('catálogo: admin sin review', exRef(ADM, 'x3').set((() => { const f = Object.assign({}, ficha, { id: 'x3' }); delete f.review; return f; })()), false);
  await expect('catálogo: admin con schemaVersion 2', exRef(ADM, 'x4').set(Object.assign({}, ficha, { id: 'x4', schemaVersion: 2 })), false);
  await expect('catálogo: usuario no borra', exRef(A, 'plancha').delete(), false);
  await expect('catálogo: admin borra', exRef(ADM, 'borrador').delete(), true);

  // ── categorías y material
  await expect('categorías: usuario lee', A.db.collection('exercise_categories').doc('dedos').get(), true);
  await expect('categorías: usuario no escribe', A.db.collection('exercise_categories').doc('dedos').set({ id: 'dedos' }), false);
  await expect('categorías: admin escribe', ADM.db.collection('exercise_categories').doc('dedos').set({ id: 'dedos' }), true);
  await expect('material: usuario no escribe', A.db.collection('equipment').doc('barra').set({ id: 'barra' }), false);
  await expect('material: admin escribe', ADM.db.collection('equipment').doc('barra').set({ id: 'barra' }), true);

  const failed = results.filter(r => !r.pass);
  results.forEach(r => console.log((r.pass ? 'OK  ' : 'FALLA') + ' ' + r.label + (r.pass ? '' : `  → esperado ${r.expected}, obtenido ${r.got}`)));
  console.log(`\n${results.length - failed.length}/${results.length} correctas`);
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('ERROR', e); process.exit(2); });

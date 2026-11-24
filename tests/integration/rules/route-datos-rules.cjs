const path = require('node:path');
const ROOT = path.resolve(__dirname, '../../..');
// Reglas de route_datos (estilo, expreses y metros que un spotter/admin añade al momento a una vía), contra el emulador local.
const firebase = require(path.join(ROOT, 'node_modules/firebase/compat/app'));
require(path.join(ROOT, 'node_modules/firebase/compat/auth'));
require(path.join(ROOT, 'node_modules/firebase/compat/firestore'));

const mk = async (name, email) => {
  const app = firebase.initializeApp({ apiKey: 'fake', projectId: 'demo-krux-audit', authDomain: 'x' }, name);
  app.auth().useEmulator('http://127.0.0.1:9109', { disableWarnings: true });
  const db = app.firestore(); db.useEmulator('127.0.0.1', 8089);
  let cred;
  try { cred = await app.auth().createUserWithEmailAndPassword(email, 'password123'); }
  catch (e) { cred = await app.auth().signInWithEmailAndPassword(email, 'password123'); }
  return { db, uid: cred.user.uid, FV: firebase.firestore.FieldValue };
};

const results = [];
const expect = async (label, promise, shouldPass) => {
  let ok;
  try { await promise; ok = true; } catch (e) { ok = false; if (!/permission|PERMISSION/i.test(String(e.code + e.message))) label += ` (error inesperado: ${e.code})`; }
  results.push({ label, pass: ok === shouldPass, expected: shouldPass ? 'permitido' : 'denegado', got: ok ? 'permitido' : 'denegado' });
};

(async () => {
  const stamp = Date.now();
  const U = await mk('u' + stamp, `u${stamp}@test.dev`);
  const SP = await mk('sp' + stamp, `sp${stamp}@test.dev`);
  const AD = await mk('ad' + stamp, `ad${stamp}@test.dev`);
  const SA = await mk('sa' + stamp, 'krux.app.info@gmail.com');
  await SA.db.collection('admins').doc(SP.uid).set({ role: 'spotter' });
  await SA.db.collection('admins').doc(AD.uid).set({ role: 'admin' });

  const school = 'esc' + stamp;
  const ref = (u, id) => u.db.collection('route_datos').doc(`${school}_${id}`);
  const data = (u, id, over) => Object.assign({ schoolId: school, routeId: id, updatedBy: u.uid, updatedAt: u.FV.serverTimestamp() }, over || {});
  const merge = { merge: true };

  await expect('spotter añade expreses', ref(SP, 1).set(data(SP, 1, { exp1: 8 }), merge), true);
  await expect('spotter añade metros a la misma vía', ref(SP, 1).set(data(SP, 1, { long1: 25 }), merge), true);
  await expect('spotter añade estilo', ref(SP, 2).set(data(SP, 2, { estilo: 'Placa' }), merge), true);
  await expect('spotter añade dato de variante (exp3/long3)', ref(SP, 3).set(data(SP, 3, { exp3: 0, long3: 12 }), merge), true);
  await expect('admin añade dato', ref(AD, 4).set(data(AD, 4, { exp1: 10 }), merge), true);
  await expect('super-admin añade dato', ref(SA, 5).set(data(SA, 5, { long1: 30 }), merge), true);
  await expect('usuario normal no puede', ref(U, 6).set(data(U, 6, { exp1: 8 }), merge), false);
  await expect('a nombre de otro', ref(SP, 7).set(data(SP, 7, { exp1: 8, updatedBy: AD.uid }), merge), false);
  await expect('id que no es escuela_id', SP.db.collection('route_datos').doc('otra_1').set(data(SP, 1, { exp1: 8 })), false);
  await expect('routeId como texto', ref(SP, 8).set(data(SP, 8, { routeId: '8', exp1: 8 }), merge), false);
  await expect('expreses fuera de rango (51)', ref(SP, 9).set(data(SP, 9, { exp1: 51 }), merge), false);
  await expect('expreses negativos', ref(SP, 9).set(data(SP, 9, { exp1: -1 }), merge), false);
  await expect('expreses decimales', ref(SP, 9).set(data(SP, 9, { exp1: 7.5 }), merge), false);
  await expect('metros 0', ref(SP, 9).set(data(SP, 9, { long1: 0 }), merge), false);
  await expect('metros 501', ref(SP, 9).set(data(SP, 9, { long1: 501 }), merge), false);
  await expect('estilo vacío', ref(SP, 9).set(data(SP, 9, { estilo: '' }), merge), false);
  await expect('estilo de 41 caracteres', ref(SP, 9).set(data(SP, 9, { estilo: 'x'.repeat(41) }), merge), false);
  await expect('campo no admitido (grado1)', ref(SP, 9).set(data(SP, 9, { grado1: '6a' }), merge), false);
  await expect('variante 6 no admitida', ref(SP, 9).set(data(SP, 9, { exp6: 5 }), merge), false);
  await expect('fecha inventada', ref(SP, 9).set(data(SP, 9, { exp1: 5, updatedAt: new Date(2000, 0, 1) }), merge), false);

  // Correcciones de admin (fix): sustituyen cualquier dato; un spotter no las crea ni las cambia
  const fix = (u, id, f) => data(u, id, { fix: f });
  await expect('admin corrige nombre, grado, estilo y descripción', ref(AD, 10).set(fix(AD, 10, { nombre: 'La Raja', grado1: '6b', estilo: 'Fisura', descripcion: 'Salida delicada' }), merge), true);
  await expect('admin borra expreses y metros (null)', ref(AD, 10).set(fix(AD, 10, { exp1: null, long1: null }), merge), true);
  await expect('admin corrige variante 3', ref(AD, 10).set(fix(AD, 10, { grado3: '7a', exp3: 9, long3: 20 }), merge), true);
  await expect('admin deja la descripción vacía', ref(AD, 10).set(fix(AD, 10, { descripcion: '' }), merge), true);
  await expect('super-admin corrige', ref(SA, 11).set(fix(SA, 11, { grado1: '5c' }), merge), true);
  await expect('spotter no puede crear fix', ref(SP, 12).set(fix(SP, 12, { grado1: '6a' }), merge), false);
  await expect('spotter no puede cambiar fix', ref(SP, 10).set(fix(SP, 10, { grado1: '8a' }), merge), false);
  await expect('spotter rellena un hueco en una vía con fix (fix intacto)', ref(SP, 10).set(data(SP, 10, { exp2: 6 }), merge), true);
  await expect('usuario no puede corregir', ref(U, 13).set(fix(U, 13, { nombre: 'x' }), merge), false);
  await expect('fix: nombre vacío', ref(AD, 14).set(fix(AD, 14, { nombre: '' }), merge), false);
  await expect('fix: grado vacío', ref(AD, 14).set(fix(AD, 14, { grado1: '' }), merge), false);
  await expect('fix: grado de 9 caracteres', ref(AD, 14).set(fix(AD, 14, { grado1: '123456789' }), merge), false);
  await expect('fix: campo no admitido (sector)', ref(AD, 14).set(fix(AD, 14, { sector: 'Otro' }), merge), false);
  await expect('fix: expreses fuera de rango', ref(AD, 14).set(fix(AD, 14, { exp1: 99 }), merge), false);
  await expect('fix: metros como texto', ref(AD, 14).set(fix(AD, 14, { long1: '20' }), merge), false);
  await expect('fix: descripción de 601 caracteres', ref(AD, 14).set(fix(AD, 14, { descripcion: 'x'.repeat(601) }), merge), false);
  await expect('fix que no es un mapa', ref(AD, 14).set(data(AD, 14, { fix: 'hola' }), merge), false);

  await expect('cualquiera lee (sin ser spotter)', ref(U, 1).get(), true);
  await expect('cualquiera lista por escuela', U.db.collection('route_datos').where('schoolId', '==', school).get(), true);
  await expect('spotter no borra', ref(SP, 1).delete(), false);
  await expect('usuario no borra', ref(U, 1).delete(), false);
  await expect('admin borra', ref(AD, 4).delete(), true);
  await expect('super-admin borra', ref(SA, 5).delete(), true);

  const failed = results.filter(r => !r.pass);
  results.forEach(r => console.log((r.pass ? 'OK  ' : 'FALLA') + ' ' + r.label + (r.pass ? '' : `  → esperado ${r.expected}, obtenido ${r.got}`)));
  console.log(`\n${results.length - failed.length}/${results.length} correctas`);
  process.exit(failed.length ? 1 : 0);
})();

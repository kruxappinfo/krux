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
  await expect('estilo vacío (quita el estilo)', ref(SP, 9).set(data(SP, 9, { estilo: '' }), merge), true);
  await expect('expreses nulos (sin dato)', ref(SP, 9).set(data(SP, 9, { exp1: null }), merge), true);
  await expect('metros nulos (sin dato)', ref(SP, 9).set(data(SP, 9, { long1: null }), merge), true);
  await expect('estilo de 121 caracteres', ref(SP, 9).set(data(SP, 9, { estilo: 'x'.repeat(121) }), merge), false);
  await expect('varios estilos (120 caracteres)', ref(SP, 15).set(data(SP, 15, { estilo: 'x'.repeat(120) }), merge), true);
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

  // Historial: solo en la misma escritura que cambia la vía, sin editar ni borrar, lectura solo admins
  const histRef = (u, id) => ref(u, id).collection('historial').doc();
  const entry = (u, role, changes, over) => Object.assign({ uid: u.uid, role, at: u.FV.serverTimestamp(), changes }, over || {});
  const withHist = (u, id, mainData, hist) => u.db.runTransaction(async (t) => {
    await t.get(ref(u, id));
    t.set(ref(u, id), mainData, merge);
    t.set(histRef(u, id), hist);
  });
  await expect('historial: spotter escribe dato y deja su entrada', withHist(SP, 20, data(SP, 20, { exp1: 7 }), entry(SP, 'spotter', { exp1: { to: 7 } })), true);
  await expect('historial: spotter con campo de fix', withHist(SP, 21, data(SP, 21, { exp1: 7 }), entry(SP, 'spotter', { f_nombre: { to: 'x' } })), false);
  await expect('historial: admin con campo de fix', withHist(AD, 22, data(AD, 22, { fix: { nombre: 'Nueva' } }), entry(AD, 'admin', { f_nombre: { to: 'Nueva' } })), true);
  await expect('historial: super-admin deja su entrada', withHist(SA, 23, data(SA, 23, { long1: 12 }), entry(SA, 'admin', { long1: { to: 12 } })), true);
  await expect('historial: entrada suelta, sin escribir la vía', histRef(SP, 24).set(entry(SP, 'spotter', { exp1: { to: 7 } })), false);
  await expect('historial: entrada a nombre de otro', withHist(SP, 25, data(SP, 25, { exp1: 7 }), entry(SP, 'spotter', { exp1: { to: 7 } }, { uid: AD.uid })), false);
  await expect('historial: fecha inventada', withHist(SP, 26, data(SP, 26, { exp1: 7 }), entry(SP, 'spotter', { exp1: { to: 7 } }, { at: new Date(2000, 0, 1) })), false);
  await expect('historial: rol inventado', withHist(SP, 27, data(SP, 27, { exp1: 7 }), entry(SP, 'spotter', { exp1: { to: 7 } }, { role: 'dios' })), false);
  await expect('historial: sin cambios', withHist(SP, 28, data(SP, 28, { exp1: 7 }), entry(SP, 'spotter', {})), false);
  await expect('historial: campo no admitido', withHist(SP, 29, data(SP, 29, { exp1: 7 }), entry(SP, 'spotter', { grado1: { to: '8c' } })), false);
  await expect('historial: campo extra en la entrada', withHist(SP, 30, data(SP, 30, { exp1: 7 }), entry(SP, 'spotter', { exp1: { to: 7 } }, { extra: 1 })), false);
  await expect('historial: usuario normal no escribe', withHist(U, 31, data(U, 31, { exp1: 7 }), entry(U, 'spotter', { exp1: { to: 7 } })), false);
  await expect('historial: admin quita un dato (sin «to») y lo registra', (async () => {
    await withHist(AD, 32, data(AD, 32, { exp1: 9 }), entry(AD, 'admin', { exp1: { to: 9 } }));
    await u2del(AD, 32);
  })(), true);
  async function u2del(u, id) {
    await u.db.runTransaction(async (t) => {
      await t.get(ref(u, id));
      t.set(ref(u, id), { schoolId: school, routeId: id, updatedBy: u.uid, updatedAt: u.FV.serverTimestamp(), exp1: u.FV.delete() }, merge);
      t.set(histRef(u, id), entry(u, 'admin', { exp1: { from: 9 } }));
    });
  }
  const hs = (u, id) => ref(u, id).collection('historial');
  await expect('historial: admin lo lee', hs(AD, 20).get(), true);
  await expect('historial: super-admin lo lee', hs(SA, 20).get(), true);
  await expect('historial: spotter no lo lee', hs(SP, 20).get(), false);
  await expect('historial: usuario no lo lee', hs(U, 20).get(), false);
  const first = (await hs(AD, 20).get()).docs[0];
  await expect('historial: el admin no edita una entrada', hs(AD, 20).doc(first.id).update({ role: 'admin' }), false);
  await expect('historial: el super-admin tampoco la edita', hs(SA, 20).doc(first.id).update({ role: 'admin' }), false);
  await expect('historial: el admin no la borra', hs(AD, 20).doc(first.id).delete(), false);

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

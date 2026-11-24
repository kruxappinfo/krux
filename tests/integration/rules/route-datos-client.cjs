const path = require('node:path');
const ROOT = path.resolve(__dirname, '../../..');
// route-datos.js real, cargado como script clásico (escritura con historial, restaurar, aprobar sugerencias) contra el emulador local y las reglas de firestore.rules.
const firebase = require(path.join(ROOT, 'node_modules/firebase/compat/app'));
require(path.join(ROOT, 'node_modules/firebase/compat/auth'));
require(path.join(ROOT, 'node_modules/firebase/compat/firestore'));

global.firebase = firebase;
// Las funciones usan firebase.firestore()/firebase.auth() del app por defecto: un solo app, cambiando de usuario
firebase.initializeApp({ apiKey: 'fake', projectId: 'demo-krux-audit', authDomain: 'x' });
firebase.auth().useEmulator('http://127.0.0.1:9109', { disableWarnings: true });
firebase.firestore().useEmulator('127.0.0.1', 8089);
const src = require('node:fs').readFileSync(path.join(ROOT, 'route-datos.js'), 'utf8');
require('node:vm').runInThisContext(src.replace(/if \(typeof module[\s\S]*$/, ''));

const as = async (email) => {
  await firebase.auth().signOut().catch(() => {});
  try { await firebase.auth().createUserWithEmailAndPassword(email, 'password123'); }
  catch (e) { await firebase.auth().signInWithEmailAndPassword(email, 'password123'); }
  return firebase.auth().currentUser.uid;
};

const results = [];
const check = (label, ok, extra) => results.push({ label: label + (ok ? '' : ` → ${extra}`), pass: !!ok });
const denied = async (label, p) => {
  try { await p; check(label, false, 'se permitió'); }
  catch (e) { check(label, /permission|PERMISSION/i.test(String(e.code + e.message)), `error inesperado: ${e.code} ${e.message}`); }
};

(async () => {
  const stamp = Date.now();
  const school = 'esc' + stamp;
  const docRef = (id) => firebase.firestore().collection('route_datos').doc(`${school}_${id}`);

  const spUid = await as(`sp${stamp}@test.dev`);
  await firebase.firestore().collection('users').doc(spUid).set({ displayName: 'Ana Spotter' });   // el perfil lo crea su dueño
  const adUid = await as(`ad${stamp}@test.dev`);
  const saUid = await as('krux.app.info@gmail.com');
  const db = firebase.firestore();
  await db.collection('admins').doc(spUid).set({ role: 'spotter' });
  await db.collection('admins').doc(adUid).set({ role: 'admin' });

  // --- Spotter: añade y corrige ---
  await as(`sp${stamp}@test.dev`);
  let merged = await kxRouteDataWrite(school, 1, { exp1: 8, long1: 20 }, 'spotter');
  check('spotter añade expreses y metros', merged && merged.exp1 === 8 && merged.long1 === 20, JSON.stringify(merged));
  merged = await kxRouteDataWrite(school, 1, { exp1: 10 }, 'spotter');
  check('spotter corrige expreses', merged && merged.exp1 === 10 && merged.long1 === 20, JSON.stringify(merged));
  check('sin cambios no escribe ni deja entrada', (await kxRouteDataWrite(school, 1, { exp1: 10 }, 'spotter')) === null);
  merged = await kxRouteDataWrite(school, 1, { estilo: 'Placa, fisura y regletas' }, 'spotter');
  check('spotter pone varios estilos', merged && merged.estilo === 'Placa, fisura y regletas');
  merged = await kxRouteDataWrite(school, 1, { exp2: null }, 'spotter');
  check('spotter marca «sin dato» (null)', merged && merged.exp2 === null);
  await denied('spotter no escribe nombre (fix)', kxRouteDataWrite(school, 1, { f_nombre: 'X' }, 'spotter'));
  await denied('spotter no escribe fuera de rango', kxRouteDataWrite(school, 2, { exp1: 99 }, 'spotter'));
  check('lo rechazado no deja documento', !(await docRef(2).get()).exists);
  await denied('spotter no lee el historial', kxRouteDataHistory(school, 1));

  // --- Admin: corrige todo, ve el historial y restaura ---
  await as(`ad${stamp}@test.dev`);
  merged = await kxRouteDataWrite(school, 1, { f_nombre: 'La Raja', f_grado1: '6b', f_descripcion: 'Salida delicada', long1: 25 }, 'admin');
  check('admin corrige nombre, grado, descripción y metros', merged && merged.fix.nombre === 'La Raja' && merged.long1 === 25 && merged.exp1 === 10, JSON.stringify(merged));

  const hist = await kxRouteDataHistory(school, 1);
  check('el historial tiene 5 entradas, la última primero', hist.length === 5 && hist[0].role === 'admin' && hist[0].changes.long1.from === 20 && hist[0].changes.long1.to === 25, JSON.stringify(hist.map(h => h.changes)));
  check('el historial lleva el nombre de quien cambió', hist[1].name === 'Usuario' || hist[4].name === 'Ana Spotter', hist.map(h => h.name).join());
  check('la primera entrada no tiene «from» (no había dato)', hist[4] && !('from' in hist[4].changes.exp1) && hist[4].changes.exp1.to === 8, JSON.stringify(hist[4] && hist[4].changes));

  // restaurar la última entrada del admin: nombre/grado/descripción desaparecen y los metros vuelven a 20
  merged = await kxRouteDataWrite(school, 1, kxRdRestoreChanges(hist[0].changes), 'admin');
  check('restaurar quita el fix y devuelve los metros', merged && merged.long1 === 20 && !merged.fix, JSON.stringify(merged));
  const stored = (await docRef(1).get()).data();
  check('lo guardado coincide (fix vacío, metros 20)', stored.long1 === 20 && Object.keys(stored.fix || {}).length === 0 && stored.exp1 === 10 && stored.updatedBy === adUid, JSON.stringify(stored));
  const hist2 = await kxRouteDataHistory(school, 1);
  check('restaurar también queda en el historial', hist2.length === 6 && hist2[0].changes.long1.to === 20 && hist2[0].changes.f_nombre.from === 'La Raja' && !('to' in hist2[0].changes.f_nombre), JSON.stringify(hist2[0] && hist2[0].changes));

  // restaurar la primera entrada (expreses y metros que puso el spotter cuando no había nada): los dos datos propios desaparecen
  merged = await kxRouteDataWrite(school, 1, kxRdRestoreChanges(hist2[5].changes), 'admin');
  check('restaurar la primera entrada quita esos datos propios y deja lo demás', merged && !('exp1' in merged) && !('long1' in merged) && merged.estilo === 'Placa, fisura y regletas', JSON.stringify(merged));

  // --- Aprobar sugerencias de usuarios ---
  const ok1 = await kxRouteDataApproveSuggestion({ schoolId: school, routeId: 3, field: 'exp1' }, '12', 'admin');
  const ok2 = await kxRouteDataApproveSuggestion({ schoolId: school, routeId: 3, field: 'long1' }, '30', 'admin');
  const ok3 = await kxRouteDataApproveSuggestion({ schoolId: school, routeId: 3, field: 'descripcion' }, 'Placa y diedro', 'admin');
  const d3 = (await docRef(3).get()).data();
  check('aprobar sugerencias guarda expreses, metros y estilo', ok1.ok && ok2.ok && ok3.ok && d3.exp1 === 12 && d3.long1 === 30 && d3.estilo === 'Placa y diedro', JSON.stringify(d3));
  check('aprobar valor fuera de rango no escribe', !(await kxRouteDataApproveSuggestion({ schoolId: school, routeId: 3, field: 'exp1' }, '99', 'admin')).ok);
  check('aprobar valor no numérico no escribe', !(await kxRouteDataApproveSuggestion({ schoolId: school, routeId: 3, field: 'long1' }, 'mucho', 'admin')).ok);
  check('aprobar sin vía no escribe', !(await kxRouteDataApproveSuggestion({ schoolId: school, field: 'exp1' }, '5', 'admin')).ok);
  check('aprobar un campo desconocido no escribe', !(await kxRouteDataApproveSuggestion({ schoolId: school, routeId: 3, field: 'grado1' }, '5', 'admin')).ok);

  // --- Usuario normal ---
  await as(`us${stamp}@test.dev`);
  await denied('usuario normal no escribe', kxRouteDataWrite(school, 4, { exp1: 5 }, 'spotter'));

  const failed = results.filter(r => !r.pass);
  results.forEach(r => console.log((r.pass ? 'OK  ' : 'FALLA') + ' ' + r.label));
  console.log(`\n${results.length - failed.length}/${results.length} correctas`);
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('ERROR', e); process.exit(1); });

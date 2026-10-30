const path = require('node:path');
const ROOT = path.resolve(__dirname, '../../..');
// Dos «dispositivos» (dos navegadores) con la misma cuenta. Cada uno hace una sesión sin red y recupera la red a la vez.
// El dispositivo A además tiene lecturas de verificación fallidas. Debe haber exactamente dos sesiones en el servidor,
// una por dispositivo, con su propio id, su fecha y sus notas, y las dos colas vacías. Requiere el servidor en :8765
// y el emulador (ver run-state.sh / race.cjs).
const { spawn } = require('node:child_process');
const firebase = require(path.join(ROOT, 'node_modules/firebase/compat/app'));
require(path.join(ROOT, 'node_modules/firebase/compat/auth')); require(path.join(ROOT, 'node_modules/firebase/compat/firestore'));
const run = (email, who, at) => new Promise(res => {
  const url = `http://localhost:8765/_harness-emu.html?multiplan=1&state=off10&email=${encodeURIComponent(email)}&who=${who}&at=${at}`;
  const p = spawn('node', [path.join(__dirname, 'cdp.mjs'), url, '^(T\\||ERR)', '170000', '390', '844']);
  let out = ''; p.stdout.on('data', d => out += d); p.on('close', () => res(out.trim()));
});
(async () => {
  const email = `dos${Date.now()}@t.dev`;
  const app = firebase.initializeApp({ apiKey: 'fake', projectId: 'demo-krux-audit' }, 'dd' + Date.now());
  app.auth().useEmulator('http://127.0.0.1:9109', { disableWarnings: true });
  const db = app.firestore(); db.useEmulator('127.0.0.1', 8089);
  const cred = await app.auth().createUserWithEmailAndPassword(email, 'password123');
  const ud = db.collection('users').doc(cred.user.uid);
  const sess = ['L', 'M', 'X', 'J', 'V', 'S', 'D'].map(d => ({ day: d, name: 'Sesión ' + d, exercises: [{ name: 'Plancha', sets: 2, workSec: 0, reps: 5, weight: 0, restSec: 0, rpeTarget: 6 }] }));
  await ud.collection('training_plan').doc('active').set({ name: 'Plan dos dispositivos', weeks: 4, activeDays: [true, true, true, true, true, true, true], sessions: sess, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
  const at = Date.now() + 70000;     // los dos navegadores tardan en abrir, migrar y hacer la sesión sin red
  const [a, b] = await Promise.all([run(email, 'A', at), run(email, 'B', at)]);
  const ja = JSON.parse(a.slice(2)), jb = JSON.parse(b.slice(2));
  const docs = (await ud.collection('training_sessions').get({ source: 'server' })).docs;
  const byNote = n => docs.find(d => d.data().notes === n);
  const dA = byNote('nota del dispositivo A'), dB = byNote('nota del dispositivo B');
  const checks = {
    dosDocumentos: docs.length === 2,
    idsDistintos: new Set(docs.map(d => d.id)).size === 2,
    colasVacias: ja.pendientesAlFinal === 0 && jb.pendientesAlFinal === 0 && ja.conflictos === 0 && jb.conflictos === 0,
    cadaUnoConSuId: !!dA && !!dB && dA.id === ja.miId && dB.id === jb.miId,
    fechaIntegra: !!dA && !!dB && dA.data().createdAt.toMillis() === ja.miCreatedAtMs && dB.data().createdAt.toMillis() === jb.miCreatedAtMs,
    sensacionYEsfuerzo: !!dA && !!dB && dA.data().feel === 'great' && dB.data().feel === 'ok' && dA.data().rpe === 6 && dB.data().rpe === 6,
    etiquetas: !!dA && !!dB && JSON.stringify(dA.data().tags) === JSON.stringify(['Sin dolor']) && JSON.stringify(dB.data().tags) === JSON.stringify(['Mucho calor']),
    seEjercitoLaVerificacionFallida: ja.lecturasFalladas === 2,
    sinErrores: !ja.err && !jb.err
  };
  console.log(JSON.stringify({ A: ja, B: jb, servidor: docs.map(d => [d.id.slice(0, 6), d.data().notes, d.data().feel]), checks }));
  const bad = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
  console.log(bad.length ? 'FALLOS: ' + bad.join() : 'dos dispositivos: ' + Object.keys(checks).length + '/' + Object.keys(checks).length + ' correctas');
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });

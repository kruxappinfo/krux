const path = require('node:path');
const ROOT = path.resolve(__dirname, '../../..');
// Dos «dispositivos» (dos navegadores) inician sesión a la vez con un usuario con plan antiguo sin migrar.
const { spawn } = require('node:child_process');
const firebase = require(path.join(ROOT, 'node_modules/firebase/compat/app'));
require(path.join(ROOT, 'node_modules/firebase/compat/auth')); require(path.join(ROOT, 'node_modules/firebase/compat/firestore'));
const run = (email, at) => new Promise(res => {
  const url = `http://localhost:8765/_harness-emu.html?multiplan=1&state=racepage&email=${encodeURIComponent(email)}&at=${at}`;
  const p = spawn('node', [path.join(__dirname, 'cdp.mjs'), url, '^(T\\||ERR)', '90000', '390', '844']);
  let out = ''; p.stdout.on('data', d => out += d); p.on('close', () => res(out.trim()));
});
(async () => {
  let bad = 0;
  for (let trial = 1; trial <= 4; trial++) {
    const email = `race${Date.now()}${trial}@t.dev`;
    const app = firebase.initializeApp({ apiKey: 'fake', projectId: 'demo-krux-audit' }, 'r' + trial + Date.now());
    app.auth().useEmulator('http://127.0.0.1:9109', { disableWarnings: true });
    const db = app.firestore(); db.useEmulator('127.0.0.1', 8089);
    const cred = await app.auth().createUserWithEmailAndPassword(email, 'password123');
    const ud = db.collection('users').doc(cred.user.uid);
    await ud.collection('training_plan').doc('active').set({ name: 'Plan carrera ' + trial, weeks: 4, activeDays: [true, false, true, false, false, false, false], sessions: [{ day: 'L', name: 'A', exercises: [{ name: 'Plancha', sets: 3, workSec: 30, reps: 0, weight: 0, restSec: 60, rpeTarget: 5 }] }], updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
    const at = Date.now() + 9000;      // los dos navegadores tardan unos segundos en arrancar
    const [a, b] = await Promise.all([run(email, at), run(email, at)]);
    const plans = (await ud.collection('training_plans').get()).docs.map(d => d.id);
    const st = (await ud.collection('training_state').doc('current').get()).data();
    const ja = JSON.parse(a.slice(2)), jb = JSON.parse(b.slice(2));
    const ok = plans.length === 1 && plans[0] === 'legacy-active' && st && st.activePlanId === 'legacy-active' && ja.plans === 'legacy-active' && jb.plans === 'legacy-active' && !ja.err && !jb.err && !ja.notice && !jb.notice;
    console.log(`intento ${trial}: ${ok ? 'OK' : 'FALLA'}  planes=${plans.join()} activo=${st && st.activePlanId}  A=${JSON.stringify(ja)}  B=${JSON.stringify(jb)}`);
    if (!ok) bad++;
  }
  console.log(bad ? `${bad} intentos con fallo` : 'sin duplicados en ningún intento');
  process.exit(bad ? 1 : 0);
})();

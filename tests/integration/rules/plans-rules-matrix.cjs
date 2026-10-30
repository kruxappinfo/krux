const path = require('node:path');
const ROOT = path.resolve(__dirname, '../../..');
// Reglas de planes múltiples contra el emulador local (proyecto demo, sin producción).
const firebase = require(path.join(ROOT, 'node_modules/firebase/compat/app'));
require(path.join(ROOT, 'node_modules/firebase/compat/auth'));
require(path.join(ROOT, 'node_modules/firebase/compat/firestore'));
const P = require(path.join(ROOT, 'train-plans.js'));
const FV = firebase.firestore.FieldValue;

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
const expectOp = async (label, fn, shouldPass) => {
  let ok;
  try { await fn(); ok = true; } catch (e) { ok = false; if (!/permission|PERMISSION/i.test(String(e.code + e.message))) label += ` (error inesperado: ${e.code} ${e.message.slice(0, 60)})`; }
  results.push({ label, pass: ok === shouldPass, expected: shouldPass ? 'permitido' : 'denegado', got: ok ? 'permitido' : 'denegado' });
};

(async () => {
  const t = Date.now();
  const A = await mk('a' + t, `a${t}@test.dev`);
  const B = await mk('b' + t, `b${t}@test.dev`);
  const col = (u, owner) => u.db.collection('users').doc((owner || u).uid).collection('training_plans');
  const state = (u, owner) => u.db.collection('users').doc((owner || u).uid).collection('training_state').doc('current');
  const content = () => ({ name: 'Plan', weeks: 4, activeDays: [true, false, true, false, true, false, false], sessions: [{ id: 's_aaaa1111', day: 'L', name: 'S', exercises: [{ name: 'Max hang', sets: 4, workSec: 10, reps: 0, weight: 20, restSec: 180, rpeTarget: 8 }] }] });
  const doc = (over) => Object.assign(P.createPlan(content(), FV.serverTimestamp()), over || {});
  const upd = (cur, over) => Object.assign({}, cur, { revision: cur.revision + 1, updatedAt: FV.serverTimestamp() }, over || {});

  // ── crear
  const p1 = col(A).doc();
  await expectOp('plan: crear válido (ready, revisión 1)', () => p1.set(doc()), true);
  await expectOp('plan: otro usuario no crea en mi espacio', () => col(B, A).doc().set(doc()), false);
  await expectOp('plan: crear con status archived', () => col(A).doc().set(doc({ status: 'archived' })), false);
  await expectOp('plan: crear con revisión 2', () => col(A).doc().set(doc({ revision: 2 })), false);
  await expectOp('plan: crear con campo no previsto', () => col(A).doc().set(doc({ isActive: true })), false);
  await expectOp('plan: crear con 17 semanas', () => col(A).doc().set(doc({ weeks: 17 })), false);
  await expectOp('plan: crear con 0 semanas', () => col(A).doc().set(doc({ weeks: 0 })), false);
  await expectOp('plan: crear con 8 sesiones', () => col(A).doc().set(doc({ sessions: Array(8).fill({ id: 'x', day: 'L', name: 's', exercises: [] }) })), false);
  await expectOp('plan: crear con 7 sesiones', () => col(A).doc().set(doc({ sessions: Array(7).fill({ id: 'x', day: 'L', name: 's', exercises: [] }) })), true);
  await expectOp('plan: crear con nombre de 81 caracteres', () => col(A).doc().set(doc({ name: 'x'.repeat(81) })), false);
  await expectOp('plan: crear con nombre vacío', () => col(A).doc().set(doc({ name: '' })), false);
  await expectOp('plan: crear con inicio programado válido', () => col(A).doc().set(doc({ startDate: '2026-11-02' })), true);
  await expectOp('plan: crear con inicio programado null', () => col(A).doc().set(doc({ startDate: null })), true);
  await expectOp('plan: inicio programado con formato inválido', () => col(A).doc().set(doc({ startDate: '2/11/2026' })), false);
  await expectOp('plan: inicio programado que no es texto', () => col(A).doc().set(doc({ startDate: 20261102 })), false);
  await expectOp('plan: crear con nivel 5', () => col(A).doc().set(doc({ level: 5 })), false);
  await expectOp('plan: crear con nivel 2, objetivo y material', () => col(A).doc().set(doc({ level: 2, goal: 'fuerza', equipment: ['barra'], minutes: 60 })), true);
  await expectOp('plan: crear con 11 materiales', () => col(A).doc().set(doc({ equipment: Array(11).fill('x') })), false);
  await expectOp('plan: crear con fecha de cliente (no la del servidor)', () => col(A).doc().set(doc({ createdAt: new Date(), updatedAt: new Date() })), false);
  await expectOp('plan: crear con schemaVersion 1', () => col(A).doc().set(doc({ schemaVersion: 1 })), false);
  await expectOp('plan: crear con id fijo legacy-active (migración)', () => col(A).doc('legacy-active').set(doc({ migratedFrom: 'training_plan/active' })), true);

  // ── leer
  await expectOp('plan: el dueño lee', () => p1.get(), true);
  await expectOp('plan: el dueño lista', () => col(A).get(), true);
  await expectOp('plan: otro usuario no lee', () => col(B, A).doc(p1.id).get(), false);
  await expectOp('plan: otro usuario no lista', () => col(B, A).get(), false);

  // ── actualizar con control de revisión
  const cur = (await p1.get()).data();
  await expectOp('plan: guardar con revisión +1', () => p1.set(upd(cur, { name: 'Renombrado' })), true);
  const cur2 = (await p1.get()).data();
  await expectOp('plan: guardar con la misma revisión (dos dispositivos)', () => p1.set(Object.assign({}, cur2, { updatedAt: FV.serverTimestamp(), name: 'Otro dispositivo' })), false);
  await expectOp('plan: guardar con la revisión antigua', () => p1.set(upd(cur, { name: 'Desfasado' })), false);
  await expectOp('plan: saltar dos revisiones', () => p1.set(Object.assign(upd(cur2), { revision: cur2.revision + 2 })), false);
  await expectOp('plan: cambiar createdAt', () => p1.set(upd(cur2, { createdAt: new Date(0) })), false);
  await expectOp('plan: cambiar sourcePlanId', () => p1.set(upd(cur2, { sourcePlanId: 'otro' })), false);
  await expectOp('plan: otro usuario no edita', () => col(B, A).doc(p1.id).set(upd(cur2)), false);
  await expectOp('plan: dos clientes a la vez, solo gana uno', async () => {
    const base = (await p1.get()).data();
    const r = await Promise.allSettled([p1.set(upd(base, { name: 'Cliente 1' })), p1.set(upd(base, { name: 'Cliente 2' }))]);
    if (r.filter(x => x.status === 'fulfilled').length !== 1) throw new Error('permission: esperado exactamente uno');
  }, true);

  // ── puntero activo
  await expectOp('estado: activar plan ready', () => state(A).set({ activePlanId: p1.id, updatedAt: FV.serverTimestamp() }), true);
  await expectOp('estado: activar plan inexistente', () => state(A).set({ activePlanId: 'no-existe', updatedAt: FV.serverTimestamp() }), false);
  await expectOp('estado: activar el plan de otro usuario', () => state(B).set({ activePlanId: p1.id, updatedAt: FV.serverTimestamp() }), false);
  await expectOp('estado: otro usuario no lee', () => state(B, A).get(), false);
  await expectOp('estado: campo no previsto', () => state(A).set({ activePlanId: p1.id, extra: 1, updatedAt: FV.serverTimestamp() }), false);
  await expectOp('estado: sin plan activo (null)', () => state(A).set({ activePlanId: null, updatedAt: FV.serverTimestamp() }), true);
  await expectOp('estado: fecha de cliente (distinta de la del servidor)', () => state(A).set({ activePlanId: null, updatedAt: new Date(0) }), false);
  await expectOp('estado: borrar el documento', () => state(A).delete(), false);
  await expectOp('estado: dueño lee', () => state(A).get(), true);

  // ── archivar / papelera el plan activo exige vaciar el puntero en el mismo lote
  await state(A).set({ activePlanId: p1.id, updatedAt: FV.serverTimestamp() });
  const c3 = (await p1.get()).data();
  await expectOp('archivar el plan activo SIN vaciar el puntero', () => p1.set(upd(c3, { status: 'archived', archivedAt: FV.serverTimestamp() })), false);
  await expectOp('enviar a la papelera el plan activo SIN vaciar el puntero', () => p1.set(upd(c3, { status: 'trashed', trashedAt: FV.serverTimestamp(), trashedFrom: 'ready' })), false);
  await expectOp('archivar el plan activo vaciando el puntero (lote)', () => {
    const b = A.db.batch();
    b.set(p1, upd(c3, { status: 'archived', archivedAt: FV.serverTimestamp() }));
    b.set(state(A), { activePlanId: null, updatedAt: FV.serverTimestamp() });
    return b.commit();
  }, true);
  await expectOp('activar un plan archivado', () => state(A).set({ activePlanId: p1.id, updatedAt: FV.serverTimestamp() }), false);
  const c4 = (await p1.get()).data();
  await expectOp('recuperar un plan archivado (ready)', () => p1.set(upd(c4, { status: 'ready', archivedAt: null })), true);

  // ── nuevo plan + activarlo en el mismo lote
  const p2 = col(A).doc();
  await expectOp('crear plan y activarlo en el mismo lote', () => {
    const b = A.db.batch();
    b.set(p2, doc({ name: 'Nuevo y activo' }));
    b.set(state(A), { activePlanId: p2.id, updatedAt: FV.serverTimestamp() });
    return b.commit();
  }, true);
  await expectOp('crear plan archivado y activarlo en el mismo lote (no)', () => {
    const b = A.db.batch(); const p = col(A).doc();
    b.set(p, doc({ status: 'archived' }));
    b.set(state(A), { activePlanId: p.id, updatedAt: FV.serverTimestamp() });
    return b.commit();
  }, false);

  // ── papelera y borrado definitivo
  const p3 = col(A).doc();
  await p3.set(doc({ name: 'Para borrar' }));
  await expectOp('borrar definitivamente un plan que NO está en la papelera', () => p3.delete(), false);
  const c5 = (await p3.get()).data();
  await expectOp('enviar a la papelera (no activo)', () => p3.set(upd(c5, { status: 'trashed', trashedAt: FV.serverTimestamp(), trashedFrom: 'ready' })), true);
  const c6 = (await p3.get()).data();
  await expectOp('restaurar desde la papelera', () => p3.set(upd(c6, { status: 'ready', trashedAt: null, trashedFrom: null })), true);
  const c7 = (await p3.get()).data();
  await p3.set(upd(c7, { status: 'trashed', trashedAt: FV.serverTimestamp(), trashedFrom: 'ready' }));
  await expectOp('otro usuario no borra un plan de la papelera', () => col(B, A).doc(p3.id).delete(), false);
  await expectOp('borrado definitivo desde la papelera', () => p3.delete(), true);
  await expectOp('el plan activo no se puede borrar aunque se force', () => col(A).doc(p2.id).delete(), false);

  // ── historial independiente del plan
  const sRef = A.db.collection('users').doc(A.uid).collection('training_sessions').doc('hist1');
  await expectOp('sesión: crear con planId y planName', () => sRef.set({ dateKey: '2026-10-29', sessionName: 'S', durationSec: 60, planId: p3.id, planName: 'Para borrar', planRevision: 3, planSessionId: 's_aaaa1111', exercises: [] }), true);
  await expectOp('sesión: sigue legible tras borrar el plan', () => sRef.get(), true);
  await expectOp('sesión: no se puede reescribir el plan de origen', () => sRef.update({ planId: 'otro' }), false);

  // ── esquema antiguo: sigue legible (y escribible hasta retirarlo)
  const legacyRef = A.db.collection('users').doc(A.uid).collection('training_plan').doc('active');
  await expectOp('antiguo: el dueño lo lee', () => legacyRef.get(), true);
  await expectOp('antiguo: otro usuario no lo lee', () => B.db.collection('users').doc(A.uid).collection('training_plan').doc('active').get(), false);

  const failed = results.filter(r => !r.pass);
  results.forEach(r => console.log((r.pass ? 'OK   ' : 'FALLA') + ' ' + r.label + (r.pass ? '' : `  → esperado ${r.expected}, obtenido ${r.got}`)));
  console.log(`\n${results.length - failed.length}/${results.length} correctas`);
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('ERROR', e); process.exit(2); });

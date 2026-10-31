import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const O = require('../train-mental-ops.js');
const P = require('../train-plans.js');

const EX = [{ name: 'Max hang', sets: 3, workSec: 10, reps: 0, weight: 20, restSec: 180, rpeTarget: 8, exerciseId: 'dedos-1', exerciseContentVersion: 2, notes: 'nota' }];
const mkPlan = () => ({
  id: 'p1', revision: 3, name: 'Plan', weeks: 4, activeDays: [true, false, true, false, false, false, false],
  sessions: [
    { id: 's_a', day: 'L', name: 'A', exercises: JSON.parse(JSON.stringify(EX)) },
    { id: 's_b', day: 'X', name: 'B', exercises: JSON.parse(JSON.stringify(EX)), mental: [{ id: 'm05-x', contentVersion: 1 }] }
  ]
});
const sleep = ms => new Promise(r => setTimeout(r, ms));

// «Servidor» de pruebas: guarda lo que recibe tras la normalización real de los planes, con revisión y retardos
function fakeServer(plan, script = []) {
  const srv = { doc: P.normalizeContent(plan), revision: plan.revision, calls: [], received: [] };
  srv.savePlan = async candidate => {
    const step = script[srv.calls.length] || {};
    srv.calls.push(step);
    srv.received.push(candidate);
    if (step.delay) await sleep(step.delay);
    if (step.fail) return false;
    if (candidate.revision !== srv.revision) return false;                 // control de revisión, como KruxTrainStore
    srv.doc = P.normalizeContent(candidate);
    srv.revision += 1;
    candidate.revision = srv.revision;                                     // adopt()
    srv.doc.sessions.forEach((s, i) => { if (candidate.sessions[i]) candidate.sessions[i].id = s.id; });
    return true;
  };
  return srv;
}
const mkOps = (plan, srv, extra) => O.createOps({ limit: 5, isMulti: () => true, plans: () => [plan], savePlan: srv.savePlan, ...extra });
const ids = s => (s.mental || []).map(m => m.id);

describe('guardado de sessions[].mental[]: carrera y consistencia', () => {
  it('un guardado que falla no deja nada a medias en memoria', async () => {
    const plan = mkPlan(); const before = JSON.stringify(plan);
    const srv = fakeServer(plan, [{ fail: true }]);
    const res = await mkOps(plan, srv).add(plan, plan.sessions[0], 'c01-x', 1);
    expect(res).toEqual({ ok: false, reason: 'guardado' });
    expect(JSON.stringify(plan)).toBe(before);
    expect(ids(srv.doc.sessions[0])).toEqual([]);
  });

  it('añadir lento + quitar a continuación: el añadido que falla no llega al servidor', async () => {
    const plan = mkPlan();
    const srv = fakeServer(plan, [{ delay: 40, fail: true }, {}]);
    const ops = mkOps(plan, srv);
    const add = ops.add(plan, plan.sessions[0], 'c01-x', 1);            // en vuelo (y va a fallar)
    const rem = ops.remove(plan, plan.sessions[1], 'm05-x');            // se pide mientras el anterior sigue en vuelo
    const [a, r] = await Promise.all([add, rem]);
    expect(a.ok).toBe(false);
    expect(r.ok).toBe(true);
    // El segundo guardado se calculó sobre el estado confirmado: no arrastra el añadido fallido
    expect(ids(srv.received[1].sessions[0])).toEqual([]);
    expect(ids(srv.doc.sessions[0])).toEqual([]);
    expect(ids(srv.doc.sessions[1])).toEqual([]);
    // Memoria y servidor coinciden
    expect(plan.sessions.map(ids)).toEqual(srv.doc.sessions.map(ids));
  });

  it('dos añadidos seguidos no se pisan: el segundo incluye al primero y la revisión avanza', async () => {
    const plan = mkPlan();
    const srv = fakeServer(plan, [{ delay: 20 }, {}]);
    const ops = mkOps(plan, srv);
    const [a, b] = await Promise.all([ops.add(plan, plan.sessions[0], 'c01-x', 1), ops.add(plan, plan.sessions[0], 'c02-y', 1)]);
    expect(a.ok && b.ok).toBe(true);
    expect(ids(srv.doc.sessions[0])).toEqual(['c01-x', 'c02-y']);
    expect(ids(plan.sessions[0])).toEqual(['c01-x', 'c02-y']);
    expect(plan.revision).toBe(5);
    expect(srv.revision).toBe(5);
  });

  it('las operaciones se ejecutan de una en una', async () => {
    const plan = mkPlan(); let running = 0, max = 0;
    const savePlan = async c => { running++; max = Math.max(max, running); await sleep(10); running--; c.revision += 1; return true; };
    const ops = O.createOps({ limit: 5, isMulti: () => true, plans: () => [plan], savePlan });
    await Promise.all(['a1', 'a2', 'a3'].map(id => ops.add(plan, plan.sessions[0], id, 1)));
    expect(max).toBe(1);
    expect(ids(plan.sessions[0])).toEqual(['a1', 'a2', 'a3']);
  });

  it('el límite de cinco se respeta aunque se pidan seis seguidos', async () => {
    const plan = mkPlan(); const srv = fakeServer(plan);
    const ops = mkOps(plan, srv);
    const res = await Promise.all(['a', 'b', 'c', 'd', 'e', 'f'].map(id => ops.add(plan, plan.sessions[0], id, 1)));
    expect(res.map(r => r.ok)).toEqual([true, true, true, true, true, false]);
    expect(res[5].reason).toBe('limite');
    expect(ids(srv.doc.sessions[0])).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(srv.calls.length).toBe(5);                                       // el sexto ni se intenta guardar
  });

  it('un duplicado o quitar algo que no está no guarda nada', async () => {
    const plan = mkPlan(); const srv = fakeServer(plan);
    const ops = mkOps(plan, srv);
    expect((await ops.add(plan, plan.sessions[1], 'm05-x', 1)).reason).toBe('duplicado');
    expect((await ops.remove(plan, plan.sessions[0], 'nada')).reason).toBe('ausente');
    expect(srv.calls.length).toBe(0);
  });

  it('un conflicto de revisión (otro dispositivo) deja la memoria intacta', async () => {
    const plan = mkPlan(); const srv = fakeServer(plan);
    srv.revision = 9;                                                       // otro dispositivo ya guardó
    const before = JSON.stringify(plan);
    const res = await mkOps(plan, srv).add(plan, plan.sessions[0], 'c01-x', 1);
    expect(res.ok).toBe(false);
    expect(JSON.stringify(plan)).toBe(before);
  });

  it('se guarda una copia: el plan en memoria no es el que viaja a savePlan', async () => {
    const plan = mkPlan(); const srv = fakeServer(plan);
    await mkOps(plan, srv).add(plan, plan.sessions[0], 'c01-x', 1);
    expect(srv.received[0]).not.toBe(plan);
    expect(srv.received[0].sessions[0]).not.toBe(plan.sessions[0]);
  });

  it('con planes múltiples nunca guarda un plan sin id (crearía uno nuevo)', async () => {
    const plan = mkPlan(); delete plan.id; const srv = fakeServer(plan);
    const res = await mkOps(plan, srv).add(plan, plan.sessions[0], 'c01-x', 1);
    expect(res).toEqual({ ok: false, reason: 'plan' });
    expect(srv.calls.length).toBe(0);
  });

  it('en modo clásico (sin id) guarda y actualiza la sesión localizada por referencia', async () => {
    const plan = mkPlan(); delete plan.id; plan.sessions.forEach(s => delete s.id);
    const saved = [];
    const ops = O.createOps({ limit: 5, isMulti: () => false, plans: () => [plan], savePlan: async c => { saved.push(c); return true; } });
    const res = await ops.add(plan, plan.sessions[0], 'c01-x', 1);
    expect(res.ok).toBe(true);
    expect(ids(plan.sessions[0])).toEqual(['c01-x']);
    expect(ids(saved[0].sessions[0])).toEqual(['c01-x']);
  });

  it('si la vista se recarga entre medias, localiza el plan y la sesión por id', async () => {
    const plan = mkPlan(); const srv = fakeServer(plan);
    const reloaded = JSON.parse(JSON.stringify(plan));                      // objetos nuevos con los mismos ids
    const ops = mkOps(plan, srv, { plans: () => [reloaded] });
    const res = await ops.add(plan, plan.sessions[0], 'c01-x', 1);
    expect(res.ok).toBe(true);
    expect(ids(reloaded.sessions[0])).toEqual(['c01-x']);
  });

  it('el plan en memoria adopta la revisión y los ids que devuelve el guardado', async () => {
    const plan = mkPlan(); const srv = fakeServer(plan);
    await mkOps(plan, srv).add(plan, plan.sessions[0], 'c01-x', 1);
    expect(plan.revision).toBe(4);
  });
});

describe('cola: un rechazo no bloquea y no se escribe sobre revisiones obsoletas', () => {
  it('si savePlan rechaza (excepción), la operación falla y la siguiente se ejecuta', async () => {
    const plan = mkPlan(); const srv = fakeServer(plan);
    let n = 0;
    const savePlan = c => { n++; if (n === 1) return Promise.reject(new Error('red')); return srv.savePlan(c); };
    const ops = O.createOps({ limit: 5, isMulti: () => true, plans: () => [plan], savePlan });
    const [a, b] = await Promise.all([ops.add(plan, plan.sessions[0], 'c01-x', 1), ops.add(plan, plan.sessions[0], 'c02-y', 1)]);
    expect(a).toEqual({ ok: false, reason: 'guardado' });
    expect(b.ok).toBe(true);
    expect(ids(srv.doc.sessions[0])).toEqual(['c02-y']);
    expect(ids(plan.sessions[0])).toEqual(['c02-y']);
  });

  it('una excepción interna (savePlan síncrono que lanza, o plans() que lanza) se devuelve como fallo y no bloquea la fila', async () => {
    const plan = mkPlan(); const srv = fakeServer(plan);
    let boom = true;
    const ops = O.createOps({
      limit: 5, isMulti: () => true,
      plans: () => { if (boom) { boom = false; throw new Error('plans()'); } return [plan]; },
      savePlan: srv.savePlan
    });
    const first = await ops.add(plan, plan.sessions[0], 'c01-x', 1);
    expect(first).toEqual({ ok: false, reason: 'error' });
    const throwing = O.createOps({ limit: 5, isMulti: () => true, plans: () => [plan], savePlan: () => { throw new Error('sync'); } });
    expect(await throwing.add(plan, plan.sessions[0], 'c01-x', 1)).toEqual({ ok: false, reason: 'guardado' });
    const next = await ops.add(plan, plan.sessions[0], 'c02-y', 1);
    expect(next.ok).toBe(true);
    expect(ids(srv.doc.sessions[0])).toEqual(['c02-y']);
  });

  it('el editor ya guardó una revisión más nueva: conflicto, sin escribir encima y sin cambiar la memoria', async () => {
    const plan = mkPlan(); const srv = fakeServer(plan);
    const ops = mkOps(plan, srv);
    // El editor confirma la revisión 4 antes de que llegue mi escritura (que lleva la revisión 3)
    const editorDoc = P.normalizeContent({ ...plan, name: 'Renombrado por el editor' });
    srv.doc = editorDoc; srv.revision = 4;
    const res = await ops.add(plan, plan.sessions[0], 'c01-x', 1);
    expect(res).toEqual({ ok: false, reason: 'guardado' });
    expect(srv.doc.name).toBe('Renombrado por el editor');                   // no se pisó
    expect(ids(srv.doc.sessions[0])).toEqual([]);
    expect(plan.revision).toBe(3);                                           // memoria intacta: aún no ha recargado
    // Tras recargar (objetos nuevos con la revisión 4) el mismo cambio sí se guarda, sobre la revisión vigente
    const reloaded = { ...JSON.parse(JSON.stringify(plan)), name: 'Renombrado por el editor', revision: 4 };
    const ops2 = O.createOps({ limit: 5, isMulti: () => true, plans: () => [reloaded], savePlan: srv.savePlan });
    const again = await ops2.add(plan, plan.sessions[0], 'c01-x', 1);
    expect(again.ok).toBe(true);
    expect(srv.doc.name).toBe('Renombrado por el editor');
    expect(ids(srv.doc.sessions[0])).toEqual(['c01-x']);
    expect(reloaded.revision).toBe(5);
  });

  it('el editor guardó (revisión nueva) en medio de una fila: la segunda operación falla, no pisa, y la memoria no diverge', async () => {
    const plan = mkPlan(); const srv = fakeServer(plan, [{ delay: 30 }, {}]);
    const ops = mkOps(plan, srv);
    const add = ops.add(plan, plan.sessions[0], 'c01-x', 1);                 // revisión 3 → 4, en vuelo
    const rem = ops.remove(plan, plan.sessions[1], 'm05-x');                 // en fila detrás
    setTimeout(() => { srv.revision = 7; }, 10);                             // «el editor» sube la revisión del servidor
    const [a, r] = await Promise.all([add, rem]);
    expect(a.ok).toBe(false);                                                // la primera ya chocó con la revisión 7
    expect(r.ok).toBe(false);                                                // la segunda parte de la revisión 3 y también choca
    expect(plan.sessions.map(ids)).toEqual([[], ['m05-x']]);                 // memoria sin cambios
    expect(srv.doc.sessions.map(ids)).toEqual([[], ['m05-x']]);              // servidor sin cambios
  });

  it('si hay copias del mismo plan con revisiones distintas, parte de la más reciente', async () => {
    const stale = mkPlan(); stale.revision = 2;
    const fresh = mkPlan(); fresh.revision = 3;
    const srv = fakeServer(fresh);
    const ops = O.createOps({ limit: 5, isMulti: () => true, plans: () => [stale, fresh], savePlan: srv.savePlan });
    const res = await ops.add(stale, stale.sessions[0], 'c01-x', 1);
    expect(res.ok).toBe(true);
    // Si hubiera partido de la copia obsoleta (revisión 2) el servidor (en la 3) la habría rechazado
    expect(stale.revision).toBe(4);
    expect(fresh.revision).toBe(4);
    expect(ids(stale.sessions[0])).toEqual(['c01-x']);
    expect(ids(fresh.sessions[0])).toEqual(['c01-x']);
  });
});

describe('sessions[].exercises[] no se altera', () => {
  it('añadir y quitar conservan los ejercicios físicos, en memoria y tras la normalización de planes', async () => {
    const plan = mkPlan(); const srv = fakeServer(plan);
    const normalizedBefore = JSON.stringify(P.normalizeContent(plan).sessions.map(s => s.exercises));
    const ops = mkOps(plan, srv);
    await ops.add(plan, plan.sessions[0], 'c01-x', 2);
    await ops.add(plan, plan.sessions[1], 'c02-y', 1);
    await ops.remove(plan, plan.sessions[1], 'm05-x');
    expect(plan.sessions.map(s => s.exercises)).toEqual([EX, EX]);
    expect(JSON.stringify(srv.doc.sessions.map(s => s.exercises))).toBe(normalizedBefore);
    expect(srv.doc.sessions[0].mental).toEqual([{ id: 'c01-x', contentVersion: 2 }]);
    expect(srv.doc.sessions[1].mental).toEqual([{ id: 'c02-y', contentVersion: 1 }]);
  });

  it('quitar el último ejercicio mental elimina el campo y no deja un array vacío', async () => {
    const plan = mkPlan(); const srv = fakeServer(plan);
    await mkOps(plan, srv).remove(plan, plan.sessions[1], 'm05-x');
    expect('mental' in plan.sessions[1]).toBe(false);
    expect('mental' in srv.doc.sessions[1]).toBe(false);
  });

  it('una sesión antigua sin mental no gana el campo al guardar otra sesión', async () => {
    const plan = mkPlan(); const srv = fakeServer(plan);
    await mkOps(plan, srv).add(plan, plan.sessions[1], 'c02-y', 1);
    expect('mental' in srv.doc.sessions[0]).toBe(false);
    expect('mental' in plan.sessions[0]).toBe(false);
  });
});

describe('progreso guardado solo en el dispositivo', () => {
  const memStorage = () => { const m = {}; return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, m }; };
  const mk = (storage, uid = 'u1') => O.createProgress({ storage: () => storage, uid: () => uid, today: () => '2026-10-31' });

  it('con almacenamiento correcto: lo anota, lo lee y cuenta repeticiones', () => {
    const st = memStorage(); const pr = mk(st);
    expect(pr.mark('m05-x')).toBe(true);
    expect(pr.mark('m05-x')).toBe(true);
    expect(pr.read()['m05-x']).toEqual({ n: 2, last: '2026-10-31' });
    expect(pr.doneToday('m05-x')).toBe(true);
    expect(Object.keys(st.m)).toEqual(['krux.mental.v1.u1']);
  });

  it('si setItem falla (cuota o modo privado) mark devuelve false y no hay nada anotado', () => {
    const st = memStorage(); st.setItem = () => { throw new Error('QuotaExceededError'); };
    const pr = mk(st);
    expect(pr.mark('m05-x')).toBe(false);
    expect(pr.read()).toEqual({});
    expect(pr.doneToday('m05-x')).toBe(false);
  });

  it('si el almacenamiento acepta pero no conserva el dato, tampoco se da por guardado', () => {
    const st = memStorage(); st.setItem = () => {};                          // escritura silenciosamente ignorada
    expect(mk(st).mark('m05-x')).toBe(false);
  });

  it('si el almacenamiento no está disponible (acceso bloqueado) no lanza y devuelve false', () => {
    const pr = O.createProgress({ storage: () => { throw new Error('SecurityError'); }, uid: () => 'u1', today: () => '2026-10-31' });
    expect(pr.mark('x')).toBe(false);
    expect(pr.read()).toEqual({});
  });

  it('datos corruptos se leen como vacíos', () => {
    const st = memStorage(); st.m['krux.mental.v1.u1'] = '{no es json';
    expect(mk(st).read()).toEqual({});
  });

  it('sin sesión usa la clave «anon» y no se mezcla con la de una cuenta', () => {
    const st = memStorage();
    mk(st, null).mark('m05-x');
    expect(Object.keys(st.m)).toEqual(['krux.mental.v1.anon']);
    expect(mk(st, 'u1').read()).toEqual({});                                 // no se transfiere al iniciar sesión
  });
});

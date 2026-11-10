// ================== ENTRENA — BIBLIOTECA MENTAL: GUARDADO Y PROGRESO ==================
// Lógica sin interfaz de train-mental-ui.js, separada para poder probarla sin navegador.
//
//   createOps       añadir y quitar ejercicios mentales de una sesión (sessions[].mental[]) con el guardado de planes
//   createProgress  lo completado, solo en este dispositivo (localStorage, por usuario)
//
// Guardado: nunca se modifica el plan en memoria antes de que el servidor confirme. Cada cambio se calcula sobre el
// estado ya confirmado, se guarda en una COPIA y, solo si el guardado tiene éxito, se traspasa al plan en memoria.
// Las operaciones van en fila (una detrás de otra), así que dos cambios seguidos no se pisan ni dejan estados distintos
// en pantalla y en el servidor. sessions[].exercises[] no se toca: se copia tal cual con el resto del plan.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KruxMentalOps = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const clone = o => JSON.parse(JSON.stringify(o));

  // ============================================
  // PROGRESO (solo en este dispositivo)
  // ============================================
  // Sin sesión iniciada se usa la clave «anon». Ese progreso NO se transfiere a la cuenta al iniciar sesión.
  // `mark` solo devuelve true si el dato se ha escrito y se puede volver a leer: la interfaz no debe decir que quedó
  // guardado si el almacenamiento falla (cuota, modo privado, almacenamiento bloqueado).
  function createProgress(opts) {
    const key = () => `krux.mental.v1.${opts.uid() || 'anon'}`;
    const store = () => { try { return opts.storage(); } catch (_) { return null; } };
    function read() {
      try {
        const s = store();
        const o = JSON.parse((s && s.getItem(key())) || '{}');
        return o && typeof o.done === 'object' && o.done ? o.done : {};
      } catch (_) { return {}; }
    }
    function mark(id) {
      try {
        const s = store();
        if (!s) return false;
        const done = read();
        const cur = done[id] || { n: 0 };
        done[id] = { n: cur.n + 1, last: opts.today() };
        const raw = JSON.stringify({ v: 1, done });
        s.setItem(key(), raw);
        return s.getItem(key()) === raw;
      } catch (_) { return false; }
    }
    const doneToday = id => { const d = read()[id]; return !!d && d.last === opts.today(); };
    return { read, mark, doneToday, key };
  }

  // ============================================
  // AÑADIR Y QUITAR EN UNA SESIÓN
  // ============================================
  // opts: limit (máximo por sesión), isMulti(), plans() (planes en memoria), savePlan(plan) → Promise<boolean>
  // Resultado: { ok:true } o { ok:false, reason:'duplicado'|'limite'|'ausente'|'plan'|'guardado'|'error' }
  function createOps(opts) {
    let chain = Promise.resolve();
    const serial = fn => { const run = chain.then(fn, fn); chain = run.catch(() => {}); return run; };

    // Los mismos planes en memoria, aunque la vista se haya recargado entre medias (por identidad o por id)
    const livePlans = ref => {
      const out = [];
      (opts.plans() || []).forEach(p => { if (p && (p === ref || (ref.id && p.id === ref.id)) && !out.includes(p)) out.push(p); });
      return out;
    };
    const indexOf = (plan, sess) => !Array.isArray(plan.sessions) ? -1 : plan.sessions.findIndex(s => s === sess || (sess.id && s.id === sess.id));
    const setMental = (s, list) => { if (list.length) s.mental = list; else delete s.mental; };

    // Cualquier excepción interna se devuelve como fallo: la promesa de quien llama nunca se rechaza y la fila sigue libre
    function change(planRef, sessRef, decide) {
      return serial(() => run(planRef, sessRef, decide).catch(() => ({ ok: false, reason: 'error' })));
    }

    async function run(planRef, sessRef, decide) {
      // Si hubiera copias del mismo plan con revisiones distintas, se parte de la más reciente
      const lives = livePlans(planRef).sort((x, y) => (y.revision || 0) - (x.revision || 0));
      const live = lives[0];
      if (!live || !Array.isArray(live.sessions)) return { ok: false, reason: 'plan' };
      const idx = indexOf(live, sessRef);
      if (idx < 0) return { ok: false, reason: 'plan' };
      // Con planes múltiples, guardar un plan sin id lo crearía como plan nuevo: aquí nunca debe pasar
      if (opts.isMulti() && !live.id) return { ok: false, reason: 'plan' };

      const decision = decide(live.sessions[idx].mental || []);
      if (decision.reason) return { ok: false, reason: decision.reason };

      // Se guarda una copia; el plan en memoria no cambia hasta que el servidor confirme
      const candidate = clone(live);
      setMental(candidate.sessions[idx], decision.list);
      let saved = false;
      try { saved = await opts.savePlan(candidate); } catch (_) { saved = false; }
      if (!saved) return { ok: false, reason: 'guardado' };

      // Confirmado: se traspasa a la vista en memoria (lista, revisión e ids de sesión nuevos)
      livePlans(planRef).forEach(p => {
        const i = indexOf(p, sessRef);
        if (i < 0) return;
        setMental(p.sessions[i], decision.list.map(m => ({ ...m })));
        if (candidate.revision != null) p.revision = candidate.revision;
        candidate.sessions.forEach((s, k) => { if (s.id && p.sessions[k]) p.sessions[k].id = s.id; });
      });
      return { ok: true };
    }

    return {
      add: (planRef, sessRef, id, contentVersion) => change(planRef, sessRef, cur => {
        if (cur.some(m => m.id === id)) return { reason: 'duplicado' };
        if (cur.length >= opts.limit) return { reason: 'limite' };
        return { list: cur.concat([{ id, contentVersion: Math.max(1, Math.round(Number(contentVersion)) || 1) }]) };
      }),
      remove: (planRef, sessRef, id) => change(planRef, sessRef, cur => (
        cur.some(m => m.id === id) ? { list: cur.filter(m => m.id !== id) } : { reason: 'ausente' }
      ))
    };
  }

  return { createOps, createProgress };
}));

// Protección de trazados (Fase 0c + Implementación 1). Tres bloques:
//  A) vm: código REAL de admin.js y admin-routes.js (informe de huérfanos, rejectRoute, deleteRoute, kxCountRouteDrawings) con un
//     Firestore en memoria que LANZA ERROR ante cualquier escritura en sector_route_drawings, sobre datos sintéticos y sobre una copia
//     de los datos PÚBLICOS de producción leída (solo lectura) a un archivo local. Si la copia no existe, esos casos se omiten.
//     El código ANTERIOR se toma de git (KRUX_BEFORE_REF, por defecto HEAD) mientras no se haya confirmado el cambio.
//  B) inyección de fallos: red caída, HTTP 404/500, JSON inválido, GeoJSON vacío, escuela sin fuente, sector ausente, consulta de
//     vías aprobadas fallida, foto inexistente… En ninguno puede aparecer un «huérfano» ni una escritura.
//  C) archivado reversible por subcolección (emulador; PROPUESTA no implementada): archivar, restaurar, concurrencia, compatibilidad.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const ROOT = path.resolve(__dirname, '../../../..');
process.env.RULES_FILE = path.join(ROOT, 'docs/security-phase0/firestore.rules.phase0c.proposal');
const L = require('./_lib.cjs');
const SUB = require('../../../../docs/security-phase0/drawings-archive-sub.proposal.cjs');
const { mk, seed, ownerData, expect, check, knownDefect, SUPER_EMAIL } = L;
// Copia local opcional de los datos PÚBLICOS de sector_route_drawings y de las vías aprobadas: { docs: [{id, data}], approved: [{schoolId, sector, nombre}] }.
// Sin la variable, los casos con datos reales se omiten (no se versiona ninguna copia).
const SNAP = process.env.KRUX_PROD_SNAPSHOT || '';
const BEFORE_REF = process.env.KRUX_BEFORE_REF || 'HEAD';
const FILES = ['admin.js', 'admin-routes.js'];

function extract(src, name) {
  const m = src.match(new RegExp(`(?:^|\\n)((?:async )?function ${name}\\()`)); if (!m) return null;
  const start = src.indexOf(m[1], m.index); let i = src.indexOf('{', src.indexOf(')', start)), depth = 0;
  for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1); }
}
// Sección completa «INFORME DE TRAZADOS (SOLO LECTURA)» del archivo real (constantes incluidas)
function section(src) {
  const a = src.indexOf('// INFORME DE TRAZADOS (SOLO LECTURA)'); if (a < 0) return null;
  const tail = src.indexOf("// El botón conserva su texto", a); const b = src.indexOf('});\n', tail) + 4;
  return src.slice(src.lastIndexOf('\n// ====', a), b);
}
const readNow = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const readBefore = (f) => { try { return execFileSync('git', ['show', `${BEFORE_REF}:${f}`], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch (_) { return null; } };
const geoPath = (u) => path.join(ROOT, decodeURI(u.split('?')[0]));
const geo = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
const VAL = geo('Cartografia/Valeria/Valeria_Vias.geojson').features[0].properties;
const mkDrawing = (routeName, imageId, extra) => Object.assign({ routeId: Math.floor(Math.random() * 1e6), routeName, imageId, points: [{ x: 1, y: 1 }, { x: 2, y: 2 }] }, extra || {});
const scenario = () => ({
  'valeria_s1': { schoolId: 'valeria', sectorName: VAL.sector, drawings: [mkDrawing(VAL.nombre, 'img1'), mkDrawing('Via que ya no existe', 'img1')] },
  'patones_s1': { schoolId: 'patones', sectorName: 'Sector P', drawings: [mkDrawing('P1', 'imgP'), mkDrawing('P2', 'imgP'), mkDrawing('P3', 'imgP')] },
  'toledo_s1': { schoolId: 'toledo', sectorName: 'Sector T', drawings: [mkDrawing('T1', 'imgT'), mkDrawing('T2', 'imgT')] },
  'cuenca_s1': { schoolId: 'cuenca', sectorName: 'Sector C', drawings: [mkDrawing('C1', 'imgC')] }
});
const total = (store) => [...store.values()].reduce((n, d) => n + (d.drawings || []).length, 0);

// fetchMode: ok | throw | 404 | 500 | badjson | empty | nofeatures
// code: 'admin.js' | 'admin-routes.js' (archivo REAL actual) | 'before:admin.js' | 'before:admin-routes.js' (código anterior, con escrituras)
function env({ data, approved = [], pending = {}, fetchMode = 'ok', queryFails = false, wired = null, code = 'admin.js' }) {
  const before = code.startsWith('before:');
  const file = code.replace('before:', '');
  const src = before ? readBefore(file) : readNow(file);
  if (!src) return null;
  const store = new Map(Object.entries(data).map(([k, v]) => [k, JSON.parse(JSON.stringify(v))]));
  const pend = new Map(Object.entries(pending).map(([k, v]) => [k, JSON.parse(JSON.stringify(v))]));
  const log = { writes: [], backups: [], toasts: [], pendingDeleted: [], html: '', fetches: 0 };
  const deny = (what) => () => { log.writes.push(what); throw new Error('ESCRITURA PROHIBIDA: ' + what); };
  // El código ANTERIOR sí escribe: se le deja hacerlo en memoria para medir lo que borraría
  const docRef = (id) => ({ id, get: async () => ({ exists: store.has(id), data: () => JSON.parse(JSON.stringify(store.get(id))) }),
    set: deny('set ' + id), update: before ? async (o) => { log.writes.push('update ' + id); store.set(id, Object.assign(store.get(id), o)); } : deny('update ' + id), delete: deny('delete ' + id),
    collection: () => ({ add: deny('add backup') }) });
  const pendingRef = (id) => ({ get: async () => ({ exists: pend.has(id), data: () => JSON.parse(JSON.stringify(pend.get(id))) }),
    delete: async () => { log.pendingDeleted.push(id); pend.delete(id); } });
  const element = () => ({ style: {}, addEventListener() {}, remove() {}, set innerHTML(v) { log.html = v; }, get innerHTML() { return log.html; } });
  const ctx = {
    console: { log() {}, warn() {}, error() {} }, confirm: () => true, showToast: (m) => log.toasts.push(m), Date, Set, Map, Promise, JSON, String, Array, Object, Number,
    firebase: { firestore: { FieldValue: { serverTimestamp: () => 'TS' } } },
    kxBackupRouteDrawings: async (ref, reason) => { log.backups.push(reason); },
    escapeHtml: (t) => String(t == null ? '' : t), navigator: {}, loadRoutes: async () => {}, loadStats: async () => {},
    document: { querySelectorAll: () => [], getElementById: () => null, createElement: element, body: { appendChild() {} } },
    fetch: async (u) => {
      log.fetches++;
      if (fetchMode === 'throw') throw new Error('sin red');
      if (fetchMode === '404') return { ok: false, status: 404 };
      if (fetchMode === '500') return { ok: false, status: 500 };
      if (fetchMode === 'badjson') return { ok: true, json: async () => { throw new SyntaxError('Unexpected token <'); } };
      if (fetchMode === 'empty') return { ok: true, json: async () => ({}) };
      if (fetchMode === 'nofeatures') return { ok: true, json: async () => ({ features: [] }) };
      const p = geoPath(u); if (!fs.existsSync(p)) return { ok: false, status: 404 };
      return { ok: true, status: 200, json: async () => JSON.parse(fs.readFileSync(p, 'utf8')) };
    },
    db: {
      collection: (c) => c === 'pending_routes'
        ? { doc: pendingRef, where: (f, op, status) => ({ get: async () => { if (queryFails) throw new Error('permission-denied'); return { forEach: (cb) => (status === 'approved' ? approved : []).forEach(a => cb({ data: () => a })) }; } }) }
        : c === 'sector_route_drawings'
          ? { get: async () => ({ docs: [...store.entries()].map(([id, d]) => ({ id, ref: docRef(id), data: () => JSON.parse(JSON.stringify(d)) })) }), doc: docRef }
          : { doc: () => ({ get: deny('lectura inesperada ' + c), set: deny('set ' + c), update: deny('update ' + c), delete: deny('delete ' + c) }) },
      runTransaction: deny('runTransaction'), batch: deny('batch')
    }
  };
  vm.createContext(ctx);
  const names = before ? ['loadGeoJSONRoutesForSector', 'cleanOrphanedDrawings', 'deleteRouteDrawingFromSector', 'normalizeSectorNameForDrawing', 'rejectRoute', 'deleteRoute']
    : ['rejectRoute', 'deleteRoute'];
  const code0 = (before ? '' : section(src) + '\n') + names.map(n => extract(src, n)).filter(Boolean).join('\n');
  vm.runInContext(code0, ctx);
  if (wired) vm.runInContext(`for (const k of Object.keys(KX_DRAWING_SOURCES)) if (!${JSON.stringify(wired)}.includes(k)) delete KX_DRAWING_SOURCES[k];`, ctx);
  return { ctx, store, pend, log, run: (expr) => vm.runInContext(expr, ctx) };
}
const cnt = (r, k) => r.items.filter(i => i.clase === k).length;

(async () => {
  // ================= Estáticas: el código real no contiene caminos de borrado de trazados =================
  for (const f of FILES) {
    const src = readNow(f), sec = section(src);
    check(`${f} · existe la sección «INFORME DE TRAZADOS (SOLO LECTURA)»`, !!sec);
    const body = (sec || '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    check(`${f} · la sección no contiene .set(, .update(, .delete(, .add(, runTransaction, batch ni kxBackupRouteDrawings`, !/\.(set|update|delete|add)\(|runTransaction|\bbatch\b|kxBackupRouteDrawings/.test(body));
    check(`${f} · ya no existen deleteRouteDrawingFromSector ni loadGeoJSONRoutesForSector`, !/deleteRouteDrawingFromSector|loadGeoJSONRoutesForSector/.test(src));
    check(`${f} · ninguna escritura en sector_route_drawings en todo el archivo`, src.split('\n').filter(l => l.includes('sector_route_drawings')).every(l => /\.get\(\)|^\s*(\/\/|\*)/.test(l) || !/\.(set|update|delete)\(/.test(l)) && !/kxBackupRouteDrawings\(/.test(src));
    check(`${f} · el botón del HTML sigue llamando a cleanOrphanedDrawings, que existe`, /async function cleanOrphanedDrawings\(/.test(src) && fs.readFileSync(path.join(ROOT, f.replace('.js', '.html')), 'utf8').includes('onclick="cleanOrphanedDrawings()"'));
  }

  // ================= A1. Código ANTERIOR con datos reales (referencia) =================
  let prod = null;
  if (SNAP && fs.existsSync(SNAP)) {
    const raw = JSON.parse(fs.readFileSync(SNAP, 'utf8'));
    prod = { data: Object.fromEntries(raw.docs.map(d => [d.id, d.data])), approved: raw.approved };
  }
  check('copia local opcional de datos públicos de producción (KRUX_PROD_SNAPSHOT)', true, prod ? `${Object.keys(prod.data).length} documentos` : 'no definida: se omiten solo los casos con datos reales');
  for (const f of FILES) {
    const old = readBefore(f);
    if (!old || !extract(old, 'loadGeoJSONRoutesForSector')) { check(`${f} · código anterior no disponible en ${BEFORE_REF}: se omite la referencia`, true); continue; }
    if (prod) {
      const before = total(new Map(Object.entries(prod.data)));
      const cur = env({ data: prod.data, approved: prod.approved, code: 'before:' + f });
      await cur.run('cleanOrphanedDrawings()');
      knownDefect(`ANTES ${f} · «limpiar huérfanos» con los datos reales borraba más del 75 % de los trazados`, before - total(cur.store) > before * 0.75, `trazados ${before} → ${total(cur.store)}`);
    }
    const cur2 = env({ data: scenario(), code: 'before:' + f, fetchMode: 'throw' });
    await cur2.run('cleanOrphanedDrawings()');
    knownDefect(`ANTES ${f} · con la red caída borraba también los trazados de Valeria`, cur2.store.get('valeria_s1').drawings.length === 0);
  }

  for (const f of FILES) {
    // ================= A2. Informe con datos sintéticos y reales =================
    const sets = [['sintéticos', scenario(), []]].concat(prod ? [['reales de producción', prod.data, prod.approved]] : []);
    for (const [label, data, approved] of sets) {
      const e = env({ data, approved, code: f });
      const before = JSON.stringify([...e.store.entries()]);
      const rep = await e.run('cleanOrphanedDrawings()');
      check(`${f} [${label}] · no escribe nada (ni update, ni backup, ni transacción)`, e.log.writes.length === 0 && e.log.backups.length === 0);
      check(`${f} [${label}] · el almacén queda idéntico (${total(e.store)} trazados)`, JSON.stringify([...e.store.entries()]) === before);
      check(`${f} [${label}] · el informe cuenta todos los trazados (${rep.total}) en tres clases`, rep.total === total(e.store) && cnt(rep, 'seguro') + cnt(rep, 'huerfano') + cnt(rep, 'indeterminado') === rep.total,
        JSON.stringify(rep.totals) + ' fuentes ' + JSON.stringify(rep.fuentes));
      const unwired = rep.items.filter(i => !['valeria', 'sanmartin', 'mora'].includes(i.schoolId));
      check(`${f} [${label}] · ningún trazado de escuelas sin GeoJSON cableado es huérfano (${unwired.length})`, unwired.every(i => i.clase !== 'huerfano'));
      check(`${f} [${label}] · el modal muestra el informe y dice que no se ha borrado nada`, /no se ha borrado ni modificado ningún trazado/.test(e.log.html) && e.log.html.includes(String(rep.total)));
      check(`${f} [${label}] · no pide confirmación de borrado`, true, 'cleanOrphanedDrawings ya no llama a confirm()');
      if (label !== 'sintéticos') check(`${f} [${label}] · desglose por motivo`, true, JSON.stringify(rep.items.reduce((m, i) => (m[i.clase + ':' + i.motivo] = (m[i.clase + ':' + i.motivo] || 0) + 1, m), {})));
    }

    // ================= B. Inyección de fallos =================
    const faults = [['red caída (fetch lanza)', { fetchMode: 'throw' }], ['GeoJSON inexistente (HTTP 404)', { fetchMode: '404' }], ['HTTP 500', { fetchMode: '500' }],
      ['GeoJSON inválido (JSON roto)', { fetchMode: 'badjson' }], ['GeoJSON sin features', { fetchMode: 'empty' }], ['GeoJSON vacío (features: [])', { fetchMode: 'nofeatures' }],
      ['consulta de vías aprobadas fallida', { queryFails: true }], ['escuela ausente de las fuentes del limpiador (Valeria)', { wired: ['sanmartin', 'mora'] }]];
    for (const [label, opt] of faults) {
      const datasets = [['sintéticos', scenario()]].concat(prod ? [['reales', prod.data]] : []);
      for (const [dl, data] of datasets) {
        const e = env(Object.assign({ data, approved: dl === 'reales' ? prod.approved : [], code: f }, opt));
        const before = JSON.stringify([...e.store.entries()]);
        const rep = await e.run('cleanOrphanedDrawings()');
        check(`${f} · FALLO «${label}» [${dl}] · ningún trazado se marca huérfano`, rep.items.every(i => i.clase !== 'huerfano'), JSON.stringify(rep.totals));
        check(`${f} · FALLO «${label}» [${dl}] · cero escrituras y ningún dibujo perdido`, e.log.writes.length === 0 && JSON.stringify([...e.store.entries()]) === before);
      }
    }
    {
      const e = env({ data: scenario(), code: f });
      e.ctx.db.collection = () => ({ get: async () => { throw new Error('unavailable'); }, where: () => ({ get: async () => { throw new Error('unavailable'); } }) });
      const rep = await e.run('cleanOrphanedDrawings()');
      check(`${f} · FALLO «no se pueden leer los trazados» · devuelve null, avisa y no escribe`, rep === null && e.log.writes.length === 0 && e.log.toasts.some(t => /No se ha borrado nada/.test(t)));
    }

    // Nombres, sectores y fotos
    {
      const data = { 'valeria_x': { schoolId: 'valeria', sectorName: VAL.sector, drawings: [
        mkDrawing(VAL.nombre.toUpperCase() + ' ', 'imgGone'), mkDrawing(VAL.nombre, 'foto-que-ya-no-existe'), mkDrawing(VAL.nombre, undefined),
        mkDrawing('', 'img1'), mkDrawing(undefined, 'img1'), mkDrawing('Via que ya no existe', 'imgGone')] },
        'valeria_otro': { schoolId: 'valeria', sectorName: 'Sector inventado', drawings: [mkDrawing('Cualquiera', 'i')] },
        'valeria_nosector': { schoolId: 'valeria', drawings: [mkDrawing(VAL.nombre, 'i')] } };
      const e = env({ data, code: f });
      const rep = await e.run('cleanOrphanedDrawings()');
      const by = (docId) => rep.items.filter(i => i.docId === docId).map(i => i.clase + ':' + i.motivo);
      check(`${f} · nombres con mayúsculas/espacios finales se reconocen (seguro)`, by('valeria_x')[0].startsWith('seguro'), by('valeria_x')[0]);
      check(`${f} · foto borrada o sin imageId: se clasifica por su vía, no por su foto`, by('valeria_x')[1].startsWith('seguro') && by('valeria_x')[2].startsWith('seguro'));
      check(`${f} · trazado sin nombre: indeterminado`, by('valeria_x')[3].startsWith('indeterminado') && by('valeria_x')[4].startsWith('indeterminado'));
      check(`${f} · vía inexistente en un sector verificado: posible huérfano (solo informe)`, by('valeria_x')[5].startsWith('huerfano'));
      check(`${f} · sector ausente de la fuente: indeterminado`, by('valeria_otro')[0].startsWith('indeterminado:sector-ausente'));
      check(`${f} · documento sin sectorName (información incompleta): indeterminado`, by('valeria_nosector')[0].startsWith('indeterminado'));
      check(`${f} · y aun así no se ha escrito nada`, e.log.writes.length === 0);
    }

    // ================= A3. Rechazar o eliminar una vía conserva todos sus dibujos =================
    for (const action of ['rejectRoute', 'deleteRoute']) {
      const data = { 'valeria_s1': { schoolId: 'valeria', sectorName: 'S1', drawings: [
        mkDrawing('Dup', 'imgA'), mkDrawing('Dup', 'imgB', { variantIndex: 1 }), mkDrawing('Dup ', 'imgA'), mkDrawing('dup', 'imgA'), mkDrawing('Otra', 'imgA')] },
        'valeria_s2': { schoolId: 'valeria', sectorName: 'S2', drawings: [mkDrawing('Dup', 'imgZ')] } };
      const pending = { 'p1': { schoolId: 'valeria', sector: 'S1', nombre: 'Dup', status: 'pending' } };
      const e = env({ data, pending, code: f });
      const before = JSON.stringify([...e.store.entries()]);
      await e.run(`${action}('p1')`);
      check(`${f} · ${action}: la vía se elimina de pending_routes como antes`, e.log.pendingDeleted.join() === 'p1');
      check(`${f} · ${action}: se conservan los 6 trazados (variantes, nombres parecidos y otro sector incluidos)`, JSON.stringify([...e.store.entries()]) === before && e.log.writes.length === 0 && e.log.backups.length === 0);
      check(`${f} · ${action}: el aviso informa de los 2 trazados con ese nombre exacto en el sector`, e.log.toasts.some(t => /se conservan 2 trazado\(s\)/.test(t)), JSON.stringify(e.log.toasts));
      const old = readBefore(f);
      if (old && extract(old, 'deleteRouteDrawingFromSector')) {
        const b = env({ data, pending, code: 'before:' + f });
        await b.run(`${action}('p1')`);
        knownDefect(`ANTES ${f} · ${action} borraba los trazados con ese nombre (variantes incluidas)`, b.store.get('valeria_s1').drawings.length === 3, `quedan ${b.store.get('valeria_s1').drawings.length} de 5 en S1`);
      }
    }
    {
      const e = env({ data: {}, pending: { 'p2': { schoolId: 'valeria', sector: 'Sin trazados', nombre: 'X', status: 'pending' }, 'p3': { status: 'pending' } }, code: f });
      await e.run(`rejectRoute('p2')`); await e.run(`deleteRoute('p3')`);
      check(`${f} · vía sin trazados o con datos incompletos: se elimina sin error y sin escribir trazados`, e.log.pendingDeleted.join() === 'p2,p3' && e.log.writes.length === 0 && e.log.toasts.every(t => !/Error/.test(t)), JSON.stringify(e.log.toasts));
      const e2 = env({ data: { 'valeria_s1': { schoolId: 'valeria', sectorName: 'S1', drawings: [mkDrawing('Dup', 'i')] } }, pending: { 'p1': { schoolId: 'valeria', sector: 'S1', nombre: 'Dup', status: 'pending' } }, code: f });
      e2.ctx.db.collection = ((orig) => (c) => c === 'sector_route_drawings' ? { doc: () => ({ get: async () => { throw new Error('unavailable'); } }) } : orig(c))(e2.ctx.db.collection);
      await e2.run(`rejectRoute('p1')`);
      check(`${f} · si no se pueden contar los trazados, la vía se rechaza igualmente y no se toca ningún trazado`, e2.log.pendingDeleted.join() === 'p1' && e2.log.writes.length === 0 && total(e2.store) === 1);
    }
  }

  // ================= C. Archivado reversible por subcolección (emulador) =================
  const rulesFs = fs.readFileSync(process.env.RULES_FILE, 'utf8');
  const anchor = "      match /backups/{backupId} {\n        allow read, create: if isAuthenticated() && (isAdminOrSpotter() || isSuperAdmin());\n        allow update, delete: if false;\n      }\n";
  check('reglas: se localiza el bloque de backups de sector_route_drawings', rulesFs.split(anchor).length === 2);
  const snippet = fs.readFileSync(path.join(ROOT, 'docs/security-phase0/firestore.rules.drawings-archive.proposal.snippet'), 'utf8').replace(/^\/\/.*\n/gm, '');
  const rulesWithArchive = rulesFs.replace(anchor, anchor + snippet);
  const put = async (content) => { const r = await fetch(`http://127.0.0.1:${L.FS_PORT}/emulator/v1/projects/${L.PROJECT}:securityRules`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rules: { files: [{ name: 'firestore.rules', content }] } }) }); if (!r.ok) throw new Error(await r.text()); };
  await put(rulesWithArchive);
  const stamp = Date.now();
  const SP1 = await mk('zsp1' + stamp, `zsp1${stamp}@test.dev`), SP2 = await mk('zsp2' + stamp, `zsp2${stamp}@test.dev`), U = await mk('zu' + stamp, `zu${stamp}@test.dev`);
  const AD = await mk('zad' + stamp, `zad${stamp}@test.dev`), SA = await mk('zsa' + stamp, SUPER_EMAIL);
  await seed(`admins/${SP1.uid}`, { role: 'spotter' }); await seed(`admins/${SP2.uid}`, { role: 'spotter' }); await seed(`admins/${AD.uid}`, { role: 'admin' });
  const FV = SP1.FV;
  const same = (a, b) => a.routeId === b.routeId && a.imageId === b.imageId;
  const docId = `z${stamp}_sector`;
  const ref = (u, id = docId) => u.db.collection('sector_route_drawings').doc(id);
  const archList = async (u, id = docId) => (await ref(u, id).collection('archived').get()).docs;
  const mkBase = () => JSON.parse(JSON.stringify({ schoolId: `z${stamp}`, sectorName: 'Sector', drawings: [mkDrawing('A', 'i1'), mkDrawing('B', 'i1'), mkDrawing('C', 'i2'), mkDrawing('D', 'i2'), mkDrawing('E')], rapelPoints: [{ x: 1, y: 1 }] }));

  await seed(`sector_route_drawings/${docId}`, mkBase());
  const n = await SUB.kxArchiveToSubTx(SP1.db, FV, docId, d => d.imageId === 'i1', { by: SP1.uid, reason: 'foto-retirada' });
  let main = await ownerData(`sector_route_drawings/${docId}`), al = await archList(SP1);
  check('subcolección · archivar: los trazados de la foto salen de drawings y aparecen en archived', n === 2 && main.drawings.length === 3 && al.length === 2);
  check('subcolección · el total se conserva (5 de 5) y la geometría es idéntica', main.drawings.length + al.length === 5 && al.every(a => a.data().drawing.points.length === 2 && a.data().archivedBy === SP1.uid && a.data().reason === 'foto-retirada'));
  check('subcolección · rapelPoints y el resto del documento intactos', main.rapelPoints.length === 1 && main.sectorName === 'Sector');
  await expect('subcolección · un usuario sin rol no puede archivar', SUB.kxArchiveToSubTx(U.db, FV, docId, d => d.routeName === 'C', { by: U.uid }), false);
  await expect('subcolección · un usuario sin rol no puede leer el archivo', U.db.collection('sector_route_drawings').doc(docId).collection('archived').get(), false);
  await expect('subcolección · lectura pública del documento principal sigue permitida', U.db.collection('sector_route_drawings').doc(docId).get(), true);
  await expect('subcolección · spotter edita un archivado', SP1.db.doc(al[0].ref.path).update({ reason: 'x' }), false);
  await expect('subcolección · spotter borra un archivado SIN restaurarlo (vaciar el archivo)', SP1.db.doc(al[0].ref.path).delete(), false);
  await expect('subcolección · admin borra un archivado SIN restaurarlo', AD.db.doc(al[0].ref.path).delete(), false);
  await expect('subcolección · crear un archivado con archivedBy ajeno', ref(SP1).collection('archived').doc('falso').set({ drawing: { a: 1 }, archivedAt: FV.serverTimestamp(), archivedBy: SP2.uid, reason: 'x' }), false);
  const r1 = await SUB.kxRestoreFromSubTx(SP1.db, FV, docId, al.map(a => a.id).slice(0, 1), same);
  main = await ownerData(`sector_route_drawings/${docId}`); al = await archList(SP1);
  check('subcolección · restaurar devuelve el trazado y lo quita del archivo (total 5)', r1.restored === 1 && main.drawings.length === 4 && al.length === 1);
  await seed(`sector_route_drawings/${docId}`, Object.assign({}, main, { drawings: main.drawings.concat([al[0].data().drawing]) }));   // un cliente con datos viejos lo reintroduce
  const r2 = await SUB.kxRestoreFromSubTx(AD.db, FV, docId, [al[0].id], same);
  main = await ownerData(`sector_route_drawings/${docId}`);
  check('subcolección · restaurar un trazado ya presente no lo duplica', r2.restored === 0 && r2.duplicatesSkipped === 1 && main.drawings.length === 5);
  await expect('subcolección · el super-admin sí puede borrar un archivado suelto', (async () => { await SUB.kxArchiveToSubTx(SP1.db, FV, docId, d => d.routeName === 'E', { by: SP1.uid, reason: 'x' }); const [a] = await archList(SA); await SA.db.doc(a.ref.path).delete(); })(), true);

  // Concurrencia: dos spotters archivan trazados distintos a la vez
  const docC = `zc${stamp}`; await seed(`sector_route_drawings/${docC}`, Object.assign(mkBase(), { schoolId: 'zc' }));
  const rs = await Promise.all([SUB.kxArchiveToSubTx(SP1.db, FV, docC, d => d.routeName === 'A', { by: SP1.uid, reason: 'c1' }), SUB.kxArchiveToSubTx(SP2.db, FV, docC, d => d.routeName === 'C', { by: SP2.uid, reason: 'c2' })]);
  main = await ownerData(`sector_route_drawings/${docC}`); al = await archList(SP1, docC);
  check('concurrencia · dos archivados simultáneos: se conservan los dos y no se pierde nada', rs[0] + rs[1] === 2 && main.drawings.length === 3 && al.length === 2 && main.drawings.length + al.length === 5);

  // Compatibilidad con clientes actuales
  const docK = `zk${stamp}`; await seed(`sector_route_drawings/${docK}`, Object.assign(mkBase(), { schoolId: 'zk' }));
  await SUB.kxArchiveToSubTx(SP1.db, FV, docK, d => d.routeName === 'A', { by: SP1.uid, reason: 'k' });
  await expect('compat · cliente actual guarda con set({drawings,…},{merge:true}) (route-drawing.js)', ref(SP2, docK).set({ drawings: (await ownerData(`sector_route_drawings/${docK}`)).drawings, updatedAt: FV.serverTimestamp() }, { merge: true }), true);
  check('compat · el archivo sigue intacto tras la escritura del cliente actual', (await archList(SP1, docK)).length === 1);
  const bk = await ownerData(`sector_route_drawings/${docK}`);
  await expect('compat · kxRestoreRouteDrawings (set SIN merge, sustituye el documento) con la copia anterior', ref(SP1, docK).set(Object.assign({}, mkBase(), { schoolId: 'zk', restoredFrom: 'b' })), true);
  check('compat · la subcolección NO se ve afectada por un restore que sustituye el documento', (await archList(SP1, docK)).length === 1 && bk.drawings.length === 4);
  const sizeOf = (o) => Buffer.byteLength(JSON.stringify(o));

  // Contraste: archivedDrawings[] en el mismo documento (opción A) con ese mismo restore
  const docA = `za${stamp}`; await seed(`sector_route_drawings/${docA}`, Object.assign(mkBase(), { schoolId: 'za', archivedDrawings: [mkDrawing('X', 'i9')] }));
  await ref(SP1, docA).set(Object.assign(mkBase(), { schoolId: 'za', restoredFrom: 'b' }));
  knownDefect('OPCIÓN A (archivedDrawings[] en el mismo documento) · un restore que sustituye el documento borra los archivados', (await ownerData(`sector_route_drawings/${docA}`)).archivedDrawings === undefined, 'por eso se recomienda la subcolección');

  // Tamaños con datos reales
  if (prod) {
    const docs = Object.entries(prod.data).map(([id, d]) => ({ id, bytes: sizeOf(d), n: (d.drawings || []).length }));
    const big = docs.sort((a, b) => b.bytes - a.bytes)[0];
    const perDraw = sizeOf(prod.data[big.id].drawings) / big.n;
    const worstA = big.bytes + sizeOf(prod.data[big.id].drawings) + big.n * 140;   // todo archivado en el mismo documento + marcas
    check(`tamaño · el mayor documento real (${big.id}, ${big.n} trazados) ocupa ${(big.bytes / 1024).toFixed(1)} KB (${(big.bytes / 1048576 * 100).toFixed(1)} % de 1 MiB)`, big.bytes < 1048576 * 0.1);
    check(`tamaño · opción A en el peor caso (archivar TODO en el mismo documento): ${(worstA / 1024).toFixed(0)} KB (${(worstA / 1048576 * 100).toFixed(1)} %); una copia de seguridad lo duplicaría`, worstA < 1048576 * 0.25, `≈ ${Math.round(perDraw)} B por trazado; el límite real se alcanzaría con ~${Math.floor(1048576 * 0.5 / (perDraw + 140))} trazados (archivados incluidos) para dejar margen del 50 %`);
  }

  L.finish('drawings-0c.cjs');
  process.exit(process.exitCode || 0);
})().catch(e => { console.error('ERROR FATAL', String(e.stack || e.message).slice(0, 600), '\nÚltima prueba registrada:', L.results.length ? L.results[L.results.length - 1].label : '(ninguna)'); process.exit(2); });

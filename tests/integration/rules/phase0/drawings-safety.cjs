// Fase 0b — trazados: ninguna operación de borrado debe provocar pérdidas involuntarias. Tres bloques:
//  1) vm: se carga el código ANTERIOR (git HEAD) de admin.js y admin-routes.js (cleanOrphanedDrawings, deleteRouteDrawingFromSector) con un
//     Firestore en memoria, para documentar qué borraba. El código actual se prueba en drawings-0c.cjs;
//  2) propuesta «archivar en vez de borrar» (docs/security-phase0/drawings-safety.proposal.cjs) en el emulador, con transacciones;
//  3) regla opcional de «el total de trazados no puede disminuir» (firestore.rules.drawings-guard.proposal.snippet) en el emulador.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const L = require('./_lib.cjs');
const P = require('../../../../docs/security-phase0/drawings-safety.proposal.cjs');
const { mk, seed, ownerData, expect, check, knownDefect, SUPER_EMAIL } = L;

function extract(src, name) {
  const m = src.match(new RegExp(`(?:^|\\n)((?:async )?function ${name}\\()`)); if (!m) throw new Error('no se encontró ' + name);
  const start = src.indexOf(m[1], m.index); let i = src.indexOf('{', src.indexOf(')', start)), depth = 0;
  for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1); }
}
const geo = (f) => JSON.parse(fs.readFileSync(path.join(L.ROOT, f), 'utf8'));
const VAL = geo('Cartografia/Valeria/Valeria_Vias.geojson').features[0].properties;     // una vía real de Valeria (sector y nombre)
const mkDrawing = (routeName, imageId, extra) => Object.assign({ routeId: Math.floor(Math.random() * 1e6), routeName, imageId, points: [{ x: 1, y: 1 }, { x: 2, y: 2 }] }, extra || {});
const scenario = () => ({
  'valeria_s1': { schoolId: 'valeria', sectorName: VAL.sector, drawings: [mkDrawing(VAL.nombre, 'img1'), mkDrawing('Via que ya no existe', 'img1')] },
  'patones_s1': { schoolId: 'patones', sectorName: 'Sector P', drawings: [mkDrawing('P1', 'imgP'), mkDrawing('P2', 'imgP'), mkDrawing('P3', 'imgP')] },
  'toledo_s1': { schoolId: 'toledo', sectorName: 'Sector T', drawings: [mkDrawing('T1', 'imgT'), mkDrawing('T2', 'imgT')] },
  'cuenca_s1': { schoolId: 'cuenca', sectorName: 'Sector C', drawings: [mkDrawing('C1', 'imgC')] }
});
function runAdmin(file, extraCode, data, { geoFails = false } = {}) {
  const store = new Map(Object.entries(data).map(([k, v]) => [k, JSON.parse(JSON.stringify(v))]));
  const log = { backups: [], toasts: [] };
  const ctx = {
    console: { log() {}, warn() {}, error() {} }, confirm: () => true, showToast: (m) => log.toasts.push(m),
    firebase: { firestore: { FieldValue: { serverTimestamp: () => 'TS' } } },
    kxBackupRouteDrawings: async (ref, reason) => { log.backups.push(reason); },
    fetch: async (u) => { if (geoFails) throw new Error('sin red'); const p = path.join(L.ROOT, decodeURI(u.split('?')[0])); if (!fs.existsSync(p)) return { ok: false }; return { ok: true, json: async () => JSON.parse(fs.readFileSync(p, 'utf8')) }; },
    db: { collection: (c) => c === 'pending_routes' ? { where: () => ({ get: async () => ({ forEach() {} }) }) }
      : { get: async () => ({ docs: [...store.entries()].map(([id, d]) => ({ id, ref: { id }, data: () => JSON.parse(JSON.stringify(d)) })) }),
          doc: (id) => ({ get: async () => ({ exists: store.has(id), data: () => JSON.parse(JSON.stringify(store.get(id))) }), update: async (o) => { store.set(id, Object.assign(store.get(id), o)); } }) } }
  };
  vm.createContext(ctx);
  // Código ANTERIOR a la Implementación 1 (git), porque el actual ya no contiene estas funciones destructivas
  const src = execFileSync('git', ['show', `${process.env.KRUX_BEFORE_REF || 'HEAD'}:${file}`], { cwd: L.ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const names = ['loadGeoJSONRoutesForSector', 'cleanOrphanedDrawings', 'deleteRouteDrawingFromSector', 'normalizeSectorNameForDrawing'];
  if (!names.every(n => new RegExp(`function ${n}\\(`).test(src))) return null;   // la referencia ya contiene el código nuevo: no hay «antes» que comparar
  const code = names.map(n => extract(src, n)).join('\n');
  return { ctx, store, log, run: (expr) => vm.runInContext(code + '\n' + expr, ctx) };
}
const total = (store) => [...store.values()].reduce((n, d) => n + (d.drawings || []).length, 0);

(async () => {
  // ================= 1. Código anterior (git HEAD) =================
  const REF = process.env.KRUX_BEFORE_REF || 'HEAD';
  const hasOld = runAdmin('admin.js', '', scenario()) !== null;
  check(`referencia del código anterior (${REF}) ${hasOld ? 'disponible' : 'ya sin las funciones destructivas: se omite la comparación (usa KRUX_BEFORE_REF=4091713)'}`, true);
  for (const file of hasOld ? ['admin.js', 'admin-routes.js'] : []) {
    const env = runAdmin(file, '', scenario());
    const before = total(env.store);
    await env.run('cleanOrphanedDrawings()');
    const lost = (id) => 0;
    knownDefect(`${file} · «limpiar huérfanos» elimina los trazados de escuelas sin GeoJSON cableado (patones, toledo, cuenca)`,
      (env.store.get('patones_s1').drawings.length + env.store.get('toledo_s1').drawings.length + env.store.get('cuenca_s1').drawings.length) === 0,
      `trazados antes ${before}, después ${total(env.store)}; copias previas: ${JSON.stringify(env.log.backups)}`);
    check(`${file} · «limpiar huérfanos» respeta la vía real de Valeria`, env.store.get('valeria_s1').drawings.some(d => d.routeName === VAL.nombre));
    const env2 = runAdmin(file, '', scenario(), { geoFails: true });
    await env2.run('cleanOrphanedDrawings()');
    knownDefect(`${file} · un fallo de red al cargar el GeoJSON hace que TODOS los trazados de Valeria se consideren huérfanos`,
      env2.store.get('valeria_s1').drawings.length === 0, `trazados de Valeria tras el fallo: ${env2.store.get('valeria_s1').drawings.length}`);
  }
  // admin-borrar-via: filtra por routeName
  if (hasOld) {
    const data = { 'valeria_s1': { schoolId: 'valeria', sectorName: 'S1', drawings: [mkDrawing('Dup', 'imgA'), mkDrawing('Dup', 'imgB', { variantIndex: 1 }), mkDrawing('Otra', 'imgA')] } };
    const env = runAdmin('admin.js', '', data);
    await env.run(`deleteRouteDrawingFromSector('valeria', 'S1', 'Dup')`);
    knownDefect('admin.js · «borrar vía» elimina todos los trazados con ese nombre, de todas las fotos y variantes', env.store.get('valeria_s1').drawings.length === 1,
      `quedan ${env.store.get('valeria_s1').drawings.length} de 3; copia previa: ${JSON.stringify(env.log.backups)}`);
  }
  // Clasificación de la propuesta (solo lectura) con las mismas condiciones
  {
    const docs = Object.entries(scenario()).map(([id, d]) => ({ id, data: () => d }));
    const sourcesOk = { valeria: new Set(geo('Cartografia/Valeria/Valeria_Vias.geojson').features.filter(f => f.properties.sector === VAL.sector).map(f => f.properties.nombre)), sanmartin: new Set(), mora: new Set() };
    const c = P.kxClassifyDrawings(docs, new Set(), sourcesOk);
    check('PROPUESTA · clasificación: patones, toledo y cuenca quedan «indeterminado» (no huérfano)', c.indeterminado.length === 6 && c.huerfano.every(h => h.docId === 'valeria_s1'), JSON.stringify({ seguro: c.seguro.length, huerfano: c.huerfano.length, indeterminado: c.indeterminado.length }));
    check('PROPUESTA · clasificación: la vía real de Valeria es «seguro» y la inexistente «huérfano»', c.seguro.length === 1 && c.huerfano.length === 1 && c.huerfano[0].routeName === 'Via que ya no existe');
    const cFail = P.kxClassifyDrawings(docs, new Set(), { valeria: null });
    check('PROPUESTA · con una fuente que no se pudo cargar (null) nada se considera huérfano', cFail.huerfano.length === 0 && cFail.indeterminado.length === 8);
  }

  // ================= 2. Archivar en vez de borrar (emulador, transacciones) =================
  await L.loadFirestoreRules('proposal');
  const stamp = Date.now();
  const SP1 = await mk('dsp1' + stamp, `dsp1${stamp}@test.dev`), SP2 = await mk('dsp2' + stamp, `dsp2${stamp}@test.dev`), U = await mk('du' + stamp, `du${stamp}@test.dev`);
  const AD = await mk('dad' + stamp, `dad${stamp}@test.dev`), SA = await mk('dsa' + stamp, SUPER_EMAIL);
  await seed(`admins/${SP1.uid}`, { role: 'spotter' }); await seed(`admins/${SP2.uid}`, { role: 'spotter' }); await seed(`admins/${AD.uid}`, { role: 'admin' }); await seed(`admins/${SA.uid}`, { role: 'admin' });
  const FV = SP1.FV;
  const docId = `s${stamp}_sector`;
  const base = () => ({ schoolId: `s${stamp}`, sectorName: 'Sector', drawings: [mkDrawing('A', 'i1'), mkDrawing('B', 'i1'), mkDrawing('C', 'i2'), mkDrawing('D', 'i2'), mkDrawing('E')], rapelPoints: [{ id: 'r', imageId: 'i1', x: 1, y: 1 }] });
  await seed(`sector_route_drawings/${docId}`, base());
  const n0 = await P.kxArchiveDrawingsTx(SP1.db, FV, docId, d => d.imageId === 'i1', { by: SP1.uid, reason: 'foto-retirada' });
  let d = await ownerData(`sector_route_drawings/${docId}`);
  check('archivar: los trazados de la foto retirada pasan a archivedDrawings', n0 === 2 && d.drawings.length === 3 && d.archivedDrawings.length === 2);
  check('archivar: el total se conserva (5 de 5) y no se pierde ninguna geometría', d.drawings.length + d.archivedDrawings.length === 5 && d.archivedDrawings.every(x => x.points.length === 2));
  check('archivar: queda registrado quién, cuándo y por qué', d.archivedDrawings.every(x => x.archivedBy === SP1.uid && x.archivedReason === 'foto-retirada' && x.archivedAt));
  check('archivar: rapelPoints intactos', d.rapelPoints.length === 1);
  const nR = await P.kxRestoreArchivedDrawingsTx(SP1.db, FV, docId, x => x.routeName === 'A');
  d = await ownerData(`sector_route_drawings/${docId}`);
  check('restaurar: el trazado vuelve a drawings sin las marcas de archivo', nR === 1 && d.drawings.some(x => x.routeName === 'A' && !x.archivedAt) && d.archivedDrawings.length === 1);
  const nM = await P.kxReassignDrawingsTx(SP1.db, FV, docId, 'i2', 'i9');
  d = await ownerData(`sector_route_drawings/${docId}`);
  check('reasignar: los trazados de una foto retirada pasan a otra foto sin perder ninguno', nM === 2 && d.drawings.filter(x => x.imageId === 'i9').length === 2 && d.drawings.length + d.archivedDrawings.length === 5);
  // Concurrencia: dos spotters archivan trazados distintos a la vez
  const docC = `s${stamp}_conc`; await seed(`sector_route_drawings/${docC}`, base());
  await Promise.all([P.kxArchiveDrawingsTx(SP1.db, FV, docC, x => x.routeName === 'A', { by: SP1.uid, reason: 'a' }), P.kxArchiveDrawingsTx(SP2.db, FV, docC, x => x.routeName === 'C', { by: SP2.uid, reason: 'c' })]);
  d = await ownerData(`sector_route_drawings/${docC}`);
  check('concurrencia: dos archivados simultáneos de trazados distintos se conservan los dos', d.archivedDrawings.length === 2 && d.drawings.length === 3);
  await expect('permisos: un usuario sin rol no puede archivar', P.kxArchiveDrawingsTx(U.db, FV, docC, x => x.routeName === 'B', { by: U.uid }), false);
  check('permisos: tras el intento denegado no cambió nada', (await ownerData(`sector_route_drawings/${docC}`)).drawings.length === 3);

  // ================= 3. Regla opcional: el total de trazados no puede disminuir =================
  const guard = fs.readFileSync(path.join(L.ROOT, 'docs/security-phase0/firestore.rules.drawings-guard.proposal.snippet'), 'utf8').split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
  let rules = fs.readFileSync(path.join(L.ROOT, 'docs/security-phase0/firestore.rules.phase0b.proposal'), 'utf8');
  const i = rules.indexOf('    match /sector_route_drawings/{drawingId} {'), j = rules.indexOf('    // Pending routes (vías pendientes');
  check('regla opcional: se localiza el bloque sector_route_drawings en las reglas', i > 0 && j > i);
  rules = rules.slice(0, i) + guard + '\n\n' + rules.slice(j);
  await fetch(`http://${L.FS_HOST}:${L.FS_PORT}/emulator/v1/projects/${L.PROJECT}:securityRules`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rules: { files: [{ name: 'firestore.rules', content: rules }] } }) });
  const g = `s${stamp}_guard`; await seed(`sector_route_drawings/${g}`, base());
  const ref = (u) => u.db.collection('sector_route_drawings').doc(g);
  const cur = async () => (await ownerData(`sector_route_drawings/${g}`));
  let c = await cur();
  await expect('guardia: el spotter quita un trazado sin archivarlo (lo que hace el cliente actual)', ref(SP1).update({ drawings: c.drawings.slice(1) }), false, 'rompe a los clientes actuales que borran: solo se despliega después del cliente nuevo');
  await expect('guardia: el spotter borra TODOS los trazados con set merge (borrador)', ref(SP1).set({ drawings: [] }, { merge: true }), false);
  await expect('guardia: el admin quita un trazado sin archivarlo', ref(AD).update({ drawings: c.drawings.slice(1) }), false);
  await expect('guardia: el spotter archiva (el total se conserva)', ref(SP1).update({ drawings: c.drawings.slice(1), archivedDrawings: [Object.assign({}, c.drawings[0], { archivedAt: 'x' })] }), true);
  c = await cur();
  await expect('guardia: el spotter añade un trazado', ref(SP1).update({ drawings: c.drawings.concat([mkDrawing('Nuevo', 'i1')]) }), true);
  c = await cur();
  await expect('guardia: el spotter edita un trazado (mismo total)', ref(SP1).update({ drawings: c.drawings.map((x, k) => (k === 0 ? Object.assign({}, x, { anchorType: 'cadena' }) : x)) }), true);
  await expect('guardia: el spotter restaura un archivado (el total se conserva)', ref(SP1).update({ drawings: c.drawings.concat([c.archivedDrawings[0]]), archivedDrawings: [] }), true);
  c = await cur();
  await expect('guardia: el spotter quita un punto de rápel (no cubierto por la guardia)', ref(SP1).update({ rapelPoints: [] }), true);
  await expect('guardia: usuario sin rol no escribe', ref(U).update({ drawings: c.drawings }), false);
  await expect('guardia: nadie, salvo el super-admin, borra el documento entero', ref(AD).delete(), false);
  check('guardia: tras todos los intentos el total de trazados no ha disminuido', ((x) => x.drawings.length + (x.archivedDrawings || []).length)(await cur()) >= 6);

  L.finish('drawings-safety.cjs');
  process.exit(process.exitCode || 0);
})().catch(e => { console.error('ERROR FATAL', e); process.exit(2); });

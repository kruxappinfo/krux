// Implementación 1 — borrar una foto de sector NO debe borrar trazados. Sin emulador: carga el código REAL de sector-images.js
// (deleteGalleryImage, deleteSectorImage, normalizeSectorName, svApplyDrawingsForImage) en un contexto aislado con un Firestore
// en memoria. Compara con el código ANTERIOR (git, KRUX_BEFORE_REF, por defecto HEAD) mientras exista en el historial sin confirmar.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const L = require('./_lib.cjs');
const { check, knownDefect } = L;

const SRC = fs.readFileSync(path.join(L.ROOT, 'sector-images.js'), 'utf8');
const BEFORE_REF = process.env.KRUX_BEFORE_REF || 'HEAD';
let BEFORE = null;
try { BEFORE = execFileSync('git', ['show', `${BEFORE_REF}:sector-images.js`], { cwd: L.ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch (_) {}

// Extrae una función de primer nivel por equilibrio de llaves
function extract(src, name) {
  const m = src.match(new RegExp(`(?:^|\\n)((?:async )?function ${name}\\()`));
  if (!m) return null;
  const start = src.indexOf(m[1], m.index);
  let i = src.indexOf('{', src.indexOf(')', start)), depth = 0;
  for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1); }
  throw new Error('llaves sin equilibrar en ' + name);
}
const code = (src, names) => names.map(n => extract(src, n)).filter(Boolean).join('\n');

// ---- Entorno falso ----
function makeEnv(initial) {
  const store = new Map(Object.entries(initial).map(([k, v]) => [k, JSON.parse(JSON.stringify(v))]));
  const log = { storageDeleted: [], backups: [], toasts: [], writes: [] };
  const docRef = (col, id) => ({
    id, _key: `${col}/${id}`,
    get: async () => ({ exists: store.has(`${col}/${id}`), id, data: () => JSON.parse(JSON.stringify(store.get(`${col}/${id}`))), ref: docRef(col, id) }),
    update: async (o) => { log.writes.push(`update ${col}/${id}`); store.set(`${col}/${id}`, Object.assign({}, store.get(`${col}/${id}`), o)); },
    set: async (o) => { log.writes.push(`set ${col}/${id}`); store.set(`${col}/${id}`, o); },
    delete: async () => { log.writes.push(`delete ${col}/${id}`); store.delete(`${col}/${id}`); }
  });
  const ctx = {
    console: { log() {}, warn() {}, error() {} },
    db: { collection: (c) => ({ doc: (id) => docRef(c, id) }) },
    firebase: { firestore: { FieldValue: { serverTimestamp: () => 'TS' } }, storage: () => ({ ref: (p) => ({ delete: async () => { log.storageDeleted.push(p); } }) }) },
    confirm: () => true, decodeURIComponent,
    showSectorToast: (m, t) => log.toasts.push(`${t}: ${m}`),
    kxBackupRouteDrawings: async (ref, reason) => { log.backups.push(reason); },
    document: { querySelector: () => null, getElementById: () => null }, updateGalleryOrderNumbers() {}, closeGalleryManageModal() {}, closeSectorImageViewer() {}, closeDeleteSectorImageModal() {},
    svDrawings: [], svAllDrawings: [], svRapelPoints: [], svAuxElements: []
  };
  vm.createContext(ctx);
  return { ctx, store, log };
}
const run = (env, src, expr) => vm.runInContext(src + '\n' + expr, env.ctx);

const mkScenario = () => ({
  'sector_images/sch_sector_a': { schoolId: 'sch', images: [
    { id: 'imgA', url: 'u/A', storagePath: 'sector-images/sch/sector_a/imgA.jpg', order: 0 },
    { id: 'imgB', url: 'u/B', storagePath: 'sector-images/sch/sector_a/imgB.jpg', order: 1 }] },
  'sector_route_drawings/sch_sector_a': {
    schoolId: 'sch', sectorName: 'Sector A',
    drawings: [
      { routeId: 1, routeName: 'V1', imageId: 'imgA', points: [{ x: 1, y: 1 }, { x: 2, y: 2 }] },
      { routeId: 2, routeName: 'V2', imageId: 'imgA', points: [{ x: 3, y: 3 }, { x: 4, y: 4 }] },
      { routeId: 3, routeName: 'V3', imageId: 'imgB', points: [{ x: 5, y: 5 }, { x: 6, y: 6 }] },
      { routeId: 4, routeName: 'V4', points: [{ x: 7, y: 7 }, { x: 8, y: 8 }] }],
    rapelPoints: [{ id: 'r1', imageId: 'imgA', x: 1, y: 1 }], auxElements: [{ id: 'e1', imageId: 'imgA', points: [{ x: 1, y: 1 }] }] }
});
const NOW = ['normalizeSectorName', 'deleteGalleryImage', 'deleteSectorImage', 'svApplyDrawingsForImage'];

(async () => {
  // ===== 0. Comprobaciones estáticas del código real =====
  check('sector-images.js ya no contiene deleteRouteDrawingsForImage (ni la función ni la llamada)', !/deleteRouteDrawingsForImage/.test(SRC));
  check('sector-images.js no crea copias de seguridad de trazados (señal de una escritura destructiva)', !/kxBackupRouteDrawings\(/.test(SRC));
  const refs = SRC.split('\n').filter(l => l.includes('sector_route_drawings'));
  check('toda referencia a sector_route_drawings en sector-images.js es una lectura o un comentario', refs.every(l => /^\s*\/\//.test(l) || /kxGetDoc\(|\.get\(\)/.test(l)), JSON.stringify(refs.map(l => l.trim())));

  // ===== 1. Código ANTERIOR (referencia) =====
  if (BEFORE && extract(BEFORE, 'deleteRouteDrawingsForImage')) {
    const env1 = makeEnv(mkScenario());
    await run(env1, code(BEFORE, ['normalizeSectorName', 'deleteGalleryImage', 'deleteRouteDrawingsForImage']), `deleteGalleryImage('sch', 'Sector%20A', 'imgA')`);
    const after1 = env1.store.get('sector_route_drawings/sch_sector_a');
    knownDefect(`código ANTERIOR (${BEFORE_REF}): borrar la foto imgA eliminaba los trazados de esa foto`, after1.drawings.length < 4,
      `trazados antes: 4, después: ${after1.drawings.length}; copia previa: ${JSON.stringify(env1.log.backups)}`);
  } else {
    check(`código anterior no disponible en ${BEFORE_REF} (ya confirmado): se omite la comparación`, true);
  }

  // ===== 2. Código ACTUAL: borrar una foto de la galería =====
  const env2 = makeEnv(mkScenario());
  const before = JSON.stringify(env2.store.get('sector_route_drawings/sch_sector_a'));
  await run(env2, code(SRC, NOW), `deleteGalleryImage('sch', 'Sector%20A', 'imgA')`);
  const after2 = env2.store.get('sector_route_drawings/sch_sector_a');
  check('borrar una foto no elimina ningún trazado (4 de 4) y el documento queda idéntico', JSON.stringify(after2) === before, `trazados tras borrar: ${after2.drawings.length}`);
  check('los trazados de la foto borrada conservan su imageId y su geometría', (d => d.length === 2 && d.every(x => x.points.length === 2))(after2.drawings.filter(d => d.imageId === 'imgA')));
  check('rápeles y auxiliares de esa foto intactos', after2.rapelPoints.length === 1 && after2.auxElements.length === 1);
  check('no se escribe nada en sector_route_drawings (ni copias de seguridad)', !env2.log.writes.some(w => w.includes('sector_route_drawings')) && env2.log.backups.length === 0, JSON.stringify(env2.log.writes));
  check('la galería funciona como antes: queda la otra foto, reordenada, y se borra el archivo de la retirada',
    env2.store.get('sector_images/sch_sector_a').images.map(i => i.id + ':' + i.order).join() === 'imgB:0' && env2.log.storageDeleted.join() === 'sector-images/sch/sector_a/imgA.jpg');
  check('se muestra el aviso «Imagen eliminada»', env2.log.toasts.some(t => /Imagen eliminada/.test(t)));

  // ===== 3. El visor ignora los trazados de una foto inexistente sin fallar =====
  const viewer = (imageId) => { run(env2, '', `svApplyDrawingsForImage(${JSON.stringify(after2)}, ${JSON.stringify(imageId)})`); return env2.ctx.svDrawings.map(d => d.routeName); };
  check('en la foto restante (imgB) solo se pintan sus trazados', viewer('imgB').join() === 'V3', JSON.stringify(viewer('imgB')));
  check('los trazados de la foto borrada siguen disponibles en svAllDrawings (siguen en el documento)', env2.ctx.svAllDrawings.length === 4);
  check('los trazados sin imageId siguen asociados a la imagen legacy', viewer('legacy_0').join() === 'V4');

  // ===== 4. Borrar la última foto: la galería desaparece, los trazados no =====
  const sc = mkScenario(); sc['sector_images/sch_sector_a'].images = [sc['sector_images/sch_sector_a'].images[0]];
  const env3 = makeEnv(sc);
  await run(env3, code(SRC, NOW), `deleteGalleryImage('sch', 'Sector%20A', 'imgA')`);
  check('al borrar la última foto se elimina la galería pero NO el documento de trazados', !env3.store.has('sector_images/sch_sector_a') && JSON.stringify(env3.store.get('sector_route_drawings/sch_sector_a')) === before);

  // ===== 5. Imagen antigua (deleteSectorImage) =====
  const env4 = makeEnv(mkScenario());
  await run(env4, code(SRC, NOW), `deleteSectorImage('sch', 'Sector%20A')`);
  check('borrar la imagen antigua del sector no toca sector_route_drawings', JSON.stringify(env4.store.get('sector_route_drawings/sch_sector_a')) === before && !env4.log.writes.some(w => w.includes('sector_route_drawings')));

  // ===== 6. Foto inexistente y fallos =====
  const env5 = makeEnv(mkScenario());
  await run(env5, code(SRC, NOW), `deleteGalleryImage('sch', 'Sector%20A', 'noExiste')`);
  check('borrar una foto que no existe no cambia nada', JSON.stringify(env5.store.get('sector_route_drawings/sch_sector_a')) === before && env5.log.writes.length === 0);
  const env6 = makeEnv(mkScenario());
  env6.ctx.firebase.storage = () => ({ ref: () => ({ delete: async () => { throw Object.assign(new Error('sin red'), { code: 'storage/retry-limit-exceeded' }); } }) });
  await run(env6, code(SRC, NOW), `deleteGalleryImage('sch', 'Sector%20A', 'imgA')`);
  check('si Storage falla al borrar el archivo, los trazados siguen intactos', JSON.stringify(env6.store.get('sector_route_drawings/sch_sector_a')) === before);

  L.finish('sector-images-drawings.cjs');
  process.exit(process.exitCode || 0);
})().catch(e => { console.error('ERROR FATAL', e); process.exit(2); });

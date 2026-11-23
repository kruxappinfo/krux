// Capas 2 y 3 de los documentos huérfanos: scripts/route-photos-orphans.py (informe de solo lectura, plan, archivado reversible por lotes con aprobación y restauración)
// ejecutado contra los emuladores. NO toca producción. Se comprueba, con datos sintéticos:
//   · clasificación (seguro / huérfano probable / confirmado / indeterminado) y que los indeterminados y los recientes NUNCA se pueden archivar;
//   · que el informe solo hace peticiones GET y no cambia nada;
//   · que ningún lote se ejecuta sin informe confirmado, hash de aprobación, frase de confirmación y re-verificación;
//   · que archivar es atómico y reversible (copia íntegra, marca, restauración);
//   · que NO se borra ni modifica ningún trazado de vía, imagen de sector u otro dato, ni ningún archivo de Storage, ni directa ni indirectamente.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const ROOT = path.resolve(__dirname, '../../../..');
process.env.RULES_FILE = process.env.RULES_FILE || path.join(ROOT, 'docs/security-phase0/firestore.rules.route-photos-only.proposal');
process.env.MODE = 'proposal';
const L = require('./_lib.cjs');
const S = require('./_storage.cjs');
const { mkPhotoV2, BASE, delPhotoBatch } = require('./_photos.cjs');
const { mk, seed, expect, check } = L;
const TOOL = path.join(ROOT, 'scripts/route-photos-orphans.py');
const H = 3600 * 1000, MIN = 60 * 1000;
const canon = (o) => JSON.stringify(o, (k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.keys(v).sort().reduce((a, kk) => { a[kk] = v[kk]; return a; }, {}) : v));   // claves ordenadas
const sha = (x) => crypto.createHash('sha256').update(canon(x)).digest('hex');

(async () => {
  const py = spawnSync('python3', ['--version'], { encoding: 'utf8' });
  if (py.status !== 0) { check('python3 disponible (necesario para la herramienta)', false, 'instala python3'); L.finish('route-photos-orphans-tool.cjs'); return; }
  const stamp = Date.now(), SCH = `ot${stamp}`, OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'kx-orphans-'));
  const tool = (args, extra = []) => { const r = spawnSync('python3', [TOOL, '--emulator', '--out', OUT, ...extra, ...args], { encoding: 'utf8', input: '' }); return { code: r.status, out: r.stdout || '', err: r.stderr || '' }; };
  const A = await mk('ot' + stamp, `ot${stamp}@test.dev`);
  await L.loadFirestoreRules('proposal'); await S.loadStorageRules(path.join(ROOT, 'storage.rules'));

  // ---------- fixtures sintéticos ----------
  const urlOf = (p, tok) => `${BASE}${encodeURIComponent(p)}?alt=media${tok ? '&token=t' : ''}`;
  const newDoc = async (n, ageMs, { file, over = {} } = {}) => {
    const x = mkPhotoV2(A, A.FV, {}, SCH, n);
    await seed(`route-photos/${x.id}`, { ...x.data, uploadedAt: new Date(Date.now() - ageMs), ...over });
    if (file) await S.upload('owner', x.storagePath);
    return x;
  };
  const oldDoc = async (n, ageMs, { file } = {}) => {   // formato antiguo: sin storagePath, id con el nombre de la vía
    const fn = `${1700000000000 + n}_Demo${n}.jpeg`, id = `${SCH}_Demo${n}_${1700000000000 + n}`, p = `route-photos/${SCH}/${fn}`;
    await seed(`route-photos/${id}`, { photoUrl: urlOf(p, true), uploadedBy: A.uid, uploadedByName: 'X', uploadedAt: new Date(Date.now() - ageMs), routeName: `Demo${n}`, schoolId: SCH, filename: fn });
    if (file) await S.upload('owner', p);
    return { id, path: p };
  };
  const seguroNuevo = await newDoc(1, 5 * H, { file: true }), seguroAntiguo = await oldDoc(2, 90 * 24 * H, { file: true });
  const huerfanoNuevo = await newDoc(3, 30 * MIN), huerfanoAntiguo = await oldDoc(4, 3 * 24 * H);
  const recienteNuevo = await newDoc(5, 2 * MIN), recienteAntiguo = await oldDoc(6, 2 * H);
  await seed(`route-photos/${SCH}_sinrutas`, { uploadedBy: A.uid, uploadedAt: new Date(Date.now() - 5 * H), routeName: 'x' });   // faltan datos
  const urlMal = await newDoc(8, 5 * H, { over: { photoUrl: urlOf(`route-photos/${SCH}/${A.uid}/otro.jpg`) } });                       // photoUrl discordante
  const futuro = await newDoc(9, -3 * H);                                                                                                // uploadedAt en el futuro
  const sinDoc = `route-photos/${SCH}/archivo_sin_documento.jpg`; await S.upload('owner', sinDoc);
  // señuelos que la herramienta NO debe tocar jamás: trazados, sectores, vías pendientes, usuarios y sus archivos
  const decoys = {
    [`sector_route_drawings/${SCH}_sector`]: { schoolId: SCH, sectorName: 'Sector', drawings: [{ routeId: 1, routeName: 'V1', imageId: 'img', points: [{ x: 1, y: 1 }, { x: 2, y: 2 }] }] },
    [`sector_images/${SCH}_sector`]: { schoolId: SCH, images: [{ id: 'img', url: 'u', storagePath: `sector-images/${SCH}/sector/img.jpg`, order: 0 }] },
    [`pending_routes/${SCH}_r`]: { nombre: 'Vía', status: 'pending', schoolId: SCH }, [`users/${SCH}_u`]: { displayName: 'Señuelo' } };
  for (const [p, d] of Object.entries(decoys)) await seed(p, d);
  await S.upload('owner', `sector-images/${SCH}/sector/img.jpg`); await S.upload('owner', `profile-photos/${SCH}u/x.jpg`);

  // ---------- instantáneas para comprobar que NO cambia lo que no debe ----------
  const coll = async (c) => { const r = await fetch(`http://127.0.0.1:${L.FS_PORT}/v1/projects/${L.PROJECT}/databases/(default)/documents/${c}?pageSize=300`, { headers: { Authorization: 'Bearer owner' } }); const j = await r.json(); return Object.fromEntries((j.documents || []).map(d => [d.name.split('/').pop(), d.fields])); };
  const objects = async () => { const r = await fetch(`${S.HOST}/storage/v1/b/${S.BUCKET}/o?maxResults=1000`, { headers: { Authorization: 'Bearer owner' } }); const j = await r.json(); return (j.items || []).map(i => i.name).sort(); };
  const decoyState = async () => { const o = {}; for (const p of Object.keys(decoys)) o[p] = await L.ownerData(p); return sha(o); };
  const mine = (c) => Object.fromEntries(Object.entries(c).filter(([k]) => k.startsWith(SCH)));
  const photosBefore = sha(mine(await coll('route-photos'))), objsBefore = sha(await objects()), decoysBefore = await decoyState();

  // ======= 0. Autocomprobación del propio script =======
  let r = tool(['selftest']);
  check('selftest del script (protecciones y clasificación, sin red)', r.code === 0 && /selftest OK/.test(r.out), r.err.slice(0, 200));

  // ======= 1. Informe (capa 2): solo lectura =======
  r = tool(['report']);
  const lastReport = () => { const f = fs.readdirSync(OUT).filter(x => x.startsWith('report-')).sort().pop(); return { file: path.join(OUT, f), json: JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8')) }; };
  let rep = lastReport();
  const cls = (id, R = rep) => (R.json.docs.find(d => d.id === id) || {}).clase;
  check('informe: termina bien y declara que todas las peticiones fueron GET', r.code === 0 && /todas GET/.test(r.out), r.err.slice(0, 200) + r.out.slice(-200));
  check('informe: documentos con archivo (nuevo y antiguo) → seguro', cls(seguroNuevo.id) === 'seguro' && cls(seguroAntiguo.id) === 'seguro');
  check('informe: sin archivo y con edad suficiente (nuevo ≥ 10 min, antiguo ≥ 24 h) → huérfano PROBABLE (aún no confirmado)', cls(huerfanoNuevo.id) === 'huerfano_probable' && cls(huerfanoAntiguo.id) === 'huerfano_probable', `${cls(huerfanoNuevo.id)} / ${cls(huerfanoAntiguo.id)}`);
  check('informe: documentos recientes sin archivo → INDETERMINADO (podría llegar el archivo o limpiarlo la cola)', cls(recienteNuevo.id) === 'indeterminado' && cls(recienteAntiguo.id) === 'indeterminado');
  check('informe: sin datos para derivar la ruta, photoUrl discordante o uploadedAt futuro → INDETERMINADO', cls(`${SCH}_sinrutas`) === 'indeterminado' && cls(urlMal.id) === 'indeterminado' && cls(futuro.id) === 'indeterminado');
  check('informe: el archivo sin documento se lista como informativo y NO como documento huérfano', rep.json.archivos_sin_documento.includes(sinDoc) && !rep.json.docs.some(d => d.ruta === sinDoc));
  check('informe: no escribe nada (documentos, archivos y señuelos idénticos)', sha(mine(await coll('route-photos'))) === photosBefore && sha(await objects()) === objsBefore && await decoyState() === decoysBefore && Object.keys(mine(await coll('route-photos-archive'))).length === 0);
  check('informe: el informe guardado no contiene tokens de descarga', !/token=/.test(fs.readFileSync(rep.file, 'utf8')));

  // ======= 2. Segunda comprobación (confirmación) =======
  r = tool(['report', '--previous', rep.file]);
  let rep2 = lastReport();
  check('confirmación: con la segunda comprobación DEMASIADO pronto (< 10 min) sigue «probable»', cls(huerfanoNuevo.id, rep2) === 'huerfano_probable' && cls(huerfanoAntiguo.id, rep2) === 'huerfano_probable');
  r = tool(['report', '--previous', rep.file, '--min-gap-minutes', '0']);
  rep2 = lastReport();
  check('confirmación: con la separación exigida cumplida pasan a «confirmado» (y solo ellos)', cls(huerfanoNuevo.id, rep2) === 'huerfano_confirmado' && cls(huerfanoAntiguo.id, rep2) === 'huerfano_confirmado'
    && rep2.json.docs.filter(d => d.clase === 'huerfano_confirmado').filter(d => d.id.startsWith(SCH)).length === 2);
  check('confirmación: dos comprobaciones registradas como evidencia', (rep2.json.docs.find(d => d.id === huerfanoNuevo.id).comprobaciones || []).length === 2);

  // ======= 3. Plan: solo documentos confirmados =======
  const idsFile = (ids) => { const f = path.join(OUT, `ids-${Math.random().toString(36).slice(2)}.txt`); fs.writeFileSync(f, ids.join('\n') + '\n'); return f; };
  for (const [label, ids, report] of [['un documento «seguro»', [seguroNuevo.id], rep2], ['un documento «indeterminado» (reciente)', [recienteNuevo.id], rep2], ['un documento «indeterminado» (datos incompletos)', [`${SCH}_sinrutas`], rep2],
    ['un documento que no figura en el informe', ['no_existe_en_el_informe'], rep2], ['un huérfano solo «probable» (informe sin confirmar)', [huerfanoNuevo.id], rep], ['un id repetido', [huerfanoNuevo.id, huerfanoNuevo.id], rep2],
    ['un confirmado MEZCLADO con un seguro', [huerfanoNuevo.id, seguroNuevo.id], rep2]]) {
    const before = fs.readdirSync(OUT).filter(x => x.startsWith('batch-')).length;
    const p = tool(['plan', '--report', report.file, '--ids', idsFile(ids)]);
    check(`plan: se RECHAZA ${label} y no se crea ningún lote`, p.code !== 0 && fs.readdirSync(OUT).filter(x => x.startsWith('batch-')).length === before, p.err.slice(0, 160));
  }
  check('plan: más de 50 ids se rechaza', tool(['plan', '--report', rep2.file, '--ids', idsFile(Array.from({ length: 51 }, (_, i) => `id${i}`))]).code !== 0);
  r = tool(['plan', '--report', rep2.file, '--ids', idsFile([huerfanoNuevo.id, huerfanoAntiguo.id])]);
  const batchFile = path.join(OUT, fs.readdirSync(OUT).filter(x => x.startsWith('batch-')).sort().pop());
  const batch = JSON.parse(fs.readFileSync(batchFile, 'utf8'));
  check('plan: con dos huérfanos confirmados crea un lote «pendiente de aprobación» con hash y sin escribir nada en Firebase', r.code === 0 && batch.status === 'pendiente_de_aprobacion' && batch.items.length === 2 && /^[0-9a-f]{16}$/.test(batch.planHash)
    && sha(mine(await coll('route-photos'))) === photosBefore && Object.keys(mine(await coll('route-photos-archive'))).length === 0 && Object.keys(await coll('route-photo-tombstones')).filter(k => k.startsWith(SCH)).length === 0, r.err.slice(0, 200));

  // ======= 4. Apply: simulación y protecciones =======
  const phrase = 'ARCHIVAR 2 DOCUMENTOS';
  r = tool(['apply', '--batch', batchFile]);
  check('apply sin aprobación = SIMULACIÓN: no escribe nada y lo declara', r.code === 0 && /SIMULACIÓN/.test(r.out) && (r.out.match(/simulado/g) || []).length === 2 && sha(mine(await coll('route-photos'))) === photosBefore && Object.keys(mine(await coll('route-photos-archive'))).length === 0);
  const refusals = [['hash de aprobación incorrecto', ['--approve', '0000000000000000', '--confirm-text', phrase, '--limit', '2']], ['sin frase de confirmación (sin terminal)', ['--approve', batch.planHash, '--limit', '2']],
    ['frase de confirmación incorrecta', ['--approve', batch.planHash, '--confirm-text', 'archivar 2 documentos', '--limit', '2']], ['frase de otro tamaño', ['--approve', batch.planHash, '--confirm-text', 'ARCHIVAR 1 DOCUMENTOS', '--limit', '2']]];
  for (const [label, a] of refusals) { const p = tool(['apply', '--batch', batchFile, ...a]); check(`apply: RECHAZA ${label}`, p.code !== 0 && sha(mine(await coll('route-photos'))) === photosBefore && Object.keys(mine(await coll('route-photos-archive'))).length === 0, p.err.slice(0, 140)); }
  const tampered = JSON.parse(JSON.stringify(batch)); tampered.items.push({ ...tampered.items[0], id: seguroNuevo.id, ruta: seguroNuevo.storagePath });
  const tf = path.join(OUT, 'batch-manipulado.json'); fs.writeFileSync(tf, JSON.stringify(tampered));
  let p = tool(['apply', '--batch', tf, '--approve', batch.planHash, '--confirm-text', 'ARCHIVAR 3 DOCUMENTOS', '--limit', '3']);
  check('apply: RECHAZA un lote manipulado (se añadió un documento «seguro»): el hash no coincide', p.code !== 0 && sha(mine(await coll('route-photos'))) === photosBefore, p.err.slice(0, 160));
  check('apply: el límite por ejecución debe estar entre 1 y 50', tool(['apply', '--batch', batchFile, '--approve', batch.planHash, '--confirm-text', phrase, '--limit', '0']).code !== 0 && tool(['apply', '--batch', batchFile, '--approve', batch.planHash, '--confirm-text', phrase, '--limit', '51']).code !== 0);

  // El informe original es OBLIGATORIO (integridad del lote): sin él, ni simulación ni ejecución; con él alterado, tampoco
  const noRep = path.join(OUT, 'sin-informe'); fs.mkdirSync(noRep, { recursive: true });
  const lone = path.join(noRep, path.basename(batchFile)); fs.copyFileSync(batchFile, lone);
  for (const [label, a] of [['en simulación', []], ['en ejecución real', ['--approve', batch.planHash, '--confirm-text', phrase, '--limit', '2']]]) {
    const q = tool(['apply', '--batch', lone, ...a]);
    check(`apply: FALLA ${label} si no encuentra el informe original (no se salta la comprobación de integridad)`, q.code !== 0 && /no se encuentra el informe original/.test(q.err + q.out) && sha(mine(await coll('route-photos'))) === photosBefore && Object.keys(mine(await coll('route-photos-archive'))).length === 0, (q.err + q.out).slice(0, 160));
  }
  const traversal = JSON.parse(JSON.stringify(batch)); traversal.report.file = '../' + batch.report.file;
  const tr = path.join(OUT, 'batch-ruta-informe.json'); fs.writeFileSync(tr, JSON.stringify(traversal));
  check('apply: RECHAZA un lote cuyo informe apunta fuera de su carpeta', tool(['apply', '--batch', tr]).code !== 0 && tool(['apply', '--batch', tr, '--approve', batch.planHash, '--confirm-text', phrase, '--limit', '2']).code !== 0);
  const repPath = path.join(OUT, batch.report.file), repOriginal = fs.readFileSync(repPath, 'utf8');
  fs.writeFileSync(repPath, repOriginal.replace(/\s*$/, ' \n'));
  const alt = tool(['apply', '--batch', batchFile, '--approve', batch.planHash, '--confirm-text', phrase, '--limit', '2']);
  fs.writeFileSync(repPath, repOriginal);
  check('apply: RECHAZA el lote si el informe original ha cambiado', alt.code !== 0 && /ha cambiado/.test(alt.err + alt.out) && sha(mine(await coll('route-photos'))) === photosBefore);

  // ======= 5. Apply real (en el emulador): archivar y borrar SOLO el documento, atómico =======
  const orig3 = await coll('route-photos'); const o3 = orig3[huerfanoNuevo.id], o4 = orig3[huerfanoAntiguo.id];
  p = tool(['apply', '--batch', batchFile, '--approve', batch.planHash, '--confirm-text', phrase, '--limit', '2']);
  const after = await coll('route-photos'), arch = await coll('route-photos-archive'), tombs = await coll('route-photo-tombstones');
  check('apply: archiva los dos huérfanos confirmados', p.code === 0 && (p.out.match(/archivado/g) || []).length >= 2, p.err.slice(0, 200) + p.out.slice(-300));
  check('apply: los dos documentos desaparecen de route-photos', !(huerfanoNuevo.id in after) && !(huerfanoAntiguo.id in after));
  check('apply: la copia en route-photos-archive es ÍNTEGRA (campos idénticos al documento original)', canon(arch[huerfanoNuevo.id].original.mapValue.fields) === canon(o3) && canon(arch[huerfanoAntiguo.id].original.mapValue.fields) === canon(o4));
  check('apply: la copia lleva quién, cuándo, por qué, lote y evidencia', ['archivedAt', 'archivedBy', 'reason', 'batchId', 'planHash', 'evidencia'].every(k => k in arch[huerfanoNuevo.id]));
  check('apply: cada documento queda con su marca permanente (solo deletedBy y deletedAt)', Object.keys(tombs[huerfanoNuevo.id] || {}).sort().join() === 'deletedAt,deletedBy' && Object.keys(tombs[huerfanoAntiguo.id] || {}).sort().join() === 'deletedAt,deletedBy');
  check('apply: hizo una copia previa de la colección', fs.readdirSync(OUT).some(f => f.startsWith('backup-')) && JSON.stringify(JSON.parse(fs.readFileSync(path.join(OUT, fs.readdirSync(OUT).filter(f => f.startsWith('backup-')).sort().pop()), 'utf8')).collections['route-photos']).includes(huerfanoNuevo.id));
  check('apply: NO tocó los documentos seguros, recientes ni indeterminados', [seguroNuevo.id, seguroAntiguo.id, recienteNuevo.id, recienteAntiguo.id, `${SCH}_sinrutas`, urlMal.id, futuro.id].every(id => id in after));
  check('apply: NO borró ni cambió NINGÚN archivo de Storage (misma lista de objetos, incluido el archivo sin documento)', sha(await objects()) === objsBefore && await S.present(sinDoc));
  check('apply: NO tocó ningún trazado, sector, vía pendiente ni usuario (estado idéntico)', await decoyState() === decoysBefore);
  check('apply: el lote queda marcado como aplicado y no se puede aplicar dos veces', JSON.parse(fs.readFileSync(batchFile, 'utf8')).status === 'aplicado' && tool(['apply', '--batch', batchFile, '--approve', batch.planHash, '--confirm-text', phrase, '--limit', '2']).code !== 0);
  await expect('apply: las reglas impiden recrear el id archivado (marca permanente)', A.db.collection('route-photos').doc(huerfanoNuevo.id).set({ photoUrl: urlOf(huerfanoNuevo.storagePath), uploadedBy: A.uid, uploadedAt: A.FV.serverTimestamp(), routeId: 3, schoolId: SCH, filename: huerfanoNuevo.filename, storagePath: huerfanoNuevo.storagePath }), false);

  // ======= 6. Re-verificación justo antes de tocar: documento modificado o archivo que reaparece =======
  const cambiado = await newDoc(11, 40 * MIN), reaparece = await newDoc(12, 40 * MIN), estable = await newDoc(13, 40 * MIN);
  tool(['report']); const r1 = lastReport(); tool(['report', '--previous', r1.file, '--min-gap-minutes', '0']); const r2 = lastReport();
  check('re-verificación: los tres huérfanos nuevos salen confirmados', [cambiado, reaparece, estable].every(x => cls(x.id, r2) === 'huerfano_confirmado'));
  tool(['plan', '--report', r2.file, '--ids', idsFile([cambiado.id, reaparece.id, estable.id])]);
  const bf2 = path.join(OUT, fs.readdirSync(OUT).filter(x => x.startsWith('batch-') && x !== path.basename(batchFile) && x !== 'batch-manipulado.json' && x !== 'batch-ruta-informe.json').sort().pop());
  const b2 = JSON.parse(fs.readFileSync(bf2, 'utf8'));
  await seed(`route-photos/${cambiado.id}`, { ...(await L.ownerData(`route-photos/${cambiado.id}`)), routeName: 'cambiado después del plan' });   // el documento cambia tras planificar
  await S.upload('owner', reaparece.storagePath);                                                                                                // el archivo reaparece tras planificar
  p = tool(['apply', '--batch', bf2, '--approve', b2.planHash, '--confirm-text', 'ARCHIVAR 3 DOCUMENTOS', '--limit', '3']);
  const after2 = await coll('route-photos'), arch2 = await coll('route-photos-archive');
  check('re-verificación: el documento modificado tras el plan se OMITE y se conserva', cambiado.id in after2 && !(cambiado.id in arch2) && /cambiado/.test(p.out), p.out.slice(-400));
  check('re-verificación: el archivo que reaparece se OMITE y el documento se conserva', reaparece.id in after2 && !(reaparece.id in arch2) && /no está confirmado como ausente/.test(p.out));
  check('re-verificación: el tercero, sin cambios, sí se archiva', !(estable.id in after2) && estable.id in arch2);

  // ======= 7. Restauración =======
  p = tool(['restore', '--id', huerfanoNuevo.id]);
  check('restore sin --apply = SIMULACIÓN: no escribe nada', p.code === 0 && /SIMULACIÓN/.test(p.out) && !(huerfanoNuevo.id in await coll('route-photos')));
  check('restore: RECHAZA la frase incorrecta', tool(['restore', '--id', huerfanoNuevo.id, '--apply', '--confirm-text', 'RESTAURAR otro']).code !== 0 && !(huerfanoNuevo.id in await coll('route-photos')));
  p = tool(['restore', '--id', huerfanoNuevo.id, '--apply', '--confirm-text', `RESTAURAR ${huerfanoNuevo.id}`]);
  const back = await coll('route-photos'), arch3 = await coll('route-photos-archive'), tombs3 = await coll('route-photo-tombstones');
  check('restore: recrea el documento TAL CUAL era (campos idénticos)', p.code === 0 && canon(back[huerfanoNuevo.id]) === canon(o3), p.err.slice(0, 200));
  check('restore: retira su marca y conserva la copia, marcada como restaurada', !(huerfanoNuevo.id in tombs3) && 'restoredAt' in arch3[huerfanoNuevo.id] && canon(arch3[huerfanoNuevo.id].original.mapValue.fields) === canon(o3));
  check('restore: no se puede restaurar dos veces ni sobre un documento existente ni un id sin copia', tool(['restore', '--id', huerfanoNuevo.id, '--apply', '--confirm-text', `RESTAURAR ${huerfanoNuevo.id}`]).code !== 0 && tool(['restore', '--id', 'sin_copia_de_este_id', '--apply', '--confirm-text', 'RESTAURAR sin_copia_de_este_id']).code !== 0);
  check('restore: tampoco tocó trazados, sectores ni archivos de Storage', await decoyState() === decoysBefore && sha(await objects()).length > 0 && (await objects()).includes(sinDoc));
  const rid = huerfanoNuevo.id;
  const fresh = () => ({ photoUrl: urlOf(huerfanoNuevo.storagePath), uploadedBy: A.uid, uploadedAt: A.FV.serverTimestamp(), routeId: 3, schoolId: SCH, filename: huerfanoNuevo.filename, storagePath: huerfanoNuevo.storagePath });
  await expect('restore: el id restaurado sigue protegido: no se puede sobrescribir el documento (set)', A.db.collection('route-photos').doc(rid).set(fresh()), false);
  await expect('restore: ni ampliar el plazo cambiando uploadedAt (update)', A.db.collection('route-photos').doc(rid).update({ uploadedAt: A.FV.serverTimestamp() }), false);
  check('restore: tras los intentos el documento sigue idéntico al original', canon((await coll('route-photos'))[rid]) === canon(o3));
  await expect('restore: borrar el documento SIN marca sigue prohibido', A.db.collection('route-photos').doc(rid).delete(), false);
  await delPhotoBatch(A, rid).then(() => check('restore: el ciclo se cierra: borrar de nuevo (documento + marca en el lote) funciona', true), (e) => check('restore: el ciclo se cierra: borrar de nuevo (documento + marca en el lote) funciona', false, e.message));
  check('restore: tras ese borrado el id vuelve a quedar marcado y no se puede recrear', (rid in await coll('route-photo-tombstones')) && !(rid in await coll('route-photos')));
  await expect('restore: …y la restauración volvería a estar permitida solo con la herramienta (el cliente no recrea)', A.db.collection('route-photos').doc(rid).set(fresh()), false);
  // el antiguo sigue archivado y con marca
  check('el otro documento archivado sigue archivado, con su marca y sin restaurar', !(huerfanoAntiguo.id in back) && huerfanoAntiguo.id in tombs3 && !('restoredAt' in arch3[huerfanoAntiguo.id]));

  // ======= 8. Código fuente: no puede tocar lo prohibido =======
  const src = fs.readFileSync(TOOL, 'utf8').split('def cmd_selftest')[0];   // código operativo (el selftest nombra colecciones prohibidas a propósito, para comprobar que se rechazan)
  check('código: no menciona colecciones de trazados, sectores, rutas pendientes, ascensos ni usuarios', !/sector_route_drawings|sector_images|pending_routes|pending_poi|pending_sectors|pending_schools|'ascents'|'users'/.test(src));
  check('código: una sola salida de red y siempre tras la validación', (src.match(/urllib\.request\.urlopen/g) || []).length === 1 && /self\.guard\.check\(method, url, body\)\n\s+self\.guard\.sent/.test(src));
  check('código: ninguna operación de borrado de objetos de Storage (solo GET sobre el host de Storage)', !/storage\.googleapis\.com[^\n]*(DELETE|upload)/i.test(src) && !/method='(DELETE|PUT|PATCH)'/.test(src));

  fs.rmSync(OUT, { recursive: true, force: true });
  L.finish('route-photos-orphans-tool.cjs');
  process.exit(process.exitCode || 0);
})().catch(e => { console.error('ERROR FATAL', String(e.stack || e.message).slice(0, 800), '\nÚltima prueba registrada:', L.results.length ? L.results[L.results.length - 1].label : '(ninguna)'); process.exit(2); });

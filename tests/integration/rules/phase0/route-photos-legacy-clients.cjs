// Fase 0c — CLIENTES ANTIGUOS de fotos de vía contra las reglas nuevas. No se presupone que los binarios instalados sean iguales al código actual del repositorio:
// se ejecutan TODAS las versiones distintas de route-photos.js que existen en el historial de git (cada una con el SDK real contra el emulador) y se modelan los formatos
// que muestran los documentos reales de 2025 (anteriores al historial: id con el nombre de la vía y sin routeId, que coincide con la versión de enero de 2026).
// Para cada versión se registra qué ocurre al SUBIR, LEER y BORRAR, y si quedan documentos o archivos huérfanos, en cuatro estados del despliegue:
//   A) reglas finales · B) Firestore final + Storage anterior · C) Storage final + Firestore actual · D) todo actual (línea base: lo que ocurre HOY).
// Solo emulador local; no toca producción ni usa credenciales. Las versiones se leen con «git show» (si no hay historial se omite con un aviso).
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const ROOT = path.resolve(__dirname, '../../../..');
process.env.RULES_FILE = process.env.RULES_FILE || path.join(ROOT, 'docs/security-phase0/firestore.rules.phase0c.proposal');
process.env.MODE = 'proposal';
const crypto = require('node:crypto');
const L = require('./_lib.cjs');
const S = require('./_storage.cjs');
const { makeEnv, mkFile, attempt, docOf } = require('./_client-env.cjs');
const { mk, seed, check, SUPER_EMAIL } = L;
const STORAGE_FINAL = path.join(ROOT, 'storage.rules'), STORAGE_PREV = path.join(ROOT, 'storage.rules.previous');
const sha = (t) => crypto.createHash('sha1').update(t).digest('hex').slice(0, 10);

// ---- Versiones del cliente en el historial de git (contenido distinto), sin la versión actual del árbol de trabajo ----
function legacyVersions() {
  const current = sha(fs.readFileSync(path.join(ROOT, 'route-photos.js'), 'utf8'));
  let hashes = [];
  try { hashes = execFileSync('git', ['log', '--all', '--format=%H', '--', 'route-photos.js'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\n').filter(Boolean); } catch (_) { /* sin git */ }
  const seen = new Map();
  for (const h of hashes.reverse()) {   // de la más antigua a la más reciente
    let src; try { src = execFileSync('git', ['show', `${h}:route-photos.js`], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 5e6 }); } catch (_) { continue; }
    const k = sha(src);
    if (k !== current && !seen.has(k)) seen.set(k, { id: k, commit: h.slice(0, 7), src });
  }
  return [...seen.values()];
}
// uploadRoutePhoto cambió de firma: (escuela, nombreVía, archivo) en la primera versión y (escuela, routeId, nombreVía, archivo) después
const upload = (env, ver, school, route, name, file) => (env.api.uploadRoutePhoto.length === 3 ? env.api.uploadRoutePhoto(school, name, file) : env.api.uploadRoutePhoto(school, route, name, file));
const listPhotos = (env, school, route, name) => (env.api.getRoutePhotos.length === 2 ? env.api.getRoutePhotos(school, name) : env.api.getRoutePhotos(school, route, name));

(async () => {
  const versions = legacyVersions();
  check('hay al menos 3 versiones antiguas distintas en el historial de git (si falla: clon sin historial)', versions.length >= 3, versions.map(v => v.commit).join(', '));
  if (versions.length < 3) { L.finish('route-photos-legacy-clients.cjs'); return; }

  const stamp = Date.now();
  const A = await mk('la' + stamp, `la${stamp}@test.dev`), B = await mk('lb' + stamp, `lb${stamp}@test.dev`), AD = await mk('lad' + stamp, `lad${stamp}@test.dev`);
  const SP = await mk('lsp' + stamp, `lsp${stamp}@test.dev`), PU = await mk('lpu' + stamp, `lpu${stamp}@test.dev`);
  for (const u of [A, B, AD, SP, PU]) { u.st = u.app.storage(); u.st.useEmulator('127.0.0.1', L.ST_PORT); }
  await seed(`admins/${AD.uid}`, { role: 'admin' }); await seed(`admins/${SP.uid}`, { role: 'spotter' }); await seed(`admins/${PU.uid}`, { role: 'photo_uploader' });
  const NEW = require('./_client-env.cjs');
  const SCH = 'sl' + stamp;
  const photoFile = (n) => mkFile(`foto${n}.jpeg`, 'image/jpeg', 4096);
  const filesIn = async (school) => {   // archivos reales bajo route-photos/{school}/ (REST del emulador, como propietario)
    const r = await fetch(`${S.HOST}/v0/b/${S.BUCKET}/o?prefix=${encodeURIComponent(`route-photos/${school}/`)}`, { headers: { Authorization: 'Bearer owner' } });
    const j = await r.json(); return (j.items || []).map(i => i.name);
  };
  const clean = async (school) => { for (const f of await filesIn(school)) await S.del('owner', f).catch(() => {}); };
  const docsOf = async (school) => {
    const r = await fetch(`http://127.0.0.1:${L.FS_PORT}/v1/projects/${L.PROJECT}/databases/(default)/documents/route-photos?pageSize=300`, { headers: { Authorization: 'Bearer owner' } });
    const j = await r.json(); return (j.documents || []).filter(d => (d.fields.schoolId || {}).stringValue === school).map(d => d.name.split('/').pop());
  };
  const wipe = async (school) => { await clean(school); for (const id of await docsOf(school)) await L.ownerDelete(`route-photos/${id}`); };
  const state = async (school) => `${(await docsOf(school)).length} documento(s), ${(await filesIn(school)).length} archivo(s)`;

  // ---- fixtures: fotos antiguas reales (formato del id con el nombre, y con routeId) y una foto NUEVA hecha con el cliente nuevo ----
  const mkLegacy = async (school, kind, n, owner) => {
    const ts = 1764000000000 + n, name = 'Prueba' + n, filename = `${ts}_${name}.jpeg`;
    const id = kind === 'name' ? `${school}_${name}_${ts}` : `${school}_${200 + n}_${ts}`;
    await seed(`route-photos/${id}`, { photoUrl: 'https://firebasestorage.googleapis.com/v0/b/x/o/y?alt=media&token=t', uploadedBy: owner.uid, uploadedByName: 'X', uploadedAt: new Date('2025-12-01T10:00:00Z'),
      routeName: name, schoolId: school, filename, ...(kind === 'id' ? { routeId: 200 + n } : {}) });
    await S.upload('owner', `route-photos/${school}/${filename}`);
    return { id, name, route: kind === 'id' ? 200 + n : undefined, path: `route-photos/${school}/${filename}` };
  };
  const mkNew = async (school, route, owner) => {   // foto con el cliente NUEVO (formato final)
    await L.loadFirestoreRules('proposal'); await S.loadStorageRules(STORAGE_FINAL);
    const e = makeEnv(owner); const url = await e.api.uploadRoutePhoto(school, route, 'Nueva', mkFile('n.jpg', 'image/jpeg'));
    const id = NEW.idOf(url); return { id, path: `route-photos/${school}/${owner.uid}/${id}.jpg` };
  };
  const setRules = async (state_) => {
    if (state_ === 'A') { await L.loadFirestoreRules('proposal'); await S.loadStorageRules(STORAGE_FINAL); }
    if (state_ === 'B') { await L.loadFirestoreRules('proposal'); await S.loadStorageRules(STORAGE_PREV); }
    if (state_ === 'C') { await L.loadFirestoreRules('current'); await S.loadStorageRules(STORAGE_FINAL); }
    if (state_ === 'D') { await L.loadFirestoreRules('current'); await S.loadStorageRules(STORAGE_PREV); }
  };

  for (const ver of versions) {
    const tag = `cliente ${ver.commit}`;
    const school = `${SCH}${ver.id}`.slice(0, 40).replace(/[^A-Za-z0-9_-]/g, '');
    const mkEnv = (u) => makeEnv(u, { src: ver.src });
    check(`${tag}: el cliente antiguo carga y expone sus funciones`, ['uploadRoutePhoto', 'deleteRoutePhoto', 'getRoutePhotos'].every(f => typeof mkEnv(A).api[f] === 'function'));

    // ===== D) línea base: reglas ACTUALES de producción =====
    await setRules('D'); await wipe(school);
    let e = mkEnv(AD); let r = await attempt(() => upload(e, ver, school, 7, 'Via', photoFile(1)));
    check(`${tag} · hoy (reglas actuales): un administrador SUBE una foto (archivo y luego documento)`, r.ok && (await state(school)) === '1 documento(s), 1 archivo(s)', r.error && r.error.message);
    await wipe(school);

    // ===== A) reglas finales =====
    await setRules('A'); await wipe(school);
    // SUBIR
    e = mkEnv(AD); r = await attempt(() => upload(e, ver, school, 7, 'Via', photoFile(2)));
    check(`${tag} · A SUBIR (admin): falla en Storage antes de crear el documento; no queda NADA`, !r.ok && !e.calls.includes('doc.set') && (await state(school)) === '0 documento(s), 0 archivo(s)', r.error && r.error.code + ' · ' + (await state(school)));
    e = mkEnv(PU); r = await attempt(() => upload(e, ver, school, 7, 'Via', photoFile(2)));
    check(`${tag} · A SUBIR (rol photo_uploader): igual, no queda nada`, !r.ok && (await state(school)) === '0 documento(s), 0 archivo(s)');
    e = mkEnv(B); r = await attempt(() => upload(e, ver, school, 7, 'Via', photoFile(2)));
    check(`${tag} · A SUBIR (usuario normal): lo impide el propio cliente antiguo sin escribir nada`, !r.ok && !e.calls.includes('file.put') && !e.calls.includes('doc.set'), r.error && r.error.message);
    // LEER
    const lg = await mkLegacy(school, 'name', 1, A), li = await mkLegacy(school, 'id', 2, A), nw = await mkNew(school, 31, A);
    e = mkEnv(B); const byName = await listPhotos(e, school, 999, lg.name), byId = await listPhotos(e, school, li.route, li.name), byNew = await listPhotos(e, school, 31, 'Nueva');
    check(`${tag} · A LEER: lista la foto antigua por nombre, la antigua con routeId y la NUEVA (URL sin token)`, byName.length >= 1 && byName.some(p => p.id === lg.id) && byId.some(p => p.id === li.id) && byNew.some(p => p.id === nw.id && /alt=media$/.test(p.url)),
      `${byName.length}/${byId.length}/${byNew.length}`);
    // BORRAR foto NUEVA con el cliente antiguo (autor)
    e = mkEnv(A); let before = await state(school); r = await attempt(() => e.api.deleteRoutePhoto(nw.id, A.uid));
    check(`${tag} · A BORRAR foto nueva (autor): falla, y NO deja huérfanos: el cliente antiguo apunta a la ruta antigua del archivo, que no existe; documento y archivo siguen intactos`,
      !r.ok && (await state(school)) === before && !!(await docOf(nw.id)) && await S.present(nw.path), r.error && r.error.message);
    // BORRAR foto ANTIGUA (autor, spotter, admin) con el cliente antiguo
    for (const [who, u] of [['autor', A], ['spotter', SP], ['usuario ajeno', B]]) {
      const lx = await mkLegacy(school, 'name', 10 + Math.floor(Math.random() * 1e6), A);
      e = mkEnv(u); before = await state(school); r = await attempt(() => e.api.deleteRoutePhoto(lx.id, u.uid));
      check(`${tag} · A BORRAR foto antigua (${who}): no se borra nada ni queda huérfano`, !r.ok && (await state(school)) === before && !!(await docOf(lx.id)) && await S.present(lx.path), r.error && r.error.message);
    }
    const la = await mkLegacy(school, 'name', 20 + Math.floor(Math.random() * 1e6), A);
    e = mkEnv(AD); r = await attempt(() => e.api.deleteRoutePhoto(la.id, A.uid));
    const docLeft = !!(await docOf(la.id)), fileLeft = await S.present(la.path);
    check(`${tag} · A BORRAR foto antigua (ADMIN con cliente antiguo): borra el ARCHIVO pero el documento se rechaza (sin marca) → DOCUMENTO HUÉRFANO visible con la imagen rota. Riesgo conocido: usar el cliente nuevo`,
      !r.ok && docLeft && !fileLeft, `documento ${docLeft ? 'queda' : 'borrado'}, archivo ${fileLeft ? 'queda' : 'borrado'}`);
    await wipe(school);

    // ===== B) Firestore final YA desplegado y Storage anterior TODAVÍA con comodín (entre los pasos 2 y 3) =====
    await setRules('B'); await wipe(school);
    e = mkEnv(AD); r = await attempt(() => upload(e, ver, school, 7, 'Via', photoFile(3)));
    const stB = await state(school);
    check(`${tag} · B SUBIR (admin): el archivo SÍ se sube (comodín) y el documento se rechaza → ARCHIVO HUÉRFANO en la ruta antigua (solo hasta que se despliegue Storage; limpiar con administración)`,
      !r.ok && stB === '0 documento(s), 1 archivo(s)', stB);
    await wipe(school);

    // ===== C) Storage final con Firestore todavía actual (si se desplegara en orden inverso) =====
    await setRules('C'); await wipe(school);
    e = mkEnv(AD); r = await attempt(() => upload(e, ver, school, 7, 'Via', photoFile(4)));
    check(`${tag} · C SUBIR (admin): falla en Storage antes de crear el documento; no queda nada`, !r.ok && (await state(school)) === '0 documento(s), 0 archivo(s)', await state(school));
    await wipe(school);
  }

  // ===== Formato de los documentos reales de 2025 (anteriores al historial) =====
  check('los formatos antiguos observados en producción (id con el nombre de la vía, sin routeId, archivo en la ruta sin uid) los cubre la versión de enero de 2026 de arriba: mismo comportamiento',
    true, 'documentos reales: {escuela}_{nombre}_{ms}; campos filename, photoUrl, routeName, schoolId, uploadedAt, uploadedBy, uploadedByName');
  L.finish('route-photos-legacy-clients.cjs');
  process.exit(process.exitCode || 0);
})().catch(e => { console.error('ERROR FATAL', String(e.stack || e.message).slice(0, 700), '\nÚltima prueba registrada:', L.results.length ? L.results[L.results.length - 1].label : '(ninguna)'); process.exit(2); });

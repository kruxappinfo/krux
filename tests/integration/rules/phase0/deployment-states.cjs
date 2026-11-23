// Fase 0c — ESTADOS INTERMEDIOS DEL DESPLIEGUE. Qué puede hacer un usuario autenticado (y uno anónimo) en cada combinación de reglas de Firestore y de Storage, para decidir el orden
// de despliegue con evidencia y no por intuición. Solo emulador local (no toca producción).
//   S0 HOY ............ Firestore actual   + Storage con comodín
//   S1 intervalo F→S .. Firestore final    + Storage con comodín   (se desplegó Firestore y aún no Storage)
//   S2 intervalo S→F .. Firestore actual   + Storage final         (se desplegó Storage y aún no Firestore)
//   S3 FINAL .......... Firestore final    + Storage final
// Tres bloques por estado: (L) operaciones LEGÍTIMAS, que deben funcionar en TODOS los estados (sin corte de servicio entre pasos); (E) EXPOSICIONES de Storage y de Firestore, que se
// documentan como «permitidas mientras siga el comodín / las reglas actuales» y deben quedar cerradas en el estado final; (F) la política de 12 h sobre el archivo y el documento.
const path = require('node:path');
const ROOT = path.resolve(__dirname, '../../../..');
process.env.RULES_FILE = process.env.RULES_FILE || path.join(ROOT, 'docs/security-phase0/firestore.rules.route-photos-only.proposal');
process.env.MODE = 'proposal';
const L = require('./_lib.cjs');
const S = require('./_storage.cjs');
const { mkPhotoV2 } = require('./_photos.cjs');
const { makeEnv, mkFile, attempt, idOf, docOf } = require('./_client-env.cjs');
const { mk, seed, expect, check, SUPER_EMAIL } = L;
const FINAL = path.join(ROOT, 'storage.rules'), PREV = path.join(ROOT, 'storage.rules.previous');
const H = 3600 * 1000;
const STATES = [
  { id: 'S0', label: 'HOY (Firestore actual + Storage con comodín)', fs: 'current', st: PREV, fsClosed: false, stClosed: false },
  { id: 'S1', label: 'INTERVALO F→S (Firestore final + Storage con comodín)', fs: 'proposal', st: PREV, fsClosed: true, stClosed: false },
  { id: 'S2', label: 'INTERVALO S→F (Storage final + Firestore actual)', fs: 'current', st: FINAL, fsClosed: false, stClosed: true },
  { id: 'S3', label: 'FINAL (Firestore final + Storage final)', fs: 'proposal', st: FINAL, fsClosed: true, stClosed: true }
];

(async () => {
  const stamp = Date.now();
  const A = await mk('da' + stamp, `da${stamp}@test.dev`), B = await mk('db' + stamp, `db${stamp}@test.dev`);
  const SP = await mk('dsp' + stamp, `dsp${stamp}@test.dev`), AD = await mk('dad' + stamp, `dad${stamp}@test.dev`);
  for (const u of [A, B, SP, AD]) { u.st = u.app.storage(); u.st.useEmulator('127.0.0.1', L.ST_PORT); }
  await seed(`admins/${SP.uid}`, { role: 'spotter' }); await seed(`admins/${AD.uid}`, { role: 'admin' });
  const t = { A: await A.token(), B: await B.token(), SP: await SP.token(), AD: await AD.token() };
  const FV = A.FV;
  let n = 0;
  const fx = async (p, ctype) => { await S.upload('owner', p, ctype); return p; };                 // objeto creado «por el propietario» (saltando las reglas)
  const photoFx = async (owner, ageMs, file = true) => {                                               // foto de vía con formato nuevo: documento sembrado + archivo
    const x = mkPhotoV2(owner, FV);
    await seed(`route-photos/${x.id}`, Object.assign({}, x.data, { uploadedAt: new Date(Date.now() - ageMs) }));
    if (file) await S.upload('owner', x.storagePath);
    return x;
  };
  const delDocPlain = (u, id) => u.db.collection('route-photos').doc(id).delete();

  for (const s of STATES) {
    await L.loadFirestoreRules(s.fs); await S.loadStorageRules(s.st);
    const T = `${s.id} ${s.label}`;
    const tag = `${s.id}_${stamp}_${++n}`;
    const school = `ds${stamp}`;
    // ---------- (L) legítimas: deben funcionar en TODOS los estados ----------
    await expect(`${T} · L1 el dueño sube su foto de perfil`, S.upload(t.A, `profile-photos/${A.uid}/${tag}_a.jpg`), true);
    await expect(`${T} · L2 el dueño sube un vídeo a sus publicaciones`, S.upload(t.A, `posts/${A.uid}/${tag}_v.mp4`, 'video/mp4', 300000), true);
    await expect(`${T} · L3 el dueño borra su propio vídeo`, S.del(t.A, `posts/${A.uid}/${tag}_v.mp4`), true);
    await expect(`${T} · L4 un spotter sube una imagen de sector`, S.upload(t.SP, `sector-images/${school}/sec/img_${tag}.jpg`), true);
    await expect(`${T} · L5 un admin borra una imagen de sector`, S.del(t.AD, `sector-images/${school}/sec/img_${tag}.jpg`), true);
    await expect(`${T} · L6 el dueño sube una foto de rocódromo`, S.upload(t.A, `gym-photos/${A.uid}/g_${tag}.jpg`), true);
    await expect(`${T} · L7 un usuario con sesión lee la foto de rocódromo`, S.read(t.B, `gym-photos/${A.uid}/g_${tag}.jpg`), true);
    await expect(`${T} · L8 un visitante lee perfil, publicación, sector y foto de vía (públicos)`, (async () => {
      const a = await fx(`profile-photos/${A.uid}/${tag}_pub.jpg`), b = await fx(`posts/${A.uid}/${tag}_pub.jpg`), c = await fx(`sector-images/${school}/sec/pub_${tag}.jpg`), d = await photoFx(A, 1000);
      for (const p of [a, b, c, d.storagePath]) await S.read(null, p);
    })(), true);
    await expect(`${T} · L9 un admin borra una foto de vía ajena (archivo)`, (async () => { const x = await photoFx(A, 2 * H); await S.del(t.AD, x.storagePath); })(), true);
    // cliente NUEVO de fotos de vía: subir, listar y borrar (compatibilidad con cualquier estado)
    const e = makeEnv(A); const r = await attempt(async () => {
      const url = await e.api.uploadRoutePhoto(school, 5, 'V', mkFile('a.jpg', 'image/jpeg')); const id = idOf(url);
      const listed = (await e.api.getRoutePhotos(school, 5)).some(p => p.id === id);
      await e.api.deleteRoutePhoto(id, A.uid); return listed && !(await docOf(id));
    });
    check(`${T} · L10 el cliente NUEVO sube, lista y borra una foto de vía`, r.ok && r.value === true, r.error && r.error.message);

    // ---------- (E) exposiciones de Storage: abiertas mientras siga el comodín, cerradas con las reglas finales ----------
    const open = !s.stClosed, note = open ? ' [exposición mientras siga el comodín]' : '';
    await expect(`${T} · E1 otro usuario SOBRESCRIBE la foto de perfil de A${note}`, S.upload(t.B, await fx(`profile-photos/${A.uid}/${tag}_e1.jpg`)), open);
    await expect(`${T} · E2 otro usuario BORRA la foto de perfil de A${note}`, S.del(t.B, await fx(`profile-photos/${A.uid}/${tag}_e2.jpg`)), open);
    await expect(`${T} · E3 otro usuario BORRA un archivo de una publicación de A${note}`, S.del(t.B, await fx(`posts/${A.uid}/${tag}_e3.jpg`)), open);
    await expect(`${T} · E4 un usuario normal SUBE una imagen de sector${note}`, S.upload(t.B, `sector-images/${school}/sec/e4_${tag}.jpg`), open);
    await expect(`${T} · E5 un usuario normal BORRA una imagen de sector${note}`, S.del(t.B, await fx(`sector-images/${school}/sec/e5_${tag}.jpg`)), open);
    await expect(`${T} · E6 un usuario normal escribe en una ruta cualquiera (p. ej. /otra/…)${note}`, S.upload(t.B, `otra${stamp}/${tag}.jpg`), open);
    await expect(`${T} · E7 otro usuario BORRA el archivo de una foto de vía de A (con documento y dentro de plazo)${note}`, S.del(t.B, (await photoFx(A, 1000)).storagePath), open);
    await expect(`${T} · E8 otro usuario SOBRESCRIBE el archivo de una foto de vía de A${note}`, S.upload(t.B, (await photoFx(A, 1000)).storagePath), open);
    await expect(`${T} · E9 otro usuario sube un archivo a la carpeta de A sin documento${note}`, S.upload(t.B, `route-photos/${school}/${A.uid}/${mkPhotoV2(A, FV).filename}`), open);
    await expect(`${T} · E10 un usuario borra el gym-photo de otro (solo admin debería)${note}`, S.del(t.B, await fx(`gym-photos/${A.uid}/e10_${tag}.jpg`)), open);
    // ---------- (F) política de 12 h ----------
    await expect(`${T} · F1 el AUTOR borra el archivo de su foto de vía pasadas 12 h (13 h)${open ? ' [la política de 12 h NO se aplica a los archivos mientras siga el comodín]' : ''}`, S.del(t.A, (await photoFx(A, 13 * H)).storagePath), open);
    await expect(`${T} · F2 el AUTOR borra el archivo de su foto de vía a las 11 h 59 min (dentro de plazo)`, S.del(t.A, (await photoFx(A, 11 * H + 59 * 60000)).storagePath), true);
    // ---------- (E) exposiciones de Firestore: abiertas con las reglas actuales, cerradas con las finales ----------
    const fopen = !s.fsClosed, fnote = fopen ? ' [exposición con las reglas actuales de Firestore]' : '';
    await expect(`${T} · E11 otro usuario BORRA el documento de una foto de A${fnote}`, delDocPlain(B, (await photoFx(A, 1000)).id), fopen);
    await expect(`${T} · E12 otro usuario CREA un documento de foto falsificado (uploadedAt en el futuro, uploadedBy ajeno)${fnote}`,
      B.db.collection('route-photos').doc(`${school}_9_${('f' + stamp.toString(36) + n + 'abcdefghijklmnop').slice(0, 16)}`).set({ photoUrl: 'https://evil.example/x.jpg', uploadedBy: A.uid, uploadedAt: new Date(Date.now() + 11 * H), routeId: 9, schoolId: school, filename: 'x.jpg' }), fopen);
    await expect(`${T} · E13 el AUTOR borra su documento pasadas 12 h (13 h), borrado simple${fnote}`, delDocPlain(A, (await photoFx(A, 13 * H, false)).id), fopen);
    // ---------- (G) consecuencia concreta del orden S→F: sin documento el autor no borra su archivo ----------
    // Con las reglas actuales de Firestore cualquiera puede borrar el documento de otro; con Storage final, el autor ya no puede retirar su archivo (solo administración).
    const g = await photoFx(A, 1000);
    await expect(`${T} · G1 tras borrar B el documento de A, el AUTOR borra su archivo${s.id === 'S2' ? ' [única consecuencia negativa del orden S→F: solo en las rutas de vía, función sin interfaz]' : ''}`,
      (async () => { await delDocPlain(B, g.id).catch(() => {}); await S.del(t.A, g.storagePath); })(), s.id !== 'S2');
    if (s.id === 'S2') await expect(`${T} · G2 …y un administrador sí puede retirar ese archivo`, S.del(t.AD, g.storagePath), true);
  }
  L.finish('deployment-states.cjs');
  process.exit(process.exitCode || 0);
})().catch(e => { console.error('ERROR FATAL', String(e.stack || e.message).slice(0, 700), '\nÚltima prueba registrada:', L.results.length ? L.results[L.results.length - 1].label : '(ninguna)'); process.exit(2); });

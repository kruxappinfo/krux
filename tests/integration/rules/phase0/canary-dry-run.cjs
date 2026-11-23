// Fase 0c — ENSAYO del canario de Firebase real (docs/security-phase0/STORAGE-CANARY.md) contra el emulador local. Ejecuta los MISMOS pasos, con los mismos identificadores (C1…C30) y
// comprueba que los resultados esperados que se le piden al canario real son los que dan las reglas. Así, un resultado distinto en producción indica de verdad un problema de despliegue
// (permiso entre servicios, comportamiento de la plataforma…) y no un error en la lista de comprobación.
// Se ejecuta en dos estados: «tras Storage» (Storage final + Firestore actual: puerta S) y «final» (puerta F). Los pasos de tiempo largo (12 h) y de red lenta/cortada no son
// reproducibles con reloj real en un emulador: aquí se cubren con documentos sembrados y con las suites escaladas; en producción son los pasos C22–C27 y C30.
// Solo emulador local; no toca producción.
const path = require('node:path');
const ROOT = path.resolve(__dirname, '../../../..');
process.env.RULES_FILE = process.env.RULES_FILE || path.join(ROOT, 'docs/security-phase0/firestore.rules.route-photos-only.proposal');
process.env.MODE = 'proposal';
const L = require('./_lib.cjs');
const S = require('./_storage.cjs');
const { mkPhotoV2, delPhotoBatch, BASE } = require('./_photos.cjs');
const { makeEnv, mkFile, attempt, idOf, docOf } = require('./_client-env.cjs');
const { mk, seed, expect, check } = L;
const FINAL = path.join(ROOT, 'storage.rules');

(async () => {
  const stamp = Date.now();
  const A = await mk('ca' + stamp, `ca${stamp}@test.dev`), B = await mk('cb' + stamp, `cb${stamp}@test.dev`);
  const ADM = await mk('cadm' + stamp, `cadm${stamp}@test.dev`), SP = await mk('csp' + stamp, `csp${stamp}@test.dev`);
  for (const u of [A, B, ADM, SP]) { u.st = u.app.storage(); u.st.useEmulator('127.0.0.1', L.ST_PORT); }
  await seed(`admins/${ADM.uid}`, { role: 'admin' }); await seed(`admins/${SP.uid}`, { role: 'spotter' });
  const t = { A: await A.token(), B: await B.token(), ADM: await ADM.token(), SP: await SP.token() };
  const FV = A.FV, SCH = 'canario';
  const H60 = 60 * 1000;
  const run = async (state) => {   // state: 'S' (tras Storage: Storage final + Firestore actual) | 'F' (final)
    const final = state === 'F', T = `[${state === 'S' ? 'tras Storage' : 'final'}]`, tag = `${state}${stamp}`;
    await L.loadFirestoreRules(final ? 'proposal' : 'current'); await S.loadStorageRules(FINAL);
    const own = async (p, c) => { await S.upload('owner', p, c); return p; };
    // ---- Puerta S: permisos de Storage (los mismos pasos que en producción, con SDK/consola) ----
    await expect(`${T} C1 A sube su foto de perfil`, S.upload(t.A, `profile-photos/${A.uid}/canary_${tag}.jpg`), true);
    await expect(`${T} C2 B y un visitante leen la foto de perfil de A`, (async () => { await S.read(t.B, `profile-photos/${A.uid}/canary_${tag}.jpg`); await S.read(null, `profile-photos/${A.uid}/canary_${tag}.jpg`); })(), true);
    await expect(`${T} C3 B BORRA la foto de perfil de A`, S.del(t.B, `profile-photos/${A.uid}/canary_${tag}.jpg`), false);
    await expect(`${T} C4 B SOBRESCRIBE la foto de perfil de A`, S.upload(t.B, `profile-photos/${A.uid}/canary_${tag}.jpg`), false);
    await expect(`${T} C5 A sube una foto y un vídeo de publicación y los borra`, (async () => { const a = `posts/${A.uid}/canary_${tag}_f.jpg`, v = `posts/${A.uid}/canary_${tag}_v.mp4`; await S.upload(t.A, a); await S.upload(t.A, v, 'video/mp4', 200000); await S.del(t.A, a); await S.del(t.A, v); })(), true);
    await expect(`${T} C6 B borra un archivo de publicación de A`, S.del(t.B, await own(`posts/${A.uid}/canary_${tag}_b.jpg`)), false);
    await expect(`${T} C7a B (normal) SUBE una imagen de sector`, S.upload(t.B, `sector-images/${SCH}/canary/img_${tag}_b.jpg`), false);
    await expect(`${T} C7b un spotter y un admin suben una imagen de sector de prueba`, (async () => { await S.upload(t.SP, `sector-images/${SCH}/canary/img_${tag}_sp.jpg`); await S.upload(t.ADM, `sector-images/${SCH}/canary/img_${tag}_adm.jpg`); })(), true);
    await expect(`${T} C7c B (normal) BORRA una imagen de sector`, S.del(t.B, `sector-images/${SCH}/canary/img_${tag}_adm.jpg`), false);
    await expect(`${T} C7d un admin borra las imágenes de sector de prueba`, (async () => { await S.del(t.ADM, `sector-images/${SCH}/canary/img_${tag}_adm.jpg`); await S.del(t.ADM, `sector-images/${SCH}/canary/img_${tag}_sp.jpg`); })(), true);
    await expect(`${T} C8 B escribe en una ruta cualquiera`, S.upload(t.B, `canario-otra/${tag}.jpg`), false);
    await expect(`${T} C9a A sube una foto de rocódromo`, S.upload(t.A, `gym-photos/${A.uid}/canary_${tag}.jpg`), true);
    await expect(`${T} C9b B (normal) borra la foto de rocódromo de A`, S.del(t.B, `gym-photos/${A.uid}/canary_${tag}.jpg`), false);
    await expect(`${T} C9c un admin borra la foto de rocódromo`, S.del(t.ADM, `gym-photos/${A.uid}/canary_${tag}.jpg`), true);
    await expect(`${T} C10a un visitante lee lo público (perfil, publicación, sector)`, (async () => { for (const p of [await own(`profile-photos/${A.uid}/c10_${tag}.jpg`), await own(`posts/${A.uid}/c10_${tag}.jpg`), await own(`sector-images/${SCH}/canary/c10_${tag}.jpg`)]) await S.read(null, p); })(), true);
    await expect(`${T} C10b un visitante SUBE`, S.upload(null, `profile-photos/${A.uid}/c10x_${tag}.jpg`), false);

    // ---- fotos de vía con el cliente NUEVO ----
    const eA = makeEnv(A), eB = makeEnv(B), eAdm = makeEnv(ADM), eSp = makeEnv(SP);
    let r = await attempt(() => eA.api.uploadRoutePhoto(SCH, 1, 'CANARIO', mkFile('c.jpg', 'image/jpeg', 300 * 1024)));
    const id = r.ok ? idOf(r.value) : null, fp = id ? `route-photos/${SCH}/${A.uid}/${id}.jpg` : null;
    check(`${T} C11 A sube una foto de vía (300 KB): documento y archivo creados, se lista y un visitante la lee`, r.ok && !!(await docOf(id)) && await S.present(fp) && (await eA.api.getRoutePhotos(SCH, 1)).some(p => p.id === id) && await S.read(null, fp).then(() => true, () => false), r.error && r.error.message);
    await expect(`${T} C12 B BORRA el archivo de la foto de A`, S.del(t.B, fp), false);
    await expect(`${T} C13 B SOBRESCRIBE el archivo de la foto de A`, S.upload(t.B, fp), false);
    const z = await attempt(() => eA.api.uploadRoutePhoto(SCH, 3, 'CANARIO', mkFile('z.jpg', 'image/jpeg')));
    await expect(`${T} C14 B borra el DOCUMENTO de una foto de A${final ? '' : ' [con las reglas actuales de Firestore SÍ se permite: solo se exige tras la puerta F]'}`, B.db.collection('route-photos').doc(idOf(z.value)).delete(), !final);
    await expect(`${T} C15 A sobrescribe su propio archivo`, S.upload(t.A, fp), false);
    r = await attempt(() => eB.api.deleteRoutePhoto(id, A.uid));
    check(`${T} C18 B con el cliente nuevo intenta borrar la foto de A: error y nada cambia`, !r.ok && await S.present(fp) && !!(await docOf(id)), r.error && r.error.message);
    const x = mkPhotoV2(A, FV); await seed(`route-photos/${x.id}`, { ...x.data, uploadedAt: new Date(Date.now() - 3600000), schoolId: SCH, storagePath: `route-photos/${SCH}/${A.uid}/${x.filename}` }); await S.upload('owner', `route-photos/${SCH}/${A.uid}/${x.filename}`);
    await expect(`${T} C20 un spotter intenta borrar la foto ajena (archivo)`, S.del(t.SP, `route-photos/${SCH}/${A.uid}/${x.filename}`), false);
    r = await attempt(() => eSp.api.deleteRoutePhoto(x.id, A.uid));
    check(`${T} C20 un spotter con el cliente nuevo intenta borrar la foto ajena: error y nada cambia`, !r.ok && await S.present(`route-photos/${SCH}/${A.uid}/${x.filename}`), r.error && r.error.message);
    if (final) {   // L6: directamente en Firestore (sin pasar por el cliente): el spotter no tiene privilegio de borrado sobre documentos de fotos de vía
      await expect(`${T} C20 un spotter BORRA directamente el documento de una foto ajena (sin marca)`, SP.db.collection('route-photos').doc(x.id).delete(), false);
      await expect(`${T} C20 un spotter BORRA directamente el documento de una foto ajena (con su marca, en un lote)`, delPhotoBatch(SP, x.id), false);
      check(`${T} C20 tras los dos intentos directos del spotter, el documento sigue y no existe marca`, !!(await docOf(x.id)) && !(await L.exists(`route-photo-tombstones/${x.id}`)));
      await expect(`${T} C20 un spotter no puede crear la marca de una foto que sigue existiendo`, SP.db.collection('route-photo-tombstones').doc(x.id).set({ deletedBy: SP.uid, deletedAt: SP.FV.serverTimestamp() }), false);
    }
    r = await attempt(() => eA.api.deleteRoutePhoto(id, A.uid));
    check(`${T} C16 A borra su foto con el cliente nuevo: archivo y documento borrados${final ? ' y marca permanente creada' : ' (sin marca: la colección aún no existe en las reglas actuales)'}`, r.ok && !(await S.present(fp)) && !(await docOf(id)) && (await L.exists(`route-photo-tombstones/${id}`)) === final, r.error && r.error.message);
    if (final) await expect(`${T} C17 A intenta RECREAR el id borrado (mismo id, mismos datos que la subida original)`, A.db.collection('route-photos').doc(id).set({ photoUrl: BASE + encodeURIComponent(fp) + '?alt=media', uploadedBy: A.uid, uploadedByName: 'T', uploadedAt: FV.serverTimestamp(), routeId: 1, routeName: 'CANARIO', schoolId: SCH, filename: `${id}.jpg`, storagePath: fp }), false);
    const y = await attempt(() => eA.api.uploadRoutePhoto(SCH, 2, 'CANARIO', mkFile('d.jpg', 'image/jpeg')));
    const yid = y.ok ? idOf(y.value) : null;
    r = await attempt(() => eAdm.api.deleteRoutePhoto(yid, A.uid));
    check(`${T} C19 un admin borra la foto de A con el cliente nuevo${final ? ' (queda su marca)' : ''}`, r.ok && !(await docOf(yid)) && (await L.exists(`route-photo-tombstones/${yid}`)) === final, r.error && r.error.message);
    // foto antigua (formato anterior): solo lectura; ni el autor ni un spotter la borran
    const lid = `${SCH}_Vieja_${stamp}${state}`, lpath = `route-photos/${SCH}/${stamp}${state}_Vieja.jpeg`;
    await seed(`route-photos/${lid}`, { photoUrl: 'https://firebasestorage.googleapis.com/v0/b/x/o/y?alt=media&token=t', uploadedBy: A.uid, uploadedByName: 'X', uploadedAt: new Date('2025-12-01T10:00:00Z'), routeName: 'Vieja', schoolId: SCH, filename: `${stamp}${state}_Vieja.jpeg` });
    await S.upload('owner', lpath);
    await expect(`${T} C21a un visitante lee la foto antigua (archivo)`, S.read(null, lpath), true);
    await expect(`${T} C21b el autor intenta borrar el archivo de la foto antigua`, S.del(t.A, lpath), false);
    await expect(`${T} C21c el autor intenta borrar el documento de la foto antigua`, A.db.collection('route-photos').doc(lid).delete(), !final);
    // ---- fallos parciales ----
    const crashed = mkPhotoV2(A, FV, {}, SCH); await A.db.collection('route-photos').doc(crashed.id).set(crashed.data);   // «pestaña cerrada a mitad de subida»: documento sin archivo
    r = await attempt(() => eA.api.deleteRoutePhoto(crashed.id, A.uid));
    check(`${T} C25 documento sin archivo (subida interrumpida): el autor lo borra desde la app`, r.ok && !(await docOf(crashed.id)), r.error && r.error.message);
    // ---- límites temporales que sí se pueden sembrar ----
    const w1 = mkPhotoV2(A, FV, {}, SCH), w2 = mkPhotoV2(A, FV, {}, SCH);
    await seed(`route-photos/${w1.id}`, { ...w1.data, uploadedAt: new Date(Date.now() - 4 * H60) }); await seed(`route-photos/${w2.id}`, { ...w2.data, uploadedAt: new Date(Date.now() - 6 * H60) });
    await expect(`${T} C28a archivo subido con el documento de 4 min (dentro de la ventana de 5 min)${final ? '' : ' [las reglas de Storage son las mismas en ambas puertas]'}`, S.upload(t.A, w1.storagePath), true);
    await expect(`${T} C28b archivo subido con el documento de 6 min (fuera de la ventana)`, S.upload(t.A, w2.storagePath), false);
    await expect(`${T} C29 dentro de la ventana A borra su archivo y lo vuelve a subir`, (async () => { await S.del(t.A, w1.storagePath); await S.upload(t.A, w1.storagePath); })(), true);
    await expect(`${T} C29b …y fuera de la ventana ya no puede crear el archivo`, (async () => { await S.upload('owner', w2.storagePath); await S.del(t.A, w2.storagePath); await S.upload(t.A, w2.storagePath); })(), false);
  };
  await run('S');
  await run('F');
  L.finish('canary-dry-run.cjs');
  process.exit(process.exitCode || 0);
})().catch(e => { console.error('ERROR FATAL', String(e.stack || e.message).slice(0, 700), '\nÚltima prueba registrada:', L.results.length ? L.results[L.results.length - 1].label : '(ninguna)'); process.exit(2); });

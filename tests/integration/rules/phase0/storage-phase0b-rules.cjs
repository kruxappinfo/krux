// Fase 0b — reglas de Storage COMPLETAS propuestas (docs/security-phase0/storage.rules.phase0b.proposal) frente a las DESPLEGADAS
// (storage.rules.DEPLOYED-snapshot, leídas de solo lectura de producción el 2026-11-14). Todo contra el emulador local.
//  MODE=proposal : carga la propuesta; cada prueba exige la política.
//  MODE=current  : carga el snapshot de las reglas desplegadas SOLO en el emulador; los «fallos» son incumplimientos reales de hoy.
// Rutas del bucket real: gym-photos/, posts/, profile-photos/, route-photos/, sector-images/. Las firestore.* de las reglas leen admins/{uid}.
const path = require('node:path');
const L = require('./_lib.cjs');
const S = require('./_storage.cjs');
const { mkPhoto } = require('./_photos.cjs');
const { mk, mkAnon, seed, exists, expect, check, SUPER_EMAIL, MODE } = L;

(async () => {
  await L.loadFirestoreRules(MODE === 'proposal' ? 'proposal' : 'current');
  await S.loadStorageRules(path.join(L.ROOT, MODE === 'proposal' ? 'docs/security-phase0/storage.rules.phase0b.proposal' : 'docs/security-phase0/storage.rules.DEPLOYED-snapshot'));
  const stamp = Date.now();
  const A = await mk('ta' + stamp, `ta${stamp}@test.dev`), B = await mk('tb' + stamp, `tb${stamp}@test.dev`);
  const SP = await mk('tsp' + stamp, `tsp${stamp}@test.dev`), AD = await mk('tad' + stamp, `tad${stamp}@test.dev`), SA = await mk('tsa' + stamp, SUPER_EMAIL);
  await seed(`admins/${SP.uid}`, { role: 'spotter' }); await seed(`admins/${AD.uid}`, { role: 'admin' });
  const t = { A: await A.token(), B: await B.token(), SP: await SP.token(), AD: await AD.token(), SA: await SA.token() };
  const FV = A.FV;
  const sch = `s${stamp}`;
  const own = async (label, tokOwner, pathStr, extra) => { await S.upload('owner', pathStr); };   // sembrado sin pasar por reglas

  // ======= profile-photos y posts: solo el dueño escribe y borra (igual que hoy, pero sin el comodín) =======
  for (const base of ['profile-photos', 'posts']) {
    const p = `${base}/${A.uid}/f${stamp}.jpg`;
    await expect(`${base}: el dueño sube`, S.upload(t.A, p), true);
    await expect(`${base}: otro usuario sube en la carpeta del dueño`, S.upload(t.B, `${base}/${A.uid}/otro${stamp}.jpg`), false);
    await expect(`${base}: sin autenticar sube`, S.upload(null, `${base}/${A.uid}/anon${stamp}.jpg`), false);
    await expect(`${base}: lectura pública`, S.read(null, p), true);
    await expect(`${base}: otro usuario borra el archivo del dueño`, S.del(t.B, p), false);
    await expect(`${base}: otro usuario sobrescribe el archivo del dueño`, S.upload(t.B, p), false);
    await expect(`${base}: sin autenticar borra`, S.del(null, p), false);
    check(`${base}: el archivo del dueño sigue existiendo tras los intentos ajenos`, await S.present(p));
    await expect(`${base}: el dueño borra el suyo`, S.del(t.A, p), true);
  }

  // ======= sector-images: solo admin, spotter y super-admin (la app ya lo exige; hoy cualquiera podía) =======
  const secNew = (n) => `sector-images/${sch}/sector_a/img_${n}.jpg`, secOld = (n) => `sector-images/${sch}/legacy_${n}.jpg`;
  await expect('sector-images: spotter sube (ruta nueva)', S.upload(t.SP, secNew(1)), true);
  await expect('sector-images: admin sube (ruta antigua)', S.upload(t.AD, secOld(1)), true);
  await expect('sector-images: super-admin sube', S.upload(t.SA, secNew(2)), true);
  await expect('sector-images: usuario normal sube', S.upload(t.B, secNew(3)), false);
  await expect('sector-images: sin autenticar sube', S.upload(null, secNew(4)), false);
  await expect('sector-images: tipo no imagen', S.upload(t.SP, secNew(5), 'text/html'), false);
  await expect('sector-images: más de 15 MB', S.upload(t.SP, secNew(6), 'image/jpeg', 16 * 1024 * 1024), false);
  await expect('sector-images: lectura pública', S.read(null, secNew(1)), true);
  await expect('sector-images: usuario normal borra una imagen de sector', S.del(t.B, secNew(1)), false);
  await expect('sector-images: usuario normal sobrescribe una imagen de sector', S.upload(t.B, secNew(1)), false);
  await expect('sector-images: sin autenticar borra', S.del(null, secNew(1)), false);
  check('sector-images: la imagen sigue existiendo tras los intentos', await S.present(secNew(1)));
  await expect('sector-images: spotter borra (la app lo permite a admin y spotter)', S.del(t.SP, secNew(1)), true);
  await expect('sector-images: admin borra', S.del(t.AD, secOld(1)), true);

  // ======= gym-photos: dueño sube; solo admin borra; antes las cubría el comodín =======
  const gp = `gym-photos/${A.uid}/roco-1_${stamp}.jpg`;
  await expect('gym-photos: el dueño sube', S.upload(t.A, gp), true);
  await expect('gym-photos: otro usuario sube en la carpeta ajena', S.upload(t.B, `gym-photos/${A.uid}/x${stamp}.jpg`), false);
  await expect('gym-photos: sin autenticar sube', S.upload(null, `gym-photos/${A.uid}/y${stamp}.jpg`), false);
  await expect('gym-photos: lectura con sesión', S.read(t.B, gp), true);
  await expect('gym-photos: otro usuario borra', S.del(t.B, gp), false);
  await expect('gym-photos: el dueño no borra (solo un admin, como gym_info)', S.del(t.A, gp), false);
  await expect('gym-photos: el spotter no borra', S.del(t.SP, gp), false);
  await expect('gym-photos: el admin borra', S.del(t.AD, gp), true);
  await expect('gym-photos: archivo de 16 MB', S.upload(t.A, `gym-photos/${A.uid}/z${stamp}.jpg`, 'image/jpeg', 16 * 1024 * 1024), false);

  // ======= rutas sin regla: denegadas =======
  await expect('ruta no prevista (exercises/…): usuario con sesión sube', S.upload(t.A, `exercises/e${stamp}.jpg`), false);
  await S.upload('owner', `exercises/seed${stamp}.jpg`);
  await expect('ruta no prevista (exercises/…): usuario con sesión borra', S.del(t.A, `exercises/seed${stamp}.jpg`), false);
  await expect('ruta no prevista (raíz): usuario con sesión sube', S.upload(t.A, `otra${stamp}.jpg`), false);

  // ======= route-photos: documento primero, archivo después =======
  const mkDoc = async (u, over, at) => { const p = mkPhoto(u, FV, over, at); await u.db.collection('route-photos').doc(p.id).set(p.data); return p; };
  if (MODE === 'proposal') {
    let p = mkPhoto(A, FV);
    await expect('route-photos: subir el archivo SIN documento previo', S.upload(t.A, p.storagePath), false);
    p = await mkDoc(A);
    await expect('route-photos: subir el archivo con su documento recién creado', S.upload(t.A, p.storagePath), true);
    await expect('route-photos: B sube a la carpeta de A usando el documento de A', S.upload(t.B, p.storagePath), false);
    await expect('route-photos: A sobrescribe su propio archivo (reiniciar timeCreated)', S.upload(t.A, p.storagePath), false);
    check('route-photos: sin autenticar lee la foto', await S.read(null, p.storagePath).then(() => true, () => false));
    p = await mkDoc(A); await expect('route-photos: tipo no imagen', S.upload(t.A, p.storagePath, 'text/html'), false);
    p = await mkDoc(A); await expect('route-photos: más de 5 MB', S.upload(t.A, p.storagePath, 'image/jpeg', 6 * 1024 * 1024), false);
    // El documento existe pero no coincide con la ruta (defensa en profundidad: el documento sembrado se saltó las reglas de Firestore)
    p = mkPhoto(A, FV); await seed(`route-photos/${p.id}`, Object.assign({}, p.data, { uploadedAt: new Date(), storagePath: `route-photos/valeria/${A.uid}/otro.jpg` }));
    await expect('route-photos: el documento apunta a otro storagePath', S.upload(t.A, p.storagePath), false);
    p = mkPhoto(A, FV); await seed(`route-photos/${p.id}`, Object.assign({}, p.data, { uploadedAt: new Date(), uploadedBy: B.uid }));
    await expect('route-photos: el documento es de otro autor (uploadedBy)', S.upload(t.A, p.storagePath), false);
    p = mkPhoto(A, FV); await seed(`route-photos/${p.id}`, Object.assign({}, p.data, { uploadedAt: new Date(Date.now() - 16 * 60 * 1000) }));
    await expect('route-photos: documento de hace 16 min (la ventana de subida es de 15)', S.upload(t.A, p.storagePath), false);
    p = mkPhoto(A, FV); await seed(`route-photos/${p.id}`, Object.assign({}, p.data, { uploadedAt: new Date(Date.now() - 14 * 60 * 1000) }));
    await expect('route-photos: documento de hace 14 min (aún dentro de la ventana)', S.upload(t.A, p.storagePath), true);
    await expect('route-photos: ruta antigua (sin uid): A sube', S.upload(t.A, `route-photos/valeria/${stamp}_Via.jpeg`), false);
    await expect('route-photos: ruta antigua (sin uid): el admin sube', S.upload(t.AD, `route-photos/valeria/${stamp}_Via2.jpeg`), false);

    // ---- Borrado: plazo de 12 h con la regla REAL (se envejece el documento, no el archivo) ----
    p = await mkDoc(A); await S.upload(t.A, p.storagePath);
    await expect('borrado: autor borra su archivo dentro del plazo', S.del(t.A, p.storagePath), true);
    await expect('borrado: el autor borra después su documento', A.db.collection('route-photos').doc(p.id).delete(), true);
    // Documento de hace 13 h (sembrado) y archivo subido sin pasar por reglas (timeCreated = ahora)
    const at13 = Date.now() - 13 * 3600 * 1000;
    p = mkPhoto(A, FV, {}, at13); await seed(`route-photos/${p.id}`, Object.assign({}, p.data, { uploadedAt: new Date(at13) })); await S.upload('owner', p.storagePath);
    await expect('borrado: autor tras 12 h (documento de hace 13 h)', S.del(t.A, p.storagePath), false);
    await expect('borrado: spotter tras 12 h', S.del(t.SP, p.storagePath), false);
    await expect('borrado: otro usuario tras 12 h', S.del(t.B, p.storagePath), false);
    await expect('borrado: sin autenticar tras 12 h', S.del(null, p.storagePath), false);
    check('borrado: el archivo vencido sigue existiendo', await S.present(p.storagePath));
    await expect('borrado: admin tras 12 h', S.del(t.AD, p.storagePath), true);
    p = mkPhoto(A, FV, {}, at13); await seed(`route-photos/${p.id}`, Object.assign({}, p.data, { uploadedAt: new Date(at13) })); await S.upload('owner', p.storagePath);
    await expect('borrado: super-admin tras 12 h', S.del(t.SA, p.storagePath), true);
    const atN = Date.now() - (12 * 3600 - 40) * 1000;
    p = mkPhoto(A, FV, {}, atN); await seed(`route-photos/${p.id}`, Object.assign({}, p.data, { uploadedAt: new Date(atN) })); await S.upload('owner', p.storagePath);
    await expect('borrado: autor a 11 h 59 min 20 s (documento)', S.del(t.A, p.storagePath), true);
    p = await mkDoc(A); await S.upload(t.A, p.storagePath);
    await expect('borrado: spotter, archivo ajeno reciente', S.del(t.SP, p.storagePath), false);
    await expect('borrado: usuario normal, archivo ajeno reciente', S.del(t.B, p.storagePath), false);
    await expect('borrado: sin autenticar, archivo reciente', S.del(null, p.storagePath), false);
    await expect('borrado: admin, archivo reciente', S.del(t.AD, p.storagePath), true);
    // Documento ya borrado: el archivo huérfano solo cuenta timeCreated
    p = await mkDoc(A); await S.upload(t.A, p.storagePath); await A.db.collection('route-photos').doc(p.id).delete();
    await expect('huérfano (sin documento): el autor lo borra dentro del plazo de timeCreated', S.del(t.A, p.storagePath), true);
    p = await mkDoc(A); await S.upload(t.A, p.storagePath); await A.db.collection('route-photos').doc(p.id).delete();
    await expect('huérfano (sin documento): el spotter no puede borrarlo', S.del(t.SP, p.storagePath), false);
    await expect('huérfano (sin documento): otro usuario no puede borrarlo', S.del(t.B, p.storagePath), false);
    // Fotos antiguas (ruta sin uid)
    for (const f of ['legacy1', 'legacy2', 'legacy3']) await S.upload('owner', `route-photos/valeria/${stamp}_${f}.jpeg`);
    await expect('antiguas: lectura pública', S.read(null, `route-photos/valeria/${stamp}_legacy1.jpeg`), true);
    await expect('antiguas: usuario normal no borra', S.del(t.A, `route-photos/valeria/${stamp}_legacy1.jpeg`), false);
    await expect('antiguas: spotter no borra', S.del(t.SP, `route-photos/valeria/${stamp}_legacy1.jpeg`), false);
    await expect('antiguas: sin autenticar no borra', S.del(null, `route-photos/valeria/${stamp}_legacy1.jpeg`), false);
    await expect('antiguas: admin borra', S.del(t.AD, `route-photos/valeria/${stamp}_legacy2.jpeg`), true);
    await expect('antiguas: super-admin borra', S.del(t.SA, `route-photos/valeria/${stamp}_legacy3.jpeg`), true);

    // ---- Ventana de timeCreated: misma regla escalada a 4 s (el emulador no permite envejecer un archivo) ----
    const fs = require('node:fs');
    const full = fs.readFileSync(path.join(L.ROOT, 'docs/security-phase0/storage.rules.phase0b.proposal'), 'utf8');
    const count = full.split("duration.value(12, 'h')").length - 1;
    check('escalado: la regla contiene exactamente 2 ocurrencias de la ventana de 12 h (timeCreated y documento)', count === 2, `ocurrencias: ${count}`);
    await S.setRules(full.split("duration.value(12, 'h')").join("duration.value(4, 's')"));
    p = await mkDoc(A); await S.upload(t.A, p.storagePath); await A.db.collection('route-photos').doc(p.id).delete();
    const orphan = p.storagePath;
    p = await mkDoc(A); await S.upload(t.A, p.storagePath);
    await expect('[4 s] autor borra el archivo dentro de la ventana', S.del(t.A, p.storagePath), true);
    p = await mkDoc(A); await S.upload(t.A, p.storagePath);
    await S.sleep(5500);
    await expect('[4 s] autor borra tras vencer la ventana (documento y archivo)', S.del(t.A, p.storagePath), false);
    await expect('[4 s] huérfano sin documento: el autor tras vencer timeCreated', S.del(t.A, orphan), false);
    await expect('[4 s] huérfano sin documento: el admin sí', S.del(t.AD, orphan), true);
    await expect('[4 s] spotter tras vencer', S.del(t.SP, p.storagePath), false);
    await expect('[4 s] admin tras vencer', S.del(t.AD, p.storagePath), true);
  }

  L.finish('storage-phase0b-rules.cjs');
  process.exit(process.exitCode || 0);
})().catch(e => { console.error('ERROR FATAL', String(e.message).slice(0, 300), '\nÚltima prueba registrada:', L.results.length ? L.results[L.results.length - 1].label : '(ninguna)'); process.exit(2); });

// Fase 0c (revisión final) — reglas de Storage COMPLETAS (storage.rules) + Firestore 0c (firestore.rules.phase0c.proposal), solo en el emulador local.
// NO se toca producción. Objetivo: (1) matriz de acceso de CADA carpeta real del bucket, (2) denegación de todo lo no previsto,
// (3) plazo de 12 h fijado por el SERVIDOR (uploadedAt del documento y timeCreated del archivo; ningún instante del cliente) en Firestore y en Storage,
// (4) imposibilidad de ampliarlo borrando y volviendo a subir (archivo) o borrando y recreando (documento, con marcas), (5) fotos antiguas,
// (6) fallos parciales, reintentos y concurrencia.
// Plazo de 12 h: el emulador no deja envejecer un archivo, pero sí un documento sembrado: se prueban los límites REALES (11 h 59 min / 12 h 01 min)
// con el uploadedAt sembrado, y además una ventana escalada a 8 s con espera real que ejercita TAMBIÉN timeCreated.
const path = require('node:path');
const ROOT = path.resolve(__dirname, '../../../..');
process.env.RULES_FILE = process.env.RULES_FILE || path.join(ROOT, 'docs/security-phase0/firestore.rules.phase0c.proposal');
process.env.MODE = 'proposal';
const fs = require('node:fs');
const L = require('./_lib.cjs');
const S = require('./_storage.cjs');
const { mkPhotoV2, delPhotoBatch } = require('./_photos.cjs');
const { mk, seed, expect, check, SUPER_EMAIL } = L;
const STORAGE_FILE = process.env.STORAGE_RULES_FILE || path.join(ROOT, 'storage.rules');   // las variables permiten comprobar con reglas mutadas que las pruebas fallan
const FS_FILE = process.env.RULES_FILE;
const H = 3600 * 1000;

(async () => {
  await L.loadFirestoreRules('proposal');
  await S.loadStorageRules(STORAGE_FILE);
  const stamp = Date.now();
  const A = await mk('ca' + stamp, `ca${stamp}@test.dev`), B = await mk('cb' + stamp, `cb${stamp}@test.dev`);
  const SP = await mk('csp' + stamp, `csp${stamp}@test.dev`), AD = await mk('cad' + stamp, `cad${stamp}@test.dev`), SA = await mk('csa' + stamp, SUPER_EMAIL);
  await seed(`admins/${SP.uid}`, { role: 'spotter' }); await seed(`admins/${AD.uid}`, { role: 'admin' });
  const t = { A: await A.token(), B: await B.token(), SP: await SP.token(), AD: await AD.token(), SA: await SA.token() };
  const FV = A.FV;
  const sch = `s${stamp}`;

  check('el archivo de reglas de Storage 0c NO contiene el comodín global', !/match\s+\/\{allPaths=\*\*\}/.test(fs.readFileSync(STORAGE_FILE, 'utf8').replace(/\/\/.*$/gm, '')));
  check('las reglas de Storage 0c declaran exactamente las 5 carpetas reales', ['profile-photos', 'posts', 'sector-images', 'route-photos', 'gym-photos']
    .every(f => new RegExp('match /' + f + '/').test(fs.readFileSync(STORAGE_FILE, 'utf8'))) && (fs.readFileSync(STORAGE_FILE, 'utf8').replace(/\/\/.*$/gm, '').match(/match \/[a-z-]+\//g) || []).length === 7,
    'match /b/ + profile-photos, posts, sector-images, route-photos (2 patrones), gym-photos');

  check('docs/security-phase0/storage.rules.phase0c.proposal es idéntico a storage.rules (una sola versión)', fs.readFileSync(path.join(ROOT, 'storage.rules'), 'utf8') === fs.readFileSync(path.join(ROOT, 'docs/security-phase0/storage.rules.phase0c.proposal'), 'utf8'));

  // ===== 1. profile-photos y posts (dueño) =====
  for (const base of ['profile-photos', 'posts']) {
    const p = `${base}/${A.uid}/f${stamp}.jpg`;
    await expect(`${base}: el dueño sube`, S.upload(t.A, p), true);
    await expect(`${base}: otro usuario sube en la carpeta del dueño`, S.upload(t.B, `${base}/${A.uid}/otro${stamp}.jpg`), false);
    await expect(`${base}: sin autenticar sube`, S.upload(null, `${base}/${A.uid}/anon${stamp}.jpg`), false);
    await expect(`${base}: lectura pública`, S.read(null, p), true);
    await expect(`${base}: otro usuario borra el archivo del dueño`, S.del(t.B, p), false);
    await expect(`${base}: el spotter borra el archivo del dueño`, S.del(t.SP, p), false);
    await expect(`${base}: el admin borra el archivo del dueño (sin privilegio especial, igual que hoy)`, S.del(t.AD, p), false);
    await expect(`${base}: otro usuario sobrescribe`, S.upload(t.B, p), false);
    check(`${base}: el archivo sigue existiendo tras los intentos ajenos`, await S.present(p));
    await expect(`${base}: el dueño borra el suyo`, S.del(t.A, p), true);
  }
  await expect('posts: el dueño sube un vídeo (video/mp4), como hace la app', S.upload(t.A, `posts/${A.uid}/v${stamp}.mp4`, 'video/mp4', 2 * 1024 * 1024), true);
  await expect('posts: el dueño sube una portada con nombre largo y espacios codificados', S.upload(t.A, `posts/${A.uid}/${stamp}_portada_mi foto (1).jpg`), true);
  await expect('profile-photos: el dueño sube con el nombre que usa la app ({Date.now()}_{name})', S.upload(t.A, `profile-photos/${A.uid}/${stamp}_avatar.jpg`), true);
  await expect('profile-banners (ruta sin uso, retirada): el dueño sube', S.upload(t.A, `profile-banners/${A.uid}/b${stamp}.jpg`), false);

  // ===== 2. sector-images =====
  const secNew = (n) => `sector-images/${sch}/sector_a/img_${n}.jpg`, secOld = (n) => `sector-images/${sch}/legacy_${n}.jpg`;
  await expect('sector-images: spotter sube (ruta nueva, como hace la app)', S.upload(t.SP, secNew(1)), true);
  await expect('sector-images: admin sube (ruta antigua)', S.upload(t.AD, secOld(1)), true);
  await expect('sector-images: super-admin sube', S.upload(t.SA, secNew(2)), true);
  await expect('sector-images: usuario normal sube', S.upload(t.B, secNew(3)), false);
  await expect('sector-images: sin autenticar sube', S.upload(null, secNew(4)), false);
  await expect('sector-images: tipo no imagen', S.upload(t.SP, secNew(5), 'text/html'), false);
  await expect('sector-images: más de 15 MB', S.upload(t.SP, secNew(6), 'image/jpeg', 16 * 1024 * 1024), false);
  await expect('sector-images: lectura pública', S.read(null, secNew(1)), true);
  await expect('sector-images: usuario normal borra', S.del(t.B, secNew(1)), false);
  await expect('sector-images: usuario normal sobrescribe', S.upload(t.B, secNew(1)), false);
  await expect('sector-images: sin autenticar borra', S.del(null, secNew(1)), false);
  check('sector-images: la imagen sigue existiendo tras los intentos', await S.present(secNew(1)));
  await expect('sector-images: spotter borra', S.del(t.SP, secNew(1)), true);
  await expect('sector-images: admin borra', S.del(t.AD, secOld(1)), true);

  // ===== 3. gym-photos =====
  const gp = `gym-photos/${A.uid}/roco-1_${stamp}.jpg`;
  await expect('gym-photos: el dueño sube (nombre {gymId}_{ms}.jpg)', S.upload(t.A, gp), true);
  await expect('gym-photos: otro usuario sube en la carpeta ajena', S.upload(t.B, `gym-photos/${A.uid}/x${stamp}.jpg`), false);
  await expect('gym-photos: sin autenticar sube', S.upload(null, `gym-photos/${A.uid}/y${stamp}.jpg`), false);
  await expect('gym-photos: lectura con sesión', S.read(t.B, gp), true);
  await expect('gym-photos: lectura sin sesión', S.read(null, gp), false);
  await expect('gym-photos: el dueño sobrescribe', S.upload(t.A, gp), false);
  await expect('gym-photos: otro usuario borra', S.del(t.B, gp), false);
  await expect('gym-photos: el dueño no borra (solo admin, como gym_info)', S.del(t.A, gp), false);
  await expect('gym-photos: el spotter no borra', S.del(t.SP, gp), false);
  await expect('gym-photos: tipo no imagen', S.upload(t.A, `gym-photos/${A.uid}/h${stamp}.html`, 'text/html'), false);
  await expect('gym-photos: 16 MB', S.upload(t.A, `gym-photos/${A.uid}/z${stamp}.jpg`, 'image/jpeg', 16 * 1024 * 1024), false);
  await expect('gym-photos: el admin borra', S.del(t.AD, gp), true);
  await expect('gym-photos: tipo image/jpg (no estándar) con el nombre de la app', S.upload(t.A, `gym-photos/${A.uid}/roco-2_${stamp}.jpg`, 'image/jpg'), true);
  await expect('gym-photos: justo por debajo de 15 MB', S.upload(t.A, `gym-photos/${A.uid}/roco-3_${stamp}.jpg`, 'image/jpeg', 15 * 1024 * 1024 - 1024), true);
  // Formatos y límites que NO se restringen a propósito (compatibilidad con las apps antiguas, que suben el original sin reducir)
  await expect('profile-photos: 12 MB (sin límite, igual que hoy)', S.upload(t.A, `profile-photos/${A.uid}/${stamp}_grande.jpg`, 'image/jpeg', 12 * 1024 * 1024), true);
  await expect('profile-photos: HEIC (sin restricción de tipo, igual que hoy)', S.upload(t.A, `profile-photos/${A.uid}/${stamp}_foto.heic`, 'image/heic'), true);
  await expect('sector-images: image/jpg (no estándar)', S.upload(t.SP, `sector-images/${sch}/sector_a/img_jpg_${stamp}.jpg`, 'image/jpg'), true);
  await expect('sector-images: justo por debajo de 15 MB', S.upload(t.SP, `sector-images/${sch}/sector_a/img_14_${stamp}.jpg`, 'image/jpeg', 15 * 1024 * 1024 - 1024), true);

  // ===== 4. Todo lo no previsto: denegado =====
  for (const p of [`exercises/e${stamp}.jpg`, `train/t${stamp}.jpg`, `otra${stamp}.jpg`, `users/${A.uid}/x${stamp}.jpg`, `chat/${A.uid}/c${stamp}.jpg`]) {
    await expect(`ruta no prevista ${p.split('/')[0]}/…: usuario con sesión sube`, S.upload(t.A, p), false);
    await S.upload('owner', p);
    await expect(`ruta no prevista ${p.split('/')[0]}/…: usuario con sesión borra`, S.del(t.A, p), false);
    await expect(`ruta no prevista ${p.split('/')[0]}/…: usuario con sesión lee`, S.read(t.A, p), false);
    await expect(`ruta no prevista ${p.split('/')[0]}/…: super-admin borra`, S.del(t.SA, p), false);
  }

  // ===== 5. route-photos: subida (el documento va primero) =====
  const mkDoc2 = async (u, over, school, route, ext) => { const x = mkPhotoV2(u, FV, over, school, route, ext); await u.db.collection('route-photos').doc(x.id).set(x.data); return x; };
  const seedAged = async (x, ageMs) => seed(`route-photos/${x.id}`, Object.assign({}, x.data, { uploadedAt: new Date(Date.now() - ageMs) }));
  let p = mkPhotoV2(A, FV);
  await expect('route-photos: subir el archivo SIN documento previo', S.upload(t.A, p.storagePath), false);
  p = await mkDoc2(A);
  await expect('route-photos: subir el archivo con su documento recién creado', S.upload(t.A, p.storagePath), true);
  await expect('route-photos: B sube a la carpeta de A usando el documento de A', S.upload(t.B, p.storagePath), false);
  await expect('route-photos: A sobrescribe su propio archivo (sustitución)', S.upload(t.A, p.storagePath), false);
  await expect('route-photos: el admin sobrescribe el archivo', S.upload(t.AD, p.storagePath), false);
  await expect('route-photos: el autor modifica los metadatos del archivo', S.patchMeta(t.A, p.storagePath, { cacheControl: 'no-cache' }), false);
  await expect('route-photos: el admin modifica los metadatos del archivo', S.patchMeta(t.AD, p.storagePath, { cacheControl: 'no-cache' }), false);
  await expect('route-photos: lectura pública del archivo (sin sesión)', S.read(null, p.storagePath), true);
  await expect('route-photos: lectura del archivo con sesión', S.read(t.B, p.storagePath), true);
  await expect('route-photos: lectura pública del documento', L.mkAnon(`rd${stamp}`).then(an => an.db.collection('route-photos').doc(p.id).get()), true);
  await expect('route-photos: A modifica su propio documento (update)', A.db.collection('route-photos').doc(p.id).update({ routeName: 'otra' }), false);
  await expect('route-photos: el admin modifica el documento (update)', AD.db.collection('route-photos').doc(p.id).update({ routeName: 'otra' }), false);
  await expect('route-photos: sin autenticar sube', S.upload(null, mkPhotoV2(A, FV).storagePath), false);
  p = await mkDoc2(A); await expect('route-photos: tipo no imagen', S.upload(t.A, p.storagePath, 'text/html'), false);
  p = await mkDoc2(A); await expect('route-photos: más de 5 MB', S.upload(t.A, p.storagePath, 'image/jpeg', 6 * 1024 * 1024), false);
  p = await mkDoc2(A); await expect('route-photos: justo por debajo de 5 MB', S.upload(t.A, p.storagePath, 'image/jpeg', 5 * 1024 * 1024 - 1024), true);
  p = await mkDoc2(A, {}, 'valeria', 12, 'png'); await expect('route-photos: extensión .png con tipo image/jpeg', S.upload(t.A, p.storagePath, 'image/jpeg'), false);
  p = await mkDoc2(A, {}, 'valeria', 12, 'png'); await expect('route-photos: .png con image/png', S.upload(t.A, p.storagePath, 'image/png'), true);
  p = await mkDoc2(A, {}, 'valeria', 12, 'webp'); await expect('route-photos: .webp con image/webp', S.upload(t.A, p.storagePath, 'image/webp'), true);
  p = await mkDoc2(A); await expect('route-photos: .jpg con image/jpg (no estándar, lo que declaran algunos navegadores)', S.upload(t.A, p.storagePath, 'image/jpg'), true);
  p = mkPhotoV2(A, FV, {}, 'valeria', 12, 'jpeg'); await seedAged(p, 1000);
  await expect('route-photos: archivo .jpeg (el cliente nuevo siempre usa .jpg)', S.upload(t.A, p.storagePath), false);
  p = await mkDoc2(SP); await expect('route-photos: el spotter sube como cualquier usuario (sin privilegios)', S.upload(t.SP, p.storagePath), true);
  p = mkPhotoV2(A, FV); await seed(`route-photos/${p.id}`, Object.assign({}, p.data, { uploadedAt: new Date(), storagePath: `route-photos/valeria/${A.uid}/otro.jpg` }));
  await expect('route-photos: el documento apunta a otro storagePath', S.upload(t.A, p.storagePath), false);
  p = mkPhotoV2(A, FV); await seed(`route-photos/${p.id}`, Object.assign({}, p.data, { uploadedAt: new Date(), uploadedBy: B.uid }));
  await expect('route-photos: el documento es de otro autor', S.upload(t.A, p.storagePath), false);
  p = mkPhotoV2(A, FV); await seedAged(p, 11 * 60 * 1000);
  await expect('route-photos: documento de hace 11 min (muy fuera de la ventana de subida de 5 min)', S.upload(t.A, p.storagePath), false);
  p = mkPhotoV2(A, FV); await seedAged(p, 5 * 60 * 1000 + 5000);
  await expect('route-photos: documento de hace 5 min 5 s (justo fuera de la ventana)', S.upload(t.A, p.storagePath), false);
  p = mkPhotoV2(A, FV); await seedAged(p, 3 * 60 * 1000);
  await expect('route-photos: documento de hace 3 min (dentro de la ventana; con la ventana anterior de 2 min se rechazaba)', S.upload(t.A, p.storagePath), true);
  p = mkPhotoV2(A, FV); await seedAged(p, 4 * 60 * 1000 + 30 * 1000);
  await expect('route-photos: documento de hace 4 min 30 s (dentro de la ventana)', S.upload(t.A, p.storagePath), true);
  // La ventana NO mueve el plazo de borrado: archivo subido al final de la ventana, plazo medido desde el documento (11 h 59 min 30 s de documento)
  p = mkPhotoV2(A, FV); await seedAged(p, 12 * H - 4 * 60 * 1000);
  await expect('route-photos: documento de hace 11 h 56 min: ya no se admite el archivo (ventana de 5 min)', S.upload(t.A, p.storagePath), false);
  await expect('route-photos: ruta antigua (sin uid): A sube', S.upload(t.A, `route-photos/valeria/${stamp}_Via.jpeg`), false);
  await expect('route-photos: ruta antigua (sin uid): el admin sube', S.upload(t.AD, `route-photos/valeria/${stamp}_Via2.jpeg`), false);
  await expect('route-photos: nombre de archivo corto y sin documento', S.upload(t.A, `route-photos/${sch}/${A.uid}/foto.jpg`), false);
  p = await mkDoc2(A); await expect('route-photos: carpeta más profunda (4 niveles)', S.upload(t.A, `route-photos/valeria/${A.uid}/extra/${p.filename}`), false);

  // ===== 5b. route-photos: validación del DOCUMENTO de Firestore =====
  const docOk = async (label, mut, expected) => { const x = mkPhotoV2(A, FV); const data = mut(Object.assign({}, x.data), x); await expect(`documento: ${label}`, A.db.collection('route-photos').doc(x.id).set(data), expected); };
  await docOk('válido', d => d, true);
  await docOk('campo extra no permitido', d => ({ ...d, extra: 1 }), false);
  await docOk('uploadedBy de otro usuario', d => ({ ...d, uploadedBy: B.uid }), false);
  await docOk('uploadedAt con la hora del cliente (no del servidor)', d => ({ ...d, uploadedAt: new Date(Date.now() - 5000) }), false); // NO `new Date()`: si el reloj del cliente coincide en el mismo milisegundo con request.time (emulador local), la regla `== request.time` lo ACEPTA y la prueba fallaba de forma intermitente
  await docOk('uploadedAt en el pasado (intento de acortar o falsear el origen)', d => ({ ...d, uploadedAt: new Date(Date.now() - H) }), false);
  await docOk('routeId como texto', d => ({ ...d, routeId: '12' }), false);
  await docOk('storagePath en la carpeta de otro usuario', (d) => ({ ...d, storagePath: d.storagePath.replace(A.uid, B.uid) }), false);
  await docOk('photoUrl de un host externo', d => ({ ...d, photoUrl: 'https://evil.example/x.jpg' }), false);
  await docOk('photoUrl de OTRO archivo del bucket', d => ({ ...d, photoUrl: d.photoUrl.replace('valeria', 'otra') }), false);
  await docOk('photoUrl con token (también válida)', d => ({ ...d, photoUrl: d.photoUrl + '&token=abc-123' }), true);
  await docOk('filename .jpeg', d => ({ ...d, filename: d.filename.replace('.jpg', '.jpeg'), storagePath: d.storagePath.replace('.jpg', '.jpeg') }), false);
  await docOk('falta storagePath (formato de las apps antiguas)', ({ storagePath, ...d }) => d, false);
  await expect('documento: id con instante en lugar de 16 caracteres aleatorios (formato antiguo)', (async () => { const x = mkPhotoV2(A, FV); const id = `valeria_12_${Date.now()}`; await A.db.collection('route-photos').doc(id).set({ ...x.data, filename: `${id}.jpg`, storagePath: `route-photos/valeria/${A.uid}/${id}.jpg` }); })(), false);
  await expect('documento: id que no coincide con schoolId_routeId', (async () => { const x = mkPhotoV2(A, FV); await A.db.collection('route-photos').doc(x.id).set({ ...x.data, routeId: 99 }); })(), false);
  await expect('documento: sin autenticar', L.mkAnon(`dn${stamp}`).then(an => { const x = mkPhotoV2(A, FV); return an.db.collection('route-photos').doc(x.id).set(x.data); }), false);

  // ===== 6. Plazo de 12 h: lo fija el SERVIDOR (uploadedAt del documento), con los límites REALES =====
  // El documento se siembra con un uploadedAt de hace N horas (el emulador no deja envejecer); el archivo se crea «ahora» (timeCreated reciente):
  // si el borrado dependiera del archivo, el autor podría borrar siempre. Que no pueda tras 12 h demuestra que manda el documento.
  const aged = async (u, ageMs, { doc = true, file = true } = {}) => {
    const x = mkPhotoV2(u, FV);
    if (doc) await seed(`route-photos/${x.id}`, Object.assign({}, x.data, { uploadedAt: new Date(Date.now() - ageMs) }));
    if (file) await S.upload('owner', x.storagePath);
    return x;
  };
  const delDoc = (u, x) => delPhotoBatch(u, x.id);
  const both = async (label, who, tok, x, expected) => {
    await expect(`${label} · Storage`, S.del(tok, x.storagePath), expected);
    await expect(`${label} · Firestore`, delDoc(who, x), expected);
  };
  let q = await aged(A, 11 * H + 59 * 60 * 1000);   // 11 h 59 min
  await both('autor a 11 h 59 min', A, t.A, q, true);
  q = await aged(A, 12 * H + 1 * 60 * 1000);        // 12 h 01 min
  await both('autor a 12 h 01 min', A, t.A, q, false);
  check('el archivo y el documento vencidos siguen existiendo tras el intento del autor', await S.present(q.storagePath) && await L.exists(`route-photos/${q.id}`));
  await both('spotter ajeno tras 12 h', SP, t.SP, q, false);
  await both('otro usuario tras 12 h', B, t.B, q, false);
  await expect('sin autenticar tras 12 h · Storage', S.del(null, q.storagePath), false);
  await expect('admin tras 12 h · Storage', S.del(t.AD, q.storagePath), true);
  await expect('admin tras 12 h · Firestore', delDoc(AD, q), true);
  q = await aged(A, 40 * H);
  await expect('super-admin con 40 h · Storage', S.del(t.SA, q.storagePath), true);
  await expect('super-admin con 40 h · Firestore', delDoc(SA, q), true);
  q = await aged(SP, 13 * H);
  await both('spotter AUTOR de su foto tras 12 h (sin privilegios por rol)', SP, t.SP, q, false);
  q = await aged(SP, 1 * H);
  await both('spotter AUTOR de su foto dentro de 12 h (como cualquier autor)', SP, t.SP, q, true);
  q = await aged(A, 2 * H);
  await expect('spotter borra la foto ajena reciente · Storage', S.del(t.SP, q.storagePath), false);
  await expect('spotter borra la foto ajena reciente · Firestore', delDoc(SP, q), false);
  await expect('admin borra la foto ajena reciente · Storage', S.del(t.AD, q.storagePath), true);
  await expect('admin borra la foto ajena reciente · Firestore', delDoc(AD, q), true);
  q = await aged(A, 1 * H);
  await expect('usuario ajeno borra una foto reciente · Storage', S.del(t.B, q.storagePath), false);
  await expect('usuario ajeno borra una foto reciente · Firestore', delDoc(B, q), false);
  await expect('sin autenticar borra una foto reciente · Storage', S.del(null, q.storagePath), false);
  check('la foto reciente ajena sigue existiendo (archivo, documento y SIN marca)', await S.present(q.storagePath) && await L.exists(`route-photos/${q.id}`) && !(await L.exists(`route-photo-tombstones/${q.id}`)));

  // ===== 7. NO se puede ampliar el plazo borrando y volviendo a subir =====
  q = await aged(A, 1 * H);
  await expect('ampliar: el autor borra el archivo a 1 h', S.del(t.A, q.storagePath), true);
  await expect('ampliar: y lo sube otra vez (el documento tiene 1 h; la subida solo se admite 10 min)', S.upload(t.A, q.storagePath), false);
  q = await aged(A, 1 * H);
  await expect('ampliar: el autor borra documento y marca a 1 h', delDoc(A, q), true);
  await expect('ampliar: recrear el MISMO id (con el mismo archivo) tras borrarlo', A.db.collection('route-photos').doc(q.id).set({ ...q.data }), false);
  q = mkPhotoV2(A, FV); await A.db.collection('route-photos').doc(q.id).set(q.data); await delDoc(A, q);
  await expect('ampliar: recrear un id recién creado y borrado (segundos después)', A.db.collection('route-photos').doc(q.id).set(q.data), false);
  await expect('ampliar: B recrea el id de A', B.db.collection('route-photos').doc(q.id).set({ ...q.data, uploadedBy: B.uid }), false);
  q = await aged(A, 13 * H);
  await expect('ampliar: el admin borra una foto vencida con su marca', delDoc(AD, q), true);
  await expect('ampliar: el autor recrea el id que borró el admin (renovar su plazo)', A.db.collection('route-photos').doc(q.id).set({ ...q.data }), false);

  // ===== 7b. Marcas (route-photo-tombstones) =====
  q = await aged(A, 1 * H, { file: false });
  await expect('marca: borrar el documento SIN marca', A.db.collection('route-photos').doc(q.id).delete(), false);
  await expect('marca: crear una marca suelta (el documento no se borra en el mismo lote)', A.db.collection('route-photo-tombstones').doc(q.id).set({ deletedBy: A.uid, deletedAt: FV.serverTimestamp() }), false);
  await expect('marca: crear una marca para un documento inexistente', A.db.collection('route-photo-tombstones').doc(`valeria_12_${'z'.repeat(16)}`).set({ deletedBy: A.uid, deletedAt: FV.serverTimestamp() }), false);
  await expect('marca: lote con la marca de OTRO usuario (deletedBy ajeno)', delPhotoBatch(A, q.id, { deletedBy: B.uid }), false);
  await expect('marca: lote con deletedAt del cliente', delPhotoBatch(A, q.id, { deletedAt: new Date(Date.now() - 5000) }), false); // NO `new Date()`: si el reloj del cliente coincide en el mismo milisegundo con request.time (emulador local), la regla `== request.time` lo ACEPTA y la prueba fallaba de forma intermitente
  await expect('marca: lote con un campo extra', delPhotoBatch(A, q.id, { motivo: 'x' }), false);
  await expect('marca: B intenta borrar el documento de A con su propia marca', delPhotoBatch(B, q.id), false);
  check('marca: tras los intentos fallidos el documento sigue y NO hay marca (lote atómico)', await L.exists(`route-photos/${q.id}`) && !(await L.exists(`route-photo-tombstones/${q.id}`)));
  await expect('marca: el autor borra su documento con marca válida', delPhotoBatch(A, q.id), true);
  const tombRead = (u) => u.db.collection('route-photo-tombstones').doc(q.id).get();
  await expect('marca: lectura por el admin', tombRead(AD), true);
  await expect('marca: lectura por el super-admin', tombRead(SA), true);
  await expect('marca: lectura por el autor', tombRead(A), false);
  await expect('marca: lectura sin sesión', L.mkAnon(`tr${stamp}`).then(an => an.db.collection('route-photo-tombstones').doc(q.id).get()), false);
  await expect('marca: el autor la modifica', A.db.collection('route-photo-tombstones').doc(q.id).update({ deletedBy: B.uid }), false);
  await expect('marca: el autor la borra', A.db.collection('route-photo-tombstones').doc(q.id).delete(), false);
  await expect('marca: el admin la borra', AD.db.collection('route-photo-tombstones').doc(q.id).delete(), false);
  await expect('marca: el super-admin la retira (corrección de errores)', SA.db.collection('route-photo-tombstones').doc(q.id).delete(), true);
  await expect('marca: tras retirarla el id puede volver a crearse (solo por decisión del super-admin)', A.db.collection('route-photos').doc(q.id).set({ ...q.data }), true);

  // ===== 8. Fallos parciales (reglas) =====
  q = await aged(A, 1 * H);
  await expect('parcial: se borró el archivo y falló el documento → el autor reintenta el documento', (async () => { await S.del(t.A, q.storagePath); await delDoc(A, q); })(), true);
  q = await aged(A, 1 * H, { file: false });
  await expect('parcial: documento sin archivo (subida fallida) → el autor lo borra dentro del plazo', delDoc(A, q), true);
  q = await aged(A, 13 * H, { file: false });
  await expect('parcial: documento sin archivo pasadas 12 h → el autor ya no puede', delDoc(A, q), false);
  await expect('parcial: documento sin archivo pasadas 12 h → el admin lo limpia', delDoc(AD, q), true);
  q = await aged(A, 1 * H, { doc: false });
  await expect('parcial: archivo SIN documento (documento borrado antes) → el autor ya NO puede borrarlo, aunque sea reciente (solo administración)', S.del(t.A, q.storagePath), false);
  await expect('parcial: archivo SIN documento → el super-admin lo borra', S.del(t.SA, q.storagePath), true);
  q = await aged(A, 13 * H, { doc: false });
  await expect('parcial: archivo SIN documento → el autor tampoco pasadas 12 h', S.del(t.A, q.storagePath), false);
  await expect('parcial: archivo SIN documento → el spotter no puede', S.del(t.SP, q.storagePath), false);
  await expect('parcial: archivo SIN documento → el admin lo borra', S.del(t.AD, q.storagePath), true);
  q = await aged(A, 1 * H, { doc: false });
  await expect('parcial: no se puede subir otra vez un archivo cuyo documento no existe', S.upload(t.A, q.storagePath.replace('.jpg', 'x.jpg')), false);

  // ===== 9. Fotos antiguas (formato anterior a la Fase 0c) =====
  const legacyDoc = `valeria_Via_${stamp}`;   // único por ejecución: las marcas son permanentes
  await seed(`route-photos/${legacyDoc}`, { photoUrl: 'https://firebasestorage.googleapis.com/v0/b/x/o/y?alt=media&token=t', uploadedBy: A.uid, uploadedAt: new Date('2025-12-01T10:00:00Z'), routeName: 'Via', schoolId: 'valeria', filename: '1764000000000_Via.jpeg' });
  await S.upload('owner', `route-photos/valeria/${stamp}_legacy1.jpeg`);
  await S.upload('owner', `route-photos/valeria/${stamp}_legacy2.jpeg`);
  await expect('antiguas: lectura pública del documento', L.mkAnon(`an${stamp}`).then(an => an.db.collection('route-photos').doc(legacyDoc).get()), true);
  await expect('antiguas: consulta pública por escuela y nombre de vía (como getRoutePhotos)', L.mkAnon(`aq${stamp}`).then(an => an.db.collection('route-photos').where('schoolId', '==', 'valeria').where('routeName', '==', 'Via').get()), true);
  await expect('antiguas: lectura pública del archivo', S.read(null, `route-photos/valeria/${stamp}_legacy1.jpeg`), true);
  await expect('antiguas: el autor NO puede borrar su documento (uploadedAt de hace meses)', delPhotoBatch(A, legacyDoc), false);
  await expect('antiguas: otro usuario no puede borrar el documento', delPhotoBatch(B, legacyDoc), false);
  await expect('antiguas: el spotter no puede borrar el documento', delPhotoBatch(SP, legacyDoc), false);
  await expect('antiguas: el autor no puede borrar el archivo', S.del(t.A, `route-photos/valeria/${stamp}_legacy1.jpeg`), false);
  await expect('antiguas: el spotter no puede borrar el archivo', S.del(t.SP, `route-photos/valeria/${stamp}_legacy1.jpeg`), false);
  await expect('antiguas: sin autenticar no puede borrar el archivo', S.del(null, `route-photos/valeria/${stamp}_legacy1.jpeg`), false);
  await expect('antiguas: el admin borra el archivo', S.del(t.AD, `route-photos/valeria/${stamp}_legacy1.jpeg`), true);
  await expect('antiguas: el super-admin borra el archivo', S.del(t.SA, `route-photos/valeria/${stamp}_legacy2.jpeg`), true);
  await expect('antiguas: el admin borra el documento (con marca)', delPhotoBatch(AD, legacyDoc), true);
  // Lo que ya NO pueden hacer las apps con el código antiguo (incompatibilidad documentada)
  await expect('app antigua: crear el documento con el formato anterior (id {escuela}_{vía}_{ms}, sin storagePath)', A.db.collection('route-photos').doc(`valeria_12_${Date.now()}`).set({
    photoUrl: 'https://firebasestorage.googleapis.com/v0/b/climbmaps-80cae.firebasestorage.app/o/route-photos%2Fvaleria%2F1_V.jpeg?alt=media&token=t', uploadedBy: A.uid, uploadedByName: 'A',
    uploadedAt: FV.serverTimestamp(), routeId: 12, routeName: 'V', schoolId: 'valeria', filename: '1_V.jpeg' }), false);
  await expect('app antigua: subir el archivo a route-photos/{escuela}/{archivo}', S.upload(t.A, `route-photos/valeria/${Date.now()}_V.jpeg`), false);

  // ===== 10. Reintentos y concurrencia =====
  const par = await Promise.allSettled([1, 2, 3, 4, 5, 6].map(async () => { const x = await mkDoc2(A); await S.upload(t.A, x.storagePath); return x; }));
  check('concurrencia: 6 subidas simultáneas (documento + archivo) del mismo usuario, todas correctas', par.every(r => r.status === 'fulfilled'), par.filter(r => r.status !== 'fulfilled').map(r => String(r.reason && r.reason.message).slice(0, 60)).join(' | '));
  q = mkPhotoV2(A, FV);
  const dup = await Promise.allSettled([A.db.collection('route-photos').doc(q.id).set(q.data), A.db.collection('route-photos').doc(q.id).set(q.data)]);
  check('concurrencia: crear a la vez el MISMO id dos veces: solo una se acepta', dup.filter(r => r.status === 'fulfilled').length === 1, `aceptadas: ${dup.filter(r => r.status === 'fulfilled').length}`);
  const dupFile = await Promise.allSettled([S.upload(t.A, q.storagePath), S.upload(t.A, q.storagePath)]);
  check('concurrencia: subir a la vez el MISMO archivo dos veces: queda el archivo y como mínimo una subida se acepta', dupFile.some(r => r.status === 'fulfilled') && await S.present(q.storagePath),
    `aceptadas: ${dupFile.filter(r => r.status === 'fulfilled').length} (si fueran 2, el plazo sigue acotado por el documento: ver sección 11)`);
  q = await aged(A, 1 * H);
  const dd = await Promise.allSettled([delDoc(A, q), delDoc(AD, q)]);
  check('concurrencia: dos borrados simultáneos del mismo documento (autor y admin): solo uno se acepta y queda una marca', dd.filter(r => r.status === 'fulfilled').length === 1 && await L.exists(`route-photo-tombstones/${q.id}`), `aceptados: ${dd.filter(r => r.status === 'fulfilled').length}`);
  q = await aged(A, 1 * H);
  const dd2 = await Promise.allSettled([S.del(t.A, q.storagePath), S.del(t.AD, q.storagePath)]);
  check('concurrencia: dos borrados simultáneos del archivo: el archivo desaparece y no hay error inesperado', !(await S.present(q.storagePath)) && dd2.some(r => r.status === 'fulfilled'));
  q = mkPhotoV2(A, FV); await A.db.collection('route-photos').doc(q.id).set(q.data);
  const raceDel = await Promise.allSettled([delDoc(A, q), A.db.collection('route-photos').doc(q.id).update({ routeName: 'x' })]);
  check('concurrencia: borrar y modificar a la vez: ninguna modificación se acepta', raceDel[1].status === 'rejected');

  // Carrera provocada por el propio autor: borrar el documento (con marca) mientras sube el archivo. Cualquiera que sea el orden en que se resuelva:
  // el documento no queda sin marca, el id no se puede reutilizar y, si queda un archivo sin documento, el autor no puede borrarlo (solo administración).
  for (let k = 0; k < 3; k++) {
    q = mkPhotoV2(A, FV); await A.db.collection('route-photos').doc(q.id).set(q.data);
    await Promise.allSettled([delDoc(A, q), S.upload(t.A, q.storagePath)]);
    const fileThere = await S.present(q.storagePath), docThere = await L.exists(`route-photos/${q.id}`), tomb = await L.exists(`route-photo-tombstones/${q.id}`);
    check(`concurrencia: borrar el documento y subir el archivo a la vez (${k + 1}/3): documento borrado ⇒ hay marca (documento ${docThere ? 'sigue' : 'borrado'}, archivo ${fileThere ? 'queda' : 'no queda'})`, docThere || tomb);
    await expect(`concurrencia: tras la carrera (${k + 1}/3) el id no se puede reutilizar`, A.db.collection('route-photos').doc(q.id).set({ ...q.data }), docThere ? false : false);
    if (fileThere && !docThere) {
      await expect(`concurrencia: archivo sin documento tras la carrera (${k + 1}/3): el autor no lo borra`, S.del(t.A, q.storagePath), false);
      await expect(`concurrencia: archivo sin documento tras la carrera (${k + 1}/3): el admin lo borra`, S.del(t.AD, q.storagePath), true);
    }
  }

  // ===== 10b. CICLO DE VIDA «borrar y volver a subir» dentro de la ventana de 5 min, sin vulnerar la protección contra reutilización de ids =====
  // La protección de ids es del DOCUMENTO (marca permanente al borrarlo); la resubida es del ARCHIVO con el documento intacto. Se comprueba el estado tras cada operación.
  const lc = async (x) => { const d = await L.ownerData(`route-photos/${x.id}`); return { doc: !!d, sp: d ? d.storagePath : null, up: d ? d.uploadedAt : null, tomb: await L.exists(`route-photo-tombstones/${x.id}`), file: await S.present(x.storagePath) }; };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const lcx = mkPhotoV2(A, FV), lcOther = mkPhotoV2(A, FV);
  let c0, c1;
  await A.db.collection('route-photos').doc(lcx.id).set(lcx.data);
  c0 = await lc(lcx);
  check('ciclo 1 · A crea el documento: documento sí, storagePath = ruta derivada del id, sin marca, sin archivo', c0.doc && c0.sp === lcx.storagePath && !c0.tomb && !c0.file, JSON.stringify(c0));
  await expect('ciclo 2 · A sube el archivo (dentro de la ventana)', S.upload(t.A, lcx.storagePath), true);
  c1 = await lc(lcx);
  check('ciclo 2 · estado: documento y storagePath intactos, sin marca, archivo sí', c1.doc && c1.sp === c0.sp && c1.up === c0.up && !c1.tomb && c1.file, JSON.stringify(c1));
  await expect('ciclo 3 · A borra SOLO el archivo (dentro del plazo de 12 h)', S.del(t.A, lcx.storagePath), true);
  c1 = await lc(lcx);
  check('ciclo 3 · estado: el documento NO cambia (mismo uploadedAt y storagePath), sin marca, sin archivo: el id sigue en uso, no se ha «reutilizado»', c1.doc && c1.sp === c0.sp && c1.up === c0.up && !c1.tomb && !c1.file, JSON.stringify(c1));
  await expect('ciclo 4 · A vuelve a subir el MISMO archivo dentro de la ventana de 5 min (mismo documento)', S.upload(t.A, lcx.storagePath), true);
  c1 = await lc(lcx);
  check('ciclo 4 · estado: archivo de nuevo; documento idéntico (uploadedAt no se mueve: el plazo de 12 h sigue contando desde el documento original)', c1.doc && c1.sp === c0.sp && c1.up === c0.up && !c1.tomb && c1.file, JSON.stringify(c1));
  await expect('ciclo 5 · A intenta cambiar el storagePath del documento (update)', A.db.collection('route-photos').doc(lcx.id).update({ storagePath: lcOther.storagePath }), false);
  await expect('ciclo 6 · A crea OTRO documento (id nuevo) apuntando al MISMO storagePath', A.db.collection('route-photos').doc(lcOther.id).set({ ...lcOther.data, storagePath: lcx.storagePath, filename: lcx.filename }), false);
  await expect('ciclo 7 · B intenta subir encima de la ruta de A', S.upload(t.B, lcx.storagePath), false);
  await expect('ciclo 8a · A borra el archivo y después el documento con su marca (orden del cliente)', (async () => { await S.del(t.A, lcx.storagePath); await delDoc(A, lcx); })(), true);
  c1 = await lc(lcx);
  check('ciclo 8 · estado: sin documento, sin archivo y marca PERMANENTE (el id queda quemado)', !c1.doc && c1.tomb && !c1.file, JSON.stringify(c1));
  await expect('ciclo 9 · A intenta RECREAR el documento con el mismo id (reutilizar el id)', A.db.collection('route-photos').doc(lcx.id).set(lcx.data), false);
  await expect('ciclo 10 · A intenta volver a subir el archivo a esa ruta (sin documento)', S.upload(t.A, lcx.storagePath), false);
  const fresh = mkPhotoV2(A, FV);
  await expect('ciclo 11 · A crea una foto NUEVA con la misma escuela y vía pero id nuevo (permitido: es otra foto con su propio plazo y su propia ruta)', A.db.collection('route-photos').doc(fresh.id).set(fresh.data), true);
  check('ciclo 11 · estado: la foto nueva tiene un storagePath distinto del quemado', fresh.storagePath !== lcx.storagePath && (await lc(fresh)).sp === fresh.storagePath);
  // Dentro y fuera de la ventana: el archivo solo se puede (re)crear mientras el documento tenga menos de 5 min
  const inWin = mkPhotoV2(A, FV), outWin = mkPhotoV2(A, FV);
  await seedAged(inWin, 4 * 60 * 1000); await seedAged(outWin, 6 * 60 * 1000);
  await S.upload('owner', inWin.storagePath); await S.upload('owner', outWin.storagePath);
  await expect('ciclo 12 · documento de 4 min: A borra el archivo y lo vuelve a subir (dentro de la ventana)', (async () => { await S.del(t.A, inWin.storagePath); await S.upload(t.A, inWin.storagePath); })(), true);
  await expect('ciclo 13 · documento de 6 min: A borra el archivo (permitido) y YA NO puede volver a subirlo (fuera de la ventana)', (async () => { await S.del(t.A, outWin.storagePath); await S.upload(t.A, outWin.storagePath); })(), false);
  check('ciclo 13 · estado: el documento sigue (sin marca) y el archivo no está: foto sin archivo que el autor puede borrar (documento + marca) dentro de las 12 h', (await lc(outWin)).doc && !(await lc(outWin)).tomb && !(await lc(outWin)).file);
  await expect('ciclo 13 · A limpia esa foto sin archivo (documento + marca)', delDoc(A, outWin), true);

  // ===== 11. Plazos ESCALADOS con espera real (12 h → 8 s, ventana de subida de 5 min → 5 s), en ambos servicios =====
  const fsFull = fs.readFileSync(FS_FILE, 'utf8'), stFull = fs.readFileSync(STORAGE_FILE, 'utf8');
  const cnt = (s, n) => s.split(n).length - 1;
  check('escalado: storage.rules contiene la ventana del autor (2 veces) y la de subida de 5 min (1 vez); firestore, la del autor (1 vez)',
    cnt(stFull, "duration.value(12, 'h')") === 2 && cnt(stFull, "duration.value(5, 'm')") === 1 && cnt(fsFull, "duration.value(12, 'h')") === 1);
  const putFs = async (content) => { const r = await fetch(`http://127.0.0.1:${L.FS_PORT}/emulator/v1/projects/${L.PROJECT}:securityRules`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rules: { files: [{ name: 'firestore.rules', content }] } }) }); if (!r.ok) throw new Error(await r.text()); };
  await putFs(fsFull.split("duration.value(12, 'h')").join("duration.value(8, 's')"));
  await S.setRules(stFull.split("duration.value(12, 'h')").join("duration.value(8, 's')").split("duration.value(5, 'm')").join("duration.value(5, 's')"));
  const born = async (u, tok, up = true) => { const x = mkPhotoV2(u, FV); await u.db.collection('route-photos').doc(x.id).set(x.data); if (up) await S.upload(tok, x.storagePath); return x; };
  // ---- Medición del tiempo (en lugar de esperas fijas) ----
  // Problema de las esperas fijas («duerme 3 s y borra; duerme 5,3 s y comprueba que ya no puede»): la prueba SUPONÍA cuánto tarda cada petición. Con el emulador lento, una operación que debía
  // permitirse dentro del plazo llegaba tarde y se denegaba, y las comprobaciones siguientes (que dependían de ella) fallaban en cascada. Aquí cada plazo se calcula con los instantes REALES que
  // fija el servidor (uploadedAt del documento y timeCreated del archivo; el emulador y la prueba comparten reloj: misma máquina) y cada comprobación se clasifica por el tiempo MEDIDO:
  //   · «debe denegarse pasado el plazo»        → se espera HASTA que el reloj supere el límite (+ holgura) y solo entonces se intenta: no depende de la latencia; un permiso indebido es siempre un fallo.
  //   · «debe permitirse dentro del plazo»      → solo se intenta si queda margen. Si se deniega y la operación terminó cuando ya se acababa el plazo, la medición NO es concluyente y se repite
  //                                               el ESCENARIO ENTERO con documentos nuevos (hasta 3 veces). Una denegación con tiempo de sobra, o cualquier error que no sea una denegación, es un
  //                                               FALLO REAL y NO se reintenta nunca (los fallos ya registrados tampoco se descartan).
  //   · «debe denegarse por OTRA causa dentro del plazo» → solo se acepta si la prueba demuestra por la hora que el plazo aún no había vencido (si no, la denegación podría deberse al plazo: no concluyente).
  // Si un escenario no concluye en 3 intentos FALLA; el número de intentos no concluyentes se informa. Los escenarios se ejecutan de KX_SCENARIO_CONCURRENCY en KX_SCENARIO_CONCURRENCY (por defecto 2):
  // con la CPU saturada, varios escenarios a la vez (Storage consultando Firestore en cada petición) dejaban sin respuesta al emulador de Storage (ver `_storage.cjs`).
  const W = 8000, UPW = 5000, MARGIN = 300, SAFETY = 1500, ATTEMPTS = 3;
  const CONC = Math.max(1, Number(process.env.KX_SCENARIO_CONCURRENCY || 2));
  class Inconclusive extends Error {}
  const now = () => Date.now();
  const T11 = now();
  const sleepUntil = (ms) => S.sleep(Math.max(0, ms - now()));
  const docAt = async (x) => (await A.db.collection('route-photos').doc(x.id).get({ source: 'server' })).data().uploadedAt.toMillis();
  const fileAt = async (x) => Date.parse((await S.meta('owner', x.storagePath)).timeCreated);
  const isDenial = (err) => /permission|PERMISSION|unauthorized|403|denied/i.test(err);
  const stats = { scenarios: 0, attempts: 0, inconclusive: 0, reasons: [] };
  const runScenario = async (name, fn) => {
    stats.scenarios++;
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      stats.attempts++;
      const buf = [];
      const run = async (op) => { const t0 = now(); let ok = true, err = ''; try { await op(); } catch (e) { ok = false; err = String(e.code || '') + ' ' + String(e.message || '').slice(0, 110); } return { ok, err, t0, t1: now() }; };
      const rec = (label, shouldPass, r, note) => {
        L.progress(`${name}: ${label}`);
        const unexpected = !r.ok && !isDenial(r.err);
        buf.push({ label, policy: shouldPass ? 'permitido' : 'denegado', got: r.ok ? 'permitido' : 'denegado', pass: r.ok === shouldPass && !unexpected, atMs: now() - T11,
          ...(r.err ? { error: r.err } : {}), ...(unexpected ? { errorInesperado: r.err } : {}), ...(note ? { nota: note } : {}) });
      };
      const c = {
        run, rec,
        expect: async (label, promise, shouldPass, note) => rec(label, shouldPass, await run(() => promise), note),
        allowBefore: async (label, deadline, op, safety = SAFETY) => {
          if (now() + safety > deadline) throw new Inconclusive(`${label}: al empezar faltaban solo ${deadline - now()} ms para el límite`);
          const r = await run(op);
          if (!r.ok && isDenial(r.err) && r.t1 + MARGIN > deadline) throw new Inconclusive(`${label}: terminó a ${deadline - r.t1} ms del límite`);
          rec(label, true, r, `empezó a ${deadline - r.t0} ms del límite y terminó a ${deadline - r.t1} ms`);
        },
        denyWithin: async (label, deadline, op) => {
          if (now() + SAFETY > deadline) throw new Inconclusive(`${label}: al empezar faltaban solo ${deadline - now()} ms para el límite`);
          const r = await run(op);
          if (!r.ok && r.t1 + MARGIN > deadline) throw new Inconclusive(`${label}: terminó a ${deadline - r.t1} ms del límite (la denegación podría deberse al plazo)`);
          rec(label, false, r, `empezó a ${deadline - r.t0} ms del límite y terminó a ${deadline - r.t1} ms`);
        },
        denyAfter: async (label, deadline, op) => { await sleepUntil(deadline + MARGIN); const r = await run(op); rec(label, false, r, `empezó ${r.t0 - deadline} ms después del límite`); }
      };
      const flush = () => { for (const r of buf) L.results.push({ ...r, ...(attempt > 1 ? { intento: attempt } : {}) }); };
      try { await fn(c); flush(); return; }
      catch (e) {
        if (!(e instanceof Inconclusive)) { flush(); L.results.push({ label: `[escalado] ${name}: error inesperado de la prueba`, policy: 'sin error', got: String(e.code || '') + ' ' + String(e.message).slice(0, 150), pass: false }); return; }
        stats.inconclusive++; stats.reasons.push(`${name}#${attempt}: ${e.message}`);
        if (buf.some(r => !r.pass)) { flush(); return; }   // ya hay un fallo REAL: se conserva y no se reintenta
      }
    }
    L.results.push({ label: `[escalado] ${name}: la medición no fue concluyente en ${ATTEMPTS} intentos`, policy: 'concluyente', got: 'no concluyente', pass: false, nota: stats.reasons.filter(x => x.startsWith(name + '#')).join(' | ') });
  };
  const runPool = async (tasks) => { const q = tasks.slice(); await Promise.all(Array.from({ length: Math.min(CONC, q.length) }, async () => { while (q.length) { const [n, f] = q.shift(); await runScenario(n, f); } })); };

  await runPool([
    // a) borrar el archivo y subirlo otra vez NO amplía el plazo (manda el documento)
    ['a', async (c) => {
      const f = await born(A, t.A), d0 = await docAt(f);
      await sleepUntil(d0 + 3000);
      await c.allowBefore('[8 s] a) el autor borra el archivo a los ~3 s', d0 + W, () => S.del(t.A, f.storagePath));
      await c.allowBefore('[8 s] a) y lo vuelve a subir dentro de la ventana de subida (timeCreated se reinicia)', d0 + UPW, () => S.upload(t.A, f.storagePath));
      await c.denyAfter('[8 s] a) pasado el plazo del DOCUMENTO el autor ya NO puede borrar, aunque el archivo nuevo tenga solo unos segundos', d0 + W, () => S.del(t.A, f.storagePath));
      await c.expect('[8 s] a) el admin sí', S.del(t.AD, f.storagePath), true);
    }],
    // a2) sobrescribir encima (sin borrar antes) tampoco amplía el plazo: el archivo nuevo tendría timeCreated reciente, pero manda el documento
    ['a2', async (c) => {
      const f = await born(A, t.A), d0 = await docAt(f);
      await sleepUntil(d0 + 3000);
      await c.denyWithin('[8 s] a2) subir encima del archivo existente (sobrescribir) a los ~3 s, dentro de la ventana de subida', d0 + UPW, () => S.upload(t.A, f.storagePath));
      await c.denyAfter('[8 s] a2) pasado el plazo el autor ya NO puede borrar', d0 + W, () => S.del(t.A, f.storagePath));
      await c.expect('[8 s] a2) el admin sí', S.del(t.AD, f.storagePath), true);
    }],
    // b) documento recreado SIN marca (p. ej. restaurado por un administrador con credenciales de servicio): manda timeCreated del archivo
    ['b', async (c) => {
      const f = await born(A, t.A), d0 = await docAt(f), tf = await fileAt(f);
      await sleepUntil(d0 + 4000);
      await L.ownerDelete(`route-photos/${f.id}`);
      await c.expect('[8 s] b) el documento se recrea con el mismo id (sin marca) → uploadedAt nuevo', A.db.collection('route-photos').doc(f.id).set(f.data), true);
      const d1 = await docAt(f);
      await sleepUntil(tf + W + MARGIN);   // vence el plazo del ARCHIVO; el del documento nuevo (d1 + W) aún no: la denegación solo puede venir de timeCreated
      if (now() + SAFETY > d1 + W) throw new Inconclusive(`[8 s] b) al probar faltaban solo ${d1 + W - now()} ms para el plazo del documento nuevo`);
      const r = await c.run(() => S.del(t.A, f.storagePath));
      if (!r.ok && r.t1 + MARGIN > d1 + W) throw new Inconclusive('[8 s] b) la denegación podría deberse también al plazo del documento nuevo');
      c.rec('[8 s] b) el archivo conserva su timeCreated: el autor ya NO puede borrarlo (el plazo de su documento nuevo aún no ha vencido)', false, r, `empezó ${r.t0 - (tf + W)} ms después del plazo del archivo y ${d1 + W - r.t1} ms antes del del documento`);
      await c.expect('[8 s] b) el admin sí', S.del(t.AD, f.storagePath), true);
    }],
    // c) archivo sin documento: el autor no borra en ningún momento (no se puede demostrar el instante de aceptación); solo administración
    ['c', async (c) => {
      const f = await born(A, t.A), g = await born(A, t.A);
      const df = await docAt(f), dg = await docAt(g);
      await L.ownerDelete(`route-photos/${f.id}`); await L.ownerDelete(`route-photos/${g.id}`);
      await sleepUntil(df + 2500);
      await c.denyWithin('[8 s] c) archivo sin documento: el autor NO puede ni a los ~2.5 s (aún dentro de lo que sería su plazo)', df + W, () => S.del(t.A, f.storagePath));
      await c.denyAfter('[8 s] c) archivo sin documento: el autor tampoco pasado el plazo (~9 s)', dg + W, () => S.del(t.A, g.storagePath));
      await c.expect('[8 s] c) archivo sin documento: el spotter no puede', S.del(t.SP, g.storagePath), false);
      await c.expect('[8 s] c) archivo sin documento: el admin sí', S.del(t.AD, g.storagePath), true);
      await c.expect('[8 s] c) archivo sin documento: el admin borra también el primero', S.del(t.AD, f.storagePath), true);
    }],
    // d) documento: borrado del autor dentro y fuera de la ventana (hora del servidor)
    ['d', async (c) => {
      const f = await born(A, t.A, false), g = await born(A, t.A, false), h = await born(SP, t.SP, false);
      const df = await docAt(f), dg = await docAt(g), dh = await docAt(h);
      await sleepUntil(df + 3000);
      await c.allowBefore('[8 s] d) el autor borra el documento a los ~3 s', df + W, () => delDoc(A, f));
      await c.denyAfter('[8 s] d) el autor ya no puede pasado el plazo (~9 s)', dg + W, () => delDoc(A, g));
      await c.denyAfter('[8 s] d) el spotter autor ya no puede pasado el plazo (~9 s)', dh + W, () => delDoc(SP, h));
      await c.expect('[8 s] d) el admin sí', delDoc(AD, g), true);
    }],
    // e) ventana de subida del archivo (5 min → 5 s)
    ['e', async (c) => {
      const early = await born(A, t.A, false), late = await born(A, t.A, false);
      const de = await docAt(early), dl = await docAt(late);
      await c.allowBefore('[5 s] e) subir a los ~0 s del documento', de + UPW, () => S.upload(t.A, early.storagePath));
      await c.denyAfter('[5 s] e) subir pasada la ventana de subida', dl + UPW, () => S.upload(t.A, late.storagePath));
      await c.allowBefore('[5 s] e) el documento sin archivo lo borra su autor (sigue dentro del plazo de 8 s)', dl + W, () => delDoc(A, late));
    }],
    // ===== 12. NINGUNA operación del autor supera las 12 h (8 s escalados) desde la aceptación del documento, sea cual sea el historial del archivo =====
    // Se preparan fotos con historiales distintos (todos «peores casos» para el autor) y TODAS se comprueban pasado el plazo, con todas las operaciones del autor.
    ['barrido', async (c) => {
      const PRIV = 'documento recreado SIN marca a ~3 s (vía privilegiada)';
      const lim = {};   // instante a partir del cual el autor ya no puede borrar el ARCHIVO de cada foto
      const prep = {
        normal: async () => { const f = await born(A, t.A); lim.normal = (await docAt(f)) + W; return f; },
        'archivo borrado y vuelto a subir a ~2 s': async () => { const f = await born(A, t.A), d0 = await docAt(f); lim['archivo borrado y vuelto a subir a ~2 s'] = d0 + W; await sleepUntil(d0 + 2000);
          await c.allowBefore('[8 s] preparación «borrado y vuelto a subir a ~2 s»: borra el archivo', d0 + W, () => S.del(t.A, f.storagePath));
          await c.allowBefore('[8 s] preparación «borrado y vuelto a subir a ~2 s»: lo vuelve a subir (ventana de subida)', d0 + UPW, () => S.upload(t.A, f.storagePath)); return f; },
        'archivo borrado y vuelto a subir EN EL BORDE de la ventana (~4 s de 5 s)': async () => { const k = 'archivo borrado y vuelto a subir EN EL BORDE de la ventana (~4 s de 5 s)'; const f = await born(A, t.A), d0 = await docAt(f); lim[k] = d0 + W; await sleepUntil(d0 + 4000);
          await c.allowBefore('[8 s] preparación «en el borde»: borra el archivo', d0 + W, () => S.del(t.A, f.storagePath));
          await c.allowBefore('[8 s] preparación «en el borde»: lo vuelve a subir cerca del final de la ventana de subida', d0 + UPW, () => S.upload(t.A, f.storagePath), 400); return f; },
        'archivo sobrescrito a ~2 s': async () => { const f = await born(A, t.A), d0 = await docAt(f); lim['archivo sobrescrito a ~2 s'] = d0 + W; await sleepUntil(d0 + 2000);
          await c.denyWithin('[8 s] preparación «sobrescrito»: sobrescribir está denegado', d0 + UPW, () => S.upload(t.A, f.storagePath)); return f; },
        'dos subidas simultáneas': async () => { const f = await born(A, t.A, false); lim['dos subidas simultáneas'] = (await docAt(f)) + W; await Promise.allSettled([S.upload(t.A, f.storagePath), S.upload(t.A, f.storagePath)]); return f; },
        [PRIV]: async () => { const f = await born(A, t.A), d0 = await docAt(f), tf = await fileAt(f); lim[PRIV] = tf + W; await sleepUntil(d0 + 3000); await L.ownerDelete(`route-photos/${f.id}`);
          await c.expect('[8 s] preparación «recreado sin marca»: el documento se recrea', A.db.collection('route-photos').doc(f.id).set(f.data), true); f.d1 = await docAt(f); return f; },
        'documento borrado con marca a ~2 s (el archivo queda)': async () => { const f = await born(A, t.A), d0 = await docAt(f); lim['documento borrado con marca a ~2 s (el archivo queda)'] = d0 + W; await sleepUntil(d0 + 2000);
          await c.allowBefore('[8 s] preparación «documento borrado con marca»: lo borra su autor', d0 + W, () => delDoc(A, f)); return f; }
      };
      const photos = {};
      await Promise.all(Object.entries(prep).map(async ([name, fn]) => { photos[name] = await fn(); }));   // todas a la vez: cada documento nace en los primeros ms
      await sleepUntil(Math.max(...Object.values(lim)) + MARGIN);   // todos los límites han vencido
      // el documento recreado (PRIV) tiene un plazo propio posterior; la denegación del archivo debe venir de su timeCreated, no de ese plazo
      if (now() + SAFETY > photos[PRIV].d1 + W) throw new Inconclusive(`[8 s] barrido: al probar faltaban solo ${photos[PRIV].d1 + W - now()} ms para el plazo del documento recreado`);
      for (const [name, f] of Object.entries(photos)) {
        const r = await c.run(() => S.del(t.A, f.storagePath));
        if (name === PRIV && !r.ok && r.t1 + MARGIN > f.d1 + W) throw new Inconclusive('[8 s] barrido: la denegación del archivo recreado podría deberse al plazo del documento nuevo');
        c.rec(`[8 s] barrido «${name}»: el autor borra el archivo pasado el plazo`, false, r);
        // Un documento recreado por la vía privilegiada es un documento NUEVO aceptado a los ~3 s; el cliente no puede llegar a ese estado (la marca lo impide).
        // Lo que importa es que el ARCHIVO conserva su timeCreated y sigue sin poder borrarse (línea anterior).
        if (name !== PRIV) await c.expect(`[8 s] barrido «${name}»: el autor borra el documento pasado el plazo`, delDoc(A, f), false);
        await c.expect(`[8 s] barrido «${name}»: el spotter (sin privilegios) tampoco`, S.del(t.SP, f.storagePath), false);
      }
      for (const [name, f] of Object.entries(photos)) await c.expect(`[8 s] barrido «${name}»: el admin sí puede borrar el archivo (control)`, S.del(t.AD, f.storagePath), true);
    }]
  ]);
  check(`[escalado] medición del tiempo: ${stats.scenarios} escenarios, ${stats.attempts} intentos, ${stats.inconclusive} no concluyentes repetidos con documentos nuevos (ningún fallo real se reintenta)`, true, stats.reasons.length ? stats.reasons.join(' | ') : 'ninguno');

  check('instante exacto de las 12 h: Date.now() del test y request.time del emulador no están sincronizados al milisegundo; se prueba 11 h 59 min / 12 h 01 min y la ventana escalada',
    true, 'la regla usa «<» estricto');

  L.finish('storage-phase0c-rules.cjs');
  process.exit(process.exitCode || 0);
})().catch(e => { console.error('ERROR FATAL', String(e.message).slice(0, 400), '\nÚltima prueba registrada:', L.results.length ? L.results[L.results.length - 1].label : '(ninguna)'); process.exit(2); });

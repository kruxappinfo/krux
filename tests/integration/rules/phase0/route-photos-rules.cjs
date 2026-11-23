// Fase 0 — fotografías de vía (route-photos, Firestore). Política aprobada:
//  - cualquier usuario autenticado sube; uploadedBy == uid; uploadedAt = hora del servidor, inmutable;
//  - el autor borra solo durante las primeras 12 h; admin y super-admin siempre; el spotter NO tiene permiso especial.
// El plazo se prueba con documentos sembrados por REST (Bearer owner, solo emulador) con uploadedAt en el pasado;
// request.time lo pone el emulador. Los márgenes son de ±20 s porque el instante exacto de las 12 h no se puede fijar.
const L = require('./_lib.cjs');
const { mk, mkAnon, seed, exists, expect, check, SUPER_EMAIL } = L;

(async () => {
  await L.loadFirestoreRules(L.MODE === 'proposal' ? 'proposal0' : 'current');   // prueba de la revisión 0 (superada por route-photos-binding-rules.cjs)
  const stamp = Date.now();
  const A = await mk('pa' + stamp, `pa${stamp}@test.dev`);      // autor
  const B = await mk('pb' + stamp, `pb${stamp}@test.dev`);      // otro usuario
  const SP = await mk('psp' + stamp, `psp${stamp}@test.dev`);   // spotter
  const AD = await mk('pad' + stamp, `pad${stamp}@test.dev`);   // admin
  const SA = await mk('psa' + stamp, SUPER_EMAIL);              // super-admin
  const anon = await mkAnon('pan' + stamp);
  await seed(`admins/${SP.uid}`, { role: 'spotter' });
  await seed(`admins/${AD.uid}`, { role: 'admin' });
  const FV = A.FV;
  const school = 'valeria';
  const BUCKET = 'climbmaps-80cae.firebasestorage.app';
  let n = 0;

  const meta = (u, over) => {
    const filename = `${Date.now()}_${++n}_Via.jpg`;
    return Object.assign({
      photoUrl: `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/route-photos%2F${school}%2F${u.uid}%2F${filename}?alt=media&token=t`,
      uploadedBy: u.uid, uploadedByName: 'Test', uploadedAt: FV.serverTimestamp(), routeId: 12, routeName: 'Via',
      schoolId: school, filename, storagePath: `route-photos/${school}/${u.uid}/${filename}`
    }, over || {});
  };
  const id = (tag) => `${school}_12_${stamp}_${tag}`;
  const ref = (u, i) => u.db.collection('route-photos').doc(i);
  // Foto sembrada de A con antigüedad dada (segundos). Devuelve el id.
  const seedPhoto = async (tag, ageSec, over) => {
    const m = meta(A);
    const data = Object.assign({}, m, { uploadedAt: new Date(Date.now() - ageSec * 1000) }, over || {});
    Object.keys(data).forEach(k => data[k] === undefined && delete data[k]);
    await seed(`route-photos/${id(tag)}`, data);
    return id(tag);
  };
  const H = 3600;

  // ---------- subida ----------
  await expect('usuario autenticado sube una foto', ref(A, id('c1')).set(meta(A)), true);
  await expect('usuario sin rol especial (B) sube una foto', ref(B, id('c2')).set(meta(B)), true);
  await expect('spotter sube una foto (no hace falta rol)', ref(SP, id('c3')).set(meta(SP)), true);
  await expect('sin autenticar intenta subir', anon.db.collection('route-photos').doc(id('c4')).set(meta(A)), false);
  await expect('falsificar uploadedBy (A sube a nombre de B)', ref(A, id('c5')).set(meta(A, { uploadedBy: B.uid })), false);
  await expect('uploadedAt con fecha del cliente', ref(A, id('c6')).set(meta(A, { uploadedAt: new Date(Date.now() - 5000) })), false);
  await expect('uploadedAt con fecha antigua (para recuperar permisos)', ref(A, id('c6b')).set(meta(A, { uploadedAt: new Date(Date.now() - 3600 * 1000) })), false);
  await expect('uploadedAt con fecha futura', ref(A, id('c6c')).set(meta(A, { uploadedAt: new Date(Date.now() + 86400000) })), false);
  await expect('sin uploadedAt', (() => { const m = meta(A); delete m.uploadedAt; return ref(A, id('c7')).set(m); })(), false);
  await expect('storagePath de otro usuario', ref(A, id('c8')).set(meta(A, { storagePath: `route-photos/${school}/${B.uid}/x.jpg` })), false);
  await expect('storagePath en la ruta antigua (sin uid)', (() => { const m = meta(A); return ref(A, id('c9')).set({ ...m, storagePath: `route-photos/${school}/${m.filename}` }); })(), false);
  await expect('photoUrl externa (no es de Firebase Storage)', ref(A, id('c10')).set(meta(A, { photoUrl: 'https://evil.example/x.jpg' })), false);
  await expect('photoUrl de otro bucket', ref(A, id('c10b')).set(meta(A, { photoUrl: 'https://firebasestorage.googleapis.com/v0/b/otro-proyecto/o/x?alt=media' })), false);
  await expect('campo arbitrario añadido', ref(A, id('c11')).set(meta(A, { isAdmin: true })), false);
  await expect('campo de moderación inventado (status)', ref(A, id('c11b')).set(meta(A, { status: 'published' })), false);
  await expect('sin storagePath (forma que escribe el cliente actual)', (() => { const m = meta(A); delete m.storagePath; return ref(A, id('c12')).set(m); })(), false,
    'el cliente actual NO escribe storagePath: hay que actualizar route-photos.js antes de desplegar');
  await expect('routeId decimal', ref(A, id('c13')).set(meta(A, { routeId: 1.5 })), false);
  await expect('schoolId demasiado largo', ref(A, id('c14')).set(meta(A, { schoolId: 'x'.repeat(61) })), false);
  await expect('lectura pública sin autenticar', anon.db.collection('route-photos').doc(id('c1')).get(), true);

  // ---------- inmutabilidad ----------
  const u1 = id('c1');
  await expect('el autor modifica uploadedAt (recuperar el plazo)', ref(A, u1).update({ uploadedAt: FV.serverTimestamp() }), false);
  await expect('el autor modifica uploadedBy', ref(A, u1).update({ uploadedBy: B.uid }), false);
  await expect('el autor modifica storagePath', ref(A, u1).update({ storagePath: `route-photos/${school}/${A.uid}/otra.jpg` }), false);
  await expect('el autor modifica photoUrl', ref(A, u1).update({ photoUrl: 'https://firebasestorage.googleapis.com/v0/b/climbmaps-80cae.firebasestorage.app/o/otra' }), false);
  await expect('el autor añade un campo', ref(A, u1).update({ extra: 1 }), false);
  await expect('el autor modifica routeName (metadato)', ref(A, u1).update({ routeName: 'Otro' }), false);
  await expect('otro usuario modifica la foto', ref(B, u1).update({ routeName: 'Hackeado' }), false);
  await expect('el admin modifica la foto (los metadatos son inmutables para todos)', ref(AD, u1).update({ routeName: 'x' }), false);
  await expect('set() sobre una foto existente (reemplazo)', ref(A, u1).set(meta(A)), false);

  // ---------- borrado: plazo de 12 h del autor ----------
  const t1 = await seedPhoto('d1', 60);                       // 1 minuto
  await expect('autor borra a 1 min', ref(A, t1).delete(), true);
  const t2 = await seedPhoto('d2', 12 * H - 20);              // 11 h 59 min 40 s
  await expect('autor borra a 11 h 59 min 40 s (justo antes del plazo)', ref(A, t2).delete(), true);
  const t3 = await seedPhoto('d3', 12 * H + 20);              // 12 h 00 min 20 s
  await expect('autor borra a 12 h 00 min 20 s (justo después del plazo)', ref(A, t3).delete(), false);
  const t4 = await seedPhoto('d4', 13 * H);
  await expect('autor borra a 13 h', ref(A, t4).delete(), false);
  const t5 = await seedPhoto('d5', 30 * 24 * H);
  await expect('autor borra a 30 días', ref(A, t5).delete(), false);
  check('instante exacto de las 12 h: NO ejecutable en el emulador (no se puede fijar request.time)', true,
    'la regla usa «<» estricto: a las 12:00:00 exactas el autor ya no puede borrar. Verificado solo por lectura de la regla');

  // ---------- borrado: roles ----------
  const r1 = await seedPhoto('e1', 60);
  await expect('admin borra una foto ajena antes de 12 h', ref(AD, r1).delete(), true);
  const r2 = await seedPhoto('e2', 13 * H);
  await expect('admin borra una foto ajena después de 12 h', ref(AD, r2).delete(), true);
  const r3 = await seedPhoto('e3', 60);
  await expect('super-admin borra una foto ajena antes de 12 h', ref(SA, r3).delete(), true);
  const r4 = await seedPhoto('e4', 30 * 24 * H);
  await expect('super-admin borra una foto ajena después de 12 h', ref(SA, r4).delete(), true);
  const r5 = await seedPhoto('e5', 60);
  await expect('spotter intenta borrar una foto ajena reciente', ref(SP, r5).delete(), false);
  const r6 = await seedPhoto('e6', 13 * H);
  await expect('spotter intenta borrar una foto ajena antigua', ref(SP, r6).delete(), false);
  const r7 = await seedPhoto('e7', 60);
  await expect('usuario normal intenta borrar una foto ajena reciente', ref(B, r7).delete(), false);
  const r8 = await seedPhoto('e8', 13 * H);
  await expect('usuario normal intenta borrar una foto ajena antigua', ref(B, r8).delete(), false);
  await expect('sin autenticar intenta borrar', anon.db.collection('route-photos').doc(r7).delete(), false);
  check('las fotos protegidas siguen existiendo tras los intentos denegados',
    (await exists(`route-photos/${r5}`)) && (await exists(`route-photos/${r6}`)) && (await exists(`route-photos/${r7}`)) && (await exists(`route-photos/${r8}`)));
  // El spotter es autor de su propia foto: gana el permiso como autor (12 h), no como spotter
  const s1 = await seedPhoto('f1', 60, { uploadedBy: SP.uid, storagePath: `route-photos/${school}/${SP.uid}/s.jpg` });
  await expect('spotter borra SU PROPIA foto reciente (como autor)', ref(SP, s1).delete(), true);
  const s2 = await seedPhoto('f2', 13 * H, { uploadedBy: SP.uid, storagePath: `route-photos/${school}/${SP.uid}/s.jpg` });
  await expect('spotter borra SU PROPIA foto pasadas 12 h (sin privilegios de rol)', ref(SP, s2).delete(), false);
  const ad1 = await seedPhoto('f3', 13 * H, { uploadedBy: AD.uid, storagePath: `route-photos/${school}/${AD.uid}/a.jpg` });
  await expect('admin borra su propia foto pasadas 12 h (es admin)', ref(AD, ad1).delete(), true);

  // ---------- documentos antiguos (sin uploadedAt / sin storagePath) ----------
  const old1 = id('g1');
  await seed(`route-photos/${old1}`, { photoUrl: 'https://x/y.jpg', uploadedBy: A.uid, uploadedByName: 'A', routeId: 12, routeName: 'Via', schoolId: school, filename: 'old.jpg' });
  await expect('documento antiguo sin uploadedAt: su autor no puede borrarlo', ref(A, old1).delete(), false,
    'las fotos antiguas solo las borra un admin (el plazo no se puede demostrar)');
  await expect('documento antiguo sin uploadedAt: admin sí', ref(AD, old1).delete(), true);
  const old2 = id('g2');
  await seed(`route-photos/${old2}`, { photoUrl: 'https://x/y.jpg', uploadedBy: A.uid, uploadedAt: 'no-es-una-fecha', schoolId: school, filename: 'x.jpg' });
  await expect('uploadedAt que no es un timestamp: el autor no puede borrar', ref(A, old2).delete(), false);

  L.finish('route-photos-rules.cjs');
  process.exit(process.exitCode || 0);
})().catch(e => { console.error('ERROR FATAL', String(e.message).slice(0, 300), '\nÚltima prueba registrada:', L.results.length ? L.results[L.results.length - 1].label : '(ninguna)'); process.exit(2); });

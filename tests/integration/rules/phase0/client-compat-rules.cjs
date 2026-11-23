// Fase 0b — compatibilidad con los clientes ACTUALES / ANTIGUOS (los que siguen en uso mientras las apps nativas no se actualicen).
// Reproduce las cargas útiles exactas del código actual (createNotification, mlVote*, mlCancelGradeVote, kxSaveRouteVotes, route-photos.js,
// subidas a Storage) contra las propuestas 0b. «permitido» = el cliente antiguo sigue funcionando; «denegado» = deja de funcionar (se anota).
const path = require('node:path');
const L = require('./_lib.cjs');
const S = require('./_storage.cjs');
const { mk, seed, ownerData, expect, check, knownDefect, SUPER_EMAIL } = L;
(async () => {
  await L.loadFirestoreRules('proposal');
  await S.loadStorageRules(path.join(L.ROOT, 'docs/security-phase0/storage.rules.phase0b.proposal'));
  const stamp = Date.now();
  const A = await mk('ca' + stamp, `ca${stamp}@test.dev`), B = await mk('cb' + stamp, `cb${stamp}@test.dev`);
  const SP = await mk('csp' + stamp, `csp${stamp}@test.dev`), AD = await mk('cad' + stamp, `cad${stamp}@test.dev`);
  await seed(`admins/${SP.uid}`, { role: 'spotter' }); await seed(`admins/${AD.uid}`, { role: 'admin' });
  const FV = A.FV, school = `s${stamp}`;

  // ---- createNotification (app_3.js:4057): fromUserPhoto puede ser una URL de Storage con token (larga) ----
  const key = (type, res) => `${type}_${A.uid}_${res}`.replace(/[^a-zA-Z0-9_]/g, '_');
  const longPhoto = 'https://firebasestorage.googleapis.com/v0/b/climbmaps-80cae.firebasestorage.app/o/profile-photos%2F' + A.uid + '%2F1760000000000_' + 'foto_de_perfil_con_nombre_largo'.repeat(6) + '.jpg?alt=media&token=' + 'a1b2c3d4-'.repeat(4);
  const notif = (type, text, extra, photo) => Object.assign({ type, text, fromUserId: A.uid, fromUserName: 'Ana García', fromUserPhoto: photo || 'https://ui-avatars.com/api/?name=U&background=DCE9DF&color=153E35&size=44',
    read: false, createdAt: FV.serverTimestamp() }, extra || {});
  const nref = (id) => A.db.collection('users').doc(B.uid).collection('notifications').doc(id);
  await expect('notificación like (postId)', nref(key('like', 'post1')).set(notif('like', 'le dio like a tu publicación', { postId: 'post1' })), true);
  await expect('notificación follow (sin recurso)', nref(key('follow', '')).set(notif('follow', 'ha empezado a seguirte')), true);
  await expect('notificación reply (postId, commentId, replyId)', nref(key('reply', 'r1')).set(notif('reply', 'respondió a tu comentario', { postId: 'p', commentId: 'c', replyId: 'r1' })), true);
  await expect('notificación comment', nref(key('comment', 'p')).set(notif('comment', 'comentó en tu publicación', { postId: 'p', commentId: 'c9' })), true);
  await expect('notificación mention (postId vacío)', nref(key('mention', '')).set(notif('mention', 'te mencionó en una publicación', { postId: '' })), true);
  check('la foto de perfil de Storage con token mide menos de 1000 caracteres', longPhoto.length < 1000, `longitud ${longPhoto.length}`);
  await expect('notificación con fromUserPhoto de Storage larga', nref(key('like', 'foto')).set(notif('like', 'x', { postId: 'p' }, longPhoto)), true);
  await expect('notificación con displayName de 80 caracteres (límite)', nref(key('like', 'nom')).set(notif('like', 'x', { postId: 'p' }, null)), true);

  // ---- Votos: patrones del cliente actual sobre documentos con la forma REAL de producción ----
  // producción (lectura pública 2026-11-14): 2 de 11 docs de grade_votes con routeId string; mapas vacíos; 2 docs de aleje y 4 de estado sin routeId
  const ids = { grade: `${school}_1`, grade2: `${school}_2`, aleje: `${school}_3`, estado: `${school}_4` };
  await seed(`grade_votes/${ids.grade}`, { schoolId: school, routeId: '1', votes: { [B.uid]: 10 }, updatedAt: new Date() });        // routeId string (efecto de mlCancelGradeVote)
  await seed(`grade_votes/${ids.grade2}`, { schoolId: school, routeId: 2, votes: {}, updatedAt: new Date() });                       // mapa vacío
  await seed(`aleje_votes/${ids.aleje}`, { schoolId: school, votes: { [B.uid]: 3 }, updatedAt: new Date() });                        // sin routeId
  await seed(`estado_votes/${ids.estado}`, { schoolId: school, routeId: 4, votes: { [B.uid]: 4 }, updatedAt: new Date(), routeName: 'Via', migratedFrom: `${school}_Via` });
  const full = async (col, id, rid, v) => { const cur = (await ownerData(`${col}/${id}`)).votes; return A.db.collection(col).doc(id).set({ schoolId: school, routeId: rid, votes: { ...cur, [A.uid]: v }, updatedAt: FV.serverTimestamp() }, { merge: true }); };
  await expect('mlVoteGrade (mapa completo) sobre documento con routeId string', full('grade_votes', ids.grade, 1, 12), true);
  await expect('mlVoteGrade sobre documento con mapa vacío', full('grade_votes', ids.grade2, 2, 12), true);
  await expect('mlVoteAleje (mapa completo) sobre documento sin routeId', full('aleje_votes', ids.aleje, 3, 2), true);
  await expect('mlVoteEstado (mapa completo) sobre documento con routeName/migratedFrom', full('estado_votes', ids.estado, 4, 5), true);
  await expect('kxSaveRouteVotes (solo clave propia, FieldValue.delete)', A.db.collection('estado_votes').doc(ids.estado).set({ schoolId: school, routeId: 4, votes: { [A.uid]: FV.delete() }, updatedAt: FV.serverTimestamp() }, { merge: true }), true);
  // mlCancelGradeVote ANTIGUO: delete local + merge del mapa restante con routeId como CADENA (data-route).
  // Matiz comprobado: si no quedan otros votantes el mapa restante es {} y el merge de un mapa vacío SUSTITUYE votes (el voto desaparece);
  // si quedan otros votantes, las claves ausentes no se borran en un merge y el voto propio PERMANECE en el servidor.
  const restSolo = { ...(await ownerData(`grade_votes/${ids.grade2}`)).votes }; delete restSolo[A.uid];
  await expect('mlCancelGradeVote antiguo, único votante (routeId como cadena sobre número)', A.db.collection('grade_votes').doc(ids.grade2).set({ schoolId: school, routeId: '2', votes: restSolo, updatedAt: FV.serverTimestamp() }, { merge: true }), true,
    'tolerado a propósito para no romper clientes antiguos');
  check('mlCancelGradeVote antiguo con un único votante: el mapa queda vacío (por eso en producción hay mapas vacíos)', Object.keys((await ownerData(`grade_votes/${ids.grade2}`)).votes).length === 0);
  const id5 = `${school}_5`;
  await seed(`grade_votes/${id5}`, { schoolId: school, routeId: 5, votes: { [A.uid]: 12, [B.uid]: 10 }, updatedAt: new Date() });
  const restVarios = { [B.uid]: 10 };
  await expect('mlCancelGradeVote antiguo con más votantes (routeId como cadena sobre número)', A.db.collection('grade_votes').doc(id5).set({ schoolId: school, routeId: '5', votes: restVarios, updatedAt: FV.serverTimestamp() }, { merge: true }), true,
    'tolerado; sigue SIN borrar el voto (defecto del cliente, no de las reglas)');
  knownDefect('mlCancelGradeVote antiguo con más votantes: el voto propio sigue en el servidor', (await ownerData(`grade_votes/${id5}`)).votes[A.uid] === 12, 'se corrige en el cliente nuevo con FieldValue.delete()');
  await expect('mlCancelGradeVote antiguo con un routeId de otra vía', A.db.collection('grade_votes').doc(id5).set({ schoolId: school, routeId: '99', votes: restVarios, updatedAt: FV.serverTimestamp() }, { merge: true }), false);

  // ---- route-photos.js ANTIGUO (subida por admin / photo_uploader): forma sin storagePath, id libre, ruta sin uid ----
  const old = { photoUrl: `https://firebasestorage.googleapis.com/v0/b/climbmaps-80cae.firebasestorage.app/o/route-photos%2Fvaleria%2F${stamp}_Via.jpeg?alt=media&token=t`, uploadedBy: AD.uid, uploadedByName: 'Admin', uploadedAt: FV.serverTimestamp(), routeId: 12, routeName: 'Via', schoolId: 'valeria', filename: `${stamp}_Via.jpeg` };
  await expect('cliente antiguo de fotos de vía: documento sin storagePath (admin)', AD.db.collection('route-photos').doc(`valeria_12_${stamp}`).set(old), false, 'la interfaz parece inactiva; el cliente nuevo debe desplegarse antes');
  await expect('cliente antiguo de fotos de vía: archivo en la ruta antigua (admin)', S.upload(await AD.token(), `route-photos/valeria/${stamp}_Via.jpeg`), false);

  // ---- Subidas a Storage de los demás módulos con el cliente actual ----
  const tA = await A.token(), tSP = await SP.token();
  await expect('foto de perfil (app_3.js:6323): dueño', S.upload(tA, `profile-photos/${A.uid}/${stamp}_yo.jpg`), true);
  await expect('post con vídeo (app_3.js:10412): dueño', S.upload(tA, `posts/${A.uid}/${stamp}_0_clip.mp4`, 'video/mp4', 4096), true);
  await expect('post con portada (app_3.js:14111): dueño', S.upload(tA, `posts/${A.uid}/${stamp}_portada_x.jpg`), true);
  await expect('imagen de sector nueva (sector-images.js:1289): spotter', S.upload(tSP, `sector-images/valeria/sector_a/img_${stamp}_x.jpg`), true);
  await expect('imagen de sector antigua (sector-images.js:1529): spotter borra', S.del(tSP, `sector-images/valeria/sector_a/img_${stamp}_x.jpg`), true);
  await expect('foto de rocódromo (gym-info.js:258): dueño', S.upload(tA, `gym-photos/${A.uid}/roco-1_${stamp}.jpg`), true);
  await expect('foto de rocódromo: borrado por admin (gym-info.js:267 / admin.js:3241)', S.del(await AD.token(), `gym-photos/${A.uid}/roco-1_${stamp}.jpg`), true);
  await expect('borrado de publicación (app_3.js:13765): el dueño borra su archivo', S.del(tA, `posts/${A.uid}/${stamp}_portada_x.jpg`), true);
  L.finish('client-compat-rules.cjs');
  process.exit(process.exitCode || 0);
})().catch(e => { console.error('ERROR FATAL', String(e.message).slice(0, 300), '\nÚltima prueba registrada:', L.results.length ? L.results[L.results.length - 1].label : '(ninguna)'); process.exit(2); });

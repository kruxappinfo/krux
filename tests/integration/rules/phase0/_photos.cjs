// Fábrica de fotos de vía válidas para las pruebas de Storage (cliente NUEVO de route-photos.js).
const BASE = 'https://firebasestorage.googleapis.com/v0/b/climbmaps-80cae.firebasestorage.app/o/';
let n = 0;
const rnd = () => { n++; return ('r' + n + 'abcdef').slice(0, 6).replace(/[^a-z0-9]/g, 'a'); };
function mkPhoto(u, FV, over = {}, at = Date.now(), school = 'valeria', route = 12) {
  const id = `${school}_${route}_${at}_${rnd()}`;
  const filename = `${id}.jpg`;
  const storagePath = `route-photos/${school}/${u.uid}/${filename}`;
  return { id, filename, storagePath, data: Object.assign({ photoUrl: `${BASE}${storagePath.replace(/\//g, '%2F')}?alt=media&token=abc-123`, uploadedBy: u.uid,
    uploadedByName: 'T', uploadedAt: FV.serverTimestamp(), routeId: route, routeName: 'Via', schoolId: school, filename, storagePath }, over) };
}

// Formato FINAL (Fase 0c, revisión final): id = {escuela}_{vía}_{16 caracteres [a-z0-9]}; photoUrl SIN token; uploadedAt lo pone el servidor.
let m = 0;
const rnd16 = () => { m++; return ('q' + Date.now().toString(36) + m.toString(36) + 'abcdefghijklmnop').replace(/[^a-z0-9]/g, 'a').slice(0, 16); };
function mkPhotoV2(u, FV, over = {}, school = 'valeria', route = 12, ext = 'jpg') {
  const id = `${school}_${route}_${rnd16()}`;
  const filename = `${id}.${ext}`;
  const storagePath = `route-photos/${school}/${u.uid}/${filename}`;
  return { id, filename, storagePath, data: Object.assign({ photoUrl: `${BASE}${storagePath.replace(/\//g, '%2F')}?alt=media`, uploadedBy: u.uid,
    uploadedByName: 'T', uploadedAt: FV.serverTimestamp(), routeId: route, routeName: 'Via', schoolId: school, filename, storagePath }, over) };
}
// Borrado como lo hace el cliente: documento + marca permanente en el MISMO lote
const delPhotoBatch = (u, id, over = {}) => {
  const b = u.db.batch();
  b.delete(u.db.collection('route-photos').doc(id));
  b.set(u.db.collection('route-photo-tombstones').doc(id), Object.assign({ deletedBy: u.uid, deletedAt: u.FV.serverTimestamp() }, over));
  return b.commit();
};
module.exports = { mkPhoto, mkPhotoV2, delPhotoBatch, BASE };

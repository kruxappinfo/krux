// ============================================================================================
// PROPUESTA — NO APLICADA. Nada de esto sustituye código de producción. Objetivo: que ninguna operación de borrado pueda
// hacer desaparecer trazados de sector_route_drawings sin que quede un rastro recuperable DENTRO del propio documento,
// además de la copia de seguridad que ya existe (kxBackupRouteDrawings, solo-añadir).
//
// Hallazgos que motivan esto (comprobados con el código real de admin.js / admin-routes.js / route-drawing.js):
//  - cleanOrphanedDrawings clasifica como «huérfano» todo trazado cuya vía no esté en pending_routes aprobadas ni en 3 GeoJSON
//    cableados (valeria, sanmartin, mora). Con los datos públicos de producción, ejecutarlo hoy eliminaría 313 de 388 trazados
//    (cuenca, patones y toledo completos). También lo haría cualquier fallo de red al cargar el GeoJSON (devuelve [] sin avisar).
//  - deleteRouteDrawingFromSector (admin-borrar-via) filtra por routeName: borra TODAS las variantes y fotos con ese nombre.
//  - Las copias de seguridad existen y son obligatorias, pero restaurar sustituye el documento ENTERO (pierde cambios posteriores).
// Diseño: «archivar en vez de borrar». Los trazados quitados pasan a archivedDrawings[] del mismo documento (con motivo, quién y cuándo),
// en una transacción (sin pérdida por concurrencia). Los lectores actuales ignoran el campo nuevo: no hay que tocar el visor.
// ============================================================================================

/** Mueve a archivedDrawings los trazados que cumplen `predicate`. Devuelve cuántos se archivaron. No borra nada. */
async function kxArchiveDrawingsTx(db, FieldValue, docId, predicate, meta) {
  const ref = db.collection('sector_route_drawings').doc(docId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return 0;
    const data = snap.data();
    const drawings = data.drawings || [];
    const moving = drawings.filter(predicate);
    if (!moving.length) return 0;
    const when = new Date().toISOString();   // los arrays de Firestore no admiten serverTimestamp()
    const archived = (data.archivedDrawings || []).concat(moving.map(d => Object.assign({}, d, {
      archivedAt: when, archivedBy: meta.by || null, archivedReason: meta.reason || 'sin-motivo' })));
    tx.update(ref, { drawings: drawings.filter(d => !predicate(d)), archivedDrawings: archived, updatedAt: FieldValue.serverTimestamp() });
    return moving.length;
  });
}

/** Devuelve a drawings los trazados archivados que cumplen `predicate` (quita las marcas de archivo). */
async function kxRestoreArchivedDrawingsTx(db, FieldValue, docId, predicate) {
  const ref = db.collection('sector_route_drawings').doc(docId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return 0;
    const data = snap.data();
    const archived = data.archivedDrawings || [];
    const back = archived.filter(predicate);
    if (!back.length) return 0;
    const clean = back.map(d => { const c = Object.assign({}, d); delete c.archivedAt; delete c.archivedBy; delete c.archivedReason; return c; });
    tx.update(ref, { drawings: (data.drawings || []).concat(clean), archivedDrawings: archived.filter(d => !predicate(d)), updatedAt: FieldValue.serverTimestamp() });
    return back.length;
  });
}

/** Cambia el imageId de los trazados de una foto retirada a otra foto (el administrador decide: las coordenadas son píxeles de la imagen). */
async function kxReassignDrawingsTx(db, FieldValue, docId, fromImageId, toImageId) {
  const ref = db.collection('sector_route_drawings').doc(docId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return 0;
    let n = 0;
    const drawings = (snap.data().drawings || []).map(d => { if (d.imageId === fromImageId) { n++; return Object.assign({}, d, { imageId: toImageId }); } return d; });
    if (n) tx.update(ref, { drawings, updatedAt: FieldValue.serverTimestamp() });
    return n;
  });
}

/**
 * Clasificación SIN escrituras para «limpiar huérfanos». Un trazado solo es «huerfano» si hay una fuente fiable que lo desmiente;
 * si la escuela no tiene fuente conocida, o la fuente no se pudo cargar, es «indeterminado» y NO se toca.
 * sources: { [schoolId]: Set(nombres de vía) | null }   (null = fuente conocida pero no cargada)
 */
function kxClassifyDrawings(drawingDocs, approvedKeys, sources) {
  const out = { seguro: [], huerfano: [], indeterminado: [] };
  for (const dd of drawingDocs) {
    const data = dd.data();
    const school = data.schoolId || dd.id.split('_')[0];
    const src = Object.prototype.hasOwnProperty.call(sources, school) ? sources[school] : undefined;
    for (const d of (data.drawings || [])) {
      const item = { docId: dd.id, routeName: d.routeName, imageId: d.imageId || null };
      if (approvedKeys.has(`${school}_${data.sectorName}_${d.routeName}`)) out.seguro.push(item);
      else if (src === undefined || src === null) out.indeterminado.push(item);
      else if (src.has(d.routeName)) out.seguro.push(item);
      else out.huerfano.push(item);
    }
  }
  return out;
}

module.exports = { kxArchiveDrawingsTx, kxRestoreArchivedDrawingsTx, kxReassignDrawingsTx, kxClassifyDrawings };

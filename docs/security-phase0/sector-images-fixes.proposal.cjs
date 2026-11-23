// ============================================================================================
// PROPUESTA FASE 0 — NO APLICADA. Correcciones de sector-images.js para revisión. No sustituye a ningún archivo.
// Es CommonJS con la base de datos inyectada para poder probarla en el emulador; si se aprueba, se trasladaría al estilo del
// proyecto (funciones globales, db y firebase del navegador).
//
// Problema 1 (concurrencia): subir, borrar y reordenar fotos de sector leen el array images[] completo, lo modifican y lo
// escriben de vuelta (sector-images.js: ~1330 subir, ~2604 reordenar, ~2646 borrar). Dos spotters a la vez → la última
// escritura pisa a la otra y se pierde una foto. Solución propuesta: transacción de Firestore (db.runTransaction), que
// reintenta si el documento cambió entre la lectura y la escritura. No cambia reglas ni estructura de datos.
//
// Problema 2 (trazados): deleteGalleryImage llama a deleteRouteDrawingsForImage, que quita de sector_route_drawings
// los dibujos de la foto borrada. Política: borrar una foto NUNCA borra trazados. Solución propuesta: no llamar a esa
// función (los dibujos conservan su imageId; sin foto asociada simplemente no se pintan, svApplyDrawingsForImage filtra por
// imageId). Esta propuesta NO escribe nada en sector_route_drawings, por tanto no necesita kxBackupRouteDrawings.
// ============================================================================================

/** Añade fotos al documento de galería de un sector de forma atómica (equivalente a la parte final de uploadSectorImages). */
async function kxAddGalleryImagesTx(db, FieldValue, docId, base, newImages) {
  const ref = db.collection('sector_images').doc(docId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) {
      tx.set(ref, Object.assign({}, base, { images: newImages.map((im, i) => Object.assign({}, im, { order: i })),
        createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }));
      return newImages.length;
    }
    const data = snap.data();
    // Compatibilidad con el formato antiguo (una sola imagen), como hace el código actual
    let images = Array.isArray(data.images) ? data.images
      : (data.imageUrl ? [{ id: 'legacy_0', url: data.imageUrl, storagePath: data.storagePath, order: 0, uploadedAt: data.uploadedAt, uploadedBy: data.uploadedBy }] : []);
    const merged = images.concat(newImages.map((im, i) => Object.assign({}, im, { order: images.length + i })));
    tx.update(ref, { images: merged, updatedAt: FieldValue.serverTimestamp() });
    return merged.length;
  });
}

/**
 * Quita UNA foto del array de forma atómica. No toca sector_route_drawings. Devuelve { removed, remaining, storagePath }.
 * El borrado del archivo en Storage se hace DESPUÉS de confirmar la transacción (si fallara, queda un archivo huérfano
 * recuperable, nunca un documento que apunta a un archivo inexistente por una transacción reintentada).
 */
async function kxRemoveGalleryImageTx(db, FieldValue, docId, imageId) {
  const ref = db.collection('sector_images').doc(docId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { removed: false, remaining: 0 };
    const images = snap.data().images || [];
    const target = images.find(im => im.id === imageId);
    if (!target) return { removed: false, remaining: images.length };
    const rest = images.filter(im => im.id !== imageId).map((im, i) => Object.assign({}, im, { order: i }));
    if (rest.length) tx.update(ref, { images: rest, updatedAt: FieldValue.serverTimestamp() });
    else tx.delete(ref);
    return { removed: true, remaining: rest.length, storagePath: target.storagePath };
  });
}

module.exports = { kxAddGalleryImagesTx, kxRemoveGalleryImageTx };

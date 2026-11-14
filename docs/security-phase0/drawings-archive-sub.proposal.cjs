// PROPUESTA FASE 0c — NO APLICADA. Archivado reversible con subcolección sector_route_drawings/{doc}/archived/{id}.
// Frente a archivedDrawings[] en el mismo documento (drawings-safety.proposal.cjs):
//  + inmune a kxRestoreRouteDrawings (set SIN merge: sustituye el documento entero y borraría un campo archivedDrawings),
//  + sin tope de 1 MiB por documento ni crecimiento de las copias de seguridad (cada copia guarda el documento completo),
//  + sin contención: un documento por trazado, y solo el documento padre entra en la transacción.
//  - hay que consultar la subcolección para ver/restaurar, y requiere un bloque nuevo de reglas (firestore.rules.drawings-archive.proposal.snippet).
const rnd = () => Math.random().toString(36).slice(2, 8);

/** Mueve a archived/ los trazados que cumplen predicate (una transacción: el trazado deja drawings y aparece archivado, o nada). */
async function kxArchiveToSubTx(db, FieldValue, docId, predicate, meta) {
  const ref = db.collection('sector_route_drawings').doc(docId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return 0;
    const drawings = snap.data().drawings || [];
    const moving = drawings.filter(predicate);
    if (!moving.length) return 0;
    moving.forEach((d, i) => tx.set(ref.collection('archived').doc(`${Date.now()}_${i}_${rnd()}`), {
      drawing: d, archivedAt: FieldValue.serverTimestamp(), archivedBy: meta.by, reason: meta.reason || 'sin-motivo',
      routeName: d.routeName || null, imageId: d.imageId || null }));
    tx.update(ref, { drawings: drawings.filter(d => !predicate(d)), updatedAt: FieldValue.serverTimestamp() });
    return moving.length;
  });
}

/** Restaura archivados (por ids). Evita duplicar un trazado que ya esté en drawings (p. ej. reintroducido por un cliente con datos viejos). */
async function kxRestoreFromSubTx(db, FieldValue, docId, archIds, sameDrawing) {
  const ref = db.collection('sector_route_drawings').doc(docId);
  return db.runTransaction(async (tx) => {
    const main = await tx.get(ref);
    const arch = await Promise.all(archIds.map(id => tx.get(ref.collection('archived').doc(id))));
    const live = main.exists ? (main.data().drawings || []) : [];
    const present = arch.filter(a => a.exists);
    const toRestore = present.filter(a => !live.some(l => sameDrawing(l, a.data().drawing)));
    // Solo se borra el archivado que de verdad vuelve a drawings (la regla exige que drawings crezca en la misma escritura).
    // Si el trazado ya estaba en drawings, su copia archivada se conserva: no se pierde nada y no se duplica.
    if (toRestore.length) {
      toRestore.forEach(a => tx.delete(a.ref));
      tx.set(ref, { drawings: live.concat(toRestore.map(a => a.data().drawing)), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    }
    return { restored: toRestore.length, duplicatesSkipped: present.length - toRestore.length };
  });
}
module.exports = { kxArchiveToSubTx, kxRestoreFromSubTx };

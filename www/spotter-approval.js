// ================== APROBACIÓN DE PROPUESTAS SPOTTER ==================
// Camino único para aprobar una propuesta (vía, POI, sector o escuela) y bonificar a quien la creó.
// Lo usan los tres paneles de administración: admin.js, admin-routes.js y el panel integrado de app_3.js.

// ============================================
// PUNTOS POR PROPUESTA APROBADA
// ============================================
const KX_SPOTTER_POINTS = {
  pending_routes: 10,
  pending_poi: 5,
  pending_schools: 15,
  pending_sectors: 15
};

/**
 * Decide los puntos que tocan al aprobar una propuesta. Función pura.
 * No bonifica dos veces la misma propuesta, ni la que aprueba su propio autor,
 * ni la de alguien que ya no es spotter (sin documento en admins/).
 * @returns {{ points: number, reason: string|null }}
 */
function kxSpotterAward(collection, pending, approverUid, creatorIsSpotter) {
  const points = KX_SPOTTER_POINTS[collection] || 0;
  if (!points) return { points: 0, reason: 'sin-puntos' };
  if (!pending || !pending.createdBy) return { points: 0, reason: 'sin-autor' };
  if (pending.pointsAwarded) return { points: 0, reason: 'ya-bonificada' };
  if (pending.createdBy === approverUid) return { points: 0, reason: 'autor-aprueba' };
  if (!creatorIsSpotter) return { points: 0, reason: 'autor-no-spotter' };
  return { points, reason: null };
}

// ============================================
// APROBAR (estado + puntos en una sola transacción)
// ============================================

/**
 * Aprueba una propuesta y suma los puntos a su autor de forma atómica.
 * Si las reglas no dejan tocar los puntos (admin sin ese permiso), aprueba igualmente y lo indica.
 * @returns {Promise<{ points: number, reason: string|null }>}
 */
async function kxApprovePending(collection, docId) {
  const fs = firebase.firestore();
  const user = firebase.auth().currentUser;
  if (!user) throw new Error('Sin sesión');
  const pendingRef = fs.collection(collection).doc(docId);
  const approval = () => ({
    status: 'approved',
    approvedAt: firebase.firestore.FieldValue.serverTimestamp(),
    approvedBy: user.email || user.uid
  });

  try {
    return await fs.runTransaction(async tx => {
      const snap = await tx.get(pendingRef);
      if (!snap.exists) throw new Error('La propuesta ya no existe');
      const pending = snap.data();
      const creatorRef = pending.createdBy ? fs.collection('admins').doc(pending.createdBy) : null;
      // Solo se lee el documento del autor si puede haber bonificación
      const mayAward = kxSpotterAward(collection, pending, user.uid, true).points > 0;
      const creatorSnap = mayAward ? await tx.get(creatorRef) : null;
      const isSpotter = !!(creatorSnap && creatorSnap.exists && creatorSnap.data().role === 'spotter');
      const award = kxSpotterAward(collection, pending, user.uid, isSpotter);

      const update = approval();
      if (award.points) {
        update.pointsAwarded = award.points;
        tx.update(creatorRef, { points: firebase.firestore.FieldValue.increment(award.points) });
      }
      tx.update(pendingRef, update);
      return award;
    });
  } catch (error) {
    if (!error || error.code !== 'permission-denied') throw error;
    // Sin permiso sobre admins/{autor}: la aprobación no debe quedarse a medias por los puntos
    console.warn('[Spotter] Aprobada sin bonificar (permiso denegado sobre los puntos):', error.message);
    await pendingRef.update(approval());
    return { points: 0, reason: 'sin-permiso' };
  }
}

/** Texto del aviso tras aprobar, según lo que haya pasado con los puntos. */
function kxApprovalMessage(base, award) {
  if (award && award.points) return `${base}\n+${award.points} pts para quien la propuso`;
  if (award && award.reason === 'sin-permiso') return `${base}\nNo se pudieron sumar los puntos`;
  return base;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { KX_SPOTTER_POINTS, kxSpotterAward, kxApprovalMessage };
}

// ============================================================================================
// PROPUESTA FASE 0c — APLICADA en la Implementación 1 (admin.js y admin-routes.js, sección «INFORME DE TRAZADOS (SOLO LECTURA)»;
// la versión aplicada añade un modal con el informe y sustituye deleteRouteDrawingFromSector por kxCountRouteDrawings). Se conserva como referencia.
// Sustituiría a cleanOrphanedDrawings() de admin.js (~1832) y admin-routes.js (~554), y a
// deleteRouteDrawingFromSector() de ambos. Es código de navegador (usa db, fetch, showToast, firebase como globales), pensado para
// pegarse tal cual; las pruebas (drawings-0c.cjs) lo cargan en un contexto aislado con un Firestore que LANZA ERROR ante cualquier escritura.
//
// Principios:
//  1. El limpiador es EXCLUSIVAMENTE INFORMATIVO: no llama a set, update, delete ni a kxBackupRouteDrawings. Mismo nombre y mismo botón
//     (admin.html / admin-routes.html), así que los clientes cacheados no cambian de comportamiento visible salvo por el aviso.
//  2. Cada trazado se clasifica en «seguro», «huerfano» o «indeterminado». «huerfano» exige una fuente VERIFICADA que lo desmienta.
//  3. Cualquier duda —escuela sin GeoJSON cableado, fuente no cargada (red, HTTP, JSON inválido, sin vías), sector ausente en la fuente,
//     lista de vías aprobadas no cargada, trazado sin nombre, vía presente en otro sector— es «indeterminado». Nunca «huerfano».
//  4. La ausencia de la FOTO (imageId) nunca clasifica un trazado como huérfano.
//  5. Borrar o rechazar una vía NO borra trazados (deleteRouteDrawingFromSector pasa a ser informativa).
// ============================================================================================

const KX_ORPHAN_SOURCES = {
  valeria: 'Cartografia/Valeria/Valeria_Vias.geojson',
  sanmartin: 'Cartografia/San Martin de ValdeIglesias/SM_Vias.geojson',
  mora: 'Cartografia/Mora/Mora_Vias.geojson'
};

function kxNormName(s) {
  return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Carga la fuente GeoJSON de una escuela. Nunca lanza. status: 'ok' | 'sin-fuente' | 'no-cargada'. */
async function kxLoadRouteSource(schoolId) {
  const path = KX_ORPHAN_SOURCES[schoolId];
  if (!path) return { status: 'sin-fuente' };
  try {
    const response = await fetch(path + '?v=' + Date.now());
    if (!response || !response.ok) return { status: 'no-cargada', reason: 'HTTP ' + (response && response.status) };
    const geojson = await response.json();
    if (!geojson || !Array.isArray(geojson.features) || geojson.features.length === 0) return { status: 'no-cargada', reason: 'sin vías' };
    const bySector = Object.create(null);   // sector normalizado -> { nombre normalizado: true }
    const anySector = Object.create(null);  // nombre normalizado -> { sector normalizado: true }
    for (const f of geojson.features) {
      const p = f && f.properties;
      if (!p || !p.sector || !p.nombre) continue;
      const s = kxNormName(p.sector), n = kxNormName(p.nombre);
      (bySector[s] = bySector[s] || Object.create(null))[n] = true;
      (anySector[n] = anySector[n] || Object.create(null))[s] = true;
    }
    if (Object.keys(bySector).length === 0) return { status: 'no-cargada', reason: 'sin vías con sector y nombre' };
    return { status: 'ok', bySector, anySector };
  } catch (e) {
    return { status: 'no-cargada', reason: String((e && e.message) || e) };
  }
}

/** Vías aprobadas o pendientes (un trazado de una vía pendiente tampoco es huérfano). null si no se pudieron leer. */
async function kxLoadKnownRoutes() {
  try {
    const keys = Object.create(null);
    for (const status of ['approved', 'pending']) {
      const snap = await db.collection('pending_routes').where('status', '==', status).get();
      snap.forEach(doc => { const d = doc.data(); keys[kxNormName(d.schoolId) + '|' + kxNormName(d.sector) + '|' + kxNormName(d.nombre)] = true; });
    }
    return keys;
  } catch (e) {
    return null;
  }
}

/** Clasificación PURA de un trazado. Devuelve { clase, motivo }. */
function kxClassifyOne(drawing, school, sectorName, known, source) {
  const name = kxNormName(drawing && drawing.routeName);
  if (!name) return { clase: 'indeterminado', motivo: 'trazado-sin-nombre' };
  if (known === null) return { clase: 'indeterminado', motivo: 'vias-aprobadas-no-cargadas' };
  const sector = kxNormName(sectorName);
  if (known[kxNormName(school) + '|' + sector + '|' + name]) return { clase: 'seguro', motivo: 'vía-aprobada-o-pendiente' };
  if (!source || source.status === 'sin-fuente') return { clase: 'indeterminado', motivo: 'escuela-sin-fuente' };
  if (source.status !== 'ok') return { clase: 'indeterminado', motivo: 'fuente-no-cargada' };
  const inSector = source.bySector[sector];
  if (!inSector) return { clase: 'indeterminado', motivo: 'sector-ausente-en-la-fuente' };
  if (inSector[name]) return { clase: 'seguro', motivo: 'geojson' };
  if (source.anySector[name]) return { clase: 'indeterminado', motivo: 'vía-presente-en-otro-sector' };
  return { clase: 'huerfano', motivo: 'no-está-en-aprobadas-ni-en-geojson-verificado' };
}

/** Construye el informe. Solo lee. */
async function kxBuildOrphanReport() {
  const known = await kxLoadKnownRoutes();
  const snapshot = await db.collection('sector_route_drawings').get();
  const sources = {};
  const items = [];
  for (const doc of snapshot.docs) {
    const data = doc.data();
    const school = data.schoolId || String(doc.id).split('_')[0];
    if (!(school in sources)) sources[school] = await kxLoadRouteSource(school);
    for (const d of (data.drawings || [])) {
      const r = kxClassifyOne(d, school, data.sectorName, known, sources[school]);
      items.push({ docId: doc.id, schoolId: school, sectorName: data.sectorName || null, routeName: d.routeName || null,
        imageId: d.imageId || null, clase: r.clase, motivo: r.motivo });
    }
  }
  const totals = { seguro: 0, huerfano: 0, indeterminado: 0 };
  items.forEach(i => { totals[i.clase]++; });
  const srcStatus = {};
  Object.keys(sources).forEach(s => { srcStatus[s] = sources[s].status + (sources[s].reason ? ' (' + sources[s].reason + ')' : ''); });
  return { generatedAt: new Date().toISOString(), total: items.length, totals, fuentes: srcStatus, items };
}

/** Sustituye a cleanOrphanedDrawings(): mismo nombre y botón; SOLO informa. */
async function cleanOrphanedDrawings() {
  showToast('Analizando trazados (solo lectura, no se borra nada)...', 'info');
  try {
    const report = await kxBuildOrphanReport();
    const t = report.totals;
    console.log('[Trazados] Informe de huérfanos (solo lectura):', report);
    showToast(`${report.total} trazados: ${t.seguro} seguros, ${t.huerfano} candidatos a huérfano, ${t.indeterminado} indeterminados. No se ha borrado nada.`, 'info');
    return report;
  } catch (error) {
    console.error('[Trazados] Error generando el informe:', error);
    showToast('No se pudo generar el informe de trazados', 'error');
    return null;
  }
}

/**
 * Sustituye a deleteRouteDrawingFromSector(): borrar o rechazar una vía NO elimina trazados. Solo informa de cuántos coinciden
 * por nombre (para que una persona decida). Una retirada explícita iría por kxArchiveDrawingsTx (drawings-safety.proposal.cjs).
 */
async function deleteRouteDrawingFromSector(schoolId, sectorName, routeName) {
  try {
    const docId = `${schoolId}_${normalizeSectorNameForDrawing(sectorName)}`;
    const doc = await db.collection('sector_route_drawings').doc(docId).get();
    const n = doc.exists ? (doc.data().drawings || []).filter(d => d.routeName === routeName).length : 0;
    if (n) console.log(`[Trazados] La vía "${routeName}" tiene ${n} trazado(s). Se conservan; retirarlos es una acción aparte.`);
    return n;
  } catch (error) {
    console.error('[Trazados] Error consultando trazados de la vía:', error);
    return 0;
  }
}

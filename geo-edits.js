// ================== CARTOGRAFÍA: MOVER PUNTOS (SUPERADMIN) ==================
// Botón «Mover puntos» en la columna de controles del mapa, solo para el superadmin. Con el modo activo,
// un toque en una vía, un grupo de variantes, un parking, un punto de interés o un rocódromo lo selecciona;
// se arrastra a su sitio y se guarda en geojson_ediciones (ver «PUNTOS MOVIDOS» en maplibre-map.js).
// También pinta la sección «Cartografía» del panel de administración: los geojson de cada escuela
// para descargarlos ya con los puntos movidos aplicados.

const KX_GEO_SUPERADMIN = 'krux.app.info@gmail.com';

// Capa del mapa → capa del documento de ediciones y fuente con los datos
const KX_GEO_PICK_LAYERS = {
  'vias-layer': { layer: 'vias', source: 'vias-source', label: 'Vía' },
  'parkings-layer': { layer: 'parkings', source: 'parkings-source', label: 'Parking' },
  'puntos-interes-layer': { layer: 'puntosInteres', source: 'puntos-interes-source', label: 'Punto de interés' },
  'gym-markers-layer': { layer: 'rocodromos', source: 'gyms-source', label: 'Rocódromo' }
};

const KX_GEO_FILE_LABELS = {
  vias: 'Vías',
  sectores: 'Sectores',
  parkings: 'Parkings',
  puntosInteres: 'Puntos de interés',
  rutasAcceso: 'Rutas de acceso'
};

const _geoSvg = paths => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const KX_GEO_ICONS = {
  move: _geoSvg('<path d="M12 3v18M3 12h18"/><path d="M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3"/>'),
  close: _geoSvg('<path d="M6 6l12 12M18 6L6 18"/>'),
  download: _geoSvg('<path d="M12 4v11"/><path d="M7 10l5 5 5-5"/><path d="M5 20h14"/>')
};

const kxGeo = {
  active: false,
  selection: null,   // { docId, items: [{ layer, key, coords, nombre }], label, nombre, anchor, marker, moved }
  saving: false
};

function kxGeoIsSuperAdmin() {
  const u = typeof auth !== 'undefined' && auth ? auth.currentUser : null;
  return !!u && u.email === KX_GEO_SUPERADMIN;
}

function kxGeoEsc(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function kxGeoToast(message, type = 'info') {
  if (typeof showToast === 'function') showToast(message, type);
  else console.log('[Cartografía]', message);
}

// ============================================
// BOTÓN DEL MAPA
// ============================================

// Arriba del todo en la columna de controles (abajo a la derecha), como el botón Spotter
function _kxGeoPlaceButton(btn) {
  const stack = document.querySelector('#map .maplibregl-ctrl-bottom-right');
  if (stack && btn.parentElement !== stack) stack.insertBefore(btn, stack.firstChild);
}

function kxGeoSyncButton() {
  const existing = document.getElementById('btn-geo-edit');
  if (!kxGeoIsSuperAdmin()) {
    kxGeoExitMode();
    if (existing) existing.remove();
    return;
  }
  if (existing) { _kxGeoPlaceButton(existing); return; }

  const host = document.getElementById('map');
  if (!host) return;
  const btn = document.createElement('button');
  btn.id = 'btn-geo-edit';
  btn.type = 'button';
  btn.className = 'map-control-btn maplibregl-ctrl kx-ctrl-edit kx-ctrl-geo';
  btn.innerHTML = KX_GEO_ICONS.move;
  btn.title = 'Mover puntos';
  btn.setAttribute('aria-label', 'Mover puntos del mapa');
  btn.setAttribute('aria-pressed', 'false');
  btn.style.display = 'flex';
  btn.addEventListener('click', () => (kxGeo.active ? kxGeoExitMode() : kxGeoEnterMode()));
  host.appendChild(btn);
  _kxGeoPlaceButton(btn);
}

// ============================================
// MODO «MOVER PUNTOS»
// ============================================

function kxGeoEnterMode() {
  if (!kxGeoIsSuperAdmin() || typeof mlMap === 'undefined' || !mlMap) return;
  kxGeo.active = true;
  kxPointEditMode = true;
  // Cierra lo que hubiera abierto: una ficha encima taparía el punto
  [typeof hideBottomSheet === 'function' && hideBottomSheet, typeof hideSectorBottomSheet === 'function' && hideSectorBottomSheet]
    .forEach(fn => { if (fn) { try { fn(); } catch (e) {} } });
  document.querySelectorAll('.maplibregl-popup').forEach(p => p.remove());
  mlMap.on('click', kxGeoOnMapClick);
  const btn = document.getElementById('btn-geo-edit');
  if (btn) { btn.classList.add('is-active'); btn.setAttribute('aria-pressed', 'true'); }
  kxGeoRenderBar();
}

function kxGeoExitMode() {
  if (!kxGeo.active) return;
  kxGeoClearSelection();
  kxGeo.active = false;
  kxPointEditMode = false;
  if (typeof mlMap !== 'undefined' && mlMap) mlMap.off('click', kxGeoOnMapClick);
  const btn = document.getElementById('btn-geo-edit');
  if (btn) { btn.classList.remove('is-active'); btn.setAttribute('aria-pressed', 'false'); }
  const bar = document.getElementById('kx-geo-bar');
  if (bar) bar.remove();
}

// Toque en el mapa: el punto editable más cercano dentro de un margen cómodo para el dedo
function kxGeoOnMapClick(e) {
  if (!kxGeo.active || kxGeo.saving) return;
  const layers = Object.keys(KX_GEO_PICK_LAYERS).filter(id => mlMap.getLayer(id));
  if (!layers.length) return;
  const pad = 14;
  const box = [[e.point.x - pad, e.point.y - pad], [e.point.x + pad, e.point.y + pad]];
  const hits = mlMap.queryRenderedFeatures(box, { layers });
  if (!hits.length) return;
  let best = hits[0];
  let bestDist = Infinity;
  for (const f of hits) {
    const c = f.geometry && f.geometry.type === 'Point' ? f.geometry.coordinates : null;
    if (!c) continue;
    const p = mlMap.project(c);
    const d = (p.x - e.point.x) ** 2 + (p.y - e.point.y) ** 2;
    if (d < bestDist) { bestDist = d; best = f; }
  }
  kxGeoPickFeature(best);
}

// Coordenadas completas del punto en los datos de su fuente (las de la capa pintada pierden precisión)
function kxGeoSourceCoords(sourceId, key) {
  const src = mlMap.getSource(sourceId);
  const features = src && src._data && Array.isArray(src._data.features) ? src._data.features : [];
  const f = features.find(x => kxGeoFeatureKey(x.properties) === key);
  if (!f || !f.geometry) return null;
  if (f.geometry.type === 'Point') return f.geometry.coordinates.slice();
  if (f.geometry.type === 'MultiPoint' && f.geometry.coordinates.length === 1) return f.geometry.coordinates[0].slice();
  return null;
}

function kxGeoFeatureName(props, label) {
  return props.nombre || props.Nombre || props.descripcio || props.descripcion || props.Descripcion || props.Descripcio || label;
}

function kxGeoPickFeature(f) {
  const cfg = KX_GEO_PICK_LAYERS[f.layer && f.layer.id];
  if (!cfg) return;
  const key = kxGeoFeatureKey(f.properties);
  const docId = cfg.layer === 'rocodromos' ? 'rocodromos' : mlCurrentSchool;
  if (!key || !docId) {
    kxGeoToast('Este punto no tiene identificador en el geojson: no se puede mover', 'error');
    return;
  }
  const coords = kxGeoSourceCoords(cfg.source, key) || f.geometry.coordinates.slice();
  const nombre = kxGeoFeatureName(f.properties, cfg.label);
  kxGeoSelect({ docId, label: cfg.label, nombre, anchor: coords, items: [{ layer: cfg.layer, key, coords, nombre }] });
}

// Grupo de variantes (marcador concéntrico): se mueven todas a la vez, manteniendo sus separaciones
function kxGeoPickVariantGroup(group, centroid) {
  if (!kxGeo.active || kxGeo.saving || !mlCurrentSchool) return;
  const items = group
    .map(gf => ({ layer: 'vias', key: kxGeoFeatureKey(gf.props), coords: gf.coords && gf.coords.slice(), nombre: gf.props.nombre || '' }))
    .filter(it => it.key && it.coords);
  if (!items.length) return;
  const nombre = items.map(it => it.nombre).filter(Boolean).join(' · ') || 'Vías';
  kxGeoSelect({ docId: mlCurrentSchool, label: `Grupo de ${items.length} vías`, nombre, anchor: centroid.slice(), items });
}

function kxGeoSelect(sel) {
  kxGeoClearSelection();
  const el = document.createElement('div');
  el.className = 'kx-geo-handle';
  el.setAttribute('aria-hidden', 'true');
  const marker = new maplibregl.Marker({ element: el, draggable: true, anchor: 'center' })
    .setLngLat(sel.anchor)
    .addTo(mlMap);
  marker.on('dragstart', () => el.classList.add('is-dragging'));
  marker.on('dragend', () => {
    el.classList.remove('is-dragging');
    kxGeo.selection.moved = true;
    kxGeoRenderBar();
  });
  kxGeo.selection = { ...sel, marker, moved: false, hasEdit: false };
  kxGeoRenderBar();
  // ¿Ya estaba movido? Entonces se ofrece devolverlo a la posición del archivo
  kxGeoEditsFor(sel.docId).then(edits => {
    if (kxGeo.selection && kxGeo.selection.marker === marker) {
      kxGeo.selection.hasEdit = sel.items.some(it => edits[it.layer + '|' + it.key]);
      kxGeoRenderBar();
    }
  });
}

function kxGeoClearSelection() {
  if (kxGeo.selection && kxGeo.selection.marker) {
    try { kxGeo.selection.marker.remove(); } catch (e) {}
  }
  kxGeo.selection = null;
  if (kxGeo.active) kxGeoRenderBar();
}

// ============================================
// BARRA DEL MODO
// ============================================

function kxGeoRenderBar() {
  if (!kxGeo.active) return;
  let bar = document.getElementById('kx-geo-bar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'kx-geo-bar';
    bar.className = 'kx-geo-bar';
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', 'Mover puntos');
    (document.getElementById('map-view') || document.body).appendChild(bar);
    bar.addEventListener('click', kxGeoOnBarClick);
  }
  const sel = kxGeo.selection;
  const busy = kxGeo.saving ? ' disabled' : '';
  if (!sel) {
    bar.innerHTML = `
      <div class="kx-geo-bar-head">
        <div class="kx-geo-bar-text">
          <span class="kx-geo-bar-kicker">Mover puntos</span>
          <span class="kx-geo-bar-title">Toca una vía, un parking, un punto de interés o un rocódromo</span>
        </div>
        <button type="button" class="kx-geo-iconbtn" data-geo="exit" aria-label="Salir de mover puntos">${KX_GEO_ICONS.close}</button>
      </div>`;
    return;
  }
  const hint = sel.moved ? 'Nueva posición lista para guardar' : 'Arrastra el marcador hasta su sitio';
  bar.innerHTML = `
    <div class="kx-geo-bar-head">
      <div class="kx-geo-bar-text">
        <span class="kx-geo-bar-kicker">${kxGeoEsc(sel.label)}</span>
        <span class="kx-geo-bar-title">${kxGeoEsc(sel.nombre)}</span>
        <span class="kx-geo-bar-hint">${hint}</span>
      </div>
      <button type="button" class="kx-geo-iconbtn" data-geo="exit" aria-label="Salir de mover puntos">${KX_GEO_ICONS.close}</button>
    </div>
    <div class="kx-geo-bar-actions">
      ${sel.hasEdit ? `<button type="button" class="kx-geo-link" data-geo="restore"${busy}>Volver a la posición original</button>` : ''}
      <button type="button" class="kx-geo-btn" data-geo="cancel"${busy}>Cancelar</button>
      <button type="button" class="kx-geo-btn is-primary" data-geo="save"${sel.moved && !kxGeo.saving ? '' : ' disabled'}>${kxGeo.saving ? 'Guardando…' : 'Guardar'}</button>
    </div>`;
}

function kxGeoOnBarClick(e) {
  const btn = e.target.closest('[data-geo]');
  if (!btn || btn.disabled) return;
  const action = btn.dataset.geo;
  if (action === 'exit') kxGeoExitMode();
  else if (action === 'cancel') kxGeoClearSelection();
  else if (action === 'save') kxGeoSave();
  else if (action === 'restore') kxGeoRestore();
}

// ============================================
// GUARDAR Y RESTAURAR
// ============================================

const kxGeoRound = n => Math.round(n * 1e8) / 1e8;   // 8 decimales ≈ 1 mm

function kxGeoSaveError(err) {
  console.error('[Cartografía] Error guardando:', err);
  const denied = err && err.code === 'permission-denied';
  kxGeoToast(denied
    ? 'Firestore aún no permite guardar puntos movidos: falta desplegar la regla de geojson_ediciones'
    : 'No se ha podido guardar: ' + (err && err.message ? err.message : 'error desconocido'), 'error');
}

async function kxGeoSave() {
  const sel = kxGeo.selection;
  if (!sel || !sel.moved || kxGeo.saving || !kxGeoIsSuperAdmin()) return;
  const ll = sel.marker.getLngLat();
  const dLng = ll.lng - sel.anchor[0];
  const dLat = ll.lat - sel.anchor[1];
  kxGeo.saving = true;
  kxGeoRenderBar();
  try {
    const current = await kxGeoEditsFor(sel.docId, { fresh: true });
    const file = sel.docId === 'rocodromos' ? KX_GYMS_GEOJSON : null;
    const now = firebase.firestore.Timestamp.now();
    const edits = {};
    for (const it of sel.items) {
      const k = it.layer + '|' + it.key;
      const prev = current[k];
      edits[k] = {
        layer: it.layer,
        key: it.key,
        nombre: it.nombre || '',
        file: file || (MAPLIBRE_SCHOOLS[sel.docId] && MAPLIBRE_SCHOOLS[sel.docId].geojson[it.layer]) || '',
        coordinates: [kxGeoRound(it.coords[0] + dLng), kxGeoRound(it.coords[1] + dLat)],
        // La posición del archivo se guarda la primera vez y no cambia aunque se mueva varias veces
        original: prev && Array.isArray(prev.original) ? prev.original : [it.coords[0], it.coords[1]],
        movedAt: now,
        movedBy: auth.currentUser.uid
      };
    }
    await firebase.firestore().collection(KX_GEO_EDITS_COLLECTION).doc(sel.docId).set({
      docId: sel.docId,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      edits
    }, { merge: true });
    kxGeoToast(sel.items.length > 1 ? `${sel.items.length} vías movidas` : 'Punto movido', 'success');
    await kxGeoAfterChange(sel.docId);
  } catch (err) {
    kxGeoSaveError(err);
  } finally {
    kxGeo.saving = false;
    kxGeoRenderBar();
  }
}

async function kxGeoRestore() {
  const sel = kxGeo.selection;
  if (!sel || kxGeo.saving || !kxGeoIsSuperAdmin()) return;
  kxGeo.saving = true;
  kxGeoRenderBar();
  try {
    const ref = firebase.firestore().collection(KX_GEO_EDITS_COLLECTION).doc(sel.docId);
    const del = firebase.firestore.FieldValue.delete();
    const args = [];
    sel.items.forEach(it => args.push(new firebase.firestore.FieldPath('edits', it.layer + '|' + it.key), del));
    await ref.update(new firebase.firestore.FieldPath('updatedAt'), firebase.firestore.FieldValue.serverTimestamp(), ...args);
    kxGeoToast('Punto devuelto a la posición del archivo', 'success');
    await kxGeoAfterChange(sel.docId);
  } catch (err) {
    kxGeoSaveError(err);
  } finally {
    kxGeo.saving = false;
    kxGeoRenderBar();
  }
}

// Vuelve a pintar con las posiciones nuevas: la escuela entera (rehace también los grupos de variantes) o los rocódromos
async function kxGeoAfterChange(docId) {
  kxGeoClearSelection();
  await kxGeoEditsFor(docId, { fresh: true });
  if (docId === 'rocodromos') {
    const src = mlMap.getSource('gyms-source');
    if (src) src.setData(await kxGeoFetchJSON(KX_GYMS_GEOJSON));
    return;
  }
  const school = MAPLIBRE_SCHOOLS[docId];
  if (school && school.geojson && school.geojson.vias) kxRoutesGeojsonCache.delete(school.geojson.vias);
  if (mlCurrentSchool === docId) await mlLoadSchool(docId, true);
}

// ============================================
// PANEL DE ADMINISTRACIÓN: SECCIÓN «CARTOGRAFÍA»
// ============================================

function kxGeoFileName(url) {
  return decodeURIComponent(url.split('/').pop());
}

// Mismo formato que exporta QGIS: cabecera en líneas sueltas y una línea por elemento
function kxGeoSerialize(geojson) {
  const head = Object.keys(geojson)
    .filter(k => k !== 'features')
    .map(k => `${JSON.stringify(k)}: ${JSON.stringify(geojson[k])},`);
  const features = (geojson.features || []).map(f => JSON.stringify(f)).join(',\n');
  return `{\n${head.join('\n')}\n"features": [\n${features}\n]\n}\n`;
}

async function kxGeoDownload(url, btn) {
  if (btn) btn.disabled = true;
  try {
    const data = kxGeoFileMeta(url)
      ? await kxGeoFetchJSON(url)
      : await fetch(url).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); });
    const name = kxGeoFileName(url);
    const blob = new Blob([kxGeoSerialize(data)], { type: 'application/geo+json' });
    // En la app nativa no hay descargas: se abre la hoja de compartir del sistema (Guardar en Archivos, AirDrop…)
    const native = typeof window.Capacitor !== 'undefined' && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform();
    const file = typeof File === 'function' ? new File([blob], name, { type: 'application/geo+json' }) : null;
    if (native && file && navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: name });
      return;
    }
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  } catch (err) {
    if (err && err.name === 'AbortError') return;   // compartir cancelado
    console.error('[Cartografía] Error descargando', url, err);
    kxGeoToast('No se ha podido descargar ' + kxGeoFileName(url), 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

function kxGeoAdminRow(url, label, moved) {
  return `
    <div class="kx-geo-file">
      <div class="kx-geo-file-text">
        <span class="kx-geo-file-label">${kxGeoEsc(label)}</span>
        <span class="kx-geo-file-name">${kxGeoEsc(kxGeoFileName(url))}</span>
      </div>
      ${moved ? `<span class="kx-geo-file-badge">${moved} ${moved === 1 ? 'punto movido' : 'puntos movidos'}</span>` : ''}
      <button type="button" class="kx-geo-file-dl" data-url="${kxGeoEsc(url)}" aria-label="Descargar ${kxGeoEsc(kxGeoFileName(url))}">
        ${KX_GEO_ICONS.download}<span>Descargar</span>
      </button>
    </div>`;
}

async function kxGeoRenderAdmin(container) {
  if (!container) return;
  if (!kxGeoIsSuperAdmin()) {
    container.innerHTML = '<p class="kx-geo-empty">Solo el superadmin puede ver la cartografía.</p>';
    return;
  }
  container.innerHTML = '<div class="admin-loading"><div class="admin-spinner"></div><p>Cargando cartografía…</p></div>';

  const schools = Object.entries(MAPLIBRE_SCHOOLS)
    .filter(([, s]) => s.geojson)
    .sort(([, a], [, b]) => a.name.localeCompare(b.name, 'es'));
  const docIds = [...schools.map(([id]) => id), 'rocodromos'];
  // Siempre la versión del servidor: el panel sirve para trabajar sobre los archivos al día
  const allEdits = await Promise.all(docIds.map(id => kxGeoEditsFor(id, { fresh: true })));
  const editsOf = Object.fromEntries(docIds.map((id, i) => [id, allEdits[i] || {}]));
  const countMoved = (docId, layer) => Object.keys(editsOf[docId]).filter(k => k.startsWith(layer + '|')).length;

  const cards = schools.map(([id, s]) => {
    const rows = Object.keys(KX_GEO_FILE_LABELS)
      .filter(layer => s.geojson[layer])
      .map(layer => kxGeoAdminRow(s.geojson[layer], KX_GEO_FILE_LABELS[layer], KX_GEO_EDITABLE_LAYERS.includes(layer) ? countMoved(id, layer) : 0));
    return `
      <div class="admin-card kx-geo-school">
        <div class="admin-card-header">${kxGeoEsc(s.name)}</div>
        <div class="admin-card-body">${rows.join('')}</div>
      </div>`;
  });
  cards.push(`
    <div class="admin-card kx-geo-school">
      <div class="admin-card-header">Rocódromos</div>
      <div class="admin-card-body">${kxGeoAdminRow(KX_GYMS_GEOJSON, 'Rocódromos', countMoved('rocodromos', 'rocodromos'))}</div>
    </div>`);

  container.innerHTML = cards.join('');
  if (!container.dataset.geoBound) {
    container.dataset.geoBound = '1';
    container.addEventListener('click', e => {
      const btn = e.target.closest('.kx-geo-file-dl');
      if (btn) kxGeoDownload(btn.dataset.url, btn);
    });
  }
}

// ============================================
// INICIALIZACIÓN
// ============================================

function initGeoEdits() {
  if (typeof auth === 'undefined' || !auth) return;
  auth.onAuthStateChanged(() => kxGeoSyncButton());
  // El mapa crea la columna de controles al iniciarse: el botón se coloca entonces
  window.addEventListener('maplibre:ready', () => kxGeoSyncButton());
  kxGeoSyncButton();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initGeoEdits);
} else {
  initGeoEdits();
}

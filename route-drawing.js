/**
 * Route Drawing Module - Dibujo de Vías en Imágenes de Sector
 *
 * Funcionalidades:
 * - Dibujar líneas de vías sobre imágenes de sectores
 * - Vincular vías de Firestore con dibujos en la imagen
 * - Editor visual estilo La Pirca / Climb Around
 * - Solo disponible para administradores
 */

// ============================================
// VARIABLES GLOBALES
// ============================================
let rdCanvas = null;                    // Canvas para dibujar
let rdCtx = null;                       // Contexto 2D del canvas
let rdImage = null;                     // Imagen del sector cargada
let rdCurrentSector = null;             // {schoolId, sectorName}
let rdDrawingMode = false;              // Modo de dibujo activo
let rdCurrentRoute = null;              // Vía actual siendo dibujada/editada
let rdRouteDrawings = [];               // Array de dibujos guardados
let rdDrawingPoints = [];               // Array de puntos del dibujo actual
let rdRoutesList = [];
let rdDrawingsLoadFailed = false;       // true si falló loadRouteDrawings: se bloquean los guardados                  // Lista de vías del sector
let rdPendingRouteInfo = null;          // Info de vía pendiente {routeName, docId} - para modo obligatorio
let rdMandatoryDrawingMode = false;     // Modo dibujo obligatorio (no se puede cerrar sin dibujar)
let rdEditMode = false;                 // Modo edición (editando un dibujo existente)
let rdTopoNumbers = new Map();          // Número de croquis de cada trazado (correlativo en todo el sector)
let rdOtherDrawings = [];               // Trazados de las demás fotos del sector (solo para numerar)
let rdLastPointTap = { index: -1, time: 0 }; // Último toque sobre un punto (doble toque = eliminar)
let rdOriginalDrawing = null;           // Dibujo original siendo editado (para restaurar si se cancela)
let rdDraggingPointIndex = -1;          // Índice del punto siendo arrastrado (-1 = ninguno)
let rdIsDragging = false;               // Si estamos arrastrando un punto
let rdSelectedPointIndex = -1;          // Índice del punto seleccionado para eliminar (-1 = ninguno)
let rdSectorImages = [];                // Array de imágenes del sector (para navegación)
let rdCurrentImageIndex = 0;            // Índice de imagen actual en rdSectorImages
let rdAutoSelectRouteId = null;         // routeId a auto-seleccionar tras abrir editor

// Estado de zoom del editor
let rdZoomState = {
  scale: 1, translateX: 0, translateY: 0,
  isPinching: false, isPanning: false,
  pinchStartDist: 0, pinchStartScale: 1,
  pinchCenterX: 0, pinchCenterY: 0,
  panStartX: 0, panStartY: 0,
  lastTranslateX: 0, lastTranslateY: 0,
  minScale: 1, maxScale: 4
};

// Variables de bifurcación
let rdBifurcationMode = false;           // Modo selección de punto de bifurcación
let rdCurrentBranchId = -1;              // Rama activa (-1 = tronco, >0 = rama)
let rdBranchesData = [];                 // Copia de trabajo de las ramas durante edición
let rdActiveForkPoint = null;            // Punto de bifurcación de la rama siendo dibujada
let rdActiveForkSegmentIndex = -1;       // Índice del segmento donde se bifurca
let rdBifurcatingDrawing = null;         // Drawing que se está bifurcando

// Variables de elementos auxiliares (líneas de descenso, grapas, cadenas, rápel)
let rdAuxMode = null;                    // Modo auxiliar activo: 'descent_line', 'grapas', 'cadena', 'rapel', null
let rdAuxPoints = [];                    // Puntos del elemento auxiliar actual
let rdAuxElements = [];                  // Elementos auxiliares guardados [{type, points, id, imageId}, ...]
let rdAuxDraggingIndex = -1;             // Índice del punto aux siendo arrastrado
let rdAuxIsDragging = false;             // Si estamos arrastrando un punto aux

// Variable de modo borrador
let rdEraserMode = false;                  // Modo borrador activo (1 clic elimina elementos)

// Variable de modo edición de elementos auxiliares
let rdEditAuxMode = false;               // Modo edición de elementos guardados
let rdEditAuxElementIndex = -1;          // Índice del elemento aux siendo editado
let rdEditAuxPointIndex = -1;            // Índice del punto dentro del elemento
let rdEditAuxIsDragging = false;         // Si estamos arrastrando un punto en modo edición

// Variables para detección de tap en touch (para menú contextual)
let rdTouchStartPos = null;              // Posición inicial del touch
let rdTouchStartTime = 0;               // Timestamp del inicio del touch
let rdPendingTap = null;                // Toque que añade un punto, a confirmar al levantar el dedo
let rdWasDragging = false;              // Flag: hubo arrastre en el último gesto (para no mostrar menú)

// Constantes para interacción
const RD_POINT_HIT_RADIUS = 20;         // Radio en píxeles para detectar clic en un punto
const RD_SEGMENT_HIT_RADIUS = 20;       // Radio para detectar clic en un segmento de línea

// Colores para el dibujo
const RD_COLORS = {
  normal: '#10b981',        // Verde para vías normales
  selected: '#f59e0b',      // Ámbar para vía seleccionada
  highlight: '#ef4444',     // Rojo para highlight
  rapel: '#202923',         // Granito para el aro de rápel
  point: '#ffffff',         // Blanco para puntos
  number: '#ffffff',        // Blanco para números
  descent_line: '#F7F6F0',  // Magnesio para líneas de descenso/ascenso
  grapas: '#F7F6F0',        // Magnesio para escaleras de grapas
  cadena: '#F7F6F0'         // Magnesio para cadenas
};

// Tipos de reunión (anchor types)
const RD_ANCHOR_TYPES = {
  quimicos: {
    id: 'quimicos',
    name: 'Anillas',
    description: '2 químicos con anillas o maillones'
  },
  cadena: {
    id: 'cadena',
    name: 'Cadena',
    description: 'Reunión con cadena'
  },
  mosqueton: {
    id: 'mosqueton',
    name: 'Mosquetón',
    description: 'Reunión con mosquetón fijo'
  },
  desconocido: {
    id: 'desconocido',
    name: 'Desconocido',
    description: 'Tipo de reunión desconocido'
  },
  sin_terminar: {
    id: 'sin_terminar',
    name: 'Sin terminar',
    description: 'Vía inconclusa / final desconocido'
  }
};

// ============================================
// BIFURCACIÓN: FUNCIONES DE DATOS Y RENDERIZADO
// ============================================

/**
 * Convierte un drawing en array de paths renderizables (tronco + ramas)
 * Retrocompatible: si no hay branches, devuelve un solo path con los points del tronco
 * @param {Object} drawing - Objeto de dibujo
 * @returns {Array} Array de {branchId, points, anchorType, isTrunk, forkPoint}
 */
function resolveDrawingPaths(drawing) {
  // Si no hay branches, devolver path único (retrocompat)
  if (!drawing.branches || drawing.branches.length === 0) {
    return [{
      branchId: 0,
      points: drawing.points,
      anchorType: drawing.anchorType,
      isTrunk: true,
      forkPoint: null
    }];
  }

  const paths = [];

  // Path del tronco principal
  paths.push({
    branchId: 0,
    points: drawing.points,
    anchorType: drawing.anchorType,
    isTrunk: true,
    forkPoint: null
  });

  // Paths de las ramas
  drawing.branches.forEach(branch => {
    paths.push({
      branchId: branch.branchId,
      points: [branch.forkPoint, ...branch.points], // forkPoint es el primer punto visual
      anchorType: branch.anchorType,
      isTrunk: false,
      forkPoint: branch.forkPoint
    });
  });

  return paths;
}

/**
 * Calcula la distancia de un punto a un segmento de línea y el punto proyectado
 * @returns {Object} {distance, projectedPoint: {x, y}, param}
 */
function pointToSegmentDistance(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSq = dx * dx + dy * dy;

  let param = 0;
  if (lengthSq > 0) {
    param = ((px - x1) * dx + (py - y1) * dy) / lengthSq;
    param = Math.max(0, Math.min(1, param));
  }

  const projX = x1 + param * dx;
  const projY = y1 + param * dy;
  const distance = Math.sqrt((px - projX) * (px - projX) + (py - projY) * (py - projY));

  return { distance, projectedPoint: { x: projX, y: projY }, param };
}

/**
 * Encuentra el segmento más cercano al click en un drawing (incluye tronco y ramas)
 * @param {number} canvasX - Coordenada X en canvas
 * @param {number} canvasY - Coordenada Y en canvas
 * @param {Object} drawing - El drawing a buscar
 * @returns {Object|null} {segmentIndex, distance, projectedPoint, branchId} o null
 */
function findNearestSegmentOnDrawing(canvasX, canvasY, drawing) {
  const displayWidth = rdCanvas.displayWidth || rdCanvas.width;
  const displayHeight = rdCanvas.displayHeight || rdCanvas.height;
  const scaleX = displayWidth / rdImage.width;
  const scaleY = displayHeight / rdImage.height;

  let nearest = null;
  let minDist = Infinity;

  // Buscar en el tronco
  const trunkPoints = drawing.points;
  if (trunkPoints && trunkPoints.length >= 2) {
    for (let i = 0; i < trunkPoints.length - 1; i++) {
      const p1 = { x: trunkPoints[i].x * scaleX, y: trunkPoints[i].y * scaleY };
      const p2 = { x: trunkPoints[i + 1].x * scaleX, y: trunkPoints[i + 1].y * scaleY };
      const result = pointToSegmentDistance(canvasX, canvasY, p1.x, p1.y, p2.x, p2.y);
      if (result.distance < minDist) {
        minDist = result.distance;
        // Convertir punto proyectado a coordenadas de imagen
        const imgPoint = canvasToImageCoords(result.projectedPoint.x, result.projectedPoint.y);
        nearest = {
          segmentIndex: i,
          distance: result.distance,
          projectedPoint: imgPoint,
          branchId: 0
        };
      }
    }
  }

  // Buscar en las ramas
  if (drawing.branches) {
    drawing.branches.forEach(branch => {
      const branchFullPoints = [branch.forkPoint, ...branch.points];
      for (let i = 0; i < branchFullPoints.length - 1; i++) {
        const p1 = { x: branchFullPoints[i].x * scaleX, y: branchFullPoints[i].y * scaleY };
        const p2 = { x: branchFullPoints[i + 1].x * scaleX, y: branchFullPoints[i + 1].y * scaleY };
        const result = pointToSegmentDistance(canvasX, canvasY, p1.x, p1.y, p2.x, p2.y);
        if (result.distance < minDist) {
          minDist = result.distance;
          const imgPoint = canvasToImageCoords(result.projectedPoint.x, result.projectedPoint.y);
          nearest = {
            segmentIndex: i,
            distance: result.distance,
            projectedPoint: imgPoint,
            branchId: branch.branchId
          };
        }
      }
    });
  }

  if (nearest && nearest.distance <= RD_SEGMENT_HIT_RADIUS) {
    return nearest;
  }
  return null;
}

/**
 * Dibuja un diamante (rombo) indicador de punto de bifurcación
 */
function drawForkDiamond(x, y, color) {
  const size = 3.5;
  rdCtx.save();
  rdCtx.translate(x, y);
  rdCtx.rotate(Math.PI / 4); // Rotar 45° para hacer rombo

  // Borde oscuro
  rdCtx.fillStyle = 'rgba(0, 0, 0, 0.5)';
  rdCtx.fillRect(-size - 1, -size - 1, (size + 1) * 2, (size + 1) * 2);

  // Borde blanco
  rdCtx.fillStyle = 'rgba(255, 255, 255, 0.85)';
  rdCtx.fillRect(-size - 0.25, -size - 0.25, (size + 0.25) * 2, (size + 0.25) * 2);

  // Relleno de color
  rdCtx.fillStyle = color;
  rdCtx.fillRect(-size + 0.5, -size + 0.5, (size - 0.5) * 2, (size - 0.5) * 2);

  rdCtx.restore();
}

// ============================================
// VERIFICACIÓN DE ADMIN
// ============================================

/**
 * Verifica si el usuario actual es admin o spotter verificado
 */
async function isRouteDrawingAdminOrSpotter() {
  try {
    const user = auth.currentUser;
    if (!user) return false;

    const adminDoc = await db.collection('admins').doc(user.uid).get();
    if (!adminDoc.exists) return false;

    const role = adminDoc.data().role;
    return role === 'admin' || role === 'spotter';
  } catch (error) {
    console.error('[RouteDrawing] Error verificando admin/spotter:', error);
    return false;
  }
}

// ============================================
// ABRIR EDITOR DE DIBUJO
// ============================================

/**
 * Abre el editor de dibujo para un sector
 * @param {string} schoolId - ID de la escuela
 * @param {string} sectorName - Nombre del sector
 * @param {string} imageId - ID de la imagen específica (opcional, para galería)
 */
async function openRouteDrawingEditor(schoolId, sectorName, imageId = null) {
  // Verificar permisos
  const hasAccess = await isRouteDrawingAdminOrSpotter();
  if (!hasAccess) {
    showRDToast('Solo administradores y spotters pueden dibujar vías', 'error');
    return;
  }

  let imageUrl = null;

  // Cargar todas las imágenes del sector para navegación
  if (typeof getSectorGalleryImages === 'function') {
    const images = await getSectorGalleryImages(schoolId, sectorName);
    if (images && images.length > 0) {
      // Solo actualizar rdSectorImages si no fue ya seteado por el caller
      if (rdSectorImages.length === 0) {
        rdSectorImages = images;
      }
      if (imageId) {
        const targetIdx = images.findIndex(img => img.id === imageId);
        if (targetIdx >= 0) {
          imageUrl = images[targetIdx].url;
          rdCurrentImageIndex = targetIdx;
        }
      }
      if (!imageUrl) {
        imageUrl = images[0].url;
        imageId = images[0].id;
        rdCurrentImageIndex = 0;
      }
    }
  }

  // Fallback si no se obtuvo imagen
  if (!imageUrl) {
    imageUrl = await getSectorImageUrl(schoolId, sectorName);
  }

  if (!imageUrl) {
    showRDToast('No hay imagen disponible para este sector', 'error');
    return;
  }

  rdCurrentSector = { schoolId, sectorName, imageId };

  // Cargar vías del sector
  await loadSectorRoutes(schoolId, sectorName);

  // Cargar dibujos existentes (filtrados por imagen si hay imageId)
  await loadRouteDrawings(schoolId, sectorName, imageId);
  await migrateRapelPoints(schoolId, sectorName, imageId);
  await loadAuxElements(schoolId, sectorName, imageId);

  // Crear el editor
  createDrawingEditor(imageUrl);
}

/**
 * Abre el editor desde un popup de vía (para vincular vía específica)
 * @param {number} routeId - ID de la vía (properties.id del GeoJSON)
 */
async function openDrawingEditorForRoute(routeId) {
  if (!mlCurrentSchool) {
    showRDToast('No se puede determinar la escuela actual', 'error');
    return;
  }

  // Obtener datos de la vía
  const routeData = await getRouteData(mlCurrentSchool, routeId);
  if (!routeData || !routeData.sector) {
    showRDToast('No se pudo obtener información de la vía', 'error');
    return;
  }

  const schoolId = mlCurrentSchool;
  const sectorName = routeData.sector;

  // Obtener todas las imágenes del sector
  const images = await getSectorGalleryImages(schoolId, sectorName);
  if (!images || images.length === 0) {
    showRDToast('No hay imagen disponible para este sector', 'error');
    return;
  }

  // Si solo hay una imagen, abrir directamente
  if (images.length === 1) {
    rdSectorImages = images;
    rdCurrentImageIndex = 0;
    await openRouteDrawingEditor(schoolId, sectorName, images[0].id);
    setTimeout(() => { selectRouteForDrawing(routeId); }, 500);
    return;
  }

  // Múltiples imágenes: mostrar selector para elegir en cuál dibujar
  rdAutoSelectRouteId = routeId;
  showImageSelectorForRoute(schoolId, sectorName, routeData.nombre || '', images);
}

/**
 * Abre el editor de dibujo para una vía PENDIENTE recién creada (modo obligatorio)
 * En este modo el usuario DEBE dibujar la vía, si cancela se elimina la vía pendiente
 * @param {string} schoolId - ID de la escuela
 * @param {string} sectorName - Nombre del sector
 * @param {string} routeName - Nombre de la vía
 * @param {string} docId - ID del documento en Firestore
 */
async function openRouteDrawingEditorForPendingRoute(schoolId, sectorName, routeName, docId) {
  // Verificar permisos
  const hasAccess = await isRouteDrawingAdminOrSpotter();
  if (!hasAccess) {
    showRDToast('Solo administradores y spotters pueden dibujar vías', 'error');
    return;
  }

  // Obtener TODAS las imágenes del sector
  const images = await getSectorGalleryImages(schoolId, sectorName);
  if (!images || images.length === 0) {
    showRDToast('No hay imagen disponible para este sector', 'error');
    return;
  }

  // Si solo hay una imagen, usarla directamente
  if (images.length === 1) {
    const selectedImage = images[0];
    await continueOpeningPendingRouteEditor(schoolId, sectorName, routeName, docId, selectedImage);
    return;
  }

  // Si hay múltiples imágenes, intentar detectar automáticamente por proximidad
  const bestImage = await detectBestImageByProximity(schoolId, sectorName, docId, images);

  if (bestImage) {
    // Encontramos una imagen probable, usarla directamente
    console.log('[RouteDrawing] Imagen detectada automáticamente por proximidad:', bestImage.id);
    await continueOpeningPendingRouteEditor(schoolId, sectorName, routeName, docId, bestImage);
  } else {
    // No pudimos determinar, mostrar selector manual
    showImageSelectorForPendingRoute(schoolId, sectorName, routeName, docId, images);
  }
}

/**
 * Detecta la mejor imagen para dibujar basándose en la proximidad
 * a otras vías que ya tienen dibujos en ese sector
 * @returns {Object|null} La imagen detectada o null si no se puede determinar
 */
async function detectBestImageByProximity(schoolId, sectorName, docId, images) {
  try {
    // 1. Obtener coordenadas de la vía pendiente desde Firestore
    const pendingDoc = await db.collection('pending_routes').doc(docId).get();
    if (!pendingDoc.exists) {
      console.log('[RouteDrawing] No se encontró la vía pendiente');
      return null;
    }

    const pendingData = pendingDoc.data();
    const pendingCoords = pendingData.coordinates; // [lng, lat]
    if (!pendingCoords || pendingCoords.length < 2) {
      console.log('[RouteDrawing] La vía pendiente no tiene coordenadas');
      return null;
    }

    // 2. Cargar todas las vías del sector con sus coordenadas
    const school = MAPLIBRE_SCHOOLS[schoolId];
    if (!school || !school.geojson || !school.geojson.vias) {
      return null;
    }

    const response = await fetch(school.geojson.vias + '?v=' + Date.now());
    if (!response.ok) return null;

    const geojson = await response.json();
    const sectorRoutes = geojson.features
      .filter(f => f.properties.sector === sectorName)
      .map(f => ({
        nombre: f.properties.nombre,
        coordinates: f.geometry.coordinates[0] || f.geometry.coordinates
      }));

    if (sectorRoutes.length === 0) {
      console.log('[RouteDrawing] No hay otras vías en el sector');
      return null;
    }

    // 3. Cargar TODOS los dibujos del sector (sin filtrar por imagen)
    const drawingsDocId = `${schoolId}_${normalizeSectorName(sectorName)}`;
    const drawingsDoc = await db.collection('sector_route_drawings').doc(drawingsDocId).get();

    if (!drawingsDoc.exists) {
      console.log('[RouteDrawing] No hay dibujos existentes en el sector');
      return null;
    }

    const allDrawings = drawingsDoc.data().drawings || [];
    if (allDrawings.length === 0) {
      console.log('[RouteDrawing] No hay dibujos guardados');
      return null;
    }

    // 4. Crear un mapa de routeId (o nombre como fallback) -> imageId
    const routeToImageMap = {};
    allDrawings.forEach(drawing => {
      const key = drawing.routeId !== undefined ? String(drawing.routeId) : drawing.routeName;
      if (key) {
        routeToImageMap[key] = drawing.imageId || 'legacy_0';
      }
    });

    // 5. Calcular distancias a vías que tienen dibujo
    const routesWithDrawings = sectorRoutes.filter(r => {
      return routeToImageMap[String(r.routeId)] || routeToImageMap[r.nombre];
    });

    if (routesWithDrawings.length === 0) {
      console.log('[RouteDrawing] Ninguna vía del sector tiene dibujo aún');
      return null;
    }

    // Calcular distancia a cada vía con dibujo
    const distances = routesWithDrawings.map(route => {
      const routeCoords = route.coordinates;
      // Distancia euclidiana simple (suficiente para proximidad local)
      const dist = Math.sqrt(
        Math.pow(pendingCoords[0] - routeCoords[0], 2) +
        Math.pow(pendingCoords[1] - routeCoords[1], 2)
      );
      return {
        routeId: route.routeId,
        routeName: route.nombre,
        imageId: routeToImageMap[String(route.routeId)] || routeToImageMap[route.nombre],
        distance: dist
      };
    });

    // Ordenar por distancia
    distances.sort((a, b) => a.distance - b.distance);

    // 6. Tomar las 3 vías más cercanas y ver qué imagen domina
    const topN = distances.slice(0, 3);
    const imageVotes = {};

    topN.forEach(item => {
      imageVotes[item.imageId] = (imageVotes[item.imageId] || 0) + 1;
    });

    // Encontrar la imagen con más votos
    let bestImageId = null;
    let maxVotes = 0;

    for (const [imageId, votes] of Object.entries(imageVotes)) {
      if (votes > maxVotes) {
        maxVotes = votes;
        bestImageId = imageId;
      }
    }

    // Si la vía más cercana está muy cerca (umbral de ~50m en grados ≈ 0.0005)
    // y tiene el mismo imageId que el ganador, confiar más en el resultado
    const closestDistance = distances[0].distance;
    const isVeryClose = closestDistance < 0.0005;

    console.log('[RouteDrawing] Análisis de proximidad:', {
      pendingCoords,
      topRoutes: topN,
      imageVotes,
      bestImageId,
      closestDistance,
      isVeryClose
    });

    // Si la vía más cercana está muy cerca O hay consenso (mayoría), usar esa imagen
    if (isVeryClose || maxVotes >= 2) {
      const selectedImage = images.find(img => img.id === bestImageId);
      if (selectedImage) {
        return selectedImage;
      }
    }

    // Si no hay suficiente confianza, devolver null para mostrar selector manual
    console.log('[RouteDrawing] No hay suficiente confianza para auto-seleccionar imagen');
    return null;

  } catch (error) {
    console.error('[RouteDrawing] Error detectando imagen por proximidad:', error);
    return null;
  }
}

/**
 * Muestra selector de imagen cuando hay múltiples imágenes en el sector
 */
function showImageSelectorForPendingRoute(schoolId, sectorName, routeName, docId, images) {
  const modal = document.createElement('div');
  modal.id = 'rd-image-selector-modal';
  modal.className = 'rd-image-selector-overlay';
  modal.innerHTML = `
    <div class="rd-image-selector-container">
      <div class="rd-image-selector-header">
        <h3>Selecciona la foto donde dibujar la vía</h3>
        <p class="rd-image-selector-subtitle">${routeName}</p>
      </div>
      <div class="rd-image-selector-grid">
        ${images.map((img, index) => `
          <div class="rd-image-selector-item" onclick="selectImageForPendingRoute('${schoolId}', '${encodeURIComponent(sectorName)}', '${encodeURIComponent(routeName)}', '${docId}', '${img.id}', '${encodeURIComponent(img.url)}')">
            <img src="${img.url}" alt="Foto ${index + 1}">
            <span class="rd-image-selector-number">${index + 1}</span>
          </div>
        `).join('')}
      </div>
      <button class="rd-image-selector-cancel" onclick="closeImageSelectorModal()">Cancelar</button>
    </div>
  `;
  document.body.appendChild(modal);
}

/**
 * Cierra el modal de selector de imagen
 */
function closeImageSelectorModal() {
  const modal = document.getElementById('rd-image-selector-modal');
  if (modal) modal.remove();
}

/**
 * Callback cuando se selecciona una imagen del selector
 */
async function selectImageForPendingRoute(schoolId, encodedSectorName, encodedRouteName, docId, imageId, encodedImageUrl) {
  closeImageSelectorModal();

  const sectorName = decodeURIComponent(encodedSectorName);
  const routeName = decodeURIComponent(encodedRouteName);
  const imageUrl = decodeURIComponent(encodedImageUrl);

  const selectedImage = { id: imageId, url: imageUrl };
  await continueOpeningPendingRouteEditor(schoolId, sectorName, routeName, docId, selectedImage);
}

/**
 * Muestra selector de imagen para vincular una vía existente (no pendiente)
 */
function showImageSelectorForRoute(schoolId, sectorName, routeName, images) {
  const modal = document.createElement('div');
  modal.id = 'rd-image-selector-modal';
  modal.className = 'rd-image-selector-overlay';
  modal.innerHTML = `
    <div class="rd-image-selector-container">
      <div class="rd-image-selector-header">
        <h3>Selecciona la foto donde dibujar la vía</h3>
        ${routeName ? `<p class="rd-image-selector-subtitle">${routeName}</p>` : ''}
      </div>
      <div class="rd-image-selector-grid">
        ${images.map((img, index) => `
          <div class="rd-image-selector-item" onclick="selectImageForRoute('${schoolId}', '${encodeURIComponent(sectorName)}', '${img.id}', ${index})">
            <img src="${img.url}" alt="Foto ${index + 1}">
            <span class="rd-image-selector-number">${index + 1}</span>
          </div>
        `).join('')}
      </div>
      <button class="rd-image-selector-cancel" onclick="closeImageSelectorModal()">Cancelar</button>
    </div>
  `;
  document.body.appendChild(modal);
}

/**
 * Callback cuando se selecciona una imagen para una vía existente
 */
async function selectImageForRoute(schoolId, encodedSectorName, imageId, imageIndex) {
  closeImageSelectorModal();

  const sectorName = decodeURIComponent(encodedSectorName);

  // Guardar las imágenes del sector para navegación
  const images = await getSectorGalleryImages(schoolId, sectorName);
  rdSectorImages = images;
  rdCurrentImageIndex = imageIndex;

  // Abrir editor con la imagen seleccionada
  await openRouteDrawingEditor(schoolId, sectorName, imageId);

  // Auto-seleccionar la vía si hay una pendiente
  if (rdAutoSelectRouteId !== null) {
    const routeId = rdAutoSelectRouteId;
    rdAutoSelectRouteId = null;
    setTimeout(() => { selectRouteForDrawing(routeId); }, 500);
  }
}

/**
 * Cambia la imagen activa en el editor sin cerrarlo
 * @param {number} newIndex - Índice de la nueva imagen en rdSectorImages
 */
async function rdSwitchImage(newIndex) {
  if (!rdSectorImages || rdSectorImages.length === 0) return;
  if (newIndex < 0 || newIndex >= rdSectorImages.length) return;
  if (newIndex === rdCurrentImageIndex) return;

  // Si hay dibujo en curso, avisar
  if (rdDrawingMode && rdDrawingPoints.length > 0) {
    if (!confirm('Tienes un dibujo sin terminar. ¿Cambiar de imagen descartará el progreso actual?')) {
      return;
    }
  }

  // Cancelar dibujo en curso si existe
  if (rdDrawingMode) {
    rdDrawingMode = false;
    rdCurrentRoute = null;
    rdDrawingPoints = [];
    rdEditMode = false;
    rdOriginalDrawing = null;
    const controls = document.getElementById('rd-drawing-controls');
    if (controls) controls.style.display = 'none';
  }

  // Resetear zoom al cambiar de imagen
  rdResetZoom();

  rdCurrentImageIndex = newIndex;
  const newImage = rdSectorImages[newIndex];

  // Actualizar sector con nuevo imageId
  rdCurrentSector.imageId = newImage.id;

  // Recargar dibujos para la nueva imagen
  await loadRouteDrawings(rdCurrentSector.schoolId, rdCurrentSector.sectorName, newImage.id);
  await migrateRapelPoints(rdCurrentSector.schoolId, rdCurrentSector.sectorName, newImage.id);
  await loadAuxElements(rdCurrentSector.schoolId, rdCurrentSector.sectorName, newImage.id);

  // Actualizar lista de vías
  const routeListEl = document.getElementById('rd-route-list');
  if (routeListEl) routeListEl.innerHTML = renderRoutesList();

  // Actualizar indicador de imagen
  rdUpdateImageIndicator();

  // Actualizar instrucciones
  updateInstructions('Selecciona una vía de la lista para dibujar su línea en la imagen');

  // Cargar nueva imagen en canvas
  rdImage = new Image();
  rdImage.crossOrigin = 'anonymous';
  rdImage.onload = () => {
    initializeCanvas();
    redrawCanvas();
  };
  rdImage.onerror = () => {
    showRDToast('Error cargando la imagen', 'error');
  };
  rdImage.src = newImage.url;
}

/**
 * Navega a la imagen anterior del sector
 */
function rdPrevImage() {
  if (rdCurrentImageIndex > 0) {
    rdSwitchImage(rdCurrentImageIndex - 1);
  }
}

/**
 * Navega a la imagen siguiente del sector
 */
function rdNextImage() {
  if (rdCurrentImageIndex < rdSectorImages.length - 1) {
    rdSwitchImage(rdCurrentImageIndex + 1);
  }
}

/**
 * Actualiza el indicador visual de imagen actual
 */
function rdUpdateImageIndicator() {
  const indicator = document.getElementById('rd-image-indicator');
  if (indicator) {
    indicator.textContent = `Foto ${rdCurrentImageIndex + 1} / ${rdSectorImages.length}`;
  }
  // Actualizar estado de botones prev/next
  const prevBtn = document.getElementById('rd-btn-prev-image');
  const nextBtn = document.getElementById('rd-btn-next-image');
  if (prevBtn) prevBtn.disabled = rdCurrentImageIndex <= 0;
  if (nextBtn) nextBtn.disabled = rdCurrentImageIndex >= rdSectorImages.length - 1;
}

/**
 * Continúa abriendo el editor después de seleccionar imagen
 */
async function continueOpeningPendingRouteEditor(schoolId, sectorName, routeName, docId, selectedImage) {
  // Guardar info de la vía pendiente
  rdPendingRouteInfo = {
    routeName: routeName,
    docId: docId,
    schoolId: schoolId,
    sectorName: sectorName,
    imageId: selectedImage.id  // Guardar el imageId seleccionado
  };
  rdMandatoryDrawingMode = true;

  rdCurrentSector = { schoolId, sectorName, imageId: selectedImage.id };

  // Cargar vías del sector (incluyendo la pendiente)
  await loadSectorRoutesWithPending(schoolId, sectorName, routeName);

  // Cargar dibujos existentes FILTRADOS por la imagen seleccionada
  await loadRouteDrawings(schoolId, sectorName, selectedImage.id);
  await migrateRapelPoints(schoolId, sectorName, selectedImage.id);
  await loadAuxElements(schoolId, sectorName, selectedImage.id);

  // Crear el editor con modo obligatorio
  createDrawingEditorMandatory(selectedImage.url, routeName);
}

/**
 * Carga vías del sector incluyendo una vía pendiente específica
 */
async function loadSectorRoutesWithPending(schoolId, sectorName, pendingRouteName) {
  rdRoutesList = [];

  const school = MAPLIBRE_SCHOOLS[schoolId];
  if (!school || !school.geojson || !school.geojson.vias) {
    // Solo añadir la vía pendiente
    rdRoutesList = [{
      nombre: pendingRouteName,
      grado: '?',
      sector: sectorName,
      isPending: true
    }];
    return;
  }

  try {
    const response = await fetch(school.geojson.vias + '?v=' + Date.now());
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const geojson = await response.json();

    if (geojson.features) {
      rdRoutesList = geojson.features
        .filter(f => f.properties.sector === sectorName)
        .map(f => ({
          routeId: Number(f.properties.id),
          nombre: f.properties.nombre,
          grado: f.properties.grado1 || '?',
          sector: f.properties.sector,
          coordinates: f.geometry.coordinates[0] || f.geometry.coordinates
        }))
        .sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));
    }

    // Añadir la vía pendiente si no está ya en la lista
    const existingRoute = rdRoutesList.find(r => r.nombre === pendingRouteName);
    if (!existingRoute) {
      // Obtener datos de la vía pendiente desde Firestore
      const pendingDoc = await db.collection('pending_routes').doc(rdPendingRouteInfo.docId).get();
      if (pendingDoc.exists) {
        const pendingData = pendingDoc.data();
        rdRoutesList.unshift({
          nombre: pendingRouteName,
          grado: pendingData.grado1 || '?',
          sector: sectorName,
          isPending: true
        });
      }
    }

    console.log('[RouteDrawing] Vías cargadas (con pendiente):', rdRoutesList.length);
  } catch (error) {
    console.error('[RouteDrawing] Error cargando vías:', error);
    // Añadir al menos la vía pendiente
    rdRoutesList = [{
      nombre: pendingRouteName,
      grado: '?',
      sector: sectorName,
      isPending: true
    }];
  }
}

/**
 * Crea el editor de dibujo en modo obligatorio (para vías pendientes)
 * Solo muestra la vía nueva, sin panel lateral de otras vías
 */
function createDrawingEditorMandatory(imageUrl, pendingRouteName) {
  // Cerrar visor de sector si está abierto
  if (typeof closeSectorImageViewer === 'function') {
    closeSectorImageViewer();
  }

  // Obtener el grado de la vía pendiente
  const pendingRoute = rdRoutesList.find(r => r.nombre === pendingRouteName);
  const gradeColor = pendingRoute ? getGradeColor(pendingRoute.grado) : '#10b981';
  const gradeText = pendingRoute ? pendingRoute.grado : '?';

  const editor = document.createElement('div');
  editor.id = 'rd-editor';
  editor.className = 'rd-editor-overlay';
  editor.innerHTML = `
    <div class="rd-editor-container rd-editor-mandatory-simple">
      <!-- Header simplificado con info de la vía -->
      <div class="rd-editor-header rd-mandatory-header">
        <div class="rd-header-left">
          <h2>${pendingRouteName}</h2>
          <span class="rd-route-grade-header" style="background-color: ${gradeColor}">${gradeText}</span>
          <span class="rd-mandatory-badge">Dibujo obligatorio</span>
        </div>
        <div class="rd-header-actions">
          <button class="rd-btn-icon" onclick="rdResetView()" title="Resetear vista">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="1 4 1 10 7 10"/>
              <polyline points="23 20 23 14 17 14"/>
              <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/>
            </svg>
          </button>
          <button class="rd-btn-icon rd-btn-cancel-mandatory" onclick="rdCancelMandatoryDrawing()" title="Cancelar (eliminará la vía)">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      </div>

      <!-- Canvas Container (ocupa todo el ancho) -->
      <div class="rd-canvas-container rd-canvas-full" id="rd-canvas-container">
        <div id="rd-canvas-wrapper"><canvas id="rd-canvas"></canvas></div>
      </div>

      <!-- Instrucciones flotantes con énfasis -->
      <div class="rd-instructions" id="rd-instructions" role="status" aria-live="polite">
        <p>Toca en la imagen para dibujar la línea de la vía. Mínimo 2 puntos.</p>
      </div>

      <!-- Controles de dibujo -->
      <div class="rd-drawing-controls" id="rd-drawing-controls" style="display: flex;">
        <button class="rd-btn-control rd-btn-undo" onclick="rdUndoLastPoint()" id="rd-btn-undo" disabled title="Deshacer último punto">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 7v6h6"/>
            <path d="M21 17a9 9 0 00-9-9 9 9 0 00-6 2.3L3 13"/>
          </svg>
          Deshacer
        </button>
        <button class="rd-btn-control rd-btn-finish" onclick="rdFinishDrawing()" id="rd-btn-finish" disabled title="Terminar y guardar">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
          Terminar
        </button>
        <button class="rd-btn-control rd-btn-cancel" onclick="rdCancelDrawing()" title="Borrar puntos">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
          Borrar puntos
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(editor);

  // Cargar imagen y configurar canvas
  setupCanvas(imageUrl);

  // Auto-seleccionar la vía pendiente para empezar a dibujar inmediatamente
  setTimeout(() => {
    selectRouteForDrawingMandatory(pendingRouteName);
  }, 300);
}

/**
 * Renderiza la lista de vías con la pendiente destacada
 */
function renderRoutesListMandatory(pendingRouteName) {
  if (rdRoutesList.length === 0) {
    return '<p class="rd-empty-message">No hay vías en este sector</p>';
  }

  return rdRoutesList.map(route => {
    const hasDrawing = rdRouteDrawings.find(d => d.routeId === route.routeId || (!d.routeId && d.routeName === route.nombre));
    const gradeColor = kxGradeColorSafe(route.grado);
    const isPendingRoute = route.nombre === pendingRouteName;

    return `
      <div class="rd-route-item ${hasDrawing ? 'rd-has-drawing' : ''} ${isPendingRoute ? 'rd-pending-route' : ''}"
           onclick="selectRouteForDrawingMandatory(${route.routeId})">
        <div class="rd-route-info">
          <span class="rd-route-name">${kxEsc(route.nombre || 'Sin nombre')}</span>
          <span class="rd-route-grade" style="background-color: ${gradeColor}; color: ${kxGradeInk(gradeColor)}">${kxEsc(route.grado)}</span>
          ${isPendingRoute ? '<span class="rd-new-badge">NUEVA</span>' : ''}
        </div>
        ${hasDrawing && !isPendingRoute ? `
          <button class="rd-btn-delete" onclick="event.stopPropagation(); deleteRouteDrawing(${route.routeId})" title="Eliminar dibujo">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        ` : ''}
      </div>
    `;
  }).join('');
}

/**
 * Selecciona una vía para dibujar en modo obligatorio
 */
function selectRouteForDrawingMandatory(routeId) {
  // routeId puede ser un número (llamada desde el listado) o un nombre de vía
  // (llamada inicial en modo obligatorio donde la ruta pendiente no tiene routeId)
  const route = rdRoutesList.find(r => r.routeId === routeId || r.nombre === routeId);

  if (!route) return;

  // En modo obligatorio solo permitir dibujar la vía pendiente
  if (rdMandatoryDrawingMode && rdPendingRouteInfo && route.nombre !== rdPendingRouteInfo.routeName) {
    showRDToast('Primero debes dibujar la vía nueva antes de poder dibujar otras', 'warning');
    return;
  }

  // Verificar si ya existe un dibujo
  const existingDrawing = rdRouteDrawings.find(d => d.routeId === route.routeId || (!d.routeId && d.routeName === route.nombre));
  if (existingDrawing) {
    showRDToast('Esta vía ya tiene un dibujo. Elimínalo primero para redibujar.', 'warning');
    rdCurrentRoute = route;
    redrawCanvas();
    return;
  }

  // Activar modo de dibujo
  rdCurrentRoute = route;
  rdDrawingMode = true;
  rdDrawingPoints = [];

  updateInstructions(`Dibujando <strong>${kxEsc(route.nombre || 'Sin nombre')}</strong> (${kxEsc(route.grado)}). Toca el pie de la vía para poner el primer punto.`);
  updateDrawingControls();

  console.log('[RouteDrawing] Vía seleccionada (modo obligatorio):', route.nombre, 'id:', route.routeId);
}

/**
 * Cancela el modo de dibujo obligatorio y elimina la vía pendiente
 */
async function rdCancelMandatoryDrawing() {
  if (!rdMandatoryDrawingMode || !rdPendingRouteInfo) {
    closeRouteDrawingEditor();
    return;
  }

  // Confirmar cancelación
  const confirmed = confirm(`¿Estás seguro de cancelar?\n\nLa vía "${rdPendingRouteInfo.routeName}" será ELIMINADA porque no se ha dibujado en la imagen.`);

  if (!confirmed) return;

  const routeNameToRemove = rdPendingRouteInfo.routeName;

  try {
    // Eliminar la vía pendiente de Firestore
    await db.collection('pending_routes').doc(rdPendingRouteInfo.docId).delete();

    // También eliminar del mapa temporal si existe
    removePendingRouteFromMap(routeNameToRemove);

    showRDToast('Vía eliminada porque no se dibujó', 'warning');

    console.log('[RouteDrawing] Vía pendiente eliminada:', routeNameToRemove);
  } catch (error) {
    console.error('[RouteDrawing] Error eliminando vía pendiente:', error);
    showRDToast('Error al eliminar la vía: ' + error.message, 'error');
  }

  // Limpiar y cerrar
  rdPendingRouteInfo = null;
  rdMandatoryDrawingMode = false;
  closeRouteDrawingEditor();
}

/**
 * Elimina una vía pendiente del mapa temporal
 */
function removePendingRouteFromMap(routeName) {
  if (!mlMap) return;

  const sourceId = 'dev-temp-routes';
  const source = mlMap.getSource(sourceId);

  if (!source) return;

  try {
    const data = source._data || { type: 'FeatureCollection', features: [] };

    // Filtrar para remover la vía por nombre
    data.features = data.features.filter(f => f.properties.nombre !== routeName);

    source.setData(data);
    console.log('[RouteDrawing] Vía removida del mapa temporal:', routeName);
  } catch (error) {
    console.error('[RouteDrawing] Error removiendo vía del mapa:', error);
  }
}

// ============================================
// CARGA DE DATOS
// ============================================

/**
 * Carga todas las vías de un sector
 */
async function loadSectorRoutes(schoolId, sectorName) {
  rdRoutesList = [];

  const school = MAPLIBRE_SCHOOLS[schoolId];
  if (!school || !school.geojson || !school.geojson.vias) return;

  try {
    const response = await fetch(school.geojson.vias + '?v=' + Date.now());
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const geojson = await response.json();

    if (geojson.features) {
      const expanded = [];
      geojson.features
        .filter(f => f.properties.sector === sectorName)
        .sort((a, b) => {
          // Orden natural («Vía 2» antes que «Vía 10»); las vías sin nombre, al final
          const [na, nb] = [a.properties.nombre || '', b.properties.nombre || ''];
          if (!na !== !nb) return na ? -1 : 1;
          return na.localeCompare(nb, 'es', { numeric: true, sensitivity: 'base' });
        })
        .forEach(f => {
          const p = f.properties;
          const coords = f.geometry.coordinates[0] || f.geometry.coordinates;
          expanded.push({ routeId: Number(p.id), nombre: p.nombre, grado: p.grado1 || '?', sector: p.sector, coordinates: coords, variantIndex: 0 });
          if (p.variante === 'SI' && !p.union) {
            for (let i = 2; i <= 5; i++) {
              const grado = p['grado' + i];
              if (grado != null && grado !== '') {
                expanded.push({ routeId: Number(p.id), nombre: p.nombre, grado, sector: p.sector, coordinates: coords, variantIndex: i - 1 });
              }
            }
          }
        });
      rdRoutesList = expanded;
    }

    console.log('[RouteDrawing] Vías cargadas:', rdRoutesList.length);
  } catch (error) {
    console.error('[RouteDrawing] Error cargando vías:', error);
  }
}

/**
 * Obtiene datos de una vía específica por su routeId (properties.id del GeoJSON)
 */
async function getRouteData(schoolId, routeId) {
  const school = MAPLIBRE_SCHOOLS[schoolId];
  if (!school || !school.geojson || !school.geojson.vias) return null;

  try {
    const response = await fetch(school.geojson.vias + '?v=' + Date.now());
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const geojson = await response.json();
    const feature = geojson.features.find(f => f.properties.id === routeId);

    return feature ? {
      routeId: feature.properties.id,
      nombre: feature.properties.nombre,
      grado: feature.properties.grado1 || '?',
      sector: feature.properties.sector,
      coordinates: feature.geometry.coordinates[0] || feature.geometry.coordinates
    } : null;
  } catch (error) {
    console.error('[RouteDrawing] Error obteniendo vía:', error);
    return null;
  }
}

/**
 * Carga dibujos existentes de Firestore
 * @param {string} imageId - ID de imagen específica para filtrar (opcional)
 */
async function loadRouteDrawings(schoolId, sectorName, imageId = null) {
  rdRouteDrawings = [];
  rdOtherDrawings = [];
  rdDrawingsLoadFailed = false;

  try {
    const docId = `${schoolId}_${normalizeSectorName(sectorName)}`;
    const doc = await db.collection('sector_route_drawings').doc(docId).get();

    if (doc.exists) {
      const data = doc.data();
      let allDrawings = data.drawings || [];

      // Normalizar routeId a Number para consistencia entre plataformas
      allDrawings.forEach(d => {
        if (d.routeId !== undefined) d.routeId = Number(d.routeId);
      });

      // Si hay imageId, filtrar solo los dibujos de esa imagen
      if (imageId) {
        const inImage = d => d.imageId ? d.imageId === imageId : imageId === 'legacy_0';
        rdRouteDrawings = allDrawings.filter(inImage);
        rdOtherDrawings = allDrawings.filter(d => !inImage(d));
        console.log('[RouteDrawing] Dibujos filtrados para imagen', imageId, ':', rdRouteDrawings.length);
      } else {
        rdRouteDrawings = allDrawings;
        console.log('[RouteDrawing] Todos los dibujos cargados:', rdRouteDrawings.length);
      }
    }
  } catch (error) {
    console.error('[RouteDrawing] Error cargando dibujos:', error);
    // Sin los dibujos existentes en memoria, guardar o borrar podría sobrescribirlos
    rdDrawingsLoadFailed = true;
    showRDToast('No se pudieron cargar los dibujos. Cierra y vuelve a abrir el editor antes de guardar.', 'error');
  }
}

// ============================================
// CREAR EDITOR
// ============================================

/**
 * Crea el editor de dibujo
 */
function createDrawingEditor(imageUrl) {
  // Cerrar visor de sector si está abierto
  if (typeof closeSectorImageViewer === 'function') {
    closeSectorImageViewer();
  }

  const hasMultipleImages = rdSectorImages.length > 1;

  const editor = document.createElement('div');
  editor.id = 'rd-editor';
  editor.className = 'rd-editor-overlay';
  editor.innerHTML = `
    <div class="rd-editor-container">
      <!-- Header -->
      <div class="rd-editor-header">
        <div class="rd-header-left">
          <h2>${rdCurrentSector.sectorName}</h2>
          <span class="rd-route-count" id="rd-progress">${rdProgressText()}</span>
        </div>
        ${hasMultipleImages ? `
        <div class="rd-image-nav">
          <button class="rd-btn-icon rd-btn-nav-image" id="rd-btn-prev-image" onclick="rdPrevImage()" title="Foto anterior" ${rdCurrentImageIndex <= 0 ? 'disabled' : ''}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
          </button>
          <span class="rd-image-indicator" id="rd-image-indicator">Foto ${rdCurrentImageIndex + 1} de ${rdSectorImages.length}</span>
          <button class="rd-btn-icon rd-btn-nav-image" id="rd-btn-next-image" onclick="rdNextImage()" title="Foto siguiente" ${rdCurrentImageIndex >= rdSectorImages.length - 1 ? 'disabled' : ''}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          </button>
        </div>
        ` : ''}
        <div class="rd-header-actions">
          <button class="rd-btn-icon rd-btn-add" id="rd-btn-add" onclick="rdToggleAddMenu()" title="Añadir elemento" aria-label="Añadir elemento">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
              <line x1="12" y1="5" x2="12" y2="19"/>
              <line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
          </button>
          <button class="rd-btn-icon rd-btn-routes-toggle" onclick="rdToggleRouteList()" title="Lista de vías" aria-label="Lista de vías">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="8" y1="6" x2="21" y2="6"/>
              <line x1="8" y1="12" x2="21" y2="12"/>
              <line x1="8" y1="18" x2="21" y2="18"/>
              <line x1="3" y1="6" x2="3.01" y2="6"/>
              <line x1="3" y1="12" x2="3.01" y2="12"/>
              <line x1="3" y1="18" x2="3.01" y2="18"/>
            </svg>
          </button>
          <button class="rd-btn-icon rd-btn-reset" onclick="rdResetView()" title="Ajustar la foto a la pantalla" aria-label="Ajustar la foto a la pantalla">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M8 3H5a2 2 0 0 0-2 2v3"/>
              <path d="M21 8V5a2 2 0 0 0-2-2h-3"/>
              <path d="M3 16v3a2 2 0 0 0 2 2h3"/>
              <path d="M16 21h3a2 2 0 0 0 2-2v-3"/>
            </svg>
          </button>
          <button class="rd-btn-icon rd-btn-close" onclick="closeRouteDrawingEditor()" title="Cerrar editor" aria-label="Cerrar editor">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      </div>

      <!-- Canvas Container -->
      <div class="rd-canvas-container" id="rd-canvas-container">
        <div id="rd-canvas-wrapper"><canvas id="rd-canvas"></canvas></div>
      </div>

      <!-- Panel lateral de vías (colapsable) -->
      <div class="rd-routes-panel" id="rd-routes-panel">
        <div class="rd-panel-header">
          <h3>Vías del sector</h3>
          <button class="rd-btn-icon rd-btn-panel-close" onclick="rdToggleRouteList()" title="Ocultar la lista" aria-label="Ocultar la lista">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <div class="rd-panel-search">
          <input type="search" id="rd-route-search" placeholder="Buscar vía" aria-label="Buscar vía" oninput="rdFilterRoutes()">
        </div>
        <div class="rd-panel-list" id="rd-route-list">
          ${renderRoutesList()}
        </div>
      </div>

      <!-- Instrucciones flotantes -->
      <div class="rd-instructions" id="rd-instructions" role="status" aria-live="polite">
        <p>Elige una vía de la lista para dibujar su línea sobre la foto</p>
      </div>

      <!-- Controles de dibujo (ocultos por defecto) -->
      <div class="rd-drawing-controls" id="rd-drawing-controls" style="display: none;">
        <button class="rd-btn-control rd-btn-undo" onclick="rdUndoLastPoint()" id="rd-btn-undo" disabled title="Deshacer último punto">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 7v6h6"/>
            <path d="M21 17a9 9 0 00-9-9 9 9 0 00-6 2.3L3 13"/>
          </svg>
          Deshacer
        </button>
        <button class="rd-btn-control rd-btn-finish" onclick="rdFinishDrawing()" id="rd-btn-finish" disabled title="Terminar y guardar">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
          Terminar
        </button>
        <button class="rd-btn-control rd-btn-cancel" onclick="rdCancelDrawing()" title="Cancelar">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
          Cancelar
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(editor);

  // Cargar imagen y configurar canvas
  setupCanvas(imageUrl);
}

/**
 * Busca el trazado de una vía (y variante) en la foto abierta
 */
function rdFindDrawing(route) {
  const vi = route.variantIndex || 0;
  return rdRouteDrawings.find(d => {
    const idMatch = d.routeId === route.routeId || (!d.routeId && d.routeName === route.nombre);
    return idMatch && (d.variantIndex || 0) === vi;
  });
}

/**
 * ¿Pertenece el trazado a esta foto? (sin imageId = primera foto, legacy_0)
 */
function rdInImage(drawing, imageId) {
  return drawing.imageId ? drawing.imageId === imageId : imageId === 'legacy_0';
}

/**
 * ¿Es el mismo trazado (vía + variante) en la misma foto? Una vía puede estar
 * dibujada en varias fotos del sector: guardar o borrar en una no toca las demás.
 */
function rdSameDrawing(d, ref) {
  const sameRoute = (d.routeId !== undefined && ref.routeId !== undefined)
    ? d.routeId === ref.routeId && (d.variantIndex || 0) === (ref.variantIndex || 0)
    : d.routeId === undefined && ref.routeId === undefined && d.routeName === ref.routeName;
  if (!sameRoute) return false;
  const refImage = ref.imageId || (rdCurrentSector && rdCurrentSector.imageId) || 'legacy_0';
  return (d.imageId || 'legacy_0') === refImage;
}

/**
 * Trazado de la vía (y variante) en otra foto del sector, si lo hay
 */
function rdFindDrawingElsewhere(route) {
  const vi = route.variantIndex || 0;
  return rdOtherDrawings.find(d => {
    const idMatch = d.routeId === route.routeId || (!d.routeId && d.routeName === route.nombre);
    return idMatch && (d.variantIndex || 0) === vi;
  });
}

/**
 * Números de croquis de todo el sector: la foto abierta más las demás fotos.
 * Mientras se edita un trazado (quitado un momento de la lista) sigue contando.
 */
function rdComputeTopoNumbers() {
  const drawings = rdOtherDrawings.concat(rdRouteDrawings);
  if (rdEditMode && rdOriginalDrawing && !rdRouteDrawings.includes(rdOriginalDrawing)) {
    const editedKey = kxDrawingKey(rdOriginalDrawing);
    if (!drawings.some(d => kxDrawingKey(d) === editedKey)) drawings.push(rdOriginalDrawing);
  }
  const currentId = rdCurrentSector && rdCurrentSector.imageId;
  // Los trazados de la foto abierta pertenecen a ella aunque no lleven imageId
  const tagged = drawings.map(d => (currentId && !d.imageId && rdRouteDrawings.includes(d)) ? { ...d, imageId: currentId } : d);
  return kxTopoNumbers(tagged, rdSectorImages.map(img => img.id));
}

/**
 * Texto de avance: cuántas vías del sector tienen trazado en esta foto
 */
function rdProgressText() {
  const total = rdRoutesList.length;
  if (total === 0) return 'Sin vías';
  // Una vía cuenta una vez aunque esté dibujada en varias fotos
  const drawn = rdRoutesList.filter(route => rdFindDrawing(route) || rdFindDrawingElsewhere(route)).length;
  return `${drawn} de ${total} dibujadas`;
}

/**
 * Renderiza la lista de vías (y actualiza el avance de la cabecera)
 */
function renderRoutesList() {
  const progress = document.getElementById('rd-progress');
  if (progress) progress.textContent = rdProgressText();

  if (rdRoutesList.length === 0) {
    return '<p class="rd-empty-message">No hay vías en este sector</p>';
  }

  // Mismo número que la chapa del inicio de la vía sobre la foto
  const topoNumbers = rdComputeTopoNumbers();

  return rdRoutesList.map(route => {
    const vi = route.variantIndex || 0;
    const hasDrawing = rdFindDrawing(route);
    const elsewhere = !hasDrawing && rdFindDrawingElsewhere(route);
    const gradeColor = kxGradeColorSafe(route.grado);
    const name = kxEsc(route.nombre || 'Sin nombre');
    const displayName = vi > 0 ? `${name} <em class="rd-variant-label">variante ${vi}</em>` : name;
    const branchCount = hasDrawing && hasDrawing.branches ? hasDrawing.branches.length : 0;

    return `
      <div class="rd-route-item ${hasDrawing ? 'rd-has-drawing' : ''} ${vi > 0 ? 'rd-route-variant-item' : ''}" onclick="selectRouteForDrawing(${route.routeId}, ${vi})">
        <div class="rd-route-status">
          ${hasDrawing
            ? `<span class="rd-status-icon rd-status-drawn" title="Dibujada: número ${topoNumbers.get(kxDrawingKey(hasDrawing))} en la foto">${topoNumbers.get(kxDrawingKey(hasDrawing))}</span>`
            : elsewhere
              ? `<span class="rd-status-icon rd-status-elsewhere" title="Dibujada en otra foto (número ${topoNumbers.get(kxDrawingKey(elsewhere))}). Toca para dibujarla también en esta">${topoNumbers.get(kxDrawingKey(elsewhere))}</span>`
              : `<span class="rd-status-icon rd-status-pending" title="Sin dibujar"></span>`}
        </div>
        <div class="rd-route-info">
          <span class="rd-route-name">${displayName}</span>
          ${elsewhere ? `<span class="rd-elsewhere-note">en otra foto</span>` : ''}
          ${branchCount > 0 ? `<span class="rd-branch-badge" title="${branchCount} ramal(es)">${branchCount}R</span>` : ''}
          <span class="rd-route-grade" style="background-color: ${gradeColor}; color: ${kxGradeInk(gradeColor)}">${kxEsc(route.grado)}</span>
        </div>
        ${hasDrawing ? `
          <div class="rd-route-actions">
            <button class="rd-btn-edit" onclick="event.stopPropagation(); editRouteDrawing(${route.routeId}, ${vi})" title="Editar dibujo" aria-label="Editar dibujo de ${name}">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 20h9"/>
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
              </svg>
            </button>
            <button class="rd-btn-fork" onclick="event.stopPropagation(); startBifurcation(${route.routeId}, ${vi})" title="Dibujar variante (ramal)" aria-label="Dibujar una variante de ${name}">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M6 3v12"/>
                <circle cx="18" cy="6" r="3"/>
                <circle cx="6" cy="18" r="3"/>
                <path d="M18 9a9 9 0 0 1-9 9"/>
              </svg>
            </button>
            <button class="rd-btn-delete" onclick="event.stopPropagation(); deleteRouteDrawing(${route.routeId}, ${vi})" title="Eliminar dibujo" aria-label="Eliminar dibujo de ${name}">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                <path d="M10 11v6"/>
                <path d="M14 11v6"/>
                <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
              </svg>
            </button>
          </div>
        ` : `
          <span class="rd-route-draw-cue" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 20h9"/>
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
            </svg>
          </span>
        `}
      </div>
    `;
  }).join('');
}

// ============================================
// SETUP CANVAS
// ============================================

/**
 * Configura el canvas y carga la imagen
 */
function setupCanvas(imageUrl) {
  rdCanvas = document.getElementById('rd-canvas');
  rdCtx = rdCanvas.getContext('2d');

  // Cargar imagen
  rdImage = new Image();
  rdImage.crossOrigin = 'anonymous';
  rdImage.onload = () => {
    initializeCanvas();
    redrawCanvas();
  };
  rdImage.onerror = () => {
    showRDToast('Error cargando la imagen', 'error');
  };
  rdImage.src = imageUrl;

  // Event listeners del canvas
  rdCanvas.addEventListener('mousedown', handleCanvasMouseDown);
  rdCanvas.addEventListener('mousemove', handleCanvasMouseMove);
  rdCanvas.addEventListener('mouseup', handleCanvasMouseUp);
  rdCanvas.addEventListener('mouseleave', handleCanvasMouseUp);
  rdCanvas.addEventListener('click', handleCanvasClick);
  rdCanvas.addEventListener('dblclick', handleCanvasDoubleClick);
  rdCanvas.addEventListener('touchstart', handleCanvasTouchStart, { passive: false });
  rdCanvas.addEventListener('touchmove', handleCanvasTouchMove, { passive: false });
  rdCanvas.addEventListener('touchend', handleCanvasTouchEnd);
  rdCanvas.addEventListener('touchcancel', handleCanvasTouchEnd);
  rdCanvas.addEventListener('wheel', handleCanvasWheel, { passive: false });
}

/**
 * Inicializa el tamaño del canvas con soporte para pantallas de alta densidad (retina/móvil)
 */
function initializeCanvas() {
  const container = document.getElementById('rd-canvas-container');
  const containerWidth = container.clientWidth;
  const containerHeight = container.clientHeight;

  // Obtener el ratio de píxeles del dispositivo para pantallas de alta densidad
  const dpr = window.devicePixelRatio || 1;

  // Ajustar canvas al tamaño del contenedor manteniendo aspect ratio
  const imgAspect = rdImage.width / rdImage.height;
  const containerAspect = containerWidth / containerHeight;

  let displayWidth, displayHeight;

  if (containerAspect > imgAspect) {
    // Contenedor más ancho - ajustar por altura
    displayHeight = containerHeight;
    displayWidth = containerHeight * imgAspect;
  } else {
    // Contenedor más alto - ajustar por ancho
    displayWidth = containerWidth;
    displayHeight = containerWidth / imgAspect;
  }

  // Establecer el tamaño interno del canvas (mayor resolución para nitidez)
  rdCanvas.width = displayWidth * dpr;
  rdCanvas.height = displayHeight * dpr;

  // Establecer el tamaño visual del canvas via CSS
  rdCanvas.style.width = displayWidth + 'px';
  rdCanvas.style.height = displayHeight + 'px';

  // Escalar el contexto para que las operaciones de dibujo sean en coordenadas lógicas
  rdCtx.scale(dpr, dpr);

  // Guardar el DPR para uso en otras funciones
  rdCanvas.dpr = dpr;
  rdCanvas.displayWidth = displayWidth;
  rdCanvas.displayHeight = displayHeight;

  console.log('[RouteDrawing] Canvas inicializado:', displayWidth, 'x', displayHeight, '@ DPR:', dpr);
}

// ============================================
// DIBUJO EN CANVAS
// ============================================

/**
 * Redibuja todo el canvas
 */
function redrawCanvas() {
  if (!rdCanvas || !rdCtx || !rdImage) return;

  const dpr = rdCanvas.dpr || 1;
  const displayWidth = rdCanvas.displayWidth || rdCanvas.width;
  const displayHeight = rdCanvas.displayHeight || rdCanvas.height;

  // Resetear transformaciones y limpiar
  rdCtx.setTransform(1, 0, 0, 1, 0, 0);
  rdCtx.clearRect(0, 0, rdCanvas.width, rdCanvas.height);

  // Restaurar escala para DPR
  rdCtx.scale(dpr, dpr);

  // Dibujar imagen de fondo usando dimensiones lógicas
  rdCtx.drawImage(rdImage, 0, 0, displayWidth, displayHeight);

  // Numeración de croquis de la foto (izquierda → derecha)
  rdTopoNumbers = rdComputeTopoNumbers();

  // PASO 1: Dibujar TODAS las líneas primero
  rdRouteDrawings.forEach((drawing, index) => {
    const isSelected = rdCurrentRoute && (
      (drawing.routeId !== undefined && drawing.routeId === rdCurrentRoute.routeId && (drawing.variantIndex || 0) === (rdCurrentRoute.variantIndex || 0)) ||
      (drawing.routeId === undefined && drawing.routeName === rdCurrentRoute.nombre)
    );
    drawRouteLineOnly(drawing, isSelected);
  });

  // PASO 1.5: Dibujar TODAS las reuniones encima de las líneas
  rdRouteDrawings.forEach((drawing, index) => {
    const isSelected = rdCurrentRoute && (
      (drawing.routeId !== undefined && drawing.routeId === rdCurrentRoute.routeId && (drawing.variantIndex || 0) === (rdCurrentRoute.variantIndex || 0)) ||
      (drawing.routeId === undefined && drawing.routeName === rdCurrentRoute.nombre)
    );
    drawRouteAnchorOnly(drawing, isSelected);
  });

  // PASO 2: Dibujar TODOS los puntos encima (para que no queden tapados)
  rdRouteDrawings.forEach((drawing, index) => {
    const isSelected = rdCurrentRoute && (
      (drawing.routeId !== undefined && drawing.routeId === rdCurrentRoute.routeId && (drawing.variantIndex || 0) === (rdCurrentRoute.variantIndex || 0)) ||
      (drawing.routeId === undefined && drawing.routeName === rdCurrentRoute.nombre)
    );
    drawRoutePointOnly(drawing, isSelected);
  });

  // PASO 3: Dibujar elementos auxiliares guardados (incluye rápel)
  drawAuxElements();

  // Dibujar línea temporal si estamos dibujando
  if (rdDrawingMode && rdDrawingPoints.length > 0) {
    drawTemporaryLine();
  }

  // Dibujar elemento auxiliar temporal si estamos en modo aux
  if (rdAuxMode && rdAuxPoints.length > 0) {
    drawAuxTemporary();
  }
}

/**
 * Obtiene los puntos escalados y el color de un dibujo
 */
function getRouteDrawingData(drawing, isSelected) {
  // Usar dimensiones lógicas para el escalado (sin DPR)
  const displayWidth = rdCanvas.displayWidth || rdCanvas.width;
  const displayHeight = rdCanvas.displayHeight || rdCanvas.height;
  const scaleX = displayWidth / rdImage.width;
  const scaleY = displayHeight / rdImage.height;

  const dvi = drawing.variantIndex || 0;
  const route = rdRoutesList.find(r =>
    ((drawing.routeId !== undefined && r.routeId === drawing.routeId && (r.variantIndex || 0) === dvi) ||
    (drawing.routeId === undefined && r.nombre === drawing.routeName))
  );
  const gradeColor = route && typeof getGradeColor === 'function'
    ? getGradeColor(route.grado)
    : RD_COLORS.normal;

  const color = isSelected ? RD_COLORS.selected : gradeColor;

  let points = [];
  if (drawing.points && drawing.points.length > 0) {
    points = drawing.points;
  } else if (drawing.startPoint && drawing.endPoint) {
    points = [drawing.startPoint, drawing.endPoint];
  } else {
    return null;
  }

  const scaledPoints = points.map(p => ({
    x: p.x * scaleX,
    y: p.y * scaleY
  }));

  return { scaledPoints, color, isSelected };
}

/**
 * Dibuja solo la LÍNEA de una vía (sin el punto)
 * Soporta múltiples paths (tronco + ramas)
 */
function drawRouteLineOnly(drawing, isSelected) {
  const data = getRouteDrawingData(drawing, isSelected);
  if (!data) return;

  const { color } = data;
  const paths = resolveDrawingPaths(drawing);

  const displayWidth = rdCanvas.displayWidth || rdCanvas.width;
  const displayHeight = rdCanvas.displayHeight || rdCanvas.height;
  const scaleX = displayWidth / rdImage.width;
  const scaleY = displayHeight / rdImage.height;

  paths.forEach(path => {
    if (!path.points || path.points.length < 2) return;

    const scaledPoints = path.points.map(p => ({
      x: p.x * scaleX,
      y: p.y * scaleY
    }));

    kxDrawTopoLine(rdCtx, scaledPoints, color, { width: isSelected ? 4 : 3 });
  });
}

/**
 * Dibuja solo el icono de reunión de una vía (separado para controlar z-order)
 * Soporta múltiples paths (reunión al final de cada rama)
 */
function drawRouteAnchorOnly(drawing, isSelected) {
  const data = getRouteDrawingData(drawing, isSelected);
  if (!data) return;

  const { color } = data;
  const paths = resolveDrawingPaths(drawing);

  const displayWidth = rdCanvas.displayWidth || rdCanvas.width;
  const displayHeight = rdCanvas.displayHeight || rdCanvas.height;
  const scaleX = displayWidth / rdImage.width;
  const scaleY = displayHeight / rdImage.height;

  // Reuniones que comparten varias vías: una sola chapa, dibujada por la primera
  const shared = kxSharedAnchors(rdRouteDrawings, d => getRouteDrawingData(d, false).color);
  const drawingKey = kxDrawingKey(drawing);

  paths.forEach(path => {
    if (!path.anchorType || !path.points || path.points.length < 2) return;
    const share = shared.get(`${drawingKey}#${path.branchId}`);
    if (share && !share.lead) return;

    const scaledPoints = path.points.map(p => ({
      x: p.x * scaleX,
      y: p.y * scaleY
    }));

    const lastPoint = scaledPoints[scaledPoints.length - 1];
    const prevPoint = scaledPoints[scaledPoints.length - 2];
    drawAnchorIcon(lastPoint.x, lastPoint.y, prevPoint.x, prevPoint.y, path.anchorType, color, share && share.colors);
  });
}

/**
 * Dibuja la chapa de reunión al final de la vía
 * (prevX, prevY orientan la flecha de «sin terminar»)
 */
function drawAnchorIcon(x, y, prevX, prevY, anchorType, color, colors) {
  kxDrawTopoChip(rdCtx, x, y, anchorType, color, {
    radius: 8,
    colors,
    angle: Math.atan2(y - prevY, x - prevX)
  });
}






/**
 * Dibuja solo el PUNTO de inicio de una vía y diamantes en puntos de bifurcación
 */
function drawRoutePointOnly(drawing, isSelected) {
  const data = getRouteDrawingData(drawing, isSelected);
  if (!data) return;

  const { scaledPoints, color } = data;
  // Chapa numerada en el inicio del tronco (mismo número que en la lista y en el visor)
  drawNumber(scaledPoints[0].x, scaledPoints[0].y, rdTopoNumbers.get(kxDrawingKey(drawing)), color, isSelected);

  // Diamantes en puntos de bifurcación
  if (drawing.branches && drawing.branches.length > 0) {
    const displayWidth = rdCanvas.displayWidth || rdCanvas.width;
    const displayHeight = rdCanvas.displayHeight || rdCanvas.height;
    const scaleX = displayWidth / rdImage.width;
    const scaleY = displayHeight / rdImage.height;

    drawing.branches.forEach(branch => {
      if (branch.forkPoint) {
        const fx = branch.forkPoint.x * scaleX;
        const fy = branch.forkPoint.y * scaleY;
        drawForkDiamond(fx, fy, color);
      }
    });
  }
}

/**
 * Dibuja un punto circular
 */
function drawPoint(x, y, color, radius) {
  rdCtx.fillStyle = RD_COLORS.point;
  rdCtx.strokeStyle = color;
  rdCtx.lineWidth = 3;

  rdCtx.beginPath();
  rdCtx.arc(x, y, radius, 0, Math.PI * 2);
  rdCtx.fill();
  rdCtx.stroke();
}

/**
 * Dibuja la chapa numerada del inicio de una vía
 */
function drawNumber(x, y, number, bgColor, isSelected = false) {
  kxDrawTopoBadge(rdCtx, x, y, number, bgColor, { radius: 9, highlighted: isSelected });
}

// ============================================
// INTERACCIÓN CON CANVAS
// ============================================

// ── Zoom helpers ──────────────────────────────────────────────────────────────

function getTouchDistance(t1, t2) {
  const dx = t2.clientX - t1.clientX;
  const dy = t2.clientY - t1.clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

function rdApplyZoomTransform(immediate = false) {
  const wrapper = document.getElementById('rd-canvas-wrapper');
  if (!wrapper) return;
  const { translateX, translateY, scale } = rdZoomState;
  wrapper.style.transition = immediate ? 'none' : 'transform 0.1s ease-out';
  wrapper.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
}

function rdConstrainPan() {
  if (rdZoomState.scale <= 1) {
    rdZoomState.translateX = 0;
    rdZoomState.translateY = 0;
    return;
  }
  const container = document.getElementById('rd-canvas-container');
  if (!container || !rdCanvas) return;
  const scaledW = (rdCanvas.displayWidth || rdCanvas.clientWidth) * rdZoomState.scale;
  const scaledH = (rdCanvas.displayHeight || rdCanvas.clientHeight) * rdZoomState.scale;
  const maxTX = Math.max(0, (scaledW - container.clientWidth) / 2);
  const maxTY = Math.max(0, (scaledH - container.clientHeight) / 2);
  rdZoomState.translateX = Math.max(-maxTX, Math.min(maxTX, rdZoomState.translateX));
  rdZoomState.translateY = Math.max(-maxTY, Math.min(maxTY, rdZoomState.translateY));
}

function rdResetZoom() {
  rdZoomState.scale = 1;
  rdZoomState.translateX = 0;
  rdZoomState.translateY = 0;
  rdApplyZoomTransform(false);
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Obtiene las coordenadas del canvas desde un evento
 */
function getCanvasCoordinates(e, isTouch = false) {
  const rect = rdCanvas.getBoundingClientRect();
  const displayWidth = rdCanvas.displayWidth || rdCanvas.width;
  const displayHeight = rdCanvas.displayHeight || rdCanvas.height;

  let clientX, clientY;
  if (isTouch) {
    clientX = e.touches[0].clientX;
    clientY = e.touches[0].clientY;
  } else {
    clientX = e.clientX;
    clientY = e.clientY;
  }

  const x = (clientX - rect.left) * (displayWidth / rect.width);
  const y = (clientY - rect.top) * (displayHeight / rect.height);

  return { x, y };
}

/**
 * Convierte coordenadas de canvas a coordenadas de imagen original
 */
function canvasToImageCoords(canvasX, canvasY) {
  const displayWidth = rdCanvas.displayWidth || rdCanvas.width;
  const displayHeight = rdCanvas.displayHeight || rdCanvas.height;
  return {
    x: canvasX / displayWidth * rdImage.width,
    y: canvasY / displayHeight * rdImage.height
  };
}

/**
 * Convierte coordenadas de imagen original a coordenadas de canvas
 */
function imageToCanvasCoords(imageX, imageY) {
  const displayWidth = rdCanvas.displayWidth || rdCanvas.width;
  const displayHeight = rdCanvas.displayHeight || rdCanvas.height;
  return {
    x: imageX * displayWidth / rdImage.width,
    y: imageY * displayHeight / rdImage.height
  };
}

/**
 * Encuentra el índice del punto más cercano al clic (si está dentro del radio de hit)
 * @returns {number} Índice del punto o -1 si no hay ninguno cercano
 */
function findNearestPointIndex(canvasX, canvasY) {
  if (rdDrawingPoints.length === 0) return -1;

  let nearestIndex = -1;
  let nearestDistance = Infinity;

  for (let i = 0; i < rdDrawingPoints.length; i++) {
    const point = rdDrawingPoints[i];
    const canvasPoint = imageToCanvasCoords(point.x, point.y);
    const distance = Math.sqrt(
      Math.pow(canvasX - canvasPoint.x, 2) +
      Math.pow(canvasY - canvasPoint.y, 2)
    );

    if (distance < nearestDistance && distance <= RD_POINT_HIT_RADIUS) {
      nearestDistance = distance;
      nearestIndex = i;
    }
  }

  return nearestIndex;
}

/**
 * Maneja clic del mouse en el canvas
 */
/**
 * Maneja clic simple (mousedown + mouseup sin arrastre)
 * Usado para mostrar el menú contextual al hacer clic en zona vacía
 */
function handleCanvasClick(e) {
  // Modo borrador: intentar borrar elemento bajo el cursor
  if (rdEraserMode && !rdWasDragging) {
    const { x, y } = getCanvasCoordinates(e);
    eraserHitTest(x, y).then(hit => {
      if (!hit) {
        // Clic en zona vacía: salir del modo borrador
        exitEraserMode();
      }
    });
    rdWasDragging = false;
    return;
  }

  // Solo mostrar menú si no hay ningún modo activo y no hubo arrastre
  if (!rdDrawingMode && !rdCurrentRoute && !rdAuxMode && !rdBifurcationMode && !rdEditAuxMode && !rdWasDragging) {
    showAuxContextMenu(e.clientX, e.clientY);
  }
  rdWasDragging = false;
}

function handleCanvasMouseDown(e) {
  // Cerrar menú contextual si está abierto (el canvas está debajo del menú, no interfiere)
  closeAuxContextMenu();

  // Modo edición de elementos auxiliares
  if (rdEditAuxMode) {
    const { x, y } = getCanvasCoordinates(e);
    handleEditAuxMouseDown(x, y);
    return;
  }

  // Modo auxiliar: añadir puntos (incluye rápel)
  if (rdAuxMode) {
    const { x, y } = getCanvasCoordinates(e);
    handleAuxMouseDown(x, y);
    return;
  }

  // Modo bifurcación: buscar segmento de línea para crear fork
  if (rdBifurcationMode) {
    const { x, y } = getCanvasCoordinates(e);
    handleBifurcationClick(x, y);
    return;
  }

  if (!rdDrawingMode || !rdCurrentRoute) return;

  const { x, y } = getCanvasCoordinates(e);

  // Verificar si estamos haciendo clic en un punto existente para arrastrarlo
  const pointIndex = findNearestPointIndex(x, y);

  if (pointIndex !== -1) {
    // Iniciar arrastre del punto
    rdDraggingPointIndex = pointIndex;
    rdIsDragging = true;
    rdSelectedPointIndex = pointIndex;
    rdCanvas.style.cursor = 'grabbing';
    updateInstructions(`Arrastrando punto ${pointIndex + 1}. Suelta para posicionar.`);
  } else {
    // Añadir nuevo punto
    handleDrawingPoint(x, y);
  }
}

/**
 * Maneja movimiento del mouse en el canvas
 */
function handleCanvasMouseMove(e) {
  // Arrastre en modo edición de elementos auxiliares
  if (rdEditAuxMode) {
    const { x, y } = getCanvasCoordinates(e);
    if (rdEditAuxIsDragging && rdEditAuxElementIndex !== -1 && rdEditAuxPointIndex !== -1) {
      const imageCoords = canvasToImageCoords(x, y);
      rdAuxElements[rdEditAuxElementIndex].points[rdEditAuxPointIndex] = imageCoords;
      rdWasDragging = true;
      redrawCanvas();
    } else {
      // Cambiar cursor si estamos sobre un punto de un elemento guardado
      const hit = findNearestAuxElementPoint(x, y);
      rdCanvas.style.cursor = hit ? 'grab' : 'crosshair';
    }
    return;
  }

  // Arrastre de elemento auxiliar
  if (rdAuxMode) {
    const { x, y } = getCanvasCoordinates(e);
    if (rdAuxIsDragging && rdAuxDraggingIndex !== -1) {
      const imageCoords = canvasToImageCoords(x, y);
      rdAuxPoints[rdAuxDraggingIndex] = imageCoords;
      redrawCanvas();
    } else {
      const pointIndex = findNearestAuxPointIndex(x, y);
      rdCanvas.style.cursor = pointIndex !== -1 ? 'grab' : 'crosshair';
    }
    return;
  }

  if (!rdDrawingMode || !rdCurrentRoute) return;

  const { x, y } = getCanvasCoordinates(e);

  if (rdIsDragging && rdDraggingPointIndex !== -1) {
    // Actualizar posición del punto siendo arrastrado
    const imageCoords = canvasToImageCoords(x, y);
    rdDrawingPoints[rdDraggingPointIndex] = imageCoords;
    rdWasDragging = true;
    redrawCanvas();
  } else {
    // Cambiar cursor si estamos sobre un punto
    const pointIndex = findNearestPointIndex(x, y);
    rdCanvas.style.cursor = pointIndex !== -1 ? 'grab' : 'crosshair';
  }
}

/**
 * Maneja cuando se suelta el mouse
 */
function handleCanvasMouseUp(e) {
  // Fin de arrastre en modo edición
  if (rdEditAuxMode && rdEditAuxIsDragging && rdEditAuxElementIndex !== -1) {
    showRDToast('Elemento movido', 'success');
    saveAuxElements();
    rdEditAuxIsDragging = false;
    rdEditAuxPointIndex = -1;
    rdCanvas.style.cursor = 'crosshair';
    redrawCanvas();
    return;
  }

  // Fin de arrastre de punto auxiliar
  if (rdAuxMode && rdAuxIsDragging && rdAuxDraggingIndex !== -1) {
    showRDToast('Punto movido', 'success');
    rdAuxIsDragging = false;
    rdAuxDraggingIndex = -1;
    rdCanvas.style.cursor = 'crosshair';
    redrawCanvas();
    return;
  }

  if (rdIsDragging && rdDraggingPointIndex !== -1) {
    showRDToast(`Punto ${rdDraggingPointIndex + 1} movido`, 'success');
    updateInstructions(`Punto movido. Sigue editando o pulsa «Terminar».`);
  }

  rdIsDragging = false;
  rdDraggingPointIndex = -1;
  rdCanvas.style.cursor = 'crosshair';
  updateDrawingControls();
}

/**
 * Maneja toque táctil en el canvas
 * 1 dedo = dibujar/arrastrar punto | 2 dedos = pinch-zoom + pan
 */
function handleCanvasTouchStart(e) {
  e.preventDefault();

  // 2 dedos → iniciar pinch-zoom (el primer dedo no llega a poner ningún punto)
  if (e.touches.length === 2) {
    rdPendingTap = null;
    rdIsDragging = false;
    rdDraggingPointIndex = -1;
    rdZoomState.isPinching = true;
    rdZoomState.isPanning = false;
    rdZoomState.pinchStartDist = getTouchDistance(e.touches[0], e.touches[1]);
    rdZoomState.pinchStartScale = rdZoomState.scale;
    rdZoomState.pinchCenterX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
    rdZoomState.pinchCenterY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
    return;
  }

  // Ignorar 1 dedo si estamos en medio de un pinch
  if (rdZoomState.isPinching) return;

  // Cerrar menú contextual si está abierto
  closeAuxContextMenu();

  // Modo edición de elementos auxiliares
  if (rdEditAuxMode) {
    const { x, y } = getCanvasCoordinates(e, true);
    handleEditAuxMouseDown(x, y);
    return;
  }

  // Modo auxiliar: añadir puntos (incluye rápel); arrastrar un punto existente empieza ya
  if (rdAuxMode) {
    const { x, y } = getCanvasCoordinates(e, true);
    if (findNearestAuxPointIndex(x, y) !== -1) handleAuxMouseDown(x, y);
    else rdDeferTap(e, () => handleAuxMouseDown(x, y));
    return;
  }

  // Modo bifurcación
  if (rdBifurcationMode) {
    const { x, y } = getCanvasCoordinates(e, true);
    rdDeferTap(e, () => handleBifurcationClick(x, y));
    return;
  }

  // Sin vía seleccionada: pan con 1 dedo si hay zoom activo, o detectar tap para menú
  if (!rdDrawingMode || !rdCurrentRoute) {
    if (rdZoomState.scale > 1) {
      rdZoomState.isPanning = true;
      rdZoomState.panStartX = e.touches[0].clientX;
      rdZoomState.panStartY = e.touches[0].clientY;
      rdZoomState.lastTranslateX = rdZoomState.translateX;
      rdZoomState.lastTranslateY = rdZoomState.translateY;
    } else {
      // Guardar posición para detectar tap y mostrar menú contextual
      rdTouchStartPos = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      rdTouchStartTime = Date.now();
    }
    return;
  }

  const { x, y } = getCanvasCoordinates(e, true);
  const pointIndex = findNearestPointIndex(x, y);
  if (pointIndex !== -1) {
    // Doble toque sobre el mismo punto: eliminarlo (equivale al doble clic del ratón)
    const now = Date.now();
    if (rdLastPointTap.index === pointIndex && now - rdLastPointTap.time < 350) {
      rdLastPointTap = { index: -1, time: 0 };
      rdDeleteSpecificPoint(pointIndex);
      return;
    }
    rdLastPointTap = { index: pointIndex, time: now };

    rdDraggingPointIndex = pointIndex;
    rdIsDragging = true;
    rdSelectedPointIndex = pointIndex;
    updateInstructions(`Arrastrando punto ${pointIndex + 1}. Suelta para posicionar.`);
  } else {
    rdLastPointTap = { index: -1, time: 0 };
    rdDeferTap(e, () => handleDrawingPoint(x, y));
  }
}

/**
 * Un toque que añade un punto no se aplica al apoyar el dedo, sino al levantarlo
 * si fue un toque corto y quieto: así un gesto de zoom con dos dedos (o un
 * arrastre) no deja puntos sueltos.
 */
function rdDeferTap(e, action) {
  const touch = e.touches[0];
  rdPendingTap = { action, x: touch.clientX, y: touch.clientY, time: Date.now() };
}

const RD_TAP_MAX_MOVE = 12;     // px que puede moverse el dedo y seguir siendo un toque
const RD_TAP_MAX_TIME = 700;    // ms máximos de un toque

/**
 * Maneja movimiento táctil en el canvas
 */
function handleCanvasTouchMove(e) {
  e.preventDefault();

  if (rdPendingTap) {
    const moved = e.touches.length !== 1 ||
      Math.hypot(e.touches[0].clientX - rdPendingTap.x, e.touches[0].clientY - rdPendingTap.y) > RD_TAP_MAX_MOVE;
    if (moved) rdPendingTap = null;
  }

  // 2 dedos → pinch-zoom
  if (e.touches.length === 2) {
    if (!rdZoomState.isPinching) {
      // Segundo dedo llegó mientras el primero ya estaba abajo → transición a pinch
      rdZoomState.isPinching = true;
      rdZoomState.isPanning = false;
      rdIsDragging = false;
      rdDraggingPointIndex = -1;
      rdZoomState.pinchStartDist = getTouchDistance(e.touches[0], e.touches[1]);
      rdZoomState.pinchStartScale = rdZoomState.scale;
      rdZoomState.pinchCenterX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      rdZoomState.pinchCenterY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      return;
    }

    const currentDist = getTouchDistance(e.touches[0], e.touches[1]);
    const rawScale = rdZoomState.pinchStartScale * (currentDist / rdZoomState.pinchStartDist);
    const newScale = Math.max(rdZoomState.minScale, Math.min(rdZoomState.maxScale, rawScale));

    const currentCenterX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
    const currentCenterY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
    const container = document.getElementById('rd-canvas-container');
    const rect = container.getBoundingClientRect();
    const pivotX = rdZoomState.pinchCenterX - (rect.left + rect.width / 2);
    const pivotY = rdZoomState.pinchCenterY - (rect.top + rect.height / 2);

    const sf = newScale / rdZoomState.scale;
    rdZoomState.translateX = rdZoomState.translateX * sf - pivotX * (sf - 1)
                             + (currentCenterX - rdZoomState.pinchCenterX);
    rdZoomState.translateY = rdZoomState.translateY * sf - pivotY * (sf - 1)
                             + (currentCenterY - rdZoomState.pinchCenterY);
    rdZoomState.pinchCenterX = currentCenterX;
    rdZoomState.pinchCenterY = currentCenterY;
    rdZoomState.scale = newScale;
    rdConstrainPan();
    rdApplyZoomTransform(true);
    return;
  }

  // 1 dedo: pan cuando no hay vía seleccionada y hay zoom activo
  if (rdZoomState.isPanning) {
    rdZoomState.translateX = rdZoomState.lastTranslateX + (e.touches[0].clientX - rdZoomState.panStartX);
    rdZoomState.translateY = rdZoomState.lastTranslateY + (e.touches[0].clientY - rdZoomState.panStartY);
    rdConstrainPan();
    rdApplyZoomTransform(true);
    return;
  }

  // 1 dedo: arrastrar en modo edición
  if (rdEditAuxMode && rdEditAuxIsDragging && rdEditAuxElementIndex !== -1 && rdEditAuxPointIndex !== -1) {
    const { x, y } = getCanvasCoordinates(e, true);
    rdAuxElements[rdEditAuxElementIndex].points[rdEditAuxPointIndex] = canvasToImageCoords(x, y);
    rdWasDragging = true;
    redrawCanvas();
    return;
  }

  // 1 dedo: arrastrar punto auxiliar
  if (rdAuxMode && rdAuxIsDragging && rdAuxDraggingIndex !== -1) {
    const { x, y } = getCanvasCoordinates(e, true);
    rdAuxPoints[rdAuxDraggingIndex] = canvasToImageCoords(x, y);
    redrawCanvas();
    return;
  }

  // Invalidar tap si hubo movimiento significativo
  if (rdTouchStartPos) {
    const dx = e.touches[0].clientX - rdTouchStartPos.x;
    const dy = e.touches[0].clientY - rdTouchStartPos.y;
    if (Math.sqrt(dx * dx + dy * dy) > 15) {
      rdTouchStartPos = null;
  rdPendingTap = null;
    }
  }

  // 1 dedo: arrastrar punto existente
  if (!rdDrawingMode || !rdCurrentRoute) return;
  if (!rdIsDragging || rdDraggingPointIndex === -1) return;

  const { x, y } = getCanvasCoordinates(e, true);
  rdDrawingPoints[rdDraggingPointIndex] = canvasToImageCoords(x, y);
  redrawCanvas();
}

/**
 * Maneja cuando se termina el toque
 */
function handleCanvasTouchEnd(e) {
  // Toque corto y quieto: ahora sí se añade el punto
  if (rdPendingTap) {
    const tap = rdPendingTap;
    rdPendingTap = null;
    if (e.type === 'touchend' && e.touches.length === 0 && !rdZoomState.isPinching && Date.now() - tap.time < RD_TAP_MAX_TIME) {
      tap.action();
    }
    return;
  }

  // Fin de pinch (se levantó un dedo)
  if (rdZoomState.isPinching && e.touches.length < 2) {
    rdZoomState.isPinching = false;
    if (rdZoomState.scale < rdZoomState.minScale) rdResetZoom();
    return;
  }

  if (rdZoomState.isPanning) {
    rdZoomState.isPanning = false;
    return;
  }

  // Fin de arrastre en modo edición (touch)
  if (rdEditAuxMode && rdEditAuxIsDragging && rdEditAuxElementIndex !== -1) {
    showRDToast('Elemento movido', 'success');
    saveAuxElements();
    rdEditAuxIsDragging = false;
    rdEditAuxPointIndex = -1;
    redrawCanvas();
    return;
  }

  // Fin de arrastre de punto auxiliar (touch)
  if (rdAuxMode && rdAuxIsDragging && rdAuxDraggingIndex !== -1) {
    showRDToast('Punto movido', 'success');
    rdAuxIsDragging = false;
    rdAuxDraggingIndex = -1;
    redrawCanvas();
    return;
  }

  // Modo borrador: detectar tap para borrar elemento
  if (rdEraserMode && rdTouchStartPos) {
    const elapsed = Date.now() - rdTouchStartTime;
    const touch = e.changedTouches[0];
    if (touch && elapsed < 400) {
      const dx = touch.clientX - rdTouchStartPos.x;
      const dy = touch.clientY - rdTouchStartPos.y;
      if (Math.sqrt(dx * dx + dy * dy) < 15) {
        const { x, y } = getCanvasCoordinates(touch);
        eraserHitTest(x, y).then(hit => {
          if (!hit) exitEraserMode();
        });
      }
    }
    rdTouchStartPos = null;
    rdTouchStartTime = 0;
    return;
  }

  // Detectar tap para mostrar menú contextual (sin modo activo)
  if (rdTouchStartPos && !rdDrawingMode && !rdCurrentRoute && !rdAuxMode && !rdBifurcationMode && !rdEditAuxMode) {
    const elapsed = Date.now() - rdTouchStartTime;
    const touch = e.changedTouches[0];
    if (touch && elapsed < 400) {
      const dx = touch.clientX - rdTouchStartPos.x;
      const dy = touch.clientY - rdTouchStartPos.y;
      if (Math.sqrt(dx * dx + dy * dy) < 15) {
        showAuxContextMenu(touch.clientX, touch.clientY);
      }
    }
    rdTouchStartPos = null;
    rdTouchStartTime = 0;
    return;
  }

  if (rdIsDragging && rdDraggingPointIndex !== -1) {
    showRDToast(`Punto ${rdDraggingPointIndex + 1} movido`, 'success');
    updateInstructions(`Punto movido. Sigue editando o pulsa «Terminar».`);
  }

  rdIsDragging = false;
  rdDraggingPointIndex = -1;
  updateDrawingControls();
}

/**
 * Zoom con rueda del ratón (web desktop)
 */
function handleCanvasWheel(e) {
  e.preventDefault();
  const container = document.getElementById('rd-canvas-container');
  const rect = container.getBoundingClientRect();
  const mouseX = e.clientX - (rect.left + rect.width / 2);
  const mouseY = e.clientY - (rect.top + rect.height / 2);
  const delta = e.deltaY > 0 ? -0.15 : 0.15;
  const oldScale = rdZoomState.scale;
  const newScale = Math.max(rdZoomState.minScale, Math.min(rdZoomState.maxScale, oldScale + delta));
  if (newScale === oldScale) return;
  const sf = newScale / oldScale;
  rdZoomState.translateX = rdZoomState.translateX * sf - mouseX * (sf - 1);
  rdZoomState.translateY = rdZoomState.translateY * sf - mouseY * (sf - 1);
  rdZoomState.scale = newScale;
  rdConstrainPan();
  rdApplyZoomTransform(false);
}

/**
 * Maneja doble clic en el canvas para eliminar un punto
 */
function handleCanvasDoubleClick(e) {
  // Doble clic en modo auxiliar: eliminar punto
  if (rdAuxMode) {
    const { x, y } = getCanvasCoordinates(e);
    const pointIndex = findNearestAuxPointIndex(x, y);
    if (pointIndex !== -1) {
      rdAuxPoints.splice(pointIndex, 1);
      showRDToast('Punto eliminado', 'info');
      updateAuxDrawingControls();
      redrawCanvas();
    }
    return;
  }

  if (!rdDrawingMode || !rdCurrentRoute) return;

  const { x, y } = getCanvasCoordinates(e);
  const pointIndex = findNearestPointIndex(x, y);

  if (pointIndex !== -1) {
    rdDeleteSpecificPoint(pointIndex);
  }
}

/**
 * Elimina un punto específico del dibujo
 * @param {number} index - Índice del punto a eliminar
 */
function rdDeleteSpecificPoint(index) {
  if (index < 0 || index >= rdDrawingPoints.length) return;

  // Verificar que quedarían al menos 0 puntos (permitir eliminar todos)
  rdDrawingPoints.splice(index, 1);
  rdSelectedPointIndex = -1;

  showRDToast(`Punto ${index + 1} eliminado`, 'info');

  if (rdDrawingPoints.length === 0) {
    updateInstructions(`Todos los puntos eliminados. Toca para añadir el primer punto.`);
  } else {
    updateInstructions(`Punto eliminado. Quedan ${rdDrawingPoints.length} punto(s). Doble toque sobre un punto para eliminar otro.`);
  }

  updateDrawingControls();
  redrawCanvas();
}

/**
 * Maneja un punto de dibujo (añadir nuevo punto)
 */
function handleDrawingPoint(x, y) {
  // Normalizar coordenadas a escala de imagen original
  const imageCoords = canvasToImageCoords(x, y);

  // Añadir punto al array
  rdDrawingPoints.push(imageCoords);

  // Actualizar UI
  updateDrawingControls();

  if (rdDrawingPoints.length === 1) {
    updateInstructions(`Punto 1 añadido. Toca para añadir más puntos.`);
  } else {
    updateInstructions(`${rdDrawingPoints.length} puntos. Arrastra un punto para moverlo; doble toque para eliminarlo.`);
  }

  // Redibujar para mostrar preview
  redrawCanvas();
}

/**
 * Dibuja la línea temporal mientras se está dibujando
 * Si estamos dibujando una rama, prefija con el forkPoint
 */
function drawTemporaryLine() {
  if (rdDrawingPoints.length === 0 && !rdActiveForkPoint) return;

  // Usar dimensiones lógicas para el escalado (sin DPR)
  const displayWidth = rdCanvas.displayWidth || rdCanvas.width;
  const displayHeight = rdCanvas.displayHeight || rdCanvas.height;
  const scaleX = displayWidth / rdImage.width;
  const scaleY = displayHeight / rdImage.height;

  // Si estamos dibujando una rama, incluir forkPoint al inicio
  let allPoints = rdDrawingPoints;
  let forkOffset = 0;
  if (rdCurrentBranchId > 0 && rdActiveForkPoint) {
    allPoints = [rdActiveForkPoint, ...rdDrawingPoints];
    forkOffset = 1; // Para no contar el forkPoint como punto editable
  }

  if (allPoints.length === 0) return;

  const scaledPoints = allPoints.map(p => ({
    x: p.x * scaleX,
    y: p.y * scaleY
  }));

  const color = RD_COLORS.selected; // Usar color de selección para preview

  // Dibujar línea temporal
  rdCtx.strokeStyle = color;
  rdCtx.lineWidth = 3;
  rdCtx.lineCap = 'round';
  rdCtx.lineJoin = 'round';
  rdCtx.setLineDash([5, 5]); // Línea punteada para indicar que es temporal

  rdCtx.beginPath();
  rdCtx.moveTo(scaledPoints[0].x, scaledPoints[0].y);
  for (let i = 1; i < scaledPoints.length; i++) {
    rdCtx.lineTo(scaledPoints[i].x, scaledPoints[i].y);
  }
  rdCtx.stroke();

  // Reset line dash
  rdCtx.setLineDash([]);

  // Dibujar diamante en forkPoint si es una rama
  if (forkOffset > 0 && scaledPoints.length > 0) {
    drawForkDiamond(scaledPoints[0].x, scaledPoints[0].y, color);
  }

  // Dibujar puntos editables (excluir forkPoint del conteo editable)
  for (let i = forkOffset; i < scaledPoints.length; i++) {
    const editIndex = i - forkOffset;
    const isBeingDragged = rdIsDragging && rdDraggingPointIndex === editIndex;
    const isSelected = rdSelectedPointIndex === editIndex;
    drawEditablePoint(scaledPoints[i].x, scaledPoints[i].y, editIndex, color, isBeingDragged, isSelected);
  }
}

/**
 * Dibuja un punto editable con indicadores visuales
 */
function drawEditablePoint(x, y, index, color, isDragging, isSelected) {
  const baseRadius = index === 0 ? 6 : 5; // Puntos más pequeños para mejor edición
  const radius = isDragging ? baseRadius + 2 : baseRadius;

  // Sombra/glow para punto siendo arrastrado
  if (isDragging) {
    rdCtx.fillStyle = 'rgba(245, 158, 11, 0.4)';
    rdCtx.beginPath();
    rdCtx.arc(x, y, radius + 5, 0, Math.PI * 2);
    rdCtx.fill();
  }

  // Borde exterior oscuro para contraste
  rdCtx.fillStyle = 'rgba(0, 0, 0, 0.8)';
  rdCtx.beginPath();
  rdCtx.arc(x, y, radius + 2, 0, Math.PI * 2);
  rdCtx.fill();

  // Círculo blanco exterior (indica que es arrastrable)
  rdCtx.fillStyle = '#ffffff';
  rdCtx.beginPath();
  rdCtx.arc(x, y, radius + 1, 0, Math.PI * 2);
  rdCtx.fill();

  // Círculo interior con el color
  rdCtx.fillStyle = isDragging ? '#ef4444' : color;
  rdCtx.beginPath();
  rdCtx.arc(x, y, radius, 0, Math.PI * 2);
  rdCtx.fill();
}

/**
 * Actualiza el estado de los botones de control
 */
function updateDrawingControls() {
  const controlsDiv = document.getElementById('rd-drawing-controls');
  const undoBtn = document.getElementById('rd-btn-undo');
  const finishBtn = document.getElementById('rd-btn-finish');

  if (rdAuxMode) {
    updateAuxDrawingControls();
    return;
  }

  if (rdDrawingMode) {
    controlsDiv.style.display = 'flex';
    undoBtn.disabled = rdDrawingPoints.length === 0;
    finishBtn.disabled = rdDrawingPoints.length < 2; // Mínimo 2 puntos
  } else {
    controlsDiv.style.display = 'none';
  }
}

/**
 * Deshace el último punto añadido
 */
function rdUndoLastPoint() {
  // Redirigir a aux si estamos en modo auxiliar
  if (rdAuxMode) {
    rdAuxUndoLastPoint();
    return;
  }

  if (rdDrawingPoints.length > 0) {
    rdDrawingPoints.pop();
    updateDrawingControls();

    if (rdDrawingPoints.length === 0) {
      updateInstructions(`Dibujando: ${rdCurrentRoute.nombre} (${rdCurrentRoute.grado}). Toca para añadir el primer punto.`);
    } else {
      updateInstructions(`Punto eliminado. Tienes ${rdDrawingPoints.length} punto(s). Sigue o pulsa «Terminar».`);
    }

    redrawCanvas();
  }
}

/**
 * Termina el dibujo y muestra el selector de tipo de reunión
 */
async function rdFinishDrawing() {
  // Redirigir a aux si estamos en modo auxiliar
  if (rdAuxMode) {
    rdAuxFinishDrawing();
    return;
  }

  if (rdDrawingPoints.length < 2) {
    showRDToast('Se requieren al menos 2 puntos para guardar', 'warning');
    return;
  }

  // ¿Termina junto a la reunión de otra vía? Se ofrece compartirla
  const near = rdFindNearbyAnchor();
  if (near) {
    const name = kxEsc(rdDrawingLabel(near.drawing));
    const share = await rdConfirm('¿Compartir reunión?', `El final queda junto a la reunión de «${name}». Las dos vías compartirán la misma reunión.`, 'Compartir');
    if (share) {
      rdDrawingPoints[rdDrawingPoints.length - 1] = { x: near.point.x, y: near.point.y };
      redrawCanvas();
      await selectAnchorType(near.anchorType);
      return;
    }
  }

  // Mostrar modal para seleccionar tipo de reunión
  showAnchorTypeModal();
}

/**
 * Muestra el modal para seleccionar el tipo de reunión
 */
function showAnchorTypeModal() {
  // Eliminar modal existente si hay uno
  const existing = document.getElementById('rd-anchor-modal');
  if (existing) existing.remove();

  // Obtener el color de la vía actual para previsualización
  const route = rdRoutesList.find(r => r.routeId === rdCurrentRoute.routeId);
  const gradeColor = route && typeof getGradeColor === 'function'
    ? getGradeColor(route.grado)
    : RD_COLORS.normal;

  const modal = document.createElement('div');
  modal.id = 'rd-anchor-modal';
  modal.className = 'rd-modal-overlay';
  modal.innerHTML = `
    <div class="rd-modal-container rd-anchor-modal-container">
      <div class="rd-modal-header">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="5" r="3"/>
          <line x1="12" y1="8" x2="12" y2="21"/>
          <path d="M5 12h14"/>
        </svg>
        <h3>Tipo de Reunión</h3>
      </div>
      <div class="rd-modal-body rd-anchor-body">
        <p>Selecciona el tipo de reunión al final de la vía:</p>
        <div class="rd-anchor-options">
          ${Object.values(RD_ANCHOR_TYPES).filter(a => a.id !== 'sin_terminar').map(anchor => `
            <button class="rd-anchor-option" data-anchor="${anchor.id}" onclick="selectAnchorType('${anchor.id}')">
              <div class="rd-anchor-icon" style="color: ${gradeColor}">
                ${getAnchorSVG(anchor.id)}
              </div>
              <div class="rd-anchor-info">
                <span class="rd-anchor-name">${anchor.name}</span>
                <span class="rd-anchor-desc">${anchor.description}</span>
              </div>
            </button>
          `).join('')}
          <div class="rd-anchor-separator">
            <span>o bien...</span>
          </div>
          <button class="rd-anchor-option rd-anchor-option-unfinished" data-anchor="sin_terminar" onclick="selectAnchorType('sin_terminar')">
            <div class="rd-anchor-icon" style="color: ${gradeColor}">
              ${getAnchorSVG('sin_terminar')}
            </div>
            <div class="rd-anchor-info">
              <span class="rd-anchor-name">${RD_ANCHOR_TYPES.sin_terminar.name}</span>
              <span class="rd-anchor-desc">${RD_ANCHOR_TYPES.sin_terminar.description}</span>
            </div>
          </button>
        </div>
      </div>
      <div class="rd-modal-footer">
        <button class="rd-modal-btn rd-modal-btn-cancel" onclick="closeAnchorModal()">Cancelar</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Cerrar con click fuera del modal
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closeAnchorModal();
    }
  });
}

/**
 * Cierra el modal de selección de reunión
 */
function closeAnchorModal() {
  const modal = document.getElementById('rd-anchor-modal');
  if (modal) modal.remove();
}

/**
 * Selecciona un tipo de reunión y guarda el dibujo
 */
async function selectAnchorType(anchorType) {
  closeAnchorModal();

  // Modo rama: guardar como branch del drawing existente
  if (rdCurrentBranchId > 0 && rdBifurcatingDrawing) {
    await saveBranch(anchorType);
    return;
  }

  // Modo edición de rama existente
  if (rdEditMode && rdCurrentBranchId > 0 && rdOriginalDrawing) {
    await saveEditedBranch(anchorType);
    return;
  }

  const isEditing = rdEditMode && rdOriginalDrawing;

  const drawing = {
    routeId: rdCurrentRoute.routeId,
    routeName: rdCurrentRoute.nombre,
    ...((rdCurrentRoute.variantIndex || 0) > 0 && { variantIndex: rdCurrentRoute.variantIndex }),
    points: rdDrawingPoints,
    anchorType: anchorType,
    createdAt: isEditing ? rdOriginalDrawing.createdAt : new Date().toISOString(),
    createdBy: isEditing ? rdOriginalDrawing.createdBy : auth.currentUser?.uid,
    ...(isEditing && {
      updatedAt: new Date().toISOString(),
      updatedBy: auth.currentUser?.uid
    })
  };

  // Preservar branches existentes si estamos editando el tronco
  if (isEditing && rdOriginalDrawing.branches && rdOriginalDrawing.branches.length > 0) {
    drawing.branches = rdOriginalDrawing.branches;
  }

  // Guardar dibujo
  await saveRouteDrawing(drawing, isEditing);

  // Resetear estado de dibujo
  rdDrawingPoints = [];
  rdDrawingMode = false;
  rdCurrentRoute = null;
  rdEditMode = false;
  rdOriginalDrawing = null;
  rdCurrentBranchId = -1;
  rdBranchesData = [];
  updateDrawingControls();

  // Si estábamos en modo obligatorio, cerrar el editor después de guardar exitosamente
  if (rdMandatoryDrawingMode && rdPendingRouteInfo) {
    showRDToast('Vía añadida correctamente con su dibujo', 'success');

    rdPendingRouteInfo = null;
    rdMandatoryDrawingMode = false;

    setTimeout(() => {
      closeRouteDrawingEditor();
    }, 1500);
  } else {
    const message = isEditing ? 'Dibujo actualizado correctamente.' : 'Dibujo guardado. Selecciona otra vía para continuar.';
    updateInstructions(message);
  }
}

/**
 * Guarda una nueva rama en el drawing existente
 */
async function saveBranch(anchorType) {
  if (rdDrawingsLoadFailed) {
    showRDToast('No se puede guardar: los dibujos no se cargaron. Vuelve a abrir el editor.', 'error');
    return;
  }
  if (!rdBifurcatingDrawing || !rdActiveForkPoint || rdDrawingPoints.length < 2) {
    showRDToast('Error: datos de bifurcación incompletos', 'error');
    return;
  }

  // Crear objeto de rama
  const branch = {
    branchId: rdCurrentBranchId,
    forkPointIndex: rdActiveForkSegmentIndex,
    forkPoint: rdActiveForkPoint,
    points: [...rdDrawingPoints],
    anchorType: anchorType
  };

  // Añadir rama al drawing
  if (!rdBifurcatingDrawing.branches) {
    rdBifurcatingDrawing.branches = [];
  }
  rdBifurcatingDrawing.branches.push(branch);
  rdBifurcatingDrawing.updatedAt = new Date().toISOString();
  rdBifurcatingDrawing.updatedBy = auth.currentUser?.uid;

  // Guardar en Firestore
  try {
    const docId = `${rdCurrentSector.schoolId}_${normalizeSectorName(rdCurrentSector.sectorName)}`;
    const docRef = db.collection('sector_route_drawings').doc(docId);
    const doc = await docRef.get();

    let allDrawings = [];
    if (doc.exists) {
      allDrawings = doc.data().drawings || [];
      // Reemplazar el drawing actualizado
      allDrawings = allDrawings.map(d => rdSameDrawing(d, rdBifurcatingDrawing) ? rdBifurcatingDrawing : d);
    }

    await kxBackupRouteDrawings(docRef, 'guardar-ramal', { snapshot: doc });
    await docRef.set({
      schoolId: rdCurrentSector.schoolId,
      sectorName: rdCurrentSector.sectorName,
      drawings: allDrawings,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedBy: auth.currentUser?.uid
    }, { merge: true });

    // Actualizar array local
    rdRouteDrawings = rdRouteDrawings.map(d => rdSameDrawing(d, rdBifurcatingDrawing) ? rdBifurcatingDrawing : d);

    showRDToast(`Ramal ${rdCurrentBranchId} guardado correctamente`, 'success');

  } catch (error) {
    console.error('[RouteDrawing] Error guardando rama:', error);
    showRDToast('Error al guardar rama: ' + error.message, 'error');
    // Revertir
    rdBifurcatingDrawing.branches = rdBifurcatingDrawing.branches.filter(b => b.branchId !== rdCurrentBranchId);
  }

  // Resetear estado
  rdDrawingPoints = [];
  rdDrawingMode = false;
  rdCurrentRoute = null;
  rdBifurcatingDrawing = null;
  rdActiveForkPoint = null;
  rdActiveForkSegmentIndex = -1;
  rdCurrentBranchId = -1;
  updateDrawingControls();

  // Actualizar lista y redibujar
  const routeListEl = document.getElementById('rd-route-list');
  if (routeListEl) routeListEl.innerHTML = renderRoutesList();
  redrawCanvas();

  updateInstructions('Ramal guardado. Selecciona otra vía para continuar.');
}

/**
 * Guarda una rama editada
 */
async function saveEditedBranch(anchorType) {
  if (!rdOriginalDrawing || rdCurrentBranchId <= 0) return;

  // Buscar el drawing en rdRouteDrawings (fue restaurado al entrar en edit)
  const targetDrawing = rdRouteDrawings.find(d =>
    (d.routeId !== undefined && d.routeId === rdOriginalDrawing.routeId) ||
    (d.routeId === undefined && d.routeName === rdOriginalDrawing.routeName)
  );

  if (!targetDrawing) {
    // El drawing fue removido por editRouteDrawing, restaurarlo
    const drawing = JSON.parse(JSON.stringify(rdOriginalDrawing));
    // Actualizar la rama editada
    if (drawing.branches) {
      const branchIdx = drawing.branches.findIndex(b => b.branchId === rdCurrentBranchId);
      if (branchIdx !== -1) {
        drawing.branches[branchIdx].points = [...rdDrawingPoints];
        drawing.branches[branchIdx].anchorType = anchorType;
      }
    }
    drawing.updatedAt = new Date().toISOString();
    drawing.updatedBy = auth.currentUser?.uid;

    rdRouteDrawings.push(drawing);
    await saveRouteDrawing(drawing, true);
  }

  // Resetear estado
  rdDrawingPoints = [];
  rdDrawingMode = false;
  rdCurrentRoute = null;
  rdEditMode = false;
  rdOriginalDrawing = null;
  rdCurrentBranchId = -1;
  rdBranchesData = [];
  updateDrawingControls();

  const routeListEl = document.getElementById('rd-route-list');
  if (routeListEl) routeListEl.innerHTML = renderRoutesList();
  redrawCanvas();

  updateInstructions('Ramal actualizado. Selecciona otra vía para continuar.');
}

/**
 * Devuelve el SVG de la chapa de reunión según el tipo.
 * Mismo lenguaje que kxDrawTopoChip: chapa de magnesio, aro del color
 * del grado (currentColor) y glifo en granito.
 */
function getAnchorSVG(type) {
  const glyphs = {
    quimicos: '<circle cx="17.8" cy="24" r="4.2"/><circle cx="30.2" cy="24" r="4.2"/>',
    cadena: '<circle cx="16" cy="17.6" r="2.2" fill="#202923" stroke="none"/><circle cx="32" cy="17.6" r="2.2" fill="#202923" stroke="none"/><polyline points="16,17.6 24,26.2 32,17.6"/><circle cx="24" cy="29.7" r="3.5"/>',
    mosqueton: '<g transform="rotate(21.8 24 24)"><rect x="18.5" y="13.9" width="11" height="20.2" rx="5.5"/><line x1="24.7" y1="19.4" x2="24.7" y2="28.6"/></g>',
    sin_terminar: '<line x1="24" y1="32.6" x2="24" y2="15.4"/><polyline points="17.6,22 24,15.4 30.4,22"/>',
    desconocido: '<text x="24" y="31.5" font-size="22" font-weight="700" font-family="Manrope, -apple-system, sans-serif" fill="#202923" stroke="none" text-anchor="middle">?</text>'
  };
  const glyph = glyphs[type];
  if (!glyph) return '';
  const dash = type === 'sin_terminar' ? ' stroke-dasharray="10 7"' : '';
  return `
    <svg viewBox="0 0 48 48" width="44" height="44" aria-hidden="true">
      <circle cx="24" cy="24" r="22" fill="#F7F6F0"/>
      <circle cx="24" cy="24" r="19.8" fill="none" stroke="currentColor" stroke-width="4.4"${dash}/>
      <g fill="none" stroke="#202923" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">${glyph}</g>
    </svg>
  `;
}

/**
 * Cancela el dibujo actual
 */
function rdCancelDrawing() {
  // Redirigir a aux si estamos en modo auxiliar
  if (rdAuxMode) {
    rdAuxCancelDrawing();
    return;
  }

  // Si estamos en modo edición, restaurar el dibujo original
  if (rdEditMode && rdOriginalDrawing) {
    rdCancelEdit();
    return;
  }

  rdDrawingPoints = [];
  rdDrawingMode = false;
  rdCurrentRoute = null;
  rdEditMode = false;
  rdOriginalDrawing = null;
  rdDraggingPointIndex = -1;
  rdIsDragging = false;
  rdSelectedPointIndex = -1;

  // Limpiar estado de bifurcación
  rdBifurcationMode = false;
  rdBifurcatingDrawing = null;
  rdActiveForkPoint = null;
  rdActiveForkSegmentIndex = -1;
  rdCurrentBranchId = -1;
  rdBranchesData = [];

  updateDrawingControls();

  updateInstructions('Dibujo cancelado. Selecciona una vía para comenzar.');
  redrawCanvas();
}

// ============================================
// EDICIÓN DE DIBUJOS EXISTENTES
// ============================================

/**
 * Inicia el modo de edición para un dibujo existente
 * @param {string} encodedName - Nombre de la vía codificado
 */
function editRouteDrawing(routeId, variantIndex = 0) {
  const vi = variantIndex || 0;
  const route = rdRoutesList.find(r => r.routeId === routeId && (r.variantIndex || 0) === vi);

  if (!route) {
    showRDToast('Vía no encontrada', 'error');
    return;
  }

  // Buscar el dibujo existente para esta variante
  const existingDrawing = rdRouteDrawings.find(d => {
    const idMatch = d.routeId === route.routeId || (!d.routeId && d.routeName === route.nombre);
    return idMatch && (d.variantIndex || 0) === vi;
  });
  if (!existingDrawing) {
    showRDToast('Esta vía no tiene un dibujo para editar', 'warning');
    return;
  }

  // Si tiene ramas, mostrar selector de rama
  if (existingDrawing.branches && existingDrawing.branches.length > 0) {
    showBranchSelector(route, existingDrawing);
    return;
  }

  // Edición normal (sin ramas) - editar tronco directamente
  startEditingBranch(route, existingDrawing, -1);
}

/**
 * Muestra selector de rama para editar
 */
function showBranchSelector(route, drawing) {
  const existing = document.getElementById('rd-branch-modal');
  if (existing) existing.remove();

  const gradeColor = getGradeColor(route.grado);

  const modal = document.createElement('div');
  modal.id = 'rd-branch-modal';
  modal.className = 'rd-modal-overlay';
  modal.innerHTML = `
    <div class="rd-modal-container rd-branch-modal-container">
      <div class="rd-modal-header">
        <h3>Editar: ${route.nombre}</h3>
        <span class="rd-route-grade-header" style="background-color: ${gradeColor}">${route.grado}</span>
      </div>
      <div class="rd-modal-body">
        <p>Selecciona qué parte editar:</p>
        <div class="rd-branch-options">
          <button class="rd-branch-option rd-branch-trunk" onclick="closeBranchSelector(); startEditingBranch(rdRoutesList.find(r => r.routeId === ${route.routeId}), rdRouteDrawings.find(d => d.routeId === ${route.routeId}), -1)">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="12" y1="2" x2="12" y2="22"/>
            </svg>
            Tronco principal
            <span class="rd-branch-points">${drawing.points.length} puntos</span>
          </button>
          ${drawing.branches.map(branch => `
            <button class="rd-branch-option" onclick="closeBranchSelector(); startEditingBranch(rdRoutesList.find(r => r.routeId === ${route.routeId}), rdRouteDrawings.find(d => d.routeId === ${route.routeId}), ${branch.branchId})">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M6 3v12"/>
                <circle cx="18" cy="18" r="3"/>
                <path d="M6 15c0 3 6 3 9 6"/>
              </svg>
              Ramal ${branch.branchId}
              <span class="rd-branch-points">${branch.points.length} puntos</span>
            </button>
          `).join('')}
        </div>
        <div class="rd-branch-delete-section">
          ${drawing.branches.map(branch => `
            <button class="rd-branch-delete-btn" onclick="closeBranchSelector(); deleteBranch(${route.routeId}, ${branch.branchId})">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <line x1="18" y1="6" x2="6" y2="18"/>
                <line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
              Eliminar Ramal ${branch.branchId}
            </button>
          `).join('')}
        </div>
      </div>
      <div class="rd-modal-footer">
        <button class="rd-modal-btn rd-modal-btn-cancel" onclick="closeBranchSelector()">Cancelar</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeBranchSelector();
  });
}

function closeBranchSelector() {
  const modal = document.getElementById('rd-branch-modal');
  if (modal) modal.remove();
}

/**
 * Inicia la edición de una rama o tronco específico
 * @param {Object} route - Datos de la vía
 * @param {Object} drawing - Drawing completo
 * @param {number} branchId - -1 para tronco, >0 para rama
 */
function startEditingBranch(route, drawing, branchId) {
  if (!route || !drawing) return;

  // Guardar el dibujo original por si se cancela
  rdOriginalDrawing = JSON.parse(JSON.stringify(drawing));

  rdCurrentRoute = route;
  rdEditMode = true;
  rdDrawingMode = true;
  rdCurrentBranchId = branchId;

  if (branchId > 0) {
    // Editando una rama
    const branch = drawing.branches.find(b => b.branchId === branchId);
    if (!branch) {
      showRDToast('Rama no encontrada', 'error');
      return;
    }
    rdDrawingPoints = [...branch.points];
    rdActiveForkPoint = branch.forkPoint;
    rdActiveForkSegmentIndex = branch.forkPointIndex;
  } else {
    // Editando tronco
    if (drawing.points && drawing.points.length > 0) {
      rdDrawingPoints = [...drawing.points];
    } else if (drawing.startPoint && drawing.endPoint) {
      rdDrawingPoints = [drawing.startPoint, drawing.endPoint];
    } else {
      rdDrawingPoints = [];
    }
  }

  // Eliminar temporalmente el dibujo del array para que no se muestre duplicado
  // (solo la variante que se edita: las demás variantes de la vía siguen a la vista)
  const editedVariant = route.variantIndex || 0;
  rdRouteDrawings = rdRouteDrawings.filter(d => {
    if (d.routeId !== undefined && route.routeId !== undefined) return !(d.routeId === route.routeId && (d.variantIndex || 0) === editedVariant);
    if (d.routeId === undefined && route.routeId === undefined) return d.routeName !== route.nombre;
    return true;
  });

  // Cerrar panel de vías para poder editar
  const panel = document.getElementById('rd-routes-panel');
  if (panel && !panel.classList.contains('rd-panel-collapsed')) {
    panel.classList.add('rd-panel-collapsed');
  }

  const editTarget = branchId > 0 ? `Ramal ${branchId}` : 'Tronco';
  updateInstructions(`Editando ${editTarget} de: ${route.nombre}. Arrastra un punto para moverlo; doble toque para eliminarlo.`);
  updateDrawingControls();

  document.getElementById('rd-route-list').innerHTML = renderRoutesList();
  redrawCanvas();

  console.log('[RouteDrawing] Editando vía:', route.nombre, 'rama:', branchId, 'con', rdDrawingPoints.length, 'puntos');
}

/**
 * Elimina una rama específica de un drawing
 */
async function deleteBranch(routeId, branchId) {
  const route = rdRoutesList.find(r => r.routeId === routeId);
  if (!route) return;

  const drawing = rdRouteDrawings.find(d =>
    d.routeId === route.routeId || (!d.routeId && d.routeName === route.nombre)
  );
  if (!drawing || !drawing.branches) return;

  if (!await rdConfirm('¿Eliminar el ramal?', `Se borrará el ramal ${branchId} de «${kxEsc(route.nombre)}».`, 'Eliminar')) return;

  // Eliminar la rama
  drawing.branches = drawing.branches.filter(b => b.branchId !== branchId);

  // Si no quedan ramas, eliminar el campo branches
  if (drawing.branches.length === 0) {
    delete drawing.branches;
  }

  drawing.updatedAt = new Date().toISOString();
  drawing.updatedBy = auth.currentUser?.uid;

  try {
    const docId = `${rdCurrentSector.schoolId}_${normalizeSectorName(rdCurrentSector.sectorName)}`;
    const docRef = db.collection('sector_route_drawings').doc(docId);
    const doc = await docRef.get();

    if (doc.exists) {
      let allDrawings = doc.data().drawings || [];
      allDrawings = allDrawings.map(d => rdSameDrawing(d, drawing) ? drawing : d);

      await kxBackupRouteDrawings(docRef, 'borrar-ramal', { snapshot: doc, required: true });
      await docRef.set({
        schoolId: rdCurrentSector.schoolId,
        sectorName: rdCurrentSector.sectorName,
        drawings: allDrawings,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedBy: auth.currentUser?.uid
      }, { merge: true });
    }

    showRDToast(`Ramal ${branchId} eliminado`, 'success');

    document.getElementById('rd-route-list').innerHTML = renderRoutesList();
    redrawCanvas();

  } catch (error) {
    console.error('[RouteDrawing] Error eliminando rama:', error);
    showRDToast('Error al eliminar rama: ' + error.message, 'error');
  }
}

/**
 * Cancela la edición y restaura el dibujo original
 */
function rdCancelEdit() {
  if (rdEditMode && rdOriginalDrawing) {
    // Restaurar el dibujo original
    rdRouteDrawings.push(rdOriginalDrawing);
    showRDToast('Edición cancelada. Dibujo restaurado.', 'info');
  }

  // Limpiar estado de edición
  rdEditMode = false;
  rdOriginalDrawing = null;
  rdDrawingPoints = [];
  rdDrawingMode = false;
  rdCurrentRoute = null;
  rdDraggingPointIndex = -1;
  rdIsDragging = false;
  rdSelectedPointIndex = -1;

  // Limpiar estado de bifurcación/ramas
  rdCurrentBranchId = -1;
  rdBranchesData = [];
  rdActiveForkPoint = null;
  rdActiveForkSegmentIndex = -1;

  updateDrawingControls();
  updateInstructions('Edición cancelada. Selecciona una vía para continuar.');

  // Actualizar lista
  document.getElementById('rd-route-list').innerHTML = renderRoutesList();

  // Redibujar
  redrawCanvas();
}

// ============================================
// SELECCIÓN DE VÍAS
// ============================================

/**
 * Selecciona una vía para dibujar
 */
function selectRouteForDrawing(routeId, variantIndex = 0) {
  const vi = variantIndex || 0;
  const route = rdRoutesList.find(r => r.routeId === routeId && (r.variantIndex || 0) === vi);

  if (!route) return;

  // Verificar si ya existe un dibujo para esta variante
  const existingDrawing = rdRouteDrawings.find(d => {
    const idMatch = d.routeId === route.routeId || (!d.routeId && d.routeName === route.nombre);
    return idMatch && (d.variantIndex || 0) === vi;
  });
  if (existingDrawing) {
    // Mostrar modal con opciones: Editar / Bifurcar / Cancelar
    showRouteActionModal(route, existingDrawing);
    return;
  }

  // Desactivar modo borrador si está activo
  if (rdEraserMode) rdEraserMode = false;

  // Desactivar modo edición si está activo
  if (rdEditAuxMode) exitEditAuxMode();

  // Desactivar modo auxiliar si está activo
  if (rdAuxMode) {
    rdAuxCancelDrawing();
  }

  // Activar modo de dibujo
  rdCurrentRoute = route;
  rdDrawingMode = true;
  rdDrawingPoints = [];

  // Cerrar panel de vías para poder dibujar en la imagen
  const panel = document.getElementById('rd-routes-panel');
  if (panel && !panel.classList.contains('rd-panel-collapsed')) {
    panel.classList.add('rd-panel-collapsed');
  }

  updateInstructions(`Dibujando <strong>${kxEsc(route.nombre || 'Sin nombre')}</strong> (${kxEsc(route.grado)}). Toca el pie de la vía para poner el primer punto.`);
  updateDrawingControls();

  console.log('[RouteDrawing] Vía seleccionada:', route.nombre, 'id:', route.routeId);
}

// ============================================
// BIFURCACIÓN: INTERACCIÓN
// ============================================

/**
 * Muestra modal con opciones cuando se selecciona una vía que ya tiene dibujo
 * Opciones: Editar / Bifurcar / Cancelar
 */
function showRouteActionModal(route, existingDrawing) {
  const existing = document.getElementById('rd-action-modal');
  if (existing) existing.remove();

  const gradeColor = getGradeColor(route.grado);
  const hasBranches = existingDrawing.branches && existingDrawing.branches.length > 0;
  const branchCount = hasBranches ? existingDrawing.branches.length : 0;

  const modal = document.createElement('div');
  modal.id = 'rd-action-modal';
  modal.className = 'rd-modal-overlay';
  modal.innerHTML = `
    <div class="rd-modal-container rd-action-modal-container">
      <div class="rd-modal-header">
        <h3>${kxEsc(route.nombre || 'Sin nombre')}</h3>
        <span class="rd-route-grade-header" style="background-color: ${gradeColor}; color: ${kxGradeInk(gradeColor)}">${kxEsc(route.grado)}</span>
      </div>
      <div class="rd-modal-body">
        <p>Esta vía ya tiene un dibujo${hasBranches ? ` con ${branchCount} ramal(es)` : ''}. ¿Qué quieres hacer?</p>
        <div class="rd-action-options">
          <button class="rd-action-btn rd-action-edit" onclick="closeRouteActionModal(); editRouteDrawing(${route.routeId}, ${route.variantIndex || 0})">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 20h9"/>
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
            </svg>
            Editar
          </button>
          <button class="rd-action-btn rd-action-bifurcate" onclick="closeRouteActionModal(); startBifurcation(${route.routeId}, ${route.variantIndex || 0})">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M6 3v12"/>
              <circle cx="18" cy="6" r="3"/>
              <circle cx="18" cy="18" r="3"/>
              <path d="M6 15c0-3 6-3 9-6"/>
              <path d="M6 15c0 3 6 3 9 6"/>
            </svg>
            Bifurcar
          </button>
        </div>
      </div>
      <div class="rd-modal-footer">
        <button class="rd-modal-btn rd-modal-btn-cancel" onclick="closeRouteActionModal()">Cancelar</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeRouteActionModal();
  });
}

/**
 * Cierra el modal de acciones de vía
 */
function closeRouteActionModal() {
  const modal = document.getElementById('rd-action-modal');
  if (modal) modal.remove();
}

/**
 * Inicia el modo bifurcación: el usuario debe tocar la línea para crear el punto de bifurcación
 */
function startBifurcation(routeId, variantIndex = 0) {
  const vi = variantIndex || 0;
  const route = rdRoutesList.find(r => r.routeId === routeId && (r.variantIndex || 0) === vi);
  if (!route) return;

  const existingDrawing = rdFindDrawing(route);
  if (!existingDrawing) {
    showRDToast('No se encontró el dibujo de la vía', 'error');
    return;
  }

  rdCurrentRoute = route;
  rdBifurcationMode = true;
  rdBifurcatingDrawing = existingDrawing;

  // Cerrar panel de vías
  const panel = document.getElementById('rd-routes-panel');
  if (panel && !panel.classList.contains('rd-panel-collapsed')) {
    panel.classList.add('rd-panel-collapsed');
  }

  // Resaltar la vía en el canvas
  redrawCanvas();

  updateInstructions('Toca sobre la línea de la vía para crear un punto de bifurcación.');
  rdCanvas.style.cursor = 'crosshair';

  // Mostrar controles con botón cancelar
  const controlsDiv = document.getElementById('rd-drawing-controls');
  if (controlsDiv) {
    controlsDiv.style.display = 'flex';
    controlsDiv.innerHTML = `
      <button class="rd-btn-control rd-btn-cancel" onclick="rdCancelBifurcation()" title="Cancelar bifurcación">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"/>
          <line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
        Cancelar
      </button>
    `;
  }

  console.log('[RouteDrawing] Modo bifurcación activado para:', route.nombre);
}

/**
 * Maneja el click en el canvas durante modo bifurcación
 * Busca el segmento más cercano y crea un punto de bifurcación
 */
function handleBifurcationClick(canvasX, canvasY) {
  if (!rdBifurcatingDrawing) return;

  const nearest = findNearestSegmentOnDrawing(canvasX, canvasY, rdBifurcatingDrawing);

  if (!nearest) {
    showRDToast('Toca más cerca de la línea de la vía', 'warning');
    return;
  }

  // Crear el punto de bifurcación
  rdActiveForkPoint = nearest.projectedPoint;
  rdActiveForkSegmentIndex = nearest.segmentIndex;

  // Calcular branchId: siguiente ID disponible
  const existingBranches = rdBifurcatingDrawing.branches || [];
  const maxId = existingBranches.reduce((max, b) => Math.max(max, b.branchId), 0);
  rdCurrentBranchId = maxId + 1;

  // Salir de modo bifurcación y entrar en modo dibujo de rama
  rdBifurcationMode = false;
  rdDrawingMode = true;
  rdDrawingPoints = [];

  // Restaurar controles normales de dibujo
  const controlsDiv = document.getElementById('rd-drawing-controls');
  if (controlsDiv) {
    controlsDiv.innerHTML = `
      <button class="rd-btn-control rd-btn-undo" onclick="rdUndoLastPoint()" id="rd-btn-undo" disabled title="Deshacer último punto">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M3 7v6h6"/>
          <path d="M21 17a9 9 0 00-9-9 9 9 0 00-6 2.3L3 13"/>
        </svg>
        Deshacer
      </button>
      <button class="rd-btn-control rd-btn-finish" onclick="rdFinishDrawing()" id="rd-btn-finish" disabled title="Terminar y guardar">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
        Terminar
      </button>
      <button class="rd-btn-control rd-btn-cancel" onclick="rdCancelDrawing()" title="Cancelar">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"/>
          <line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
        Cancelar
      </button>
    `;
  }

  updateInstructions(`Bifurcación creada (Ramal ${rdCurrentBranchId}). Toca para añadir puntos de la nueva rama.`);
  updateDrawingControls();
  redrawCanvas();

  console.log('[RouteDrawing] Fork creado en segmento', rdActiveForkSegmentIndex,
    'punto:', rdActiveForkPoint, 'branchId:', rdCurrentBranchId);
}

/**
 * Cancela el modo bifurcación sin crear rama
 */
function rdCancelBifurcation() {
  rdBifurcationMode = false;
  rdBifurcatingDrawing = null;
  rdCurrentRoute = null;
  rdActiveForkPoint = null;
  rdActiveForkSegmentIndex = -1;
  rdCurrentBranchId = -1;

  // Ocultar controles
  const controlsDiv = document.getElementById('rd-drawing-controls');
  if (controlsDiv) {
    controlsDiv.style.display = 'none';
    // Restaurar HTML original de controles
    controlsDiv.innerHTML = `
      <button class="rd-btn-control rd-btn-undo" onclick="rdUndoLastPoint()" id="rd-btn-undo" disabled title="Deshacer último punto">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M3 7v6h6"/>
          <path d="M21 17a9 9 0 00-9-9 9 9 0 00-6 2.3L3 13"/>
        </svg>
        Deshacer
      </button>
      <button class="rd-btn-control rd-btn-finish" onclick="rdFinishDrawing()" id="rd-btn-finish" disabled title="Terminar y guardar">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
        Terminar
      </button>
      <button class="rd-btn-control rd-btn-cancel" onclick="rdCancelDrawing()" title="Cancelar">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"/>
          <line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
        Cancelar
      </button>
    `;
  }

  rdCanvas.style.cursor = 'default';
  updateInstructions('Bifurcación cancelada. Selecciona una vía para continuar.');
  redrawCanvas();
}

// ============================================
// GUARDAR Y ELIMINAR DIBUJOS
// ============================================

/**
 * Guarda un dibujo en Firestore
 * Ahora incluye imageId para soportar múltiples imágenes por sector
 * @param {Object} drawing - El dibujo a guardar
 * @param {boolean} isEditing - Si estamos editando un dibujo existente
 */
async function saveRouteDrawing(drawing, isEditing = false) {
  if (rdDrawingsLoadFailed) {
    showRDToast('No se puede guardar: los dibujos no se cargaron. Vuelve a abrir el editor.', 'error');
    return;
  }
  try {
    const docId = `${rdCurrentSector.schoolId}_${normalizeSectorName(rdCurrentSector.sectorName)}`;

    // Añadir imageId al dibujo si estamos editando una imagen específica
    if (rdCurrentSector.imageId) {
      drawing.imageId = rdCurrentSector.imageId;
    }

    // Si estamos editando, el dibujo ya fue removido temporalmente del array
    // Solo necesitamos añadirlo de nuevo
    rdRouteDrawings.push(drawing);

    // Obtener TODOS los dibujos existentes (de todas las imágenes)
    const docRef = db.collection('sector_route_drawings').doc(docId);
    const doc = await docRef.get();

    let allDrawings = [];
    if (doc.exists) {
      const data = doc.data();
      allDrawings = data.drawings || [];

      if (isEditing) {
        // MODO EDICIÓN: Eliminar el dibujo original y añadir el editado
        // (solo el de esta foto: la misma vía puede estar dibujada en otras)
        allDrawings = allDrawings.filter(d => !rdSameDrawing(d, drawing));
        // Añadir el dibujo editado
        allDrawings.push(drawing);
      } else {
        // MODO NUEVO: Si hay imageId, reemplazar solo los dibujos de esta imagen
        if (rdCurrentSector.imageId) {
          // Mantener dibujos de otras imágenes
          allDrawings = allDrawings.filter(d => !rdInImage(d, rdCurrentSector.imageId));
          // Añadir los dibujos actuales de esta imagen
          allDrawings = allDrawings.concat(rdRouteDrawings);
        } else {
          // Modo legacy: reemplazar todos
          allDrawings = rdRouteDrawings;
        }
      }
    } else {
      allDrawings = rdRouteDrawings;
    }

    // Guardar en Firestore
    await kxBackupRouteDrawings(docRef, 'guardar-trazado', { snapshot: doc });
    await docRef.set({
      schoolId: rdCurrentSector.schoolId,
      sectorName: rdCurrentSector.sectorName,
      drawings: allDrawings,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedBy: auth.currentUser?.uid
    }, { merge: true });

    const message = isEditing ? 'Dibujo actualizado correctamente' : 'Dibujo guardado correctamente';
    showRDToast(message, 'success');

    // Actualizar lista de vías
    document.getElementById('rd-route-list').innerHTML = renderRoutesList();

    // Redibujar
    redrawCanvas();

  } catch (error) {
    console.error('[RouteDrawing] Error guardando dibujo:', error);
    showRDToast('Error al guardar: ' + error.message, 'error');
    // Revertir cambio local
    rdRouteDrawings.pop();
    // Si estábamos editando, restaurar el original
    if (isEditing && rdOriginalDrawing) {
      rdRouteDrawings.push(rdOriginalDrawing);
    }
  }
}

/**
 * Elimina un dibujo
 */
async function deleteRouteDrawing(routeId, variantIndex = 0) {
  const vi = variantIndex || 0;
  const route = rdRoutesList.find(r => r.routeId === routeId && (r.variantIndex || 0) === vi);
  const baseName = route ? route.nombre : routeId;
  const displayName = vi > 0 ? `${baseName} (variante ${vi})` : baseName;

  if (!await rdConfirm('¿Eliminar el dibujo?', `Se borrará la línea de «${kxEsc(displayName)}» en esta foto. La vía no se elimina.`, 'Eliminar')) return;

  try {
    const docId = `${rdCurrentSector.schoolId}_${normalizeSectorName(rdCurrentSector.sectorName)}`;

    // Remover del array local solo el dibujo de esta variante
    rdRouteDrawings = rdRouteDrawings.filter(d => {
      if (d.routeId !== undefined && routeId !== undefined) {
        return !(d.routeId === routeId && (d.variantIndex || 0) === vi);
      }
      return d.routeName !== baseName;
    });

    // Actualizar Firestore: releer el documento y quitar solo este dibujo.
    // rdRouteDrawings contiene solo los dibujos de la imagen abierta; escribirlo tal cual
    // borraba los dibujos del resto de imágenes del sector.
    const docRef = db.collection('sector_route_drawings').doc(docId);
    const doc = await docRef.get();
    const imageId = rdCurrentSector.imageId;
    const allDrawings = (doc.exists ? doc.data().drawings || [] : []).filter(d => {
      if (imageId && (d.imageId || 'legacy_0') !== imageId) return true;
      if (d.routeId !== undefined && routeId !== undefined) {
        return !(Number(d.routeId) === routeId && (d.variantIndex || 0) === vi);
      }
      return d.routeName !== baseName;
    });

    await kxBackupRouteDrawings(docRef, 'borrar-trazado', { snapshot: doc, required: true });
    await docRef.set({
      schoolId: rdCurrentSector.schoolId,
      sectorName: rdCurrentSector.sectorName,
      drawings: allDrawings,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedBy: auth.currentUser?.uid
    }, { merge: true });

    showRDToast('Dibujo eliminado', 'success');

    // Actualizar lista
    document.getElementById('rd-route-list').innerHTML = renderRoutesList();

    // Redibujar
    redrawCanvas();

  } catch (error) {
    console.error('[RouteDrawing] Error eliminando dibujo:', error);
    showRDToast('Error al eliminar: ' + error.message, 'error');
  }
}

// ============================================
// SISTEMA DE PUNTOS DE RÁPEL
// ============================================

/**
 * Activa/desactiva el modo rápel
 */
// rdToggleRapelMode removed - rapel now uses aux system via enterAuxMode('rapel')

/**
 * Dibuja la chapa de rápel - reutilizable por editor y visor
 */
function drawRapelIcon(ctx, x, y, size, color) {
  kxDrawTopoChip(ctx, x, y, 'rapel', color, { radius: size * 0.6 });
}

// ============================================
// ELEMENTOS AUXILIARES: MENÚ CONTEXTUAL
// ============================================

/**
 * Muestra el menú contextual para elegir tipo de elemento auxiliar
 */
function showAuxContextMenu(clientX, clientY) {
  closeAuxContextMenu();

  const container = document.getElementById('rd-canvas-container');
  if (!container) return;
  const containerRect = container.getBoundingClientRect();

  // Posición relativa al contenedor
  let menuX = clientX - containerRect.left;
  let menuY = clientY - containerRect.top;

  const menu = document.createElement('div');
  menu.id = 'rd-aux-context-menu';
  menu.className = 'rd-aux-context-menu';
  menu.innerHTML = `
    <div class="rd-aux-menu-title">Añadir elemento</div>
    <button class="rd-aux-menu-item" onclick="toggleEditAuxMode()">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
        <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
      </svg>
      <span style="color: ${rdEditAuxMode ? '#DCE9DF' : 'inherit'}">${rdEditAuxMode ? '✓ Editar (activo)' : 'Editar'}</span>
    </button>
    <button class="rd-aux-menu-item" onclick="toggleEraserMode()">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2">
        <path d="M20 20H7L3 16c-.8-.8-.8-2 0-2.8L14.2 2c.8-.8 2-.8 2.8 0L21.8 6.8c.8.8.8 2 0 2.8L10 21"/>
        <line x1="18" y1="13" x2="11" y2="6"/>
      </svg>
      <span style="color: ${rdEraserMode ? '#ef4444' : 'inherit'}">${rdEraserMode ? '✓ Borrador (activo)' : 'Borrador'}</span>
    </button>
    <div class="rd-aux-menu-separator" style="border-top: 1px solid rgba(255,255,255,0.1); margin: 4px 0;"></div>
    <button class="rd-aux-menu-item" onclick="enterAuxMode('rapel')">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="5" r="3"/>
        <circle cx="12" cy="5" r="1.2" fill="currentColor"/>
        <polyline points="10,8 8,14 10,20" stroke-linecap="round"/>
        <polyline points="14,8 16,14 14,20" stroke-linecap="round"/>
      </svg>
      <span>Punto de Rápel</span>
    </button>
    <button class="rd-aux-menu-item" onclick="enterAuxMode('descent_line')">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="${RD_COLORS.descent_line}" stroke-width="2">
        <line x1="4" y1="4" x2="20" y2="20" stroke-dasharray="4 3"/>
        <polyline points="14,20 20,20 20,14"/>
      </svg>
      <span>Línea de descenso/ascenso</span>
    </button>
    <button class="rd-aux-menu-item" onclick="enterAuxMode('grapas')">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="${RD_COLORS.grapas}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M6,4 L6,14 Q6,18 10,18 L14,18 Q18,18 18,14 L18,4"/>
      </svg>
      <span>Escalera de grapas</span>
    </button>
    <button class="rd-aux-menu-item" onclick="enterAuxMode('cadena')">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="${RD_COLORS.cadena}" stroke-width="2">
        <ellipse cx="9" cy="8" rx="5" ry="3.5" transform="rotate(-30 9 8)"/>
        <ellipse cx="15" cy="16" rx="5" ry="3.5" transform="rotate(-30 15 16)"/>
      </svg>
      <span>Cadena</span>
    </button>
    <div class="rd-aux-menu-separator" style="border-top: 1px solid rgba(255,255,255,0.1); margin: 4px 0;"></div>
    <button class="rd-aux-menu-item" onclick="closeAuxContextMenu(); showSharedAnchorsModal()">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M5 21V12a7 7 0 0 1 7-7"/>
        <path d="M19 21V12a7 7 0 0 0-7-7"/>
        <circle cx="12" cy="5" r="2.2"/>
      </svg>
      <span>Unir reuniones</span>
    </button>
    <button class="rd-aux-menu-item" onclick="closeAuxContextMenu(); showDrawingBackupsModal()">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3 12a9 9 0 1 0 3-6.7"/>
        <polyline points="3 4 3 9 8 9"/>
        <polyline points="12 7 12 12 15.5 14"/>
      </svg>
      <span>Copias de seguridad</span>
    </button>
  `;

  container.appendChild(menu);

  // Ajustar posición si se sale del contenedor
  const menuRect = menu.getBoundingClientRect();
  if (menuX + menuRect.width > containerRect.width) {
    menuX = containerRect.width - menuRect.width - 8;
  }
  if (menuY + menuRect.height > containerRect.height) {
    menuY = containerRect.height - menuRect.height - 8;
  }
  if (menuX < 8) menuX = 8;
  if (menuY < 8) menuY = 8;

  menu.style.left = menuX + 'px';
  menu.style.top = menuY + 'px';

  // Cerrar con clic fuera (en el siguiente frame para no cerrarse con el clic actual)
  requestAnimationFrame(() => {
    document.addEventListener('click', closeAuxContextMenuOutside, { once: true });
  });
}

function closeAuxContextMenu() {
  const menu = document.getElementById('rd-aux-context-menu');
  if (menu) menu.remove();
  document.removeEventListener('click', closeAuxContextMenuOutside);
}

function closeAuxContextMenuOutside(e) {
  const menu = document.getElementById('rd-aux-context-menu');
  if (menu && !menu.contains(e.target)) {
    closeAuxContextMenu();
  }
}

/**
 * Entra en un modo auxiliar de dibujo
 */
function enterAuxMode(mode) {
  closeAuxContextMenu();

  // Verificar que no hay otros modos activos
  if (rdDrawingMode || rdBifurcationMode) {
    showRDToast('Termina el modo actual antes de añadir elementos', 'warning');
    return;
  }

  // Salir del modo edición si estaba activo
  if (rdEditAuxMode) exitEditAuxMode();

  rdAuxMode = mode;
  rdAuxPoints = [];
  rdAuxDraggingIndex = -1;
  rdAuxIsDragging = false;
  rdCanvas.style.cursor = 'crosshair';

  const modeNames = {
    descent_line: 'Línea de descenso/ascenso',
    grapas: 'Escalera de grapas',
    cadena: 'Cadena',
    rapel: 'Punto de Rápel'
  };

  const modeInstructions = {
    descent_line: 'Toca para añadir puntos de la línea. Doble clic para eliminar un punto.',
    grapas: 'Toca para colocar grapas. Doble clic para eliminar una grapa.',
    cadena: 'Toca para añadir puntos de la cadena. Doble clic para eliminar un punto.',
    rapel: 'Toca para colocar puntos de rápel. Doble clic para eliminar un punto.'
  };

  updateInstructions(`${modeNames[mode]}: ${modeInstructions[mode]}`);
  updateAuxDrawingControls();
  showRDToast(`Modo: ${modeNames[mode]}`, 'success');
}

// ============================================
// ELEMENTOS AUXILIARES: INTERACCIÓN
// ============================================

/**
 * Maneja clic/tap en modo auxiliar
 */
function handleAuxMouseDown(canvasX, canvasY) {
  const imageCoords = canvasToImageCoords(canvasX, canvasY);

  // Buscar si estamos sobre un punto existente (para arrastrar)
  const pointIndex = findNearestAuxPointIndex(canvasX, canvasY);

  if (pointIndex !== -1) {
    rdAuxDraggingIndex = pointIndex;
    rdAuxIsDragging = true;
    rdCanvas.style.cursor = 'grabbing';
    return;
  }

  // Añadir nuevo punto
  rdAuxPoints.push(imageCoords);
  updateAuxDrawingControls();
  redrawCanvas();

  const count = rdAuxPoints.length;
  if (rdAuxMode === 'grapas') {
    showRDToast(`Grapa ${count} colocada`, 'success');
  } else if (rdAuxMode === 'rapel') {
    showRDToast(`Punto de rápel ${count} colocado`, 'success');
  } else {
    showRDToast(`Punto ${count} añadido`, 'success');
  }
}

/**
 * Busca el punto auxiliar más cercano al clic
 */
function findNearestAuxPointIndex(canvasX, canvasY) {
  const hitRadius = RD_POINT_HIT_RADIUS;
  let nearestIndex = -1;
  let nearestDist = Infinity;

  const displayWidth = rdCanvas.displayWidth || rdCanvas.width;
  const displayHeight = rdCanvas.displayHeight || rdCanvas.height;
  const scaleX = displayWidth / rdImage.width;
  const scaleY = displayHeight / rdImage.height;

  rdAuxPoints.forEach((pt, i) => {
    const cx = pt.x * scaleX;
    const cy = pt.y * scaleY;
    const dx = cx - canvasX;
    const dy = cy - canvasY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < hitRadius && dist < nearestDist) {
      nearestDist = dist;
      nearestIndex = i;
    }
  });

  return nearestIndex;
}

/**
 * Actualiza controles de dibujo para modo auxiliar
 */
function updateAuxDrawingControls() {
  const controlsDiv = document.getElementById('rd-drawing-controls');
  if (!controlsDiv) return;

  if (rdAuxMode) {
    controlsDiv.style.display = 'flex';
    const undoBtn = document.getElementById('rd-btn-undo');
    const finishBtn = document.getElementById('rd-btn-finish');
    if (undoBtn) undoBtn.disabled = rdAuxPoints.length === 0;
    if (finishBtn) {
      if (rdAuxMode === 'grapas' || rdAuxMode === 'rapel') {
        finishBtn.disabled = rdAuxPoints.length < 1;
      } else {
        finishBtn.disabled = rdAuxPoints.length < 2;
      }
    }
  }
}

/**
 * Deshace el último punto auxiliar
 */
function rdAuxUndoLastPoint() {
  if (rdAuxPoints.length > 0) {
    rdAuxPoints.pop();
    updateAuxDrawingControls();

    if (rdAuxPoints.length === 0) {
      const modeNames = { descent_line: 'línea', grapas: 'grapas', cadena: 'cadena', rapel: 'rápel' };
      updateInstructions(`Todos los puntos eliminados. Toca para añadir el primer punto de ${modeNames[rdAuxMode]}.`);
    }
    redrawCanvas();
  }
}

/**
 * Termina y guarda el elemento auxiliar actual
 */
async function rdAuxFinishDrawing() {
  const minPoints = (rdAuxMode === 'grapas' || rdAuxMode === 'rapel') ? 1 : 2;
  if (rdAuxPoints.length < minPoints) {
    showRDToast(`Se requieren al menos ${minPoints} punto(s) para guardar`, 'warning');
    return;
  }

  // Crear elemento
  const element = {
    type: rdAuxMode,
    points: rdAuxPoints.map(p => ({ x: p.x, y: p.y })),
    id: Date.now(),
    ...(rdCurrentSector.imageId && { imageId: rdCurrentSector.imageId })
  };

  rdAuxElements.push(element);
  await saveAuxElements();

  const modeNames = { descent_line: 'Línea de descenso', grapas: 'Grapas', cadena: 'Cadena', rapel: 'Puntos de rápel' };
  showRDToast(`${modeNames[rdAuxMode]} guardado`, 'success');

  // Salir del modo auxiliar tras guardar
  rdAuxMode = null;
  rdAuxPoints = [];
  rdAuxDraggingIndex = -1;
  rdAuxIsDragging = false;
  rdCanvas.style.cursor = 'default';

  const controlsDiv = document.getElementById('rd-drawing-controls');
  if (controlsDiv) controlsDiv.style.display = 'none';

  updateInstructions('Elemento guardado. Toca en la imagen para añadir otro elemento.');
  redrawCanvas();
}

/**
 * Cancela el modo auxiliar actual
 */
function rdAuxCancelDrawing() {
  rdAuxMode = null;
  rdAuxPoints = [];
  rdAuxDraggingIndex = -1;
  rdAuxIsDragging = false;
  rdCanvas.style.cursor = 'default';

  const controlsDiv = document.getElementById('rd-drawing-controls');
  if (controlsDiv) controlsDiv.style.display = 'none';

  updateInstructions('Selecciona una vía de la lista para dibujar su línea en la imagen');
  redrawCanvas();
}

// ============================================
// ELEMENTOS AUXILIARES: RENDERIZADO
// ============================================

/**
 * Dibuja todos los elementos auxiliares guardados en el canvas
 */
function drawAuxElements() {
  if (rdAuxElements.length === 0) return;

  const displayWidth = rdCanvas.displayWidth || rdCanvas.width;
  const displayHeight = rdCanvas.displayHeight || rdCanvas.height;
  const scaleX = displayWidth / rdImage.width;
  const scaleY = displayHeight / rdImage.height;

  rdAuxElements.forEach((element, elIdx) => {
    const scaledPoints = element.points.map(p => ({
      x: p.x * scaleX,
      y: p.y * scaleY
    }));

    switch (element.type) {
      case 'descent_line':
        drawDescentLineElement(scaledPoints, RD_COLORS.descent_line);
        break;
      case 'grapas':
        drawGrapasElement(scaledPoints, RD_COLORS.grapas);
        break;
      case 'cadena':
        drawCadenaElement(scaledPoints, RD_COLORS.cadena);
        break;
      case 'rapel':
        drawRapelAuxElement(scaledPoints, RD_COLORS.rapel);
        break;
    }

    // En modo edición, dibujar puntos editables sobre los elementos guardados
    if (rdEditAuxMode) {
      const isEditingThis = rdEditAuxElementIndex === elIdx;
      scaledPoints.forEach((pt, pIdx) => {
        const isDragging = isEditingThis && rdEditAuxIsDragging && rdEditAuxPointIndex === pIdx;
        drawEditablePoint(pt.x, pt.y, pIdx, RD_COLORS[element.type] || '#ffffff', isDragging, isEditingThis && rdEditAuxPointIndex === pIdx);
      });
    }
  });
}

/**
 * Dibuja la línea temporal del elemento auxiliar en curso
 */
function drawAuxTemporary() {
  if (rdAuxPoints.length === 0) return;

  const displayWidth = rdCanvas.displayWidth || rdCanvas.width;
  const displayHeight = rdCanvas.displayHeight || rdCanvas.height;
  const scaleX = displayWidth / rdImage.width;
  const scaleY = displayHeight / rdImage.height;

  const scaledPoints = rdAuxPoints.map(p => ({
    x: p.x * scaleX,
    y: p.y * scaleY
  }));

  const color = RD_COLORS[rdAuxMode] || '#ffffff';

  switch (rdAuxMode) {
    case 'descent_line':
      drawDescentLineElement(scaledPoints, color);
      break;
    case 'grapas':
      drawGrapasElement(scaledPoints, color);
      break;
    case 'cadena':
      drawCadenaElement(scaledPoints, color);
      break;
    case 'rapel':
      drawRapelAuxElement(scaledPoints, color);
      break;
  }

  // Dibujar puntos editables encima
  scaledPoints.forEach((pt, i) => {
    const isDragging = rdAuxIsDragging && rdAuxDraggingIndex === i;
    drawEditablePoint(pt.x, pt.y, i, color, isDragging, false);
  });
}

/**
 * Dibuja una línea de descenso/ascenso (discontinua con flecha)
 */
function drawDescentLineElement(scaledPoints, color) {
  kxDrawDescentLine(rdCtx, scaledPoints, color);
}


/**
 * Dibuja grapas (U invertida) en cada punto
 */
function drawGrapasElement(scaledPoints, color) {
  scaledPoints.forEach(pt => {
    drawGrapaIcon(rdCtx, pt.x, pt.y, 12, color);
  });
}

/**
 * Dibuja un icono de grapa (U) - reutilizable por editor y visor
 */
function drawGrapaIcon(ctx, x, y, size, color) {
  kxDrawStaple(ctx, x, y, size, color);
}

/**
 * Dibuja una cadena (eslabones encadenados)
 */
function drawCadenaElement(scaledPoints, color) {
  kxDrawChain(rdCtx, scaledPoints, color);
}


/**
 * Dibuja puntos de rápel como elemento auxiliar
 */
function drawRapelAuxElement(scaledPoints, color) {
  if (scaledPoints.length === 0) return;
  const size = 14;
  scaledPoints.forEach(pt => {
    rdCtx.save();
    rdCtx.translate(pt.x, pt.y);
    drawRapelIcon(rdCtx, 0, 0, size, color);
    rdCtx.restore();
  });
}

// ============================================
// ELEMENTOS AUXILIARES: PERSISTENCIA
// ============================================

/**
 * Guarda los elementos auxiliares en Firestore
 */
async function saveAuxElements() {
  try {
    const docId = `${rdCurrentSector.schoolId}_${normalizeSectorName(rdCurrentSector.sectorName)}`;
    const docRef = db.collection('sector_route_drawings').doc(docId);

    const auxData = rdAuxElements.map(el => ({
      type: el.type,
      points: el.points,
      id: el.id,
      ...(rdCurrentSector.imageId && { imageId: rdCurrentSector.imageId })
    }));

    // Obtener documento existente para merge
    const doc = await docRef.get();
    let allAuxElements = [];

    if (doc.exists && doc.data().auxElements) {
      allAuxElements = doc.data().auxElements;
      // Filtrar los de esta imagen y reemplazar
      if (rdCurrentSector.imageId) {
        allAuxElements = allAuxElements.filter(el => el.imageId !== rdCurrentSector.imageId);
      } else {
        allAuxElements = allAuxElements.filter(el => el.imageId);
      }
    }
    allAuxElements = allAuxElements.concat(auxData);

    await kxBackupRouteDrawings(docRef, 'guardar-elementos', { snapshot: doc });
    await docRef.set({
      auxElements: allAuxElements,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedBy: auth.currentUser?.uid
    }, { merge: true });

  } catch (error) {
    console.error('[RouteDrawing] Error guardando elementos auxiliares:', error);
    showRDToast('Error al guardar: ' + error.message, 'error');
  }
}

/**
 * Carga los elementos auxiliares de Firestore
 */
async function loadAuxElements(schoolId, sectorName, imageId = null) {
  rdAuxElements = [];

  try {
    const docId = `${schoolId}_${normalizeSectorName(sectorName)}`;
    const doc = await db.collection('sector_route_drawings').doc(docId).get();

    if (doc.exists && doc.data().auxElements) {
      const allAuxElements = doc.data().auxElements;

      if (imageId) {
        rdAuxElements = allAuxElements.filter(el => {
          if (el.imageId) return el.imageId === imageId;
          return imageId === 'legacy_0';
        });
      } else {
        rdAuxElements = allAuxElements;
      }
    }
  } catch (error) {
    console.error('[RouteDrawing] Error cargando elementos auxiliares:', error);
  }
}

/**
 * Migra puntos de rápel del formato antiguo (rapelPoints) al nuevo (auxElements con type 'rapel')
 * Se ejecuta al cargar para compatibilidad con datos existentes
 */
async function migrateRapelPoints(schoolId, sectorName, imageId = null) {
  try {
    const docId = `${schoolId}_${normalizeSectorName(sectorName)}`;
    const doc = await db.collection('sector_route_drawings').doc(docId).get();

    if (!doc.exists || !doc.data().rapelPoints || doc.data().rapelPoints.length === 0) return;

    const allRapelPoints = doc.data().rapelPoints;
    let pointsToMigrate;

    if (imageId) {
      pointsToMigrate = allRapelPoints.filter(p => {
        if (p.imageId) return p.imageId === imageId;
        return imageId === 'legacy_0';
      });
    } else {
      pointsToMigrate = allRapelPoints;
    }

    if (pointsToMigrate.length === 0) return;

    // Convertir a elemento auxiliar de tipo rapel
    const rapelElement = {
      type: 'rapel',
      points: pointsToMigrate.map(p => ({ x: p.x, y: p.y })),
      id: Date.now(),
      ...(imageId && { imageId: imageId })
    };

    rdAuxElements.push(rapelElement);

    // Eliminar los rapelPoints migrados del documento
    let remainingRapelPoints = allRapelPoints;
    if (imageId) {
      remainingRapelPoints = allRapelPoints.filter(p => {
        if (p.imageId) return p.imageId !== imageId;
        return imageId !== 'legacy_0';
      });
    } else {
      remainingRapelPoints = [];
    }

    // Guardar la migración
    await saveAuxElements();
    const docRef = db.collection('sector_route_drawings').doc(docId);
    await docRef.set({ rapelPoints: remainingRapelPoints }, { merge: true });

    console.log(`[RouteDrawing] Migrados ${pointsToMigrate.length} puntos de rápel a auxElements`);
  } catch (error) {
    console.error('[RouteDrawing] Error migrando puntos de rápel:', error);
  }
}

// ============================================
// FUNCIONES DE UI
// ============================================

/**
 * Cierra el editor
 */
function closeRouteDrawingEditor() {
  const editor = document.getElementById('rd-editor');
  if (editor) {
    editor.remove();
  }

  // Limpiar estado
  rdCanvas = null;
  rdCtx = null;
  rdImage = null;
  rdCurrentSector = null;
  rdDrawingMode = false;
  rdCurrentRoute = null;
  rdRouteDrawings = [];
  rdDrawingPoints = [];
  rdRoutesList = [];
  rdPendingRouteInfo = null;
  rdMandatoryDrawingMode = false;
  rdEditMode = false;
  rdOriginalDrawing = null;
  rdDraggingPointIndex = -1;
  rdIsDragging = false;
  rdSelectedPointIndex = -1;
  rdSectorImages = [];
  rdCurrentImageIndex = 0;
  rdAutoSelectRouteId = null;

  // Limpiar estado de borrador
  rdEraserMode = false;

  // Limpiar estado de bifurcación
  rdBifurcationMode = false;
  rdCurrentBranchId = -1;
  rdBranchesData = [];
  rdActiveForkPoint = null;
  rdActiveForkSegmentIndex = -1;
  rdBifurcatingDrawing = null;

  // Limpiar estado de edición de auxiliares
  rdEditAuxMode = false;
  rdEditAuxElementIndex = -1;
  rdEditAuxPointIndex = -1;
  rdEditAuxIsDragging = false;

  // Limpiar estado de elementos auxiliares
  rdAuxMode = null;
  rdAuxPoints = [];
  rdAuxElements = [];
  rdAuxDraggingIndex = -1;
  rdAuxIsDragging = false;
  rdTouchStartPos = null;
  rdTouchStartTime = 0;
  rdWasDragging = false;
}

/**
 * Toggle del panel de vías
 */
function rdToggleRouteList() {
  const panel = document.getElementById('rd-routes-panel');
  if (!panel) return;
  const collapsed = panel.classList.toggle('rd-panel-collapsed');
  if (!collapsed) {
    // Al abrir, lista completa y sin filtro anterior
    const search = document.getElementById('rd-route-search');
    if (search && search.value) { search.value = ''; rdFilterRoutes(); }
  }
}

/**
 * Filtra las vías por búsqueda
 */
function rdFilterRoutes() {
  const searchTerm = document.getElementById('rd-route-search').value.toLowerCase();
  const items = document.querySelectorAll('.rd-route-item');

  items.forEach(item => {
    const routeName = item.querySelector('.rd-route-name').textContent.toLowerCase();
    item.style.display = routeName.includes(searchTerm) ? '' : 'none';
  });
}

/**
 * Ajusta la foto a la pantalla: quita el zoom y el desplazamiento. No toca los trazados.
 */
function rdResetView() {
  rdResetZoom();
  initializeCanvas();
  redrawCanvas();
}

/**
 * Confirmación con el modal del editor
 * @returns {Promise<boolean>} true si se confirma
 */
function rdConfirm(title, message, confirmText) {
  return new Promise(resolve => {
    showRdConfirmModal(title, message, confirmText, 'Cancelar', () => resolve(true), () => resolve(false));
  });
}

// ============================================
// REUNIONES COMPARTIDAS: UNIR FINALES CERCANOS
// ============================================

// Fracción del ancho de la foto bajo la que dos finales se consideran «junto a»
const RD_NEAR_ANCHOR_FRACTION = 0.05;

/**
 * Nombre legible de un trazado (con la variante si la tiene)
 */
function rdDrawingLabel(drawing) {
  const dvi = drawing.variantIndex || 0;
  const route = rdRoutesList.find(r =>
    (drawing.routeId !== undefined && r.routeId === drawing.routeId && (r.variantIndex || 0) === dvi) ||
    (drawing.routeId === undefined && r.nombre === drawing.routeName)
  );
  const name = (route && route.nombre) || drawing.routeName || 'Sin nombre';
  return dvi > 0 ? `${name} (variante ${dvi})` : name;
}

/**
 * Final con reunión de otra vía que queda junto al final que se acaba de dibujar
 * @returns {Object|null} {drawing, point, anchorType} del final más cercano
 */
function rdFindNearbyAnchor() {
  if (!rdCurrentRoute || rdDrawingPoints.length < 2 || !rdImage) return null;
  const last = rdDrawingPoints[rdDrawingPoints.length - 1];
  const limit = rdImage.width * RD_NEAR_ANCHOR_FRACTION;
  const ownKey = kxDrawingKey({ routeId: rdCurrentRoute.routeId, variantIndex: rdCurrentRoute.variantIndex, routeName: rdCurrentRoute.nombre });
  let best = null;
  kxPathEnds(rdRouteDrawings).forEach(end => {
    if (kxDrawingKey(end.drawing) === ownKey || end.anchorType === 'sin_terminar') return;
    const dist = Math.hypot(end.point.x - last.x, end.point.y - last.y);
    if (dist <= limit && (!best || dist < best.dist)) best = { dist, drawing: end.drawing, point: end.point, anchorType: end.anchorType };
  });
  return best;
}

/**
 * Grupos de finales de vías distintas que quedan cerca pero aún no comparten reunión
 * @returns {Array} grupos de finales (kxPathEnds)
 */
function rdNearbyAnchorGroups() {
  if (!rdImage) return [];
  const limit = rdImage.width * RD_NEAR_ANCHOR_FRACTION;
  const ends = kxPathEnds(rdRouteDrawings).filter(e => e.anchorType !== 'sin_terminar');
  const groups = [];
  ends.forEach(end => {
    const hits = groups.filter(g => g.some(m => Math.hypot(m.point.x - end.point.x, m.point.y - end.point.y) <= limit));
    if (hits.length === 0) { groups.push([end]); return; }
    // Une los grupos que este final enlaza
    const merged = [end].concat(...hits);
    hits.forEach(h => groups.splice(groups.indexOf(h), 1));
    groups.push(merged);
  });
  const sameSpot = g => g.every(m => Math.hypot(m.point.x - g[0].point.x, m.point.y - g[0].point.y) <= KX_SHARED_ANCHOR_TOL);
  return groups
    .filter(g => new Set(g.map(m => kxDrawingKey(m.drawing))).size > 1 && !sameSpot(g))
    .map(g => g.sort((a, b) => (rdTopoNumbers.get(kxDrawingKey(a.drawing)) || 0) - (rdTopoNumbers.get(kxDrawingKey(b.drawing)) || 0)));
}

/**
 * Lista las reuniones cercanas y permite unirlas
 */
function showSharedAnchorsModal() {
  closeSharedAnchorsModal();
  if (!rdCurrentSector) return;

  rdTopoNumbers = rdComputeTopoNumbers();
  const groups = rdNearbyAnchorGroups();
  rdSharedAnchorGroups = groups;

  const rows = groups.map((g, gi) => {
    const types = [...new Set(g.map(m => m.anchorType))];
    const members = g.map(m => {
      const color = getRouteDrawingData(m.drawing, false).color;
      const n = rdTopoNumbers.get(kxDrawingKey(m.drawing));
      const branch = m.branchId > 0 ? ` · ramal ${m.branchId}` : '';
      return `<span class="rd-share-member"><span class="rd-share-num" style="border-color: ${color}">${n}</span>${kxEsc(rdDrawingLabel(m.drawing))}${branch}</span>`;
    }).join('');
    const buttons = types.map(t => `
      <button class="rd-share-join" onclick="joinSharedAnchors(${gi}, '${t}')">
        ${types.length > 1 ? `Unir como ${kxEsc(RD_ANCHOR_TYPES[t]?.name || t)}` : 'Unir'}
      </button>`).join('');
    return `
      <div class="rd-share-row">
        <div class="rd-share-members">${members}</div>
        <div class="rd-share-actions">${buttons}</div>
      </div>`;
  }).join('');

  const modal = document.createElement('div');
  modal.id = 'rd-shared-modal';
  modal.className = 'rd-modal-overlay';
  modal.innerHTML = `
    <div class="rd-modal-container rd-share-container">
      <div class="rd-modal-header">
        <h3>Unir reuniones</h3>
      </div>
      <div class="rd-modal-body">
        <p>${groups.length
          ? 'Estas vías terminan una junto a otra. Al unirlas comparten la misma reunión y sus líneas se juntan.'
          : 'No hay vías que terminen una junto a otra sin compartir reunión.'}</p>
        ${groups.length ? `<div class="rd-share-list">${rows}</div>` : ''}
      </div>
      <div class="rd-modal-footer">
        <button class="rd-modal-btn rd-modal-btn-cancel" onclick="closeSharedAnchorsModal()">Cerrar</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeSharedAnchorsModal();
  });
}

function closeSharedAnchorsModal() {
  const modal = document.getElementById('rd-shared-modal');
  if (modal) modal.remove();
}

let rdSharedAnchorGroups = [];

/**
 * Junta los finales de un grupo en un punto y les da el mismo tipo de reunión
 */
async function joinSharedAnchors(groupIndex, anchorType) {
  const group = rdSharedAnchorGroups[groupIndex];
  if (!group) return;
  if (rdDrawingsLoadFailed) {
    showRDToast('No se puede guardar: los dibujos no se cargaron. Vuelve a abrir el editor.', 'error');
    return;
  }

  const target = {
    x: Math.round(group.reduce((sum, m) => sum + m.point.x, 0) / group.length),
    y: Math.round(group.reduce((sum, m) => sum + m.point.y, 0) / group.length)
  };

  // Cambios sobre una copia: si falla el guardado, la foto queda como estaba
  const changed = new Map();
  group.forEach(m => {
    const dk = kxDrawingKey(m.drawing);
    const copy = changed.get(dk) || JSON.parse(JSON.stringify(m.drawing));
    if (m.branchId > 0) {
      const branch = (copy.branches || []).find(b => b.branchId === m.branchId);
      if (!branch) return;
      branch.points[branch.points.length - 1] = { ...target };
      branch.anchorType = anchorType;
    } else {
      copy.points[copy.points.length - 1] = { ...target };
      copy.anchorType = anchorType;
    }
    copy.updatedAt = new Date().toISOString();
    copy.updatedBy = auth.currentUser?.uid;
    changed.set(dk, copy);
  });

  try {
    const docRef = rdDrawingsDocRef();
    const doc = await docRef.get();
    const imageId = rdCurrentSector.imageId;
    const allDrawings = (doc.exists ? doc.data().drawings || [] : []).map(d => {
      if (imageId && (d.imageId || 'legacy_0') !== imageId) return d;
      return changed.get(kxDrawingKey(d)) || d;
    });

    await kxBackupRouteDrawings(docRef, 'unir-reuniones', { snapshot: doc, required: true });
    await docRef.set({
      schoolId: rdCurrentSector.schoolId,
      sectorName: rdCurrentSector.sectorName,
      drawings: allDrawings,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedBy: auth.currentUser?.uid
    }, { merge: true });

    rdRouteDrawings = rdRouteDrawings.map(d => changed.get(kxDrawingKey(d)) || d);
    redrawCanvas();
    showSharedAnchorsModal();
    updateInstructions('Reuniones unidas.');
  } catch (error) {
    console.error('[RouteDrawing] Error uniendo reuniones:', error);
    showRDToast('No se pudieron unir las reuniones: ' + error.message, 'error');
  }
}

// ============================================
// COPIAS DE SEGURIDAD: HISTORIAL Y RESTAURACIÓN
// ============================================

const RD_BACKUP_REASONS = {
  'guardar-trazado': 'Antes de guardar un trazado',
  'borrar-trazado': 'Antes de borrar un trazado',
  'guardar-ramal': 'Antes de guardar un ramal',
  'borrar-ramal': 'Antes de borrar un ramal',
  'guardar-elementos': 'Antes de guardar elementos',
  'borrador': 'Antes de usar el borrador',
  'unir-reuniones': 'Antes de unir reuniones',
  'borrar-imagen': 'Antes de borrar una foto',
  'admin-borrar-via': 'Antes de borrar una vía (admin)',
  'admin-limpiar-huerfanos': 'Antes de limpiar huérfanos (admin)',
  'antes-de-restaurar': 'Antes de restaurar otra copia'
};

function rdDrawingsDocRef() {
  const docId = `${rdCurrentSector.schoolId}_${normalizeSectorName(rdCurrentSector.sectorName)}`;
  return db.collection('sector_route_drawings').doc(docId);
}

/**
 * Muestra las últimas copias de seguridad de los trazados del sector
 */
async function showDrawingBackupsModal() {
  closeDrawingBackupsModal();
  if (!rdCurrentSector) return;

  const modal = document.createElement('div');
  modal.id = 'rd-backups-modal';
  modal.className = 'rd-modal-overlay';
  modal.innerHTML = `
    <div class="rd-modal-container rd-backups-container">
      <div class="rd-modal-header">
        <h3>Copias de seguridad</h3>
      </div>
      <div class="rd-modal-body">
        <p>Antes de cada cambio se guarda una copia de los trazados del sector. Las copias no se pueden borrar.</p>
        <div class="rd-backups-list" id="rd-backups-list">
          <div class="rd-backups-empty">Cargando copias…</div>
        </div>
      </div>
      <div class="rd-modal-footer">
        <button class="rd-modal-btn rd-modal-btn-cancel" onclick="closeDrawingBackupsModal()">Cerrar</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeDrawingBackupsModal();
  });

  const list = document.getElementById('rd-backups-list');
  try {
    const snap = await rdDrawingsDocRef().collection('backups').orderBy('createdAt', 'desc').limit(30).get();
    if (!document.getElementById('rd-backups-modal')) return;

    if (snap.empty) {
      list.innerHTML = '<div class="rd-backups-empty">Todavía no hay copias de este sector. Se crean solas al guardar o borrar.</div>';
      return;
    }

    list.innerHTML = snap.docs.map(doc => {
      const b = doc.data();
      const date = b.createdAt && b.createdAt.toDate ? b.createdAt.toDate() : null;
      const when = date
        ? date.toLocaleString('es-ES', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
        : 'Ahora mismo';
      const vias = `${b.drawingsCount || 0} ${b.drawingsCount === 1 ? 'vía' : 'vías'}`;
      const aux = b.auxCount ? ` · ${b.auxCount} ${b.auxCount === 1 ? 'elemento' : 'elementos'}` : '';
      return `
        <div class="rd-backup-row">
          <div class="rd-backup-info">
            <span class="rd-backup-when">${when}</span>
            <span class="rd-backup-meta">${vias}${aux} · ${RD_BACKUP_REASONS[b.reason] || 'Copia automática'}</span>
          </div>
          <button class="rd-backup-restore" onclick="restoreDrawingBackup('${doc.id}')">Restaurar</button>
        </div>
      `;
    }).join('');
  } catch (error) {
    console.error('[RouteDrawing] Error cargando copias de seguridad:', error);
    if (list) list.innerHTML = '<div class="rd-backups-empty">No se pudieron cargar las copias. Revisa la conexión y vuelve a intentarlo.</div>';
  }
}

function closeDrawingBackupsModal() {
  const modal = document.getElementById('rd-backups-modal');
  if (modal) modal.remove();
}

/**
 * Restaura una copia de seguridad (guardando antes el estado actual)
 */
async function restoreDrawingBackup(backupId) {
  const ok = await rdConfirm(
    'Restaurar copia',
    'Los trazados del sector volverán a como estaban en esa copia. El estado actual se guarda antes como otra copia, así que podrás deshacerlo.',
    'Restaurar'
  );
  if (!ok) return;

  try {
    await kxRestoreRouteDrawings(rdDrawingsDocRef(), backupId);
    closeDrawingBackupsModal();

    await loadRouteDrawings(rdCurrentSector.schoolId, rdCurrentSector.sectorName, rdCurrentSector.imageId);
    await loadAuxElements(rdCurrentSector.schoolId, rdCurrentSector.sectorName, rdCurrentSector.imageId);
    const routeList = document.getElementById('rd-route-list');
    if (routeList) routeList.innerHTML = renderRoutesList();
    redrawCanvas();
    showRDToast('Copia restaurada', 'success');
  } catch (error) {
    console.error('[RouteDrawing] Error restaurando copia:', error);
    showRDToast('No se pudo restaurar: ' + error.message, 'error');
  }
}

/**
 * Muestra un modal de confirmación personalizado
 */
function showRdConfirmModal(title, message, confirmText, cancelText, onConfirm, onCancel) {
  // Eliminar modal existente si hay uno
  const existing = document.getElementById('rd-confirm-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'rd-confirm-modal';
  modal.className = 'rd-modal-overlay';
  modal.innerHTML = `
    <div class="rd-modal-container">
      <div class="rd-modal-header">
        <h3>${title}</h3>
      </div>
      <div class="rd-modal-body">
        <p>${message}</p>
      </div>
      <div class="rd-modal-footer">
        <button class="rd-modal-btn rd-modal-btn-cancel" id="rd-modal-cancel">${cancelText}</button>
        <button class="rd-modal-btn rd-modal-btn-confirm" id="rd-modal-confirm">${confirmText}</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Event listeners
  document.getElementById('rd-modal-cancel').addEventListener('click', () => {
    modal.remove();
    if (onCancel) onCancel();
  });

  document.getElementById('rd-modal-confirm').addEventListener('click', () => {
    modal.remove();
    if (onConfirm) onConfirm();
  });

  // Cerrar con click fuera del modal
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.remove();
      if (onCancel) onCancel();
    }
  });
}

/**
 * Actualiza las instrucciones
 */
function updateInstructions(text) {
  const instructions = document.getElementById('rd-instructions');
  if (instructions) {
    instructions.innerHTML = `<p>${text}</p>`;
  }
}

/**
 * Muestra toast de notificación
 */
function showRDToast(message, type = 'info') {
  // Con el editor abierto, la foto se ve despejada: los avisos de éxito o de
  // información no se pintan (el resultado ya se ve en el dibujo y se anuncia
  // en rd-instructions). Los errores y avisos sí, porque piden una reacción.
  if (document.getElementById('rd-editor') && (type === 'success' || type === 'info')) {
    updateInstructions(kxEsc(message));
    return;
  }
  // Un único sistema de avisos para toda la app (showToast, en user-features.js)
  showToast(message, type);
}

// ============================================
// INTEGRACIÓN CON VISOR DE SECTOR
// ============================================

/**
 * Agrega botón "Dibujar Vías" al visor de imagen de sector
 * Esta función debe ser llamada desde sector-images.js
 */
function addDrawingButtonToSectorViewer(schoolId, sectorName, isAdmin) {
  if (!isAdmin) return '';

  return `
    <button class="sector-viewer-draw-btn" onclick="openRouteDrawingEditor('${schoolId}', '${encodeURIComponent(sectorName)}')">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 20h9"/>
        <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
      </svg>
      Dibujar Vías
    </button>
  `;
}

/**
 * Agrega botón "Vincular con Imagen" al popup de vía
 * Esta función debe ser llamada desde maplibre-map.js
 */
function addLinkDrawingButtonToRoutePopup(routeId, isAdmin) {
  if (!isAdmin) return '';

  return `
    <button class="ml-route-dev-btn" onclick="openDrawingEditorForRoute(${routeId})">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
      </svg>
      Vincular con imagen
    </button>
  `;
}

// ============================================
// BOTÓN "+" - MENÚ DESPLEGABLE
// ============================================

/**
 * Abre el menú contextual desde el botón "+"
 */
function rdToggleAddMenu() {
  const btn = document.getElementById('rd-btn-add');
  if (!btn) return;
  const rect = btn.getBoundingClientRect();
  showAuxContextMenu(rect.left + rect.width / 2, rect.bottom + 4);
}

// ============================================
// MODO EDICIÓN DE ELEMENTOS AUXILIARES
// ============================================

/**
 * Activa/desactiva el modo edición de elementos auxiliares guardados
 */
function toggleEditAuxMode() {
  closeAuxContextMenu();

  if (rdDrawingMode || rdAuxMode || rdBifurcationMode) {
    showRDToast('Termina el modo actual antes de editar', 'warning');
    return;
  }

  // Desactivar borrador si está activo
  if (rdEraserMode) {
    rdEraserMode = false;
    rdCanvas.style.cursor = 'default';
  }

  rdEditAuxMode = !rdEditAuxMode;
  rdEditAuxElementIndex = -1;
  rdEditAuxPointIndex = -1;
  rdEditAuxIsDragging = false;

  if (rdEditAuxMode) {
    rdCanvas.style.cursor = 'crosshair';
    updateInstructions('Modo edición: arrastra puntos para mover elementos. Clic en zona vacía para salir.');
  } else {
    exitEditAuxMode();
  }
  redrawCanvas();
}

/**
 * Sale del modo edición
 */
function exitEditAuxMode() {
  rdEditAuxMode = false;
  rdEditAuxElementIndex = -1;
  rdEditAuxPointIndex = -1;
  rdEditAuxIsDragging = false;
  rdCanvas.style.cursor = 'default';
  updateInstructions('Selecciona una vía de la lista para dibujar su línea en la imagen');
  redrawCanvas();
}

/**
 * Maneja mousedown en modo edición: busca el punto más cercano de un elemento guardado
 */
function handleEditAuxMouseDown(canvasX, canvasY) {
  const hit = findNearestAuxElementPoint(canvasX, canvasY);

  if (hit && hit.pointIndex !== -1) {
    rdEditAuxElementIndex = hit.elementIndex;
    rdEditAuxPointIndex = hit.pointIndex;
    rdEditAuxIsDragging = true;
    rdCanvas.style.cursor = 'grabbing';
    updateInstructions('Arrastrando punto. Suelta para posicionar.');
  } else if (!hit) {
    // Clic en zona vacía: salir del modo edición
    exitEditAuxMode();
  }
}

// ============================================
// MODO BORRADOR
// ============================================

/**
 * Activa/desactiva el modo borrador
 */
function toggleEraserMode() {
  closeAuxContextMenu();

  // No permitir si hay un modo de dibujo activo
  if (rdDrawingMode || rdAuxMode || rdBifurcationMode) {
    showRDToast('Termina el modo actual antes de usar el borrador', 'warning');
    return;
  }

  // Desactivar modo edición si está activo
  if (rdEditAuxMode) {
    exitEditAuxMode();
  }

  rdEraserMode = !rdEraserMode;

  if (rdEraserMode) {
    rdCanvas.style.cursor = 'crosshair';
    updateInstructions('Modo borrador: haz clic en cualquier elemento para eliminarlo. Clic en zona vacía para salir.');
  } else {
    rdCanvas.style.cursor = 'default';
    updateInstructions('Selecciona una vía de la lista para dibujar su línea en la imagen');
  }
  redrawCanvas();
}

/**
 * Desactiva el modo borrador
 */
function exitEraserMode() {
  rdEraserMode = false;
  rdCanvas.style.cursor = 'default';
  updateInstructions('Selecciona una vía de la lista para dibujar su línea en la imagen');
  redrawCanvas();
}

/**
 * Intenta borrar un elemento en las coordenadas dadas (canvas coords)
 * Devuelve true si se borró algo
 */
async function eraserHitTest(canvasX, canvasY) {
  const imgCoords = canvasToImageCoords(canvasX, canvasY);

  // 1. Comprobar elementos auxiliares (descent_line, grapas, cadena, rapel)
  const auxHit = findNearestAuxElementPoint(canvasX, canvasY);
  if (auxHit) {
    const element = rdAuxElements[auxHit.elementIndex];
    const typeName = { descent_line: 'Línea de descenso', grapas: 'Grapa', cadena: 'Cadena', rapel: 'Punto de rápel' };

    // Para elementos de punto individual (grapas, rapel): borrar solo ese punto
    if ((element.type === 'grapas' || element.type === 'rapel') && auxHit.pointIndex !== -1) {
      element.points.splice(auxHit.pointIndex, 1);
      if (element.points.length === 0) {
        rdAuxElements.splice(auxHit.elementIndex, 1);
      }
      await saveAuxElements();
      showRDToast(`${typeName[element.type]} eliminado`, 'info');
      redrawCanvas();
      return true;
    }

    // Para elementos de línea (descent_line, cadena): borrar el elemento completo
    rdAuxElements.splice(auxHit.elementIndex, 1);
    await saveAuxElements();
    showRDToast(`${typeName[element.type] || 'Elemento'} eliminado`, 'info');
    redrawCanvas();
    return true;
  }

  // 3. Comprobar dibujos de vías
  const drawingHit = findNearestRouteDrawing(canvasX, canvasY);
  if (drawingHit !== -1) {
    const drawing = rdRouteDrawings[drawingHit];
    const routeName = drawing.routeName || 'Vía';
    rdRouteDrawings.splice(drawingHit, 1);
    await saveAllRouteDrawings();
    showRDToast(`Dibujo de "${routeName}" eliminado`, 'info');
    redrawCanvas();
    // Actualizar lista de vías
    const listContainer = document.getElementById('rd-route-list');
    if (listContainer) {
      listContainer.innerHTML = typeof renderRoutesListMandatory === 'function' && rdMandatoryDrawingMode
        ? renderRoutesListMandatory(rdPendingRouteInfo?.docId)
        : renderRoutesList();
    }
    return true;
  }

  return false;
}

/**
 * Busca el punto más cercano de un elemento auxiliar guardado (canvas coords)
 * Devuelve {elementIndex, pointIndex} o null si no hay hit
 */
function findNearestAuxElementPoint(canvasX, canvasY) {
  if (rdAuxElements.length === 0) return null;

  const displayWidth = rdCanvas.displayWidth || rdCanvas.width;
  const displayHeight = rdCanvas.displayHeight || rdCanvas.height;
  const scaleX = displayWidth / rdImage.width;
  const scaleY = displayHeight / rdImage.height;
  const hitRadius = RD_SEGMENT_HIT_RADIUS;

  let nearestElementIndex = -1;
  let nearestPointIndex = -1;
  let nearestDist = Infinity;

  rdAuxElements.forEach((element, elIdx) => {
    const scaledPoints = element.points.map(p => ({ x: p.x * scaleX, y: p.y * scaleY }));

    // Para grapas y rapel: comprobar proximidad a cada punto individual
    if (element.type === 'grapas' || element.type === 'rapel') {
      scaledPoints.forEach((pt, pIdx) => {
        const dist = Math.sqrt((pt.x - canvasX) ** 2 + (pt.y - canvasY) ** 2);
        if (dist < hitRadius && dist < nearestDist) {
          nearestDist = dist;
          nearestElementIndex = elIdx;
          nearestPointIndex = pIdx;
        }
      });
    } else {
      // Para líneas (cadena, descent_line): comprobar proximidad a cada segmento
      for (let i = 0; i < scaledPoints.length - 1; i++) {
        const dist = pointToSegmentDist(canvasX, canvasY, scaledPoints[i], scaledPoints[i + 1]);
        if (dist < hitRadius && dist < nearestDist) {
          nearestDist = dist;
          nearestElementIndex = elIdx;
          nearestPointIndex = -1;
        }
      }
      // También detectar puntos individuales para edición
      scaledPoints.forEach((pt, pIdx) => {
        const dist = Math.sqrt((pt.x - canvasX) ** 2 + (pt.y - canvasY) ** 2);
        if (dist < hitRadius && dist < nearestDist) {
          nearestDist = dist;
          nearestElementIndex = elIdx;
          nearestPointIndex = pIdx;
        }
      });
    }
  });

  return nearestElementIndex !== -1 ? { elementIndex: nearestElementIndex, pointIndex: nearestPointIndex } : null;
}

/**
 * Busca el dibujo de vía más cercano al punto dado (canvas coords)
 */
function findNearestRouteDrawing(canvasX, canvasY) {
  if (rdRouteDrawings.length === 0) return -1;

  const displayWidth = rdCanvas.displayWidth || rdCanvas.width;
  const displayHeight = rdCanvas.displayHeight || rdCanvas.height;
  const scaleX = displayWidth / rdImage.width;
  const scaleY = displayHeight / rdImage.height;
  const hitRadius = RD_SEGMENT_HIT_RADIUS;

  let nearestIndex = -1;
  let nearestDist = Infinity;

  rdRouteDrawings.forEach((drawing, dIdx) => {
    const points = drawing.points || [];
    const scaledPoints = points.map(p => ({ x: p.x * scaleX, y: p.y * scaleY }));

    for (let i = 0; i < scaledPoints.length - 1; i++) {
      const dist = pointToSegmentDist(canvasX, canvasY, scaledPoints[i], scaledPoints[i + 1]);
      if (dist < hitRadius && dist < nearestDist) {
        nearestDist = dist;
        nearestIndex = dIdx;
      }
    }

    // También comprobar branches
    if (drawing.branches) {
      drawing.branches.forEach(branch => {
        const branchScaled = (branch.points || []).map(p => ({ x: p.x * scaleX, y: p.y * scaleY }));
        for (let i = 0; i < branchScaled.length - 1; i++) {
          const dist = pointToSegmentDist(canvasX, canvasY, branchScaled[i], branchScaled[i + 1]);
          if (dist < hitRadius && dist < nearestDist) {
            nearestDist = dist;
            nearestIndex = dIdx;
          }
        }
      });
    }
  });

  return nearestIndex;
}

/**
 * Distancia de un punto a un segmento de línea
 */
function pointToSegmentDist(px, py, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.sqrt((px - a.x) ** 2 + (py - a.y) ** 2);
  let t = ((px - a.x) * dx + (py - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const projX = a.x + t * dx;
  const projY = a.y + t * dy;
  return Math.sqrt((px - projX) ** 2 + (py - projY) ** 2);
}

/**
 * Guarda todos los route drawings en Firestore (usado por eraser)
 */
async function saveAllRouteDrawings() {
  if (rdDrawingsLoadFailed) {
    showRDToast('No se puede guardar: los dibujos no se cargaron. Vuelve a abrir el editor.', 'error');
    return;
  }
  try {
    const docId = `${rdCurrentSector.schoolId}_${normalizeSectorName(rdCurrentSector.sectorName)}`;
    const docRef = db.collection('sector_route_drawings').doc(docId);
    const doc = await docRef.get();

    let allDrawings = [];
    if (doc.exists) {
      allDrawings = doc.data().drawings || [];
    }

    // Filtrar dibujos de esta imagen y reemplazar con los actuales
    if (rdCurrentSector.imageId) {
      allDrawings = allDrawings.filter(d => !rdInImage(d, rdCurrentSector.imageId));
      const withImageId = rdRouteDrawings.map(d => ({ ...d, imageId: rdCurrentSector.imageId }));
      allDrawings = allDrawings.concat(withImageId);
    } else {
      allDrawings = [...rdRouteDrawings];
    }

    await kxBackupRouteDrawings(docRef, 'borrador', { snapshot: doc, required: true });
    await docRef.set({
      drawings: allDrawings,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedBy: auth.currentUser?.uid
    }, { merge: true });
  } catch (error) {
    console.error('[RouteDrawing] Error guardando drawings tras borrado:', error);
    showRDToast('Error al guardar: ' + error.message, 'error');
  }
}

// ============================================
// EXPORTAR FUNCIONES
// ============================================

window.openRouteDrawingEditor = openRouteDrawingEditor;
window.openDrawingEditorForRoute = openDrawingEditorForRoute;
window.openRouteDrawingEditorForPendingRoute = openRouteDrawingEditorForPendingRoute;
window.closeRouteDrawingEditor = closeRouteDrawingEditor;
window.selectImageForPendingRoute = selectImageForPendingRoute;
window.closeImageSelectorModal = closeImageSelectorModal;
window.selectRouteForDrawing = selectRouteForDrawing;
window.selectRouteForDrawingMandatory = selectRouteForDrawingMandatory;
window.deleteRouteDrawing = deleteRouteDrawing;
window.editRouteDrawing = editRouteDrawing;
window.rdCancelEdit = rdCancelEdit;
window.rdDeleteSpecificPoint = rdDeleteSpecificPoint;
window.rdToggleRouteList = rdToggleRouteList;
window.rdFilterRoutes = rdFilterRoutes;
window.rdResetView = rdResetView;
window.rdUndoLastPoint = rdUndoLastPoint;
window.rdFinishDrawing = rdFinishDrawing;
window.rdCancelDrawing = rdCancelDrawing;
window.rdCancelMandatoryDrawing = rdCancelMandatoryDrawing;
window.removePendingRouteFromMap = removePendingRouteFromMap;
window.addDrawingButtonToSectorViewer = addDrawingButtonToSectorViewer;
window.addLinkDrawingButtonToRoutePopup = addLinkDrawingButtonToRoutePopup;
// Funciones para navegación de imágenes
window.selectImageForRoute = selectImageForRoute;
window.rdPrevImage = rdPrevImage;
window.rdNextImage = rdNextImage;
// Funciones para selección de tipo de reunión
window.showAnchorTypeModal = showAnchorTypeModal;
window.showSharedAnchorsModal = showSharedAnchorsModal;
window.closeSharedAnchorsModal = closeSharedAnchorsModal;
window.joinSharedAnchors = joinSharedAnchors;
window.closeAnchorModal = closeAnchorModal;
window.selectAnchorType = selectAnchorType;
window.rdToggleAddMenu = rdToggleAddMenu;
window.toggleEditAuxMode = toggleEditAuxMode;
window.drawRapelIcon = drawRapelIcon;
// Funciones de elementos auxiliares
window.showAuxContextMenu = showAuxContextMenu;
window.closeAuxContextMenu = closeAuxContextMenu;
window.enterAuxMode = enterAuxMode;
window.drawGrapaIcon = drawGrapaIcon;
// Funciones de borrador
window.toggleEraserMode = toggleEraserMode;
window.exitEraserMode = exitEraserMode;

console.log('[RouteDrawing] Módulo cargado');

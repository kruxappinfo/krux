// Route Photo Management Module
// Handles uploading and retrieving photos for climbing routes
//
// FORMATO (reglas de la Fase 0c: storage.rules y firestore.rules.phase0c.proposal)
//   · Archivo:   route-photos/{schoolId}/{uid}/{id}.{jpg|png|webp}      · Documento: route-photos/{id}
//   · id = {schoolId}_{routeId}_{16 caracteres [a-z0-9]}; documento y archivo se identifican por ese id (relación 1:1).
//   · ORDEN: primero el documento (el servidor fija uploadedAt), después el archivo (Storage exige el documento y solo lo admite durante los 5 min siguientes).
//   · El autor dispone de COMO MÁXIMO 12 h para borrar, contadas por el SERVIDOR desde que acepta el documento (uploadedAt): el retraso hasta que llega el archivo se descuenta.
//     Este cliente no envía ni usa ningún instante para las reglas; solo mide tiempo transcurrido en local para decidir si merece la pena reintentar la subida.
//   · Borrar: primero el archivo, después el documento junto con su marca route-photo-tombstones/{id} (mismo lote). La marca impide recrear el id.
//   · Fotos antiguas (documento sin storagePath, archivo en route-photos/{schoolId}/{archivo}): se siguen leyendo; solo las borra un administrador.
//   · DIARIO DE SUBIDAS (capa 1 de los documentos huérfanos): antes de crear el documento se anota la subida en el almacenamiento local y se borra la anotación al terminar o al limpiar.
//     Si la app se cierra a mitad de una subida, la anotación queda; en el siguiente arranque SOLO SE COMPRUEBA (¿existe el archivo?) y se INFORMA (kxRpInterruptedUploads).
//     Nada se borra solo: descartar un documento de una subida interrumpida exige una llamada explícita (kxRpDiscardInterruptedUpload).

const KX_RP_SUPER_EMAIL = 'krux.app.info@gmail.com';
const KX_RP_BUCKET = 'climbmaps-80cae.firebasestorage.app';
const KX_RP_MAX_BYTES = 5 * 1024 * 1024;
const KX_RP_PENDING_KEY = 'kx-route-photos-pending-docs';
const KX_RP_PENDING_MAX_AGE_MS = 13 * 60 * 60 * 1000;   // pasadas 12 h el autor ya no puede borrar el documento: se abandona el reintento
// Ventana de las reglas de Storage entre aceptar el documento y recibir el archivo COMPLETO: 5 min (en el emulador las reglas se evalúan al finalizar la subida, así que cuenta
// también la transferencia). Un segundo intento empieza de cero, por eso solo se hace si el primero falló pronto (menos de 90 s desde la aceptación del documento, de modo que quedan
// más de 3 min para la nueva transferencia); si no, no cabría en la ventana: se limpia (documento + marca) y el usuario vuelve a intentarlo con un documento nuevo y una ventana nueva.
// La ventana no cambia el plazo de borrado del autor: sigue siendo de 12 h como máximo desde uploadedAt.
const KX_RP_RETRY_BEFORE_MS = 90 * 1000;
const kxRpInFlight = new Map();
let kxRpRetrying = false;
const KX_RP_JOURNAL_KEY = 'kx-route-photos-upload-journal';           // subidas en curso: [{id, uid, path, at}]
const KX_RP_INTERRUPTED_KEY = 'kx-route-photos-interrupted-uploads';   // subidas interrumpidas detectadas: [{id, uid, path, at, detectedAt}]
const KX_RP_JOURNAL_GRACE_MS = 6 * 60 * 1000;                          // la ventana de subida es de 5 min: pasados 6 min el archivo ya no puede llegar
const KX_RP_JOURNAL_MAX_AGE_MS = 24 * 60 * 60 * 1000;                  // el autor solo puede borrar 12 h; a las 24 h la anotación ya no sirve
const KX_RP_REVALIDATE_EVERY_MS = 10 * 60 * 1000;                      // una subida interrumpida ya detectada se vuelve a comprobar como mucho cada 10 min (evita lecturas repetidas)
const kxRpActiveUploads = new Set();                                   // ids de subidas en curso en ESTA pestaña (no se reconcilian)

/**
 * Check if current user has permission to upload photos
 * Política: cualquier usuario con sesión puede subir fotos de vía (las reglas lo aplican en el servidor).
 * @returns {Promise<boolean>}
 */
async function canUploadPhotos() {
    return !!currentUser;
}

/**
 * Check if current user is a photo admin (can delete any photo at any time)
 * El spotter no tiene privilegios especiales de borrado: solo admin y super-admin (las reglas lo aplican en el servidor).
 * @returns {Promise<boolean>}
 */
async function isPhotoAdmin() {
    if (!currentUser) return false;
    if (currentUser.email === KX_RP_SUPER_EMAIL) return true;

    try {
        const adminDoc = await db.collection('admins').doc(currentUser.uid).get();
        if (!adminDoc.exists) return false;

        return adminDoc.data().role === 'admin';
    } catch (error) {
        console.error('Error checking admin permissions:', error);
        return false;
    }
}

// ============================================
// UTILIDADES
// ============================================

function kxRpRandomId(length = 16) {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    const bytes = new Uint8Array(length);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(bytes);
    else for (let i = 0; i < length; i++) bytes[i] = Math.floor(Math.random() * 256);
    let out = '';
    for (let i = 0; i < length; i++) out += chars[bytes[i] % chars.length];
    return out;
}

// La extensión sale del tipo MIME (las reglas exigen que coincidan); un archivo «.jpeg» se guarda como «.jpg»
function kxRpExtensionFor(type) {
    if (/^image\/jpe?g$/i.test(type || '')) return 'jpg';
    if (/^image\/png$/i.test(type || '')) return 'png';
    if (/^image\/webp$/i.test(type || '')) return 'webp';
    return null;
}

// URL de descarga SIN token: el token no existe hasta que se sube el archivo y el documento no se puede actualizar después. Funciona porque la lectura es pública.
function kxRpDownloadUrl(storagePath) {
    let bucket = KX_RP_BUCKET;
    try { bucket = storage.app.options.storageBucket || bucket; } catch (_) { /* valor por defecto */ }
    return `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(storagePath)}?alt=media`;
}

function kxRpCode(error) {
    return (error && error.code) || '';
}

function kxRpIsPermissionError(error) {
    return /permission-denied|unauthorized|unauthenticated/.test(kxRpCode(error));
}

function kxRpIsNotFound(error) {
    return /object-not-found|not-found/.test(kxRpCode(error));
}

// Ruta del archivo de una foto: la guardada en el documento o, en las fotos antiguas, la de siempre
function kxRpStoragePathOf(data) {
    if (data.storagePath) return data.storagePath;
    if (data.filename && data.schoolId) return `route-photos/${data.schoolId}/${data.filename}`;
    return null;
}

// ============================================
// DOCUMENTOS PENDIENTES DE BORRAR (fallo de red tras borrar el archivo o tras una subida fallida)
// ============================================

function kxRpPendingLoad() {
    try {
        const list = JSON.parse(localStorage.getItem(KX_RP_PENDING_KEY) || '[]');
        return Array.isArray(list) ? list : [];
    } catch (_) { return []; }
}

function kxRpPendingSave(list) {
    try { localStorage.setItem(KX_RP_PENDING_KEY, JSON.stringify(list.slice(-50))); } catch (_) { /* sin almacenamiento: no se reintenta */ }
}

function kxRpPendingAdd(photoId) {
    if (!currentUser) return;
    const list = kxRpPendingLoad().filter(e => e.id !== photoId);
    list.push({ id: photoId, uid: currentUser.uid, at: Date.now() });
    kxRpPendingSave(list);
}

// Borra el documento y crea su marca permanente en el MISMO lote (las reglas de la Fase 0c exigen las dos cosas a la vez)
async function kxRpDeleteDocWithTombstone(photoId) {
    const batch = db.batch();
    batch.delete(db.collection('route-photos').doc(photoId));
    batch.set(db.collection('route-photo-tombstones').doc(photoId), {
        deletedBy: currentUser.uid,
        deletedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    try {
        await batch.commit();
    } catch (error) {
        if (!kxRpIsPermissionError(error)) throw error;
        // Transición: con las reglas anteriores a la Fase 0c no existe la colección de marcas y el lote se rechaza entero. El borrado simple
        // funciona con ellas; con las reglas nuevas se rechaza igual (sin marca no se puede borrar) y el error se propaga tal cual.
        await db.collection('route-photos').doc(photoId).delete();
    }
}

// Reintenta los borrados pendientes de este usuario. Nunca lanza.
async function kxRpRetryPending() {
    if (kxRpRetrying || !currentUser) return;
    kxRpRetrying = true;
    try { await kxRpReconcileJournal(); } catch (_) { /* el diario nunca bloquea nada */ }
    try {
        const list = kxRpPendingLoad();
        const keep = [];
        for (const entry of list) {
            if (entry.uid !== currentUser.uid) { keep.push(entry); continue; }
            try {
                const snap = await db.collection('route-photos').doc(entry.id).get();
                if (!snap.exists) continue;   // ya borrado
                await kxRpDeleteDocWithTombstone(entry.id);
            } catch (error) {
                // Pasado el plazo del autor solo un administrador puede limpiarlo: se deja de insistir
                if (Date.now() - entry.at < KX_RP_PENDING_MAX_AGE_MS) keep.push(entry);
            }
        }
        kxRpPendingSave(keep);
    } catch (_) { /* silencioso */ }
    kxRpRetrying = false;
}

// ============================================
// DIARIO DE SUBIDAS (solo anota y comprueba; no borra nada por sí mismo)
// ============================================

function kxRpListLoad(key) {
    try {
        const list = JSON.parse(localStorage.getItem(key) || '[]');
        return Array.isArray(list) ? list : [];
    } catch (_) { return []; }
}

function kxRpListSave(key, list) {
    try { localStorage.setItem(key, JSON.stringify(list.slice(-50))); } catch (_) { /* sin almacenamiento: no hay diario */ }
}

function kxRpJournalAdd(entry) {
    kxRpListSave(KX_RP_JOURNAL_KEY, kxRpListLoad(KX_RP_JOURNAL_KEY).filter(e => e.id !== entry.id).concat([entry]));
}

function kxRpJournalRemove(photoId) {
    kxRpListSave(KX_RP_JOURNAL_KEY, kxRpListLoad(KX_RP_JOURNAL_KEY).filter(e => e.id !== photoId));
}

/**
 * Subidas interrumpidas detectadas en esta cuenta (documento creado, archivo ausente, ventana de subida cerrada).
 * Solo informa: no borra nada. @returns {Array<{id, path, at, detectedAt}>}
 */
function kxRpInterruptedUploads() {
    if (!currentUser) return [];
    return kxRpListLoad(KX_RP_INTERRUPTED_KEY).filter(e => e.uid === currentUser.uid);
}

// Revisa las anotaciones del diario de ESTA cuenta cuando ya no pueden estar en curso. Solo lecturas (documento y metadatos del archivo): nunca borra ni escribe en Firestore o Storage.
//   · documento ya no existe → se descarta la anotación;  · el archivo existe → la subida terminó: se descarta;
//   · el archivo no existe (object-not-found) → subida interrumpida: pasa a la lista de interrumpidas, que solo se informa;
//   · cualquier otro resultado (red, permisos, errores) → indeterminado: la anotación se conserva para otro intento.
async function kxRpReconcileJournal() {
    if (!currentUser) return;
    const now = Date.now();
    const keep = [], found = [];
    // Las ya detectadas se revalidan (solo lecturas): si el documento o el archivo cambiaron, dejan de ser «interrumpidas»
    for (const entry of kxRpListLoad(KX_RP_INTERRUPTED_KEY)) {
        if (entry.uid !== currentUser.uid) { found.push(entry); continue; }
        if (now - entry.at >= KX_RP_JOURNAL_MAX_AGE_MS) continue;
        if (entry.checkedAt && now - entry.checkedAt < KX_RP_REVALIDATE_EVERY_MS) { found.push(entry); continue; }   // comprobada hace poco
        try {
            const snap = await db.collection('route-photos').doc(entry.id).get();
            if (!snap.exists) continue;
            try { await storage.ref().child(entry.path).getMetadata(); } catch (_) { found.push({ ...entry, checkedAt: now }); }   // sigue sin archivo (o no se pudo comprobar): se conserva; si el archivo existe, se descarta
        } catch (_) { found.push(entry); }
    }
    for (const entry of kxRpListLoad(KX_RP_JOURNAL_KEY)) {
        if (entry.uid !== currentUser.uid) { keep.push(entry); continue; }
        if (kxRpActiveUploads.has(entry.id) || now - entry.at < KX_RP_JOURNAL_GRACE_MS) { keep.push(entry); continue; }   // puede estar en curso
        if (now - entry.at >= KX_RP_JOURNAL_MAX_AGE_MS) continue;                                                           // demasiado antigua
        try {
            const snap = await db.collection('route-photos').doc(entry.id).get();
            if (!snap.exists) continue;                                                                                     // el documento ya no existe
            try {
                await storage.ref().child(entry.path).getMetadata();                                                        // el archivo existe: subida terminada
            } catch (error) {
                if (kxRpIsNotFound(error)) { if (!found.some(e => e.id === entry.id)) found.push({ ...entry, detectedAt: now, checkedAt: now }); }
                else keep.push(entry);                                                                                      // indeterminado
            }
        } catch (_) { keep.push(entry); }
    }
    kxRpListSave(KX_RP_JOURNAL_KEY, keep);
    kxRpListSave(KX_RP_INTERRUPTED_KEY, found);
}

/**
 * ACCIÓN EXPLÍCITA (nunca se llama sola): descarta el documento de una subida interrumpida de esta cuenta, con su marca, dentro del plazo del autor.
 * Vuelve a comprobar que el documento es suyo y que el archivo sigue sin existir; si el archivo existe o hay cualquier duda, no hace nada.
 * @returns {Promise<boolean>} true si se descartó
 */
async function kxRpDiscardInterruptedUpload(photoId) {
    if (!currentUser) throw new Error('User must be logged in');
    const entry = kxRpInterruptedUploads().find(e => e.id === photoId);
    if (!entry) return false;                                                    // solo subidas detectadas como interrumpidas
    const snap = await db.collection('route-photos').doc(photoId).get();
    if (!snap.exists || snap.data().uploadedBy !== currentUser.uid) return false;
    try {
        await storage.ref().child(entry.path).getMetadata();
        return false;                                                            // el archivo existe: no es una subida interrumpida
    } catch (error) {
        if (!kxRpIsNotFound(error)) return false;                                // indeterminado: no se toca
    }
    await kxRpDeleteDocWithTombstone(photoId);
    kxRpListSave(KX_RP_INTERRUPTED_KEY, kxRpListLoad(KX_RP_INTERRUPTED_KEY).filter(e => e.id !== photoId));
    return true;
}

/**
 * Get all photos for a route
 * @param {string} schoolId - School identifier
 * @param {number} routeId - Route ID from GeoJSON properties.id
 * @param {string} [routeName] - Route name (fallback for old docs without routeId)
 * @returns {Promise<Array>} - Array of photo objects {id, url, uploadedBy, ...}
 */
async function getRoutePhotos(schoolId, routeId, routeName) {
    kxRpRetryPending();
    try {
        // Primary query: by routeId
        let snapshot = await db.collection('route-photos')
            .where('schoolId', '==', schoolId)
            .where('routeId', '==', routeId)
            .get({ source: 'server' });

        // Fallback: old docs without routeId field, query by routeName
        if (snapshot.empty && routeName) {
            snapshot = await db.collection('route-photos')
                .where('schoolId', '==', schoolId)
                .where('routeName', '==', routeName)
                .get({ source: 'server' });
        }

        if (snapshot.empty) {
            return [];
        }

        const photos = snapshot.docs.map(doc => ({
            id: doc.id,
            url: doc.data().photoUrl,
            uploadedBy: doc.data().uploadedBy,
            uploadedByName: doc.data().uploadedByName,
            uploadedAt: doc.data().uploadedAt
        }));

        // Sort in memory to avoid Firestore composite index requirement
        return photos.sort((a, b) => {
            const tA = a.uploadedAt ? a.uploadedAt.toMillis() : 0;
            const tB = b.uploadedAt ? b.uploadedAt.toMillis() : 0;
            return tB - tA; // Descending
        });

    } catch (error) {
        console.error('Error getting route photos:', error);
        return [];
    }
}

/**
 * Upload a photo for a route
 * Orden: 1) preparar la imagen, 2) crear el documento (el servidor fija uploadedAt), 3) subir el archivo,
 * 4) si falla algo, deshacer lo creado (archivo y documento) para no dejar huérfanos.
 * @param {string} schoolId - School identifier
 * @param {number} routeId - Route ID from GeoJSON properties.id (entero)
 * @param {string} routeName - Route name (for display/compat)
 * @param {File} file - Image file to upload
 * @returns {Promise<string>} - URL of uploaded photo
 */
async function uploadRoutePhoto(schoolId, routeId, routeName, file) {
    if (!currentUser) {
        throw new Error('User must be logged in to upload photos');
    }

    // Check upload permissions
    const hasPermission = await canUploadPhotos();
    if (!hasPermission) {
        throw new Error('Debes iniciar sesión para subir fotos.');
    }

    // Validate file type
    const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg'];
    if (!validTypes.includes(file.type)) {
        throw new Error('Invalid file type. Please upload a JPG, PNG, or WebP image.');
    }

    // Validate file size (max 5MB)
    if (file.size > KX_RP_MAX_BYTES) {
        throw new Error('File too large. Maximum size is 5MB.');
    }

    if (typeof schoolId !== 'string' || !/^[A-Za-z0-9_-]{1,60}$/.test(schoolId) || !Number.isInteger(routeId)) {
        throw new Error('No se puede subir una foto a esta vía: le falta el identificador.');
    }

    // Doble pulsación o reintento del mismo archivo mientras sube: una sola subida
    const flightKey = `${currentUser.uid}|${schoolId}|${routeId}|${file.name}|${file.size}|${file.lastModified || ''}`;
    if (kxRpInFlight.has(flightKey)) return kxRpInFlight.get(flightKey);
    const job = kxRpUpload(schoolId, routeId, routeName, file).finally(() => kxRpInFlight.delete(flightKey));
    kxRpInFlight.set(flightKey, job);
    return job;
}

async function kxRpUpload(schoolId, routeId, routeName, file) {
    kxRpRetryPending();

    // 1) Reducir la imagen ANTES de crear nada: así el documento y el archivo se crean con segundos de diferencia
    const toUpload = (typeof kxPrepareImageForUpload === 'function') ? await kxPrepareImageForUpload(file) : file;
    const extension = kxRpExtensionFor(toUpload.type || file.type);
    if (!extension || toUpload.size > KX_RP_MAX_BYTES) {
        throw new Error(extension ? 'File too large. Maximum size is 5MB.' : 'Invalid file type. Please upload a JPG, PNG, or WebP image.');
    }

    const photoId = `${schoolId}_${routeId}_${kxRpRandomId(16)}`;
    const filename = `${photoId}.${extension}`;
    const storagePath = `route-photos/${schoolId}/${currentUser.uid}/${filename}`;
    const docRef = db.collection('route-photos').doc(photoId);
    const photoUrl = kxRpDownloadUrl(storagePath);

    // 2) Documento primero: uploadedAt lo pone el servidor y es la referencia de las 12 h. ANTES se anota la subida en el diario (si la app se cierra, queda constancia)
    kxRpActiveUploads.add(photoId);
    kxRpJournalAdd({ id: photoId, uid: currentUser.uid, path: storagePath, at: Date.now() });
    try {
        await docRef.set({
            photoUrl: photoUrl,
            uploadedBy: currentUser.uid,
            uploadedByName: String(currentUser.displayName || 'Anonymous').slice(0, 100),
            uploadedAt: firebase.firestore.FieldValue.serverTimestamp(),
            routeId: routeId,
            routeName: String(routeName || '').slice(0, 200),
            schoolId: schoolId,
            filename: filename,
            storagePath: storagePath
        });
    } catch (error) {
        // La respuesta pudo perderse con el documento ya creado: si existe y es nuestro, se continúa con él
        let created = false;
        try { const snap = await docRef.get(); created = snap.exists && snap.data().uploadedBy === currentUser.uid; } catch (_) { /* no se pudo comprobar */ }
        if (!created) { kxRpActiveUploads.delete(photoId); kxRpJournalRemove(photoId); throw kxRpFriendlyError(error, 'upload'); }
    }

    // 3) Archivo: un reintento si falla rápido y aún cabe en la ventana de 5 min; si el primer intento llegó a crearse pese al error, no se repite
    const acceptedAt = Date.now();
    const photoRef = storage.ref().child(storagePath);
    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt++) {
        if (attempt > 0 && Date.now() - acceptedAt >= KX_RP_RETRY_BEFORE_MS) break;   // fuera de ventana: las reglas lo rechazarían
        try {
            await photoRef.put(toUpload, {
                contentType: toUpload.type || undefined,
                cacheControl: 'public,max-age=31536000,immutable'
            });
            lastError = null;
            break;
        } catch (error) {
            lastError = error;
            try { await photoRef.getMetadata(); lastError = null; break; } catch (_) { /* no existe: se reintenta */ }
            if (kxRpIsPermissionError(error)) break;   // reintentar no cambia un «no»
        }
    }

    // 4) Si no se pudo subir, no queda nada a medias: se borra el documento (y el archivo, si llegó a existir)
    if (lastError) {
        console.error('Error uploading photo:', lastError);
        try { await photoRef.delete(); } catch (_) { /* no existe: lo normal */ }
        try {
            await kxRpDeleteDocWithTombstone(photoId);
        } catch (cleanupError) {
            kxRpPendingAdd(photoId);   // la cola de pendientes se ocupa del documento
            console.warn('No se pudo limpiar el documento de la foto; se reintentará:', cleanupError);
        }
        kxRpActiveUploads.delete(photoId); kxRpJournalRemove(photoId);   // el cliente se hizo cargo: ya no es una subida interrumpida
        throw kxRpFriendlyError(lastError, 'upload');
    }

    kxRpActiveUploads.delete(photoId); kxRpJournalRemove(photoId);   // subida completa
    return photoUrl;
}

function kxRpFriendlyError(error, action) {
    const code = kxRpCode(error);
    if (action === 'delete' && kxRpIsPermissionError(error)) {
        return new Error('Solo puedes borrar tus fotos durante las 12 primeras horas. Pasado ese tiempo, solo un administrador.');
    }
    if (action === 'upload' && kxRpIsPermissionError(error)) {
        return new Error('No se ha podido subir la foto (permiso denegado). Inténtalo de nuevo.');
    }
    // Likely CORS or Network error
    if (code === 'storage/retry-limit-exceeded' || code === 'unavailable' || /network/i.test(error && error.message || '') || !code) {
        return new Error('Error de conexión o CORS. Si estás en localhost, instala la extensión "Allow CORS" en Chrome.');
    }
    return error;
}

/**
 * Get photo URL for a route (Legacy - returns first found)
 * @param {string} schoolId - School identifier
 * @param {number} routeId - Route ID from GeoJSON properties.id
 * @param {string} [routeName] - Route name (fallback for old docs)
 * @returns {Promise<string|null>} - Photo URL or null if not found
 */
async function getRoutePhotoURL(schoolId, routeId, routeName) {
    const photos = await getRoutePhotos(schoolId, routeId, routeName);
    return photos.length > 0 ? photos[0].url : null;
}

/**
 * Delete a route photo
 * Orden: 1) archivo, 2) documento + marca. Si falla el archivo no se toca el documento; si falla el documento por red queda pendiente y se reintenta.
 * Quién puede lo deciden las reglas del servidor: el autor como máximo 12 h desde que el servidor aceptó el documento, admin y super-admin siempre.
 * El archivo va SIEMPRE antes que el documento: sin documento el autor ya no puede borrar el archivo.
 * @param {string} photoId - Firestore document ID of the photo
 * @param {string} uploaderUid - UID of the user who uploaded the photo (for quick check)
 * @returns {Promise<boolean>} - Success status
 */
async function deleteRoutePhoto(photoId, uploaderUid) {
    if (!currentUser) {
        throw new Error('User must be logged in to delete photos');
    }

    try {
        const doc = await db.collection('route-photos').doc(photoId).get();

        if (!doc.exists) {
            throw new Error('Photo not found');
        }

        const photoData = doc.data();

        // Comprobación rápida solo para evitar peticiones inútiles; la decisión real la toma el servidor
        const isAdmin = await isPhotoAdmin();
        if (photoData.uploadedBy !== currentUser.uid && !isAdmin) {
            throw new Error('You do not have permission to delete this photo');
        }

        // 1) Archivo (las fotos antiguas solo las puede borrar un administrador)
        const storagePath = kxRpStoragePathOf(photoData);
        if (storagePath) {
            const fileRef = storage.ref().child(storagePath);
            try {
                await fileRef.delete();
            } catch (error) {
                if (!kxRpIsNotFound(error)) {
                    // Si el archivo ya no existe (subida que falló) las reglas pueden responder «sin permiso» en lugar de «no encontrado»: se comprueba antes de rendirse
                    let gone = false;
                    try { await fileRef.getMetadata(); } catch (metaError) { gone = kxRpIsNotFound(metaError); }
                    if (!gone) throw kxRpFriendlyError(error, 'delete');   // el archivo sigue ahí: no se toca el documento
                }
            }
        }

        // 2) Documento + marca permanente (mismo lote)
        try {
            await kxRpDeleteDocWithTombstone(photoId);
        } catch (error) {
            const check = await db.collection('route-photos').doc(photoId).get().catch(() => null);
            if (check && !check.exists) return true;   // otro dispositivo lo borró a la vez
            if (!kxRpIsPermissionError(error)) kxRpPendingAdd(photoId);   // un «no» del servidor (plazo vencido) no mejora reintentando
            throw kxRpFriendlyError(error, 'delete');
        }

        // Verify deletion
        const check = await db.collection('route-photos').doc(photoId).get();
        if (check.exists) {
            throw new Error('Error: La foto no se pudo eliminar de la base de datos.');
        }
        kxRpListSave(KX_RP_INTERRUPTED_KEY, kxRpListLoad(KX_RP_INTERRUPTED_KEY).filter(e => e.id !== photoId));   // ya no es una subida interrumpida

        return true;

    } catch (error) {
        console.error('Error deleting photo:', error);
        throw error;
    }
}

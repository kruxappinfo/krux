// Firebase Configuration
// TODO: Replace with your actual Firebase config from Firebase Console
// Instructions:
// 1. Go to https://console.firebase.google.com/
// 2. Select your project (or create new one)
// 3. Go to Project Settings → General → Your apps
// 4. Click on Web app icon (</>)
// 5. Copy the firebaseConfig object and paste it below

const firebaseConfig = {
    apiKey: "AIzaSyDpxQsBojIZCiRGMn8fyLUmJIOm_2M_5EU",
    authDomain: "climbmaps-80cae.firebaseapp.com",
    projectId: "climbmaps-80cae",
    storageBucket: "climbmaps-80cae.firebasestorage.app",
    messagingSenderId: "627029956398",
    appId: "1:627029956398:web:ac68aa375da7f654480cbf",
    measurementId: "G-52WLBVG198"
};
// Detectar si estamos en Capacitor/app nativa
const isCapacitorEnv = window.Capacitor !== undefined;

// Initialize Firebase
firebase.initializeApp(firebaseConfig);

// Initialize services (declared as global variables)
db = firebase.firestore();
storage = firebase.storage();

// Inicializar Auth con manejo especial para Capacitor
auth = firebase.auth();

// Configurar persistencia ANTES de cualquier operación de auth
// En iOS WebView de Capacitor, ciertos tipos de persistencia no funcionan
if (isCapacitorEnv) {
    // Intentamos configurar la persistencia inmediatamente
    // Usamos indexedDB persistence que suele funcionar mejor en Capacitor
    (async function() {
        try {
            await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
            console.log('Firebase Auth: Persistencia LOCAL configurada');
        } catch (error) {
            console.warn('Firebase Auth: LOCAL no soportado, usando NONE:', error.code);
            try {
                await auth.setPersistence(firebase.auth.Auth.Persistence.NONE);
                console.log('Firebase Auth: Persistencia NONE configurada');
            } catch (err) {
                console.error('Firebase Auth: Error configurando persistencia:', err);
            }
        }
    })();
}

// Promesa que se resuelve cuando el estado de auth se ha determinado con un usuario válido,
// o tras un timeout si no hay sesión activa.
let _authReadyResolved = false;
let _authReadyResolve;
const authReadyPromise = new Promise((resolve) => { _authReadyResolve = resolve; });

const _unsubAuthReady = auth.onAuthStateChanged(function(user) {
    console.log('Firebase Auth: onAuthStateChanged, user:', user ? user.uid : 'null', 'already resolved:', _authReadyResolved);
    if (user && !_authReadyResolved) {
        _authReadyResolved = true;
        _authReadyResolve(user);
        _unsubAuthReady(); // Ya no necesitamos más emisiones
    }
});

// Timeout de seguridad: si tras 2s no hay usuario, resolver con null
setTimeout(() => {
    if (!_authReadyResolved) {
        console.log('Firebase Auth: Timeout alcanzado sin usuario, resolviendo con null');
        _authReadyResolved = true;
        _authReadyResolve(null);
        _unsubAuthReady();
    }
}, 2000);

/**
 * Espera a que Firebase Auth tenga un usuario autenticado, o timeout de 2s.
 * @returns {Promise<firebase.User|null>}
 */
function waitForAuthReady() {
    // Si auth.currentUser ya existe, resolver inmediatamente
    if (auth.currentUser) {
        return Promise.resolve(auth.currentUser);
    }
    return authReadyPromise;
}

// Google Auth Provider
googleProvider = new firebase.auth.GoogleAuthProvider();

// Facebook Auth Provider
facebookProvider = new firebase.auth.FacebookAuthProvider();
// Add scopes for email and public profile
facebookProvider.addScope('email');
facebookProvider.addScope('public_profile');

// ============================================
// COPIA DE SEGURIDAD DE TRAZADOS DE VÍAS
// ============================================
// Antes de escribir en sector_route_drawings/{id} se guarda el estado previo en
// sector_route_drawings/{id}/backups. Las reglas solo dejan añadir copias: nadie
// puede editarlas ni borrarlas desde la app.
const KX_DRAWINGS_BACKUP_INTERVAL_MS = 2 * 60 * 1000;
const _kxDrawingsBackupAt = {};

/**
 * Guarda una copia del documento de trazados tal como está ahora.
 * opts.snapshot: lectura ya hecha del documento (evita releerlo)
 * opts.required: operación destructiva → copia siempre y, si falla, lanza error
 *                para que el borrado no llegue a ejecutarse.
 * Sin required, las copias se espacian KX_DRAWINGS_BACKUP_INTERVAL_MS por documento.
 */
async function kxBackupRouteDrawings(docRef, reason, opts = {}) {
    const required = !!opts.required;
    try {
        const snapshot = opts.snapshot || await docRef.get();
        if (!snapshot.exists) return null;

        const data = snapshot.data() || {};
        const drawingsCount = (data.drawings || []).length;
        const auxCount = (data.auxElements || []).length + (data.rapelPoints || []).length;
        if (drawingsCount + auxCount === 0) return null;

        const last = _kxDrawingsBackupAt[docRef.id] || 0;
        if (!required && Date.now() - last < KX_DRAWINGS_BACKUP_INTERVAL_MS) return null;

        const user = firebase.auth().currentUser;
        const backupRef = await docRef.collection('backups').add({
            docId: docRef.id,
            reason: reason || 'write',
            drawingsCount,
            auxCount,
            data,
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            createdBy: user ? user.uid : null
        });
        _kxDrawingsBackupAt[docRef.id] = Date.now();
        return backupRef.id;
    } catch (e) {
        console.error('[DrawingsBackup] Error creando copia de seguridad:', e);
        if (required) {
            throw new Error('no se pudo crear la copia de seguridad, así que no se ha borrado nada');
        }
        return null;
    }
}

/**
 * Restaura una copia: guarda antes el estado actual y sustituye el documento entero.
 */
async function kxRestoreRouteDrawings(docRef, backupId) {
    const backup = await docRef.collection('backups').doc(backupId).get();
    if (!backup.exists || !backup.data().data) {
        throw new Error('la copia no existe o está vacía');
    }
    await kxBackupRouteDrawings(docRef, 'antes-de-restaurar', { required: true });
    const user = firebase.auth().currentUser;
    await docRef.set({
        ...backup.data().data,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedBy: user ? user.uid : null,
        restoredFrom: backupId
    });
}

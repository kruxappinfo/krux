/**
 * Admin Panel - Unified Administration
 *
 * Panel unificado de administración para Climbmaps.
 * Acceso exclusivo para super-admin (krux.app.info@gmail.com)
 */

// ============================================
// CONFIGURACIÓN
// ============================================

const SUPER_ADMIN_EMAIL = 'krux.app.info@gmail.com';

let db;
let auth;
let currentUser = null;
let allRoutes = [];
let allUsers = [];

// ============================================
// INICIALIZACIÓN
// ============================================

document.addEventListener('DOMContentLoaded', () => {
    initFirebase();
    setupNavigation();
});

function initFirebase() {
    db = firebase.firestore();
    auth = firebase.auth();

    auth.onAuthStateChanged(async (user) => {
        if (user) {
            currentUser = user;
            await checkSuperAdminAccess(user);
        } else {
            showAccessDenied();
        }
    });
}

// ============================================
// VERIFICACIÓN DE ACCESO
// ============================================

async function checkSuperAdminAccess(user) {
    const loadingState = document.getElementById('loadingState');

    // Verificar si es el super admin
    if (user.email !== SUPER_ADMIN_EMAIL) {
        showAccessDenied();
        return;
    }

    // Es super admin, mostrar panel
    loadingState.style.display = 'none';
    document.getElementById('adminPanel').style.display = 'block';

    // Actualizar UI del usuario
    updateUserUI(user);

    // Cargar datos iniciales
    await Promise.all([
        loadStats(),
        loadSchoolsFilter(),
        loadRoutes(),
        loadUsers()
    ]);
}

function showAccessDenied() {
    document.getElementById('loadingState').style.display = 'none';
    document.getElementById('accessDenied').style.display = 'block';
    document.getElementById('sidebar').style.display = 'none';
}

function updateUserUI(user) {
    const email = user.email || 'Usuario';
    document.getElementById('userName').textContent = email;
    document.getElementById('userAvatar').textContent = email.charAt(0).toUpperCase();
}

// ============================================
// NAVEGACIÓN
// ============================================

function setupNavigation() {
    const navLinks = document.querySelectorAll('.sidebar-nav a');

    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const section = link.dataset.section;
            navigateTo(section);

            // Cerrar sidebar en móvil
            if (window.innerWidth <= 768) {
                document.getElementById('sidebar').classList.remove('open');
            }
        });
    });

    // Manejar navegación por hash
    window.addEventListener('hashchange', () => {
        const hash = window.location.hash.replace('#', '') || 'dashboard';
        navigateTo(hash, false);
    });

    // Cargar sección inicial
    const initialSection = window.location.hash.replace('#', '') || 'dashboard';
    navigateTo(initialSection, false);
}

function navigateTo(section, updateHash = true) {
    // Actualizar nav activo
    document.querySelectorAll('.sidebar-nav a').forEach(link => {
        link.classList.toggle('active', link.dataset.section === section);
    });

    // Mostrar sección
    document.querySelectorAll('.section').forEach(sec => {
        sec.classList.toggle('active', sec.id === `section-${section}`);
    });

    // Actualizar hash
    if (updateHash) {
        window.location.hash = section;
    }

    // Recargar datos si es necesario
    if (section === 'routes') {
        loadRoutes();
    } else if (section === 'users') {
        loadUsers();
        loadSpotterRequestsInUsersSection();
    } else if (section === 'spotters') {
        loadSpotterRequests();
        loadApprovedSpotters();
    } else if (section === 'suggestions') {
        loadSuggestions();
    } else if (section === 'schools') {
        loadPendingSchools();
    } else if (section === 'sectors') {
        loadPendingSectors();
    } else if (section === 'poi') {
        loadPendingPOI();
    } else if (section === 'gyms') {
        loadGymContributions();
    }
}

function toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('open');
}

// ============================================
// ESTADÍSTICAS
// ============================================

async function loadStats() {
    try {
        const collections = ['pending_routes', 'pending_schools', 'pending_sectors', 'pending_poi'];
        let pending = 0, approved = 0, rejected = 0;
        let schoolsPending = 0, sectorsPending = 0, poiPending = 0;

        for (const col of collections) {
            const snapshot = await db.collection(col).get();
            snapshot.forEach(doc => {
                const status = doc.data().status || 'pending';
                if (status === 'pending') {
                    pending++;
                    if (col === 'pending_schools') schoolsPending++;
                    if (col === 'pending_sectors') sectorsPending++;
                    if (col === 'pending_poi') poiPending++;
                }
                else if (status === 'approved') approved++;
                else if (status === 'rejected') rejected++;
            });
        }

        document.getElementById('statPending').textContent = pending;
        document.getElementById('statApproved').textContent = approved;
        document.getElementById('statRejected').textContent = rejected;

        // Nav badges
        const setBadge = (id, count) => {
            const el = document.getElementById(id);
            if (el) {
                el.textContent = count;
                el.style.display = count > 0 ? 'inline' : 'none';
            }
        };
        setBadge('schoolsBadge', schoolsPending);
        setBadge('sectorsBadge', sectorsPending);
        setBadge('poiBadge', poiPending);

        // Stats de usuarios
        const usersSnapshot = await db.collection('admins').get();
        document.getElementById('statUsers').textContent = usersSnapshot.size;

    } catch (error) {
        console.error('Error cargando estadísticas:', error);
    }
}

// ============================================
// GESTIÓN DE VÍAS
// ============================================

async function loadSchoolsFilter() {
    try {
        const snapshot = await db.collection('pending_routes').get();
        const schools = new Set();

        snapshot.forEach(doc => {
            const data = doc.data();
            if (data.schoolId) {
                schools.add(JSON.stringify({ id: data.schoolId, name: data.schoolName || data.schoolId }));
            }
        });

        const select = document.getElementById('filterSchool');
        // Limpiar opciones excepto la primera
        while (select.options.length > 1) {
            select.remove(1);
        }

        schools.forEach(schoolStr => {
            const school = JSON.parse(schoolStr);
            const option = document.createElement('option');
            option.value = school.id;
            option.textContent = school.name;
            select.appendChild(option);
        });
    } catch (error) {
        console.error('Error cargando escuelas:', error);
    }
}

async function loadRoutes() {
    const routesList = document.getElementById('routesList');
    routesList.innerHTML = `
        <div class="loading">
            <div class="spinner"></div>
            <p>Cargando vías...</p>
        </div>
    `;

    try {
        const filterSchool = document.getElementById('filterSchool').value;
        const filterStatus = document.getElementById('filterStatus').value;

        const snapshot = await db.collection('pending_routes').orderBy('createdAt', 'desc').get();
        allRoutes = [];

        snapshot.forEach(doc => {
            const data = doc.data();
            data.id = doc.id;

            // Aplicar filtros
            if (filterSchool !== 'all' && data.schoolId !== filterSchool) return;
            if (filterStatus !== 'all' && data.status !== filterStatus) return;

            allRoutes.push(data);
        });

        renderRoutes(allRoutes);
    } catch (error) {
        console.error('Error cargando rutas:', error);
        routesList.innerHTML = `
            <div class="empty-state">
                <p>Error al cargar las vías</p>
            </div>
        `;
    }
}

function renderRoutes(routes) {
    const routesList = document.getElementById('routesList');

    if (routes.length === 0) {
        routesList.innerHTML = `
            <div class="empty-state">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p>No hay vías con los filtros seleccionados</p>
            </div>
        `;
        return;
    }

    routesList.innerHTML = routes.map(route => createRouteCard(route)).join('');
}

function createRouteCard(route) {
    const createdAt = route.createdAt ? new Date(route.createdAt.toDate()).toLocaleDateString('es-ES', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    }) : 'Fecha desconocida';

    const statusClass = route.status || 'pending';
    const statusText = {
        'pending': 'Pendiente',
        'approved': 'Aprobada',
        'rejected': 'Rechazada'
    }[statusClass] || 'Pendiente';

    const badgeClass = {
        'pending': 'badge-pending',
        'approved': 'badge-approved',
        'rejected': 'badge-rejected'
    }[statusClass] || 'badge-pending';

    const showActions = route.status === 'pending';

    return `
        <div class="route-card ${statusClass}">
            <div class="route-header">
                <div>
                    <div class="route-name">${escapeHtml(route.nombre || 'Sin nombre')}</div>
                    <span class="badge ${badgeClass}">${statusText}</span>
                </div>
                <div class="route-grade">${escapeHtml(route.grado1 || '?')}</div>
            </div>

            <div class="route-details">
                <div>
                    <div class="route-detail-label">Escuela</div>
                    <div class="route-detail-value">${escapeHtml(route.schoolName || route.schoolId || '-')}</div>
                </div>
                <div>
                    <div class="route-detail-label">Sector</div>
                    <div class="route-detail-value">${escapeHtml(route.sector || '-')}</div>
                </div>
                <div>
                    <div class="route-detail-label">Modalidad</div>
                    <div class="route-detail-value">${escapeHtml(route.modalidad || 'Simple')}</div>
                </div>
                <div>
                    <div class="route-detail-label">Express</div>
                    <div class="route-detail-value">${route.exp1 || '-'}</div>
                </div>
                <div>
                    <div class="route-detail-label">Metros</div>
                    <div class="route-detail-value">${route.long1 ? route.long1 + 'm' : '-'}</div>
                </div>
                <div>
                    <div class="route-detail-label">Descripción</div>
                    <div class="route-detail-value">${escapeHtml(route.descripcion || '-')}</div>
                </div>
            </div>

            <div class="route-meta">
                <span>Enviada por: ${escapeHtml(route.createdByEmail || 'Desconocido')}</span>
                <span>${createdAt}</span>
            </div>

            <div class="route-actions">
                ${route.coordinates ? `
                <button class="btn btn-primary btn-sm" onclick="viewRouteOnMap('${route.id}', ${route.coordinates[0]}, ${route.coordinates[1]}, '${escapeHtml(route.schoolId || '')}')">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                    </svg>
                    Ver en mapa
                </button>
                ` : ''}
                ${showActions ? `
                <button class="btn btn-success btn-sm" onclick="approveRoute('${route.id}')">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                    </svg>
                    Aprobar
                </button>
                <button class="btn btn-danger btn-sm" onclick="rejectRoute('${route.id}')">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                    Rechazar
                </button>
                ` : ''}
                <button class="btn btn-edit btn-sm" onclick="openEditModal('${route.id}')">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                    Editar
                </button>
                <button class="btn btn-delete btn-sm" onclick="deleteRoute('${route.id}')">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                    Eliminar
                </button>
            </div>
        </div>
    `;
}

// Puntos y aprobación: spotter-approval.js (kxApprovePending), compartido con los otros paneles

async function approveRoute(routeId) {
    if (!confirm('¿Aprobar esta vía?')) return;

    try {
        const award = await kxApprovePending('pending_routes', routeId);

        showToast(kxApprovalMessage('Vía aprobada correctamente', award).replace('\n', ' · '), 'success');
        await loadRoutes();
        await loadStats();
    } catch (error) {
        console.error('Error aprobando ruta:', error);
        showToast('Error al aprobar la vía', 'error');
    }
}

async function rejectRoute(routeId) {
    if (!confirm('¿Rechazar y eliminar esta vía permanentemente?')) return;

    try {
        // Obtener datos de la vía antes de eliminarla (para informar de sus trazados)
        const routeDoc = await db.collection('pending_routes').doc(routeId).get();
        const routeData = routeDoc.exists ? routeDoc.data() : null;

        // Eliminar completamente el documento (no dejar residuos)
        await db.collection('pending_routes').doc(routeId).delete();

        // Los trazados de la vía NO se borran: solo se informa de cuántos se conservan
        let keptDrawings = 0;
        if (routeData && routeData.schoolId && routeData.sector && routeData.nombre) {
            keptDrawings = await kxCountRouteDrawings(routeData.schoolId, routeData.sector, routeData.nombre);
        }

        showToast(keptDrawings ? `Vía rechazada y eliminada · se conservan ${keptDrawings} trazado(s) del croquis` : 'Vía rechazada y eliminada', 'info');
        await loadRoutes();
        await loadStats();
    } catch (error) {
        console.error('Error rechazando ruta:', error);
        showToast('Error al rechazar la vía', 'error');
    }
}

async function deleteRoute(routeId) {
    if (!confirm('¿Eliminar esta vía permanentemente?')) return;

    try {
        // Obtener datos de la vía antes de eliminarla (para informar de sus trazados)
        const routeDoc = await db.collection('pending_routes').doc(routeId).get();
        const routeData = routeDoc.exists ? routeDoc.data() : null;

        await db.collection('pending_routes').doc(routeId).delete();

        // Los trazados de la vía NO se borran: solo se informa de cuántos se conservan
        let keptDrawings = 0;
        if (routeData && routeData.schoolId && routeData.sector && routeData.nombre) {
            keptDrawings = await kxCountRouteDrawings(routeData.schoolId, routeData.sector, routeData.nombre);
        }

        showToast(keptDrawings ? `Vía eliminada · se conservan ${keptDrawings} trazado(s) del croquis` : 'Vía eliminada', 'info');
        await loadRoutes();
        await loadStats();
    } catch (error) {
        console.error('Error eliminando ruta:', error);
        showToast('Error al eliminar la vía', 'error');
    }
}

// ============================================
// EXPORTACIÓN
// ============================================

async function exportAllApproved() {
    try {
        const filterSchool = document.getElementById('filterSchool')?.value || 'all';

        const snapshot = await db.collection('pending_routes')
            .where('status', '==', 'approved')
            .get();

        if (snapshot.empty) {
            showToast('No hay vías aprobadas para exportar', 'info');
            return;
        }

        const routesBySchool = {};

        snapshot.forEach(doc => {
            const data = doc.data();

            if (filterSchool !== 'all' && data.schoolId !== filterSchool) return;

            if (!routesBySchool[data.schoolId]) {
                routesBySchool[data.schoolId] = {
                    name: data.schoolName || data.schoolId,
                    features: []
                };
            }

            const feature = {
                type: 'Feature',
                properties: {
                    fid: routesBySchool[data.schoolId].features.length + 1000,
                    nombre: data.nombre,
                    grado1: data.grado1,
                    sector: data.sector,
                    exp1: data.exp1,
                    long1: data.long1,
                    descripcion: data.descripcion,
                    modalidad: data.modalidad,
                    variante: data.variante || 'NO'
                },
                geometry: {
                    type: 'MultiPoint',
                    coordinates: [data.coordinates]
                }
            };

            routesBySchool[data.schoolId].features.push(feature);
        });

        const schoolIds = Object.keys(routesBySchool);

        if (schoolIds.length === 0) {
            showToast('No hay vías para exportar', 'info');
            return;
        }

        for (const schoolId of schoolIds) {
            const school = routesBySchool[schoolId];
            const geojson = {
                type: 'FeatureCollection',
                name: `${schoolId}_Vias_Aprobadas`,
                features: school.features
            };

            downloadJSON(geojson, `${schoolId}_vias_aprobadas_${Date.now()}.geojson`);
        }

        showToast(`Exportadas ${schoolIds.length} escuela(s)`, 'success');

    } catch (error) {
        console.error('Error exportando:', error);
        showToast('Error al exportar', 'error');
    }
}

function downloadJSON(data, filename) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

// ============================================
// GESTIÓN DE USUARIOS
// ============================================

async function loadUsers() {
    const usersList = document.getElementById('usersList');

    try {
        const snapshot = await db.collection('admins').get();

        if (snapshot.empty) {
            usersList.innerHTML = `
                <tr>
                    <td colspan="4" class="empty-state">No hay usuarios autorizados</td>
                </tr>
            `;
            return;
        }

        let html = '';
        snapshot.forEach(doc => {
            const data = doc.data();
            const uid = doc.id;

            const roleLabel = data.role === 'admin' ? 'Admin' : 'Subir Fotos';
            const badgeClass = data.role === 'admin' ? 'badge-admin' : 'badge-uploader';

            html += `
                <tr>
                    <td>${escapeHtml(data.email || 'N/A')}</td>
                    <td><span class="badge ${badgeClass}">${roleLabel}</span></td>
                    <td style="font-family: monospace; font-size: 12px; color: #999;">${uid.substring(0, 12)}...</td>
                    <td>
                        <button
                            class="btn btn-danger btn-sm"
                            onclick="removeUser('${uid}', '${escapeHtml(data.email || uid)}')"
                            ${uid === currentUser?.uid ? 'disabled title="No puedes eliminarte"' : ''}
                        >
                            Eliminar
                        </button>
                    </td>
                </tr>
            `;
        });

        usersList.innerHTML = html;

    } catch (error) {
        console.error('Error cargando usuarios:', error);
        usersList.innerHTML = `
            <tr>
                <td colspan="4" style="color: #ef4444;">Error al cargar usuarios</td>
            </tr>
        `;
    }
}

async function addUser() {
    const emailInput = document.getElementById('newUserEmail');
    const roleSelect = document.getElementById('newUserRole');

    const email = emailInput.value.trim();
    const role = roleSelect.value;

    if (!email || !email.includes('@')) {
        showToast('Por favor, ingresa un correo válido', 'error');
        return;
    }

    const uid = prompt(
        `Para agregar a ${email}, necesitas su UID de Firebase.\n\n` +
        `El usuario debe iniciar sesión al menos una vez en la app.\n` +
        `Copia su UID desde Firebase Auth:`
    );

    if (!uid || uid.trim() === '') {
        showToast('Operación cancelada', 'info');
        return;
    }

    try {
        await db.collection('admins').doc(uid.trim()).set({
            email: email,
            role: role,
            addedBy: currentUser.uid,
            addedAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        showToast(`Usuario ${email} agregado`, 'success');
        emailInput.value = '';
        await loadUsers();
        await loadStats();

    } catch (error) {
        console.error('Error agregando usuario:', error);
        showToast('Error al agregar usuario', 'error');
    }
}

async function removeUser(uid, email) {
    if (!confirm(`¿Eliminar a ${email}?`)) return;

    try {
        await db.collection('admins').doc(uid).delete();
        showToast(`Usuario ${email} eliminado`, 'success');
        await loadUsers();
        await loadStats();

    } catch (error) {
        console.error('Error eliminando usuario:', error);
        showToast('Error al eliminar usuario', 'error');
    }
}

// ============================================
// UTILIDADES
// ============================================

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function showToast(message, type = 'info') {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;

    document.body.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(20px)';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function logout() {
    if (confirm('¿Cerrar sesión?')) {
        auth.signOut().then(() => {
            window.location.href = 'index.html';
        });
    }
}

// ============================================
// VER RUTA EN MAPA
// ============================================

let mapModal = null;
let mapInstance = null;
let currentMapRouteId = null;

function viewRouteOnMap(routeId, lng, lat, schoolId) {
    currentMapRouteId = routeId;

    // Crear modal si no existe
    if (!mapModal) {
        createMapModal();
    }

    // Mostrar modal
    mapModal.classList.remove('hidden');

    // Forzar resize del mapa después de que el modal sea visible
    // Esto es necesario porque MapLibre necesita dimensiones calculadas del contenedor
    setTimeout(() => {
        if (mapInstance) {
            mapInstance.resize();
        }
        // Cargar datos de la ruta después del resize
        loadRouteForMap(routeId, lng, lat);
    }, 50);
}

function createMapModal() {
    mapModal = document.createElement('div');
    mapModal.id = 'map-modal';
    mapModal.className = 'map-modal-overlay';
    mapModal.innerHTML = `
        <div class="map-modal-container">
            <div class="map-modal-header">
                <h3 id="map-modal-title">Ubicación de la vía</h3>
                <button class="map-modal-close" onclick="closeMapModal()">&times;</button>
            </div>
            <div class="map-modal-body">
                <div id="admin-map-container"></div>
                <div id="map-route-info" class="map-route-info"></div>
            </div>
            <div class="map-modal-footer" id="map-modal-actions">
                <!-- Actions will be inserted here -->
            </div>
        </div>
    `;

    // Añadir estilos
    const styles = document.createElement('style');
    styles.textContent = `
        .map-modal-overlay {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0,0,0,0.7);
            z-index: 9999;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }
        .map-modal-overlay.hidden {
            display: none;
        }
        .map-modal-container {
            background: white;
            border-radius: 16px;
            width: 100%;
            max-width: 900px;
            max-height: 90vh;
            overflow: hidden;
            display: flex;
            flex-direction: column;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
        }
        .map-modal-header {
            padding: 20px 24px;
            border-bottom: 1px solid #e0e0e0;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .map-modal-header h3 {
            font-size: 18px;
            font-weight: 600;
            color: #1a1a2e;
        }
        .map-modal-close {
            background: none;
            border: none;
            font-size: 28px;
            cursor: pointer;
            color: #666;
            line-height: 1;
            padding: 0;
            width: 36px;
            height: 36px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 8px;
        }
        .map-modal-close:hover {
            background: #f0f0f0;
        }
        .map-modal-body {
            flex: 1;
            overflow: hidden;
            display: flex;
            flex-direction: column;
        }
        #admin-map-container {
            width: 100%;
            height: 400px;
            background: #e0e0e0;
        }
        .map-route-info {
            padding: 20px;
            background: #f8f9fa;
            border-top: 1px solid #e0e0e0;
        }
        .map-route-info h4 {
            font-size: 18px;
            font-weight: 700;
            margin-bottom: 12px;
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .map-route-info .route-grade-badge {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 14px;
        }
        .map-route-details-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
            gap: 12px;
            margin-bottom: 12px;
        }
        .map-route-detail {
            font-size: 13px;
        }
        .map-route-detail-label {
            color: #666;
            font-size: 11px;
            text-transform: uppercase;
        }
        .map-route-detail-value {
            font-weight: 600;
            color: #333;
        }
        .map-modal-footer {
            padding: 16px 24px;
            border-top: 1px solid #e0e0e0;
            display: flex;
            gap: 12px;
            justify-content: flex-end;
            flex-wrap: wrap;
        }
        @media (max-width: 600px) {
            .map-modal-container {
                max-height: 100vh;
                border-radius: 0;
            }
            #admin-map-container {
                height: 300px;
            }
            .map-modal-footer {
                flex-direction: column;
            }
            .map-modal-footer .btn {
                width: 100%;
                justify-content: center;
            }
        }
    `;
    document.head.appendChild(styles);
    document.body.appendChild(mapModal);

    // Inicializar mapa
    initAdminMap();
}

function initAdminMap() {
    // Cargar MapLibre si no está disponible
    if (typeof maplibregl === 'undefined') {
        const script = document.createElement('script');
        script.src = 'https://unpkg.com/maplibre-gl@3.6.2/dist/maplibre-gl.js';
        script.onload = () => {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = 'https://unpkg.com/maplibre-gl@3.6.2/dist/maplibre-gl.css';
            document.head.appendChild(link);
            createMapInstance();
        };
        document.head.appendChild(script);
    } else {
        createMapInstance();
    }
}

function createMapInstance() {
    mapInstance = new maplibregl.Map({
        container: 'admin-map-container',
        style: {
            version: 8,
            glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
            sources: {
                'satellite': {
                    type: 'raster',
                    tiles: [
                        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
                    ],
                    tileSize: 256,
                    attribution: '&copy; Esri'
                }
            },
            layers: [
                {
                    id: 'satellite-layer',
                    type: 'raster',
                    source: 'satellite',
                    minzoom: 0,
                    maxzoom: 22
                }
            ]
        },
        center: [-3.7, 40.4],
        zoom: 5
    });

    mapInstance.addControl(new maplibregl.NavigationControl(), 'top-right');
}

async function loadRouteForMap(routeId, lng, lat) {
    try {
        const doc = await db.collection('pending_routes').doc(routeId).get();

        if (!doc.exists) {
            showToast('Ruta no encontrada', 'error');
            closeMapModal();
            return;
        }

        const route = doc.data();
        route.id = doc.id;

        // Actualizar título
        document.getElementById('map-modal-title').textContent = route.nombre || 'Vía sin nombre';

        // Actualizar info de la ruta
        const infoContainer = document.getElementById('map-route-info');
        infoContainer.innerHTML = `
            <h4>
                ${escapeHtml(route.nombre || 'Sin nombre')}
                <span class="route-grade-badge">${escapeHtml(route.grado1 || '?')}</span>
            </h4>
            <div class="map-route-details-grid">
                <div class="map-route-detail">
                    <div class="map-route-detail-label">Escuela</div>
                    <div class="map-route-detail-value">${escapeHtml(route.schoolName || route.schoolId || '-')}</div>
                </div>
                <div class="map-route-detail">
                    <div class="map-route-detail-label">Sector</div>
                    <div class="map-route-detail-value">${escapeHtml(route.sector || '-')}</div>
                </div>
                <div class="map-route-detail">
                    <div class="map-route-detail-label">Modalidad</div>
                    <div class="map-route-detail-value">${escapeHtml(route.modalidad || 'Simple')}</div>
                </div>
                <div class="map-route-detail">
                    <div class="map-route-detail-label">Express</div>
                    <div class="map-route-detail-value">${route.exp1 || '-'}</div>
                </div>
                <div class="map-route-detail">
                    <div class="map-route-detail-label">Metros</div>
                    <div class="map-route-detail-value">${route.long1 ? route.long1 + 'm' : '-'}</div>
                </div>
                <div class="map-route-detail">
                    <div class="map-route-detail-label">Enviada por</div>
                    <div class="map-route-detail-value">${escapeHtml(route.createdByEmail || '-')}</div>
                </div>
            </div>
        `;

        // Actualizar acciones según estado
        const actionsContainer = document.getElementById('map-modal-actions');
        if (route.status === 'pending') {
            actionsContainer.innerHTML = `
                <button class="btn btn-secondary" onclick="closeMapModal()">Cerrar</button>
                <button class="btn btn-danger" onclick="rejectRouteFromMap('${route.id}')">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                    Rechazar
                </button>
                <button class="btn btn-success" onclick="approveRouteFromMap('${route.id}')">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                    </svg>
                    Aprobar
                </button>
            `;
        } else {
            const statusText = route.status === 'approved' ? 'Aprobada' : 'Rechazada';
            actionsContainer.innerHTML = `
                <span style="color: #666;">Estado: <strong>${statusText}</strong></span>
                <button class="btn btn-secondary" onclick="closeMapModal()">Cerrar</button>
            `;
        }

        // Centrar mapa y añadir marcador
        if (mapInstance) {
            // Esperar a que el mapa esté listo
            if (mapInstance.loaded()) {
                addMarkerToMap(lng, lat, route);
            } else {
                mapInstance.on('load', () => addMarkerToMap(lng, lat, route));
            }
        }

    } catch (error) {
        console.error('Error cargando ruta:', error);
        showToast('Error al cargar la ruta', 'error');
    }
}

function addMarkerToMap(lng, lat, route) {
    // Remover marcadores anteriores
    const existingMarkers = document.querySelectorAll('.admin-map-marker');
    existingMarkers.forEach(m => m.remove());

    // Cargar vías oficiales de la escuela para contexto
    loadOfficialRoutesOnViewMap(route.schoolId);

    // Crear marcador de la vía pendiente (morado/violeta para distinguirla)
    const el = document.createElement('div');
    el.className = 'admin-map-marker';
    el.style.cssText = `
        width: 16px;
        height: 16px;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        border: 2px solid white;
        border-radius: 50%;
        box-shadow: 0 2px 6px rgba(0,0,0,0.3);
        cursor: pointer;
        z-index: 10;
    `;

    new maplibregl.Marker({ element: el })
        .setLngLat([lng, lat])
        .addTo(mapInstance);

    // Centrar mapa
    mapInstance.flyTo({
        center: [lng, lat],
        zoom: 17,
        duration: 1000
    });
}

/**
 * Carga las vías oficiales desde el archivo GeoJSON para el modal de visualización
 */
async function loadOfficialRoutesOnViewMap(schoolId) {
    if (!mapInstance || !schoolId) return;

    const geojsonPath = SCHOOL_GEOJSON_PATHS[schoolId];
    if (!geojsonPath) {
        console.log(`[ViewMap] No hay GeoJSON de vías oficiales para ${schoolId}`);
        return;
    }

    try {
        // Remover source y layers anteriores si existen
        if (mapInstance.getLayer('view-official-routes-labels')) mapInstance.removeLayer('view-official-routes-labels');
        if (mapInstance.getLayer('view-official-routes-layer')) mapInstance.removeLayer('view-official-routes-layer');
        if (mapInstance.getSource('view-official-routes')) mapInstance.removeSource('view-official-routes');

        // Cargar el GeoJSON
        const response = await fetch(geojsonPath);
        if (!response.ok) {
            console.warn(`[ViewMap] No se pudo cargar ${geojsonPath}`);
            return;
        }
        const geojson = await response.json();

        // Añadir source
        mapInstance.addSource('view-official-routes', {
            type: 'geojson',
            data: geojson
        });

        // Añadir capa de círculos para las vías oficiales (azul)
        mapInstance.addLayer({
            id: 'view-official-routes-layer',
            type: 'circle',
            source: 'view-official-routes',
            paint: {
                'circle-radius': 6,
                'circle-color': '#3b82f6',  // Azul para oficiales
                'circle-stroke-color': '#ffffff',
                'circle-stroke-width': 1.5,
                'circle-opacity': 0.8
            }
        });

        // Añadir etiquetas con nombre y grado
        mapInstance.addLayer({
            id: 'view-official-routes-labels',
            type: 'symbol',
            source: 'view-official-routes',
            layout: {
                'text-field': ['concat', ['get', 'nombre'], ' (', ['get', 'grado1'], ')'],
                'text-font': ['Noto Sans Regular'],
                'text-size': 10,
                'text-offset': [0, 1.2],
                'text-anchor': 'top',
                'text-allow-overlap': false
            },
            paint: {
                'text-color': '#93c5fd',
                'text-halo-color': '#1e3a5f',
                'text-halo-width': 1
            }
        });

        // Añadir popup al hacer click en las vías oficiales
        mapInstance.on('click', 'view-official-routes-layer', (e) => {
            if (!e.features || e.features.length === 0) return;
            const props = e.features[0].properties;

            new maplibregl.Popup()
                .setLngLat(e.lngLat)
                .setHTML(`
                    <div style="padding: 8px;">
                        <strong>${props.nombre || 'Sin nombre'}</strong><br>
                        <span style="color: #3b82f6; font-weight: 600;">${props.grado1 || '?'}</span><br>
                        <small>Sector: ${props.sector || '-'}</small><br>
                        <small style="color: #3b82f6;">✓ Vía Oficial</small>
                    </div>
                `)
                .addTo(mapInstance);
        });

        // Cursor pointer al hover
        mapInstance.on('mouseenter', 'view-official-routes-layer', () => {
            mapInstance.getCanvas().style.cursor = 'pointer';
        });
        mapInstance.on('mouseleave', 'view-official-routes-layer', () => {
            mapInstance.getCanvas().style.cursor = '';
        });

        console.log(`[ViewMap] Cargadas ${geojson.features?.length || 0} vías oficiales de ${schoolId}`);

    } catch (error) {
        console.error('[ViewMap] Error cargando vías oficiales:', error);
    }
}

function closeMapModal() {
    if (mapModal) {
        mapModal.classList.add('hidden');
    }
    currentMapRouteId = null;
}

async function approveRouteFromMap(routeId) {
    if (!confirm('¿Aprobar esta vía?')) return;

    try {
        const award = await kxApprovePending('pending_routes', routeId);

        showToast(kxApprovalMessage('Vía aprobada correctamente', award).replace('\n', ' · '), 'success');
        closeMapModal();
        await loadRoutes();
        await loadStats();
    } catch (error) {
        console.error('Error aprobando ruta:', error);
        showToast('Error al aprobar la vía', 'error');
    }
}

async function rejectRouteFromMap(routeId) {
    const reason = prompt('Motivo del rechazo (opcional):');

    try {
        await db.collection('pending_routes').doc(routeId).update({
            status: 'rejected',
            rejectedAt: firebase.firestore.FieldValue.serverTimestamp(),
            rejectedBy: currentUser.email,
            rejectionReason: reason || null
        });

        showToast('Vía rechazada', 'info');
        closeMapModal();
        await loadRoutes();
        await loadStats();
    } catch (error) {
        console.error('Error rechazando ruta:', error);
        showToast('Error al rechazar la vía', 'error');
    }
}

// ============================================
// EDICIÓN DE VÍAS (SPOTTER)
// ============================================

let editModal = null;
let editMap = null;
let editMarker = null;
let editingRouteId = null;
let editingRouteData = null;

/**
 * Abre el modal de edición para una vía
 */
async function openEditModal(routeId) {
    try {
        const doc = await db.collection('pending_routes').doc(routeId).get();
        if (!doc.exists) {
            showToast('Vía no encontrada', 'error');
            return;
        }

        editingRouteId = routeId;
        editingRouteData = doc.data();

        createEditModal();

        // Rellenar formulario
        document.getElementById('editNombre').value = editingRouteData.nombre || '';
        document.getElementById('editGrado').value = editingRouteData.grado1 || '';
        document.getElementById('editSector').value = editingRouteData.sector || '';
        document.getElementById('editExp').value = editingRouteData.exp1 || '';
        document.getElementById('editLong').value = editingRouteData.long1 || '';
        document.getElementById('editDescripcion').value = editingRouteData.descripcion || '';
        document.getElementById('editModalidad').value = editingRouteData.modalidad || 'Simple';

        editModal.classList.remove('hidden');

        setTimeout(() => initEditMap(), 100);

    } catch (error) {
        console.error('Error abriendo editor:', error);
        showToast('Error al cargar la vía', 'error');
    }
}

function createEditModal() {
    if (document.getElementById('editModal')) {
        editModal = document.getElementById('editModal');
        return;
    }

    editModal = document.createElement('div');
    editModal.id = 'editModal';
    editModal.className = 'edit-modal-overlay';
    editModal.innerHTML = `
        <div class="edit-modal-container">
            <div class="edit-modal-header">
                <h3>Editar Vía del Spotter</h3>
                <button class="edit-modal-close" onclick="closeEditModal()">&times;</button>
            </div>

            <div class="edit-modal-body">
                <div class="edit-form-section">
                    <h4>Información de la Vía</h4>
                    <div class="edit-form-grid">
                        <div class="edit-form-group">
                            <label>Nombre</label>
                            <input type="text" id="editNombre" class="form-input" placeholder="Nombre de la vía">
                        </div>
                        <div class="edit-form-group">
                            <label>Grado</label>
                            <input type="text" id="editGrado" class="form-input" placeholder="Ej: 6a+">
                        </div>
                        <div class="edit-form-group">
                            <label>Sector</label>
                            <input type="text" id="editSector" class="form-input" placeholder="Sector">
                        </div>
                        <div class="edit-form-group">
                            <label>Modalidad</label>
                            <select id="editModalidad" class="form-select">
                                <option value="Simple">Simple</option>
                                <option value="Largo">Largo</option>
                                <option value="Boulder">Boulder</option>
                            </select>
                        </div>
                        <div class="edit-form-group">
                            <label>Expresos</label>
                            <input type="number" id="editExp" class="form-input" placeholder="Nº expresos">
                        </div>
                        <div class="edit-form-group">
                            <label>Metros</label>
                            <input type="number" id="editLong" class="form-input" placeholder="Longitud (m)">
                        </div>
                        <div class="edit-form-group full-width">
                            <label>Descripción</label>
                            <textarea id="editDescripcion" class="form-input" rows="3" placeholder="Descripción de la vía..."></textarea>
                        </div>
                    </div>
                </div>

                <div class="edit-form-section">
                    <h4>Ubicación en el Mapa</h4>
                    <p class="edit-hint">Arrastra el marcador verde grande para mover la ubicación. Las otras vías de la escuela se muestran para referencia.</p>
                    <div id="editMapContainer"></div>
                    <div class="edit-map-legend">
                        <span class="legend-item"><span class="legend-dot" style="background: #3b82f6;"></span> Oficiales</span>
                        <span class="legend-item"><span class="legend-dot" style="background: #10b981;"></span> Aprobadas</span>
                        <span class="legend-item"><span class="legend-dot" style="background: #f59e0b;"></span> Pendientes</span>
                    </div>
                    <div class="edit-coords-inputs">
                        <div class="coord-input-group">
                            <label>Latitud</label>
                            <input type="number" id="editLatInput" step="0.000001" placeholder="39.794890" onchange="updateMarkerFromInputs()">
                        </div>
                        <div class="coord-input-group">
                            <label>Longitud</label>
                            <input type="number" id="editLngInput" step="0.000001" placeholder="-2.148689" onchange="updateMarkerFromInputs()">
                        </div>
                        <button type="button" class="btn btn-secondary btn-sm" onclick="updateMarkerFromInputs()">
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                            </svg>
                            Ir
                        </button>
                    </div>
                </div>
            </div>

            <div class="edit-modal-footer">
                <button class="btn btn-secondary" onclick="closeEditModal()">Cancelar</button>
                <button class="btn btn-success" onclick="saveRouteEdits()">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                    </svg>
                    Guardar Cambios
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(editModal);

    editModal.addEventListener('click', (e) => {
        if (e.target === editModal) closeEditModal();
    });
}

function initEditMap() {
    let coords = getRouteCoordinates(editingRouteData);
    if (!coords) coords = [-3.7, 40.4];

    if (editMap) {
        editMap.setCenter(coords);
        editMap.setZoom(17);
        if (editMarker) editMarker.setLngLat(coords);
        updateEditCoordsDisplay(coords);
        // Recargar vías del contexto
        loadOfficialRoutesOnEditMap();
        loadOtherRoutesOnEditMap();
        return;
    }

    editMap = new maplibregl.Map({
        container: 'editMapContainer',
        style: {
            version: 8,
            glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
            sources: {
                'satellite': {
                    type: 'raster',
                    tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
                    tileSize: 256
                }
            },
            layers: [{ id: 'satellite-layer', type: 'raster', source: 'satellite' }]
        },
        center: coords,
        zoom: 17
    });

    editMap.on('load', () => {
        // Cargar vías oficiales y otras vías para contexto
        loadOfficialRoutesOnEditMap();
        loadOtherRoutesOnEditMap();
    });

    editMarker = new maplibregl.Marker({ color: '#10b981', draggable: true })
        .setLngLat(coords)
        .addTo(editMap);

    editMarker.on('dragend', () => {
        const lngLat = editMarker.getLngLat();
        updateEditCoordsDisplay([lngLat.lng, lngLat.lat]);
    });

    updateEditCoordsDisplay(coords);
}

// Configuración de rutas de GeoJSON por escuela (mismo que maplibre-config.js)
const SCHOOL_GEOJSON_PATHS = {
    valeria: 'Cartografia/Valeria/Valeria_Vias.geojson',
    sanmartin: 'Cartografia/San Martin de ValdeIglesias/SM_Vias.geojson',
    mora: 'Cartografia/Mora/Mora_Vias.geojson'
};

/**
 * Carga las vías oficiales desde el archivo GeoJSON de la escuela
 */
async function loadOfficialRoutesOnEditMap() {
    if (!editMap || !editingRouteData) return;

    const schoolId = editingRouteData.schoolId;
    if (!schoolId) return;

    const geojsonPath = SCHOOL_GEOJSON_PATHS[schoolId];
    if (!geojsonPath) {
        console.log(`[EditMap] No hay GeoJSON de vías oficiales para ${schoolId}`);
        return;
    }

    try {
        // Remover source y layers anteriores si existen
        if (editMap.getLayer('official-routes-labels')) editMap.removeLayer('official-routes-labels');
        if (editMap.getLayer('official-routes-layer')) editMap.removeLayer('official-routes-layer');
        if (editMap.getSource('official-routes')) editMap.removeSource('official-routes');

        // Cargar el GeoJSON
        const response = await fetch(geojsonPath);
        if (!response.ok) {
            console.warn(`[EditMap] No se pudo cargar ${geojsonPath}`);
            return;
        }
        const geojson = await response.json();

        // Añadir source
        editMap.addSource('official-routes', {
            type: 'geojson',
            data: geojson
        });

        // Añadir capa de círculos para las vías oficiales (azul)
        editMap.addLayer({
            id: 'official-routes-layer',
            type: 'circle',
            source: 'official-routes',
            paint: {
                'circle-radius': 6,
                'circle-color': '#3b82f6',  // Azul para oficiales
                'circle-stroke-color': '#ffffff',
                'circle-stroke-width': 1.5,
                'circle-opacity': 0.7
            }
        });

        // Añadir etiquetas con nombre y grado
        editMap.addLayer({
            id: 'official-routes-labels',
            type: 'symbol',
            source: 'official-routes',
            layout: {
                'text-field': ['concat', ['get', 'nombre'], ' (', ['get', 'grado1'], ')'],
                'text-font': ['Noto Sans Regular'],
                'text-size': 10,
                'text-offset': [0, 1.2],
                'text-anchor': 'top',
                'text-allow-overlap': false
            },
            paint: {
                'text-color': '#93c5fd',
                'text-halo-color': '#1e3a5f',
                'text-halo-width': 1
            }
        });

        // Añadir popup al hacer click en las vías oficiales
        editMap.on('click', 'official-routes-layer', (e) => {
            if (!e.features || e.features.length === 0) return;
            const props = e.features[0].properties;

            new maplibregl.Popup()
                .setLngLat(e.lngLat)
                .setHTML(`
                    <div style="padding: 8px;">
                        <strong>${props.nombre || 'Sin nombre'}</strong><br>
                        <span style="color: #3b82f6; font-weight: 600;">${props.grado1 || '?'}</span><br>
                        <small>Sector: ${props.sector || '-'}</small><br>
                        <small style="color: #3b82f6;">Vía Oficial</small>
                    </div>
                `)
                .addTo(editMap);
        });

        // Cursor pointer al hover
        editMap.on('mouseenter', 'official-routes-layer', () => {
            editMap.getCanvas().style.cursor = 'pointer';
        });
        editMap.on('mouseleave', 'official-routes-layer', () => {
            editMap.getCanvas().style.cursor = '';
        });

        console.log(`[EditMap] Cargadas ${geojson.features?.length || 0} vías oficiales de ${schoolId}`);

    } catch (error) {
        console.error('[EditMap] Error cargando vías oficiales:', error);
    }
}

/**
 * Carga las otras vías de la misma escuela en el mapa de edición para contexto
 */
async function loadOtherRoutesOnEditMap() {
    if (!editMap || !editingRouteData) return;

    const schoolId = editingRouteData.schoolId;
    if (!schoolId) return;

    try {
        // Obtener todas las vías de la escuela (pendientes y aprobadas)
        const snapshot = await db.collection('pending_routes')
            .where('schoolId', '==', schoolId)
            .get();

        const features = [];
        snapshot.forEach(doc => {
            // Excluir la vía que estamos editando
            if (doc.id === editingRouteId) return;

            const data = doc.data();

            // Solo mostrar vías pendientes y aprobadas (no rechazadas)
            if (data.status === 'rejected') return;

            const coords = getRouteCoordinates(data);
            if (!coords) return;

            features.push({
                type: 'Feature',
                properties: {
                    id: doc.id,
                    nombre: data.nombre || 'Sin nombre',
                    grado: data.grado1 || '?',
                    status: data.status || 'pending',
                    sector: data.sector || ''
                },
                geometry: {
                    type: 'Point',
                    coordinates: coords
                }
            });
        });

        const geojson = {
            type: 'FeatureCollection',
            features: features
        };

        // Remover source y layers anteriores si existen
        if (editMap.getLayer('other-routes-labels')) editMap.removeLayer('other-routes-labels');
        if (editMap.getLayer('other-routes-layer')) editMap.removeLayer('other-routes-layer');
        if (editMap.getSource('other-routes')) editMap.removeSource('other-routes');

        // Añadir source
        editMap.addSource('other-routes', {
            type: 'geojson',
            data: geojson
        });

        // Añadir capa de círculos para las otras vías
        editMap.addLayer({
            id: 'other-routes-layer',
            type: 'circle',
            source: 'other-routes',
            paint: {
                'circle-radius': 8,
                'circle-color': [
                    'case',
                    ['==', ['get', 'status'], 'approved'], '#10b981',  // Verde para aprobadas
                    ['==', ['get', 'status'], 'rejected'], '#ef4444',  // Rojo para rechazadas
                    '#f59e0b'  // Amarillo para pendientes
                ],
                'circle-stroke-color': '#ffffff',
                'circle-stroke-width': 2,
                'circle-opacity': 0.8
            }
        });

        // Añadir etiquetas con nombre y grado
        editMap.addLayer({
            id: 'other-routes-labels',
            type: 'symbol',
            source: 'other-routes',
            layout: {
                'text-field': ['concat', ['get', 'nombre'], ' (', ['get', 'grado'], ')'],
                'text-font': ['Noto Sans Regular'],
                'text-size': 11,
                'text-offset': [0, 1.5],
                'text-anchor': 'top',
                'text-allow-overlap': false
            },
            paint: {
                'text-color': '#ffffff',
                'text-halo-color': '#000000',
                'text-halo-width': 1.5
            }
        });

        // Añadir popup al hacer click en las vías
        editMap.on('click', 'other-routes-layer', (e) => {
            if (!e.features || e.features.length === 0) return;
            const props = e.features[0].properties;
            const statusText = {
                'approved': 'Aprobada',
                'rejected': 'Rechazada',
                'pending': 'Pendiente'
            }[props.status] || 'Pendiente';

            new maplibregl.Popup()
                .setLngLat(e.lngLat)
                .setHTML(`
                    <div style="padding: 8px;">
                        <strong>${props.nombre}</strong><br>
                        <span style="color: #667eea; font-weight: 600;">${props.grado}</span><br>
                        <small>Sector: ${props.sector || '-'}</small><br>
                        <small style="color: ${props.status === 'approved' ? '#10b981' : props.status === 'rejected' ? '#ef4444' : '#f59e0b'};">
                            ${statusText}
                        </small>
                    </div>
                `)
                .addTo(editMap);
        });

        // Cursor pointer al hover
        editMap.on('mouseenter', 'other-routes-layer', () => {
            editMap.getCanvas().style.cursor = 'pointer';
        });
        editMap.on('mouseleave', 'other-routes-layer', () => {
            editMap.getCanvas().style.cursor = '';
        });

        console.log(`[EditMap] Cargadas ${features.length} vías de contexto para ${schoolId}`);

    } catch (error) {
        console.error('[EditMap] Error cargando vías de contexto:', error);
    }
}

function getRouteCoordinates(routeData) {
    if (routeData.coordinates && Array.isArray(routeData.coordinates)) {
        return routeData.coordinates;
    }
    if (routeData.geojsonFeature?.geometry) {
        const geom = routeData.geojsonFeature.geometry;
        if (geom.coordinates) return geom.coordinates;
        if (geom.lng !== undefined && geom.lat !== undefined) return [geom.lng, geom.lat];
    }
    return null;
}

function updateEditCoordsDisplay(coords) {
    document.getElementById('editLatInput').value = coords[1].toFixed(6);
    document.getElementById('editLngInput').value = coords[0].toFixed(6);
}

/**
 * Actualiza el marcador desde los inputs de coordenadas manuales
 */
function updateMarkerFromInputs() {
    const lat = parseFloat(document.getElementById('editLatInput').value);
    const lng = parseFloat(document.getElementById('editLngInput').value);

    if (isNaN(lat) || isNaN(lng)) {
        showToast('Coordenadas inválidas', 'error');
        return;
    }

    // Validar rangos
    if (lat < -90 || lat > 90) {
        showToast('Latitud debe estar entre -90 y 90', 'error');
        return;
    }
    if (lng < -180 || lng > 180) {
        showToast('Longitud debe estar entre -180 y 180', 'error');
        return;
    }

    const coords = [lng, lat];

    if (editMarker) {
        editMarker.setLngLat(coords);
    }
    if (editMap) {
        editMap.flyTo({ center: coords, zoom: 17 });
    }
}

function closeEditModal() {
    if (editModal) editModal.classList.add('hidden');
    editingRouteId = null;
    editingRouteData = null;
}

async function saveRouteEdits() {
    if (!editingRouteId) {
        showToast('Error: No hay vía seleccionada', 'error');
        return;
    }

    try {
        const lngLat = editMarker.getLngLat();
        const newCoords = [lngLat.lng, lngLat.lat];

        const nombre = document.getElementById('editNombre').value.trim();
        const grado1 = document.getElementById('editGrado').value.trim();
        const sector = document.getElementById('editSector').value.trim();
        const exp1 = document.getElementById('editExp').value.trim();
        const long1 = document.getElementById('editLong').value.trim();
        const descripcion = document.getElementById('editDescripcion').value.trim();
        const modalidad = document.getElementById('editModalidad').value;

        if (!nombre) {
            showToast('El nombre es obligatorio', 'error');
            return;
        }

        const updateData = {
            nombre,
            grado1,
            sector,
            exp1,
            long1,
            descripcion,
            modalidad,
            coordinates: newCoords,
            editedAt: firebase.firestore.FieldValue.serverTimestamp(),
            editedBy: currentUser.email,
            'geojsonFeature.properties.nombre': nombre,
            'geojsonFeature.properties.grado1': grado1,
            'geojsonFeature.properties.sector': sector,
            'geojsonFeature.properties.exp1': exp1,
            'geojsonFeature.properties.long1': long1,
            'geojsonFeature.properties.descripcion': descripcion,
            'geojsonFeature.properties.modalidad': modalidad,
            'geojsonFeature.geometry.lng': newCoords[0],
            'geojsonFeature.geometry.lat': newCoords[1]
        };

        await db.collection('pending_routes').doc(editingRouteId).update(updateData);

        showToast('Vía actualizada correctamente', 'success');
        closeEditModal();
        await loadRoutes();

    } catch (error) {
        console.error('Error guardando cambios:', error);
        showToast('Error al guardar los cambios', 'error');
    }
}

// ============================================
// INFORME DE TRAZADOS (SOLO LECTURA)
// ============================================
// Nada de esta sección escribe en Firestore. El botón «Limpiar Dibujos» genera un
// informe y borrar o rechazar una vía solo cuenta sus trazados: no se borra ninguno.
// Un trazado solo se marca «huérfano» si una fuente verificada lo desmiente; ante
// cualquier duda (red, GeoJSON ausente o inválido, consulta fallida, datos
// incompletos) queda «indeterminado».

const KX_DRAWING_SOURCES = {
    'valeria': 'Cartografia/Valeria/Valeria_Vias.geojson',
    'sanmartin': 'Cartografia/San Martin de ValdeIglesias/SM_Vias.geojson',
    'mora': 'Cartografia/Mora/Mora_Vias.geojson'
};

/**
 * Normaliza un nombre para compararlo (sin acentos, mayúsculas ni signos)
 */
function kxNormDrawingName(value) {
    return String(value == null ? '' : value)
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');
}

/**
 * Carga el GeoJSON de vías de una escuela. Nunca lanza.
 * status: 'ok' | 'sin-fuente' | 'no-cargada'
 */
async function kxLoadDrawingSource(schoolId) {
    const path = KX_DRAWING_SOURCES[schoolId];
    if (!path) return { status: 'sin-fuente' };
    try {
        const response = await fetch(path + '?v=' + Date.now());
        if (!response || !response.ok) return { status: 'no-cargada', reason: 'HTTP ' + (response && response.status) };
        const geojson = await response.json();
        if (!geojson || !Array.isArray(geojson.features) || geojson.features.length === 0) {
            return { status: 'no-cargada', reason: 'sin vías' };
        }
        const bySector = Object.create(null);   // sector -> { nombre: true }
        const anySector = Object.create(null);  // nombre -> { sector: true }
        for (const feature of geojson.features) {
            const props = feature && feature.properties;
            if (!props || !props.sector || !props.nombre) continue;
            const sector = kxNormDrawingName(props.sector);
            const name = kxNormDrawingName(props.nombre);
            (bySector[sector] = bySector[sector] || Object.create(null))[name] = true;
            (anySector[name] = anySector[name] || Object.create(null))[sector] = true;
        }
        if (Object.keys(bySector).length === 0) return { status: 'no-cargada', reason: 'sin vías con sector y nombre' };
        return { status: 'ok', bySector, anySector };
    } catch (error) {
        return { status: 'no-cargada', reason: String((error && error.message) || error) };
    }
}

/**
 * Vías aprobadas o pendientes (escuela|sector|nombre). null si no se pudieron leer.
 */
async function kxLoadKnownRoutes() {
    try {
        const keys = Object.create(null);
        for (const status of ['approved', 'pending']) {
            const snapshot = await db.collection('pending_routes').where('status', '==', status).get();
            snapshot.forEach(doc => {
                const d = doc.data();
                keys[kxNormDrawingName(d.schoolId) + '|' + kxNormDrawingName(d.sector) + '|' + kxNormDrawingName(d.nombre)] = true;
            });
        }
        return keys;
    } catch (error) {
        console.warn('[Trazados] No se pudieron leer las vías aprobadas/pendientes:', error);
        return null;
    }
}

/**
 * Clasifica un trazado: { clase: 'seguro' | 'huerfano' | 'indeterminado', motivo }
 * La foto (imageId) no interviene: un trazado sin foto no es huérfano por eso.
 */
function kxClassifyDrawing(drawing, schoolId, sectorName, known, source) {
    const name = kxNormDrawingName(drawing && drawing.routeName);
    if (!name) return { clase: 'indeterminado', motivo: 'trazado-sin-nombre' };
    if (known === null) return { clase: 'indeterminado', motivo: 'vias-aprobadas-no-cargadas' };
    const sector = kxNormDrawingName(sectorName);
    if (!sector) return { clase: 'indeterminado', motivo: 'documento-sin-sector' };
    if (known[kxNormDrawingName(schoolId) + '|' + sector + '|' + name]) return { clase: 'seguro', motivo: 'vía-aprobada-o-pendiente' };
    if (!source || source.status === 'sin-fuente') return { clase: 'indeterminado', motivo: 'escuela-sin-fuente' };
    if (source.status !== 'ok') return { clase: 'indeterminado', motivo: 'fuente-no-cargada' };
    const inSector = source.bySector[sector];
    if (!inSector) return { clase: 'indeterminado', motivo: 'sector-ausente-en-la-fuente' };
    if (inSector[name]) return { clase: 'seguro', motivo: 'geojson' };
    if (source.anySector[name]) return { clase: 'indeterminado', motivo: 'vía-presente-en-otro-sector' };
    return { clase: 'huerfano', motivo: 'no-está-en-aprobadas-ni-en-geojson' };
}

/**
 * Construye el informe de trazados. Solo lee.
 */
async function kxBuildOrphanReport() {
    const known = await kxLoadKnownRoutes();
    const snapshot = await db.collection('sector_route_drawings').get();
    const sources = {};
    const items = [];
    for (const doc of snapshot.docs) {
        const data = doc.data() || {};
        const schoolId = data.schoolId || String(doc.id).split('_')[0];
        if (!(schoolId in sources)) sources[schoolId] = await kxLoadDrawingSource(schoolId);
        for (const drawing of (data.drawings || [])) {
            const result = kxClassifyDrawing(drawing, schoolId, data.sectorName, known, sources[schoolId]);
            items.push({
                docId: doc.id,
                schoolId,
                sectorName: data.sectorName || null,
                routeName: (drawing && drawing.routeName) || null,
                imageId: (drawing && drawing.imageId) || null,
                clase: result.clase,
                motivo: result.motivo
            });
        }
    }
    const totals = { seguro: 0, huerfano: 0, indeterminado: 0 };
    items.forEach(item => { totals[item.clase]++; });
    const fuentes = {};
    Object.keys(sources).forEach(s => {
        fuentes[s] = sources[s].status + (sources[s].reason ? ' (' + sources[s].reason + ')' : '');
    });
    return { generatedAt: new Date().toISOString(), total: items.length, totals, fuentes, vias: known === null ? 'no-cargadas' : 'ok', items };
}

/**
 * Botón «Limpiar Dibujos»: ahora genera un informe y NO borra nada.
 */
async function cleanOrphanedDrawings() {
    showToast('Analizando trazados (solo lectura)...', 'info');
    try {
        const report = await kxBuildOrphanReport();
        console.log('[Trazados] Informe (solo lectura):', report);
        kxShowDrawingsReport(report);
        return report;
    } catch (error) {
        console.error('[Trazados] Error generando el informe:', error);
        showToast('No se pudo generar el informe de trazados. No se ha borrado nada.', 'error');
        return null;
    }
}

/**
 * Muestra el informe en un modal propio (estilos en línea: sirve en admin.html y admin-routes.html)
 */
function kxShowDrawingsReport(report) {
    document.getElementById('kx-drawings-report')?.remove();
    const t = report.totals;
    const motivos = {};
    report.items.forEach(item => {
        const key = item.clase + '|' + item.motivo;
        motivos[key] = (motivos[key] || 0) + 1;
    });
    const rows = (clase) => report.items.filter(i => i.clase === clase).map(i => `
        <tr><td>${escapeHtml(i.schoolId)}</td><td>${escapeHtml(i.sectorName || i.docId)}</td>
        <td>${escapeHtml(i.routeName || '(sin nombre)')}</td><td>${escapeHtml(i.motivo)}</td></tr>`).join('');
    const table = (clase) => `
        <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px;overflow-wrap:normal;white-space:nowrap">
        <thead><tr style="text-align:left;color:#6b7280"><th>Escuela</th><th>Sector</th><th>Vía</th><th>Motivo</th></tr></thead>
        <tbody>${rows(clase)}</tbody></table></div>`;

    const overlay = document.createElement('div');
    overlay.id = 'kx-drawings-report';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:10001;display:flex;align-items:center;justify-content:center;padding:16px';
    overlay.innerHTML = `
        <div role="dialog" aria-label="Informe de trazados" style="background:#fff;color:#111827;border-radius:14px;width:100%;min-width:0;max-width:760px;max-height:90vh;overflow-y:auto;box-sizing:border-box;overflow-wrap:anywhere;padding:20px 18px;box-shadow:0 25px 50px rgba(0,0,0,0.25)">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:12px">
                <h3 style="margin:0;font-size:18px">Informe de trazados</h3>
                <button type="button" data-kx-close style="border:none;background:#f3f4f6;border-radius:8px;min-width:44px;min-height:44px;font-size:20px;cursor:pointer" aria-label="Cerrar">×</button>
            </div>
            <p style="margin:10px 0;padding:10px 12px;background:#ecfdf5;color:#065f46;border-radius:8px;font-size:13px">
                Solo lectura: no se ha borrado ni modificado ningún trazado.</p>
            <p style="margin:6px 0;font-size:14px"><strong>${report.total}</strong> trazados ·
                <strong>${t.seguro}</strong> seguros · <strong>${t.huerfano}</strong> posibles huérfanos ·
                <strong>${t.indeterminado}</strong> indeterminados</p>
            <p style="margin:6px 0;font-size:12px;color:#6b7280">Fuentes GeoJSON: ${escapeHtml(Object.entries(report.fuentes).map(([k, v]) => k + ': ' + v).join(' · ') || 'ninguna')}
                · Vías aprobadas/pendientes: ${escapeHtml(report.vias)}</p>
            <p style="margin:6px 0;font-size:12px;color:#6b7280">${escapeHtml(Object.entries(motivos).map(([k, v]) => k.replace('|', ': ') + ' (' + v + ')').join(' · '))}</p>
            ${t.huerfano ? `<h4 style="margin:18px 0 8px;font-size:14px">Posibles huérfanos (revisar a mano) (${t.huerfano})</h4>${table('huerfano')}` : ''}
            ${t.indeterminado ? `<details style="margin-top:18px"><summary style="cursor:pointer;font-weight:600;font-size:14px;min-height:44px;display:flex;align-items:center">Indeterminados: no se pueden comprobar (${t.indeterminado})</summary>${table('indeterminado')}</details>` : ''}
            <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
                <button type="button" data-kx-copy style="border:1px solid #d1d5db;background:#fff;border-radius:8px;min-height:44px;padding:0 14px;cursor:pointer">Copiar informe (JSON)</button>
                <button type="button" data-kx-close style="border:none;background:#111827;color:#fff;border-radius:8px;min-height:44px;padding:0 16px;cursor:pointer">Cerrar</button>
            </div>
        </div>`;
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay || e.target.closest('[data-kx-close]')) overlay.remove();
        if (e.target.closest('[data-kx-copy]')) {
            Promise.resolve()
                .then(() => navigator.clipboard.writeText(JSON.stringify(report, null, 2)))
                .then(() => showToast('Informe copiado', 'success'))
                .catch(() => showToast('No se pudo copiar el informe', 'error'));
        }
    });
    document.body.appendChild(overlay);
}

/**
 * Trazados de una vía que se rechaza o elimina. Solo informa: no borra ni modifica nada.
 * Cuenta por nombre exacto dentro del documento de ese sector. Devuelve null si no se pudo leer.
 */
async function kxCountRouteDrawings(schoolId, sectorName, routeName) {
    try {
        const docId = `${schoolId}_${normalizeSectorNameForDrawing(sectorName)}`;
        const doc = await db.collection('sector_route_drawings').doc(docId).get();
        if (!doc.exists) return 0;
        const count = (doc.data().drawings || []).filter(d => d.routeName === routeName).length;
        if (count) console.log(`[Trazados] "${routeName}" tiene ${count} trazado(s) en ${docId}. Se conservan.`);
        return count;
    } catch (error) {
        console.warn('[Trazados] No se pudieron contar los trazados de la vía:', error);
        return null;
    }
}

/**
 * Normaliza el nombre del sector para usarlo como ID de documento
 */
function normalizeSectorNameForDrawing(name) {
    return name
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '') // Quitar acentos
        .replace(/[^a-z0-9]/g, '_')      // Reemplazar caracteres especiales
        .replace(/_+/g, '_')              // Evitar guiones múltiples
        .replace(/^_|_$/g, '');           // Quitar guiones al inicio/final
}

// El botón conserva su texto; el tooltip ya no promete un borrado
document.querySelectorAll('[onclick="cleanOrphanedDrawings()"]').forEach(btn => {
    btn.title = 'Informe de trazados huérfanos (solo lectura, no borra nada)';
});

// ============================================
// SPOTTER MANAGEMENT
// ============================================

let spotterRequests = [];
let approvedSpotters = [];

// Load spotter requests
async function loadSpotterRequests() {
    const requestsList = document.getElementById('spotterRequestsList');
    const pendingCount = document.getElementById('pendingSpottersCount');
    const navBadge = document.getElementById('spottersBadge');
    const usersBadge = document.getElementById('usersBadge');

    if (!requestsList) return;

    requestsList.innerHTML = `
        <div class="loading">
            <div class="spinner"></div>
            <p>Cargando solicitudes...</p>
        </div>
    `;

    try {
        // Consulta sin orderBy para evitar necesidad de índice compuesto
        const snapshot = await db.collection('spotter_requests')
            .where('status', '==', 'pending')
            .get();

        spotterRequests = [];
        snapshot.forEach(doc => {
            spotterRequests.push({ id: doc.id, ...doc.data() });
        });

        // Ordenar en el cliente por fecha de creación (más recientes primero)
        spotterRequests.sort((a, b) => {
            const dateA = a.createdAt?.toDate?.() || new Date(0);
            const dateB = b.createdAt?.toDate?.() || new Date(0);
            return dateB - dateA;
        });

        // Update pending count
        if (pendingCount) {
            pendingCount.textContent = `${spotterRequests.length} pendiente${spotterRequests.length !== 1 ? 's' : ''}`;
        }

        // Update nav badge for Spotters
        if (navBadge) {
            if (spotterRequests.length > 0) {
                navBadge.style.display = 'inline';
                navBadge.textContent = spotterRequests.length;
            } else {
                navBadge.style.display = 'none';
            }
        }

        // Update nav badge for Users (same count)
        if (usersBadge) {
            if (spotterRequests.length > 0) {
                usersBadge.style.display = 'inline';
                usersBadge.textContent = spotterRequests.length;
            } else {
                usersBadge.style.display = 'none';
            }
        }

        renderSpotterRequests();
    } catch (error) {
        console.error('Error loading spotter requests:', error);
        requestsList.innerHTML = `
            <div class="empty-spotters">
                <p>Error al cargar las solicitudes</p>
            </div>
        `;
    }
}

// Render spotter request cards
function renderSpotterRequests() {
    const requestsList = document.getElementById('spotterRequestsList');
    if (!requestsList) return;

    if (spotterRequests.length === 0) {
        requestsList.innerHTML = `
            <div class="empty-spotters">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p>No hay solicitudes pendientes</p>
            </div>
        `;
        return;
    }

    requestsList.innerHTML = spotterRequests.map(request => createSpotterRequestCard(request)).join('');
}

// Create spotter request card HTML
function createSpotterRequestCard(request) {
    const createdAt = request.createdAt ? new Date(request.createdAt.toDate()).toLocaleDateString('es-ES', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    }) : 'Fecha desconocida';

    const avatarUrl = request.userPhotoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(request.firstname + '+' + request.lastname)}&background=fbbf24&color=1f2937&size=56`;
    const fullName = `${escapeHtml(request.firstname)} ${escapeHtml(request.lastname)}`;

    return `
        <div class="spotter-request-card" data-request-id="${request.id}">
            <div class="spotter-request-header">
                <img src="${avatarUrl}" alt="${fullName}" class="spotter-avatar" onerror="this.src='https://ui-avatars.com/api/?name=U&background=fbbf24&color=1f2937&size=56'">
                <div class="spotter-info">
                    <div class="spotter-name">${fullName}</div>
                    <div class="spotter-email">${escapeHtml(request.email)}</div>
                    <div class="spotter-date">Solicitado: ${createdAt}</div>
                </div>
            </div>
            ${request.message ? `
                <div class="spotter-message-section">
                    <div class="spotter-message-label">Motivación</div>
                    <div class="spotter-message-text">${escapeHtml(request.message)}</div>
                </div>
            ` : ''}
            <div class="spotter-actions">
                <button class="btn btn-danger btn-sm" onclick="rejectSpotterRequest('${request.id}')">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                    Rechazar
                </button>
                <button class="btn btn-success btn-sm" onclick="approveSpotterRequest('${request.id}')">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                    </svg>
                    Aprobar
                </button>
            </div>
        </div>
    `;
}

// Approve spotter request
async function approveSpotterRequest(requestId) {
    if (!confirm('¿Aprobar esta solicitud de Spotter?')) return;

    try {
        const requestDoc = await db.collection('spotter_requests').doc(requestId).get();
        if (!requestDoc.exists) {
            showToast('Solicitud no encontrada', 'error');
            return;
        }

        const requestData = requestDoc.data();

        // Add user to admins collection with spotter role
        await db.collection('admins').doc(requestData.userId).set({
            email: requestData.email,
            role: 'spotter',
            name: `${requestData.firstname} ${requestData.lastname}`,
            addedBy: currentUser.uid,
            addedAt: firebase.firestore.FieldValue.serverTimestamp(),
            approvedFromRequest: requestId
        });

        // Update request status
        await db.collection('spotter_requests').doc(requestId).update({
            status: 'approved',
            approvedAt: firebase.firestore.FieldValue.serverTimestamp(),
            approvedBy: currentUser.uid
        });

        showToast('Spotter aprobado correctamente', 'success');
        loadSpotterRequests();
        loadApprovedSpotters();
        loadSpotterRequestsInUsersSection();
        loadUsers();
        loadStats();

    } catch (error) {
        console.error('Error approving spotter:', error);
        showToast('Error al aprobar el spotter', 'error');
    }
}

// Reject spotter request
async function rejectSpotterRequest(requestId) {
    const reason = prompt('Motivo del rechazo (opcional):');

    try {
        await db.collection('spotter_requests').doc(requestId).update({
            status: 'rejected',
            rejectedAt: firebase.firestore.FieldValue.serverTimestamp(),
            rejectedBy: currentUser.uid,
            rejectionReason: reason || ''
        });

        showToast('Solicitud rechazada', 'info');
        loadSpotterRequests();
        loadSpotterRequestsInUsersSection();

    } catch (error) {
        console.error('Error rejecting spotter:', error);
        showToast('Error al rechazar la solicitud', 'error');
    }
}

// Load approved spotters
async function loadApprovedSpotters() {
    const spottersList = document.getElementById('approvedSpottersList');
    if (!spottersList) return;

    spottersList.innerHTML = '<tr><td colspan="4" class="loading">Cargando spotters...</td></tr>';

    try {
        const snapshot = await db.collection('admins')
            .where('role', '==', 'spotter')
            .get();

        approvedSpotters = [];
        snapshot.forEach(doc => {
            approvedSpotters.push({ id: doc.id, ...doc.data() });
        });

        renderApprovedSpotters();

    } catch (error) {
        console.error('Error loading approved spotters:', error);
        spottersList.innerHTML = '<tr><td colspan="4">Error al cargar los spotters</td></tr>';
    }
}

// Render approved spotters table
function renderApprovedSpotters() {
    const spottersList = document.getElementById('approvedSpottersList');
    if (!spottersList) return;

    if (approvedSpotters.length === 0) {
        spottersList.innerHTML = '<tr><td colspan="4" style="text-align: center; color: #6b7280;">No hay spotters aprobados</td></tr>';
        return;
    }

    spottersList.innerHTML = approvedSpotters.map(spotter => {
        const addedAt = spotter.addedAt ? new Date(spotter.addedAt.toDate()).toLocaleDateString('es-ES', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        }) : 'Desconocido';

        return `
            <tr>
                <td>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <span class="badge badge-spotter">Spotter</span>
                        ${escapeHtml(spotter.name || 'Sin nombre')}
                    </div>
                </td>
                <td>${escapeHtml(spotter.email || '-')}</td>
                <td>${addedAt}</td>
                <td>
                    <button class="btn btn-danger btn-sm" onclick="revokeSpotterRole('${spotter.id}', '${escapeHtml(spotter.email)}')">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                        Revocar
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

// Revoke spotter role
async function revokeSpotterRole(userId, email) {
    if (!confirm(`¿Revocar el rol de Spotter a ${email}?`)) return;

    try {
        await db.collection('admins').doc(userId).delete();

        // Also update the request status if exists
        const requestDoc = await db.collection('spotter_requests').doc(userId).get();
        if (requestDoc.exists) {
            await db.collection('spotter_requests').doc(userId).update({
                status: 'revoked',
                revokedAt: firebase.firestore.FieldValue.serverTimestamp(),
                revokedBy: currentUser.uid
            });
        }

        showToast('Rol de Spotter revocado', 'success');
        loadApprovedSpotters();
        loadUsers();
        loadStats();

    } catch (error) {
        console.error('Error revoking spotter role:', error);
        showToast('Error al revocar el rol', 'error');
    }
}

/**
 * Carga las solicitudes de spotter pendientes en la sección de Usuarios
 */
async function loadSpotterRequestsInUsersSection() {
    const requestsList = document.getElementById('usersSpotterRequestsList');
    const pendingCount = document.getElementById('usersSpotterCount');
    const card = document.getElementById('usersSpotterRequestsCard');
    const navBadge = document.getElementById('spottersBadge');
    const usersBadge = document.getElementById('usersBadge');

    if (!requestsList || !card) return;

    requestsList.innerHTML = `
        <div class="loading">
            <div class="spinner"></div>
            <p>Cargando solicitudes...</p>
        </div>
    `;

    try {
        // Consulta sin orderBy para evitar necesidad de índice compuesto
        const snapshot = await db.collection('spotter_requests')
            .where('status', '==', 'pending')
            .get();

        const requests = [];
        snapshot.forEach(doc => {
            requests.push({ id: doc.id, ...doc.data() });
        });

        // Ordenar en el cliente por fecha de creación (más recientes primero)
        requests.sort((a, b) => {
            const dateA = a.createdAt?.toDate?.() || new Date(0);
            const dateB = b.createdAt?.toDate?.() || new Date(0);
            return dateB - dateA;
        });

        // Update pending count badge
        if (pendingCount) {
            pendingCount.textContent = `${requests.length} pendiente${requests.length !== 1 ? 's' : ''}`;
        }

        // Update nav badges
        [navBadge, usersBadge].forEach(badge => {
            if (badge) {
                if (requests.length > 0) {
                    badge.style.display = 'inline';
                    badge.textContent = requests.length;
                } else {
                    badge.style.display = 'none';
                }
            }
        });

        // Show requests or empty state
        if (requests.length > 0) {
            requestsList.innerHTML = requests.map(request => createSpotterRequestCard(request)).join('');
        } else {
            requestsList.innerHTML = `
                <div class="empty-spotters">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <p>No hay solicitudes de Spotter pendientes</p>
                </div>
            `;
        }

    } catch (error) {
        console.error('Error loading spotter requests in users section:', error);
        requestsList.innerHTML = `
            <div class="empty-spotters">
                <p>Error al cargar las solicitudes</p>
            </div>
        `;
    }
}

// Load spotters on initial load if on dashboard
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        loadSpotterRequests(); // Load to update badge count
        loadSuggestionsBadge(); // Load suggestions badge count
    }, 1000);
});

// ============================================
// GESTIÓN DE SUGERENCIAS DE USUARIOS
// ============================================

let allSuggestions = [];

/**
 * Carga el contador de sugerencias pendientes para el badge
 */
async function loadSuggestionsBadge() {
    try {
        const snapshot = await db.collection('routeSuggestions')
            .where('status', '==', 'pending')
            .get();

        const count = snapshot.size;
        const badge = document.getElementById('suggestionsBadge');

        if (count > 0) {
            badge.textContent = count;
            badge.style.display = 'inline';
        } else {
            badge.style.display = 'none';
        }
    } catch (error) {
        console.error('Error loading suggestions badge:', error);
    }
}

/**
 * Carga las sugerencias según los filtros.
 *
 * NOTA: Los documentos en routeSuggestions se guardan con esta estructura:
 *   { routeName, schoolId, userId, userEmail, status, timestamp, data: { descripcion?, exp1?, long1? } }
 * El campo de fecha es "timestamp" (no "createdAt") y los valores sugeridos están
 * dentro del objeto "data" (no en campos "field"/"suggestedValue" a nivel raíz).
 *
 * Para evitar problemas de índices compuestos en Firestore, solo aplicamos
 * el filtro de estado en la query y filtramos el campo en el cliente.
 */
async function loadSuggestions() {
    const container = document.getElementById('suggestionsList');
    container.innerHTML = `
        <div class="loading">
            <div class="spinner"></div>
            <p>Cargando sugerencias...</p>
        </div>
    `;

    try {
        const statusFilter = document.getElementById('filterSuggestionStatus').value;
        const fieldFilter = document.getElementById('filterSuggestionField').value;

        let query = db.collection('routeSuggestions');

        // Aplicar filtro de estado en Firestore
        if (statusFilter !== 'all') {
            query = query.where('status', '==', statusFilter);
        }

        // Ordenar por fecha — el campo real es "timestamp"
        query = query.orderBy('timestamp', 'desc');

        const snapshot = await query.get();
        allSuggestions = [];

        snapshot.forEach(doc => {
            const raw = doc.data();

            // Problemas notificados desde la ficha de la vía: una sola tarjeta
            if (raw.kind === 'report') {
                allSuggestions.push({ id: doc.id, ...raw, createdAt: raw.timestamp || null, field: 'report' });
                return;
            }

            // Normalizar: expandir el objeto "data" a pares campo/valor individuales
            // para que renderSuggestions pueda iterar sobre cada campo sugerido
            const dataFields = raw.data || {};
            const fieldKeys = Object.keys(dataFields);

            // Si no hay campos dentro de data, incluir el doc tal cual
            // (por si en el futuro se guardan con estructura plana)
            if (fieldKeys.length === 0) {
                // Formato plano (field + suggestedValue a nivel raíz) — compatibilidad
                allSuggestions.push({ id: doc.id, ...raw });
            } else {
                // Formato anidado: crear una entrada por cada campo sugerido
                fieldKeys.forEach(fieldKey => {
                    allSuggestions.push({
                        id: doc.id,
                        routeName: raw.routeName,
                        routeId: raw.routeId,
                        schoolId: raw.schoolId,
                        userId: raw.userId,
                        userEmail: raw.userEmail,
                        status: raw.status,
                        createdAt: raw.timestamp || raw.createdAt || null,
                        field: fieldKey,
                        suggestedValue: String(dataFields[fieldKey])
                    });
                });
            }
        });

        // Filtrar por campo en el cliente (evita índice compuesto en Firestore)
        if (fieldFilter !== 'all') {
            allSuggestions = allSuggestions.filter(s => s.field === fieldFilter);
        }

        renderSuggestions(allSuggestions);

        // Actualizar badge
        loadSuggestionsBadge();

    } catch (error) {
        console.error('Error loading suggestions:', error);
        container.innerHTML = `
            <div class="empty-suggestions">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <p>Error al cargar las sugerencias</p>
            </div>
        `;
    }
}

/**
 * Renderiza las tarjetas de sugerencias
 */
function renderSuggestions(suggestions) {
    const container = document.getElementById('suggestionsList');

    if (suggestions.length === 0) {
        container.innerHTML = `
            <div class="empty-suggestions">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p>No hay sugerencias que mostrar</p>
            </div>
        `;
        return;
    }

    const fieldLabels = {
        descripcion: 'Tipo de escalada',
        exp1: 'Número de express',
        long1: 'Metros de la vía'
    };

    const fieldUnits = {
        descripcion: '',
        exp1: ' express',
        long1: ' metros'
    };

    container.innerHTML = suggestions.map((suggestion, idx) => {
        if (suggestion.kind === 'report') return renderReportCard(suggestion);

        // Usar un ID único por entrada (docId + campo) para evitar colisiones
        const uniqueKey = suggestion.field ? `${suggestion.id}_${suggestion.field}` : `${suggestion.id}_${idx}`;

        const date = suggestion.createdAt?.toDate?.() ?
            suggestion.createdAt.toDate().toLocaleDateString('es-ES', {
                day: '2-digit',
                month: 'short',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            }) : 'Fecha desconocida';

        const userInitial = suggestion.userEmail ?
            suggestion.userEmail.charAt(0).toUpperCase() : '?';

        const fieldLabel = fieldLabels[suggestion.field] || suggestion.field || 'Desconocido';
        const fieldUnit = fieldUnits[suggestion.field] || '';

        const isPending = suggestion.status === 'pending';

        return `
            <div class="suggestion-card ${suggestion.status}" data-id="${suggestion.id}" data-field="${suggestion.field || ''}">
                <div class="suggestion-header">
                    <div class="suggestion-route-info">
                        <div class="suggestion-route-name">${escapeHtml(suggestion.routeName)}</div>
                        <div class="suggestion-school">${escapeHtml(suggestion.schoolId || 'Escuela desconocida')}</div>
                    </div>
                    <span class="suggestion-field-badge ${suggestion.field || ''}">${fieldLabel}</span>
                </div>

                <div class="suggestion-content">
                    <div class="suggestion-value-label">Valor sugerido</div>
                    <div class="suggestion-value" id="value-${uniqueKey}">
                        ${escapeHtml(suggestion.suggestedValue || '')}${fieldUnit}
                    </div>
                    ${isPending ? `
                        <input type="${suggestion.field === 'descripcion' ? 'text' : 'number'}"
                               class="suggestion-edit-input"
                               id="input-${uniqueKey}"
                               value="${escapeHtml(suggestion.suggestedValue || '')}"
                               placeholder="Editar valor antes de aprobar...">
                    ` : ''}
                </div>

                <div class="suggestion-meta">
                    <div class="suggestion-user">
                        <div class="suggestion-user-avatar">${userInitial}</div>
                        <span>${escapeHtml(suggestion.userEmail || 'Usuario anónimo')}</span>
                    </div>
                    <span>${date}</span>
                </div>

                ${isPending ? `
                    <div class="suggestion-actions">
                        <button class="btn btn-success btn-sm" onclick="approveSuggestion('${suggestion.id}', '${suggestion.field || ''}')">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                            </svg>
                            Aprobar
                        </button>
                        <button class="btn btn-danger btn-sm" onclick="rejectSuggestion('${suggestion.id}')">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                            Rechazar
                        </button>
                        <button class="btn btn-secondary btn-sm" onclick="deleteSuggestion('${suggestion.id}')">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                            Eliminar
                        </button>
                    </div>
                ` : `
                    <div class="suggestion-actions">
                        <span class="badge badge-${suggestion.status}">
                            ${suggestion.status === 'approved' ? 'Aprobada' : 'Rechazada'}
                        </span>
                    </div>
                `}
            </div>
        `;
    }).join('');
}

const REPORT_ISSUE_LABELS = {
    grado: 'Grado incorrecto',
    nombre: 'Nombre incorrecto',
    datos: 'Express, metros o tipo',
    ubicacion: 'Ubicación en el mapa',
    seguridad: 'Chapas o roca en mal estado',
    otro: 'Otro'
};

/**
 * Tarjeta de un problema notificado por un usuario (kind: 'report')
 */
function renderReportCard(report) {
    const date = report.createdAt?.toDate?.() ?
        report.createdAt.toDate().toLocaleDateString('es-ES', {
            day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
        }) : 'Fecha desconocida';
    const userInitial = report.userEmail ? report.userEmail.charAt(0).toUpperCase() : '?';
    const isPending = report.status === 'pending';
    const issues = (report.issues || []).map(i =>
        `<span class="suggestion-field-badge report">${escapeHtml(REPORT_ISSUE_LABELS[i] || i)}</span>`).join(' ');
    const proposed = report.proposed || {};
    const changes = [
        proposed.grado1 ? `<div><strong>Grado:</strong> ${escapeHtml(report.grade || '?')} → ${escapeHtml(proposed.grado1)}</div>` : '',
        proposed.nombre ? `<div><strong>Nombre:</strong> ${escapeHtml(report.routeName || '')} → ${escapeHtml(proposed.nombre)}</div>` : ''
    ].join('');

    return `
        <div class="suggestion-card ${report.status}" data-id="${report.id}" data-field="report">
            <div class="suggestion-header">
                <div class="suggestion-route-info">
                    <div class="suggestion-route-name">${escapeHtml(report.routeName)} <small>(${escapeHtml(report.grade || '?')})</small></div>
                    <div class="suggestion-school">${escapeHtml([report.schoolId, report.sector].filter(Boolean).join(' · ') || 'Escuela desconocida')} · id ${escapeHtml(String(report.routeId ?? '?'))}</div>
                </div>
                <span class="suggestion-field-badge report">Problema</span>
            </div>

            <div class="suggestion-content">
                <div style="display:flex; flex-wrap:wrap; gap:6px; margin-bottom:8px;">${issues}</div>
                ${changes ? `<div class="suggestion-value">${changes}</div>` : ''}
                ${report.message ? `<div class="suggestion-value" style="white-space:pre-wrap;">${escapeHtml(report.message)}</div>` : ''}
            </div>

            <div class="suggestion-meta">
                <div class="suggestion-user">
                    <div class="suggestion-user-avatar">${userInitial}</div>
                    <span>${escapeHtml(report.userEmail || 'Usuario anónimo')}</span>
                </div>
                <span>${date}</span>
            </div>

            ${isPending ? `
                <div class="suggestion-actions">
                    <button class="btn btn-success btn-sm" onclick="resolveReport('${report.id}')">Marcar resuelto</button>
                    <button class="btn btn-danger btn-sm" onclick="rejectSuggestion('${report.id}')">Descartar</button>
                    <button class="btn btn-secondary btn-sm" onclick="deleteSuggestion('${report.id}')">Eliminar</button>
                </div>
            ` : `
                <div class="suggestion-actions">
                    <span class="badge badge-${report.status}">${report.status === 'approved' ? 'Resuelto' : 'Descartado'}</span>
                </div>
            `}
        </div>
    `;
}

/**
 * Marca un problema notificado como resuelto. No cambia la vía: la corrección se hace a mano en los datos.
 */
async function resolveReport(reportId) {
    const report = allSuggestions.find(s => s.id === reportId);
    if (!report) return;
    if (!confirm(`¿Marcar como resuelto?\n\nVía: ${report.routeName}\n\nRecuerda corregir los datos de la vía si hace falta.`)) {
        return;
    }
    try {
        await db.collection('routeSuggestions').doc(reportId).update({
            status: 'approved',
            resolvedAt: firebase.firestore.FieldValue.serverTimestamp(),
            resolvedBy: currentUser.email
        });
        showToast('Problema marcado como resuelto', 'success');
        loadSuggestions();
    } catch (error) {
        console.error('Error resolving report:', error);
        showToast('Error al marcar como resuelto', 'error');
    }
}

/**
 * Aprueba una sugerencia y actualiza la vía en los datos
 */
async function approveSuggestion(suggestionId, fieldName) {
    // Buscar la sugerencia por docId + campo (para docs con múltiples campos)
    const suggestion = allSuggestions.find(s => s.id === suggestionId && (!fieldName || s.field === fieldName));
    if (!suggestion) return;

    // Obtener el valor editado — el input usa el uniqueKey (docId_field)
    const uniqueKey = fieldName ? `${suggestionId}_${fieldName}` : suggestionId;
    const inputEl = document.getElementById(`input-${uniqueKey}`);
    const finalValue = inputEl ? inputEl.value.trim() : suggestion.suggestedValue;

    if (!finalValue) {
        showToast('El valor no puede estar vacío', 'error');
        return;
    }

    if (!confirm(`¿Aprobar esta sugerencia?\n\nVía: ${suggestion.routeName}\nCampo: ${suggestion.field}\nValor: ${finalValue}`)) {
        return;
    }

    try {
        // 1. El dato va a la vía: si es una vía de la comunidad (pending_routes) se actualiza allí; si es una vía del mapa
        //    de KRUX, a route_datos con su historial. Solo después se marca la sugerencia como aprobada.
        const routeQuery = await db.collection('pending_routes')
            .where('nombre', '==', suggestion.routeName)
            .where('schoolId', '==', suggestion.schoolId)
            .get();

        if (!routeQuery.empty) {
            const routeDoc = routeQuery.docs[0];
            const updateData = {};
            updateData[suggestion.field] = finalValue;

            await db.collection('pending_routes').doc(routeDoc.id).update(updateData);
            console.log(`Vía "${suggestion.routeName}" actualizada con ${suggestion.field}=${finalValue}`);
        } else {
            const result = await kxRouteDataApproveSuggestion(suggestion, finalValue, 'admin');
            if (!result.ok) {
                showToast(result.error, 'error');
                return;
            }
        }

        // 2. Actualizar el estado de la sugerencia
        await db.collection('routeSuggestions').doc(suggestionId).update({
            status: 'approved',
            approvedValue: finalValue,
            approvedAt: firebase.firestore.FieldValue.serverTimestamp(),
            approvedBy: currentUser.email
        });

        showToast('Sugerencia aprobada y vía actualizada', 'success');
        loadSuggestions();

    } catch (error) {
        console.error('Error approving suggestion:', error);
        showToast('Error al aprobar la sugerencia', 'error');
    }
}

/**
 * Rechaza una sugerencia
 */
async function rejectSuggestion(suggestionId) {
    const suggestion = allSuggestions.find(s => s.id === suggestionId);
    if (!suggestion) return;

    const detail = suggestion.kind === 'report' ? 'Problema notificado' : `Valor: ${suggestion.suggestedValue}`;
    if (!confirm(`¿Rechazar esta sugerencia?\n\nVía: ${suggestion.routeName}\n${detail}`)) {
        return;
    }

    try {
        await db.collection('routeSuggestions').doc(suggestionId).update({
            status: 'rejected',
            rejectedAt: firebase.firestore.FieldValue.serverTimestamp(),
            rejectedBy: currentUser.email
        });

        showToast('Sugerencia rechazada', 'info');
        loadSuggestions();

    } catch (error) {
        console.error('Error rejecting suggestion:', error);
        showToast('Error al rechazar la sugerencia', 'error');
    }
}

/**
 * Elimina una sugerencia
 */
async function deleteSuggestion(suggestionId) {
    if (!confirm('¿Eliminar esta sugerencia permanentemente?')) {
        return;
    }

    try {
        await db.collection('routeSuggestions').doc(suggestionId).delete();
        showToast('Sugerencia eliminada', 'info');
        loadSuggestions();

    } catch (error) {
        console.error('Error deleting suggestion:', error);
        showToast('Error al eliminar la sugerencia', 'error');
    }
}

/**
 * Escapa HTML para prevenir XSS
 */
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ============================================
// GESTIÓN DE ESCUELAS PENDIENTES
// ============================================

async function loadPendingSchools() {
    const listEl = document.getElementById('schoolsList');
    listEl.innerHTML = '<div class="loading"><div class="spinner"></div><p>Cargando escuelas...</p></div>';

    try {
        const filterStatus = document.getElementById('filterSchoolStatus').value;
        let query = db.collection('pending_schools');
        if (filterStatus !== 'all') query = query.where('status', '==', filterStatus);

        const snapshot = await query.get();
        let items = [];
        snapshot.forEach(doc => items.push({ id: doc.id, ...doc.data() }));
        items.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));

        if (items.length === 0) {
            listEl.innerHTML = `
                <div class="empty-state">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <p>No hay escuelas que mostrar</p>
                </div>`;
            return;
        }

        listEl.innerHTML = items.map(item => {
            const createdAt = item.createdAt ? new Date(item.createdAt.toDate()).toLocaleDateString('es-ES', {
                year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
            }) : 'Fecha desconocida';
            const statusClass = item.status || 'pending';
            const statusText = { 'pending': 'Pendiente', 'approved': 'Aprobada', 'rejected': 'Rechazada' }[statusClass] || 'Pendiente';
            const badgeClass = { 'pending': 'badge-pending', 'approved': 'badge-approved', 'rejected': 'badge-rejected' }[statusClass];
            const showActions = item.status === 'pending';
            const coords = item.coordinates ? `[${item.coordinates[1]?.toFixed(5)}, ${item.coordinates[0]?.toFixed(5)}]` : 'Sin coordenadas';

            return `
                <div class="route-card ${statusClass}">
                    <div class="route-header">
                        <div>
                            <div class="route-name">${escapeHtml(item.nombre || 'Sin nombre')}</div>
                            <span class="badge ${badgeClass}">${statusText}</span>
                        </div>
                    </div>
                    <div class="route-details">
                        <div>
                            <div class="route-detail-label">Descripcion</div>
                            <div class="route-detail-value">${escapeHtml(item.descripcion || '-')}</div>
                        </div>
                        <div>
                            <div class="route-detail-label">Coordenadas</div>
                            <div class="route-detail-value">${coords}</div>
                        </div>
                    </div>
                    <div class="route-meta">
                        <span>Enviada por: ${escapeHtml(item.createdByEmail || 'Desconocido')}</span>
                        <span>${createdAt}</span>
                    </div>
                    ${showActions ? `
                    <div class="route-actions">
                        <button class="btn btn-success btn-sm" onclick="approveItem('pending_schools', '${item.id}', loadPendingSchools)">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                            </svg>
                            Aprobar
                        </button>
                        <button class="btn btn-danger btn-sm" onclick="rejectItem('pending_schools', '${item.id}', loadPendingSchools)">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                            Rechazar
                        </button>
                    </div>
                    ` : ''}
                </div>`;
        }).join('');
    } catch (error) {
        console.error('Error loading pending schools:', error);
        listEl.innerHTML = '<div class="empty-state"><p>Error al cargar escuelas</p></div>';
    }
}

// ============================================
// GESTIÓN DE SECTORES PENDIENTES
// ============================================

async function loadPendingSectors() {
    const listEl = document.getElementById('sectorsList');
    listEl.innerHTML = '<div class="loading"><div class="spinner"></div><p>Cargando sectores...</p></div>';

    try {
        const filterStatus = document.getElementById('filterSectorStatus').value;
        let query = db.collection('pending_sectors');
        if (filterStatus !== 'all') query = query.where('status', '==', filterStatus);

        const snapshot = await query.get();
        let items = [];
        snapshot.forEach(doc => items.push({ id: doc.id, ...doc.data() }));
        items.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));

        if (items.length === 0) {
            listEl.innerHTML = `
                <div class="empty-state">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <p>No hay sectores que mostrar</p>
                </div>`;
            return;
        }

        listEl.innerHTML = items.map(item => {
            const createdAt = item.createdAt ? new Date(item.createdAt.toDate()).toLocaleDateString('es-ES', {
                year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
            }) : 'Fecha desconocida';
            const statusClass = item.status || 'pending';
            const statusText = { 'pending': 'Pendiente', 'approved': 'Aprobado', 'rejected': 'Rechazado' }[statusClass] || 'Pendiente';
            const badgeClass = { 'pending': 'badge-pending', 'approved': 'badge-approved', 'rejected': 'badge-rejected' }[statusClass];
            const showActions = item.status === 'pending';
            const vertexCount = item.vertices?.length || 0;

            return `
                <div class="route-card ${statusClass}">
                    <div class="route-header">
                        <div>
                            <div class="route-name">${escapeHtml(item.nombre || 'Sin nombre')}</div>
                            <span class="badge ${badgeClass}">${statusText}</span>
                        </div>
                    </div>
                    <div class="route-details">
                        <div>
                            <div class="route-detail-label">Escuela</div>
                            <div class="route-detail-value">${escapeHtml(item.schoolId || 'No asignada')}</div>
                        </div>
                        <div>
                            <div class="route-detail-label">Restriccion</div>
                            <div class="route-detail-value">${item.restr || 'NO'}${item.restr === 'SI' ? ` (${item.Fecha_inicio || '?'} - ${item.Fecha_fin || '?'})` : ''}</div>
                        </div>
                        <div>
                            <div class="route-detail-label">Exposicion</div>
                            <div class="route-detail-value">${escapeHtml(item.exposicion || '-')}</div>
                        </div>
                        <div>
                            <div class="route-detail-label">Vertices</div>
                            <div class="route-detail-value">${vertexCount} puntos</div>
                        </div>
                    </div>
                    <div class="route-meta">
                        <span>Enviado por: ${escapeHtml(item.createdByEmail || 'Desconocido')}</span>
                        <span>${createdAt}</span>
                    </div>
                    ${showActions ? `
                    <div class="route-actions">
                        <button class="btn btn-success btn-sm" onclick="approveItem('pending_sectors', '${item.id}', loadPendingSectors)">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                            </svg>
                            Aprobar
                        </button>
                        <button class="btn btn-danger btn-sm" onclick="rejectItem('pending_sectors', '${item.id}', loadPendingSectors)">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                            Rechazar
                        </button>
                    </div>
                    ` : ''}
                </div>`;
        }).join('');
    } catch (error) {
        console.error('Error loading pending sectors:', error);
        listEl.innerHTML = '<div class="empty-state"><p>Error al cargar sectores</p></div>';
    }
}

// ============================================
// GESTIÓN DE POI PENDIENTES
// ============================================

const POI_EMOJIS = {
    'fuente': '🚰', 'ducha': '🚿', 'hospital': '🏥', 'parking': '🅿️',
    'refugio': '🏠', 'mirador': '👁️', 'cueva': '🕳️', 'bar': '🍺',
    'restaurante': '🍽️', 'tienda': '🛒', 'farmacia': '💊', 'gasolinera': '⛽',
    'camping': '⛺', 'wc': '🚻', 'escalera': '🪜', 'puente': '🌉',
    'peligro': '⚠️', 'informacion': 'ℹ️', 'iglesia': '⛪', 'hotel': '🏨',
    'albergue': '🛏️', 'merendero': '🧺'
};

function getAdminPOIEmoji(desc) {
    if (!desc) return '📍';
    return POI_EMOJIS[desc.toLowerCase().trim()] || '📍';
}

async function loadPendingPOI() {
    const listEl = document.getElementById('poiList');
    listEl.innerHTML = '<div class="loading"><div class="spinner"></div><p>Cargando puntos de interes...</p></div>';

    try {
        const filterStatus = document.getElementById('filterPOIStatus').value;
        let query = db.collection('pending_poi');
        if (filterStatus !== 'all') query = query.where('status', '==', filterStatus);

        const snapshot = await query.get();
        let items = [];
        snapshot.forEach(doc => items.push({ id: doc.id, ...doc.data() }));
        items.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));

        if (items.length === 0) {
            listEl.innerHTML = `
                <div class="empty-state">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <p>No hay puntos de interes que mostrar</p>
                </div>`;
            return;
        }

        listEl.innerHTML = items.map(item => {
            const createdAt = item.createdAt ? new Date(item.createdAt.toDate()).toLocaleDateString('es-ES', {
                year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
            }) : 'Fecha desconocida';
            const statusClass = item.status || 'pending';
            const statusText = { 'pending': 'Pendiente', 'approved': 'Aprobado', 'rejected': 'Rechazado' }[statusClass] || 'Pendiente';
            const badgeClass = { 'pending': 'badge-pending', 'approved': 'badge-approved', 'rejected': 'badge-rejected' }[statusClass];
            const showActions = item.status === 'pending';
            const emoji = getAdminPOIEmoji(item.descripcio);
            const coords = item.coordinates ? `[${item.coordinates[1]?.toFixed(5)}, ${item.coordinates[0]?.toFixed(5)}]` : 'Sin coordenadas';

            return `
                <div class="route-card ${statusClass}">
                    <div class="route-header">
                        <div>
                            <div class="route-name">${emoji} ${escapeHtml(item.descripcio || 'Sin tipo')} ${item.nombre ? '— ' + escapeHtml(item.nombre) : ''}</div>
                            <span class="badge ${badgeClass}">${statusText}</span>
                        </div>
                    </div>
                    <div class="route-details">
                        <div>
                            <div class="route-detail-label">Escuela</div>
                            <div class="route-detail-value">${escapeHtml(item.schoolId || 'No asignada')}</div>
                        </div>
                        <div>
                            <div class="route-detail-label">Coordenadas</div>
                            <div class="route-detail-value">${coords}</div>
                        </div>
                        ${item.link ? `
                        <div>
                            <div class="route-detail-label">Enlace</div>
                            <div class="route-detail-value"><a href="${escapeHtml(item.link)}" target="_blank" style="color:#667eea;">Ver enlace</a></div>
                        </div>
                        ` : ''}
                    </div>
                    <div class="route-meta">
                        <span>Enviado por: ${escapeHtml(item.createdByEmail || 'Desconocido')}</span>
                        <span>${createdAt}</span>
                    </div>
                    ${showActions ? `
                    <div class="route-actions">
                        <button class="btn btn-success btn-sm" onclick="approveItem('pending_poi', '${item.id}', loadPendingPOI)">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                            </svg>
                            Aprobar
                        </button>
                        <button class="btn btn-danger btn-sm" onclick="rejectItem('pending_poi', '${item.id}', loadPendingPOI)">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                            Rechazar
                        </button>
                    </div>
                    ` : ''}
                </div>`;
        }).join('');
    } catch (error) {
        console.error('Error loading pending POI:', error);
        listEl.innerHTML = '<div class="empty-state"><p>Error al cargar puntos de interes</p></div>';
    }
}

// ============================================
// APROBAR/RECHAZAR GENÉRICO (Escuelas, Sectores, POI)
// ============================================

async function approveItem(collection, docId, reloadFn) {
    if (!confirm('¿Aprobar este elemento?')) return;
    try {
        const award = await kxApprovePending(collection, docId);
        showToast(kxApprovalMessage('Aprobado correctamente', award).replace('\n', ' · '), 'success');
        if (typeof reloadFn === 'function') reloadFn();
        loadStats();
    } catch (error) {
        console.error('Error approving item:', error);
        showToast('Error al aprobar', 'error');
    }
}

async function rejectItem(collection, docId, reloadFn) {
    const reason = prompt('Motivo del rechazo (opcional):');
    if (reason === null) return; // Canceló el prompt
    try {
        await db.collection(collection).doc(docId).update({
            status: 'rejected',
            rejectedAt: firebase.firestore.FieldValue.serverTimestamp(),
            rejectedBy: currentUser.email,
            rejectionReason: reason || ''
        });
        showToast('Rechazado correctamente', 'info');
        if (typeof reloadFn === 'function') reloadFn();
        loadStats();
    } catch (error) {
        console.error('Error rejecting item:', error);
        showToast('Error al rechazar', 'error');
    }
}

console.log('[Admin] Panel de administración cargado');


// ============================================
// ROCÓDROMOS: DENUNCIAS DE LA COMUNIDAD (gym_reports sobre gym_info)
// ============================================
// Cualquier usuario puede denunciar una aportación y proponer un cambio. Aquí se revisan:
//   · «Aceptar cambio» sustituye el texto/enlace de la aportación por la propuesta ya escrita por quien denuncia (horario, precios, contacto y enlaces);
//   · «Borrar aportación» la elimina (y la foto del almacenamiento) y cierra todas sus denuncias;
//   · «Rechazar» / «Descartar» cierra la denuncia sin tocar nada.
const GYM_KIND_LABEL = { photo: 'Foto', hours: 'Horario', price: 'Precios', contact: 'Contacto', facility: 'Instalación', link: 'Red o web' };
const GYM_REASON_LABEL = { incorrect: 'Es incorrecto', outdated: 'Está desfasado', inappropriate: 'Inapropiado o spam' };
let gymReportCache = [];
let gymInfoCache = {};

async function loadGymContributions() {
    const listEl = document.getElementById('gymsList');
    listEl.innerHTML = '<div class="loading"><div class="spinner"></div><p>Cargando denuncias...</p></div>';
    try {
        const filter = document.getElementById('filterGymStatus').value;
        let query = db.collection('gym_reports');
        if (filter !== 'all') query = query.where('status', '==', filter);
        const snap = await query.get();
        gymReportCache = snap.docs.map(d => ({ id: d.id, ...d.data() }))
            .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));

        // Aportaciones denunciadas (una lectura por aportación)
        const ids = [...new Set(gymReportCache.map(r => r.infoId))];
        gymInfoCache = {};
        await Promise.all(ids.map(async id => {
            const d = await db.collection('gym_info').doc(id).get();
            gymInfoCache[id] = d.exists ? { id: d.id, ...d.data() } : null;
        }));

        const openSnap = filter === 'open' ? snap : await db.collection('gym_reports').where('status', '==', 'open').get();
        const openCount = openSnap.size;
        const badge = document.getElementById('gymsBadge');
        if (badge) { badge.textContent = openCount; badge.style.display = openCount ? '' : 'none'; }

        if (!gymReportCache.length) {
            listEl.innerHTML = `<div class="empty-state"><p>${filter === 'open' ? 'No hay denuncias pendientes' : 'No hay denuncias'}</p></div>`;
            return;
        }
        listEl.innerHTML = gymReportCache.map(r => {
            const it = gymInfoCache[r.infoId];
            const date = r.createdAt ? new Date(r.createdAt.toDate()).toLocaleDateString('es-ES', { year: 'numeric', month: 'short', day: 'numeric' }) : '';
            const isOpen = r.status === 'open';
            let content;
            if (!it) content = '<em>La aportación ya no existe</em>';
            else if (it.kind === 'photo') content = `<img src="${escapeHtml(it.photoUrl || '')}" alt="" style="max-width:240px;border-radius:10px">`;
            else if (it.kind === 'facility') content = escapeHtml(it.value || '');
            else if (it.kind === 'link') content = `${escapeHtml(it.network || '')}: ${escapeHtml(it.url || '')}`;
            else content = escapeHtml(it.text || '');
            const canApply = isOpen && it && r.proposal && ['hours', 'price', 'contact', 'link'].includes(it.kind);
            return `
                <div class="route-card ${isOpen ? 'pending' : 'approved'}">
                    <div class="route-header">
                        <div>
                            <div class="route-name">${escapeHtml(GYM_KIND_LABEL[r.kind] || r.kind)} · ${escapeHtml(r.gymId)}</div>
                            <span class="badge ${isOpen ? 'badge-pending' : 'badge-approved'}">${isOpen ? 'Pendiente' : 'Resuelta'}</span>
                            <span class="badge badge-rejected">${escapeHtml(GYM_REASON_LABEL[r.reason] || r.reason)}</span>
                        </div>
                    </div>
                    <div class="route-details">
                        <div>
                            <div class="route-detail-label">Información denunciada</div>
                            <div class="route-detail-value">${content}</div>
                        </div>
                        <div>
                            <div class="route-detail-label">Cambio propuesto</div>
                            <div class="route-detail-value">${r.proposal ? escapeHtml(r.proposal) : '<em>Sin propuesta</em>'}</div>
                        </div>
                    </div>
                    <div class="route-meta">
                        <span>Denunciada por: ${escapeHtml(r.reporterName || r.reporterId || 'Desconocido')}${it ? ` · aportada por ${escapeHtml(it.authorName || 'Usuario')}` : ''}</span>
                        <span>${date}</span>
                    </div>
                    ${isOpen ? `
                    <div class="route-actions">
                        ${canApply ? `<button class="btn btn-success btn-sm" onclick="applyGymReport('${r.id}')">Aceptar cambio</button>` : ''}
                        ${it ? `<button class="btn btn-danger btn-sm" onclick="deleteGymContribution('${r.id}')">Borrar aportación</button>` : ''}
                        <button class="btn btn-sm" onclick="dismissGymReport('${r.id}')">${canApply ? 'Rechazar' : 'Descartar'}</button>
                    </div>` : ''}
                </div>`;
        }).join('');
    } catch (error) {
        console.error('Error loading gym reports:', error);
        listEl.innerHTML = '<div class="empty-state"><p>Error al cargar las denuncias</p></div>';
    }
}

// Cierra todas las denuncias abiertas de una aportación
async function resolveGymReportsOf(infoId) {
    const snap = await db.collection('gym_reports').where('infoId', '==', infoId).get();
    const batch = db.batch();
    snap.forEach(d => { if (d.data().status === 'open') batch.update(d.ref, { status: 'resolved' }); });
    await batch.commit();
}

async function applyGymReport(reportId) {
    const r = gymReportCache.find(x => x.id === reportId);
    const it = r && gymInfoCache[r.infoId];
    if (!r || !it) return;
    let value = String(r.proposal || '').trim();
    const patch = {};
    if (it.kind === 'link') {
        if (!/^https:\/\/[^\s]+$/.test(value)) {
            value = prompt('La propuesta no es una dirección https válida. Escribe el enlace correcto:', value) || '';
            if (!/^https:\/\/[^\s]+$/.test(value.trim())) { showToast('Enlace no válido: no se ha aplicado', 'error'); return; }
        }
        patch.url = value.trim();
    } else {
        patch.text = value.slice(0, 500);
    }
    try {
        await db.collection('gym_info').doc(it.id).update(patch);
        await resolveGymReportsOf(it.id);
        showToast('Cambio aplicado', 'success');
        loadGymContributions();
    } catch (error) {
        console.error('Error applying gym report:', error);
        showToast('No se pudo aplicar el cambio', 'error');
    }
}

async function dismissGymReport(reportId) {
    try {
        await db.collection('gym_reports').doc(reportId).update({ status: 'resolved' });
        showToast('Denuncia descartada', 'info');
        loadGymContributions();
    } catch (error) {
        console.error('Error dismissing gym report:', error);
        showToast('No se pudo descartar', 'error');
    }
}

async function deleteGymContribution(reportId) {
    const r = gymReportCache.find(x => x.id === reportId);
    const it = r && gymInfoCache[r.infoId];
    if (!it || !confirm('¿Borrar esta aportación definitivamente?')) return;
    try {
        await db.collection('gym_info').doc(it.id).delete();
        if (it.storagePath && firebase.storage) {
            try { await firebase.storage().ref(it.storagePath).delete(); } catch (_) {}
        }
        await resolveGymReportsOf(it.id);
        showToast('Aportación borrada', 'info');
        loadGymContributions();
    } catch (error) {
        console.error('Error deleting gym contribution:', error);
        showToast('No se pudo borrar', 'error');
    }
}

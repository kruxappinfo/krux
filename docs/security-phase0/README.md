# Fase 0 / 0b / 0c de seguridad — propuestas y pruebas (NADA de las reglas nuevas está desplegado)

Todo lo de esta carpeta y de `tests/integration/rules/phase0/` es propuesta y prueba aislada. No sustituye a ningún archivo de producción:
`firestore.rules`, el JavaScript de la app, las reglas desplegadas y los datos de Firebase están sin tocar.

| Archivo | Qué es |
|---|---|
| `firestore.rules.phase0b.proposal` | Fase 0b: copia completa de `firestore.rules` con 3 bloques sustituidos: votos, `route-photos` y notificaciones. **Vigente para votos y notificaciones; su bloque de `route-photos` (plazo por el id) está SUPERADO por la 0c.** |
| `storage.rules.phase0b.proposal` | Fase 0b: reglas de Storage completas sin comodín. **SUPERADA por `storage.rules` (0c)**; se conserva como base de las pruebas de la 0b. |
| `firestore.rules.route-photos-only.proposal` | **Fase 0c, la que se desplegaría en Firestore:** `firestore.rules` desplegado + solo el bloque de `route-photos` y las marcas `route-photo-tombstones`. |
| `firestore.rules.phase0c.proposal` | Fase 0c completa (0b + el bloque de `route-photos` de la 0c); la usan las pruebas de regresión. |
| `storage.rules.phase0c.proposal` | Copia idéntica de `storage.rules` de la raíz (una prueba lo exige). |
| `RULES-MANIFEST.sha256` | SHA-256 de los cuatro archivos a conservar: reglas anteriores (`storage.rules.previous`, `firestore.rules.previous`, en la raíz) y nuevas (`storage.rules`, `firestore.rules.route-photos-only.proposal`). Comprobar con `shasum -a 256 -c docs/security-phase0/RULES-MANIFEST.sha256` desde la raíz. |
| `STORAGE-DEPLOY.md`, `STORAGE-CANARY.md`, `STORAGE-INVENTORY-0c.md` | Despliegue, recuperación y ensayo de la vuelta atrás; canario en Firebase real; inventario del bucket. |
| `STORAGE-ORPHANS-PROPOSAL.md`, `STORAGE-ORPHANS-RUNBOOK.md` | Documentos huérfanos: diseño (A0 adoptada, A1 no) y procedimiento administrativo. |
| `storage.rules.DEPLOYED-snapshot` | Copia de solo lectura de las reglas de Storage desplegadas (ruleset de 2025-12-29). Línea base de las pruebas. |
| `firestore.rules.drawings-guard.proposal.snippet` | Opcional: el total de trazados no puede disminuir. Solo después del cliente nuevo. |
| `drawings-safety.proposal.cjs` | Archivar en vez de borrar trazados; clasificar huérfanos sin escribir; reasignar de foto. |
| `sector-images-fixes.proposal.cjs`, `sector-images-keep-drawings.proposal.diff` | Transacciones de la galería de sector y quitar el borrado de trazados al borrar una foto. |
| `firestore.rules.phase0.proposal`, `storage.rules.route-photos.fragment.proposal` | Revisión 0, superada por la 0b (se conserva para documentar el hueco de «borrar y recrear»). |

## Cómo se ejecutan las pruebas
Requiere Java 21+ y `firebase-tools`. Emulador aislado: proyecto `demo-krux-phase0`, Auth 9190, Firestore 8190, Storage 9199, hub 4490, registro 4590
(no usa `tests/integration/emulator.sh`, 8089/9109, ni ningún proyecto real).
```bash
JAVA_HOME=/ruta/a/jdk-21 tests/integration/rules/phase0/run-phase0.sh
```
`MODE=current` carga las reglas actuales (Firestore: `firestore.rules`; Storage: el snapshot desplegado) **solo en el emulador**.
`RULES_FILE=<ruta>` prueba otra propuesta de Firestore.

## Límites que no se pueden probar aquí
- El emulador no adelanta el reloj: el plazo de 12 h de Firestore (y de Storage por documento) se prueba con documentos sembrados con antigüedad (margen ±20 s);
  la ventana por `timeCreated` de Storage se prueba con la misma regla escalada a 4 s. El instante exacto de las 12 h no es ejecutable.
- `firestore.get()/exists()` desde las reglas de Storage funciona en el emulador; en producción necesita permiso de la cuenta de servicio de Storage sobre Firestore (no verificado).
- La cola offline se prueba con `disableNetwork()/enableNetwork()` en Node (sin IndexedDB); falta una prueba en Chrome/Capacitor.
- Los cambios de cliente descritos en el informe NO están implementados, así que las reglas propuestas solo se han probado con las cargas útiles que esos clientes enviarían.

## Implementación 1 — protección de dibujos y cartografía (PUBLICADA en `f14abb0`, Service Worker v306)
- `admin.js` y `admin-routes.js`: sección «INFORME DE TRAZADOS (SOLO LECTURA)». `cleanOrphanedDrawings()` (mismo botón) genera un informe
  seguro / huérfano / indeterminado en un modal y no escribe nada. `deleteRouteDrawingFromSector` y `loadGeoJSONRoutesForSector` eliminadas;
  `rejectRoute` / `deleteRoute` solo cuentan los trazados con `kxCountRouteDrawings` y avisan de que se conservan.
- `sector-images.js`: `deleteGalleryImage` ya no borra trazados; `deleteRouteDrawingsForImage` eliminada (no tenía otros usos).
- Pruebas: `drawings-0c.cjs` (código real de ambos archivos + fallos de red/GeoJSON + vías con nombre duplicado), `sector-images-drawings.cjs`,
  `drawings-safety.cjs` (el «antes» se lee de git: `KRUX_BEFORE_REF`, por defecto HEAD).
- Estado: publicada junto con la Implementación 2 (`f14abb0`). El archivado de dibujos (propuestas `drawings-*.proposal.*`) sigue pendiente de autorización.

## Implementación 2 — sincronización segura (PUBLICADA en `f14abb0`)
- `sw.js`: `CACHE_VERSION` v305 → v306; el precacheo usa `cache:'reload'`; un recurso propio sin copia en la caché de esta versión se descarga con `cache:'reload'`.
  Prueba: `tests/sw-cache.test.js` (carga el sw.js real en un entorno simulado; 6 de sus 10 casos fallan con el sw.js anterior).
- `www/`: copia selectiva (`cp`) de `sw.js`, `admin.js`, `admin-routes.js` y `sector-images.js`. No se ejecutó `npm run build` (borra y recrea `www/`).
- Circuito de publicación (comprobado): PWA = GitHub Pages desde la rama `dev`, carpeta raíz (`kruxappinfo.github.io/krux/`); Netlify = `main` con `npm run build`; `www/` = Capacitor/Firebase Hosting.
  `admin.html` y `admin-routes.html` solo existen en la raíz (el build no los copia a `www/`).

## Fase 0c — Storage (reglas finales, cliente de fotos de vía y plan de despliegue; sin commit ni despliegue)
- **Qué hay:** `storage.rules` y `storage.rules.previous` (copia exacta de lo desplegado) en la raíz, el bloque `storage` de `firebase.json`, `firestore.rules.route-photos-only.proposal` (producción + solo `route-photos`
  y marcas), el cliente `route-photos.js` nuevo y las pruebas. **Procedimiento de despliegue, verificación con Firebase real y recuperación: `STORAGE-DEPLOY.md`.**
- **Plazo de 12 h de las fotos de vía (opción A):** como máximo 12 h desde que el servidor acepta el documento (`uploadedAt`); el retraso hasta que llega el archivo (ventana de 5 min) se descuenta. Lo fija el servidor, nunca el cliente, y no se amplía borrando y resubiendo, sobrescribiendo ni recreando (marcas). Sin documento, el autor no borra el archivo.
- **Pruebas:** emulador → `storage-phase0c-rules.cjs`, `route-photos-client.cjs` (cliente real con fallos inyectados), `route-photos-legacy-clients.cjs` (las 4 versiones antiguas reales del cliente: subir, leer, borrar, huérfanos), `mutations-0c.cjs` (¿detectan las pruebas una regla rota?) y `tests/route-photos.test.js` (vitest);
  motor real de Firebase sin desplegar → `node rules-engine-check.cjs` (necesita `gcloud auth login`; no forma parte de `run-phase0.sh`).
- **No desplegar con `firebase deploy` a secas:** `firebase.json` ya incluye Storage. Usar siempre `--only`.
- **Orden de despliegue recomendado: Storage primero, Firestore después** (medido en `deployment-states.cjs`); canario en `STORAGE-CANARY.md`; propuesta de huérfanos (no implementada) en `STORAGE-ORPHANS-PROPOSAL.md`.
- **Documentos huérfanos (aprobadas capas 1–3, sin ejecutar limpieza real):** diario de subidas en `route-photos.js` (solo informa), herramienta `scripts/route-photos-orphans.py` (`report` solo lectura; `plan`/`apply`/`restore` con aprobación, archivado reversible y atómico) la capa 0 resuelta con **A0** (sin cambios de reglas; A1 no adoptada, §12) y el procedimiento administrativo en `STORAGE-ORPHANS-RUNBOOK.md`. Pruebas: `route-photos-orphans-tool.cjs`, `admin-orphan-resolution.cjs`, `tests/route-photos-orphans.test.js`.
- **Reglas anteriores y nuevas, siempre conservadas:** `storage.rules.previous` y `firestore.rules.previous` (copias exactas de lo desplegado) y `storage.rules` + la propuesta `route-photos-only` (lo nuevo), con sus hashes en `RULES-MANIFEST.sha256`. Despliegue y recuperación (`STORAGE-DEPLOY.md` §3.4 y §6) **no usan git ni modifican esos archivos**: se publican desde un directorio temporal. Ensayo de la vuelta atrás: `scripts/rules-rollback-rehearsal.sh` (solo proyecto de pruebas; probado contra una API simulada, **pendiente contra la API real**, §6.1).
- **Endurecimientos de la herramienta de huérfanos:** `apply` falla si no encuentra el informe original (ni simulación) y exige el lote completo y atómico (copia + borrado + marca); `restore` exige recrear el documento y marcar la copia. Pruebas negativas en el autotest del script y en `route-photos-orphans-tool.cjs`.
- **Reproducir desde un clon limpio:** `git clone`, `npm install` (`npm ci` falla desde antes de la 0c: `package-lock.json` desincronizado), `firebase-tools` global y JDK 21+. Dos suites leen el historial de git (`route-photos-legacy-clients.cjs`, `drawings-safety.cjs`): necesitan un clon con `.git`. `tests/climb-session.test.js` necesita `ios/` (ignorado por git) y falla en un clon; no es de esta fase.
- **Ensayo de la vuelta atrás con la API real (pendiente):** `ROLLBACK-TEST-PROJECT.md` describe el proyecto de pruebas exclusivo (id `krux-rules-test…`, que el script exige), servicios, roles mínimos, verificación y limpieza. **No existe ni se ha creado ningún proyecto.**
- **Migración de `routeId` de las 4 fotos antiguas:** `ROUTEID-MIGRATION.md` + `scripts/route-photos-routeid-plan.py` (solo lectura). Ninguna de las 4 corresponde a una vía del mapa: no hay nada migrable y no se usa `migrate-route-ids.html`.
- **Estabilidad de las pruebas con tiempo real:** `tests/integration/rules/phase0/soak.sh <suite> <N> <variante> [carga]` repite una suite N veces sin reintentos; ver el apartado «Pruebas con tiempo real» de `STORAGE-DEPLOY.md` §8.

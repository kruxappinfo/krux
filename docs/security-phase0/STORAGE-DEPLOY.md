# Storage (Fase 0c): despliegue, verificación y recuperación

**Estado: preparado para revisión. NADA está desplegado.** El bucket `climbmaps-80cae.firebasestorage.app` sigue con el ruleset
`16df6449-48f8-473b-82ba-8325bf7d0093` (2025-12-29), que termina en el comodín `match /{allPaths=**} { allow read, write: if request.auth != null }`.
Firestore sigue con el ruleset `d2908fdf-91b5-4819-bd7b-b823f2e98eed` (2026-11-12, md5 `311a726e31a1da22962d8ada891bd08f` = `firestore.rules`).

## 1. Qué se entrega

| Archivo | Para qué |
|---|---|
| `storage.rules` | Reglas finales de Storage, sin comodín (se despliegan con `firebase deploy --only storage`) |
| `storage.rules.previous` | **Copia exacta** del ruleset desplegado (SHA-256 `29cc65bdef1a484c98447ffa627b017de6718568c9a190a67104036d332fb887`, 1444 bytes; verificado contra la API de Reglas el 2026-11-14). Sirve para recuperar |
| `firestore.rules.previous` | **Copia exacta** del ruleset de Firestore desplegado (`d2908fdf…`, md5 `311a726e31a1da22962d8ada891bd08f`, 36 519 bytes). Sirve para recuperar sin depender de git |
| `docs/security-phase0/RULES-MANIFEST.sha256` | SHA-256 de los cuatro archivos que hay que conservar: **anteriores** (`storage.rules.previous`, `firestore.rules.previous`) y **nuevos** (`storage.rules`, `firestore.rules.route-photos-only.proposal`). Se comprueba con `shasum -a 256 -c` desde la raíz del repositorio |
| `scripts/rules-rollback-rehearsal.sh` | Ensayo de la vuelta atrás en un **proyecto de pruebas** (nunca producción); ver §6.1 |
| `firebase.json` | Añade `"storage": { "rules": "storage.rules" }`. El resto no cambia |
| `docs/security-phase0/firestore.rules.route-photos-only.proposal` | `firestore.rules` desplegado + **solo** el bloque de `route-photos` y la colección `route-photo-tombstones`. Es lo que hay que desplegar en Firestore para esta fase |
| `docs/security-phase0/firestore.rules.phase0c.proposal` | La propuesta 0c completa (incluye además los cambios de la Fase 0b), con el mismo bloque de `route-photos` |
| `docs/security-phase0/storage.rules.phase0c.proposal` | Copia idéntica de `storage.rules` (una prueba lo exige) |
| `docs/security-phase0/STORAGE-CANARY.md` | Procedimiento de verificación en Firebase real (cuentas, pasos, criterios de parada, vuelta atrás) |
| `docs/security-phase0/STORAGE-ORPHANS-PROPOSAL.md` | Documentos huérfanos: capas 1–3 **implementadas sin ejecutar ninguna limpieza real**, uso de la herramienta y **alternativa a la capa 0 (propuesta)** |
| `docs/security-phase0/STORAGE-ORPHANS-RUNBOOK.md` | **Procedimiento administrativo** para resolver documentos huérfanos antiguos (A0; sin cambios de reglas; ningún borrado fuera de la herramienta o la app) |
| `scripts/route-photos-orphans.py` | Herramienta local: `report` (solo lectura), `plan`, `apply` (simulación por defecto; archiva y borra solo el documento, atómico, con aprobación) y `restore` |
| `route-photos.js` (y `www/route-photos.js`) | Cliente nuevo, compatible con las reglas nuevas **y** con las actuales |
| `tests/route-photos.test.js` | 31 pruebas unitarias del cliente (vitest, sin emulador) |
| `tests/integration/rules/phase0/` | `storage-phase0c-rules.cjs`, `route-photos-client.cjs`, `route-photos-legacy-clients.cjs` (versiones antiguas del cliente), `deployment-states.cjs` (estados intermedios del despliegue), `canary-dry-run.cjs` (ensayo del canario), `mutations-0c.cjs` (emulador; ayudante `_client-env.cjs`) y `rules-engine-check.cjs` (motor real, sin desplegar) |

> **`firebase deploy` sin `--only` ya despliega también Storage** (por el bloque nuevo de `firebase.json`), además de Firestore e Hosting.
> Usar siempre `--only storage`, `--only firestore:rules` o `--only hosting`.

## 2. Política de fotos de vía y qué la garantiza

Cualquier usuario con sesión sube. **El autor dispone de un máximo de 12 h para borrar su foto, contadas desde que el servidor acepta el documento de Firestore** (`uploadedAt`);
el retraso entre aceptar el documento y recibir el archivo (hasta 5 min, normalmente segundos) **se descuenta del plazo**. Pasadas las 12 h, solo admin y super-admin. El spotter no tiene
privilegios por rol. Es la **opción A** de la revisión de seguridad, elegida por sencillez y mantenibilidad: el autor puede perder unos segundos de plazo, **nunca ganar**. Una exactitud
al milisegundo desde `resource.timeCreated` no se puede garantizar con reglas nativas sin permitir ampliaciones (ver el análisis de alternativas en el informe de la revisión) y exigiría una Cloud Function.

**Ningún instante lo escribe el cliente.** La referencia es `uploadedAt` del documento (`== request.time` en la creación, inmutable porque `update: false`):

- Borrado del autor en Firestore: `request.time < uploadedAt + 12 h` (y con su marca en el mismo lote).
- Borrado del autor en Storage: **solo si el documento existe** y `request.time < uploadedAt + 12 h` **y** `request.time < timeCreated + 12 h`. Como `timeCreated ≥ uploadedAt`, la primera manda;
  la segunda solo importa si el documento se recreó sin marca por una vía privilegiada. **Sin documento, el autor no borra el archivo** (solo administración): por eso el cliente borra siempre el archivo **antes** que el documento.
- El archivo solo se admite si su documento existe, es del mismo autor, apunta a ese mismo archivo y tiene menos de **5 min**. **Esa ventana solo limita cuándo puede llegar el archivo; no forma parte de ninguna regla de borrado**, de modo que ampliarla no amplía el plazo de 12 h.

**Garantía:** ninguna operación del autor —borrar el archivo, borrar el documento, resubir, sobrescribir, recrear— tiene efecto a partir de `uploadedAt + 12 h`. La única excepción es recrear el
**documento** por una vía privilegiada (consola o credenciales de servicio): crea un documento nuevo con plazo propio, pero el archivo conserva su `timeCreated` y el autor sigue sin poder borrarlo.
Comprobado con el motor real de Firebase con una rejilla de 962 combinaciones (cifra histórica, pendiente de verificación: §8) (13 edades de documento y de archivo, con y sin documento, autor/otro usuario/spotter/admin/super-admin) y con el emulador (barrido con plazo escalado).

| Intento de ampliar el plazo | Qué lo impide | Prueba |
|---|---|---|
| Borrar el archivo y subirlo otra vez (`timeCreated` se reinicia) | El plazo lo marca el documento (inmutable); además la nueva subida solo se admite en los 5 min posteriores a `uploadedAt` y no mueve el plazo | `storage-phase0c` §7, §11a y §12 (espera real); `rules-engine-check` («borrar y RESUBIR» y rejilla) |
| Borrar el documento y recrearlo con el mismo id | Cada borrado deja una marca permanente `route-photo-tombstones/{id}` en el mismo lote (`existsAfter`) y un id con marca no puede crearse; además el archivo conserva su `timeCreated` | §7, §7b, §11b, §12 |
| Sobrescribir el archivo o modificar sus metadatos | Subir encima de un archivo existente se evalúa como `create` (la documentación reserva `update` a los metadatos), por eso `create` exige `resource == null`; `update: false` | §5; `rules-engine-check` («SOBRESCRIBIR») |
| Subir dos veces a la vez el mismo archivo | Si ambas se aceptan, manda igualmente el documento | §10, §12 |
| Borrar primero el documento (con marca) y luego el archivo | Sin documento el autor no puede borrar el archivo | §8, §11c, §12 |
| Poner una hora falsa en el cliente | No existe ninguna hora del cliente en lo que se envía a las reglas | `uploadedAt == request.time`; `tests/route-photos.test.js` |
| Spotter con privilegios | `isAdmin()` es solo `role == 'admin'` | §6, §12 |

Residual conocido: un documento sin archivo (subida fallida y sin red para limpiar) es visible hasta que se borre; Firestore no puede comprobar que el archivo exista.
El cliente lo limpia solo en cuanto hay red (cola pendiente, 13 h máximo); pasadas las 12 h solo un administrador puede borrarlo. Lo mismo para un archivo cuyo documento se borró por otra vía.

### 2b. Ventana de subida: 5 minutos (estudio 10 → 2 → 5)

Qué mide: el tiempo entre que el servidor acepta el documento y recibe el archivo. **En el emulador las reglas se evalúan al finalizar la subida reanudable**, no al iniciarla
(sonda: inicio a ~0 s y fin a ~7 s con una ventana escalada de 4 s → 403; un inicio fuera de ventana se acepta y falla al finalizar), así que la ventana cubre **toda la transferencia**.
Si Firebase real se comporta igual **no está verificado**: lo comprobará el canario ([STORAGE-CANARY.md](STORAGE-CANARY.md) C22–C24, bloque 3).

- **La ventana no amplía el plazo de borrado (garantía).** Las dos reglas de borrado (Firestore y Storage) solo contienen `12 h`; la ventana solo aparece en la regla de `create` del archivo.
  Comprobado por: (1) un test que exige que la regla de borrado de Storage no contenga ninguna otra duración (`tests/route-photos.test.js`); (2) la mutación «la ventana se SUMA al plazo de borrado» (detectada);
  (3) la rejilla de 962 combinaciones (cifra histórica: §8) del motor real, que no depende de la ventana; (4) los escenarios escalados (ventana 5 s, plazo 8 s) donde el archivo se borra y se vuelve a subir **en el borde de la ventana** y el autor
  sigue sin poder borrar pasado `uploadedAt + 8 s` (§11a y §12 del emulador).
- **Coste:** el retraso entre documento y archivo se descuenta del plazo, así que el autor puede perder hasta 5 min de los 12 h en el peor caso (normalmente segundos). Nunca gana.
- El cliente reduce la imagen **antes** de crear el documento (máx. 1600 px, JPEG 0,82: normalmente 150–500 KB; tope duro de 5 MB). Medido con el cliente real en el emulador: documento→inicio 0 ms; `uploadedAt`→`timeCreated` del servidor
  11 ms (50 KB) a 31 ms (4,9 MB). En producción se suman las latencias de red (del orden de 1–3 s).
- Ancho de banda mínimo para terminar en 5 min (con 10 s de margen de arranque): 300 KB → 8 kbps · 600 KB → 17 kbps · 2 MB → 55 kbps · 5 MB → 140 kbps. Cualquier foto reducida termina incluso con EDGE (50–100 kbps);
  «Slow 3G» (400 kbps) sube 5 MB en ~100 s. Con la ventana de 2 min un original irreducible de 5 MB necesitaba 380 kbps.
- **Si se supera la ventana** (corte de red, cierre de la app): las reglas rechazan el archivo, el cliente borra el documento (con marca) y avisa; el usuario repite con un documento nuevo y 5 min nuevos. No queda un archivo sin documento
  (probado con el cliente real y una ventana escalada a 3 s). El SDK reintenta cada operación como mucho 2 min y un segundo intento empieza de cero, por eso el cliente solo reintenta si el primer fallo ocurrió en menos de 90 s.
- **Resubidas:** dentro de la ventana el autor puede borrar su archivo y volver a subirlo (o fallar al sobrescribir: `resource == null`); el plazo seguirá siendo `uploadedAt + 12 h`. Fuera de la ventana no puede crear el archivo.
- Residual: durante la ventana el autor puede borrar el **documento** (con marca) mientras sube el archivo; si la subida termina después de borrarlo puede quedar un archivo sin documento (solo borrable por administración). Es una carrera
  provocada por el propio autor, acotada a su carpeta y a 5 min; antes (2 min) existía igual.

## 3. Orden y secuencia de despliegue

### 3.1 Qué puede hacer un usuario con sesión mientras solo uno de los dos servicios está desplegado
Medido en el emulador con `deployment-states.cjs` (105 comprobaciones, cifra histórica: §8; B es un usuario normal que actúa sobre datos de A). **Ninguna operación legítima se interrumpe en ningún estado** (L1–L10: perfil, publicaciones, sector, rocódromo,
lecturas públicas y el cliente nuevo de fotos de vía funcionan en los cuatro estados).

| Operación (usuario con sesión) | HOY | Firestore primero (F→S) | **Storage primero (S→F)** | Final |
|---|---|---|---|---|
| Sobrescribir o borrar la foto de perfil o los archivos de publicaciones de otro (E1–E3) | sí | sí | **no** | no |
| Subir o borrar imágenes de sector sin ser admin/spotter (E4–E5) | sí | sí | **no** | no |
| Escribir en cualquier ruta del bucket; borrar fotos de rocódromo ajenas (E6, E10) | sí | sí | **no** | no |
| Borrar o sobrescribir el archivo de una foto de vía ajena; subir a la carpeta de otro sin documento (E7–E9) | sí | sí | **no** | no |
| El autor borra el archivo de su foto de vía pasadas 12 h (F1) | sí | sí | **no** | no |
| Borrar o falsificar **documentos** de fotos de vía ajenos; el autor borra su documento pasadas 12 h (E11–E13) | sí | **no** | sí | no |
| Tras borrar B el documento de A, A borra su propio archivo (G1) | sí | sí | **no** (solo admin) | sí |

Riesgos concretos de cada intervalo:
- **F→S (Firestore ya desplegado, Storage con comodín):** sigue abierta **toda** la superficie de archivos del bucket: cualquier usuario con sesión puede sobrescribir o borrar fotos de perfil, publicaciones, las 199 imágenes de sector y las fotos de rocódromo, y escribir
  en cualquier ruta, y el plazo de 12 h no se aplica a los archivos. Además un cliente antiguo que suba una foto deja un **archivo huérfano** (el archivo entra por el comodín y el documento se rechaza).
- **S→F (Storage ya desplegado, Firestore con las reglas actuales):** quedan abiertos solo los **documentos** de fotos de vía (una función sin interfaz hoy; 5 documentos reales): se pueden borrar o falsificar. Consecuencia concreta: quien borre el documento de otro le impide retirar su
  propio archivo (solo administración). Un documento falsificado con `uploadedAt` en el futuro **no** amplía el plazo (manda también `timeCreated`; motor real). Los clientes antiguos fallan limpiamente al subir (sin huérfanos). Las fotos que se borren con el cliente nuevo no dejan marca hasta que se despliegue Firestore.

### 3.2 Decisión: **Storage primero, Firestore después** (corrige la recomendación anterior) — **aprobada por el propietario el 2026-11-15** con estas condiciones: intervalo objetivo **inferior a 5 min** y máximo absoluto de **15 min** (a 2026-11-18, con la puerta S de 10 pasos, el objetivo de < 5 min es solo orientativo y lo exigible es el máximo de 15 min: §3.3); **verificación del hash del ruleset tras cada despliegue**; **no continuar si falla alguna comprobación**; **ninguna prueba destructiva sobre fotografías reales**
El riesgo grave de esta fase es el comodín (es lo que permite borrar las 199 imágenes de sector o las fotos de otros). Desplegar Storage primero lo cierra por completo en el primer paso y deja abierto solo lo que afecta a una función sin interfaz;
el orden contrario mantiene el comodín abierto todo el intervalo y cierra antes lo secundario. Si el segundo despliegue fallara, también es preferible quedarse en S→F (comodín cerrado) que en F→S (comodín abierto). Además el estado S→F no genera archivos huérfanos con clientes antiguos.

### 3.3 Procedimiento y tiempos
| Cuándo | Paso | Comprobación antes de seguir |
|---|---|---|
| **Días antes** | 1. Publicar el cliente (`route-photos.js`, con `CACHE_VERSION` de `sw.js` y `?v=3` en `index.html`; fuera del alcance autorizado hasta ahora). Con las reglas actuales sube y borra. | `curl` de `sw.js` muestra la versión nueva |
| Días antes | 2. Plan de `routeId` **de solo lectura** (`scripts/route-photos-routeid-plan.py plan`; ver [ROUTEID-MIGRATION.md](ROUTEID-MIGRATION.md)). **No se usa `migrate-route-ids.html`.** Las 4 fotos antiguas no corresponden a ninguna vía del mapa: no hay nada migrable y no hace falta | 0 migrables, 4 «sin_coincidencia», 1 con `routeId`; las 5 fotos siguen legibles (HTTP 200) |
| **T−60 min** | 3. Pre-vuelo: lista de §4; manifiesto del bucket (`gcloud storage ls -r gs://climbmaps-80cae.firebasestorage.app > manifiesto-antes.txt`); copia de Firestore (`scripts/backup-firestore.py`); cuentas del canario listas, **con A en un perfil de navegador exclusivo para el canario (sin otras cuentas ni sesiones en él) y su cola de borrados pendientes vacía (C0d: `kxRpPendingLoad()` → `[]`; si no lo está, no se empieza: se investiga el origen y **no** se resuelve con el uso normal de la aplicación, sino fuera del procedimiento)** y **con un guion por sesión con todos sus fragmentos ya pegados** ([STORAGE-CANARY.md](STORAGE-CANARY.md) §2); avisar a administradores | Release activos = `16df6449…` y `d2908fdf…`; hashes de los archivos |
| **T0** | 4. Desplegar Storage con el comando exacto de §3.4 (`publicar storage`) | **Justo antes: C0d otra vez** (A, en su perfil de navegador exclusivo: `kxRpPendingLoad()` → `[]`, sin ninguna entrada pendiente; si no, **no se despliega**: se investiga el origen y se resuelve fuera del procedimiento). **Después:** el release de Storage cambia y su contenido es `storage.rules` (comparar SHA-256 con la API) |
| T0 → T0+15 min (**máximo exigible**; orientativo T0+5 min) | 5. **Puerta S mínima, con todas sus limpiezas** (10 pasos, **máximo 15 min**): C1, C3, **C4b**, C7b, **C7d**, **C8**, C11, C10a, C12, **C15b** del canario ([STORAGE-CANARY.md](STORAGE-CANARY.md) §2). C8 (B intenta subir a una ruta que ninguna regla nombra) comprueba que el comodín global ha desaparecido | Todos como se esperan **y las tres limpiezas (C4b, C7d y C15b) hechas y verificadas** (0 objetos del canario; PS se borra con las reglas anteriores de Firestore y no deja marca). Si falla uno → **rollback de Storage inmediato** (§6): en la puerta S cualquier STOP revierte Storage. **Sin las tres limpiezas no se despliega Firestore** |
| **Con la puerta S cerrada** (orientativo T0+5 min; **máximo absoluto T0+15 min**, exigible) | 6. Desplegar Firestore con el comando exacto de §3.4 (`publicar firestore`; despliega la propuesta **sin modificar** `firestore.rules`) | El release de Firestore cambia; diff contra el ruleset anterior = solo el bloque de `route-photos`; hash del release verificado. **Después, C0e** (ADM, `cuentaMarcas()`; la colección de marcas solo se puede leer ya con Firestore desplegado), con **tres resultados distintos**: lectura correcta con **0** → seguir; lectura correcta con **un número distinto de 0** → **STOP-8**: se para el canario, **no se revierte ningún servicio** y se avisa al propietario; **lectura fallida** (permisos, red o cualquier otro error) → **STOP-4: revertir Firestore** |
| Firestore + 60 min como máximo (punto de control a los 30 min) | 7. **Puerta F, bloque 1: las seis pruebas críticas de Firestore**, en este orden: **C0e, C11b, C10a, C14, C16, C17** (6 pasos sin esperas; ≈ 5 min por paso = ≈ 30 min; **estimación, no medida**) | Criterios de parada de [STORAGE-CANARY.md](STORAGE-CANARY.md) §3. **A los 30 min los seis pasos deben estar completados y dar lo esperado**; si no, decide el propietario en ese momento (continuar hasta el máximo de 60 min o revertir Firestore; sin decisión expresa, **revertir Firestore**); sin los seis a los 60 min: **revertir Firestore**. Al terminar: P1 borrada (**1 marca**) y **P2 sigue viva** hasta C19 |
| Tras el bloque 1, el mismo día | 8. **Puerta F, bloque 2** (sin el límite de 60 min), en este orden: **grupo P2** sobre P2 (C12, C13, C15, C18, C20a, C20b) → **C19** (ADM borra P2) → **grupo P completo** (C1–C10b, solo Storage) → **C21** | Criterios de parada de [STORAGE-CANARY.md](STORAGE-CANARY.md) §3, con el rollback del servicio de cada operación (C12, C13, C15 y C20a: Storage; C18b y C20b: Firestore). Al terminar: 0 objetos, 0 documentos y **3 marcas** (P1, P2, L1). Orden de magnitud ≈ 2 h (estimación, no medida) |
| Tras el bloque 2, el mismo día | 9. **Puerta F, bloque 3** (posterior y reversible): red lenta y fallos parciales (C22–C25), C28–C29, recuento de marcas tras cada intento **con la cola de borrados pendientes vacía** y manifiesto posterior (`manifiesto-despues.txt`: solo deben aparecer los objetos del canario) | Sin objetos inesperados; marcas = `3 +` los documentos realmente creados en el bloque 3 (6 a 12 en total, §1.2.2 del canario). Mientras dure, la vuelta atrás de §6 sigue disponible |
| `Tf + 1 h` (una hora después de cerrar el bloque 3) | 10. Comprobaciones de humo y manifiesto de [STORAGE-CANARY.md](STORAGE-CANARY.md) §3.1, **cuando ya no hay ninguna prueba en curso**. **El límite de 12 h (C27 y C30) está excluido en la variante sin excepciones** (no hay fotos X ni Z; el plazo de 12 h se cubre solo con el emulador a plazos escalados) | Sin fallos |
| T0+48 h | 11. Cierre: revisar errores 403 y huérfanos (propuesta [STORAGE-ORPHANS-PROPOSAL.md](STORAGE-ORPHANS-PROPOSAL.md)) | Sin anomalías |

Reglas del procedimiento:
- **Intervalo S→F: máximo absoluto 15 min** (el objetivo de < 5 min es solo orientativo: la puerta S tiene 10 pasos y 5 sesiones). Si la puerta S no está cerrada a los 15 min, se revierte Storage (no se queda en el intervalo).
- **Si falla cualquier comprobación (hash del ruleset, puerta S o puerta F), no se continúa**: se aplica la vuelta atrás **del servicio al que pertenece** (§6; criterio en [STORAGE-CANARY.md](STORAGE-CANARY.md) §3), antes de nada más. **Única excepción: STOP-8** (una guarda lanza `PARAR`, L1 ya existía, o **C0e lee correctamente un número distinto de 0**): se para el canario, **no se borra nada y no se revierte ningún servicio** (Storage y Firestore quedan desplegados), se avisa al propietario y revertir, si se quisiera, es una decisión suya posterior. **Una lectura fallida en C0e no es STOP-8: es STOP-4 (revertir Firestore).** Ambos documentos describen exactamente esta decisión.
- **Verificación del hash tras cada despliegue** (comando de §4): el SHA-256 del ruleset activo debe coincidir con el del archivo; si no coincide, parar.
- **Ninguna prueba destructiva sobre fotografías reales**: el canario solo usa la escuela `canario` y objetos creados para él; las 5 fotos reales solo se leen.
- **Fallo tras el paso 4 (puerta S):** revertir solo Storage (es lo único desplegado). **Fallo tras el paso 6 (puerta F):** se revierte **el servicio al que pertenece la operación fallida**, no «el último desplegado»: operación sobre un archivo u objeto de Storage → Storage; sobre un documento o una marca de Firestore → Firestore (tabla y criterio en [STORAGE-CANARY.md](STORAGE-CANARY.md) §3: STOP-1, 2a/2b, 3a/3b y 4). El otro servicio se queda como está; si no se puede decidir en un minuto, se revierte el último desplegado.
- No encadenar los dos despliegues en un solo comando: hace falta la verificación entre ambos.
- **Variante sin excepciones (decidida 2026-11-18): C26, C27 y C30 no se ejecutan**; al terminar el bloque 2 no queda ningún objeto del canario (P2 es el único que cruza del bloque 1 al 2, y se borra en C19) y el canario se cierra el mismo día. Si este apartado y [STORAGE-CANARY.md](STORAGE-CANARY.md) discreparan, **manda STORAGE-CANARY.md**.
- Un cliente nuevo funciona en los cuatro estados (`route-photos-client.cjs` §P, §P2, §P3 y L10 de `deployment-states.cjs`).

### 3.4 Comandos exactos de publicación (no se han ejecutado)
Se ejecutan desde la raíz de un clon limpio del repositorio, **después** de que `storage.rules`, `storage.rules.previous`, `firestore.rules.previous`, `RULES-MANIFEST.sha256` y la propuesta estén confirmados en él.
**Ninguno modifica archivos del repositorio** (ni `firestore.rules` ni `storage.rules`): cada despliegue se hace desde un directorio temporal con su propio `firebase.json`, de modo que no hay nada que «restaurar» después y las reglas anteriores y las nuevas permanecen siempre en el repositorio.
```bash
P=climbmaps-80cae
# Comprobación previa (debe imprimir cuatro «OK»)
shasum -a 256 -c docs/security-phase0/RULES-MANIFEST.sha256

# Función común: publicar <storage|firestore> <archivo de reglas>
publicar() {
  W=$(mktemp -d)
  case "$1" in
    storage)   cp "$2" "$W/storage.rules";   printf '{"storage":{"rules":"storage.rules"}}\n' > "$W/firebase.json"; ONLY=storage ;;
    firestore) cp "$2" "$W/firestore.rules"; printf '{"firestore":{"rules":"firestore.rules"}}\n' > "$W/firebase.json"; ONLY=firestore:rules ;;
    *) echo "uso: publicar storage|firestore <archivo>"; return 2 ;;
  esac
  ( cd "$W" && firebase deploy --only "$ONLY" --project "$P" ); RC=$?
  rm -rf "$W"; return $RC
}

# Paso 4 — publicar storage
publicar storage storage.rules
# (verificar el hash con el comando de §4 antes de seguir)

# Paso 6 — publicar firestore (solo tras cerrar la puerta S, dentro del plazo de §3.3)
publicar firestore docs/security-phase0/firestore.rules.route-photos-only.proposal
```
Tras desplegar y verificar, si se quiere que `firestore.rules` refleje producción, se copia la propuesta sobre él **en un commit aparte**; `firestore.rules.previous` conserva siempre el anterior. `firebase deploy` **sin** `--only` no se usa nunca.

### 3.5 Publicación del cliente (paso 1; preparada, NO ejecutada)
Hoy: `sw.js` y `www/sw.js` en `v306`; `index.html` y `www/index.html` cargan `./route-photos.js?v=2`; `route-photos.js` y `www/route-photos.js` ya contienen el cliente nuevo (idénticos). **Cambios que faltan, y solo estos:**
| Archivo (raíz y `www/`, mismo cambio) | Cambio |
|---|---|
| `sw.js` y `www/sw.js` | `const CACHE_VERSION = 'v306';` → `'v307';` (los `.js` se sirven «primero caché»: sin subir la versión los usuarios seguirían con el cliente anterior) |
| `index.html` y `www/index.html` | `<script defer src="./route-photos.js?v=2">` → `?v=3` |
| `route-photos.js` y `www/route-photos.js` | sin cambios (ya idénticos) |
```bash
# 1. Cambios mínimos, en la raíz y en www/ a la vez (NO se usa `npm run build` —borra y recrea www/— ni scripts/Personal/sync-www.sh —hace `git add www/` y push—)
sed -i '' "s/const CACHE_VERSION = 'v306';/const CACHE_VERSION = 'v307';/" sw.js www/sw.js
sed -i '' 's#route-photos\.js?v=2#route-photos.js?v=3#' index.html www/index.html
# 2. Comprobar: copias idénticas y versiones juntas (la prueba falla si solo se cambia una de las dos)
cmp route-photos.js www/route-photos.js && cmp sw.js www/sw.js && cmp index.html www/index.html
npx vitest run tests/client-release-sync.test.js tests/route-photos.test.js tests/sw-cache.test.js
# 3. Añadir SOLO estos seis archivos (nunca `git add -A` ni `git add www/`: hay cambios ajenos en www/route-drawing.js y www/Cartografia/)
git add route-photos.js www/route-photos.js sw.js www/sw.js index.html www/index.html
git status --short | grep -E "^[AM] " # debe listar exactamente esos seis
```
El commit, el push y la comprobación posterior (`curl` de `sw.js` en la URL publicada) requieren la autorización expresa del propietario. Las apps nativas empaquetan el JS: no reciben este cambio hasta publicar nuevas versiones en las tiendas (§7).

**Antes del paso 6 (hallazgos de la revisión de seguridad):**
- **Migración de `routeId`** (paso 2): **no se ejecuta `migrate-route-ids.html`** (modifica trazados, ascensos y votos, elige la primera coincidencia ante ambigüedad y hace `update` sobre `route-photos`, que las reglas nuevas deniegan). Evaluación y procedimiento seguro: [ROUTEID-MIGRATION.md](ROUTEID-MIGRATION.md).
- **Borrar fotos siempre desde la app** (o dejando una marca en `route-photo-tombstones/{id}`). Borrar solo el documento desde la consola o con credenciales de servicio permite al autor recrear el id.
- `scripts/storage-optimize.py --resize` reescribe objetos de `route-photos/` (reinicia `timeCreated`). Con esta política es inocuo (manda `uploadedAt`), pero conviene no ejecutarlo en las 12 h posteriores a una subida.
- **Apps y clientes con código antiguo (§7):** no pueden subir fotos de vía con las reglas nuevas (falla en Storage, sin dejar nada). Un administrador que borre una foto ANTIGUA con un cliente antiguo deja un **documento huérfano**
  (borra el archivo y el documento se rechaza): borrar con el cliente nuevo. Ver la propuesta de detección y limpieza (no implementada).

## 4. Antes de desplegar (lista de comprobación)

- [ ] `npx vitest run` en verde y la regresión de Fase 0: `JAVA_HOME=<jdk21> tests/integration/rules/phase0/run-phase0.sh`.
- [ ] `node tests/integration/rules/phase0/mutations-0c.cjs` (con el emulador arrancado): todas las mutaciones detectadas.
- [ ] `node tests/integration/rules/phase0/rules-engine-check.cjs` (necesita `gcloud auth login`): todos los casos coinciden en el motor real.

> **Estado de las tres comprobaciones anteriores a 2026-11-19.** **Ejecutadas el 2026-11-19** (detalle, horas y cifras en [STORAGE-DEPLOY.md](STORAGE-DEPLOY.md) §8): `run-phase0.sh` (exit 0, todas las suites de propuesta superadas), `mutations-0c.cjs` (22 mutaciones: **21 detectadas y 1 equivalente**; su primer intento quedó bloqueado por infraestructura y no se contó) y `rules-engine-check.cjs` (**1 043 de 1 043** casos coinciden en el motor real, solo `projects:test` con datos simulados). **JDK 21 (21.0.12.1) está instalado, pero JDK 17 (17.0.17) sigue siendo el `java` predeterminado**: JDK 21 solo se usa con `JAVA_HOME` en cada comando. **Qué NO sustituyen ni demuestran:** no sustituyen al canario; no validan los permisos IAM reales Storage → Firestore, las subidas reanudables, las redes lentas, la hora real de producción ni el plazo de 12 h (que en esta variante no se prueba en producción); el emulador no aplica el límite de 2 documentos por regla y el motor real se probó con datos simulados. Si cambian las reglas, el cliente o las suites después del 2026-11-19, esos resultados dejan de valer y hay que repetirlas. Estas ejecuciones **no son una autorización de despliegue**. La tercera necesitó una sesión `gcloud` activa (se usó la cuenta ya autenticada, sin cambiar cuentas ni permisos). Las casillas de arriba describen el procedimiento; el resultado vigente es el de §8. **Las cifras anteriores a esa fecha (73, 105, 53, 52, 962…) son históricas**; las que coinciden o difieren (p. ej. 64 y no 53 en `route-photos-orphans-tool.cjs`) están indicadas en §8.
> **Qué NO demuestran las pruebas de guardas (STORAGE-CANARY.md §1.4):** las 270 comprobaciones usan *stubs* en memoria y demuestran la lógica de las guardas, **no** el comportamiento real de Firebase (códigos de error, `getMetadata`, permisos entre servicios) **ni los tiempos**; eso solo lo demuestra el canario. `vitest` (653) protege el repositorio, no el procedimiento.
- [ ] **No hay deriva**: el release activo sigue siendo el esperado. Si no lo es, parar y revisar.
  ```bash
  TOKEN=$(gcloud auth print-access-token); P=climbmaps-80cae
  curl -s -H "Authorization: Bearer $TOKEN" -H "x-goog-user-project: $P" \
    "https://firebaserules.googleapis.com/v1/projects/$P/releases/firebase.storage/$P.firebasestorage.app" | grep rulesetName   # → …/16df6449-48f8-473b-82ba-8325bf7d0093
  curl -s -H "Authorization: Bearer $TOKEN" -H "x-goog-user-project: $P" \
    "https://firebaserules.googleapis.com/v1/projects/$P/releases/cloud.firestore" | grep rulesetName                              # → …/d2908fdf-91b5-4819-bd7b-b823f2e98eed
  ```
- [ ] `shasum -a 256 -c docs/security-phase0/RULES-MANIFEST.sha256` imprime cuatro «OK» (`storage.rules.previous` = `29cc65bd…b887`; `firestore.rules.previous` y `firestore.rules` = md5 `311a726e…`).
- [ ] **Copia de seguridad fuera del repositorio** (conserva las reglas anteriores y las nuevas y los ids activos, por si el clon no estuviera disponible):
  ```bash
  D=~/krux-backups/rules-release-$(date +%Y%m%d-%H%M); mkdir -p "$D"
  cp storage.rules.previous firestore.rules.previous storage.rules docs/security-phase0/firestore.rules.route-photos-only.proposal docs/security-phase0/RULES-MANIFEST.sha256 "$D"/
  TOKEN=$(gcloud auth print-access-token); P=climbmaps-80cae
  for r in firebase.storage/$P.firebasestorage.app cloud.firestore; do curl -s -H "Authorization: Bearer $TOKEN" -H "x-goog-user-project: $P" "https://firebaserules.googleapis.com/v1/projects/$P/releases/$r"; done > "$D/releases-antes.json"
  (cd "$D" && shasum -a 256 *.rules* *.proposal > SHA256SUMS.txt && cat SHA256SUMS.txt)
  ```
- [ ] **C0d justo antes de desplegar Storage** ([STORAGE-CANARY.md](STORAGE-CANARY.md) §1.1): con la sesión de A, en su **perfil de navegador exclusivo para el canario**, `kxRpPendingLoad()` → `[]` (cola vacía, sin ninguna entrada pendiente). Si no lo está: **no se despliega**; se investiga el origen y se resuelve **fuera de este procedimiento** (no con el uso normal de la aplicación).
- [ ] Autorización expresa del propietario para cada despliegue.
- [ ] **Después de cada despliegue** (pasos 4 y 6 de §3.3), comprobar que el release activo contiene exactamente lo que se pretendía desplegar:
  ```bash
  TOKEN=$(gcloud auth print-access-token); P=climbmaps-80cae; B=$P.firebasestorage.app; H="x-goog-user-project: $P"
  show() { RS=$(curl -s -H "Authorization: Bearer $TOKEN" -H "$H" "https://firebaserules.googleapis.com/v1/projects/$P/releases/$1" | python3 -c "import json,sys;print(json.load(sys.stdin)['rulesetName'])")
           echo "$1 → $RS"; curl -s -H "Authorization: Bearer $TOKEN" -H "$H" "https://firebaserules.googleapis.com/v1/$RS" | python3 -c "import json,sys,hashlib;print(hashlib.sha256(json.load(sys.stdin)['source']['files'][0]['content'].encode()).hexdigest())"; }
  show firebase.storage/$B; shasum -a 256 storage.rules      # los dos hashes deben coincidir tras desplegar Storage
  show cloud.firestore;     shasum -a 256 docs/security-phase0/firestore.rules.route-photos-only.proposal    # idem tras desplegar Firestore (el archivo desplegado es la propuesta)
  ```

## 5. Verificación en Firebase real (canario)

El procedimiento completo —cuentas, pasos C1–C30 (C26, C27 y C30 excluidas en la variante sin excepciones) con sus fragmentos de consola, redes lentas, fallos parciales, límites temporales, criterios de parada y vuelta atrás— está en **[STORAGE-CANARY.md](STORAGE-CANARY.md)**.
Sus resultados esperados se ensayan en el emulador con `canary-dry-run.cjs` (73 comprobaciones en las dos puertas; cifra histórica, **pendiente de verificación**: §8), de modo que un resultado distinto en producción indica un problema de despliegue y no un error de la lista.
Lo que **solo** puede demostrar Firebase real: el permiso entre servicios (C11), `resource == null` con tráfico real (C13, C15), si las reglas se evalúan al finalizar una subida reanudable (C22–C24). El límite de 12 h con la hora del servidor (C27, C30) **no** se comprueba en producción en la variante sin excepciones: solo lo cubren el emulador con plazos escalados y el motor real de reglas con datos simulados.

## 6. Recuperación

Las reglas no escriben ni modifican archivos o datos: recuperar es solo volver a publicar el ruleset anterior. Es inmediato.

**Qué se conserva y dónde (sin depender de git ni de que `HEAD` contenga las reglas antiguas):** las reglas **anteriores** (`storage.rules.previous`, `firestore.rules.previous`) y las **nuevas** (`storage.rules`, la propuesta `route-photos-only`) son archivos versionados y con su SHA-256 en `docs/security-phase0/RULES-MANIFEST.sha256`;
además, §4 deja una copia con hashes y los ids de release fuera del repositorio. Ningún paso de despliegue o de recuperación modifica esos archivos. Una prueba (`tests/rules-rollback-rehearsal.test.js`) falla si alguno cambia o si este apartado vuelve a depender de comandos de git.

```bash
P=climbmaps-80cae; B=$P.firebasestorage.app
OLD_STORAGE=16df6449-48f8-473b-82ba-8325bf7d0093; OLD_FIRESTORE=d2908fdf-91b5-4819-bd7b-b823f2e98eed
TOKEN=$(gcloud auth print-access-token)
volver() {   # volver <release> <id del ruleset anterior>
  curl -s -X PATCH -H "Authorization: Bearer $TOKEN" -H "x-goog-user-project: $P" -H "Content-Type: application/json" \
    "https://firebaserules.googleapis.com/v1/projects/$P/releases/$1" \
    -d "{\"release\":{\"name\":\"projects/$P/releases/$1\",\"rulesetName\":\"projects/$P/rulesets/$2\"}}"
}
```
**Vía A (preferida; no necesita archivos ni la CLI): reactivar el ruleset anterior por su id.**
```bash
volver firebase.storage/$B $OLD_STORAGE        # Storage → 16df6449…
volver cloud.firestore     $OLD_FIRESTORE      # Firestore → d2908fdf…
```
Después, **verificar** (el release debe mostrar el id anterior y el contenido su hash):
```bash
for r in firebase.storage/$B cloud.firestore; do
  RS=$(curl -s -H "Authorization: Bearer $TOKEN" -H "x-goog-user-project: $P" "https://firebaserules.googleapis.com/v1/projects/$P/releases/$r" | python3 -c "import json,sys;print(json.load(sys.stdin)['rulesetName'])")
  echo "$r → $RS"; curl -s -H "Authorization: Bearer $TOKEN" -H "x-goog-user-project: $P" "https://firebaserules.googleapis.com/v1/$RS" | python3 -c "import json,sys,hashlib;print(hashlib.sha256(json.load(sys.stdin)['source']['files'][0]['content'].encode()).hexdigest())"
done
shasum -a 256 storage.rules.previous firestore.rules.previous   # deben coincidir, en este orden, con los dos hashes anteriores
```
**Vía B (con la CLI, desde los archivos conservados): volver a publicar las reglas anteriores.** Usa la función `publicar` de §3.4 y no toca ningún archivo del repositorio:
```bash
publicar storage   storage.rules.previous
publicar firestore firestore.rules.previous
```
Cada servicio se recupera **por separado**: Storage no depende de Firestore para volver atrás, y viceversa. Si el clon no está disponible, los mismos archivos están en la copia de §4 (`$D`) y la vía A solo necesita los ids.


### Diferencias entre la vía A (API/PATCH) y la vía B (CLI) — medidas el 2026-11-16 en el proyecto de pruebas
| | **Vía A** (`PATCH` por id) | **Vía B** (`firebase deploy --only …` con el archivo conservado) |
|---|---|---|
| Qué hace | mueve el release a un ruleset que **ya existe** | sube el archivo (crea un ruleset **nuevo**) y mueve el release |
| Tras volver atrás | el release apunta al **mismo id** de antes (`16df6449…`, `d2908fdf…`) | el release apunta a un **id nuevo** con el **mismo contenido** (medido: ruleset `15cb3bc1…` desplegado, `92cfb65c…` tras el rollback; SHA-256 idéntico) |
| Necesita | los ids de los rulesets anteriores y un token (`gcloud`) | la CLI con sesión iniciada, el archivo exacto y el proyecto en `--project` |
| Validación previa | la API comprueba que el ruleset existe y la máscara (400 explícito si no) | la CLI compila el archivo antes de subirlo (los avisos de «función no usada» de `firestore.rules` son los mismos que en producción) |
| Peculiaridades (código de `firebase-tools` 15.3.0) | ninguna: es una sola llamada | **no sube nada si el contenido ya es el del release activo** («already up to date») y por tanto no «re-activa» un ruleset antiguo; usa por debajo el mismo `PATCH` y, **si falla, lo reintenta como `POST` (crear)** sin avisar del primer error |
| Storage con reglas entre servicios (`firestore.get/exists`) | no toca IAM | en modo interactivo la CLI comprueba el rol `roles/firebaserules.firestoreServiceAgent` de la cuenta de servicio de Storage y, si falta, **pregunta (por defecto sí) si lo concede**, es decir, modifica IAM. En producción el rol ya existe (comprobado el 2026-11-14), así que no debería preguntar; **si pregunta, responder que no y parar**. Con `--non-interactive` omite la comprobación |
| Permisos con **`roles/firebaserules.admin` solo** (**medido el 2026-11-16 con una cuenta de servicio temporal**) | **Funciona** (`releases.{get,list,update,create,delete}`, `rulesets.{get,list,create,delete,test}`): ensayo completo de Firestore con el script, comprobado con lecturas | **NO funciona**: la CLI comprueba antes que la API esté habilitada (`serviceusage.services.get`, que ese rol no incluye) y se detiene con `Permission denied to get service [firestore.googleapis.com]`, tanto normal como con `--non-interactive`; no crea nada. Hace falta una identidad que además pueda leer los servicios del proyecto (la cuenta propietaria que se usaría en producción la tiene). Sumar `serviceusage.services.get` a un rol mínimo **no se probó** (no autorizado); en Storage, además, la comprobación de IAM de la CLI (solo código) |

### Procedimiento de rollback recomendado y su estado de validación
| Servicio | Recomendado | Respaldo | Validado en ejecución real | Pendiente |
|---|---|---|---|---|
| **Firestore** | Vía A (id exacto, una llamada, sin archivos) | Vía B | **Vía A:** `rules-rollback-rehearsal.sh` (3 ejecuciones, **una con la cuenta mínima `firebaserules.admin`**) y `PATCH` manuales, con hash comprobado. **Vía B:** desplegar el anterior, el nuevo y volver al anterior con la función `publicar` de §3.4; el contenido recuperado coincide byte a byte | Vía B con el rol mínimo: **no funciona solo con `firebaserules.admin`** (ver arriba); qué permiso mínimo adicional basta, sin probar |
| **Storage** | Vía A (mismo `PATCH`, release `firebase.storage/<bucket>`) | Vía B | **Vía A, solo a nivel de la API de Reglas**: crear los dos rulesets de Storage, activar el nuevo, `PATCH` al anterior y hash `29cc65bd…` correcto, sobre un release de un bucket que **no existe** (la API no lo valida). Independencia respecto a Firestore comprobada en la API real. **Vía B:** el comando documentado falla de forma limpia y sin crear nada: `Firebase Storage has not been set up on project…` | **Vía B con éxito y que Storage use de verdad el ruleset reactivado**: requiere un bucket (facturación). Prompt de IAM de la CLI |
Reglas de uso: (1) antes de tocar nada, apuntar los ids y hashes de los releases activos (§4); (2) volver atrás **un servicio cada vez** y verificar con lecturas (`GET` del release y hash del contenido) antes del siguiente; (3) si hay que usar la vía B, verificar después el id nuevo y el hash; (4) nunca usar `firebase deploy` sin `--only`.

### 6.1 Ensayo de la vuelta atrás (proyecto de pruebas) — estado y límites
`scripts/rules-rollback-rehearsal.sh <proyecto>` ejecuta la misma operación de recuperación para Storage y Firestore: crea el ruleset anterior y el nuevo, los activa en orden, reactiva el anterior con **el mismo PATCH** de la vía A y comprueba el SHA-256 del contenido activo. Se niega a ejecutarse contra `climbmaps-80cae` o contra un id que recuerde al de producción, y exige confirmar el proyecto dos veces (`KRUX_REHEARSAL_PROJECT`).
```bash
# Solo con un proyecto de pruebas DEDICADO (Firestore creado; para Storage la API de Reglas acepta un release aunque no haya bucket). Escribe rulesets y mueve sus releases.
KRUX_REHEARSAL_PROJECT=<proyecto-de-pruebas> scripts/rules-rollback-rehearsal.sh <proyecto-de-pruebas>
```
**Estado a 2026-11-16 (qué está validado, qué está documentado y qué está pendiente):**
- **Validado mediante ensayo real** (proyecto `krux-rules-test-a7f3`, sin facturación; detalle en [ROLLBACK-TEST-PROJECT.md](ROLLBACK-TEST-PROJECT.md) §9 y §10): vía A de Firestore; vía B de Firestore; vía A de Storage solo a nivel de la API de Reglas (sin bucket); independencia de ambos releases.
- **Validado solo con una API simulada:** el comportamiento del script ante una API que miente (200 sin cambiar el release, contenido distinto); la API real respondió 400 explícito en todas las variantes incorrectas que se probaron.
- **Documentado, no ejecutado con éxito:** vía B de Storage (la CLI se detiene antes de crear nada porque no hay bucket); concesión de IAM de la CLI.
- **Validado con el rol mínimo (2026-11-16):** la vía A de Firestore con una cuenta de servicio que solo tiene `roles/firebaserules.admin`; sin ese rol, todas las lecturas y escrituras dan 403. La vía B (CLI) con ese rol **falla** en la comprobación de APIs (`serviceusage.services.get`).
- **Validado `--non-interactive` (Firestore, sesión del propietario):** salida idéntica a la ejecución normal en los tres despliegues; no hay preguntas en ninguna de las dos; la política IAM, los servicios habilitados, la base de datos, Hosting, la facturación y los buckets no cambian en ninguno de los seis despliegues. Su efecto sobre Storage (omitir la comprobación de IAM) está **leído en el código, no ejecutado**.
- **Pendiente de validación real:** que un bucket de Storage use el ruleset reactivado (exige crear un bucket, es decir, facturación) y la vía B de Storage completa; qué permiso mínimo adicional permite a la CLI trabajar sin ser propietaria.
- **Limitaciones del proyecto de pruebas:** sin bucket de Storage (`defaultBucket` da 404 y crearlo da 403 sin Blaze) y sin datos; el release de Storage del ensayo apunta a un bucket inexistente, que la API de Reglas acepta; el hash se compara con el contenido que devuelve la API.

**Cliente:** revertir **solo** `route-photos.js` (+ `www/`) y subir `CACHE_VERSION` otra vez (p. ej. `v308`; volver a un número usado no obligaría al navegador a reinstalar el Service Worker). No es necesario con las reglas
actuales: el cliente nuevo funciona con ellas.

**Datos:** no hay nada que deshacer. Las marcas `route-photo-tombstones/*` creadas por el cliente nuevo son inertes con las reglas anteriores (la colección queda sin regla = denegada) y se pueden dejar o borrar con
credenciales de servicio. Las fotos y documentos creados con el formato nuevo se leen igual con cualquier regla.

## 7. Apps nativas y versiones antiguas

**No se presupone que los binarios instalados coincidan con el repositorio.** Evidencia disponible y límites:
- Capacitor carga el JS **empaquetado** en el binario (`server.url` no está definido): una app instalada conserva el código con el que se compiló hasta que se actualice desde la tienda.
- **No se puede saber qué versiones hay en las tiendas**: `android/app/build.gradle` (`versionCode 1`, `versionName "1.0"`) y `ios/App/App.xcodeproj` (`MARKETING_VERSION 1.0`, build `1`) son idénticos en todas las compilaciones, `ios/` y `android/` están
  en `.gitignore` y no hay herramientas de publicación en el repositorio. Las compilaciones locales de la copia de trabajo son del 14-nov-2026 (Service Worker v305).
- **Versiones del cliente de fotos de vía que existen en el historial de git** (4 contenidos distintos; `main` = la de abril; el Hosting `climbmaps-80cae.web.app` = la de febrero):
  | Commit | Fecha | Diferencia relevante |
  |---|---|---|
  | `687cf4d` | 2026-01-15 | id del documento `{escuela}_{nombre de la vía}_{ms}`, sin `routeId`; consulta solo por nombre |
  | `bc499df` | 2026-02-14 | id con `routeId`; consulta por `routeId` y reserva por nombre |
  | `dcf81de` | 2026-04-13 | el spotter pasa la comprobación **del cliente** para borrar (las reglas actuales ya lo permitían por el comodín) |
  | `f90d020` | 2026-10-29 | reduce la imagen y fija `Cache-Control` |
  Todas suben **el archivo primero** a `route-photos/{escuela}/{ms}_{nombre}.{ext}` (sin uid) y después crean el documento sin `storagePath`; todas borran el archivo con esa ruta antigua (ignorando errores) y después el documento.
- **Los documentos reales de 2025 son anteriores a todas ellas**: 4 de los 5 no tienen `routeId` y su id lleva el nombre de la vía (formato de enero de 2026), y uno tiene `routeId` y nombre en el id (un formato intermedio). Hubo, por tanto, al menos una versión
  anterior al historial. Los binarios de 2025 no son comprobables; su comportamiento se infiere del formato de lo que escribieron (mismo patrón: archivo primero en la ruta sin uid, documento sin `storagePath`).
- Interfaz: el código que dispara subir/borrar foto de vía (`.upload-photo-btn`, `.delete-photo-btn`) **no lo pinta ningún código de `dev`, `main` ni del Hosting actual** (solo existen los manejadores y el CSS). No se puede descartar que una compilación anterior al historial lo pintara.
- Antes de tocar nada, los clientes antiguos ya limitaban en el propio cliente la subida a administradores y al rol `photo_uploader`.

**Qué ocurre con cada versión antigua** (`route-photos-legacy-clients.cjs`: las 4 versiones reales ejecutadas con el SDK contra el emulador; estados del despliegue A = reglas finales, B = Firestore final + Storage anterior, C = Storage final + Firestore actual):

| Operación | Resultado con las reglas finales (A) | ¿Huérfanos? |
|---|---|---|
| **Subir** (admin o `photo_uploader`) | Falla en Storage (`unauthorized`) antes de crear el documento | **No** |
| Subir en el estado B (Firestore final antes que Storage; **no ocurre con el orden recomendado Storage→Firestore**) | El archivo sí se sube (comodín) y el documento se rechaza | **Archivo huérfano** en la ruta antigua, solo hasta desplegar Storage |
| Subir en el estado C | Falla en Storage | No |
| **Leer** (listar por escuela y vía; fotos antiguas, con `routeId` y nuevas) | Funciona en las 4 versiones; las fotos nuevas se muestran (URL sin token con lectura pública) | — |
| **Borrar una foto NUEVA** (autor) | Falla; el cliente antiguo apunta a la ruta antigua del archivo, que no existe: no se borra nada | **No** (documento y archivo intactos) |
| **Borrar una foto ANTIGUA**: autor, spotter, usuario ajeno | Se rechaza (o lo impide el propio cliente); no cambia nada | No |
| **Borrar una foto ANTIGUA: administrador con cliente antiguo** | Borra el archivo (permitido) y el documento se rechaza (sin marca) | **Documento huérfano** visible con la imagen rota. Mitigación: borrar con el cliente nuevo; un admin puede limpiarlo |

Mejora colateral: un spotter con un cliente antiguo ya no puede borrar fotos ajenas (antes lo permitía el comodín).

- Perfil, publicaciones, vídeos, imágenes de sector y rocódromos usan las mismas rutas que antes y siguen funcionando con cualquier versión (rutas históricas: `profile-photos/{uid}/{ms}_{nombre}`, `posts/{uid}/{…}`, `sector-images/{escuela}/{sector}.jpg`,
  `sector-images/{escuela}/{sector}/{img_…}.jpg`, `gym-photos/{uid}/{gym}_{ms}.{ext}`; `profile-banners/` no aparece nunca en el código).
- HEIC: el cliente de fotos de vía solo acepta JPEG, PNG y WebP (igual que antes); si iOS entrega HEIC se rechaza con el mensaje de siempre. Perfil y posts no restringen el tipo (igual que hoy).

## 8. Pruebas: emulador frente a Firebase real

**Estado de verificación a 2026-11-19 — léase antes de fiarse de cualquier cifra de esta sección.** Se distinguen tres categorías: **ejecutado el 2026-11-19** (resultado real de una ejecución de ese día, con comando y salida conservada); **histórico** (cifra declarada en un documento sin ejecución fechada: **no es validación actual**, marcada con (†)); y **pendiente** (no ejecutado). El 2026-11-19 se instaló JDK 21 (21.0.12.1, de Homebrew, sin cambiar el `java` por defecto del equipo, que sigue siendo JDK 17.0.17) y se ejecutaron, **por separado y en este orden**: (1) `run-phase0.sh`, de 00:09:54 a 00:13:04 (hora local), exit 0 y 0 fallos en todas las suites de la propuesta; (2) `mutations-0c.cjs`: **el primer intento quedó BLOQUEADO por infraestructura** (el emulador de Storage dejó de responder tras 4 mutaciones; no se contó como resultado) y el **segundo intento** (00:52:02–01:06:25 hora local, emulador nuevo) terminó con exit 0: 22 mutaciones, 21 detectadas y 1 equivalente; (3) `rules-engine-check.cjs` contra el motor real de Firebase Rules del proyecto de producción (solo `projects:test`, datos simulados; no despliega ni escribe nada), 01:08:17–01:08:32 hora local, exit 0: 1 043 de 1 043 casos coinciden. **Qué demuestran:** el comportamiento de las reglas propuestas en el emulador local (proyecto `demo-krux-phase0`, sin Firebase real), que la suite detecta cada regla rota a propósito, y que el motor real interpreta las reglas como se espera con datos simulados. **Qué NO demuestran:** los permisos IAM reales Storage → Firestore, las subidas reanudables, las redes lentas, la hora real de producción ni el plazo de 12 h (eso lo comprueba, o no, el canario). Las ejecuciones **no son una autorización de despliegue**. Hasta el 2026-11-18 este apartado solo recogía cifras históricas: la fecha del registro del emulador (`.emulator-phase0.log`) **ya no sirve como evidencia de nada**, porque el archivo se reescribe en cada arranque; la **última ejecución anterior** documentada era la de [TEST-STABILITY.md](TEST-STABILITY.md) §4 (archivo del 2026-11-16 03:26, sin fecha de cada ejecución).

| Suite o cifra | Cifra declarada (histórica) | Resultado ejecutado el 2026-11-19 | Estado |
|---|---|---|---|
| `storage-phase0c-rules.cjs` | 294/294 (TEST-STABILITY.md §4) | **294/294** con las reglas de Storage de `storage.rules` y los dos Firestore (0c y «solo route-photos»), 0 fallos | **ejecutada y coincide** con la cifra histórica |
| `route-photos-client.cjs` | no declarada en este documento | **102/102** (las dos configuraciones de Firestore), 0 fallos | ejecutada |
| `route-photos-legacy-clients.cjs` | no declarada en este documento | **54/54** (las dos configuraciones), 0 fallos | ejecutada |
| `deployment-states.cjs` | 105 (solo este documento, sin fecha) | **105/105**, 0 fallos | **ejecutada y coincide** |
| `canary-dry-run.cjs` | 73, dos puertas (solo este documento, sin fecha) | **73/73**, 0 fallos. **No está adaptada** al procedimiento actual (bloques 1–3, C0e, ayudantes `intenta…`): reproduce el comportamiento de las reglas, no los pasos | ejecutada; **coincide** con la cifra, pero no valida el procedimiento |
| `route-photos-orphans-tool.cjs` | 53 (solo este documento, sin fecha) | **64/64**, 0 fallos | ejecutada; **la cifra histórica (53) estaba desfasada**: hoy la suite tiene 64 comprobaciones |
| `admin-orphan-resolution.cjs` | 52 (TEST-STABILITY.md §4 y este §8) | **52/52**, 0 fallos | **ejecutada y coincide** |
| Resto de `run-phase0.sh` | no declaradas aquí | Regresión de reglas existentes (6 suites × 2 modos, todas correctas), suites de la 0b contra el Firestore 0b y 0c, `drawings-0c.cjs` 108/108, revisión 0 (50/50, 39/39, 1/1); 0 fallos en todas las de propuesta. El bloque «reglas ACTUALES de producción» **muestra incumplimientos de política por diseño** (p. ej. 56/149 en `votes-rules`) y no cuenta como fallo | ejecutadas |
| `mutations-0c.cjs` | 22 mutaciones: 21 detectadas y 1 equivalente (TEST-STABILITY.md §4 y este §8) | **22 mutaciones: 21 DETECTADA y 1 EQUIVALENTE** («la subida no exige que exista el documento»: 0 fallos porque `uploadedBy` ya falla sin documento), 0 supervivientes ni inválidas. Primer intento BLOQUEADO por infraestructura (ver arriba), no contado | **ejecutada (segundo intento) y coincide** |
| `rules-engine-check.cjs` | rejilla de 962 (910 + 52), 11 casos de A1 y 1 043 casos en total | **1 043 de 1 043 coinciden**: Storage 40, Firestore 8, A1 11, rejilla Storage 910/910, rejilla de subida 22/22, rejilla Firestore 52/52; ningún caso consulta más de 2 documentos. Cuenta de gcloud activa, solo `projects:test`; salida completa conservada fuera del repositorio | **ejecutada y coincide** con las cifras históricas |
| `tests/rules-rollback-rehearsal.test.js` | «8 pruebas» (cifra anterior, **desfasada**) | **12 pruebas**, verificado con `vitest` el 2026-11-18 (no repetido el 2026-11-19) | verificada el 2026-11-18 |
| `vitest` completo | 653 | **653/653**, verificado el 2026-11-18 (no repetido el 2026-11-19; protege el repositorio, no el procedimiento) | verificado el 2026-11-18 |
| **Pendiente (no ejecutado)** | — | El canario en producción (permisos IAM Storage → Firestore, subidas reanudables, redes lentas, ventana de 5 min real); el plazo de 12 h (no se prueba en producción en esta variante); `soak.sh`, `emulator-concurrency-probe.cjs` y las demás sondas de estabilidad; el ensayo con bucket real de Storage (§6.1) | pendiente |

(†) en las tablas siguientes = cifra histórica del cuadro anterior; **donde la tabla de arriba da un resultado ejecutado el 2026-11-19, ese resultado sustituye al (†)** (las cifras coinciden salvo `route-photos-orphans-tool.cjs`: 64, no 53, y `rules-rollback-rehearsal`: 12, no 8). Las filas de «Firebase real» describen lo que comprobará el canario, que **no se ha ejecutado**.

| Qué | Emulador | Firebase real (procedimiento vigente en [STORAGE-CANARY.md](STORAGE-CANARY.md)) |
|---|---|---|
| Matriz carpeta × usuario × operación (perfil, posts, sector, vías, rocódromos, resto denegado) | `storage-phase0c-rules.cjs` (†) | puerta S (C1, C3, C4b, C7b, C7d, C8, C11, C12, C15b) y grupo P completo (C1–C10b, bloque 2) |
| Plazos de 11 h 59 min y 12 h 01 min, ventana de subida de 5 min, orden documento↔archivo | `storage-phase0c-rules.cjs` §6 (con `uploadedAt` sembrado), §11 y §12 (plazo escalado a 8 s y ventana a 5 s, ejercitan `timeCreated`) (†) | `rules-engine-check.cjs` (motor real, datos simulados, sin desplegar; rejilla de 962 combinaciones (†)). **En producción solo se comprueba la ventana de 5 min** (C28 y C29, bloque 3); el plazo de 12 h **no** se comprueba (C27 y C30 excluidas) |
| Ninguna operación supera las 12 h desde la aceptación del documento (borrar y resubir, sobrescribir, subidas simultáneas, recrear con y sin marca, borrar el documento primero) | §7, §7b, §11, §12 (barrido tras vencer el plazo con seis historiales distintos) (†) | `rules-engine-check.cjs` (rejilla Storage 910 + Firestore 52 (†)); **no se comprueba en producción** (C27 y C30 excluidas) |
| Fallos parciales, reintentos (incluido el reintento solo si el primer fallo fue rápido) y concurrencia con el cliente real | `route-photos-client.cjs` (†), `tests/route-photos.test.js` (vitest, verificado el 2026-11-18) | — |
| Compatibilidad del cliente nuevo con las reglas actuales y con los estados intermedios del despliegue (Storage final + Firestore actual, y Firestore final + Storage anterior) | `route-photos-client.cjs` §P, §P2/P3 (†) | puerta S (C11, C10a, C15b: Storage final + Firestore anterior) y bloque 1 (Firestore final). El estado Firestore final + Storage anterior solo se da si hay que revertir Storage |
| **Documentos huérfanos**: diario de subidas (capa 1) y herramienta de informe/plan/archivado/restauración (capas 2 y 3) | `tests/route-photos.test.js` (diario), `tests/route-photos-orphans.test.js` (estático) (vitest, verificados el 2026-11-18), `route-photos-client.cjs` §J, `route-photos-orphans-tool.cjs` (53 comprobaciones; trazados y Storage intactos) (†) | informe de solo lectura en producción |
| **Capa 0 = A0** (resolución atómica por administradores con marca, con las reglas vigentes; A1 estudiada y **no adoptada**) | `admin-orphan-resolution.cjs` (52 comprobaciones) (†) | `rules-engine-check.cjs` (sección A1, 11 casos) (†) |
| **Estados intermedios del despliegue** (qué puede hacer un usuario en cada combinación Firestore/Storage; sin cortes de servicio) | `deployment-states.cjs` (105 comprobaciones) (†) | puerta S (C1–C15b) |
| **Estabilidad de las pruebas con tiempo real** (causas de la intermitencia, plazos medidos en vez de esperas fijas, bloqueo del emulador bajo carga y cómo se clasifica) | [TEST-STABILITY.md](TEST-STABILITY.md); `soak.sh`, `emulator-concurrency-probe.cjs`, `mutations-0c.cjs` (22 mutaciones) (†) | — |
| **Ensayo del canario** (los resultados esperados de STORAGE-CANARY.md) | `canary-dry-run.cjs` (73 comprobaciones, dos puertas) (†; no adaptada al procedimiento actual) | el procedimiento de [STORAGE-CANARY.md](STORAGE-CANARY.md) §2 |
| **Reglas conservadas y vuelta atrás** (hashes de las reglas anteriores y nuevas; el ensayo del PATCH de recuperación contra una API simulada; el apartado 6 sin git ni rutas locales) | `tests/rules-rollback-rehearsal.test.js` (**12 pruebas**, verificadas el 2026-11-18 con vitest; la cifra anterior era 8) | el ensayo en un proyecto de pruebas real (§6.1, pendiente) |
| Fotos antiguas y **clientes antiguos** (4 versiones reales de git: subir, leer, borrar; huérfanos; 4 estados del despliegue) | §9, `route-photos-client.cjs` §L y `route-photos-legacy-clients.cjs` (†) | C21 (foto antigua L1: leerla y comprobar que el autor no puede borrarla; bloque 2); las apps de tienda no son comprobables |
| Las pruebas tienen capacidad de detección | `mutations-0c.cjs` (22 mutaciones: 21 detectadas y 1 equivalente declarada) (†) | — |
| **Permisos IAM de Storage → Firestore**, subidas reanudables (¿se evalúan las reglas al finalizar?), redes lentas, apps nativas | **no** | C11 y C11b (permiso entre servicios); C22–C24 (subidas reanudables y redes lentas; bloque 3); las apps nativas **no** se comprueban en el canario |
| `resource.timeCreated` con hora real de producción | semántica comprobada, hora real del emulador (†) | `rules-engine-check.cjs` (semántica) (†); la hora real de producción **no** se comprueba (C27 y C30 excluidas) |
| Número de documentos consultados por regla (límite 2) | no se aplica el límite | `rules-engine-check.cjs` (lo cuenta el motor real) (†) |

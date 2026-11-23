# Documentos huérfanos de fotos de vía — capas 1, 2 y 3 implementadas (sin ejecutar ninguna limpieza real); capa 0: se mantiene A0 (sin cambios de reglas)

**Estado (2026-11-15):** aprobadas e **implementadas las capas 1, 2 y 3**. **Decisión del propietario sobre la capa 0: se mantiene A0** (resolver con las reglas vigentes, sin tocar ninguna regla); **A1 no se adopta ni se implementa**. Procedimiento administrativo: [STORAGE-ORPHANS-RUNBOOK.md](STORAGE-ORPHANS-RUNBOOK.md).
**No se ha ejecutado ninguna limpieza real**: la herramienta solo se ha probado contra el emulador con datos sintéticos y, en producción, solo en modo informe (lectura).
**Prohibición absoluta, por diseño:** nada de esto borra ni modifica dibujos de vías, sectores ni ningún otro dato asociado, y no se borra ningún archivo de Storage (ver §7).

| Capa | Qué es | Dónde | Estado |
|---|---|---|---|
| 1 | Diario de subidas del cliente: anota, comprueba e **informa**; **no limpia nada solo** | `route-photos.js` (`kxRpInterruptedUploads`, `kxRpDiscardInterruptedUpload` explícita) | Implementada |
| 2 | Herramienta local **exclusivamente informativa** (`report`) | `scripts/route-photos-orphans.py` | Implementada |
| 3 | Archivado reversible y limpieza **por lotes con aprobación explícita** (`plan`, `apply`, `restore`) | `scripts/route-photos-orphans.py` | Implementada; **sin ejecutar** |
| 0 | Que los administradores resuelvan los huérfanos de clientes antiguos | **A0**: lote atómico «borrar + marca» con las reglas vigentes (cliente nuevo o herramienta) | **Adoptada A0 (sin cambios de reglas)**; A1 descartada |

## 1. Qué es un «documento huérfano» y de dónde salen
Documento `route-photos/{id}` cuyo archivo de Storage ya no existe (o nunca llegó). La foto aparece en la app con la imagen rota. El inverso (**archivo sin documento**) también existe, pero **solo se informa; nunca se borra** (§7).

| Origen | Cuándo ocurre | Frecuencia esperada |
|---|---|---|
| **O1. Cliente antiguo de un administrador borra una foto ANTIGUA** (el caso que se pide analizar) | Borra el archivo (legacy: solo admin puede) y el documento se rechaza (sin marca) | Baja: exige admin + binario antiguo + foto antigua (5 documentos) |
| **O2. Subida interrumpida con el cliente nuevo** (pestaña cerrada, app matada, móvil sin batería entre crear el documento y recibir el archivo) | El documento existe, el archivo ya no podrá llegar (la ventana de 5 min se cierra) y no hay ninguna entrada pendiente que lo limpie | **La más probable** en uso móvil |
| O3. Falló la limpieza tras una subida fallida y se perdió el almacenamiento local (cola pendiente) | Raro | Muy baja |
| O4. Borrado desde la app interrumpido tras borrar el archivo y perdida la cola pendiente | Raro | Muy baja |
| O5. Alguien borra el archivo por consola o con credenciales de servicio | Acción administrativa | Controlable |
| O6. Con el comodín activo (intervalo F→S) un usuario borra archivos ajenos | Solo si se despliega Firestore antes que Storage | Evitable (orden de despliegue) |

**Línea base real (lectura de producción del 2026-11-15): 5 documentos y 5 archivos; 0 documentos huérfanos y 0 archivos sin documento.**

## 2. El caso pedido (O1) en detalle
Reproducido con las 4 versiones reales del cliente en `route-photos-legacy-clients.cjs` (estado final de las reglas): un administrador con un cliente antiguo borra una foto antigua → el archivo se borra (permitido a admin) y el documento se rechaza porque el borrado exige crear la marca en el mismo lote
(los clientes antiguos no la conocen). Resultado: documento sin archivo, **visible**, que solo un administrador con el cliente nuevo puede limpiar. El resto de borrados con clientes antiguos no dejan nada (autor, spotter y ajenos se rechazan; las fotos nuevas no las alcanzan).

## 3. Cuatro capas (cada una se aprueba por separado)
**Capa 0 — quitar la causa de O1 (cambio de reglas, opcional).** Permitir que **admin y super-admin borren el documento con o sin marca** (la marca sigue siendo obligatoria solo para el autor). Con eso un administrador con un cliente antiguo completa el borrado (archivo y documento) y O1 desaparece.
Coste/riesgo analizado: sin marca el id de una foto borrada por un admin podría recrearse; pero el archivo ya se borró, recrear exige subir un archivo nuevo en 5 min (otra foto, con plazo propio) y no amplía ningún plazo del autor. El riesgo real es solo el ya conocido de borrar únicamente el documento por consola.

**Capa 1 — prevenir O2 en el cliente (diario de subidas en curso).** Antes de crear el documento, el cliente anota `{id, uid, ruta, hora local}` en el almacenamiento local; lo borra al terminar bien o tras limpiar. Al arrancar (y en `getRoutePhotos`), por cada entrada con más de 6 min:
si el archivo existe → se descarta la entrada; si no existe (`object-not-found`) → borra el documento con su marca (el autor puede, dentro de 12 h); con cualquier otro error → se conserva. Entradas con más de 13 h se descartan. Es la única capa que evita O2 sin intervención humana.

**Capa 2 — detección (informe de solo lectura).** Algoritmo en §4. No escribe nada.

**Capa 3 — limpieza segura (archivar y después borrar solo el documento).** §5. Solo con aprobación humana por lote, nunca automática.

## 4. Detección (capa 2)
Herramienta: **script local con las credenciales de `gcloud` del administrador** (como `scripts/backup-firestore.py`), no código del cliente ni Cloud Function. Modo por defecto: **informe**, sin escrituras.
1. Leer todos los documentos de `route-photos` y listar con privilegios los objetos de `route-photos/` (el listado es autoritativo y consistente; mejor que una petición por foto).
2. Derivar la ruta del archivo de cada documento: `storagePath` si existe; si no, `route-photos/{schoolId}/{filename}`; si faltan datos → **indeterminado**.
3. Clasificar (mismo esquema que el informe de trazados, ya usado en KRUX): **seguro** (el archivo existe), **huérfano**, **indeterminado**.
4. Un documento es **huérfano** solo si se cumplen **todas** estas condiciones:
   - Formato nuevo (`storagePath` y id `{escuela}_{vía}_{16}`): han pasado **≥ 10 min** desde `uploadedAt` (el doble de la ventana de subida: el archivo ya no puede llegar). Formato antiguo: el documento tiene **≥ 24 h**.
   - El archivo está **ausente en dos comprobaciones separadas ≥ 10 min** (listado completo y consulta directa del objeto con credenciales).
   - La ruta derivada coincide con la que contiene `photoUrl` (si no coincide → indeterminado).
   - Ninguna entrada del informe anterior lo marca como «archivo reapareció».
5. **Indeterminado** (nunca se limpia): error de red o 5xx, 403, listado truncado o incompleto, documento sin ruta derivable, `photoUrl` que no concuerda, documento con `uploadedAt` futuro o ausente.
6. Salida: informe JSON y resumen (`seguros / huérfanos / indeterminados`, con la evidencia de cada huérfano: ruta, resultados de las dos comprobaciones, edad) y la lista inversa **«archivos sin documento»** (solo informativa).

## 5. Limpieza (capa 3): archivar y después borrar solo el documento
Activación explícita: `--apply --ids <fichero revisado a mano> --limit N` (por defecto N pequeño). Por cada documento huérfano confirmado, **en este orden**:
1. **Tercera comprobación** del archivo inmediatamente antes de tocar nada. Si existe → se omite.
2. **Copia de seguridad previa** de toda la colección `route-photos` en local (como `backup-firestore.py`).
3. **Archivo**: crear `route-photos-archive/{id}` con `{ original: <documento completo tal cual>, archivedAt, archivedBy, reason, evidence: {…comprobaciones…}, tool: versión }`.
4. Solo si el archivo se escribió y se releyó igual: **borrar `route-photos/{id}` y crear su marca** `route-photo-tombstones/{id}`.
La colección `route-photos-archive` no necesita reglas nuevas: la escribe un script con credenciales de servicio y las reglas actuales la dejan cerrada a los clientes (colección sin regla = denegada).

## 6. Reversibilidad y protección frente a falsos positivos
- **Reversible:** nada se borra sin su copia íntegra en `route-photos-archive`; la restauración (script `--restore <id>`) recrea el documento tal cual y retira la marca (el super-admin puede borrarla). La copia no se purga automáticamente (conservar ≥ 90 días).
- **No toca archivos:** el mecanismo no escribe ni borra nada en Storage. Un falso positivo (archivo que sí existía bajo otra ruta) solo cuesta un documento, restaurable.
- **Doble y triple comprobación**, edades mínimas, ruta cruzada con `photoUrl`, y «ante la duda, indeterminado».
- **Tope por ejecución y simulación por defecto**; el conjunto a limpiar lo revisa una persona sobre el informe (nunca «limpiar todo lo huérfano» sin lista).
- **Idempotente y atómico por documento** (si falla tras archivar, la siguiente pasada continúa sin duplicar).

## 7. Prohibiciones y cómo se hacen cumplir
**Nunca** se borran ni se modifican: `sector_route_drawings` (trazados de vías), `sector_images`, `pending_*`, ascensos, usuarios, votos, ni ningún objeto de Storage. Garantías técnicas:
1. **Lista cerrada de colecciones**: el script solo conoce `route-photos`, `route-photo-tombstones` y `route-photos-archive`; cualquier otra ruta provoca un error antes de escribir.
2. **Sin llamadas de borrado de Storage** en el código (una prueba lo comprueba leyendo el fuente) y sin permisos de escritura de Storage en el modo informe.
3. **Prueba de integridad con trazados**: en el emulador, el estado de `sector_route_drawings` y `sector_images` (hash de cada documento) debe ser idéntico antes y después de cualquier ejecución, incluida `--apply`.
4. **Simulación por defecto**, tope por ejecución, lista de ids obligatoria y copia previa de la colección.
5. Rechazo explícito si el informe contiene un id que no sea un documento de `route-photos`.

## 8. Alternativas descartadas
- *Cloud Function que borre el documento al borrarse el archivo*: introduce infraestructura nueva (plan Blaze, despliegue, monitorización) y un borrado automático sin revisión.
- *TTL de Firestore sobre `uploadedAt`*: no sabe si el archivo existe; borraría fotos válidas.
- *Reglas que impidan borrar el archivo si el documento sigue*: Storage no puede forzar el orden y rompería el flujo correcto del cliente.
- *Borrado automático periódico*: contradice «reversible y protegido frente a falsos positivos»; se exige aprobación humana por lote.

## 9. Plan de pruebas (antes de usarlo en producción)
Emulador, con el mismo arnés de `route-photos-legacy-clients.cjs`: documento seguro; huérfano nuevo y antiguo; indeterminados (error 500, 403, sin ruta, `photoUrl` discordante, listado truncado); documento joven (< 10 min / < 24 h); archivo que reaparece entre comprobaciones;
modo informe sin escrituras; archivo-antes-de-borrar (si falla el archivado no se borra); restauración idéntica; idempotencia; tope por ejecución; rechazo de ids ajenos a `route-photos`; **trazados y sectores intactos**; el código no contiene borrados de Storage.

## 10. Decisiones (aprobadas el 2026-11-15, salvo la capa 0)
1. Capa 0: **se mantiene A0** (sin cambios de reglas); A1 no se adopta ni se implementa (decisión del 2026-11-15).
2. Capa 1 (diario de subidas): aprobada **sin limpieza automática**.
3. Capas 2 y 3: aprobadas; la capa 3 se implementa pero **no se ejecuta ninguna limpieza real**; los lotes exigen aprobación explícita y los indeterminados nunca se borran.
4. Periodicidad del informe (propuesta, pendiente de decidir): tras el despliegue, a las 48 h y una vez por semana durante un mes.

## 11. Cómo se usa lo implementado

**Capa 1 (cliente).** Antes de crear el documento se anota la subida en el almacenamiento local (`kx-route-photos-upload-journal`) y se borra la anotación al terminar o al limpiar. Si la app se cierra a mitad, la anotación queda.
En el siguiente arranque (y en `getRoutePhotos`), pasados 6 min, **solo se leen** el documento y los metadatos del archivo: si el archivo existe, se descarta la anotación; si falta, la subida pasa a `kxRpInterruptedUploads()` (informe);
cualquier otro resultado (red, permisos) es indeterminado y la anotación se conserva. **Nada se borra solo.** `kxRpDiscardInterruptedUpload(id)` es una acción explícita, nunca invocada por el código, que vuelve a comprobar que el documento es del usuario y que el archivo sigue ausente antes de borrar el documento con su marca.

**Capas 2 y 3 (herramienta local, `python3 scripts/route-photos-orphans.py`, con la sesión de `gcloud` de un administrador; solo biblioteca estándar).** Las opciones globales (`--out`, `--emulator`…) van antes del subcomando.
1. `report` — **solo lectura** (cualquier escritura se rechaza antes de enviarse). Guarda un informe en `~/krux-backups/route-photos-orphans/` (fuera del repositorio; contiene datos de usuarios: no subirlo). Clases: `seguro`, `huerfano_probable`, `huerfano_confirmado`, `indeterminado`.
   Para confirmar un huérfano hace falta un **segundo informe separado ≥ 10 min**: `report --previous <informe anterior>`.
2. `plan --report <informe> --ids <fichero>` — solo documentos `huerfano_confirmado` elegidos a mano (máx. 50, sin repetidos); crea un lote «pendiente de aprobación» con su hash. No escribe nada en Firebase.
3. `apply --batch <lote>` — **simulación por defecto**. Para ejecutar de verdad hacen falta, a la vez: `--approve <hash del lote>`, `--confirm-text "ARCHIVAR N DOCUMENTOS"` (o escribirla en una terminal) y `--limit N` (1–50; por defecto 5), y se hace una **copia previa** de `route-photos` y `route-photo-tombstones`.
   Antes de tocar cada documento se **re-verifica**: sigue existiendo, no ha cambiado desde el plan y su archivo sigue ausente (consulta directa); si no, se omite. Cada documento se archiva en **una única operación atómica**: copia íntegra en `route-photos-archive`, borrado de ese documento (con precondición de versión) y su marca permanente.
4. `restore --id <id>` — **simulación por defecto**; con `--apply --confirm-text "RESTAURAR <id>"` recrea el documento tal cual y retira su marca; la copia se conserva marcada como restaurada.
5. `selftest` — comprueba sin red las protecciones.

**Qué NO puede hacer** (comprobado por `selftest`, `tests/route-photos-orphans.test.js` y `route-photos-orphans-tool.cjs`): escribir en Storage, borrar archivos, leer o escribir cualquier colección distinta de `route-photos`, `route-photo-tombstones` y `route-photos-archive`, borrar sin precondición de versión, sobrescribir informes/lotes/copias,
archivar indeterminados o recientes, ejecutar un lote manipulado o ya aplicado. En las pruebas, trazados de vías, imágenes de sector, vías pendientes y usuarios de señuelo quedan **idénticos (hash)** y la lista de objetos de Storage no cambia.

## 12. Capa 0: A0 adoptada; A1 estudiada y NO adoptada
**Problema:** un administrador con un cliente antiguo que borra una foto antigua deja un documento huérfano (el archivo se borra y el documento se rechaza porque falta la marca). La capa 0 original (que el administrador borre sin marca) era la solución más sencilla, pero relaja una regla.
**Estudio y conclusión:** hay dos formas de «resolver con marca, de forma segura y atómica», y las dos se han probado (`admin-orphan-resolution.cjs`, 52 comprobaciones en el emulador; los casos de reglas, también con el motor real de Firebase: `rules-engine-check.cjs`, sección A1).

**A0 — sin cambiar ninguna regla (recomendada).** Las reglas vigentes de la propuesta ya permiten a un administrador o super-administrador resolver cualquier documento huérfano con **un lote atómico «borrar el documento + crear su marca»** (el cliente nuevo ya lo hace en `deleteRoutePhoto`, y la herramienta del §11 lo hace con credenciales de servicio).
Pruebas de seguridad: el lote es todo o nada (marca con `deletedBy` ajeno, hora del cliente o campos extra → se rechaza el lote entero y el documento sigue); no se puede crear la marca sola ni para documentos inexistentes; solo administración puede (otro usuario, spotter, visitante y el autor pasadas 12 h no);
el borrado simple de un administrador **sigue denegado** (no se debilita nada); el id resuelto no se puede reutilizar ni por el autor ni por un administrador, y el formato antiguo no se puede crear; el administrador no puede modificar ni retirar la marca (solo el super-administrador, como hasta ahora); y ningún trazado, sector ni archivo de Storage cambia.
**Límite documentado:** las reglas no ven Storage, así que permiten resolver también un documento que sí tiene archivo; esa comprobación («el archivo no existe») la hacen el cliente nuevo (borra primero el archivo) y la herramienta (re-verificación). Lo que A0 no hace es impedir que un administrador con un cliente antiguo CREE el huérfano; solo lo resuelve después (con la herramienta o con el cliente nuevo).

**A1 — cambio mínimo opcional de reglas (si se quiere impedir también que se cree el huérfano).** En la regla de borrado de `route-photos`, permitir a administradores y super-administradores borrar **sin marca únicamente los documentos de formato antiguo** (los que no tienen `storagePath`):
```
allow delete: if isAuthenticated() && (
  ((isAdmin() || isSuperAdmin()) && !('storagePath' in resource.data)) ||
  (existsAfter(tombstonePath()) && ( <regla actual> )));
```
Por qué no debilita: las reglas **ya no permiten crear** documentos de formato antiguo (`storagePath` es obligatorio y el id debe terminar en 16 caracteres aleatorios), así que un id antiguo no se puede reutilizar aunque no tenga marca; los documentos de formato nuevo siguen exigiendo marca para todos; el autor, el spotter y los demás no ganan nada.
Probado en emulador y con el motor real (11 casos): admin/super-admin borran antiguos sin marca; el borrado simple de un documento nuevo sigue denegado para todos; nadie más puede; el lote «borrar + marca» sigue funcionando; ningún id antiguo ni nuevo se puede recrear; trazados y sectores intactos. **No está en ningún archivo de reglas desplegable**: la variante se construye en memoria en las pruebas (`_variants.cjs`).
**Decisión del propietario (2026-11-15): se mantiene A0; A1 NO se implementa.** Se conservan las 52 pruebas de seguridad de `admin-orphan-resolution.cjs` (incluida la sección A1, que prueba una variante construida en memoria y deja constancia de por qué sería segura) y los 11 casos A1 del motor real, solo como estudio: ninguna regla ni archivo desplegable contiene A1 (una prueba lo comprueba). Cómo resolver documentos antiguos: [STORAGE-ORPHANS-RUNBOOK.md](STORAGE-ORPHANS-RUNBOOK.md).

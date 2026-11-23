# Proyecto Firebase EXCLUSIVO de pruebas para ensayar la vuelta atrás de las reglas

**Estado (2026-11-16): proyecto CREADO; vía A (PATCH) y vía B (CLI) de Firestore EJECUTADAS en la API real, la vía A también con una cuenta de rol mínimo (`firebaserules.admin`); la vía B con ese rol mínimo FALLA (falta `serviceusage.services.get`); `--non-interactive` ensayado en Firestore; Storage validado solo a nivel de la API de Reglas (sin bucket) y por lectura del código.** Proyecto `krux-rules-test-a7f3` (número `130591852919`). Resultados en §9. Antes de crearlo el ensayo solo se había ejecutado contra una API simulada local (`tests/rules-rollback-rehearsal.test.js`).
Objetivo: demostrar, contra la **API real de Reglas de Firebase**, que se puede activar un ruleset nuevo, volver al anterior con el `PATCH` de `STORAGE-DEPLOY.md` §6 (vía A) y verificar el hash del contenido activo. Nunca se toca `climbmaps-80cae` ni el proyecto de otra app.

## 1. Requisitos del proyecto
| Requisito | Valor |
|---|---|
| **Id** | Debe empezar por `krux-rules-test` (p. ej. `krux-rules-test-1`). El script **rechaza** cualquier otro id, así que producción y los proyectos de otras apps quedan excluidos por construcción |
| **Contenido** | Vacío. Sin datos reales, sin copias de producción, sin usuarios, sin apps registradas, sin Hosting |
| **Separación** | Proyecto de Google Cloud propio (no una «app» más dentro de otro proyecto); sin relación con `climbmaps-80cae` |
| **Propietario / facturación** | Idealmente el mismo propietario, con plan **Spark** (sin facturación). Ver §2 sobre Storage |
| **Vida útil** | Temporal: se elimina al terminar (§6) |

## 2. Servicios que habría que habilitar
| Servicio | Para qué | ¿Facturación? |
|---|---|---|
| **Firebase Rules API** (`firebaserules.googleapis.com`) | Crear rulesets y mover releases (es lo que se ensaya) | No |
| **Cloud Firestore** con la base de datos `(default)` en modo nativo | El release `cloud.firestore` solo existe si hay base de datos | No (cuota gratuita; elegir una ubicación) |
| **Cloud Storage para Firebase** con el bucket predeterminado | El release `firebase.storage/<bucket>` exige que el bucket exista | **A verificar al crearlo:** Firebase ha ido exigiendo el plan **Blaze** para crear buckets predeterminados nuevos (aunque el uso quede dentro de la cuota gratuita). **No se activa sin autorización expresa** |
| Service Usage API | La usan `gcloud` y la CLI para habilitar lo anterior | No |

**Alternativa sin facturación:** ensayar solo Firestore (`KRUX_REHEARSAL_SERVICES=firestore`). Cada servicio es independiente en el script. Limitación: la recuperación de Storage quedaría sin ensayo real (su `PATCH` es el mismo cambiando solo el nombre del release; la vía B, la CLI, es la que cubre ese hueco).
**No hace falta** registrar apps, crear usuarios, ni subir datos: el ensayo no evalúa reglas, solo las publica y las reactiva.

## 3. Roles y permisos mínimos
- **Para crear/preparar el proyecto (una sola vez, por el propietario):** `Owner` del proyecto nuevo (o `Project Creator` + `Service Usage Admin`).
- **Para ejecutar el ensayo:** una cuenta con **`roles/firebaserules.admin`** (Firebase Rules Admin) en ese proyecto. Permisos que usa el script: `firebaserules.rulesets.create/get/delete` y `firebaserules.releases.create/get/update/delete`.
- Para la vía B (CLI), además `roles/firebase.viewer` (la CLI consulta el proyecto). Nada de `Owner` en el ensayo.
- **Cuenta separada:** conviene una configuración de `gcloud` dedicada para que el token que usa el script no sea el que apunta a producción:
  ```bash
  gcloud config configurations create krux-rules-test      # configuración aislada
  gcloud auth login                                          # con la cuenta que tenga el rol anterior
  gcloud config set project krux-rules-test-1
  gcloud config get-value project                            # debe mostrar el proyecto de pruebas, NO climbmaps-80cae
  ```

## 4. Configuración inicial (solo cuando exista el proyecto y el propietario lo autorice)
Por consola de Firebase o CLI **del proyecto de pruebas**:
1. Crear el proyecto con id `krux-rules-test-…` (sin Google Analytics).
2. Habilitar la API de Reglas: `gcloud services enable firebaserules.googleapis.com --project krux-rules-test-1`.
3. Crear Firestore `(default)` en modo nativo (y, solo si se autoriza, el bucket de Storage; anotar su nombre: `<proyecto>.firebasestorage.app` o `<proyecto>.appspot.com`).
4. **No** crear reglas ni datos: el propio ensayo crea el primer release.
5. Comprobar que no hay nada compartido con producción: `gcloud projects describe krux-rules-test-1` (id y número distintos de `climbmaps-80cae` / `627029956398`).

## 5. Ejecutar el ensayo
```bash
# 0. Desde la raíz de un clon limpio; los cuatro archivos de reglas deben coincidir con el manifiesto
shasum -a 256 -c docs/security-phase0/RULES-MANIFEST.sha256

# 1. (opcional, recomendado) Estado ANTES: listar releases y rulesets del proyecto de pruebas
P=krux-rules-test-1; TOKEN=$(gcloud auth print-access-token)
curl -s -H "Authorization: Bearer $TOKEN" -H "x-goog-user-project: $P" "https://firebaserules.googleapis.com/v1/projects/$P/releases"   > releases-antes.json
curl -s -H "Authorization: Bearer $TOKEN" -H "x-goog-user-project: $P" "https://firebaserules.googleapis.com/v1/projects/$P/rulesets"   > rulesets-antes.json

# 2. Ensayo completo (Storage y Firestore); añade KRUX_REHEARSAL_BUCKET=<bucket> si no es <proyecto>.firebasestorage.app
KRUX_REHEARSAL_PROJECT=$P scripts/rules-rollback-rehearsal.sh $P
#    Solo Firestore (sin facturación):   KRUX_REHEARSAL_SERVICES=firestore KRUX_REHEARSAL_PROJECT=$P scripts/rules-rollback-rehearsal.sh $P
#    Solo Storage:                        KRUX_REHEARSAL_SERVICES=storage ...
```
El script imprime un `PASO` por comprobación y termina con `ENSAYO CORRECTO` solo si **todas** pasan:
`1/6` crea los rulesets anterior y nuevo · `2/6` el contenido guardado de cada uno tiene el SHA-256 de su archivo · `3/6` release en el estado «producción» simulado (el anterior) · `4/6` activa el nuevo y comprueba (con un `GET` aparte, no con la respuesta del `PATCH`) que el release apunta al nuevo y que su contenido coincide · `5/6` PATCH de recuperación aceptado · `6/6` **otro `GET`**: el release apunta de nuevo al anterior y el SHA-256 del contenido coincide con `storage.rules.previous` / `firestore.rules.previous`.
Si la API responde 200 pero el release no cambia, o guarda un contenido distinto, el paso correspondiente falla (probado con la API simulada).

## 6. Verificación manual antes y después del PATCH (independiente del script)
```bash
RS() { curl -s -H "Authorization: Bearer $TOKEN" -H "x-goog-user-project: $P" "https://firebaserules.googleapis.com/v1/projects/$P/releases/$1" | python3 -c "import json,sys;d=json.load(sys.stdin);print(d['rulesetName'],d['updateTime'])"; }
HASH() { curl -s -H "Authorization: Bearer $TOKEN" -H "x-goog-user-project: $P" "https://firebaserules.googleapis.com/v1/$1" | python3 -c "import json,sys,hashlib;print(hashlib.sha256(json.load(sys.stdin)['source']['files'][0]['content'].encode()).hexdigest())"; }
# Con KRUX_REHEARSAL_CLEANUP sin activar, el script deja los rulesets y releases; se pueden inspeccionar así:
RS cloud.firestore                      # ruleset activo y updateTime (debe ser el ANTERIOR tras la recuperación)
HASH projects/$P/rulesets/<id>          # debe ser: firestore.rules.previous  → shasum -a 256 firestore.rules.previous
shasum -a 256 storage.rules.previous firestore.rules.previous storage.rules docs/security-phase0/firestore.rules.route-photos-only.proposal
```

## 7. Limpieza del proyecto de pruebas
1. **Con el propio script:** `KRUX_REHEARSAL_CLEANUP=1` borra, al terminar o al fallar, los releases que movió y los rulesets que creó (los releases primero: un ruleset en uso no se puede borrar).
2. **Comprobar que no queda nada:** `curl … /releases` y `/rulesets` deben devolver listas vacías.
3. **Eliminar el proyecto entero** (solo el de pruebas; se puede deshacer 30 días): `gcloud projects delete krux-rules-test-1` y, si se activó facturación, desvincularla antes. Confirmar con `gcloud projects list` que `climbmaps-80cae` sigue intacto.
4. Quitar la configuración local: `gcloud config configurations activate default && gcloud config configurations delete krux-rules-test`.
5. Anotar el resultado (fecha, id del proyecto, salida del script) en `STORAGE-DEPLOY.md` §6.1 sustituyendo «ejecución real pendiente».

## 8. Qué NO demuestra este ensayo (límites)
- No evalúa las reglas (eso lo hacen el emulador y el canario). Solo demuestra que **publicar y reactivar rulesets por la API funciona y conserva el contenido**.
- No demuestra el permiso entre servicios Storage→Firestore (C11 del canario) ni la propagación en producción.
- La vía B (CLI desde un directorio temporal) se puede ensayar en el mismo proyecto con `publicar firestore firestore.rules.previous` (función de `STORAGE-DEPLOY.md` §3.4), apuntando `P` al proyecto de pruebas.

## 9. Resultado del ensayo real (2026-11-16)
**Proyecto:** `krux-rules-test-a7f3` · creado sin organización ni carpeta · **facturación desactivada (`billingEnabled: false`); no se activó Blaze ni se vinculó ninguna cuenta de facturación** · configuración de `gcloud` aislada `krux-rules-test` (la configuración `default`, apuntando a producción, no se tocó; se usó `CLOUDSDK_ACTIVE_CONFIG_NAME`).
**Servicios habilitados** (además de los que Google activa por defecto en todo proyecto nuevo): `firebaserules`, `firestore`, `firebase`, `firebasestorage`; al «añadir Firebase» se activaron también `firebasehosting`, `firebaseinstallations` y `firebaseremoteconfig(realtime)` y se creó el sitio de Hosting `krux-rules-test-a7f3` (gratuito, vacío).
**Firestore:** base de datos `(default)`, modo nativo, edición STANDARD, región **`eur3`** (la misma que producción), sin protección contra borrado, **sin ningún dato**.
**Storage: NO creado.** `POST firebasestorage.googleapis.com/v1beta/projects/krux-rules-test-a7f3/defaultBucket` devolvió `403 PERMISSION_DENIED («The caller does not have permission»)` dos veces, con la cuenta propietaria del proyecto y la facturación desactivada. La API no dice «billing», pero es el comportamiento esperado de Firebase sin Blaze; no se probó ninguna otra vía (un bucket de Cloud Storage tampoco se puede crear sin facturación). Se paró ahí, como se indicó: **el ensayo de Storage queda pendiente de una decisión sobre facturación.**

### Ensayo de Firestore (API real, `scripts/rules-rollback-rehearsal.sh`)
| Paso | Resultado |
|---|---|
| Crear ruleset anterior (`firestore.rules.previous`) | `caca5ec3-ad9e-492f-9f07-2968ab30e438` · SHA-256 `3f025ad0…c63c82` · 36 519 bytes |
| Crear ruleset nuevo (propuesta `route-photos-only`) | `fc8aa797-c604-4603-8c03-2f0213ebe197` · SHA-256 `6361c566…a48b` · 43 378 bytes |
| Activar el nuevo y comprobar con un `GET` aparte | el release apuntaba a `fc8aa797…` y su contenido coincidía |
| `PATCH` de recuperación al anterior | HTTP 200 |
| `GET` aparte tras el `PATCH` | release → `caca5ec3…`; contenido SHA-256 `3f025ad0…c63c82` = el de `firestore.rules.previous` = el de producción |
Los dos hashes y los tamaños de la API **coinciden byte a byte con los archivos locales** (antes era una suposición: ahora está medido en la API real). Segunda ejecución con `KRUX_REHEARSAL_CLEANUP=1`: mismos seis pasos (`0f7b099d…` y `d7f95fb5…`), y el script dejó el proyecto sin releases ni rulesets propios.
**Comprobado fuera del script, directamente en la API real**, con el release en `cloud.firestore`:
- `PATCH` válido a un ruleset existente → HTTP 200 y el release cambia (control positivo).
- `PATCH` sin `release.name` → **HTTP 400** (`Release name should be in projects/{project_id}/releases/{release_id} format`); el release no cambia.
- `PATCH` a un ruleset que no existe → **HTTP 400** (`does not exist`); no cambia.
- `PATCH` con `updateMask=updateTime` → **HTTP 400**: la API solo acepta `ruleset_name` y `disabled`.
- `PATCH` con `updateMask=rulesetName` (camelCase) → HTTP 200 y cambia. Sin máscara también cambia (es lo que usa el procedimiento).
Es decir: la API real **no devolvió ningún «200 que no cambia el release»** en las variantes probadas; los errores son 400 explícitos. La comprobación independiente por `GET` del script (que sí detecta ese caso en la API simulada) es una defensa adicional, no una necesidad demostrada.

### Limpieza
Ambos rulesets de la primera ejecución se borraron a mano (`DELETE`, HTTP 200) y los de la segunda y el release los borró el propio script. Estado final comprobado: **0 releases y 0 rulesets** en el proyecto. El proyecto, la base de datos y el sitio de Hosting **se conservan** (no se eliminan sin autorización).

### Limitaciones
- **Storage sin ensayar** (arriba). Su `PATCH` es idéntico salvo el nombre del release (`firebase.storage/<bucket>`); la independencia de ambos servicios se ha comprobado solo en la API simulada y por construcción (releases distintos); en la API real, solo se movió `cloud.firestore`.
- Quien ejecutó el ensayo es el **Owner** del proyecto (lo creó): no se probó el rol mínimo `roles/firebaserules.admin`. Para probarlo haría falta otra cuenta.
- No demuestra nada sobre la evaluación de reglas ni sobre el permiso Storage→Firestore (canario).
- La vía B (CLI desde un directorio temporal) **no se ensayó** en este proyecto.

## 10. Ensayo de la vía B (Firebase CLI) y estudio de Storage (2026-11-16)
Mismo proyecto (`krux-rules-test-a7f3`, sin facturación). `firebase-tools` **15.3.0**, Node 25.2.1, sesión de la CLI = la cuenta del proyecto; `--project` explícito en cada despliegue; el directorio de trabajo, fuera del repositorio y sin `firebase.json`/`.firebaserc` en sus padres. Estado inicial leído: **0 releases y 0 rulesets**.

### 10.1 Firestore por CLI (función `publicar` de `STORAGE-DEPLOY.md` §3.4, copiada tal cual)
Comando por despliegue: `publicar firestore <archivo>` → en un directorio temporal nuevo (`cp <archivo> firestore.rules`; `firebase.json` = `{"firestore":{"rules":"firestore.rules"}}`) → `firebase deploy --only firestore:rules --project krux-rules-test-a7f3`.
| # | Archivo desplegado | SHA-256 del archivo | Ruleset y release resultantes (leídos con la API) | SHA-256 del contenido activo |
|---|---|---|---|---|
| 1 | `firestore.rules.previous` («producción» simulada) | `3f025ad0…c63c82` | release `cloud.firestore` → `15cb3bc1-f1f6-48af-a392-6a4f017e638c` | `3f025ad0…c63c82` (36 519 B) |
| 2 | propuesta `route-photos-only` (nuevo) | `6361c566…a48b` | release → `7e504995-b83a-4ff0-819d-f6a22834ce56` | `6361c566…a48b` (43 378 B) |
| 3 | `firestore.rules.previous` (**rollback**) | `3f025ad0…c63c82` | release → **`92cfb65c-29ae-432a-b89f-7722b8a96be5`** (ruleset nuevo, distinto de `15cb3bc1`) | `3f025ad0…c63c82` (36 519 B), **idéntico** al del despliegue 1 |
Los tres terminaron con `Deploy complete!`. La CLI compiló el archivo antes de subirlo (avisos de «función no usada»/«nombre no válido» en `isSpotter`, **los mismos que ya tiene `firestore.rules` de producción**: no son errores). **Hallazgo:** la vía B restaura el **contenido** (hash exacto) pero **no el id**: crea un ruleset nuevo (`92cfb65c…`) en lugar de reactivar `15cb3bc1…` (el código de la CLI solo compara con el ruleset ya publicado y, si el contenido difiere, sube uno nuevo). Verificado que el procedimiento no usa git ni modifica archivos del repositorio: los SHA-256 de `firestore.rules.previous`, de la propuesta y de `firestore.rules` son idénticos antes y después.
*Incidente menor (sin efecto):* una invocación mía por error de ruta se interrumpió antes de desplegar; se comprobó con lecturas que el proyecto seguía vacío.

### 10.2 Investigación de Storage (código de `firebase-tools` 15.3.0 + lecturas de la API real)
- **Cómo publica la CLI:** `deploy --only storage` → obtiene el bucket por defecto con `GET firebasestorage.googleapis.com/v1alpha/projects/<p>/defaultBucket` (si da 404 aborta con «Firebase Storage has not been set up…») → compila el archivo (`rulesets:test`) → crea un ruleset (`POST …/rulesets`) salvo que el contenido ya sea el del release activo → mueve el release `firebase.storage/<bucket>` con `PATCH …/releases/firebase.storage/<bucket>` (si el `PATCH` falla, lo repite como `POST …/releases`).
- **¿Existe un equivalente a `PATCH` para Storage?** **Sí, es exactamente el mismo:** Firestore y Storage comparten la API de Reglas; solo cambia el nombre del release (`cloud.firestore` frente a `firebase.storage/<bucket>`).
- **Permisos:** la API usa `firebaserules.releases.{get,update,create,delete}` y `firebaserules.rulesets.{get,create,delete,test}` (todos en `roles/firebaserules.admin`; `roles/firebaserules.viewer` solo lee). Para reglas con `firestore.get/exists` la CLI (modo interactivo) comprueba además que la cuenta de servicio de Storage tenga `roles/firebaserules.firestoreServiceAgent` (permiso `datastore.entities.get`) y puede **pedir concederlo** (modifica IAM); con `--non-interactive` no lo comprueba.
- **Verificación por lecturas:** `GET …/releases/firebase.storage/<bucket>` → `rulesetName`; `GET …/rulesets/<id>` → SHA-256 de `source.files[0].content` (igual que para Firestore; `state.sh`/§6 de `STORAGE-DEPLOY.md`).
- **Qué se pudo ejecutar sin bucket ni facturación:**
  1. `GET …/defaultBucket` → **404**, `GET …/buckets` → `{}`; el comando documentado `publicar storage storage.rules` falla en la fase de preparación: `Error: Firebase Storage has not been set up on project 'krux-rules-test-a7f3'` y **no crea nada** (estado idéntico antes y después).
  2. La **API de Reglas sí acepta** crear rulesets de Storage y un release `firebase.storage/krux-rules-test-a7f3.firebasestorage.app` **aunque el bucket no exista** (no lo valida). Con eso se ejecutó el ensayo completo de Storage con `rules-rollback-rehearsal.sh` (una vez con limpieza y otra sin ella): rulesets `99a2b32d…` (anterior) y `ba9bd73d…` (nuevo) en la primera; `a4c60353…` (anterior) y `56c49f21…` (nuevo) en la segunda; activar el nuevo, `PATCH` al anterior, release de vuelta en el anterior y SHA-256 `29cc65bdef1a484c98447ffa627b017de6718568c9a190a67104036d332fb887` (1 444 B) = `storage.rules.previous`.
  3. **Independencia en la API real:** con los dos releases vivos, mover Firestore a `7e504995…` y volver a `92cfb65c…` no cambió el `updateTime` del release de Storage (`07:14:18.750878Z`), y el ensayo de Storage no cambió el de Firestore (`07:12:29.166741Z`).
- **Qué NO se pudo validar (sin bucket):** que Storage use el ruleset reactivado; la vía B de Storage con éxito; el aviso de IAM de la CLI; permisos con un rol mínimo. Crear el bucket exige Blaze (`defaultBucket` → 403) y no se intentó otra vía.

### 10.3 Limpieza y estado final
Se borraron los **2 releases** (`cloud.firestore` y el de Storage) y los **5 rulesets** creados en esta sesión (`15cb3bc1…`, `7e504995…`, `92cfb65c…`, `a4c60353…`, `56c49f21…`; los de la ejecución con limpieza los borró el propio script) con `DELETE` (HTTP 200). Estado final leído: `releases: ninguno · rulesets: ninguno`. **Se conservan** el proyecto, la base de datos Firestore `(default)` (eur3, vacía), el sitio de Hosting y la configuración `gcloud` `krux-rules-test`. Facturación: `false`.

## 11. Rol mínimo y `--non-interactive` (2026-11-16)
**Cambios IAM autorizados y realizados, todos en `krux-rules-test-a7f3`, y todos revertidos:** (1) no hizo falta habilitar `iam.googleapis.com`; (2) se creó la cuenta de servicio `rules-min-rehearsal@krux-rules-test-a7f3.iam.gserviceaccount.com` sin roles; (3) se generó una clave JSON temporal (`c5dd976e…`, permisos 600, fuera del repositorio); (4) se añadió **un único binding**: `roles/firebaserules.admin` → esa cuenta (ninguna otra concesión, nada a tu usuario, sin `serviceUsageConsumer`, sin `--force`). Al terminar: clave revocada, binding retirado, cuenta eliminada, copias locales borradas.
**Aislamiento de la CLI:** `XDG_CONFIG_HOME` vacío, `GOOGLE_APPLICATION_CREDENTIALS` → la clave y `CLOUDSDK_CONFIG` propio. `firebase login:list` dio «No authorized accounts» (no se reutilizó la sesión del usuario) y `tokeninfo` del token mostró `email = rules-min-rehearsal@…`. Importante: la CLI usa siempre un usuario iniciado con `firebase login` si lo hay (el código lo prioriza sobre las credenciales por defecto), por eso hace falta el `XDG_CONFIG_HOME` vacío.

### 11.1 Resultado con el rol mínimo (`roles/firebaserules.admin` solamente)
| Comprobación | Resultado |
|---|---|
| Cuenta **sin ningún rol**: `GET releases` (con y sin cabecera de cuota) | HTTP 403 `The caller does not have permission` |
| Cuenta sin ningún rol: `firebase deploy --only firestore:rules` | `Error: … serviceusage.googleapis.com/…/firestore.googleapis.com had HTTP Error: 403, Permission denied to get service [firestore.googleapis.com]`, `rc=1`, nada creado |
| Tras conceder el rol: propagación | las lecturas dieron 403 durante ~1 minuto y luego 200 (**la concesión de IAM tarda en propagarse**) |
| Con el rol: `GET releases` (con y sin cabecera `x-goog-user-project`) | HTTP 200 |
| Con el rol: `firebase deploy --only firestore:rules` (vía B) | **Mismo error** que sin rol (`serviceusage … Permission denied to get service`), `rc=1`, nada creado; con `--non-interactive`, igual (falla explícitamente, sin alternativa ni cambios) |
| Con el rol: ensayo de la vía A con el script (`rules-rollback-rehearsal.sh`, token de la cuenta) | **Correcto**: anterior `186dbc26-1ece-4642-8b9e-0d3e3aa3629c`, nuevo `fe9114ca-022a-4ffe-9d8b-3e66975303b9`, activar el nuevo (hash `6361c566…`), `PATCH` de vuelta, release → `186dbc26…`, SHA-256 `3f025ad0…c63c82`; confirmado después con lecturas del propietario |
**Conclusión:** `roles/firebaserules.admin` **basta para la vía A** y **no basta para la vía B**: la CLI comprueba primero con la API de Service Usage que Firestore está habilitada (`serviceusage.services.get`), permiso que ese rol no incluye. Esa comprobación ocurre antes de cualquier escritura. No se concedió ningún permiso adicional; cuál sería el mínimo que desbloquea la CLI (p. ej. `serviceusage.services.get` o un rol que lo contenga) **queda sin probar**, y tampoco se sabe si después de ese paso la CLI necesitaría algo más.

### 11.2 `--non-interactive` (Firestore, con la sesión del propietario)
Tres despliegues por modo (anterior → nuevo → anterior, con la función `publicar`/`run2.sh`) desde un directorio temporal:
| | Normal | `--non-interactive` |
|---|---|---|
| Despliegue 1 (anterior) | ruleset `c2c833a2…`, hash `3f025ad0…` | ruleset `33a46486…`, hash `3f025ad0…` |
| Despliegue 2 (nuevo) | `75836142…`, hash `6361c566…` | `2caee5ed…`, hash `6361c566…` |
| Despliegue 3 (rollback) | **`35488320…`**, hash `3f025ad0…` (idéntico al 1; id distinto) | **`e97a5061…`**, hash `3f025ad0…` (idéntico al 1; id distinto) |
- **Salida:** idéntica línea por línea en los tres pares (ignorando ids y horas); **no hay ninguna pregunta** en ninguno de los dos modos (el despliegue de reglas de Firestore no tiene preguntas).
- **Otros efectos:** tras cada uno de los seis despliegues se comparó una instantánea de solo lectura (política IAM, servicios habilitados, base de datos, sitios de Hosting, facturación, buckets, cuentas de servicio) con la base: **idéntica** en todos. Una instantánea (tras el despliegue 3 no interactivo) devolvió la facturación en blanco por un fallo puntual de `gcloud`; la relectura inmediata dio `False`, igual que en la base.
- **Contenido idéntico al activo:** con `--non-interactive`, un segundo despliegue del mismo archivo imprime `latest version of firestore.rules already up to date, skipping upload...`, **no crea ruleset** y vuelve a mover el release (cambia su `updateTime`, no su ruleset).
- **Permiso que falta:** con la cuenta de rol mínimo falla igual en ambos modos (arriba): error explícito, `rc=1`, sin alternativa ni escrituras.
- **No validado (solo código):** con reglas de Storage entre servicios, `--non-interactive` omite la comprobación de IAM; `--force` la aceptaría sola; sin bucket no se puede ejecutar. Se mantiene como pendiente.

### 11.3 Limpieza y estado final
Rulesets y releases creados en esta ejecución (vías A y B, ambos modos): borrados con `DELETE` (HTTP 200); estado final leído: **0 releases, 0 rulesets**. Política IAM final **idéntica a la inicial** (6 bindings; sin miembros `deleted:` residuales ni bindings de `rules-min-rehearsal`), cuentas de servicio idénticas a las iniciales (solo `firebase-adminsdk-fbsvc`), servicios, Firestore `(default)` `eur3`, sitio de Hosting `krux-rules-test-a7f3` y buckets (ninguno) sin cambios, **facturación `false`**. Las lecturas de comprobación posteriores a borrar la cuenta (`describe`) dan `PERMISSION_DENIED … (or it may not exist)`, lo esperable para una cuenta eliminada.

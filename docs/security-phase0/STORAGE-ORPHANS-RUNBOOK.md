# Procedimiento administrativo: resolver documentos huérfanos de fotos de vía

**Decisión del propietario (2026-11-15): se mantiene la alternativa A0.** Se resuelve con las reglas vigentes (lote atómico «borrar el documento + crear su marca»); **no se cambia ninguna regla** y la variante A1 **no se adopta ni se implementa**.
Este procedimiento es para quien administre KRUX. **Nada de esto se ha ejecutado en producción**: la herramienta solo se ha probado contra el emulador y, en producción, únicamente en modo informe (lectura).

## 0. Reglas de oro
1. **Solo se resuelve un documento cuyo archivo NO existe.** Si el archivo existe, no es un huérfano: no se toca.
2. **Nunca se borra desde la consola de Firebase** (ni un documento ni un archivo): se salta la marca y permitiría reutilizar el id. Todo pasa por la herramienta o por la app.
3. **Jamás se borran ni se modifican trazados de vías, sectores ni ningún otro dato asociado**, ni archivos de Storage. La herramienta no puede hacerlo (protecciones comprobadas en las pruebas) y este procedimiento no lo pide en ningún paso.
4. **Los casos indeterminados y los recientes nunca se resuelven.** Se esperan, se investigan o se dejan.
5. **Ningún lote se ejecuta sin una persona que lo apruebe** y sin haber leído el informe. No hay limpieza automática.
6. Los informes, lotes y copias contienen datos de usuarios (uid, nombres): se guardan fuera del repositorio (`~/krux-backups/route-photos-orphans/`) y no se suben a git.

## 1. Cuándo aplicarlo
- Tras el despliegue (informe a las 48 h y una vez por semana durante un mes) o cuando alguien avise de una foto de vía con la imagen rota.
- Origen típico: un **administrador con un cliente antiguo** borró una foto antigua (se llevó el archivo y el documento se rechazó), o una app se cerró a mitad de una subida.
- **Línea base real (2026-11-15):** 5 documentos, 5 archivos, 0 huérfanos.

## 2. Qué necesitas
- Una cuenta de administrador con `gcloud auth login` hecho (la herramienta usa esa sesión; sin ella no hace nada).
- `python3` (solo biblioteca estándar). No instala nada.
- Para el caso puntual por la app (§5): una cuenta con rol `admin` o el super-administrador, con el cliente **nuevo** de `route-photos.js`.

## 3. Procedimiento con la herramienta (lotes)
Las opciones globales (`--out`, `--project`…) van **antes** del subcomando.

1. **Informe (solo lectura).**
   ```bash
   python3 scripts/route-photos-orphans.py report
   ```
   Lee los documentos y los archivos (7 peticiones, todas GET) y guarda `report-<fecha>.json`. Resultado esperado hoy: «5 seguros · 0 huérfanos». Cada documento queda como `seguro`, `huerfano_probable` o `indeterminado`.
2. **Confirmación (≥ 10 min después).** Un huérfano solo se puede resolver si lo confirman **dos comprobaciones separadas**:
   ```bash
   python3 scripts/route-photos-orphans.py report --previous ~/krux-backups/route-photos-orphans/report-<primero>.json
   ```
   Los que sigan sin archivo pasan a `huerfano_confirmado`. Los documentos recientes (nuevos < 10 min; antiguos < 24 h) y todo lo dudoso (`indeterminado`) **no pasan nunca**.
3. **Revisión humana.** Para cada `huerfano_confirmado` comprobar el motivo y la evidencia del informe (ruta, dos comprobaciones, edad). Si algo no cuadra, **no se incluye**. Los «archivos sin documento» del informe son solo informativos: no se borran ni se archivan.
4. **Plan (no escribe en Firebase).** Escribir en un fichero los ids elegidos, uno por línea (máximo 50):
   ```bash
   python3 scripts/route-photos-orphans.py plan --report ~/krux-backups/route-photos-orphans/report-<segundo>.json --ids ids.txt
   ```
   Se rechaza cualquier id que no sea `huerfano_confirmado`. Anota el **hash de aprobación** que imprime.
5. **Simulación (siempre antes de ejecutar).**
   ```bash
   python3 scripts/route-photos-orphans.py apply --batch ~/krux-backups/route-photos-orphans/batch-<id>.json
   ```
   El informe original del lote (`report-….json`) tiene que seguir **en la misma carpeta** que el lote: sin él, o si ha cambiado, `apply` se niega (también en simulación) porque no puede comprobar su integridad. Muestra qué haría con cada documento y **no escribe nada**. Si algún documento sale «omitido», entender por qué antes de seguir.
6. **Aprobación y ejecución.** Solo si todo es correcto y con el propietario de acuerdo:
   ```bash
   python3 scripts/route-photos-orphans.py apply --batch <lote> --limit N --approve <hash> --confirm-text "ARCHIVAR N DOCUMENTOS"
   ```
   (`N` = nº de documentos del lote; la frase debe ser exacta). La herramienta hace una **copia previa** de `route-photos` y `route-photo-tombstones` y, para cada documento, **vuelve a comprobar** que no ha cambiado y que su archivo sigue ausente; después, **en una sola operación atómica**, guarda su copia íntegra en `route-photos-archive`, borra **solo ese documento** y crea su marca permanente. Si el lote no incluyera las tres piezas (copia, borrado y marca) la herramienta lo rechaza antes de enviarlo.
7. **Comprobación posterior.** Repetir `report`: los resueltos ya no aparecen; el resto, igual. Guardar el resultado (`apply-<lote>.json`) y la copia previa.

## 4. Deshacer
Si un documento se resolvió por error:
```bash
python3 scripts/route-photos-orphans.py restore --id <id>                                      # simulación
python3 scripts/route-photos-orphans.py restore --id <id> --apply --confirm-text "RESTAURAR <id>"
```
Recrea el documento tal cual y retira su marca; la copia se conserva marcada como restaurada. Si la copia previa de §3.6 también se necesita, está en la carpeta de salida.

Lo que hace exactamente (comprobado en el emulador):
- Recrea el documento **idéntico** al archivado (mismos campos y tipos, incluida la fecha original `uploadedAt`; no se renueva el plazo) y retira su marca en **una sola operación atómica**; la copia queda marcada como restaurada y no se puede restaurar dos veces.
- Se niega si el documento ya existe en `route-photos` o si no hay copia archivada de ese id.
- **El id sigue protegido:** mientras el documento exista nadie puede sobrescribirlo ni cambiar su fecha (las reglas no permiten actualizar), y no se puede borrar sin crear de nuevo su marca. Si se vuelve a borrar, el id queda marcado otra vez.
- **Un documento restaurado vuelve a ser un huérfano** si su archivo no existe: restaurar solo sirve para deshacer un error, no para «arreglar» la foto. No restaura archivos de Storage.

## 5. Caso puntual por la app (sin herramienta)
Para un único documento antiguo huérfano, un administrador o el super-administrador pueden usar el cliente nuevo, que ya hace lo correcto con las reglas vigentes (primero el archivo —si no existe se ignora— y después **documento + marca en un único lote**):
```js
await deleteRoutePhoto('<id del documento>', '<uid del autor>');   // consola de la PWA con la sesión del administrador
```
**Antes:** confirmar con el informe que el documento es `huerfano_confirmado`. **Aviso:** esta llamada también borraría el archivo si existiera; por eso nunca se usa sin la confirmación del informe. No guarda copia en `route-photos-archive` (la herramienta sí): para varios documentos o para poder deshacer, usa el procedimiento de §3.

## 6. Qué hacer según el caso
| Situación | Acción |
|---|---|
| Documento antiguo sin archivo, confirmado en dos informes | Resolver (§3 o §5) |
| Documento nuevo sin archivo de una subida interrumpida (< 24 h) | Dejar que su autor lo descarte (`kxRpDiscardInterruptedUpload`) o resolver tras confirmarlo |
| Documento reciente o indeterminado | **No tocar.** Repetir el informe más tarde |
| Archivo sin documento | Solo informar al propietario; **no borrar** |
| Un administrador con un cliente antiguo vuelve a dejar documentos huérfanos | Pedirle que actualice la app / use el cliente nuevo; resolver los que queden |
| Un documento se resolvió por error | `restore` (§4) |
| La herramienta rechaza algo | Es una protección: no se salta; revisar el motivo |

## 7. Qué NO hace (y por qué no hace falta más)
- No hay cambio de reglas: la **alternativa A1** (que el administrador borre sin marca los documentos antiguos) **no se adopta ni se implementa**; se conserva solo como estudio probado en `STORAGE-ORPHANS-PROPOSAL.md` §12.
- La herramienta no impide que un cliente antiguo de un administrador **cree** un huérfano; lo resuelve después. La forma de evitarlo es que los administradores usen el cliente nuevo (se publica con la subida de versión del Service Worker).
- Las reglas no ven Storage, así que la comprobación «el archivo no existe» la hacen siempre la herramienta o el cliente, no las reglas.

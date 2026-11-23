# Migración de `routeId` de las fotos de vía antiguas — evaluación y procedimiento (NO ejecutado)

**Estado: preparado, sin ejecutar ninguna modificación.** Todo lo de aquí se ha comprobado con lecturas (GET) de producción y con el GeoJSON del repositorio. Herramienta de plan y verificación (solo lectura): `scripts/route-photos-routeid-plan.py`; pruebas: `tests/route-photos-routeid-plan.test.js`.

## 1. Qué hay realmente (lectura de producción, 2026-11-15)
| Documento | `routeId` | Nombre de vía | ¿Existe esa vía en `Valeria_Vias.geojson`? | Archivo |
|---|---|---|---|---|
| `valeria_Expertos_del_grado_1765317990188` | **234** | Expertos del grado | Sí, única (id 234) | legible (HTTP 200) |
| `valeria_Prueba_1_1764508079804` | — | Prueba 1 | **No** | legible |
| `valeria_Prueba_3_1764260639733` | — | Prueba 3 | **No** | legible |
| `valeria_Prueba_5_1764266814573` | — | Prueba 5 | **No** | legible |
| `valeria_parking_2_1764974227272` | — | parking_2 | **No** | legible |

**Conclusión principal: hoy ninguno de los cuatro documentos antiguos se puede migrar de forma segura**, porque `Prueba 1/3/5` y `parking_2` no corresponden a ninguna vía del mapa (ni existen en el GeoJSON actual ni han existido en su historial de git). Asignarles un `routeId` sería inventarlo.
Esto **contradice** lo que daba por supuesto `STORAGE-DEPLOY.md` §3.3 paso 2 («las 5 fotos tienen `routeId`»): ese paso no se puede cumplir y no hace falta cumplirlo (§3).

## 2. Defectos de `migrate-route-ids.html` (por qué NO se usa)
- **Toca mucho más que las fotos:** una sola ejecución migra también `sector_route_drawings` (trazados), ascensos, comentarios y votos. Los trazados no se modifican nunca.
- **Elige la primera coincidencia cuando hay ambigüedad** (`matches[0]`): puede asignar la foto a **otra vía** con el mismo nombre.
- Escribe con el SDK del cliente (`update`), sin precondición de versión: tras desplegar las reglas nuevas se rechaza (`update: false`) y antes no protege de condiciones de carrera.
- Cada ejecución no informa de un plan comprobable por separado; no hay verificación posterior.

## 3. Qué hacer con los cuatro documentos
**Recomendación: dejarlos como están.** No necesitan `routeId` para seguir siendo legibles:
- Su imagen se sirve por la URL con token guardada en `photoUrl` (HTTP 200 comprobado) y la lectura de `route-photos` es pública en las reglas actuales y en las nuevas; los archivos antiguos (`route-photos/valeria/<archivo>`) también tienen lectura pública en las reglas nuevas.
- El cliente nuevo los busca por nombre cuando una vía no tiene fotos con `routeId` (`getRoutePhotos`, consulta de reserva). Como esas vías no existen en el mapa, nadie los ve hoy ni los verá después: **el comportamiento no cambia**.
- Con las reglas nuevas solo los puede borrar un administrador (no tienen `uploadedAt` reciente): es lo previsto.
- Si el propietario decide que alguno corresponde a una vía concreta, se decide **a mano, caso por caso** (§5) y solo con coincidencia única; o se retira con el procedimiento de documentos huérfanos/administración, nunca con la consola.

**Cambio en el plan de despliegue:** el paso 2 pasa a ser «ejecutar el plan de solo lectura (§4); resultado esperado: 0 migrables, 4 «sin_coincidencia», 1 con `routeId`; las 5 fotos legibles». No bloquea el despliegue.

## 4. Comprobaciones previas (solo lectura)
```bash
python3 scripts/route-photos-routeid-plan.py plan        # GET de Firestore + GeoJSON local; guarda el plan fuera del repo
```
Clasifica cada documento SIN `routeId` como `unico` (una sola vía con ese nombre **en esa escuela**), `ambiguo` (varias), `sin_coincidencia` o `sin_datos`. Solo `unico` es migrable. No confunde escuelas (la clave es `schoolId` + nombre exacto). Es **idempotente**: un documento que ya tiene `routeId` se omite, así que un plan posterior a la migración no propone nada. El plan incluye una instantánea de todos los documentos (para la verificación) y contiene uids: se guarda en `~/krux-backups/route-photos-routeid/`, nunca en git.
Resultado esperado hoy: `Documentos: 5 · ya con routeId: 1 · sin routeId: 4 … Migrables (coincidencia ÚNICA): 0`.

## 5. Procedimiento seguro SI algún día hay un documento `unico` (no ejecutar hoy)
Requisitos: autorización expresa del propietario; copia previa (`scripts/backup-firestore.py`); un documento cada vez; plan reciente.
1. `plan` (arriba) y revisar a mano que el `routeId` propuesto es la vía correcta (nombre, escuela y sector).
2. Escribir **solo** `routeId` en **solo** ese documento, con precondición de versión (si el documento cambió desde el plan, la API lo rechaza; repetirlo no daña: es idempotente porque escribe el mismo valor):
   ```bash
   P=climbmaps-80cae; ID=<id del documento>; RID=<routeId del plan>; UT=<updateTime del plan>
   curl -s -X PATCH -H "Authorization: Bearer $(gcloud auth print-access-token)" -H "x-goog-user-project: $P" -H "Content-Type: application/json" \
     "https://firestore.googleapis.com/v1/projects/$P/databases/(default)/documents/route-photos/$ID?updateMask.fieldPaths=routeId&currentDocument.updateTime=$UT" \
     -d "{\"fields\":{\"routeId\":{\"integerValue\":\"$RID\"}}}"
   ```
   `updateMask` limita la escritura a `routeId`: el resto de campos (incluidos `uploadedAt`, `photoUrl`, `filename`, autor) **no se tocan**. Se hace con credenciales de administración (no pasa por las reglas), por eso es posible aunque las reglas nuevas ya estén desplegadas.
3. **Verificación posterior:** `python3 scripts/route-photos-routeid-plan.py verify --plan <plan.json>` comprueba que el conjunto de documentos es el mismo, que solo cambió `routeId` y solo en los planificados, y con el valor planificado. Después: `python3 scripts/route-photos-orphans.py report` (debe seguir «5 seguros · 0 huérfanos») y abrir la `photoUrl` de las cinco fotos (HTTP 200).
4. Si algo no cuadra: restaurar el documento desde la copia previa; no hay nada más que deshacer (no se tocan archivos ni otras colecciones).

## 6. Qué garantiza y qué no
- Garantizado por la herramienta y sus pruebas: solo lectura (ninguna petición de escritura en el código); no mezcla escuelas; no migra ambiguos ni sin coincidencia; idempotente; la verificación detecta cualquier cambio distinto de `routeId`, un `routeId` equivocado, uno no planificado y documentos que faltan o sobran.
- No garantizado: que el nombre de una vía no se haya reutilizado para otra distinta con el tiempo (por eso la revisión humana del paso 1 y el límite de un documento por vez).

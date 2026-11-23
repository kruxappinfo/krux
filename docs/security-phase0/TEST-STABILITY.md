# Estabilidad de `storage-phase0c-rules` y de las pruebas con tiempo real

Contexto: en la auditoría anterior la suite dio 283/286 dos veces en un clon limpio (una por variante de Firestore) y después 286/286 en seis ejecuciones seguidas. Aquí se documenta qué se encontró, qué está **demostrado** y qué no, y cómo se evita que vuelva a pasar sin ocultar fallos reales. Todo se midió solo en el emulador local de Fase 0; no se tocó Firebase real.

## 1. Qué falló en aquella ejecución
**No se conservó el detalle**: `run-phase0.sh` solo imprimía el recuento y descartaba la salida de error, así que los nombres de las tres comprobaciones que fallaron **no se pueden recuperar**. Lo que sí se puede decir es qué mecanismos existen y cuáles se reprodujeron (§2). Para que no vuelva a perderse información, `run-phase0.sh` ahora lista cada fallo (etiqueta, esperado, obtenido, error y milisegundo) y `KX_TRACE=1` deja un rastro por comprobación.

## 2. Causas encontradas (con evidencia)
### Causa A — prueba intermitente por diseño (DEMOSTRADA)
Tres comprobaciones que deben **denegarse** usaban `new Date()` como «hora del cliente» (`uploadedAt` en `storage-phase0c-rules.cjs`, `deletedAt` de la marca en `storage-phase0c-rules.cjs` y en `admin-orphan-resolution.cjs`). Las reglas exigen `== request.time`: si el milisegundo del cliente coincide con el del servidor (siempre ocurre a veces en un emulador local), la regla **acepta** correctamente un valor que es igual a la hora del servidor, y la prueba cree ver una denegación fallida.
- **Medido:** 58 de 300 lotes con `deletedAt: new Date()` fueron aceptados (19 %); con `Date.now() - 5000`, 0 de 300.
- **Visto en una pasada sin carga** (pasada 9 de 10 de la variante `phase0c`, con la instrumentación nueva): fallaron exactamente **tres** comprobaciones encadenadas: «lote con deletedAt del cliente» (permitido en vez de denegado) y, como consecuencia, «tras los intentos fallidos el documento sigue y NO hay marca» y «el autor borra su documento con marca válida» (el documento ya estaba borrado). Es el mismo recuento (3) y el mismo patrón que 283/286.
- **No es un fallo de seguridad**: un cliente no puede conocer `request.time` de antemano; coincidir por azar con la hora del servidor es inocuo (el valor aceptado es la hora del servidor).
- **Corrección:** esas tres comprobaciones usan ahora `new Date(Date.now() - 5000)` (un instante que nunca puede ser `request.time`). Misma cobertura (el cliente sigue sin poder fijar la hora) y cero intermitencia. Las demás suites ya usaban un desfase.
- **Qué NO se puede afirmar:** que esta fuera la causa exacta de las dos ejecuciones del clon (faltan sus etiquetas). Es la explicación **coherente** (3 fallos, ambas variantes, misma forma) y la única reproducida sin carga; tras corregirla no se ha vuelto a ver ningún fallo de esa forma (44 pasadas, §4).

### Causa B — el emulador de Storage se queda sin responder bajo carga (DEMOSTRADA, no es un fallo de las reglas)
Con la CPU saturada, el motor de reglas de Storage del emulador deja **sin respuesta** una petición que consulta Firestore (`fetch_firestore_document` queda abierta en su registro) y no se recupera hasta reiniciarlo. Se aisló con `emulator-concurrency-probe.cjs` (subidas y borrados con `firestore.get()` en las reglas):
| Carga de CPU | Peticiones a la vez | Resultado |
|---|---|---|
| ninguna | 8 | 5 de 5 ejecuciones completas (320 operaciones cada una) |
| 2 × núcleos | 1 (secuencial) | 4 de 4 ejecuciones completas (60, 60, 600 y 600 operaciones) |
| 2 × núcleos | 2 | **se bloquea** (2 de 2: tras 22 y 50 operaciones) |
| 2 × núcleos | 3 | **se bloquea** (2 de 2: tras 69 y 27 operaciones) |
| 2 × núcleos | 4 | **se bloquea** (2 de 2: tras 16 y 28 operaciones) |
| 2 × núcleos | 8 | **se bloquea** (2 de 2: en la primera y la segunda ronda) |
Con la suite original y cargas intermedias (12, 14 y 16 procesos en 10 núcleos) se bloqueó al menos una vez en cada una de las tres series (en las dos últimas, además, las pasadas siguientes fallaron porque entonces aún no se reiniciaba el emulador). Con la carga igual al número de núcleos (10 procesos) hubo 1 bloqueo en 50 pasadas de la suite refactorizada (en la primera serie de 10; 0 en las 40 siguientes). Cuando ocurre, **todas las peticiones siguientes esperan 300 s** (límite por defecto de `fetch`) y las suites siguientes de `run-phase0.sh` dan «SIN RESULTADO» en cascada. La suite lo dispara en sus pruebas de concurrencia intencionadas (varias subidas o borrados simultáneos) y en los escenarios con espera real.
- **Conclusión:** no es el reloj ni las reglas: es un defecto del emulador cuando varias peticiones con consulta a Firestore coinciden **y** la máquina va justa. No se puede arreglar desde aquí (versión: `firebase-tools` 15.3.0, `cloud-storage-rules-runtime` 1.1.3); sí se puede **detectar, clasificar y no confundir con un fallo de las reglas** (§3).
- **Cómo se presentaba esto en 283/286:** un bloqueo total produce «SIN RESULTADO», no tres fallos; por eso la Causa A es la explicación del recuento y la B es un riesgo distinto, ya visible y clasificado.

### Causa C — esperas fijas en la prueba de ventana escalada (RIESGO ELIMINADO, no se observó un fallo por esta causa)
La sección de plazos escalados (12 h → 8 s, 5 min → 5 s) dormía un tiempo fijo («duerme 3 s y borra; duerme 5,3 s y comprueba que ya no puede») y **suponía** la latencia de cada petición con seis escenarios simultáneos. Una operación permitida que llegara tarde se denegaba y las comprobaciones siguientes fallaban en cascada (la cascada de un escenario son exactamente 3 comprobaciones). En ninguna ejecución se observó este fallo, pero era posible y cualquiera de esas dos comprobaciones «a los ~X s» podía resultar falsa o verdadera por razones de tiempo. También había **falsos positivos posibles**: una denegación «porque no se puede sobrescribir» podía deberse en realidad a que ya había vencido la ventana.

## 3. Qué se cambió (sin reducir la cobertura)
1. **Plazos calculados con el tiempo medido, no con esperas fijas** (`storage-phase0c-rules.cjs` §11 y §12). Cada plazo sale del `uploadedAt` que fija el servidor y del `timeCreated` del archivo (mismo reloj: misma máquina). Reglas de clasificación:
   - *«Debe denegarse pasado el plazo»*: se espera **hasta** que el reloj supere el límite y solo entonces se intenta. No depende de la latencia; un permiso indebido es siempre un fallo.
   - *«Debe permitirse dentro del plazo»*: solo se intenta si queda margen. Si se deniega y terminó con el plazo casi agotado, la medición **no es concluyente** y se repite el escenario con documentos nuevos (máximo 3 veces). Si se deniega con tiempo de sobra, o falla por cualquier causa que no sea una denegación, es un **fallo real y no se reintenta**.
   - *«Debe denegarse por otra causa dentro del plazo»* (sobrescribir con el archivo existente, borrar sin documento, que solo venza `timeCreated`): solo se acepta si la hora demuestra que el plazo aún no había vencido; si no, es no concluyente (así no hay denegaciones por el motivo equivocado).
   - Un escenario que no concluye en 3 intentos **falla**; los fallos reales ya registrados nunca se descartan ni se reintentan; el número de intentos no concluyentes queda en una comprobación del informe.
2. **Cada petición a Storage tiene un límite de 30 s** (`_storage.cjs`): si el emulador deja de responder, la prueba falla enseguida con código `EMULATOR_TIMEOUT` y las siguientes fallan sin esperar. `S.present()` ya no confunde un error o un tiempo agotado con «el archivo no existe» (solo el 404 significa ausente).
3. **Instrumentación:** `run-phase0.sh` lista cada fallo (etiqueta, esperado, obtenido, error, milisegundo); `KX_TRACE=1` escribe una línea por comprobación y avisa si pasan 30 s sin progreso; cada resultado de `expect` lleva su instante; los escenarios con tiempo anotan cuánto faltaba para el límite al empezar y al terminar.
4. **Los bloqueos del emulador se clasifican como fallos de INFRAESTRUCTURA, no de las reglas:** `run-phase0.sh` y `soak.sh` los detectan, reinician el emulador (para no arrastrarlo a las suites siguientes) y terminan con error; el resultado de esa suite **no vale** y hay que repetir con la máquina descargada. No se reintenta automáticamente nada que pueda ocultar un fallo.
5. **Concurrencia entre escenarios acotada** (`KX_SCENARIO_CONCURRENCY`, por defecto 2) para no sumar peticiones en vuelo sin necesidad. Las pruebas de concurrencia de las reglas (subidas y borrados simultáneos) **se conservan**: son cobertura.
6. **Corrección de la Causa A** en tres comprobaciones (arriba).

Cobertura: antes 286 comprobaciones, ahora 294 (las ocho nuevas son las comprobaciones de preparación de los escenarios, que antes eran silenciosas, y el resumen de intentos). `mutations-0c.cjs` (reglas rotas a propósito) se volvió a ejecutar con la suite nueva: ver §4.

## 4. Resultados de la verificación
| Qué | Resultado |
|---|---|
| Variante `route-photos-only` (la que se desplegaría), sin carga | 12/12 pasadas, 294/294 |
| Variante `phase0c`, sin carga | 12/12 pasadas, 294/294 |
| Ambas, con carga igual al número de núcleos (10 procesos), 10 pasadas cada una | 20/20 pasadas, 294/294 |
| `admin-orphan-resolution` (mismo arreglo de la marca de tiempo) | 5/5 pasadas, 52/52 |
| Antes de corregir la Causa A (misma instrumentación) | 1 fallo de 3 comprobaciones en 40 pasadas sin y con carga leve (la pasada 9 de `phase0c`) |
| Con 2 × núcleos de carga | el emulador se bloquea (Causa B): ya no se confunde con un fallo de reglas y se reinicia |
| Mutaciones (`mutations-0c.cjs`: 22 reglas rotas a propósito) | 21 detectadas y 1 equivalente (la de siempre: `firestore.exists` es redundante con `firestore.get(...)`); la suite refactorizada **no perdió dientes** |
**Límite honesto:** con la máquina saturada (2 × núcleos) la suite no puede completarse de forma fiable porque el emulador se bloquea; eso se detecta y se informa, pero no se puede «arreglar» en las pruebas. Con la máquina normal (incluso con tantos procesos ocupados como núcleos) 44 de 44 pasadas dieron 294/294.

## 5. Cómo repetir la comprobación
```bash
export JAVA_HOME=/ruta/a/jdk21
tests/integration/rules/phase0/emulator-phase0.sh start
tests/integration/rules/phase0/soak.sh storage-phase0c-rules 10 route-photos-only 0     # 10 pasadas, sin reintentos; sale con error si falla UNA
tests/integration/rules/phase0/soak.sh storage-phase0c-rules 10 phase0c 10              # variante 0c con 10 procesos de carga
KX_TRACE=1 node tests/integration/rules/phase0/storage-phase0c-rules.cjs                # rastro por comprobación (stderr)
node tests/integration/rules/phase0/emulator-concurrency-probe.cjs 8 30                  # sonda de la Causa B (con carga externa: ver §2)
tests/integration/rules/phase0/emulator-phase0.sh stop
```

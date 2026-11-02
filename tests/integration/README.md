# Pruebas de integración de Entrena

Pruebas que ejecutan la **aplicación real** (Chrome sin pantalla) y las **reglas reales** de `firestore.rules`
contra el **emulador local** de Firestore y Auth. No usan Firebase de producción, ni credenciales, ni datos reales.

## Requisitos
- Node 18+, `npm install` (con `firebase` 9.23 de las devDependencies) y `firebase-tools`.
- Java **21 o superior** para el emulador (`JAVA_HOME`). Chrome instalado en `/Applications/Google Chrome.app`.

## Uso
```bash
tests/integration/emulator.sh start                       # arranca el emulador (proyecto demo-krux-audit)
node tests/integration/rules/rules-matrix.cjs             # reglas: catálogo, favoritos, plan antiguo, sesiones
node tests/integration/rules/plans-rules-matrix.cjs       # reglas: planes múltiples, puntero, papelera
MULTI=1 tests/integration/harness/run-state.sh multi 280000    # migración, planes, historial, conflictos
MULTI=1 tests/integration/harness/run-state.sh plansui 280000  # pantalla «Mis planes» completa
tests/integration/harness/run-state.sh phase0             # sesión con copia independiente
node tests/integration/harness/race.cjs                   # dos dispositivos migrando a la vez
tests/integration/emulator.sh stop
```
`MULTI=1` activa `window.KRUX_MULTIPLAN` en la página de pruebas (desactivado por defecto en la app).
Cada estado imprime un JSON con `resumen` (aciertos/total) y `fallos`. Las pruebas unitarias son `npx vitest run tests`.

## Modo sin conexión
```bash
tests/integration/harness/offline-seq.sh      # 5 páginas seguidas en el mismo Chrome (cola persistente real)
```
Usa `?offline=1` (Firestore sin red desde el arranque) para simular un reinicio sin cobertura, y `rules-swap.sh deny`
para que el servidor rechace las sesiones (conflicto). La interfaz de «Mis planes» y el calendario se prueban con
`MULTI=1 run-state.sh plansui` y `train-inject.html?state=cal-test&multiplan=1`.

## Perfil del escalador (KRUX_COACH)
```bash
node tests/integration/rules/profile-rules-matrix.cjs                  # reglas del perfil y la evaluación mental (59 casos)
QS='&coach=1' tests/integration/harness/run-state.sh coach 300000       # onboarding, edición, evaluación mental, sin conexión
tests/integration/harness/run-state.sh coach 120000                     # sin ?coach=1: no se ve ni se escribe nada
WRAP=320 QS='&coach=1' tests/integration/harness/run-state.sh coach 400000   # mismo recorrido en un iframe de 320 px
SHOTS_DIR=/ruta SHOT_W=390 WRAP=390 QS='&coach=1&shots=1' tests/integration/harness/run-state.sh coach 400000   # capturas
```
`WRAP=<ancho>` carga la página en un iframe de ese ancho (el Chrome sin pantalla no baja de ~500 px) y la prueba revisa
que ningún control mida menos de 44×44 px ni desborde en horizontal.

## Registro final y modo clásico
```bash
tests/integration/harness/registro-final.sh                # planes múltiples: 5 cierres × 2 reaperturas
tests/integration/harness/registro-final-clasico.sh        # igual con ?multiplan=0 (sesión y registro protegidos por la cola local)
```

## Fallos intermitentes conocidos (de entorno, no de la app)
`multi` (`u7_detecta`, `u9_registroLegibleSinPlan`, «client is offline», cuelgues en `cycle`), `o3_colaVacia`, `o5` y, de
forma rara, `verificacionRegistro` fallan a veces en la preparación. Diagnóstico (30-oct-2026):
- Con el registro del SDK (`QS='&fsdebug=1'` y `CONSOLE_LOG=/ruta.log`) se ve que, tras un cierre y entrada de sesión, los canales
  `Listen` y `Write` de Firestore no reciben respuesta durante 55-60 s mientras las lecturas REST sí responden y el emulador
  está inactivo y sin errores. Después todo se recupera solo.
- `u7_detecta` espera 20 s a que llegue el aviso de cambios con la app antigua y `u9` lee `kruxActivePlan` (todavía `null`):
  fallan porque la carga de la app aún no ha terminado, no por la lógica. Cuando la carga acaba a tiempo dan el resultado correcto.
- No ocurre con el SDK solo (40 ciclos de cierre/entrada con 8-16 oyentes y escrituras: 0 bloqueos), y forzar *long polling* no lo evita
  (4 de 8 con *long polling* forzado, 5 de 8 sin él), así que no es un problema del transporte concreto.
- Reiniciar el emulador no cambia la tasa. Los mismos fallos aparecen con el código y las reglas anteriores.
`cycle` deja marcas en el título (`ciclo:signOut|signIn|waitServer|fin`) para ver dónde se queda cada cuelgue.

- `registro-final*.sh`: los fallos aislados de `a_*`, `b_*` y `c_colaVacia` que se veían antes (también en modo clásico) venían del perfil de Chrome reutilizado
  y de la lectura de una cola ajena; ver «Perfiles aislados y colas de otras cuentas» más abajo. No son un defecto de la cola offline de la app.

## Service worker y bloqueos de ~51 s (causa y corrección del arnés)
Diagnóstico (1-nov-2026). La causa de los cuelgues de `multi` (`u7_detecta`, `u9_registroLegibleSinPlan`, «client is offline») y de la
reapertura lenta de `registro-final*` y `offline-seq` no era el transporte del SDK ni el emulador, sino el **service worker** de la app
(`sw.js`) dentro del arnés:
- `sw.js` solo ignora las peticiones que no son GET y los hosts `firebase`/`googleapis.com`. Los GET de larga duración de los canales de
  Firestore hacia el emulador (`127.0.0.1:8089/.../Listen|Write/channel?...RID=rpc`) pasan por `networkFirstThenCache`, y ese `fetch` sigue
  vivo en el service worker unos ~51 s después de cerrar la página o de cambiar de sesión.
- Chrome admite 6 conexiones HTTP/1.1 por host (el emulador no usa HTTP/2). Con esos sockets ocupados, los `POST` de apertura de `Listen`
  y `Write` esperan 51-60 s **dentro de Chrome** (fase de conexión) y no llegan al emulador, que por eso no muestra nada. Todo se recupera
  solo cuando termina el GET antiguo.
- Con el service worker, `multi` mostró saltos de 56-61 s en cada ciclo de cierre/entrada de sesión (4 de 4 ejecuciones, 3 sin terminar en
  400 s); con el service worker esquivado, 4 de 4 terminaron en 37-40 s (56/56). La reapertura de `off11c` pasó de ~52 s a ~3,6 s.
- En producción `firestore.googleapis.com` está excluido en `sw.js`, de modo que esta ruta no se usa contra Firebase real.

Corrección (solo del arnés): `cdp.mjs` y `cdp-seq.mjs` activan `Network.setBypassServiceWorker` en cada navegador que lanzan, así que todas
las pruebas de integración (`run-state.sh`, `registro-final*.sh`, `offline-seq.sh`, `race.cjs`, `dos-dispositivos.cjs`) dejan de pasar por el
service worker. `KEEP_SW=1` lo conserva para probar el service worker a propósito. La app y `sw.js` no cambian.

Límites: la prueba no cubre el comportamiento del service worker (precarga, actualización de versión).

## Perfiles aislados y colas de otras cuentas (causa de los fallos de `c_colaVacia`, 1-nov-2026)
Los fallos de `c_colaVacia` (y de `a_*`, `b_*`, `c_mismoId`, `c_fecha` en `registro-final*.sh`, escenario `inmediato`) investigados procedían de la
**selección de una cola ajena**, no de la cola offline de la app:
- `cdp.mjs` y `cdp-seq.mjs` usaban el perfil `/private/tmp/claude-501/cdp-profile-<puerto>` con un puerto aleatorio de 500 posibles y **no
  borraban nunca el perfil**. Un puerto repetido reutilizaba el `localStorage` de una ejecución anterior (el 67 % de los puertos tenía ya un perfil).
  Si esa ejecución se había abortado (emulador reiniciado, disco lleno, tiempo agotado), el perfil conservaba la cola pendiente de una cuenta que
  ya no existe en el emulador (`kx/timeout`, nunca se sincroniza).
- `emu-inject.html` leía `lsKeys().find(k => k.includes('.pending.'))`: la **primera** cola de cualquier cuenta. Con una cola ajena delante, `a_*`
  comparaba con la entrada ajena, `c_colaVacia` esperaba 60 s a que se vaciase una cola que no es de la cuenta de la prueba (ejecuciones de ~97 s en
  lugar de ~35 s) y `c_mismoId`/`c_fecha` comparaban con su id y su fecha.
- Evidencia: de 30 ejecuciones instrumentadas, las 2 que fallaron empezaron con una cola ajena en el perfil y las otras 28 con el perfil limpio pasaron.
  Sembrar esa cola en un perfil limpio reprodujo los fallos en 5 de 6 ejecuciones (la sexta falló solo en `c_colaVacia`, según el orden de las claves).
- **No se encontró evidencia de un defecto en la cola offline de la app**: la entrada de la cuenta de la prueba se guardó, se envió y se vació
  siempre que se leyó la cola correcta.
- Las ejecuciones oficiales fallidas anteriores sin traza (4 de 30 en la comparación; 3 de 12 en la primera tanda) coinciden en síntomas y duración
  (+60 s), pero **no pueden atribuirse una a una con certeza**.

Corrección (solo del arnés):
- `chrome-profile.mjs`: cada ejecución crea un perfil nuevo y vacío con `mkdtemp` (`<raíz>/cdp-run-XXXXXX`; raíz = `CDP_PROFILE_ROOT`,
  `/private/tmp/claude-501` o el directorio temporal). Al terminar bien se borra. Si la ejecución **falla** (error, título `ERR`, `fallos` no vacío,
  sin terminar a tiempo) o se pasa `KEEP_PROFILE=1`, se **conserva** y su ruta sale por stderr (`[arnés] perfil conservado ...`, con
  `KRUX-EJECUCION.txt` dentro). Tampoco se borra un perfil que algún proceso siga usando. Los perfiles conservados hay que borrarlos a mano.
- `emu-inject.html`: las pruebas `off*` leen solo la cola de la cuenta actual (`krux.train.v1.pending.<uid>`, helpers `myQueue()` y
  `hasMyQueueKey()`) y nunca tocan las de otras cuentas.

Pruebas del aislamiento:
```
node tests/integration/harness/aislamiento-perfil.check.mjs     # perfiles: vacío, no compartido, borrado/conservado, en uso (sin emuladores)
tests/integration/harness/aislamiento-cola.sh [REP]           # colas ajenas: selección, intactas, caso «inmediato» sembrado (necesita los emuladores)
```
`aislamiento-cola.sh` devuelve código de salida distinto de 0 si falla alguna comprobación.

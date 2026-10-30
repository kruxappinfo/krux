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

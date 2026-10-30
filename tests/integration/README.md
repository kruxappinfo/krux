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

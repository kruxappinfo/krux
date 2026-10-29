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

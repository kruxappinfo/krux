#!/bin/bash
# Fase 0 — ejecuta TODAS las pruebas de seguridad en un emulador local aislado y recién arrancado (sin datos previos).
# No toca firestore.rules, el código de la app, Firebase real, ni el emulador de tests/integration/emulator.sh.
#   JAVA_HOME=/ruta/a/jdk21 tests/integration/rules/phase0/run-phase0.sh
# Salida: un bloque por archivo. MODE=proposal exige cumplir la política; MODE=current muestra qué incumple HOY producción.
# WITH_MUTATIONS=1 añade la comprobación de mutaciones (~10 min). Aparte, y solo a mano (necesita gcloud y red): node rules-engine-check.cjs (motor real de reglas, sin desplegar).
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
: "${JAVA_HOME:?define JAVA_HOME con un JDK 21+}"
cd "$HERE"
./emulator-phase0.sh stop >/dev/null 2>&1; sleep 2
./emulator-phase0.sh start || exit 1
summ() { python3 "$HERE/summ.py"; }
FAIL=0
INFRA=0
# Tras cada suite: si el emulador de Storage dejó de responder (se ha observado con la CPU saturada y varias peticiones a la vez; ver STORAGE-DEPLOY.md §8) NO es un fallo de las reglas:
# se avisa, se reinicia el emulador (para no arrastrar el bloqueo a las suites siguientes) y la ejecución completa termina con error. El resultado de esa suite no vale: hay que repetir con la máquina descargada.
wedge_check() {
  if grep -q "EMULATOR_\|dejó de responder\|sin respuesta en [0-9]* ms" "$ERRF" 2>/dev/null; then
    echo "   !! FALLO DE INFRAESTRUCTURA: el emulador de Storage dejó de responder (no es un fallo de las reglas). Resultado de esta suite NO válido; se reinicia el emulador. Repetir con la máquina descargada."
    INFRA=1; FAIL=1
    ./emulator-phase0.sh stop >/dev/null 2>&1; sleep 2; ./emulator-phase0.sh start >/dev/null 2>&1 || exit 1
  fi
}
ERRF="$(mktemp)"; export ERRF; trap 'rm -f "$ERRF"' EXIT   # stderr de cada suite (para diagnosticar «SIN RESULTADO»)
echo "== Reglas existentes (regresión; emulador limpio) =="
MODES=current,proposal node run-existing-regression.cjs 2>/dev/null | python3 -c "
import json,sys
d=json.load(sys.stdin)
for m in d:
  for f,v in d[m].items(): print('  ', m, f, v['resumen'], 'exit', v['exit'])"
echo "== Propuesta Fase 0b (MODE=proposal; Firestore: firestore.rules.phase0b.proposal, Storage: storage.rules.phase0b.proposal) =="
for t in votes-rules notifications-rules sector-images-rules sector-images-drawings migration-tool-rules offline-votes-rules route-photos-binding-rules route-photos-partial-failures storage-phase0b-rules client-compat-rules drawings-safety; do
  MODE=proposal node $t.cjs 2>"$ERRF" | summ; [ "${PIPESTATUS[0]}" -ne 0 ] && FAIL=1; wedge_check
done
echo "== Fase 0c (Firestore: firestore.rules.phase0c.proposal, Storage: storage.rules; el archivo de trazados usa una copia local de datos públicos si existe) =="
for t in storage-phase0c-rules route-photos-client route-photos-legacy-clients drawings-0c; do
  MODE=proposal node $t.cjs 2>"$ERRF" | summ; [ "${PIPESTATUS[0]}" -ne 0 ] && FAIL=1; wedge_check
done
echo "== Fase 0c con el Firestore de SOLO route-photos (firestore.rules.route-photos-only.proposal = producción + el bloque de route-photos; es lo que se desplegaría) =="
for t in storage-phase0c-rules route-photos-client route-photos-legacy-clients deployment-states canary-dry-run route-photos-orphans-tool admin-orphan-resolution; do
  RULES_FILE="$HERE/../../../../docs/security-phase0/firestore.rules.route-photos-only.proposal" MODE=proposal node $t.cjs 2>"$ERRF" | summ; [ "${PIPESTATUS[0]}" -ne 0 ] && FAIL=1; wedge_check
done
if [ -n "${WITH_MUTATIONS:-}" ]; then
  echo "== Mutaciones: las pruebas de la 0c deben detectar cada regla rota a propósito (tarda ~10 min) =="
  node mutations-0c.cjs 2>/dev/null | tail -3; [ "${PIPESTATUS[0]}" -ne 0 ] && FAIL=1; wedge_check
fi
echo "== Suites de la 0b contra el Firestore 0c (regresión; route-photos-binding-rules y route-photos-partial-failures miden el formato de la 0b, sustituido en la 0c, y quedan fuera) =="
for t in votes-rules notifications-rules sector-images-rules sector-images-drawings migration-tool-rules offline-votes-rules client-compat-rules drawings-safety; do
  RULES_FILE="$HERE/../../../../docs/security-phase0/firestore.rules.phase0c.proposal" MODE=proposal node $t.cjs 2>"$ERRF" | summ; [ "${PIPESTATUS[0]}" -ne 0 ] && FAIL=1; wedge_check
done
echo "== Revisión 0 (superada por la 0b; se conserva para comparar y para documentar el hueco de «borrar y recrear») =="
for t in route-photos-rules storage-route-photos-rules route-photos-loophole-v0; do
  MODE=proposal node $t.cjs 2>"$ERRF" | summ; [ "${PIPESTATUS[0]}" -ne 0 ] && FAIL=1; wedge_check
done
echo "== Reglas ACTUALES de producción (Firestore: firestore.rules; Storage: snapshot desplegado) cargadas solo en el emulador (MODE=current; los fallos son incumplimientos de la política) =="
for t in votes-rules route-photos-rules notifications-rules migration-tool-rules storage-phase0b-rules; do
  MODE=current node $t.cjs 2>"$ERRF" | summ; wedge_check
done
./emulator-phase0.sh stop >/dev/null
exit $FAIL

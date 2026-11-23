#!/bin/bash
# Repite UNA suite N veces seguidas (emulador ya arrancado: ./emulator-phase0.sh start) y resume resultados y fallos. Sirve para demostrar estabilidad (no para ocultar fallos:
# NO hay reintentos; un solo fallo en cualquiera de las N pasadas hace que termine con código 1).
#   tests/integration/rules/phase0/soak.sh <suite sin .cjs> <N> <firestore|route-photos-only|phase0c> [carga]
# PASS_TIMEOUT=segundos por pasada (por defecto 240). «carga» = número de procesos que consumen CPU durante las pasadas (p. ej. el doble de los núcleos) para provocar latencia en el emulador.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
SUITE="${1:?suite}"; N="${2:?N}"; VAR="${3:?variante}"; LOAD="${4:-0}"
case "$VAR" in
  route-photos-only) RF="$HERE/../../../../docs/security-phase0/firestore.rules.route-photos-only.proposal" ;;
  phase0c)           RF="$HERE/../../../../docs/security-phase0/firestore.rules.phase0c.proposal" ;;
  *) echo "variante desconocida" >&2; exit 2 ;;
esac
PIDS=()
cleanup() { for p in "${PIDS[@]:-}"; do [ -n "$p" ] && kill "$p" 2>/dev/null; done; }
trap cleanup EXIT
for ((k=0; k<LOAD; k++)); do ( while :; do :; done ) >/dev/null 2>&1 & PIDS+=($!); done   # (seq 1 0 no es una secuencia vacía en macOS)
cd "$HERE"; BAD=0; INFRA=0; ERRF="$(mktemp)"
for i in $(seq 1 "$N"); do
  START=$(date +%s)
  # Vigilante: una pasada normal tarda ~30 s; si el emulador deja de responder (p. ej. una petición Storage→Firestore sin contestar) se aborta y se cuenta como fallo, sin esperar 300 s por petición
  KX_TRACE=1 RULES_FILE="$RF" MODE=proposal perl -e 'alarm shift; exec @ARGV' "${PASS_TIMEOUT:-240}" node "$SUITE.cjs" 2>"$ERRF" | ERRF="$ERRF" python3 -c "
import sys,json,os
t=sys.stdin.read()
try:
  d=json.loads(t[t.find('{'):]); print('  pasada $i:', d['resumen'], '| fallos:', len(d['fallos']))
  for f in d['fallos']: print('     FALLO:', f.get('label'), '| esperado:', f.get('policy'), '| obtenido:', f.get('got'), '|', f.get('errorInesperado') or f.get('error') or '', '| a los', f.get('atMs'), 'ms')
  sys.exit(1 if d['fallos'] else 0)
except SystemExit: raise
except Exception: print('  pasada $i: SIN RESULTADO (últimas líneas del rastro):'); [print('      ' + l) for l in open(os.environ['ERRF']).read().strip().splitlines()[-6:]]; sys.exit(1)"
  RCS=("${PIPESTATUS[@]}")
  [ "${RCS[1]}" -ne 0 ] && BAD=$((BAD+1))
  # fallo de infraestructura = el emulador dejó de contestar (petición sin respuesta) o el vigilante mató la pasada por exceder el tiempo (señal 14 → código 142)
  if [ "${RCS[0]}" -eq 142 ] || grep -q "EMULATOR_\|dejó de responder\|sin respuesta en [0-9]* ms" "$ERRF" 2>/dev/null; then
    echo "     !! el emulador dejó de responder (FALLO DE INFRAESTRUCTURA, no de las reglas); se reinicia para la pasada siguiente"
    INFRA=$((INFRA+1)); ./emulator-phase0.sh stop >/dev/null 2>&1; sleep 2; ./emulator-phase0.sh start >/dev/null 2>&1
  fi
  echo "     ($(( $(date +%s) - START )) s)"
done
rm -f "$ERRF"
echo "RESUMEN $SUITE [$VAR] carga=$LOAD: $((N-BAD))/$N pasadas sin fallos (fallos de infraestructura del emulador: $INFRA)"
[ "$BAD" -eq 0 ]

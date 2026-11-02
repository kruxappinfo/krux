#!/bin/bash
# Aislamiento de colas por cuenta en el arnés (necesita los emuladores y la app, como registro-final.sh).
#   1) off12: cuenta nueva con DOS colas ajenas (una antes y otra después por orden alfabético): se lee solo la propia y las ajenas quedan intactas.
#   2) Caso que originó el problema: se siembra la cola pendiente real de otra cuenta en el perfil y se ejecuta el escenario «inmediato»
#      (directa y sinRedLuegoConRed, REP veces cada una); al final la cola ajena sigue exactamente igual.
#   aislamiento-cola.sh [REP]      (por defecto 3)   →   código de salida 0 solo si TODAS las comprobaciones pasan
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$HERE/../../.." && pwd)"
REP="${1:-3}"
"$HERE/prepare.sh"
( cd "$ROOT" && python3 -m http.server 8765 >/dev/null 2>&1 & echo $! > "$HERE/.generated/server.pid" ); sleep 1
trap 'kill $(cat "$HERE/.generated/server.pid") 2>/dev/null; rm -f "$ROOT/_harness-emu.html"' EXIT
B="http://localhost:8765/_harness-emu.html?multiplan=1"
bad=0
# resume <esperado>: lee las líneas T| de stdin y las compara con «7/7 | ...»
resume() { python3 -c "
import sys,json
res=[json.loads(l[2:]) for l in sys.stdin.read().splitlines() if l.startswith('T|')]
print(' | '.join((r.get('resumen','?')+(' '+str(r.get('fallos')) if r.get('fallos') else '')+(' ERR '+str(r.get('err')) if r.get('err') else '')) for r in res))"; }
chk() { local nombre="$1" esperado="$2" real="$3"; if [ "$real" = "$esperado" ]; then printf 'OK    %s  %s\n' "$nombre" "$real"; else printf 'FALLA %s\n      esperado: %s\n      real:     %s\n' "$nombre" "$esperado" "$real"; bad=$((bad+1)); fi; }

chk "off12 selección de cola propia y colas ajenas intactas" "6/6" "$(node "$HERE/cdp-seq.mjs" 90000 "$B&state=off12" 2>&1 | resume)"
for i in $(seq 1 "$REP"); do
  chk "cola ajena sembrada + inmediato directa #$i" "1/1 | 3/3 | 7/7 | 1/1" "$(node "$HERE/cdp-seq.mjs" 150000 "$B&state=off13a" "$B&state=off11a&mode=inmediato" "$B&state=off11c" "$B&state=off13b" 2>&1 | resume)"
  chk "cola ajena sembrada + inmediato sinRedLuegoConRed #$i" "1/1 | 3/3 | 4/4 | 7/7 | 1/1" "$(node "$HERE/cdp-seq.mjs" 150000 "$B&state=off13a" "$B&state=off11a&mode=inmediato" "$B&state=off11b&offline=1" "$B&state=off11c" "$B&state=off13b" 2>&1 | resume)"
done
echo; [ "$bad" = 0 ] && echo "Todo correcto" || echo "$bad comprobaciones con fallo"
exit $((bad>0))

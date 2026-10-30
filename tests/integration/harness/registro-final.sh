#!/bin/bash
# El registro final (sensación, esfuerzo, notas y etiquetas) se guarda en la cola al pulsar «guardar»; la app «se cierra» en cada
# punto de la sincronización y se vuelve a abrir (con y sin conexión). Cada escenario usa una cuenta nueva y el mismo Chrome.
#   registro-final.sh [escenario ...]     escenarios: inmediato escrituraSesion verificacionSesion escrituraRegistro verificacionRegistro
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$HERE/../../.." && pwd)"
"$HERE/prepare.sh"
( cd "$ROOT" && python3 -m http.server 8765 >/dev/null 2>&1 & echo $! > "$HERE/.generated/server.pid" ); sleep 1
trap 'kill $(cat "$HERE/.generated/server.pid") 2>/dev/null; rm -f "$ROOT/_harness-emu.html"' EXIT
B="http://localhost:8765/_harness-emu.html?multiplan=1"
S="${@:-inmediato escrituraSesion verificacionSesion escrituraRegistro verificacionRegistro}"
for m in $S; do
  for reopen in directa sinRedLuegoConRed; do
    printf "%-22s %-18s " "$m" "$reopen"
    if [ "$reopen" = directa ]; then
      node "$HERE/cdp-seq.mjs" 150000 "$B&state=off11a&mode=$m" "$B&state=off11c" 2>&1 | python3 -c "
import sys,json
res=[json.loads(l[2:]) for l in sys.stdin.read().splitlines() if l.startswith('T|')]
print(' | '.join((r.get('resumen','?')+(' '+str(r.get('fallos')) if r.get('fallos') else '')+(' ERR '+str(r.get('err')) if r.get('err') else '')) for r in res))"
    else
      node "$HERE/cdp-seq.mjs" 150000 "$B&state=off11a&mode=$m" "$B&state=off11b&offline=1" "$B&state=off11c" 2>&1 | python3 -c "
import sys,json
res=[json.loads(l[2:]) for l in sys.stdin.read().splitlines() if l.startswith('T|')]
print(' | '.join((r.get('resumen','?')+(' '+str(r.get('fallos')) if r.get('fallos') else '')+(' ERR '+str(r.get('err')) if r.get('err') else '')) for r in res))"
    fi
  done
done

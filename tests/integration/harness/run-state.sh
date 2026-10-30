#!/bin/bash
# Ejecuta un estado de prueba de la interfaz en Chrome sin pantalla, contra el emulador y con la app real.
#   MULTI=1 ./run-state.sh <estado> [timeoutMs]       (MULTI=1 activa la arquitectura de planes múltiples)
# Estados: persist, phase0, multi, plansui, favs, offline, denied, remote, racepage... (ver emu-inject.html)
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$HERE/../../.." && pwd)"
"$HERE/prepare.sh"
GEN="$HERE/.generated"
( cd "$ROOT" && python3 -m http.server 8765 >/dev/null 2>&1 & echo $! > "$GEN/server.pid" ); sleep 1
trap 'kill $(cat "$GEN/server.pid") 2>/dev/null; rm -f "$ROOT/_harness-emu.html"' EXIT
node "$HERE/cdp.mjs" "http://localhost:8765/_harness-emu.html?multiplan=${MULTI:-0}&state=$1&upto=${UPTO:-9}" '^(T\||ERR)' "${2:-90000}" 390 844

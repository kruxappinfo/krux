#!/bin/bash
# Ejecuta un estado de prueba de la interfaz en Chrome sin pantalla, contra el emulador y con la app real.
#   MULTI=1 ./run-state.sh <estado> [timeoutMs]       (MULTI=1 activa la arquitectura de planes múltiples)
#   QS='&coach=1' añade parámetros a la URL; W y H fijan el tamaño de la ventana (por defecto 390×844)
# Estados: persist, phase0, multi, plansui, favs, offline, denied, remote, racepage... (ver emu-inject.html)
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$HERE/../../.." && pwd)"
"$HERE/prepare.sh"
GEN="$HERE/.generated"
( cd "$ROOT" && python3 -m http.server 8765 >/dev/null 2>&1 & echo $! > "$GEN/server.pid" ); sleep 1
trap 'kill $(cat "$GEN/server.pid") 2>/dev/null; rm -f "$ROOT/_harness-emu.html"' EXIT
URL="http://localhost:8765/_harness-emu.html?multiplan=${MULTI:-0}&state=$1&upto=${UPTO:-9}${QS}"
# WRAP=<ancho>: la página se carga en un iframe de ese ancho (el Chrome sin pantalla no baja de ~500 px)
if [ -n "$WRAP" ]; then
  echo "<!doctype html><title>x</title><body style='margin:0'><iframe src='$URL' width='$WRAP' height='${H:-844}' style='border:0'></iframe></body>" > "$ROOT/_wrap-emu.html"
  trap 'kill $(cat "$GEN/server.pid") 2>/dev/null; rm -f "$ROOT/_harness-emu.html" "$ROOT/_wrap-emu.html"' EXIT
  URL="http://localhost:8765/_wrap-emu.html"
fi
node "$HERE/cdp.mjs" "$URL" '^(T\||ERR)' "${2:-90000}" "${W:-390}" "${H:-844}"

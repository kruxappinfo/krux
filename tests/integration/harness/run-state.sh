#!/bin/bash
# Ejecuta un estado de prueba de la interfaz en Chrome sin pantalla, contra el emulador y con la app real.
#   MULTI=1 ./run-state.sh <estado> [timeoutMs]       (MULTI=1 activa la arquitectura de planes múltiples)
#   QS='&coach=1' añade parámetros a la URL; W y H fijan el tamaño de la ventana (por defecto 390×844)
# Estados: persist, phase0, multi, plansui, favs, offline, denied, remote, racepage... (ver emu-inject.html)
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$HERE/../../.." && pwd)"
"$HERE/prepare.sh"
# El servidor se lanza en este mismo shell para que $! sea el PID de python3. La limpieza no falla si ya ha terminado y conserva el código de salida de la prueba.
python3 -m http.server 8765 --directory "$ROOT" >/dev/null 2>&1 &
SRV=$!
TMPS=("$ROOT/_harness-emu.html")
limpiar() { local rc=$?; trap - EXIT; kill "$SRV" 2>/dev/null || true; wait "$SRV" 2>/dev/null || true; rm -f "${TMPS[@]}"; exit "$rc"; }
trap limpiar EXIT
sleep 1
kill -0 "$SRV" 2>/dev/null || { echo "run-state.sh: el servidor no arrancó (¿puerto 8765 ocupado?)" >&2; exit 1; }
URL="http://localhost:8765/_harness-emu.html?multiplan=${MULTI:-0}&state=$1&upto=${UPTO:-9}${QS}"
# WRAP=<ancho>: la página se carga en un iframe de ese ancho (el Chrome sin pantalla no baja de ~500 px)
if [ -n "$WRAP" ]; then
  echo "<!doctype html><title>x</title><body style='margin:0'><iframe src='$URL' width='$WRAP' height='${H:-844}' style='border:0'></iframe></body>" > "$ROOT/_wrap-emu.html"
  TMPS+=("$ROOT/_wrap-emu.html")
  URL="http://localhost:8765/_wrap-emu.html"
fi
node "$HERE/cdp.mjs" "$URL" '^(T\||ERR)' "${2:-90000}" "${W:-390}" "${H:-844}"

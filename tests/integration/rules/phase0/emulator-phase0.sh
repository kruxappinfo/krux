#!/bin/bash
# Emulador AISLADO de la Fase 0: proyecto demo-krux-phase0 (sin acceso a Firebase real), Auth 9190, Firestore 8190,
# Storage 9199. No toca el emulador de tests/integration/emulator.sh (8089/9109) ni firestore.rules.
# Requiere Java 21+ (JAVA_HOME) y firebase-tools. Uso: JAVA_HOME=... ./emulator-phase0.sh start|stop
# Reglas iniciales: emulator.phase0.firestore.rules (deniega todo; solo para arrancar); cada prueba carga después las suyas con la API del emulador.
# Suites de dibujos (desde un clon limpio, tras `npm ci`):
#   JAVA_HOME=... ./emulator-phase0.sh start
#   KRUX_BEFORE_REF=4091713 MODE=proposal node drawings-0c.cjs   # idem sector-images-drawings.cjs y drawings-safety.cjs
#   ./emulator-phase0.sh stop
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
case "${1:-start}" in
  start)
    : "${JAVA_HOME:?define JAVA_HOME con un JDK 21+}"
    export PATH="$JAVA_HOME/bin:$PATH"
    ( cd "$HERE" && firebase emulators:start --only auth,firestore,storage --project demo-krux-phase0 \
        --config "$HERE/emulator.phase0.json" > "$HERE/.emulator-phase0.log" 2>&1 & echo $! > "$HERE/.emulator-phase0.pid" )
    for i in $(seq 1 90); do grep -q "All emulators ready" "$HERE/.emulator-phase0.log" 2>/dev/null && echo "emulador listo" && exit 0; sleep 1; done
    echo "el emulador no arrancó:"; tail -15 "$HERE/.emulator-phase0.log"; exit 1 ;;
  stop)
    [ -f "$HERE/.emulator-phase0.pid" ] && kill "$(cat "$HERE/.emulator-phase0.pid")" 2>/dev/null || true
    pkill -f "demo-krux-phase0" 2>/dev/null || true; rm -f "$HERE/.emulator-phase0.pid"; echo "emulador parado" ;;
esac

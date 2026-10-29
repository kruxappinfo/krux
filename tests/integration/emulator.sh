#!/bin/bash
# Arranca (o para) el emulador local de Firestore + Auth con las reglas del repositorio.
# Proyecto de pruebas «demo-krux-audit»: no toca Firebase de producción ni usa tus credenciales.
# Requiere Java 21 o superior (JAVA_HOME) y firebase-tools.
#   ./emulator.sh start   |   ./emulator.sh stop   |   ./emulator.sh rules   (recarga firestore.rules)
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$HERE/../.." && pwd)"
CFG="$HERE/.firebase.emu.json"
cat > "$CFG" <<JSON
{ "firestore": { "rules": "$ROOT/firestore.rules" },
  "emulators": { "firestore": { "port": 8089 }, "auth": { "port": 9109 }, "ui": { "enabled": false }, "singleProjectMode": true } }
JSON
case "${1:-start}" in
  start)
    pkill -f "firebase emulators" 2>/dev/null || true; pkill -f cloud-firestore-emulator 2>/dev/null || true; sleep 1
    ( cd "$HERE" && firebase emulators:start --only firestore,auth --project demo-krux-audit --config "$CFG" > "$HERE/.emulator.log" 2>&1 & )
    for i in $(seq 1 60); do grep -q "All emulators ready" "$HERE/.emulator.log" 2>/dev/null && echo "emulador listo" && exit 0; sleep 1; done
    echo "el emulador no arrancó:"; tail -5 "$HERE/.emulator.log"; exit 1 ;;
  stop)
    pkill -f "firebase emulators" 2>/dev/null || true; pkill -f cloud-firestore-emulator 2>/dev/null || true; echo "emulador parado" ;;
  rules)
    python3 - "$ROOT" <<'PY' | curl -s -X PUT "http://127.0.0.1:8089/emulator/v1/projects/demo-krux-audit:securityRules" -H 'Content-Type: application/json' -d @- > /dev/null
import json,sys
print(json.dumps({"rules":{"files":[{"name":"firestore.rules","content":open(sys.argv[1]+"/firestore.rules").read()}]}}))
PY
    echo "reglas recargadas" ;;
esac

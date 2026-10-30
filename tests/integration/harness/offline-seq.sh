#!/bin/bash
# Secuencia completa del modo sin conexión en UNA instancia de Chrome (mismo almacenamiento local):
# sin red → reinicio sin red → reconexión → conflicto del servidor → otra cuenta → reintento y cuota.
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$HERE/../../.." && pwd)"
"$HERE/prepare.sh"
"$HERE/../rules-swap.sh" real
( cd "$ROOT" && python3 -m http.server 8765 >/dev/null 2>&1 & echo $! > "$HERE/.generated/server.pid" ); sleep 1
trap 'kill $(cat "$HERE/.generated/server.pid") 2>/dev/null; rm -f "$ROOT/_harness-emu.html"; "$HERE/../rules-swap.sh" real' EXIT
B="http://localhost:8765/_harness-emu.html?multiplan=1"
node "$HERE/cdp-seq.mjs" 120000 "$B&state=off1" "$B&state=off2&offline=1" "$B&state=off3" "!$HERE/../rules-swap.sh deny" "$B&state=off4" "!$HERE/../rules-swap.sh real" "$B&state=off5"

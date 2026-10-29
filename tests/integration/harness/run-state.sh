#!/bin/bash
# Ejecuta un estado de prueba de la interfaz en Chrome sin pantalla, contra el emulador y con la app real.
#   MULTI=1 ./run-state.sh <estado> [timeoutMs]       (MULTI=1 activa la arquitectura de planes múltiples)
# Estados: persist, phase0, multi, plansui, favs, offline, denied, remote, racepage... (ver emu-inject.html)
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$HERE/../../.." && pwd)"
GEN="$HERE/.generated"; mkdir -p "$GEN"
python3 - "$ROOT" "$GEN" <<'PY'
import re,sys
root,gen=sys.argv[1],sys.argv[2]
c=open(root+'/firebase-config.js').read()
c=re.sub(r'const firebaseConfig = \{.*?\};','const firebaseConfig = { apiKey: "fake-emulator-key", authDomain: "demo-krux-audit.firebaseapp.com", projectId: "demo-krux-audit", storageBucket: "demo-krux-audit.appspot.com", appId: "1:1:web:1" };',c,flags=re.S)
c=c.replace("auth = firebase.auth();","auth = firebase.auth();\ndb.useEmulator('127.0.0.1', 8089);\nauth.useEmulator('http://127.0.0.1:9109', { disableWarnings: true });\nif (new URLSearchParams(location.search).get('offline') === '1') { db.disableNetwork(); Object.defineProperty(navigator, 'onLine', { get: () => false, configurable: true }); }",1)
assert 'climbmaps' not in c
open(gen+'/emu-firebase-config.js','w').write(c)
src=open(root+'/index.html',encoding='utf-8').read().replace('./firebase-config.js','./tests/integration/harness/.generated/emu-firebase-config.js')
inj=open(root+'/tests/integration/harness/emu-inject.html',encoding='utf-8').read()
open(root+'/_harness-emu.html','w',encoding='utf-8').write(src.replace('</body>',inj+'</body>'))
PY
( cd "$ROOT" && python3 -m http.server 8765 >/dev/null 2>&1 & echo $! > "$GEN/server.pid" ); sleep 1
trap 'kill $(cat "$GEN/server.pid") 2>/dev/null; rm -f "$ROOT/_harness-emu.html"' EXIT
node "$HERE/cdp.mjs" "http://localhost:8765/_harness-emu.html?multiplan=${MULTI:-0}&state=$1&upto=${UPTO:-9}" '^(T\||ERR)' "${2:-90000}" 390 844

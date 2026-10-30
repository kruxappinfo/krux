#!/bin/bash
# Genera _harness-emu.html: la app real con la configuración del EMULADOR y las pruebas inyectadas.
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

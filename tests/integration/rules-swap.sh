#!/bin/bash
# rules-swap.sh deny|real : carga en el emulador las reglas reales o una variante que rechaza crear sesiones
python3 - "$1" <<'PY' | curl -s -X PUT "http://127.0.0.1:8089/emulator/v1/projects/demo-krux-audit:securityRules" -H 'Content-Type: application/json' -d @- > /dev/null
import json,sys
r=open('/Users/jaimelillo/krux/firestore.rules').read()
if sys.argv[1]=='deny':
    old="allow create: if isOwner(userId)\n          && isString(request.resource.data.dateKey, 10)"
    assert old in r
    r=r.replace(old,"allow create: if false && isOwner(userId)\n          && isString(request.resource.data.dateKey, 10)",1)
print(json.dumps({"rules":{"files":[{"name":"firestore.rules","content":r}]}}))
PY
echo "reglas: $1"

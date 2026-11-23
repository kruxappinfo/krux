#!/bin/bash
# ================== ENSAYO DE LA VUELTA ATRÁS DE LAS REGLAS (SOLO EN UN PROYECTO DE PRUEBAS) ==================
# Ensaya, con la API de Reglas de Firebase, EXACTAMENTE la operación de recuperación de docs/security-phase0/STORAGE-DEPLOY.md §6:
#   crear el ruleset anterior y el nuevo → activar el nuevo → reactivar el anterior con el PATCH por id → comprobar el SHA-256 del contenido activo.
# Se hace para Storage (storage.rules.previous / storage.rules) y para Firestore (firestore.rules.previous / la propuesta route-photos-only).
#
# SEGURIDAD: este script ESCRIBE (crea rulesets y mueve el release) en el proyecto que se le indique. Por eso:
#   · SOLO acepta ids que empiecen por «krux-rules-test» (convención del proyecto de pruebas dedicado): producción (climbmaps-80cae) y los proyectos de otras apps quedan excluidos por construcción;
#   · exige además escribir el id dos veces (argumento y KRUX_REHEARSAL_PROJECT) y rechaza explícitamente producción;
#   · usa un proyecto de pruebas DEDICADO y vacío, nunca el de una app real. Requisitos y limpieza: docs/security-phase0/ROLLBACK-TEST-PROJECT.md.
# Uso:
#   KRUX_REHEARSAL_PROJECT=mi-proyecto-de-pruebas scripts/rules-rollback-rehearsal.sh mi-proyecto-de-pruebas
# Variables: TOKEN (por defecto, gcloud auth print-access-token), API_BASE (por defecto https://firebaserules.googleapis.com; las pruebas usan un servidor local simulado),
#   KRUX_REHEARSAL_SERVICES (storage,firestore | storage | firestore; por defecto los dos, cada uno es independiente del otro),
#   KRUX_REHEARSAL_BUCKET (por defecto <proyecto>.firebasestorage.app; los proyectos antiguos usan <proyecto>.appspot.com),
#   KRUX_REHEARSAL_CLEANUP=1 (al terminar, o al fallar, borra los releases y rulesets que creó este ensayo: SOLO en el proyecto de pruebas).
# Salida: una línea PASO por comprobación y «ENSAYO CORRECTO» al final; cualquier fallo termina con código distinto de 0.
set -euo pipefail

PROD='climbmaps-80cae'
P="${1:-}"
[ -n "$P" ] || { echo "Uso: KRUX_REHEARSAL_PROJECT=<proyecto> $0 <proyecto>" >&2; exit 2; }
[ "$P" != "$PROD" ] || { echo "RECHAZADO: $PROD es PRODUCCIÓN. Este ensayo solo se ejecuta en un proyecto de pruebas." >&2; exit 2; }
[ "${KRUX_REHEARSAL_PROJECT:-}" = "$P" ] || { echo "RECHAZADO: confirma el proyecto con KRUX_REHEARSAL_PROJECT=$P" >&2; exit 2; }
case "$P" in *climbmaps*) echo "RECHAZADO: el id recuerda al de producción." >&2; exit 2;; esac
case "$P" in krux-rules-test*) ;; *) echo "RECHAZADO: el proyecto de pruebas debe llamarse «krux-rules-test…» (así nunca se puede apuntar a producción ni a otra app)." >&2; exit 2;; esac
[[ "$P" =~ ^krux-rules-test[a-z0-9-]*$ ]] || { echo "RECHAZADO: id de proyecto no válido." >&2; exit 2; }
SERVICES="${KRUX_REHEARSAL_SERVICES:-storage,firestore}"
case "$SERVICES" in storage|firestore|storage,firestore|firestore,storage) ;; *) echo "RECHAZADO: KRUX_REHEARSAL_SERVICES debe ser storage, firestore o storage,firestore" >&2; exit 2;; esac

HERE="$(cd "$(dirname "$0")/.." && pwd)"
API="${API_BASE:-https://firebaserules.googleapis.com}"
TOKEN="${TOKEN:-$(gcloud auth print-access-token)}"
B="${KRUX_REHEARSAL_BUCKET:-$P.firebasestorage.app}"
WORK="$(mktemp -d)"
TOUCHED_RELEASES=()
cleanup() {
  if [ "${KRUX_REHEARSAL_CLEANUP:-}" = 1 ]; then   # solo en el proyecto de pruebas (el guard de arriba lo garantiza)
    for r in "${TOUCHED_RELEASES[@]:-}"; do [ -n "$r" ] && curl -s -o /dev/null -X DELETE -H "Authorization: Bearer $TOKEN" -H "x-goog-user-project: $P" "$API/v1/projects/$P/releases/$r"; done
    local n=0; [ -f "$WORK/created" ] && while read -r i; do [ -n "$i" ] && { curl -s -o /dev/null -X DELETE -H "Authorization: Bearer $TOKEN" -H "x-goog-user-project: $P" "$API/v1/projects/$P/rulesets/$i"; n=$((n+1)); }; done < "$WORK/created"
    echo "LIMPIEZA: borrados ${#TOUCHED_RELEASES[@]} release(s) y $n ruleset(s) creados por este ensayo en $P"
  fi
  rm -rf "$WORK"
}
trap cleanup EXIT

sha() { shasum -a 256 "$1" | cut -d' ' -f1; }
step() { echo "PASO $*"; }
die() { echo "FALLO: $*" >&2; exit 1; }

# api METHOD URL [JSON] → cuerpo en $WORK/out, código HTTP en stdout
api() {
  local m="$1" u="$2" d="${3:-}"
  if [ -n "$d" ]; then
    curl -sS -o "$WORK/out" -w '%{http_code}' -X "$m" -H "Authorization: Bearer $TOKEN" -H "x-goog-user-project: $P" -H 'Content-Type: application/json' "$u" -d "$d"
  else
    curl -sS -o "$WORK/out" -w '%{http_code}' -X "$m" -H "Authorization: Bearer $TOKEN" -H "x-goog-user-project: $P" "$u"
  fi
}
json() { python3 -c "import json,sys; d=json.load(open('$WORK/out')); print($1)"; }

# Crea un ruleset con el contenido de un archivo y devuelve su id; comprueba que el contenido guardado tiene el mismo SHA-256
create_ruleset() {
  local file="$1" body code id
  body="$(python3 -c "import json,sys; print(json.dumps({'source':{'files':[{'name':sys.argv[2],'content':open(sys.argv[1]).read()}]}}))" "$file" "$2")"
  code="$(api POST "$API/v1/projects/$P/rulesets" "$body")"; [ "$code" = 200 ] || die "crear ruleset ($file): HTTP $code $(cat "$WORK/out")"
  id="$(json "d['name'].split('/')[-1]")"
  echo "$id" >> "$WORK/created"
  echo "$id"
}
active_id()  { json "d['rulesetName'].split('/')[-1]"; }
content_sha() {   # SHA-256 del contenido de un ruleset (como se verifica tras cada despliegue)
  local code; code="$(api GET "$API/v1/projects/$P/rulesets/$1")"; [ "$code" = 200 ] || die "leer ruleset $1: HTTP $code"
  python3 -c "import json,hashlib; d=json.load(open('$WORK/out')); print(hashlib.sha256(d['source']['files'][0]['content'].encode()).hexdigest())"
}
# LA operación de recuperación (idéntica a STORAGE-DEPLOY.md §6, vía A)
rollback_patch() {   # rollback_patch <nombre del release> <id del ruleset>
  api PATCH "$API/v1/projects/$P/releases/$1" "{\"release\":{\"name\":\"projects/$P/releases/$1\",\"rulesetName\":\"projects/$P/rulesets/$2\"}}"
}
set_release() {   # crea el release si no existe, o lo mueve
  local code; code="$(api GET "$API/v1/projects/$P/releases/$1")"
  if [ "$code" = 404 ]; then
    code="$(api POST "$API/v1/projects/$P/releases" "{\"name\":\"projects/$P/releases/$1\",\"rulesetName\":\"projects/$P/rulesets/$2\"}")"
  else
    code="$(rollback_patch "$1" "$2")"
  fi
  [ "$code" = 200 ] || die "mover el release $1 a $2: HTTP $code $(cat "$WORK/out")"
}

rehearse() {   # rehearse <servicio> <release> <archivo anterior> <archivo nuevo> <nombre del archivo en el ruleset>
  local svc="$1" rel="$2" old="$3" new="$4" name="$5" id_old id_new want_old want_new code
  want_old="$(sha "$old")"; want_new="$(sha "$new")"
  [ "$want_old" != "$want_new" ] || die "$svc: las reglas anteriores y las nuevas son idénticas"
  id_old="$(create_ruleset "$old" "$name")"; id_new="$(create_ruleset "$new" "$name")"
  TOUCHED_RELEASES+=("$rel")
  step "$svc 1/6 creados ruleset anterior ($id_old) y nuevo ($id_new)"
  [ "$(content_sha "$id_old")" = "$want_old" ] || die "$svc: el ruleset anterior guardado no coincide con $old"
  [ "$(content_sha "$id_new")" = "$want_new" ] || die "$svc: el ruleset nuevo guardado no coincide con $new"
  step "$svc 2/6 el contenido guardado de ambos coincide (SHA-256) con sus archivos"
  set_release "$rel" "$id_old"
  step "$svc 3/6 release en el estado «producción» simulado (ruleset anterior)"
  set_release "$rel" "$id_new"; code="$(api GET "$API/v1/projects/$P/releases/$rel")"; [ "$code" = 200 ] || die "$svc: leer release"
  [ "$(active_id)" = "$id_new" ] || die "$svc: el release no quedó en el ruleset nuevo"
  [ "$(content_sha "$(active_id)")" = "$want_new" ] || die "$svc: el contenido activo no es el nuevo"
  step "$svc 4/6 desplegado el nuevo: el release apunta al nuevo y su SHA-256 coincide"
  code="$(rollback_patch "$rel" "$id_old")"; [ "$code" = 200 ] || die "$svc: el PATCH de recuperación falló: HTTP $code $(cat "$WORK/out")"
  step "$svc 5/6 PATCH de recuperación aceptado"
  code="$(api GET "$API/v1/projects/$P/releases/$rel")"; [ "$code" = 200 ] || die "$svc: leer release tras la recuperación"
  [ "$(active_id)" = "$id_old" ] || die "$svc: tras la recuperación el release NO apunta al ruleset anterior"
  [ "$(content_sha "$(active_id)")" = "$want_old" ] || die "$svc: tras la recuperación el contenido activo NO coincide con $old"
  step "$svc 6/6 recuperado: el release vuelve a $id_old y su SHA-256 es $want_old"
}

[ -f "$HERE/storage.rules.previous" ] && [ -f "$HERE/firestore.rules.previous" ] || die "faltan storage.rules.previous o firestore.rules.previous"
( cd "$HERE" && shasum -a 256 -c docs/security-phase0/RULES-MANIFEST.sha256 >/dev/null ) || die "los archivos de reglas no coinciden con docs/security-phase0/RULES-MANIFEST.sha256"
step "0 los cuatro archivos de reglas coinciden con RULES-MANIFEST.sha256"
case ",$SERVICES," in *,storage,*)
  rehearse storage   "firebase.storage/$B" "$HERE/storage.rules.previous"   "$HERE/storage.rules"                                                   storage.rules ;; esac
case ",$SERVICES," in *,firestore,*)
  rehearse firestore "cloud.firestore"     "$HERE/firestore.rules.previous" "$HERE/docs/security-phase0/firestore.rules.route-photos-only.proposal" firestore.rules ;; esac
echo "ENSAYO CORRECTO en $P para: $SERVICES (API: $API)"

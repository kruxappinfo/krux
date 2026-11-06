#!/bin/bash
# Permisos nativos de KRUX que no se pueden versionar porque ios/ y android/ están en .gitignore (se regeneran con `cap add`).
# Idempotente: se puede ejecutar siempre. Úsalo tras `npx cap add ios|android` o si recreas los proyectos nativos.
#   bash scripts/native-permissions.sh
# Ubicación solo MIENTRAS LA APP ESTÁ EN USO (sesiones de escalada con GPS). No añade ubicación en segundo plano.
set -e
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

IOS_PLIST="$ROOT/ios/App/App/Info.plist"
IOS_KEY="NSLocationWhenInUseUsageDescription"
IOS_TEXT="KRUX usa tu ubicación, solo mientras tienes una sesión de escalada con seguimiento GPS activado, para registrar el recorrido que haces y calcular la distancia."

if [ -f "$IOS_PLIST" ]; then
  if /usr/libexec/PlistBuddy -c "Print :$IOS_KEY" "$IOS_PLIST" >/dev/null 2>&1; then
    /usr/libexec/PlistBuddy -c "Set :$IOS_KEY $IOS_TEXT" "$IOS_PLIST"
  else
    /usr/libexec/PlistBuddy -c "Add :$IOS_KEY string $IOS_TEXT" "$IOS_PLIST"
  fi
  plutil -lint "$IOS_PLIST" >/dev/null
  echo "iOS: $IOS_KEY listo"
else
  echo "iOS: no existe $IOS_PLIST (se omite)"
fi

ANDROID_MANIFEST="$ROOT/android/app/src/main/AndroidManifest.xml"
if [ -f "$ANDROID_MANIFEST" ]; then
  python3 - "$ANDROID_MANIFEST" <<'PY'
import sys
p = sys.argv[1]
s = open(p, encoding='utf-8').read()
for perm in ('ACCESS_FINE_LOCATION', 'ACCESS_COARSE_LOCATION'):
    line = f'<uses-permission android:name="android.permission.{perm}" />'
    if f'android.permission.{perm}"' not in s:
        s = s.replace('</manifest>', f'    {line}\n</manifest>', 1)
open(p, 'w', encoding='utf-8').write(s)
PY
  echo "Android: ACCESS_FINE_LOCATION y ACCESS_COARSE_LOCATION listos"
else
  echo "Android: no existe $ANDROID_MANIFEST (se omite)"
fi

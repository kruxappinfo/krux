#!/bin/bash
# Permisos nativos de KRUX que no se pueden versionar porque ios/ y android/ están en .gitignore (se regeneran con `cap add`).
# Idempotente: se puede ejecutar siempre. Úsalo tras `npx cap add ios|android` o si recreas los proyectos nativos.
#   bash scripts/native-permissions.sh
# Ubicación para las sesiones de escalada con GPS, también con la pantalla bloqueada (plugin
# @capacitor-community/background-geolocation): permiso «siempre», modo de fondo location en iOS y servicio en primer
# plano con notificación en Android. Solo graba mientras hay una sesión en curso con el GPS activado.
set -e
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

IOS_PLIST="$ROOT/ios/App/App/Info.plist"
IOS_TEXT="KRUX usa tu ubicación, solo mientras tienes una sesión de escalada con seguimiento GPS activado, para registrar el recorrido que haces y calcular la distancia."
IOS_TEXT_ALWAYS="KRUX sigue registrando el recorrido de tu sesión de escalada con el móvil bloqueado, solo mientras la sesión con GPS está en curso. Al pausarla o finalizarla deja de usar tu ubicación."

plist_string() {   # clave, texto
  if /usr/libexec/PlistBuddy -c "Print :$1" "$IOS_PLIST" >/dev/null 2>&1; then
    /usr/libexec/PlistBuddy -c "Set :$1 $2" "$IOS_PLIST"
  else
    /usr/libexec/PlistBuddy -c "Add :$1 string $2" "$IOS_PLIST"
  fi
}

if [ -f "$IOS_PLIST" ]; then
  plist_string NSLocationWhenInUseUsageDescription "$IOS_TEXT"
  plist_string NSLocationAlwaysAndWhenInUseUsageDescription "$IOS_TEXT_ALWAYS"
  # UIBackgroundModes: añade «location» sin quitar los modos que ya hubiera (p. ej. notificaciones)
  if ! /usr/libexec/PlistBuddy -c "Print :UIBackgroundModes" "$IOS_PLIST" >/dev/null 2>&1; then
    /usr/libexec/PlistBuddy -c "Add :UIBackgroundModes array" "$IOS_PLIST"
  fi
  if ! /usr/libexec/PlistBuddy -c "Print :UIBackgroundModes" "$IOS_PLIST" | grep -qx '[[:space:]]*location'; then
    /usr/libexec/PlistBuddy -c "Add :UIBackgroundModes: string location" "$IOS_PLIST"
  fi
  plutil -lint "$IOS_PLIST" >/dev/null
  echo "iOS: ubicación en uso y siempre, y UIBackgroundModes location listos"
else
  echo "iOS: no existe $IOS_PLIST (se omite)"
fi

ANDROID_MANIFEST="$ROOT/android/app/src/main/AndroidManifest.xml"
if [ -f "$ANDROID_MANIFEST" ]; then
  python3 - "$ANDROID_MANIFEST" <<'PY'
import sys
p = sys.argv[1]
s = open(p, encoding='utf-8').read()
for perm in ('ACCESS_FINE_LOCATION', 'ACCESS_COARSE_LOCATION', 'FOREGROUND_SERVICE', 'FOREGROUND_SERVICE_LOCATION', 'POST_NOTIFICATIONS'):
    line = f'<uses-permission android:name="android.permission.{perm}" />'
    if f'android.permission.{perm}"' not in s:
        s = s.replace('</manifest>', f'    {line}\n</manifest>', 1)
open(p, 'w', encoding='utf-8').write(s)
PY
  echo "Android: ubicación, servicio en primer plano (location) y notificaciones listos"
  STRINGS="$ROOT/android/app/src/main/res/values/strings.xml"
  if [ -f "$STRINGS" ] && ! grep -q capacitor_background_geolocation_notification_channel_name "$STRINGS"; then
    python3 - "$STRINGS" <<'PY'
import sys
p = sys.argv[1]
s = open(p, encoding='utf-8').read()
s = s.replace('</resources>', '    <string name="capacitor_background_geolocation_notification_channel_name">Sesión de escalada</string>\n</resources>', 1)
open(p, 'w', encoding='utf-8').write(s)
PY
    echo "Android: canal de la notificación «Sesión de escalada» listo"
  fi
else
  echo "Android: no existe $ANDROID_MANIFEST (se omite)"
fi

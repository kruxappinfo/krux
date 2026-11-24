#!/bin/bash
# Notificaciones push de KRUX (Firebase Cloud Messaging) en los proyectos nativos, que no se versionan (ios/ y android/
# están en .gitignore). Idempotente: se puede ejecutar siempre. Úsalo tras `npx cap add ios|android` o si los recreas.
#   bash scripts/native-push.sh && npx cap sync && (cd ios/App && pod install)
#
# - Android: google-services.json (el plugin de Gradle ya se aplica solo si el archivo existe)
# - iOS: GoogleService-Info.plist dentro del proyecto de Xcode, pod FirebaseMessaging, AppDelegate que entrega a
#   Capacitor el token de FCM (no el de APNs), capacidad Push (aps-environment) y modo de fondo remote-notification.
# La clave de APNs (.p8) se sube una vez en la consola de Firebase › Configuración › Cloud Messaging: sin ella iOS no recibe nada.
set -e
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CFG="$ROOT/native-config"

# ---------- Android ----------
if [ -d "$ROOT/android/app" ]; then
  cp "$CFG/google-services.json" "$ROOT/android/app/google-services.json"
  echo "Android: google-services.json listo"
else
  echo "Android: no existe android/app (se omite)"
fi

# ---------- iOS ----------
IOS="$ROOT/ios/App"
if [ ! -d "$IOS/App" ]; then
  echo "iOS: no existe ios/App (se omite)"
  exit 0
fi

cp "$CFG/GoogleService-Info.plist" "$IOS/App/GoogleService-Info.plist"

# Entitlements con la capacidad Push. Xcode sustituye «development» por «production» al exportar para la App Store.
ENT="$IOS/App/App.entitlements"
if [ ! -f "$ENT" ]; then
  cat > "$ENT" <<'XML'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
</dict>
</plist>
XML
fi
/usr/libexec/PlistBuddy -c "Print :aps-environment" "$ENT" >/dev/null 2>&1 || /usr/libexec/PlistBuddy -c "Add :aps-environment string development" "$ENT"

# Modo de fondo remote-notification (sin quitar location, que pone native-permissions.sh)
PLIST="$IOS/App/Info.plist"
/usr/libexec/PlistBuddy -c "Print :UIBackgroundModes" "$PLIST" >/dev/null 2>&1 || /usr/libexec/PlistBuddy -c "Add :UIBackgroundModes array" "$PLIST"
if ! /usr/libexec/PlistBuddy -c "Print :UIBackgroundModes" "$PLIST" | grep -qx '[[:space:]]*remote-notification'; then
  /usr/libexec/PlistBuddy -c "Add :UIBackgroundModes: string remote-notification" "$PLIST"
fi
plutil -lint "$PLIST" "$ENT" >/dev/null

# Proyecto de Xcode: el plist de Firebase en Recursos y los entitlements en los ajustes de firma (gema xcodeproj de CocoaPods)
ruby - "$IOS/App.xcodeproj" <<'RUBY'
require 'xcodeproj'
project = Xcodeproj::Project.open(ARGV[0])
target = project.targets.find { |t| t.name == 'App' }
group = project.main_group['App'] || project.main_group
unless group.files.any? { |f| f.path == 'GoogleService-Info.plist' }
  ref = group.new_reference('GoogleService-Info.plist')
  target.resources_build_phase.add_file_reference(ref, true)
end
unless group.files.any? { |f| f.path == 'App.entitlements' }
  group.new_reference('App.entitlements')
end
target.build_configurations.each { |c| c.build_settings['CODE_SIGN_ENTITLEMENTS'] = 'App/App.entitlements' }
project.save
RUBY

# Podfile: FirebaseMessaging dentro del target App
PODFILE="$IOS/Podfile"
if ! grep -q "pod 'FirebaseMessaging'" "$PODFILE"; then
  python3 - "$PODFILE" <<'PY'
import sys
p = sys.argv[1]
s = open(p, encoding='utf-8').read()
s = s.replace("  capacitor_pods\n  # Add your Pods here\n", "  capacitor_pods\n  # Add your Pods here\n  pod 'FirebaseMessaging'   # push: token de FCM (scripts/native-push.sh)\n", 1)
open(p, 'w', encoding='utf-8').write(s)
PY
fi
grep -q "pod 'FirebaseMessaging'" "$PODFILE" || { echo "iOS: no se pudo añadir FirebaseMessaging al Podfile" >&2; exit 1; }

# AppDelegate: Firebase al arrancar y el token de FCM para @capacitor/push-notifications
DELEGATE="$IOS/App/AppDelegate.swift"
if ! grep -q "FirebaseMessaging" "$DELEGATE"; then
  python3 - "$DELEGATE" <<'PY'
import sys
p = sys.argv[1]
s = open(p, encoding='utf-8').read()
s = s.replace("import Capacitor\n", "import Capacitor\nimport FirebaseCore\nimport FirebaseMessaging\n", 1)
s = s.replace("        // Override point for customization after application launch.\n        return true",
              "        // Override point for customization after application launch.\n        FirebaseApp.configure()\n        return true", 1)
hook = '''
    // Push (scripts/native-push.sh): Capacitor recibe el token de FCM en lugar del de APNs, para enviar con Firebase
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        Messaging.messaging().apnsToken = deviceToken
        Messaging.messaging().token { token, error in
            if let error = error {
                NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
            } else if let token = token {
                NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: token)
            }
        }
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
    }

}
'''
i = s.rstrip().rfind('}')
s = s[:i].rstrip() + '\n' + hook
open(p, 'w', encoding='utf-8').write(s)
PY
fi
grep -q "FirebaseApp.configure()" "$DELEGATE" || { echo "iOS: no se pudo preparar AppDelegate.swift" >&2; exit 1; }
echo "iOS: GoogleService-Info.plist, Push (aps-environment), remote-notification, FirebaseMessaging y AppDelegate listos"

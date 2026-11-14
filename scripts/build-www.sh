#!/bin/bash

# =============================================================================
# KRUX Build Script
# Copia los archivos web a la carpeta www para Capacitor
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
WWW_DIR="$PROJECT_ROOT/www"

echo "🔨 Building KRUX for Capacitor..."
echo "=================================="

# Limpiar carpeta www
rm -rf "$WWW_DIR"
mkdir -p "$WWW_DIR"

# Copiar archivos HTML
echo "📄 Copiando HTML..."
cp "$PROJECT_ROOT/index.html" "$WWW_DIR/"
cp "$PROJECT_ROOT/offline.html" "$WWW_DIR/"
[ -f "$PROJECT_ROOT/admin-users.html" ] && cp "$PROJECT_ROOT/admin-users.html" "$WWW_DIR/"

# Copiar archivos CSS
echo "🎨 Copiando CSS..."
cp "$PROJECT_ROOT"/*.css "$WWW_DIR/" 2>/dev/null || true

# Copiar archivos JS
echo "📜 Copiando JavaScript..."
cp "$PROJECT_ROOT"/*.js "$WWW_DIR/" 2>/dev/null || true

# Copiar manifest y SW
echo "📱 Copiando PWA assets..."
cp "$PROJECT_ROOT/manifest.json" "$WWW_DIR/"
cp "$PROJECT_ROOT/sw.js" "$WWW_DIR/"

# Copiar favicon y logos
echo "🖼️ Copiando imágenes..."
cp "$PROJECT_ROOT/favicon.png" "$WWW_DIR/" 2>/dev/null || true
cp "$PROJECT_ROOT"/*.png "$WWW_DIR/" 2>/dev/null || true

# Copiar carpetas de assets
echo "📁 Copiando assets..."
[ -d "$PROJECT_ROOT/assets" ] && cp -r "$PROJECT_ROOT/assets" "$WWW_DIR/"
[ -d "$PROJECT_ROOT/icons" ] && cp -r "$PROJECT_ROOT/icons" "$WWW_DIR/"
[ -d "$PROJECT_ROOT/Visuales" ] && cp -r "$PROJECT_ROOT/Visuales" "$WWW_DIR/"
[ -d "$PROJECT_ROOT/Cartografia" ] && cp -r "$PROJECT_ROOT/Cartografia" "$WWW_DIR/"
[ -d "$PROJECT_ROOT/tiles" ] && cp -r "$PROJECT_ROOT/tiles" "$WWW_DIR/"
[ -d "$PROJECT_ROOT/js" ] && cp -r "$PROJECT_ROOT/js" "$WWW_DIR/"
[ -d "$PROJECT_ROOT/vendor" ] && cp -r "$PROJECT_ROOT/vendor" "$WWW_DIR/"

echo ""
echo "=================================="
echo "✅ Build completado!"
echo "📂 Archivos en: $WWW_DIR"
echo ""
echo "Próximo paso: npx cap sync"

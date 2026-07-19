#!/usr/bin/env bash
set -euo pipefail

UUID="gnotch@anorak999.github.io"
EXT_DIR="$HOME/.local/share/gnome-shell/extensions/$UUID"

echo "Uninstalling Gnotch extension..."

gnome-extensions disable "$UUID" 2>/dev/null || true

if [ -d "$EXT_DIR" ]; then
    rm -rf "$EXT_DIR"
    echo "Removed: $EXT_DIR"
else
    echo "Extension not found at $EXT_DIR (already removed?)"
fi

echo ""
echo "To fully unload: log out and back in (Wayland) or press Alt+F2 -> r (X11)"
echo ""

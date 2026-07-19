#!/usr/bin/env bash
set -euo pipefail

UUID="gnotch@anorak999.github.io"
EXT_DIR="$HOME/.local/share/gnome-shell/extensions/$UUID"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "Installing Gnotch extension..."

mkdir -p "$HOME/.local/share/gnome-shell/extensions"
cp -r "$SCRIPT_DIR/$UUID" "$EXT_DIR"

echo "Extension installed to: $EXT_DIR"
echo "UUID in metadata.json:"
grep '"uuid"' "$EXT_DIR/metadata.json"

echo ""
echo "To activate:"
echo "  1. Log out and back in (Wayland) or press Alt+F2 -> r (X11)"
echo "  2. Run: gnome-extensions enable $UUID"
echo ""

#!/usr/bin/env bash
set -euo pipefail
UUID="nookdo@sfaisal.dev"
gnome-extensions disable "$UUID" 2>/dev/null || true
rm -rf "$HOME/.local/share/gnome-shell/extensions/$UUID"
echo "✓ Removed. Your tasks are kept in ~/.local/share/nookdo/ (delete that folder to erase them)."

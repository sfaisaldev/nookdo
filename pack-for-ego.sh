#!/usr/bin/env bash
# Builds the zip to upload at https://extensions.gnome.org/upload/
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE/nookdo@sfaisal.dev"
OUT="$HERE/nookdo@sfaisal.dev.shell-extension.zip"
rm -f "$OUT"
# EGO compiles schemas itself for GNOME 44+, so the compiled file is left out.
zip -qr "$OUT" metadata.json extension.js indicator.js effects.js taskStore.js prefs.js stylesheet.css icons schemas -x 'schemas/gschemas.compiled'
echo "✓ $OUT"

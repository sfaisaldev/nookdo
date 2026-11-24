#!/usr/bin/env bash
# Nookdo installer: copies the extension into your user extensions folder and enables it.
set -euo pipefail
UUID="nookdo@sfaisal.dev"
OLD_UUID="glint-tasks@sfaisal.dev"
HERE="$(cd "$(dirname "$0")" && pwd)"
EXT_DIR="$HOME/.local/share/gnome-shell/extensions"
DEST="$EXT_DIR/$UUID"

shell_ver="$(gnome-shell --version 2>/dev/null | grep -oE '[0-9]+' | head -1 || true)"
echo "→ GNOME Shell version: ${shell_ver:-unknown}"
supported=$(grep -oE '"[0-9]+"' "$HERE/$UUID/metadata.json" | tr -d '"' | tr '\n' ' ')
if [[ -n "$shell_ver" && " $supported " != *" $shell_ver "* ]]; then
  echo "⚠ This build supports GNOME $supported but you run $shell_ver."
  echo "  It may be shown as 'out of date'. Please report this so it can be updated."
fi

# Remove the pre-release "Glint Tasks" copy if present.
if [[ -d "$EXT_DIR/$OLD_UUID" ]]; then
  echo "→ Removing old Glint Tasks build"
  gnome-extensions disable "$OLD_UUID" 2>/dev/null || true
  rm -rf "$EXT_DIR/$OLD_UUID"
fi

echo "→ Installing to $DEST"
rm -rf "$DEST"
mkdir -p "$DEST"
cp -r "$HERE/$UUID/." "$DEST/"
glib-compile-schemas "$DEST/schemas"

# Put it in the enabled list (works before GNOME Shell has discovered it).
python3 - "$UUID" "$OLD_UUID" <<'PY'
import ast, subprocess, sys
uuid, old = sys.argv[1], sys.argv[2]
raw = subprocess.check_output(['gsettings', 'get', 'org.gnome.shell', 'enabled-extensions'], text=True).strip()
lst = [] if raw in ('@as []', '[]') else ast.literal_eval(raw.replace('@as ', ''))
lst = [x for x in lst if x != old]
if uuid not in lst:
    lst.append(uuid)
subprocess.check_call(['gsettings', 'set', 'org.gnome.shell', 'enabled-extensions', str(lst)])
PY
gsettings set org.gnome.shell disable-user-extensions false

if gnome-extensions enable "$UUID" 2>/dev/null; then
  echo "✓ Enabled. Look for the new icon in the top bar (or press Super+Alt+T)."
  gnome-extensions info "$UUID" | grep -E "State|Enabled" || true
else
  echo "✓ Installed. Log out and back in once (Wayland only discovers new extensions at login)."
  echo "  After logging in, check it with:  gnome-extensions info $UUID"
fi

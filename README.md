# Nookdo

A small, fully animated task list that lives in the GNOME top bar (GNOME Shell 45–51: Ubuntu 23.10 through 26.10).

## Install
```bash
unzip nookdo.zip && cd nookdo
./install.sh
```
On Wayland (Ubuntu's default) log out and back in once after the first install.

## Use
- Click the icon in the top bar, or press **Super+Alt+T**.
- Type a task and press **Enter**. **Ctrl+1/2/3** sets Low/Medium/High priority while typing (**Ctrl+0** clears it), or click the priority chip.
- Click the circle to complete a task, **double-click** its text to edit it, and hover it and click **×** to delete it. **Undo** appears for 5 seconds.
- Filter with All / Active / Done. **Clear done** removes completed tasks (it can be undone too).
- The ⚙ button opens Settings.

## Reminders
Settings → Reminders: the popup opens every N minutes (60 by default), **only when you have open tasks**.
The timer restarts each time you open the popup yourself. It skips fullscreen apps, the lock screen
and the overview, and it auto-hides after 20 s if you don't touch it (all adjustable). Use **Preview** to see it.

## Not showing up?
```bash
gnome-shell --version
gnome-extensions info nookdo@sfaisal.dev
journalctl -b -o cat /usr/bin/gnome-shell | grep -i -B2 -A8 nookdo
```

## Publishing
`./pack-for-ego.sh` builds the zip to upload at https://extensions.gnome.org/upload/

## Data
Tasks are saved to `~/.local/share/nookdo/tasks.json`.

## Debugging
```bash
journalctl -f -o cat /usr/bin/gnome-shell     # live logs
gnome-extensions prefs nookdo@sfaisal.dev  # open settings
```

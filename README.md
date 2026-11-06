# Gnotch

A fluid, context-aware morphing notch overlay for the GNOME top bar. It rests as a
small notch below the panel, reflects MPRIS now-playing state, and expands into
richer widgets on demand.

## Requirements

- GNOME Shell 45–48
- `gnome-extensions` CLI (ships with GNOME Shell)

## Install

```bash
git clone https://github.com/Himath-Rajapaksha/Gnotch.git
cd Gnotch
./install.sh
```

The script copies `extension.js`, `metadata.json` and `stylesheet.css` into
`~/.local/share/gnome-shell/extensions/gnotch@anorak999.github.io/`.

Activate it:

```bash
# Wayland: log out and back in first
# X11:     Alt+F2, then "r" to reload the shell
gnome-extensions enable gnotch@anorak999.github.io
```

## Remove

```bash
./uninstall.sh
```

## Structure

| file | role |
| --- | --- |
| `extension.js` | extension entry point — notch geometry, morph tween, MPRIS proxy |
| `metadata.json` | extension UUID, name, supported shell versions |
| `stylesheet.css` | notch and widget styling |
| `install.sh` / `uninstall.sh` | local install and removal |

The idle and expanded geometry targets (`IDLE_WIDTH`, `OPEN_WIDTH`, corner radii,
easing) are constants at the top of `extension.js`.

## Notes

- Wayland requires a full session restart to pick up a newly installed extension;
  `Alt+F2 r` only works on X11.
- Testing is manual: enable the extension, play something over MPRIS, and toggle
  the overlay.

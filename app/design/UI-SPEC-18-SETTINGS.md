# UI-SPEC-18 — Settings

New app. Standard `WindowFrame` chrome (traffic lights left, per `DESIGN.md`). Window: 640×480 default, resizable, min 560×400.

## Layout

- Sidebar: 200px fixed, `--bg-elevated`. Row height 40px, 12px left padding, `--text-primary` label. Selected row: `--accent-bg` fill, `--accent` left-edge indicator bar (3px wide, full row height).
- Content pane: fills remainder, `--bg-surface`, 24px padding.
- Sections, top to bottom: **General**, **Daemon**, **Hotkeys**.

## General pane

Placeholder for v1 — dark mode is the only theme (`DESIGN.md`), so no theme toggle. Show:
- App version (static string)
- Daemon connection status — 8px dot + label, `--status-success` "Connected" / `--status-danger` "Disconnected", reusing tokens already defined in `DESIGN.md`.

## Daemon pane

Three cards, stacked, each `--bg-overlay`, 8px corner radius, 16px internal padding, 16px gap between cards.

**Card 1 — WSL Lifecycle** (existing feature, from `APPEND_WSL_LIFECYCLE.md`): restart button + confirmation modal naming the real distro from `wsl -l -v`. No change here — this spec just places it as the first card in this pane.

**Card 2 — Storage**
- Row: label "Enable Auto-Shrink" (left) + toggle (right), 32px row height.
- Helper text below, 13px `--text-secondary`: "Prevents future disk growth. Existing bloat isn't reclaimed automatically — requires stopping <distro name> once."
- Enabling triggers the same confirmation-modal pattern as WSL Lifecycle's restart action (reuse copy style, real distro name substituted in).
- Underlying action: `wsl --manage <distro> --set-sparse true`. Tauri-side only — no daemon call.

**Card 3 — wsl.conf**
- Four toggle rows, 32px each, label left / toggle right:
  - "Enable systemd" → `systemd`
  - "Append Windows PATH" → `appendWindowsPath`
  - "Auto-mount Windows drives" → `automountEnabled`
  - "Generate /etc/hosts" → `generateHosts`
- Below the toggles: a collapsed disclosure, 13px `--text-tertiary`, label "View raw file" — expands a read-only monospace (`JetBrains Mono`, 12px) block showing the `raw` field from `GET /api/config/wsl-conf`.
- Save button at card bottom-right, sends the full four-key set to `PUT /api/config/wsl-conf` (never a partial patch).
- Footer note under the save button, 12px `--text-tertiary`: "Takes effect on next WSL restart."

## Hotkeys pane

Read-only reference table for v1 — **no rebinding UI**, flagged explicitly as deferred:

| Action | Chord |
|---|---|
| Control-Tab (app switcher) | Ctrl+Shift+Tab |
| Command Center | Ctrl+Shift+/ |
| Spotlight | Ctrl+Shift+Space |
| Zoom in / out | Ctrl+Plus / Ctrl+Minus (per-app, see `UI-SPEC-20`-adjacent table) |

Table row height 32px, `--text-primary` action / `--text-secondary` chord, right-aligned monospace for the chord column.

## Deferred (not this pass)

- Hotkey rebinding
- Any General-pane content beyond version + connection status

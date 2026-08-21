# Aqua UI Spec — Chrome (Menu Bar, Dock, Window Frame)

Every other panel inherits from these three components — get them right first (`DESIGN.md` says the same). Nothing here is app-specific; this is the shell.

Data source: daemon connectivity only (health-check result + WS state), no `CONTRACT.md` payloads. Everything app-specific (window titles, dock badges) is passed in from `windowStore.ts`.

---

## 1. Menu Bar

Height `24px` (`DESIGN.md`), full width, `--bg-elevated`, sits above everything including maximized windows.

```
┌─────────────────────────────────────────────────────────────────────────┐
│ 🖥  Finder   File  Edit  View  Go  Window          ⌾ 42%  🔊  📶  ⬤  14:02 │
└─────────────────────────────────────────────────────────────────────────┘
  ^app icon+name   ^app menus (per focused app)        ^status  ^connection ^clock
```

**Left cluster:** focused app's icon (16px) + name in `--text-primary`, then that app's menu items in `--text-secondary`, `--text-primary` on hover with `--bg-hover` pill behind the label. Menu config comes from the app's manifest (per `aqua-app-plan.md` §5 "app-as-plugin pattern") — Menu Bar itself renders whatever the focused app declares, it owns none of these labels.

**Right cluster**, left to right:
1. Optional per-app quick indicators (e.g. Activity Monitor's live CPU %, if that app declares one)
2. **Daemon connection indicator** — the one global status glyph in the whole OS:
   - Connected: a small solid dot, `--status-success`, no label, tooltip "Aqua daemon connected"
   - Reconnecting: same dot in `--status-warning`, subtle pulse (reuse the `--accent-ring` pulse timing, don't invent a new one), tooltip "Reconnecting to daemon…"
   - Disconnected: dot in `--status-danger`, **does** get a label this time ("Daemon offline") — this is the one state serious enough to break the "icons only" rule, because it explains why every open app just went stale
3. Clock, `--text-primary`, system locale format

Clicking the connection indicator when disconnected opens a small popover: last-seen timestamp, a "Retry now" button (`--accent` primary button), and — only after 3 failed retries — a note suggesting the user check whether the WSL daemon process is running, not a raw error string.

---

## 2. Dock

Collapsed height `64px` (`DESIGN.md`), floats centered at the bottom of the desktop, `--bg-elevated` background, corner radius matches `--card` radius (`8px`), 1px hairline top border at 8% white for separation from wallpaper.

```
        ┌───────────────────────────────────────────────────────┐
        │  [Finder] [Term] [Monitor] [Editor]   |   [Trash]      │
        └───────────────────────────────────────────────────────┘
                         ●     ●
                    (running-app indicator, below icon)
```

Icons `48px`, magnify to `64px` max on hover/mouse-proximity (`DESIGN.md`: 120ms ease-out — this is the one place continuous magnify motion is allowed; don't add it anywhere else in the OS). A vertical hairline divider separates pinned apps from Trash/utility slot.

**Running indicator:** a `4px` dot in `--accent`, centered under the icon, one dot per open window up to 3, then a "+2" style overflow — never more than three dots, this is a presence signal not a counter.

**States:**
- **Not running:** icon at rest opacity, no dot.
- **Running, unfocused:** icon full opacity, dot(s) present.
- **Running, focused:** icon gets a `2px` `--accent` underline glow instead of changing the icon itself — focus lives in the Menu Bar's app name too, so this is a secondary confirmation, not the primary one.
- **Launching (daemon-backed app whose first data call hasn't returned):** icon bounces once (borrow the window-open easing, `DESIGN.md`, don't add a new curve) then settles to "running" — no separate spinner on the dock icon itself, the app's own window shows its Loading state per that app's spec.

Right-click / long-press on a running icon → context menu: "Show All Windows", "Minimize", "Quit" (quit here means close all that app's windows, not kill the daemon — see `aqua-app-plan.md` §4 on daemon lifecycle).

---

## 3. Window Frame

The chrome every app window (Finder, Terminal, Editor, Activity Monitor) is wrapped in. Corner radius `10px` (`DESIGN.md`), title bar height `28px`, fully custom — `decorations: false`, there is no native Windows title bar underneath this.

```
┌───────────────────────────────────────────┐
│ ●●●            Finder — ~/projects         │  ← 28px title bar
├───────────────────────────────────────────┤
│                                             │
│              (app content)                 │
│                                             │
└───────────────────────────────────────────┘
```

**Traffic lights:** `12px` diameter, `8px` gap between them, left-aligned with `16px` inset from the window's left edge. Colors reuse semantic status tokens rather than inventing macOS-red/yellow/green hexes from scratch: close = `--status-danger`, minimize = `--status-warning`, maximize = `--status-success`. At rest they render at ~60% opacity (quiet, not a traffic light shouting at you); on title-bar hover they reach full opacity and show their glyph (×, –, ⤢) in `--bg-surface` at 8px.

**Title:** centered in the title bar, `--text-secondary`, app name em-dash current context (Finder's cwd, Editor's filename, Terminal's shell cwd) — the em-dash pattern is consistent across every app so a glance at any title bar tells you the same *kind* of thing.

**Body:** `--bg-surface`, content area only — every app's own spec below describes what fills it.

**Focused vs. unfocused window:** focused window's title bar text goes to `--text-primary` and traffic lights sit at full opacity even without hover; unfocused windows dim their title bar text to `--text-tertiary` and traffic lights drop to ~35% opacity. This is the loudest focus signal in the OS (paired with the Dock underline and Menu Bar app name) — three consistent, quiet signals beat one loud one.

**Resize handles:** 4px invisible hit-zone on all edges + corners, cursor changes on hover, no visible affordance line (macOS convention — a visible resize handle reads as un-mac).

**Window open/close:** `220ms cubic-bezier(0.4, 0, 0.2, 1)` (`DESIGN.md`) — scale + fade from the Dock icon's position on open, reverse on close. Minimize animates *to* the Dock icon specifically (not a generic fade) at `320ms` (`DESIGN.md` "Minimize-to-dock").

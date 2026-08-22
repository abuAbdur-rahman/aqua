# Aqua UI Spec — System Menu

Adds a dedicated system-menu slot to the Menu Bar, distinct from the focused-app slot already specified in `UI-SPEC-01-Chrome.md`. That spec had the leftmost Menu Bar item bound to whichever app is focused; this splits that into two slots, matching how a real desktop separates "the OS" from "the current app" — clicking the app name was never going to be a sane place for power actions, since it changes meaning every time focus changes.

**Amend `UI-SPEC-01-Chrome.md` §1 Menu Bar left cluster to read:**

```
┌─────────────────────────────────────────────────────────────────────────┐
│ ◆  Finder   File  Edit  View  Go  Window          ⌾ 42%  🔊  📶  ⬤  14:02 │
└─────────────────────────────────────────────────────────────────────────┘
  ^system menu ^focused app + its menus
```

`◆` is a small fixed Aqua glyph (16px, the accent-cyan diamond/squircle mark — reuse the same shape language as the app icons' tile corner radius, scaled down), always present regardless of what's focused. It never changes label or icon. The focused app's icon+name sits immediately to its right, unchanged from the original Chrome spec.

Data source: none from `CONTRACT.md` for the menu itself (it's pure UI chrome) — individual items trigger Tauri host lifecycle calls, not daemon API calls, except where noted below.

## Dropdown

Opens directly under the `◆` glyph on click, `--bg-overlay` surface, `8px` corner radius, same open motion as any other dropdown in this OS (reuse the Spotlight-adjacent quick fade+scale, not a new curve).

```
┌────────────────────────────┐
│  About Aqua                 │
│  Settings…                  │
├────────────────────────────┤
│  Restart Daemon              │
├────────────────────────────┤
│  Force Quit…                │
│  Sleep Display               │
│  Restart Aqua                │
│  Shut Down Aqua               │
└────────────────────────────┘
```

Three groups, separated by hairline dividers (`1px`, 8% white) — grouped by *consequence*, not alphabetically: info/settings, daemon-affecting, session-ending. This ordering means the most destructive items are always at the bottom, farthest from the accidental first click.

**About Aqua** — opens a small fixed-size non-resizable panel (not a full Window Frame app, more like a lightweight info card): Aqua glyph large, version string, daemon version (pulled from `GET /api/health`'s `HealthResponse.version` the next time it's available — shows "—" if daemon's unreachable rather than blocking the panel open), WSL distro name. No actions beyond a close ×.

**Settings…** — focuses/launches the Settings app (`UI-SPEC-09-Settings.md`). No confirmation needed, this is non-destructive.

**Restart Daemon** — kills and respawns the WSL daemon child process without touching the Aqua app window itself. This is real disruption (drops every open Terminal session, per `aqua-backend-plan.md` risk table), so it routes through the Confirmation Modal (`UI-SPEC-08-Modals.md`) before firing: "Restart the daemon? Open terminal sessions will end." / Cancel / Restart (danger-styled). Purely a Tauri-host lifecycle action — same spawn/health-check sequence as first launch (`aqua-app-plan.md` §4), no new daemon endpoint needed for this.

**Force Quit…** — opens a compact list of currently-open apps (from `windowStore`), each row with a "Force Quit" text button. Quitting Terminal this way closes its window(s) *and* signals the daemon to end any pty sessions tied to those windows (already covered by "kill pty on WS close" in the daemon's existing risk mitigation — no new backend work). No confirmation modal on individual force-quits inside this panel; the panel itself, being opened deliberately from a destructive-leaning menu group, is the friction.

**Sleep Display** — cosmetic only, not real hardware sleep (this app has no path to controlling actual Windows power state, and that's a deliberately bigger, more consequential capability than anything else in scope — flagging rather than quietly building it). Dims the desktop under a near-opaque `--bg-base` overlay with the clock centered, wakes on any keypress/click. No modal needed, it's non-destructive and instantly reversible.

**Restart Aqua** — quits the Tauri app and relaunches it, respawning the daemon fresh in the process. Routes through the Confirmation Modal same as Restart Daemon (same underlying disruption, plus it also closes every window).

**Shut Down Aqua** — quits the app *and* explicitly stops the daemon (the one place daemon shutdown is intentional — normal window-close leaves it running per `aqua-app-plan.md` §4 step 4). Confirmation Modal, danger-styled: "Shut down Aqua? This closes every window and stops the background daemon."

## States

Only one state worth designing for: **daemon unreachable when the menu opens.** "Restart Daemon" and "About Aqua"'s version line both degrade gracefully — Restart Daemon's label just changes to "Start Daemon" (since there's nothing running to kill, only to spawn), no error shown, since a daemon being down is already surfaced globally by the Menu Bar's connection dot.

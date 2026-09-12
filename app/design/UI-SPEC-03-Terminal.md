# Aqua UI Spec — Terminal

Data source: `POST /api/pty/spawn` (`PtySpawnRequest`/`Response`), then `WS /ws/pty/:sessionId` — raw bytes both directions, control frames for `PtyResize`, server-sent `PtyExit`. Shapes: `CONTRACT.md` §Terminal. Rendered with `xterm.js` (`../PLAN.md` §5).

## Layout

```
┌───────────────────────────────────────────┐
│ ●●●     bash — ~/projects/aqua        ▾   │  ← title bar, ▾ = tab switcher if >1 tab
├──[ bash ]──[ bash · npm run dev ]──[ + ]───┤  ← tab strip, only shown when 2+ tabs
│ abdul@wsl:~/projects/aqua$ ls               │
│ AGENTS.md  CONTRACT.md  DESIGN.md  README.md│
│ abdul@wsl:~/projects/aqua$ ▏                │  ← blinking cursor
│                                              │
└───────────────────────────────────────────┘
```

**Single tab:** tab strip is hidden entirely — no strip with one meaningless tab sitting in it. It appears the moment a second tab opens, disappears again if closed back down to one (don't leave a dead single-tab strip around).

**Tab strip** (when present): `28px` tall, sits directly under the title bar, `--bg-elevated`. Each tab shows a short label — defaults to the shell name, updates to reflect the foreground process if the pty reports one (e.g. `bash` → `bash · npm run dev`) so a background dev-server tab is identifiable at a glance instead of every tab reading "bash." Active tab gets `--bg-surface` (matches body, "lifts" it visually above the strip); inactive tabs sit at `--bg-elevated` with `--text-secondary` label. `+` button spawns a new session via `pty/spawn` with the same `cwd` as the currently active tab.

**Body:** `xterm.js` canvas, monospace = JetBrains Mono (`DESIGN.md`), background `--bg-surface`, default foreground `--text-primary`. ANSI 16-color palette maps onto the semantic tokens where a sane mapping exists (green→`--status-success`, red→`--status-danger`, yellow→`--status-warning`, cyan→`--accent`) rather than xterm.js's stock palette, so a `git status` in this terminal visually agrees with the rest of the OS's status colors.

Padding: `8px` on all sides between the xterm canvas and the window edge — a pty with text glued to the window border reads as unfinished.

**Cursor:** block cursor, `--accent` fill when the pane is focused, hollow/outline-only when unfocused — same focused/unfocused logic as the Window Frame itself, applied at the pane level for multi-tab clarity.

## Interactions

- Standard xterm.js selection-to-copy, right-click paste (matches every real terminal, don't reinvent).
- Resize: window/pane resize sends a `PtyResize` control frame debounced to the trailing edge of the drag (not every intermediate frame) — mirrors the layout-write debounce pattern already used elsewhere in this app, for the same reason (don't flood the daemon).
- Closing a tab with a foreground child process running (not just an idle shell) shows a lightweight confirm ("A process is still running in this tab — close anyway?") rather than killing silently. Closing the idle-shell case needs no confirmation.

## States

**Spawning** (between `pty/spawn` request and the WS connection completing): the pane shows a single centered line, "Starting shell…", in `--text-tertiary`, no premature empty prompt-looking placeholder that could be mistaken for a real dead terminal.

**Connected / populated:** as above — this is the primary and by far most common state, most of the visual budget goes here rather than the edge cases.

**Exited** (`PtyExit` received): the pane doesn't just go blank. Print a final line in `--text-tertiary`: `[Process exited with code {code}]`, non-zero codes get the `{code}` in `--status-danger` instead of the default text color. Below that, an inline "Restart" text-button (`--accent`) that re-runs `pty/spawn` with the same `cwd` into the same tab, so an accidentally-killed shell isn't a lost tab.

**Disconnected** (daemon connection drops mid-session, separate from a clean `PtyExit`): the whole pane dims slightly (overlay at `--bg-overlay`, low opacity) with a centered "Connection lost — reconnecting…" — this defers to the global Menu Bar connection indicator for the underlying cause, it doesn't re-explain the daemon state, just says this pane's stream specifically is stalled.

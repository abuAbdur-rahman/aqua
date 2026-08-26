# Aqua — UI Specs (Index)

Companion set to `DESIGN.md` (tokens) and `CONTRACT.md` (data shapes). Those two files say *what values exist*; this set says *where they go on screen* — layout, states, and composition for every panel in Aqua. Written for the Windows agent (`app/`) to build directly against; no new tokens are introduced here that aren't already in `DESIGN.md`.

Read `app/AGENTS.md` and `DESIGN.md` before any of these. These specs assume both.

## Files in this set

| File | Covers |
|---|---|
| `UI-SPEC-01-Chrome.md` | Menu Bar, Dock, Window Frame — the shell every app sits inside |
| `UI-SPEC-02-Finder.md` | Finder — list/icon view, Quick Look preview |
| `UI-SPEC-03-Terminal.md` | Terminal — xterm.js pane, tabs |
| `UI-SPEC-04-ActivityMonitor.md` | Activity Monitor — live stats, process list |
| `UI-SPEC-05-Editor.md` | Editor — Monaco, multi-tab |
| `UI-SPEC-06-Spotlight.md` | Spotlight — search palette |
| `UI-SPEC-07-SystemMenu.md` | System Menu and lifecycle actions |
| `UI-SPEC-08-Modals.md` | Shared confirmation and sudo elevation modals |
| `UI-SPEC-09-Settings.md` | Settings, appearance, wallpaper, daemon, and About panes |
| `UI-SPEC-10-FilePicker.md` | Open/Save file-picker sheet shared by Editor, Settings' wallpaper picker, and future callers |
| `UI-SPEC-11-Greeter.md` | Boot Greeter — pre-daemon startup/health-check screen with retry state |
| `UI-SPEC-14-CommandCenter.md` | Command Center — searchable action palette |
| `UI-SPEC-15-Trash.md` | Trash — recoverable delete bucket, restore/permanent-delete/empty |

## Conventions used across every spec

**ASCII wireframes** show structure and proportion, not pixel-perfect layout — treat box widths as relative, not literal. Any exact number called out in prose (heights, radii, gaps) comes straight from `DESIGN.md` and is load-bearing; anything only shown in a wireframe is a suggestion the agent can adjust for React Flexbox/Grid reality.

**Every screen is specified in four states**, because a daemon-backed app spends real time outside its "happy path" and an agent guessing at these later is where visual drift creeps in:
- **Loading** — daemon reachable, data not back yet
- **Empty** — daemon reachable, data back, genuinely nothing there
- **Populated** — the normal case
- **Error / disconnected** — daemon unreachable or a call failed

**Connection status is global, not per-app.** A single daemon-connection indicator lives in the Menu Bar (see Chrome spec) — individual app panels don't each invent their own "reconnecting…" banner. An app panel's own error state is for *that app's* call failing while the daemon is otherwise up (e.g. one `fs/read` 404s).

**Data source per screen** is named explicitly at the top of each spec (which `CONTRACT.md` types back it), so the agent can see at a glance what's real vs. what's local UI state.

**Signature element:** the one place this OS commits to a visual idea beyond "clone macOS" is the accent-ring focus states and the Spotlight open animation (`DESIGN.md` motion table) — sharp, cyan, quick. Everywhere else, restraint: this is a tool people will stare at for hours, not a landing page. No decorative gradients beyond the wallpaper, no motion beyond what `DESIGN.md` already specifies.

**Empty states act, they don't apologize.** Every empty state below names the action that fills it, not a mood ("No files here" is wrong; "Drop files here, or ⌘N to create one" is right).

**Accessibility floor for every screen:** visible `--accent-ring` focus outline on every interactive element (never suppress `:focus-visible`), all icon-only buttons get an accessible label, color is never the only signal for status (pair `--status-danger` with an icon/label, not just a red dot).

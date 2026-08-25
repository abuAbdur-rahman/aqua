# Aqua — WSL Ubuntu → macOS Desktop

## Objective

A real, daily-driver desktop for WSL Ubuntu that looks and behaves like macOS — Finder, Terminal, Activity Monitor, a code editor, Spotlight, a full window manager with Spaces — shipped as a native Windows app called **Aqua**. Not a demo: the goal is to actually use this instead of raw terminal + Explorer for day-to-day WSL work.

Two independently-buildable pieces:

- **The app** (`app/src-tauri/` + `app/frontend/`) – a native Tauri window hosting the React UI. Owns everything visible.
- **The backend** (`daemon/`) — a Rust/Axum binary running *inside* WSL Ubuntu, bound to `127.0.0.1`. Owns everything real: filesystem, processes, shell.

Full detail lives in four companion docs:

- [`app/PLAN.md`](./app/PLAN.md) — Tauri host + frontend
- [`daemon/PLAN.md`](./daemon/PLAN.md) — Rust daemon
- [`CONTRACT.md`](./CONTRACT.md) — exact request/response shapes for every call between them
- [`DESIGN.md`](./DESIGN.md) — dark-mode-only color tokens, chrome dimensions, motion timing

This README is the entry point: what it is, how the pieces fit together, how the repository is validated, and where the current work stands.

## How it fits together

```
[ WebView (React UI) ] ──direct fetch/WS──▶ [ Rust daemon (Axum), inside WSL ] ──▶ [ real fs / processes / shell ]
[ Tauri Rust host ]     ──spawn + health-check──▶ [ same daemon ]
```

The WebView talks straight to the daemon over `http://localhost:61234` – WSL2 forwards that automatically, no proxying needed. The Tauri Rust host only starts the daemon and owns OS-integration bits (global hotkey, tray, frameless window). Two consumers of one API, defined once in `CONTRACT.md`.

## Locked scope

| Area | Decision |
|---|---|
| Delivery shell | Native Tauri app, not a browser tab |
| App windows | Custom-built panels — no WSLg app streaming |
| Access model | Localhost only, no auth |
| Finder | Full CRUD + Quick Look-style preview |
| Terminal | Full unrestricted pty — real bash, sudo, everything |
| Window manager | Full pro-grade + Spaces |
| Editor | Monaco-based, multi-tab |
| Activity Monitor | Read-only live stats |
| Spotlight | Files + app launch + quick actions + global hotkey |
| Gallery | Grid + full-screen image browsing, folder-scoped. No new daemon surface. |
| Command Center | `Ctrl+Shift+/` action palette — window, Space, app-menu, and system commands. No new daemon surface. |
| Menu bar | Functional, context-sensitive per app |
| Theme | Dark mode only — see `DESIGN.md` |

v2 stretch (not built now): real WSLg app streaming, GUI process kill/renice, multi-distro switching, wallpaper customization, Notification Center.

## Repo structure

One GitHub repo, cloned twice — once per OS, each built with that OS's native toolchain. Don't develop across a `\\wsl.localhost\` mount: Cargo builds are markedly slower over it, file watchers (Vite/Tauri dev reload) get unreliable, and `src-tauri` has to link Windows' WebView2 anyway, so it wants Windows-native files.

```
aqua/                                    # the repo, same on both sides
  AGENTS.md            # shared context – human-maintained, agents read but never edit
  app/                  # Windows agent's scope
    PLAN.md             # Tauri host + frontend roadmap
    src-tauri/          # Tauri Rust host
    frontend/           # React/TS UI
    AGENTS.md           # Windows agent instructions
  daemon/               # WSL agent's scope
    PLAN.md             # Rust daemon roadmap
    src/
    Phases/
    AGENTS.md           # WSL agent instructions
  README.md
  CONTRACT.md
  DESIGN.md
```

```
WSL (ext4):      ~/projects/aqua-daemon/         → build/run daemon/ from here, WSL agent's cwd
Windows (NTFS):  C:\Users\abdul\projects\aqua-app\  → build/run app/ from here, Windows agent's cwd
```

Git is the sync layer between the two clones, not a shared mount — push after finishing a piece on one side, pull before starting the matching piece on the other. Maps directly onto the alternating build order in "Where to start" below. `.gitattributes` at repo root should force `* text=auto eol=lf` so files don't show as dirty purely from crossing OSes; `target/`, `node_modules/`, and `dist/` stay gitignored as usual on both sides.

## Repository workflow

The repository uses `master` as its default branch. Direct pushes are protected by the `Protect master` GitHub ruleset: pull requests, one approving review, resolved review threads, and passing `Daemon checks` and `App checks` are required. The repository owner may bypass these requirements for deliberate administrative changes. Force-pushes and branch deletion are blocked.

CI is defined in [`.github/workflows/ci.yml`](./.github/workflows/ci.yml) and runs on pushes and pull requests:

- Daemon: `cargo fmt --check`, Clippy with `-D warnings`, and all Rust tests on Ubuntu.
- App: `pnpm test`, `pnpm build`, and Tauri host `cargo check` on Windows.
- App CI uses Node 24 and pnpm 11.6.0.

Read [`CONTRIBUTING.md`](./CONTRIBUTING.md) before opening a change. The two workstreams remain independently buildable: app changes belong under `app/`, daemon changes belong under `daemon/`, and shared contract changes require coordination.

## Current status

Backend Phases 0–6 are complete and verified (foundation, Finder, Terminal, Activity Monitor, Spotlight search backend, SQLite layout persistence, hardening audit). Windows-native end-to-end verification has passed: health, fs create/write/list/read/rename/chmod/delete with traversal rejection, Spotlight file + calculator results over a created-then-renamed file, layout persistence round-trip without shape drift, and PTY spawn → Origin-gated WebSocket bridge → binary echo → resize → exit frame → normal close — all driven from Windows against the WSL daemon on `localhost:61234`.

On the app side, all planned phases are complete: Tauri scaffold with daemon spawn/health-check and CSP wiring, window manager core with OS chrome per `UI-SPEC-01`, Finder filesystem workspace, Terminal PTY sessions via `/ws/pty/:sessionId`, Activity Monitor streaming via `/ws/sysmon`, a Monaco-style Editor linked to Finder/Terminal, the Spotlight palette (debounced `GET /api/search?q=`, grouped results, system-wide Ctrl+Shift+Space via `tauri-plugin-global-shortcut`, verified end-to-end from the native Windows app), Spaces — multi-desktop with Mission Control, drag-to-migrate window cards, space add/remove, and Ctrl+←/→ / Ctrl+1..9 keyboard switching — plus the Gallery image browser (`UI-SPEC-12`, grid + Loupe over existing fs endpoints), System Menu and shared modals, Settings with wallpaper management, and layout persistence with debounced writes, viewport clamping, dock magnification, tray actions, and a11y/bundle audits (App Phases 8–10).

The next active work is **daily-driver usage**: run the app as the primary WSL workflow and file follow-up issues from real friction. Known open items: Gallery icon gradient drifts from `DESIGN.md` accent tokens, and Trash delete semantics (hard vs recoverable) remain an undecided contract question.

Client-supplied spec additions are registered: [`APPEND_V3.md`](./APPEND_V3.md) (menu dispatch contract + graceful shutdown), [`app/design/UI-SPEC-10-FilePicker.md`](./app/design/UI-SPEC-10-FilePicker.md), and [`app/design/UI-SPEC-11-Greeter.md`](./app/design/UI-SPEC-11-Greeter.md) — none implemented yet. [`app/design/UI-SPEC-12-Gallery.md`](./app/design/UI-SPEC-12-Gallery.md) is registered but unimplemented (App Phase 5.5); [`app/design/UI-SPEC-13-Spaces.md`](./app/design/UI-SPEC-13-Spaces.md) was written retroactively and is already covered by the shipped App Phase 7.

## Build order

Build backend capabilities before the UI that consumes them. All planned phases are complete; remaining work is end-to-end verification from the Windows-native checkout.

- [x] Backend Phases 0–3 – foundation, Finder, Terminal, Activity Monitor
- [x] Backend Phase 4 – Spotlight search backend
- [x] App Phases 0–5 – scaffold, chrome, window manager, Finder, Terminal, Activity Monitor, Editor
- [x] App Phase 6 – Spotlight UI and global hotkey
- [x] App Phase 7 – Spaces and Mission Control
- [x] Backend Phase 5 – Persistence
- [x] App Phase 8 – Polish and persistence wiring
- [x] Backend Phase 6 – Hardening audit
- [x] App Phase 5.5 – Gallery UI (`UI-SPEC-12`)
- [x] App Phases 9–10 – System Menu & Modals, Settings + Wallpaper
- [x] Windows-native end-to-end verification (health, search, PTY, fs ops, persistence)

### Windows handoff

Run the app from a Windows-native checkout and verify that the Tauri host starts the daemon and that the WebView can reach `http://localhost:61234/api/search?q=`. Do not infer Windows reachability from WSL-only tests.

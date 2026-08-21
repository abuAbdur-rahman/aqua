# Aqua — WSL Ubuntu → macOS Desktop

## Objective

A real, daily-driver desktop for WSL Ubuntu that looks and behaves like macOS — Finder, Terminal, Activity Monitor, a code editor, Spotlight, a full window manager with Spaces — shipped as a native Windows app called **Aqua**. Not a demo: the goal is to actually use this instead of raw terminal + Explorer for day-to-day WSL work.

Two independently-buildable pieces:

- **The app** (`src-tauri/` + `frontend/`) — a native Tauri window hosting the React UI. Owns everything visible.
- **The backend** (`daemon/`) — a Rust/Axum binary running *inside* WSL Ubuntu, bound to `127.0.0.1`. Owns everything real: filesystem, processes, shell.

Full detail lives in four companion docs:

- [`aqua-app-plan.md`](./aqua-app-plan.md) — Tauri host + frontend
- [`aqua-backend-plan.md`](./aqua-backend-plan.md) — Rust daemon
- [`CONTRACT.md`](./CONTRACT.md) — exact request/response shapes for every call between them
- [`DESIGN.md`](./DESIGN.md) — dark-mode-only color tokens, chrome dimensions, motion timing

This README is the entry point: what it is, how the pieces fit, and where to start.

## How it fits together

```
[ WebView (React UI) ] ──direct fetch/WS──▶ [ Rust daemon (Axum), inside WSL ] ──▶ [ real fs / processes / shell ]
[ Tauri Rust host ]     ──spawn + health-check──▶ [ same daemon ]
```

The WebView talks straight to the daemon over `http://localhost:61234` — WSL2 forwards that automatically, no proxying needed. The Tauri Rust host only starts the daemon and owns OS-integration bits (global hotkey, tray, frameless window). Two consumers of one API, defined once in `CONTRACT.md`.

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
| Menu bar | Functional, context-sensitive per app |
| Theme | Dark mode only — see `DESIGN.md` |

v2 stretch (not built now): real WSLg app streaming, GUI process kill/renice, multi-distro switching, wallpaper customization, Notification Center.

## Repo structure

One GitHub repo, cloned twice — once per OS, each built with that OS's native toolchain. Don't develop across a `\\wsl.localhost\` mount: Cargo builds are markedly slower over it, file watchers (Vite/Tauri dev reload) get unreliable, and `src-tauri` has to link Windows' WebView2 anyway, so it wants Windows-native files.

```
aqua/                                    # the repo, same on both sides
  AGENTS.md            # shared context — human-maintained, agents read but never edit
  app/                  # Windows agent's scope — its own AGENTS.md lives here
    src-tauri/            # Tauri Rust host — see aqua-app-plan.md
    frontend/              # React/TS UI — see aqua-app-plan.md
    AGENTS.md
  daemon/                # WSL agent's scope — its own AGENTS.md lives here
    ...                    # Rust/Axum backend — see aqua-backend-plan.md
    AGENTS.md
  README.md
  aqua-app-plan.md
  aqua-backend-plan.md
  CONTRACT.md
  DESIGN.md
```

`src-tauri/` nests inside `app/` (matching how `create-tauri-app` scaffolds normally look) rather than sitting as a sibling to `frontend/` — this gives the Windows agent one directory, `app/`, to point its cwd at, and one `AGENTS.md` inside it that covers both the Rust host and the frontend. The WSL agent gets the same treatment under `daemon/`. Point each agent's working directory at its own subtree so it discovers the right file automatically instead of needing to be told every session — and because the two files never share a path, nothing about running two agents against the same underlying repo can produce a git conflict between them. The only file both agents can see is the root `AGENTS.md`, and the rule there is simple: they read it, they don't write it.

```
WSL (ext4):      ~/projects/aqua-daemon/         → build/run daemon/ from here, WSL agent's cwd
Windows (NTFS):  C:\Users\abdul\projects\aqua-app\  → build/run app/ from here, Windows agent's cwd
```

Git is the sync layer between the two clones, not a shared mount — push after finishing a piece on one side, pull before starting the matching piece on the other. Maps directly onto the alternating build order in "Where to start" below. `.gitattributes` at repo root should force `* text=auto eol=lf` so files don't show as dirty purely from crossing OSes; `target/`, `node_modules/`, and `dist/` stay gitignored as usual on both sides.

## Where to start

Build order respects the one real dependency: **the app can't do anything until the daemon exists and responds to a health check.** After that, alternate — build a daemon endpoint, then the UI that consumes it — rather than finishing either side end-to-end first.

- [ ] **Backend Phase 0** — `cargo new daemon`, `/api/health` + WS echo, confirm reachable from Windows at `http://localhost:61234`
- [ ] **App Phase 0** — Tauri scaffold, spawn/health-check the daemon, frameless window + empty Dock/MenuBar (per `DESIGN.md`), confirm WebView → daemon WS round-trip
- [ ] **App Phase 1** — Window manager core (drag/resize/focus/minimize, single Space)
- [ ] **Backend Phase 1** — Finder backend (CRUD + fs-watch)
- [ ] **App Phase 2** — Finder UI
- [ ] **App Phase 5** — Editor UI (Monaco) — only needs fs/read+write from Backend Phase 1
- [ ] **Backend Phase 2** — Terminal backend (pty)
- [ ] **App Phase 3** — Terminal UI
- [ ] **Backend Phase 3** — Activity Monitor backend
- [ ] **App Phase 4** — Activity Monitor UI
- [ ] **Backend Phase 4** — Spotlight backend (tantivy index + search)
- [ ] **App Phase 6** — Spotlight UI + global hotkey
- [ ] **App Phase 7** — Spaces
- [ ] **Backend Phase 5** — Persistence (SQLite layout store)
- [ ] **App Phase 8** — Polish (persistence wiring, menu bar content, dock animation, tray menu)
- [ ] **Backend Phase 6** — Hardening (path validation audit, Origin checks)

### Right now

```
cargo new daemon
```

inside WSL. Stand up `GET /api/health` and a `/ws/echo` route, confirm you can hit `http://localhost:61234/api/health` from a Windows browser or `curl.exe`. That's the one thing every other phase, in every doc, depends on.

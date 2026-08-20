# Aqua — App Plan (Tauri + Frontend)

Repo slice: `src-tauri/` + `frontend/`. This is Aqua's native Windows shell — the window manager, every visible panel, and the OS-integration glue (daemon lifecycle, global hotkey, tray). It owns no real data; everything it shows comes from the daemon over the API contract in §6 (full shapes: `CONTRACT.md`).

**Companion docs:**
- `aqua-backend-plan.md` — owns the Rust daemon this app talks to
- `CONTRACT.md` — exact request/response shapes for every call this app makes
- `DESIGN.md` — dark-mode-only color tokens, chrome dimensions, motion timing

Build order: backend §10 Phase 0 → app §7 Phase 0 → then alternate per feature — a phase here is only as useful as the matching backend phase it depends on.

## 1. Scope owned by this app

| Area | Decision |
|---|---|
| Delivery shell | Native Tauri app, not a browser tab |
| Window manager | Full pro-grade: drag, resize, edge-snap, minimize-to-dock, multi-window, **+ Spaces** |
| Finder UI | Full CRUD UI, Quick Look-style preview (images inline, PDFs paginate, markdown/code render) |
| Terminal UI | `xterm.js` renderer streaming a real bash pty from the daemon |
| Editor UI | Monaco-based, multi-tab, save-to-disk |
| Activity Monitor UI | Read-only live charts (CPU/mem/disk/process list) |
| Spotlight | Files + content search, app launcher, quick actions, **system-wide global hotkey** |
| Menu bar | Functional, context-sensitive per focused app |
| Access model | Localhost only, no auth — WebView never loads anything but Aqua |

## 2. Why native (Tauri) instead of a browser tab

| Reason | Detail |
|---|---|
| No browser chrome | Address bar/tab strip breaks the "this is an OS" illusion. Tauri's frameless window gives full control of the chrome. |
| Global hotkey | Spotlight needs a system-wide hotkey that fires unfocused. Browsers can't do this; Tauri's `global-shortcut` plugin can. |
| Security exposure closed | The daemon is unauthenticated with an unrestricted shell. In a real browser, any other tab can blind-`fetch()` it (CORS blocks reading the response, not sending the request). A dedicated Tauri window only ever loads Aqua, closing that attack class. |
| Auto-launch daemon | The Rust host shells out `wsl.exe -d Ubuntu -- ./daemon` on startup — no manual backend startup. |

## 3. Architecture (this app's slice)

Two halves inside one `.exe`, with different jobs:

- **WebView (React UI)** — talks **directly** to the daemon over `fetch`/`WebSocket` at `http://localhost:8080`. No IPC proxying for data — same calls a browser tab would make.
- **Tauri Rust host** — owns only OS-integration: daemon lifecycle (spawn, health-check, no relaunch if already running), the global Spotlight hotkey, the tray icon, frameless window config. Never touches file data, pty streams, or stats.

Don't route file ops, pty streams, fs-watch, or sysmon through Tauri IPC — that's double-plumbing every daemon endpoint for no benefit. Let the WebView call the daemon directly; WSL2's localhost forwarding makes `http://localhost:8080` reachable from Windows automatically.

## 4. Tauri host design

### Crates / plugins

| Crate | Purpose |
|---|---|
| `tauri` | Core app framework, window management |
| `tauri-plugin-shell` | Spawn `wsl.exe -d Ubuntu -- ./daemon` as a child process |
| `tauri-plugin-global-shortcut` | Register the Spotlight hotkey system-wide |
| Tauri core tray feature | System tray icon (built into v2 core, no separate plugin) |
| `reqwest` | Health-check ping to the daemon before showing the window |

### Startup sequence

1. Ping `GET http://localhost:8080/api/health`.
2. If it responds, the daemon's already running — show the window.
3. If not, spawn `wsl.exe -d Ubuntu -- ./daemon`, poll health every ~200ms (timeout ~5s), then show the window.
4. On app quit, **leave the daemon running** — killing it drops active pty sessions and in-memory index state. A "Quit and stop backend" tray item can be added later for an explicit full shutdown.

### Window config (`tauri.conf.json`)

- `identifier: "com.abdul.aqua"` (or your preferred reverse-domain), `productName: "Aqua"`
- `decorations: false` — no native title bar; you own the chrome, which is what makes the menu bar/traffic-light illusion work
- `app.security.csp` — must explicitly allow `connect-src http://localhost:8080 ws://localhost:8080`, or the default CSP blocks the WebView's calls to the daemon

## 5. Frontend design (React + TypeScript)

**Stack:** React, TypeScript, Tailwind, Zustand (window/app state), Framer Motion (window/dock animation), `xterm.js` (terminal), Monaco Editor (code editor). All colors, spacing, and chrome dimensions come from `DESIGN.md` as CSS variables/Tailwind theme extensions — never hardcode a hex in a component.

```
frontend/src/
  desktop/
    Desktop.tsx           # root: wallpaper, spaces container, drop target
    Dock.tsx
    MenuBar.tsx             # renders per-focused-app menu config
    Spotlight.tsx
    Spaces.tsx               # Mission Control view + space switching
  window-manager/
    WindowFrame.tsx         # chrome: traffic lights, title bar, resize handles
    windowStore.ts           # Zustand: z-order, position, size, minimized, per-space
  apps/
    finder/
      Finder.tsx
      FileList.tsx
      PreviewPane.tsx
      useFsWatch.ts
    terminal/
      Terminal.tsx            # xterm.js + WS bridge
    activity-monitor/
      ActivityMonitor.tsx
      useSysmon.ts
    editor/
      Editor.tsx               # Monaco wrapper
    spotlight/
      SpotlightPalette.tsx
  lib/
    ws.ts                      # typed WS channel multiplexer, points at localhost:8080
    api.ts                     # typed REST client, points at localhost:8080
    api-types.ts                # from CONTRACT.md — generated once real daemon code exists
```

**App-as-plugin pattern:** each app registers a manifest — icon, default window size, menu bar config, dock behavior. `WindowManager` and `Dock` are generic and know nothing about specific apps, so adding one later (Preview, Notification Center) is additive, not invasive.

## 6. API contract this app consumes

Path/purpose map below; exact request/response shapes live in `CONTRACT.md`.

| Path | Type | Purpose |
|---|---|---|
| `GET /api/health` | REST | Used by the Tauri host at startup |
| `GET /api/fs/list?path=` | REST | Directory listing |
| `POST /api/fs/op` | REST | Create/rename/move/delete/chmod |
| `GET /api/fs/read?path=` | REST | File content for editor/preview |
| `PUT /api/fs/write` | REST | Save file content |
| `WS /ws/fs-watch` | WS | Push fs change events to active Finder windows |
| `WS /ws/pty/:session_id` | WS | Bidirectional pty byte stream |
| `POST /api/pty/spawn` | REST | New terminal session, returns session_id |
| `WS /ws/sysmon` | WS | Push CPU/mem/disk/process stats ~1/sec |
| `GET /api/search?q=` | REST | Spotlight query — files, apps, quick actions merged |
| `GET /api/state/layout` | REST | Load saved window/space layout on boot |
| `PUT /api/state/layout` | REST | Persist layout (debounce client-side, ~1s after last change) |

## 7. Roadmap

| Phase | Deliverable |
|---|---|
| 0 — Scaffold | `npm create tauri-app@latest`; Rust host spawns/health-checks the daemon; frameless window rendering wallpaper + empty Dock + empty MenuBar per `DESIGN.md`; confirm WebView → daemon WS round-trip |
| 1 — Window manager core | Drag, resize, focus/z-order, minimize-to-dock, single Space, generic `WindowFrame` |
| 2 — Finder UI | Read-only list/icon view → full CRUD → live refresh via fs-watch → Quick Look preview pane |
| 3 — Terminal UI | xterm.js wired to `/ws/pty/:id`, multi-tab within one window |
| 4 — Activity Monitor UI | Live CPU/mem/disk charts, process list, wired to `/ws/sysmon` |
| 5 — Editor UI | Monaco integration, open-from-Finder, save-to-disk, multi-tab |
| 6 — Spotlight | Global hotkey palette wired to `/api/search`, file search + app launch + quick actions |
| 7 — Spaces | Multiple desktops, keyboard/gesture switching, Mission Control overview |
| 8 — Polish | Layout persistence wired end-to-end, per-app menu bar contents, dock magnification, window animations, tray menu |

## 8. Risks (app-side)

| Risk | Mitigation |
|---|---|
| Tauri's default CSP blocks calls to localhost | Explicitly allowlist `connect-src` for `http://localhost:8080` / `ws://localhost:8080` |
| Hardcoded `-d Ubuntu` fails if default distro is named differently | Query `wsl -l -v` from the Rust host at startup instead of hardcoding |
| Daemon not ready yet when window shows | Splash/loading state driven by the health-check poll in the startup sequence |
| Monaco bundle size | Lazy-load Monaco only when Editor first opens |
| Window drag performance with many windows | Transform-based dragging, RAF-batched updates |

## 9. Immediate next step

`npm create tauri-app@latest` for the shell + frontend scaffold. Wire the Tauri `setup` hook to spawn `wsl.exe -d Ubuntu -- ./daemon` and poll `/api/health`. Render a full-viewport wallpaper div (per `DESIGN.md`) with a fixed Dock and MenuBar shell in a frameless window. Confirm the WebView-to-daemon WS round-trip before building any app panels — everything downstream depends on that channel.

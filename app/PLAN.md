# Aqua — App Plan (Tauri + Frontend)

Repo slice: `app/` (`app/src-tauri/` + `app/frontend/`) – the Windows agent's working directory, with its own `app/AGENTS.md`. This is Aqua's native Windows shell – the window manager, every visible panel, and the OS-integration glue (daemon lifecycle, global hotkey, tray). It owns no real data; everything it shows comes from the daemon over the API contract in §6 (full shapes: `../CONTRACT.md`).

**Companion docs:**
- `../../daemon/PLAN.md` — owns the Rust daemon this app talks to
- `../CONTRACT.md` — exact request/response shapes for every call this app makes
- `../DESIGN.md` — dark-mode-only color tokens, chrome dimensions, motion timing

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

- **WebView (React UI)** – talks **directly** to the daemon over `fetch`/`WebSocket` at `http://localhost:61234`. No IPC proxying for data – same calls a browser tab would make.
- **Tauri Rust host** — owns only OS-integration: daemon lifecycle (spawn, health-check, no relaunch if already running), the global Spotlight hotkey, the tray icon, frameless window config. Never touches file data, pty streams, or stats.

Don't route file ops, pty streams, fs-watch, or sysmon through Tauri IPC – that's double-plumbing every daemon endpoint for no benefit. Let the WebView call the daemon directly; WSL2's localhost forwarding makes `http://localhost:61234` reachable from Windows automatically.

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

1. Ping `GET http://localhost:61234/api/health`.
2. If it responds, the daemon's already running — show the window.
3. If not, spawn `wsl.exe -d Ubuntu -- ./daemon`, poll health every ~200ms (timeout ~5s), then show the window.
4. On app quit, **leave the daemon running** — killing it drops active pty sessions and in-memory index state. A "Quit and stop backend" tray item can be added later for an explicit full shutdown.

### Window config (`tauri.conf.json`)

- `identifier: "com.abdul.aqua"` (or your preferred reverse-domain), `productName: "Aqua"`
- `decorations: false` — no native title bar; you own the chrome, which is what makes the menu bar/traffic-light illusion work
- `app.security.csp` – must explicitly allow `connect-src http://localhost:61234 ws://localhost:61234`, or the default CSP blocks the WebView's calls to the daemon

## 5. Frontend design (React + TypeScript)

**Stack:** React, TypeScript, Tailwind, Zustand (window/app state), Framer Motion (window/dock animation), `xterm.js` (terminal), Monaco Editor (code editor). All colors, spacing, and chrome dimensions come from `../DESIGN.md` as CSS variables/Tailwind theme extensions — never hardcode a hex in a component.

```
app/frontend/src/
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
    ws.ts                      # typed WS channel multiplexer, points at localhost:61234
    api.ts                     # typed REST client, points at localhost:61234
    api-types.ts                # from CONTRACT.md — generated once real daemon code exists
```

**App-as-plugin pattern:** each app registers a manifest — icon, default window size, menu bar config, dock behavior. `WindowManager` and `Dock` are generic and know nothing about specific apps, so adding one later (Preview, Notification Center) is additive, not invasive.

**Menu dispatch contract (`APPEND_V3.md` §1):** "menu bar config" is concrete — each window supplies `menus: AppMenuGroup[]`, rendered by the Menu Bar with clicks dispatched straight to `onSelect()` closures:

```ts
interface AppMenuItem {
  id: string;              // stable id, e.g. "file.save" — used for shortcut registration, not for lookup
  label: string;
  shortcut?: string;        // e.g. "Ctrl+S" — displayed in the menu AND registered as a live keybinding
  onSelect: () => void;     // the actual handler — a real closure, never a string looked up elsewhere
  enabled?: boolean;        // default true; false renders grayed-out and non-interactive, item stays visible
  separatorAfter?: boolean;
}

interface AppMenuGroup {
  label: string;   // "File", "Edit", "View", ...
  items: AppMenuItem[];
}
```

Critical rule: `menus` is supplied **per open window instance, not per app type.** Two Editor windows each build their own array with `onSelect` closures bound to that window's own file/buffer — no shared static definition across instances, or every window's Save ends up saving the wrong buffer.

## 6. API contract this app consumes

Path/purpose map below; exact request/response shapes live in `../CONTRACT.md`.

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
| 0 — Scaffold | `npm create tauri-app@latest`; Rust host spawns/health-checks the daemon; frameless window rendering wallpaper + empty Dock + empty MenuBar per `../DESIGN.md`; confirm WebView → daemon WS round-trip |
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
| Tauri's default CSP blocks calls to localhost | Explicitly allowlist `connect-src` for `http://localhost:61234` / `ws://localhost:61234` |
| Hardcoded `-d Ubuntu` fails if default distro is named differently | Query `wsl -l -v` from the Rust host at startup instead of hardcoding |
| Daemon not ready yet when window shows | Splash/loading state driven by the health-check poll in the startup sequence |
| Monaco bundle size | Lazy-load Monaco only when Editor first opens |
| Window drag performance with many windows | Transform-based dragging, RAF-batched updates |

## 9. Immediate next step

`npm create tauri-app@latest` for the shell + frontend scaffold. Wire the Tauri `setup` hook to spawn `wsl.exe -d Ubuntu -- ./daemon` and poll `/api/health`. Render a full-viewport wallpaper div (per `../DESIGN.md`) with a fixed Dock and MenuBar shell in a frameless window. Confirm the WebView-to-daemon WS round-trip before building any app panels — everything downstream depends on that channel.

## 10. V2 additions

### Scope

| Area | Decision |
|---|---|
| System Menu | OS-level dropdown for lifecycle and power actions; Tauri host only |
| System Modals | Shared confirmation and sudo elevation dialogs |
| Settings app | Appearance, wallpaper, daemon status, and About panes |
| Wallpaper | Built-in frontend assets plus daemon-managed custom uploads |

### Frontend modules

```text
app/src/
  desktop/
    SystemMenu.tsx
  system/
    ConfirmModal.tsx
    ElevateModal.tsx
    modalStore.ts
  panes/
    SettingsPane.tsx
    AppearancePane.tsx
    WallpaperPane.tsx
    DaemonPane.tsx
    AboutPane.tsx
    wallpaperStore.ts
```

### API consumption

| Path | Type | Purpose |
|---|---|---|
| `POST /api/system/elevate` | REST | Validate sudo password and cache elevation |
| `GET /api/wallpaper` | REST | Load wallpaper state |
| `PUT /api/wallpaper` | REST | Apply a wallpaper selection |
| `POST /api/wallpaper/upload` | REST | Add a custom wallpaper |
| `DELETE /api/wallpaper/:id` | REST | Remove a custom wallpaper |

### Roadmap

| Phase | Deliverable |
|---|---|
| 9 — System Menu & Modals | System menu, shared confirmation/elevation dialogs, and Finder elevation retry |
| 10 — Settings + Wallpaper | Settings shell, appearance preferences, wallpaper endpoints, daemon status, and About |

### Risks

| Risk | Mitigation |
|---|---|
| Elevation password lingering in React state | Clear it immediately after the request succeeds or fails |
| Large wallpaper upload delaying first paint | Generate and serve thumbnails separately from full-resolution assets |
| Deleting the active custom wallpaper | Fall back to the built-in Aqua wallpaper immediately |

### Immediate next step

Build the shared confirmation and elevation modal state first, then use the System Menu's daemon restart action as the first real caller.

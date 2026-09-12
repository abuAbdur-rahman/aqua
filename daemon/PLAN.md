# Aqua — Backend Plan (Rust Daemon / Axum)

Repo slice: `daemon/` – the WSL agent's working directory, with its own `daemon/AGENTS.md`. A single Rust binary running **inside WSL Ubuntu**, bound to `127.0.0.1`. It's the only thing that touches the real filesystem, process table, and shell – Aqua's Tauri app has no direct OS access at all, it only calls this API.

**Companion docs:**
- `../app/PLAN.md` — owns the Tauri/React app that consumes this API
- `../CONTRACT.md` — exact request/response shapes for every path/channel below

Build order: this doc's §10 Phase 0 → app doc's §7 Phase 0 → then alternate per feature (finish a daemon endpoint before building its UI).

## 1. Scope owned by this daemon

| Area | Decision |
|---|---|
| Finder backend | Full CRUD (create, rename, move, delete, chmod, symlink-aware) + live fs-watch |
| Terminal backend | Full unrestricted pty — real bash, sudo, everything |
| Activity Monitor backend | Read-only live stats via `sysinfo` (no kill/renice endpoint) |
| Spotlight backend | Full-text index (`tantivy`), file search, app-launch metadata, quick actions |
| Persistence | SQLite: window/space layout, recents, prefs |
| Access model | Localhost only, no auth — trust boundary is "only Aqua's Tauri app talks to this," see §9 |

## 2. Why Rust/Axum here

Real OS-level primitives (pty allocation, `sysinfo`, `notify` filesystem watching) without fighting a weaker process/fs story, a single static binary with no runtime to install inside WSL, and tokio's async model maps cleanly onto "many long-lived WebSocket streams," which is most of what this daemon does.

## 3. Architecture (this daemon's slice)

Single binary, `axum` router, bound to `127.0.0.1:61234`. Port `61234` is Aqua's fixed loopback daemon port; keep it centralized in the implementation rather than scattering numeric literals. Two consumers, both external to this repo slice:

- Aqua's **WebView** — direct `fetch`/`WebSocket` calls for all data operations (§6, shapes in `../CONTRACT.md`).
- Aqua's **Tauri Rust host** — only calls `GET /api/health` at startup to decide whether to spawn this daemon.

This daemon doesn't know or care which one is calling — same API either way.

## 4. Crates

| Crate | Purpose |
|---|---|
| `axum` | HTTP + WebSocket server, routing |
| `tokio` | Async runtime |
| `tower` / `tower-http` | Middleware |
| `serde` / `serde_json` | Serialization |
| `notify` | Filesystem watching (drives Finder live-refresh) |
| `portable-pty` | Real pty allocation for the Terminal |
| `sysinfo` | CPU/mem/disk/process stats |
| `ignore` or `walkdir` | Fast recursive directory walk for Spotlight indexing |
| `tantivy` | Full-text search index |
| `rusqlite` or `sqlx` (sqlite) | Local state persistence |
| `tracing` | Structured logging |

## 5. Module layout

```
daemon/
  src/
    main.rs              # server bootstrap, router assembly
    fs/
      mod.rs              # list, read, write, create, move, copy, trash ops, chmod
      watch.rs             # notify-based watcher -> WS broadcast
      preview.rs           # thumbnail/preview generation dispatch
      trash.rs             # moveToTrash / restore / permanentDelete / emptyTrash + 7-day purge sweep
    pty/
      mod.rs               # session manager (spawn, resize, kill)
      ws.rs                # WS <-> pty byte stream bridge
    sysmon/
      mod.rs               # sysinfo polling loop -> WS broadcast
    search/
      indexer.rs           # tantivy index build + incremental update via fs watch
      query.rs             # search + app-launch + quick actions routing
    state/
      mod.rs               # sqlite: window layout, spaces, recents, prefs
    api/
      mod.rs               # REST route handlers
      types.rs              # serde structs — source for CONTRACT.md / generated TS types
      ws.rs                # WS route handlers (multiplexed by channel)
```

## 6. API contract (path map — shapes in `../CONTRACT.md`)

| Path | Type | Purpose |
|---|---|---|
| `GET /api/health` | REST | Liveness check — used by the Tauri host at startup |
| `GET /api/fs/list?path=` | REST | Directory listing |
| `POST /api/fs/op` | REST | Create/rename/move/copy/trash/chmod (op in body) |
| `GET /api/fs/read?path=` | REST | File content for editor/preview |
| `PUT /api/fs/write` | REST | Save file content |
| `GET /api/trash/list` | REST | Trashed-item bucket — restore/permanent-delete/empty go through `/api/fs/op` |
| `WS /ws/fs-watch` | WS | Push fs change events for active Finder windows |
| `WS /ws/pty/:session_id` | WS | Bidirectional pty byte stream |
| `POST /api/pty/spawn` | REST | New terminal session, returns session_id |
| `WS /ws/sysmon` | WS | Push CPU/mem/disk/process stats every ~1s |
| `GET /api/search?q=` | REST | Spotlight query — files, apps, quick actions merged |
| `GET /api/state/layout` | REST | Load saved window/space layout |
| `PUT /api/state/layout` | REST | Persist layout |
| `POST /api/system/shutdown` | REST | Graceful shutdown — close pty sessions cleanly, flush state, then exit |

Changing this contract means updating `../CONTRACT.md` and `../app/PLAN.md` §6 too — `../CONTRACT.md` is the one either side should code against.

## 7. Real-time data flows

- **Terminal:** on `WS /ws/pty/:id` connect (after `POST /api/pty/spawn`), bridge raw pty bytes both directions. Resize sent as small control messages over the same socket.
- **Finder live refresh:** `notify` watcher emits change events for watched directories; broadcast to clients subscribed on `/ws/fs-watch`.
- **Activity Monitor:** poll `sysinfo` on an interval, push deltas over `/ws/sysmon`.
- **Spotlight indexing:** `tantivy` index built once at startup (respecting `.gitignore`-style excludes), kept current incrementally via the same `notify` events used for Finder.

## 8. Persistence (SQLite)

```sql
CREATE TABLE windows (
  id TEXT PRIMARY KEY,
  app TEXT NOT NULL,
  space_id INTEGER NOT NULL,
  x INTEGER, y INTEGER, w INTEGER, h INTEGER,
  minimized BOOLEAN, z_index INTEGER,
  app_state TEXT  -- JSON blob, app-specific (e.g. Finder's current path)
);

CREATE TABLE spaces (
  id INTEGER PRIMARY KEY,
  name TEXT,
  order_index INTEGER
);

CREATE TABLE recents (
  path TEXT,
  opened_at TIMESTAMP,
  source TEXT  -- 'finder' | 'spotlight' | 'editor'
);

CREATE TABLE prefs (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE trash (
  id TEXT PRIMARY KEY,
  original_path TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,          -- 'file' | 'dir' | 'symlink'
  size INTEGER,
  deleted_at TIMESTAMP NOT NULL,
  trash_path TEXT NOT NULL      -- current location inside the internal trash dir
);
```

Layout writes arrive already debounced from the frontend (~1s after last change) — no need to debounce again server-side.

## 9. Security model (daemon-side)

- Bind `127.0.0.1` only, never `0.0.0.0`.
- The real attack surface — "any browser tab can blind-`fetch()` an unauthenticated shell" — is closed on the app side by using a dedicated Tauri window instead of a general browser (see app doc §2). This daemon still shouldn't assume that's the only line of defense.
- Validate and canonicalize every filesystem path server-side — stay inside intended roots, resolve symlinks correctly. This is about correctness (not deleting the wrong thing on a traversal bug), not access control.
- Optional hardening: reject requests whose `Origin` header isn't Aqua's app origin, in case anything else on the machine ever probes this port.
- `POST /api/system/shutdown` has no confirmation step of its own at the daemon level — the confirmation already happens once, at the UI layer (`UI-SPEC-08-Modals.md`'s Confirmation Modal), before this call is ever made. The daemon executes it unconditionally on receipt.

## 10. Roadmap

| Phase | Deliverable |
|---|---|
| 0 – Scaffold | `cargo new daemon`; `axum` router with `GET /api/health` and a WS echo route; confirm reachable from Windows via `http://localhost:61234` |
| 1 — Finder backend | Read-only `fs/list` + `fs/read` → full CRUD (`fs/op`, `fs/write`) → `notify` watcher + `/ws/fs-watch` |
| 1.5 — Trash | `moveToTrash`/`restoreFromTrash`/`permanentDelete`/`emptyTrash` (+ `copy`), `trash` table, `GET /api/trash/list`, 7-day purge sweep, `FsEntry.isTrashable` — natural extension of the Finder backend, same phase family |
| 2 — Terminal backend | `portable-pty` session manager, `/api/pty/spawn`, `/ws/pty/:id` bridge, resize handling, cleanup on disconnect |
| 3 — Activity Monitor backend | `sysinfo` polling loop, `/ws/sysmon` broadcast |
| 4 — Spotlight backend | `tantivy` indexer, incremental updates via `notify`, `/api/search` (files + app metadata + quick actions) |
| 5 — Persistence | SQLite schema, `/api/state/layout` GET/PUT |
| 6 — Hardening | Path validation audit, Origin header checks, graceful pty/session cleanup on crash |

## 11. Risks (backend-side)

| Risk | Mitigation |
|---|---|
| pty orphan processes on disconnect | Kill pty on WS close + heartbeat timeout |
| `notify` event storms on large directory ops (e.g. `git checkout`) | Debounce fs-watch events per-path before broadcasting |
| Path traversal / symlink escape in `fs/op` | Canonicalize + validate every path against allowed roots before touching disk |
| Spotlight full reindex cost on large trees | Incremental updates via fs-watch; full reindex only on explicit request or startup |
| Hard-killing the daemon process (bypassing graceful shutdown) leaves orphaned pty child processes in WSL | Tauri host always attempts `POST /api/system/shutdown` first and gives it a short grace period before falling back to a force-kill; force-kill is the exception path, not the default |

## 12. Immediate next step

`cargo new daemon` inside WSL. Stand up `GET /api/health` and a `/ws/echo` route. Confirm it's reachable from Windows at `http://localhost:61234/api/health` before writing any real fs/pty/sysmon logic – that round-trip is the foundation everything else builds on.

## 13. V2 additions

### Scope

| Area | Decision |
|---|---|
| Elevation | In-memory sudo-validated timestamp cache gating specific filesystem operations |
| Wallpaper storage | Custom uploads only; full-resolution and thumbnail files tracked in SQLite |

### Module layout

```text
daemon/src/
  system/mod.rs       # POST /api/system/elevate and in-memory cache
  wallpaper/mod.rs    # wallpaper state, upload, delete, and asset handlers
  wallpaper/thumbnail.rs
```

### Crates

| Crate | Purpose |
|---|---|
| `image` | Thumbnail generation for wallpaper uploads |

### API

| Path | Type | Purpose |
|---|---|---|
| `POST /api/system/elevate` | REST | Validate sudo password and cache elevation |
| `GET /api/wallpaper` | REST | Current selection and custom wallpaper list |
| `PUT /api/wallpaper` | REST | Set current selection |
| `POST /api/wallpaper/upload` | REST | Store an image and generate its thumbnail |
| `DELETE /api/wallpaper/:id` | REST | Remove a custom wallpaper |
| `GET /api/wallpaper/asset/:id` and `/thumb` | REST | Serve stored image bytes |

`fs/op` returns `needsElevation: true` for plausible permission failures. An `elevated: true` retry is accepted only while the in-memory elevation timestamp remains valid; expired elevation requires a fresh password prompt.

### Persistence

```sql
CREATE TABLE wallpapers (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  path TEXT NOT NULL,
  thumb_path TEXT NOT NULL,
  added_at TIMESTAMP
);
```

The current selection reuses `prefs` with key `wallpaper.current`.

### Security

- Never log the elevation password.
- Keep elevation state only in daemon memory; it expires and does not survive restart.
- Pass sudo passwords over stdin only – never argv or environment variables.

### Roadmap

| Phase | Deliverable |
|---|---|
| 7 — Elevation | Elevation endpoint, in-memory cache, and filesystem retry path |
| 8 — Wallpaper | Wallpaper table, upload/thumbnail generation, CRUD, and asset serving |

### Risks

| Risk | Mitigation |
|---|---|
| Password resident in daemon memory during sudo | Drop it after the sudo call and never store it in long-lived state |
| Elevation cache expiry bug | Check expiry on every elevated operation |
| Thumbnail generation blocking daemon traffic | Run image processing in `spawn_blocking` or a worker task |

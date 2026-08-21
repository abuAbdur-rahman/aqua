# Aqua — Backend Plan (Rust Daemon / Axum)

Repo slice: `daemon/` – the WSL agent's working directory, with its own `daemon/AGENTS.md`. A single Rust binary running **inside WSL Ubuntu**, bound to `127.0.0.1`. It's the only thing that touches the real filesystem, process table, and shell – Aqua's Tauri app has no direct OS access at all, it only calls this API.

**Companion docs:**
- `aqua-app-plan.md` — owns the Tauri/React app that consumes this API
- `CONTRACT.md` — exact request/response shapes for every path/channel below

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

- Aqua's **WebView** — direct `fetch`/`WebSocket` calls for all data operations (§6, shapes in `CONTRACT.md`).
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
      mod.rs              # list, read, write, create, move, delete, chmod
      watch.rs             # notify-based watcher -> WS broadcast
      preview.rs           # thumbnail/preview generation dispatch
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

## 6. API contract (path map — shapes in `CONTRACT.md`)

| Path | Type | Purpose |
|---|---|---|
| `GET /api/health` | REST | Liveness check — used by the Tauri host at startup |
| `GET /api/fs/list?path=` | REST | Directory listing |
| `POST /api/fs/op` | REST | Create/rename/move/delete/chmod (op in body) |
| `GET /api/fs/read?path=` | REST | File content for editor/preview |
| `PUT /api/fs/write` | REST | Save file content |
| `WS /ws/fs-watch` | WS | Push fs change events for active Finder windows |
| `WS /ws/pty/:session_id` | WS | Bidirectional pty byte stream |
| `POST /api/pty/spawn` | REST | New terminal session, returns session_id |
| `WS /ws/sysmon` | WS | Push CPU/mem/disk/process stats every ~1s |
| `GET /api/search?q=` | REST | Spotlight query — files, apps, quick actions merged |
| `GET /api/state/layout` | REST | Load saved window/space layout |
| `PUT /api/state/layout` | REST | Persist layout |

Changing this contract means updating `CONTRACT.md` and `aqua-app-plan.md` §6 too — `CONTRACT.md` is the one either side should code against.

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
```

Layout writes arrive already debounced from the frontend (~1s after last change) — no need to debounce again server-side.

## 9. Security model (daemon-side)

- Bind `127.0.0.1` only, never `0.0.0.0`.
- The real attack surface — "any browser tab can blind-`fetch()` an unauthenticated shell" — is closed on the app side by using a dedicated Tauri window instead of a general browser (see app doc §2). This daemon still shouldn't assume that's the only line of defense.
- Validate and canonicalize every filesystem path server-side — stay inside intended roots, resolve symlinks correctly. This is about correctness (not deleting the wrong thing on a traversal bug), not access control.
- Optional hardening: reject requests whose `Origin` header isn't Aqua's app origin, in case anything else on the machine ever probes this port.

## 10. Roadmap

| Phase | Deliverable |
|---|---|
| 0 – Scaffold | `cargo new daemon`; `axum` router with `GET /api/health` and a WS echo route; confirm reachable from Windows via `http://localhost:61234` |
| 1 — Finder backend | Read-only `fs/list` + `fs/read` → full CRUD (`fs/op`, `fs/write`) → `notify` watcher + `/ws/fs-watch` |
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

## 12. Immediate next step

`cargo new daemon` inside WSL. Stand up `GET /api/health` and a `/ws/echo` route. Confirm it's reachable from Windows at `http://localhost:61234/api/health` before writing any real fs/pty/sysmon logic – that round-trip is the foundation everything else builds on.

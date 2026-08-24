# Aqua — API Contract (App ⇄ Daemon)

The authoritative payload shapes for every path/channel listed in the app and backend plans. Those docs say *what exists and why*; this one says *exactly what goes over the wire*.

**Wire format:** camelCase JSON everywhere. Rust structs use `#[serde(rename_all = "camelCase")]` so nothing snake_case leaks into the frontend and no translation layer is needed.

**Status:** hand-written, matching the daemon before real code exists. Once `daemon/src/api/types.rs` exists, generate `app/frontend/src/lib/api-types.ts` from it with `specta` or `ts-rs` and delete the TS block below — a generated type can't drift, a hand-written doc can.

## Health

`GET /api/health`

```ts
interface HealthResponse {
  status: "ok";
  version: string;
}
```

## Filesystem

`GET /api/fs/list?path=` → `FsEntry[]`

```ts
interface FsEntry {
  name: string;
  path: string;
  kind: "file" | "dir" | "symlink";
  size: number;        // bytes
  modified: string;    // ISO 8601
  permissions: string; // octal, e.g. "755"
}
```

`POST /api/fs/op` — body is a tagged union on `op`:

```ts
type FsOp =
  | { op: "createFile"; path: string }
  | { op: "createDir"; path: string }
  | { op: "rename"; path: string; newName: string }
  | { op: "move"; path: string; to: string }
  | { op: "delete"; path: string }
  | { op: "chmod"; path: string; mode: string }; // octal string, e.g. "755"

type FsOpResponse =
  | { success: true }
  | { success: false; error: string };
```

Rust side: `#[serde(tag = "op", rename_all = "camelCase")] enum FsOp { ... }` — the tag field name (`op`) and variant names must match exactly, this is the highest-drift-risk shape in the whole contract.

`GET /api/fs/read?path=`

```ts
interface FsReadResponse {
  path: string;
  content: string;
  encoding: "utf8" | "base64"; // base64 for binary/large files
  truncated: boolean;
}
```

`PUT /api/fs/write`

```ts
interface FsWriteRequest {
  path: string;
  content: string;
}

type FsWriteResponse =
  | { success: true; modified: string } // ISO 8601
  | { success: false; error: string };
```

`WS /ws/fs-watch`

```ts
// client → server
type FsWatchSubscribe =
  | { type: "subscribe"; path: string }
  | { type: "unsubscribe"; path: string };

// server → client
interface FsWatchEvent {
  type: "change";
  path: string;
  kind: "created" | "modified" | "removed" | "renamed";
  entry?: FsEntry;
}
```

## Terminal

### Trust boundary and Origin policy

PTY access deliberately keeps Aqua's localhost/no-auth architecture. This accepts that another native process running as the same Windows or WSL user can call the daemon; Origin validation is browser hardening, not authentication.

Both PTY endpoints require an `Origin` header matching one of these exact Aqua WebView origins:

- `http://tauri.localhost` for the packaged Windows app;
- `http://localhost:1420` for the fixed Vite development server.

A missing, opaque (`null`), or different Origin is rejected with `403 Forbidden` before a shell is spawned or a WebSocket upgrade occurs. Do not reflect arbitrary origins, use suffix matching, or treat CORS response headers as authorization. Adding other development origins requires an explicit configuration and contract decision.

### Spawn

`POST /api/pty/spawn`

```ts
interface PtySpawnRequest {
  cwd?: string;
  cols: number;
  rows: number;
}

interface PtySpawnResponse {
  sessionId: string;
}
```

- `cols` and `rows` must each be an integer from `1` through `1000`.
- `cwd` defaults to the daemon user's `$HOME`. When supplied, it follows the same allowed-root and no-symlink-traversal policy as the filesystem API and must identify an existing directory.
- A successful spawn creates a single-use, unguessable session ID. Exactly one WebSocket may attach to it.
- A spawned session that is not attached within 30 seconds is terminated and removed.
- Invalid requests use the daemon's structured JSON error response and do not leave a child process running.

### WebSocket bridge

`WS /ws/pty/:sessionId`

A missing, expired, unknown, or already-attached `sessionId` is rejected before upgrade. Sessions cannot be reattached after their WebSocket disconnects.

#### Client → server

- **Binary frames:** raw PTY stdin bytes. Empty binary frames are valid no-ops.
- **Text frames:** control JSON only. The only control message is:

  ```ts
  interface PtyResize {
    type: "resize";
    cols: number;
    rows: number;
  }
  ```

  Resize dimensions use the same `1..=1000` bounds as spawn.
- **Pong frames:** heartbeat acknowledgement.
- Any non-JSON text, unknown control type or field, invalid dimensions, or other unsupported application frame causes a WebSocket policy-error close (`1008`) and session termination. Terminal input that happens to be UTF-8 is still sent as binary, never as text.

#### Server → client

- **Binary frames:** raw PTY output bytes with stdout and stderr interleaved by the PTY. Bytes are not decoded or normalized.
- **Text frames:** control JSON only. Process exit is:

  ```ts
  interface PtyExit {
    type: "exit";
    code: number;
  }
  ```

  The daemon sends the exit message after PTY output already read from the child, then closes the WebSocket normally (`1000`).
- **Ping frames:** heartbeat probes.

The daemon sends a ping every 15 seconds. If no pong is received within 10 seconds of a ping, it closes the socket and terminates the session. Client close, transport failure, heartbeat timeout, daemon shutdown, or failed bridge setup also terminates the child process group and removes the session. Terminal input and output must never be written to logs.

## Activity Monitor

`WS /ws/sysmon` — server pushes every ~1s:

```ts
interface SysmonStats {
  type: "stats";
  cpuPercent: number;
  memUsed: number;   // bytes
  memTotal: number;  // bytes
  disks: DiskStat[];
  processes: ProcessStat[];
}

interface DiskStat {
  mount: string;
  used: number;   // bytes
  total: number;  // bytes
}

interface ProcessStat {
  pid: number;
  name: string;
  cpuPercent: number;
  memBytes: number;
}
```

## Spotlight

`GET /api/search?q=`

```ts
interface SearchResponse {
  files: SearchFileHit[];
  apps: SearchAppHit[];
  actions: SearchActionHit[];
}

interface SearchFileHit {
  path: string;
  name: string;
  snippet?: string;
  score: number;
}

interface SearchAppHit {
  id: string;
  name: string;
  icon: string;
}

interface SearchActionHit {
  kind: "calculator" | "unitConvert";
  input: string;
  result: string;
}
```

## State / persistence

`GET /api/state/layout` and `PUT /api/state/layout` share a shape:

```ts
interface LayoutState {
  windows: WindowState[];
  spaces: SpaceState[];
}

interface WindowState {
  id: string;
  app: string;
  spaceId: number;
  x: number;
  y: number;
  w: number;
  h: number;
  minimized: boolean;
  zIndex: number;
  appState: unknown; // app-specific JSON, e.g. Finder's current path
}

interface SpaceState {
  id: number;
  name: string;
  orderIndex: number;
}
```

`PUT` request body = `LayoutState`. Response = `{ success: true }`.

## System & Wallpaper

### Shutdown

```ts
type ShutdownResponse = { success: true };
```

`POST /api/system/shutdown` — no body. The daemon stops accepting new connections, closes every active pty session cleanly (SIGTERM to each shell child, brief grace period, SIGKILL anything still alive after it — the same cleanup `/ws/pty` disconnect already does, just invoked proactively here instead of reactively), closes WS connections, flushes pending SQLite writes, then exits its own process. The HTTP response fires immediately on receipt (`{ success: true }` means "shutdown started," not "shutdown complete") — the caller (Tauri host) confirms actual completion by polling for the child process to exit, not by anything in this response.

### Elevation

```ts
interface ElevateRequest {
  password: string;
}

type ElevateResponse =
  | { success: true; expiresAt: string }
  | { success: false; error: string };
```

`POST /api/system/elevate` validates the password with `sudo -S -v`. The daemon pipes the password through stdin, never through argv or the environment, and caches successful elevation in process memory for a fixed window (proposed: five minutes).

`FsOp` gains an optional `elevated` field on every variant. A permissions failure may return `needsElevation: true`; after successful elevation, the client retries the same operation with `elevated: true`.

```ts
type FsOp =
  | { op: "createFile"; path: string; elevated?: boolean }
  | { op: "createDir"; path: string; elevated?: boolean }
  | { op: "rename"; path: string; newName: string; elevated?: boolean }
  | { op: "move"; path: string; to: string; elevated?: boolean }
  | { op: "delete"; path: string; elevated?: boolean }
  | { op: "chmod"; path: string; mode: string; elevated?: boolean };

type FsOpResponse =
  | { success: true }
  | { success: false; error: string; needsElevation?: boolean };
```

### Wallpaper

```ts
interface CustomWallpaper {
  id: string;
  label: string;
  addedAt: string;
}

interface WallpaperState {
  current: string;
  custom: CustomWallpaper[];
}

type WallpaperSetResponse =
  | { success: true }
  | { success: false; error: string };

type WallpaperUploadResponse =
  | { success: true; wallpaper: CustomWallpaper }
  | { success: false; error: string };

type WallpaperDeleteResponse =
  | { success: true }
  | { success: false; error: string };
```

Built-in wallpaper IDs are frontend-owned and cannot be deleted through the daemon. Custom assets are daemon-owned; deleting the active custom wallpaper makes the client immediately fall back to the built-in Aqua wallpaper.

| Path | Type | Purpose |
|---|---|---|
| `POST /api/system/elevate` | REST | Validate the sudo password and cache elevation |
| `POST /api/system/shutdown` | REST | Graceful shutdown — close pty sessions cleanly, flush state, then exit |
| `GET /api/wallpaper` | REST | Current selection and custom wallpaper list |
| `PUT /api/wallpaper` | REST | Set the current wallpaper; body `{ id: string }` |
| `POST /api/wallpaper/upload` | REST | Upload a custom wallpaper image |
| `DELETE /api/wallpaper/:id` | REST | Remove a custom wallpaper |
| `GET /api/wallpaper/asset/:id` | REST | Serve a custom full-resolution image |
| `GET /api/wallpaper/asset/:id/thumb` | REST | Serve a custom thumbnail |

## Ownership

Backend plan owns the *existence* of each path/channel (§6 of `daemon/PLAN.md`). This file owns the *shape*. If they disagree, this file is wrong and needs updating to match what the daemon actually emits — not the other way around, once real code exists.

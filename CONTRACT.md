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

`WS /ws/pty/:sessionId`

- Client → server: raw bytes as WS text/binary frames = stdin. Control frames for resize:
  ```ts
  interface PtyResize {
    type: "resize";
    cols: number;
    rows: number;
  }
  ```
- Server → client: raw bytes = stdout/stderr, interleaved. On process exit:
  ```ts
  interface PtyExit {
    type: "exit";
    code: number;
  }
  ```

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

## Ownership

Backend plan owns the *existence* of each path/channel (§6 of `daemon/PLAN.md`). This file owns the *shape*. If they disagree, this file is wrong and needs updating to match what the daemon actually emits — not the other way around, once real code exists.

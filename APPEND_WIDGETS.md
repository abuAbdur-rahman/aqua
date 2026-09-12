# APPEND_WIDGETS.md — Widget Contract & CSP Additions

Contract and config additions for `UI-SPEC-17-Widgets.md` (desktop-pinned widgets, Sonoma-style). Two pieces touch the shared contract — both proposed, daemon side pending with the WSL agent; the third is Windows-agent-owned config applied in this pass. Same append convention as `APPEND_AGENTS.md` / `APPEND_V3.md`.

---

## 1. Layout persistence — add `LayoutState.widgets[]`

Widgets ride the existing layout persistence contract (`GET` / `PUT /api/state/layout`, same ~1s debounce as window layout) rather than inventing a parallel system. Add to `LayoutState`:

```ts
interface WidgetState {
  id: string;
  type: "systemMonitor" | "storage" | "clock" | "trashPreview" | "calendar" | "weather" | "projects";
  size: "small" | "medium";
  x: number;
  y: number;
}
```

- `widgets: WidgetState[]`, default `[]`.
- Same `PUT` semantics as the window list: the client sends the full array; the daemon persists it in the existing SQLite layout row. No new endpoint.
- **Current status:** the app-only pass persists widgets to `localStorage` (`aqua.widgets`, `useWidgetStore`). Migrating to `LayoutState.widgets[]` happens together with the daemon-side landing so both sides move in one contract change.

---

## 2. New daemon endpoint — `GET /api/projects/list` (Projects widget)

The one widget needing real new daemon work. **Proposed for the WSL agent (Backend Phase 4.5)** — not implemented in this app-only pass; the app-side widget renders an "unavailable" state until it lands.

### Request

```
GET /api/projects/list?root=<path>
```

- `root` optional, defaults to `~/projects` (the WSL user's home). Resolved through the same path-canonicalization rule every fs operation already follows.

### Response

```json
{
  "projects": [
    {
      "name": "aqua-app",
      "path": "/home/abdulazeez/projects/Self/aqua/app",
      "lockfileKind": "pnpm",
      "lastModified": "2026-08-28T19:00:00Z"
    }
  ]
}
```

`lockfileKind` is `"npm" | "yarn" | "pnpm"`; `lastModified` is the mtime of `package.json` (ISO 8601), used for a "recently active" sort.

### Semantics

- A directory counts as a project only if it has **all three** markers: `package.json` + a lockfile (`package-lock.json` | `yarn.lock` | `pnpm-lock.yaml`) + `node_modules`, at any depth up to 6 levels from `root`.
- **Never descend into `node_modules`, `.git`, `dist`, `target`, or whatever exclude list Spotlight's indexer already respects** — reuse that same list, verbatim. Not a second implementation that can drift (this exact bug pinned Spotlight's CPU before).
- Stop descending once a directory matches all three markers — no nested/monorepo detection in v1.
- Bounded depth (6) as a safety net against symlink loops / unexpectedly deep trees.
- Not fs-watched — fetched on widget open and on a manual refresh button only.
- Clicking a project entry opens a Terminal session `cd`'d into it via the existing `POST /api/pty/spawn` (`cwd` is already accepted) — no new backend beyond the listing.

---

## 3. CSP `connect-src` additions (Weather widget) — applied in this pass

The Weather widget talks to two public, keyless APIs directly from the WebView (never routed through the daemon — its whole job is *local machine* primitives). Both domains added to `app/src-tauri/tauri.conf.json`:

```
connect-src ... https://api.open-meteo.com https://ipapi.co
```

- `https://api.open-meteo.com` — weather data (no key).
- `https://ipapi.co` — one-time IP-based geolocation on first widget add.

No new credentials to manage; refresh is a client-side ~30-minute interval.

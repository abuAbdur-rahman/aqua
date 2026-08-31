# UI-SPEC-17 — Widgets

Desktop-pinned widgets, Sonoma-style — cards that sit directly on the wallpaper, not a slide-out panel. Supersedes the "Notification Center" line item under `README.md`'s v2 stretch goals for this specific form of it; a slide-out panel remains a separate, still-unbuilt idea if ever revisited later.

**Companion docs:** `CONTRACT.md` (`LayoutState.widgets[]`, new `/api/projects/list` — proposed in `APPEND_WIDGETS.md`), `DESIGN.md` (card surfaces reuse `--bg-elevated`/`--bg-overlay`, no new tokens needed), `aqua-backend-plan.md` §4 (`ignore`/`walkdir`, already a listed crate — Projects reuses it rather than adding a new one).

## 1. Placement & layer

Widgets sit in `Desktop.tsx`'s existing z-order: above the wallpaper, below every window. No special always-on-top behavior — if a window covers a widget, it's covered, same as any desktop icon would be on a real OS. Not per-Space in v1 — one global widget layer regardless of which Space is active. Per-Space widgets are a real macOS behavior but adds real complexity for a feature that's already expanding scope this round; flagged as out of scope rather than silently building it.

## 2. Edit mode

Right-click the desktop (empty area, not a window) → "Edit Widgets" → a gallery overlay of available widget types, each showing its size options (Small / Medium — two sizes for v1, not the three-tier S/M/L some widgets support elsewhere, since most of these don't have enough content to justify a Large variant). Drag from the gallery onto the desktop to add; drag an existing widget to reposition; a small "−" on hover removes one. Exiting edit mode persists the layout.

## 3. Persistence

Extends the existing layout persistence rather than inventing a parallel system — same `GET`/`PUT /api/state/layout`, same ~1s debounce already established for window layout.

```ts
// addition to LayoutState, proposed in APPEND_WIDGETS.md
interface WidgetState {
  id: string;
  type: "systemMonitor" | "storage" | "clock" | "trashPreview" | "calendar" | "weather" | "projects";
  size: "small" | "medium";
  x: number;
  y: number;
}
```

## 4. Widget catalog

### System Monitor
Mini CPU + memory line graphs. Data: subscribes the existing `/ws/sysmon` stream — zero new daemon work, same data Activity Monitor already renders, just smaller. Medium size adds a rolling 60-second history graph; Small shows just the current numbers.

### Storage
Disk usage per volume, from the same `/ws/sysmon` payload's `disks[]` — no separate call. Small shows the primary volume only; Medium shows all reported disks as stacked bars.

### Clock
Pure client-side, no daemon involvement at all. Small: time only. Medium: time + date.

### Trash Preview
Item count and a one-click "Empty Trash" (routes through the same confirmation modal as the real Trash window — no separate, weaker confirmation path). Data: `GET /api/trash/list`, already specced in `APPEND_TRASH.md` — this widget just renders a count of what's already there, refetched on the same `/ws/fs-watch`-triggered-refresh pattern the Trash window itself uses.

### Calendar
Decorative month grid, no real events — client-side only, `date-fns` or equivalent, no daemon, no external calendar integration. If real synced events ever matter, that's a distinct, much larger feature — not something this widget quietly grows into.

### Weather
The one widget that talks to the outside world, and deliberately not through the daemon at all — a public weather API call belongs to the WebView directly, same as any web page would make it, not routed through a daemon whose whole job is *local machine* primitives (fs, pty, sysinfo, search). Recommended API: **Open-Meteo** (`api.open-meteo.com`) — free, no key required, fits the project's running preference for zero new credentials to manage. Location: on first add, a one-time IP-based geolocation lookup (`ipapi.co`, also free/keyless) sets an initial lat/long; overridable afterward in Settings (a plain lat/long pair, not a full city-search autocomplete — that's a nice-to-have, not v1). Refresh: every ~30 minutes, client-side interval — no daemon polling loop to worry about. Both API domains need adding to `tauri.conf.json`'s CSP `connect-src` — proposed in `APPEND_WIDGETS.md`, since that file is Windows-agent-owned.

### Projects
Scans `~/projects` (configurable root) for directories that look like a ready-to-run Node project: `package.json` **and** a lockfile (`package-lock.json`, `yarn.lock`, or `pnpm-lock.yaml`) **and** a `node_modules` directory, at any depth — matching the example given, `~/projects/Self/aqua/app`, three levels down. This is the one widget needing real new daemon work:

- New endpoint `GET /api/projects/list?root=` (defaults to `~/projects`), backed by a new `daemon/src/search/projects.rs`, reusing the `ignore`/`walkdir` crate already in the crate list for Spotlight — not a second directory-walking implementation.
- **Never descend into `node_modules`, `.git`, `dist`, `target`, or whatever exclude list Spotlight's indexer already respects** (`aqua-backend-plan.md` §7's ".gitignore-style excludes") — reused verbatim, not maintained as a second list that can drift. This is the exact category of bug that pegged Spotlight's CPU before; a second implementation of the same mistake is not acceptable here.
- Stop descending once a directory matches all three markers — don't keep walking inside a found project looking for nested ones (monorepo-aware detection is a real feature, just not this one).
- Bounded depth (6 levels from root) as a safety net against symlink loops or an unexpectedly deep tree, on top of the existing path-canonicalization rule every fs operation already follows.
- Not fs-watched — this data changes rarely (you don't create a new project every five minutes), so it's fetched on widget open and on a manual refresh button, not wired to live updates. Same restraint as everything else in this project that's learned not to over-subscribe to change events for data that barely changes.
- Clicking a project entry spawns a Terminal session cd'd into it — `POST /api/pty/spawn` already accepts a `cwd`, so this is zero new backend work beyond the listing itself, just wiring an existing call to a new trigger.

```ts
// GET /api/projects/list?root= response
interface ProjectEntry {
  name: string;
  path: string;
  lockfileKind: "npm" | "yarn" | "pnpm";
  lastModified: string; // ISO 8601 — mtime of package.json, for a "recently active" sort
}
```

## 5. Dispatch contract

```ts
type WidgetAction =
  | { type: "enterEditMode" }
  | { type: "exitEditMode" }
  | { type: "addWidget"; widgetType: WidgetState["type"]; size: WidgetState["size"] }
  | { type: "removeWidget"; id: string }
  | { type: "moveWidget"; id: string; x: number; y: number }
  | { type: "resizeWidget"; id: string; size: WidgetState["size"] }
  | { type: "openProjectTerminal"; path: string };
```

## 6. Out of scope

Per-Space widgets, a slide-out Notification-Center panel (separate from this desktop-pinned form), Large widget size tier, real synced Calendar events, monorepo-aware nested Projects detection, city-search autocomplete for Weather's location.

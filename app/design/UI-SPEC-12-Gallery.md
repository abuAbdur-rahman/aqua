# UI-SPEC-12 — Gallery

Image viewer app. Grid of a folder's images + a full-screen single-image view ("Loupe"). Frontend-only addition — no new daemon endpoints, no `CONTRACT.md` changes. Every call Gallery makes already exists: `GET /api/fs/list`, `GET /api/fs/read`, `POST /api/fs/op`, `WS /ws/fs-watch`.

**Companion docs:** `CONTRACT.md` (shapes used below), `DESIGN.md` (tokens), `aqua-app-plan.md` (module tree this slots into — see `APPEND_GALLERY.md`).

## 1. Scope

| In scope | Out of scope (not this version) |
|---|---|
| Grid browse of images in a folder | Curated "Photos library" (albums, tags, favorites) |
| Full-screen single-image view, prev/next | Editing — crop, rotate, filters, red-eye, anything destructive or non-destructive |
| Rename, delete, reveal-in-Finder, get-info | EXIF panel / metadata editing |
| Live grid updates while folder is open | Video, RAW, animated GIF playback control (GIF renders static-first-frame in grid, animates in Loupe) |
| Formats: jpg/jpeg/png/gif/webp/bmp/svg | Cloud sync, multi-folder "collections" |

Gallery opens scoped to one folder at a time (same mental model as Finder — no cross-folder library). Launched either from the Dock (defaults to `~`, filtered) or via Finder's "Open in Gallery" on a folder/image (dispatch contract in §6).

## 2. Data flow — daemon calls used (all pre-existing)

| Call | When |
|---|---|
| `GET /api/fs/list?path=` | On open, and on folder change. Client filters `FsEntry[]` to image extensions. |
| `GET /api/fs/read?path=` | Per-image bytes (base64), fetched lazily — see §5 perf. |
| `POST /api/fs/op` | Rename (`{op:"rename"}`), delete (`{op:"delete"}`), no new op types needed. |
| `WS /ws/fs-watch` | Subscribe to the open folder path; live-add/remove/refresh grid entries. |

No new REST paths, no new WS channels, no new `FsOp` variants. If this ever needs real thumbnails, that's a future daemon addition (`GET /api/fs/thumbnail?path=&size=`) — explicitly deferred, not designed here.

## 3. Grid view — four states

**Loading** — `fs/list` in flight. Skeleton grid: fixed-size tiles at `--bg-elevated`, shimmer sweep to `--bg-hover`, no text. Toolbar renders immediately (breadcrumb path, disabled controls) so the window doesn't feel frozen.

**Empty** — `fs/list` succeeded, zero entries match image extensions. Centered: generic image glyph in `--text-tertiary`, "No images in this folder," secondary line noting non-image file count if any ("14 other files here"), single button "Open in Finder" (dispatches `{type:"openInFinder", path}`).

**Populated** — Virtualized grid (render visible rows + one buffer row above/below; use windowed rendering so a 2,000-item folder doesn't choke). Toolbar: breadcrumb, thumbnail-size slider (S/M/L, persisted per-window like other apps via `LayoutState.windows[].appState`), sort menu (Name / Date Modified / Size). Selection: click = select one, Cmd/Ctrl-click = toggle, Shift-click = range. Double-click or Enter = open Loupe on that item. Right-click / context menu: Rename, Move to Trash, Reveal in Finder, Get Info, Open (Loupe) — same verbs as Finder, deliberately, so nothing new to learn.

**Error** — `fs/list` failed (daemon unreachable, permission denied, path deleted out from under it). Standard error treatment: `--status-danger` icon, one-line message from `FsOpResponse`-style `error` string if present, Retry button re-issues `fs/list`.

## 4. Loupe (full-screen single image) — states

Opened from a grid double-click/Enter. Full window overlay, `--bg-overlay`, image centered and scaled to fit (never upscaled past 100%).

- **Loading** — spinner over a blurred/dimmed placeholder of the grid thumbnail already in memory (avoids a blank flash), while `fs/read` fetches full bytes.
- **Loaded** — image, minimal chrome: filename + index (`"IMG_0231.jpg — 14 / 82"`) top-left, close (Esc) top-right, prev/next chevrons (← / →, also swipe-equivalent drag on trackpad), action bar bottom-center on hover: Rename, Delete, Reveal in Finder.
- **Error** — file failed to load or was removed underneath the viewer (fs-watch `removed` event fires while open). Broken-image glyph, "Couldn't load this image," Retry + auto-advance to next valid item after 2s if the cause was deletion.

Arrow keys navigate without closing Loupe; each navigation triggers its own `fs/read` (previous images stay cached, see §5).

## 5. Performance mitigations (because there's no thumbnail endpoint)

- **Lazy load by viewport**: `IntersectionObserver` per grid cell; `fs/read` only fires when a cell scrolls near-visible.
- **Concurrency cap**: max 6 in-flight `fs/read` calls at once, queued FIFO, cancel in-flight requests for cells that scroll back out before resolving.
- **Size gate**: entries over ~8MB (from `FsEntry.size`, no read needed to know this) skip auto-load in the grid — show a generic large-file glyph with a "Load preview" click affordance instead. Loupe always loads on demand regardless of size, since that's an explicit user action on one image.
- **In-memory cache**: decoded blob URLs keyed by path in a `Map`, capped (evict oldest beyond ~150 entries) — avoids re-fetching on scroll-back or Loupe prev/next.
- **No decode-then-discard churn**: revoke `URL.createObjectURL` handles on cache eviction, not on every unmount.

## 6. Dispatch contract

Every interactive element resolves to one of these — matches the project's per-window `onSelect` mandate:

```ts
type GalleryAction =
  | { type: "openLoupe"; path: string }
  | { type: "closeLoupe" }
  | { type: "navigate"; direction: "prev" | "next" }
  | { type: "rename"; path: string; newName: string }   // -> POST /api/fs/op {op:"rename"}
  | { type: "delete"; path: string }                     // -> POST /api/fs/op {op:"delete"}
  | { type: "revealInFinder"; path: string }              // opens/focuses Finder window at parent dir
  | { type: "getInfo"; path: string }                     // reuses Finder's existing Get Info panel
  | { type: "openInFinder"; path: string };
```

Rename and delete are handled exactly like Finder's own — Gallery doesn't introduce new delete/rename semantics (no separate "Move to Trash" behavior to design; whatever `{op:"delete"}` does in Finder, it does here).

## 7. Live updates

Subscribe `/ws/fs-watch` for the open folder path on mount, unsubscribe on close (same lifecycle as Finder's `useFsWatch` — reuse that hook, don't reimplement).

| Event | Grid behavior | Loupe behavior (if open) |
|---|---|---|
| `created` (image ext) | Insert into grid, re-sort | — |
| `modified` | Evict cached blob for that path, will re-fetch when next visible | If it's the current image, re-fetch and swap |
| `removed` | Remove from grid | If it's the current image, show Loupe Error state (§4), auto-advance |
| `renamed` | Update entry path/name in place | If current image, update filename in chrome |

## 8. Menu bar (per-window, focused-app menu)

`Gallery` menu: About Gallery. `View` menu: Thumbnail size (S/M/L, radio), Sort By submenu. `Image` menu (enabled only with a selection or Loupe open): Rename, Move to Trash, Reveal in Finder, Get Info. Standard `Window`/`Help` per existing menu bar contract.

## 9. Keyboard

| Key | Action |
|---|---|
| ← / → | Prev/next (Loupe); move selection (grid) |
| Enter | Open Loupe on selected item |
| Esc | Close Loupe / clear selection |
| Cmd/Ctrl+Delete | Move selected to Trash |
| Enter (on renaming) | Confirm rename, inline field same as Finder |
| Space | Quick Look toggle — reuses Loupe as the Quick Look surface, no separate preview panel to build |

## 10. Icon

Not designed here (kept out of scope for this pass) — flag for the existing icon set: needs a 512×512 SVG following the same gradient + shadow treatment as the other seven. Aperture/frame motif in `--accent` reads well against the set's existing language; do this as a small follow-up, not blocking Gallery's build order.

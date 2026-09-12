# Aqua UI Spec — Trash

The window behind the Dock's Trash icon. Aggregates every trashed item regardless of which folder it came from — not folder-scoped like Finder, one bucket, matching macOS's Trash.

Data source: `GET /api/trash/list` → `TrashEntry[]`; mutations via `POST /api/fs/op` (`restoreFromTrash`, `permanentDelete`, `emptyTrash`). Live-refresh over `WS /ws/fs-watch`. Shapes: `CONTRACT.md` §Filesystem and §Trash.

**Companion docs:** root `APPEND_TRASH.md` (the contract/backend diffs this depends on), `DESIGN.md` (icon two-state note).

## 1. Data flow

| Call | When |
|---|---|
| `GET /api/trash/list` → `TrashEntry[]` (`{id, originalPath, name, kind, size, deletedAt}`) | On open, and on refresh |
| `WS /ws/fs-watch` subscribed to the internal trash directory (`~/.local/share/aqua/Trash/`) | Coarse "something changed" signal → refetch `GET /api/trash/list`. Not fine-grained per-item, since trash entries carry derived metadata (`originalPath`, `deletedAt`) that raw `FsEntry` doesn't have — a full refetch is simpler than reconciling partial events. |
| `POST /api/fs/op {op:"restoreFromTrash", trashId}` | Restore |
| `POST /api/fs/op {op:"permanentDelete", trashId}` | Delete one item forever |
| `POST /api/fs/op {op:"emptyTrash"}` | Empty everything |

## 2. States

**Loading** — skeleton list rows, same treatment as other list-based surfaces.

**Empty** — "Trash is empty," centered, uses the empty-state Trash icon asset (§5).

**Populated** — List view: name, truncated original-path breadcrumb, relative deleted time ("3 days ago"). Sorted newest-first by default. Multi-select (click/Cmd-click/Shift-click, same conventions as Finder/Gallery). Toolbar: "Empty Trash" button, disabled when empty. Footer: item count + total size ("12 items, 340 MB"). Context menu per row: Restore, Delete Permanently. A nice-to-have, not blocking: since items are close to the 7-day auto-purge, a secondary line like "Purges in 2 days" costs nothing given `deletedAt` is already known — include if convenient, skip if it complicates the row layout.

**Error** — `GET /api/trash/list` failed. Standard treatment: message, Retry.

## 3. Destructive actions require an explicit click, never a bare keypress

Arrow keys move selection only. There's no "select then hit Enter" path that restores or permanently deletes — both require clicking their actual button/menu item. This is deliberate: Trash is where undo-by-panic happens ("wait, I didn't mean to empty that"), so the one surface in Aqua that should be hardest to trigger by accident is this one. "Empty Trash" specifically routes through the shared Confirmation Modal (`UI-SPEC-08`):

```
Title: Empty Trash?
Body: This permanently deletes 12 items (340 MB). This can't be undone.
Confirm: Empty Trash
Cancel: Cancel
```

(Counts interpolated from the current list.)

## 4. Dispatch contract

```ts
type TrashAction =
  | { type: "restore"; trashId: string }
  | { type: "permanentDelete"; trashId: string }
  | { type: "emptyTrash" }
  | { type: "refresh" };
```

## 5. Icon

Two states, as decided: empty vs. has-items. Reactive wherever the icon renders — Dock and this window's own titlebar — driven by whether `GET /api/trash/list` currently returns anything. Asset work (the full-trash variant) is a follow-up, same as Gallery's icon was — doesn't block building the window; until that variant exists the single `icon-trash.svg` ships regardless of contents.

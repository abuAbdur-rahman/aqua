# Aqua UI Spec — Finder

Data source: `GET /api/fs/list?path=` → `FsEntry[]`, live-refreshed over `WS /ws/fs-watch` (`FsWatchEvent`). Writes via `POST /api/fs/op` (`FsOp` union) and `GET /api/fs/read` for preview content. Shapes: `CONTRACT.md` §Filesystem.

Sits inside the Window Frame from `UI-SPEC-01-Chrome.md`. Default window size per `aqua-app-plan.md` app manifest pattern — this spec doesn't set that number, the app manifest does.

## Layout

```
┌──────────────┬──────────────────────────────┬───────────────┐
│  Sidebar      │  Path bar: ~ / projects / aqua │              │
│  ⌂ Home       ├──────────────────────────────┤  Preview pane │
│  📁 projects  │  Name        Size  Modified   │  (Quick Look) │
│  📁 Downloads │  📁 daemon    —    2h ago      │               │
│  ── divider ──│  📁 app       —    2h ago      │   [image /    │
│  🗑 Trash     │  📄 README.md 4KB  1d ago      │    pdf pages /│
│               │  📄 CONTRACT.md 6KB 1d ago     │    md render] │
└──────────────┴──────────────────────────────┴───────────────┘
```

Three-pane layout, sidebar and preview pane both collapsible (preview pane is closed by default, opens on selection or Space-bar Quick Look toggle — mirroring the real shortcut).

**Sidebar:** fixed shortcuts (Home, and whatever `recents`/pinned paths come back from `GET /api/state/layout`'s `appState` blob for this window), `--bg-elevated` background to read as a distinct surface from the file list per `DESIGN.md`'s elevation principle. Active location gets `--accent-bg` row highlight + `--accent` icon tint.

**Path bar:** breadcrumb built from the current `path`, each segment clickable to navigate there directly. Directly editable on click into a raw path field (power-user affordance, matches "real bash, sudo, everything" tone of the rest of the OS).

**File list — two view modes**, toggled top-right of the list pane:
- **List view** (default): columns Name / Size / Modified / Kind, sourced directly from `FsEntry.size`, `.modified`, `.kind`. Sortable by any column, sort state is local UI state (not persisted server-side beyond whatever `appState` the layout endpoint stores).
- **Icon view:** grid of icon+name, `kind` drives icon glyph (folder / file-type glyph / symlink gets a small corner-arrow badge — never silently treat a symlink as its target, `kind: "symlink"` must visually read as one).

**Row interactions:** single click selects (row gets `--accent-bg`), double-click on `dir` navigates in, double-click on `file` opens in Editor (or triggers Quick Look if the file type isn't editable — image/PDF). Right-click → context menu: New Folder, Rename, Move to Trash, Get Info, Open in Terminal (spawns a `POST /api/pty/spawn` with `cwd` set to that folder — the one deliberate cross-app hook Finder has).

## Preview pane (Quick Look)

Per `aqua-app-plan.md` §1: images render inline, PDFs paginate, markdown/code render (not raw-dump). Header of the pane shows filename + size; body swaps by kind:
- Image: fit-to-pane, checkerboard behind transparency
- PDF: page-by-page with a thin page-count indicator, not a continuous scroll — matches native Quick Look's paging feel
- Markdown: rendered, not source
- Code: syntax highlighted read-only (reuse whatever highlighter the Editor already has — no second dependency for this)
- Anything else (binary, unknown): a generic file glyph + "size / kind / modified", no forced text dump

## States

**Loading** (first `fs/list` for a path not yet returned): skeleton rows — 5 shimmer bars at `--bg-hover` opacity, sidebar and path bar render immediately since they don't depend on this call.

**Empty** (`FsEntry[]` returns `[]`): centered in the list pane — folder-outline glyph, "This folder is empty," and a "New Folder" button (`--accent` primary). Not "No files found" — that phrasing implies a search that failed, this is just an empty directory.

**Populated:** as wireframe above. New entries arriving over `/ws/fs-watch` (`kind: "created"`) insert with a brief `120ms` fade-in at their sorted position — no jarring re-sort jump if the user's mid-scroll.

**Error** (an `fs/op` returns `{ success: false, error }`, or `fs/list` 404s on a path that got deleted out from under the window): inline banner at the top of the list pane, `--status-danger` left-border accent card, the raw `error` string shown in `--text-secondary` monospace under a plain-language line ("Couldn't complete that action"), with a "Try again" action where it makes sense (retry) and none where it doesn't (path no longer exists — offer "Go to parent folder" instead).

# UI-SPEC-20 — Editor: folder/project open (file tree)

Addition to Editor's existing multi-tab Monaco setup. Adds an optional left sidebar; coexists with single-file open, doesn't replace it.

## Entry points

- New "Open Folder" action alongside the existing "Open File".
- Finder's context menu gains "Open in Editor" for directories, not just files.

## Sidebar

- 240px default width, resizable via a 4px drag handle on its right edge.
- `--bg-elevated` background. Only rendered when a folder (not just loose files) is open.
- Row height 28px, 8px icon-to-label gap. File-type icons reused from Finder's existing icon set.
- Selected/focused row: `--accent-bg` background, `--text-primary` label.

## Tree behavior

- **Lazy, never recursive.** Each directory node fetches its children via `GET /api/fs/list?path=` only when expanded. No pre-fetching, no client-side recursive walk.
- **Known-heavy directories** (`node_modules`, `target`, `.git`, `dist`, `build` — the same list Spotlight's indexer already excludes) render collapsed by default and require an explicit click to expand. They are never hidden outright and never auto-scanned — this is about not walking them automatically, not about denying access to them.
- Single-click a file: opens it in a new Editor tab, or focuses the existing tab if already open.
- Double-click (or disclosure arrow click) on a folder: toggles expand/collapse.
- **Live updates:** subscribes to `/ws/fs-watch` for the open folder root — same event handling Finder already has. A file created/renamed/deleted elsewhere in the tree updates it without a manual refresh.

## Deferred (not this pass)

- Drag-to-move within the tree — Finder already owns file moves; this tree is browse-only for v1.
- Multi-root workspaces — one folder open at a time.
- Any per-file-type actions beyond open (no context menu here yet — use Finder for rename/delete/move).

## Per-app zoom map (accepted)

`Ctrl+Plus` / `Ctrl+Minus` wired per app — no global page zoom:

| App | Zoom means |
|---|---|
| Finder | Row density / text scale |
| Terminal | Terminal font size |
| Editor | Monaco font size |
| Gallery | Image scale |
| Reader | Markdown font size |
| Activity / Trash / Settings | No-op |

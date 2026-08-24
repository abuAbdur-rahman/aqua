# Aqua UI Spec — File Picker (Open/Save Sheet)

The thing any app reaches for when it needs the user to choose a file — Editor's *File → Open*, Settings' *Wallpaper → +*, and anything added later. It's a cut-down Finder, not a separate app: same sidebar, same list, same `fs/list` call — just presented as a **sheet** (attached to the *inviting window*, not floating over the whole desktop) and reduced to "browse and pick," not full CRUD.

**Supersedes one earlier decision:** `UI-SPEC-09-Settings.md`'s Wallpaper pane originally routed its `+` tile through "Tauri's native file-dialog plugin" (the real Windows file picker). Replace that with this component instead, filtered to image kinds. Reasoning: WSL2 auto-mounts Windows drives under `/mnt/c/...`, so the daemon's ordinary `fs/list` already reaches anywhere on the Windows filesystem a native picker would — nothing is lost, and staying in-app keeps the illusion that Aqua *is* the desktop intact instead of dropping out to a real Windows dialog mid-flow.

Data source: identical to Finder — `GET /api/fs/list?path=` (`FsEntry[]`). No new daemon endpoint. This is a frontend-only component reusing Finder's existing contract.

---

## Why a sheet, not a modal

`UI-SPEC-08-Modals.md`'s Confirm/Elevate modals dim the *whole desktop* and float centered on screen — appropriate for a system-level question. A file picker is scoped to *one window's* task (Editor opening a file, Settings adding a wallpaper), so it behaves like a real macOS sheet: it drops down attached under the *inviting window's* title bar and only dims that window's own content — every other open window and the Menu Bar stay fully interactive underneath it.

## Dimensions (exact)

| Element | Value |
|---|---|
| Sheet width | `640px` default (resizable via bottom-right corner only: min `480px`, max `880px`) |
| Sheet height | `460px` default (min `360px`, max `680px`) |
| Corner radius | Top corners `0` (flush under the parent window's title bar — it visually emerges from there, doesn't float free), bottom corners `10px` (matches window radius from `UI-SPEC-01-Chrome.md`) |
| Horizontal position | Centered over the parent window's own width, not the screen |
| Vertical position | Top edge sits exactly at the parent window's title-bar bottom edge (`28px` down from that window's top) |
| Drop shadow | `dy 12px, blur 24px, opacity 0.5` — heavier than a normal window's, since it's floating above that window's content, not sitting on the desktop |
| Path bar height | `44px` |
| Sidebar width | `160px` (narrower than Finder's own — this panel is smaller overall) |
| Column header row height | `28px` |
| List row height | `32px` (more compact than Finder's own rows — a picker favors seeing more at once over Finder's richer per-row detail) |
| Row icon size | `18px` |
| Footer height | `64px` |
| Button height | `32px`, min-width `88px`, `10px` gap between them, `16px` inset from the sheet's right/bottom edges |

## Layout

```
   (parent window's title bar, 28px, sits above this)
┌─────────────────────────────────────────────────────┐
│  ~ / projects / aqua                    [New Folder] │  ← 44px path bar (New Folder: Save mode only)
├───────────┬───────────────────────────────────────────┤
│  Home      │  Name              Modified                │  ← 28px column header
│  Desktop   ├───────────────────────────────────────────┤
│  Documents │  📁 daemon           2h ago                 │  ← 32px rows
│  ──────    │  📁 app              2h ago                 │
│  Downloads │  📄 README.md       1d ago                  │
│            │  🖼 wallpaper.png    3d ago  (dimmed if     │
│            │                       filtered out by kind) │
├───────────┴───────────────────────────────────────────┤
│  Kind: [ Images ▾ ]         [ Cancel ]   [ Open ]      │  ← 64px footer
└─────────────────────────────────────────────────────┘
```

**Path bar:** same breadcrumb-of-clickable-segments as Finder's, plus a directly-editable raw path field on click. Save mode only: a right-aligned "New Folder" button (creates via the same `fs/op` the full Finder uses).

**Sidebar:** same source as Finder's — Home, Desktop, Documents, a divider, then pinned/recent locations. Selected location gets the same `--accent-bg` row treatment as everywhere else in this OS. Deliberately the *same* component as Finder's sidebar (not a rebuilt one), just constrained to this narrower width.

**List:** two columns only (Name, Modified) — Size/Kind columns from full Finder are dropped here, this view exists to identify and pick a file quickly, not audit a directory. Sortable by either column, same interaction language as Finder (click header to sort, click again to reverse).

**Footer — left to right:**
- **Kind filter dropdown** — only rendered at all if the caller passed more than one allowed kind (e.g. Settings' wallpaper picker restricts to `Images`; Editor's Open passes no restriction, so this control is simply absent for that call rather than showing a meaningless single-option "All Files" dropdown).
- **Filename field** (Save mode only) — flex-fills the remaining space between the kind filter and the buttons; pre-filled with a sensible default name, fully editable.
- **Cancel** — secondary style, always enabled.
- **Open** (or **Save** in Save mode) — primary `--accent` style, disabled until there's a valid selection (Open mode: a file, not a folder, is selected; Save mode: the filename field is non-empty).

## Selection behavior

- **Single-select is the default.** Multi-select only activates when the calling app explicitly asks for it (`multiple: true`) — e.g. Settings' wallpaper add allowing a batch upload. When enabled, standard range (Shift-click) and toggle (Ctrl/Cmd-click) selection apply, and the confirm button's label pluralizes ("Open 3 Files").
- Single click selects (`--accent-bg` full-row highlight, same token as every other selectable row in this OS). Double-click on a folder navigates into it; double-click on a file (in Open mode) immediately confirms the pick, same as clicking the primary button.
- **Kind-filtered rows are dimmed, not hidden** — a `.png` sitting in a folder full of code, seen at ~40% opacity while browsing an Editor's Open dialog, still shows the folder's real contents; it's just not clickable-to-select. Folders are never dimmed regardless of kind filter — you always need to see and enter them to reach the files you're after.
- Type-ahead jump: typing while the list has focus jumps selection to the next row starting with those characters (standard picker behavior, not specific to this OS — implement it because its absence is the kind of thing power users notice immediately).
- `Enter` confirms the current selection (Open mode) or filename (Save mode) when the primary button is enabled; `Esc` cancels — same modal-shell keyboard contract as `UI-SPEC-08-Modals.md`.

## States

**Loading** (`fs/list` for the current path not back yet): sidebar and path bar render immediately (their data doesn't depend on this call); the list area shows 5 skeleton rows at `--bg-hover`, same treatment as Finder's own loading state.

**Empty:** centered "This folder is empty." Open mode: primary button stays disabled, nothing to do here. Save mode: still fully usable — the filename field and New Folder button don't care whether the current folder has existing content.

**Populated:** as the layout above.

**Error** (path 404s, permission denied): same inline `--status-danger` banner pattern as Finder's error state — reused component, not reinvented — with a "Go to parent folder" action in place of retry where the path itself is gone.

## Integration

A single shared frontend entry point rather than each app wiring its own copy:

```ts
pickFile({
  mode: "open" | "save",
  allowedKinds?: string[],   // e.g. ["image"] — omit for no restriction
  multiple?: boolean,        // default false
  startPath?: string,        // defaults to the app's last-used location if omitted
  confirmLabel?: string,     // defaults to "Open" / "Save"
}) => Promise<string[] | null>   // null on cancel
```

Lives alongside the existing modal components — `system/FilePickerSheet.tsx` + `filePickerStore.ts`, in the same `system/` module introduced by `APPEND_V2.md`'s frontend addendum, next to `ConfirmModal.tsx` and `ElevateModal.tsx`.

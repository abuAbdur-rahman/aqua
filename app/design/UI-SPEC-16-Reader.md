# UI-SPEC-16 — Reader

Lightweight, read-only Markdown viewer. One document per window, no editing, no Monaco. Frontend-only — no new daemon endpoints, consumes only what's already there: `fs/read`, `fs/op` (rename, the `copy` variant from `APPEND_WINDOWS_IMPORT.md`, `moveToTrash`), `/ws/fs-watch`.

**Companion docs:** `CONTRACT.md` (unchanged by this spec), `DESIGN.md` (typography tokens reused directly — Inter for prose, JetBrains Mono for code blocks, same as Editor), `app/PLAN.md` §1 (Finder's Quick Look promise, which this spec resolves rather than duplicates).

## 1. Scope

| In scope | Out of scope |
|---|---|
| Render `.md`/`.markdown` as formatted output — GFM (tables, task lists, strikethrough, autolinks) | Editing — that's Editor's job. No WYSIWYG, no save. |
| Syntax-highlighted code fences | HTML rendering, other rich-text formats |
| Collapsible table-of-contents from headings, active-heading tracking on scroll | Mermaid/diagram rendering, math (KaTeX) — real candidates for later, not v1 |
| Copy as Markdown (raw source) / Copy as Plain Text (rendered, stripped) | Multi-tab — one document per window, like a real Preview-style app, not Editor's tabbed model |
| File actions: Rename, Duplicate, Move to Trash, Reveal in Finder | Live collaborative editing, version history |
| Print / export to PDF via the browser's native print dialog | Anything requiring a new daemon endpoint |

## 2. Relationship to Finder's preview pane

Finder's Quick Look preview (`app/PLAN.md` §1: "markdown/code render") and Reader share one `MarkdownRenderer` component. Finder's preview pane uses it small, no chrome, just enough to glance at a file without opening anything. Reader wraps the same renderer full-window with the TOC sidebar, copy/print actions, and the file-action toolbar. One rendering implementation, two presentations — not two markdown renderers quietly drifting apart, the same mistake Gallery's icon-set caveat and Command Center's shared-`PaletteOverlay` note were both written to avoid.

## 3. Rendering approach — kept genuinely lightweight

- Markdown parsing: a small client-side parser (e.g. `markdown-it` or `remark`), not a full editor engine.
- Code-block syntax highlighting: a minimal highlighter (e.g. Prism), lazy-loaded only when the open document actually contains a fenced code block — same lazy-load principle already applied to Monaco in Editor, applied here to keep the *common case* (a document with no code) cheap.
- Every rendered code block gets a small copy icon, revealed on hover in the block's top-right corner — click copies the raw, unhighlighted code to the clipboard and flashes a brief checkmark in place of the icon for ~1s. No toast, no modal — the same low-friction pattern as copying a link in a browser's address bar.
- No virtualization needed for the document body — typical markdown files are small enough that windowing would be over-engineering. If someone opens something unusually large (a multi-MB single file), a soft inline note ("Large file — rendering may be slow") is enough; not a blocking mechanism.

## 4. States

**Loading** — skeleton paragraph-shaped shimmer blocks in place of the document body while `fs/read` resolves.

**Empty** — Reader launched from the Dock with no target file (no "Open in Reader" action fired it). Centered prompt, "Open a Markdown file," using the existing File Picker sheet — same reused component every other app already uses for this, not a new picker.

**Populated** — Rendered document, TOC sidebar (collapsible, off by default on narrow windows), toolbar: Copy as Markdown, Copy as Plain Text, Rename, Duplicate, Move to Trash, Reveal in Finder, Print. Typography: `--text-primary` body copy on `--bg-surface`, Inter for prose, JetBrains Mono for code — both already-established `DESIGN.md` tokens, not new choices.

**Error** — two distinct cases, not collapsed into one generic message: `fs/read` failed (permission, file gone before open) gets the standard message + Retry; the file being removed out from under an *already-open* Reader window (via `/ws/fs-watch`, same signal Gallery's Loupe already reacts to) gets its own line — "This file was moved or deleted" — since that's a meaningfully different situation from a failed initial load.

## 5. Dispatch contract

```ts
type ReaderAction =
  | { type: "rename"; path: string; newName: string }
  | { type: "duplicate"; path: string }        // -> POST /api/fs/op {op:"copy", path, to: same dir}
                                                  // same auto-rename-on-conflict policy already
                                                  // established for restoreFromTrash and Windows
                                                  // import — third reuse of the same rule, not a new one
  | { type: "moveToTrash"; path: string }
  | { type: "revealInFinder"; path: string }
  | { type: "copyAsMarkdown" }                    // clipboard, raw source — client-side only
  | { type: "copyAsPlainText" }                    // clipboard, rendered text stripped of markup
  | { type: "toggleToc" }
  | { type: "print" };                              // window.print(), client-side only
```

`moveToTrash`/rename dispatch through the exact same daemon calls Finder and Gallery already use — no new behavior invented here either.

## 6. Live reload

Subscribes `/ws/fs-watch` on the open file's path for its window's lifetime (reuses the same hook pattern as Finder/Gallery). On `modified`, re-fetch and re-render in place, preserving current scroll position where possible. On `removed`, show the Error-state message above rather than silently closing.

## 7. Keyboard

| Key | Action |
|---|---|
| `Cmd/Ctrl+C` (nothing selected) | Copy as Plain Text (the whole document) |
| `Cmd/Ctrl+P` | Print |
| `Cmd/Ctrl+Delete` | Move to Trash (with the standard confirmation) |
| `Cmd/Ctrl+D` | Duplicate |

## 8. Icon

Not designed here — follow-up asset, same as Gallery's and Trash's. Doesn't block building the app.

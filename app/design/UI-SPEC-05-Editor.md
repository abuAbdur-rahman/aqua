# Aqua UI Spec — Editor

Data source: `GET /api/fs/read` (`FsReadResponse`) to open, `PUT /api/fs/write` (`FsWriteRequest`/`Response`) to save. Monaco-based, multi-tab, lazy-loaded only on first open (`aqua-app-plan.md` §8 risk table — this spec doesn't change that, just designs around it). Shapes: `CONTRACT.md` §Filesystem.

## Layout

```
┌───────────────────────────────────────────┐
│ ●●●        Editor                          │
├──[ README.md ]──[ ● main.rs ]──[ + ]───────┤  ← tabs, ● = unsaved
├───────┬─────────────────────────────────────┤
│ 1 │ # │ Aqua                                 │
│ 2 │   │                                      │
│ 3 │ A │ real, daily-driver desktop for...    │
├───────┴─────────────────────────────────────┤
│ README.md          UTF-8   Markdown   Ln 3   │  ← status bar
└───────────────────────────────────────────┘
```

**Tab strip:** same visual treatment as Terminal's (active = `--bg-surface`, inactive = `--bg-elevated`, `28px`), so the two multi-tab apps in the OS feel like one shared pattern rather than two different tab widgets. Unsaved-changes dot: a small `--accent` (not `--status-warning` — unsaved isn't a *problem*, it's normal editing state) filled circle before the filename, replaces the close-× on hover only after the file is saved; while unsaved, hovering shows both the dot and a close-× stacked, so closing an unsaved tab is still one click but the dot doesn't silently vanish under the hover state.

**Editor body:** Monaco itself, theme built from `DESIGN.md` tokens rather than Monaco's stock dark theme — background `--bg-surface`, gutter `--bg-surface` too (not a contrasting gutter color; keep it quiet), line numbers `--text-tertiary`, current line highlight `--bg-hover`, selection `--accent-bg`. Syntax colors are the one place outside the semantic-status set this app introduces its own palette (standard-ish dark-theme syntax colors), since forcing code-token colors onto only four accent/status tokens would make syntax highlighting useless — call this out explicitly to whoever implements it so it isn't read as a DESIGN.md violation.

**Status bar:** `24px` strip at the bottom (matches Menu Bar height for rhythm), `--bg-elevated`, left-to-right: filename, encoding (`FsReadResponse.encoding`), detected language, cursor position (`Ln X, Col Y`). Right-aligned: save state text ("Saved" in `--text-tertiary`, or "Saving…" transiently during the write call).

## Interactions

- `Ctrl+S` (or Aqua's equivalent) triggers `PUT /api/fs/write`; while in flight, status bar right side reads "Saving…"; on `{ success: true, modified }` it flips to "Saved" and the tab's unsaved-dot clears; on `{ success: false, error }` see Error state below.
- Opening a file already open in another tab focuses that tab instead of duplicating it.
- `truncated: true` on `FsReadResponse` (large file, daemon capped it) — banner across the top of the editor body, not silent: "This file is large — showing the first portion. Editing and saving are disabled." Editor goes read-only in this case (Monaco `readOnly: true`) rather than letting someone save a truncated file over the real one.
- `encoding: "base64"` on read — this app doesn't try to render binary as text; swap the whole body for a simple "This file can't be edited here" message with a "Open in Finder" text-link instead of a Monaco instance full of garbage bytes.

## States

**Loading** (tab opened, `fs/read` not back yet): tab appears immediately (so the click feels responsive) with its title, but the body shows a quiet skeleton — a few gutter-only gray bars, no fake code — until content arrives.

**Empty** (genuinely empty file, `content: ""`): Monaco just renders empty with a cursor at 1:1 — no special empty-state graphic needed here, an empty text file isn't a broken state the way an empty folder or empty search result is, it's just... an empty file. Don't over-design this one.

**Populated:** as wireframe above.

**Error — read failed** (`fs/read` 404s, e.g. file deleted from under an open tab via Finder or the fs-watch stream reports a `removed` event for this exact path): the tab stays but its body swaps to an inline notice, `--status-danger` left-border card: "This file no longer exists," with "Close tab" and "Save as new file" actions (the second one re-runs `fs/write` at the same path, effectively recreating it from the in-memory buffer — useful if it was deleted by accident).

**Error — write failed** (`fs/write` returns `{ success: false, error }`): status bar's "Saving…" flips to "Couldn't save" in `--status-danger`, non-dismissed until the next successful save or explicit retry — this one deliberately doesn't auto-clear on a timer, because "your edits aren't actually saved" is exactly the kind of state that shouldn't quietly disappear.

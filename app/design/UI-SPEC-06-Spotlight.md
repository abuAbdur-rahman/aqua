# Aqua UI Spec — Spotlight

Data source: `GET /api/search?q=` → `SearchResponse { files, apps, actions }`. Opened by a system-wide global hotkey (`tauri-plugin-global-shortcut`, `aqua-app-plan.md` §4), fires unfocused — this is the only panel in the OS that isn't a Window-Frame app; it's a floating overlay, not a window (no traffic lights, no title bar, no Dock icon of its own).

## Layout

```
        ┌───────────────────────────────────────┐
        │  🔍  fs/list                            │
        ├───────────────────────────────────────┤
        │  FILES                                  │
        │  📄 fs/mod.rs           daemon/src/fs   │
        │  📄 CONTRACT.md         · GET /api/fs/…  │
        │                                          │
        │  QUICK ACTIONS                          │
        │  🧮  42 * 12  →  504                     │
        └───────────────────────────────────────┘
                (floats centered, upper-third of screen)
```

Single floating `--bg-overlay` panel (`DESIGN.md`'s modal/palette surface, distinct from every window's `--bg-surface`), centered horizontally, positioned in the upper third of the screen rather than dead-center — matches the real Spotlight's placement and keeps it from covering whatever the user was mid-task on beneath it. Corner radius matches window radius (`10px`) for family resemblance even though it isn't a window.

**Input row:** large, single line, `🔍` glyph left-aligned, placeholder "Search files, apps, or type a calculation" — the placeholder itself teaches the three result kinds this box understands, so the empty box is doing onboarding rather than sitting blank.

**Results, grouped by kind, in a fixed section order:** Apps → Files → Quick Actions. Apps first because "launch something" is the highest-frequency Spotlight use case in the real OS this mirrors; Quick Actions last since they're a single-line answer, not something to scan a list for.

- **Apps** (`SearchAppHit`): icon + name, single row each, Enter on the top one launches it (maps onto opening/focusing that app's Dock entry).
- **Files** (`SearchFileHit`): file glyph (by extension, same icon set as Finder — don't introduce a second file-type icon system) + `name`, with `path`'s parent directory as a dim secondary line, and `snippet` (if present) below that in `--text-tertiary` — this is the one place highlighted-match context matters, since `tantivy` full-text search is exactly what makes a snippet meaningful here.
- **Quick Actions** (`SearchActionHit`): a single compact row, `kind` decides the glyph (calculator vs. unit-convert), `input → result` shown directly so the answer is visible without pressing Enter — Enter just copies `result` to clipboard.

Selected row (arrow-key navigable) gets `--accent-bg` background across the full row width, not just a text-color change — needs to be glanceable at speed since this whole surface exists to be used with keyboard only, most sessions never touch a mouse.

## Interactions

- Debounce the `search?q=` call client-side (~150–200ms after last keystroke) — this hits the daemon on every open keystroke otherwise, and unlike the layout-write debounce elsewhere in this app (which is about not spamming disk writes), this one is about not spamming a full-text index query mid-word.
- `Esc` closes immediately, no confirmation, no animation lag — Spotlight needs to feel instantly dismissible or the muscle-memory of "type, act, hit Esc" breaks.
- Open animation: `180ms, scale 0.96 → 1` (`DESIGN.md`) — this exact easing/scale is Spotlight's signature motion in this OS, don't reuse a different one here even though it's visually similar to the window-open animation; keep it distinct since this panel isn't a window.

## States

**Empty query** (just opened, nothing typed): show a short "Recent" list instead of a blank panel — reuse whatever `recents` data Finder's sidebar already draws from `state/layout`'s `appState`/recents table (`aqua-backend-plan.md` §8 schema has a dedicated `recents` table with a `source` column) rather than inventing a second recents concept. An empty panel on first keystroke-target is a wasted screen; a truly new install with zero recents falls back to the placeholder-only input row, which is fine.

**Loading** (query in flight, debounce elapsed): keep showing the previous result set dimmed to ~50% opacity rather than clearing to blank-then-repopulate — a search box that flashes empty on every keystroke feels broken even when it's technically "correct."

**No results** (`SearchResponse` comes back with all three arrays empty): single centered line under the input, "No matches for “{query}”" — quoting the actual query back, not a generic "no results" — with no further action offered; unlike Finder's empty-folder state there's nothing constructive to *do* here beyond typing something else, so this is the one legitimate case in the whole OS where the empty state doesn't need a call-to-action button.

**Error** (the `search` call itself fails, as opposed to succeeding with empty arrays): small inline `--status-danger` text under the input, "Search is unavailable right now" — Spotlight doesn't get its own retry button or reconnect chatter; it's a lightweight overlay, that messaging job belongs to the Menu Bar's global connection indicator, and this panel just stays out of its way.

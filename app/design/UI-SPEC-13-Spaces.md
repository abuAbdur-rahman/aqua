# UI-SPEC-13 — Spaces & Mission Control

Multiple desktops + the zoomed-out overview to manage them. Locked scope already ("Window manager: Full pro-grade + Spaces," `README.md`), stubbed already (`desktop/Spaces.tsx`, App Phase 7) — this fills in the part that was never actually decided: how switching works, what Mission Control looks like, and what happens to a window when its Space goes away.

**Companion docs:** `CONTRACT.md` (§ State/persistence — unchanged by this spec), `DESIGN.md` (tokens; new motion values proposed in §7, not yet applied — locked file, needs its own append), `aqua-app-plan.md` §5 (`windowStore.ts`, `Spaces.tsx`).

## 1. Scope

| In scope | Out of scope (not this version) |
|---|---|
| N desktops, add/remove | Per-space wallpaper |
| Switch via keyboard, Dock/menu-bar indicator, or Mission Control | App Exposé (per-app window overview) |
| Mission Control: zoomed-out view of every Space + its windows | "Assign app to all desktops" / sticky windows |
| Drag a window between Spaces (from inside Mission Control) | Cross-Space window tiling/Stage Manager-style layouts |
| Reorder Spaces | Space-specific menu bar items beyond the standard per-app ones |

## 2. Data model — no `CONTRACT.md` changes needed

Already shaped for this: `LayoutState.spaces: SpaceState[]` (`id`, `name`, `orderIndex`) and `WindowState.spaceId` already exist. Spaces was designed into the contract before it was designed into the UI — this spec just uses what's there. Persistence is the existing `GET`/`PUT /api/state/layout`, same client-side ~1s debounce already established for layout writes. No new daemon calls, no new endpoints.

`activeSpaceId` itself is **not** persisted server-side (not part of `LayoutState`) — it's ephemeral client state in `windowStore.ts`, reset to the lowest `orderIndex` Space on boot. Worth flagging: if you want Aqua to reopen on whatever Space you left it on, that's a small `CONTRACT.md` addition (`LayoutState.activeSpaceId`), deliberately not proposed here since it's outside "no daemon changes."

## 3. Desktop view — Space switching

Only windows where `window.spaceId === activeSpaceId` render in `Desktop.tsx`. Switching is instant-select, not scroll-through — no continuous horizontal desktop that pans (that's a real trackpad-gesture pattern macOS supports natively; Windows/Tauri doesn't get that gesture for free, so building it would mean fighting the platform for a cosmetic win). Switch triggers:

- **Keyboard**: `Ctrl+→` / `Ctrl+←` (next/previous Space by `orderIndex`), `Ctrl+1`...`Ctrl+9` (jump to Space N).
- **Menu bar indicator**: dot cluster in the menu bar (`● ○ ○ ○`, current Space filled) — click cycles, or opens a small popover listing Space names for direct jump.
- **Mission Control** (§4): click a Space thumbnail.

Switch animation: current Space's windows slide out, target's slide in, same direction as the keyboard arrow (or leftward for a menu-bar/Mission-Control jump to a lower `orderIndex`, rightward for higher). Timing proposed in §7 — no existing `DESIGN.md` token covers this, flagged there rather than invented silently.

## 4. Mission Control — states

Full-viewport overlay, `--bg-overlay`, triggered by `Ctrl+Up` or clicking the menu-bar Space indicator's "Show All" option. This is the one surface in this spec that's genuinely data-driven (reading current window/space state), so it gets the real four-state treatment — everything else in this doc is pure client interaction with no fetch involved.

**Loading** — only reachable if Mission Control opens before the boot-time `GET /api/state/layout` resolves (edge case: hitting `Ctrl+Up` in the first ~200ms). Same skeleton treatment as other specs: dimmed backdrop, no space thumbnails yet, brief enough it'll rarely be seen.

**Empty** — exactly one Space exists (the default) and it has zero open windows. Centered: "Nothing open," a single "+" affordance to add a second Space. Not a true error state, just nothing to show yet.

**Populated** — row of Space thumbnails across the top third, each a scaled-down live render (see perf note §6, not a screenshot) of that Space's windows, current Space highlighted with an `--accent-ring` border. Click a thumbnail = switch + close Mission Control. Drag a window's thumbnail from one Space into another = reassign (`spaceId` update, persisted via the existing debounced `PUT /api/state/layout`). Hover a Space thumbnail reveals a small "×" (remove — see §5) unless it's the last remaining Space. Trailing "+" thumbnail adds a new Space. Below the Space row: the active Space's windows at a larger scale, same drag-to-reassign behavior, click to focus + exit Mission Control.

**Error** — layout failed to load (daemon unreachable at boot). Reuses the standard treatment: `--status-danger` icon, message, Retry re-issues `GET /api/state/layout`. If this fires, Mission Control has nothing to show regardless — same failure as every other surface that depends on boot-time layout.

## 5. Removing a Space

Only offered when the Space has zero windows, **or** windows exist and removing prompts: "Move N windows to [previous Space]?" — Confirm reassigns every window in that Space to the adjacent lower-`orderIndex` Space (or the next one up, if removing Space 1) and deletes the `SpaceState` entry. No silent data loss, no orphaned `spaceId` values left pointing at a Space that no longer exists. Last remaining Space cannot be removed — no "×" renders on it.

## 6. Performance — the actual risk here

Mission Control renders every open window's real component tree at reduced scale, across every Space, simultaneously. Given the CPU-burn history on this project (bare loops, unbounded polling), this is worth being explicit about rather than assuming CSS `transform: scale()` on a live `WindowFrame` is free:

- Terminal and Activity Monitor windows in **inactive** Spaces keep their WS connections alive (pty and sysmon should keep running in the background — that matches real desktop behavior, a backgrounded terminal process shouldn't die because you switched desktops), but their **rendering** should stop consuming paint cycles while not visible. Use `content-visibility: hidden` (or unmount the heavy child — `xterm.js`/Monaco — while keeping the WS connection and buffering incoming data) rather than just `display: none` on a still-fully-rendering subtree.
- Mission Control itself, being a moment where *every* Space's windows render at once regardless of active/inactive, is the one time all those subtrees need to paint together. Cap it: if a Space's window count is large, render its thumbnail row as a static last-known-frame snapshot (canvas capture on Mission Control open) rather than N live scaled subtrees repainting in parallel. Live-render only the active Space's larger row.
- Don't tie Mission Control's open/close to a fresh `fs/list` or `sysmon` fetch — it reads from `windowStore.ts`, which is already current.

## 7. Motion — proposed `DESIGN.md` tokens (not yet applied, locked file)

| Interaction | Proposed timing |
|---|---|
| Space switch (slide) | 260ms `cubic-bezier(0.4, 0, 0.2, 1)` — same curve as Window open/close for consistency |
| Mission Control open/close (zoom) | 220ms, scale 1 → 0.94 on open (mirrors Spotlight's existing 180ms/0.96 pattern, slightly slower since more is moving on screen) |

These need a real append to `DESIGN.md` before implementation — not doing that inline here since it's a locked file with its own append convention. Flagging the values now so the Windows agent isn't inventing timing on the spot mid-build.

## 8. Dispatch contract

```ts
type SpacesAction =
  | { type: "switchSpace"; spaceId: number }
  | { type: "addSpace" }
  | { type: "removeSpace"; spaceId: number; reassignWindowsTo: number }
  | { type: "reorderSpace"; spaceId: number; newOrderIndex: number }
  | { type: "moveWindowToSpace"; windowId: string; spaceId: number }
  | { type: "openMissionControl" }
  | { type: "closeMissionControl" };
```

## 9. Keyboard

| Key | Action |
|---|---|
| `Ctrl+→` / `Ctrl+←` | Next / previous Space |
| `Ctrl+1`...`Ctrl+9` | Jump to Space by number |
| `Ctrl+Up` | Open Mission Control |
| `Esc` | Close Mission Control (no switch) |
| `Enter` (thumbnail focused) | Switch to focused Space, close Mission Control |

## 10. Menu bar

Space indicator lives in the standard menu bar, not a per-app menu — it's system chrome, always visible regardless of focused app, matching Menu Bar's existing spec role as the one thing that doesn't change per-window.

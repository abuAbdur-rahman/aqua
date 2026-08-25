# UI-SPEC-14 — Command Center

A searchable palette over every executable command in Aqua — window actions, per-app menu commands, Space actions, system/daemon-lifecycle commands. Not a search surface (that's Spotlight's job — files, app launch, quick actions); this is an *action* surface. Trigger: `Ctrl+Shift+/`, local to the focused Aqua window (not a global hotkey — see §2).

**Companion docs:** `DESIGN.md` (Spotlight's existing 180ms/0.96 open motion, reused here — see §5), `APPEND_V3.md` (the `AppMenuItem`/`AppMenuGroup` contract this reuses as its primary command source), `UI-SPEC-13-Spaces.md` (`SpacesAction`, one of the registries fed in).

## 1. Scope

| In scope | Out of scope |
|---|---|
| Fuzzy-search every named command, execute on select | File search, content search (Spotlight's job) |
| Aggregate commands from: focused app's menu, window management, Spaces, system/daemon lifecycle | Custom user-defined commands / macros |
| Keyboard-first: open, type, arrow, enter | Command history / recently-used ranking (nice-to-have, not v1) |
| Show each command's existing keyboard shortcut as a hint, not rebind it | Rebinding shortcuts from within the palette |

## 2. Scope decision — local hotkey, not global

Spotlight needs a system-wide hotkey because it's meant to fire from anywhere, unfocused (`aqua-app-plan.md` §2, `tauri-plugin-global-shortcut`). Command Center doesn't share that need — every command it lists (window actions, per-app menu items, Space switches) only makes sense with Aqua already focused; there's nothing to *do* with a "New Space" command from outside the app. So `Ctrl+Shift+/` is a plain in-WebView key listener, no Tauri host involvement, no new global-shortcut registration. Smaller surface, matches the existing pattern of not reaching into the host layer unless the feature actually needs OS-level reach.

## 3. Command sources — no duplicate command definitions

The palette doesn't own its own command list; it reads from the same sources that already exist, so a command defined once shows up everywhere it should with no second place to update:

| Source | Feeds |
|---|---|
| Focused app's `AppMenuGroup[]` (the contract from `APPEND_V3.md`) | Every visible menu item of whatever app currently has focus — Finder's "New Folder," Editor's "Save," Gallery's "Rename," etc. |
| `windowStore.ts` | Window-level actions for the focused window: Minimize, Close, Zoom/Fullscreen, Move to Space submenu |
| `SpacesAction` registry (`UI-SPEC-13-Spaces.md` §8) | Switch to Space N, New Space, Open Mission Control |
| System/daemon commands | The three named Tauri commands already specified in `APPEND_V3.md` — `restart_daemon`, `relaunch_aqua`, `quit_and_stop_daemon` — plus "Open Settings," "Toggle Spotlight" |

Each source contributes `CommandEntry` objects (shape in §6) rather than the palette hardcoding anything app-specific. Adding a new app's commands to the palette is then a side effect of that app defining its `AppMenuGroup` correctly — no separate registration step.

## 4. States

**Loading** — not really reachable; the registry is assembled from state already in memory (`windowStore.ts`, the focused app's manifest) the instant the palette opens. No daemon round-trip on open.

**Empty** — query matches nothing. Centered, small: "No matching commands," no further affordance (unlike Spotlight's empty state, there's no sensible fallback action like "search the web" — this is a closed set of known commands).

**Populated** — grouped list, most relevant group first: commands from the focused app, then Window, then Spaces, then System. Each row: command label, category tag, keyboard shortcut on the right if one exists (display-only, per §1). Arrow keys move selection, `Enter` executes and closes the palette. Typing filters by fuzzy match against label + optional `keywords` (so "kill terminal" can still surface "Close Window" even without an exact label match).

**Error** — a selected command's execution fails (e.g., `quit_and_stop_daemon` can't reach the daemon to shut it down cleanly). Palette stays open, the failed row shows an inline `--status-danger` note under it rather than closing on a silent failure — the person should see that nothing happened and why, not have the palette vanish as if it worked.

## 5. Motion

Reuses the existing Spotlight token from `DESIGN.md` exactly — 180ms, scale 0.96 → 1 — rather than proposing a new one. These two overlays are close enough in shape and role that giving them different timing would read as an unintentional inconsistency, not a deliberate design choice.

## 6. Dispatch contract

```ts
interface CommandEntry {
  id: string;
  label: string;
  category: "app" | "window" | "space" | "system";
  keywords?: string[];
  shortcutHint?: string;      // display only — e.g. "⌘W" — never rebindable here
  enabled: boolean;            // e.g. "Close Window" disabled with zero windows open
  run: () => void;              // dispatches into the existing contract the entry came from —
                                  // AppMenuItem.onSelect, a windowStore action, a SpacesAction,
                                  // or a Tauri invoke for the three named system commands
}

type CommandCenterAction =
  | { type: "open" }
  | { type: "close" }
  | { type: "execute"; commandId: string };
```

## 7. Keyboard

| Key | Action |
|---|---|
| `Ctrl+Shift+/` | Toggle open/close |
| ↑ / ↓ | Move selection |
| `Enter` | Execute selected, close palette |
| `Esc` | Close without executing |
| Typing | Fuzzy-filter live |

## 8. Shared base with Spotlight

Both are: overlay on `--bg-overlay`, a search input, a filtered list, the same open/close motion, the same keyboard navigation shape. Worth building a shared `PaletteOverlay` component (input + list + keyboard nav + motion) that Spotlight and Command Center both wrap, rather than two near-identical implementations drifting apart over time. This isn't a new API surface — purely an internal frontend structuring note for whoever builds this.

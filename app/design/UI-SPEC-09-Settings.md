# Aqua UI Spec — Settings

New Dock app (icon already designed — `icon-settings.svg`). Data sources: `GET/PUT /api/wallpaper`, `POST /api/wallpaper/upload`, `DELETE /api/wallpaper/:id` for the Wallpaper pane (new — see CONTRACT addendum); `GET /api/health` for the Daemon pane; everything else (Appearance, About) is local UI state or static text, no daemon round-trip.

## Layout

Sidebar-navigated, like the rest of Aqua's multi-section apps get a consistent "list on the left, content on the right" shape rather than a tabs-across-the-top layout (tabs are reserved for Terminal/Editor's multi-document pattern — using the same widget for "app sections" would blur the two meanings).

```
┌───────────────┬───────────────────────────────────┐
│  Appearance    │  Wallpaper                          │
│▸ Wallpaper     │  ┌────┐ ┌────┐ ┌────┐ ┌────┐        │
│  Daemon        │  │ ✓  │ │    │ │    │ │ +  │        │
│  About         │  └────┘ └────┘ └────┘ └────┘        │
│                │   Aqua    Dusk   Slate   Add          │
│                │                                       │
└───────────────┴───────────────────────────────────┘
```

Sidebar: `--bg-elevated`, fixed sections in a stable order (Appearance, Wallpaper, Daemon, About), active item gets `--accent-bg` row + `--accent` label — identical selected-state treatment to Finder's sidebar, for consistency across the OS's two sidebar-driven apps.

## Appearance pane

Short, because most of this OS's visual identity is deliberately locked (`DESIGN.md`: dark mode only, no theme switching). This pane says so rather than hiding the fact that there's "nothing to switch" — an Appearance section with zero controls reads as broken, so it explains the choice in one line and then offers the two things that *are* actually adjustable:

- **Reduce motion** toggle — when on, every animation elsewhere in the OS (window open/close, dock magnify, minimize-to-dock, Spotlight open) drops to a plain opacity cross-fade at a fixed 100ms, per the accessibility floor already set in `UI-SPEC-00-INDEX.md`. Local-only state (a `prefs` key via the existing daemon prefs table, so it persists across restarts — reuses the schema already defined in `aqua-backend-plan.md` §8, no new table needed).
- **Dock icon size** slider — adjusts the *base* size (currently fixed at 48px in `DESIGN.md`) between 40–56px; magnify-on-hover stays proportional (always +16px over base, matching today's 48→64 ratio). Also a `prefs` key.

A one-line note under the section header: "Aqua uses a single dark theme by design — see the aesthetic notes in the project's `DESIGN.md`." (Internal framing for whoever's building this — the in-app copy itself should just say something like "Aqua is dark-mode only. A light theme isn't planned.")

## Wallpaper pane

The main event. Grid of square thumbnails, `4` per row, `12px` gap, each thumbnail `8px` radius (card token) with a `2px` `--accent-ring` border on the currently-selected tile plus a small checkmark badge (`--accent` circle, white check) in its top-right corner — badge, not just a border, because a border-only selection state is easy to miss at a glance across a grid this size.

**Two thumbnail sources merged into one grid:**
1. **Built-in wallpapers** — shipped as static assets in the frontend bundle (not daemon-served — these aren't user data, no reason to round-trip them through the API). The default gradient from `DESIGN.md` is always the first tile, labeled "Aqua" (its actual name, not "Default" — every other tile has a real name, this one should too).
2. **Custom wallpapers** — user-uploaded, daemon-served, appended after the built-ins. Label defaults to the original filename (minus extension) unless the daemon assigns one.

**"+" tile** — same size as the others, dashed border instead of a photo, centered `+` glyph. Click opens the OS-native file picker (Tauri's file-dialog plugin, not a custom in-app picker — this is exactly the kind of native-feeling moment worth using the real OS dialog for). On a valid image selection, uploads via `POST /api/wallpaper/upload`; the tile briefly shows an upload-progress ring in place of the `+`, then the grid gets a new real thumbnail in its place and the "+" tile shifts to stay last.

**Selecting a tile applies immediately** — no separate "Apply" button. Click → `PUT /api/wallpaper` with that tile's id → on success the desktop wallpaper updates live behind every open window (this is why it's worth seeing applied instantly: the whole point of a wallpaper picker is judging it against your actual desktop, not a preview thumbnail). A brief `220ms` cross-fade on the desktop itself when the wallpaper changes (reuse the window-open easing curve, don't add a new one).

**Deleting a custom wallpaper:** hovering a *custom* tile (never a built-in — those aren't deletable, and shouldn't show any hover affordance suggesting they are) reveals a small trash-glyph badge, top-left, `--status-danger` on hover. Clicking it routes through the Confirmation Modal ("Delete “{label}”? This can't be undone.") before calling `DELETE /api/wallpaper/:id`. If the deleted wallpaper was the currently-applied one, selection falls back to the default Aqua gradient automatically (never leaves the desktop pointing at a wallpaper that no longer exists).

## Daemon pane

Read-only status plus one action:

- Connection state (mirrors the Menu Bar's global dot, but with a text label here since this pane has room for one: "Connected" / "Reconnecting…" / "Offline")
- Daemon version (`HealthResponse.version`)
- WSL distro name (whatever the Tauri host resolved at startup, per `app/AGENTS.md`'s "query `wsl -l -v`, never hardcode" rule)
- **Restart Daemon** button — same action as the System Menu's entry, same Confirmation Modal copy; having it in two places (menu + Settings) is fine since they're the same underlying action, not a duplicated concept.

## About pane

Aqua glyph (large, ~96px, the same mark used at 16px in the System Menu — one asset, two sizes), version string, and nothing else. No changelog, no license text wall — this is a tool for one person's own machine, not a shipped product with legal obligations to surface here.

## States

**Wallpaper pane, loading** (initial `GET /api/wallpaper` not back yet): built-in tiles render immediately (they're static, no fetch needed) with no selection badge shown on any of them until the real `current` value arrives — better an unselected-looking grid for a moment than a badge on the wrong tile that then jumps.

**Wallpaper pane, upload error** (`POST /api/wallpaper/upload` fails — bad format, too large, daemon disk write failed): the "+" tile's progress ring is replaced by a small `--status-danger` "×" for ~2 seconds, then reverts to the plain "+" — no modal, no persistent banner, this is a low-stakes retry-and-move-on failure, not a data-loss risk.

**Daemon pane, disconnected:** version and distro fields show "—" instead of stale/blank, Restart Daemon button's label flips to "Start Daemon" (mirrors the System Menu's same-situation handling in `UI-SPEC-07-SystemMenu.md`).

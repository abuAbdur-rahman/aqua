# UI-SPEC-19 — Control-Tab (app switcher)

An overlay, not a window — renders above every open window, centered on screen. Registered via `tauri-plugin-global-shortcut` under Aqua's `Ctrl+Shift` prefix, fires regardless of which app inside Aqua currently has focus.

## Trigger

Hold `Ctrl+Shift`, tap `Tab` to advance selection (wraps at the end), release `Ctrl` or `Shift` to select and bring the chosen app forward. `Escape` while held cancels with no change.

Apps only, not windows — one entry per **running** app (an app with at least one open window), not one entry per window. If the selected app has more than one open window, its most-recently-focused window comes forward, matching the common single-tap "switch to previous app" use case.

## Layout

- Backdrop: ~40% black scrim behind the overlay, consistent with Spotlight's existing overlay treatment.
- Container: `--bg-overlay`, 12px corner radius, horizontal row of app icons.
- Icons: 64px squircle (matches Dock icon size), 16px gap between icons.
- Selection state: `--accent-ring` outline, icon enlarges to 72px, 120ms ease-out (matches Dock magnify's existing motion token in `DESIGN.md`).
- App name label, 13px `--text-primary`, shown below the selected icon only — not under every icon, to keep the row visually quiet until something's selected.

## Open questions / deferred

- Whether cycling order should be strict most-recent-first vs. a fixed left-to-right app order — spec assumes most-recent-first (mirrors Cmd+Tab); revisit if it feels wrong in practice.
- No mouse-click selection in v1 — keyboard-only, consistent with it being a hold-and-release interaction rather than a persistent palette.

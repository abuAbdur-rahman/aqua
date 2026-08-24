# Aqua UI Spec — Boot Greeter

The screen shown between the Tauri window appearing and the daemon actually responding — currently only exists in the plans as one risk-table line ("Splash/loading state driven by the health-check poll"). This gives it an actual design. Not a login screen — there's no auth model in this OS (`README.md`: "Access model: localhost only, no auth") — it's purely "WSL/daemon is starting, please wait," named Greeter because that's the closest real-world analogue (a distro boot greeter), not because it greets a user by identity.

Data source: none from `CONTRACT.md` — this screen exists entirely *before* the daemon is confirmed reachable. It only ever calls `GET /api/health` (already in the contract) and reports on that call's outcome.

## When it shows, exactly

Per `aqua-app-plan.md` §4 startup sequence: from the moment the Tauri window is created until step 2 or 3 of that sequence succeeds. It replaces the desktop entirely — no wallpaper, no Dock, no Menu Bar — because none of those can render meaningfully yet (Dock needs `state/layout`, wallpaper needs the wallpaper API, both need the very daemon this screen is waiting on).

## Layout

Full viewport, no window chrome at all — like Spotlight, this is the second deliberate exception to "everything is a Window Frame app."

```
                    (full viewport, --bg-base)



                        ◆  (96px Aqua glyph)

                       ● ● ●   (indeterminate pulse)

                  Checking for Aqua daemon…


```

Centered both axes. Aqua glyph (`96px`, same asset used in the System Menu's About panel and Settings' About pane — one asset, several sizes, per that existing convention) sits above a small indeterminate progress indicator — three dots, `--accent`, pulsing in sequence (not a percentage bar; there's nothing to measure a percentage against, this is a poll-until-success flow, and a fake progress bar that doesn't correspond to real progress is worse than an honest indeterminate one). Status text below in `--text-secondary`, single line, changes with the actual phase — never sits static and never lies about what's happening.

## Phase text (maps directly onto `aqua-app-plan.md` §4's numbered steps)

1. **"Checking for Aqua daemon…"** — the initial `GET /api/health` ping (step 1).
2. **"Starting WSL…"** — shown only if step 1 failed and the Tauri host is now spawning `wsl.exe -d {distro} -- ./daemon` (step 3).
3. **"Waiting for daemon to respond…"** — during the ~200ms health-poll loop (step 3).
4. On success: dots resolve into a small checkmark for ~150ms, then the whole screen cross-fades into the real desktop (reuse the window-open easing curve, `220ms cubic-bezier(0.4, 0, 0.2, 1)` — no new curve invented for this).

Every phase transition is a plain text swap, no re-layout — the glyph and dots never move, only the caption line changes, so the screen doesn't feel like it's jumping around while someone's just trying to read what's happening.

## Timeout / failure state

If the ~5s poll timeout (`aqua-app-plan.md` §4 step 3) is exceeded with no success, this screen does **not** spin forever — it switches to an explicit failure state:

```
                        ◆

                        ⚠

              Aqua daemon isn't responding

                    [ Retry ]

        wsl -d Ubuntu -- ./daemon · localhost:61234
```

Plain-language line in `--text-primary`, a single **Retry** button (`--accent`, primary) that re-runs the entire startup sequence from step 1, and one small technical line in `--text-tertiary` monospace underneath — the distro name and health-check URL actually used — because the person looking at this screen is exactly the kind of person who can fix a stuck WSL distro themselves if told what was tried, and hiding that detail behind a generic "something went wrong" would make this screen actively less useful for its own target audience.

No auto-retry loop — a screen that keeps silently re-polling forever after a real failure just looks frozen. One clear failure state, one clear manual action.

## States (this screen's own lifecycle, not the app's usual four)

This screen only ever has three states, and they're the ones above: **checking**, **waiting** (the two in-progress phase-text variants collapse into one visual state, differing only in caption), and **failed**. There's no "empty" or "populated" state here in the usual sense — replace that mental model entirely for this one screen, it doesn't apply.

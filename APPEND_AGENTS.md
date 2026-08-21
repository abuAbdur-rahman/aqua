# APPEND_AGENTS.md

Three files, three different git paths — this is what makes the collision problem structurally impossible rather than something to remember. Two agents can edit these concurrently, push and pull all day, and never produce a merge conflict between them, because none of them ever touch the same path.

| File | Who writes it | Who reads it |
|---|---|---|
| `AGENTS.md` (root) | Nobody (human-maintained) | Both agents, for orientation |
| `app/AGENTS.md` | Windows agent only | Windows agent |
| `daemon/AGENTS.md` | WSL agent only | WSL agent |

Apply these as new files (all three patches are written against an empty original) — if any of these paths already have content, paste the `+` lines onto the end instead of running `git apply` blind.

## Root — `AGENTS.md` — create this first, by hand, not via an agent

```diff
--- a/AGENTS.md
+++ b/AGENTS.md
@@ -0,0 +1,33 @@
+# AGENTS.md
+
+Root context for every agent on Aqua. Read this first, in whichever clone you're in, before touching anything. This file is deliberately short — a long list of rules gets skimmed, not followed.
+
+## What this is
+
+Aqua gives WSL Ubuntu a native, macOS-mannered desktop: a Tauri app on Windows talking to a Rust daemon inside WSL. Two repos, two agents, one shared history. Full picture in `README.md`.
+
+## Your scope
+
+You are one of two agents on this codebase:
+
+- **Windows agent** → `app/` only, rules in `app/AGENTS.md`
+- **WSL agent** → `daemon/` only, rules in `daemon/AGENTS.md`
+
+Stay inside your directory. If a task seems to need a change outside it, that's a two-sided change — say so and stop, don't make it.
+
+## Hard rules
+
+- Never edit this file. Your own rules go in your scoped `AGENTS.md`, not here.
+- Never edit `CONTRACT.md` unilaterally — it's the interface both sides depend on. Propose the change, don't just make it.
+- Never force-push, rewrite history, or touch a file outside your own scope.
+- Don't refactor, rename, or "clean up" anything you weren't asked to touch. Smallest correct diff wins.
+- Ambiguous request, or one that seems to reach past your scope? Ask. Don't guess and proceed.
+
+## Where the real instructions live
+
+| Need | File |
+|---|---|
+| Build/test commands, stack, code style | your scoped `AGENTS.md` |
+| API request/response shapes | `CONTRACT.md` |
+| Colors, spacing, motion timing | `DESIGN.md` |
+| Everything else | `README.md`, `aqua-app-plan.md`, `aqua-backend-plan.md` |
```

## Windows agent — `app/AGENTS.md`

```diff
--- a/app/AGENTS.md
+++ b/app/AGENTS.md
@@ -0,0 +1,12 @@
+
+## Aqua-specific rules (append-only, don't remove without checking CONTRACT.md/DESIGN.md still agree)
+
+- Wire format is camelCase JSON. Shapes live in `CONTRACT.md` — never invent or rename a field without updating that file in the same change.
+- WebView talks **directly** to the daemon via `fetch`/`WebSocket` at `http://localhost:61234`. Do not add Tauri IPC commands for data operations (fs, pty, sysmon, search) — Tauri commands are reserved for OS-integration only: daemon lifecycle, global hotkey, tray.
+- `tauri.conf.json`'s CSP must allow `connect-src http://localhost:61234 ws://localhost:61234`. If daemon calls silently fail with no network tab error, check this first.
+- Never hardcode `-d Ubuntu` when spawning `wsl.exe`. Query `wsl -l -v` first — the user's default distro name may differ from the one this project assumes.
+- All colors, spacing, and motion timing come from `DESIGN.md` tokens (CSS variables / Tailwind theme extension). No hardcoded hex or raw pixel values inside component files.
+- Window chrome (traffic lights, title bar) is fully custom — `decorations: false` in Tauri config. Never assume or rely on the native Windows title bar being present.
+- Debounce layout persistence writes client-side (~1s after last change) before `PUT /api/state/layout`. Never fire this on every drag frame.
+- Lazy-load Monaco on first Editor open — do not import it into the main bundle.
+- This repo builds and runs from a Windows-native path (e.g. `C:\Users\...\aqua-app\`). Never develop against a `\\wsl.localhost\...` mount — Cargo and file watchers behave badly across it.
```

## WSL agent — `daemon/AGENTS.md`

```diff
--- a/daemon/AGENTS.md
+++ b/daemon/AGENTS.md
@@ -0,0 +1,12 @@
+
+## Aqua-specific rules (append-only, don't remove without checking CONTRACT.md still agrees)
+
+- Bind `127.0.0.1` only. Never `0.0.0.0`, even temporarily for debugging.
+- Wire format is camelCase JSON — every API type gets `#[serde(rename_all = "camelCase")]`. Shapes must match `CONTRACT.md` exactly; update both in the same change.
+- `FsOp` is `#[serde(tag = "op", rename_all = "camelCase")]`. Variant names are the highest-drift-risk part of the whole contract — keep them in lockstep with `CONTRACT.md`, don't rename a variant without updating it there too.
+- Canonicalize and validate every filesystem path against allowed roots before touching disk. This is about correctness (not deleting/reading the wrong thing on a symlink or traversal bug), not access control — do it even though this is a trusted local tool.
+- Kill pty sessions on WS close plus a heartbeat timeout. Don't leave orphaned bash processes running after a client disconnects.
+- Debounce `notify` fs-watch events per-path before broadcasting over `/ws/fs-watch`. A single `git checkout` can fire hundreds of raw events — don't forward them 1:1.
+- Spotlight index updates are incremental via `notify` events. Full reindex only on explicit request or daemon startup — never trigger a full reindex from a routine fs-watch event.
+- This repo builds and runs from a WSL-native path (e.g. `~/projects/aqua-daemon/`). Never develop against the Windows-mounted equivalent of this path.
+- `GET /api/health` must exist and respond correctly before any other endpoint work — the Tauri host polls this at startup and won't show its window until it succeeds.
```

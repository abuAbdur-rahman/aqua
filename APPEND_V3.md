# APPEND_V3.md — Menu Dispatch Contract & Graceful Shutdown

Two fixes, both closing gaps the earlier docs left open rather than changing anything already working. Same append convention as `APPEND_AGENTS.md` / `APPEND_V2.md`.

---

## 1. Menu dispatch contract — fixes "menus render but don't do anything"

**Root cause:** every earlier spec described *what a menu looks like*, never *what actually fires on click*. `aqua-app-plan.md` §5 says apps register "menu bar config" with no shape given; `UI-SPEC-01-Chrome.md` says the Menu Bar "renders whatever the focused app declares" with no dispatch mechanism specified. An agent building against that has nothing concrete to bind a click handler to — this patch gives it that.

### Patch `aqua-app-plan.md` §5 — replace the vague "menu bar config" mention with a concrete shape

```ts
interface AppMenuItem {
  id: string;              // stable id, e.g. "file.save" — used for shortcut registration, not for lookup
  label: string;
  shortcut?: string;        // e.g. "Ctrl+S" — displayed in the menu AND registered as a live keybinding
  onSelect: () => void;     // the actual handler — a real closure, never a string looked up elsewhere
  enabled?: boolean;        // default true; false renders grayed-out and non-interactive, item stays visible
  separatorAfter?: boolean;
}

interface AppMenuGroup {
  label: string;   // "File", "Edit", "View", ...
  items: AppMenuItem[];
}
```

**The critical rule, stated explicitly because it's the likely actual bug:** `menus: AppMenuGroup[]` is supplied **per open window instance, not per app type.** Two Editor windows each build their own `menus` array with `onSelect` closures bound to *that window's own* file/buffer — there is no single static "Editor's menu definition" shared across every Editor window. If a window's menu array is built once at the app-type level and reused across instances, every window's Save ends up saving the wrong (or a stale) buffer — which looks exactly like "the menu doesn't do anything" from the user's side once it's wired to a dead closure.

### Patch `UI-SPEC-01-Chrome.md` §1 — dispatch mechanism

The Menu Bar's actual job, spelled out: on every focus change, read the newly-focused window's own `menus: AppMenuGroup[]` (carried on that window's entry in `windowStore`, not fetched from any app-level table) and render it directly. Clicking a rendered `AppMenuItem` calls its `onSelect()` **directly** — no string-based action registry, no lookup table in between. The simplest possible wiring is the one that can't silently drop a binding.

**Keyboard shortcuts:** on every focus change, deregister the previously-focused window's shortcut set and register the newly-focused one's, from the same `menus` array (walk every `AppMenuItem` with a `shortcut` field). A shortcut left bound to a window that's no longer focused — or never deregistered when that window closes — is the other classic version of this bug (a keystroke silently doing nothing, or doing the wrong window's action). Deregister on window close too, not just on blur.

### Patch `UI-SPEC-07-SystemMenu.md` — real command bindings

The System Menu's items split into two kinds, and only the second kind needs anything beyond a normal frontend handler:

- **Frontend-only** (no Tauri command needed): About Aqua, Settings…, Force Quit…, Sleep Display. These are pure `windowStore`/UI actions — if these specifically don't work, the bug is the same generic dispatch issue above, not something special to the System Menu.
- **Real Tauri commands** (these did not exist as named commands anywhere in the plan before this patch — if they were never implemented, this is the whole reason those three items do nothing):

```rust
#[tauri::command]
async fn restart_daemon() -> Result<(), String> { /* see §2 below — graceful shutdown, then respawn */ }

#[tauri::command]
async fn relaunch_aqua() -> Result<(), String> { /* graceful daemon shutdown, then app relaunch */ }

#[tauri::command]
async fn quit_and_stop_daemon() -> Result<(), String> { /* graceful daemon shutdown, then app quit */ }
```

Frontend calls these via `invoke("restart_daemon")` etc. (`@tauri-apps/api/core`). **Restart Daemon**, **Restart Aqua**, and **Shut Down Aqua** in the System Menu bind to these three specifically — nowhere else in the plan defined these command names before, so if they were never added on the Rust side, clicking those three items was always going to be a no-op regardless of how correct the frontend click handling was.

---

## 2. Graceful daemon shutdown — fixes the "way to shut down" gap

**What was missing:** nothing in `CONTRACT.md` or `aqua-backend-plan.md` ever specified *how* the daemon stops. The System Menu spec assumed "the Tauri host kills the child process," but the daemon is what's supposed to clean up pty child processes on disconnect (`aqua-backend-plan.md` §11 risk table) — force-killing the daemon's own OS process skips that cleanup entirely, so a hard kill can leave orphaned bash processes running inside WSL after "Shut Down Aqua." This adds the missing graceful path.

### Patch `CONTRACT.md` — add to the System section from `APPEND_V2.md`

```ts
type ShutdownResponse = { success: true };
```

`POST /api/system/shutdown` — no body. The daemon stops accepting new connections, closes every active pty session cleanly (SIGTERM to each shell child, brief grace period, SIGKILL anything still alive after it — the same cleanup `/ws/pty` disconnect already does, just invoked proactively here instead of reactively), closes WS connections, flushes pending SQLite writes, then exits its own process. The HTTP response fires immediately on receipt (`{ success: true }` means "shutdown started," not "shutdown complete") — the caller (Tauri host) confirms actual completion by polling for the child process to exit, not by anything in this response.

### Patch `aqua-backend-plan.md` §6 — add row

| Path | Type | Purpose |
|---|---|---|
| `POST /api/system/shutdown` | REST | Graceful shutdown — close pty sessions cleanly, flush state, then exit |

### Patch `aqua-backend-plan.md` §9 Security model — add

- `POST /api/system/shutdown` has no confirmation step of its own at the daemon level — the confirmation already happens once, at the UI layer (`UI-SPEC-08-Modals.md`'s Confirmation Modal), before this call is ever made. The daemon executes it unconditionally on receipt.

### Patch the three Tauri commands from §1 above — actual sequence

```
restart_daemon:
  1. POST http://localhost:61234/api/system/shutdown
  2. poll: wait for the child process to exit, OR up to ~3s
  3. if still alive after ~3s, force-kill the process (last resort, not the default path)
  4. respawn `wsl.exe -d {distro} -- ./daemon`, poll /api/health same as first launch

relaunch_aqua:
  1–3. same graceful-shutdown-then-force-kill-fallback sequence as restart_daemon
  4. relaunch the Tauri application itself (which re-runs its own startup sequence, respawning the daemon fresh)

quit_and_stop_daemon:
  1–3. same graceful-shutdown-then-force-kill-fallback sequence
  4. quit the Tauri application — do NOT respawn anything afterward (this is the one path that intentionally ends with nothing running)
```

The force-kill fallback stays in all three — a hung daemon that never exits shouldn't be able to block the user from restarting or quitting — but it's now explicitly the *fallback*, not the *only* mechanism, which is what fixes the orphaned-process risk.

### Patch `aqua-backend-plan.md` §11 Risks — add row

| Risk | Mitigation |
|---|---|
| Hard-killing the daemon process (bypassing graceful shutdown) leaves orphaned pty child processes in WSL | Tauri host always attempts `POST /api/system/shutdown` first and gives it a short grace period before falling back to a force-kill; force-kill is the exception path, not the default |

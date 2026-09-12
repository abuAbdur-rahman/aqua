# Daemon Deploy — Follow-up for the Windows (app) Agent

> Status: **WSL side is done and verified.** The daemon is now a persistent
> `systemd` **user service**, not a process the Tauri host spawns per launch.
> This file tells the Windows agent exactly what changed and what to migrate.
>
> Source of truth for the WSL/deploy side: `daemon/deploy/README.md`.

## What changed (the lifecycle model)

| Before                                                        | After                                                            |
| ------------------------------------------------------------- | ---------------------------------------------------------------- |
| Tauri host shells out `wsl.exe -d <distro> -- cargo run …` on every launch | Daemon is a `systemd --user` service, auto-started via linger    |
| Build happens at app-launch time (slow first start, recompile) | Built once at install; service runs the installed binary         |
| App owns a `std::process::Child` it can force-kill            | App does not own the process; `systemctl --user` owns it         |
| Dies when WSL session ends unless a terminal stays open       | Survives session end (`loginctl enable-linger`, `Linger=yes`)   |

The **wire contract is unchanged**: still `http://localhost:61234` and
`ws://localhost:61234`, still `GET /api/health` and `POST /api/system/shutdown`.
Only *how the process comes alive* changed.

## Deployed facts (WSL side)

- Service: `aqua-daemon.service` (user systemd). Unit file:
  `daemon/deploy/aqua-daemon.service` → installed to
  `~/.config/systemd/user/aqua-daemon.service`, enabled in `default.target.wants`.
- Binaries: `~/.local/bin/aqua-daemon` and `~/.local/bin/aqua-daemon-helper`
  (**must stay in the same dir** — helper resolves itself relative to the
  daemon executable, see `daemon/src/system.rs:26-32`).
- Port: `127.0.0.1:61234` (unchanged).
- `Restart=on-failure`, `RestartSec=2`; `HOME` is the filesystem root.
- Linger: `loginctl show-user $USER -p Linger` → `yes`.
- Elevation helper: `/etc/sudoers.d/aqua-daemon-helper` grants
  `<user> ALL=(root) NOPASSWD: <home>/.local/bin/aqua-daemon-helper`
  (helper is invoked as `sudo -n`, `daemon/src/system.rs:124-125`). Rule is
  scoped to the helper binary only — verified.
- Install path (re-run to rebuild): `bash daemon/deploy/install.sh`.

## What the app must change (`app/src-tauri/src/lib.rs`)

All line numbers are from the current `app/src-tauri/src/lib.rs` at time of
writing; re-grep if the file has moved.

1. **`spawn_daemon` (lib.rs:83-97)** — replace the spawn command:
   ```rust
   // before
   wsl.exe -d <distro> -- cargo run --release --manifest-path <dir>/Cargo.toml
   // after
   wsl.exe -d <distro> -- systemctl --user start aqua-daemon.service
   ```
   Keep it **idempotent**: `start` is a no-op if already running.

2. **`resolve_daemon_dir` + `AQUA_DAEMON_DIR` (lib.rs:52-81)** — no longer needed
   to *start* the unit (the unit's `ExecStart` already knows the path). You may
   keep the dir probe for diagnostics/Settings display, but the `whoami`/`test -d`
   WSL probes and the env override are unnecessary for launch. Safe to delete
   from the spawn path.

3. **`discover_default_distro` (lib.rs:31-47)** — **keep**. You still need the
   distro name to target `wsl.exe -d <distro> -- systemctl --user …`. (Do not
   hardcode `-d Ubuntu`; AGENTS rule.)

4. **`DaemonChild` / `store_child` state (lib.rs:17, 136-145, 382)** — the app no
   longer owns a `Child`. The force-kill fallback (lib.rs:129-132, 140-143) is
   dead against a service. Repurpose or remove; do not kill a service process.

5. **`stop_daemon` (lib.rs:118-134)** — under the persistent model the app should
   generally **not** kill the daemon. Quitting Aqua should leave the service
   running (matches the existing doc rule "leave the daemon running when Aqua
   exits"; `CloseRequested` at lib.rs:421-425 already does not stop it). If an
   explicit Stop is still wanted it becomes:
   ```rust
   wsl.exe -d <distro> -- systemctl --user stop aqua-daemon.service
   ```
   The graceful `POST /api/system/shutdown` path can stay, but must NOT be
   followed by a process kill.

6. **`restart_daemon` (lib.rs:175-190)** →
   `wsl.exe -d <distro> -- systemctl --user restart aqua-daemon.service`
   (drop the `resolve_daemon_dir` + `spawn_daemon` re-shell).

7. **`restart_wsl_distro` (lib.rs:218-244)** — `wsl --terminate <distro>` stops the
   unit with the distro; afterwards `systemctl --user start aqua-daemon.service`
   again (or rely on linger to bring it back). Drop the `spawn_daemon` re-shell.

8. **`wait_for_health` (lib.rs:99-112) / `start_daemon` guard (lib.rs:161-172)** —
   **keep as-is**. The health-first guard (`wait_for_health(app,1,0)` → spawn only
   if down) now becomes "start the service only if health fails", which is
   correct. You can reduce the long retry windows (lib.rs:187/241 used 100×200ms
   to absorb `cargo` recompile) since systemd start is fast; optional.

9. **`relaunch_aqua` / `quit_and_stop_daemon` (lib.rs:193-206)** — `quit_and_stop`
   must stop calling shutdown-kill; quitting should leave the service up.

## Docs to update on the app side

These currently describe `wsl.exe -d {distro} -- ./daemon` / `cargo run` and
must be rewritten to "ensure/connect to the systemd user service":
`app/PLAN.md:37,55,64,205`, `app/Phases/0.md:36-38`, `APPEND_V3.md:88`,
`app/AGENTS.md:12`, and `app/design/UI-SPEC-07-SystemMenu.md` /
`UI-SPEC-11-Greeter.md`. Note existing docs already contradict the code
(`PLAN.md` says a prebuilt `./daemon`, code does `cargo run`) — fix both.

`CONTRACT.md` needs **no** change: it defines only wire shapes, which are
unchanged.

## Verification the app agent can run

```bash
# from Windows, after migrating spawn_daemon:
wsl.exe -d <distro> -- systemctl --user is-active aqua-daemon.service   # active
curl.exe http://localhost:61234/api/health                              # {"status":"ok",...}
```
And the existing `/api/health` poll in `wait_for_health` should return `200`
immediately because linger already has the service up.

## Open items (left to the Windows agent)

- [ ] Migrate `spawn_daemon` → `systemctl --user start` (item 1 above).
- [ ] Decide whether to keep `resolve_daemon_dir`/`AQUA_DAEMON_DIR` for diagnostics.
- [ ] Remove dead `DaemonChild` force-kill paths (items 4, 5).
- [ ] Update `stop_daemon`/`restart_daemon`/`restart_wsl_distro`/`quit_and_stop`.
- [ ] Update the docs listed above.
- [ ] Optional: trim `wait_for_health` retry windows now that there's no compile.

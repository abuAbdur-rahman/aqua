# Daemon deployment (WSL user service)

The daemon is no longer run from a project checkout via `cargo run`. It is
installed as a per-user `systemd` service that owns its own lifecycle, so the
Windows Tauri host only needs to *talk* to it (and start it if it is down),
never build or spawn it.

## Install

From a WSL-native checkout (never `/mnt/c` or a `\\wsl.localhost\` mount):

```bash
cd ~/projects/Self/aqua/daemon
bash deploy/install.sh
```

This:
1. `cargo build --release`
2. installs `aqua-daemon` and `aqua-daemon-helper` into `~/.local/bin`
   (both must stay in the same directory — the helper resolves itself relative
   to the daemon executable, see `src/system.rs`).
3. drops `~/.config/systemd/user/aqua-daemon.service`
4. `loginctl enable-linger "$USER"` so the service survives session end (needs
   sudo; skipped with a warning if unavailable)
5. writes `/etc/sudoers.d/aqua-daemon-helper` granting
   `<user> ALL=(root) NOPASSWD: ~/.local/bin/aqua-daemon-helper`, and chowns the
   helper to root:root (the helper is invoked as `sudo -n`, so NOPASSWD is
   required or elevation fails — see `src/system.rs`)
6. `systemctl --user daemon-reload && systemctl --user enable --now aqua-daemon.service`
   (needs the user manager running; on WSL this requires `systemd=true` under
   `[boot]` in `/etc/wsl.conf`, which is already the case since `systemctl` works)

The unit binds to `127.0.0.1:61234`, uses `HOME` as the filesystem root, and
restarts on failure. `Restart=on-failure` keeps the daemon alive across crashes.

> Steps 4–5 run via `sudo` and are best-effort: if `sudo` is unavailable the
> install still completes, but the daemon will not survive session end and
> elevated filesystem operations will fail until those are done manually.

## Linger and sudoers (auto-applied by install.sh)

`install.sh` enables linger and provisions the sudoers rule for you. If you ran
an older install or skipped sudo, apply them manually:

```bash
sudo loginctl enable-linger "$USER"
echo "$USER ALL=(root) NOPASSWD: $HOME/.local/bin/aqua-daemon-helper" | sudo tee /etc/sudoers.d/aqua-daemon-helper
sudo chmod 0440 /etc/sudoers.d/aqua-daemon-helper
sudo chown root:root "$HOME/.local/bin/aqua-daemon-helper"
sudo chmod 0755 "$HOME/.local/bin/aqua-daemon-helper"
```

## Manual control

```bash
systemctl --user status aqua-daemon.service
systemctl --user restart aqua-daemon.service
systemctl --user stop aqua-daemon.service
journalctl --user -u aqua-daemon.service -f
```

## Required change on the app side (Windows agent owns `app/`)

`app/src-tauri/src/lib.rs` currently spawns the daemon with
`wsl.exe -d <distro> -- cargo run --release --manifest-path <dir>/Cargo.toml`
(`spawn_daemon`, lines 83-97). Once this service exists, replace that spawn path
with starting the installed user service:

```rust
Command::new("wsl.exe")
    .args(["-d", distro, "--", "systemctl", "--user", "start", "aqua-daemon.service"])
    .status()
```

and keep the existing health poll (`wait_for_health`) against
`http://localhost:61234/api/health`. `restart_daemon` should call
`systemctl --user restart aqua-daemon.service`; `stop_daemon` can keep POSTing
`/api/system/shutdown` (the daemon exits and `Restart=on-failure` will not
re-trigger because the unit's process exited cleanly — verify this behavior).
The distro directory probe (`resolve_daemon_dir`) and `AQUA_DAEMON_DIR` are no
longer needed for the spawn path and can be removed, but `discover_default_distro`
is still required to pick the right WSL distro.

## Lifecycle model (write this down on the app side too)

The daemon is now a **persistent systemd user service**, not a process the Tauri
host spawns per launch. The app's launch logic (`aqua-app-plan.md` §4:
`wsl.exe -d Ubuntu -- ./daemon` + health-poll, "no relaunch if already running")
still works because the existing health-check-first path becomes a no-op when the
service is already up — but the *how* changed (systemd-managed vs. Tauri-spawned).
To stop a future Windows-agent "fix" that re-adds the spawn logic, append a note
to the root `README.md` / `aqua-backend-plan.md` documenting this `deploy/`
systemd path as the Phase-6-and-later lifecycle model. (Left to the Windows agent
to record in the shared docs — out of WSL scope.)

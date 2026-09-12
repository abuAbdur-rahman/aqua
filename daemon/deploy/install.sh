#!/usr/bin/env bash
# Install the Aqua daemon and its elevation helper as a per-user systemd service.
#
# Builds the release binaries, copies aqua-daemon + aqua-daemon-helper into
# ~/.local/bin, drops a user unit into ~/.config/systemd/user, enables lingering
# so the service survives session end, provisions a NOPASSWD sudoers rule for the
# elevation helper (it is invoked via `sudo -n`, see src/system.rs), then enables
# and restarts the service. The daemon uses HOME as its filesystem root and
# resolves the helper relative to its own executable, so both land in one dir.
#
# Requires: a Rust toolchain, and `sudo` for the linger + sudoers steps. If sudo
# is unavailable those steps are skipped with a warning — the daemon still runs,
# but elevation and/or unattended survival will not work until run manually.
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
DAEMON_DIR="$(cd -- "$SCRIPT_DIR/.." >/dev/null 2>&1 && pwd)"
BIN_DIR="${HOME}/.local/bin"
UNIT_DIR="${HOME}/.config/systemd/user"
UNIT_NAME="aqua-daemon.service"
TARGET="${UNIT_DIR}/${UNIT_NAME}"

echo "Building release binaries from ${DAEMON_DIR}"
cargo build --release --manifest-path "${DAEMON_DIR}/Cargo.toml"

mkdir -p "$BIN_DIR" "$UNIT_DIR"

echo "Installing binaries to ${BIN_DIR}"
install -m 0755 "${DAEMON_DIR}/target/release/aqua-daemon" "${BIN_DIR}/aqua-daemon"
install -m 0755 "${DAEMON_DIR}/target/release/aqua-daemon-helper" "${BIN_DIR}/aqua-daemon-helper"

echo "Installing systemd user unit to ${TARGET}"
install -m 0644 "${SCRIPT_DIR}/${UNIT_NAME}" "$TARGET"

# Linger so the user service keeps running after the WSL session ends. On WSL
# there is no login manager to start the user instance automatically, so this
# is required for unattended operation. Best-effort: needs sudo.
if command -v loginctl >/dev/null 2>&1; then
  if sudo loginctl enable-linger "$USER" 2>/dev/null; then
    echo "Linger enabled for ${USER}"
  else
    echo "WARN: could not enable linger (needs sudo). The daemon may stop when the WSL session ends. Run 'loginctl enable-linger $USER' manually."
  fi
else
  echo "WARN: loginctl not found; enable lingering manually if your system supports it."
fi

# Elevation helper is invoked as `sudo -n <helper>` (src/system.rs). NOPASSWD is
# required or the first elevated fs call fails with 'a password is required'.
# The helper must not be writable by non-root or this grant is unsafe.
SUDOERS_FILE="/etc/sudoers.d/aqua-daemon-helper"
if echo "${USER} ALL=(root) NOPASSWD: ${BIN_DIR}/aqua-daemon-helper" | sudo tee "$SUDOERS_FILE" >/dev/null 2>&1; then
  sudo chmod 0440 "$SUDOERS_FILE"
  sudo chown root:root "${BIN_DIR}/aqua-daemon-helper"
  sudo chmod 0755 "${BIN_DIR}/aqua-daemon-helper"
  echo "Provisioned NOPASSWD sudoers rule for ${BIN_DIR}/aqua-daemon-helper"
else
  echo "WARN: could not write ${SUDOERS_FILE} (needs sudo). Elevated filesystem operations will fail until a NOPASSWD rule is added manually."
fi

echo "Reloading and enabling ${UNIT_NAME}"
systemctl --user daemon-reload
systemctl --user enable --now "$UNIT_NAME"

echo "Installed. Status:"
systemctl --user status "$UNIT_NAME" --no-pager || true

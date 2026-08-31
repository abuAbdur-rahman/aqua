#!/usr/bin/env bash
# Install the Aqua daemon from a GitHub Release tarball — no Rust toolchain needed.
#
# Static musl binary (glibc-free): works on any WSL Ubuntu 20.04/22.04/24.04.
# Reuses the same placement/linger/sudoers logic as deploy/install.sh, but
# skips `cargo build`. The tarball must contain `aqua-daemon` + `aqua-daemon-helper`
# (as produced by .github/workflows/daemon-release.yml).
#
# Usage:
#   bash daemon/deploy/install-from-release.sh [TAG|URL]   # TAG like v0.1.0, or full https:// URL
#   bash daemon/deploy/install-from-release.sh             # auto-detect latest tag via GitHub API
#   AQUA_DAEMON_TARBALL=/tmp/aqua-daemon-*.tar.gz bash daemon/deploy/install-from-release.sh --local
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
BIN_DIR="${HOME}/.local/bin"
UNIT_DIR="${HOME}/.config/systemd/user"
UNIT_NAME="aqua-daemon.service"
TARGET="${UNIT_DIR}/${UNIT_NAME}"
REPO="abuAbdur-rahman/aqua"

resolve_tag() {
  if [ $# -eq 0 ] || [ -z "${1:-}" ]; then
    # latest release tag via API (no auth, rate-limited but fine for manual runs)
    curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" | grep -m1 '"tag_name"' | cut -d'"' -f4
  elif [[ "$1" == https://* ]]; then
    echo "$1"
  else
    echo "$1"
  fi
}

TARBALL_URL=""
LOCAL_TARBALL="${AQUA_DAEMON_TARBALL:-}"

if [ "${1:-}" = "--local" ]; then
  if [ -z "$LOCAL_TARBALL" ] || [ ! -f "$LOCAL_TARBALL" ]; then
    echo "ERROR: --local requires AQUA_DAEMON_TARBALL=/path/to/tar.gz" >&2
    exit 1
  fi
else
  RESOLVED="$(resolve_tag "${1:-}")"
  if [[ "$RESOLVED" == https://* ]]; then
    TARBALL_URL="$RESOLVED"
  else
    TAG="$RESOLVED"
    if [ -z "$TAG" ]; then
      echo "ERROR: could not resolve tag (no releases? pass TAG like v0.1.0 or a URL)" >&2
      exit 1
    fi
    TARBALL_URL="https://github.com/${REPO}/releases/download/${TAG}/aqua-daemon-${TAG}-linux-x86_64-musl.tar.gz"
  fi
  LOCAL_TARBALL="$(mktemp /tmp/aqua-daemon-XXXXXX.tar.gz)"
  echo "Downloading ${TARBALL_URL}"
  curl -fsSL -o "$LOCAL_TARBALL" "$TARBALL_URL"
  # optional checksum if .sha256 is published alongside
  if curl -fsSL -o "${LOCAL_TARBALL}.sha256" "${TARBALL_URL}.sha256" 2>/dev/null; then
    (cd "$(dirname "$LOCAL_TARBALL")" && sha256sum -c "$(basename "${LOCAL_TARBALL}.sha256")") && echo "Checksum OK" || echo "WARN: checksum mismatch — continuing"
  fi
fi

mkdir -p "$BIN_DIR" "$UNIT_DIR"

echo "Extracting to ${BIN_DIR}"
tar xzf "$LOCAL_TARBALL" -C "$BIN_DIR"
chmod 0755 "${BIN_DIR}/aqua-daemon" "${BIN_DIR}/aqua-daemon-helper"

echo "Installing systemd user unit to ${TARGET}"
install -m 0644 "${SCRIPT_DIR}/${UNIT_NAME}" "$TARGET"

if command -v loginctl >/dev/null 2>&1; then
  if sudo loginctl enable-linger "$USER" 2>/dev/null; then
    echo "Linger enabled for ${USER}"
  else
    echo "WARN: could not enable linger (needs sudo). Run 'loginctl enable-linger $USER' manually."
  fi
else
  echo "WARN: loginctl not found; enable lingering manually if your system supports it."
fi

SUDOERS_FILE="/etc/sudoers.d/aqua-daemon-helper"
if echo "${USER} ALL=(root) NOPASSWD: ${BIN_DIR}/aqua-daemon-helper" | sudo tee "$SUDOERS_FILE" >/dev/null 2>&1; then
  sudo chmod 0440 "$SUDOERS_FILE"
  sudo chown root:root "${BIN_DIR}/aqua-daemon-helper"
  sudo chmod 0755 "${BIN_DIR}/aqua-daemon-helper"
  echo "Provisioned NOPASSWD sudoers rule for ${BIN_DIR}/aqua-daemon-helper"
else
  echo "WARN: could not write ${SUDOERS_FILE} (needs sudo). Elevated ops will fail until added manually."
fi

echo "Reloading and enabling ${UNIT_NAME}"
systemctl --user daemon-reload
systemctl --user enable --now "$UNIT_NAME"

echo "Installed. Status:"
systemctl --user status "$UNIT_NAME" --no-pager || true

# cleanup temp download if we created it
if [[ "${TARBALL_URL}" != "" ]] && [[ "$LOCAL_TARBALL" == /tmp/aqua-daemon-* ]]; then
  rm -f "$LOCAL_TARBALL" "${LOCAL_TARBALL}.sha256"
fi

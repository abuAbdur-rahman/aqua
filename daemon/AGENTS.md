# WSL Daemon Agent Instructions

This directory owns Aqua's WSL Ubuntu backend. Work here is for the Rust/Axum daemon, not the Windows Tauri host or React frontend.

## Source of truth

Read these root documents before changing backend behavior:

- `../README.md` – product scope and cross-platform architecture
- `PLAN.md` – daemon architecture and roadmap
- `../CONTRACT.md` – authoritative wire shapes
- `../DESIGN.md` – frontend-only unless backend behavior explicitly depends on it
- `Phases/` – phase-specific implementation and verification requirements

If implementation and `../CONTRACT.md` disagree, stop and resolve the contract deliberately. Do not silently make either side conform.

## Backend boundaries

- Run and build the daemon from a WSL-native Linux path, never `/mnt/c` or a `\\wsl.localhost\` mount.
- Bind only to `127.0.0.1`. Never bind to `0.0.0.0`, including during debugging.
- Keep OS data operations in the daemon. Do not add React UI or Windows/Tauri host code under `daemon/`.
- Use camelCase JSON. Rust API types must use the appropriate Serde renaming attributes.
- Keep route names and payloads synchronized with `../CONTRACT.md`.
- Treat the daemon as security-sensitive: it will eventually control files and unrestricted PTY sessions.
- Do not implement filesystem mutation until allowed roots, traversal handling, and symlink behavior are explicitly defined.
- Do not treat CORS or localhost binding as authentication. Authentication and Origin policy require an explicit project decision before privileged endpoints ship.

## Implementation rules

- Complete phases in dependency order. Start with `Phases/0.md`.
- Keep `main.rs` focused on startup and router assembly; put reusable behavior in modules.
- Return structured errors without exposing unnecessary internal details.
- Use structured logging through `tracing`; do not rely on scattered `println!` calls.
- Do not hardcode user-specific absolute paths.
- Do not add crates without confirming their purpose and license.
- Do not leave placeholder comments or incomplete handlers.
- Do not suppress compiler or linter diagnostics without a nearby explanation of why the suppression is necessary.

## Verification

Before reporting a backend change complete, run the checks supported by the current project, including at minimum once the crate exists:

```bash
cargo fmt --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test --all-features
```

Run these commands from `daemon/`. From the repository root, pass `--manifest-path daemon/Cargo.toml`. Also exercise affected HTTP/WebSocket behavior with integration tests or an explicit local smoke test. Windows-to-WSL reachability must be verified from Windows and must not be inferred from a Linux-only test.

## Contract changes

A change to an endpoint, route parameter, JSON field, enum variant, WebSocket frame, or error shape must update `../CONTRACT.md` in the same change. Use `sessionId`, not `session_id`, for the PTY route parameter and JSON-facing terminology unless the contract is deliberately revised.

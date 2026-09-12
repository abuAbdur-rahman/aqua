# Contributing to Aqua

## Workstream ownership

Aqua has two independently buildable workstreams:

- `app/` – Windows-native Tauri host and React UI. Build and test from a native Windows checkout.
- `daemon/` – WSL-native Rust/Axum backend. Build and test from a Linux/WSL checkout.

Keep changes inside the workstream they belong to. Coordinate before changing `CONTRACT.md`, `DESIGN.md`, root architecture documents, or both sides of an API boundary.

The current handoff is complete Backend Phase 4 Spotlight search to App Phase 6 Spotlight UI. The app should consume the existing `GET /api/search?q=` contract rather than adding a parallel search path.

## Before opening a change

Fetch the latest `master` and work from a feature branch. Do not develop across a `\\wsl.localhost` mount. Read the relevant `AGENTS.md`, phase document, and `CONTRACT.md` sections before editing.

Run the checks for the files you changed:

```bash
# App, from the repository root
pnpm -C app install --frozen-lockfile
pnpm -C app test
pnpm -C app build
cargo check --manifest-path app/src-tauri/Cargo.toml

# Daemon, from the repository root
cargo fmt --manifest-path daemon/Cargo.toml -- --check
cargo clippy --manifest-path daemon/Cargo.toml --all-targets --all-features -- -D warnings
cargo test --manifest-path daemon/Cargo.toml --all-features
```

The same checks run in [`.github/workflows/ci.yml`](./.github/workflows/ci.yml). App CI uses Node 24 and pnpm 11.6.0.

## Commit rules

Use Conventional Commits with a short subject of 50 characters or fewer:

```text
feat(app): add spotlight results
fix(daemon): debounce search updates
test: cover search recovery
docs: update phase handoff
ci: update workflow
```

Keep commits focused. Do not mix generated output, dependency churn, unrelated cleanup, or app and daemon implementation changes unless the interface change requires both. Explain the reason in the body when the subject is not enough.

## Pull requests

- Target `master`.
- Describe the behavior changed and the phase it advances.
- List the commands run and their results.
- Call out contract, security, performance, or platform implications.
- Include screenshots for visible UI changes.
- Keep reviewable commits when practical.

The `Protect master` ruleset requires pull requests, one approving review, resolved review threads, and successful `Daemon checks` and `App checks`. Force-push and branch deletion are disabled. The repository owner is the sole administrative bypass actor.

## Runtime verification

Unit and build checks are necessary but do not replace boundary testing. Backend endpoint changes should include a clean daemon smoke test, resource sampling when background work changes, and confirmation that the daemon is stopped afterward. App changes that consume daemon APIs must be verified from Windows against `localhost:61234`; WSL-local success does not prove Windows reachability.

# Windows App Agent Instructions

This directory owns Aqua's Windows desktop app. Work here covers the Tauri Rust host and React frontend under `app/src-tauri/` and `app/frontend/`.

Read the root `../AGENTS.md`, `../README.md`, `../aqua-app-plan.md`, `../CONTRACT.md`, and `../DESIGN.md` before implementation.

## App boundaries

- Build from a Windows-native checkout path, never a `\\wsl.localhost\` mount.
- The WebView talks directly to the daemon at `http://localhost:61234` using `fetch` and WebSocket.
- Do not add Tauri IPC commands for filesystem, PTY, sysmon, search, or persistence data operations. Reserve Tauri commands for daemon lifecycle and OS integration: global shortcut, tray, and native window behavior.
- Never hardcode `-d Ubuntu` when spawning WSL. Query `wsl -l -v` and select the configured or default distro deliberately.
- Configure CSP to allow `http://localhost:61234` and `ws://localhost:61234`.
- Keep custom window chrome with `decorations: false`.
- Use `DESIGN.md` CSS variables and Tailwind tokens. Do not hardcode colors or component dimensions.
- Debounce layout persistence writes around one second after the last change, never once per drag frame.
- Lazy-load Monaco when the editor first opens.

## Contract rules

- Wire format is camelCase JSON.
- Keep routes, fields, enum variants, WebSocket frames, and error shapes synchronized with `../CONTRACT.md`.
- Use `sessionId`, not `session_id`, for PTY route and JSON-facing terminology unless the shared contract is deliberately changed.

## Verification

Run the frontend and Tauri checks defined by the actual package manifests after they exist. Verify daemon health and WebSocket connectivity from Windows separately; do not infer Windows-to-WSL reachability from WSL-local tests.

## Local implementation notes (app agent)

- Package manager is **pnpm** (`packageManager: pnpm@11.6.0`). Run all frontend commands with `pnpm -C app ...`. Lockfile is `app/pnpm-lock.yaml`; `app/pnpm-workspace.yaml` allowlists `esbuild` for `onlyBuiltDependencies`.
- UI stack: **Tailwind CSS v4** via `@tailwindcss/vite` (`@import "tailwindcss"` + CSS-first `@theme` in `app/src/App.css` mapping `DESIGN.md` tokens), **react-icons** as the sole icon library (no emoji/handwritten SVG/second library), Inter + JetBrains Mono.
- Vite project lives at `app/` (not `app/frontend/`); `app/src-tauri/tauri.conf.json` `frontendDist` is `../dist`. If the team later moves vite to `app/frontend/`, update `frontendDist`, `beforeDevCommand`/`beforeBuildCommand`, and this file in one commit.
- Actual phase specs for this workstream are `app/Phases/0.md`–`8.md`; `0.md` is the source of truth for Phase 0 scaffold/lifecycle/CSP/port.
- Daemon port is `61234` everywhere (`app/src/lib/api.ts`, `app/src-tauri/tauri.conf.json` CSP, `app/src-tauri/src/lib.rs` health poll). Do not reintroduce `8080`.
- Windows checkout path for this clone is `D:\Self\aqua\app\` (app agent cwd). Do not edit `daemon/`; the WSL agent owns it and `daemon/AGENTS.md`.

# Ubuntu Backend Phases

These files expand the backend roadmap from `../../README.md` and `../PLAN.md` into implementation-ready scopes and acceptance criteria.

| Phase | File | Deliverable |
|---|---|---|
| 0 – Scaffold | [`0.md`](./0.md) | Rust/Axum daemon, health endpoint, WebSocket echo, Windows reachability foundation |
| 1 – Finder backend | [`1.md`](./1.md) | Safe filesystem read/CRUD/write APIs and debounced filesystem watching |
| 2 – Terminal backend | [`2.md`](./2.md) | PTY session manager, spawn API, WebSocket bridge, resize and cleanup |
| 3 – Activity Monitor | [`3.md`](./3.md) | Shared `sysinfo` polling and live stats WebSocket |
| 4 – Spotlight | [`4.md`](./4.md) | Tantivy indexing, incremental updates, search and quick actions |
| 5 – Persistence | [`5.md`](./5.md) | SQLite migrations and layout GET/PUT API |
| 6 – Hardening | [`6.md`](./6.md) | Authentication/Origin enforcement, path audit, lifecycle and reliability review |
| 7 – Elevation | [`7.md`](./7.md) | Sudo-validated elevation cache, `needsElevation` retries, single-shot privileged helper binary |
| 8 – Wallpaper | [`8.md`](./8.md) | Custom wallpaper uploads, thumbnails, selection persistence, asset serving |

## Working order

Complete Phase 0 first. After that, coordinate backend phases with their app consumers in the alternating order documented in the root README. A phase is complete only when its acceptance criteria have concrete test or command evidence.

The detailed wire format remains owned by `../../CONTRACT.md`. If a phase file and the contract disagree, resolve and update the documentation deliberately before implementation.

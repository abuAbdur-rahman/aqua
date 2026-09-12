# Aqua UI Spec — Activity Monitor

Data source: `WS /ws/sysmon`, pushed ~1/sec (`SysmonStats`, nesting `DiskStat[]` / `ProcessStat[]`). Read-only — no kill/renice endpoint exists (`../../daemon/PLAN.md` §1 locked scope), so this spec has no destructive actions to design around. Shapes: `CONTRACT.md` §Activity Monitor.

## Layout

```
┌─────────────────────────────────────────────┐
│ ●●●        Activity Monitor                  │
├───────────────┬───────────────┬─────────────┤
│  CPU  42%      │  Memory 6.1/16GB│ Disk  212GB │
│  ▁▃▅▇▆▄▃▂▁▃▅▇  │  ▓▓▓▓▓░░░░░    │ / 512GB     │
├───────────────┴───────────────┴─────────────┤
│  Process          CPU%    Memory              │
│  node (npm dev)    18.2%   340 MB              │
│  rust-analyzer      9.1%   612 MB              │
│  bash                0.1%    4 MB              │
└─────────────────────────────────────────────┘
```

**Top row — three stat cards** (CPU, Memory, Disk), each a `--bg-elevated` card (`8px` radius per `DESIGN.md` card token), equal width. Not a dashboard-grid of a dozen tiny widgets — three cards, generous, legible at a glance, matching the "Activity Monitor is read-only, keep it calm" scope.

- **CPU card:** big number (`cpuPercent`, rounded to whole %) in `--text-primary`, small sparkline underneath — a rolling strip chart built client-side from the last ~60 pushes (the daemon doesn't send history, only the current sample, so history is local state accumulated client-side, capped at 60 points ≈ 1 minute).
- **Memory card:** `memUsed / memTotal` as text, plus a single horizontal bar (`--accent` fill up to the used fraction, `--bg-hover` track) — simpler than CPU's sparkline on purpose, memory doesn't need a time-series to be readable, a bar plus the raw numbers is enough.
- **Disk card:** one card per mount if `disks.length > 1` (horizontally scrollable strip of cards in that case), otherwise the single mount fills the card width. Same bar treatment as Memory for consistency.

Bar/sparkline color shifts at thresholds using the existing semantic tokens, not new ones: `--accent` under 70%, `--status-warning` 70–90%, `--status-danger` above 90% — this is the one place in the OS where a "normal" element (a stat bar) is allowed to escalate to a status color, because that escalation *is* the information Activity Monitor exists to show.

**Bottom — process table**, sourced from `processes: ProcessStat[]`. Columns: Process name, CPU%, Memory (bytes formatted to human units). Sortable by any column (defaults to CPU% descending — that's almost always what someone opened this app to find). Table re-sorts smoothly on each ~1s push rather than jump-cutting: animate row position changes over the same interval as the push cadence, capped so it never fights the next incoming sample.

No search/filter row in v1 — this app's whole point is "glance at the top," a filter box would be scope creep beyond what's actually planned.

## States

**Loading** (WS not yet delivered a first `SysmonStats`): all three cards show a flat `--bg-hover` skeleton bar in place of the number/chart, process table shows 4 skeleton rows. No numbers guessed at zero — a `0%` CPU reading during load looks like a real (misleading) measurement, a skeleton doesn't.

**Populated:** as wireframe above — this is effectively the only state that matters day-to-day, since "empty" isn't really meaningful for a stats view (there's always at least the daemon's own process) and this data doesn't 404.

**Disconnected** (WS drops): cards freeze on their last known values but desaturate slightly (drop to ~60% opacity) with a small "Last updated Xs ago" caption under the card row — stale-but-visible beats blank, since "the machine was last known to be at 42% CPU" is still useful context while reconnecting. Relies on the Menu Bar's global connection indicator for the "why," same pattern as Terminal's disconnected state.

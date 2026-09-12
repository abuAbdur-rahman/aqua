# Aqua — DESIGN.md (dark mode only)

No light theme, ever. This is a developer tool used for terminal/editor work, typically in low light — a single, well-tuned dark palette beats a half-maintained light variant nobody uses. Skip `next-themes`-style class switching entirely: one stylesheet, one set of CSS variables.

## Principles this palette follows

Two things worth building on rather than reinventing: dark surfaces should sit on true dark gray rather than pure black, because <cite index="8-1">pure black surfaces lose the ability to show visible elevation between layered UI</cite> — a card, a sidebar, and a modal all need to read as *different* surfaces, which #000000 can't do. And the 2026 baseline has moved past flat mid-gray: <cite index="4-1">plain gray now reads as dated, and the current standard is neutrals with a deliberate warm or cool tint</cite>. This palette uses a cool-blue-tinted neutral ramp for exactly that reason — it's also a quiet nod to the "Aqua" name without being loud about it.

## Token system

Same naming convention as Veridex (`accent` / `accent-strong` / `accent-bg` / `accent-ring`) — one shared mental model across your projects.

### Surfaces (elevation ramp — lighter as you go up, never pure black)

| Token | Hex | Use |
|---|---|---|
| `--bg-base` | `#121212` | Outermost canvas / desktop backdrop |
| `--bg-surface` | `#1A1A1E` | Window body background |
| `--bg-elevated` | `#232328` | Sidebar, Dock, Menu Bar |
| `--bg-overlay` | `#2C2C32` | Spotlight palette, modals, popovers |
| `--bg-hover` | `#34343B` | Hover state on list rows, Dock icons |

### Text

| Token | Hex | Contrast on `--bg-surface` |
|---|---|---|
| `--text-primary` | `#F2F2F5` | ~15.5:1 |
| `--text-secondary` | `#A8A8B3` | ~6.5:1 |
| `--text-tertiary` | `#6E6E78` | ~3.3:1 — large text/icons only |
| `--text-disabled` | `#4A4A52` | Decorative/disabled only |

### Accent — "Aqua"

| Token | Value | Use |
|---|---|---|
| `--accent` | `#22D3EE` | Selected menu item, active dock indicator, focus core, primary buttons |
| `--accent-strong` | `#67E8F9` | Hover/pressed state on accent elements |
| `--accent-bg` | `rgba(34,211,238,0.14)` | Selected row background |
| `--accent-ring` | `rgba(34,211,238,0.45)` | Focus ring |

### Semantic status (kept separate from accent — status ≠ brand)

| Token | Hex | Use |
|---|---|---|
| `--status-success` | `#32D74B` | Daemon connected, operation succeeded |
| `--status-warning` | `#FFD60A` | Daemon reconnecting, degraded state |
| `--status-danger` | `#FF453A` | Errors, daemon disconnected, delete confirmation |
| `--status-info` | `#0A84FF` | Neutral informational callouts |

## Chrome dimensions

| Element | Value |
|---|---|
| Traffic lights | 12px diameter, 8px gap |
| Title bar height | 28px |
| Menu bar height | 24px |
| Dock height (collapsed) | 64px |
| Dock icon size | 48px, magnifies to 64px max |
| Window corner radius | 10px |
| Card/panel corner radius | 8px |

## Motion

| Interaction | Timing |
|---|---|
| Window open/close | 220ms `cubic-bezier(0.4, 0, 0.2, 1)` |
| Dock magnify | 120ms ease-out |
| Spotlight open | 180ms, scale 0.96 → 1 |
| Minimize-to-dock | 320ms |

## Typography

- UI font: **Inter** (matches Veridex)
- Monospace (Terminal, Editor): **JetBrains Mono** (matches Veridex)

## Wallpaper

Default: a subtle gradient from `--bg-base` into a desaturated deep teal — quiet reference to "Aqua," not a loud one. User-configurable wallpaper is a v2 stretch goal (see app plan).

## Applying this

Ship these as CSS custom properties on `:root` in the frontend, extend Tailwind's theme to reference them (`bg-surface`, `text-primary`, etc.) rather than hardcoding hex anywhere in component code. `WindowFrame`, `Dock`, and `MenuBar` are the three components every other panel inherits chrome from — get those three right against this doc first, everything downstream is free.

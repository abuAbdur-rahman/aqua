# AGENTS.md

Root context for every agent on Aqua. Read this first, in whichever clone you're in, before touching anything. This file is deliberately short — a long list of rules gets skimmed, not followed.

## What this is

Aqua gives WSL Ubuntu a native, macOS-mannered desktop: a Tauri app on Windows talking to a Rust daemon inside WSL. Two repos, two agents, one shared history. Full picture in `README.md`.

## Your scope

You are one of two agents on this codebase:

- **Windows agent** → `app/` only, rules in `app/AGENTS.md`
- **WSL agent** → `daemon/` only, rules in `daemon/AGENTS.md`

Stay inside your directory. If a task seems to need a change outside it, that's a two-sided change — say so and stop, don't make it.

## Hard rules

- Never edit this file. Your own rules go in your scoped `AGENTS.md`, not here.
- Never edit `CONTRACT.md` unilaterally — it's the interface both sides depend on. Propose the change, don't just make it.
- Never force-push, rewrite history, or touch a file outside your own scope.
- Don't refactor, rename, or "clean up" anything you weren't asked to touch. Smallest correct diff wins.
- Ambiguous request, or one that seems to reach past your scope? Ask. Don't guess and proceed.

## Where the real instructions live

| Need | File |
|---|---|
| Build/test commands, stack, code style | your scoped `AGENTS.md` |
| API request/response shapes | `CONTRACT.md` |
| Colors, spacing, motion timing | `DESIGN.md` |
| Everything else | `README.md`, `app/PLAN.md`, `daemon/PLAN.md` |

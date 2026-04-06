# Playback

CMAF-compliant media player library extending the HTML `<video>` element with adaptive streaming. Currently supports DASH manifest parsing with an event-driven controller architecture.

## Docs

- [Architecture & Technical Design](docs/DESIGN.md)

## Tech Stack

- TypeScript, Vite, pnpm
- Biome for formatting and linting

## Scripts

- `pnpm dev` — dev server with example app
- `pnpm build` — production build
- `pnpm format` — format and lint with Biome
- `pnpm tsc` — type check

## Project Structure

- `lib/` — source code
  - `player.ts` — central Player class (event bus, controller registry, public API)
  - `events.ts` — event definitions
  - `config.ts` — player configuration
  - `controllers/` — single-responsibility controllers (event-driven)
  - `dash/` — DASH MPD parser
  - `types/` — format-agnostic manifest model
  - `utils/` — assertion, time, URL, functional helpers
- `example/` — example app (Vite dev server)
- `docs/` — design documentation

## Working Guidelines

### Workflow

- Use superpowers (brainstorm → plan → execute) for any non-trivial task
- Non-trivial = 3+ steps or architectural decisions
- If something goes sideways, STOP and re-plan immediately

### Subagent Strategy

- Use subagents liberally to keep main context window clean
- Offload research, exploration, and parallel analysis
- For complex problems, throw more compute at it via subagents

### Code Quality

- Demand elegance: for non-trivial changes, pause and ask "is there a more elegant way?"
- Skip for simple, obvious changes — do not over-engineer
- Simplicity first: make every change as simple as possible, impact minimal code
- Find root causes — no temporary fixes, no workarounds
- Senior developer standards at all times

### Code Style

- JSDoc comments: concise, technical, multi-line format, 80 char max line length
- Follow Biome rules (double quotes, 2-space indent, block statements required)
- Use `import type` for type-only imports

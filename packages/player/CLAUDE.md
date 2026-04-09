# @bap/player

CMAF-compliant media player library extending the HTML `<video>` element with adaptive streaming. Currently supports DASH manifest parsing with an event-driven controller architecture.

## Docs

- [Architecture & Technical Design](docs/DESIGN.md)
- [Manifest Model](docs/MANIFEST.md)

## Structure

- `lib/` — source code
  - `player.ts` — central Player class
  - `controllers/` — event-driven controllers
  - `dash/` — DASH MPD parser
  - `net/` — network layer
  - `types/` — manifest model types
  - `utils/` — shared helpers

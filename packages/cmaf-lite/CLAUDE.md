# cmaf-lite

CMAF-compliant media player library extending the HTML `<video>` element with adaptive streaming. Currently supports DASH manifest parsing with an event-driven controller architecture.

## Docs

- [Architecture & Technical Design](docs/DESIGN.md)
- [Manifest Model](docs/MANIFEST.md)

## Structure

- `lib/` — source code
  - `player.ts` — central Player class
  - `config.ts` — player configuration and defaults
  - `events.ts` — event definitions and type map
  - `registry.ts` — extensible component registry
  - `manifest/` — manifest loading and parser base class
  - `media/` — buffer, stream, and gap controllers
  - `dash/` — DASH MPD parser
  - `net/` — network service and response
  - `types/` — manifest, media, and network types
  - `utils/` — shared helpers

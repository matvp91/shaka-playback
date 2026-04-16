# cmaf-lite

CMAF-compliant media player library extending the HTML `<video>` element with adaptive streaming. Currently supports DASH manifest parsing with an event-driven controller architecture.

## Docs

- [Architecture & Technical Design](docs/design.md)
- [Manifest Model](docs/manifest.md)
- [Buffer Management](docs/buffer.md)
- [Adaptive Bitrate](docs/abr.md)

## Structure

- `lib/` — source code
  - `player.ts` — central Player class
  - `config.ts` — player configuration and defaults
  - `events.ts` — event definitions and type map
  - `manifest/` — manifest loading
  - `media/` — buffer, stream, and gap controllers
  - `abr/` — adaptive bitrate controller and estimators
  - `dash/` — DASH MPD parser
  - `net/` — network service and response
  - `types/` — manifest, media, and network types
  - `utils/` — shared helpers

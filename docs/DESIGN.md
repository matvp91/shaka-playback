# playback — Architecture & Technical Design

## Overview

playback is a CMAF-compliant media player library written in TypeScript. It extends the HTML `<video>` element with adaptive streaming playback by parsing streaming manifests into an internal model, fetching media segments, and buffering them through the MediaSource Extensions (MSE) API.

The consumer provides a URL and a media element — the library handles everything else.

### Goals

- Full player experience — manifest-to-playback with no assembly required
- VOD focus today, architecture supports live from day one
- Format-agnostic internal model — DASH is the first parser, but the manifest types are format-neutral
- Event-driven controller architecture — loosely coupled, single-responsibility controllers communicating through a central event bus

### Non-goals (for now)

- Plugin API for custom controllers
- DRM / content protection
- UI / player chrome
- ABR (adaptive bitrate selection)

## Pipeline

When `player.load(url)` is called, data flows through this pipeline:

```
URL → [ManifestController] → Manifest Model → [StreamController] → Segment Data → [BufferController] → MSE/SourceBuffer → <video>
```

Each stage is handled by a controller — a single-responsibility class that listens for events signaling its input is ready, does its work, and emits events signaling its output is available.

## Player

The Player class sits at the center of the architecture with three roles:

1. **Event bus** — all controller-to-controller communication flows through Player's EventEmitter. Controllers never call each other directly.
2. **Controller registry** — Player instantiates and holds references to all controllers.
3. **Public API** — `load()`, `attachMedia()`, `detachMedia()` are the consumer-facing surface.

## Controllers

Controllers live in `lib/controllers/`. Each controller:

- Receives the Player instance on construction
- Binds event listeners to coordinate with other controllers through the Player's event bus
- Has a single, well-defined responsibility
- Provides a `destroy()` method that removes all event listeners and cleans up resources
- Never calls other controllers directly — all coordination happens through events

### ManifestController

Owns manifest fetching and parsing.

- Listens for `MANIFEST_LOADING` (emitted by Player on `load()`)
- Delegates to the appropriate parser (DASH) based on the manifest format
- Emits `MANIFEST_PARSED` with the resulting Manifest model
- For live, will own the periodic manifest refresh loop

### MediaController

Manages the relationship between the `<video>` element and MediaSource.

- Handles media attach/detach lifecycle
- Creates and owns the MediaSource instance
- Binds MediaSource to the video element on attach
- Emits `MEDIA_ATTACHED` once MediaSource fires `sourceopen` (MediaSource is ready for SourceBuffers)
- Monitors native media events (play, pause, seeking, timeupdate, ended, error) and re-emits them as player events

### BufferController

Owns the SourceBuffers and manages appending segment data.

- Maintains a `Map<SelectionSet, SourceBuffer>` — one SourceBuffer per media type, stable across quality switches
- Creates SourceBuffers on the MediaSource when tracks are selected (using the track's mimeType and codec)
- Manages the append queue — SourceBuffer only allows one append at a time, gated by `updateend`
- Receives segment data and appends it to the correct SourceBuffer
- Reports buffer levels

### StreamController

Orchestrates the segment loading flow. This is the brain of the playback loop.

- Listens for manifest availability, selects initial tracks
- Determines which segments to load based on playback position and buffer state
- Owns the `bufferGoal` check — compares current buffer level against the configured goal to decide whether to load more segments
- Fetches segments and signals when segment data is ready
- Reacts to seeking by loading segments at the new position

## Event Flow

Events are the connective tissue between controllers. No controller knows about any other controller — they only know about events.

### Media Attachment

```
player.attachMedia(videoEl)
  → MEDIA_ATTACHING
  → MediaController creates MediaSource, binds to video element
  → MediaSource fires sourceopen
  → MEDIA_ATTACHED (MediaSource ready for SourceBuffers)
```

### Load & Playback (VOD)

```
player.load(url)
  → MANIFEST_LOADING { url }
  → ManifestController fetches and parses manifest
  → MANIFEST_PARSED { manifest }

Once both MEDIA_ATTACHED and MANIFEST_PARSED have fired:
  → StreamController selects initial tracks, requests first segments
  → SEGMENT_LOADED { data, track }
  → BufferController creates SourceBuffer if needed (from track codec), appends data
  → BUFFER_APPENDED
  → StreamController checks buffer level against bufferGoal, loads next or waits
```

### Native Media Events

```
video element fires play, pause, seeking, timeupdate, error, ended
  → MediaController re-emits as player events
  → StreamController reacts (e.g., seeking triggers segment loads at new position)
```

## Manifest Model

The internal manifest model is format-agnostic. Any parser (DASH today) outputs this same structure:

```
Manifest
  └── Presentation[]
        ├── start, end (time bounds)
        └── SelectionSet[]
              ├── type (VIDEO | AUDIO | TEXT)
              └── SwitchingSet[]
                    └── Track[]
                          ├── mimeType, codec, bandwidth
                          ├── width?, height? (video)
                          ├── initSegmentUrl
                          ├── timeOffset
                          └── Segment[]
                                ├── url
                                ├── start, end (seconds)
```

### Mutability & Stable References

The Manifest and its nested objects are mutable with stable references. Controllers can hold direct references to tracks, presentations, or segments and use them as map keys. For live, manifest refreshes update existing objects in place rather than replacing the tree.

This enables stable mappings like `Map<SelectionSet, SourceBuffer>` — one SourceBuffer per SelectionSet (i.e., per media type). This mapping stays stable across quality switches since switching tracks happens within a SelectionSet, not across them.

### Parsers

Parsers live in `lib/dash/` (and future format directories). A parser's only job is to take a raw manifest and produce the internal Manifest model. This boundary is what makes the rest of the pipeline format-agnostic.

## Live vs VOD

The architecture supports both through the same pipeline. The key differences:

- **VOD**: Manifest is parsed once, segment list is complete upfront.
- **Live**: Manifest is re-fetched periodically, segment list grows over time, old buffer may need eviction.

The Presentation's `start`/`end` and the segment timeline already accommodate both — a live presentation has a moving window rather than fixed bounds. The controllers don't need to distinguish between live and VOD in their core logic; the difference is in how often the manifest is refreshed and whether the segment list is static or growing.

Current focus is VOD. Live support requires no architectural changes, only additional behavior in the manifest refresh and buffer eviction paths.

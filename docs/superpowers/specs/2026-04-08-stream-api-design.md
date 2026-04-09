# Stream API Design

Public API for querying available streams and setting playback
preferences, abstracting over the internal manifest model.

## Motivation

The internal manifest model (`Presentation → SelectionSet →
SwitchingSet → Track`) is a faithful representation of the source
format. Users don't care about that hierarchy — they want to know
what video/audio options exist and express what they prefer.

A **Stream** is a unified, cross-presentation view of a playback
option. A **StreamPreference** is a partial description of the
desired stream, matched by closest approximation.

## Types

### `types/stream.ts`

```typescript
type Stream = {
  codec: string;
} & (
  | {
      type: MediaType.VIDEO;
      width: number;
      height: number;
    }
  | {
      type: MediaType.AUDIO;
    }
);

type VideoStream = Extract<Stream, { type: MediaType.VIDEO }>;
type AudioStream = Extract<Stream, { type: MediaType.AUDIO }>;

type StreamPreference<T extends Stream> = Partial<Omit<T, "type">>;
type VideoStreamPreference = StreamPreference<VideoStream>;
type AudioStreamPreference = StreamPreference<AudioStream>;
```

- Discriminated union on `MediaType`, same pattern as `Track`
- `codec` is the short identifier (e.g., `avc1.64001f`,
  `mp4a.40.2`), not the full MSE content type
- `VideoStream` adds `width` and `height`
- `AudioStream` has no additional fields yet (language/channels
  are future work, tracked in TODO.md)
- `StreamPreference<T>` is a type-level utility that derives an
  all-optional preference from any stream type

### `types/base.ts` → `types/media.ts`

Rename for clarity. Contains `MediaType`, `InitSegment`, `Segment`.

## Public API (`player.ts`)

### Getters

```typescript
getVideoStreams(): VideoStream[]
getAudioStreams(): AudioStream[]
```

Derived on demand from the current manifest via `utils/stream.ts`.
No cached state — always reflects the current manifest.

### Preference setter

```typescript
setPreferences(
  type: MediaType.VIDEO,
  preference: VideoStreamPreference,
  flushBuffer?: boolean
): void;

setPreferences(
  type: MediaType.AUDIO,
  preference: AudioStreamPreference,
  flushBuffer?: boolean
): void;
```

Preferences are matched by closest approximation, not exact match.
For example, `{ height: 720 }` selects the stream closest to 720p.

## Stream construction (`utils/stream.ts`)

Pure functions that operate on the manifest model:

- **Build stream list:** Takes a `Manifest`, derives the unique
  set of `Stream` objects across all presentations. Streams are
  identified by their distinguishing properties (codec +
  width/height for video, codec for audio).
- **Match preference:** Takes available streams and a
  `StreamPreference`, returns the closest matching stream.
- **Resolve track:** Given a resolved stream and a presentation,
  returns the corresponding manifest `Track` for segment loading.

All filtering and matching logic lives here, keeping
StreamController focused on orchestration.

## Manifest normalization (`lib/ham/normalize.ts`)

A post-parse normalization pass, gated by the `normalizeManifest`
config option. Ensures every presentation has a consistent set of
streams (same codec groups, same quality levels).

### Initial implementation

Returns the manifest as-is. The stub includes documentation
explaining:

- **Why:** Presentations may have inconsistent switching sets
  across periods. The public stream API assumes uniformity.
- **What:** Normalization will intersect or reconcile the
  available tracks across presentations to guarantee a consistent
  stream set.
- **How:** TBD — will be designed when we encounter real-world
  inconsistent manifests.

### Config

Add `normalizeManifest: boolean` to `PlayerConfig` (default:
`true`).

## StreamController integration

### Preference event flow

1. `player.setPreferences()` emits `STREAM_PREFERENCE_SET` with
   the media type, preference, and `flushBuffer` flag.
2. StreamController receives the event.
3. Resolves the best matching `Track` per presentation via
   `utils/stream.ts`.
4. Updates `mediaState.track` and resets `lastSegment` to trigger
   time-based segment lookup at the current playback position.

### `flushBuffer: true`

1. Abort any in-flight segment request for the media type.
2. Clear the SourceBuffer (remove all buffered data).
3. Load the new track's init segment.
4. Resume segment loading from current playback time.

### `flushBuffer: false`

1. Let the current buffer play out.
2. At the next segment boundary, append the new track's init
   segment and continue loading from the new track.

## File changes summary

| File | Change |
|---|---|
| `types/base.ts` | Rename to `types/media.ts` |
| `types/stream.ts` | New — `Stream`, `VideoStream`, `AudioStream`, `StreamPreference` |
| `utils/stream.ts` | New — stream list construction, preference matching, track resolution |
| `lib/ham/normalize.ts` | New — stub normalization pass |
| `lib/config.ts` | Add `normalizeManifest` option |
| `lib/events.ts` | Add `STREAM_PREFERENCE_SET` event |
| `lib/player.ts` | Add `getVideoStreams()`, `getAudioStreams()`, `setPreferences()` |
| `lib/controllers/stream_controller.ts` | Handle preference event, track switching with flush/no-flush |
| All importers of `types/base.ts` | Update import paths to `types/media.ts` |

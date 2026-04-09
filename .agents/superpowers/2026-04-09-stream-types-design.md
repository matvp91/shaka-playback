# Stream Types Design

Public types and API for querying available streams and setting
playback preferences.

## Motivation

The internal manifest model (`Presentation -> SelectionSet ->
SwitchingSet -> Track`) faithfully represents the source format.
Users don't care about that hierarchy -- they want to know what
video/audio options exist and express what they prefer.

A **Stream** is a unified, cross-presentation view of a playback
option. A **StreamPreference** is a partial description of the
desired stream, matched by closest approximation.

## Types (`types/player.ts`)

New file for public player-specific types.

```typescript
import type { MediaType } from "./media";

type Stream = {
  codec: string;
} & (
  | { type: MediaType.VIDEO; width: number; height: number }
  | { type: MediaType.AUDIO }
);

type StreamPreference = {
  [K in Stream as K["type"]]:
    { type: K["type"] } & Partial<Omit<K, "type">>;
}[Stream["type"]];
```

- `Stream` is a discriminated union on `MediaType`, same
  pattern as `Track`
- `codec` is a shared base property (e.g. `avc1.64001f`,
  `mp4a.40.2`)
- Video streams add `width` and `height`
- Audio streams have no additional fields yet (language,
  channels are future work)
- `StreamPreference` is derived from `Stream` -- keeps `type`
  required, everything else optional
- Both exported from `types/index.ts`

### MSE content type

Built from `MediaType` + `codec` without needing `mimeType`.
CMAF guarantees fMP4, so the content type is always
`${type}/mp4; codecs="${codec}"`. A utility constructs this.

## Player API (`player.ts`)

### `getStreams(): Stream[]`

Returns a flat array of all streams (video + audio), derived
on demand from the current manifest via
`utils/stream_select.ts`. No cached state -- always reflects
the current manifest.

### `setPreference(preference: StreamPreference, flushBuffer?: boolean): void`

1. Emits `STREAM_PREFERENCE_CHANGED` with `{ preference }`
2. If `flushBuffer` is true, calls
   `bufferController.flush(preference.type)`

Preferences are matched by closest approximation, not exact
match. For example, `{ type: MediaType.VIDEO, height: 720 }`
selects the stream closest to 720p.

## Event (`events.ts`)

```typescript
STREAM_PREFERENCE_CHANGED: "streamPreferenceChanged"
```

Payload: `{ preference: StreamPreference }`

Follows the existing `SUBJECT_ACTION` naming pattern.

## Stream selection (`utils/stream_select.ts`)

Pure functions that keep StreamController focused on
orchestration. Handles both default selection (no preference)
and preference-based selection.

### `getStreams(manifest): Stream[]`

Derives the set of available streams by intersecting across
all presentations. Only streams that exist in every
presentation are included.

A stream is identified by its distinguishing properties:
- Video: `codec` + `width` + `height`
- Audio: `codec`

Asserts that the result is non-empty. An empty intersection
means the manifest has no consistent streams -- fail fast.

### `selectTrack(manifest, presentation, type, preference?): Track`

Single entry point for all track selection in StreamController.
Replaces `getTrackForType_`.

- **With preference:** matches the closest stream, then
  resolves to the corresponding `Track` in the given
  presentation by walking
  `SelectionSet -> SwitchingSet -> Track`.
- **Without preference:** returns the first track for the
  media type (current default behavior).

Asserts that a matching track is found. If the intersection
in `getStreams` is correct, every stream must have a
corresponding track in every presentation.

## StreamController changes

### Simplification

StreamController no longer walks `SelectionSet`/`SwitchingSet`
directly. All track resolution goes through `selectTrack()`
from `utils/stream_select.ts`. This replaces `getTrackForType_`
and the manual hierarchy traversal in `tryStart_`.

### MediaState

Unchanged -- holds `presentation` and `track`. The
`switchingSet` and `selectionSet` are not stored; they are
derivable from `track` + `presentation` + `type` when needed.
This keeps state lean and avoids maintaining references for
logic that doesn't exist yet.

When `changeType` / SourceBuffer reset support is added later,
the old and new switching set (and selection set) can be
derived at the point of transition to decide the appropriate
MSE action (`changeType` vs full reset). The architecture
supports this without storing extra state now.

### Preference storage

Holds `preferences_: Map<MediaType, StreamPreference>`. Passed
to `selectTrack` when present.

### `STREAM_PREFERENCE_CHANGED` handler

1. Stores the preference in `preferences_`
2. Cancels any in-flight request for that media type
3. Clears `lastSegment` and `lastInitSegment` on the
   `MediaState`
4. The existing tick loop naturally recovers: empty buffer
   triggers time-based segment lookup at current playback
   position, using the new track resolved via `selectTrack()`

### MSE content type in `tryStart_`

Currently reads `mimeType` and `codec` from `SwitchingSet` to
emit `BUFFER_CODECS`. With `codec` on `Stream`, the content
type is built from `MediaType` + `Stream.codec` instead.

## BufferController changes

### `flush(type: MediaType): void`

New public method. Clears the SourceBuffer for the given media
type. Called directly by `player.setPreference()` when
`flushBuffer` is true.

## Future considerations

### SwitchingSet / SelectionSet transitions

A stream preference change can cross SwitchingSet or
SelectionSet boundaries:

- **SwitchingSet crossing** (different codec, same group):
  requires `changeType()` on the SourceBuffer
- **SelectionSet crossing** (different group): may require a
  full SourceBuffer reset, especially on legacy devices that
  don't support `changeType()`

These transitions are detectable by deriving the old and new
switching set / selection set from the track + presentation.
No additional state in MediaState is needed. Implementation
is deferred.

## File changes summary

| File | Change |
|---|---|
| `types/player.ts` | New -- `Stream`, `StreamPreference` |
| `types/index.ts` | Re-export `types/player.ts` |
| `utils/stream_select.ts` | New -- `getStreams`, `selectTrack` |
| `events.ts` | Add `STREAM_PREFERENCE_CHANGED` event |
| `player.ts` | Add `getStreams()`, `setPreference()` |
| `controllers/stream_controller.ts` | Replace `getTrackForType_` with `selectTrack`, add `preferences_` map, handle preference event |
| `controllers/buffer_controller.ts` | Add `flush(type)` method |

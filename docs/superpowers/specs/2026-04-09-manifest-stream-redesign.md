# Manifest Model & Stream Selection Redesign

## Motivation

SelectionSet is an unnecessary grouping layer in the manifest
model. SwitchingSet already carries codec information and Track
carries type, making SelectionSet purely redundant indirection.
Removing it simplifies the model, flattens traversals, and
aligns better with CMAF (which defines SwitchingSets but not
SelectionSets). The SourceBuffer mapping that SelectionSet
claimed (1:1 with SourceBuffer) was inaccurate — the real 1:1
mapping is SwitchingSet to SourceBuffer.

This redesign also clarifies Stream as a first-class concept,
splits stream selection into focused functions, and restructures
BUFFER_CODECS as a per-type event to enable future changeType
support without additional plumbing.

## Manifest Model

### Before

```
Manifest → Presentation[] → SelectionSet[] → SwitchingSet[] → Track[]
```

### After

```
Manifest → Presentation[] → SwitchingSet[] → Track[]
```

**SelectionSet is removed.** SwitchingSets live directly on
Presentation.

### SwitchingSet

Gains `type: MediaType` (previously on SelectionSet). Owns all
properties shared by its Tracks:

- `type: MediaType` — media type
- `codec: string` — codec string
- `tracks: Track[]` — quality levels

### Track

Unchanged. Per-quality properties:

- `bandwidth: number`
- `initSegment: InitSegment`
- `segments: Segment[]`
- Discriminated union: VIDEO adds `width`, `height`

### Property Rationale (from DASH)

In DASH, properties inherit downward (child wins). Mapping to
our model:

| Property | SwitchingSet | Track | Rationale |
|-----------|-------------|-------|-----------|
| type | x | | From contentType/mimeType, shared |
| codec | x | | Shared within AdaptationSet |
| width | | x | Per-Representation |
| height | | x | Per-Representation |
| bandwidth | | x | Per-Representation only |
| segments | | x | Resolved from SegmentTemplate |

## DASH Parser

### Removed

- `groupAdaptationSets` — grouped by `@group`/contentType
- `parseSelectionSet` — wrapped groups into SelectionSet
- `inferContentType` — fallback key for grouping

### Changed

- **`parsePeriod`**: maps each AdaptationSet directly to a
  SwitchingSet (no grouping step)
- **`parseSwitchingSet`**: receives type from `inferMediaType`,
  includes it in the returned SwitchingSet
- **`@group` attribute**: dropped from DASH types

### Kept

- `inferMediaType` — determines `type` for each SwitchingSet

### DASH Mapping

| DASH | Internal |
|------|----------|
| MPD | Manifest |
| Period | Presentation |
| AdaptationSet | SwitchingSet |
| Representation | Track |

## Stream

### Definition

A Stream is the player's view of what's choosable — consistent
across all Presentations. It represents a unique combination of
properties that distinguishes one playback option from another
(type, codec, resolution). Streams are what a player UI surfaces
and what ABR operates on.

The relationship:
```
Manifest (what exists) → Stream[] (what's choosable) → Track (what's playing)
```

### Type

Moves from `types/player.ts` to `types/stream.ts` (with
`StreamPreference`). Type definition unchanged:

```ts
type Stream = { codec: string } & (
  | { type: MediaType.VIDEO; width: number; height: number }
  | { type: MediaType.AUDIO }
);
```

### changeType

Comparing two Streams' `codec` field determines whether
BufferController needs to call `sourceBuffer.changeType()`.
A Stream defines the codec, so crossing Presentations on the
same Stream never triggers changeType — only Stream changes can.

## Stream Selection

### Public Functions

Three focused functions replace the current `selectTrack`:

**`getStreams(manifest): Stream[]`**

Derive the set of Streams consistent across all Presentations.
Scans all SwitchingSets in each Presentation, converts Tracks
to Streams, intersects across Presentations.

**`selectStream(streams, type, current?, preference?): { stream, action }`**

Pick the best Stream for a media type. Steps:

1. Filter streams by requested type
2. No preference: return first matching Stream
3. With preference: find closest match
   - Video: closest by height, then width, codec as tiebreaker
   - Audio: match codec, or first available
4. Compare to current (if any) to determine action

Action values:
- `none` — same Stream, nothing to do
- `switch` — same codec, different quality
- `changeType` — different codec

**`resolveTrack(presentation, stream): Track`**

Resolve a Stream to a concrete Track in a Presentation. Filters
SwitchingSets by type + codec, then matches Track by dimensions
(video) or returns first (audio).

### Private Functions

**Kept:**
- `isSameStream` — shared Stream comparison
- `matchVideoPreference` — non-trivial distance calculation
- `matchAudioPreference` — codec matching logic

**Removed (inlined):**
- `collectStreams` — into `getStreams`
- `toStream` — inline where used
- `intersect` — into `getStreams`
- `getFirstTrack` — replaced by `selectStream` + `resolveTrack`
- `isTrackMatch` — replaced by `isSameStream`

## StreamController

### MediaState

Gains `stream` to track what's currently selected:

```ts
type MediaState = {
  type: MediaType;
  stream: Stream;
  presentation: Presentation;
  track: Track;
  ended: boolean;
  lastSegment: Segment | null;
  lastInitSegment: InitSegment | null;
  lastRequest: Request<"arrayBuffer"> | null;
  timer: Timer;
};
```

### Call Patterns

**Initial setup (`tryStart_`):**
`selectStream` (no current) + `resolveTrack` per type. Emits
per-type `BUFFER_CODECS`.

**Preference change (`onStreamPreferenceChanged_`):**
`selectStream` (with current, returns action) + `resolveTrack`.
If action is `changeType`, emits per-type `BUFFER_CODECS` with
new mimeType. Resets lastInitSegment and lastSegment.

**Presentation crossing (`advanceOrEnd_`):**
`resolveTrack` only. Same Stream, new Presentation — no
selection, no codec change possible.

## Events

### BUFFER_CODECS (changed)

Becomes per-type:

```ts
// Before
{ mediaTracks: Map<MediaType, MediaTrack>, duration: number }

// After
{ type: MediaType, mimeType: string }
```

Emitted once per type at startup. Emitted again for the
affected type on a codec change. Duration handling moves out
of this event and is addressed separately.

BufferController decides internally:
- SourceBuffer doesn't exist → `addSourceBuffer`
- SourceBuffer exists → `changeType` via OperationQueue

### BUFFER_CREATED (removed)

No longer needed. StreamController gets buffer info through
`Player.getBuffered(type)` instead of stored SourceBuffer
references.

## changeType Flow

Not implemented in this work, but the architecture supports it
without additional plumbing:

1. `selectStream` returns `{ stream, action: "changeType" }`
2. StreamController emits per-type `BUFFER_CODECS` with new
   mimeType
3. BufferController queues `changeType` on OperationQueue
4. StreamController resets MediaState (stream, track,
   lastInitSegment, lastSegment)
5. Next tick loads new init segment → `BUFFER_APPENDING` →
   queued after `changeType` in OperationQueue
6. OperationQueue serialization guarantees correct ordering

No new events, no waiting, no callbacks needed.

# Multi-Period Support

Adds multi-period DASH support by replacing the flat manifest model with a
CMAF-aligned 4-level hierarchy and updating the event architecture to follow
a command/response pattern inspired by hls.js.

## Motivation

The current manifest model (`Manifest → MediaGroup → Stream`) is flat and
single-period. The parser reads only `Period[0]`, discarding all other
periods. This design adds full multi-period support for general DASH spec
compliance.

## Manifest Model

### Hierarchy

```
Manifest
└── Presentation[]
    └── SelectionSet[]
        └── SwitchingSet[]
            └── Track[]
```

### Types

**Manifest** — top-level container.
- `presentations: Presentation[]` — ordered by time.

**Presentation** — maps to a DASH Period. Time-bounded, independent content.
- `start: number` — period start time in seconds (from `Period@start`).
- `selectionSets: SelectionSet[]`

**SelectionSet** — maps to one MSE SourceBuffer. Groups content by media type.
- `type: MediaType` — VIDEO, AUDIO, or TEXT.
- `switchingSets: SwitchingSet[]`

**SwitchingSet** — CMAF switching set. Tracks that can be seamlessly switched
between (same codec). ABR operates within a SwitchingSet.
- `mimeType: string`
- `codec: string`
- `timeOffset: number` — `presentationTimeOffset` from DASH. Shared across
  all tracks in the set (CMAF guarantees aligned timestamps within a
  SwitchingSet).
- `tracks: Track[]`

**Track** — individual quality level. Maps to a DASH Representation.
- `bandwidth: number`
- `initSegment: InitSegment`
- `segments: Segment[]`
- `width: number` (video only)
- `height: number` (video only)

**InitSegment** — unchanged.
- `url: string`

**Segment** — unchanged.
- `url: string`
- `start: number`
- `end: number`

### DASH Mapping

| Manifest Model | DASH MPD          |
|----------------|-------------------|
| Manifest       | MPD               |
| Presentation   | Period            |
| SelectionSet   | AdaptationSets grouped by media type |
| SwitchingSet   | AdaptationSet (by codec/mimeType)    |
| Track          | Representation    |

### Design Decisions

1. **Raw model.** Values stay as close to the source format as possible. No
   computed or derived fields. Controllers derive what they need (e.g., MSE
   `timestampOffset` from `presentation.start - switchingSet.timeOffset`).

2. **Presentations are independent.** No cross-period metadata or
   compatibility flags. Controllers determine SourceBuffer compatibility at
   transition time by comparing `mimeType;codecs` strings.

3. **`timeOffset` on SwitchingSet.** CMAF guarantees aligned timestamps
   within a SwitchingSet, so `presentationTimeOffset` is shared. Different
   SwitchingSets in the same SelectionSet may have different values (e.g.,
   H.264 vs H.265 encoded with different pipelines).

4. **No `start`/`end` on Track.** Derivable from the segment list.

5. **Minimal Manifest.** Just `presentations: Presentation[]`. MPD-level
   metadata (`type`, `minBufferTime`) deferred until live support.

### Migration from Current Model

| Current                  | New                            |
|--------------------------|--------------------------------|
| `Manifest { groups }`   | `Manifest { presentations }`   |
| `MediaGroup`             | Split into SelectionSet + SwitchingSet |
| `Stream`                 | `Track`                        |
| `timeOffset` on Stream   | `timeOffset` on SwitchingSet   |
| `start`/`end` on Stream  | Removed                        |

## Event Architecture

Replace the current ad-hoc events with a command/response pattern between
StreamController and BufferController, inspired by hls.js.

### Buffer Events

**Commands (StreamController → BufferController):**

| Event              | Purpose                        | Payload |
|--------------------|--------------------------------|---------|
| `BUFFER_CODECS`    | Create SourceBuffers           | Codec info per media type |
| `BUFFER_APPENDING` | Append data (init or media)    | Type, data, timestampOffset? |
| `BUFFER_EOS`       | End the stream                 | — |

**Responses (BufferController → StreamController):**

| Event              | Purpose                        | Payload |
|--------------------|--------------------------------|---------|
| `BUFFER_CREATED`   | SourceBuffers ready            | — |
| `BUFFER_APPENDED`  | Append complete                | Type |

### Event Flow

```
StreamController                              BufferController
      |                                             |
  emit BUFFER_CODECS { codecs per type }  ───────>  |
      |                                        create SourceBuffers
      |                                  <───────  emit BUFFER_CREATED
      |                                             |
  emit BUFFER_APPENDING { init segment } ────────>  |
      |                                        appendBuffer()
      |                                  <───────  emit BUFFER_APPENDED
      |                                             |
  emit BUFFER_APPENDING { media segment } ───────>  |
      |                                        appendBuffer()
      |                                  <───────  emit BUFFER_APPENDED
      |                                             |
  (period transition: new init + updated offset)    |
  emit BUFFER_APPENDING { init, offset } ────────>  |
      |                                        set timestampOffset
      |                                        appendBuffer()
      |                                  <───────  emit BUFFER_APPENDED
      |                                             |
  emit BUFFER_EOS                        ────────>  |
      |                                        endOfStream()
```

### Events Removed

- `MEDIA_GROUPS_UPDATED` — replaced by `BUFFER_CODECS`.
- `SEGMENT_LOADED` — replaced by `BUFFER_APPENDING`.

### Events Unchanged

- `MANIFEST_LOADING`, `MANIFEST_PARSED` — manifest fetch/parse lifecycle.
- `MEDIA_ATTACHING`, `MEDIA_ATTACHED`, `MEDIA_DETACHED` — media element
  lifecycle.

## DASH Parser Changes

1. **Iterate all periods** — `mpd.Period.map(parsePeriod)` instead of
   `mpd.Period[0]`.
2. **Extract `Period@start`** — parse duration string into seconds for
   `Presentation.start`.
3. **Two-level AdaptationSet grouping:**
   - By media type → SelectionSet.
   - By codec/mimeType within type → SwitchingSet.
4. **Extract `presentationTimeOffset`** from SegmentTemplate at
   AdaptationSet level, store on SwitchingSet as `timeOffset`.
5. **Remove `start`/`end` computation** on Track.

## Controller Changes

### StreamController

- **`MediaState`** tracks full hierarchy: `presentation`, `selectionSet`,
  `switchingSet`, `track`, plus `lastSegment` and `lastInitSegment`.
- **`tryStart_()`** resolves `Presentation[0]` → SelectionSet per type →
  SwitchingSet[0] → Track[0]. Emits `BUFFER_CODECS`.
- **`getNextSegment_()`** when a Track's segments are exhausted, checks for
  a next Presentation. If found, transitions MediaState to the new period
  and loads the new init segment. Only emits `BUFFER_EOS` when the last
  Presentation is exhausted.
- **`timestampOffset`** computed as `presentation.start -
  switchingSet.timeOffset` and included with `BUFFER_APPENDING` when it
  changes at period boundaries.

### BufferController

- **`onBufferCodecs_()`** creates SourceBuffers from codec info. Emits
  `BUFFER_CREATED`.
- **`onBufferAppending_()`** sets `sourceBuffer.timestampOffset` when
  provided, then calls `appendBuffer()`. Handles both init and media
  segments uniformly.
- **Duration** computed from the last presentation's `start` plus the
  maximum `segment.end` across its active tracks.
- Buffer eviction, EOS handling, operation queue unchanged.

### ManifestController

Minimal change — fetches and delegates to the parser, which returns the new
model shape.

## Scope

### In scope

- New manifest model types (Presentation, SelectionSet, SwitchingSet, Track).
- DASH parser producing multi-period output.
- New event architecture (BUFFER_CODECS, BUFFER_APPENDING, etc.).
- StreamController period-aware segment selection.
- BufferController handling compatible period transitions (same codec).
- Example app updated for new model.

### Deferred

- Incompatible codec switches across periods (SourceBuffer recreation or
  `changeType()`). The model carries all info needed for future
  implementation — nothing in this design precludes either approach.
- Live manifest support (MPD-level metadata, refresh logic).
- ABR switching (still picks first Track).

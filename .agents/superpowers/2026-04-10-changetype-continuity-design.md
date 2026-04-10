# changeType Support & Flat Manifest Model

## Problem

StreamController conflates hierarchy resolution with segment
navigation. There is no explicit SwitchingSet level in
MediaState, making codec change detection impossible. MSE
`changeType` is unsupported. The Presentation level in the
manifest model adds complexity without value — segment times
are already resolved to the presentation timeline at parse
time.

## Goals

- Support MSE `changeType` for codec switching
- Flatten the manifest model by removing Presentation
- Simplify StreamController with explicit hierarchy and
  self-correcting delivery state
- Slim stream_utils to selection-only

## Design

### Manifest Model

Remove Presentation. Segments are one flat array per Track,
spanning the full content. Each segment references its own
InitSegment — segments in the same DASH period share the
same InitSegment reference (stable references). A change
in InitSegment reference between consecutive segments marks
a discontinuity (old period boundary).

```ts
type Manifest = {
  duration: number;
  switchingSets: SwitchingSet[];
};

type SwitchingSet = {
  type: MediaType;
  codec: string;
  tracks: Track[];
};

type Track = {
  bandwidth: number;
  segments: Segment[];
} & (
  | { type: MediaType.VIDEO; width: number; height: number }
  | { type: MediaType.AUDIO }
);

type Segment = {
  url: string;
  start: number;
  end: number;
  initSegment: InitSegment;
};

type InitSegment = {
  url: string;
};
```

**What goes away:** `Presentation` type, `presentations`
array, period-based grouping. The DASH parser flattens
periods into continuous tracks at parse time.

**TODO:** The parser currently assumes consistent streams
across all periods. Handling inconsistent periods (different
codecs/resolutions per period) is deferred.

### MediaState

Add `switchingSet` to make the hierarchy explicit. Rename
`lastRequest` to `request`. Remove `presentation`. Group
fields by concern:

```ts
type MediaState<T extends MediaType = MediaType> = {
  // Identity
  type: T;
  stream: ByType<Stream, T>;

  // Hierarchy
  switchingSet: SwitchingSet;
  track: ByType<Track, T>;

  // Delivery
  lastSegment: Segment | null;
  lastInitSegment: InitSegment | null;

  // Operational
  request: NetworkRequest | null;
  ended: boolean;
  timer: Timer;
};
```

**Hierarchy cascade:**

- SwitchingSet changes → emit BUFFER_CODECS (triggers
  `changeType` in BufferController)

That is the only cascade side effect. Track changes do not
null `lastInitSegment` — the reference comparison in
`update_` is self-correcting.

**Delivery:** `lastSegment` and `lastInitSegment` both mean
"this was sent to the buffer." They are set after successful
fetch in `loadSegment_`, not eagerly — this prevents marking
data as delivered when a fetch is aborted.

`lastInitSegment` is never explicitly nulled. When the init
segment changes (track change, discontinuity, seek into
different period), the reference comparison
`segment.initSegment !== lastInitSegment` catches it
automatically.

**Position:** `lastSegment` doubles as the position anchor.
When non-null, the next segment is found by index. When
null, a time-based lookup re-establishes position.

### Continuity Model

Each MediaType has its own continuity — one flat segment
array per track spanning the full content. No module needed;
the flat manifest model is the continuity.

**Core principle:** `lastSegment` exists means we know where
we are. `lastSegment` is null means position unknown.

| Situation | lastSegment | Next segment |
|-----------|-------------|--------------|
| Normal playback | kept | index + 1 |
| Quality switch (same SS) | remapped | index-based remap, CMAF aligned |
| Codec switch (different SS) | kept | `getSegmentForTime(lastSegment.end)` on new track |
| Seek | null | binary search by time |

`lastSegment` is only nulled on seek. All other transitions
preserve continuity.

**Stream as lens:** The Stream (type + codec + dimensions)
determines which track's segments we pull from. When the
Stream changes, the position doesn't — the Stream is a lens
on the continuity, not the continuity itself.

### Resolving Hierarchy

A `resolveHierarchy` function finds the SwitchingSet and
Track for a given Stream in the manifest:

```ts
function resolveHierarchy(
  manifest: Manifest,
  stream: Stream,
): { switchingSet: SwitchingSet; track: Track }
```

Called at start and on preference change — not per tick.

A `remapSegment` function preserves position across track
changes within the same SwitchingSet:

```ts
function remapSegment(
  oldTrack: Track,
  newTrack: Track,
  lastSegment: Segment,
): Segment
```

Index-based: finds the index in oldTrack, returns the
segment at the same index in newTrack. CMAF guarantees
aligned segments within a SwitchingSet.

Both are small utility functions inlined in or called from
StreamController.

### StreamController Changes

**update_ simplification:**

Two paths:

1. `lastSegment` exists → `segments[index + 1]`. If null
   → EOS.
2. `lastSegment` is null → binary search by time. If null
   → EOS.

Then check `segment.initSegment !== lastInitSegment` and
fetch init if needed. Otherwise fetch the segment.

No `advanceOrEnd_`. No `getPresentationForTime_`. No
presentation boundary handling. `getNextSegment` is index
+ 1 on a flat array — null means end of content.

**onStreamPreferenceChanged_:**

Select stream → `resolveHierarchy` → compare switchingSet
(emit BUFFER_CODECS if different) → compare track (remap
segment if different within same SwitchingSet) → update
MediaState → call `update_`.

**onSeeking_:**

Null `lastSegment`, cancel request, reset ended, call
`update_`. The time-based path handles everything.

**applyHierarchy_ helper:**

Private method encapsulating hierarchy diff, BUFFER_CODECS
emission, and MediaState update. Used by
`onStreamPreferenceChanged_` and the seek path in `update_`
when `getSegmentForTime` resolves a different hierarchy.

**Removed methods:**

- `advanceOrEnd_`
- `getNextSegment_` (inlined, one line)
- `getPresentationForTime_`

**Moved methods:**

- `getSegmentForTime_` — stays in StreamController or moves
  to a small utility. Binary search on a flat segment array.

### Stream Utils Changes

Slimmed to stream selection only:

**Stays:**
- `getStreams(manifest)` — derive available streams
- `selectStream(streams, preference)` — pick best stream
- `isSameStream(a, b)` — equality (used by `getStreams`)

**Removed:**
- `resolveTrack` → replaced by `resolveHierarchy`
- `getStreamAction` → replaced by reference comparison

### Buffer Controller Changes

`onBufferCodecs_` supports `changeType` when a SourceBuffer
already exists:

```ts
private onBufferCodecs_ = (event: BufferCodecsEvent) => {
  if (!this.mediaSource_) return;

  const { type, mimeType } = event;
  const sb = this.sourceBuffers_.get(type);

  if (sb) {
    this.opQueue_.enqueue(type, {
      execute: () => sb.changeType(mimeType),
    });
    return;
  }

  const newSb = this.mediaSource_.addSourceBuffer(mimeType);
  this.sourceBuffers_.set(type, newSb);
  this.opQueue_.add(type, newSb);

  newSb.addEventListener("updateend", () => {
    this.opQueue_.shiftAndExecuteNext(type);
  });

  this.updateDuration_(event.duration);
};
```

`changeType` is enqueued through the operation queue to
ensure it runs when the SourceBuffer is not updating.

### DASH Parser Changes

The parser flattens periods into continuous tracks. For
each DASH period, segments are resolved to the presentation
timeline (already done today). The difference: instead of
creating separate Presentation objects, segments are
appended to the same Track. Each segment references the
InitSegment for its period via stable reference.

**TODO:** Validate consistent streams across periods.
Handle inconsistent periods (different codecs/resolutions
per period) in a future change.

## Files Changed

| File | Change |
|------|--------|
| `lib/types/manifest.ts` | Remove Presentation, add initSegment to Segment, remove initSegment from Track |
| `lib/media/stream_controller.ts` | Refactor — flat model, hierarchy in MediaState, simplified update loop |
| `lib/media/buffer_controller.ts` | Update — changeType support in onBufferCodecs_ |
| `lib/utils/stream_utils.ts` | Slim — remove resolveTrack, getStreamAction |
| `lib/dash/dash_parser.ts` | Update — flatten periods into continuous tracks |

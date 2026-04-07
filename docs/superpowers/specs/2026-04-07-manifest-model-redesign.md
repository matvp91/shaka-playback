# Manifest Model Redesign

## Problem

The current manifest model mirrors DASH's XML hierarchy with five levels
of nesting: `Manifest > Presentation > SelectionSet > SwitchingSet > Track > Segment`.
This is academically faithful but imposes unnecessary complexity on consumers.
Most VOD content has a single Presentation, and most streams have one
SwitchingSet per SelectionSet, making two layers redundant in practice.
Controllers already flatten the hierarchy — StreamController picks one
track per SelectionSet and works with `Track` + `Segment[]` directly.

Additionally:
- `initSegmentUrl` is a plain string on `Track`, offering no extensibility
  for encryption metadata.
- `BufferController` receives `Track` objects but only uses `mimeType` and
  `codec` — it knows more than it needs to.
- `TrackType` naming collides with HTML's `AudioTrack`/`TextTrack` API.
- `duration` is computed ad-hoc from `Presentation.end` by StreamController.

## Design

### Manifest Model

Flatten the hierarchy to three levels. Leverage CMAF switching set
guarantees to hoist shared properties to the group level.

```
Manifest
└── groups: MediaGroup[]
    ├── type: MediaType
    ├── mimeType: string
    ├── codec: string
    └── streams: Stream[]
        ├── type: MediaType (discriminant)
        ├── bandwidth: number
        ├── width/height (video only)
        ├── initSegment: InitSegment
        │   └── url: string
        └── segments: Segment[]
            ├── url: string
            ├── start: number
            └── end: number
```

#### Type Definitions

```typescript
enum MediaType {
  VIDEO = "video",
  AUDIO = "audio",
  TEXT = "text",
}

type Manifest = {
  groups: MediaGroup[];
};

type MediaGroup = {
  type: MediaType;
  mimeType: string;
  codec: string;
  streams: Stream[];
};

type Stream = {
  bandwidth: number;
  initSegment: InitSegment;
  segments: Segment[];
} & (
  | { type: MediaType.VIDEO; width: number; height: number }
  | { type: MediaType.AUDIO }
);

type Segment = {
  url: string;
  start: number;
  end: number;
};

type InitSegment = {
  url: string;
};
```

#### Key Decisions

- **`Presentation` and `SwitchingSet` removed.** Periods are flattened at
  parse time by the DASH parser. Multi-period merging is deferred to when
  we need it.
- **`mimeType` and `codec` on `MediaGroup`.** CMAF guarantees these are
  identical across all streams in a switching set.
- **`InitSegment` on `Stream`.** Each stream has one init segment. This
  is correct for single-period content. Multi-period support (where init
  segments can change across period boundaries) will be revisited later.
- **`InitSegment` is a proper type** with a `url` field, extensible for
  an `encrypted` flag later.
- **No `duration` on `Manifest` or `MediaGroup`.** Duration is derivable
  from segments via helpers in `manifest_util.ts`.
- **No `language` yet.** Will be added to `MediaGroup` in a future pass
  with proper BCP-47 normalization.
- **Discriminated union on `Stream`** via `type` field. Enables compile-time
  guarantees that video streams carry `width`/`height`. The `type` is
  redundant with `MediaGroup.type` but necessary for type narrowing when a
  `Stream` is used without its parent group context.

#### Manifest Utilities (`lib/utils/manifest_util.ts`)

Helper functions for deriving information from the manifest model. Keeps
computed properties out of the model itself.

```typescript
/** Returns the end time of the last segment in the group. */
function getGroupDuration(group: MediaGroup): number;
```

Additional helpers added as needed.

#### MSE Mapping

The model maps directly to Media Source Extensions primitives:

| Model | MSE Primitive | Relationship |
|-------|---------------|--------------|
| `MediaGroup` | `SourceBuffer` | 1:1 — created from `mimeType` + `codec` |
| `Stream` | (none) | ABR/fetch concern — MSE never sees this |
| `InitSegment` | `appendBuffer()` | fMP4 header appended before media data |
| `Segment` | `appendBuffer()` | Media data appended to the SourceBuffer |

MSE doesn't care about quality, ABR, or periods — it receives bytes in
order via `appendBuffer()`. The `MediaGroup` → `SourceBuffer` mapping is
the only structural relationship. Everything else is a selection and
fetching concern owned by StreamController.

SourceBuffer lifecycle (reuse, reset, recreate on codec switch) is an
implementation detail inside BufferController, not a model concern.

#### Naming Changes

| Old | New | Rationale |
|-----|-----|-----------|
| `TrackType` | `MediaType` | Follows from Track -> Stream rename |
| `SelectionSet` | `MediaGroup` | Describes what it is: a group of media of the same type |
| `Track` | `Stream` | Avoids collision with HTML `AudioTrack`/`TextTrack` API |
| `initSegmentUrl: string` | `InitSegment` type | Proper type, extensible for `encrypted` flag later |
| `Presentation` | removed | Periods flattened at parse time |
| `SwitchingSet` | removed | Mapped 1:1 with SelectionSet in practice |

### Events

#### `MEDIA_GROUPS_UPDATED` (replaces `TRACKS_SELECTED`)

```typescript
type MediaGroupsUpdatedEvent = {
  groups: MediaGroup[];
};
```

Idempotent event signaling "here are the current active groups." Handles:
- Initial setup (first group selection after manifest parse)
- Codec switches (new group with different codec replaces old one)
- Language switches (different audio group selected)

BufferController reconciles SourceBuffers against the received groups on
each emission — creating, tearing down, or keeping SourceBuffers as needed.
Duration is derived from the groups via `getGroupDuration()`.

#### `SEGMENT_LOADED` (reshaped)

```typescript
type SegmentLoadedEvent = {
  type: MediaType;
  segment: Segment;
  data: ArrayBuffer;
};
```

Carries `MediaType` for SourceBuffer routing, `Segment` for context
(timing info), and raw data for appending.

#### Other Events

| Event | Change |
|-------|--------|
| `TRACKS_SELECTED` | Removed, replaced by `MEDIA_GROUPS_UPDATED` |
| `MANIFEST_PARSED` | Payload uses new `Manifest` type |
| `BUFFER_APPENDED` | `TrackType` renamed to `MediaType` |
| `BUFFER_CREATED` | Unchanged — confirms SourceBuffers exist before segment loading |
| `BUFFER_EOS` | Unchanged |
| `MANIFEST_LOADING` | Unchanged |
| `MEDIA_ATTACHING` | Unchanged |
| `MEDIA_ATTACHED` | Unchanged |
| `MEDIA_DETACHED` | Unchanged |

### Controller Responsibilities

#### BufferController

Scope unchanged. Updated inputs.

- Receives `MediaGroup[]` via `MEDIA_GROUPS_UPDATED`
- Creates SourceBuffers from `group.mimeType` + `group.codec`
- Derives duration from groups via `getGroupDuration()` for
  `mediaSource.duration`
- Reconciles SourceBuffers on each `MEDIA_GROUPS_UPDATED` (idempotent):
  same codec = no-op, different codec = tear down and recreate
- Appends segment data routed by `MediaType`
- Owns SourceBuffer lifecycle decisions (reuse, reset, recreate) —
  future concern for codec switches and period transitions
- **No knowledge of `Manifest`** — works with `MediaGroup` and raw data

#### StreamController

Same scope. Updated to new model.

- Receives `Manifest` via `MANIFEST_PARSED`
- Selects one `MediaGroup` per `MediaType`
- Selects one `Stream` per group (first stream now, ABR later)
- Tracks current `InitSegment` per group; fetches new one on change
  (ABR switch)
- Drives buffer-fill loop: checks buffer goal, fetches next segment,
  emits `SEGMENT_LOADED`
- Emits `MEDIA_GROUPS_UPDATED` with active groups
- Emits `BUFFER_EOS` when all segments are loaded

#### ManifestController

Updated output.

- DASH parser produces the new flattened `Manifest` model
- Single-period content maps directly to the new model
- Multi-period merging deferred to a future iteration

### Separation of Concerns

| Concern | Owner |
|---------|-------|
| Manifest structure and parsing | ManifestController |
| Group/stream/segment selection | StreamController |
| Init segment tracking | StreamController |
| SourceBuffer creation and management | BufferController |
| Data appending and operation queuing | BufferController |
| Duration derivation | `manifest_util.ts` helper |
| Buffer level tracking | BufferController |

### DASH Parser Changes

The DASH parser must change from producing the current deep hierarchy to
the flat model. Key transformations:

1. **Flatten hierarchy:** Map AdaptationSets to `MediaGroup[]`, hoist
   `mimeType` and `codec`. Map Representations to `Stream[]` with
   `InitSegment` per stream.
2. **Timing:** Segment `start`/`end` times are resolved to the
   presentation timeline at parse time. No `timeOffset` on streams.
3. **URL resolution:** Fully resolved at parse time as today.
4. **Multi-period:** Deferred. Current parser handles single-period
   content. Multi-period support will be added in a future iteration.

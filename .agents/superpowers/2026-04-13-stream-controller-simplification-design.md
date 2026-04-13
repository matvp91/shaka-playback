# Stream Controller Simplification — Design

## Problem

`StreamController` tracks the active selection per media type through three
parallel references on each `MediaState`: `stream`, `switchingSet`, and
`track`. `this.streams_` holds a flat, denormalized catalog of streams derived
from the manifest. Every selection path calls `selectStream` to pick a
`Stream`, then `resolveHierarchy` to re-walk the manifest and recover
`(switchingSet, track)`. The manifest is therefore walked twice for the same
information: once when building `streams_`, once again on every selection.

The duplication is not field-for-field data copying — each MediaState field
answers a distinct question (public identity, codec and reference-equality
check, segment iteration). What is duplicated is the **relationship** between
a `Stream` and its manifest entry, re-derived on every selection instead of
established once.

## Goals

- Establish the `Stream ↔ (SwitchingSet, Track)` relationship exactly once,
  at manifest parse.
- Preserve stable `Stream` object identity across the lifetime of a manifest,
  so the public API (`player.getStreams()`, `player.getActiveStream()`,
  `player.setStreamPreference(stream)`) continues to return stable references.
- Preserve the load-bearing reference-equality check that drives MSE
  `changeType` via `BUFFER_CODECS`
  ([stream_controller.ts:148-158](../../packages/cmaf-lite/lib/media/stream_controller.ts#L148-L158)).
- Keep `Stream` as a public DTO whose internal vocabulary is named — the
  manifest shape (`SwitchingSet`, `Track`) is reachable from a `Stream`, but
  through a single, explicitly named property.
- Reduce `StreamController`'s internal vocabulary so that it operates solely
  in terms of `Stream`.

## Non-Goals

- Changing any public API method signature or behavior.
- Splitting the `Stream` discriminated union into per-type concrete types.
- Changing segment fetch, tick, seek, or end-of-stream logic.
- Retaining `this.manifest_` on the controller. It is consumed at parse time
  and discarded.

## Design

### Types — `packages/cmaf-lite/lib/types/media.ts`

Introduce `StreamHierarchy` and add it to `Stream`:

```ts
export type StreamHierarchy = {
  switchingSet: SwitchingSet;
  track: Track;
};

export type Stream = {
  codec: string;
  bandwidth: number;
  hierarchy: StreamHierarchy;
} & (
  | { type: MediaType.VIDEO; width: number; height: number }
  | { type: MediaType.AUDIO }
);
```

`StreamPreference` is unchanged (`OptionalExcept<Stream, "type">` — note that
`hierarchy` becomes optional in the preference type, which is correct; callers
never supply it).

`SwitchingSet` and `Track` inside `hierarchy` are references to the manifest's
own objects — `buildStreams` never copies them. This preserves reference
equality for the codec-change detection.

### Utilities — `packages/cmaf-lite/lib/utils/stream_utils.ts`

```ts
export function buildStreams(manifest: Manifest): Stream[];
export function selectStream(
  streams: Stream[],
  preference: StreamPreference,
): Stream;
```

- `buildStreams` replaces `getStreams`. It walks the manifest once and
  produces `Stream` objects with `hierarchy` populated with references to the
  manifest's own `SwitchingSet` and `Track` objects. Dedup logic
  (`isSameStream`) is preserved, unchanged in behavior.
- `selectStream` is unchanged in signature and matching logic. It returns a
  `Stream` from the input list. No `.type` filtering is added at this level;
  the existing `preference.type` dispatch remains.
- `resolveHierarchy` is **deleted**. No callers remain inside the package.
  Its tests are deleted.

### Controller — `packages/cmaf-lite/lib/media/stream_controller.ts`

Fields:

```ts
private streams_: Stream[] | null = null;
private media_: HTMLMediaElement | null = null;
private mediaStates_ = new Map<MediaType, MediaState>();
private preferences_ = new Map<MediaType, StreamPreference>();
// this.manifest_ — removed
```

`MediaState` shrinks:

```ts
type MediaState = {
  type: MediaType;
  stream: Stream;
  lastSegment: Segment | null;
  lastInitSegment: InitSegment | null;
  request: NetworkRequest | null;
  ended: boolean;
  timer: Timer;
};
```

Call-site changes:

- `onManifestParsed_`: `this.streams_ = buildStreams(event.manifest)`. The
  `manifest` reference is not retained on the controller.
- `tryStart_`:
  - `const types = new Set(this.streams_.map(s => s.type))` (unchanged).
  - For each type: `const stream = selectStream(this.streams_, preference);`
  - `this.player_.emit(Events.BUFFER_CODECS, { type, codec: stream.hierarchy.switchingSet.codec });`
  - Construct `MediaState` with only `stream` as the selection field.
- `onStreamPreferenceChanged_`:
  - `const stream = selectStream(this.streams_, preference);`
  - Codec-change check becomes
    `stream.hierarchy.switchingSet !== mediaState.stream.hierarchy.switchingSet`.
  - On change: `mediaState.stream = stream; mediaState.lastSegment = null;
    mediaState.lastInitSegment = null; this.update_(mediaState);`
- `update_` / `getNextSegment_`:
  `mediaState.stream.hierarchy.track.segments` replaces
  `mediaState.track.segments`.
- `getSegmentForTime_`: accepts the track argument as today; call site passes
  `mediaState.stream.hierarchy.track`.
- `destroy`: `this.streams_ = null` (no `manifest_` to null out).
- `getActiveStream(type)`: returns `mediaState.stream` — unchanged.
- `getStreams()`: returns `this.streams_` — unchanged.

The controller no longer imports `SwitchingSet` or `Track` as identifiers it
uses directly; they appear only through `Stream.hierarchy`.

### Load-Bearing Behavior

- **Codec-change detection for MSE `changeType`**:
  `stream.hierarchy.switchingSet !== mediaState.stream.hierarchy.switchingSet`.
  Both sides point to the same manifest's `SwitchingSet` object (because
  `buildStreams` does not copy), so reference equality is preserved exactly
  as today.
- **Stable `Stream` identity**: `streams_` is built once at
  `MANIFEST_PARSED` and held for the lifetime of the controller's manifest.
  Public `getStreams()` / `getActiveStream()` return references into the
  same array, as today.
- **Segment list identity**: `mediaState.stream.hierarchy.track` points to
  the manifest's own `Track` object; `track.segments` identity is unchanged.

### What is removed

- `this.manifest_` field on `StreamController`.
- `MediaState.switchingSet`, `MediaState.track` fields.
- `resolveHierarchy` function in `stream_utils.ts`.
- The `resolveHierarchy` test suite in
  `packages/cmaf-lite/test/utils/stream_utils.test.ts`.

### What is renamed

- `getStreams(manifest)` utility → `buildStreams(manifest)`. The name change
  signals that this function produces the canonical catalog (including
  hierarchy wiring), not just a flat projection. The public
  `Player.getStreams()` / `StreamController.getStreams()` methods are
  unchanged.

## Test Plan

- `test/utils/stream_utils.test.ts`:
  - Rename `describe("getStreams")` → `describe("buildStreams")`; assertions
    on shape stay the same except each stream now carries a `hierarchy`
    property. Add a check that `hierarchy.switchingSet` and `hierarchy.track`
    are references to the corresponding manifest objects (identity, not
    equality).
  - `describe("selectStream")`: unchanged — `selectStream` returns a
    `Stream` from the list. Fixtures will need to produce streams with
    `hierarchy` populated (via `buildStreams`, which is already how the
    suite constructs test streams).
  - `describe("resolveHierarchy")`: deleted.
- `test/media/stream_controller.test.ts` (and any integration-flavored
  controller tests): any test that reaches into `mediaState.switchingSet`
  or `mediaState.track` must be updated to read through
  `mediaState.stream.hierarchy`. Tests that exercise codec-change behavior
  on stream preference switch verify MSE `changeType` emission; these should
  pass without behavioral change.
- No new test categories required — this is a structural refactor. Existing
  coverage of the codec-change path and of `selectStream` dispatch is
  sufficient.

## Migration

Single commit, single PR. No staged migration needed because the only
consumers of `Stream` (the demo) use it as an opaque identifier —
`player.setStreamPreference(stream, true)` — and will continue to work
with stable refs. No consumer reads fields that are being removed.

## Risks

- **Serialization**: If any consumer serializes `Stream` (e.g., JSON round-
  trip), the new `hierarchy` property will be included and produce a
  cyclic-looking (but not actually cyclic) payload with segment data. The
  demo does not serialize streams. No known consumer does. If future
  serialization is needed, a projection helper can be added; not in scope.
- **Type surface growth**: `Stream` gains one property. `StreamHierarchy`
  is a new exported type. The public API surface expands by these two
  additions. Intentional.

## Open Questions

None outstanding at time of writing.

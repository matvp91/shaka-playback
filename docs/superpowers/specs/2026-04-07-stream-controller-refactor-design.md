# Stream Controller Refactor

Refactor `stream_controller.ts` to enforce single responsibility and add an
explicit state machine, using learnings from Shaka Player v2's
`streaming_engine.js` and hls.js's `stream-controller.ts`.

## Motivation

The stream controller currently leaks MSE concerns (mp4 box parsing,
timestamp offset computation) and uses implicit state tracking that allows
re-entry races and makes the flow hard to follow. This refactor:

- Moves all MSE-related logic to the buffer controller
- Introduces an explicit state machine per media type
- Simplifies the update loop and transition logic
- Fixes four latent bugs discovered during analysis

## Reference Analysis

### Shaka Player v2

Shaka v2's `streaming_engine.js` is tightly coupled to MSE — it manages
`timestampOffset`, append windows, buffer eviction, and `endOfStream()`
directly. Its synchronized period transitions and readiness gates
(`canSwitchStream_`, `canSwitchPeriod_`) solve problems we don't have:

- **Synchronized transitions**: Our buffer controller + operation queue
  already handles MSE coordination per type. No synchronization needed in
  the stream controller.
- **Readiness gates**: Shaka's `createSegmentIndex()` is async. Our
  segments are materialized upfront during DASH parsing.

**What we adopt**: The `MediaState_` pattern — a per-type struct that
tracks streaming cursor state with an explicit `performingUpdate` guard
against re-entry. We formalize this as a state machine.

### hls.js

hls.js uses an explicit state machine (`IDLE`, `FRAG_LOADING`,
`WAITING_LEVEL`, etc.) with a tick-based loop. Their `doTickIdle()` has a
multi-condition bail-out chain that only fetches when all preconditions
are met. We adopt the state machine pattern but keep our event-driven
architecture rather than polling.

## State Machine

### States

```ts
const enum State {
  STOPPED,         // Before startup or after media detach
  IDLE,            // Ready to make a fetch decision
  LOADING_INIT,    // Init segment fetch in flight
  LOADING_SEGMENT, // Media segment fetch in flight
  ENDED,           // All presentations exhausted for this type
}
```

### Transitions

```
STOPPED ──tryStart_()──► IDLE
                           │
              ┌────────────┤
              │            ▼
              │   buffer goal met? ── yes ──► IDLE (timer: recheck in 1s)
              │            │
              │            no
              │            ▼
              │   has next segment? ── yes ──► LOADING_SEGMENT
              │            │                      │
              │            no                     │ BUFFER_APPENDED
              │            ▼                      │
              │   has next presentation?          │
              │      │              │             │
              │     yes             no            │
              │      ▼              ▼             │
              │   LOADING_INIT    ENDED           │
              │      │                            │
              │      │ BUFFER_APPENDED            │
              └──────┴────────────────────────────┘

Any state ──onMediaDetached_──► STOPPED (timers cancelled)
```

One `MediaState` per media type. Audio and video fetch in parallel
(separate states), but within a type it's strictly sequential.

## MediaState

Cleaned up — pure streaming-sequencing struct, no MSE concerns:

```ts
type MediaState = {
  state: State;
  presentation: Presentation;
  selectionSet: SelectionSet;
  switchingSet: SwitchingSet;
  track: Track;
  lastSegment: Segment | null;
  lastInitSegment: InitSegment | null;
  timer: Timer;
};
```

### Removed fields

- `lastTimestampOffset` — MSE concern, moves to buffer controller
- `initSegmentMeta_` map on the class — MSE concern, moves to buffer
  controller

## Event Contract Changes

### `BufferAppendingEvent`

**Before:**

```ts
type BufferAppendingEvent = {
  type: MediaType;
  data: ArrayBuffer;
  timestampOffset?: number;
};
```

**After:**

```ts
type BufferAppendingEvent = {
  type: MediaType;
  initSegment: InitSegment;
  data: ArrayBuffer;
  segment?: Segment;
};
```

- `initSegment` is always present — buffer controller uses it as cache
  key for timescale
- `segment` present = media segment; absent = init segment
- `timestampOffset` removed — buffer controller derives it

No other events change.

## Responsibility Transfer to Buffer Controller

### What moves

- `parseTimescale()` — called when receiving an append without `segment`
  (init segment), result cached in a `Map<InitSegment, { timescale }>`
- `parseBaseMediaDecodeTime()` + offset computation — called when
  receiving an append with `segment` (media segment), formula:
  `segment.start - (baseMediaDecodeTime / timescale)`
- Timescale cache (`initSegmentMeta_` equivalent) — keyed by
  `InitSegment` reference
- Timestamp offset tracking per type — to avoid redundant
  `sb.timestampOffset` writes

### What's removed from stream controller

- `computeTimestampOffset_()` method
- `initSegmentMeta_` map
- `import { parseBaseMediaDecodeTime, parseTimescale }` — moves to
  buffer controller

## Simplified Update Loop

### `update_()`

Single top-down decision flow:

```ts
private update_(mediaState: MediaState): number | null {
  if (mediaState.state !== State.IDLE) {
    return null;
  }

  // Buffer goal check
  const currentTime = this.player_.getMedia()?.currentTime ?? 0;
  const bufferedEnd = this.player_.getBufferedEnd(
    mediaState.selectionSet.type,
  );
  if (bufferedEnd - currentTime >= this.player_.getConfig().bufferGoal) {
    return 1;
  }

  // Next segment from current track
  const nextSegment = this.getNextSegment_(mediaState);
  if (nextSegment) {
    mediaState.state = State.LOADING_SEGMENT;
    this.loadSegment_(mediaState, nextSegment);
    return null;
  }

  // Track exhausted — advance to next presentation
  this.advancePresentation_(mediaState);
  return null;
}
```

### `onBufferAppended_`

Calls `update_()` directly — state machine prevents re-entry. Only
transitions from `LOADING_INIT` or `LOADING_SEGMENT` to avoid
overwriting `ENDED` or `STOPPED`:

```ts
private onBufferAppended_ = (event: BufferAppendedEvent) => {
  const mediaState = this.mediaStates_.get(event.type);
  if (!mediaState) return;
  if (
    mediaState.state !== State.LOADING_INIT &&
    mediaState.state !== State.LOADING_SEGMENT
  ) {
    return;
  }
  mediaState.state = State.IDLE;
  this.update_(mediaState);
};
```

### `onUpdate_`

Only called from the timer (buffer-full recheck):

```ts
private onUpdate_(mediaState: MediaState) {
  const delay = this.update_(mediaState);
  if (delay !== null) {
    mediaState.timer.tickAfter(delay);
  }
}
```

### `scheduleUpdate_` — deleted

Timer used inline in `onUpdate_` only for buffer-full polling.
`onBufferAppended_` calls `update_()` directly.

## Transition and End-of-Stream Logic

### `getNextSegment_()` — pure, no side effects

Returns the next segment or `null`. Handles empty segments arrays
(returns `null`, triggering `advancePresentation_`):

```ts
private getNextSegment_(mediaState: MediaState): Segment | null {
  const { segments } = mediaState.track;
  if (!mediaState.lastSegment) {
    return segments[0] ?? null;
  }
  const lastIndex = segments.indexOf(mediaState.lastSegment);
  return segments[lastIndex + 1] ?? null;
}
```

### `advancePresentation_()` — replaces `transitionToNextPresentation_()`

- Finds next presentation; if none → `ENDED`, `checkEndOfStream_()`
- Validates matching SelectionSet, SwitchingSet, Track — **throws** on
  CMAF inconsistency (e.g., missing audio track in next presentation)
- Updates MediaState cursor, resets `lastSegment`
- Sets state to `LOADING_INIT`, calls `loadInitSegment_()`

### `checkEndOfStream_()` — simplified

Checks if all media states are in `ENDED` state. No more
`isTrackExhausted_()` re-derivation:

```ts
private checkEndOfStream_() {
  const allDone = [...this.mediaStates_.values()].every(
    (ms) => ms.state === State.ENDED,
  );
  if (allDone) {
    this.player_.emit(Events.BUFFER_EOS);
  }
}
```

### `isTrackExhausted_()` — deleted

Replaced by `ENDED` state.

## Cleanup Helpers

### `stopMediaStates_()`

Shared by `destroy()` and `onMediaDetached_`:

```ts
private stopMediaStates_() {
  for (const mediaState of this.mediaStates_.values()) {
    mediaState.state = State.STOPPED;
    mediaState.timer.stop();
  }
}
```

## Bugs Fixed

1. **Duplicate load race** — `BUFFER_APPENDED` during in-flight fetch
   could re-enter `update_()` and trigger a duplicate `loadSegment_()`.
   Fixed: `LOADING_*` state rejects re-entry.

2. **`BUFFER_EOS` never emitted with asymmetric presentations** —
   `isTrackExhausted_()` didn't check if next presentations have matching
   SelectionSets. Fixed: `ENDED` state set per type, `checkEndOfStream_`
   checks states directly.

3. **Silent hang with empty segments** — `getNextSegment_()` returned
   `null` without triggering a transition. Fixed: `update_()` calls
   `advancePresentation_()` when `getNextSegment_()` returns `null`.

4. **Media detach doesn't stop streaming** — `onMediaDetached_()` only
   nulled `media_`. Fixed: `stopMediaStates_()` sets `STOPPED` and
   cancels timers.

## Future Considerations

### Request cancellation

Add `AbortController | null` to `MediaState`. On cancel (quality switch,
seek, detach), abort in-flight fetch and reset to `IDLE`. State machine
supports this without structural changes.

### Preference API for track selection

Track selection (currently hardcoded to index 0 in `tryStart_()`) will be
replaced by a preference-based API (e.g., prefer 1080p, prefer ABR).
This is a separate concern from this refactor — the state machine
supports it via a future `switchTrack()` method that resets to `IDLE`
with a new track.

### Parallel segment prefetching

Currently one in-flight request per type. Prefetching could be added as
a side-channel alongside the state machine, similar to Shaka v4's
`segmentPrefetch`.

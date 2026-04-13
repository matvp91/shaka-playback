# BUFFER_FLUSHING Event — Design

## Problem

`Player.setStreamPreference` reaches directly into `BufferController.flush()`
to coordinate a buffer flush on stream switch. Two concerns:

- The player crosses the controller boundary — other controller interactions
  are event-driven, this one is a direct method call.
- The decision to flush lives in the player, but the information needed to
  decide correctly (whether a switch actually happened, and whether the type
  is AV) lives in `StreamController`. The player has to duplicate gating
  logic (`preference.type !== MediaType.TEXT`) that the controller already
  does via `isAV`.

## Goals

- Move the flush trigger into `StreamController`, where switch detection and
  `isAV` gating already live.
- Make `BufferController.flush` a private, event-triggered operation.
- Keep `Player.setStreamPreference` a thin pass-through that only emits an
  event.
- Preserve today's buffer-reset invariants on stream switch (segment state
  cleared before new fetches begin).

## Non-Goals

- Changing when the flush runs relative to the new-segment fetch (both
  remain async; the fetch starts immediately, the flush is enqueued on
  `opQueue` as today).
- Adding flush triggers outside the preference-change path (e.g., automatic
  flush on cross-switching-set transitions without an explicit
  `flushBuffer`).

## Design

### Event

```ts
// lib/events.ts
export type BufferFlushingEvent = {
  type: SourceBufferMediaType;
};

// EventMap
[Events.BUFFER_FLUSHING]: (event: BufferFlushingEvent) => void;
```

Naming: pairs with the existing past-tense `BUFFER_FLUSHED`. Present-
continuous signals "flush requested, in progress."

### `STREAM_PREFERENCE_CHANGED` payload gains `flushBuffer`

```ts
export type StreamPreferenceChangedEvent = {
  preference: StreamPreference;
  flushBuffer?: boolean;
};
```

The `flushBuffer` flag flows from `Player.setStreamPreference` through the
event payload into `StreamController`, which owns the decision to flush.

### Player

```ts
setStreamPreference(preference: StreamPreference, flushBuffer?: boolean) {
  this.emit(Events.STREAM_PREFERENCE_CHANGED, { preference, flushBuffer });
}
```

Player is now a pure pass-through for this path. Removed:

- Direct `this.bufferController_.flush(...)` call.
- `preference.type !== MediaType.TEXT` narrowing guard.
- Implicit dependency on `SourceBufferMediaType` for the flush type.

### StreamController

In `onStreamPreferenceChanged_`, emit `BUFFER_FLUSHING` after the switch is
committed, gated by both the incoming `flushBuffer` flag and `isAV`:

```ts
log.info("Switched stream", stream);
mediaState.stream = stream;
mediaState.lastSegment = null;
mediaState.lastInitSegment = null;

if (event.flushBuffer && isAV(mediaState.type)) {
  this.player_.emit(Events.BUFFER_FLUSHING, { type: mediaState.type });
}

this.update_(mediaState);
```

Placement notes:

- Emission is inside the switch path, which is only reached after the
  `stream === mediaState.stream` early-return. **A no-op preference change
  (same stream) no longer flushes.** See "Behavior change" below.
- Emission is after the codec-change check and the
  `mediaState.stream = stream` assignment, so that `update_` and any
  downstream consumers observe a consistent post-switch state.
- `isAV(mediaState.type)` re-uses the existing gate; the TEXT case never
  emits.

### BufferController

Flush becomes private, triggered only by the event.

```ts
// constructor
this.player_.on(Events.BUFFER_FLUSHING, this.onBufferFlushing_);

// destroy
this.player_.off(Events.BUFFER_FLUSHING, this.onBufferFlushing_);

private onBufferFlushing_ = (event: BufferFlushingEvent) => {
  this.flush_(event.type);
};

// rename flush -> flush_ (private); body unchanged
private flush_(type: SourceBufferMediaType) { /* ... */ }
```

Rename `flush` → `flush_` to make the event-driven boundary a compile-time
guarantee: no caller outside `BufferController` can trigger a flush without
emitting the event.

## Behavior Change

Under the current API, `player.setStreamPreference(samePreference, true)`
flushes the buffer even when no stream switch results. Under this design,
that call is a no-op — the event still fires but `StreamController`
short-circuits on `stream === mediaState.stream` before emitting
`BUFFER_FLUSHING`.

This is intentional: flushing-without-switching was an unintended
side-effect of the direct-call API, not a documented feature. No internal
caller relies on it. Worth a release note for external consumers.

If a future need arises for "flush without switching," the cleanest path is
a dedicated `player.flushBuffer(type)` method that emits `BUFFER_FLUSHING`
directly — not re-coupling it to preference changes.

## Regression Checks

- **Segment-state reset invariant**: `lastSegment` and `lastInitSegment` are
  cleared synchronously in `onStreamPreferenceChanged_` before emitting
  `BUFFER_FLUSHING`. When `BUFFER_FLUSHED` later fires,
  `onBufferFlushed_` re-clears them — a no-op on the switch path but still
  correct for future flush paths.
- **Flush vs. fetch ordering**: unchanged. Flush is enqueued on `opQueue`;
  `update_` fires synchronously after the emit. Both concurrency paths are
  identical to today.
- **`BufferController.flush` callers**: grep confirms the only current
  caller outside `BufferController` is `Player.setStreamPreference`, which
  is replaced by the event. Renaming to private `flush_` is safe.
- **Codec-change detection**: unaffected. The `BUFFER_CODECS` emit continues
  to precede any flush.

## Test Plan

### `stream_controller.test.ts` (new or extended)

- "emits BUFFER_FLUSHING when preference change causes a switch with
  `flushBuffer=true`" — spy on emit, trigger switch, assert event fires
  with the correct `type`.
- "does not emit BUFFER_FLUSHING when the preference change is a no-op"
  (same stream selected) — spy, trigger, assert no emit.
- "does not emit BUFFER_FLUSHING when `flushBuffer` is omitted or false" —
  spy, trigger switch without flag, assert no emit.
- "does not emit BUFFER_FLUSHING for non-AV switches" (guard by
  `isAV`) — currently unreachable since TEXT has no runtime projection;
  skip unless text plumbing lands first.

### `buffer_controller.test.ts` (new or extended)

- "flushes the SourceBuffer on BUFFER_FLUSHING event" — emit the event,
  assert `sourceBuffer.remove(0, Infinity)` is called and
  `BUFFER_FLUSHED` is emitted afterward.

### Existing tests

- `BUFFER_FLUSHED` handler in `StreamController` is unchanged; existing
  coverage sufficient.
- `Player.setStreamPreference` no longer calls `bufferController.flush`
  directly; any test asserting that call must be updated to assert the
  event flow.

## Migration

Single commit. No staged migration — internal consumers update together.
External consumers of `BufferController.flush` don't exist (the method is
only exposed through the package barrel if at all; verify during
implementation).

## Risks

- **Silent behavior change for no-op switch flush**: addressed above, flag
  in release notes.
- **Event ordering assumptions**: `BUFFER_FLUSHING` is emitted after
  `BUFFER_CODECS` (if any) in the same synchronous block. Consumers that
  listen to both must not assume flush precedes codec change.

# Unified Stream Switching

## Problem

`StreamController` has duplicated stream selection logic across `tryStart_` and
`setPreference`. Both select a stream via `StreamUtils.selectStream`, emit
`BUFFER_CODECS` when the codec changes, and update `MediaState`. This
duplication means stream-change side effects are scattered across two code
paths.

## Design

### New event: `STREAM_CHANGED`

Added to `Events` and `EventMap`:

```ts
STREAM_CHANGED: "streamChanged"
```

Payload:

```ts
export type StreamChangedEvent = {
  oldStream: Stream | null;
  stream: Stream;
};
```

`oldStream` is `null` on initial selection (from `tryStart_`), and the previous
`Stream` on preference-driven switches.

### `MediaState.stream` becomes nullable

```ts
type MediaState = {
  // ...
  stream: Stream | null;
  // ...
};
```

Initialized to `null`. `getActiveStream` already uses `assertExists`, so
callers that expect a non-null stream are covered.

### New private method: `switchStream_`

```ts
private switchStream_(mediaState: MediaState, stream: Stream): boolean
```

Encapsulates all stream-change logic:

1. Returns `false` if `stream === mediaState.stream` (no change).
2. Cancels any in-flight request on `mediaState`.
3. Checks codec change with explicit condition:
   ```ts
   const oldStream = mediaState.stream;
   if (!oldStream || oldStream.hierarchy.switchingSet !== stream.hierarchy.switchingSet) {
     if (isAV(mediaState.type)) {
       this.player_.emit(Events.BUFFER_CODECS, { ... });
     }
   }
   ```
4. Sets `mediaState.stream = stream`.
5. Resets `mediaState.lastSegment` and `mediaState.lastInitSegment` to `null`.
6. Logs the switch: `log.info("Switched stream", stream)`.
7. Emits `STREAM_CHANGED` with `{ oldStream, stream }`.
8. Returns `true`.

### Updated callers

**`tryStart_`:**

```ts
const mediaState: MediaState = {
  type,
  stream: null,
  ended: false,
  lastSegment: null,
  lastInitSegment: null,
  request: null,
  timer: new Timer(() => this.update_(mediaState)),
};
this.mediaStates_.set(type, mediaState);
this.switchStream_(mediaState, stream);
```

Timer setup (`tickEvery`) remains after the loop, unchanged.

**`setPreference`:**

```ts
const stream = StreamUtils.selectStream(streams, preference);
if (!this.switchStream_(mediaState, stream)) {
  return;
}

if (flushBuffer && isAV(mediaState.type)) {
  this.player_.emit(Events.BUFFER_FLUSHING, { type: mediaState.type });
}

this.update_(mediaState);
```

Early returns for missing `mediaState` / `streams_` stay in `setPreference`.

## Files changed

- `lib/events.ts` — add `STREAM_CHANGED`, `StreamChangedEvent`, `EventMap` entry
- `lib/media/stream_controller.ts` — nullable `MediaState.stream`, extract
  `switchStream_`, simplify `tryStart_` and `setPreference`
- Public re-exports if `StreamChangedEvent` should be part of the public API
- Tests covering the new event emission

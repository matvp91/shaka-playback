# StreamController Refactor — Design Spec

## Summary

Refactor StreamController to use per-stream timers, time-based segment selection, and cleaner init segment handling. This replaces the TaskLoop-driven tick loop with independent per-MediaState scheduling, removes the segmentIndex counter in favor of deriving the next segment from buffer state, and separates init segment loading from the streaming loop.

## Changes

### 1. Timer utility (`lib/utils/timer.ts`)

New class replacing `TaskLoop`:

```ts
new Timer(callback)
  .tickAfter(seconds)  // schedule callback after delay
  .tickNow()           // schedule with 0 delay
  .stop()              // cancel pending tick

timer.destroy()        // stop + nullify callback
```

- Single-shot: each `tickAfter`/`tickNow` cancels any pending tick before scheduling.
- Returns `this` for chaining.
- `TaskLoop` is deleted after migration.

### 2. MediaState (replaces StreamState)

```ts
type MediaState = {
  selectionSet: SelectionSet;
  track: Track;
  lastSegment: Segment | null;
  lastInitSegment: Segment | null;
  timer: Timer;
};
```

Key differences from `StreamState`:
- **No `segmentIndex`** — next segment derived from `bufferedEnd`.
- **No `initLoaded`** — covered by `lastInitSegment !== null`.
- **`lastSegment`** — reference to the last loaded media segment, used for next-segment lookup and end-of-stream detection.
- **`lastInitSegment`** — reference to the last loaded init segment, useful for future ABR track switching (to know if a new init segment is needed).
- **`timer`** — each MediaState owns its own Timer for independent scheduling.

### 3. Storage: `mediaStates_` Map

Replace `streams_: StreamState[]` with `mediaStates_: Map<string, MediaState>` keyed by content type (`selectionSet.type`, e.g. `"video"`, `"audio"`).

Benefits:
- Direct lookup by type instead of array iteration.
- Natural key for correlating with events (e.g. `BUFFER_APPENDED` carries `selectionSet`).

### 4. Init segment loading (on BUFFER_CREATED)

Init segments move out of the update loop:

1. `BUFFER_CREATED` fires after SourceBuffers are ready.
2. StreamController fetches all init segments in parallel.
3. After each init is appended (`BUFFER_APPENDED` for init), that MediaState's update timer starts.

This separates setup (init) from streaming (media segments) cleanly.

### 5. Update loop (per-MediaState)

Each MediaState's timer calls `update_(mediaState)`:

1. Find next segment: first segment in `track.segments` where `start >= bufferedEnd` for that stream.
2. If found and `bufferedEnd - currentTime < bufferGoal` — fetch and emit `SEGMENT_LOADED`.
3. On `BUFFER_APPENDED` for this stream — schedule next update via `timer.tickNow()` (if buffer still below goal) or `timer.tickAfter(delay)`.
4. If no next segment and `lastSegment` is the final segment — this stream is done.

End-of-stream (`BUFFER_EOS`) is emitted when all MediaStates have finished.

### 6. Removed concepts

- **`TaskLoop`** — replaced by `Timer`.
- **`segmentIndex`** — replaced by time-based segment selection.
- **`initLoaded`** — replaced by `lastInitSegment` null check.
- **`loading_` flag** — no longer needed; each stream is independent.
- **`streams_` array** — replaced by `mediaStates_` Map.

## Files affected

| File | Change |
|------|--------|
| `lib/utils/timer.ts` | New file |
| `lib/utils/task_loop.ts` | Deleted |
| `lib/controllers/stream_controller.ts` | Major refactor |
| `lib/controllers/buffer_controller.ts` | Add `type` to QueueItem and `BUFFER_APPENDED` emit |
| `lib/events.ts` | Remove `segmentIndex` from SegmentLoadedEvent, add `type` to BufferAppendedEvent |
| `example/main.ts` | Update to match event changes |

# StreamController Refactor — Design Spec

## Summary

Refactor StreamController to use per-stream timers, time-based segment selection, and cleaner init segment handling. This replaces the TaskLoop-driven tick loop with independent per-MediaState scheduling, removes the segmentIndex counter in favor of deriving the next segment from buffer state, and separates init segment loading from the streaming loop. Additionally, moves BufferController and events to use `TrackType` as the key instead of `SelectionSet`.

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

Replace `streams_: StreamState[]` with `mediaStates_: Map<TrackType, MediaState>` keyed by content type slot (`"video"`, `"audio"`, `"text"`).

The key represents a slot, not a specific SelectionSet. StreamController doesn't own track selection — it streams whatever is in the slot. Selection logic lives elsewhere (Player API, future ABR controller).

### 4. Events overhaul

- **`BUFFER_CODECS` → `TRACKS_SELECTED`** — renamed and simplified. Payload becomes `{ tracks: Track[] }` (was `{ tracks: { selectionSet, track }[] }`). Reusable for initial setup and future track switching.
- **`SegmentLoadedEvent`** — remove `segmentIndex`, remove `selectionSet`. Becomes `{ track: Track; data: ArrayBuffer }`.
- **`BufferAppendedEvent`** — replace `selectionSet` with `type: TrackType`. Becomes `{ type: TrackType }`.

### 5. BufferController: TrackType as key

- `sourceBuffers_: Map<TrackType, SourceBuffer>` (was `Map<SelectionSet, SourceBuffer>`)
- `getBufferedEnd(type: TrackType)` (was `getBufferedEnd(selectionSet)`)
- `QueueItem` uses `type: TrackType` instead of `selectionSet`
- Listens for `TRACKS_SELECTED` instead of `BUFFER_CODECS`

This removes all `SelectionSet` dependency from BufferController. It only needs `Track` (for codec info) and `TrackType` (for the slot key).

### 6. Init segment loading (on BUFFER_CREATED)

Init segments move out of the update loop:

1. `BUFFER_CREATED` fires after SourceBuffers are ready.
2. StreamController fetches all init segments in parallel.
3. After each init is appended (`BUFFER_APPENDED` for init), that MediaState's update timer starts.

This separates setup (init) from streaming (media segments) cleanly.

### 7. Update loop (three-layer pattern)

- **`update_(mediaState): number | null`** — does the streaming work (check buffer, find segment, load). Returns seconds to wait before next update, or `null` if no reschedule needed.
- **`onUpdate_(mediaState)`** — timer callback. Calls `update_()`, feeds the result to `scheduleUpdate_()`.
- **`scheduleUpdate_(mediaState, delay)`** — schedules the next `onUpdate_` call via `mediaState.timer.tickAfter(delay)`. Entry point for external triggers (buffer appended, seeking).

End-of-stream (`BUFFER_EOS`) is emitted when all MediaStates have finished.

### 8. Removed concepts

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
| `lib/events.ts` | Rename BUFFER_CODECS → TRACKS_SELECTED, simplify payloads, use TrackType |
| `lib/controllers/buffer_controller.ts` | Key by TrackType, listen for TRACKS_SELECTED |
| `lib/controllers/stream_controller.ts` | Major refactor: MediaState, per-stream timers, time-based segments |
| `lib/player.ts` | `getBufferedEnd(type: TrackType)` |
| `example/main.ts` | Update to match event changes |

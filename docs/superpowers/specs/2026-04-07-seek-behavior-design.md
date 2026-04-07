# Seek Behavior & Time-Based Streaming

## Problem

When the user seeks, the StreamController continues buffering sequentially from `lastSegment` rather than loading segments at the new playhead position. The controller uses a sequential segment lookup (`getNextSegment_`) and is tightly coupled to BufferController via `BUFFER_APPENDED` events.

## Design

### Buffer Utility

New file `lib/utils/buffer.ts` with two pure functions operating on the native `TimeRanges` API:

- **`getBufferInfo(buffered: TimeRanges, pos: number): { start: number; end: number } | null`** — returns the buffered range containing `pos`, or `null` if `pos` is in a gap or unbuffered.

StreamController reads `this.media_.buffered` directly. No buffer queries flow through Player or BufferController.

**Cleanup:** Remove `getBufferedEnd` from Player and BufferController.

### Time-Based Segment Lookup

Replace `getNextSegment_(mediaState)` with `getSegmentForTime(track, time)`:

- Binary search the track's `segments` array for the segment where `segment.start <= time < segment.end`.
- Returns `Segment | null`.

### Update Loop

`update_()` flow:

1. Early return if `state !== IDLE`.
2. Get `currentTime` from `this.media_`.
3. Get buffer info at `currentTime` via `getBufferInfo(this.media_.buffered, currentTime)`.
4. Determine `lookupTime`:
   - Buffered at playhead → `bufferInfo.end` (extend from end of contiguous range).
   - Not buffered at playhead → `currentTime` (need data here).
5. If buffered and `bufferInfo.end - currentTime >= bufferGoal` → return (goal met, next tick handles it).
6. Resolve Presentation for `lookupTime` — if it differs from current, update the full MediaState chain and load init segment if changed (set `state = LOADING`, return — next tick handles media segment).
7. `getSegmentForTime(track, lookupTime)` → set `state = LOADING`, fetch and emit `BUFFER_APPENDING`.

### Presentation Resolution

Replace `advancePresentation_()` with `resolvePresentation_(time)`:

- Scan `manifest.presentations` for the Presentation where `presentation.start <= time < presentation.end`.
- If different from `mediaState.presentation`, update the full chain: `presentation` → `selectionSet` (by media type) → `switchingSet` → `track`.
- Load init segment if it changed (compare against `lastInitSegment`).
- Handles both forward and backward seeks across Period boundaries.

### Interval-Based Scheduling

Replace event-driven scheduling with a 100ms polling interval (same pattern as hls.js):

- Each MediaState's timer runs on a 100ms interval.
- Starts when streaming begins, stops on media detach / destroy.
- `update_()` runs every tick — no longer triggered by buffer events.

### State Machine

4-state enum replacing the current 5-state:

| State | Purpose |
|-------|---------|
| `STOPPED` | Inactive — media detached or destroyed |
| `IDLE` | Ready to make streaming decisions |
| `LOADING` | Fetch in-flight (init or media segment) |
| `ENDED` | All presentations exhausted |

### MediaState Changes

- Drop `lastSegment` — time-based lookup replaces sequential.
- Keep `lastInitSegment` — used for init segment caching (skip re-append if unchanged).

### Event Listener Cleanup

**Remove:**
- `BUFFER_APPENDED` listener — interval replaces event-driven scheduling.
- `BUFFER_CREATED` listener — interval naturally picks up buffer readiness.

**Keep:**
- `MANIFEST_PARSED` — lifecycle event.
- `MEDIA_ATTACHED` — lifecycle event.
- `MEDIA_DETACHED` — lifecycle event.

### Fetch Lifecycle

- Set `state = LOADING` before fetch.
- Set `state = IDLE` after emitting `BUFFER_APPENDING` (segment handed off to BufferController).

### Seek Behavior (Emergent)

No explicit seek handling needed. The time-based lookup naturally handles seeks:

- **Seek within buffered range:** `bufferInfo.end - currentTime >= bufferGoal` check handles it — no new segments needed.
- **Seek to unbuffered position:** `isBufferedAt` returns false → `lookupTime = currentTime` → segment lookup finds the right segment.
- **Seek across Period boundary:** `resolvePresentation_` detects the new Presentation and updates the MediaState chain.

Existing buffered data is never flushed on seek.

## Future Work

- Replace `LOADING` state with `AbortController` storage for fetch cancellation on seek (abort wasted work for a position we've moved away from).

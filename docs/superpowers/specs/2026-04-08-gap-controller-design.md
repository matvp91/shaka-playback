# Gap Controller Design

## Problem

After seeking, H.264 composition time offsets (CTO) create a small gap
between `currentTime` and the first buffered frame. For example, seeking
to 640.895s produces a buffer starting at 641.066s — a 0.17s gap. This
causes two failures:

1. **Re-fetch loop**: `update_()` in StreamController sees
   `bufferEnd === null` (gap exceeds `maxBufferHole`), resets
   `lastSegment` to null, and re-fetches the same segment forever.
2. **Playback stall**: The video element can't play because
   `currentTime` is before the buffered range.

hls.js handles this with a dedicated GapController that nudges
`currentTime` past gaps. The CMAF passthrough path in hls.js does NOT
compensate for CTO in `timestampOffset` — the gap is expected behavior.

## Solution

Two changes:

### 1. Remove aggressive `lastSegment` reset

Remove lines 158-160 in `stream_controller.ts`:

```typescript
if (bufferEnd === null) {
  mediaState.lastSegment = null;
}
```

`lastSegment` is already reset on seek (`onSeeking_`). This line
conflates "buffer evicted" with "buffer has CTO gap", causing the
re-fetch loop. Removing it fixes the loop. Buffer eviction handling
can be added later as a separate concern.

### 2. New GapController

A standalone polling controller that detects playback stalls caused
by gaps in the buffer and nudges `currentTime` past them.

#### Constants

| Name | Value | Notes |
|---|---|---|
| `MAX_START_GAP_JUMP` | 2.0s | Max gap size to jump (matches hls.js) |
| `SKIP_BUFFER_HOLE_PADDING` | 0.1s | Padding added when seeking past a gap |
| `TICK_INTERVAL` | 0.1s | Polling interval |

#### State

| Field | Type | Purpose |
|---|---|---|
| `lastCurrentTime_` | `number` | Previous tick's `currentTime` |
| `moved_` | `boolean` | Whether playhead has ever advanced |
| `stalled_` | `number \| null` | Timestamp when stall was first detected |

#### Lifecycle

- Registered like other controllers in Player
- Listens for `MEDIA_ATTACHED`: stores media reference, starts timer
- Listens for `MEDIA_DETACHED`: stops timer, clears state
- Listens for media element `seeking`: sets `moved_ = false`, clears
  stall state
- Listens for media element `seeked`: clears stall state

#### `poll()` decision tree

```
1. currentTime !== lastCurrentTime_?
   → Playhead moved. Set moved_ = true, clear stall. Return.

2. Seeking, paused, or ended?
   → Return (don't interfere).

3. No buffered data at all?
   → Return (nothing to nudge to).

4. !moved_ && stalled_ !== null?
   → Start/seek gap. Find next buffered range start.
     If gap <= MAX_START_GAP_JUMP:
       Seek to rangeStart + SKIP_BUFFER_HOLE_PADDING.
     Return.

5. stalled_ === null?
   → First stall detection. Record timestamp. Return.
     (Debounce: give browser one tick to self-resolve.)

6. stalled_ !== null (confirmed stall)?
   → trySkipBufferHole_(): find next buffered range,
     seek past gap + padding.
```

#### `trySkipBufferHole_()`

Finds the first buffered range whose start is after `currentTime`.
If the gap is <= `MAX_START_GAP_JUMP` (2.0s), seeks to
`rangeStart + SKIP_BUFFER_HOLE_PADDING`.

Uses `getBufferInfo` from `utils/buffer.ts` with `maxBufferHole`
config to determine the current buffer state, and the raw
`media.buffered` TimeRanges to find the next range start.

#### What it does NOT handle (deferred)

- Nudge inside buffered data (browser decoder stalls)
- Fragment tracker integration
- Chrome-specific video pipeline workaround
- End-of-stream synthesis
- Stall reporting events

These can be added incrementally as needed.

## File changes

| File | Change |
|---|---|
| `lib/controllers/stream_controller.ts` | Remove `bufferEnd === null → lastSegment = null` (3 lines) |
| `lib/controllers/gap_controller.ts` | New file (~60-70 lines) |
| `lib/player.ts` | Register GapController |

## References

- hls.js `gap-controller.ts`: proven pattern, handles same scenarios
- hls.js CMAF passthrough does NOT compensate CTO in timestampOffset
- `MAX_START_GAP_JUMP` (2.0s) and `SKIP_BUFFER_HOLE_PADDING` (0.1s)
  match hls.js constants

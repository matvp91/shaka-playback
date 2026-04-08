# End-of-Stream Detection & StreamController Cleanup

## Problem

When all segments across all presentations have been loaded, `StreamController`
enters an infinite no-op loop on its 100ms tick. The root cause is
floating-point precision: `SourceBuffer.buffered` reports times like 45.032999
instead of 45.033, so `bufferEnd` never exactly reaches the last presentation's
end. This means:

1. `bufferEnd - currentTime < bufferGoal` remains true (buffer check fails)
2. `resolvePresentation_(lookupTime)` still finds the last presentation
3. `getNextSegment_()` returns null (no more segments)
4. State stays `IDLE` — never transitions to `ENDED`
5. `BUFFER_EOS` is never emitted, `MediaSource.endOfStream()` is never called

The player continues playback but the front buffer drains without the stream
being properly finalized.

Additionally, presentation advancement has a similar float-precision issue and
does not handle gaps between presentations.

## Prior Art

- **Shaka v2**: Uses `timeUntilEnd < 1e-6` (one microsecond tolerance) to
  detect content end, bypassing float precision issues.
- **hls.js**: Uses a `FragmentTracker` that records per-fragment load state and
  checks if the endlist fragment has been buffered. More robust but heavier.

## Solution

### 1. Presentation advancement via segment exhaustion

When `getNextSegment_()` returns null (sequential path, current presentation
exhausted), call `resolvePresentation_()` with `presentation.end` as the time.
This advances to the next presentation without depending on float-precision
buffer times. The next tick handles init segment + first segment load.

If `resolvePresentation_()` returns false, there is no next presentation —
the media type has reached end of content.

### 2. EOS detection for the seek path

When `getSegmentForTime_()` returns null (seek path, no `lastSegment`), check
if `lookupTime` is within `1e-6` of the total duration. If so, set `ENDED`.
This is the float-precision tolerance from Shaka v2, only needed when we
don't have sequential segment tracking to rely on.

### 3. Gap-tolerant `getPresentationForTime_()`

Simplify from:

```typescript
if (time >= p.start && time < p.end) return p;
```

To:

```typescript
if (time < p.end) return p;
```

Since presentations are ordered, the first one whose end is past our time is
correct. This handles:
- Exact containment (works as before)
- Gaps between presentations (snaps forward to next)
- Float precision at boundaries

### 4. MediaState simplification

Remove `selectionSet` and `switchingSet` from `MediaState`. These are
intermediate manifest levels that were cached but rarely read:

- `selectionSet` was only read for `.type`
- `switchingSet` was only read once in `tryStart_()` for codec info

New MediaState:

```typescript
type MediaState = {
  state: State;
  type: MediaType;
  request: Request<"arraybuffer"> | null;
  presentation: Presentation;
  track: Track;
  lastSegment: Segment | null;
  lastInitSegment: InitSegment | null;
  timer: Timer;
};
```

`type` is set once from `selectionSet.type` in `tryStart_()`. When ABR or
presentation changes need `selectionSet`/`switchingSet`, they walk from
`presentation` using `type`:

```typescript
const selectionSet = presentation.selectionSets.find(
  (s) => s.type === mediaState.type,
);
const switchingSet = selectionSet.switchingSets[0];
```

### 5. Simplify `resolvePresentation_()`

With `selectionSet` and `switchingSet` removed from MediaState, the method
only needs to update `presentation` and `track`. The selectionSet/switchingSet
walk happens inline but is no longer stored.

## Updated `update_()` null-segment handling

```typescript
if (!segment) {
  if (mediaState.lastSegment) {
    // Sequential path: all segments in current
    // presentation exhausted. Advance to the next
    // presentation by resolving at the boundary.
    this.resolvePresentation_(mediaState, mediaState.presentation.end);
    return;
  }

  // Seek path: no segment found at lookupTime.
  // SourceBuffer.buffered has limited float precision,
  // so bufferEnd may never exactly reach the duration.
  // A microsecond tolerance (Shaka v2) prevents an
  // infinite no-op loop when all content is buffered.
  const duration = this.computeDuration_();
  if (lookupTime >= duration - 1e-6) {
    mediaState.state = State.ENDED;
    this.checkEndOfStream_();
  }
  return;
}
```

## What this doesn't change

- No new classes or data structures
- No changes to buffer eviction or append logic
- `getNextSegment_()` stays pure (current track only)
- `getSegmentForTime_()` unchanged

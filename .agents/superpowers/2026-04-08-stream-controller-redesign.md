# StreamController Redesign & SegmentFetch

## Problem

The StreamController's tick loop calls `resolvePresentation_()` on every tick
using `lookupTime` (derived from `bufferEnd`). This fights with sequential
presentation advancement because SourceBuffer reports buffer times with float
imprecision — `bufferEnd` can be 45.032999 instead of 45.033, snapping the
presentation back to the previous one every tick and creating an infinite loop.

Additionally, segment fetching, error handling, and buffering decisions are
tangled in a single method, making it hard to evolve the architecture toward
prefetching and per-presentation buffer strategies.

## Prior Art & Learnings

- **Shaka v2**: Separates "what period do I need?" from "fetch from that
  period". Period transitions are explicit events, not per-tick resolves.
  Synchronizes transitions across types for MSE correctness (timestampOffset
  and appendWindow are period-scoped).
- **hls.js**: Uses a FragmentTracker for EOS detection. Queues `changeType()`
  as a per-type operation. Audio blocked until video catches up during codec
  transitions.

**Our architecture differs**: timestampOffset is computed per-segment from
mp4 container data, not per-period. We don't use appendWindow. So cross-type
synchronization is not needed for MSE correctness. Independent per-type
advancement is safe.

## Solution

Two changes: extract segment fetching into `SegmentFetch`, and rewrite the
StreamController tick loop to never resolve presentations per tick.

### SegmentFetch

**File:** `lib/controllers/segment_fetch.ts`

One instance per media type. Wraps native `fetch()` + `AbortController` with
an internal cache. The StreamController never touches network requests
directly.

**API:**
- `fetch(segment: Segment | InitSegment): Promise<ArrayBuffer>` — check
  cache, if hit resolve immediately and evict entry. If miss, fetch from
  network. Implicitly cancels any previous in-flight request.
- `cancel()` — abort in-flight request, clear entire cache.
- `isLoading(): boolean` — whether a request is in-flight.

**Internals:**
- Cache: `Map<string, ArrayBuffer>` keyed by URL.
- Uses `AbortController` for cancellation. AbortError propagates to caller.
- On `fetch()`: new `AbortController` replaces the previous one (implicit
  cancel of prior request).
- On `cancel()`: abort current controller, clear cache map.
- Later additions: `prefetch()` to populate cache ahead of time.

### StreamController

**File:** `lib/controllers/stream_controller.ts`

#### MediaState

```typescript
type MediaState = {
  type: MediaType;
  ended: boolean;
  presentation: Presentation;
  track: Track;
  lastSegment: Segment | null;
  lastInitSegment: InitSegment | null;
  fetch: SegmentFetch;
  timer: Timer;
};
```

Removed vs current: `state` enum (replaced by `ended` boolean),
`request` (owned by SegmentFetch).

#### update_() flow

The tick loop is synchronous. It kicks off async work (fetch + append) but
does not await in the loop itself. `isLoading()` prevents re-entry.

1. **Guard**: `ended` or `fetch.isLoading()` → return.
2. **Buffer check**: `bufferEnd - currentTime >= bufferGoal` → return.
3. **Buffer lost**: if `bufferEnd === null` → reset `lastSegment`, resolve
   presentation from `currentTime`.
4. **Compute lookupTime**: `bufferEnd ?? currentTime`.
5. **Find segment**: `lastSegment` → `getNextSegment_()`, otherwise →
   `getSegmentForTime_(track, lookupTime)`.
6. **Segment exhaustion (sequential path)**: segment is null and
   `lastSegment` exists → call `resolvePresentation_(mediaState,
   presentation.end)` to advance. Return. Next tick picks up init segment
   and first segment of new presentation.
7. **EOS (seek path)**: segment is null and no `lastSegment` →
   `lookupTime >= duration - 1e-6` → set `ended = true`,
   `checkEndOfStream_()`.
8. **Init segment**: if `track.initSegment !== lastInitSegment` → fetch
   init segment, append, set `lastInitSegment`. Return.
9. **Media segment**: set `lastSegment`, fetch segment, append.

Steps 8 and 9 call an async helper that awaits SegmentFetch, catches
AbortError (silently returns), and emits `BUFFER_APPENDING`.

#### Presentation transitions

Presentations are set at four explicit points only. The tick loop never
resolves the presentation. Each transition uses `getPresentationForTime_()`
and `getTrackForType_()` as pure lookups, with mutations inline at the
call site.

1. **`tryStart_()`** — initial setup from first presentation.
2. **`onSeeking_()`** — cancel fetch, resolve from `currentTime`.
3. **Segment exhaustion** — resolve at `presentation.end` to advance
   to next, or set `ended = true` if no next presentation.
4. **Buffer lost** (`bufferEnd === null`) — resolve from `currentTime`.

#### getPresentationForTime_()

Gap-tolerant: returns first presentation whose end is past the given time.
Handles gaps between presentations and float-precision at boundaries.

```typescript
for (const p of this.manifest_.presentations) {
  if (time < p.end) {
    return p;
  }
}
return null;
```

#### Removed from StreamController

- `resolvePresentation_()` — removed entirely. Presentation transitions
  are now explicit inline mutations at the call sites, using pure lookups
  `getPresentationForTime_()` and `getTrackForType_()`.
- `loadInitSegment_()` and `loadSegment_()` methods — replaced by
  inline SegmentFetch calls + AbortError catch.
- `onBufferAppended_` listener — was only clearing `request`.
- `State` enum — replaced by `ended` boolean on MediaState.
- All error handling except AbortError (deferred to later design).

#### New methods

- `getTrackForType_(presentation, type)` — pure lookup. Walks
  `selectionSets → switchingSets → tracks`, returns first track.
  Same chain as the old `resolvePresentation_()` but with no mutations.

#### Kept unchanged

- `getNextSegment_()` — within current track only.
- `getSegmentForTime_()` — binary search with tolerance.
- `getPresentationForTime_()` — gap-tolerant, pure lookup.
- `checkEndOfStream_()` and `computeDuration_()`.

### Future extension points

**Presentation boundary handler**: Step 6 is where a configurable strategy
hooks in. Today it just advances. Later it can:
- **Continue** (current): advance presentation, keep appending.
- **Reset**: clear SourceBuffer, re-append init, then start new
  presentation. Configurable per MSE implementation.

**changeType()**: When presentations have different codecs, the boundary
handler queues `changeType()` on the OperationQueue before appending the
new init segment. Per-type, no cross-type synchronization needed.

**Prefetch**: SegmentFetch gains a `prefetch()` method that populates its
cache. The StreamController (or a separate controller) calls it for
upcoming segments. `fetch()` resolves immediately from cache.

## What this doesn't change

- Manifest model (Presentation, SelectionSet, SwitchingSet, Track, Segment).
- BufferController — still receives `BUFFER_APPENDING` events.
- OperationQueue — still serializes SourceBuffer operations.
- `Request` class in `lib/utils/request.ts` — no longer used by
  StreamController but kept for ManifestController.

# Buffer Quota Exceeded Protection

Research and design decisions for handling `QuotaExceededError` during
`SourceBuffer.appendBuffer()`.

## How hls.js handles it

Three-tier escalation in `buffer-controller.ts`:

**Tier 1 — Targeted back-buffer eviction.** On `QuotaExceededError`,
`FragmentTracker.getBackBufferEvictionEnd()` walks tracked fragments
before `currentTime`, accumulating byte sizes until `>= data.byteLength`.
Returns eviction end time. Inserts `[remove(0, evictEnd), retry-append,
clear-flag]` into the operation queue. One attempt per type before
escalating (gated by `_quotaEvictionPending[type]`).

**Tier 2 — Aggressive trim + config reduction.** Emits
`BUFFER_FULL_ERROR` (never fatal for quota errors). `trimBuffers(frag.start, 1)`
aggressively trims back buffer to ~1 segment behind playhead.
`StreamController.reduceMaxBufferLength()` permanently halves
`maxMaxBufferLength` to prevent future over-fetching. No forward buffer
eviction — forward buffer shrinks naturally as playback consumes it.

**Tier 3 — Quota errors are never fatal in hls.js.**
`event.fatal = !isQuotaError` is always false. Retries indefinitely.

### FragmentTracker pruning

hls.js does not use explicit pruning. On every `BUFFER_APPENDED` event,
`detectEvictedFragments()` reconciles all tracked fragments against
`SourceBuffer.buffered`. If a fragment's PTS range is no longer present
in `buffered`, it's removed from tracking. No coupling to `sb.remove()`
call sites.

### maxBufferLength vs maxMaxBufferLength

hls.js dynamically computes the effective buffer goal based on bitrate:
`effectiveGoal = min(max((8 * maxBufferSize) / bitrate, maxBufferLength), maxMaxBufferLength)`.
Low bitrate streams get deeper buffers. `maxMaxBufferLength` (600s) is
the ceiling. On quota error, the ceiling is halved — not the floor.
This split is not needed in cmaf-lite since we have a single static
`frontBufferLength`.

## How Shaka Player handles it

Single mechanism via `bufferingScale_` (starts at 1.0). On quota error,
the scale is reduced: 80% → 60% → 40% → 20% → 16% → 12% → 8% → 4% →
fail. Both `frontBufferLength` and `backBufferLength` are multiplied by the scale.
After reducing, `evict_()` trims behind the playhead using the new
(smaller) `backBufferLength`. Schedules retry 4 seconds later (not
immediate). Scale never recovers during a session.

Does not work with `backBufferLength: Infinity` (our default) since
`Infinity * 0.6 = Infinity`.

## Design decisions for cmaf-lite

- **SegmentTracker** — new passive class tracking `{start, end, byteLength}`
  per appended media segment. Populated on `BUFFER_APPENDED`. Pruned via
  reconciliation against `SourceBuffer.buffered` (hls.js approach, no
  explicit pruning at `sb.remove()` sites).
- **Tier 1** — evict minimum back buffer to fit failed segment, using
  SegmentTracker byte data. Retry append via operation queue insertion.
- **Tier 2** — aggressive back-buffer trim to ~1 segment behind
  playhead. Emit `BUFFER_ERROR`.
- **No forward buffer eviction** — forward buffer shrinks naturally.
- **No `frontBufferLength` scaling** — the two eviction tiers plus natural
  forward buffer consumption handle quota pressure.
- **Never fatal** — retry indefinitely (matches hls.js).
- **QuotaExceededError detection** — `error.name === 'QuotaExceededError'`
  plus `error.code === DOMException.QUOTA_EXCEEDED_ERR` for
  cross-browser safety.

## Implementation surface

- `OperationQueue` — add `onError` callback to `Operation` type.
  `executeNext_()` calls `onError(error)` instead of silently catching.
  Add `insertNext(type, operations)` to insert at front of queue.
- `BufferController` — supply `onError` in `onBufferAppending_` that
  detects `QuotaExceededError` and runs the two-tier eviction.
  Per-type `quotaEvictionPending` flag to gate tier 1 → tier 2.
- `SegmentTracker` — new file (`segment_tracker.ts`). Tracks appended
  segments, answers "how much to evict for N bytes", self-prunes via
  `SourceBuffer.buffered` reconciliation.
- `StreamController` — no changes needed. The `update_()` loop
  naturally pauses when buffer is sufficient.
- `Events` — add `BUFFER_ERROR` event.

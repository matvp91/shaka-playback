# Buffer Management

MSE buffer pipeline — fetch scheduling, SourceBuffer
serialization, and quota recovery.

## Buffer Goal

StreamController ticks per media type every 100ms. Each tick
computes `bufferEnd` by merging adjacent buffered ranges with
gaps < `maxBufferHole` (0.1s). If
`bufferEnd - currentTime < frontBufferLength`, fetch the next
segment. Once all segments are appended, emit `BUFFER_EOS` →
`MediaSource.endOfStream()`.

## Operation Queue

MSE requires one operation at a time per SourceBuffer.
OperationQueue serializes append, remove, and duration updates.

- `enqueue(type, op)` — push, execute immediately if idle
- `shiftAndExecuteNext(type)` — on `updateend`, shift + run next
- `insertNext(type, ops)` — prepend (quota recovery)
- `block(type)` — resolves when prior ops complete

Operations carry `execute`, `onComplete`, and `onError`
callbacks. `onError` catches throws from `execute`, preventing
the queue from stalling on an `updateend` that never fires.

## Timestamp Offset

Computed per append from MP4 container metadata. Parse `mdhd`
→ `timescale`, parse `tfdt` → `baseMediaDecodeTime`.
`timestampOffset = segment.start - (baseMediaDecodeTime / timescale)`.
Aligns decode times with the presentation timeline.

## Back Buffer Eviction

After each append, if `backBufferLength` is finite, remove
data behind `currentTime - backBufferLength`. Default is
`Infinity` — no auto-eviction; data persists until quota
pressure triggers recovery.

## Segment Tracking

SegmentTracker records `{start, end, byteLength}` per append.
`getEvictionEnd(type, currentTime, bytesNeeded)` walks
segments before `currentTime`, accumulating bytes, returning
the end time once coverage ≥ `bytesNeeded`. `reconcile(type,
buffered)` prunes entries no longer in `SourceBuffer.buffered`
(0.2s tolerance). Runs after every append, no coupling to
`sb.remove()` call sites.

## Quota Exceeded Recovery

Two-tier escalation on `QuotaExceededError`:

**Tier 1 — Targeted eviction.** SegmentTracker computes
minimum back-buffer removal to fit the failed segment. Inserts
`[remove(start, evictEnd + backBufferQuotaPadding), retry,
clear-flag]` at queue front. Per-type `quotaEvictionPending`
flag gates one attempt before escalating.

**Tier 2 — Aggressive trim.** Emits `BUFFER_APPEND_ERROR`.
Trims back buffer to ~1 segment behind playhead. Inserts
`[remove, retry]`, resets flag for future tier 1 attempts.

No forward buffer eviction — forward buffer shrinks naturally.
No `frontBufferLength` scaling. Never fatal — retries
indefinitely.

## Gap Recovery

GapController polls at 100ms. On stall (currentTime unchanged
two consecutive ticks, not paused): find next buffered range
start. If gap ≤ 2s, jump to `rangeStart + 0.1s`. If > 2s,
stay stalled. One-tick grace period lets the browser
self-resolve transient stalls.

## Configuration

See [`PlayerConfig`](/cmaf-lite/reference/cmaf-lite.playerconfig/)
for buffer-related settings and their defaults.

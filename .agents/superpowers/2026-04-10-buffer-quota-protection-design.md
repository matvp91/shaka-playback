# Buffer Quota Exceeded Protection

Handle `QuotaExceededError` during `SourceBuffer.appendBuffer()` to
continue playback without fatal errors.

## Research Summary

### hls.js approach
- **Tier 1:** Targeted back-buffer eviction using `FragmentTracker`
  byte sizes. Evicts minimum bytes to fit the failed segment. Inserts
  `[remove, retry-append]` into the operation queue.
- **Tier 2:** Aggressive back-buffer trim to ~1 segment behind
  playhead. Emits `BUFFER_FULL_ERROR`. Permanently halves
  `maxMaxBufferLength` to reduce future fetching.
- **Tier 3:** Quota errors are never fatal. Retries indefinitely.
- **Fragment pruning:** Reconciliation against `SourceBuffer.buffered`
  on every `BUFFER_APPENDED` — no explicit pruning at `sb.remove()`
  call sites.
- **No forward buffer eviction.** Forward buffer shrinks naturally
  through playback consumption.

### Shaka Player approach
- Single `bufferingScale_` (1.0 → 0.8 → 0.6 → ... → 0.04 → fail).
  Scales both `bufferGoal` and `bufferBehind`. Does not work with
  `bufferBehind: Infinity`. Permanent for session. 4-second delay
  between retries.

### Key takeaways
- hls.js byte-based eviction is more precise than Shaka's scale
  approach and works with `backBufferLength: Infinity`.
- Reconciliation-based pruning is simpler and self-healing compared
  to explicit pruning at every `sb.remove()` site.
- No player evicts forward buffer on quota errors.
- `bufferGoal` scaling is unnecessary when back-buffer eviction and
  natural forward buffer consumption handle the pressure.

## Design

### Config changes

Rename existing config values for clarity:

| Current | New |
|---|---|
| `bufferGoal` | `frontBufferLength` |
| `bufferBehind` | `backBufferLength` |

New config value:

| Name | Default | Description |
|---|---|---|
| `backBufferQuotaPadding` | 2 | Extra seconds added to eviction target during quota recovery, creating headroom to avoid immediate re-trigger |

### New file: `lib/media/segment_tracker.ts`

Passive tracker storing `{start, end, byteLength}` per media type for
each appended media segment.

**Population:** On `BUFFER_APPENDED`, if `segment` is non-null, push
the entry.

**Pruning:** On each append or query, reconcile entries against
`SourceBuffer.buffered`. Discard entries whose time range is no longer
present in `buffered`.

**Query:** `getEvictionEnd(type, currentTime, bytesNeeded)` — walks
entries before `currentTime` oldest-first, accumulating byte sizes
until `>= bytesNeeded`. Returns eviction end time, or `0` if
insufficient back buffer.

### Changes to `lib/media/operation_queue.ts`

1. **`onError` callback on `Operation` type.** `executeNext_()` calls
   `operation.onError(error)` when the execute throws, instead of
   silently dropping. Falls back to current behavior if no `onError`
   provided.

2. **`insertNext(type, operations)` method.** Inserts operations at
   position `[0]` in the queue, ahead of pending operations. Used to
   queue `[remove, retry-append]` sequences.

### Changes to `lib/media/buffer_controller.ts`

**State:** `quotaEvictionPending_: Set<MediaType>` — tracks whether
tier 1 was attempted for a given type.

**Tier 1 — Targeted eviction + retry.**
On `QuotaExceededError` when type is NOT in `quotaEvictionPending_`:
1. Query `SegmentTracker.getEvictionEnd(type, currentTime, data.byteLength)`
2. Add `backBufferQuotaPadding` to the result, clamped to `currentTime`
3. If `evictionEnd > 0`: add type to `quotaEvictionPending_`, insert
   `[remove(bufferStart, evictionEnd), retry-append]` via `insertNext`.
   The retry-append operation carries an `onComplete` that removes the
   type from `quotaEvictionPending_`. If the retry throws again, its
   `onError` fires and enters tier 2.
4. If `evictionEnd === 0` (no back buffer to evict): fall through to
   tier 2.

**Tier 2 — Aggressive trim.**
On `QuotaExceededError` when type IS in `quotaEvictionPending_`:
1. Compute `minBackBuffer = max(lastTrackedEntry.duration, 2)`.
   `remove(bufferStart, currentTime - minBackBuffer)`
2. Emit `BUFFER_ERROR` (non-fatal, informational)
3. Insert `[remove, retry-append]` via `insertNext`
4. Remove type from `quotaEvictionPending_`

**After tier 2 exhaustion:** The failed append is dropped. The
`StreamController` `update_()` tick naturally re-attempts once playback
consumes enough forward buffer to drop below `frontBufferLength`.

**Detection:** `error.name === 'QuotaExceededError'` plus
`error.code === DOMException.QUOTA_EXCEEDED_ERR` for cross-browser
safety.

### Changes to `lib/events.ts`

Add `BUFFER_ERROR: "bufferError"` to `Events`.

```typescript
type BufferErrorEvent = {
  type: MediaType;
  error: DOMException;
};
```

Emitted on tier 2. Informational — no internal consumer acts on it.

### No changes to `lib/media/stream_controller.ts`

The `update_()` loop checks `bufferEnd - currentTime >= frontBufferLength`
before fetching. After a failed append is dropped, `StreamController`
naturally re-attempts once playback consumes enough forward buffer.
Only change is the config rename (`bufferGoal` → `frontBufferLength`).

## Flow diagram

```
sb.appendBuffer(data) throws QuotaExceededError
  │
  ├─ quotaEvictionPending_ has type? NO (Tier 1)
  │   │
  │   ├─ SegmentTracker.getEvictionEnd() + padding
  │   │   │
  │   │   ├─ evictionEnd > 0?
  │   │   │   YES: add to Set, insertNext([remove, retry])
  │   │   │   NO: fall through to Tier 2
  │   │   │
  │   │   └─ Retry succeeds → remove from Set, done
  │   │       Retry fails → re-enters as Tier 2
  │   │
  ├─ quotaEvictionPending_ has type? YES (Tier 2)
  │   │
  │   ├─ remove(bufferStart, currentTime - maxSegmentDuration)
  │   ├─ emit BUFFER_ERROR
  │   ├─ insertNext([remove, retry])
  │   ├─ remove from Set
  │   │
  │   └─ Retry succeeds → done
  │       Retry fails → append dropped, StreamController
  │       re-attempts via natural update_() tick
```

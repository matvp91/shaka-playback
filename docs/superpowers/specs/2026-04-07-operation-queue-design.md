# Operation Queue — Design Spec

## Summary

Introduce an `OperationQueue` class that serializes all MSE SourceBuffer operations (append, remove) per buffer, replacing the ad-hoc `queue_`/`appending_`/`flush_()` pattern in `BufferController`. This is foundational infrastructure that enables robust `endOfStream()` coordination, buffer eviction, and future codec switching.

## Background

The MSE spec requires that SourceBuffer operations are strictly serialized — calling `appendBuffer()` or `remove()` while `updating === true` throws `InvalidStateError`. Our current `BufferController` handles this with a simple array queue and boolean flag, but only supports appends. As we add remove operations, cross-buffer coordination, and eviction, a proper operation queue is needed.

This follows the same pattern used by hls.js (`BufferOperationQueue`) and shaka-player (`MediaSourceEngine`), adapted to our event-driven architecture.

## Changes

### 1. Operation type

```ts
interface Operation {
  execute: () => void;
  onComplete: () => void;
}
```

Minimal — no `label`, `onStart`, or `onError`. `execute()` performs the MSE call, `onComplete()` is called after `updateend`. Error handling and retry (e.g., `QuotaExceededError` + eviction) will be added later when needed.

### 2. OperationQueue class (`lib/controllers/operation_queue.ts`)

Standalone class that owns per-SourceBuffer FIFO queues.

**State:**

- `queues_: Map<TrackType, Operation[]>` — one queue per track type
- `sourceBuffers_: Map<TrackType, SourceBuffer>` — registered SourceBuffers

**Public API:**

- `add(type, sourceBuffer)` — register a SourceBuffer, wire up `updateend` and `error` listeners
- `enqueue(type, operation)` — push to queue, execute immediately if queue was empty
- `block(type, position: "append" | "prepend")` — returns `Promise<void>` that resolves when the blocker reaches the front and executes. `"append"` adds to end of queue, `"prepend"` adds to front.
- `destroy()` — remove all event listeners, clear all queues and references

**Internal mechanics:**

- `executeNext_(type)` — peek front of queue, call `execute()`. If it throws synchronously and SourceBuffer is not updating, shift and advance (prevents stall).
- `onUpdateEnd_(type)` — call `onComplete()` on current op, shift it off, call `executeNext_(type)`.
- `onError_(type)` — no custom handling yet. The `updateend` event always fires after `error`, so the queue advances naturally via `onUpdateEnd_`.

### 3. BufferController changes

Replace `queue_`, `appending_`, and `flush_()` with `this.opQueue_: OperationQueue`.

**`onTracksSelected_()`** — after creating each SourceBuffer, register with `this.opQueue_.add(type, sourceBuffer)`.

**`onSegmentLoaded_()`** — enqueue an append operation:

```ts
this.opQueue_.enqueue(type, {
  execute: () => sourceBuffer.appendBuffer(data),
  onComplete: () => this.player_.emit(Event.BUFFER_APPENDED, { type }),
});
```

**Removed:** `queue_` array, `appending_` flag, `flush_()` method, manual `updateend` listener in flush.

**Unchanged:** `sourceBuffers_` map, SourceBuffer creation, all other event handlers.

### 4. endOfStream coordination

Currently `MediaController` calls `mediaSource.endOfStream()` on `BUFFER_EOS` with no guarantee buffers are idle. This can throw if a SourceBuffer is updating.

**Fix:** Move `endOfStream()` from `MediaController` to `BufferController`. On `BUFFER_EOS`:

1. For each registered track type, call `this.opQueue_.block(type, "append")`
2. `Promise.all()` the blockers
3. Once resolved, call `mediaSource.endOfStream()` directly

### 5. bufferBehind config

**Config:** Add `bufferBehind: number` to config, default `Infinity` (disabled — no eviction unless opted in).

**Trigger:** In `BufferController`, after `BUFFER_APPENDED`, check if buffered data behind playhead exceeds `bufferBehind`:

```ts
const evictEnd = currentTime - bufferBehind;
if (bufferedStart < evictEnd) {
  this.opQueue_.enqueue(type, {
    execute: () => sourceBuffer.remove(bufferedStart, evictEnd),
    onComplete: () => {},
  });
}
```

No special queue support needed — `remove()` is just another serialized operation.

## Files affected

| File | Change |
|------|--------|
| `lib/controllers/operation_queue.ts` | New — OperationQueue class |
| `lib/controllers/buffer_controller.ts` | Replace queue/appending/flush with opQueue_ |
| `lib/controllers/media_controller.ts` | Remove `endOfStream()` handling (moved to BufferController) |
| `lib/config.ts` | Add `bufferBehind: number` (default `Infinity`) |
| `lib/events.ts` | Remove `BUFFER_EOS` event (no longer needed) |

## Future extensions (not in scope)

- `onError` callback on operations — needed for `QuotaExceededError` → evict → retry
- `insertNext()` method — insert operations after current for retry patterns
- `changeType()` support — codec switching mid-stream
- `frontBufferFlushThreshold` — evict stale data ahead of playhead after seeks

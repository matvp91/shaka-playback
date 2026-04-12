# Operation Queue Redesign — Design Spec

## Summary

Redesign `OperationQueue` to fix bugs, decouple from MSE internals, and
align with battle-tested patterns from hls.js's `BufferOperationQueue`.
The queue stays a thin serializer but gains correctness fixes, a delegate
interface, operation tagging, and debug tooling.

## Background

The current `OperationQueue` was modelled after hls.js but diverges in
several ways that introduce bugs or limit future extensibility:

- `insertNext` uses `unshift`, which displaces the currently-executing
  operation and causes out-of-order execution.
- `block()` auto-advances the queue, preventing caller-controlled
  synchronization (needed for codec switching).
- Error handling has two branches with different shift semantics.
- The queue holds direct `SourceBuffer` references, coupling it to MSE.
- Sync operations (e.g. quota cleanup) can stall the queue because only
  `updateend` triggers advancement.

## Changes

### 1. OperationQueueDelegate

Replace the `sourceBuffers_` map with a delegate interface injected via
the constructor. The queue no longer knows what a SourceBuffer is.

```ts
interface OperationQueueDelegate {
  isUpdating: (type: MediaType) => boolean;
}
```

The buffer controller implements this, asserting that a SourceBuffer
exists for the given type:

```ts
const delegate: OperationQueueDelegate = {
  isUpdating: (type) => {
    const sb = this.sourceBuffers_.get(type);
    asserts.assertExists(sb, `No SourceBuffer for ${type}`);
    return sb.updating;
  },
};
```

### 2. OperationKind and Operation type

Add a `kind` field for tagging operations. Known kinds live in a const
object; the field itself is typed as `string` for composability (e.g.
`${OperationKind.ChangeType}_${mimeType}`).

```ts
const OperationKind = {
  Append: "append",
  Block: "block",
  ChangeType: "changeType",
  Flush: "flush",
  QuotaCleanup: "quotaCleanup",
} as const;

type Operation = {
  kind: string;
  execute: () => void;
  onComplete?: () => void;
  onError?: (error: unknown) => void;
};
```

- `kind` — mandatory, identifies the operation for debugging.
- `onComplete` — optional, called by `shiftAndExecuteNext`.
- `onError` — optional, called on synchronous throw from `execute()`.
- No `onStart` — not needed.

### 3. Queue state

Queues are a fixed record initialized for both media types in the
constructor. No dynamic registration, no `add()` method.

```ts
class OperationQueue {
  private queues_: Record<MediaType, Operation[]> = {
    [MediaType.VIDEO]: [],
    [MediaType.AUDIO]: [],
  };

  constructor(private delegate_: OperationQueueDelegate) {}
}
```

### 4. insertNext fix

Insert after the currently-executing operation (index 1), not before it
(index 0). Only call `executeNext_` if the queue was empty before
insertion.

```ts
insertNext(type: MediaType, operations: Operation[]) {
  const queue = this.queues_[type];
  queue.splice(1, 0, ...operations);
  if (queue.length === operations.length) {
    this.executeNext_(type);
  }
}
```

### 5. Caller-controlled block

`block()` resolves the promise when the blocker reaches the front and
executes, but does NOT shift or advance. The caller does their work,
then calls `shiftAndExecuteNext` when ready.

```ts
block(type: MediaType): Promise<void> {
  return new Promise((resolve) => {
    this.enqueue(type, {
      kind: OperationKind.Block,
      execute: resolve,
    });
  });
}
```

Caller usage:

```ts
await queue.block("audio");
await swapCodec();
queue.shiftAndExecuteNext("audio");
```

### 6. Unified executeNext_ with auto-advance

One path for both success and error. After `execute()`, check
`delegate_.isUpdating(type)` — if not updating, the operation completed
synchronously and the queue auto-advances via `shiftAndExecuteNext`.
This handles sync operations like QuotaCleanup without requiring manual
shift calls or special-casing.

```ts
private executeNext_(type: MediaType) {
  const queue = this.queues_[type];
  if (queue.length === 0) {
    return;
  }
  const operation = queue[0];
  try {
    operation.execute();
    if (!this.delegate_.isUpdating(type)
        && operation.kind !== OperationKind.Block) {
      this.shiftAndExecuteNext(type);
    }
  } catch (error) {
    operation.onError?.(error);
    if (!this.delegate_.isUpdating(type)) {
      this.shiftAndExecuteNext(type);
    }
  }
}
```

Three cases after `execute()`:

- **Async ops** (append, flush, changeType) — `execute()` sets
  `updating = true` synchronously per the MSE spec, so the check skips
  auto-advance. The buffer controller's `updateend` listener calls
  `shiftAndExecuteNext` when the browser signals completion.
- **Sync ops** (quota cleanup) — SourceBuffer is not updating, queue
  auto-advances.
- **Block ops** — explicitly skipped via `kind` check. The caller
  controls when to advance by calling `shiftAndExecuteNext`.

### 7. shiftAndExecuteNext

Shifts the head operation, calls `onComplete`, then advances. Unchanged
in behavior from current implementation.

```ts
shiftAndExecuteNext(type: MediaType) {
  const queue = this.queues_[type];
  if (queue.length === 0) {
    return;
  }
  const operation = queue.shift()!;
  operation.onComplete?.();
  this.executeNext_(type);
}
```

### 8. toString

Debug string showing queue state per type using `kind`.

```ts
toString(): string {
  return [
    this.formatQueue_(MediaType.VIDEO),
    this.formatQueue_(MediaType.AUDIO),
  ].filter(Boolean).join("\n");
}

private formatQueue_(type: MediaType): string {
  const queue = this.queues_[type];
  if (queue.length === 0) {
    return "";
  }
  return `${type}: ${queue.map((op) => op.kind).join(", ")}`;
}
```

Output example: `video: append, append, flush`

### 9. Removed

- `add()` — queues are pre-initialized.
- `destroy()` — GC handles cleanup when the player is destroyed.
- `sourceBuffers_` map — replaced by delegate.

### 10. Buffer controller changes

- Implement `OperationQueueDelegate` with `isUpdating` that asserts
  SourceBuffer existence.
- Pass delegate to `new OperationQueue(delegate)`.
- Remove `add()` calls.
- Add `kind` to all operations using `OperationKind` values.
- Keep `updateend` → `shiftAndExecuteNext` listener for async ops.
- At `block()` call sites, call `shiftAndExecuteNext` after the awaited
  work completes.

## Files affected

| File | Change |
|------|--------|
| `lib/media/operation_queue.ts` | Rewrite per spec |
| `lib/media/buffer_controller.ts` | Adapt to new API |

## Not in scope

- `pending` flag — no use case today.
- `current()` accessor — not needed.
- `removeBlockers()` — revisit when error recovery is built.
- `onStart` callback — no use case.

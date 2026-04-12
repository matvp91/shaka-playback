# Operation Queue Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign OperationQueue to fix bugs, decouple from MSE, and align with hls.js patterns.

**Architecture:** Introduce an `OperationQueueDelegate` interface to replace direct SourceBuffer references. Add `OperationKind` const and `kind` field for tagging. Fix `insertNext`, `block`, and `executeNext_` semantics.

**Tech Stack:** TypeScript, Vitest

---

### Task 1: Add OperationQueueDelegate and OperationKind types

**Files:**
- Modify: `packages/cmaf-lite/lib/media/operation_queue.ts:1-8`

- [ ] **Step 1: Add the delegate interface and OperationKind const**

Replace the entire type section at the top of `operation_queue.ts`:

```ts
import type { MediaType } from "../types/media";

export interface OperationQueueDelegate {
  /** Whether the SourceBuffer for this type is currently updating. */
  isUpdating: (type: MediaType) => boolean;
}

export const OperationKind = {
  Append: "append",
  Block: "block",
  ChangeType: "changeType",
  Flush: "flush",
  QuotaCleanup: "quotaCleanup",
} as const;

export type Operation = {
  kind: string;
  execute: () => void;
  onComplete?: () => void;
  onError?: (error: unknown) => void;
};
```

- [ ] **Step 2: Verify the file is valid TypeScript**

Run: `pnpm tsc`
Expected: Type errors in operation_queue.ts (class not yet updated) and buffer_controller.ts (missing `kind`). No errors in the type definitions themselves.

- [ ] **Step 3: Commit**

```bash
git add packages/cmaf-lite/lib/media/operation_queue.ts
git commit -m "refactor: add OperationQueueDelegate and OperationKind types"
```

---

### Task 2: Rewrite OperationQueue class

**Files:**
- Modify: `packages/cmaf-lite/lib/media/operation_queue.ts:10-121`

- [ ] **Step 1: Rewrite the OperationQueue class**

Replace the entire class with:

```ts
export class OperationQueue {
  private queues_: Record<MediaType, Operation[]> = {
    [MediaType.VIDEO]: [],
    [MediaType.AUDIO]: [],
  };

  constructor(private delegate_: OperationQueueDelegate) {}

  /**
   * Push an operation onto the queue. Executes immediately
   * if the queue was empty.
   */
  enqueue(type: MediaType, operation: Operation) {
    const queue = this.queues_[type];
    queue.push(operation);
    if (queue.length === 1) {
      this.executeNext_(type);
    }
  }

  /**
   * Append a blocker that resolves when all prior operations
   * complete. The caller must call shiftAndExecuteNext to
   * advance past the blocker.
   */
  block(type: MediaType): Promise<void> {
    return new Promise((resolve) => {
      this.enqueue(type, {
        kind: OperationKind.Block,
        execute: resolve,
      });
    });
  }

  /**
   * Insert operations after the currently-executing operation.
   * If the queue is empty, executes the first inserted
   * operation immediately.
   */
  insertNext(type: MediaType, operations: Operation[]) {
    const queue = this.queues_[type];
    queue.splice(1, 0, ...operations);
    if (queue.length === operations.length) {
      this.executeNext_(type);
    }
  }

  /**
   * Complete the current operation and execute the next.
   * Called on SourceBuffer updateend or by the caller after
   * a blocker resolves.
   */
  shiftAndExecuteNext(type: MediaType) {
    const queue = this.queues_[type];
    if (queue.length === 0) {
      return;
    }
    const operation = queue.shift()!;
    operation.onComplete?.();
    this.executeNext_(type);
  }

  /** Debug string showing queue state per type. */
  toString(): string {
    return [
      this.formatQueue_(MediaType.VIDEO),
      this.formatQueue_(MediaType.AUDIO),
    ]
      .filter(Boolean)
      .join("\n");
  }

  private executeNext_(type: MediaType) {
    const queue = this.queues_[type];
    if (queue.length === 0) {
      return;
    }
    const operation = queue[0];
    try {
      operation.execute();
      if (
        !this.delegate_.isUpdating(type) &&
        operation.kind !== OperationKind.Block
      ) {
        this.shiftAndExecuteNext(type);
      }
    } catch (error) {
      operation.onError?.(error);
      if (!this.delegate_.isUpdating(type)) {
        this.shiftAndExecuteNext(type);
      }
    }
  }

  private formatQueue_(type: MediaType): string {
    const queue = this.queues_[type];
    if (queue.length === 0) {
      return "";
    }
    return `${type}: ${queue.map((op) => op.kind).join(", ")}`;
  }
}
```

- [ ] **Step 2: Remove the asserts import**

The rewritten class no longer uses `asserts`. Remove:

```ts
import * as asserts from "../utils/asserts";
```

- [ ] **Step 3: Verify the file compiles in isolation**

Run: `pnpm tsc`
Expected: Errors in buffer_controller.ts and test file (not yet updated). No errors in operation_queue.ts itself.

- [ ] **Step 4: Commit**

```bash
git add packages/cmaf-lite/lib/media/operation_queue.ts
git commit -m "refactor: rewrite OperationQueue with delegate and fixed semantics"
```

---

### Task 3: Rewrite operation_queue tests

**Files:**
- Modify: `packages/cmaf-lite/test/media/operation_queue.test.ts`

- [ ] **Step 1: Rewrite the test file**

Replace the entire file with:

```ts
import { describe, expect, it, vi } from "vitest";
import {
  OperationKind,
  OperationQueue,
  type OperationQueueDelegate,
} from "../../lib/media/operation_queue";
import { MediaType } from "../../lib/types/media";

function createDelegate(updating = false): OperationQueueDelegate {
  return { isUpdating: () => updating };
}

function op(overrides: Record<string, unknown> = {}) {
  return {
    kind: OperationKind.Append,
    execute: vi.fn(),
    ...overrides,
  };
}

describe("OperationQueue", () => {
  it("executes the first enqueued operation immediately", () => {
    const queue = new OperationQueue(createDelegate());
    const operation = op();

    queue.enqueue(MediaType.VIDEO, operation);

    expect(operation.execute).toHaveBeenCalledOnce();
  });

  it("defers subsequent operations until the current one completes", () => {
    const queue = new OperationQueue(createDelegate(true));
    const first = op();
    const second = op();

    queue.enqueue(MediaType.VIDEO, first);
    queue.enqueue(MediaType.VIDEO, second);

    expect(first.execute).toHaveBeenCalledOnce();
    expect(second.execute).not.toHaveBeenCalled();
  });

  it("calls onComplete and advances on shiftAndExecuteNext", () => {
    const queue = new OperationQueue(createDelegate(true));
    const onComplete = vi.fn();
    const first = op({ onComplete });
    const second = op();

    queue.enqueue(MediaType.VIDEO, first);
    queue.enqueue(MediaType.VIDEO, second);
    queue.shiftAndExecuteNext(MediaType.VIDEO);

    expect(onComplete).toHaveBeenCalledOnce();
    expect(second.execute).toHaveBeenCalledOnce();
  });

  it("inserts operations after the currently-executing operation", () => {
    const queue = new OperationQueue(createDelegate(true));
    const order: number[] = [];

    queue.enqueue(MediaType.VIDEO, op({ execute: () => order.push(1) }));
    queue.enqueue(MediaType.VIDEO, op({ execute: () => order.push(3) }));
    queue.insertNext(MediaType.VIDEO, [
      op({ execute: () => order.push(2) }),
    ]);

    queue.shiftAndExecuteNext(MediaType.VIDEO);
    queue.shiftAndExecuteNext(MediaType.VIDEO);
    queue.shiftAndExecuteNext(MediaType.VIDEO);

    expect(order).toEqual([1, 2, 3]);
  });

  it("resolves block promise when it reaches the front of the queue", async () => {
    const queue = new OperationQueue(createDelegate());
    const resolved = vi.fn();

    queue.block(MediaType.VIDEO).then(resolved);
    await Promise.resolve();

    expect(resolved).toHaveBeenCalledOnce();
  });

  it("does not auto-advance past a blocker", async () => {
    const queue = new OperationQueue(createDelegate());
    const second = op();

    queue.block(MediaType.VIDEO);
    queue.enqueue(MediaType.VIDEO, second);
    await Promise.resolve();

    expect(second.execute).not.toHaveBeenCalled();
  });

  it("advances past a blocker when caller calls shiftAndExecuteNext", async () => {
    const queue = new OperationQueue(createDelegate());
    const second = op();

    queue.block(MediaType.VIDEO);
    queue.enqueue(MediaType.VIDEO, second);
    await Promise.resolve();

    queue.shiftAndExecuteNext(MediaType.VIDEO);

    expect(second.execute).toHaveBeenCalledOnce();
  });

  it("calls onError with the thrown error when execute fails", () => {
    const queue = new OperationQueue(createDelegate());
    const error = new Error("boom");
    const onError = vi.fn();

    queue.enqueue(MediaType.VIDEO, op({
      execute: () => { throw error; },
      onError,
    }));

    expect(onError).toHaveBeenCalledWith(error);
  });

  it("advances past failed operation when sourceBuffer is not updating", () => {
    const queue = new OperationQueue(createDelegate());
    const second = op();

    queue.enqueue(MediaType.VIDEO, op({
      execute: () => { throw new Error("boom"); },
    }));
    queue.enqueue(MediaType.VIDEO, second);

    expect(second.execute).toHaveBeenCalledOnce();
  });

  it("stalls the queue when execute throws and sourceBuffer is updating", () => {
    const queue = new OperationQueue(createDelegate(true));
    const second = op();

    queue.enqueue(MediaType.VIDEO, op({
      execute: () => { throw new Error("boom"); },
    }));
    queue.enqueue(MediaType.VIDEO, second);

    expect(second.execute).not.toHaveBeenCalled();
  });

  it("auto-advances sync operations when sourceBuffer is not updating", () => {
    const queue = new OperationQueue(createDelegate());
    const first = op({ kind: OperationKind.QuotaCleanup });
    const second = op();

    queue.enqueue(MediaType.VIDEO, first);
    queue.enqueue(MediaType.VIDEO, second);

    expect(first.execute).toHaveBeenCalledOnce();
    expect(second.execute).toHaveBeenCalledOnce();
  });

  it("returns debug string with queue state", () => {
    const queue = new OperationQueue(createDelegate(true));

    queue.enqueue(MediaType.VIDEO, op({ kind: OperationKind.Append }));
    queue.enqueue(MediaType.VIDEO, op({ kind: OperationKind.Flush }));
    queue.enqueue(MediaType.AUDIO, op({ kind: OperationKind.Append }));

    expect(queue.toString()).toBe(
      "video: append, flush\naudio: append",
    );
  });

  it("returns empty string from toString when all queues are empty", () => {
    const queue = new OperationQueue(createDelegate());
    expect(queue.toString()).toBe("");
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `cd packages/cmaf-lite && pnpm test -- --run test/media/operation_queue.test.ts`
Expected: All 12 tests pass.

- [ ] **Step 3: Commit**

```bash
git add packages/cmaf-lite/test/media/operation_queue.test.ts
git commit -m "test: rewrite operation queue tests for redesigned API"
```

---

### Task 4: Update buffer controller

**Files:**
- Modify: `packages/cmaf-lite/lib/media/buffer_controller.ts`

- [ ] **Step 1: Update imports**

Replace:

```ts
import type { Operation } from "./operation_queue";
import { OperationQueue } from "./operation_queue";
```

With:

```ts
import type { Operation, OperationQueueDelegate } from "./operation_queue";
import { OperationKind, OperationQueue } from "./operation_queue";
```

- [ ] **Step 2: Update opQueue_ initialization**

Replace:

```ts
private opQueue_ = new OperationQueue();
```

With:

```ts
private opQueue_: OperationQueue;
```

And in the constructor, after `this.player_.on(...)` calls, add:

```ts
const delegate: OperationQueueDelegate = {
  isUpdating: (type) => {
    const sb = this.sourceBuffers_.get(type);
    asserts.assertExists(sb, `No SourceBuffer for ${type}`);
    return sb.updating;
  },
};
this.opQueue_ = new OperationQueue(delegate);
```

- [ ] **Step 3: Add kind to flush operation**

In the `flush()` method, replace:

```ts
this.opQueue_.enqueue(type, {
  execute: () => {
    sb.remove(0, Infinity);
  },
});
```

With:

```ts
this.opQueue_.enqueue(type, {
  kind: OperationKind.Flush,
  execute: () => {
    sb.remove(0, Infinity);
  },
});
```

- [ ] **Step 4: Add kind to changeType operation**

In `onBufferCodecs_`, replace:

```ts
this.opQueue_.enqueue(type, {
  execute: () => sb.changeType(mimeType),
});
```

With:

```ts
this.opQueue_.enqueue(type, {
  kind: `${OperationKind.ChangeType}_${mimeType}`,
  execute: () => sb.changeType(mimeType),
});
```

- [ ] **Step 5: Remove opQueue_.add() call and remove updateend from onBufferCodecs_**

In `onBufferCodecs_`, remove:

```ts
this.opQueue_.add(type, newSb);
```

Keep the `updateend` listener — it's still needed to call `shiftAndExecuteNext` for async operations.

- [ ] **Step 6: Add kind to append operation**

In `onBufferAppending_`, replace:

```ts
const operation = {
  execute: () => {
```

With:

```ts
const operation: Operation = {
  kind: OperationKind.Append,
  execute: () => {
```

- [ ] **Step 7: Update blockUntil to call shiftAndExecuteNext after callback**

Replace:

```ts
private blockUntil(callback: () => void) {
  const types = [...this.sourceBuffers_.keys()];
  const blockers = types.map((type) => this.opQueue_.block(type));
  Promise.all(blockers).then(callback);
}
```

With:

```ts
private blockUntil(callback: () => void) {
  const types = [...this.sourceBuffers_.keys()];
  const blockers = types.map((type) => this.opQueue_.block(type));
  Promise.all(blockers).then(() => {
    callback();
    for (const type of types) {
      this.opQueue_.shiftAndExecuteNext(type);
    }
  });
}
```

- [ ] **Step 8: Add kind to getFlushOperation_**

Replace:

```ts
return {
  execute: () => {
    sb.remove(start, end);
  },
};
```

With:

```ts
return {
  kind: OperationKind.Flush,
  execute: () => {
    sb.remove(start, end);
  },
};
```

- [ ] **Step 9: Add kind to getQuotaEvictedOperation_**

Replace:

```ts
return {
  execute: () => {
    this.quotaEvictionPending_.delete(type);
  },
};
```

With:

```ts
return {
  kind: OperationKind.QuotaCleanup,
  execute: () => {
    this.quotaEvictionPending_.delete(type);
  },
};
```

- [ ] **Step 10: Add kind to evictBackBuffer_ operation**

In `evictBackBuffer_`, the enqueue call already uses `getFlushOperation_` which now has `kind`. No change needed here.

- [ ] **Step 11: Remove opQueue_.destroy() from destroy()**

Replace:

```ts
this.opQueue_.destroy();
```

Remove this line entirely — `OperationQueue` no longer has a `destroy()` method.

- [ ] **Step 12: Verify types compile**

Run: `pnpm tsc`
Expected: No type errors.

- [ ] **Step 13: Run all tests**

Run: `pnpm test`
Expected: All tests pass. Buffer controller tests may need updates if they reference `add()` or `destroy()` on the queue.

- [ ] **Step 14: Commit**

```bash
git add packages/cmaf-lite/lib/media/buffer_controller.ts
git commit -m "refactor: adapt buffer controller to redesigned OperationQueue"
```

---

### Task 5: Run format and final verification

**Files:** None (verification only)

- [ ] **Step 1: Format**

Run: `pnpm format`

- [ ] **Step 2: Type check**

Run: `pnpm tsc`
Expected: No errors.

- [ ] **Step 3: Run all tests**

Run: `pnpm test`
Expected: All tests pass.

- [ ] **Step 4: Commit any formatting changes**

```bash
git add -A
git commit -m "chore: format"
```

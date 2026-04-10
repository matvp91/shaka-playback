# Buffer Quota Exceeded Protection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Handle `QuotaExceededError` during `SourceBuffer.appendBuffer()` with a two-tier back-buffer eviction strategy that continues playback without fatal errors.

**Architecture:** A new `SegmentTracker` tracks byte sizes of appended segments. `OperationQueue` gains error forwarding and front-insertion. `BufferController` orchestrates two-tier eviction: targeted (evict enough bytes) then aggressive (trim to ~1 segment behind playhead). A `BUFFER_ERROR` event notifies consumers.

**Tech Stack:** TypeScript, MSE (MediaSource Extensions)

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Modify | `packages/cmaf-lite/lib/config.ts` | Rename config keys, add `backBufferQuotaPadding` |
| Modify | `packages/cmaf-lite/lib/events.ts` | Add `BUFFER_ERROR` event |
| Modify | `packages/cmaf-lite/lib/media/operation_queue.ts` | Add `onError` to Operation, add `insertNext` |
| Create | `packages/cmaf-lite/lib/media/segment_tracker.ts` | Track appended segment byte sizes, compute eviction targets |
| Modify | `packages/cmaf-lite/lib/media/buffer_controller.ts` | Wire SegmentTracker, two-tier quota error handling |
| Modify | `packages/cmaf-lite/lib/media/stream_controller.ts` | Config rename only (`bufferGoal` → `frontBufferLength`) |
| No change | `packages/cmaf-lite/lib/player.ts` | No changes needed |
| Modify | `packages/demo/src/main.tsx` | Config rename |
| Modify | `packages/demo/src/types.ts` | Config rename |
| Modify | `packages/demo/src/App.tsx` | Config rename |
| Modify | `packages/demo/src/components/buffer-graph/Header.tsx` | Config rename |
| Modify | `packages/demo/src/components/buffer-graph/BufferGraph.tsx` | Config rename |
| Modify | `packages/demo/src/components/buffer-graph/Track.tsx` | Config rename |

---

### Task 1: Config Rename

Rename `bufferGoal` → `frontBufferLength` and `bufferBehind` → `backBufferLength` across the entire codebase. Add `backBufferQuotaPadding`.

**Files:**
- Modify: `packages/cmaf-lite/lib/config.ts:1-13`
- Modify: `packages/cmaf-lite/lib/media/stream_controller.ts:207,210`
- Modify: `packages/cmaf-lite/lib/media/buffer_controller.ts:151,152,165`
- Modify: `packages/demo/src/main.tsx:12`
- Modify: `packages/demo/src/types.ts:14-15`
- Modify: `packages/demo/src/App.tsx:43-44`
- Modify: `packages/demo/src/components/buffer-graph/Header.tsx:2,6,9`
- Modify: `packages/demo/src/components/buffer-graph/BufferGraph.tsx:15,23,33,47,57`
- Modify: `packages/demo/src/components/buffer-graph/Track.tsx:11,21,48`
- Modify: `packages/cmaf-lite/docs/BUFFER.md`

- [ ] **Step 1: Update config type and defaults**

In `packages/cmaf-lite/lib/config.ts`, replace the full file:

```typescript
export type PlayerConfig = {
  frontBufferLength: number;
  backBufferLength: number;
  backBufferQuotaPadding: number;
  maxBufferHole: number;
  maxSegmentLookupTolerance: number;
};

export const defaultConfig: PlayerConfig = {
  frontBufferLength: 30,
  backBufferLength: Infinity,
  backBufferQuotaPadding: 2,
  maxBufferHole: 0.1,
  maxSegmentLookupTolerance: 0.25,
};
```

- [ ] **Step 2: Update stream_controller.ts**

In `packages/cmaf-lite/lib/media/stream_controller.ts`, replace `bufferGoal` with `frontBufferLength`:

Line 207: `const bufferGoal = this.player_.getConfig().bufferGoal;`
→ `const frontBufferLength = this.player_.getConfig().frontBufferLength;`

Line 210: `if (bufferEnd !== null && bufferEnd - currentTime >= bufferGoal) {`
→ `if (bufferEnd !== null && bufferEnd - currentTime >= frontBufferLength) {`

- [ ] **Step 3: Update buffer_controller.ts**

In `packages/cmaf-lite/lib/media/buffer_controller.ts`, replace `bufferBehind` with `backBufferLength`:

Line 151: `const { bufferBehind } = this.player_.getConfig();`
→ `const { backBufferLength } = this.player_.getConfig();`

Line 152: `if (!Number.isFinite(bufferBehind)) {`
→ `if (!Number.isFinite(backBufferLength)) {`

Line 165: `const evictEnd = media.currentTime - bufferBehind;`
→ `const evictEnd = media.currentTime - backBufferLength;`

- [ ] **Step 4: Update demo app**

In `packages/demo/src/types.ts`, rename:
- `bufferGoal: number;` → `frontBufferLength: number;`
- `bufferBehind: number;` → `backBufferLength: number;`

In `packages/demo/src/main.tsx`, rename:
- `bufferGoal: 30,` → `frontBufferLength: 30,`

In `packages/demo/src/App.tsx`, rename:
- `bufferGoal: config.bufferGoal,` → `frontBufferLength: config.frontBufferLength,`
- `bufferBehind: config.bufferBehind,` → `backBufferLength: config.backBufferLength,`

In `packages/demo/src/components/buffer-graph/Header.tsx`, rename all `bufferGoal` → `frontBufferLength`.

In `packages/demo/src/components/buffer-graph/BufferGraph.tsx`, rename all `bufferGoal` → `frontBufferLength`.

In `packages/demo/src/components/buffer-graph/Track.tsx`, rename all `bufferGoal` → `frontBufferLength`.

- [ ] **Step 5: Update BUFFER.md references**

In `packages/cmaf-lite/docs/BUFFER.md`, rename remaining references:
- `bufferGoal` → `frontBufferLength`
- `bufferBehind` → `backBufferLength`
- `backBufferLength: Infinity` (was `bufferBehind: Infinity`)

- [ ] **Step 6: Verify**

Run: `pnpm tsc && pnpm build`
Expected: No type errors, builds successfully.

- [ ] **Step 7: Commit**

```bash
git add packages/cmaf-lite/lib/config.ts packages/cmaf-lite/lib/media/stream_controller.ts packages/cmaf-lite/lib/media/buffer_controller.ts packages/cmaf-lite/docs/BUFFER.md packages/demo/src/main.tsx packages/demo/src/types.ts packages/demo/src/App.tsx packages/demo/src/components/buffer-graph/Header.tsx packages/demo/src/components/buffer-graph/BufferGraph.tsx packages/demo/src/components/buffer-graph/Track.tsx
git commit -m "refactor: rename bufferGoal/bufferBehind to frontBufferLength/backBufferLength"
```

---

### Task 2: Add BUFFER_ERROR Event

**Files:**
- Modify: `packages/cmaf-lite/lib/events.ts:1-93`

- [ ] **Step 1: Add event constant and type**

In `packages/cmaf-lite/lib/events.ts`, add to the `Events` constant after `BUFFER_EOS`:

```typescript
BUFFER_ERROR: "bufferError",
```

Add the event type after `BufferAppendedEvent`:

```typescript
export type BufferErrorEvent = {
  type: MediaType;
  error: DOMException;
};
```

Note: `MediaType` is already imported via the barrel import on line 1.

Add to the `EventMap` interface after the `BUFFER_EOS` entry:

```typescript
[Events.BUFFER_ERROR]: (event: BufferErrorEvent) => void;
```

- [ ] **Step 2: Verify**

Run: `pnpm tsc`
Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add packages/cmaf-lite/lib/events.ts
git commit -m "feat: add BUFFER_ERROR event"
```

---

### Task 3: OperationQueue — onError and insertNext

**Files:**
- Modify: `packages/cmaf-lite/lib/media/operation_queue.ts:1-101`

- [ ] **Step 1: Add onError to Operation type**

In `packages/cmaf-lite/lib/media/operation_queue.ts`, replace the `Operation` type:

```typescript
type Operation = {
  execute: () => void;
  onComplete?: () => void;
  onError?: (error: unknown) => void;
};
```

- [ ] **Step 2: Update executeNext_ to call onError**

Replace the `executeNext_` method (lines 84-100):

```typescript
private executeNext_(type: MediaType) {
  const queue = this.queues_.get(type);
  if (!queue || queue.length === 0) {
    return;
  }
  const operation = queue[0];
  asserts.assertExists(operation, "Queue not empty but no operation");
  try {
    operation.execute();
  } catch (error) {
    if (operation.onError) {
      queue.shift();
      operation.onError(error);
    } else {
      const sb = this.sourceBuffers_.get(type);
      if (!sb?.updating) {
        queue.shift();
        this.executeNext_(type);
      }
    }
  }
}
```

When `onError` is provided, the operation is shifted off and `onError` is called (which will handle eviction and insert new operations). When `onError` is not provided, the existing fallback behavior is preserved.

- [ ] **Step 3: Add insertNext method**

Add after the `block` method (after line 62):

```typescript
/**
 * Insert operations at the front of the queue, ahead
 * of any pending operations. Executes the first
 * inserted operation immediately.
 */
insertNext(type: MediaType, operations: Operation[]) {
  const queue = this.queues_.get(type);
  if (!queue) {
    return;
  }
  queue.unshift(...operations);
  this.executeNext_(type);
}
```

- [ ] **Step 4: Verify**

Run: `pnpm tsc`
Expected: No type errors.

- [ ] **Step 5: Commit**

```bash
git add packages/cmaf-lite/lib/media/operation_queue.ts
git commit -m "feat(operation-queue): add onError callback and insertNext method"
```

---

### Task 4: SegmentTracker

**Files:**
- Create: `packages/cmaf-lite/lib/media/segment_tracker.ts`

- [ ] **Step 1: Create SegmentTracker**

Create `packages/cmaf-lite/lib/media/segment_tracker.ts`:

```typescript
import type { MediaType } from "../types/media";

type TrackedSegment = {
  start: number;
  end: number;
  byteLength: number;
};

export class SegmentTracker {
  private segments_ = new Map<MediaType, TrackedSegment[]>();

  /**
   * Record a successfully appended media segment.
   */
  trackAppend(type: MediaType, start: number, end: number, byteLength: number) {
    let list = this.segments_.get(type);
    if (!list) {
      list = [];
      this.segments_.set(type, list);
    }
    list.push({ start, end, byteLength });
  }

  /**
   * Walk tracked segments before currentTime oldest-first,
   * accumulating byte sizes until >= bytesNeeded. Returns the
   * eviction end time, or 0 if insufficient back buffer.
   */
  getEvictionEnd(
    type: MediaType,
    currentTime: number,
    bytesNeeded: number,
  ): number {
    const list = this.segments_.get(type);
    if (!list) {
      return 0;
    }
    let bytesFreed = 0;
    let evictionEnd = 0;
    for (const segment of list) {
      if (segment.end > currentTime) {
        continue;
      }
      bytesFreed += segment.byteLength;
      evictionEnd = Math.max(evictionEnd, segment.end);
      if (bytesFreed >= bytesNeeded) {
        return evictionEnd;
      }
    }
    return evictionEnd;
  }

  /**
   * Get the duration of the last tracked segment for the
   * given type, used to compute minBackBuffer.
   */
  getLastSegmentDuration(type: MediaType): number {
    const list = this.segments_.get(type);
    if (!list || list.length === 0) {
      return 0;
    }
    const last = list[list.length - 1];
    return last.end - last.start;
  }

  /**
   * Reconcile tracked segments against SourceBuffer.buffered.
   * Discard entries whose time range is no longer in the buffer.
   */
  reconcile(type: MediaType, buffered: TimeRanges) {
    const list = this.segments_.get(type);
    if (!list) {
      return;
    }
    // TODO(matvp): We shall think about not alloc a new array each
    // time we reconcile.
    const filteredList = list.filter((segment) => isTimeBuffered(segment.start, segment.end, buffered));
    this.segments_.set(
      type,
      filteredList,
    );
  }

  destroy() {
    this.segments_.clear();
  }
}

/**
 * Check if a time range is contained within any of the
 * buffered ranges, with a small tolerance for float precision.
 */
function isTimeBuffered(
  start: number,
  end: number,
  buffered: TimeRanges,
): boolean {
  const tolerance = 0.2;
  for (let i = 0; i < buffered.length; i++) {
    if (
      start >= buffered.start(i) - tolerance &&
      end <= buffered.end(i) + tolerance
    ) {
      return true;
    }
  }
  return false;
}
```

- [ ] **Step 2: Verify**

Run: `pnpm tsc`
Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add packages/cmaf-lite/lib/media/segment_tracker.ts
git commit -m "feat: add SegmentTracker for byte-aware buffer eviction"
```

---

### Task 5: BufferController — Wire SegmentTracker and Quota Handling

**Files:**
- Modify: `packages/cmaf-lite/lib/media/buffer_controller.ts:1-210`

- [ ] **Step 1: Add SegmentTracker and quota state to BufferController**

In `packages/cmaf-lite/lib/media/buffer_controller.ts`, add imports:

```typescript
import type { BufferErrorEvent } from "../events";
import { SegmentTracker } from "./segment_tracker";
```

Add fields after `initSegmentInfo_`:

```typescript
private segmentTracker_ = new SegmentTracker();
private quotaEvictionPending_ = new Set<MediaType>();
```

- [ ] **Step 3: Wire SegmentTracker population and reconciliation in onBufferAppended_**

Replace `onBufferAppended_` (lines 150-174):

```typescript
private onBufferAppended_ = (event: BufferAppendedEvent) => {
  const { type, segment, data } = event;

  // Record byte size for quota-aware eviction decisions.
  if (segment) {
    this.segmentTracker_.trackAppend(
      type,
      segment.start,
      segment.end,
      data.byteLength,
    );
  }

  const sb = this.sourceBuffers_.get(type);
  asserts.assertExists(sb, `No SourceBuffer for ${type}`);
  if (sb.buffered.length > 0) {
    this.segmentTracker_.reconcile(type, sb.buffered);
  }

  const { backBufferLength } = this.player_.getConfig();
  if (!Number.isFinite(backBufferLength)) {
    return;
  }
  const media = this.player_.getMedia();
  if (!media) {
    return;
  }
  if (sb.buffered.length === 0) {
    return;
  }
  const bufferedStart = sb.buffered.start(0);
  const evictEnd = media.currentTime - backBufferLength;
  if (bufferedStart >= evictEnd) {
    return;
  }
  this.opQueue_.enqueue(type, {
    execute: () => {
      sb.remove(bufferedStart, evictEnd);
    },
  });
};
```

- [ ] **Step 4: Replace onBufferAppending_ with inline operation and quota handling**

Replace `onBufferAppending_` (lines 101-132):

```typescript
private onBufferAppending_ = (event: BufferAppendingEvent) => {
  const { type, initSegment, data, segment } = event;

  if (!segment) {
    this.initSegmentInfo_.set(initSegment, {
      timescale: Mp4BoxParser.parseTimescale(data),
    });
  }

  const timestampOffset = segment
    ? this.computeTimestampOffset_(initSegment, segment, data)
    : undefined;

  const operation: Operation = {
    execute: () => {
      const sb = this.sourceBuffers_.get(type);
      if (!sb) {
        return;
      }
      if (
        timestampOffset !== undefined &&
        sb.timestampOffset !== timestampOffset
      ) {
        sb.timestampOffset = timestampOffset;
      }
      sb.appendBuffer(data);
    },
    onComplete: () => {
      this.player_.emit(Events.BUFFER_APPENDED, event);
    },
    onError: (error: unknown) => {
      if (isQuotaExceededError(error)) {
        this.evictAndRetryAppend_(type, operation, data.byteLength, error);
      }
    },
  };

  this.opQueue_.enqueue(type, operation);
};
```

The operation closures capture `type`, `data`, `timestampOffset`, `event`,
and the `operation` reference itself. On retry, the same object is
re-queued — no reconstruction needed.

- [ ] **Step 5: Add evictAndRetryAppend_ with two-tier eviction**

Add after `onBufferAppending_`:

```typescript
private evictAndRetryAppend_(
  type: MediaType,
  operation: Operation,
  byteLength: number,
  error: DOMException,
) {
  const media = this.player_.getMedia();
  asserts.assertExists(media, "No media element");
  const sb = this.sourceBuffers_.get(type);
  asserts.assertExists(sb, `No SourceBuffer for ${type}`);

  // Nothing buffered, nothing to evict.
  if (sb.buffered.length === 0) {
    return;
  }

  const currentTime = media.currentTime;
  const bufferedStart = sb.buffered.start(0);

  if (!this.quotaEvictionPending_.has(type)) {
    if (this.evictTargetedBackBuffer_(type, operation, byteLength, currentTime, bufferedStart)) {
      return;
    }
  }

  this.player_.emit(Events.BUFFER_ERROR, {
    type,
    error,
  } satisfies BufferErrorEvent);

  this.evictAggressiveBackBuffer_(type, operation, currentTime, bufferedStart);
}

/**
 * Tier 1: Evict minimum back buffer to fit the failed
 * segment, plus padding for headroom. Returns true when
 * eviction was queued, false when there is not enough
 * back buffer to evict.
 */
private evictTargetedBackBuffer_(
  type: MediaType,
  operation: Operation,
  byteLength: number,
  currentTime: number,
  bufferedStart: number,
): boolean {
  const { backBufferQuotaPadding } = this.player_.getConfig();
  let evictionEnd = this.segmentTracker_.getEvictionEnd(
    type,
    currentTime,
    byteLength,
  );
  evictionEnd = Math.min(evictionEnd + backBufferQuotaPadding, currentTime);

  // Not enough back buffer to free the required bytes.
  if (evictionEnd <= bufferedStart) {
    return false;
  }

  this.quotaEvictionPending_.add(type);
  const sb = this.sourceBuffers_.get(type);
  asserts.assertExists(sb, `No SourceBuffer for ${type}`);

  const removeOp: Operation = {
    execute: () => {
      sb.remove(bufferedStart, evictionEnd);
    },
  };

  const clearOp: Operation = {
    execute: () => {
      this.quotaEvictionPending_.delete(type);
    },
  };

  this.opQueue_.insertNext(type, [removeOp, operation, clearOp]);
  return true;
}

/**
 * Tier 2: Aggressively trim back buffer to ~1 segment
 * behind playhead.
 */
private evictAggressiveBackBuffer_(
  type: MediaType,
  operation: Operation,
  currentTime: number,
  bufferedStart: number,
) {
  const minBackBuffer = Math.max(
    this.segmentTracker_.getLastSegmentDuration(type),
    2,
  );
  const evictionEnd = currentTime - minBackBuffer;

  // Back buffer is already smaller than the minimum
  // we want to keep. Nothing left to evict.
  if (evictionEnd <= bufferedStart) {
    this.quotaEvictionPending_.delete(type);
    return;
  }

  this.quotaEvictionPending_.delete(type);
  const sb = this.sourceBuffers_.get(type);
  asserts.assertExists(sb, `No SourceBuffer for ${type}`);

  const removeOp: Operation = {
    execute: () => {
      sb.remove(bufferedStart, evictionEnd);
    },
  };

  this.opQueue_.insertNext(type, [removeOp, operation]);
}
```

- [ ] **Step 6: Add isQuotaExceededError utility**

Add at the bottom of `buffer_controller.ts`, outside the class:

```typescript
function isQuotaExceededError(error: unknown): error is DOMException {
  if (!(error instanceof DOMException)) {
    return false;
  }
  return (
    error.name === "QuotaExceededError" ||
    error.code === DOMException.QUOTA_EXCEEDED_ERR
  );
}
```

- [ ] **Step 7: Update destroy and flush**

In the `destroy` method, add before `this.sourceBuffers_.clear()`:

```typescript
this.segmentTracker_.destroy();
this.quotaEvictionPending_.clear();
```

In the `flush` method, add before the `opQueue_.enqueue`:

```typescript
this.quotaEvictionPending_.delete(type);
```

- [ ] **Step 8: Verify**

Run: `pnpm tsc && pnpm build`
Expected: No type errors, builds successfully.

- [ ] **Step 9: Commit**

```bash
git add packages/cmaf-lite/lib/media/buffer_controller.ts packages/cmaf-lite/lib/media/segment_tracker.ts
git commit -m "feat: buffer quota exceeded protection with two-tier eviction"
```

---

### Task 6: Format and Final Verification

**Files:**
- All modified files

- [ ] **Step 1: Format**

Run: `pnpm format`

- [ ] **Step 2: Type check**

Run: `pnpm tsc`
Expected: No type errors.

- [ ] **Step 3: Build**

Run: `pnpm build`
Expected: Builds successfully.

- [ ] **Step 4: Commit if formatting changed anything**

```bash
git add -A
git commit -m "chore: format"
```

- [ ] **Step 5: Manual smoke test**

Run: `pnpm dev`
Verify the demo app loads and plays without errors in the console.

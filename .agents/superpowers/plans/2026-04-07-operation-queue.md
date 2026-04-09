# Operation Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce an OperationQueue that serializes all MSE SourceBuffer operations per buffer, replacing the ad-hoc queue in BufferController, enabling robust endOfStream coordination and back-buffer eviction.

**Architecture:** A standalone OperationQueue class owns per-SourceBuffer FIFO queues. Each operation has `execute` and `onComplete` callbacks. The queue listens for `updateend` to advance. BufferController delegates all SourceBuffer mutations through the queue. endOfStream coordination uses the queue's `block()` method to wait for all buffers to be idle. A `bufferBehind` config option enables back-buffer eviction via `remove()` operations through the same queue.

**Tech Stack:** TypeScript, Vite, pnpm, Biome

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `lib/controllers/operation_queue.ts` | Create | Per-SourceBuffer FIFO queue that serializes MSE operations |
| `lib/controllers/buffer_controller.ts` | Modify | Replace queue\_/appending\_/flush\_ with opQueue\_, add endOfStream and eviction |
| `lib/controllers/media_controller.ts` | Modify | Remove BUFFER\_EOS listener and endOfStream handling |
| `lib/config.ts` | Modify | Add `bufferBehind: number` (default `Infinity`) |

---

### Task 1: Create OperationQueue class

**Files:**
- Create: `lib/controllers/operation_queue.ts`

- [ ] **Step 1: Create the Operation type and OperationQueue class**

```ts
import type { TrackType } from "../types/manifest";

type Operation = {
  execute: () => void;
  onComplete: () => void;
};

export class OperationQueue {
  private queues_ = new Map<TrackType, Operation[]>();
  private sourceBuffers_ = new Map<TrackType, SourceBuffer>();

  /**
   * Register a SourceBuffer for a track type.
   * Wires up updateend and error listeners.
   */
  add(type: TrackType, sourceBuffer: SourceBuffer) {
    this.queues_.set(type, []);
    this.sourceBuffers_.set(type, sourceBuffer);
    sourceBuffer.addEventListener("updateend", () =>
      this.onUpdateEnd_(type),
    );
  }

  /**
   * Push an operation onto the queue. Executes
   * immediately if the queue was empty.
   */
  enqueue(type: TrackType, operation: Operation) {
    const queue = this.queues_.get(type);
    if (!queue) {
      return;
    }
    queue.push(operation);
    if (queue.length === 1) {
      this.executeNext_(type);
    }
  }

  /**
   * Insert a blocker into the queue. Returns a
   * promise that resolves when the blocker reaches
   * the front and executes. The blocker does not
   * trigger an updateend event, so it shifts itself
   * off and advances the queue.
   */
  block(
    type: TrackType,
    position: "append" | "prepend",
  ): Promise<void> {
    return new Promise((resolve) => {
      const operation: Operation = {
        execute: () => {
          resolve();
          const queue = this.queues_.get(type);
          queue?.shift();
          this.executeNext_(type);
        },
        onComplete: () => {},
      };
      const queue = this.queues_.get(type);
      if (!queue) {
        resolve();
        return;
      }
      if (position === "prepend") {
        queue.unshift(operation);
      } else {
        queue.push(operation);
      }
      if (queue.length === 1) {
        this.executeNext_(type);
      }
    });
  }

  /** Remove all listeners, clear all state. */
  destroy() {
    this.queues_.clear();
    this.sourceBuffers_.clear();
  }

  private executeNext_(type: TrackType) {
    const queue = this.queues_.get(type);
    if (!queue || queue.length === 0) {
      return;
    }
    const operation = queue[0];
    try {
      operation.execute();
    } catch {
      const sb = this.sourceBuffers_.get(type);
      if (!sb?.updating) {
        queue.shift();
        this.executeNext_(type);
      }
    }
  }

  private onUpdateEnd_(type: TrackType) {
    const queue = this.queues_.get(type);
    if (!queue || queue.length === 0) {
      return;
    }
    const operation = queue.shift();
    operation?.onComplete();
    this.executeNext_(type);
  }
}
```

- [ ] **Step 2: Run type check**

Run: `pnpm tsc`
Expected: No errors related to operation_queue.ts

- [ ] **Step 3: Run format**

Run: `pnpm format`
Expected: Clean

- [ ] **Step 4: Commit**

```bash
git add lib/controllers/operation_queue.ts
git commit -m "feat: add OperationQueue class for serializing MSE operations"
```

---

### Task 2: Migrate BufferController to use OperationQueue

**Files:**
- Modify: `lib/controllers/buffer_controller.ts`

- [ ] **Step 1: Replace queue/appending/flush with opQueue_**

Replace the full contents of `lib/controllers/buffer_controller.ts` with:

```ts
import type {
  MediaAttachedEvent,
  SegmentLoadedEvent,
  TracksSelectedEvent,
} from "../events";
import { Events } from "../events";
import type { Player } from "../player";
import type { TrackType } from "../types/manifest";
import { OperationQueue } from "./operation_queue";

export class BufferController {
  private sourceBuffers_ = new Map<TrackType, SourceBuffer>();
  private opQueue_ = new OperationQueue();
  private mediaSource_: MediaSource | null = null;

  constructor(private player_: Player) {
    this.player_.on(Events.MEDIA_ATTACHED, this.onMediaAttached_);
    this.player_.on(Events.TRACKS_SELECTED, this.onTracksSelected_);
    this.player_.on(Events.SEGMENT_LOADED, this.onSegmentLoaded_);
  }

  destroy() {
    this.player_.off(Events.MEDIA_ATTACHED, this.onMediaAttached_);
    this.player_.off(Events.TRACKS_SELECTED, this.onTracksSelected_);
    this.player_.off(Events.SEGMENT_LOADED, this.onSegmentLoaded_);
    this.opQueue_.destroy();
    this.sourceBuffers_.clear();
    this.mediaSource_ = null;
  }

  getBufferedEnd(type: TrackType): number {
    const sb = this.sourceBuffers_.get(type);
    if (!sb || sb.buffered.length === 0) {
      return 0;
    }
    return sb.buffered.end(sb.buffered.length - 1);
  }

  private onMediaAttached_ = (event: MediaAttachedEvent) => {
    this.mediaSource_ = event.mediaSource;
  };

  private onTracksSelected_ = (event: TracksSelectedEvent) => {
    if (!this.mediaSource_) {
      return;
    }
    for (const track of event.tracks) {
      if (this.sourceBuffers_.has(track.type)) {
        continue;
      }
      const mime = `${track.mimeType};codecs="${track.codec}"`;
      const sb = this.mediaSource_.addSourceBuffer(mime);
      this.sourceBuffers_.set(track.type, sb);
      this.opQueue_.add(track.type, sb);
    }
    this.mediaSource_.duration = event.duration;
    this.player_.emit(Events.BUFFER_CREATED);
  };

  private onSegmentLoaded_ = (event: SegmentLoadedEvent) => {
    const type = event.track.type;
    this.opQueue_.enqueue(type, {
      execute: () => {
        const sb = this.sourceBuffers_.get(type);
        sb?.appendBuffer(event.data);
      },
      onComplete: () => {
        this.player_.emit(Events.BUFFER_APPENDED, { type });
      },
    });
  };
}
```

- [ ] **Step 2: Run type check**

Run: `pnpm tsc`
Expected: No errors

- [ ] **Step 3: Run format**

Run: `pnpm format`
Expected: Clean

- [ ] **Step 4: Manual smoke test**

Run: `pnpm dev`
Open the example app in a browser. Verify video plays through without errors. Check the console for any SourceBuffer-related exceptions.

- [ ] **Step 5: Commit**

```bash
git add lib/controllers/buffer_controller.ts
git commit -m "refactor: use OperationQueue in BufferController"
```

---

### Task 3: Move endOfStream to BufferController with block coordination

**Files:**
- Modify: `lib/controllers/buffer_controller.ts`
- Modify: `lib/controllers/media_controller.ts`

- [ ] **Step 1: Add BUFFER_EOS listener to BufferController**

In `lib/controllers/buffer_controller.ts`, add the import and listener.

Add to the constructor, after the existing listeners:

```ts
this.player_.on(Events.BUFFER_EOS, this.onBufferEos_);
```

Add to `destroy()`, after the existing `off` calls:

```ts
this.player_.off(Events.BUFFER_EOS, this.onBufferEos_);
```

Add the handler as a new private method at the end of the class:

```ts
private onBufferEos_ = async () => {
  const blockers = [...this.sourceBuffers_.keys()].map((type) =>
    this.opQueue_.block(type, "append"),
  );
  await Promise.all(blockers);
  if (this.mediaSource_?.readyState === "open") {
    this.mediaSource_.endOfStream();
  }
};
```

- [ ] **Step 2: Remove BUFFER_EOS handling from MediaController**

In `lib/controllers/media_controller.ts`, remove the BUFFER_EOS listener and handler.

Remove from constructor:

```ts
this.player_.on(Events.BUFFER_EOS, this.onBufferEos_);
```

Remove from `destroy()`:

```ts
this.player_.off(Events.BUFFER_EOS, this.onBufferEos_);
```

Remove the handler method:

```ts
private onBufferEos_ = () => {
  if (this.mediaSource_ && this.mediaSource_.readyState === "open") {
    this.mediaSource_.endOfStream();
  }
};
```

The resulting `MediaController` should be:

```ts
import type { MediaAttachingEvent } from "../events";
import { Events } from "../events";
import type { Player } from "../player";

export class MediaController {
  private mediaSource_: MediaSource | null = null;

  constructor(private player_: Player) {
    this.player_.on(Events.MEDIA_ATTACHING, this.onMediaAttaching_);
  }

  destroy() {
    this.player_.off(Events.MEDIA_ATTACHING, this.onMediaAttaching_);
    this.mediaSource_ = null;
  }

  private onMediaAttaching_ = (event: MediaAttachingEvent) => {
    const mediaSource = new MediaSource();
    this.mediaSource_ = mediaSource;

    mediaSource.addEventListener(
      "sourceopen",
      () => {
        this.player_.emit(Events.MEDIA_ATTACHED, {
          media: event.media,
          mediaSource,
        });
      },
      { once: true },
    );

    event.media.src = URL.createObjectURL(mediaSource);
  };
}
```

- [ ] **Step 3: Run type check**

Run: `pnpm tsc`
Expected: No errors

- [ ] **Step 4: Run format**

Run: `pnpm format`
Expected: Clean

- [ ] **Step 5: Manual smoke test**

Run: `pnpm dev`
Verify video plays to completion. The end of stream should trigger cleanly — no console errors about SourceBuffer still updating.

- [ ] **Step 6: Commit**

```bash
git add lib/controllers/buffer_controller.ts lib/controllers/media_controller.ts
git commit -m "refactor: move endOfStream to BufferController with block coordination"
```

---

### Task 4: Add bufferBehind config and back-buffer eviction

**Files:**
- Modify: `lib/config.ts`
- Modify: `lib/controllers/buffer_controller.ts`

- [ ] **Step 1: Add bufferBehind to config**

In `lib/config.ts`, update the type and default:

```ts
export type PlayerConfig = {
  bufferGoal: number;
  bufferBehind: number;
};

export const defaultConfig: PlayerConfig = {
  bufferGoal: 30,
  bufferBehind: Infinity,
};
```

- [ ] **Step 2: Add eviction logic to BufferController**

In `lib/controllers/buffer_controller.ts`, add the `BUFFER_APPENDED` listener and eviction check.

Add the import for `BufferAppendedEvent`:

```ts
import type {
  BufferAppendedEvent,
  MediaAttachedEvent,
  SegmentLoadedEvent,
  TracksSelectedEvent,
} from "../events";
```

Add to the constructor, after the existing listeners:

```ts
this.player_.on(Events.BUFFER_APPENDED, this.onBufferAppended_);
```

Add to `destroy()`, after the existing `off` calls:

```ts
this.player_.off(Events.BUFFER_APPENDED, this.onBufferAppended_);
```

Add the handler as a new private method:

```ts
private onBufferAppended_ = (event: BufferAppendedEvent) => {
  const { bufferBehind } = this.player_.getConfig();
  if (!Number.isFinite(bufferBehind)) {
    return;
  }
  const media = this.player_.getMedia();
  if (!media) {
    return;
  }
  const type = event.type;
  const sb = this.sourceBuffers_.get(type);
  if (!sb || sb.buffered.length === 0) {
    return;
  }
  const bufferedStart = sb.buffered.start(0);
  const evictEnd = media.currentTime - bufferBehind;
  if (bufferedStart >= evictEnd) {
    return;
  }
  this.opQueue_.enqueue(type, {
    execute: () => {
      sb.remove(bufferedStart, evictEnd);
    },
    onComplete: () => {},
  });
};
```

- [ ] **Step 3: Run type check**

Run: `pnpm tsc`
Expected: No errors

- [ ] **Step 4: Run format**

Run: `pnpm format`
Expected: Clean

- [ ] **Step 5: Manual smoke test**

Run: `pnpm dev`
In the example app, set `bufferBehind` to a small value (e.g., 10) via `player.setConfig({ bufferBehind: 10 })` and verify that buffered ranges behind the playhead are trimmed as playback progresses. Check using `video.buffered` in the browser console.

- [ ] **Step 6: Commit**

```bash
git add lib/config.ts lib/controllers/buffer_controller.ts
git commit -m "feat: add bufferBehind config for back-buffer eviction"
```

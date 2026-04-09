# Gap Controller Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix seek stalls caused by H.264 composition time offset
gaps by removing the aggressive `lastSegment` reset and adding a
GapController that nudges `currentTime` past buffer gaps.

**Architecture:** Two independent changes. (1) Remove a 3-line
block in StreamController that resets `lastSegment` when the buffer
is empty, causing an infinite re-fetch loop after seeking.
(2) Add a new GapController that polls every 100ms, detects when
the playhead is stalled before a buffered range, and seeks past
the gap. Follows the same pattern as hls.js's gap-controller.

**Tech Stack:** TypeScript, existing Timer utility, existing
event system.

**Spec:** `docs/superpowers/specs/2026-04-08-gap-controller-design.md`

---

### Task 1: Remove aggressive `lastSegment` reset

**Files:**
- Modify: `lib/controllers/stream_controller.ts:158-160`

- [ ] **Step 1: Remove the `bufferEnd === null` reset block**

In `lib/controllers/stream_controller.ts`, remove these 3 lines
from `update_()`:

```typescript
    if (bufferEnd === null) {
      mediaState.lastSegment = null;
    }
```

The surrounding code should read:

```typescript
    if (bufferEnd !== null && bufferEnd - currentTime >= bufferGoal) {
      return;
    }

    const lookupTime = bufferEnd ?? currentTime;
```

- [ ] **Step 2: Verify types and format**

Run:
```bash
pnpm tsc && pnpm format
```
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add lib/controllers/stream_controller.ts
git commit -m "fix: remove aggressive lastSegment reset on empty buffer

lastSegment is already reset on seek. The bufferEnd === null check
conflated buffer eviction with CTO gaps, causing an infinite
re-fetch loop after seeking."
```

---

### Task 2: Add `getNextBufferedStart` utility

**Files:**
- Modify: `lib/utils/buffer.ts`

- [ ] **Step 1: Add the `getNextBufferedStart` function**

Append to `lib/utils/buffer.ts`:

```typescript
/**
 * Find the start of the first buffered range after
 * the given position. Returns null if no range exists
 * ahead of pos.
 */
export function getNextBufferedStart(
  buffered: TimeRanges,
  pos: number,
): number | null {
  for (let i = 0; i < buffered.length; i++) {
    const start = buffered.start(i);
    if (start > pos) {
      return start;
    }
  }
  return null;
}
```

- [ ] **Step 2: Verify types and format**

Run:
```bash
pnpm tsc && pnpm format
```
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add lib/utils/buffer.ts
git commit -m "feat: add getNextBufferedStart buffer utility"
```

---

### Task 3: Create GapController

**Files:**
- Create: `lib/controllers/gap_controller.ts`

- [ ] **Step 1: Create the GapController**

Create `lib/controllers/gap_controller.ts`:

```typescript
import type { MediaAttachedEvent } from "../events";
import { Events } from "../events";
import type { Player } from "../player";
import { getNextBufferedStart } from "../utils/buffer";
import { Timer } from "../utils/timer";

const TICK_INTERVAL = 0.1;
const MAX_START_GAP_JUMP = 2;
const SKIP_BUFFER_HOLE_PADDING = 0.1;

export class GapController {
  private media_: HTMLMediaElement | null = null;
  private timer_: Timer;
  private moved_ = false;
  private stalled_: number | null = null;
  private lastCurrentTime_ = 0;

  constructor(private player_: Player) {
    this.timer_ = new Timer(() => this.poll_());
    this.player_.on(Events.MEDIA_ATTACHED, this.onMediaAttached_);
    this.player_.on(Events.MEDIA_DETACHED, this.onMediaDetached_);
  }

  destroy() {
    this.timer_.destroy();
    this.player_.off(Events.MEDIA_ATTACHED, this.onMediaAttached_);
    this.player_.off(Events.MEDIA_DETACHED, this.onMediaDetached_);
    this.media_ = null;
  }

  private onMediaAttached_ = (event: MediaAttachedEvent) => {
    this.media_ = event.media;
    this.media_.addEventListener("seeking", this.onSeeking_);
    this.media_.addEventListener("seeked", this.onSeeked_);
    this.timer_.tickEvery(TICK_INTERVAL);
  };

  private onMediaDetached_ = () => {
    this.timer_.stop();
    this.media_?.removeEventListener("seeking", this.onSeeking_);
    this.media_?.removeEventListener("seeked", this.onSeeked_);
    this.media_ = null;
    this.clearStall_();
  };

  private onSeeking_ = () => {
    this.moved_ = false;
    this.clearStall_();
  };

  private onSeeked_ = () => {
    this.clearStall_();
  };

  private poll_() {
    const media = this.media_;
    if (!media) {
      return;
    }

    const currentTime = media.currentTime;

    // Playhead moved — no stall.
    if (currentTime !== this.lastCurrentTime_) {
      this.lastCurrentTime_ = currentTime;
      this.moved_ = true;
      this.clearStall_();
      return;
    }

    // Don't interfere while seeking, paused, or ended.
    if (media.seeking || media.paused || media.ended) {
      return;
    }

    // No buffer at all — nothing to nudge to.
    if (media.buffered.length === 0) {
      return;
    }

    // Start/seek gap: playhead never moved and stall
    // was detected on a prior tick. Jump past the gap.
    if (!this.moved_ && this.stalled_ !== null) {
      this.trySkipBufferHole_(media);
      return;
    }

    // First stall detection — record and wait one tick
    // to let the browser self-resolve.
    if (this.stalled_ === null) {
      this.stalled_ = performance.now();
      return;
    }

    // Confirmed mid-stream stall — try skipping.
    this.trySkipBufferHole_(media);
  }

  /**
   * Seek past a gap to the next buffered range start.
   * Only jumps if the gap is within MAX_START_GAP_JUMP.
   */
  private trySkipBufferHole_(media: HTMLMediaElement) {
    const nextStart = getNextBufferedStart(
      media.buffered,
      media.currentTime,
    );
    if (nextStart === null) {
      return;
    }

    const gap = nextStart - media.currentTime;
    if (gap > MAX_START_GAP_JUMP) {
      return;
    }

    media.currentTime = nextStart + SKIP_BUFFER_HOLE_PADDING;
  }

  private clearStall_() {
    this.stalled_ = null;
  }
}
```

- [ ] **Step 2: Verify types and format**

Run:
```bash
pnpm tsc && pnpm format
```
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add lib/controllers/gap_controller.ts
git commit -m "feat: add GapController for buffer gap detection

Polls every 100ms. Detects when the playhead is stalled before
a buffered range (e.g. due to H.264 composition time offsets)
and seeks past the gap."
```

---

### Task 4: Register GapController in Player

**Files:**
- Modify: `lib/player.ts`

- [ ] **Step 1: Import and instantiate GapController**

In `lib/player.ts`, add the import alongside the other controllers:

```typescript
import { GapController } from "./controllers/gap_controller";
```

Add the field alongside the other controller fields:

```typescript
  private gapController_: GapController;
```

Instantiate in the constructor alongside the others:

```typescript
    this.gapController_ = new GapController(this);
```

Add `destroy` call alongside the others in `destroy()`:

```typescript
    this.gapController_.destroy();
```

The full file should read:

```typescript
import { EventEmitter } from "@matvp91/eventemitter3";
import type { PlayerConfig } from "./config";
import { defaultConfig } from "./config";
import { BufferController } from "./controllers/buffer_controller";
import { GapController } from "./controllers/gap_controller";
import { ManifestController } from "./controllers/manifest_controller";
import { StreamController } from "./controllers/stream_controller";
import type { EventMap } from "./events";
import { Events } from "./events";

export class Player extends EventEmitter<EventMap> {
  private config_ = defaultConfig;
  private media_: HTMLMediaElement | null = null;
  private manifestController_: ManifestController;
  private bufferController_: BufferController;
  private gapController_: GapController;
  private streamController_: StreamController;

  constructor() {
    super();
    this.manifestController_ = new ManifestController(this);
    this.bufferController_ = new BufferController(this);
    this.gapController_ = new GapController(this);
    this.streamController_ = new StreamController(this);
  }

  load(url: string) {
    this.emit(Events.MANIFEST_LOADING, { url });
  }

  getMedia() {
    return this.media_;
  }

  setConfig(config: Partial<PlayerConfig>) {
    this.config_ = { ...this.config_, ...config };
  }

  getConfig() {
    return this.config_;
  }

  attachMedia(media: HTMLMediaElement) {
    this.media_ = media;
    this.emit(Events.MEDIA_ATTACHING, { media });
  }

  detachMedia() {
    this.media_ = null;
    this.emit(Events.MEDIA_DETACHED);
  }

  destroy() {
    this.manifestController_.destroy();
    this.bufferController_.destroy();
    this.gapController_.destroy();
    this.streamController_.destroy();
    this.removeAllListeners();
  }
}
```

- [ ] **Step 2: Verify types and format**

Run:
```bash
pnpm tsc && pnpm format
```
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add lib/player.ts
git commit -m "feat: register GapController in Player"
```

---

### Task 5: Manual verification

- [ ] **Step 1: Start dev server**

Run:
```bash
pnpm dev
```

- [ ] **Step 2: Verify seek no longer stalls**

In the browser with the example app:
1. Let playback start from the beginning
2. Open console, set `$0.currentTime = 640.895917`
   (where `$0` is the video element)
3. Verify: playback resumes within ~200ms (one stall
   detection tick + one gap jump)
4. Verify: no repeated segment fetches in the network tab

- [ ] **Step 3: Verify second seek target**

```
$0.currentTime = 372.948534
```
Verify: same behavior — playback resumes, no re-fetch loop.

- [ ] **Step 4: Verify normal playback unaffected**

Reload and let the video play from 0 without seeking.
Verify: segments load sequentially, no stalls, plays to end.

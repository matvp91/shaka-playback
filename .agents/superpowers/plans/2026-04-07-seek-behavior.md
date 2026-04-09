# Seek Behavior & Time-Based Streaming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace sequential segment loading with time-based lookup so seeking works naturally, and decouple StreamController from BufferController by switching to interval-based polling.

**Architecture:** StreamController polls every 100ms, determines what to buffer by querying the media element's `TimeRanges` directly, and looks up segments/presentations by time instead of sequence. BufferController stays unchanged except for removing `getBufferedEnd`.

**Tech Stack:** TypeScript, Vite, pnpm, Biome

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `lib/utils/buffer.ts` | Create | Buffer info utilities (`getBufferInfo`, `isBufferedAt`) |
| `lib/utils/timer.ts` | Modify | Add `tickEvery` interval method |
| `lib/controllers/stream_controller.ts` | Modify | Time-based update loop, interval scheduling, presentation resolution |
| `lib/controllers/buffer_controller.ts` | Modify | Remove `getBufferedEnd` |
| `lib/player.ts` | Modify | Remove `getBufferedEnd` |

---

### Task 1: Buffer Utility

**Files:**
- Create: `lib/utils/buffer.ts`

- [ ] **Step 1: Create `lib/utils/buffer.ts`**

```ts
type BufferInfo = {
  start: number;
  end: number;
};

/**
 * Find the buffered range containing the given
 * position, or null if the position is unbuffered.
 */
function getBufferInfo(
  buffered: TimeRanges,
  pos: number,
): BufferInfo | null {
  for (let i = 0; i < buffered.length; i++) {
    const start = buffered.start(i);
    const end = buffered.end(i);
    if (pos >= start && pos < end) {
      return { start, end };
    }
  }
  return null;
}

export { getBufferInfo };
export type { BufferInfo };
```

- [ ] **Step 2: Verify types compile**

Run: `pnpm tsc`
Expected: No errors.

- [ ] **Step 3: Format**

Run: `pnpm format`

- [ ] **Step 4: Commit**

```bash
git add lib/utils/buffer.ts
git commit -m "feat: add buffer info utilities for time-based lookups"
```

---

### Task 2: Add `tickEvery` to Timer

The current `Timer` only supports single-shot (`tickAfter`). We need a repeating interval for the 100ms polling loop.

**Files:**
- Modify: `lib/utils/timer.ts`

- [ ] **Step 1: Add `tickEvery` and `scheduleRepeating_` to Timer**

Add `tickEvery` after `tickNow`, and `scheduleRepeating_` as a private method:

The full `lib/utils/timer.ts` after changes:

```ts
import { assertNotVoid } from "./assert";

/**
 * Timer that schedules a callback as a
 * single-shot or repeating interval.
 * Each tick cancels any pending scheduled call.
 */
export class Timer {
  private id_: ReturnType<typeof setTimeout> | null = null;
  private callback_: (() => void) | null;

  constructor(callback: () => void) {
    this.callback_ = callback;
  }

  /**
   * Schedule the callback after a delay in seconds.
   * Cancels any previously scheduled tick.
   */
  tickAfter(seconds: number): this {
    this.stop();
    this.id_ = setTimeout(() => {
      this.id_ = null;
      assertNotVoid(this.callback_, "Timer fired after destroy");
      this.callback_();
    }, seconds * 1000);
    return this;
  }

  /**
   * Schedule the callback on the next event loop tick.
   * Cancels any previously scheduled tick.
   */
  tickNow(): this {
    return this.tickAfter(0);
  }

  /**
   * Schedule the callback to repeat at a fixed
   * interval in seconds. Cancels any pending tick.
   */
  tickEvery(seconds: number): this {
    this.stop();
    this.scheduleRepeating_(seconds);
    return this;
  }

  /** Cancel any pending scheduled tick. */
  stop(): this {
    if (this.id_ !== null) {
      clearTimeout(this.id_);
      this.id_ = null;
    }
    return this;
  }

  /** Stop the timer and release the callback. */
  destroy() {
    this.stop();
    this.callback_ = null;
  }

  /**
   * Reschedule first, then call the callback.
   * If the callback calls stop(), the pending
   * timeout gets cleared.
   */
  private scheduleRepeating_(seconds: number) {
    this.id_ = setTimeout(() => {
      this.id_ = null;
      assertNotVoid(this.callback_, "Timer fired after destroy");
      this.scheduleRepeating_(seconds);
      this.callback_();
    }, seconds * 1000);
  }
}
```

- [ ] **Step 2: Verify types compile**

Run: `pnpm tsc`
Expected: No errors.

- [ ] **Step 3: Format**

Run: `pnpm format`

- [ ] **Step 4: Commit**

```bash
git add lib/utils/timer.ts
git commit -m "feat: add tickEvery interval method to Timer"
```

---

### Task 3: Rewrite StreamController

This is the core task. We rewrite the StreamController to use time-based segment lookup, interval-based scheduling, and bidirectional presentation resolution.

**Files:**
- Modify: `lib/controllers/stream_controller.ts`

- [ ] **Step 1: Rewrite `lib/controllers/stream_controller.ts`**

```ts
import type { ManifestParsedEvent, MediaAttachedEvent } from "../events";
import { Events } from "../events";
import type { Player } from "../player";
import type {
  InitSegment,
  Manifest,
  MediaType,
  Presentation,
  Segment,
  SelectionSet,
  SwitchingSet,
  Track,
} from "../types/manifest";
import { assertNotVoid } from "../utils/assert";
import { getBufferInfo } from "../utils/buffer";
import { Timer } from "../utils/timer";

const TICK_INTERVAL = 0.1;

enum State {
  STOPPED,
  IDLE,
  LOADING,
  ENDED,
}

type MediaState = {
  state: State;
  presentation: Presentation;
  selectionSet: SelectionSet;
  switchingSet: SwitchingSet;
  track: Track;
  lastInitSegment: InitSegment | null;
  timer: Timer;
};

export class StreamController {
  private manifest_: Manifest | null = null;
  private media_: HTMLMediaElement | null = null;
  private mediaStates_ = new Map<MediaType, MediaState>();

  constructor(private player_: Player) {
    this.player_.on(Events.MANIFEST_PARSED, this.onManifestParsed_);
    this.player_.on(Events.MEDIA_ATTACHED, this.onMediaAttached_);
    this.player_.on(Events.MEDIA_DETACHED, this.onMediaDetached_);
  }

  destroy() {
    for (const mediaState of this.mediaStates_.values()) {
      mediaState.timer.destroy();
    }
    this.player_.off(Events.MANIFEST_PARSED, this.onManifestParsed_);
    this.player_.off(Events.MEDIA_ATTACHED, this.onMediaAttached_);
    this.player_.off(Events.MEDIA_DETACHED, this.onMediaDetached_);
    this.manifest_ = null;
    this.mediaStates_.clear();
  }

  private onManifestParsed_ = (event: ManifestParsedEvent) => {
    this.manifest_ = event.manifest;
    this.tryStart_();
  };

  private onMediaAttached_ = (event: MediaAttachedEvent) => {
    this.media_ = event.media;
    this.tryStart_();
  };

  private onMediaDetached_ = () => {
    for (const mediaState of this.mediaStates_.values()) {
      mediaState.state = State.STOPPED;
      mediaState.timer.stop();
    }
    this.media_ = null;
  };

  private tryStart_() {
    if (!this.manifest_ || !this.media_) {
      return;
    }

    const presentation = this.manifest_.presentations[0];
    assertNotVoid(presentation, "No Presentation found");

    const codecTracks = new Map<
      MediaType,
      { mimeType: string; codec: string }
    >();

    for (const selectionSet of presentation.selectionSets) {
      const switchingSet = selectionSet.switchingSets[0];
      assertNotVoid(switchingSet, "No SwitchingSet available");

      const track = switchingSet.tracks[0];
      assertNotVoid(track, "No Track available");

      const mediaState: MediaState = {
        state: State.IDLE,
        presentation,
        selectionSet,
        switchingSet,
        track,
        lastInitSegment: null,
        timer: new Timer(() => this.onUpdate_(mediaState)),
      };

      this.mediaStates_.set(selectionSet.type, mediaState);

      codecTracks.set(selectionSet.type, {
        mimeType: switchingSet.mimeType,
        codec: switchingSet.codec,
      });
    }

    this.player_.emit(Events.BUFFER_CODECS, {
      tracks: codecTracks,
      duration: this.computeDuration_(),
    });

    for (const mediaState of this.mediaStates_.values()) {
      mediaState.timer.tickEvery(TICK_INTERVAL);
    }
  }

  /**
   * Core streaming decision for a single track.
   * Runs every tick on a 100ms interval.
   */
  private update_(mediaState: MediaState) {
    if (mediaState.state !== State.IDLE) {
      return;
    }
    if (!this.media_) {
      return;
    }

    const currentTime = this.media_.currentTime;
    const bufferGoal = this.player_.getConfig().bufferGoal;
    const bufferInfo = getBufferInfo(
      this.media_.buffered,
      currentTime,
    );

    const lookupTime = bufferInfo ? bufferInfo.end : currentTime;

    if (bufferInfo && bufferInfo.end - currentTime >= bufferGoal) {
      return;
    }

    if (!this.resolvePresentation_(mediaState, lookupTime)) {
      return;
    }

    const segment = this.getSegmentForTime_(
      mediaState.track,
      lookupTime,
    );
    if (segment) {
      this.loadSegment_(mediaState, segment);
      return;
    }

    this.checkEndOfStream_();
  }

  private onUpdate_(mediaState: MediaState) {
    this.update_(mediaState);
  }

  /**
   * Resolve the presentation chain for the given
   * time. Returns false if a new init segment must
   * be loaded first (state set to LOADING).
   */
  private resolvePresentation_(
    mediaState: MediaState,
    time: number,
  ): boolean {
    if (!this.manifest_) {
      return false;
    }

    const presentation = this.getPresentationForTime_(time);
    if (!presentation) {
      mediaState.state = State.ENDED;
      this.checkEndOfStream_();
      return false;
    }

    if (presentation === mediaState.presentation) {
      return true;
    }

    const type = mediaState.selectionSet.type;
    const selectionSet = presentation.selectionSets.find(
      (s) => s.type === type,
    );
    assertNotVoid(
      selectionSet,
      `No SelectionSet for ${type} in Presentation`,
    );

    const switchingSet = selectionSet.switchingSets[0];
    assertNotVoid(switchingSet, "No SwitchingSet in Presentation");

    const track = switchingSet.tracks[0];
    assertNotVoid(track, "No Track in Presentation");

    mediaState.presentation = presentation;
    mediaState.selectionSet = selectionSet;
    mediaState.switchingSet = switchingSet;
    mediaState.track = track;

    if (track.initSegment !== mediaState.lastInitSegment) {
      this.loadInitSegment_(mediaState);
      return false;
    }

    return true;
  }

  /**
   * Find the presentation that contains the
   * given time.
   */
  private getPresentationForTime_(
    time: number,
  ): Presentation | null {
    if (!this.manifest_) {
      return null;
    }
    for (const p of this.manifest_.presentations) {
      if (time >= p.start && time < p.end) {
        return p;
      }
    }
    return null;
  }

  /**
   * Binary search for the segment containing the
   * given time. Returns null if no segment matches.
   */
  private getSegmentForTime_(
    track: Track,
    time: number,
  ): Segment | null {
    const { segments } = track;
    let lo = 0;
    let hi = segments.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      const seg = segments[mid];
      if (time < seg.start) {
        hi = mid - 1;
      } else if (time >= seg.end) {
        lo = mid + 1;
      } else {
        return seg;
      }
    }
    return null;
  }

  private checkEndOfStream_() {
    const allDone = [...this.mediaStates_.values()].every(
      (ms) => ms.state === State.ENDED,
    );
    if (allDone) {
      this.player_.emit(Events.BUFFER_EOS);
    }
  }

  /** Get total presentation duration. */
  private computeDuration_(): number {
    const end = this.manifest_?.presentations.at(-1)?.end;
    assertNotVoid(end, "Cannot compute duration");
    return end;
  }

  private async loadInitSegment_(mediaState: MediaState) {
    const { initSegment } = mediaState.track;

    if (mediaState.lastInitSegment === initSegment) {
      return;
    }

    mediaState.state = State.LOADING;

    const response = await fetch(initSegment.url);
    const data = await response.arrayBuffer();

    if (mediaState.state !== State.LOADING) {
      return;
    }

    mediaState.lastInitSegment = initSegment;

    this.player_.emit(Events.BUFFER_APPENDING, {
      type: mediaState.selectionSet.type,
      initSegment,
      data,
      segment: null,
    });

    mediaState.state = State.IDLE;
  }

  private async loadSegment_(
    mediaState: MediaState,
    segment: Segment,
  ) {
    mediaState.state = State.LOADING;

    const response = await fetch(segment.url);
    const data = await response.arrayBuffer();

    if (mediaState.state !== State.LOADING) {
      return;
    }

    this.player_.emit(Events.BUFFER_APPENDING, {
      type: mediaState.selectionSet.type,
      initSegment: mediaState.track.initSegment,
      segment,
      data,
    });

    mediaState.state = State.IDLE;
  }
}
```

- [ ] **Step 2: Verify types compile**

Run: `pnpm tsc`
Expected: No errors.

- [ ] **Step 3: Format**

Run: `pnpm format`

- [ ] **Step 4: Commit**

```bash
git add lib/controllers/stream_controller.ts
git commit -m "refactor: time-based segment lookup with interval scheduling"
```

---

### Task 4: Remove `getBufferedEnd` from BufferController and Player

**Files:**
- Modify: `lib/controllers/buffer_controller.ts`
- Modify: `lib/player.ts`

- [ ] **Step 1: Remove `getBufferedEnd` from BufferController**

In `lib/controllers/buffer_controller.ts`, remove the entire method (lines 44-50):

```ts
  getBufferedEnd(type: MediaType): number {
    const sb = this.sourceBuffers_.get(type);
    if (!sb || sb.buffered.length === 0) {
      return 0;
    }
    return sb.buffered.end(sb.buffered.length - 1);
  }
```

- [ ] **Step 2: Remove `getBufferedEnd` from Player**

In `lib/player.ts`, remove the method (lines 41-43):

```ts
  getBufferedEnd(type: MediaType): number {
    return this.bufferController_.getBufferedEnd(type);
  }
```

Also remove the `MediaType` import if no longer used. Check if `MediaType` is used elsewhere in `player.ts` — it is not (only used for `getBufferedEnd`), so remove it from the import:

```ts
import type { MediaType } from "./types/manifest";
```

- [ ] **Step 3: Verify types compile**

Run: `pnpm tsc`
Expected: No errors. If BufferController still imports `MediaType` for its own internal use, that's fine — only remove the import from `player.ts`.

- [ ] **Step 4: Format**

Run: `pnpm format`

- [ ] **Step 5: Commit**

```bash
git add lib/controllers/buffer_controller.ts lib/player.ts
git commit -m "refactor: remove getBufferedEnd from Player and BufferController"
```

---

### Task 5: Manual Verification

**Files:** None — testing only.

- [ ] **Step 1: Run dev server**

Run: `pnpm dev`

Open the example app in a browser. Verify:
1. Normal playback works — video plays from start, segments load progressively.
2. Seek within buffered range — playback resumes instantly, no re-fetch.
3. Seek to unbuffered position — segments load at the new position, playback resumes.
4. If multi-period content is available, seek across period boundary and verify playback continues.

- [ ] **Step 2: Check for console errors**

Open browser DevTools console during the above tests. No errors should appear.

- [ ] **Step 3: Build**

Run: `pnpm build`
Expected: Build succeeds with no errors.

- [ ] **Step 4: Type check**

Run: `pnpm tsc`
Expected: No errors.

- [ ] **Step 5: Format**

Run: `pnpm format`
Expected: No formatting changes needed (already formatted in prior tasks).

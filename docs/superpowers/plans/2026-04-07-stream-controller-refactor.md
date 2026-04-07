# Stream Controller Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor stream controller to enforce single responsibility via an explicit state machine and move MSE concerns (mp4 parsing, timestamp offset) to buffer controller.

**Architecture:** Introduce a per-MediaState state machine (STOPPED, IDLE, LOADING_INIT, LOADING_SEGMENT, ENDED) that gates all fetch decisions. Redesign the `BufferAppendingEvent` to carry manifest objects instead of computed offsets, letting buffer controller derive `timestampOffset` from raw segment data.

**Tech Stack:** TypeScript, Biome (formatting/linting)

**Spec:** `docs/superpowers/specs/2026-04-07-stream-controller-refactor-design.md`

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `lib/events.ts` | Modify | Update `BufferAppendingEvent` type |
| `lib/controllers/stream_controller.ts` | Rewrite | State machine, simplified update loop, SRP cleanup |
| `lib/controllers/buffer_controller.ts` | Modify | Add timestamp offset derivation from raw segments |

---

### Task 1: Update `BufferAppendingEvent` type

**Files:**
- Modify: `lib/events.ts:38-42`
- Modify: `lib/events.ts:1` (imports)

This is the shared contract between stream and buffer controller. Change it first so both sides can be updated against the new shape.

- [ ] **Step 1: Update the import in `lib/events.ts`**

Add `InitSegment` and `Segment` to the type import at line 1:

```ts
import type { InitSegment, Manifest, MediaType, Segment } from "./types/manifest";
```

- [ ] **Step 2: Replace `BufferAppendingEvent` type**

Replace lines 38-42:

```ts
export type BufferAppendingEvent = {
  type: MediaType;
  initSegment: InitSegment;
  data: ArrayBuffer;
  segment?: Segment;
};
```

- [ ] **Step 3: Run type check**

Run: `pnpm tsc`
Expected: Type errors in `stream_controller.ts` (still emitting old shape) and `buffer_controller.ts` (still destructuring `timestampOffset`). This is correct — we'll fix both in subsequent tasks.

- [ ] **Step 4: Run formatter**

Run: `pnpm format`

- [ ] **Step 5: Commit**

```bash
git add lib/events.ts
git commit -m "refactor: update BufferAppendingEvent to carry manifest objects"
```

---

### Task 2: Move timestamp offset derivation to buffer controller

**Files:**
- Modify: `lib/controllers/buffer_controller.ts:1-6` (imports)
- Modify: `lib/controllers/buffer_controller.ts:12-16` (class fields)
- Modify: `lib/controllers/buffer_controller.ts:83-103` (`onBufferAppending_`)

Buffer controller already applies `sb.timestampOffset`. Now it also derives the value by parsing mp4 boxes from the raw segment data.

- [ ] **Step 1: Add mp4 and manifest imports**

Replace lines 1-6 of `lib/controllers/buffer_controller.ts`:

```ts
import type {
  BufferAppendedEvent,
  BufferAppendingEvent,
  BufferCodecsEvent,
  MediaAttachingEvent,
} from "../events";
import { Events } from "../events";
import type { Player } from "../player";
import type { InitSegment, MediaType } from "../types/manifest";
import { assertNotVoid } from "../utils/assert";
import { parseBaseMediaDecodeTime, parseTimescale } from "../utils/mp4";
import { OperationQueue } from "./operation_queue";
```

- [ ] **Step 2: Add timescale cache field**

Replace lines 12-16 (the class fields block):

```ts
  private sourceBuffers_ = new Map<MediaType, SourceBuffer>();
  private opQueue_ = new OperationQueue();
  private mediaSource_: MediaSource | null = null;
  private duration_ = 0;
  private timescaleCache_ = new Map<InitSegment, number>();
```

- [ ] **Step 3: Rewrite `onBufferAppending_`**

Replace lines 83-103 (the entire `onBufferAppending_` method):

```ts
  private onBufferAppending_ = (event: BufferAppendingEvent) => {
    const { type, initSegment, data, segment } = event;

    if (!segment) {
      this.timescaleCache_.set(initSegment, parseTimescale(data));
    }

    const timestampOffset = segment
      ? this.computeTimestampOffset_(initSegment, segment, data)
      : undefined;

    this.opQueue_.enqueue(type, {
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
        this.player_.emit(Events.BUFFER_APPENDED, { type });
      },
    });
  };
```

- [ ] **Step 4: Add `computeTimestampOffset_` method**

Add this method after `onBufferAppending_` (before `onBufferAppended_`):

```ts
  /**
   * Derive timestampOffset from mp4 container data.
   * Uses cached timescale from the init segment and
   * baseMediaDecodeTime from the media segment.
   */
  private computeTimestampOffset_(
    initSegment: InitSegment,
    segment: { start: number },
    data: ArrayBuffer,
  ): number {
    const timescale = this.timescaleCache_.get(initSegment);
    assertNotVoid(timescale, "Init segment not parsed");
    const mediaTime = parseBaseMediaDecodeTime(data) / timescale;
    return segment.start - mediaTime;
  }
```

- [ ] **Step 5: Run type check**

Run: `pnpm tsc`
Expected: Type errors only in `stream_controller.ts` (still emitting old event shape). Buffer controller should be clean.

- [ ] **Step 6: Run formatter**

Run: `pnpm format`

- [ ] **Step 7: Commit**

```bash
git add lib/controllers/buffer_controller.ts
git commit -m "refactor: move timestamp offset derivation to buffer controller"
```

---

### Task 3: Rewrite stream controller with state machine

**Files:**
- Rewrite: `lib/controllers/stream_controller.ts`

This is the core task. Replace the entire stream controller with the state machine design.

- [ ] **Step 1: Write the complete new stream controller**

Replace the full contents of `lib/controllers/stream_controller.ts`:

```ts
import type {
  BufferAppendedEvent,
  ManifestParsedEvent,
  MediaAttachedEvent,
} from "../events";
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
import { Timer } from "../utils/timer";

const enum State {
  STOPPED,
  IDLE,
  LOADING_INIT,
  LOADING_SEGMENT,
  ENDED,
}

type MediaState = {
  state: State;
  presentation: Presentation;
  selectionSet: SelectionSet;
  switchingSet: SwitchingSet;
  track: Track;
  lastSegment: Segment | null;
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
    this.player_.on(Events.BUFFER_CREATED, this.onBufferCreated_);
    this.player_.on(Events.BUFFER_APPENDED, this.onBufferAppended_);
  }

  destroy() {
    this.stopMediaStates_();
    this.player_.off(Events.MANIFEST_PARSED, this.onManifestParsed_);
    this.player_.off(Events.MEDIA_ATTACHED, this.onMediaAttached_);
    this.player_.off(Events.MEDIA_DETACHED, this.onMediaDetached_);
    this.player_.off(Events.BUFFER_CREATED, this.onBufferCreated_);
    this.player_.off(Events.BUFFER_APPENDED, this.onBufferAppended_);
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
    this.stopMediaStates_();
    this.media_ = null;
  };

  private onBufferCreated_ = () => {
    for (const mediaState of this.mediaStates_.values()) {
      this.loadInitSegment_(mediaState);
    }
  };

  private onBufferAppended_ = (event: BufferAppendedEvent) => {
    const mediaState = this.mediaStates_.get(event.type);
    if (!mediaState) {
      return;
    }
    if (
      mediaState.state !== State.LOADING_INIT &&
      mediaState.state !== State.LOADING_SEGMENT
    ) {
      return;
    }
    mediaState.state = State.IDLE;
    this.update_(mediaState);
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
        lastSegment: null,
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
  }

  /**
   * Core streaming decision for a single track.
   * Returns seconds until next poll, or null
   * if no reschedule is needed.
   */
  private update_(mediaState: MediaState): number | null {
    if (mediaState.state !== State.IDLE) {
      return null;
    }

    const currentTime = this.player_.getMedia()?.currentTime ?? 0;
    const bufferGoal = this.player_.getConfig().bufferGoal;
    const bufferedEnd = this.player_.getBufferedEnd(
      mediaState.selectionSet.type,
    );

    if (bufferedEnd - currentTime >= bufferGoal) {
      return 1;
    }

    const nextSegment = this.getNextSegment_(mediaState);
    if (nextSegment) {
      mediaState.state = State.LOADING_SEGMENT;
      this.loadSegment_(mediaState, nextSegment);
      return null;
    }

    this.advancePresentation_(mediaState);
    return null;
  }

  private onUpdate_(mediaState: MediaState) {
    const delay = this.update_(mediaState);
    if (delay !== null) {
      mediaState.timer.tickAfter(delay);
    }
  }

  /**
   * Find the next segment to load.
   * Pure — no side effects.
   */
  private getNextSegment_(mediaState: MediaState): Segment | null {
    const { segments } = mediaState.track;
    if (!mediaState.lastSegment) {
      return segments[0] ?? null;
    }
    const lastIndex = segments.indexOf(mediaState.lastSegment);
    return segments[lastIndex + 1] ?? null;
  }

  /**
   * Advance to the next presentation. Throws on
   * CMAF inconsistency. Sets ENDED when no more
   * presentations are available.
   */
  private advancePresentation_(mediaState: MediaState) {
    if (!this.manifest_) {
      return;
    }

    const presentations = this.manifest_.presentations;
    const currentIndex = presentations.indexOf(mediaState.presentation);
    const nextPresentation = presentations[currentIndex + 1];

    if (!nextPresentation) {
      mediaState.state = State.ENDED;
      this.checkEndOfStream_();
      return;
    }

    const type = mediaState.selectionSet.type;
    const selectionSet = nextPresentation.selectionSets.find(
      (s) => s.type === type,
    );
    assertNotVoid(
      selectionSet,
      `No SelectionSet for ${type} in next Presentation`,
    );

    const switchingSet = selectionSet.switchingSets[0];
    assertNotVoid(switchingSet, "No SwitchingSet in next Presentation");

    const track = switchingSet.tracks[0];
    assertNotVoid(track, "No Track in next Presentation");

    mediaState.presentation = nextPresentation;
    mediaState.selectionSet = selectionSet;
    mediaState.switchingSet = switchingSet;
    mediaState.track = track;
    mediaState.lastSegment = null;

    this.loadInitSegment_(mediaState);
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
      mediaState.state = State.IDLE;
      this.update_(mediaState);
      return;
    }

    mediaState.state = State.LOADING_INIT;

    const response = await fetch(initSegment.url);
    const data = await response.arrayBuffer();

    mediaState.lastInitSegment = initSegment;

    this.player_.emit(Events.BUFFER_APPENDING, {
      type: mediaState.selectionSet.type,
      initSegment,
      data,
    });
  }

  private async loadSegment_(mediaState: MediaState, segment: Segment) {
    const response = await fetch(segment.url);
    const data = await response.arrayBuffer();

    mediaState.lastSegment = segment;

    this.player_.emit(Events.BUFFER_APPENDING, {
      type: mediaState.selectionSet.type,
      initSegment: mediaState.track.initSegment,
      segment,
      data,
    });
  }

  private stopMediaStates_() {
    for (const mediaState of this.mediaStates_.values()) {
      mediaState.state = State.STOPPED;
      mediaState.timer.stop();
    }
  }
}
```

- [ ] **Step 2: Run type check**

Run: `pnpm tsc`
Expected: PASS — all three files (events, buffer controller, stream controller) should be consistent.

- [ ] **Step 3: Run formatter**

Run: `pnpm format`

- [ ] **Step 4: Commit**

```bash
git add lib/controllers/stream_controller.ts
git commit -m "refactor: rewrite stream controller with state machine"
```

---

### Task 4: Verify and clean up

**Files:**
- Verify: `lib/controllers/stream_controller.ts`
- Verify: `lib/controllers/buffer_controller.ts`
- Verify: `lib/events.ts`

Final verification that everything compiles, formats, and the dev server runs.

- [ ] **Step 1: Run full type check**

Run: `pnpm tsc`
Expected: PASS with no errors.

- [ ] **Step 2: Run formatter**

Run: `pnpm format`
Expected: No changes needed (already formatted in prior tasks).

- [ ] **Step 3: Smoke test with dev server**

Run: `pnpm dev`
Open the example app in a browser. Verify:
- Video loads and plays
- Audio + video are in sync
- Multi-period content transitions cleanly (if test content has multiple periods)
- No console errors

- [ ] **Step 4: Commit any fixes**

If any issues were found in step 3, fix and commit:

```bash
git add -A
git commit -m "fix: address issues found during smoke test"
```

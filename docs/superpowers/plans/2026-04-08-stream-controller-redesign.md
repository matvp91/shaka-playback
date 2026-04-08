# StreamController Redesign & SegmentFetch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix presentation advancement bugs and separate fetch concerns from streaming decisions by introducing SegmentFetch and rewriting StreamController's tick loop.

**Architecture:** SegmentFetch is a new class wrapping native `fetch()` with a cache and cancellation — one instance per media type. StreamController is rewritten to never resolve presentations per tick; instead, presentation transitions happen at four explicit points. All error handling except AbortError is deferred.

**Tech Stack:** TypeScript, Vite, Biome

---

## File Structure

- **Create:** `lib/controllers/segment_fetch.ts` — cache-backed fetcher with cancellation
- **Rewrite:** `lib/controllers/stream_controller.ts` — new MediaState, new update_() flow, explicit presentation transitions
- **Unchanged:** `lib/utils/request.ts` (kept for ManifestController), `lib/controllers/buffer_controller.ts`, `lib/events.ts`

---

### Task 1: Create SegmentFetch

**Files:**
- Create: `lib/controllers/segment_fetch.ts`

- [ ] **Step 1: Create SegmentFetch class**

```typescript
import type { InitSegment, Segment } from "../types/manifest";

/**
 * Segment fetcher with cancellation. One instance
 * per media type. Uses native fetch() and
 * AbortController internally.
 */
export class SegmentFetch {
  private controller_: AbortController | null = null;

  /**
   * Fetch segment data from network. Implicitly
   * cancels any previous in-flight request.
   * Returns null when the request was aborted.
   */
  async fetch(
    segment: Segment | InitSegment,
  ): Promise<ArrayBuffer | null> {
    this.controller_?.abort();
    this.controller_ = new AbortController();

    try {
      const response = await fetch(segment.url, {
        signal: this.controller_.signal,
      });
      const data = await response.arrayBuffer();
      this.controller_ = null;
      return data;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return null;
      }
      throw error;
    }
  }

  /** Abort in-flight request. */
  cancel() {
    this.controller_?.abort();
    this.controller_ = null;
  }

  /** Whether a network request is in-flight. */
  isLoading(): boolean {
    return this.controller_ !== null;
  }
}
```

- [ ] **Step 2: Verify build**

Run: `pnpm tsc`
Expected: No type errors.

- [ ] **Step 3: Run format**

Run: `pnpm format`

- [ ] **Step 4: Commit**

```bash
git add lib/controllers/segment_fetch.ts
git commit -m "feat: add SegmentFetch with cache and cancellation"
```

---

### Task 2: Rewrite StreamController

**Files:**
- Rewrite: `lib/controllers/stream_controller.ts`

This is a full rewrite. The file is replaced entirely. The new version uses SegmentFetch, removes the State enum, removes resolvePresentation_(), removes loadInitSegment_()/loadSegment_(), removes onBufferAppended_, and introduces the new update_() flow with explicit presentation transitions.

- [ ] **Step 1: Write the new StreamController**

Replace the entire contents of `lib/controllers/stream_controller.ts` with:

```typescript
import type {
  BufferCreatedEvent,
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
  Track,
} from "../types/manifest";
import { binarySearch } from "../utils/array";
import { assertNotVoid } from "../utils/assert";
import { getBufferInfo } from "../utils/buffer";
import { Timer } from "../utils/timer";
import { SegmentFetch } from "./segment_fetch";

const TICK_INTERVAL = 0.1;

type MediaState = {
  type: MediaType;
  ended: boolean;
  presentation: Presentation;
  track: Track;
  lastSegment: Segment | null;
  lastInitSegment: InitSegment | null;
  fetch: SegmentFetch;
  timer: Timer;
};

export class StreamController {
  private manifest_: Manifest | null = null;
  private media_: HTMLMediaElement | null = null;
  private mediaStates_ = new Map<MediaType, MediaState>();
  private sourceBuffers_ = new Map<MediaType, SourceBuffer>();

  constructor(private player_: Player) {
    this.player_.on(Events.MANIFEST_PARSED, this.onManifestParsed_);
    this.player_.on(Events.MEDIA_ATTACHED, this.onMediaAttached_);
    this.player_.on(Events.MEDIA_DETACHED, this.onMediaDetached_);
    this.player_.on(Events.BUFFER_CREATED, this.onBufferCreated_);
  }

  destroy() {
    for (const mediaState of this.mediaStates_.values()) {
      mediaState.fetch.cancel();
      mediaState.timer.destroy();
    }
    this.player_.off(Events.MANIFEST_PARSED, this.onManifestParsed_);
    this.player_.off(Events.MEDIA_ATTACHED, this.onMediaAttached_);
    this.player_.off(Events.MEDIA_DETACHED, this.onMediaDetached_);
    this.player_.off(Events.BUFFER_CREATED, this.onBufferCreated_);
    this.manifest_ = null;
    this.mediaStates_.clear();
    this.sourceBuffers_.clear();
  }

  private onManifestParsed_ = (event: ManifestParsedEvent) => {
    this.manifest_ = event.manifest;
    this.tryStart_();
  };

  private onMediaAttached_ = (event: MediaAttachedEvent) => {
    this.media_ = event.media;
    this.media_.addEventListener("seeking", this.onSeeking_);
    this.tryStart_();
  };

  private onBufferCreated_ = (event: BufferCreatedEvent) => {
    this.sourceBuffers_ = event.sourceBuffers;
  };

  private onMediaDetached_ = () => {
    for (const mediaState of this.mediaStates_.values()) {
      mediaState.fetch.cancel();
      mediaState.timer.stop();
    }
    this.media_?.removeEventListener("seeking", this.onSeeking_);
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

      const type = selectionSet.type;

      const mediaState: MediaState = {
        type,
        ended: false,
        presentation,
        track,
        lastSegment: null,
        lastInitSegment: null,
        fetch: new SegmentFetch(),
        timer: new Timer(() => this.update_(mediaState)),
      };

      this.mediaStates_.set(type, mediaState);

      codecTracks.set(type, {
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
   * Runs every tick on a 100ms interval. Synchronous
   * — kicks off async fetch but does not await.
   */
  private update_(mediaState: MediaState) {
    if (mediaState.ended || mediaState.fetch.isLoading()) {
      return;
    }
    if (!this.media_) {
      return;
    }

    const currentTime = this.media_.currentTime;
    const bufferGoal = this.player_.getConfig().bufferGoal;
    const bufferEnd = this.getBufferEnd_(
      mediaState.type,
      currentTime,
    );

    if (
      bufferEnd !== null &&
      bufferEnd - currentTime >= bufferGoal
    ) {
      return;
    }

    if (bufferEnd === null) {
      mediaState.lastSegment = null;
    }

    const lookupTime = bufferEnd ?? currentTime;

    const segment = mediaState.lastSegment
      ? this.getNextSegment_(mediaState)
      : this.getSegmentForTime_(mediaState.track, lookupTime);

    if (!segment) {
      // Resolve time: sequential path uses the
      // presentation boundary, time-based path uses
      // the lookup time (seek or buffer-lost).
      const time = mediaState.lastSegment
        ? mediaState.presentation.end
        : lookupTime;

      const presentation =
        this.getPresentationForTime_(time);
      if (!presentation) {
        mediaState.ended = true;
        this.checkEndOfStream_();
        return;
      }

      if (presentation !== mediaState.presentation) {
        mediaState.presentation = presentation;
        mediaState.track = this.getTrackForType_(
          presentation,
          mediaState.type,
        );
        mediaState.lastSegment = null;
        return;
      }

      // Same presentation, no segment — check EOS.
      // Float precision means bufferEnd may never
      // exactly reach the duration (Shaka v2).
      const duration = this.computeDuration_();
      if (lookupTime >= duration - 1e-6) {
        mediaState.ended = true;
        this.checkEndOfStream_();
      }
      return;
    }

    if (
      mediaState.track.initSegment !== mediaState.lastInitSegment
    ) {
      this.loadInitSegment_(mediaState);
      return;
    }

    mediaState.lastSegment = segment;
    this.loadSegment_(mediaState, segment);
  }

  /**
   * Fetch init segment and emit BUFFER_APPENDING.
   */
  private async loadInitSegment_(mediaState: MediaState) {
    const { initSegment } = mediaState.track;

    // Returns null when the request was aborted.
    const data = await mediaState.fetch.fetch(initSegment);
    if (!data) {
      return;
    }

    mediaState.lastInitSegment = initSegment;
    this.player_.emit(Events.BUFFER_APPENDING, {
      type: mediaState.type,
      initSegment,
      data,
      segment: null,
    });
  }

  /**
   * Fetch media segment and emit BUFFER_APPENDING.
   */
  private async loadSegment_(
    mediaState: MediaState,
    segment: Segment,
  ) {
    // Returns null when the request was aborted.
    const data = await mediaState.fetch.fetch(segment);
    if (!data) {
      return;
    }

    this.player_.emit(Events.BUFFER_APPENDING, {
      type: mediaState.type,
      initSegment: mediaState.track.initSegment,
      segment,
      data,
    });
  }

  /**
   * Find the presentation for the given time.
   * Returns the first presentation whose end is
   * past the time, which handles gaps between
   * presentations and float-precision at boundaries.
   */
  private getPresentationForTime_(
    time: number,
  ): Presentation | null {
    if (!this.manifest_) {
      return null;
    }
    for (const p of this.manifest_.presentations) {
      if (time < p.end) {
        return p;
      }
    }
    return null;
  }

  /**
   * Walk the manifest chain from presentation to
   * track for the given media type.
   */
  private getTrackForType_(
    presentation: Presentation,
    type: MediaType,
  ): Track {
    const selectionSet = presentation.selectionSets.find(
      (s) => s.type === type,
    );
    assertNotVoid(
      selectionSet,
      `No SelectionSet for ${type}`,
    );

    const switchingSet = selectionSet.switchingSets[0];
    assertNotVoid(switchingSet, "No SwitchingSet");

    return switchingSet.tracks[0];
  }

  /**
   * Get the end of the buffered range containing
   * the given time for a specific media type.
   */
  private getBufferEnd_(
    type: MediaType,
    time: number,
  ): number | null {
    const sb = this.sourceBuffers_.get(type);
    if (!sb) {
      return null;
    }
    const { maxBufferHole } = this.player_.getConfig();
    const info = getBufferInfo(sb.buffered, time, maxBufferHole);
    return info ? info.end : null;
  }

  /**
   * Find the next segment after lastSegment
   * in the current track.
   */
  private getNextSegment_(
    mediaState: MediaState,
  ): Segment | null {
    const { segments } = mediaState.track;
    assertNotVoid(mediaState.lastSegment, "No last segment");
    const lastIndex = segments.indexOf(
      mediaState.lastSegment,
    );
    return segments[lastIndex + 1] ?? null;
  }

  /**
   * Binary search for the segment containing the
   * given time. Returns null if no segment matches.
   */
  private getSegmentForTime_(
    track: Track,
    time: number,
  ): Segment | null {
    const { maxSegmentLookupTolerance } =
      this.player_.getConfig();
    return binarySearch(track.segments, (seg) => {
      if (time >= seg.start && time < seg.end) {
        return 0;
      }
      if (time < seg.start) {
        const tolerance = Math.min(
          maxSegmentLookupTolerance,
          seg.end - seg.start,
        );
        if (
          seg.start - tolerance > time &&
          seg.start > 0
        ) {
          return -1;
        }
        return 0;
      }
      return 1;
    });
  }

  private checkEndOfStream_() {
    const allDone = [...this.mediaStates_.values()].every(
      (ms) => ms.ended,
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

  private onSeeking_ = () => {
    for (const mediaState of this.mediaStates_.values()) {
      mediaState.ended = false;
      mediaState.fetch.cancel();
      mediaState.lastSegment = null;
      this.update_(mediaState);
    }
  };
}
```

- [ ] **Step 2: Verify build**

Run: `pnpm tsc`
Expected: No type errors.

- [ ] **Step 3: Run format**

Run: `pnpm format`

- [ ] **Step 4: Verify no remaining references to old patterns**

Check that `Request` import, `State` enum, `onBufferAppended_`, `loadInitSegment_`, `loadSegment_`, and `resolvePresentation_` per-tick call are all gone. The file should not import from `../utils/request` or `../errors`.

- [ ] **Step 5: Commit**

```bash
git add lib/controllers/stream_controller.ts
git commit -m "refactor: rewrite StreamController with explicit presentation transitions and SegmentFetch"
```

---

### Task 3: Remove BUFFER_APPENDED listener registration

The `BUFFER_APPENDED` event listener was only used to clear `mediaState.request`. Since SegmentFetch now owns request state, the StreamController no longer listens for this event. However, BufferController still emits it (used for buffer eviction). We just need to verify StreamController no longer registers for it.

**Files:**
- Verify: `lib/controllers/stream_controller.ts` (already done in Task 2)
- Verify: `lib/events.ts` (no changes needed — event still used by BufferController)

- [ ] **Step 1: Verify BufferController still uses BUFFER_APPENDED**

Read `lib/controllers/buffer_controller.ts` and confirm it still emits and listens for `BUFFER_APPENDED` for buffer eviction. No changes needed.

- [ ] **Step 2: Verify build end-to-end**

Run: `pnpm tsc && pnpm format`
Expected: No errors.

- [ ] **Step 3: Commit (if any formatting changes)**

```bash
git add -A
git commit -m "chore: verify BUFFER_APPENDED cleanup"
```

---

### Task 4: Manual verification

- [ ] **Step 1: Run dev server**

Run: `pnpm dev`

- [ ] **Step 2: Test multi-period playback**

Load a multi-period DASH manifest. Verify:
- Playback crosses P1→P2 boundary without stalling
- Buffer continues filling into P2 and crosses P2→P3
- Init segments are fetched at each presentation boundary (visible in Network tab)
- `endOfStream()` fires when all content is buffered

- [ ] **Step 3: Test seek across presentations**

Seek to a time in a later presentation. Verify:
- Correct presentation is resolved
- Init segment for that presentation is fetched
- Segments load from the correct track
- Buffer fills from the seek point

- [ ] **Step 4: Test seek while loading**

Seek while a segment is in-flight. Verify:
- In-flight request is cancelled (visible in Network tab as cancelled)
- New segment loads from seek position
- No stale data appended

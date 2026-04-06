# StreamController Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor StreamController to use per-stream timers, time-based segment selection, and init loading tied to SourceBuffer creation. Move BufferController and events to use TrackType as the key instead of SelectionSet.

**Architecture:** Replace TaskLoop with a Timer utility. Each stream gets a MediaState with its own Timer for independent scheduling. Segment selection is time-based (from bufferedEnd) instead of index-based. Init segments load on BUFFER_CREATED, not in the update loop. BufferController and all events use TrackType as the key, removing SelectionSet from the buffer layer.

**Tech Stack:** TypeScript, Vite, pnpm, Biome

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `lib/utils/timer.ts` | Create | Single-shot timer with `tickAfter`/`tickNow`/`stop`/`destroy` |
| `lib/utils/task_loop.ts` | Delete | Replaced by Timer |
| `lib/events.ts` | Modify | Rename BUFFER_CODECS → TRACKS_SELECTED, simplify payloads, use TrackType |
| `lib/controllers/buffer_controller.ts` | Modify | Key by TrackType, listen for TRACKS_SELECTED |
| `lib/controllers/stream_controller.ts` | Rewrite | MediaState, per-stream timers, time-based segment selection |
| `lib/player.ts` | Modify | `getBufferedEnd(type: TrackType)` |
| `example/main.ts` | Modify | Adapt to event changes |

---

### Task 1: Create Timer utility

**Files:**
- Create: `lib/utils/timer.ts`

- [ ] **Step 1: Create Timer class**

```ts
import { assertNotVoid } from "./assert";

/**
 * Single-shot timer that schedules a callback.
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
}
```

- [ ] **Step 2: Run type check**

Run: `pnpm tsc`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add lib/utils/timer.ts
git commit -m "feat: add Timer utility class"
```

---

### Task 2: Update events and BufferController to use TrackType

**Files:**
- Modify: `lib/events.ts`
- Modify: `lib/controllers/buffer_controller.ts`
- Modify: `lib/player.ts`
- Modify: `example/main.ts`

- [ ] **Step 1: Update events.ts**

Replace the entire contents of `lib/events.ts` with:

```ts
import type { Manifest, Track } from "./types/manifest";
import type { TrackType } from "./types/manifest";

export const Events = {
  MANIFEST_LOADING: "manifestLoading",
  MANIFEST_PARSED: "manifestParsed",
  MEDIA_ATTACHING: "mediaAttaching",
  MEDIA_ATTACHED: "mediaAttached",
  MEDIA_DETACHED: "mediaDetached",
  TRACKS_SELECTED: "tracksSelected",
  BUFFER_CREATED: "bufferCreated",
  SEGMENT_LOADED: "segmentLoaded",
  BUFFER_APPENDED: "bufferAppended",
  BUFFER_EOS: "bufferEos",
};

export type ManifestLoadingEvent = {
  url: string;
};

export type ManifestParsedEvent = {
  manifest: Manifest;
};

export type MediaAttachingEvent = {
  media: HTMLMediaElement;
};

export type MediaAttachedEvent = {
  media: HTMLMediaElement;
  mediaSource: MediaSource;
};

export type TracksSelectedEvent = {
  tracks: Track[];
};

export type SegmentLoadedEvent = {
  track: Track;
  data: ArrayBuffer;
};

export type BufferAppendedEvent = {
  type: TrackType;
};

export interface EventMap {
  [Events.MANIFEST_LOADING]: (event: ManifestLoadingEvent) => void;
  [Events.MANIFEST_PARSED]: (event: ManifestParsedEvent) => void;
  [Events.MEDIA_ATTACHING]: (event: MediaAttachingEvent) => void;
  [Events.MEDIA_ATTACHED]: (event: MediaAttachedEvent) => void;
  [Events.MEDIA_DETACHED]: undefined;
  [Events.TRACKS_SELECTED]: (event: TracksSelectedEvent) => void;
  [Events.BUFFER_CREATED]: undefined;
  [Events.SEGMENT_LOADED]: (event: SegmentLoadedEvent) => void;
  [Events.BUFFER_APPENDED]: (event: BufferAppendedEvent) => void;
  [Events.BUFFER_EOS]: undefined;
}
```

- [ ] **Step 2: Update BufferController**

Replace the entire contents of `lib/controllers/buffer_controller.ts` with:

```ts
import type {
  MediaAttachedEvent,
  SegmentLoadedEvent,
  TracksSelectedEvent,
} from "../events";
import { Events } from "../events";
import type { Player } from "../player";
import type { TrackType } from "../types/manifest";

type QueueItem = {
  type: TrackType;
  data: ArrayBuffer;
};

export class BufferController {
  private sourceBuffers_ = new Map<TrackType, SourceBuffer>();
  private queue_: QueueItem[] = [];
  private appending_ = false;
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
    this.sourceBuffers_.clear();
    this.queue_ = [];
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
    }
    this.player_.emit(Events.BUFFER_CREATED);
  };

  private onSegmentLoaded_ = (event: SegmentLoadedEvent) => {
    this.queue_.push({
      type: event.track.type,
      data: event.data,
    });
    this.flush_();
  };

  private flush_() {
    if (this.appending_ || this.queue_.length === 0) {
      return;
    }
    const item = this.queue_.shift();
    if (!item) {
      return;
    }
    const sb = this.sourceBuffers_.get(item.type);
    if (!sb) {
      return;
    }

    this.appending_ = true;

    sb.addEventListener(
      "updateend",
      () => {
        this.appending_ = false;
        this.player_.emit(Events.BUFFER_APPENDED, {
          type: item.type,
        });
        this.flush_();
      },
      { once: true },
    );

    sb.appendBuffer(item.data);
  }
}
```

- [ ] **Step 3: Update Player.getBufferedEnd**

In `lib/player.ts`, change the import from:

```ts
import type { SelectionSet } from "./types/manifest";
```

to:

```ts
import type { TrackType } from "./types/manifest";
```

Change the `getBufferedEnd` method from:

```ts
getBufferedEnd(selectionSet: SelectionSet): number {
  return this.bufferController_.getBufferedEnd(selectionSet);
}
```

to:

```ts
getBufferedEnd(type: TrackType): number {
  return this.bufferController_.getBufferedEnd(type);
}
```

- [ ] **Step 4: Update example**

In `example/main.ts`, change the SEGMENT_LOADED listener from:

```ts
player.on(Events.SEGMENT_LOADED, ({ track, segmentIndex }) => {
  console.log(`Segment loaded: ${track.type} #${segmentIndex}`);
});
```

to:

```ts
player.on(Events.SEGMENT_LOADED, ({ track }) => {
  console.log(`Segment loaded: ${track.type}`);
});
```

- [ ] **Step 5: Run type check**

Run: `pnpm tsc`
Expected: Errors in `stream_controller.ts` only (still uses old event names and patterns). This is expected — Task 3 fixes it.

- [ ] **Step 6: Commit**

```bash
git add lib/events.ts lib/controllers/buffer_controller.ts lib/player.ts example/main.ts
git commit -m "refactor: use TrackType as key, rename BUFFER_CODECS to TRACKS_SELECTED"
```

---

### Task 3: Rewrite StreamController

**Files:**
- Rewrite: `lib/controllers/stream_controller.ts`

- [ ] **Step 1: Rewrite StreamController**

Replace the entire contents of `lib/controllers/stream_controller.ts` with:

```ts
import type {
  BufferAppendedEvent,
  ManifestParsedEvent,
  MediaAttachedEvent,
} from "../events";
import { Events } from "../events";
import type { Player } from "../player";
import type {
  Manifest,
  Segment,
  SelectionSet,
  Track,
} from "../types/manifest";
import type { TrackType } from "../types/manifest";
import { Timer } from "../utils/timer";

type MediaState = {
  selectionSet: SelectionSet;
  track: Track;
  lastSegment: Segment | null;
  lastInitSegment: Segment | null;
  timer: Timer;
};

export class StreamController {
  private manifest_: Manifest | null = null;
  private mediaAttached_ = false;
  private mediaStates_ = new Map<TrackType, MediaState>();

  constructor(private player_: Player) {
    this.player_.on(Events.MANIFEST_PARSED, this.onManifestParsed_);
    this.player_.on(Events.MEDIA_ATTACHED, this.onMediaAttached_);
    this.player_.on(Events.BUFFER_CREATED, this.onBufferCreated_);
    this.player_.on(Events.BUFFER_APPENDED, this.onBufferAppended_);
  }

  destroy() {
    for (const mediaState of this.mediaStates_.values()) {
      mediaState.timer.destroy();
    }
    this.player_.off(Events.MANIFEST_PARSED, this.onManifestParsed_);
    this.player_.off(Events.MEDIA_ATTACHED, this.onMediaAttached_);
    this.player_.off(Events.BUFFER_CREATED, this.onBufferCreated_);
    this.player_.off(Events.BUFFER_APPENDED, this.onBufferAppended_);
    this.manifest_ = null;
    this.mediaStates_.clear();
  }

  private onManifestParsed_ = (event: ManifestParsedEvent) => {
    this.manifest_ = event.manifest;
    this.tryStart_();
  };

  private onMediaAttached_ = (_event: MediaAttachedEvent) => {
    this.mediaAttached_ = true;
    this.tryStart_();
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
    this.scheduleUpdate_(mediaState, 0);
  };

  private tryStart_() {
    if (!this.manifest_ || !this.mediaAttached_) {
      return;
    }

    const presentation = this.manifest_.presentations[0];
    if (!presentation) {
      return;
    }

    // Pick one SelectionSet per type — multiple of the same
    // type are alternatives (eg. languages), only one active.
    const seen = new Set<string>();

    for (const selectionSet of presentation.selectionSets) {
      if (seen.has(selectionSet.type)) {
        continue;
      }
      seen.add(selectionSet.type);

      const track = selectionSet.switchingSets[0]?.tracks[0];
      if (!track) {
        throw new Error("No track available");
      }

      const mediaState: MediaState = {
        selectionSet,
        track,
        lastSegment: null,
        lastInitSegment: null,
        timer: new Timer(() => this.onUpdate_(mediaState)),
      };

      this.mediaStates_.set(track.type, mediaState);
    }

    this.player_.emit(Events.TRACKS_SELECTED, {
      tracks: [...this.mediaStates_.values()].map((ms) => ms.track),
    });
  }

  private onUpdate_(mediaState: MediaState) {
    const delay = this.update_(mediaState);
    if (delay !== null) {
      this.scheduleUpdate_(mediaState, delay);
    }
  }

  /**
   * Core streaming logic for a single stream.
   * Returns seconds until next update, or null
   * if no reschedule is needed.
   */
  private update_(mediaState: MediaState): number | null {
    const media = this.player_.getMedia();
    const currentTime = media?.currentTime ?? 0;
    const bufferGoal = this.player_.getConfig().bufferGoal;

    const bufferedEnd = this.player_.getBufferedEnd(
      mediaState.track.type,
    );

    if (bufferedEnd - currentTime >= bufferGoal) {
      return 1;
    }

    const segment = this.getNextSegment_(mediaState);
    if (!segment) {
      this.checkEndOfStream_();
      return null;
    }

    this.loadSegment_(mediaState, segment);
    return null;
  }

  /** Schedule the next update for a media state. */
  private scheduleUpdate_(
    mediaState: MediaState,
    delay: number,
  ) {
    mediaState.timer.tickAfter(delay);
  }

  /**
   * Find the next segment to load based on what's
   * already buffered for this stream.
   */
  private getNextSegment_(
    mediaState: MediaState,
  ): Segment | null {
    const bufferedEnd = this.player_.getBufferedEnd(
      mediaState.track.type,
    );

    for (const segment of mediaState.track.segments) {
      if (segment.start >= bufferedEnd) {
        return segment;
      }
    }
    return null;
  }

  private checkEndOfStream_() {
    const allDone = [...this.mediaStates_.values()].every(
      (ms) => this.getNextSegment_(ms) === null,
    );
    if (allDone) {
      this.player_.emit(Events.BUFFER_EOS);
    }
  }

  private async loadInitSegment_(mediaState: MediaState) {
    const response = await fetch(
      mediaState.track.initSegmentUrl,
    );
    const data = await response.arrayBuffer();

    mediaState.lastInitSegment = {
      url: mediaState.track.initSegmentUrl,
      start: 0,
      end: 0,
    };

    this.player_.emit(Events.SEGMENT_LOADED, {
      track: mediaState.track,
      data,
    });
  }

  private async loadSegment_(
    mediaState: MediaState,
    segment: Segment,
  ) {
    const response = await fetch(segment.url);
    const data = await response.arrayBuffer();

    mediaState.lastSegment = segment;

    this.player_.emit(Events.SEGMENT_LOADED, {
      track: mediaState.track,
      data,
    });
  }
}
```

- [ ] **Step 2: Run type check**

Run: `pnpm tsc`
Expected: No errors.

- [ ] **Step 3: Run format**

Run: `pnpm format`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add lib/controllers/stream_controller.ts
git commit -m "refactor: rewrite StreamController with MediaState, per-stream timers, and time-based segment selection"
```

---

### Task 4: Delete TaskLoop

**Files:**
- Delete: `lib/utils/task_loop.ts`

- [ ] **Step 1: Delete task_loop.ts**

```bash
rm lib/utils/task_loop.ts
```

- [ ] **Step 2: Run type check**

Run: `pnpm tsc`
Expected: No errors (nothing imports TaskLoop anymore).

- [ ] **Step 3: Commit**

```bash
git add lib/utils/task_loop.ts
git commit -m "refactor: remove TaskLoop, replaced by Timer"
```

---

### Task 5: Verify end-to-end

- [ ] **Step 1: Run full type check**

Run: `pnpm tsc`
Expected: No errors.

- [ ] **Step 2: Run format and lint**

Run: `pnpm format`
Expected: No errors.

- [ ] **Step 3: Start dev server and test playback**

Run: `pnpm dev`
Expected: Dev server starts. Open in browser, video plays with segments loading independently per stream type.

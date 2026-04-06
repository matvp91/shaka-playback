# EventManager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a centralized EventManager class that tracks event listeners on both Player (EventEmitter) and DOM EventTarget, with bulk cleanup via `release()`.

**Architecture:** Two overloaded `listen()` signatures (Player vs EventTarget) route through a shared `subscribe_()` helper that detects target type and stores a `Binding` with a `remove` closure. The `once` option wraps callbacks to self-remove after first invocation. Controllers replace manual `on`/`off` boilerplate with EventManager.

**Tech Stack:** TypeScript, eventemitter3 (`@matvp91/eventemitter3`)

---

### Task 1: Create EventManager class

**Files:**
- Create: `lib/utils/event_manager.ts`

- [ ] **Step 1: Create the EventManager file with types and class skeleton**

```ts
import { EventEmitter } from "@matvp91/eventemitter3";
import type { EventMap } from "../events";
import type { Player } from "../player";

type Binding = {
  remove: () => void;
};

type ListenOptions = {
  once?: boolean;
};

export class EventManager {
  private bindings_: Binding[] = [];

  listen<K extends keyof EventMap>(
    target: Player,
    event: K,
    callback: EventMap[K],
    options?: ListenOptions,
  ): void;
  listen(
    target: EventTarget,
    event: string,
    callback: EventListenerOrEventListenerObject,
    options?: ListenOptions,
  ): void;
  listen(
    target: Player | EventTarget,
    event: string,
    callback: ((...args: any[]) => void) | EventListenerOrEventListenerObject,
    options?: ListenOptions,
  ) {
    if (options?.once) {
      let binding: Binding;
      const wrapper = (...args: any[]) => {
        binding.remove();
        this.remove_(binding);
        (callback as (...args: any[]) => void)(...args);
      };
      binding = this.subscribe_(target, event, wrapper);
      this.bindings_.push(binding);
      return;
    }
    const binding = this.subscribe_(target, event, callback);
    this.bindings_.push(binding);
  }

  /**
   * Remove all tracked listeners from all targets.
   */
  release() {
    for (const binding of this.bindings_) {
      binding.remove();
    }
    this.bindings_ = [];
  }

  private subscribe_(
    target: Player | EventTarget,
    event: string,
    callback: ((...args: any[]) => void) | EventListenerOrEventListenerObject,
  ): Binding {
    if (target instanceof EventTarget) {
      target.addEventListener(
        event,
        callback as EventListenerOrEventListenerObject,
      );
      return {
        remove: () =>
          target.removeEventListener(
            event,
            callback as EventListenerOrEventListenerObject,
          ),
      };
    }
    if (target instanceof EventEmitter) {
      (target as Player).on(
        event as keyof EventMap,
        callback as (...args: any[]) => void,
      );
      return {
        remove: () =>
          (target as Player).off(
            event as keyof EventMap,
            callback as (...args: any[]) => void,
          ),
      };
    }
    throw new Error("Unsupported target");
  }

  private remove_(binding: Binding) {
    const index = this.bindings_.indexOf(binding);
    if (index !== -1) {
      this.bindings_.splice(index, 1);
    }
  }
}
```

- [ ] **Step 2: Run type check**

Run: `pnpm tsc`
Expected: No errors.

- [ ] **Step 3: Run format**

Run: `pnpm format`
Expected: Clean output.

- [ ] **Step 4: Commit**

```bash
git add lib/utils/event_manager.ts
git commit -m "feat: add EventManager class"
```

---

### Task 2: Refactor ManifestController

**Files:**
- Modify: `lib/controllers/manifest_controller.ts`

- [ ] **Step 1: Replace manual on/off with EventManager**

Replace the full file content with:

```ts
import { fetchManifest } from "../dash/dash_parser";
import type { ManifestLoadingEvent } from "../events";
import { Events } from "../events";
import type { Player } from "../player";
import { EventManager } from "../utils/event_manager";

export class ManifestController {
  private eventManager_ = new EventManager();

  constructor(private player_: Player) {
    this.eventManager_.listen(
      player_,
      Events.MANIFEST_LOADING,
      this.onManifestLoading_,
    );
  }

  destroy() {
    this.eventManager_.release();
  }

  private onManifestLoading_ = async (event: ManifestLoadingEvent) => {
    const manifest = await fetchManifest(event.url);
    this.player_.emit(Events.MANIFEST_PARSED, { manifest });
  };
}
```

- [ ] **Step 2: Run type check**

Run: `pnpm tsc`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add lib/controllers/manifest_controller.ts
git commit -m "refactor: use EventManager in ManifestController"
```

---

### Task 3: Refactor MediaController

**Files:**
- Modify: `lib/controllers/media_controller.ts`

- [ ] **Step 1: Replace manual on/off and DOM addEventListener with EventManager**

Replace the full file content with:

```ts
import type { MediaAttachingEvent } from "../events";
import { Events } from "../events";
import type { Player } from "../player";
import { EventManager } from "../utils/event_manager";

export class MediaController {
  private eventManager_ = new EventManager();
  private mediaSource_: MediaSource | null = null;

  constructor(private player_: Player) {
    this.eventManager_.listen(
      player_,
      Events.MEDIA_ATTACHING,
      this.onMediaAttaching_,
    );
    this.eventManager_.listen(
      player_,
      Events.BUFFER_EOS,
      this.onBufferEos_,
    );
  }

  destroy() {
    this.eventManager_.release();
    this.mediaSource_ = null;
  }

  private onMediaAttaching_ = (event: MediaAttachingEvent) => {
    const mediaSource = new MediaSource();
    this.mediaSource_ = mediaSource;

    this.eventManager_.listen(
      mediaSource,
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

  private onBufferEos_ = () => {
    if (this.mediaSource_ && this.mediaSource_.readyState === "open") {
      this.mediaSource_.endOfStream();
    }
  };
}
```

- [ ] **Step 2: Run type check**

Run: `pnpm tsc`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add lib/controllers/media_controller.ts
git commit -m "refactor: use EventManager in MediaController"
```

---

### Task 4: Refactor BufferController

**Files:**
- Modify: `lib/controllers/buffer_controller.ts`

- [ ] **Step 1: Replace manual on/off and DOM addEventListener with EventManager**

Replace the full file content with:

```ts
import type {
  MediaAttachedEvent,
  SegmentLoadedEvent,
  TracksSelectedEvent,
} from "../events";
import { Events } from "../events";
import type { Player } from "../player";
import type { TrackType } from "../types/manifest";
import { EventManager } from "../utils/event_manager";

type QueueItem = {
  type: TrackType;
  data: ArrayBuffer;
};

export class BufferController {
  private eventManager_ = new EventManager();
  private sourceBuffers_ = new Map<TrackType, SourceBuffer>();
  private queue_: QueueItem[] = [];
  private appending_ = false;
  private mediaSource_: MediaSource | null = null;

  constructor(private player_: Player) {
    this.eventManager_.listen(
      player_,
      Events.MEDIA_ATTACHED,
      this.onMediaAttached_,
    );
    this.eventManager_.listen(
      player_,
      Events.TRACKS_SELECTED,
      this.onTracksSelected_,
    );
    this.eventManager_.listen(
      player_,
      Events.SEGMENT_LOADED,
      this.onSegmentLoaded_,
    );
  }

  destroy() {
    this.eventManager_.release();
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
    this.mediaSource_.duration = event.duration;
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

    this.eventManager_.listen(
      sb,
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

- [ ] **Step 2: Run type check**

Run: `pnpm tsc`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add lib/controllers/buffer_controller.ts
git commit -m "refactor: use EventManager in BufferController"
```

---

### Task 5: Refactor StreamController

**Files:**
- Modify: `lib/controllers/stream_controller.ts`

- [ ] **Step 1: Replace manual on/off with EventManager**

Replace the full file content with:

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
  TrackType,
} from "../types/manifest";
import { EventManager } from "../utils/event_manager";
import { Timer } from "../utils/timer";

type MediaState = {
  selectionSet: SelectionSet;
  track: Track;
  lastSegment: Segment | null;
  lastInitSegment: Segment | null;
  timer: Timer;
};

export class StreamController {
  private eventManager_ = new EventManager();
  private manifest_: Manifest | null = null;
  private mediaAttached_ = false;
  private mediaStates_ = new Map<TrackType, MediaState>();

  constructor(private player_: Player) {
    this.eventManager_.listen(
      player_,
      Events.MANIFEST_PARSED,
      this.onManifestParsed_,
    );
    this.eventManager_.listen(
      player_,
      Events.MEDIA_ATTACHED,
      this.onMediaAttached_,
    );
    this.eventManager_.listen(
      player_,
      Events.BUFFER_CREATED,
      this.onBufferCreated_,
    );
    this.eventManager_.listen(
      player_,
      Events.BUFFER_APPENDED,
      this.onBufferAppended_,
    );
  }

  destroy() {
    for (const mediaState of this.mediaStates_.values()) {
      mediaState.timer.destroy();
    }
    this.eventManager_.release();
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
      duration: presentation.end - presentation.start,
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

    const bufferedEnd = this.player_.getBufferedEnd(mediaState.track.type);

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
  private scheduleUpdate_(mediaState: MediaState, delay: number) {
    mediaState.timer.tickAfter(delay);
  }

  /**
   * Find the next segment to load. Uses lastSegment
   * to avoid float precision issues with buffer times.
   */
  private getNextSegment_(mediaState: MediaState): Segment | null {
    const { segments } = mediaState.track;

    if (!mediaState.lastSegment) {
      return segments[0] ?? null;
    }

    const lastIndex = segments.indexOf(mediaState.lastSegment);
    return segments[lastIndex + 1] ?? null;
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
    const response = await fetch(mediaState.track.initSegmentUrl);
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

  private async loadSegment_(mediaState: MediaState, segment: Segment) {
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

- [ ] **Step 3: Commit**

```bash
git add lib/controllers/stream_controller.ts
git commit -m "refactor: use EventManager in StreamController"
```

---

### Task 6: Final verification

- [ ] **Step 1: Run full type check**

Run: `pnpm tsc`
Expected: No errors.

- [ ] **Step 2: Run format**

Run: `pnpm format`
Expected: Clean output.

- [ ] **Step 3: Test in dev server**

Run: `pnpm dev`
Manually verify playback works — the video should load and play as before.

- [ ] **Step 4: Commit any format fixes**

```bash
git add -A
git commit -m "chore: format"
```

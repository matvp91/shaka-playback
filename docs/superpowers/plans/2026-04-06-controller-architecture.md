# Controller Architecture & VOD Playback — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the event-driven controller architecture that takes a parsed DASH manifest and plays it back through MSE on a `<video>` element.

**Architecture:** Player becomes the controller registry and event bus. Four controllers (ManifestController, MediaController, BufferController, StreamController) each have a single responsibility and communicate exclusively through events. StreamController orchestrates the loading loop, checking bufferGoal before fetching the next segment.

**Tech Stack:** TypeScript, MSE (MediaSource/SourceBuffer), EventEmitter, Vite

**Code conventions:**
- Omit `public` on class members, keep `private`
- Private members use trailing underscore (`media_`, `onMediaAttaching_`)
- Arrow functions for event listener callbacks only, regular methods otherwise
- Use named event types from `events.ts` (eg. `MediaAttachingEvent`), never inline duplicates
- Initialize all members in the constructor, no inline property assignments
- Prefer composition over inheritance

---

## File Structure

### New files

- `lib/utils/task_loop.ts` — Coalescing tick scheduler, defers work via `setTimeout(0)`
- `lib/controllers/manifest_controller.ts` — Listens for `MANIFEST_LOADING`, delegates to DASH parser, emits `MANIFEST_PARSED`
- `lib/controllers/media_controller.ts` — Manages MediaSource lifecycle, re-emits native video events
- `lib/controllers/buffer_controller.ts` — Owns `Map<SelectionSet, SourceBuffer>`, manages append queue
- `lib/controllers/stream_controller.ts` — Orchestrates segment loading loop via TaskLoop, owns bufferGoal check

### Modified files

- `lib/events.ts` — Add all new events (`MANIFEST_LOADING`, `MANIFEST_PARSED`, `SEGMENT_LOADED`, `BUFFER_APPENDED`, etc.) and export event types
- `lib/player.ts` — Remove direct `fetchManifest` call, instantiate controllers, emit `MANIFEST_LOADING` from `load()`
- `example/main.ts` — Update to demonstrate full playback flow

---

## Task 1: Expand the Event System

**Files:**
- Modify: `lib/events.ts`

This task defines all the events that controllers will use to communicate. Every subsequent task depends on these definitions.

- [ ] **Step 1: Define new event types and update Events object**

```typescript
// lib/events.ts
import type { Manifest, SelectionSet, Track } from "./types/manifest";

export const Events = {
  MANIFEST_LOADING: "manifestLoading",
  MANIFEST_PARSED: "manifestParsed",
  MEDIA_ATTACHING: "mediaAttaching",
  MEDIA_ATTACHED: "mediaAttached",
  MEDIA_DETACHED: "mediaDetached",
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

export type SegmentLoadedEvent = {
  selectionSet: SelectionSet;
  track: Track;
  data: ArrayBuffer;
  segmentIndex: number;
};

export type BufferAppendedEvent = {
  selectionSet: SelectionSet;
};

export interface EventMap {
  [Events.MANIFEST_LOADING]: (event: ManifestLoadingEvent) => void;
  [Events.MANIFEST_PARSED]: (event: ManifestParsedEvent) => void;
  [Events.MEDIA_ATTACHING]: (event: MediaAttachingEvent) => void;
  [Events.MEDIA_ATTACHED]: (event: MediaAttachedEvent) => void;
  [Events.MEDIA_DETACHED]: undefined;
  [Events.SEGMENT_LOADED]: (event: SegmentLoadedEvent) => void;
  [Events.BUFFER_APPENDED]: (event: BufferAppendedEvent) => void;
  [Events.BUFFER_EOS]: undefined;
}
```

- [ ] **Step 2: Verify types compile**

Run: `pnpm tsc`
Expected: PASS (no type errors)

- [ ] **Step 3: Commit**

```bash
git add lib/events.ts
git commit -m "feat: expand event system for controller architecture"
```

---

## Task 2: TaskLoop Utility

**Files:**
- Create: `lib/utils/task_loop.ts`

A minimal coalescing tick scheduler. Multiple `tick()` calls between executions are coalesced into a single callback via `setTimeout`.

- [ ] **Step 1: Create TaskLoop**

```typescript
// lib/utils/task_loop.ts
export class TaskLoop {
  private timer_: ReturnType<typeof setTimeout> | null = null;
  private callback_: () => void;

  constructor(callback: () => void) {
    this.callback_ = callback;
  }

  tick() {
    if (this.timer_ !== null) {
      return;
    }
    this.timer_ = setTimeout(() => {
      this.timer_ = null;
      this.callback_();
    }, 0);
  }

  destroy() {
    if (this.timer_ !== null) {
      clearTimeout(this.timer_);
      this.timer_ = null;
    }
  }
}
```

- [ ] **Step 2: Verify types compile**

Run: `pnpm tsc`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add lib/utils/task_loop.ts
git commit -m "feat: add TaskLoop utility for coalescing tick scheduling"
```

---

## Task 3: ManifestController

**Files:**
- Create: `lib/controllers/manifest_controller.ts`
- Modify: `lib/player.ts`

Moves manifest fetching out of Player into a controller that listens for `MANIFEST_LOADING`.

- [ ] **Step 1: Create ManifestController**

```typescript
// lib/controllers/manifest_controller.ts
import { fetchManifest } from "../dash/dash_parser";
import type { ManifestLoadingEvent } from "../events";
import { Events } from "../events";
import type { Player } from "../player";

export class ManifestController {
  private player_: Player;

  constructor(player: Player) {
    this.player_ = player;
    this.player_.on(Events.MANIFEST_LOADING, this.onManifestLoading_);
  }

  destroy() {
    this.player_.off(Events.MANIFEST_LOADING, this.onManifestLoading_);
  }

  private onManifestLoading_ = async (event: ManifestLoadingEvent) => {
    const manifest = await fetchManifest(event.url);
    this.player_.emit(Events.MANIFEST_PARSED, { manifest });
  };
}
```

- [ ] **Step 2: Update Player to use ManifestController**

Replace the direct `fetchManifest` call in `player.ts`. Player now instantiates ManifestController in the constructor and emits `MANIFEST_LOADING` from `load()`. Remove the `fetchManifest` import. `load()` is no longer async.

```typescript
// lib/player.ts
import { EventEmitter } from "@matvp91/eventemitter3";
import type { PlayerConfig } from "./config";
import { defaultConfig } from "./config";
import { ManifestController } from "./controllers/manifest_controller";
import type { EventMap } from "./events";
import { Events } from "./events";

export class Player extends EventEmitter<EventMap> {
  private config_: PlayerConfig;
  private media_: HTMLMediaElement | null = null;
  private manifestController_: ManifestController;

  constructor() {
    super();
    this.config_ = defaultConfig;
    this.manifestController_ = new ManifestController(this);
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
}
```

- [ ] **Step 3: Update example to verify**

```typescript
// example/main.ts
import { Events, Player } from "../lib/index.ts";

const player = new Player();

const video = document.getElementById("videoElement") as HTMLVideoElement;
player.attachMedia(video);

player.on(Events.MANIFEST_PARSED, ({ manifest }) => {
  console.log("Manifest parsed:", manifest);
});

player.load(
  "https://d305rncpy6ne2q.cloudfront.net/v1/dash/94063eadf7d8c56e9e2edd84fdf897826a70d0df/SFP-MediaTailor-VOD-HLS-DASH/out/v1/b94f3611978f419985a18335bac9d9cb/ddb73bf548a44551a0059c346226445a/eaa5485198bf497284559efb8172425e/index.mpd?aws.sessionId=21567779-c8a8-4be9-9f18-d628dea03826",
);
```

- [ ] **Step 4: Verify types compile**

Run: `pnpm tsc`
Expected: PASS

- [ ] **Step 5: Verify in browser — manifest still parses**

Run: `pnpm dev`
Expected: Console logs "Manifest parsed" with manifest object.

- [ ] **Step 6: Commit**

```bash
git add lib/controllers/manifest_controller.ts lib/player.ts example/main.ts
git commit -m "feat: add ManifestController, move parsing out of Player"
```

---

## Task 4: MediaController

**Files:**
- Create: `lib/controllers/media_controller.ts`
- Modify: `lib/player.ts`

Creates and owns the MediaSource, binds it to the video element, emits `MEDIA_ATTACHED` once `sourceopen` fires.

- [ ] **Step 1: Create MediaController**

```typescript
// lib/controllers/media_controller.ts
import type { MediaAttachingEvent } from "../events";
import { Events } from "../events";
import type { Player } from "../player";

export class MediaController {
  private player_: Player;
  private mediaSource_: MediaSource | null = null;

  constructor(player: Player) {
    this.player_ = player;
    this.player_.on(Events.MEDIA_ATTACHING, this.onMediaAttaching_);
    this.player_.on(Events.BUFFER_EOS, this.onBufferEos_);
  }

  destroy() {
    this.player_.off(Events.MEDIA_ATTACHING, this.onMediaAttaching_);
    this.player_.off(Events.BUFFER_EOS, this.onBufferEos_);
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

  private onBufferEos_ = () => {
    if (
      this.mediaSource_ &&
      this.mediaSource_.readyState === "open"
    ) {
      this.mediaSource_.endOfStream();
    }
  };
}
```

- [ ] **Step 2: Register MediaController in Player**

Add to `lib/player.ts`:

```typescript
import { MediaController } from "./controllers/media_controller";

// In class body:
private mediaController_ = new MediaController(this);
```

- [ ] **Step 3: Verify types compile**

Run: `pnpm tsc`
Expected: PASS

- [ ] **Step 4: Verify in browser — MediaSource opens**

Run: `pnpm dev`
Add temporary log: `player.on(Events.MEDIA_ATTACHED, () => console.log("MediaSource open"));`
Expected: Console logs "MediaSource open"

- [ ] **Step 5: Commit**

```bash
git add lib/controllers/media_controller.ts lib/player.ts
git commit -m "feat: add MediaController with MediaSource lifecycle"
```

---

## Task 5: BufferController

**Files:**
- Create: `lib/controllers/buffer_controller.ts`
- Modify: `lib/player.ts`

Owns the `Map<SelectionSet, SourceBuffer>`. Creates SourceBuffers when segments arrive, manages the append queue gated by `updateend`.

- [ ] **Step 1: Create BufferController**

```typescript
// lib/controllers/buffer_controller.ts
import type { MediaAttachedEvent, SegmentLoadedEvent } from "../events";
import { Events } from "../events";
import type { Player } from "../player";
import type { SelectionSet } from "../types/manifest";

type QueueItem = {
  selectionSet: SelectionSet;
  data: ArrayBuffer;
};

export class BufferController {
  private player_: Player;
  private sourceBuffers_ = new Map<SelectionSet, SourceBuffer>();
  private queue_: QueueItem[] = [];
  private appending_ = false;
  private mediaSource_: MediaSource | null = null;

  constructor(player: Player) {
    this.player_ = player;
    this.player_.on(Events.MEDIA_ATTACHED, this.onMediaAttached_);
    this.player_.on(Events.SEGMENT_LOADED, this.onSegmentLoaded_);
  }

  destroy() {
    this.player_.off(Events.MEDIA_ATTACHED, this.onMediaAttached_);
    this.player_.off(Events.SEGMENT_LOADED, this.onSegmentLoaded_);
    this.sourceBuffers_.clear();
    this.queue_ = [];
    this.mediaSource_ = null;
  }

  getBufferedEnd(selectionSet: SelectionSet): number {
    const sb = this.sourceBuffers_.get(selectionSet);
    if (!sb || sb.buffered.length === 0) {
      return 0;
    }
    return sb.buffered.end(sb.buffered.length - 1);
  }

  private onMediaAttached_ = (event: MediaAttachedEvent) => {
    this.mediaSource_ = event.mediaSource;
  };

  private onSegmentLoaded_ = (event: SegmentLoadedEvent) => {
    this.ensureSourceBuffer_(event.selectionSet, event.track);
    this.queue_.push({
      selectionSet: event.selectionSet,
      data: event.data,
    });
    this.flush_();
  };

  private ensureSourceBuffer_(
    selectionSet: SelectionSet,
    track: SegmentLoadedEvent["track"],
  ) {
    if (this.sourceBuffers_.has(selectionSet)) {
      return;
    }
    if (!this.mediaSource_) {
      return;
    }
    const mime = `${track.mimeType};codecs="${track.codec}"`;
    const sb = this.mediaSource_.addSourceBuffer(mime);
    this.sourceBuffers_.set(selectionSet, sb);
  }

  private flush_() {
    if (this.appending_ || this.queue_.length === 0) {
      return;
    }
    const item = this.queue_.shift();
    if (!item) {
      return;
    }
    const sb = this.sourceBuffers_.get(item.selectionSet);
    if (!sb) {
      return;
    }

    this.appending_ = true;

    sb.addEventListener(
      "updateend",
      () => {
        this.appending_ = false;
        this.player_.emit(Events.BUFFER_APPENDED, {
          selectionSet: item.selectionSet,
        });
        this.flush_();
      },
      { once: true },
    );

    sb.appendBuffer(item.data);
  }
}
```

- [ ] **Step 2: Register BufferController in Player and expose buffer query**

Add to `lib/player.ts`:

```typescript
import { BufferController } from "./controllers/buffer_controller";
import type { SelectionSet } from "./types/manifest";

// In class body:
private bufferController_ = new BufferController(this);

// Public method:
getBufferedEnd(selectionSet: SelectionSet): number {
  return this.bufferController_.getBufferedEnd(selectionSet);
}
```

- [ ] **Step 3: Verify types compile**

Run: `pnpm tsc`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add lib/controllers/buffer_controller.ts lib/player.ts
git commit -m "feat: add BufferController with SourceBuffer management"
```

---

## Task 6: StreamController

**Files:**
- Create: `lib/controllers/stream_controller.ts`
- Modify: `lib/player.ts`

The brain of the playback loop. Waits for both `MANIFEST_PARSED` and `MEDIA_ATTACHED`, selects initial tracks (first track per SelectionSet), fetches init segments + media segments, and continues loading until bufferGoal is met.

- [ ] **Step 1: Create StreamController**

```typescript
// lib/controllers/stream_controller.ts
import type {
  BufferAppendedEvent,
  ManifestParsedEvent,
  MediaAttachedEvent,
} from "../events";
import { Events } from "../events";
import type { Player } from "../player";
import type {
  Manifest,
  SelectionSet,
  Track,
} from "../types/manifest";
import { TaskLoop } from "../utils/task_loop";

type StreamState = {
  selectionSet: SelectionSet;
  track: Track;
  segmentIndex: number;
  initLoaded: boolean;
};

export class StreamController {
  private player_: Player;
  private taskLoop_: TaskLoop;
  private manifest_: Manifest | null = null;
  private mediaAttached_ = false;
  private streams_: StreamState[] = [];
  private loading_ = false;

  constructor(player: Player) {
    this.player_ = player;
    this.taskLoop_ = new TaskLoop(this.onTick_.bind(this));

    this.player_.on(Events.MANIFEST_PARSED, this.onManifestParsed_);
    this.player_.on(Events.MEDIA_ATTACHED, this.onMediaAttached_);
    this.player_.on(Events.BUFFER_APPENDED, this.onBufferAppended_);
  }

  destroy() {
    this.taskLoop_.destroy();
    this.player_.off(Events.MANIFEST_PARSED, this.onManifestParsed_);
    this.player_.off(Events.MEDIA_ATTACHED, this.onMediaAttached_);
    this.player_.off(Events.BUFFER_APPENDED, this.onBufferAppended_);
    this.manifest_ = null;
    this.streams_ = [];
  }

  private onManifestParsed_ = (event: ManifestParsedEvent) => {
    this.manifest_ = event.manifest;
    this.tryStart_();
  };

  private onMediaAttached_ = (_event: MediaAttachedEvent) => {
    this.mediaAttached_ = true;
    this.tryStart_();
  };

  private onBufferAppended_ = (_event: BufferAppendedEvent) => {
    this.loading_ = false;
    this.taskLoop_.tick();
  };

  private tryStart_() {
    if (!this.manifest_ || !this.mediaAttached_) {
      return;
    }

    const presentation = this.manifest_.presentations[0];
    if (!presentation) {
      return;
    }

    this.streams_ = presentation.selectionSets.map(
      (selectionSet) => {
        const track = selectionSet.switchingSets[0]?.tracks[0];
        if (!track) {
          throw new Error("No track available");
        }
        return {
          selectionSet,
          track,
          segmentIndex: 0,
          initLoaded: false,
        };
      },
    );

    this.taskLoop_.tick();
  }

  private onTick_() {
    if (this.loading_) {
      return;
    }

    // Load init segments first.
    for (const stream of this.streams_) {
      if (!stream.initLoaded) {
        this.loadInitSegment_(stream);
        return;
      }
    }

    const media = this.player_.getMedia();
    const currentTime = media?.currentTime ?? 0;
    const bufferGoal = this.player_.getConfig().bufferGoal;

    // Load next segment for the stream that needs it.
    for (const stream of this.streams_) {
      const segment = stream.track.segments[stream.segmentIndex];
      if (!segment) {
        continue;
      }

      const bufferedEnd = this.player_.getBufferedEnd(
        stream.selectionSet,
      );
      if (bufferedEnd - currentTime >= bufferGoal) {
        continue;
      }

      this.loadSegment_(stream);
      return;
    }

    // Signal end of stream when all segments are loaded.
    const allDone = this.streams_.every(
      (s) => s.segmentIndex >= s.track.segments.length,
    );
    if (allDone) {
      this.player_.emit(Events.BUFFER_EOS);
    }
  }

  private async loadInitSegment_(stream: StreamState) {
    this.loading_ = true;
    const response = await fetch(stream.track.initSegmentUrl);
    const data = await response.arrayBuffer();

    stream.initLoaded = true;

    this.player_.emit(Events.SEGMENT_LOADED, {
      selectionSet: stream.selectionSet,
      track: stream.track,
      data,
      segmentIndex: -1,
    });
  }

  private async loadSegment_(stream: StreamState) {
    this.loading_ = true;
    const segment = stream.track.segments[stream.segmentIndex];
    if (!segment) {
      return;
    }

    const response = await fetch(segment.url);
    const data = await response.arrayBuffer();

    const segmentIndex = stream.segmentIndex;
    stream.segmentIndex++;

    this.player_.emit(Events.SEGMENT_LOADED, {
      selectionSet: stream.selectionSet,
      track: stream.track,
      data,
      segmentIndex,
    });
  }
}
```

- [ ] **Step 2: Register StreamController in Player**

Add to `lib/player.ts`:

```typescript
import { StreamController } from "./controllers/stream_controller";

// In class body:
private streamController_ = new StreamController(this);
```

- [ ] **Step 3: Verify types compile**

Run: `pnpm tsc`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add lib/controllers/stream_controller.ts lib/player.ts
git commit -m "feat: add StreamController with segment loading loop"
```

---

## Task 7: Final Player & End-to-End Verification

**Files:**
- Modify: `lib/player.ts`
- Modify: `example/main.ts`

Add `destroy()` to Player and wire up the example for full VOD playback.

- [ ] **Step 1: Add destroy() to Player**

Full final `lib/player.ts`:

```typescript
// lib/player.ts
import { EventEmitter } from "@matvp91/eventemitter3";
import type { PlayerConfig } from "./config";
import { defaultConfig } from "./config";
import { BufferController } from "./controllers/buffer_controller";
import { ManifestController } from "./controllers/manifest_controller";
import { MediaController } from "./controllers/media_controller";
import { StreamController } from "./controllers/stream_controller";
import type { EventMap } from "./events";
import { Events } from "./events";
import type { SelectionSet } from "./types/manifest";

export class Player extends EventEmitter<EventMap> {
  private config_: PlayerConfig;
  private media_: HTMLMediaElement | null = null;
  private manifestController_: ManifestController;
  private mediaController_: MediaController;
  private bufferController_: BufferController;
  private streamController_: StreamController;

  constructor() {
    super();
    this.config_ = defaultConfig;
    this.manifestController_ = new ManifestController(this);
    this.mediaController_ = new MediaController(this);
    this.bufferController_ = new BufferController(this);
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

  getBufferedEnd(selectionSet: SelectionSet): number {
    return this.bufferController_.getBufferedEnd(selectionSet);
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
    this.mediaController_.destroy();
    this.bufferController_.destroy();
    this.streamController_.destroy();
    this.removeAllListeners();
  }
}
```

- [ ] **Step 2: Update example for full playback**

```typescript
// example/main.ts
import { Events, Player } from "../lib/index.ts";

const player = new Player();

const video = document.getElementById("videoElement") as HTMLVideoElement;

player.on(Events.MANIFEST_PARSED, ({ manifest }) => {
  console.log("Manifest parsed:", manifest);
});

player.on(Events.MEDIA_ATTACHED, () => {
  console.log("Media attached, MediaSource open");
});

player.on(Events.SEGMENT_LOADED, ({ track, segmentIndex }) => {
  console.log(`Segment loaded: ${track.type} #${segmentIndex}`);
});

player.attachMedia(video);

player.load(
  "https://d305rncpy6ne2q.cloudfront.net/v1/dash/94063eadf7d8c56e9e2edd84fdf897826a70d0df/SFP-MediaTailor-VOD-HLS-DASH/out/v1/b94f3611978f419985a18335bac9d9cb/ddb73bf548a44551a0059c346226445a/eaa5485198bf497284559efb8172425e/index.mpd?aws.sessionId=21567779-c8a8-4be9-9f18-d628dea03826",
);
```

- [ ] **Step 3: Verify types compile**

Run: `pnpm tsc`
Expected: PASS

- [ ] **Step 4: Test in browser**

Run: `pnpm dev`
Expected:
1. Console logs "Manifest parsed" with manifest object
2. Console logs "Media attached, MediaSource open"
3. Console logs segment loaded messages for video and audio
4. Video plays back with both audio and video

- [ ] **Step 5: Commit**

```bash
git add lib/player.ts example/main.ts
git commit -m "feat: finalize Player with destroy, wire up VOD playback example"
```

# Manifest Model Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Flatten the manifest model from 5 levels to 3, rename types to avoid collisions, introduce `InitSegment` type, and update all consumers.

**Architecture:** Replace `Presentation > SelectionSet > SwitchingSet > Track` with `MediaGroup > Stream`. Hoist `mimeType`/`codec` to `MediaGroup` (CMAF guarantee). Replace `TRACKS_SELECTED` with idempotent `MEDIA_GROUPS_UPDATED`. Update DASH parser to produce flat model directly.

**Tech Stack:** TypeScript, Biome

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Rewrite | `lib/types/manifest.ts` | New manifest model types |
| Create | `lib/utils/manifest_util.ts` | Manifest helper functions |
| Rewrite | `lib/events.ts` | Updated events and payloads |
| Modify | `lib/controllers/buffer_controller.ts` | Use `MediaGroup` + `MediaType` |
| Modify | `lib/controllers/operation_queue.ts` | `TrackType` → `MediaType` |
| Modify | `lib/controllers/stream_controller.ts` | Use new manifest model |
| Modify | `lib/player.ts` | `TrackType` → `MediaType` |
| Modify | `lib/dash/dash_parser.ts` | Produce flat `Manifest` |
| Modify | `lib/dash/dash_presentation.ts` | Return `InitSegment` + segments |
| Modify | `example/main.ts` | Update to new event/type names |

---

### Task 1: Rewrite manifest types

**Files:**
- Rewrite: `lib/types/manifest.ts`

- [ ] **Step 1: Replace all types in `lib/types/manifest.ts`**

```typescript
export enum MediaType {
  VIDEO = "video",
  AUDIO = "audio",
  TEXT = "text",
}

export type Manifest = {
  groups: MediaGroup[];
};

/**
 * Group of streams sharing codec and MIME type,
 * maps 1:1 to a SourceBuffer.
 */
export type MediaGroup = {
  type: MediaType;
  mimeType: string;
  codec: string;
  streams: Stream[];
};

/**
 * Single quality level as a sequence of segments,
 * seamlessly switchable within a MediaGroup.
 */
export type Stream = {
  bandwidth: number;
  initSegment: InitSegment;
  segments: Segment[];
} & (
  | {
      type: MediaType.VIDEO;
      width: number;
      height: number;
    }
  | {
      type: MediaType.AUDIO;
    }
);

/** Initialization segment for a stream. */
export type InitSegment = {
  url: string;
};

/**
 * Addressable media chunk with precise timing.
 */
export type Segment = {
  url: string;
  start: number;
  end: number;
};
```

- [ ] **Step 2: Run type check to see cascading errors**

Run: `pnpm tsc`
Expected: Multiple errors in events.ts, controllers, parser — all files that import old types.

- [ ] **Step 3: Commit**

```bash
git add lib/types/manifest.ts
git commit -m "refactor: rewrite manifest types to flat model"
```

---

### Task 2: Create manifest utilities

**Files:**
- Create: `lib/utils/manifest_util.ts`

- [ ] **Step 1: Create `lib/utils/manifest_util.ts`**

```typescript
import type { MediaGroup } from "../types/manifest";

/**
 * Returns the end time of the last segment
 * across all streams in the group.
 */
export function getGroupDuration(group: MediaGroup): number {
  let maxEnd = 0;
  for (const stream of group.streams) {
    const last = stream.segments[stream.segments.length - 1];
    if (last && last.end > maxEnd) {
      maxEnd = last.end;
    }
  }
  return maxEnd;
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/utils/manifest_util.ts
git commit -m "feat: add manifest utility helpers"
```

---

### Task 3: Update events

**Files:**
- Rewrite: `lib/events.ts`

- [ ] **Step 1: Replace `lib/events.ts`**

```typescript
import type { Manifest, MediaGroup, MediaType, Segment } from "./types/manifest";

export const Events = {
  MANIFEST_LOADING: "manifestLoading",
  MANIFEST_PARSED: "manifestParsed",
  MEDIA_ATTACHING: "mediaAttaching",
  MEDIA_ATTACHED: "mediaAttached",
  MEDIA_DETACHED: "mediaDetached",
  MEDIA_GROUPS_UPDATED: "mediaGroupsUpdated",
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

export type MediaGroupsUpdatedEvent = {
  groups: MediaGroup[];
};

export type SegmentLoadedEvent = {
  type: MediaType;
  segment: Segment;
  data: ArrayBuffer;
};

export type BufferAppendedEvent = {
  type: MediaType;
};

export interface EventMap {
  [Events.MANIFEST_LOADING]: (event: ManifestLoadingEvent) => void;
  [Events.MANIFEST_PARSED]: (event: ManifestParsedEvent) => void;
  [Events.MEDIA_ATTACHING]: (event: MediaAttachingEvent) => void;
  [Events.MEDIA_ATTACHED]: (event: MediaAttachedEvent) => void;
  [Events.MEDIA_DETACHED]: undefined;
  [Events.MEDIA_GROUPS_UPDATED]: (event: MediaGroupsUpdatedEvent) => void;
  [Events.BUFFER_CREATED]: undefined;
  [Events.SEGMENT_LOADED]: (event: SegmentLoadedEvent) => void;
  [Events.BUFFER_APPENDED]: (event: BufferAppendedEvent) => void;
  [Events.BUFFER_EOS]: undefined;
}
```

- [ ] **Step 2: Run type check**

Run: `pnpm tsc`
Expected: Errors in controllers and player — they still import old types and reference old events.

- [ ] **Step 3: Commit**

```bash
git add lib/events.ts
git commit -m "refactor: update events to new manifest model"
```

---

### Task 4: Update OperationQueue

**Files:**
- Modify: `lib/controllers/operation_queue.ts`

- [ ] **Step 1: Replace `TrackType` import with `MediaType`**

Change the import on line 1:

```typescript
// Old:
import type { TrackType } from "../types/manifest";

// New:
import type { MediaType } from "../types/manifest";
```

- [ ] **Step 2: Replace all `TrackType` usages with `MediaType`**

Replace every occurrence of `TrackType` in the file with `MediaType`. The affected locations:

- Line 10: `private queues_ = new Map<MediaType, Operation[]>();`
- Line 11: `private sourceBuffers_ = new Map<MediaType, SourceBuffer>();`
- Line 17: `add(type: MediaType, sourceBuffer: SourceBuffer) {`
- Line 26: `enqueue(type: MediaType, operation: Operation) {`
- Line 43: `block(type: MediaType): Promise<void> {`
- Line 72: `shiftAndExecuteNext(type: MediaType) {`
- Line 89: `private executeNext_(type: MediaType) {`

- [ ] **Step 3: Run type check**

Run: `pnpm tsc`
Expected: OperationQueue errors resolved. Remaining errors in buffer_controller, stream_controller, player.

- [ ] **Step 4: Commit**

```bash
git add lib/controllers/operation_queue.ts
git commit -m "refactor: rename TrackType to MediaType in OperationQueue"
```

---

### Task 5: Update BufferController

**Files:**
- Modify: `lib/controllers/buffer_controller.ts`

- [ ] **Step 1: Update imports**

```typescript
// Old:
import type {
  BufferAppendedEvent,
  MediaAttachingEvent,
  SegmentLoadedEvent,
  TracksSelectedEvent,
} from "../events";
import { Events } from "../events";
import type { Player } from "../player";
import type { TrackType } from "../types/manifest";
import { OperationQueue } from "./operation_queue";

// New:
import type {
  BufferAppendedEvent,
  MediaAttachingEvent,
  MediaGroupsUpdatedEvent,
  SegmentLoadedEvent,
} from "../events";
import { Events } from "../events";
import type { Player } from "../player";
import type { MediaType } from "../types/manifest";
import { getGroupDuration } from "../utils/manifest_util";
import { OperationQueue } from "./operation_queue";
```

- [ ] **Step 2: Update class properties and method signatures**

```typescript
// Old:
private sourceBuffers_ = new Map<TrackType, SourceBuffer>();

// New:
private sourceBuffers_ = new Map<MediaType, SourceBuffer>();
```

```typescript
// Old:
getBufferedEnd(type: TrackType): number {

// New:
getBufferedEnd(type: MediaType): number {
```

- [ ] **Step 3: Replace `onTracksSelected_` with `onMediaGroupsUpdated_`**

Replace the event listener registration in constructor and destroy:

```typescript
// Old (constructor):
this.player_.on(Events.TRACKS_SELECTED, this.onTracksSelected_);

// New (constructor):
this.player_.on(Events.MEDIA_GROUPS_UPDATED, this.onMediaGroupsUpdated_);
```

```typescript
// Old (destroy):
this.player_.off(Events.TRACKS_SELECTED, this.onTracksSelected_);

// New (destroy):
this.player_.off(Events.MEDIA_GROUPS_UPDATED, this.onMediaGroupsUpdated_);
```

Replace the handler itself:

```typescript
// Old:
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
    sb.addEventListener("updateend", () => {
      this.opQueue_.shiftAndExecuteNext(track.type);
    });
  }
  this.mediaSource_.duration = event.duration;
  this.player_.emit(Events.BUFFER_CREATED);
};

// New:
private onMediaGroupsUpdated_ = (event: MediaGroupsUpdatedEvent) => {
  if (!this.mediaSource_) {
    return;
  }
  for (const group of event.groups) {
    if (this.sourceBuffers_.has(group.type)) {
      continue;
    }
    const mime = `${group.mimeType};codecs="${group.codec}"`;
    const sb = this.mediaSource_.addSourceBuffer(mime);
    this.sourceBuffers_.set(group.type, sb);
    this.opQueue_.add(group.type, sb);
    sb.addEventListener("updateend", () => {
      this.opQueue_.shiftAndExecuteNext(group.type);
    });
  }
  const duration = Math.max(...event.groups.map(getGroupDuration));
  this.mediaSource_.duration = duration;
  this.player_.emit(Events.BUFFER_CREATED);
};
```

- [ ] **Step 4: Update `onSegmentLoaded_`**

```typescript
// Old:
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

// New:
private onSegmentLoaded_ = (event: SegmentLoadedEvent) => {
  const { type } = event;
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
```

- [ ] **Step 5: Run type check**

Run: `pnpm tsc`
Expected: BufferController errors resolved.

- [ ] **Step 6: Commit**

```bash
git add lib/controllers/buffer_controller.ts
git commit -m "refactor: update BufferController to MediaGroup model"
```

---

### Task 6: Update StreamController

**Files:**
- Modify: `lib/controllers/stream_controller.ts`

- [ ] **Step 1: Update imports and MediaState type**

```typescript
// Old:
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
import { Timer } from "../utils/timer";

type MediaState = {
  selectionSet: SelectionSet;
  track: Track;
  lastSegment: Segment | null;
  lastInitSegment: Segment | null;
  timer: Timer;
};

// New:
import type {
  BufferAppendedEvent,
  ManifestParsedEvent,
  MediaAttachedEvent,
} from "../events";
import { Events } from "../events";
import type { Player } from "../player";
import type {
  Manifest,
  MediaGroup,
  MediaType,
  Segment,
  Stream,
} from "../types/manifest";
import { Timer } from "../utils/timer";

type MediaState = {
  group: MediaGroup;
  stream: Stream;
  lastSegment: Segment | null;
  lastInitSegment: string | null;
  timer: Timer;
};
```

Note: `lastInitSegment` changes from `Segment | null` to `string | null` — it tracks the last loaded init segment URL to detect changes on ABR switch.

- [ ] **Step 2: Update class properties**

```typescript
// Old:
private mediaStates_ = new Map<TrackType, MediaState>();

// New:
private mediaStates_ = new Map<MediaType, MediaState>();
```

- [ ] **Step 3: Rewrite `tryStart_`**

```typescript
// Old:
private tryStart_() {
  if (!this.manifest_ || !this.media_) {
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
    duration: presentation.end - presentation.start,
  });
}

// New:
private tryStart_() {
  if (!this.manifest_ || !this.media_) {
    return;
  }

  // Pick one MediaGroup per type — multiple of the same
  // type are alternatives (eg. languages), only one active.
  const seen = new Set<string>();
  const activeGroups: MediaGroup[] = [];

  for (const group of this.manifest_.groups) {
    if (seen.has(group.type)) {
      continue;
    }
    seen.add(group.type);

    const stream = group.streams[0];
    if (!stream) {
      throw new Error("No stream available");
    }

    const mediaState: MediaState = {
      group,
      stream,
      lastSegment: null,
      lastInitSegment: null,
      timer: new Timer(() => this.onUpdate_(mediaState)),
    };

    this.mediaStates_.set(group.type, mediaState);
    activeGroups.push(group);
  }

  this.player_.emit(Events.MEDIA_GROUPS_UPDATED, {
    groups: activeGroups,
  });
}
```

- [ ] **Step 4: Update `onBufferAppended_` and `update_`**

```typescript
// Old (in onBufferAppended_):
const mediaState = this.mediaStates_.get(event.type);

// No change needed — event.type is already MediaType.
```

```typescript
// Old (in update_):
const bufferedEnd = this.player_.getBufferedEnd(mediaState.track.type);

// New:
const bufferedEnd = this.player_.getBufferedEnd(mediaState.group.type);
```

- [ ] **Step 5: Update `getNextSegment_`**

```typescript
// Old:
private getNextSegment_(mediaState: MediaState): Segment | null {
  const { segments } = mediaState.track;

  if (!mediaState.lastSegment) {
    return segments[0] ?? null;
  }

  const lastIndex = segments.indexOf(mediaState.lastSegment);
  return segments[lastIndex + 1] ?? null;
}

// New:
private getNextSegment_(mediaState: MediaState): Segment | null {
  const { segments } = mediaState.stream;

  if (!mediaState.lastSegment) {
    return segments[0] ?? null;
  }

  const lastIndex = segments.indexOf(mediaState.lastSegment);
  return segments[lastIndex + 1] ?? null;
}
```

- [ ] **Step 6: Rewrite `loadInitSegment_`**

```typescript
// Old:
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

// New:
private async loadInitSegment_(mediaState: MediaState) {
  const { initSegment } = mediaState.stream;
  const response = await fetch(initSegment.url);
  const data = await response.arrayBuffer();

  mediaState.lastInitSegment = initSegment.url;

  this.player_.emit(Events.SEGMENT_LOADED, {
    type: mediaState.group.type,
    segment: { url: initSegment.url, start: 0, end: 0 },
    data,
  });
}
```

- [ ] **Step 7: Update `loadSegment_`**

```typescript
// Old:
private async loadSegment_(mediaState: MediaState, segment: Segment) {
  const response = await fetch(segment.url);
  const data = await response.arrayBuffer();

  mediaState.lastSegment = segment;

  this.player_.emit(Events.SEGMENT_LOADED, {
    track: mediaState.track,
    data,
  });
}

// New:
private async loadSegment_(mediaState: MediaState, segment: Segment) {
  const response = await fetch(segment.url);
  const data = await response.arrayBuffer();

  mediaState.lastSegment = segment;

  this.player_.emit(Events.SEGMENT_LOADED, {
    type: mediaState.group.type,
    segment,
    data,
  });
}
```

- [ ] **Step 8: Run type check**

Run: `pnpm tsc`
Expected: StreamController errors resolved.

- [ ] **Step 9: Commit**

```bash
git add lib/controllers/stream_controller.ts
git commit -m "refactor: update StreamController to new manifest model"
```

---

### Task 7: Update Player

**Files:**
- Modify: `lib/player.ts`

- [ ] **Step 1: Replace `TrackType` with `MediaType`**

```typescript
// Old:
import type { TrackType } from "./types/manifest";

// New:
import type { MediaType } from "./types/manifest";
```

```typescript
// Old:
getBufferedEnd(type: TrackType): number {
  return this.bufferController_.getBufferedEnd(type);
}

// New:
getBufferedEnd(type: MediaType): number {
  return this.bufferController_.getBufferedEnd(type);
}
```

- [ ] **Step 2: Run type check**

Run: `pnpm tsc`
Expected: Player errors resolved.

- [ ] **Step 3: Commit**

```bash
git add lib/player.ts
git commit -m "refactor: rename TrackType to MediaType in Player"
```

---

### Task 8: Update DASH parser

**Files:**
- Modify: `lib/dash/dash_parser.ts`
- Modify: `lib/dash/dash_presentation.ts`

- [ ] **Step 1: Update `dash_presentation.ts` to return `InitSegment` and drop `timeOffset`**

```typescript
// Old imports:
import type { Segment } from "../types/manifest";

// New imports:
import type { InitSegment, Segment } from "../types/manifest";
```

Change the return type of `parseSegmentData`. Replace the return statement:

```typescript
// Old:
return {
  initSegmentUrl,
  segments,
  timeOffset,
};

// New:
return {
  initSegment: { url: initSegmentUrl } satisfies InitSegment,
  segments,
};
```

Remove the `timeOffset` computation (lines 39-40):

```typescript
// Remove these lines:
const presentationTimeOffset = Number(st["@_presentationTimeOffset"] ?? 0);
const timeOffset = presentationTimeOffset / timescale;
```

Also rename the local variable for clarity. The `initSegmentUrl` variable
on lines 42-48 can stay as-is since it's a local — only the return
shape changes.

- [ ] **Step 2: Update `dash_parser.ts` imports**

```typescript
// Old:
import type {
  Manifest,
  Presentation,
  SelectionSet,
  SwitchingSet,
  Track,
} from "../types/manifest";
import { TrackType } from "../types/manifest";

// New:
import type {
  Manifest,
  MediaGroup,
  Stream,
} from "../types/manifest";
import { MediaType } from "../types/manifest";
```

- [ ] **Step 3: Rewrite `parseManifest` to produce flat model**

```typescript
// Old:
async function parseManifest(text: string, options: ParseManifestOptions) {
  const parser = new XMLParser({
    ignoreAttributes: false,
    alwaysCreateTextNode: true,
    isArray: (tagName) => DASH_ARRAY_NODES.includes(tagName),
  });
  const mpd = parser.parse(text).MPD as MPD;

  const manifest: Manifest = {
    presentations: mpd.Period.map((period) =>
      parsePeriod(options, mpd, period),
    ),
  };

  return manifest;
}

// New:
async function parseManifest(text: string, options: ParseManifestOptions) {
  const parser = new XMLParser({
    ignoreAttributes: false,
    alwaysCreateTextNode: true,
    isArray: (tagName) => DASH_ARRAY_NODES.includes(tagName),
  });
  const mpd = parser.parse(text).MPD as MPD;

  const period = mpd.Period[0];
  if (!period) {
    throw new Error("No Period found in manifest");
  }

  const manifest: Manifest = {
    groups: parsePeriod(options, mpd, period),
  };

  return manifest;
}
```

- [ ] **Step 4: Rewrite `parsePeriod` to return `MediaGroup[]`**

```typescript
// Old:
function parsePeriod(
  options: ParseManifestOptions,
  mpd: MPD,
  period: Period,
): Presentation {
  const group = groupAdaptationSets(period.AdaptationSet);
  const adaptationSetSets = Array.from(group.values());

  const index = mpd.Period.indexOf(period);
  const nextPeriod = mpd.Period[index + 1];
  const start = period["@_start"] ? parseDuration(period["@_start"]) : 0;
  const duration =
    nextPeriod?.["@_start"] ?? mpd["@_mediaPresentationDuration"];
  const end = duration ? parseDuration(duration) : start;

  return {
    start,
    end,
    selectionSets: adaptationSetSets.map((adaptationSets) =>
      parseAdaptationSets(options, mpd, period, adaptationSets),
    ),
  };
}

// New:
function parsePeriod(
  options: ParseManifestOptions,
  mpd: MPD,
  period: Period,
): MediaGroup[] {
  const grouped = groupAdaptationSets(period.AdaptationSet);
  const adaptationSetSets = Array.from(grouped.values());

  return adaptationSetSets.map((adaptationSets) =>
    parseAdaptationSets(options, mpd, period, adaptationSets),
  );
}
```

- [ ] **Step 5: Rewrite `parseAdaptationSets` to return `MediaGroup`**

```typescript
// Old:
function parseAdaptationSets(
  options: ParseManifestOptions,
  mpd: MPD,
  period: Period,
  adaptationSets: AdaptationSet[],
): SelectionSet {
  const switchingSets = adaptationSets.map((adaptationSet) =>
    parseAdaptationSet(options, mpd, period, adaptationSet),
  );
  const type = switchingSets[0]?.tracks[0]?.type;
  assertNotVoid(type, "type is mandatory");

  return {
    type,
    switchingSets,
  };
}

// New:
function parseAdaptationSets(
  options: ParseManifestOptions,
  mpd: MPD,
  period: Period,
  adaptationSets: AdaptationSet[],
): MediaGroup {
  const streams = adaptationSets.flatMap((adaptationSet) =>
    parseAdaptationSet(options, mpd, period, adaptationSet),
  );

  const first = streams[0];
  assertNotVoid(first, "No streams found");

  // Resolve mimeType and codec from AdaptationSet or first
  // Representation — same lookup as parseRepresentation uses.
  const as = adaptationSets[0];
  assertNotVoid(as, "No AdaptationSet found");
  const rep = as.Representation[0];
  assertNotVoid(rep, "No Representation found");

  const mimeType = findMap([rep, as], "@_mimeType");
  assertNotVoid(mimeType, "mimeType is mandatory");

  const codec = findMap([rep, as], "@_codecs");
  assertNotVoid(codec, "codecs is mandatory");

  return {
    type: first.type,
    mimeType,
    codec,
    streams,
  };
}
```

- [ ] **Step 6: Rewrite `parseAdaptationSet` to return `Stream[]`**

```typescript
// Old:
function parseAdaptationSet(
  options: ParseManifestOptions,
  mpd: MPD,
  period: Period,
  adaptationSet: AdaptationSet,
): SwitchingSet {
  return {
    tracks: adaptationSet.Representation.map((representation) =>
      parseRepresentation(options, mpd, period, adaptationSet, representation),
    ),
  };
}

// New:
function parseAdaptationSet(
  options: ParseManifestOptions,
  mpd: MPD,
  period: Period,
  adaptationSet: AdaptationSet,
): Stream[] {
  return adaptationSet.Representation.map((representation) =>
    parseRepresentation(options, mpd, period, adaptationSet, representation),
  );
}
```

- [ ] **Step 7: Rewrite `parseRepresentation` to return `Stream`**

```typescript
// Old:
function parseRepresentation(
  options: ParseManifestOptions,
  mpd: MPD,
  period: Period,
  adaptationSet: AdaptationSet,
  representation: Representation,
): Track {
  const baseUrls = filterMap(
    [mpd, period, adaptationSet, representation],
    (node) => node.BaseURL?.["#text"],
  );
  const baseUrl = resolveUrls([options.sourceUrl, ...baseUrls]);

  const mimeType = findMap([representation, adaptationSet], "@_mimeType");
  assertNotVoid(mimeType, "mimeType is mandatory");

  const codec = findMap([representation, adaptationSet], "@_codecs");
  assertNotVoid(codec, "codecs is mandatory");

  const bandwidth = Number(representation["@_bandwidth"]);
  assertNumber(bandwidth, "bandwidth is mandatory");

  const segmentData = parseSegmentData(
    mpd,
    period,
    adaptationSet,
    representation,
    baseUrl,
  );

  if (mimeType.startsWith("video/")) {
    const width = Number(findMap([representation, adaptationSet], "@_width"));
    assertNumber(width, "width is mandatory");

    const height = Number(findMap([representation, adaptationSet], "@_height"));
    assertNumber(height, "height is mandatory");

    return {
      type: TrackType.VIDEO,
      mimeType,
      codec,
      width,
      height,
      bandwidth,
      ...segmentData,
    };
  }

  if (mimeType.startsWith("audio/")) {
    return {
      type: TrackType.AUDIO,
      mimeType,
      codec,
      bandwidth,
      ...segmentData,
    };
  }

  throw new Error("TODO: Map TEXT type");
}

// New:
function parseRepresentation(
  options: ParseManifestOptions,
  mpd: MPD,
  period: Period,
  adaptationSet: AdaptationSet,
  representation: Representation,
): Stream {
  const baseUrls = filterMap(
    [mpd, period, adaptationSet, representation],
    (node) => node.BaseURL?.["#text"],
  );
  const baseUrl = resolveUrls([options.sourceUrl, ...baseUrls]);

  const mimeType = findMap([representation, adaptationSet], "@_mimeType");
  assertNotVoid(mimeType, "mimeType is mandatory");

  const bandwidth = Number(representation["@_bandwidth"]);
  assertNumber(bandwidth, "bandwidth is mandatory");

  const segmentData = parseSegmentData(
    mpd,
    period,
    adaptationSet,
    representation,
    baseUrl,
  );

  if (mimeType.startsWith("video/")) {
    const width = Number(findMap([representation, adaptationSet], "@_width"));
    assertNumber(width, "width is mandatory");

    const height = Number(findMap([representation, adaptationSet], "@_height"));
    assertNumber(height, "height is mandatory");

    return {
      type: MediaType.VIDEO,
      width,
      height,
      bandwidth,
      ...segmentData,
    };
  }

  if (mimeType.startsWith("audio/")) {
    return {
      type: MediaType.AUDIO,
      bandwidth,
      ...segmentData,
    };
  }

  throw new Error("TODO: Map TEXT type");
}
```

Note: `mimeType` and `codec` are no longer on `Stream` — they've been hoisted to `MediaGroup`. The `parseRepresentation` function still reads them to detect video vs audio, but doesn't include them in the return value.

- [ ] **Step 8: Remove unused imports from `dash_parser.ts`**

The `parseDuration` import is no longer needed (period start/end computation removed). The `Presentation`, `SelectionSet`, `SwitchingSet`, `Track` type imports are replaced. Verify no other usages remain.

Remove from imports:
- `parseDuration` from `"../utils/time"`
- Old type imports already replaced in Step 2

- [ ] **Step 9: Run type check**

Run: `pnpm tsc`
Expected: All parser errors resolved.

- [ ] **Step 10: Commit**

```bash
git add lib/dash/dash_parser.ts lib/dash/dash_presentation.ts
git commit -m "refactor: update DASH parser to produce flat manifest model"
```

---

### Task 9: Update example app

**Files:**
- Modify: `example/main.ts`

- [ ] **Step 1: Update example to use new event names**

```typescript
// Old:
player.on(Events.SEGMENT_LOADED, ({ track }) => {
  console.log(`Segment loaded: ${track.type}`);
});

// New:
player.on(Events.SEGMENT_LOADED, ({ type }) => {
  console.log(`Segment loaded: ${type}`);
});
```

- [ ] **Step 2: Run type check and format**

Run: `pnpm tsc && pnpm format`
Expected: No errors. All files formatted.

- [ ] **Step 3: Commit**

```bash
git add example/main.ts
git commit -m "refactor: update example app to new manifest model"
```

---

### Task 10: Final verification

- [ ] **Step 1: Run full type check**

Run: `pnpm tsc`
Expected: Zero errors.

- [ ] **Step 2: Run format**

Run: `pnpm format`
Expected: Clean output.

- [ ] **Step 3: Run dev server and verify playback**

Run: `pnpm dev`
Expected: Dev server starts. Open browser, verify video plays without console errors. Segments load, buffer fills, playback is smooth.

- [ ] **Step 4: Commit any format fixes**

```bash
git add -A
git commit -m "chore: format after manifest model redesign"
```

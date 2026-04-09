# Multi-Period Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat manifest model with a CMAF-aligned 4-level hierarchy (Presentation → SelectionSet → SwitchingSet → Track) and update the event architecture to support multi-period DASH playback.

**Architecture:** The manifest model gains period awareness through a 4-level hierarchy mapping directly to DASH/CMAF concepts. The event architecture shifts to a command/response pattern (BUFFER_CODECS, BUFFER_APPENDING, BUFFER_APPENDED) between StreamController and BufferController. Controllers handle compatible period transitions (same codec across periods).

**Tech Stack:** TypeScript, Vite, pnpm, Biome

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `lib/types/manifest.ts` | Rewrite | New 4-level manifest model types |
| `lib/events.ts` | Rewrite | New event types and EventMap |
| `lib/dash/dash_parser.ts` | Modify | Multi-period parsing, two-level AS grouping |
| `lib/dash/dash_presentation.ts` | Modify | Remove start/end computation, keep timeOffset |
| `lib/controllers/stream_controller.ts` | Rewrite | Period-aware streaming, new event emissions |
| `lib/controllers/buffer_controller.ts` | Rewrite | BUFFER_CODECS/BUFFER_APPENDING handlers, updateDuration_ |
| `lib/player.ts` | Modify | Remove getBufferedEnd proxy, update imports |
| `example/main.ts` | Modify | Update event references |

---

### Task 1: Manifest Model Types

Replace the flat `Manifest → MediaGroup → Stream` model with the 4-level CMAF hierarchy.

**Files:**
- Rewrite: `lib/types/manifest.ts`

- [ ] **Step 1: Rewrite manifest types**

Replace the entire contents of `lib/types/manifest.ts` with:

```typescript
export enum MediaType {
  VIDEO = "video",
  AUDIO = "audio",
  TEXT = "text",
}

export type Manifest = {
  presentations: Presentation[];
};

/**
 * Time-bounded content period,
 * maps to a DASH Period.
 */
export type Presentation = {
  start: number;
  selectionSets: SelectionSet[];
};

/**
 * Groups content by media type,
 * maps 1:1 to an MSE SourceBuffer.
 */
export type SelectionSet = {
  type: MediaType;
  switchingSets: SwitchingSet[];
};

/**
 * CMAF switching set — tracks that can be
 * seamlessly switched between (same codec).
 */
export type SwitchingSet = {
  mimeType: string;
  codec: string;
  timeOffset: number;
  tracks: Track[];
};

/**
 * Single quality level as a sequence of
 * segments, discriminated by media type.
 */
export type Track = {
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

/** Initialization segment for a track. */
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
Expected: Type errors in events.ts, dash_parser.ts, stream_controller.ts, buffer_controller.ts, player.ts, example/main.ts (all referencing old model types). This is expected — we fix these in subsequent tasks.

- [ ] **Step 3: Commit**

```bash
git add lib/types/manifest.ts
git commit -m "refactor: replace manifest model with 4-level CMAF hierarchy"
```

---

### Task 2: Event Architecture

Replace the ad-hoc events with the command/response pattern. Remove `MEDIA_GROUPS_UPDATED` and `SEGMENT_LOADED`, add `BUFFER_CODECS` and `BUFFER_APPENDING`.

**Files:**
- Rewrite: `lib/events.ts`

- [ ] **Step 1: Rewrite events**

Replace the entire contents of `lib/events.ts` with:

```typescript
import type { Manifest, MediaType } from "./types/manifest";

export const Events = {
  MANIFEST_LOADING: "manifestLoading",
  MANIFEST_PARSED: "manifestParsed",
  MEDIA_ATTACHING: "mediaAttaching",
  MEDIA_ATTACHED: "mediaAttached",
  MEDIA_DETACHED: "mediaDetached",
  BUFFER_CODECS: "bufferCodecs",
  BUFFER_CREATED: "bufferCreated",
  BUFFER_APPENDING: "bufferAppending",
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

export type BufferCodecsEvent = {
  tracks: Map<MediaType, { mimeType: string; codec: string }>;
  duration: number;
};

export type BufferAppendingEvent = {
  type: MediaType;
  data: ArrayBuffer;
  timestampOffset: number;
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
  [Events.BUFFER_CODECS]: (event: BufferCodecsEvent) => void;
  [Events.BUFFER_CREATED]: undefined;
  [Events.BUFFER_APPENDING]: (event: BufferAppendingEvent) => void;
  [Events.BUFFER_APPENDED]: (event: BufferAppendedEvent) => void;
  [Events.BUFFER_EOS]: undefined;
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/events.ts
git commit -m "refactor: replace events with command/response buffer pattern"
```

---

### Task 3: DASH Parser — Multi-Period Output

Update the parser to iterate all periods and produce the new 4-level hierarchy.

**Files:**
- Modify: `lib/dash/dash_parser.ts`
- Modify: `lib/dash/dash_presentation.ts`

- [ ] **Step 1: Update dash_presentation.ts return shape**

In `lib/dash/dash_presentation.ts`, update `parseSegmentData` to:
1. Compute `periodStart` locally from `period["@_start"]` (already has access to the Period object).
2. Compute segment times in presentation time: `(time - PTO) / timescale + periodStart`.
3. Remove `start`, `end`, and `timeOffset` from the return value (timeOffset moves to the parser at the AdaptationSet level).

The function signature stays the same — no new parameters needed.

Replace the `presentationTimeOffset` / `timeOffset` lines and the return:

```typescript
// Old:
const presentationTimeOffset = Number(st["@_presentationTimeOffset"] ?? 0);
const timeOffset = presentationTimeOffset / timescale;
// ...
return {
  start: segments[0]?.start ?? 0,
  end: segments[segments.length - 1]?.end ?? 0,
  timeOffset,
  initSegment: { url: initSegmentUrl } satisfies InitSegment,
  segments,
};

// New:
const pto = Number(st["@_presentationTimeOffset"] ?? 0);
const periodStart = period["@_start"]
  ? parseDuration(period["@_start"])
  : 0;
const segments = mapTemplateTimeline(
  timeline, media, st, representation, baseUrl, pto, periodStart,
);
const initSegment: InitSegment = { url: initSegmentUrl };
return { initSegment, segments };
```

Add `parseDuration` import at the top of `dash_presentation.ts`:

```typescript
import { parseDuration } from "../utils/time";
```

Update `mapTemplateTimeline` to accept `pto` and `periodStart`, and compute presentation-time segment boundaries:

```typescript
function mapTemplateTimeline(
  timeline: SegmentTimeline,
  media: string,
  st: SegmentTemplate,
  representation: Representation,
  baseUrl: string,
  pto: number,
  periodStart: number,
): Segment[] {
  const timescale = Number(st["@_timescale"] ?? 1);
  const startNumber = Number(st["@_startNumber"] ?? 1);
  const segments: Segment[] = [];
  let time = 0;
  let number = startNumber;

  for (const s of timeline.S) {
    const d = Number(s["@_d"]);
    const r = Number(s["@_r"] ?? 0);

    if (s["@_t"] != null) {
      time = Number(s["@_t"]);
    }

    for (let i = 0; i <= r; i++) {
      const relativeUrl = applyUrlTemplate(media, {
        RepresentationID: representation["@_id"],
        Bandwidth: representation["@_bandwidth"],
        Number: number,
        Time: time,
      });
      const url = resolveUrl(relativeUrl, baseUrl);
      segments.push({
        url,
        start: (time - pto) / timescale + periodStart,
        end: (time - pto + d) / timescale + periodStart,
      });
      time += d;
      number++;
    }
  }

  return segments;
}
```

- [ ] **Step 2: Rewrite dash_parser.ts**

Replace the entire contents of `lib/dash/dash_parser.ts` with:

```typescript
import { XMLParser } from "fast-xml-parser";
import type {
  Manifest,
  Presentation,
  SelectionSet,
  SwitchingSet,
  Track,
} from "../types/manifest";
import { MediaType } from "../types/manifest";
import { assertNotVoid, assertNumber } from "../utils/assert";
import { filterMap, findMap } from "../utils/functional";
import { parseDuration } from "../utils/time";
import { resolveUrls } from "../utils/url";
import { parseSegmentData } from "./dash_presentation";
import type { AdaptationSet, MPD, Period, Representation } from "./types";

const DASH_ARRAY_NODES = [
  "Period",
  "AdaptationSet",
  "Representation",
  "S",
  "AudioChannelConfiguration",
  "SupplementalProperty",
  "EssentialProperty",
  "ContentProtection",
  "Role",
  "Accessibility",
  "SegmentURL",
  "EventStream",
  "Event",
];

export async function fetchManifest(url: string) {
  const response = await fetch(url);
  const text = await response.text();
  return parseManifest(text, {
    sourceUrl: url,
  });
}

type ParseManifestOptions = {
  sourceUrl: string;
};

async function parseManifest(text: string, options: ParseManifestOptions) {
  const parser = new XMLParser({
    ignoreAttributes: false,
    alwaysCreateTextNode: true,
    isArray: (tagName) => DASH_ARRAY_NODES.includes(tagName),
  });
  const mpd = parser.parse(text).MPD as MPD;

  if (mpd.Period.length === 0) {
    throw new Error("No Period found in manifest");
  }

  const presentations = mpd.Period.map((period) =>
    parsePeriod(options, mpd, period),
  );

  const manifest: Manifest = { presentations };

  return manifest;
}

function parsePeriod(
  options: ParseManifestOptions,
  mpd: MPD,
  period: Period,
): Presentation {
  const start = period["@_start"]
    ? parseDuration(period["@_start"])
    : 0;

  const grouped = groupAdaptationSets(period.AdaptationSet);

  const selectionSets: SelectionSet[] = Array.from(
    grouped.entries(),
  ).map(([_key, adaptationSets]) =>
    parseSelectionSet(options, mpd, period, adaptationSets),
  );

  return { start, selectionSets };
}

function parseSelectionSet(
  options: ParseManifestOptions,
  mpd: MPD,
  period: Period,
  adaptationSets: AdaptationSet[],
): SelectionSet {
  const first = adaptationSets[0];
  assertNotVoid(first, "No AdaptationSet found");
  const type = inferMediaType(first);
  assertNotVoid(type, "Cannot infer media type");

  const switchingSets = adaptationSets.map((as) =>
    parseSwitchingSet(options, mpd, period, as, type),
  );

  return { type, switchingSets };
}

function parseSwitchingSet(
  options: ParseManifestOptions,
  mpd: MPD,
  period: Period,
  adaptationSet: AdaptationSet,
  type: MediaType,
): SwitchingSet {
  const firstRep = adaptationSet.Representation[0];
  assertNotVoid(firstRep, "No Representation found");

  const mimeType = findMap([firstRep, adaptationSet], "@_mimeType");
  assertNotVoid(mimeType, "mimeType is mandatory");

  const codec = findMap([firstRep, adaptationSet], "@_codecs");
  assertNotVoid(codec, "codecs is mandatory");

  const timeOffset = extractTimeOffset(adaptationSet);

  const tracks = adaptationSet.Representation.map((rep) =>
    parseTrack(options, mpd, period, adaptationSet, rep, type),
  );

  return { mimeType, codec, timeOffset, tracks };
}

function parseTrack(
  options: ParseManifestOptions,
  mpd: MPD,
  period: Period,
  adaptationSet: AdaptationSet,
  representation: Representation,
  type: MediaType,
): Track {
  const baseUrls = filterMap(
    [mpd, period, adaptationSet, representation],
    (node) => node.BaseURL?.["#text"],
  );
  const baseUrl = resolveUrls([options.sourceUrl, ...baseUrls]);

  const bandwidth = Number(representation["@_bandwidth"]);
  assertNumber(bandwidth, "bandwidth is mandatory");

  const segmentData = parseSegmentData(
    mpd,
    period,
    adaptationSet,
    representation,
    baseUrl,
  );

  if (type === MediaType.VIDEO) {
    const width = Number(
      findMap([representation, adaptationSet], "@_width"),
    );
    assertNumber(width, "width is mandatory");

    const height = Number(
      findMap([representation, adaptationSet], "@_height"),
    );
    assertNumber(height, "height is mandatory");

    return {
      type: MediaType.VIDEO,
      width,
      height,
      bandwidth,
      ...segmentData,
    };
  }

  if (type === MediaType.AUDIO) {
    return {
      type: MediaType.AUDIO,
      bandwidth,
      ...segmentData,
    };
  }

  throw new Error("TODO: Map TEXT type");
}

/**
 * Extract presentationTimeOffset from the
 * AdaptationSet's SegmentTemplate, normalized
 * to seconds.
 */
function extractTimeOffset(adaptationSet: AdaptationSet): number {
  const st = adaptationSet.SegmentTemplate;
  if (!st) {
    return 0;
  }
  const timescale = Number(st["@_timescale"] ?? 1);
  const pto = Number(st["@_presentationTimeOffset"] ?? 0);
  return pto / timescale;
}

/**
 * Group AdaptationSets by @group or inferred
 * content type. Each group becomes a SelectionSet,
 * each AdaptationSet within becomes a SwitchingSet.
 */
function groupAdaptationSets(adaptationSets: AdaptationSet[]) {
  const groups = new Map<string, AdaptationSet[]>();
  for (const adaptationSet of adaptationSets) {
    const key =
      adaptationSet["@_group"] ?? inferContentType(adaptationSet);
    const list = groups.get(key) ?? [];
    list.push(adaptationSet);
    groups.set(key, list);
  }
  return groups;
}

function inferContentType(adaptationSet: AdaptationSet) {
  if (adaptationSet["@_contentType"]) {
    return adaptationSet["@_contentType"];
  }
  const mimeType =
    adaptationSet["@_mimeType"] ??
    adaptationSet.Representation[0]?.["@_mimeType"];
  if (mimeType) {
    const type = mimeType.split("/")[0] ?? mimeType;
    return type === "application" ? "text" : type;
  }
  return "unknown";
}

function inferMediaType(adaptationSet: AdaptationSet): MediaType | null {
  const contentType = adaptationSet["@_contentType"];
  if (contentType === "video") return MediaType.VIDEO;
  if (contentType === "audio") return MediaType.AUDIO;
  if (contentType === "text") return MediaType.TEXT;
  const mimeType =
    adaptationSet["@_mimeType"] ??
    adaptationSet.Representation[0]?.["@_mimeType"];
  if (mimeType?.startsWith("video/")) return MediaType.VIDEO;
  if (mimeType?.startsWith("audio/")) return MediaType.AUDIO;
  if (
    mimeType?.startsWith("text/") ||
    mimeType?.startsWith("application/")
  ) {
    return MediaType.TEXT;
  }
  return null;
}
```

- [ ] **Step 3: Run type check**

Run: `pnpm tsc`
Expected: Errors only in stream_controller.ts, buffer_controller.ts, player.ts, and example/main.ts. The parser and manifest types should be clean.

- [ ] **Step 4: Commit**

```bash
git add lib/dash/dash_parser.ts lib/dash/dash_presentation.ts
git commit -m "refactor: update DASH parser for multi-period output"
```

---

### Task 4: BufferController — New Event Handlers

Rewrite BufferController to listen for `BUFFER_CODECS` and `BUFFER_APPENDING` instead of `MEDIA_GROUPS_UPDATED` and `SEGMENT_LOADED`. Add `updateDuration_()`.

**Files:**
- Rewrite: `lib/controllers/buffer_controller.ts`

- [ ] **Step 1: Rewrite buffer_controller.ts**

Replace the entire contents of `lib/controllers/buffer_controller.ts` with:

```typescript
import type {
  BufferAppendedEvent,
  BufferAppendingEvent,
  BufferCodecsEvent,
  MediaAttachingEvent,
} from "../events";
import { Events } from "../events";
import type { Player } from "../player";
import type { MediaType } from "../types/manifest";
import { OperationQueue } from "./operation_queue";

export class BufferController {
  private sourceBuffers_ = new Map<MediaType, SourceBuffer>();
  private opQueue_ = new OperationQueue();
  private mediaSource_: MediaSource | null = null;
  private duration_ = 0;

  constructor(private player_: Player) {
    this.player_.on(Events.MEDIA_ATTACHING, this.onMediaAttaching_);
    this.player_.on(Events.BUFFER_CODECS, this.onBufferCodecs_);
    this.player_.on(Events.BUFFER_APPENDING, this.onBufferAppending_);
    this.player_.on(Events.BUFFER_EOS, this.onBufferEos_);
    this.player_.on(Events.BUFFER_APPENDED, this.onBufferAppended_);
  }

  destroy() {
    this.player_.off(Events.MEDIA_ATTACHING, this.onMediaAttaching_);
    this.player_.off(Events.BUFFER_CODECS, this.onBufferCodecs_);
    this.player_.off(Events.BUFFER_APPENDING, this.onBufferAppending_);
    this.player_.off(Events.BUFFER_EOS, this.onBufferEos_);
    this.player_.off(Events.BUFFER_APPENDED, this.onBufferAppended_);
    this.opQueue_.destroy();
    this.sourceBuffers_.clear();
    this.mediaSource_ = null;
  }

  getBufferedEnd(type: MediaType): number {
    const sb = this.sourceBuffers_.get(type);
    if (!sb || sb.buffered.length === 0) {
      return 0;
    }
    return sb.buffered.end(sb.buffered.length - 1);
  }

  private onMediaAttaching_ = (event: MediaAttachingEvent) => {
    this.mediaSource_ = new MediaSource();

    this.mediaSource_.addEventListener(
      "sourceopen",
      () => {
        this.player_.emit(Events.MEDIA_ATTACHED, {
          media: event.media,
          mediaSource: this.mediaSource_,
        });
      },
      { once: true },
    );

    event.media.src = URL.createObjectURL(this.mediaSource_);
  };

  private onBufferCodecs_ = (event: BufferCodecsEvent) => {
    if (!this.mediaSource_) {
      return;
    }
    for (const [type, { mimeType, codec }] of event.tracks) {
      if (this.sourceBuffers_.has(type)) {
        continue;
      }
      const mime = `${mimeType};codecs="${codec}"`;
      const sb = this.mediaSource_.addSourceBuffer(mime);
      this.sourceBuffers_.set(type, sb);
      this.opQueue_.add(type, sb);
      sb.addEventListener("updateend", () => {
        this.opQueue_.shiftAndExecuteNext(type);
      });
    }
    this.duration_ = event.duration;
    this.player_.emit(Events.BUFFER_CREATED);
    this.updateDuration_();
  };

  private onBufferAppending_ = (event: BufferAppendingEvent) => {
    const { type, data, timestampOffset } = event;
    this.opQueue_.enqueue(type, {
      execute: () => {
        const sb = this.sourceBuffers_.get(type);
        if (!sb) {
          return;
        }
        if (sb.timestampOffset !== timestampOffset) {
          sb.timestampOffset = timestampOffset;
        }
        sb.appendBuffer(data);
      },
      onComplete: () => {
        this.player_.emit(Events.BUFFER_APPENDED, { type });
      },
    });
  };

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

  /**
   * Set mediaSource.duration through the operation
   * queue to avoid InvalidStateError when a
   * SourceBuffer is updating.
   */
  private updateDuration_() {
    if (
      !this.mediaSource_ ||
      this.mediaSource_.readyState !== "open"
    ) {
      return;
    }
    const duration = this.duration_;
    if (this.mediaSource_.duration === duration) {
      return;
    }
    const types = [...this.sourceBuffers_.keys()];
    const blockers = types.map((type) =>
      this.opQueue_.block(type),
    );
    Promise.all(blockers).then(() => {
      if (
        this.mediaSource_ &&
        this.mediaSource_.readyState === "open" &&
        this.mediaSource_.duration !== duration
      ) {
        this.mediaSource_.duration = duration;
      }
    });
  }

  private onBufferEos_ = async () => {
    const blockers = [...this.sourceBuffers_.keys()].map((type) =>
      this.opQueue_.block(type),
    );
    await Promise.all(blockers);
    if (this.mediaSource_?.readyState === "open") {
      this.mediaSource_.endOfStream();
    }
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/controllers/buffer_controller.ts
git commit -m "refactor: update BufferController for command/response events"
```

---

### Task 5: StreamController — Period-Aware Streaming

Rewrite StreamController to navigate the 4-level hierarchy, handle period transitions, and emit `BUFFER_CODECS`/`BUFFER_APPENDING`.

**Files:**
- Rewrite: `lib/controllers/stream_controller.ts`

- [ ] **Step 1: Rewrite stream_controller.ts**

Replace the entire contents of `lib/controllers/stream_controller.ts` with:

```typescript
import type {
  BufferAppendedEvent,
  ManifestParsedEvent,
  MediaAttachedEvent,
} from "../events";
import { Events } from "../events";
import type { Player } from "../player";
import type {
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

type MediaState = {
  presentation: Presentation;
  selectionSet: SelectionSet;
  switchingSet: SwitchingSet;
  track: Track;
  lastSegment: Segment | null;
  lastInitSegment: string | null;
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
    for (const mediaState of this.mediaStates_.values()) {
      mediaState.timer.destroy();
    }
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
    this.scheduleUpdate_(mediaState, 0);
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

  private onUpdate_(mediaState: MediaState) {
    const delay = this.update_(mediaState);
    if (delay !== null) {
      this.scheduleUpdate_(mediaState, delay);
    }
  }

  /**
   * Core streaming logic for a single track.
   * Returns seconds until next update, or null
   * if no reschedule is needed.
   */
  private update_(mediaState: MediaState): number | null {
    const media = this.player_.getMedia();
    const currentTime = media?.currentTime ?? 0;
    const bufferGoal = this.player_.getConfig().bufferGoal;

    const bufferedEnd = this.player_.getBufferedEnd(
      mediaState.selectionSet.type,
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

  private scheduleUpdate_(mediaState: MediaState, delay: number) {
    mediaState.timer.tickAfter(delay);
  }

  /**
   * Find the next segment to load. When the
   * current track is exhausted, transitions to
   * the next presentation if available.
   */
  private getNextSegment_(
    mediaState: MediaState,
  ): Segment | null {
    const { segments } = mediaState.track;

    if (!mediaState.lastSegment) {
      return segments[0] ?? null;
    }

    const lastIndex = segments.indexOf(mediaState.lastSegment);
    const next = segments[lastIndex + 1];
    if (next) {
      return next;
    }

    // Track exhausted — try next presentation.
    if (this.transitionToNextPresentation_(mediaState)) {
      return mediaState.track.segments[0] ?? null;
    }

    return null;
  }

  /**
   * Transition to the next presentation. Updates
   * the media state and loads the new init segment.
   * Returns true if a transition occurred.
   */
  private transitionToNextPresentation_(
    mediaState: MediaState,
  ): boolean {
    if (!this.manifest_) {
      return false;
    }

    const presentations = this.manifest_.presentations;
    const currentIndex = presentations.indexOf(
      mediaState.presentation,
    );
    const nextPresentation = presentations[currentIndex + 1];
    if (!nextPresentation) {
      return false;
    }

    const type = mediaState.selectionSet.type;
    const selectionSet = nextPresentation.selectionSets.find(
      (s) => s.type === type,
    );
    if (!selectionSet) {
      return false;
    }

    const switchingSet = selectionSet.switchingSets[0];
    if (!switchingSet) {
      return false;
    }

    const track = switchingSet.tracks[0];
    if (!track) {
      return false;
    }

    mediaState.presentation = nextPresentation;
    mediaState.selectionSet = selectionSet;
    mediaState.switchingSet = switchingSet;
    mediaState.track = track;
    mediaState.lastSegment = null;

    this.loadInitSegment_(mediaState);

    return true;
  }

  private checkEndOfStream_() {
    const allDone = [...this.mediaStates_.values()].every(
      (ms) => this.getNextSegment_(ms) === null,
    );
    if (allDone) {
      this.player_.emit(Events.BUFFER_EOS);
    }
  }

  /**
   * Compute total duration from the last
   * presentation's start + max segment end.
   */
  /**
   * Get total duration. Segment times are in
   * presentation time, so the last segment's
   * end in the first track is the duration.
   */
  private computeDuration_(): number {
    assertNotVoid(this.manifest_, "Manifest not set");
    const presentation = this.manifest_.presentations.at(-1);
    assertNotVoid(presentation, "No presentations");
    const selectionSet = presentation.selectionSets[0];
    assertNotVoid(selectionSet, "No selection sets");
    const switchingSet = selectionSet.switchingSets[0];
    assertNotVoid(switchingSet, "No switching sets");
    const track = switchingSet.tracks[0];
    assertNotVoid(track, "No tracks");
    const lastSeg = track.segments.at(-1);
    assertNotVoid(lastSeg, "No segments");
    return lastSeg.end;
  }

  private async loadInitSegment_(mediaState: MediaState) {
    const { initSegment } = mediaState.track;

    if (mediaState.lastInitSegment === initSegment.url) {
      return;
    }

    const response = await fetch(initSegment.url);
    const data = await response.arrayBuffer();

    mediaState.lastInitSegment = initSegment.url;

    this.player_.emit(Events.BUFFER_APPENDING, {
      type: mediaState.selectionSet.type,
      data,
      timestampOffset: this.getTimestampOffset_(mediaState),
    });
  }

  private async loadSegment_(
    mediaState: MediaState,
    segment: Segment,
  ) {
    const response = await fetch(segment.url);
    const data = await response.arrayBuffer();

    mediaState.lastSegment = segment;

    this.player_.emit(Events.BUFFER_APPENDING, {
      type: mediaState.selectionSet.type,
      data,
      timestampOffset: this.getTimestampOffset_(mediaState),
    });
  }

  private getTimestampOffset_(mediaState: MediaState): number {
    return (
      mediaState.presentation.start -
      mediaState.switchingSet.timeOffset
    );
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/controllers/stream_controller.ts
git commit -m "refactor: update StreamController for multi-period support"
```

---

### Task 6: Player — Update Imports and Exports

Update Player to remove old type imports and adjust the `getBufferedEnd` proxy.

**Files:**
- Modify: `lib/player.ts`

- [ ] **Step 1: Update player.ts**

The `Player` class uses `getBufferedEnd(type: MediaType)` which proxies to `BufferController`. This still works — `MediaType` is unchanged. The only change needed is removing old type imports if any, but the current code only imports `MediaType` which still exists.

No changes needed to `lib/player.ts` — verify with type check.

- [ ] **Step 2: Update example/main.ts**

Replace the contents of `example/main.ts` with:

```typescript
import { Events, Player } from "../lib/index.ts";

const player = new Player();

player.setConfig({
  bufferGoal: 10,
});

const video = document.getElementById("videoElement") as HTMLVideoElement;

player.on(Events.MANIFEST_PARSED, ({ manifest }) => {
  console.log("Manifest parsed:", manifest);
});

player.on(Events.MEDIA_ATTACHED, () => {
  console.log("Media attached, MediaSource open");
});

player.on(Events.BUFFER_APPENDED, ({ type }) => {
  console.log(`Buffer appended: ${type}`);
});

player.attachMedia(video);

player.load(
  "https://d305rncpy6ne2q.cloudfront.net/v1/dash/94063eadf7d8c56e9e2edd84fdf897826a70d0df/SFP-MediaTailor-VOD-HLS-DASH/out/v1/b94f3611978f419985a18335bac9d9cb/ddb73bf548a44551a0059c346226445a/eaa5485198bf497284559efb8172425e/index.mpd?aws.sessionId=21567779-c8a8-4be9-9f18-d628dea03826",
);
```

- [ ] **Step 3: Run type check**

Run: `pnpm tsc`
Expected: PASS — no type errors.

- [ ] **Step 4: Run format**

Run: `pnpm format`
Expected: PASS — all files formatted.

- [ ] **Step 5: Commit**

```bash
git add example/main.ts
git commit -m "refactor: update example app for new event architecture"
```

---

### Task 7: Smoke Test

Verify the full pipeline works end-to-end by running the dev server and testing playback.

**Files:**
- None (manual verification)

- [ ] **Step 1: Build**

Run: `pnpm build`
Expected: PASS — successful build with no errors.

- [ ] **Step 2: Start dev server and verify playback**

Run: `pnpm dev`

Open the URL in a browser. Verify:
1. Manifest parses without errors (check console for "Manifest parsed" log).
2. SourceBuffers are created (no MSE errors in console).
3. Video plays back — segments load and append.
4. No errors in the browser console.

Note: The test manifest is single-period, so this verifies backward compatibility. Multi-period testing requires a multi-period manifest.

- [ ] **Step 3: Final commit (if any fixes needed)**

If any fixes were needed during smoke testing, commit them:

```bash
git add -A
git commit -m "fix: address smoke test issues"
```

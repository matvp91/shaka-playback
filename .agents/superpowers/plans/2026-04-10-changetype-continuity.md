# changeType & Flat Manifest Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Support MSE `changeType` for codec switching by flattening the manifest model (removing Presentation), adding SwitchingSet to MediaState, and simplifying StreamController.

**Architecture:** Remove the Presentation level from the manifest hierarchy. The DASH parser flattens periods into continuous segment arrays per track, with each segment referencing its own InitSegment. StreamController gains a `switchingSet` field in MediaState and uses reference comparison to detect codec changes and emit BUFFER_CODECS. BufferController handles repeated BUFFER_CODECS by calling `changeType` on the existing SourceBuffer.

**Tech Stack:** TypeScript, MSE (MediaSource Extensions)

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `lib/types/manifest.ts` | Modify | Remove Presentation, add initSegment to Segment, remove initSegment from Track |
| `lib/dash/dash_parser.ts` | Modify | Flatten periods into continuous tracks, attach initSegment to each segment |
| `lib/dash/dash_presentation.ts` | Modify | Return initSegment reference with each segment |
| `lib/utils/stream_utils.ts` | Modify | Remove resolveTrack, getStreamAction; update getStreams to use flat model |
| `lib/media/stream_controller.ts` | Modify | Add switchingSet to MediaState, simplify update loop, add applyHierarchy_ |
| `lib/media/buffer_controller.ts` | Modify | Support changeType in onBufferCodecs_ |
| `lib/index.ts` | Verify | Presentation export removed automatically when type is deleted |

---

### Task 1: Flatten manifest types

**Files:**
- Modify: `lib/types/manifest.ts`

- [ ] **Step 1: Update Manifest type**

Remove the `Presentation` type and update `Manifest` to hold `switchingSets` directly. Move `initSegment` from Track to Segment.

```ts
import type { MediaType } from "./media";

export type Manifest = {
  duration: number;
  switchingSets: SwitchingSet[];
};

/**
 * CMAF switching set — tracks that can be seamlessly
 * switched between (same codec, same type).
 */
export type SwitchingSet = {
  type: MediaType;
  codec: string;
  tracks: Track[];
};

/**
 * Single quality level as a sequence of segments,
 * discriminated by media type.
 */
export type Track = {
  bandwidth: number;
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

export type InitSegment = {
  url: string;
};

export type Segment = {
  url: string;
  start: number;
  end: number;
  initSegment: InitSegment;
};
```

- [ ] **Step 2: Run type check to see all breakages**

Run: `pnpm tsc`
Expected: Type errors in dash_parser.ts, dash_presentation.ts, stream_controller.ts, stream_utils.ts. This is expected — we fix them in subsequent tasks.

- [ ] **Step 3: Commit**

```bash
git add lib/types/manifest.ts
git commit -m "refactor: flatten manifest types, remove Presentation"
```

---

### Task 2: Update DASH segment parsing to attach initSegment to each segment

**Files:**
- Modify: `lib/dash/dash_presentation.ts`

- [ ] **Step 1: Update parseSegmentData return type**

Change the return shape: instead of returning `{ initSegment, segments }` where segments lack initSegment, create the InitSegment first and attach it to each segment. The stable reference is shared across all segments from the same period.

```ts
export function parseSegmentData(
  _mpd: MPD,
  period: Period,
  adaptationSet: AdaptationSet,
  representation: Representation,
  baseUrl: string,
  duration: number | null,
) {
  const st = resolveSegmentTemplate(
    period.SegmentTemplate,
    adaptationSet.SegmentTemplate,
    representation.SegmentTemplate,
  );

  const initialization = st["@_initialization"];
  asserts.assertExists(initialization, "initialization is mandatory");

  const media = st["@_media"];
  asserts.assertExists(media, "media is mandatory");

  const timescale = XmlUtils.asNumber(st["@_timescale"]);
  asserts.assertExists(timescale, "timescale is mandatory");

  const bandwidth = XmlUtils.asNumber(representation["@_bandwidth"]);
  asserts.assertExists(bandwidth, "bandwidth is mandatory");

  const pto = XmlUtils.asNumber(st["@_presentationTimeOffset"]) ?? 0;

  const periodStart = period["@_start"]
    ? decodeIso8601Duration(period["@_start"])
    : 0;

  const initSegmentUrl = UrlUtils.resolveUrl(
    processUriTemplate(
      initialization,
      representation["@_id"],
      null,
      null,
      bandwidth,
      null,
    ),
    baseUrl,
  );

  const initSegment: InitSegment = {
    url: initSegmentUrl,
  };

  const segments = st.SegmentTimeline
    ? mapTemplateTimeline(
        st.SegmentTimeline,
        media,
        st,
        representation,
        baseUrl,
        bandwidth,
        pto,
        periodStart,
        initSegment,
      )
    : mapTemplateDuration(
        st,
        media,
        representation,
        baseUrl,
        bandwidth,
        pto,
        periodStart,
        duration,
        initSegment,
      );

  return { segments };
}
```

- [ ] **Step 2: Update mapTemplateTimeline to accept and attach initSegment**

Add `initSegment` parameter. Each segment includes it:

```ts
function mapTemplateTimeline(
  timeline: SegmentTimeline,
  media: string,
  st: SegmentTemplate,
  representation: Representation,
  baseUrl: string,
  bandwidth: number,
  pto: number,
  periodStart: number,
  initSegment: InitSegment,
): Segment[] {
  const timescale = XmlUtils.asNumber(st["@_timescale"]) ?? 1;
  const startNumber = XmlUtils.asNumber(st["@_startNumber"]) ?? 1;
  const segments: Segment[] = [];
  let time = 0;
  let number = startNumber;

  for (const s of timeline.S) {
    const d = XmlUtils.asNumber(s["@_d"]);
    asserts.assertExists(d, "segment duration is mandatory");
    const r = XmlUtils.asNumber(s["@_r"]) ?? 0;

    const t = XmlUtils.asNumber(s["@_t"]);
    if (t != null) {
      time = t;
    }

    for (let i = 0; i <= r; i++) {
      const relativeUrl = processUriTemplate(
        media,
        representation["@_id"],
        number,
        null,
        bandwidth,
        time,
      );
      const url = UrlUtils.resolveUrl(relativeUrl, baseUrl);
      segments.push({
        url,
        start: (time - pto) / timescale + periodStart,
        end: (time - pto + d) / timescale + periodStart,
        initSegment,
      });
      time += d;
      number++;
    }
  }

  return segments;
}
```

- [ ] **Step 3: Update mapTemplateDuration to accept and attach initSegment**

Same pattern:

```ts
function mapTemplateDuration(
  st: SegmentTemplate,
  media: string,
  representation: Representation,
  baseUrl: string,
  bandwidth: number,
  pto: number,
  periodStart: number,
  presentationDuration: number | null,
  initSegment: InitSegment,
): Segment[] {
  asserts.assertExists(
    presentationDuration,
    "Duration-based addressing requires a resolvable presentation duration",
  );

  const templateDuration = XmlUtils.asNumber(st["@_duration"]);
  asserts.assertExists(
    templateDuration,
    "SegmentTemplate requires either SegmentTimeline or @duration",
  );

  const timescale = XmlUtils.asNumber(st["@_timescale"]) ?? 1;
  const startNumber = XmlUtils.asNumber(st["@_startNumber"]) ?? 1;
  const segmentDuration = templateDuration / timescale;
  const segmentCount = Math.ceil(presentationDuration / segmentDuration);

  const segments: Segment[] = [];

  for (let i = 0; i < segmentCount; i++) {
    const number = startNumber + i;
    const time = i * templateDuration;
    const relativeUrl = processUriTemplate(
      media,
      representation["@_id"],
      number,
      null,
      bandwidth,
      time,
    );
    const url = UrlUtils.resolveUrl(relativeUrl, baseUrl);
    segments.push({
      url,
      start: (time - pto) / timescale + periodStart,
      end: (time - pto + templateDuration) / timescale + periodStart,
      initSegment,
    });
  }

  return segments;
}
```

- [ ] **Step 4: Remove InitSegment import if no longer used directly**

Update import line — `InitSegment` is still used (we create one), keep it. But verify `Segment` import is present since segments now include initSegment.

```ts
import type { InitSegment, Segment } from "../types/manifest";
```

- [ ] **Step 5: Commit**

```bash
git add lib/dash/dash_presentation.ts
git commit -m "refactor: attach initSegment to each segment in DASH parser"
```

---

### Task 3: Flatten DASH parser to merge periods

**Files:**
- Modify: `lib/dash/dash_parser.ts`

- [ ] **Step 1: Rewrite parseManifest to flatten periods**

Instead of creating a Presentation per period, collect all switching sets across periods and merge tracks by matching type + codec. Segments from later periods are appended to the same track.

```ts
export function parseManifest(text: string, sourceUrl: string) {
  const parser = new XMLParser({
    ignoreAttributes: false,
    alwaysCreateTextNode: true,
    isArray: (tagName) => DASH_ARRAY_NODES.includes(tagName),
  });
  const mpd = parser.parse(text).MPD as MPD;

  if (mpd.Period.length === 0) {
    throw new Error("No Period found in manifest");
  }

  const switchingSets = flattenPeriods(sourceUrl, mpd);
  const duration = resolveDuration(mpd, switchingSets);

  const manifest: Manifest = {
    duration,
    switchingSets,
  };
  return manifest;
}
```

- [ ] **Step 2: Write flattenPeriods function**

Parse each period's switching sets, then merge into a single flat list. For each period's switching set, find the matching one in the result (by type + codec) and append segments to the corresponding tracks. If no match exists, add the switching set as new.

```ts
function flattenPeriods(
  sourceUrl: string,
  mpd: MPD,
): SwitchingSet[] {
  const result: SwitchingSet[] = [];

  for (let i = 0; i < mpd.Period.length; i++) {
    const period = mpd.Period[i];
    const duration = resolvePeriodDuration(mpd, period, i);

    for (const as of period.AdaptationSet) {
      const type = inferMediaType(as);
      asserts.assertExists(type, "Cannot infer media type");
      const ss = parseSwitchingSet(
        sourceUrl, mpd, period, as, type, duration,
      );

      const existing = result.find(
        (r) => r.type === ss.type && r.codec === ss.codec,
      );

      if (existing) {
        for (let t = 0; t < ss.tracks.length; t++) {
          asserts.assertExists(
            existing.tracks[t],
            "Track count mismatch across periods",
          );
          existing.tracks[t].segments.push(...ss.tracks[t].segments);
        }
      } else {
        result.push(ss);
      }
    }
  }

  return result;
}
```

- [ ] **Step 3: Write resolveDuration function**

Compute manifest duration from the last segment or MPD metadata:

```ts
function resolveDuration(
  mpd: MPD,
  switchingSets: SwitchingSet[],
): number {
  const mpdDuration = mpd["@_mediaPresentationDuration"];
  if (mpdDuration != null) {
    return decodeIso8601Duration(mpdDuration);
  }

  const lastSegmentEnd =
    switchingSets[0]?.tracks[0]?.segments.at(-1)?.end;
  asserts.assertExists(lastSegmentEnd, "Cannot resolve duration");
  return lastSegmentEnd;
}
```

- [ ] **Step 4: Rename resolvePresentationDuration to resolvePeriodDuration**

This function resolves a single period's duration from metadata. Rename for clarity since we no longer have Presentations. Update signature to remove unused `start` param — pass `period` start inline:

```ts
function resolvePeriodDuration(
  mpd: MPD,
  period: Period,
  periodIndex: number,
): number | null {
  const duration = period["@_duration"];
  if (duration != null) {
    return decodeIso8601Duration(duration);
  }

  const start = period["@_start"]
    ? decodeIso8601Duration(period["@_start"])
    : 0;

  const nextStart = mpd.Period[periodIndex + 1]?.["@_start"];
  if (nextStart != null) {
    return decodeIso8601Duration(nextStart) - start;
  }

  const mpdDuration = mpd["@_mediaPresentationDuration"];
  if (mpdDuration != null) {
    return decodeIso8601Duration(mpdDuration) - start;
  }

  return null;
}
```

- [ ] **Step 5: Remove parsePeriod and resolvePresentationEnd**

These are no longer needed — their logic is absorbed into `flattenPeriods` and `resolveDuration`.

- [ ] **Step 6: Update parseTrack to use new segment data shape**

`parseSegmentData` now returns `{ segments }` (no `initSegment` at the top level). Update track creation to spread only segments:

```ts
function parseTrack(
  sourceUrl: string,
  mpd: MPD,
  period: Period,
  adaptationSet: AdaptationSet,
  representation: Representation,
  type: MediaType,
  duration: number | null,
): Track {
  const baseUrls = Functional.filterMap(
    [mpd, period, adaptationSet, representation],
    (node) => node.BaseURL?.["#text"],
  );
  const baseUrl = UrlUtils.resolveUrls([sourceUrl, ...baseUrls]);

  const bandwidth = XmlUtils.asNumber(representation["@_bandwidth"]);
  asserts.assertExists(bandwidth, "bandwidth is mandatory");

  const { segments } = parseSegmentData(
    mpd,
    period,
    adaptationSet,
    representation,
    baseUrl,
    duration,
  );

  if (type === MediaType.VIDEO) {
    const width = XmlUtils.asNumber(
      Functional.findMap([representation, adaptationSet], "@_width"),
    );
    asserts.assertExists(width, "width is mandatory");

    const height = XmlUtils.asNumber(
      Functional.findMap([representation, adaptationSet], "@_height"),
    );
    asserts.assertExists(height, "height is mandatory");

    return {
      type: MediaType.VIDEO,
      width,
      height,
      bandwidth,
      segments,
    };
  }

  if (type === MediaType.AUDIO) {
    return {
      type: MediaType.AUDIO,
      bandwidth,
      segments,
    };
  }

  throw new Error("TODO: Map TEXT type");
}
```

- [ ] **Step 7: Clean up imports**

Remove `Presentation` from the import:

```ts
import type {
  Manifest,
  SwitchingSet,
  Track,
} from "../types/manifest";
```

- [ ] **Step 8: Commit**

```bash
git add lib/dash/dash_parser.ts
git commit -m "refactor: flatten DASH periods into continuous tracks"
```

---

### Task 4: Update stream_utils

**Files:**
- Modify: `lib/utils/stream_utils.ts`

- [ ] **Step 1: Update getStreams for flat model**

No more `presentations.map()` with intersection. Derive streams directly from `manifest.switchingSets`:

```ts
/**
 * Derive the set of available streams from the manifest.
 */
export function getStreams(manifest: Manifest): Stream[] {
  const streams: Stream[] = [];
  for (const ss of manifest.switchingSets) {
    for (const track of ss.tracks) {
      const stream: Stream =
        track.type === MediaType.VIDEO
          ? {
              type: track.type,
              codec: ss.codec,
              width: track.width,
              height: track.height,
            }
          : { type: track.type, codec: ss.codec };
      if (!streams.some((s) => isSameStream(s, stream))) {
        streams.push(stream);
      }
    }
  }
  asserts.assert(streams.length > 0, "No streams found");
  return streams;
}
```

- [ ] **Step 2: Remove resolveTrack and getStreamAction**

Delete both functions entirely. `resolveTrack` is replaced by `resolveHierarchy` in stream_controller. `getStreamAction` is replaced by reference comparison.

- [ ] **Step 3: Clean up imports**

```ts
import type { Manifest } from "../types/manifest";
import type { ByType, Stream, StreamPreference } from "../types/media";
import { MediaType } from "../types/media";
import * as asserts from "./asserts";
```

Remove `Presentation` and `Track` imports.

- [ ] **Step 4: Commit**

```bash
git add lib/utils/stream_utils.ts
git commit -m "refactor: slim stream_utils to selection only"
```

---

### Task 5: Rewrite StreamController

**Files:**
- Modify: `lib/media/stream_controller.ts`

This is the largest task. We rewrite stream_controller with the new MediaState, flat manifest model, and simplified update loop.

- [ ] **Step 1: Update imports**

```ts
import type {
  ManifestParsedEvent,
  MediaAttachedEvent,
  StreamPreferenceChangedEvent,
} from "../events";
import { Events } from "../events";
import type { Player } from "../player";
import type {
  InitSegment,
  Manifest,
  Segment,
  SwitchingSet,
  Track,
} from "../types/manifest";
import type {
  ByType,
  MediaType,
  Stream,
  StreamPreference,
} from "../types/media";
import type { NetworkRequest } from "../types/net";
import { ABORTED, NetworkRequestType } from "../types/net";
import * as ArrayUtils from "../utils/array_utils";
import * as asserts from "../utils/asserts";
import * as BufferUtils from "../utils/buffer_utils";
import * as CodecUtils from "../utils/codec_utils";
import * as StreamUtils from "../utils/stream_utils";
import { Timer } from "../utils/timer";
```

- [ ] **Step 2: Update MediaState type**

```ts
const TICK_INTERVAL = 0.1;

type MediaState<T extends MediaType = MediaType> = {
  /** Identity */
  type: T;
  stream: ByType<Stream, T>;

  /** Hierarchy */
  switchingSet: SwitchingSet;
  track: ByType<Track, T>;

  /** Delivery */
  lastSegment: Segment | null;
  lastInitSegment: InitSegment | null;

  /** Operational */
  request: NetworkRequest | null;
  ended: boolean;
  timer: Timer;
};
```

- [ ] **Step 3: Write resolveHierarchy helper**

Add as a module-level function above the class:

```ts
/**
 * Find the SwitchingSet and Track matching a stream.
 */
function resolveHierarchy(
  manifest: Manifest,
  stream: Stream,
): { switchingSet: SwitchingSet; track: Track } {
  for (const switchingSet of manifest.switchingSets) {
    if (
      switchingSet.type !== stream.type ||
      switchingSet.codec !== stream.codec
    ) {
      continue;
    }
    for (const track of switchingSet.tracks) {
      if (
        stream.type !== MediaType.VIDEO ||
        track.type !== MediaType.VIDEO ||
        (stream.width === track.width && stream.height === track.height)
      ) {
        return { switchingSet, track };
      }
    }
  }
  throw new Error("No matching hierarchy for stream");
}
```

- [ ] **Step 4: Write remapSegment helper**

```ts
/**
 * Remap a segment to the equivalent position in a
 * different track. CMAF guarantees aligned segments
 * within a SwitchingSet.
 */
function remapSegment(
  oldTrack: Track,
  newTrack: Track,
  lastSegment: Segment,
): Segment {
  const index = oldTrack.segments.indexOf(lastSegment);
  asserts.assert(index !== -1, "Segment not found in old track");
  const segment = newTrack.segments[index];
  asserts.assertExists(segment, "Segment index out of bounds in new track");
  return segment;
}
```

- [ ] **Step 5: Write the StreamController class**

```ts
export class StreamController {
  private manifest_: Manifest | null = null;
  private streams_: Stream[] | null = null;
  private media_: HTMLMediaElement | null = null;
  private mediaStates_ = new Map<MediaType, MediaState>();
  private preferences_ = new Map<MediaType, StreamPreference>();

  constructor(private player_: Player) {
    this.player_.on(Events.MANIFEST_PARSED, this.onManifestParsed_);
    this.player_.on(Events.MEDIA_ATTACHED, this.onMediaAttached_);
    this.player_.on(Events.MEDIA_DETACHED, this.onMediaDetached_);
    this.player_.on(
      Events.STREAM_PREFERENCE_CHANGED,
      this.onStreamPreferenceChanged_,
    );
  }

  getStreams() {
    asserts.assertExists(this.streams_, "No Streams");
    return this.streams_;
  }

  getActiveStream(type: MediaType) {
    const mediaState = this.mediaStates_.get(type);
    asserts.assertExists(mediaState, `No Media State for ${type}`);
    return mediaState.stream;
  }

  destroy() {
    const networkService = this.player_.getNetworkService();
    for (const mediaState of this.mediaStates_.values()) {
      if (mediaState.request) {
        networkService.cancel(mediaState.request);
      }
      mediaState.timer.destroy();
    }
    this.player_.off(Events.MANIFEST_PARSED, this.onManifestParsed_);
    this.player_.off(Events.MEDIA_ATTACHED, this.onMediaAttached_);
    this.player_.off(Events.MEDIA_DETACHED, this.onMediaDetached_);
    this.player_.off(
      Events.STREAM_PREFERENCE_CHANGED,
      this.onStreamPreferenceChanged_,
    );
    this.manifest_ = null;
    this.streams_ = null;
    this.mediaStates_.clear();
    this.preferences_.clear();
  }

  private onManifestParsed_ = (event: ManifestParsedEvent) => {
    this.manifest_ = event.manifest;
    this.streams_ = StreamUtils.getStreams(this.manifest_);
    this.tryStart_();
  };

  private onMediaAttached_ = (event: MediaAttachedEvent) => {
    this.media_ = event.media;
    this.media_.addEventListener("seeking", this.onSeeking_);
    this.tryStart_();
  };

  private onStreamPreferenceChanged_ = (
    event: StreamPreferenceChangedEvent,
  ) => {
    const { preference } = event;

    const mediaState = this.mediaStates_.get(preference.type);
    if (!mediaState || !this.manifest_) {
      return;
    }

    this.preferences_.set(preference.type, preference);

    const stream = StreamUtils.selectStream(this.getStreams(), preference);
    if (stream === mediaState.stream) {
      return;
    }

    const networkService = this.player_.getNetworkService();
    if (mediaState.request) {
      networkService.cancel(mediaState.request);
    }

    const oldTrack = mediaState.track;
    const { switchingSet, track } = resolveHierarchy(
      this.manifest_,
      stream,
    );

    if (switchingSet !== mediaState.switchingSet) {
      this.player_.emit(Events.BUFFER_CODECS, {
        type: mediaState.type,
        mimeType: CodecUtils.getContentType(mediaState.type, stream.codec),
        duration: this.manifest_.duration,
      });
    }

    if (track !== oldTrack && mediaState.lastSegment) {
      if (switchingSet === mediaState.switchingSet) {
        mediaState.lastSegment = remapSegment(
          oldTrack, track, mediaState.lastSegment,
        );
      } else {
        // Codec switch: segments may not align across
        // SwitchingSets, use time-based lookup to find
        // position in new track.
        const lookupTime = mediaState.lastSegment.end;
        mediaState.lastSegment = this.getSegmentForTime_(
          track, lookupTime,
        );
      }
    }

    mediaState.stream = stream;
    mediaState.switchingSet = switchingSet;
    mediaState.track = track;
    this.update_(mediaState);
  };

  private onMediaDetached_ = () => {
    const networkService = this.player_.getNetworkService();
    for (const mediaState of this.mediaStates_.values()) {
      if (mediaState.request) {
        networkService.cancel(mediaState.request);
      }
      mediaState.timer.stop();
    }
    this.media_?.removeEventListener("seeking", this.onSeeking_);
    this.media_ = null;
  };

  private tryStart_() {
    if (!this.manifest_ || !this.media_) {
      return;
    }

    const streams = this.getStreams();
    const types = new Set(streams.map((s) => s.type));

    for (const type of types) {
      const preference = this.preferences_.get(type) ?? { type };
      this.preferences_.set(type, preference);
      const stream = StreamUtils.selectStream(streams, preference);
      const { switchingSet, track } = resolveHierarchy(
        this.manifest_, stream,
      );

      const mediaState: MediaState = {
        type,
        stream,
        switchingSet,
        track,
        ended: false,
        lastSegment: null,
        lastInitSegment: null,
        request: null,
        timer: new Timer(() => this.update_(mediaState)),
      };

      this.mediaStates_.set(type, mediaState);

      this.player_.emit(Events.BUFFER_CODECS, {
        type,
        mimeType: CodecUtils.getContentType(type, stream.codec),
        duration: this.manifest_.duration,
      });
    }

    for (const mediaState of this.mediaStates_.values()) {
      mediaState.timer.tickEvery(TICK_INTERVAL);
    }
  }

  /**
   * Core streaming tick. Finds the next segment to fetch
   * via sequential index or time-based lookup.
   */
  private update_(mediaState: MediaState) {
    if (mediaState.ended || mediaState.request?.inFlight) {
      return;
    }
    if (!this.media_) {
      return;
    }

    const currentTime = this.media_.currentTime;
    const frontBufferLength = this.player_.getConfig().frontBufferLength;
    const bufferEnd = this.getBufferEnd_(mediaState.type, currentTime);

    if (bufferEnd !== null && bufferEnd - currentTime >= frontBufferLength) {
      return;
    }

    const lookupTime = bufferEnd ?? currentTime;

    const segment = mediaState.lastSegment
      ? this.getNextSegment_(mediaState)
      : this.getSegmentForTime_(mediaState.track, lookupTime);

    if (!segment) {
      mediaState.ended = true;
      this.checkEndOfStream_();
      return;
    }

    if (segment.initSegment !== mediaState.lastInitSegment) {
      this.loadSegment_(mediaState, segment.initSegment, null);
      return;
    }

    this.loadSegment_(mediaState, segment.initSegment, segment);
  }

  /**
   * Fetch an init or media segment and emit
   * BUFFER_APPENDING. State is updated only after
   * the fetch resolves.
   */
  private async loadSegment_(
    mediaState: MediaState,
    initSegment: InitSegment,
    segment: Segment | null,
  ) {
    const networkService = this.player_.getNetworkService();
    const url = segment?.url ?? initSegment.url;

    mediaState.request = networkService.request(
      NetworkRequestType.SEGMENT,
      url,
    );

    const response = await mediaState.request.promise;
    if (response === ABORTED) {
      return;
    }

    if (segment) {
      mediaState.lastSegment = segment;
    } else {
      mediaState.lastInitSegment = initSegment;
    }

    this.player_.emit(Events.BUFFER_APPENDING, {
      type: mediaState.type,
      initSegment,
      segment,
      data: response.arrayBuffer,
    });
  }

  private getBufferEnd_(type: MediaType, time: number): number | null {
    const { maxBufferHole } = this.player_.getConfig();
    const buffered = this.player_.getBuffered(type);
    return BufferUtils.getBufferedEnd(buffered, time, maxBufferHole);
  }

  private getNextSegment_(mediaState: MediaState): Segment | null {
    const { segments } = mediaState.track;
    asserts.assertExists(mediaState.lastSegment, "No last segment");
    const lastIndex = segments.indexOf(mediaState.lastSegment);
    return segments[lastIndex + 1] ?? null;
  }

  /**
   * Binary search for the segment containing the given
   * time.
   */
  private getSegmentForTime_(track: Track, time: number): Segment | null {
    const { maxSegmentLookupTolerance } = this.player_.getConfig();
    return ArrayUtils.binarySearch(track.segments, (seg) => {
      if (time >= seg.start && time < seg.end) {
        return 0;
      }
      if (time < seg.start) {
        const tolerance = Math.min(
          maxSegmentLookupTolerance,
          seg.end - seg.start,
        );
        if (seg.start - tolerance > time && seg.start > 0) {
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

  private onSeeking_ = () => {
    for (const mediaState of this.mediaStates_.values()) {
      mediaState.ended = false;
      if (mediaState.request) {
        const networkService = this.player_.getNetworkService();
        networkService.cancel(mediaState.request);
      }
      mediaState.lastSegment = null;
      this.update_(mediaState);
    }
  };
}
```

- [ ] **Step 6: Run type check**

Run: `pnpm tsc`
Expected: PASS (or only buffer_controller errors remaining from Task 6)

- [ ] **Step 7: Commit**

```bash
git add lib/media/stream_controller.ts
git commit -m "refactor: simplify StreamController with flat model and switchingSet"
```

---

### Task 6: Add changeType support to BufferController

**Files:**
- Modify: `lib/media/buffer_controller.ts`

- [ ] **Step 1: Update onBufferCodecs_**

Replace the early return when SourceBuffer exists with a `changeType` call through the operation queue:

```ts
private onBufferCodecs_ = (event: BufferCodecsEvent) => {
  if (!this.mediaSource_) {
    return;
  }

  const { type, mimeType } = event;
  const sb = this.sourceBuffers_.get(type);

  if (sb) {
    this.opQueue_.enqueue(type, {
      execute: () => sb.changeType(mimeType),
    });
    return;
  }

  const newSb = this.mediaSource_.addSourceBuffer(mimeType);
  this.sourceBuffers_.set(type, newSb);
  this.opQueue_.add(type, newSb);

  newSb.addEventListener("updateend", () => {
    this.opQueue_.shiftAndExecuteNext(type);
  });

  this.updateDuration_(event.duration);
};
```

- [ ] **Step 2: Run type check**

Run: `pnpm tsc`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add lib/media/buffer_controller.ts
git commit -m "feat: support MSE changeType in BufferController"
```

---

### Task 7: Verify build and format

**Files:**
- All modified files

- [ ] **Step 1: Run full type check**

Run: `pnpm tsc`
Expected: PASS — no type errors

- [ ] **Step 2: Run formatter**

Run: `pnpm format`
Expected: All files formatted, no lint errors

- [ ] **Step 3: Run build**

Run: `pnpm build`
Expected: Build succeeds

- [ ] **Step 4: Final commit if formatting changed anything**

```bash
git add -A
git commit -m "chore: format"
```

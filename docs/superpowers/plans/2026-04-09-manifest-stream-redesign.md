# Manifest Model & Stream Selection Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove SelectionSet from the manifest model, simplify the DASH parser, split stream selection into focused functions, and make BUFFER_CODECS per-type.

**Architecture:** SelectionSet is dropped — SwitchingSets move directly onto Presentation with a `type` field. Stream selection is split into `getStreams`, `selectStream`, and `resolveTrack`. BUFFER_CODECS becomes per-type to support both initial setup and future changeType. Eight functions are removed across parser and selection logic.

**Tech Stack:** TypeScript, Biome

---

### Task 1: Update Manifest Types

Remove SelectionSet, add `type` to SwitchingSet, update Presentation.

**Files:**
- Modify: `lib/types/manifest.ts`

- [ ] **Step 1: Rewrite manifest types**

Replace the full contents of `lib/types/manifest.ts`:

```ts
import type { MediaType } from "./media";

export type Manifest = {
  presentations: Presentation[];
};

/**
 * Time-bounded content period, maps to a DASH Period.
 */
export type Presentation = {
  start: number;
  end: number;
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

export type InitSegment = {
  url: string;
};

export type Segment = {
  url: string;
  start: number;
  end: number;
};
```

- [ ] **Step 2: Verify the type change compiles in isolation**

Run: `pnpm tsc 2>&1 | head -40`

Expected: Errors in files that reference `selectionSets` or `SelectionSet` (dash_parser.ts, stream_select.ts, stream_controller.ts). This is expected — those files are updated in subsequent tasks.

- [ ] **Step 3: Commit**

```bash
git add lib/types/manifest.ts
git commit -m "refactor: remove SelectionSet, add type to SwitchingSet"
```

---

### Task 2: Move Stream Types to stream.ts

Move `Stream` and `StreamPreference` from `types/player.ts` to a new `types/stream.ts`. Update barrel export.

**Files:**
- Create: `lib/types/stream.ts`
- Modify: `lib/types/player.ts`
- Modify: `lib/types/index.ts`

- [ ] **Step 1: Create stream.ts**

Create `lib/types/stream.ts`:

```ts
import type { MediaType } from "./media";

export type Stream = {
  codec: string;
} & (
  | { type: MediaType.VIDEO; width: number; height: number }
  | { type: MediaType.AUDIO }
);

export type StreamPreference = {
  [K in Stream as K["type"]]: { type: K["type"] } & Partial<Omit<K, "type">>;
}[Stream["type"]];
```

- [ ] **Step 2: Remove Stream types from player.ts**

Replace the full contents of `lib/types/player.ts` with an empty file (no exports remain):

```ts
```

Note: If player.ts has no other types, it can be deleted entirely. Check if anything imports from it besides Stream/StreamPreference.

- [ ] **Step 3: Update barrel export**

Replace the full contents of `lib/types/index.ts`:

```ts
export * from "./manifest";
export * from "./media";
export * from "./net";
export * from "./stream";
```

- [ ] **Step 4: Type check**

Run: `pnpm tsc 2>&1 | head -20`

Expected: Still errors from dash_parser.ts and stream_select.ts referencing `SelectionSet`/`selectionSets`. No new errors from the Stream move — all consumers import through the barrel.

- [ ] **Step 5: Commit**

```bash
git add lib/types/stream.ts lib/types/player.ts lib/types/index.ts
git commit -m "refactor: move Stream types to types/stream.ts"
```

---

### Task 3: Simplify DASH Parser

Remove `@group` support, remove `groupAdaptationSets`, `parseSelectionSet`, `inferContentType`. Each AdaptationSet maps directly to a SwitchingSet.

**Files:**
- Modify: `lib/dash/dash_parser.ts`
- Modify: `lib/types/dash.ts`

- [ ] **Step 1: Remove @group from DASH types**

In `lib/types/dash.ts`, remove the `@_group` line from `AdaptationSet`:

```ts
export type AdaptationSet = {
  "@_contentType"?: string;
  "@_mimeType"?: string;
  "@_codecs"?: string;
  "@_width"?: string;
  "@_height"?: string;
  BaseURL?: TextNode;
  SegmentTemplate?: SegmentTemplate;
  Representation: Representation[];
};
```

- [ ] **Step 2: Rewrite dash_parser.ts**

Replace the full contents of `lib/dash/dash_parser.ts`:

```ts
import { decodeIso8601Duration } from "@svta/cml-iso-8601";
import { XMLParser } from "fast-xml-parser";
import type {
  Manifest,
  Presentation,
  SwitchingSet,
  Track,
} from "../types";
import { MediaType } from "../types";
import type {
  AdaptationSet,
  MPD,
  Period,
  Representation,
} from "../types/dash";
import { assertNotVoid } from "../utils/assert";
import { filterMap, findMap } from "../utils/functional";
import { asNumber } from "../utils/parse";
import { resolveUrls } from "../utils/url";
import { parseSegmentData } from "./dash_presentation";

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

export async function parseManifest(
  text: string,
  sourceUrl: string,
) {
  const parser = new XMLParser({
    ignoreAttributes: false,
    alwaysCreateTextNode: true,
    isArray: (tagName) => DASH_ARRAY_NODES.includes(tagName),
  });
  const mpd = parser.parse(text).MPD as MPD;

  if (mpd.Period.length === 0) {
    throw new Error("No Period found in manifest");
  }

  const presentations = mpd.Period.map((period, periodIndex) =>
    parsePeriod(sourceUrl, mpd, period, periodIndex),
  );

  const manifest: Manifest = { presentations };

  return manifest;
}

function parsePeriod(
  sourceUrl: string,
  mpd: MPD,
  period: Period,
  periodIndex: number,
): Presentation {
  const start = period["@_start"]
    ? decodeIso8601Duration(period["@_start"])
    : 0;

  const switchingSets = period.AdaptationSet.map((as) => {
    const type = inferMediaType(as);
    assertNotVoid(type, "Cannot infer media type");
    return parseSwitchingSet(sourceUrl, mpd, period, as, type);
  });

  const end = resolvePresentationEnd(
    mpd,
    period,
    periodIndex,
    start,
    switchingSets,
  );

  return { start, end, switchingSets };
}

/**
 * Resolve presentation end using the DASH fallback chain:
 * duration → next start → MPD duration → last segment end.
 */
function resolvePresentationEnd(
  mpd: MPD,
  period: Period,
  periodIndex: number,
  start: number,
  switchingSets: SwitchingSet[],
): number {
  const duration = period["@_duration"];
  if (duration != null) {
    return start + decodeIso8601Duration(duration);
  }

  const nextStart = mpd.Period[periodIndex + 1]?.["@_start"];
  if (nextStart != null) {
    return decodeIso8601Duration(nextStart);
  }

  const mpdDuration = mpd["@_mediaPresentationDuration"];
  if (mpdDuration != null) {
    return decodeIso8601Duration(mpdDuration);
  }

  const lastSegmentEnd =
    switchingSets[0]?.tracks[0]?.segments.at(-1)?.end;
  assertNotVoid(
    lastSegmentEnd,
    "Cannot resolve presentation end",
  );
  return lastSegmentEnd;
}

function parseSwitchingSet(
  sourceUrl: string,
  mpd: MPD,
  period: Period,
  adaptationSet: AdaptationSet,
  type: MediaType,
): SwitchingSet {
  const firstRep = adaptationSet.Representation[0];
  assertNotVoid(firstRep, "No Representation found");

  const codec = findMap(
    [firstRep, adaptationSet],
    (node) => node["@_codecs"]?.toLowerCase(),
  );
  assertNotVoid(codec, "codecs is mandatory");

  const tracks = adaptationSet.Representation.map((rep) =>
    parseTrack(
      sourceUrl,
      mpd,
      period,
      adaptationSet,
      rep,
      type,
    ),
  );

  return { type, codec, tracks };
}

function parseTrack(
  sourceUrl: string,
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
  const baseUrl = resolveUrls([sourceUrl, ...baseUrls]);

  const bandwidth = asNumber(representation["@_bandwidth"]);
  assertNotVoid(bandwidth, "bandwidth is mandatory");

  const segmentData = parseSegmentData(
    mpd,
    period,
    adaptationSet,
    representation,
    baseUrl,
  );

  if (type === MediaType.VIDEO) {
    const width = asNumber(
      findMap([representation, adaptationSet], "@_width"),
    );
    assertNotVoid(width, "width is mandatory");

    const height = asNumber(
      findMap([representation, adaptationSet], "@_height"),
    );
    assertNotVoid(height, "height is mandatory");

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

function inferMediaType(
  adaptationSet: AdaptationSet,
): MediaType | null {
  const contentType = adaptationSet["@_contentType"];
  if (contentType === "video") {
    return MediaType.VIDEO;
  }
  if (contentType === "audio") {
    return MediaType.AUDIO;
  }
  if (contentType === "text") {
    return MediaType.TEXT;
  }
  const mimeType =
    adaptationSet["@_mimeType"] ??
    adaptationSet.Representation[0]?.["@_mimeType"];
  if (mimeType?.startsWith("video/")) {
    return MediaType.VIDEO;
  }
  if (mimeType?.startsWith("audio/")) {
    return MediaType.AUDIO;
  }
  if (
    mimeType?.startsWith("text/") ||
    mimeType?.startsWith("application/")
  ) {
    return MediaType.TEXT;
  }
  return null;
}
```

**Removed functions:** `groupAdaptationSets`, `parseSelectionSet`, `inferContentType`.

**Key change in `parsePeriod`:** Directly maps each AdaptationSet to a SwitchingSet. No grouping step.

**Key change in `parseSwitchingSet`:** Now includes `type` in the returned object.

**Key change in `resolvePresentationEnd`:** Takes `switchingSets` directly instead of `selectionSets`. Last segment fallback navigates `switchingSets[0]?.tracks[0]` instead of `selectionSets[0]?.switchingSets[0]?.tracks[0]`.

- [ ] **Step 3: Type check**

Run: `pnpm tsc 2>&1 | head -20`

Expected: Errors in stream_select.ts and stream_controller.ts only (they still reference `selectionSets`).

- [ ] **Step 4: Commit**

```bash
git add lib/dash/dash_parser.ts lib/types/dash.ts
git commit -m "refactor: simplify DASH parser, drop @group and SelectionSet"
```

---

### Task 4: Rewrite Stream Selection

Replace `selectTrack` with `selectStream` + `resolveTrack`. Inline/remove helper functions. Add `StreamAction` type.

**Files:**
- Modify: `lib/utils/stream_select.ts`

- [ ] **Step 1: Rewrite stream_select.ts**

Replace the full contents of `lib/utils/stream_select.ts`:

```ts
import type {
  Manifest,
  Presentation,
  Stream,
  StreamPreference,
  Track,
} from "../types";
import { MediaType } from "../types";
import { assert, assertNotVoid } from "./assert";

export type StreamAction = "none" | "switch" | "changeType";

export type StreamSelection = {
  stream: Stream;
  action: StreamAction;
};

/**
 * Derive the set of streams available across all
 * presentations. Only streams present in every
 * presentation are included (intersection).
 */
export function getStreams(manifest: Manifest): Stream[] {
  assert(manifest.presentations.length > 0, "No presentations");

  const sets = manifest.presentations.map((presentation) => {
    const streams: Stream[] = [];
    for (const switchingSet of presentation.switchingSets) {
      for (const track of switchingSet.tracks) {
        const stream: Stream =
          track.type === MediaType.VIDEO
            ? {
                type: track.type,
                codec: switchingSet.codec,
                width: track.width,
                height: track.height,
              }
            : { type: track.type, codec: switchingSet.codec };
        if (!streams.some((s) => isSameStream(s, stream))) {
          streams.push(stream);
        }
      }
    }
    return streams;
  });

  const result = sets.reduce((a, b) =>
    a.filter((s) => b.some((t) => isSameStream(s, t))),
  );
  assert(
    result.length > 0,
    "No consistent streams across presentations",
  );
  return result;
}

/**
 * Select the best stream for a media type. Compares to
 * the current stream (if any) to determine the action
 * needed (none, switch, or changeType).
 */
export function selectStream(
  streams: Stream[],
  type: MediaType,
  current?: Stream,
  preference?: StreamPreference,
): StreamSelection {
  const filtered = streams.filter(
    (s): s is Stream & { type: typeof type } => s.type === type,
  );
  assertNotVoid(filtered[0], `No streams for ${type}`);

  let stream: Stream;
  if (!preference) {
    stream = filtered[0];
  } else if (preference.type === MediaType.VIDEO) {
    stream = matchVideoPreference(
      filtered as (Stream & { type: MediaType.VIDEO })[],
      preference,
    );
  } else {
    stream = matchAudioPreference(
      filtered as (Stream & { type: MediaType.AUDIO })[],
      preference,
    );
  }

  if (!current) {
    return { stream, action: "none" };
  }
  if (isSameStream(current, stream)) {
    return { stream, action: "none" };
  }
  if (current.codec !== stream.codec) {
    return { stream, action: "changeType" };
  }
  return { stream, action: "switch" };
}

/**
 * Resolve a stream to a concrete track in a presentation.
 */
export function resolveTrack(
  presentation: Presentation,
  stream: Stream,
): Track {
  for (const switchingSet of presentation.switchingSets) {
    if (
      switchingSet.type !== stream.type ||
      switchingSet.codec !== stream.codec
    ) {
      continue;
    }
    for (const track of switchingSet.tracks) {
      if (isSameStream(stream, trackToStream(track, switchingSet.codec))) {
        return track;
      }
    }
  }

  throw new Error("No track found for stream in presentation");
}

function isSameStream(a: Stream, b: Stream): boolean {
  if (a.type !== b.type || a.codec !== b.codec) {
    return false;
  }
  if (
    a.type === MediaType.VIDEO &&
    b.type === MediaType.VIDEO
  ) {
    return a.width === b.width && a.height === b.height;
  }
  return true;
}

function trackToStream(track: Track, codec: string): Stream {
  if (track.type === MediaType.VIDEO) {
    return {
      type: track.type,
      codec,
      width: track.width,
      height: track.height,
    };
  }
  return { type: track.type, codec };
}

function matchVideoPreference(
  streams: (Stream & { type: MediaType.VIDEO })[],
  preference: {
    type: MediaType.VIDEO;
    codec?: string;
    width?: number;
    height?: number;
  },
): Stream {
  assertNotVoid(
    streams[0],
    "No video streams to match against",
  );
  let best = streams[0];
  let bestDist = Number.POSITIVE_INFINITY;

  for (const stream of streams) {
    let dist = 0;
    if (preference.height !== undefined) {
      dist += Math.abs(stream.height - preference.height);
    }
    if (preference.width !== undefined) {
      dist += Math.abs(stream.width - preference.width);
    }
    if (
      preference.codec !== undefined &&
      stream.codec !== preference.codec
    ) {
      dist += 1_000_000;
    }
    if (dist < bestDist) {
      best = stream;
      bestDist = dist;
    }
  }

  return best;
}

function matchAudioPreference(
  streams: (Stream & { type: MediaType.AUDIO })[],
  preference: { type: MediaType.AUDIO; codec?: string },
): Stream {
  if (preference.codec) {
    const match = streams.find(
      (s) => s.codec === preference.codec,
    );
    if (match) {
      return match;
    }
  }
  assertNotVoid(
    streams[0],
    "No audio streams to match against",
  );
  return streams[0];
}
```

**Removed:** `collectStreams`, `toStream`, `intersect`, `getFirstTrack`, `isTrackMatch`, `selectTrack`, `matchPreference`, `TrackSelection`.

**Added:** `selectStream`, `resolveTrack` (public), `StreamAction`, `StreamSelection`, `trackToStream` (private, used only in `resolveTrack`).

**Note:** `trackToStream` is kept as a small private helper in `resolveTrack` to convert a Track into a Stream for comparison via `isSameStream`. This avoids duplicating the conversion logic inline.

- [ ] **Step 2: Type check**

Run: `pnpm tsc 2>&1 | head -20`

Expected: Errors in stream_controller.ts only — it still imports `selectTrack`.

- [ ] **Step 3: Commit**

```bash
git add lib/utils/stream_select.ts
git commit -m "refactor: split selectTrack into selectStream + resolveTrack"
```

---

### Task 5: Update StreamController

Use new selection functions. Add `stream` to MediaState. Update all three call sites.

**Files:**
- Modify: `lib/controllers/stream_controller.ts`

- [ ] **Step 1: Update imports and MediaState**

Replace imports and MediaState type at the top of `lib/controllers/stream_controller.ts`:

```ts
import type {
  ManifestParsedEvent,
  MediaAttachedEvent,
  StreamPreferenceChangedEvent,
} from "../events";
import { Events } from "../events";
import type { NetworkService } from "../net/network_service";
import type { Player } from "../player";
import type {
  InitSegment,
  Manifest,
  MediaType,
  Presentation,
  Segment,
  Stream,
  StreamPreference,
  Track,
} from "../types";
import type { Request } from "../types/net";
import { ABORTED, RequestType } from "../types/net";
import { binarySearch } from "../utils/array";
import { assertNotVoid } from "../utils/assert";
import { getBufferedEnd } from "../utils/buffer";
import { getContentType } from "../utils/codec";
import {
  getStreams,
  resolveTrack,
  selectStream,
} from "../utils/stream_select";
import { Timer } from "../utils/timer";

const TICK_INTERVAL = 0.1;

type MediaState = {
  type: MediaType;
  stream: Stream;
  ended: boolean;
  presentation: Presentation;
  track: Track;
  lastSegment: Segment | null;
  lastInitSegment: InitSegment | null;
  lastRequest: Request<"arrayBuffer"> | null;
  timer: Timer;
};
```

- [ ] **Step 2: Update tryStart_**

Replace the `tryStart_` method:

```ts
  private tryStart_() {
    if (!this.manifest_ || !this.media_) {
      return;
    }

    const presentation = this.manifest_.presentations[0];
    assertNotVoid(presentation, "No Presentation found");

    const streams = this.getStreams();
    const types = new Set(streams.map((s) => s.type));

    for (const type of types) {
      const preference = this.preferences_.get(type);
      const { stream } = selectStream(
        streams,
        type,
        undefined,
        preference,
      );
      const track = resolveTrack(presentation, stream);

      const mediaState: MediaState = {
        type,
        stream,
        ended: false,
        presentation,
        track,
        lastSegment: null,
        lastInitSegment: null,
        lastRequest: null,
        timer: new Timer(() => this.update_(mediaState)),
      };

      this.mediaStates_.set(type, mediaState);

      this.player_.emit(Events.BUFFER_CODECS, {
        type,
        mimeType: getContentType(type, stream.codec),
      });
    }

    for (const mediaState of this.mediaStates_.values()) {
      mediaState.timer.tickEvery(TICK_INTERVAL);
    }
  }
```

Note: `BUFFER_CODECS` is now emitted per-type inside the loop.

- [ ] **Step 3: Update onStreamPreferenceChanged_**

Replace the `onStreamPreferenceChanged_` method:

```ts
  private onStreamPreferenceChanged_ = (
    event: StreamPreferenceChangedEvent,
  ) => {
    const { preference } = event;
    this.preferences_.set(preference.type, preference);

    const mediaState = this.mediaStates_.get(preference.type);
    if (!mediaState || !this.manifest_) {
      return;
    }

    if (mediaState.lastRequest) {
      this.networkService_.cancel(mediaState.lastRequest);
    }

    const { stream, action } = selectStream(
      this.getStreams(),
      mediaState.type,
      mediaState.stream,
      preference,
    );

    if (action === "none") {
      return;
    }

    if (action === "changeType") {
      this.player_.emit(Events.BUFFER_CODECS, {
        type: mediaState.type,
        mimeType: getContentType(mediaState.type, stream.codec),
      });
    }

    mediaState.stream = stream;
    mediaState.track = resolveTrack(
      mediaState.presentation,
      stream,
    );
    mediaState.lastSegment = null;
    mediaState.lastInitSegment = null;
  };
```

- [ ] **Step 4: Update advanceOrEnd_**

Replace the presentation-crossing block inside `advanceOrEnd_`. Find the block:

```ts
    if (presentation !== mediaState.presentation) {
      mediaState.presentation = presentation;
      const { track } = selectTrack(
        this.getStreams(),
        presentation,
        mediaState.type,
        this.preferences_.get(mediaState.type),
      );
      mediaState.track = track;
      mediaState.lastSegment = null;
      return;
    }
```

Replace with:

```ts
    if (presentation !== mediaState.presentation) {
      mediaState.presentation = presentation;
      mediaState.track = resolveTrack(
        presentation,
        mediaState.stream,
      );
      mediaState.lastSegment = null;
      return;
    }
```

- [ ] **Step 5: Remove unused import of MediaTrack**

The `MediaTrack` import is no longer needed since `tryStart_` no longer builds a `Map<MediaType, MediaTrack>`. Verify it's not used elsewhere in the file and remove it from the import block if unused.

- [ ] **Step 6: Type check**

Run: `pnpm tsc 2>&1 | head -20`

Expected: Errors in buffer_controller.ts and events.ts — the `BufferCodecsEvent` type still expects the old shape.

- [ ] **Step 7: Commit**

```bash
git add lib/controllers/stream_controller.ts
git commit -m "refactor: use selectStream + resolveTrack in StreamController"
```

---

### Task 6: Update BUFFER_CODECS Event and BufferController

Change `BufferCodecsEvent` to per-type. Update BufferController to handle both create and future changeType.

**Files:**
- Modify: `lib/events.ts`
- Modify: `lib/controllers/buffer_controller.ts`

- [ ] **Step 1: Update BufferCodecsEvent in events.ts**

Replace the `BufferCodecsEvent` type:

```ts
export type BufferCodecsEvent = {
  type: MediaType;
  mimeType: string;
};
```

Also remove `MediaTrack` from the imports at the top if it's no longer referenced. Check if any other event type uses it. `MediaTrack` is defined in `types/media.ts`.

- [ ] **Step 2: Update BufferController.onBufferCodecs_**

Replace the `onBufferCodecs_` method in `lib/controllers/buffer_controller.ts`:

```ts
  private onBufferCodecs_ = (event: BufferCodecsEvent) => {
    if (!this.mediaSource_) {
      return;
    }

    const { type, mimeType } = event;

    if (this.sourceBuffers_.has(type)) {
      return;
    }

    const sb = this.mediaSource_.addSourceBuffer(mimeType);
    this.sourceBuffers_.set(type, sb);
    this.opQueue_.add(type, sb);
    sb.addEventListener("updateend", () => {
      this.opQueue_.shiftAndExecuteNext(type);
    });
  };
```

Note: The `if (this.sourceBuffers_.has(type))` guard returns early for now. When changeType is implemented, this will call `sb.changeType(mimeType)` instead of returning.

- [ ] **Step 3: Handle duration separately**

Duration was previously on `BufferCodecsEvent`. It needs to move. The simplest approach: StreamController emits a separate duration update. Add to `tryStart_` in stream_controller.ts, after the per-type BUFFER_CODECS loop:

In `lib/events.ts`, add a new event:

```ts
// Add to Events const
BUFFER_DURATION: "bufferDuration",
```

```ts
// Add event type
export type BufferDurationEvent = {
  duration: number;
};
```

```ts
// Add to EventMap
[Events.BUFFER_DURATION]: (event: BufferDurationEvent) => void;
```

In `lib/controllers/buffer_controller.ts`, add listener:

In the constructor, add:
```ts
this.player_.on(Events.BUFFER_DURATION, this.onBufferDuration_);
```

In destroy, add:
```ts
this.player_.off(Events.BUFFER_DURATION, this.onBufferDuration_);
```

Add handler:
```ts
  private onBufferDuration_ = (event: BufferDurationEvent) => {
    this.duration_ = event.duration;
    this.updateDuration_();
  };
```

In `lib/controllers/stream_controller.ts`, in `tryStart_`, after the per-type loop and before starting timers, add:

```ts
    this.player_.emit(Events.BUFFER_DURATION, {
      duration: this.computeDuration_(),
    });
```

- [ ] **Step 4: Remove unused imports**

In `lib/controllers/buffer_controller.ts`, update imports to include `BufferDurationEvent`:

```ts
import type {
  BufferAppendedEvent,
  BufferAppendingEvent,
  BufferCodecsEvent,
  BufferDurationEvent,
  MediaAttachingEvent,
} from "../events";
```

In `lib/events.ts`, remove `MediaTrack` from the import — `BufferCodecsEvent` no longer uses it and no other event type does.

Also remove `MediaTrack` from `lib/types/media.ts` — after these changes nothing imports it. Remove the type definition entirely.

- [ ] **Step 5: Type check**

Run: `pnpm tsc 2>&1 | head -20`

Expected: Clean — no errors.

- [ ] **Step 6: Format**

Run: `pnpm format`

- [ ] **Step 7: Commit**

```bash
git add lib/events.ts lib/controllers/buffer_controller.ts lib/controllers/stream_controller.ts
git commit -m "refactor: make BUFFER_CODECS per-type, extract BUFFER_DURATION"
```

---

### Task 7: Update Documentation

Update MANIFEST.md, DESIGN.md to reflect the new model.

**Files:**
- Modify: `docs/MANIFEST.md`
- Modify: `docs/DESIGN.md`

- [ ] **Step 1: Update MANIFEST.md**

Replace the full contents of `docs/MANIFEST.md`:

```markdown
# Manifest Model

Format-agnostic internal representation. Any parser (DASH
today) outputs this structure. Type definitions live in
[lib/types/manifest.ts](../lib/types/manifest.ts).

## Hierarchy

```
Manifest
  └── Presentation[]
        └── SwitchingSet[]
              └── Track[]
                    └── Segment[]
```

- **Presentation** — time-bounded content period.
- **SwitchingSet** — CMAF switching set. Tracks with same
  type and codec, seamlessly switchable. Maps 1:1 to an
  MSE SourceBuffer.
- **Track** — single quality level. Discriminated union on
  `MediaType` — video carries `width`/`height`, audio has
  no additional properties yet.
- **Segment** — addressable media chunk with timing on the
  presentation timeline.

## Stable References

Manifest objects are mutable with stable references.
Controllers hold direct references and use them as map keys.
For live, manifest refreshes will update objects in place
rather than replacing the tree.

## DASH Mapping

| DASH | Internal |
|------|----------|
| MPD | Manifest |
| Period | Presentation |
| AdaptationSet | SwitchingSet |
| Representation | Track |
| SegmentTemplate + Timeline | Segment[] + InitSegment |

Segment times are resolved to the presentation timeline at
parse time. URLs are fully resolved. Presentation end uses
the DASH fallback chain: `@duration` → next `@start` →
`@mediaPresentationDuration` → last segment end.
```

- [ ] **Step 2: Update DESIGN.md event flow**

In `docs/DESIGN.md`, replace the "Load & Playback (VOD)" event flow section:

```markdown
### Load & Playback (VOD)

```
player.load(url)
  → MANIFEST_LOADING
  → ManifestController fetches + parses
  → MANIFEST_PARSED

Both MEDIA_ATTACHED and MANIFEST_PARSED received:
  → StreamController selects streams
  → BUFFER_CODECS (per type)
  → BufferController creates SourceBuffers
  → BUFFER_DURATION
  → StreamController tick loop starts
  → BUFFER_APPENDING (init, then media segments)
  → BUFFER_APPENDED
  → ... repeats until done ...
  → BUFFER_EOS → endOfStream()
```
```

- [ ] **Step 3: Commit**

```bash
git add docs/MANIFEST.md docs/DESIGN.md
git commit -m "docs: update MANIFEST.md and DESIGN.md for new model"
```

---

### Task 8: Final Verification

- [ ] **Step 1: Type check**

Run: `pnpm tsc`

Expected: Clean — no errors.

- [ ] **Step 2: Format and lint**

Run: `pnpm format`

Expected: No issues, or auto-fixed.

- [ ] **Step 3: Build**

Run: `pnpm build`

Expected: Successful build.

- [ ] **Step 4: Run dev server**

Run: `pnpm dev`

Verify the example app loads and plays video without errors. Check browser console for any runtime errors.

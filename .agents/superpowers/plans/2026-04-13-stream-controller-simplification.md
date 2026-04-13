# Stream Controller Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse `StreamController`'s parallel `(stream, switchingSet, track)` tracking and the redundant `resolveHierarchy` walk into a single `hierarchy` property on `Stream`, so the controller operates solely in terms of `Stream`; change public `getStreams()` to `getStreams(type: MediaType)`.

**Architecture:** `Stream` gains a `hierarchy: StreamHierarchy` back-reference to the manifest's own `SwitchingSet` and `Track` objects (reference-equal, no copies). `buildStreams(manifest)` replaces `getStreams`, producing a `Map<MediaType, Stream[]>` populated once at `MANIFEST_PARSED`. `resolveHierarchy` is deleted. `MediaState` holds only `stream` as its selection field; track/switchingSet access goes through `mediaState.stream.hierarchy`. Reference-equality is preserved for MSE `changeType` detection.

**Tech Stack:** TypeScript, Vitest (happy-dom), pnpm workspaces, Biome.

**Spec:** [.agents/superpowers/2026-04-13-stream-controller-simplification-design.md](../2026-04-13-stream-controller-simplification-design.md)

---

## File Map

| Action | File | Responsibility |
|---|---|---|
| Modify | `packages/cmaf-lite/lib/types/media.ts` | Add `StreamHierarchy`; add `hierarchy` field to `Stream` |
| Modify | `packages/cmaf-lite/lib/utils/stream_utils.ts` | Rename `getStreams` → `buildStreams` returning `Map<MediaType, Stream[]>`; populate `hierarchy`; delete `resolveHierarchy`; remove internal filter in `selectStream` |
| Modify | `packages/cmaf-lite/test/utils/stream_utils.test.ts` | Rename describe block; update assertions for `Map` return shape; delete `resolveHierarchy` tests; add `hierarchy` identity assertions |
| Modify | `packages/cmaf-lite/lib/media/stream_controller.ts` | Drop `manifest_`; `streams_: Map<MediaType, Stream[]>`; shrink `MediaState`; access via `stream.hierarchy`; `getStreams(type)` signature change |
| Modify | `packages/cmaf-lite/lib/player.ts` | `getStreams(type: MediaType)` signature change |

---

## Task 1: Update types (`media.ts`)

**Files:**
- Modify: `packages/cmaf-lite/lib/types/media.ts`

- [ ] **Step 1: Add `StreamHierarchy` type and `hierarchy` field on `Stream`**

Edit `packages/cmaf-lite/lib/types/media.ts`. After the `MediaType` / `SourceBufferMediaType` block (before the `Stream` declaration), add imports for `SwitchingSet` and `Track`, and define `StreamHierarchy`:

```ts
import type { OptionalExcept } from "./helpers";
import type { SwitchingSet, Track } from "./manifest";

/**
 * Supported media types.
 *
 * @public
 */
export enum MediaType {
  VIDEO = "video",
  AUDIO = "audio",
  TEXT = "text",
}

/**
 * Media types backed by a SourceBuffer.
 */
export type SourceBufferMediaType = MediaType.VIDEO | MediaType.AUDIO;

/**
 * Reference into the manifest that a {@link Stream} is a view of.
 * `switchingSet` and `track` are the exact manifest objects — not
 * copies — so reference equality can be used to detect a switching-set
 * change (which drives MSE `changeType`).
 *
 * @public
 */
export type StreamHierarchy = {
  switchingSet: SwitchingSet;
  track: Track;
};
```

Then update `Stream` to include `hierarchy`:

```ts
/**
 * Set of compatible, switchable tracks sharing a codec
 * and media type. Discriminated by {@link MediaType}.
 *
 * @public
 */
export type Stream = {
  /** Normalized codec */
  codec: string;
  /** Bandwidth */
  bandwidth: number;
  /** Manifest entry this stream is a view of. */
  hierarchy: StreamHierarchy;
} & (
  | {
      /** Video type */
      type: MediaType.VIDEO;
      /** Video width */
      width: number;
      /** Video height */
      height: number;
    }
  | {
      /** Audio type */
      type: MediaType.AUDIO;
    }
  | {
      /** Text type. No additional fields today; text streams are part
       * of the stream model but not yet wired through the stream
       * controller. */
      type: MediaType.TEXT;
    }
);
```

`StreamPreference` remains `OptionalExcept<Stream, "type">` — `hierarchy` becomes optional on preference, which is harmless (preference matchers never read it).

- [ ] **Step 2: Type-check**

Run: `pnpm tsc`
Expected: failures inside `stream_utils.ts` (doesn't yet populate `hierarchy`) and `stream_controller.ts` (still references removed `resolveHierarchy` flow via `MediaState.switchingSet`/`track` patterns). These are addressed in Tasks 2 and 3.

Do **not** commit yet — the tree is temporarily broken until Task 2 lands.

---

## Task 2: Refactor `stream_utils.ts` and its tests

**Files:**
- Modify: `packages/cmaf-lite/lib/utils/stream_utils.ts`
- Modify: `packages/cmaf-lite/test/utils/stream_utils.test.ts`

- [ ] **Step 1: Update tests first**

Edit `packages/cmaf-lite/test/utils/stream_utils.test.ts`. Replace the entire file with:

```ts
import { describe, expect, it } from "vitest";
import { MediaType } from "../../lib/types/media";
import { buildStreams, selectStream } from "../../lib/utils/stream_utils";
import {
  createAudioTrack,
  createManifest,
  createSwitchingSet,
  createVideoTrack,
} from "../__framework__/factories";

describe("StreamUtils", () => {
  describe("buildStreams", () => {
    it("extracts one stream per unique type and resolution", () => {
      const manifest = createManifest();
      const streams = buildStreams(manifest);
      expect(streams.get(MediaType.VIDEO)).toHaveLength(1);
      expect(streams.get(MediaType.AUDIO)).toHaveLength(1);
    });

    it("wires hierarchy to the manifest's own switching set and track", () => {
      const manifest = createManifest();
      const streams = buildStreams(manifest);
      const videoStream = streams.get(MediaType.VIDEO)![0]!;
      const expectedSwitchingSet = manifest.switchingSets.find(
        (ss) => ss.type === MediaType.VIDEO,
      )!;
      const expectedTrack = expectedSwitchingSet.tracks[0]!;
      expect(videoStream.hierarchy.switchingSet).toBe(expectedSwitchingSet);
      expect(videoStream.hierarchy.track).toBe(expectedTrack);
    });

    it("deduplicates streams with identical type, codec, and resolution", () => {
      const track = createVideoTrack();
      const manifest = createManifest({
        switchingSets: [createSwitchingSet({ tracks: [track, track] })],
      });
      const streams = buildStreams(manifest);
      expect(streams.get(MediaType.VIDEO)).toHaveLength(1);
    });

    it("throws when manifest has no switching sets", () => {
      const manifest = createManifest({ switchingSets: [] });
      expect(() => buildStreams(manifest)).toThrow("No streams found");
    });

    it("produces separate streams for tracks with different resolutions", () => {
      const manifest = createManifest({
        switchingSets: [
          createSwitchingSet({
            tracks: [
              createVideoTrack({ width: 1920, height: 1080 }),
              createVideoTrack({ width: 1280, height: 720 }),
            ],
          }),
        ],
      });
      const streams = buildStreams(manifest);
      expect(streams.get(MediaType.VIDEO)).toHaveLength(2);
    });
  });

  describe("selectStream", () => {
    const manifest = createManifest({
      switchingSets: [
        createSwitchingSet({
          tracks: [
            createVideoTrack({ width: 1920, height: 1080 }),
            createVideoTrack({ width: 1280, height: 720 }),
          ],
        }),
        createSwitchingSet({
          type: MediaType.AUDIO,
          codec: "mp4a.40.2",
          tracks: [createAudioTrack()],
        }),
      ],
    });
    const streamsByType = buildStreams(manifest);
    const videoStreams = streamsByType.get(MediaType.VIDEO)!;
    const audioStreams = streamsByType.get(MediaType.AUDIO)!;

    it("selects the video stream closest to preferred height", () => {
      const stream = selectStream(videoStreams, {
        type: MediaType.VIDEO,
        height: 700,
      });
      expect(stream.type).toBe(MediaType.VIDEO);
      if (stream.type === MediaType.VIDEO) {
        expect(stream.height).toBe(720);
      }
    });

    it("selects an audio stream matching the preferred codec", () => {
      const stream = selectStream(audioStreams, {
        type: MediaType.AUDIO,
        codec: "aac",
      });
      expect(stream.type).toBe(MediaType.AUDIO);
      expect(stream.codec).toBe("aac");
    });

    it("penalizes codec mismatch when selecting video streams", () => {
      const multiCodecStreams = buildStreams(
        createManifest({
          switchingSets: [
            createSwitchingSet({
              codec: "avc1.64001f",
              tracks: [createVideoTrack({ width: 1920, height: 1080 })],
            }),
            createSwitchingSet({
              codec: "hev1.1.6.L93",
              tracks: [createVideoTrack({ width: 1920, height: 1080 })],
            }),
          ],
        }),
      ).get(MediaType.VIDEO)!;
      const stream = selectStream(multiCodecStreams, {
        type: MediaType.VIDEO,
        codec: "hevc",
      });
      expect(stream.codec).toBe("hevc");
    });

    it("selects video stream closest to preferred width", () => {
      const stream = selectStream(videoStreams, {
        type: MediaType.VIDEO,
        width: 1300,
      });
      expect(stream.type).toBe(MediaType.VIDEO);
      if (stream.type === MediaType.VIDEO) {
        expect(stream.width).toBe(1280);
      }
    });

    it("falls back to the first audio stream when preferred codec is unavailable", () => {
      const stream = selectStream(audioStreams, {
        type: MediaType.AUDIO,
        codec: "nonexistent",
      });
      expect(stream.type).toBe(MediaType.AUDIO);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter cmaf-lite test -- stream_utils`
Expected: FAIL — `buildStreams` does not exist yet (still exported as `getStreams`).

- [ ] **Step 3: Rewrite `stream_utils.ts`**

Replace the entire contents of `packages/cmaf-lite/lib/utils/stream_utils.ts` with:

```ts
import type { Manifest, SwitchingSet, Track } from "../types/manifest";
import type { ByType, Stream, StreamPreference } from "../types/media";
import { MediaType } from "../types/media";
import * as asserts from "./asserts";
import * as CodecUtils from "./codec_utils";

/**
 * Walk the manifest once and produce per-type lists of `Stream`,
 * each carrying a `hierarchy` back-reference to the manifest's own
 * `SwitchingSet` and `Track` objects.
 */
export function buildStreams(manifest: Manifest): Map<MediaType, Stream[]> {
  const result = new Map<MediaType, Stream[]>();
  for (const ss of manifest.switchingSets) {
    for (const track of ss.tracks) {
      const stream = projectStream(ss, track);
      const list = result.get(stream.type);
      if (!list) {
        result.set(stream.type, [stream]);
        continue;
      }
      if (!list.some((s) => isSameStream(s, stream))) {
        list.push(stream);
      }
    }
  }
  asserts.assert(result.size > 0, "No streams found");
  return result;
}

/**
 * Select the best stream from a pre-filtered per-type list.
 */
export function selectStream(
  streams: Stream[],
  preference: StreamPreference,
): Stream {
  asserts.assertExists(streams[0], `No streams for ${preference.type}`);

  if (preference.type === MediaType.VIDEO) {
    return matchVideoPreference(
      streams as ByType<Stream, MediaType.VIDEO>[],
      preference,
    );
  }
  if (preference.type === MediaType.AUDIO) {
    return matchAudioPreference(
      streams as ByType<Stream, MediaType.AUDIO>[],
      preference,
    );
  }

  throw new Error("Could not lookup preference type");
}

function projectStream(ss: SwitchingSet, track: Track): Stream {
  const codec = CodecUtils.getNormalizedCodec(ss.codec);
  const hierarchy = { switchingSet: ss, track };
  if (track.type === MediaType.VIDEO) {
    return {
      type: track.type,
      codec,
      bandwidth: track.bandwidth,
      width: track.width,
      height: track.height,
      hierarchy,
    };
  }
  return {
    type: track.type,
    codec,
    bandwidth: track.bandwidth,
    hierarchy,
  };
}

function isSameStream(a: Stream, b: Stream): boolean {
  if (a.type !== b.type || a.codec !== b.codec) {
    return false;
  }
  if (a.type === MediaType.VIDEO && b.type === MediaType.VIDEO) {
    return a.width === b.width && a.height === b.height;
  }
  return true;
}

function matchVideoPreference(
  streams: ByType<Stream, MediaType.VIDEO>[],
  preference: ByType<StreamPreference, MediaType.VIDEO>,
): ByType<Stream, MediaType.VIDEO> {
  asserts.assertExists(streams[0], "No video streams to match against");
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
    if (preference.bandwidth !== undefined) {
      dist += Math.abs(stream.bandwidth - preference.bandwidth);
    }
    if (preference.codec !== undefined && stream.codec !== preference.codec) {
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
  streams: ByType<Stream, MediaType.AUDIO>[],
  preference: ByType<StreamPreference, MediaType.AUDIO>,
): ByType<Stream, MediaType.AUDIO> {
  asserts.assertExists(streams[0], "No video streams to match against");
  let best = streams[0];
  let bestDist = Number.POSITIVE_INFINITY;

  for (const stream of streams) {
    let dist = 0;
    if (preference.bandwidth !== undefined) {
      dist += Math.abs(stream.bandwidth - preference.bandwidth);
    }
    if (preference.codec !== undefined && stream.codec !== preference.codec) {
      dist += 1_000_000;
    }
    if (dist < bestDist) {
      best = stream;
      bestDist = dist;
    }
  }

  return best;
}
```

Key differences from the previous version:
- `getStreams` → `buildStreams`, returns `Map<MediaType, Stream[]>`.
- Extracted `projectStream` helper to populate `hierarchy` alongside the projected fields (replaces the inline builder and the manifest-walk in the old `resolveHierarchy`).
- `selectStream` no longer filters by type — callers pass the per-type list.
- `resolveHierarchy` deleted (no export).
- `matchVideoPreference` / `matchAudioPreference` return narrowed types (`ByType<Stream, MediaType.VIDEO>` / `ByType<Stream, MediaType.AUDIO>`) rather than the broader `Stream`.

- [ ] **Step 4: Run utils tests to verify they pass**

Run: `pnpm --filter cmaf-lite test -- stream_utils`
Expected: PASS — all `buildStreams` and `selectStream` tests green.

- [ ] **Step 5: Type-check**

Run: `pnpm tsc`
Expected: still failing inside `stream_controller.ts` and `player.ts` (downstream consumers). Utils file and its tests should have no errors.

Do **not** commit yet — consumer updates in Tasks 3 and 4 are needed for a clean commit.

---

## Task 3: Refactor `StreamController`

**Files:**
- Modify: `packages/cmaf-lite/lib/media/stream_controller.ts`

- [ ] **Step 1: Rewrite `stream_controller.ts`**

Replace the entire contents of `packages/cmaf-lite/lib/media/stream_controller.ts` with:

```ts
import type {
  BufferFlushedEvent,
  ManifestParsedEvent,
  MediaAttachedEvent,
  StreamPreferenceChangedEvent,
} from "../events";
import { Events } from "../events";
import type { Player } from "../player";
import type { InitSegment, Segment, Track } from "../types/manifest";
import type { Stream, StreamPreference } from "../types/media";
import { MediaType } from "../types/media";
import type { NetworkRequest } from "../types/net";
import { ABORTED, NetworkRequestType } from "../types/net";
import * as ArrayUtils from "../utils/array_utils";
import * as asserts from "../utils/asserts";
import * as BufferUtils from "../utils/buffer_utils";
import { Log } from "../utils/log";
import * as ManifestUtils from "../utils/manifest_utils";
import * as StreamUtils from "../utils/stream_utils";
import { Timer } from "../utils/timer";

const log = Log.create("StreamController");

const TICK_INTERVAL = 0.1;

type MediaState = {
  type: MediaType;
  stream: Stream;
  lastSegment: Segment | null;
  lastInitSegment: InitSegment | null;
  request: NetworkRequest | null;
  ended: boolean;
  timer: Timer;
};

export class StreamController {
  private streams_: Map<MediaType, Stream[]> | null = null;
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
    this.player_.on(Events.BUFFER_FLUSHED, this.onBufferFlushed_);
  }

  getStreams(type: MediaType) {
    asserts.assertExists(this.streams_, "No Streams");
    const list = this.streams_.get(type);
    asserts.assertExists(list, `No streams for ${type}`);
    return list;
  }

  getActiveStream(type: MediaType) {
    const mediaState = this.mediaStates_.get(type);
    asserts.assertExists(mediaState, `No Media State for ${type}`);
    return mediaState.stream;
  }

  getActiveStreamPreference(type: MediaType) {
    const preference = this.preferences_.get(type);
    asserts.assertExists(preference, `No Preference for ${type}`);
    return preference;
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
    this.player_.off(Events.BUFFER_FLUSHED, this.onBufferFlushed_);
    this.streams_ = null;
    this.mediaStates_.clear();
    this.preferences_.clear();
  }

  private onManifestParsed_ = (event: ManifestParsedEvent) => {
    this.streams_ = StreamUtils.buildStreams(event.manifest);
    this.tryStart_();
  };

  private onMediaAttached_ = (event: MediaAttachedEvent) => {
    this.media_ = event.media;
    this.media_.addEventListener("seeking", this.onSeeking_);
    this.tryStart_();
  };

  private onBufferFlushed_ = (event: BufferFlushedEvent) => {
    const mediaState = this.mediaStates_.get(event.type);
    if (mediaState) {
      mediaState.lastSegment = null;
      mediaState.lastInitSegment = null;
    }
  };

  private onStreamPreferenceChanged_ = (
    event: StreamPreferenceChangedEvent,
  ) => {
    const { preference } = event;
    // We can set preferences before we load.
    this.preferences_.set(preference.type, preference);

    const mediaState = this.mediaStates_.get(preference.type);
    if (!mediaState || !this.streams_) {
      return;
    }

    const streams = this.streams_.get(preference.type);
    if (!streams) {
      return;
    }
    const stream = StreamUtils.selectStream(streams, preference);
    if (stream === mediaState.stream) {
      return;
    }

    const networkService = this.player_.getNetworkService();
    if (mediaState.request) {
      networkService.cancel(mediaState.request);
    }

    // NOTE: the codec-change check MUST run before `mediaState.stream = stream`.
    // Otherwise both sides resolve to the new stream's switching set and the
    // comparison collapses to equality, skipping BUFFER_CODECS / MSE changeType.
    if (
      stream.hierarchy.switchingSet !== mediaState.stream.hierarchy.switchingSet
    ) {
      if (isAV(mediaState.type)) {
        this.player_.emit(Events.BUFFER_CODECS, {
          type: mediaState.type,
          codec: stream.hierarchy.switchingSet.codec,
        });
      } else {
        // TODO(matvp): We shall figure out what to do with types
        // that do not rely on MSE. Such as text.
      }
    }

    log.info("Switched stream", stream);
    mediaState.stream = stream;
    mediaState.lastSegment = null;
    mediaState.lastInitSegment = null;
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
    if (!this.streams_ || !this.media_) {
      return;
    }

    for (const [type, streams] of this.streams_) {
      const preference = this.preferences_.get(type) ?? { type };
      this.preferences_.set(type, preference);
      const stream = StreamUtils.selectStream(streams, preference);

      const mediaState: MediaState = {
        type,
        stream,
        ended: false,
        lastSegment: null,
        lastInitSegment: null,
        request: null,
        timer: new Timer(() => this.update_(mediaState)),
      };
      log.info(`MediaState ${type}`, stream);

      this.mediaStates_.set(type, mediaState);

      this.player_.emit(Events.BUFFER_CODECS, {
        type,
        codec: stream.hierarchy.switchingSet.codec,
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

    let segment = this.getNextSegment_(mediaState);
    if (!segment) {
      const { maxSegmentLookupTolerance } = this.player_.getConfig();
      const lookupTime =
        bufferEnd ?? Math.max(0, currentTime - maxSegmentLookupTolerance);
      segment = this.getSegmentForTime_(
        mediaState.stream.hierarchy.track,
        lookupTime,
        maxSegmentLookupTolerance,
      );
      log.debug(`Segment by time at ${lookupTime}`, segment);
    } else {
      log.debug(`Segment by index`, segment);
    }

    if (!segment) {
      mediaState.ended = true;
      this.checkEndOfStream_();
      return;
    }

    if (segment.initSegment !== mediaState.lastInitSegment) {
      this.loadSegment_(mediaState, segment.initSegment);
    } else {
      this.loadSegment_(mediaState, segment);
    }
  }

  /**
   * Fetch an init or media segment and emit
   * BUFFER_APPENDING. State is updated only after
   * the fetch resolves.
   */
  private async loadSegment_(
    mediaState: MediaState,
    segment: Segment | InitSegment,
  ) {
    const networkService = this.player_.getNetworkService();
    mediaState.request = networkService.request(
      NetworkRequestType.SEGMENT,
      segment.url,
    );

    const response = await mediaState.request.promise;
    if (response === ABORTED) {
      return;
    }

    // Update mediaState AFTER we fetched, it means that we
    // sent this segment to the buffer controller.
    if (ManifestUtils.isInitSegment(segment)) {
      mediaState.lastInitSegment = segment;
    }
    if (ManifestUtils.isMediaSegment(segment)) {
      mediaState.lastSegment = segment;
    }

    if (isAV(mediaState.type)) {
      // If audio or video, we can send it to the buffer controller.
      this.player_.emit(Events.BUFFER_APPENDING, {
        type: mediaState.type,
        segment,
        data: response.arrayBuffer,
      });
    }
  }

  private getBufferEnd_(type: MediaType, time: number): number | null {
    const { maxBufferHole } = this.player_.getConfig();
    const buffered = this.player_.getBuffered(type);
    return BufferUtils.getBufferedEnd(buffered, time, maxBufferHole);
  }

  private getNextSegment_(mediaState: MediaState): Segment | null {
    if (!mediaState.lastSegment) {
      return null;
    }
    const { segments } = mediaState.stream.hierarchy.track;
    const lastIndex = segments.indexOf(mediaState.lastSegment);
    return segments[lastIndex + 1] ?? null;
  }

  /**
   * Binary search for the segment containing the given
   * time.
   */
  private getSegmentForTime_(
    track: Track,
    time: number,
    maxTolerance: number,
  ): Segment | null {
    return ArrayUtils.binarySearch(track.segments, (seg) => {
      if (time >= seg.start && time < seg.end) {
        return 0;
      }
      if (time < seg.start) {
        const tolerance = Math.min(maxTolerance, seg.end - seg.start);
        if (seg.start - tolerance > time && seg.start > 0) {
          return -1;
        }
        return 0;
      }
      return 1;
    });
  }

  private checkEndOfStream_() {
    const allDone = [...this.mediaStates_.values()].every((ms) => ms.ended);
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

function isAV(type: MediaType) {
  return type === MediaType.AUDIO || type === MediaType.VIDEO;
}
```

Key differences from the previous version:
- `manifest_` field removed.
- `streams_` is now `Map<MediaType, Stream[]> | null`.
- `MediaState` lost `switchingSet` and `track` fields.
- `getStreams()` → `getStreams(type: MediaType)`.
- `onStreamPreferenceChanged_` uses `stream.hierarchy.switchingSet` on both sides of the codec-change check; comment documents the ordering requirement.
- `tryStart_` iterates `this.streams_` entries; no `Set` allocation; no `resolveHierarchy`.
- Segment/track access everywhere goes through `mediaState.stream.hierarchy.track`.
- `SwitchingSet` import removed; only `Track` (for `getSegmentForTime_` param) and `InitSegment`/`Segment` remain from manifest types.

- [ ] **Step 2: Type-check**

Run: `pnpm tsc`
Expected: still failing in `player.ts` (call to `this.streamController_.getStreams()` without an argument). Controller file itself should be error-free.

Do **not** commit yet — `Player` update in Task 4 is needed for a consistent commit.

---

## Task 4: Update `Player.getStreams` signature

**Files:**
- Modify: `packages/cmaf-lite/lib/player.ts`

- [ ] **Step 1: Update `Player.getStreams`**

Open `packages/cmaf-lite/lib/player.ts`. Locate `getStreams()` near line 95:

```ts
getStreams() {
  return this.streamController_.getStreams();
}
```

Replace with:

```ts
getStreams(type: MediaType) {
  return this.streamController_.getStreams(type);
}
```

`MediaType` is already imported in `player.ts` — if not, add:

```ts
import { MediaType } from "./types/media";
```

(Verify by reading the existing imports before editing.)

- [ ] **Step 2: Type-check**

Run: `pnpm tsc`
Expected: PASS inside `packages/cmaf-lite`. The demo package will fail; see Task 6.

- [ ] **Step 3: Run full cmaf-lite test suite**

Run: `pnpm --filter cmaf-lite test`
Expected: PASS — all existing tests (utils, media, dash, manifest, etc.) green.

- [ ] **Step 4: Run format/lint**

Run: `pnpm --filter cmaf-lite format`
Expected: no changes, or auto-formatting applied. Inspect any changes with `git diff`.

- [ ] **Step 5: Commit the refactor**

```bash
git add packages/cmaf-lite/lib/types/media.ts \
        packages/cmaf-lite/lib/utils/stream_utils.ts \
        packages/cmaf-lite/test/utils/stream_utils.test.ts \
        packages/cmaf-lite/lib/media/stream_controller.ts \
        packages/cmaf-lite/lib/player.ts
git commit -m "$(cat <<'EOF'
refactor: collapse stream controller state onto Stream.hierarchy

- Add StreamHierarchy back-reference on Stream pointing to the
  manifest's own SwitchingSet and Track objects.
- Replace getStreams utility with buildStreams returning a
  Map<MediaType, Stream[]>; walk the manifest once and wire
  hierarchy during projection.
- Delete resolveHierarchy; the manifest is no longer walked twice.
- Drop StreamController.manifest_; MediaState loses switchingSet
  and track fields (accessed via stream.hierarchy).
- Player.getStreams gains a required type: MediaType argument.
EOF
)"
```

---

## Task 5: Update consumers in the demo

**Files:**
- Modify: `packages/demo/src/components/stream-list/StreamList.tsx`
- Modify: any other demo files that call `player.getStreams()`

> **Note:** The user indicated they will handle demo/UI impact themselves. This task is included for completeness but may be skipped if the user wants to take it over. If executing, follow the steps below; otherwise stop after Task 4 and hand off.

- [ ] **Step 1: Find demo consumers**

Run: `grep -rn "player.getStreams" packages/demo/src`
Expected: one or more matches in `StreamList.tsx` (and possibly others).

- [ ] **Step 2: Update call sites**

For each call site, change `player.getStreams()` to call with an explicit `type: MediaType` argument. Consumers that previously iterated a flat list and grouped by type themselves can now make two calls — one per type — and concatenate, or restructure their component hierarchy to branch per type.

The specific demo shape is out of scope for this refactor; adjust to match the existing UI's needs. If the UI previously rendered a flat list of all streams, the minimum change is:

```ts
const streams = [
  ...player.getStreams(MediaType.VIDEO),
  ...player.getStreams(MediaType.AUDIO),
];
```

- [ ] **Step 3: Type-check demo**

Run: `pnpm tsc`
Expected: PASS across the workspace.

- [ ] **Step 4: Manual smoke**

Run: `pnpm dev`
Expected: demo loads a stream. Verify:
- Stream list renders with both video and audio entries.
- Clicking a different stream triggers a switch.
- If the switch crosses switching sets (different codec), playback continues across the MSE `changeType` — no stall, no error in console.

- [ ] **Step 5: Commit**

```bash
git add packages/demo/src
git commit -m "$(cat <<'EOF'
refactor(demo): update getStreams callers for per-type API

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Final verification

**Files:** none

- [ ] **Step 1: Full workspace type check**

Run: `pnpm tsc`
Expected: PASS.

- [ ] **Step 2: Full workspace test**

Run: `pnpm test`
Expected: PASS.

- [ ] **Step 3: Full workspace format/lint**

Run: `pnpm format`
Expected: no changes, or auto-formatted changes inspected and acceptable.

- [ ] **Step 4: Full workspace build**

Run: `pnpm build`
Expected: PASS.

- [ ] **Step 5: Log verification result**

Confirm the branch `refactor/stream-controller-simplification` is ready for review. The only changes outside the spec/plan files should be in `packages/cmaf-lite/lib/` (types, utils, media), `packages/cmaf-lite/test/utils/stream_utils.test.ts`, and `packages/demo/src/` (if Task 5 was executed).

---

## Regression Checklist (for reviewer)

- [ ] `stream.hierarchy.switchingSet` and `stream.hierarchy.track` are reference-equal to `manifest.switchingSets[i]` / `manifest.switchingSets[i].tracks[j]` (not copies). Verified by `buildStreams` test in Task 2.
- [ ] Codec-change check in `onStreamPreferenceChanged_` compares old vs. new switching set **before** assigning `mediaState.stream = stream`. Comment in `stream_controller.ts` documents this.
- [ ] `this.manifest_` is not retained after `onManifestParsed_`. No `manifest_` field on the controller.
- [ ] `resolveHierarchy` export is gone from `stream_utils.ts`. Its tests are deleted.
- [ ] `MediaState` has no `switchingSet` or `track` fields.
- [ ] `Player.getStreams(type)` requires a type argument.
- [ ] Manifest is walked exactly once, in `buildStreams`, for the lifetime of a manifest.

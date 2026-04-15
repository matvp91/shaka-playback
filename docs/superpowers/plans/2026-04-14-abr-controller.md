# ABR Controller Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a rule-based ABR controller to cmaf-lite that automatically
manages video quality based on throughput, buffer level, and device
capability.

**Architecture:** Four independent rules (throughput, BOLA, insufficient
buffer, dropped frames) each propose a video stream. The controller takes
the minimum bandwidth — most conservative wins. Throughput estimation via
`@svta/cml-throughput` EwmaEstimator.

**Tech Stack:** TypeScript, Vitest, `@svta/cml-throughput`, `@svta/cml-utils`

---

### Task 1: Install dependencies

**Files:**
- Modify: `packages/cmaf-lite/package.json`

- [ ] **Step 1: Install @svta/cml-throughput**

```bash
cd packages/cmaf-lite && pnpm add @svta/cml-throughput
```

- [ ] **Step 2: Verify installation**

```bash
pnpm ls @svta/cml-throughput --filter cmaf-lite
```

Expected: `@svta/cml-throughput` listed with version.

- [ ] **Step 3: Commit**

```bash
git add packages/cmaf-lite/package.json pnpm-lock.yaml
git commit -m "chore: add @svta/cml-throughput dependency"
```

---

### Task 2: Add maxSegmentDuration to Track type and DASH parser

**Files:**
- Modify: `packages/cmaf-lite/lib/types/manifest.ts`
- Modify: `packages/cmaf-lite/lib/dash/dash_segments.ts`
- Modify: `packages/cmaf-lite/lib/dash/dash_periods.ts`
- Modify: `packages/cmaf-lite/test/__framework__/factories.ts`
- Test: `packages/cmaf-lite/test/dash/dash_parser.test.ts`

- [ ] **Step 1: Write failing test**

In `test/dash/dash_parser.test.ts`, add a test inside the existing
`DashParser` describe block:

```ts
it("computes maxSegmentDuration on each track", () => {
  const result = parse(loadFixture("basic"));
  for (const ss of result.switchingSets) {
    for (const track of ss.tracks) {
      expect(track.maxSegmentDuration).toBe(4);
    }
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/cmaf-lite && pnpm test -- --run -t "computes maxSegmentDuration"
```

Expected: FAIL — `maxSegmentDuration` does not exist on Track.

- [ ] **Step 3: Add maxSegmentDuration to Track type**

In `lib/types/manifest.ts`, add to the shared part of the `Track` union
(inside the base object before the discriminated union):

```ts
export type Track = Prettify<
  {
    /** Bitrate in bits per second. */
    bandwidth: number;
    /** Ordered chunks on the presentation timeline. */
    segments: Segment[];
    /** Longest segment duration in seconds. */
    maxSegmentDuration: number;
  } & (
    | {
        type: MediaType.VIDEO;
        width: number;
        height: number;
      }
    | {
        type: MediaType.AUDIO;
      }
    | {
        type: MediaType.TEXT;
      }
  )
>;
```

- [ ] **Step 4: Compute maxSegmentDuration in DASH parser**

In `lib/dash/dash_segments.ts`, modify `parseSegments` to track
`maxSegmentDuration` as segments are built and return both:

```ts
// Return type changes from Segment[] to:
return { segments, maxSegmentDuration };
```

Track `maxSegmentDuration` inside the existing segment-building loop:

```ts
let maxSegmentDuration = 0;
// ... inside the loop where segments are pushed:
maxSegmentDuration = Math.max(maxSegmentDuration, end - start);
```

In `lib/dash/dash_periods.ts`, in the `parseRepresentation` function,
spread the result from `parseSegments`:

```ts
const segmentData = parseSegments(
  period,
  adaptationSet,
  representation,
  baseUrl,
  bandwidth,
  duration,
);
```

Then spread `segmentData` in each return statement:

```ts
return {
  type: MediaType.VIDEO,
  width,
  height,
  bandwidth,
  ...segmentData,
};
```

```ts
return {
  type: MediaType.AUDIO,
  bandwidth,
  ...segmentData,
};
```

- [ ] **Step 5: Update test factories**

In `test/__framework__/factories.ts`, add `maxSegmentDuration` to both
`createVideoTrack` and `createAudioTrack`:

```ts
export function createVideoTrack(
  overrides?: Partial<Extract<Track, { type: MediaType.VIDEO }>>,
): Extract<Track, { type: MediaType.VIDEO }> {
  return {
    type: MediaType.VIDEO,
    bandwidth: 2_000_000,
    width: 1920,
    height: 1080,
    segments: [createSegment()],
    maxSegmentDuration: 4,
    ...overrides,
  };
}

export function createAudioTrack(
  overrides?: Partial<Extract<Track, { type: MediaType.AUDIO }>>,
): Extract<Track, { type: MediaType.AUDIO }> {
  return {
    type: MediaType.AUDIO,
    bandwidth: 128_000,
    segments: [createSegment()],
    maxSegmentDuration: 4,
    ...overrides,
  };
}
```

- [ ] **Step 6: Run tests to verify all pass**

```bash
cd packages/cmaf-lite && pnpm test
```

Expected: All tests pass, including the new one.

- [ ] **Step 7: Commit**

```bash
git add packages/cmaf-lite/lib/types/manifest.ts \
  packages/cmaf-lite/lib/dash/dash_segments.ts \
  packages/cmaf-lite/lib/dash/dash_periods.ts \
  packages/cmaf-lite/test/__framework__/factories.ts \
  packages/cmaf-lite/test/dash/dash_parser.test.ts
git commit -m "feat: add maxSegmentDuration to Track type"
```

---

### Task 3: Sort streams by bandwidth in buildStreams

**Files:**
- Modify: `packages/cmaf-lite/lib/utils/stream_utils.ts`
- Test: `packages/cmaf-lite/test/utils/stream_utils.test.ts`

- [ ] **Step 1: Write failing test**

In `test/utils/stream_utils.test.ts`, add inside the `buildStreams` describe
block:

```ts
it("sorts streams by bandwidth ascending for ABR", () => {
  const manifest = createManifest({
    switchingSets: [
      createSwitchingSet({
        tracks: [
          createVideoTrack({ bandwidth: 5_000_000, width: 1920, height: 1080 }),
          createVideoTrack({ bandwidth: 1_000_000, width: 640, height: 360 }),
          createVideoTrack({ bandwidth: 3_000_000, width: 1280, height: 720 }),
        ],
      }),
    ],
  });
  const streams = buildStreams(manifest);
  const video = streams.get(MediaType.VIDEO)!;
  const bandwidths = video.map((s) => s.bandwidth);
  expect(bandwidths).toEqual([1_000_000, 3_000_000, 5_000_000]);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/cmaf-lite && pnpm test -- --run -t "sorts streams by bandwidth"
```

Expected: FAIL — streams are in manifest order, not sorted.

- [ ] **Step 3: Add sorting to buildStreams**

In `lib/utils/stream_utils.ts`, in the `buildStreams` function, before the
`return result` statement, add:

```ts
// Sorted by bandwidth ascending — index 0 is lowest quality.
// Required for ABR rules to reason about the quality ladder.
for (const streams of result.values()) {
  streams.sort((a, b) => a.bandwidth - b.bandwidth);
}
```

- [ ] **Step 4: Run tests to verify all pass**

```bash
cd packages/cmaf-lite && pnpm test
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/cmaf-lite/lib/utils/stream_utils.ts \
  packages/cmaf-lite/test/utils/stream_utils.test.ts
git commit -m "feat: sort streams by bandwidth ascending for ABR"
```

---

### Task 4: Add ABR config

**Files:**
- Modify: `packages/cmaf-lite/lib/config.ts`

- [ ] **Step 1: Add AbrConfig type and defaults**

In `lib/config.ts`, add the ABR config to `PlayerConfig` and
`DEFAULT_CONFIG`:

```ts
export type AbrConfig = {
  /** Initial bandwidth estimate in bits/s before samples. */
  defaultBandwidthEstimate: number;
  /** Upgrade when bandwidth >= this fraction of stream bitrate. */
  bandwidthUpgradeTarget: number;
  /** Downgrade when bandwidth < this fraction of stream bitrate. */
  bandwidthDowngradeTarget: number;
  /** Seconds between ABR evaluations. */
  evaluationInterval: number;
  /** EWMA fast half-life in seconds. */
  fastHalfLife: number;
  /** EWMA slow half-life in seconds. */
  slowHalfLife: number;
  /** Dropped frame ratio threshold for downgrade. */
  droppedFramesThreshold: number;
};
```

Add to `PlayerConfig`:

```ts
export type PlayerConfig = {
  // ... existing fields ...
  /** ABR controller configuration. */
  abr: AbrConfig;
};
```

Add to `DEFAULT_CONFIG`:

```ts
export const DEFAULT_CONFIG: PlayerConfig = {
  // ... existing fields ...
  abr: {
    defaultBandwidthEstimate: 1_000_000,
    bandwidthUpgradeTarget: 0.7,
    bandwidthDowngradeTarget: 0.95,
    evaluationInterval: 8,
    fastHalfLife: 3,
    slowHalfLife: 9,
    droppedFramesThreshold: 0.15,
  },
};
```

- [ ] **Step 2: Run type check**

```bash
cd packages/cmaf-lite && pnpm tsc
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add packages/cmaf-lite/lib/config.ts
git commit -m "feat: add ABR config to PlayerConfig"
```

---

### Task 5: Implement AbrController with inline rules

All four rules live as private methods in `AbrController`. Each receives
`videoStreams` and `currentVideoStream` as parameters, avoiding the need
for per-rule early-exit checks. `evaluate_` guards once that both are
available before invoking the rules.

Note: ABR tests are deferred — validated via the demo app, added
separately after the feature is working.

**Files:**
- Create: `packages/cmaf-lite/lib/abr/abr_controller.ts`
- Modify: `packages/cmaf-lite/lib/index.ts`

- [ ] **Step 1: Implement AbrController**

Create `lib/abr/abr_controller.ts`:

```ts
import { EwmaEstimator } from "@svta/cml-throughput";
import type { Player } from "../player";
import type { Stream } from "../types/media";
import { MediaType } from "../types/media";
import type { NetworkResponseEvent } from "../events";
import type { StreamsUpdatedEvent } from "../events";
import { Events } from "../events";
import { NetworkRequestType } from "../types/net";
import { Timer } from "../utils/timer";
import { getBufferedEnd } from "../utils/buffer_utils";

/**
 * Rule-based ABR controller. Evaluates four rules on a timer and
 * applies the most conservative (lowest bandwidth) result.
 *
 * Rules:
 *   - Throughput   — highest stream fitting measured bandwidth.
 *   - BOLA         — buffer-level utility scoring (paper formulation).
 *   - Insufficient — proportional downshift when buffer is thin.
 *   - DroppedFrames — one step down when decoder can't keep up.
 *
 * @internal
 */
export class AbrController {
  private player_: Player;
  private timer_: Timer;
  private estimator_: EwmaEstimator;

  // Cached on STREAMS_UPDATED — avoids per-tick Map lookup.
  private videoStreams_: Stream[] = [];

  constructor(player: Player) {
    this.player_ = player;
    this.timer_ = new Timer(() => this.evaluate_());

    const { fastHalfLife, slowHalfLife, defaultBandwidthEstimate } =
      player.getConfig().abr;
    this.estimator_ = new EwmaEstimator({
      fastHalfLife,
      slowHalfLife,
      defaultEstimate: defaultBandwidthEstimate,
    });

    this.player_.on(Events.STREAMS_UPDATED, this.onStreamsUpdated_);
    this.player_.on(Events.NETWORK_RESPONSE, this.onNetworkResponse_);
  }

  /**
   * Returns the current throughput estimate in bits/s.
   * The EWMA estimator returns bytes/s, so multiply by 8.
   */
  getThroughputEstimate(): number {
    return this.estimator_.getEstimate() * 8;
  }

  /**
   * Returns the video buffer level ahead of the playhead in seconds.
   * Returns 0 when no media is attached or the playhead is outside
   * buffered ranges.
   */
  getBufferLevel(): number {
    const media = this.player_.getMedia();
    if (!media) {
      return 0;
    }
    const buffered = this.player_.getBuffered(MediaType.VIDEO);
    const { maxBufferHole } = this.player_.getConfig();
    const end = getBufferedEnd(buffered, media.currentTime, maxBufferHole);
    return end ? end - media.currentTime : 0;
  }

  destroy() {
    this.timer_.stop();
    this.player_.off(Events.STREAMS_UPDATED, this.onStreamsUpdated_);
    this.player_.off(Events.NETWORK_RESPONSE, this.onNetworkResponse_);
  }

  // --- Lifecycle ---

  private onStreamsUpdated_ = (event: StreamsUpdatedEvent) => {
    this.videoStreams_ = event.streamsMap.get(MediaType.VIDEO) ?? [];
    this.evaluate_();
    const { evaluationInterval } = this.player_.getConfig().abr;
    this.timer_.tickEvery(evaluationInterval);
  };

  private onNetworkResponse_ = (event: NetworkResponseEvent) => {
    if (event.type !== NetworkRequestType.SEGMENT) {
      return;
    }
    this.estimator_.sample({
      startTime: event.response.startTime,
      duration: event.response.timeElapsed,
      encodedBodySize: event.response.arrayBuffer.byteLength,
    });
  };

  // --- Evaluation ---

  private evaluate_() {
    const videoStreams = this.videoStreams_;
    const currentVideoStream = this.player_.getActiveStream(MediaType.VIDEO);

    // Rules need both streams and a current stream to reason.
    if (!videoStreams.length || !currentVideoStream) {
      return;
    }

    const candidates = [
      this.evaluateThroughput_(videoStreams, currentVideoStream),
      this.evaluateBola_(videoStreams, currentVideoStream),
      this.evaluateInsufficientBuffer_(videoStreams, currentVideoStream),
      this.evaluateDroppedFrames_(videoStreams, currentVideoStream),
    ];

    let best: Stream | null = null;
    for (const candidate of candidates) {
      if (candidate && (!best || candidate.bandwidth < best.bandwidth)) {
        best = candidate;
      }
    }

    if (best && best !== currentVideoStream) {
      this.player_.setStreamPreference({
        type: MediaType.VIDEO,
        bandwidth: best.bandwidth,
      });
    }
  }

  // --- Rules ---

  /** Highest video stream fitting measured throughput, minus audio. */
  private evaluateThroughput_(
    videoStreams: Stream[],
    currentVideoStream: Stream,
  ): Stream | null {
    const { bandwidthUpgradeTarget, bandwidthDowngradeTarget } =
      this.player_.getConfig().abr;
    const audioStream = this.player_.getActiveStream(MediaType.AUDIO);
    const audioBandwidth = audioStream ? audioStream.bandwidth : 0;
    const effectiveBandwidth = this.getThroughputEstimate() - audioBandwidth;

    let best: Stream | null = null;
    for (const stream of videoStreams) {
      const isUpgrade = stream.bandwidth > currentVideoStream.bandwidth;
      const factor = isUpgrade
        ? bandwidthUpgradeTarget
        : bandwidthDowngradeTarget;
      if (stream.bandwidth <= effectiveBandwidth * factor) {
        best = stream;
      }
    }

    return best ?? videoStreams[0] ?? null;
  }

  /**
   * BOLA — buffer-level utility scoring. Abstains during startup.
   * See BOLA paper (arxiv 1601.06748). Utility v_m = ln(S_m / S_1)
   * shifted by +1 so lowest stream has utility 1.
   */
  private evaluateBola_(
    videoStreams: Stream[],
    currentVideoStream: Stream,
  ): Stream | null {
    const MINIMUM_BUFFER_S = 10;

    const lowestStream = videoStreams[0];
    const highestStream = videoStreams[videoStreams.length - 1];
    if (!lowestStream || !highestStream) {
      return null;
    }

    const { maxSegmentDuration } = currentVideoStream.hierarchy.track;
    const { frontBufferLength } = this.player_.getConfig();
    const bufferLevel = this.getBufferLevel();

    if (bufferLevel < maxSegmentDuration) {
      return null;
    }

    const lnS1 = Math.log(lowestStream.bandwidth);
    const vM = Math.log(highestStream.bandwidth) - lnS1 + 1;

    // Q_max: at least front buffer, scaled up by stream count.
    const Qmax = Math.max(
      frontBufferLength,
      MINIMUM_BUFFER_S + 2 * videoStreams.length,
    );

    const gp = (vM - 1) / (Qmax / MINIMUM_BUFFER_S - 1);
    const V = MINIMUM_BUFFER_S / gp;

    let bestIndex = 0;
    let bestScore = -Infinity;
    for (let i = 0; i < videoStreams.length; i++) {
      const stream = videoStreams[i];
      if (!stream) continue;
      const vm = Math.log(stream.bandwidth) - lnS1 + 1;
      // Paper: (V * (v_m + gp) - Q) / S_m with lowest v_m = 0.
      // Our vm is +1 shifted, so subtract 1 to recover paper's v_m.
      const score = (V * (vm - 1 + gp) - bufferLevel) / stream.bandwidth;
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }

    return videoStreams[bestIndex] ?? null;
  }

  /**
   * Proportional downshift based on buffer thinness. Formula:
   * `throughput * safety * (bufferLevel / maxSegmentDuration)`.
   * Abstains during startup.
   */
  private evaluateInsufficientBuffer_(
    videoStreams: Stream[],
    currentVideoStream: Stream,
  ): Stream | null {
    const THROUGHPUT_SAFETY_FACTOR = 0.7;

    const { maxSegmentDuration } = currentVideoStream.hierarchy.track;
    const bufferLevel = this.getBufferLevel();

    if (bufferLevel < maxSegmentDuration) {
      return null;
    }

    const targetBitrate =
      this.getThroughputEstimate() *
      THROUGHPUT_SAFETY_FACTOR *
      (bufferLevel / maxSegmentDuration);

    let best: Stream | null = null;
    for (const stream of videoStreams) {
      if (stream.bandwidth <= targetBitrate) {
        best = stream;
      }
    }

    return best ?? videoStreams[0] ?? null;
  }

  /** Step one quality level down when dropped frame ratio is high. */
  private evaluateDroppedFrames_(
    videoStreams: Stream[],
    currentVideoStream: Stream,
  ): Stream | null {
    const media = this.player_.getMedia() as HTMLVideoElement | null;
    if (!media?.getVideoPlaybackQuality) return null;

    const quality = media.getVideoPlaybackQuality();
    if (quality.totalVideoFrames === 0) return null;

    const ratio = quality.droppedVideoFrames / quality.totalVideoFrames;
    const { droppedFramesThreshold } = this.player_.getConfig().abr;
    if (ratio <= droppedFramesThreshold) return null;

    const currentIndex = videoStreams.indexOf(currentVideoStream);
    const newIndex = Math.max(0, currentIndex - 1);
    return videoStreams[newIndex] ?? null;
  }
}
```

- [ ] **Step 2: Export from index**

In `lib/index.ts`, add:

```ts
export { AbrController } from "./abr/abr_controller";
```

- [ ] **Step 3: Run type check**

```bash
cd packages/cmaf-lite && pnpm tsc
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add packages/cmaf-lite/lib/abr/abr_controller.ts \
  packages/cmaf-lite/lib/index.ts
git commit -m "feat: implement AbrController with inline rules"
```

---

### Task 6: Wire AbrController into Player

**Files:**
- Modify: `packages/cmaf-lite/lib/player.ts`

- [ ] **Step 1: Add AbrController to Player**

In `lib/player.ts`, add the import:

```ts
import { AbrController } from "./abr/abr_controller";
```

Add the private field alongside the other controllers:

```ts
private abrController_: AbrController;
```

In the constructor, after `this.streamController_`:

```ts
this.abrController_ = new AbrController(this);
```

In the `destroy()` method, before `this.removeAllListeners()`:

```ts
this.abrController_.destroy();
```

- [ ] **Step 2: Run type check and tests**

```bash
cd packages/cmaf-lite && pnpm tsc && pnpm test
```

Expected: All pass.

- [ ] **Step 3: Commit**

```bash
git add packages/cmaf-lite/lib/player.ts
git commit -m "feat: wire AbrController into Player"
```

---

### Task 7: Write user-facing ABR documentation

**Files:**
- Create: `packages/cmaf-lite/docs/abr.md`

- [ ] **Step 1: Write ABR documentation**

Create `packages/cmaf-lite/docs/abr.md`:

```md
# Adaptive Bitrate (ABR)

cmaf-lite includes a built-in ABR controller that automatically manages
video quality during playback. It evaluates four independent rules and
picks the most conservative result.

## Rules

### Throughput

Measures download speed using a dual EWMA (Exponential Weighted Moving
Average) estimator. Picks the highest video stream that the network can
sustain, with asymmetric thresholds to resist oscillation — it requires
more headroom to upgrade than to stay at the current quality.

Works best for: stable and moderately variable networks.

### BOLA (Buffer Optimized)

Uses buffer level to score each quality tier. When the buffer is healthy,
it favors higher quality. When the buffer is thin, it picks
conservatively. Activates only after at least one segment duration has
been buffered.

Works best for: fluctuating networks where throughput estimates lag
behind reality.

### Insufficient Buffer

Proportionally reduces quality when the buffer is low but not empty.
Uses the formula `throughput × 0.7 × (bufferLevel / segmentDuration)`
to compute a target bitrate. Abstains during startup.

Works best for: preventing rebuffering during temporary bandwidth dips.

### Dropped Frames

Detects when the device cannot decode the current quality fast enough
by monitoring the browser's dropped frame ratio. Steps down one quality
level when the ratio exceeds the configured threshold.

Works best for: low-powered devices struggling with high resolutions.

## How Rules Combine

All rules run on every evaluation tick. Each proposes a video stream or
abstains. The controller picks the stream with the lowest bandwidth
among all proposals — the most conservative rule always wins.

During startup (before one segment duration is buffered), only the
throughput rule and dropped frames rule are active. This ensures the
initial quality is driven by the configured bandwidth estimate.

## Configuration

All settings live under the `abr` key in the player config:

| Setting | Default | Description |
|---|---|---|
| `defaultBandwidthEstimate` | `1_000_000` | Initial bandwidth estimate in bits/s |
| `bandwidthUpgradeTarget` | `0.7` | Bandwidth fraction required to upgrade |
| `bandwidthDowngradeTarget` | `0.95` | Bandwidth fraction to trigger downgrade |
| `evaluationInterval` | `8` | Seconds between ABR evaluations |
| `fastHalfLife` | `3` | EWMA fast estimator half-life (seconds) |
| `slowHalfLife` | `9` | EWMA slow estimator half-life (seconds) |
| `droppedFramesThreshold` | `0.15` | Dropped frame ratio to trigger downgrade |

## Future Enhancements

The following refinements are intentionally deferred. They are tracked
here so future work can revisit them with full context.

### BOLA placeholder buffer

The original BOLA paper and dash.js maintain a virtual buffer that
compensates for non-download delays (pauses, stalls, seek recovery).
Without it, a user-initiated pause can make BOLA pick a lower quality
when playback resumes because actual throughput samples have grown
stale. A placeholder buffer decays gradually (0.99 per cycle in dash.js)
so BOLA sees a smoothly declining virtual buffer rather than a cliff.

Not implemented because cmaf-lite is VOD-focused and the min-aggregation
with ThroughputRule keeps the overall decision safe even if BOLA's score
is temporarily pessimistic.

### BOLA startup mode

dash.js uses throughput-guided selection inside BOLA during startup
until the buffer reaches one segment duration. Our BolaRule abstains
entirely below that threshold and lets ThroughputRule drive initial
quality.

The simpler approach works because ThroughputRule always runs. If a
future change isolates rules (e.g., strategy switching), BOLA will need
its own startup handling.

### InsufficientBufferRule buffer-empty hard zero

dash.js force-selects the lowest quality when the buffer state is
completely empty, in addition to the proportional formula. We abstain
when the buffer is below one segment duration, so near-zero buffer is
only reachable between evaluations. With a high throughput estimate and
a sudden buffer drop, the proportional formula could pick a non-lowest
stream.

Not implemented because rebuffering is imminent regardless in that
scenario, and shortening the evaluation interval is a simpler mitigation
if it becomes a real problem.

### Per-representation dropped frame history

dash.js tracks dropped frames per quality level and caps below the
lowest bad level (with a 375-frame minimum sample size). Our rule uses
the global ratio from `getVideoPlaybackQuality()` and steps down one
level when it exceeds the threshold.

Not implemented because cmaf-lite does not flush the buffer on ABR
switches, so frames from prior streams continue decoding into the new
stream — we cannot cleanly attribute drops per stream.
```

- [ ] **Step 2: Commit**

```bash
git add packages/cmaf-lite/docs/abr.md
git commit -m "docs: add ABR documentation"
```

---

### Task 8: Final verification

- [ ] **Step 1: Run full test suite**

```bash
cd packages/cmaf-lite && pnpm test
```

Expected: All tests pass.

- [ ] **Step 2: Run type check**

```bash
pnpm tsc
```

Expected: No errors.

- [ ] **Step 3: Run formatter**

```bash
pnpm format
```

Expected: No issues.

- [ ] **Step 4: Run build**

```bash
pnpm build
```

Expected: Build succeeds.

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
      expect(track.maxSegmentDuration).toBeGreaterThan(0);
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

### Task 5: Add AbrRule interface

**Files:**
- Create: `packages/cmaf-lite/lib/types/abr.ts`
- Modify: `packages/cmaf-lite/lib/index.ts`

- [ ] **Step 1: Create types file**

Create `lib/types/abr.ts`:

```ts
import type { Stream } from "./media";

/**
 * ABR rule that proposes a video stream based on its
 * own heuristic. Returns `null` to abstain.
 *
 * @internal
 */
export interface AbrRule {
  getDecision(): Stream | null;
}
```

- [ ] **Step 2: Export from index**

In `lib/index.ts`, add:

```ts
export * from "./types/abr";
```

- [ ] **Step 3: Run type check**

```bash
cd packages/cmaf-lite && pnpm tsc
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add packages/cmaf-lite/lib/types/abr.ts \
  packages/cmaf-lite/lib/index.ts
git commit -m "feat: add AbrRule interface"
```

---

### Task 6: Add test mock helpers

**Files:**
- Create: `packages/cmaf-lite/test/__framework__/player_mock.ts`
- Create: `packages/cmaf-lite/test/__framework__/abr_controller_mock.ts`

- [ ] **Step 1: Create player mock factory**

Create `test/__framework__/player_mock.ts`:

```ts
import { vi } from "vitest";
import type { Player } from "../../lib/player";
import { DEFAULT_CONFIG } from "../../lib/config";
import { createTimeRanges } from "./time_ranges";

/**
 * Minimal Player mock for rule testing. Configure only
 * what the test needs via overrides.
 */
export function createMockPlayer(
  overrides: Record<string, unknown> = {},
) {
  return {
    on: vi.fn(),
    off: vi.fn(),
    getStreams: vi.fn(() => []),
    getActiveStream: vi.fn(() => null),
    getBuffered: vi.fn(() => createTimeRanges()),
    getMedia: vi.fn(() => null),
    getConfig: vi.fn(() => DEFAULT_CONFIG),
    setStreamPreference: vi.fn(),
    ...overrides,
  } as unknown as Player;
}
```

- [ ] **Step 2: Create AbrController mock factory**

Create `test/__framework__/abr_controller_mock.ts`:

```ts
import { vi } from "vitest";
import type { AbrController } from "../../lib/abr/abr_controller";
import { DEFAULT_CONFIG } from "../../lib/config";

/**
 * Minimal AbrController mock for rules that need a
 * controller reference (e.g. InsufficientBufferRule).
 */
export function createMockAbrController(
  overrides: Record<string, unknown> = {},
) {
  return {
    getThroughputEstimate: vi.fn(
      () => DEFAULT_CONFIG.abr.defaultBandwidthEstimate,
    ),
    ...overrides,
  } as unknown as AbrController;
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/cmaf-lite/test/__framework__/player_mock.ts \
  packages/cmaf-lite/test/__framework__/abr_controller_mock.ts
git commit -m "test: add Player and AbrController mock factories"
```

---

### Task 7: Implement ThroughputRule

**Files:**
- Create: `packages/cmaf-lite/lib/abr/rule_throughput.ts`
- Create: `packages/cmaf-lite/test/abr/rule_throughput.test.ts`

- [ ] **Step 1: Write failing tests**

Create `test/abr/rule_throughput.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ThroughputRule } from "../../lib/abr/rule_throughput";
import { MediaType } from "../../lib/types/media";
import { buildStreams } from "../../lib/utils/stream_utils";
import {
  createManifest,
  createSwitchingSet,
  createVideoTrack,
  createAudioTrack,
} from "../__framework__/factories";
import { createMockPlayer } from "../__framework__/player_mock";

function createVideoStreams() {
  const manifest = createManifest({
    switchingSets: [
      createSwitchingSet({
        tracks: [
          createVideoTrack({ bandwidth: 500_000, width: 640, height: 360 }),
          createVideoTrack({ bandwidth: 1_500_000, width: 1280, height: 720 }),
          createVideoTrack({ bandwidth: 3_000_000, width: 1920, height: 1080 }),
        ],
      }),
    ],
  });
  return buildStreams(manifest).get(MediaType.VIDEO)!;
}

describe("ThroughputRule", () => {
  it("selects stream fitting defaultBandwidthEstimate when no samples", () => {
    const streams = createVideoStreams();
    const player = createMockPlayer({
      getStreams: () => streams,
      getActiveStream: (type: MediaType) =>
        type === MediaType.VIDEO ? streams[0] : null,
    });
    const rule = new ThroughputRule(player);

    // 1_000_000 * 0.7 = 700_000 — highest fitting is 500_000
    expect(rule.getDecision()).toBe(streams[0]);
  });

  it("selects highest stream fitting effective bandwidth", () => {
    const streams = createVideoStreams();
    const player = createMockPlayer({
      getStreams: () => streams,
      getActiveStream: (type: MediaType) =>
        type === MediaType.VIDEO ? streams[0] : null,
      getConfig: () => ({
        ...DEFAULT_CONFIG,
        abr: {
          ...DEFAULT_CONFIG.abr,
          defaultBandwidthEstimate: 5_000_000,
        },
      }),
    });
    const rule = new ThroughputRule(player);

    // 5_000_000 * 0.7 = 3_500_000 — highest fitting is 3_000_000
    expect(rule.getDecision()).toBe(streams[2]);
  });

  it("subtracts audio bandwidth from throughput estimate", () => {
    const streams = createVideoStreams();
    const audioManifest = createManifest({
      switchingSets: [
        createSwitchingSet({
          type: MediaType.AUDIO,
          codec: "mp4a.40.2",
          tracks: [createAudioTrack({ bandwidth: 400_000 })],
        }),
      ],
    });
    const audioStreams = buildStreams(audioManifest).get(MediaType.AUDIO);
    const audioStream = audioStreams ? audioStreams[0] ?? null : null;
    const player = createMockPlayer({
      getStreams: () => streams,
      getActiveStream: (type: MediaType) => {
        if (type === MediaType.AUDIO) return audioStream;
        if (type === MediaType.VIDEO) return streams[0];
        return null;
      },
      getConfig: () => ({
        ...DEFAULT_CONFIG,
        abr: {
          ...DEFAULT_CONFIG.abr,
          defaultBandwidthEstimate: 2_000_000,
        },
      }),
    });
    const rule = new ThroughputRule(player);

    // (2_000_000 - 400_000) * 0.7 = 1_120_000 — highest fitting is 500_000
    expect(rule.getDecision()).toBe(streams[0]);
  });

  it("exposes throughput estimate via getEstimate", () => {
    const player = createMockPlayer();
    const rule = new ThroughputRule(player);

    expect(rule.getEstimate()).toBe(1_000_000);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/cmaf-lite && pnpm test -- --run -t "ThroughputRule"
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement ThroughputRule**

Create `lib/abr/rule_throughput.ts`:

```ts
import { EwmaEstimator } from "@svta/cml-throughput";
import type { AbrRule } from "../types/abr";
import type { Stream } from "../types/media";
import { MediaType } from "../types/media";
import type { NetworkResponseEvent } from "../events";
import { Events } from "../events";
import { NetworkRequestType } from "../types/net";
import type { Player } from "../player";

/**
 * Selects the highest video stream that fits within
 * the measured throughput, accounting for audio bandwidth.
 *
 * @internal
 */
export class ThroughputRule implements AbrRule {
  private estimator_: EwmaEstimator;
  private player_: Player;

  constructor(player: Player) {
    this.player_ = player;

    const { fastHalfLife, slowHalfLife, defaultBandwidthEstimate } =
      player.getConfig().abr;
    this.estimator_ = new EwmaEstimator({
      fastHalfLife,
      slowHalfLife,
      defaultEstimate: defaultBandwidthEstimate,
    });

    this.player_.on(Events.NETWORK_RESPONSE, this.onNetworkResponse_);
  }

  /**
   * Returns the current throughput estimate in bits/s.
   * The EWMA estimator returns bytes/s, so we multiply
   * by 8 to convert.
   */
  getEstimate(): number {
    return this.estimator_.getEstimate() * 8;
  }

  getDecision(): Stream | null {
    const streams = this.player_.getStreams(MediaType.VIDEO);
    if (!streams.length) {
      return null;
    }

    const { bandwidthUpgradeTarget, bandwidthDowngradeTarget } =
      this.player_.getConfig().abr;
    const throughput = this.getEstimate();
    const audioStream = this.player_.getActiveStream(MediaType.AUDIO);
    const audioBandwidth = audioStream ? audioStream.bandwidth : 0;
    const effectiveBandwidth = throughput - audioBandwidth;

    const currentStream = this.player_.getActiveStream(MediaType.VIDEO);

    let best: Stream | null = null;
    for (const stream of streams) {
      const factor = ThroughputRule.isUpgrade_(currentStream, stream)
        ? bandwidthUpgradeTarget
        : bandwidthDowngradeTarget;
      if (stream.bandwidth <= effectiveBandwidth * factor) {
        best = stream;
      }
    }

    return best ?? streams[0] ?? null;
  }

  destroy() {
    this.player_.off(Events.NETWORK_RESPONSE, this.onNetworkResponse_);
  }

  private static isUpgrade_(
    current: Stream | null,
    candidate: Stream,
  ): boolean {
    return !current || candidate.bandwidth > current.bandwidth;
  }

  private onNetworkResponse_ = (event: NetworkResponseEvent) => {
    if (event.type !== NetworkRequestType.SEGMENT) {
      return;
    }
    this.estimator_.sample({
      startTime: 0,
      duration: event.response.timeElapsed,
      encodedBodySize: event.response.arrayBuffer.byteLength,
    });
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/cmaf-lite && pnpm test -- --run -t "ThroughputRule"
```

Expected: All ThroughputRule tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/cmaf-lite/lib/abr/rule_throughput.ts \
  packages/cmaf-lite/test/abr/rule_throughput.test.ts
git commit -m "feat: implement ThroughputRule"
```

---

### Task 8: Implement BolaRule

**Files:**
- Create: `packages/cmaf-lite/lib/abr/rule_bola.ts`
- Create: `packages/cmaf-lite/test/abr/rule_bola.test.ts`

- [ ] **Step 1: Write failing tests**

Create `test/abr/rule_bola.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { BolaRule } from "../../lib/abr/rule_bola";
import { MediaType } from "../../lib/types/media";
import { buildStreams } from "../../lib/utils/stream_utils";
import {
  createManifest,
  createSwitchingSet,
  createVideoTrack,
} from "../__framework__/factories";
import { createMockPlayer } from "../__framework__/player_mock";
import { createTimeRanges } from "../__framework__/time_ranges";

function createVideoStreams() {
  const manifest = createManifest({
    switchingSets: [
      createSwitchingSet({
        tracks: [
          createVideoTrack({ bandwidth: 500_000, width: 640, height: 360 }),
          createVideoTrack({ bandwidth: 1_500_000, width: 1280, height: 720 }),
          createVideoTrack({ bandwidth: 3_000_000, width: 1920, height: 1080 }),
        ],
      }),
    ],
  });
  return buildStreams(manifest).get(MediaType.VIDEO)!;
}

describe("BolaRule", () => {
  it("abstains when buffer is below maxSegmentDuration", () => {
    const streams = createVideoStreams();
    const player = createMockPlayer({
      getStreams: () => streams,
      getActiveStream: () => streams[0],
      getBuffered: () => createTimeRanges([0, 2]),
      getMedia: () => ({ currentTime: 0 }),
    });
    const rule = new BolaRule(player);

    // maxSegmentDuration is 4 (from factory default), buffer is 2
    expect(rule.getDecision()).toBeNull();
  });

  it("picks higher stream when buffer is healthy", () => {
    const streams = createVideoStreams();
    const player = createMockPlayer({
      getStreams: () => streams,
      getActiveStream: () => streams[0],
      getBuffered: () => createTimeRanges([0, 30]),
      getMedia: () => ({ currentTime: 0 }),
    });
    const rule = new BolaRule(player);

    const decision = rule.getDecision();
    expect(decision).not.toBeNull();
    expect(decision!.bandwidth).toBeGreaterThanOrEqual(streams[1]!.bandwidth);
  });

  it("picks conservatively when buffer is just above threshold", () => {
    const streams = createVideoStreams();
    const player = createMockPlayer({
      getStreams: () => streams,
      getActiveStream: () => streams[0],
      getBuffered: () => createTimeRanges([0, 5]),
      getMedia: () => ({ currentTime: 0 }),
    });
    const rule = new BolaRule(player);

    const decision = rule.getDecision();
    expect(decision).not.toBeNull();
    expect(decision!.bandwidth).toBeLessThanOrEqual(streams[1]!.bandwidth);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/cmaf-lite && pnpm test -- --run -t "BolaRule"
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement BolaRule**

Create `lib/abr/rule_bola.ts`:

```ts
import type { AbrRule } from "../types/abr";
import type { Stream } from "../types/media";
import { MediaType } from "../types/media";
import type { Player } from "../player";
import { getBufferedEnd } from "../utils/buffer_utils";

const MINIMUM_BUFFER_S = 10;
const MINIMUM_BUFFER_PER_LEVEL_S = 2;

/**
 * Buffer-Optimized Bitrate Algorithm. Uses buffer level
 * to compute utility scores per stream — higher buffer
 * allows higher quality.
 *
 * Abstains during startup (buffer < maxSegmentDuration).
 *
 * @internal
 */
export class BolaRule implements AbrRule {
  private player_: Player;

  constructor(player: Player) {
    this.player_ = player;
  }

  getDecision(): Stream | null {
    const streams = this.player_.getStreams(MediaType.VIDEO);
    if (!streams.length) {
      return null;
    }

    const currentStream = this.player_.getActiveStream(MediaType.VIDEO);
    if (!currentStream) {
      return null;
    }

    const { maxSegmentDuration } = currentStream.hierarchy.track;
    const bufferLevel = this.getBufferLevel_();

    if (bufferLevel < maxSegmentDuration) {
      return null;
    }

    // Compute utility parameters inline — no array allocations.
    // Utility is log(bandwidth) normalized so lowest stream = 1.
    const minUtility = Math.log(streams[0].bandwidth);
    const highestNormalized =
      Math.log(streams[streams.length - 1].bandwidth) - minUtility + 1;

    const bufferTarget = Math.max(
      MINIMUM_BUFFER_S,
      MINIMUM_BUFFER_S + MINIMUM_BUFFER_PER_LEVEL_S * streams.length,
    );

    const utilityOffset =
      (highestNormalized - 1) / (bufferTarget / MINIMUM_BUFFER_S - 1);
    const utilityScale = MINIMUM_BUFFER_S / utilityOffset;

    let bestIndex = 0;
    let bestScore = -Infinity;

    for (let i = 0; i < streams.length; i++) {
      const normalized = Math.log(streams[i].bandwidth) - minUtility + 1;
      const score =
        (utilityScale * (normalized + utilityOffset) - bufferLevel) /
        streams[i].bandwidth;
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }

    return streams[bestIndex] ?? null;
  }

  private getBufferLevel_(): number {
    const media = this.player_.getMedia();
    if (!media) {
      return 0;
    }
    const buffered = this.player_.getBuffered(MediaType.VIDEO);
    const { maxBufferHole } = this.player_.getConfig();
    const end = getBufferedEnd(buffered, media.currentTime, maxBufferHole);
    return end ? end - media.currentTime : 0;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/cmaf-lite && pnpm test -- --run -t "BolaRule"
```

Expected: All BolaRule tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/cmaf-lite/lib/abr/rule_bola.ts \
  packages/cmaf-lite/test/abr/rule_bola.test.ts
git commit -m "feat: implement BolaRule"
```

---

### Task 9: Implement InsufficientBufferRule

**Files:**
- Create: `packages/cmaf-lite/lib/abr/rule_insufficient_buffer.ts`
- Create: `packages/cmaf-lite/test/abr/rule_insufficient_buffer.test.ts`

- [ ] **Step 1: Write failing tests**

Create `test/abr/rule_insufficient_buffer.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { InsufficientBufferRule } from "../../lib/abr/rule_insufficient_buffer";
import { MediaType } from "../../lib/types/media";
import { buildStreams } from "../../lib/utils/stream_utils";
import {
  createManifest,
  createSwitchingSet,
  createVideoTrack,
} from "../__framework__/factories";
import { createMockPlayer } from "../__framework__/player_mock";
import { createMockAbrController } from "../__framework__/abr_controller_mock";
import { createTimeRanges } from "../__framework__/time_ranges";

function createVideoStreams() {
  const manifest = createManifest({
    switchingSets: [
      createSwitchingSet({
        tracks: [
          createVideoTrack({ bandwidth: 500_000, width: 640, height: 360 }),
          createVideoTrack({ bandwidth: 1_500_000, width: 1280, height: 720 }),
          createVideoTrack({ bandwidth: 3_000_000, width: 1920, height: 1080 }),
        ],
      }),
    ],
  });
  return buildStreams(manifest).get(MediaType.VIDEO)!;
}

describe("InsufficientBufferRule", () => {
  it("abstains when buffer is below maxSegmentDuration", () => {
    const streams = createVideoStreams();
    const player = createMockPlayer({
      getStreams: () => streams,
      getActiveStream: () => streams[1],
      getBuffered: () => createTimeRanges([0, 2]),
      getMedia: () => ({ currentTime: 0 }),
    });
    const controller = createMockAbrController({
      getThroughputEstimate: () => 5_000_000,
    });
    const rule = new InsufficientBufferRule(player, controller);

    expect(rule.getDecision()).toBeNull();
  });

  it("returns proportionally scaled stream when buffer is low", () => {
    const streams = createVideoStreams();
    const player = createMockPlayer({
      getStreams: () => streams,
      getActiveStream: () => streams[1],
      getBuffered: () => createTimeRanges([0, 6]),
      getMedia: () => ({ currentTime: 0 }),
    });
    const controller = createMockAbrController({
      getThroughputEstimate: () => 3_000_000,
    });
    const rule = new InsufficientBufferRule(player, controller);

    const decision = rule.getDecision();
    // bitrate = 3_000_000 * 0.7 * (6 / 4) = 3_150_000
    // Fits stream at 3_000_000
    expect(decision).not.toBeNull();
    expect(decision?.bandwidth).toBe(3_000_000);
  });

  it("returns lowest stream when buffer barely above threshold", () => {
    const streams = createVideoStreams();
    const player = createMockPlayer({
      getStreams: () => streams,
      getActiveStream: () => streams[1],
      getBuffered: () => createTimeRanges([0, 4.5]),
      getMedia: () => ({ currentTime: 0 }),
    });
    const controller = createMockAbrController({
      getThroughputEstimate: () => 1_000_000,
    });
    const rule = new InsufficientBufferRule(player, controller);

    const decision = rule.getDecision();
    // bitrate = 1_000_000 * 0.7 * (4.5 / 4) = 787_500
    // Fits stream at 500_000
    expect(decision).not.toBeNull();
    expect(decision?.bandwidth).toBe(500_000);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/cmaf-lite && pnpm test -- --run -t "InsufficientBufferRule"
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement InsufficientBufferRule**

Create `lib/abr/rule_insufficient_buffer.ts`:

```ts
import type { AbrRule } from "../types/abr";
import type { Stream } from "../types/media";
import { MediaType } from "../types/media";
import type { Player } from "../player";
import type { AbrController } from "./abr_controller";
import { getBufferedEnd } from "../utils/buffer_utils";

const THROUGHPUT_SAFETY_FACTOR = 0.7;

/**
 * Proportionally reduces quality when buffer is low.
 * Uses `throughput * 0.7 * (bufferLevel / maxSegmentDuration)`
 * to compute a target bitrate.
 *
 * Abstains during startup (buffer < maxSegmentDuration).
 *
 * @internal
 */
export class InsufficientBufferRule implements AbrRule {
  private player_: Player;
  private controller_: AbrController;

  constructor(player: Player, controller: AbrController) {
    this.player_ = player;
    this.controller_ = controller;
  }

  getDecision(): Stream | null {
    const streams = this.player_.getStreams(MediaType.VIDEO);
    if (!streams.length) {
      return null;
    }

    const currentStream = this.player_.getActiveStream(MediaType.VIDEO);
    if (!currentStream) {
      return null;
    }

    const { maxSegmentDuration } = currentStream.hierarchy.track;
    const bufferLevel = this.getBufferLevel_();

    if (bufferLevel < maxSegmentDuration) {
      return null;
    }

    const throughput = this.controller_.getThroughputEstimate();
    const targetBitrate =
      throughput *
      THROUGHPUT_SAFETY_FACTOR *
      (bufferLevel / maxSegmentDuration);

    let best: Stream | null = null;
    for (const stream of streams) {
      if (stream.bandwidth <= targetBitrate) {
        best = stream;
      }
    }

    return best ?? streams[0] ?? null;
  }

  private getBufferLevel_(): number {
    const media = this.player_.getMedia();
    if (!media) {
      return 0;
    }
    const buffered = this.player_.getBuffered(MediaType.VIDEO);
    const { maxBufferHole } = this.player_.getConfig();
    const end = getBufferedEnd(buffered, media.currentTime, maxBufferHole);
    return end ? end - media.currentTime : 0;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/cmaf-lite && pnpm test -- --run -t "InsufficientBufferRule"
```

Expected: All InsufficientBufferRule tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/cmaf-lite/lib/abr/rule_insufficient_buffer.ts \
  packages/cmaf-lite/test/abr/rule_insufficient_buffer.test.ts
git commit -m "feat: implement InsufficientBufferRule"
```

---

### Task 10: Implement DroppedFramesRule

**Files:**
- Create: `packages/cmaf-lite/lib/abr/rule_dropped_frames.ts`
- Create: `packages/cmaf-lite/test/abr/rule_dropped_frames.test.ts`

- [ ] **Step 1: Write failing tests**

Create `test/abr/rule_dropped_frames.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { DroppedFramesRule } from "../../lib/abr/rule_dropped_frames";
import { MediaType } from "../../lib/types/media";
import { buildStreams } from "../../lib/utils/stream_utils";
import {
  createManifest,
  createSwitchingSet,
  createVideoTrack,
} from "../__framework__/factories";
import { createMockPlayer } from "../__framework__/player_mock";

function createVideoStreams() {
  const manifest = createManifest({
    switchingSets: [
      createSwitchingSet({
        tracks: [
          createVideoTrack({ bandwidth: 500_000, width: 640, height: 360 }),
          createVideoTrack({ bandwidth: 1_500_000, width: 1280, height: 720 }),
          createVideoTrack({ bandwidth: 3_000_000, width: 1920, height: 1080 }),
        ],
      }),
    ],
  });
  return buildStreams(manifest).get(MediaType.VIDEO)!;
}

function playerWithDrops(
  streams: ReturnType<typeof createVideoStreams>,
  currentIndex: number,
  droppedRatio: number,
) {
  const totalFrames = 1000;
  return createMockPlayer({
    getStreams: () => streams,
    getActiveStream: (type: MediaType) =>
      type === MediaType.VIDEO ? streams[currentIndex] : null,
    getMedia: () => ({
      getVideoPlaybackQuality: () => ({
        totalVideoFrames: totalFrames,
        droppedVideoFrames: Math.round(totalFrames * droppedRatio),
      }),
    }),
  });
}

describe("DroppedFramesRule", () => {
  it("abstains when dropped frame ratio is below threshold", () => {
    const streams = createVideoStreams();
    const player = playerWithDrops(streams, 2, 0.05);
    const rule = new DroppedFramesRule(player);

    expect(rule.getDecision()).toBeNull();
  });

  it("returns one stream below current when ratio exceeds threshold", () => {
    const streams = createVideoStreams();
    const player = playerWithDrops(streams, 2, 0.20);
    const rule = new DroppedFramesRule(player);

    expect(rule.getDecision()).toBe(streams[1]);
  });

  it("returns lowest stream when already at index 1", () => {
    const streams = createVideoStreams();
    const player = playerWithDrops(streams, 1, 0.20);
    const rule = new DroppedFramesRule(player);

    expect(rule.getDecision()).toBe(streams[0]);
  });

  it("returns lowest stream when already at lowest", () => {
    const streams = createVideoStreams();
    const player = playerWithDrops(streams, 0, 0.20);
    const rule = new DroppedFramesRule(player);

    expect(rule.getDecision()).toBe(streams[0]);
  });

  it("abstains when media element is not available", () => {
    const streams = createVideoStreams();
    const player = createMockPlayer({
      getStreams: () => streams,
      getActiveStream: () => streams[2],
      getMedia: () => null,
    });
    const rule = new DroppedFramesRule(player);

    expect(rule.getDecision()).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/cmaf-lite && pnpm test -- --run -t "DroppedFramesRule"
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement DroppedFramesRule**

Create `lib/abr/rule_dropped_frames.ts`:

```ts
import type { AbrRule } from "../types/abr";
import type { Stream } from "../types/media";
import { MediaType } from "../types/media";
import type { Player } from "../player";

/**
 * Downgrades quality when the device cannot keep up
 * with decoding, detected via dropped frame ratio.
 *
 * @internal
 */
export class DroppedFramesRule implements AbrRule {
  private player_: Player;

  constructor(player: Player) {
    this.player_ = player;
  }

  getDecision(): Stream | null {
    const media = this.player_.getMedia() as HTMLVideoElement | null;
    if (!media?.getVideoPlaybackQuality) {
      return null;
    }

    const quality = media.getVideoPlaybackQuality();
    if (quality.totalVideoFrames === 0) {
      return null;
    }

    const ratio = quality.droppedVideoFrames / quality.totalVideoFrames;
    const { droppedFramesThreshold } = this.player_.getConfig().abr;

    if (ratio <= droppedFramesThreshold) {
      return null;
    }

    const streams = this.player_.getStreams(MediaType.VIDEO);
    if (!streams.length) {
      return null;
    }

    const currentStream = this.player_.getActiveStream(MediaType.VIDEO);
    const currentIndex = currentStream
      ? streams.indexOf(currentStream)
      : streams.length - 1;

    return streams[Math.max(0, currentIndex - 1)] ?? null;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/cmaf-lite && pnpm test -- --run -t "DroppedFramesRule"
```

Expected: All DroppedFramesRule tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/cmaf-lite/lib/abr/rule_dropped_frames.ts \
  packages/cmaf-lite/test/abr/rule_dropped_frames.test.ts
git commit -m "feat: implement DroppedFramesRule"
```

---

### Task 11: Implement AbrController

**Files:**
- Create: `packages/cmaf-lite/lib/abr/abr_controller.ts`

Note: AbrController tests are skipped for now — validated via the demo app.

- [ ] **Step 1: Implement AbrController**

Create `lib/abr/abr_controller.ts`:

```ts
import type { Player } from "../player";
import type { AbrRule } from "../types/abr";
import type { Stream } from "../types/media";
import { MediaType } from "../types/media";
import { Events } from "../events";
import { Timer } from "../utils/timer";
import { ThroughputRule } from "./rule_throughput";
import { BolaRule } from "./rule_bola";
import { InsufficientBufferRule } from "./rule_insufficient_buffer";
import { DroppedFramesRule } from "./rule_dropped_frames";

/**
 * Rule-based ABR controller. Evaluates all rules on a
 * timer and applies the most conservative (lowest
 * bandwidth) result.
 *
 * @internal
 */
export class AbrController {
  private player_: Player;
  private timer_: Timer;
  private throughputRule_: ThroughputRule;
  private bolaRule_: BolaRule;
  private insufficientBufferRule_: InsufficientBufferRule;
  private droppedFramesRule_: DroppedFramesRule;
  private rules_: AbrRule[];

  constructor(player: Player) {
    this.player_ = player;
    this.timer_ = new Timer(() => this.evaluate_());

    this.throughputRule_ = new ThroughputRule(player);
    this.bolaRule_ = new BolaRule(player);
    this.insufficientBufferRule_ = new InsufficientBufferRule(
      player,
      this,
    );
    this.droppedFramesRule_ = new DroppedFramesRule(player);

    this.rules_ = [
      this.throughputRule_,
      this.bolaRule_,
      this.insufficientBufferRule_,
      this.droppedFramesRule_,
    ];

    this.player_.on(Events.STREAMS_UPDATED, this.onStreamsUpdated_);
  }

  /**
   * Returns the current throughput estimate in bits/s.
   */
  getThroughputEstimate(): number {
    return this.throughputRule_.getEstimate();
  }

  destroy() {
    this.timer_.stop();
    this.player_.off(Events.STREAMS_UPDATED, this.onStreamsUpdated_);
    this.throughputRule_.destroy();
  }

  private onStreamsUpdated_ = () => {
    this.evaluate_();
    const interval = this.player_.getConfig().abr.evaluationInterval;
    this.timer_.tickEvery(interval);
  };

  private evaluate_() {
    const streams = this.player_.getStreams(MediaType.VIDEO);
    if (!streams.length) {
      return;
    }

    let best: Stream | null = null;
    for (const rule of this.rules_) {
      const stream = rule.getDecision();
      if (stream && (!best || stream.bandwidth < best.bandwidth)) {
        best = stream;
      }
    }

    const current = this.player_.getActiveStream(MediaType.VIDEO);
    if (best && best !== current) {
      this.player_.setStreamPreference({
        type: MediaType.VIDEO,
        bandwidth: best.bandwidth,
      });
    }
  }
}
```

- [ ] **Step 2: Run type check**

```bash
cd packages/cmaf-lite && pnpm tsc
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add packages/cmaf-lite/lib/abr/abr_controller.ts \
  packages/cmaf-lite/test/abr/abr_controller.test.ts
git commit -m "feat: implement AbrController"
```

---

### Task 12: Wire AbrController into Player

**Files:**
- Modify: `packages/cmaf-lite/lib/player.ts`
- Modify: `packages/cmaf-lite/lib/index.ts`

- [ ] **Step 1: Add AbrController to Player**

In `lib/player.ts`, add the import and instantiation:

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

- [ ] **Step 2: Export ABR modules from index**

In `lib/index.ts`, add:

```ts
export { AbrController } from "./abr/abr_controller";
```

- [ ] **Step 3: Run type check and tests**

```bash
cd packages/cmaf-lite && pnpm tsc && pnpm test
```

Expected: All pass.

- [ ] **Step 4: Commit**

```bash
git add packages/cmaf-lite/lib/player.ts \
  packages/cmaf-lite/lib/index.ts
git commit -m "feat: wire AbrController into Player"
```

---

### Task 13: Write user-facing ABR documentation

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
```

- [ ] **Step 2: Commit**

```bash
git add packages/cmaf-lite/docs/abr.md
git commit -m "docs: add ABR documentation"
```

---

### Task 14: Final verification

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

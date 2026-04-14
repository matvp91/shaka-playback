# ABR Controller Design

## Overview

A rule-based Adaptive Bitrate controller for cmaf-lite. Four independent rules
each propose a video stream. The controller takes the most conservative result
(lowest bandwidth). Inspired by dash.js's rule architecture and Netflix
Cadmium's throughput estimation, simplified for cmaf-lite's event-driven
design.

Throughput estimation uses `@svta/cml-throughput`'s EwmaEstimator.

## File Structure

```
lib/abr/
  abr_controller.ts           — orchestrates rules, runs evaluation timer
  rule_throughput.ts           — bandwidth-based stream selection
  rule_bola.ts                 — buffer-level-based utility scoring
  rule_insufficient_buffer.ts  — emergency lowest-quality fallback
  rule_dropped_frames.ts       — device capability detection

lib/types/abr.ts               — AbrRule interface
```

## Config

Added to `lib/config.ts` under an `abr` key:

```ts
abr: {
  defaultBandwidthEstimate: 1_000_000,    // bits/s, before any samples
  bandwidthUpgradeTarget: 0.7,            // upgrade when bw >= 70% of stream
  bandwidthDowngradeTarget: 0.95,         // downgrade when bw < 95% of stream
  evaluationInterval: 8,                  // seconds between evaluations
  insufficientBufferThreshold: 0.5,       // seconds, force lowest below this
  fastHalfLife: 3,                        // EWMA fast half-life in seconds
  slowHalfLife: 9,                        // EWMA slow half-life in seconds
  droppedFramesThreshold: 0.15,           // ratio, force downgrade above this
}
```

## Types

`lib/types/abr.ts`:

```ts
import type { Stream } from "./media";

interface AbrRule {
  getDecision(): Stream | null;
}
```

Rules return a `Stream` to vote, or `null` to abstain. No priority system,
no decision objects. Zero allocations per evaluation tick.

## AbrController

### Responsibility

Owns the evaluation timer, runs rules, applies the result.

### Construction

```ts
new AbrController(player)
```

Creates the four rules internally, passing each the player reference and
relevant config values.

### Lifecycle

- Listens to `STREAMS_UPDATED` on the player.
- On `STREAMS_UPDATED`, runs an immediate evaluation to set the initial
  stream preference based on `defaultBandwidthEstimate`, and starts the
  evaluation timer at `evaluationInterval` seconds.
- This ensures the first segment downloads at the correct quality — the
  preference is set before `StreamController.tryStart_()` selects the
  initial stream.
- Does not store stream state. Reads current video stream via
  `player.getActiveStream(VIDEO)` and available streams via
  `player.getStreams(VIDEO)` on each evaluation.

### Evaluation Loop

Uses cmaf-lite's existing `Timer` utility with `tickEvery(evaluationInterval)`.
Runs every `evaluationInterval` seconds:

```ts
let best: Stream | null = null;
for (const rule of this.rules) {
  const stream = rule.getDecision();
  if (stream && (!best || stream.bandwidth < best.bandwidth)) {
    best = stream;
  }
}
const current = player.getActiveStream(MediaType.VIDEO);
if (best && best !== current) {
  player.setStreamPreference({ type: MediaType.VIDEO, bandwidth: best.bandwidth });
}
```

Single pass, no intermediate arrays, zero allocations.

### Video Only

The ABR controller only manages video streams. Audio stays on its initially
selected stream. Audio bandwidth is subtracted from the throughput estimate
in ThroughputRule.

## Rules

All rules receive the Player reference at construction and read what they need
directly. No shared context object.

### ThroughputRule

**Purpose:** What can the network support?

- Creates and owns an `EwmaEstimator` from `@svta/cml-throughput`.
- Listens to `NETWORK_RESPONSE` on the player, feeds segment download samples
  to the estimator (filters out non-segment responses).
- Config: `fastHalfLife`, `slowHalfLife`, `defaultBandwidthEstimate`,
  `bandwidthUpgradeTarget`, `bandwidthDowngradeTarget`.
- `getDecision()`:
  1. Gets throughput estimate from EWMA (falls back to
     `defaultBandwidthEstimate` before samples arrive).
  2. Subtracts current audio stream bandwidth.
  3. If considering an upgrade: applies `bandwidthUpgradeTarget` (0.7).
  4. If considering a downgrade: applies `bandwidthDowngradeTarget` (0.95).
  5. Returns the highest stream that fits within the effective bandwidth.

### BolaRule

**Purpose:** What does the buffer level justify?

- No config. Derives decisions from buffer level and the stream ladder.
- `getDecision()`:
  1. Reads buffer level from the player.
  2. For each video stream, computes a utility score: quality-to-bitrate
     tradeoff weighted by current buffer level.
  3. Low buffer produces conservative scores, high buffer produces aggressive
     scores.
  4. Returns the stream with the highest utility score.

### InsufficientBufferRule

**Purpose:** Are we about to rebuffer?

- Config: `insufficientBufferThreshold` (default 0.5s).
- `getDecision()`:
  1. Reads buffer level from the player.
  2. If buffer < `insufficientBufferThreshold`, returns the lowest stream.
  3. Otherwise returns `null` (abstains).

### DroppedFramesRule

**Purpose:** Can the device keep up?

- Config: `droppedFramesThreshold` (default 0.15).
- `getDecision()`:
  1. Reads `video.getVideoPlaybackQuality()` from the video element.
  2. If dropped frame ratio > `droppedFramesThreshold`, returns one stream
     below the current stream.
  3. Otherwise returns `null` (abstains).

## Aggregation

All four rules always run. The controller takes the minimum bandwidth among
all non-null responses. No priority system. The most conservative rule wins.

| Scenario               | Throughput | BOLA     | Insufficient | Dropped | Result   |
|------------------------|-----------|----------|-------------|---------|----------|
| Healthy playback       | Stream 5  | Stream 7 | null        | null    | Stream 5 |
| Full buffer, good bw   | Stream 7  | Stream 7 | null        | null    | Stream 7 |
| Buffer dropping        | Stream 5  | Stream 3 | null        | null    | Stream 3 |
| Buffer critical        | Stream 5  | Stream 2 | Stream 0    | null    | Stream 0 |
| Weak device            | Stream 5  | Stream 5 | null        | Stream 4| Stream 4 |

## Prerequisite Changes

### Stream Sorting

`StreamUtils.buildStreams()` sorts each stream list by bandwidth ascending
before returning. A comment above the sort explains this is needed for ABR
(index 0 = lowest quality, last = highest quality). Rules can work with
stream indices directly.

## Teardown

AbrController exposes a `destroy()` method that stops the timer and removes
event listeners from the player. Called by Player on destroy.

## Implementation Notes

- **Buffer level computation:** Rules use `getBufferedEnd()` from
  `buffer_utils` to compute seconds ahead of playhead:
  `getBufferedEnd(buffered, currentTime, maxHole) - currentTime`.
- **Video element access:** DroppedFramesRule accesses the video element via
  `player.getMedia()` to call `getVideoPlaybackQuality()`.

## Dependencies

- `@svta/cml-throughput` — EwmaEstimator for throughput measurement.
- `@svta/cml-utils` — peer dependency of the above (ResourceTiming type).

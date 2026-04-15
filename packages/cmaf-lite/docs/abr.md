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

The following refinements are intentionally deferred.

### BOLA placeholder buffer

The original BOLA paper describes a virtual buffer that compensates for
non-download delays (pauses, stalls, seek recovery). Without it, a
user-initiated pause can make BOLA pick a lower quality when playback
resumes because actual throughput samples have grown stale. A
placeholder buffer decays gradually so BOLA sees a smoothly declining
virtual buffer rather than a cliff.

Not implemented because cmaf-lite is VOD-focused and the conservative
aggregation with the Throughput rule keeps the overall decision safe
even if BOLA's score is temporarily pessimistic.

### BOLA startup mode

A common refinement uses throughput-guided selection inside BOLA during
startup until the buffer reaches one segment duration. Our BOLA rule
abstains entirely below that threshold and lets the Throughput rule
drive initial quality.

The simpler approach works because the Throughput rule always runs. If
a future change isolates rules, BOLA will need its own startup handling.

### Insufficient-buffer hard zero

Some implementations force the lowest quality when the buffer is
completely empty, in addition to the proportional formula. We abstain
when the buffer is below one segment duration, so near-zero buffer is
only reachable between evaluations. With a high throughput estimate and
a sudden buffer drop, the proportional formula could pick a non-lowest
stream.

Not implemented because rebuffering is imminent regardless in that
scenario, and shortening the evaluation interval is a simpler mitigation
if it becomes a real problem.

### Per-representation dropped frame history

A more precise approach tracks dropped frames per quality level and
caps below the lowest bad level (with a minimum sample size). Our rule
uses the global ratio from `getVideoPlaybackQuality()` and steps down
one level when it exceeds the threshold.

Not implemented because cmaf-lite does not flush the buffer on ABR
switches, so frames from prior streams continue decoding into the new
stream — we cannot cleanly attribute drops per stream.

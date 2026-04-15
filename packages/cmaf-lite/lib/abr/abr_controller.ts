import { EwmaBandwidthEstimator } from "./ewma_bandwidth_estimator";
import type { NetworkResponseEvent, StreamsUpdatedEvent } from "../events";
import { Events } from "../events";
import type { Player } from "../player";
import type { Stream } from "../types/media";
import { MediaType } from "../types/media";
import { NetworkRequestType } from "../types/net";
import { getBufferedEnd } from "../utils/buffer_utils";
import { Log } from "../utils/log";
import { Timer } from "../utils/timer";

const log = Log.create("AbrController");

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
  private bandwidthEstimator_: EwmaBandwidthEstimator;
  private videoStreams_: Stream[] = [];

  constructor(player: Player) {
    this.player_ = player;
    this.timer_ = new Timer(() => this.evaluate_());

    const { fastHalfLife, slowHalfLife, defaultBandwidthEstimate } =
      player.getConfig().abr;
    this.bandwidthEstimator_ = new EwmaBandwidthEstimator({
      fastHalfLife,
      slowHalfLife,
      defaultBandwidthEstimate,
      minTotalBytes: 128_000,
    });

    this.player_.on(Events.STREAMS_UPDATED, this.onStreamsUpdated_);
    this.player_.on(Events.NETWORK_RESPONSE, this.onNetworkResponse_);
  }

  /**
   * Returns the current throughput estimate in bits/s.
   */
  getThroughputEstimate(): number {
    return this.bandwidthEstimator_.getEstimate();
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

  private onStreamsUpdated_ = (event: StreamsUpdatedEvent) => {
    this.videoStreams_ = event.streamsMap.get(MediaType.VIDEO) ?? [];
    const { evaluationInterval } = this.player_.getConfig().abr;
    this.timer_.tickEvery(evaluationInterval);
  };

  private onNetworkResponse_ = (event: NetworkResponseEvent) => {
    if (event.type !== NetworkRequestType.SEGMENT) {
      return;
    }
    this.bandwidthEstimator_.sample(
      event.response.timeElapsed / 1000,
      event.response.arrayBuffer.byteLength,
    );
  };

  /**
   * Evaluate potential stream targets
   */
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
      log.info("ABR decision", best);
      this.player_.setStreamPreference(best);
    }
  }

  /**
   * Highest video stream fitting measured throughput, minus audio.
   */
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
      if (!stream) {
        continue;
      }
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

  /**
   * Step one quality level down when dropped frame ratio is high.
   */
  private evaluateDroppedFrames_(
    videoStreams: Stream[],
    currentVideoStream: Stream,
  ): Stream | null {
    const media = this.player_.getMedia() as HTMLVideoElement | null;
    if (!media?.getVideoPlaybackQuality) {
      return null;
    }

    const quality = media.getVideoPlaybackQuality();
    const ratio = quality.totalVideoFrames
      ? quality.droppedVideoFrames / quality.totalVideoFrames
      : 0;
    const { droppedFramesThreshold } = this.player_.getConfig().abr;
    if (ratio <= droppedFramesThreshold) {
      return null;
    }

    const currentIndex = videoStreams.indexOf(currentVideoStream);
    const newIndex = Math.max(0, currentIndex - 1);
    return videoStreams[newIndex] ?? null;
  }
}

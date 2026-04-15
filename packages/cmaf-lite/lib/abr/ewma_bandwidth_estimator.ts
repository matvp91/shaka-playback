import { Ewma } from "./ewma";

/**
 * Configuration for {@link EwmaBandwidthEstimator}.
 *
 * @internal
 */
export type EwmaBandwidthEstimatorOptions = {
  /** Fast EWMA half-life in seconds. */
  fastHalfLife: number;
  /** Slow EWMA half-life in seconds. */
  slowHalfLife: number;
  /**
   * Initial bandwidth estimate in bits/s, returned until
   * `minTotalBytes` of real samples have accumulated.
   */
  defaultBandwidthEstimate: number;
  /**
   * Minimum bytes of real samples before switching from
   * `defaultBandwidthEstimate` to the EWMA estimate.
   */
  minTotalBytes: number;
};

/**
 * Dual-EWMA bandwidth estimator. Maintains a fast and slow EWMA and
 * returns the minimum — a quick-reacting but conservative estimate.
 *
 * @internal
 */
export class EwmaBandwidthEstimator {
  private fast_: Ewma;
  private slow_: Ewma;
  private defaultBandwidthEstimate_: number;
  private minTotalBytes_: number;
  private totalBytes_ = 0;

  constructor(options: EwmaBandwidthEstimatorOptions) {
    this.fast_ = new Ewma(options.fastHalfLife);
    this.slow_ = new Ewma(options.slowHalfLife);
    this.defaultBandwidthEstimate_ = options.defaultBandwidthEstimate;
    this.minTotalBytes_ = options.minTotalBytes;
  }

  /**
   * Records a completed download as a bandwidth sample.
   *
   * @param durationSeconds - How long the download took.
   * @param bytes - How many bytes were received.
   */
  sample(durationSeconds: number, bytes: number) {
    if (durationSeconds <= 0 || bytes <= 0) {
      return;
    }
    const bitsPerSecond = (bytes * 8) / durationSeconds;
    this.fast_.sample(durationSeconds, bitsPerSecond);
    this.slow_.sample(durationSeconds, bitsPerSecond);
    this.totalBytes_ += bytes;
  }

  /**
   * Returns the current bandwidth estimate in bits/s. Returns
   * `defaultBandwidthEstimate` until `minTotalBytes` has accumulated.
   */
  getEstimate(): number {
    if (this.totalBytes_ < this.minTotalBytes_) {
      return this.defaultBandwidthEstimate_;
    }
    return Math.min(this.fast_.getEstimate(), this.slow_.getEstimate());
  }
}

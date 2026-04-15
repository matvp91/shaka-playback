import type { AbrConfig } from "../config";
import { Ewma } from "./ewma";

/**
 * Dual-EWMA bandwidth estimator. Maintains a fast and slow EWMA and
 * returns the minimum — a quick-reacting but conservative estimate.
 *
 * @internal
 */
export class EwmaBandwidthEstimator {
  private fast_: Ewma;
  private slow_: Ewma;
  private totalBytes_ = 0;

  constructor(private config_: AbrConfig) {
    this.fast_ = new Ewma(config_.fastHalfLife);
    this.slow_ = new Ewma(config_.slowHalfLife);
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
  getEstimate(defaultEstimate: number): number {
    if (this.totalBytes_ < this.config_.minTotalBytes) {
      return defaultEstimate;
    }
    return Math.min(this.fast_.getEstimate(), this.slow_.getEstimate());
  }
}

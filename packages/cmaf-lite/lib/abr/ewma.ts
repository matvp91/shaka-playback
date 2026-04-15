/**
 * Exponentially-weighted moving average. Ported from Shaka Player
 * (Apache-2.0, {@link https://github.com/shaka-project/shaka-player}).
 *
 * @internal
 */
export class Ewma {
  private alpha_: number;
  private estimate_ = 0;
  private totalWeight_ = 0;

  /**
   * @param halfLife - The quantity of prior samples (by weight) that
   *   together make up half of the new estimate. Larger values retain
   *   history for longer.
   */
  constructor(halfLife: number) {
    // Convert half-life to a per-unit-time decay factor in (0, 1).
    this.alpha_ = 0.5 ** (1 / halfLife);
  }

  /**
   * Records a new sample and updates the estimate.
   *
   * @param weight - Sample weight (typically duration in seconds).
   * @param value - Observed value at this sample.
   */
  sample(weight: number, value: number) {
    const adjAlpha = this.alpha_ ** weight;
    const newEstimate = value * (1 - adjAlpha) + adjAlpha * this.estimate_;
    if (!Number.isNaN(newEstimate)) {
      this.estimate_ = newEstimate;
      this.totalWeight_ += weight;
    }
  }

  /**
   * Returns the current estimate with zero-bias correction applied
   * so early samples are not pulled toward the initial value of 0.
   */
  getEstimate(): number {
    const zeroFactor = 1 - this.alpha_ ** this.totalWeight_;
    return this.estimate_ / zeroFactor;
  }
}

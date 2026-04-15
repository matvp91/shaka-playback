export class Ewma {
  private alpha_: number;
  private estimate_ = 0;
  private totalWeight_ = 0;

  constructor(halfLife: number) {
    // Convert half-life to a per-unit-time decay factor in (0, 1).
    this.alpha_ = 0.5 ** (1 / halfLife);
  }

  sample(weight: number, value: number) {
    const adjAlpha = this.alpha_ ** weight;
    const newEstimate = value * (1 - adjAlpha) + adjAlpha * this.estimate_;
    if (!Number.isNaN(newEstimate)) {
      this.estimate_ = newEstimate;
      this.totalWeight_ += weight;
    }
  }

  getEstimate(): number {
    const zeroFactor = 1 - this.alpha_ ** this.totalWeight_;
    return this.estimate_ / zeroFactor;
  }
}

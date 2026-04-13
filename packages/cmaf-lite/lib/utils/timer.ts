/**
 * Schedules a callback as single-shot or repeating interval.
 * Each new tick cancels any pending scheduled call.
 */
export class Timer {
  private cancelPending_: (() => void) | null = null;

  constructor(private onTick_: () => void) {}

  /**
   * Schedule callback after a delay in seconds. Cancels
   * any previously scheduled tick.
   */
  tickAfter(seconds: number): this {
    this.stop();
    this.schedule_(() => this.onTick_(), seconds);
    return this;
  }

  /**
   * Tick immediately
   */
  tickNow(): this {
    this.stop();
    this.onTick_();
    return this;
  }

  /**
   * Repeat callback at a fixed interval in seconds.
   * Cancels any pending tick.
   */
  tickEvery(seconds: number): this {
    this.stop();
    this.scheduleRepeating_(seconds);
    return this;
  }

  stop(): this {
    this.cancelPending_?.();
    this.cancelPending_ = null;
    return this;
  }

  private schedule_(callback: () => void, delayInSeconds: number) {
    let alive = true;
    let timeoutId: ReturnType<typeof setTimeout>;

    this.cancelPending_ = () => {
      clearTimeout(timeoutId);
      alive = false;
    };

    timeoutId = setTimeout(() => {
      if (alive) {
        callback();
      }
    }, delayInSeconds * 1000);
  }

  /**
   * Reschedule first, then call the callback. If the
   * callback calls stop(), the pending timeout clears.
   */
  private scheduleRepeating_(seconds: number) {
    this.schedule_(() => {
      this.scheduleRepeating_(seconds);
      this.onTick_();
    }, seconds);
  }
}

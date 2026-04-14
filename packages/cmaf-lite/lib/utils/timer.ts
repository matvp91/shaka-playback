/**
 * Chainable timer that schedules a callback as a single-shot
 * delay or repeating interval. Each new call to
 * {@link Timer.tickAfter}, {@link Timer.tickNow}, or {@link Timer.tickEvery}
 * cancels any pending scheduled invocation.
 *
 * @public
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
   * Fires the callback synchronously and cancels any
   * pending tick.
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

  /** Cancels any pending or repeating tick. */
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

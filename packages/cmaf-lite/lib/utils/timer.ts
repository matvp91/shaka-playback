import * as asserts from "./asserts";

/**
 * Schedules a callback as single-shot or repeating interval.
 * Each new tick cancels any pending scheduled call.
 */
export class Timer {
  private id_: ReturnType<typeof setTimeout> | null = null;

  constructor(private callback_: () => void) {}

  /**
   * Schedule callback after a delay in seconds. Cancels
   * any previously scheduled tick.
   */
  tickAfter(seconds: number): this {
    this.stop();
    this.id_ = setTimeout(() => {
      this.id_ = null;
      this.callback_();
    }, seconds * 1000);
    return this;
  }

  /**
   * Schedule callback on the next event loop tick.
   * Cancels any previously scheduled tick.
   */
  tickNow(): this {
    this.callback_();
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
    if (this.id_ !== null) {
      clearTimeout(this.id_);
      this.id_ = null;
    }
    return this;
  }

  /**
   * Stop the timer and release the callback.
   */
  destroy() {
    this.stop();
  }

  /**
   * Reschedule first, then call the callback. If the
   * callback calls stop(), the pending timeout clears.
   */
  private scheduleRepeating_(seconds: number) {
    this.id_ = setTimeout(() => {
      this.id_ = null;
      asserts.assertExists(this.callback_, "Timer fired after destroy");
      this.scheduleRepeating_(seconds);
      this.callback_();
    }, seconds * 1000);
  }
}

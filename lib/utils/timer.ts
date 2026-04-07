import { assertNotVoid } from "./assert";

/**
 * Timer that schedules a callback as a
 * single-shot or repeating interval.
 * Each tick cancels any pending scheduled call.
 */
export class Timer {
  private id_: ReturnType<typeof setTimeout> | null = null;
  private callback_: (() => void) | null;

  constructor(callback: () => void) {
    this.callback_ = callback;
  }

  /**
   * Schedule the callback after a delay in seconds.
   * Cancels any previously scheduled tick.
   */
  tickAfter(seconds: number): this {
    this.stop();
    this.id_ = setTimeout(() => {
      this.id_ = null;
      assertNotVoid(this.callback_, "Timer fired after destroy");
      this.callback_();
    }, seconds * 1000);
    return this;
  }

  /**
   * Schedule the callback on the next event loop tick.
   * Cancels any previously scheduled tick.
   */
  tickNow(): this {
    return this.tickAfter(0);
  }

  /**
   * Schedule the callback to repeat at a fixed
   * interval in seconds. Cancels any pending tick.
   */
  tickEvery(seconds: number): this {
    this.stop();
    this.scheduleRepeating_(seconds);
    return this;
  }

  /** Cancel any pending scheduled tick. */
  stop(): this {
    if (this.id_ !== null) {
      clearTimeout(this.id_);
      this.id_ = null;
    }
    return this;
  }

  /** Stop the timer and release the callback. */
  destroy() {
    this.stop();
    this.callback_ = null;
  }

  /**
   * Reschedule first, then call the callback.
   * If the callback calls stop(), the pending
   * timeout gets cleared.
   */
  private scheduleRepeating_(seconds: number) {
    this.id_ = setTimeout(() => {
      this.id_ = null;
      assertNotVoid(this.callback_, "Timer fired after destroy");
      this.scheduleRepeating_(seconds);
      this.callback_();
    }, seconds * 1000);
  }
}

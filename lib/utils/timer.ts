import { assertNotVoid } from "./assert";

/**
 * Single-shot timer that schedules a callback.
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
}

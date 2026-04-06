export class TaskLoop {
  private timer_: ReturnType<typeof setTimeout> | null = null;
  private callback_: () => void;

  constructor(callback: () => void) {
    this.callback_ = callback;
  }

  tick() {
    if (this.timer_ !== null) {
      return;
    }
    this.timer_ = setTimeout(() => {
      this.timer_ = null;
      this.callback_();
    }, 0);
  }

  destroy() {
    if (this.timer_ !== null) {
      clearTimeout(this.timer_);
      this.timer_ = null;
    }
  }
}

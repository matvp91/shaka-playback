import type { MediaAttachedEvent } from "../events";
import { Events } from "../events";
import type { Player } from "../player";
import { getNextBufferedStart } from "../utils/buffer";
import { Timer } from "../utils/timer";

const TICK_INTERVAL = 0.1;
const MAX_START_GAP_JUMP = 2;
const SKIP_BUFFER_HOLE_PADDING = 0.1;

export class GapController {
  private media_: HTMLMediaElement | null = null;
  private timer_: Timer;
  private moved_ = false;
  private stalled_: number | null = null;
  private lastCurrentTime_ = 0;

  constructor(private player_: Player) {
    this.timer_ = new Timer(() => this.poll_());
    this.player_.on(Events.MEDIA_ATTACHED, this.onMediaAttached_);
    this.player_.on(Events.MEDIA_DETACHED, this.onMediaDetached_);
  }

  destroy() {
    this.timer_.destroy();
    this.player_.off(Events.MEDIA_ATTACHED, this.onMediaAttached_);
    this.player_.off(Events.MEDIA_DETACHED, this.onMediaDetached_);
    this.media_ = null;
  }

  private onMediaAttached_ = (event: MediaAttachedEvent) => {
    this.media_ = event.media;
    this.media_.addEventListener("seeking", this.onSeeking_);
    this.media_.addEventListener("seeked", this.onSeeked_);
    this.timer_.tickEvery(TICK_INTERVAL);
  };

  private onMediaDetached_ = () => {
    this.timer_.stop();
    this.media_?.removeEventListener("seeking", this.onSeeking_);
    this.media_?.removeEventListener("seeked", this.onSeeked_);
    this.media_ = null;
    this.clearStall_();
  };

  private onSeeking_ = () => {
    this.moved_ = false;
    this.clearStall_();
  };

  private onSeeked_ = () => {
    this.clearStall_();
  };

  private poll_() {
    const media = this.media_;
    if (!media) {
      return;
    }

    const currentTime = media.currentTime;

    // Playhead moved — no stall.
    if (currentTime !== this.lastCurrentTime_) {
      this.lastCurrentTime_ = currentTime;
      this.moved_ = true;
      this.clearStall_();
      return;
    }

    // Don't interfere while seeking, paused, or ended.
    if (media.seeking || media.paused || media.ended) {
      return;
    }

    // No buffer at all — nothing to nudge to.
    if (media.buffered.length === 0) {
      return;
    }

    // Start/seek gap: playhead never moved and stall
    // was detected on a prior tick. Jump past the gap.
    if (!this.moved_ && this.stalled_ !== null) {
      this.trySkipBufferHole_(media);
      return;
    }

    // First stall detection — record and wait one tick
    // to let the browser self-resolve.
    if (this.stalled_ === null) {
      this.stalled_ = performance.now();
      return;
    }

    // Confirmed mid-stream stall — try skipping.
    this.trySkipBufferHole_(media);
  }

  /**
   * Seek past a gap to the next buffered range start.
   * Only jumps if the gap is within MAX_START_GAP_JUMP.
   */
  private trySkipBufferHole_(media: HTMLMediaElement) {
    const nextStart = getNextBufferedStart(media.buffered, media.currentTime);
    if (nextStart === null) {
      return;
    }

    const gap = nextStart - media.currentTime;
    if (gap > MAX_START_GAP_JUMP) {
      return;
    }

    media.currentTime = nextStart + SKIP_BUFFER_HOLE_PADDING;
  }

  private clearStall_() {
    this.stalled_ = null;
  }
}

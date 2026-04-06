import type { MediaAttachingEvent } from "../events";
import { Events } from "../events";
import type { Player } from "../player";
import { EventManager } from "../utils/event_manager";

export class MediaController {
  private eventManager_ = new EventManager();
  private mediaSource_: MediaSource | null = null;

  constructor(private player_: Player) {
    this.eventManager_.listen(
      player_,
      Events.MEDIA_ATTACHING,
      this.onMediaAttaching_,
    );
    this.eventManager_.listen(player_, Events.BUFFER_EOS, this.onBufferEos_);
  }

  destroy() {
    this.eventManager_.release();
    this.mediaSource_ = null;
  }

  private onMediaAttaching_ = (event: MediaAttachingEvent) => {
    const mediaSource = new MediaSource();
    this.mediaSource_ = mediaSource;

    this.eventManager_.listen(
      mediaSource,
      "sourceopen",
      () => {
        this.player_.emit(Events.MEDIA_ATTACHED, {
          media: event.media,
          mediaSource,
        });
      },
      { once: true },
    );

    event.media.src = URL.createObjectURL(mediaSource);
  };

  private onBufferEos_ = () => {
    if (this.mediaSource_ && this.mediaSource_.readyState === "open") {
      this.mediaSource_.endOfStream();
    }
  };
}

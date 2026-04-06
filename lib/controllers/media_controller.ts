import type { MediaAttachingEvent } from "../events";
import { Events } from "../events";
import type { Player } from "../player";

export class MediaController {
  private mediaSource_: MediaSource | null = null;

  constructor(private player_: Player) {
    this.player_.on(Events.MEDIA_ATTACHING, this.onMediaAttaching_);
    this.player_.on(Events.BUFFER_EOS, this.onBufferEos_);
  }

  destroy() {
    this.player_.off(Events.MEDIA_ATTACHING, this.onMediaAttaching_);
    this.player_.off(Events.BUFFER_EOS, this.onBufferEos_);
    this.mediaSource_ = null;
  }

  private onMediaAttaching_ = (event: MediaAttachingEvent) => {
    const mediaSource = new MediaSource();
    this.mediaSource_ = mediaSource;

    mediaSource.addEventListener(
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

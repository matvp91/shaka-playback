import type { MediaAttachingEvent } from "../events";
import { Events } from "../events";
import type { Player } from "../player";

export class MediaController {
  constructor(private player_: Player) {
    this.player_.on(Events.MEDIA_ATTACHING, this.onMediaAttaching_);
  }

  destroy() {
    this.player_.off(Events.MEDIA_ATTACHING, this.onMediaAttaching_);
  }

  private onMediaAttaching_ = (event: MediaAttachingEvent) => {
    const mediaSource = new MediaSource();

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
}

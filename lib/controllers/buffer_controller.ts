import type {
  MediaAttachedEvent,
  SegmentLoadedEvent,
  TracksSelectedEvent,
} from "../events";
import { Events } from "../events";
import type { Player } from "../player";
import type { TrackType } from "../types/manifest";
import { EventManager } from "../utils/event_manager";

type QueueItem = {
  type: TrackType;
  data: ArrayBuffer;
};

export class BufferController {
  private eventManager_ = new EventManager();
  private sourceBuffers_ = new Map<TrackType, SourceBuffer>();
  private queue_: QueueItem[] = [];
  private appending_ = false;
  private mediaSource_: MediaSource | null = null;

  constructor(private player_: Player) {
    this.eventManager_.listen(
      player_,
      Events.MEDIA_ATTACHED,
      this.onMediaAttached_,
    );
    this.eventManager_.listen(
      player_,
      Events.TRACKS_SELECTED,
      this.onTracksSelected_,
    );
    this.eventManager_.listen(
      player_,
      Events.SEGMENT_LOADED,
      this.onSegmentLoaded_,
    );
  }

  destroy() {
    this.eventManager_.release();
    this.sourceBuffers_.clear();
    this.queue_ = [];
    this.mediaSource_ = null;
  }

  getBufferedEnd(type: TrackType): number {
    const sb = this.sourceBuffers_.get(type);
    if (!sb || sb.buffered.length === 0) {
      return 0;
    }
    return sb.buffered.end(sb.buffered.length - 1);
  }

  private onMediaAttached_ = (event: MediaAttachedEvent) => {
    this.mediaSource_ = event.mediaSource;
  };

  private onTracksSelected_ = (event: TracksSelectedEvent) => {
    if (!this.mediaSource_) {
      return;
    }
    for (const track of event.tracks) {
      if (this.sourceBuffers_.has(track.type)) {
        continue;
      }
      const mime = `${track.mimeType};codecs="${track.codec}"`;
      const sb = this.mediaSource_.addSourceBuffer(mime);
      this.sourceBuffers_.set(track.type, sb);
    }
    this.mediaSource_.duration = event.duration;
    this.player_.emit(Events.BUFFER_CREATED);
  };

  private onSegmentLoaded_ = (event: SegmentLoadedEvent) => {
    this.queue_.push({
      type: event.track.type,
      data: event.data,
    });
    this.flush_();
  };

  private flush_() {
    if (this.appending_ || this.queue_.length === 0) {
      return;
    }
    const item = this.queue_.shift();
    if (!item) {
      return;
    }
    const sb = this.sourceBuffers_.get(item.type);
    if (!sb) {
      return;
    }

    this.appending_ = true;

    this.eventManager_.listen(
      sb,
      "updateend",
      () => {
        this.appending_ = false;
        this.player_.emit(Events.BUFFER_APPENDED, {
          type: item.type,
        });
        this.flush_();
      },
      { once: true },
    );

    sb.appendBuffer(item.data);
  }
}

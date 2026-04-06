import type {
  MediaAttachedEvent,
  SegmentLoadedEvent,
  TracksSelectedEvent,
} from "../events";
import { Events } from "../events";
import type { Player } from "../player";
import type { TrackType } from "../types/manifest";
import { OperationQueue } from "./operation_queue";

export class BufferController {
  private sourceBuffers_ = new Map<TrackType, SourceBuffer>();
  private opQueue_ = new OperationQueue();
  private mediaSource_: MediaSource | null = null;

  constructor(private player_: Player) {
    this.player_.on(Events.MEDIA_ATTACHED, this.onMediaAttached_);
    this.player_.on(Events.TRACKS_SELECTED, this.onTracksSelected_);
    this.player_.on(Events.SEGMENT_LOADED, this.onSegmentLoaded_);
  }

  destroy() {
    this.player_.off(Events.MEDIA_ATTACHED, this.onMediaAttached_);
    this.player_.off(Events.TRACKS_SELECTED, this.onTracksSelected_);
    this.player_.off(Events.SEGMENT_LOADED, this.onSegmentLoaded_);
    this.opQueue_.destroy();
    this.sourceBuffers_.clear();
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
      this.opQueue_.add(track.type, sb);
      sb.addEventListener("updateend", () => {
        this.opQueue_.shiftAndExecuteNext(track.type);
      });
    }
    this.mediaSource_.duration = event.duration;
    this.player_.emit(Events.BUFFER_CREATED);
  };

  private onSegmentLoaded_ = (event: SegmentLoadedEvent) => {
    const type = event.track.type;
    this.opQueue_.enqueue(type, {
      execute: () => {
        const sb = this.sourceBuffers_.get(type);
        sb?.appendBuffer(event.data);
      },
      onComplete: () => {
        this.player_.emit(Events.BUFFER_APPENDED, { type });
      },
    });
  };
}

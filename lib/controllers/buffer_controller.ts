import type {
  BufferCodecsEvent,
  MediaAttachedEvent,
  SegmentLoadedEvent,
} from "../events";
import { Events } from "../events";
import type { Player } from "../player";
import type { SelectionSet } from "../types/manifest";

type QueueItem = {
  selectionSet: SelectionSet;
  data: ArrayBuffer;
};

export class BufferController {
  private sourceBuffers_ = new Map<SelectionSet, SourceBuffer>();
  private queue_: QueueItem[] = [];
  private appending_ = false;
  private mediaSource_: MediaSource | null = null;

  constructor(private player_: Player) {
    this.player_.on(Events.MEDIA_ATTACHED, this.onMediaAttached_);
    this.player_.on(Events.BUFFER_CODECS, this.onBufferCodecs_);
    this.player_.on(Events.SEGMENT_LOADED, this.onSegmentLoaded_);
  }

  destroy() {
    this.player_.off(Events.MEDIA_ATTACHED, this.onMediaAttached_);
    this.player_.off(Events.BUFFER_CODECS, this.onBufferCodecs_);
    this.player_.off(Events.SEGMENT_LOADED, this.onSegmentLoaded_);
    this.sourceBuffers_.clear();
    this.queue_ = [];
    this.mediaSource_ = null;
  }

  getBufferedEnd(selectionSet: SelectionSet): number {
    const sb = this.sourceBuffers_.get(selectionSet);
    if (!sb || sb.buffered.length === 0) {
      return 0;
    }
    return sb.buffered.end(sb.buffered.length - 1);
  }

  private onMediaAttached_ = (event: MediaAttachedEvent) => {
    this.mediaSource_ = event.mediaSource;
  };

  private onBufferCodecs_ = (event: BufferCodecsEvent) => {
    if (!this.mediaSource_) {
      return;
    }
    for (const { selectionSet, track } of event.tracks) {
      if (this.sourceBuffers_.has(selectionSet)) {
        continue;
      }
      const mime = `${track.mimeType};codecs="${track.codec}"`;
      const sb = this.mediaSource_.addSourceBuffer(mime);
      this.sourceBuffers_.set(selectionSet, sb);
    }
    this.player_.emit(Events.BUFFER_CREATED);
  };

  private onSegmentLoaded_ = (event: SegmentLoadedEvent) => {
    this.queue_.push({
      selectionSet: event.selectionSet,
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
    const sb = this.sourceBuffers_.get(item.selectionSet);
    if (!sb) {
      return;
    }

    this.appending_ = true;

    sb.addEventListener(
      "updateend",
      () => {
        this.appending_ = false;
        this.player_.emit(Events.BUFFER_APPENDED, {
          selectionSet: item.selectionSet,
        });
        this.flush_();
      },
      { once: true },
    );

    sb.appendBuffer(item.data);
  }
}

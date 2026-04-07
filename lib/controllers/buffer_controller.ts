import type {
  BufferAppendedEvent,
  MediaAttachingEvent,
  MediaGroupsUpdatedEvent,
  SegmentLoadedEvent,
} from "../events";
import { Events } from "../events";
import type { Player } from "../player";
import type { MediaType } from "../types/manifest";
import { getGroupDuration } from "../utils/manifest_util";
import { OperationQueue } from "./operation_queue";

export class BufferController {
  private sourceBuffers_ = new Map<MediaType, SourceBuffer>();
  private opQueue_ = new OperationQueue();
  private mediaSource_: MediaSource | null = null;

  constructor(private player_: Player) {
    this.player_.on(Events.MEDIA_ATTACHING, this.onMediaAttaching_);
    this.player_.on(Events.MEDIA_GROUPS_UPDATED, this.onMediaGroupsUpdated_);
    this.player_.on(Events.SEGMENT_LOADED, this.onSegmentLoaded_);
    this.player_.on(Events.BUFFER_EOS, this.onBufferEos_);
    this.player_.on(Events.BUFFER_APPENDED, this.onBufferAppended_);
  }

  destroy() {
    this.player_.off(Events.MEDIA_ATTACHING, this.onMediaAttaching_);
    this.player_.off(Events.MEDIA_GROUPS_UPDATED, this.onMediaGroupsUpdated_);
    this.player_.off(Events.SEGMENT_LOADED, this.onSegmentLoaded_);
    this.player_.off(Events.BUFFER_EOS, this.onBufferEos_);
    this.player_.off(Events.BUFFER_APPENDED, this.onBufferAppended_);
    this.opQueue_.destroy();
    this.sourceBuffers_.clear();
    this.mediaSource_ = null;
  }

  getBufferedEnd(type: MediaType): number {
    const sb = this.sourceBuffers_.get(type);
    if (!sb || sb.buffered.length === 0) {
      return 0;
    }
    return sb.buffered.end(sb.buffered.length - 1);
  }

  private onMediaAttaching_ = (event: MediaAttachingEvent) => {
    this.mediaSource_ = new MediaSource();

    this.mediaSource_.addEventListener(
      "sourceopen",
      () => {
        this.player_.emit(Events.MEDIA_ATTACHED, {
          media: event.media,
          mediaSource: this.mediaSource_,
        });
      },
      { once: true },
    );

    event.media.src = URL.createObjectURL(this.mediaSource_);
  };

  private onMediaGroupsUpdated_ = (event: MediaGroupsUpdatedEvent) => {
    if (!this.mediaSource_) {
      return;
    }
    for (const group of event.groups) {
      if (this.sourceBuffers_.has(group.type)) {
        continue;
      }
      const mime = `${group.mimeType};codecs="${group.codec}"`;
      const sb = this.mediaSource_.addSourceBuffer(mime);
      this.sourceBuffers_.set(group.type, sb);
      this.opQueue_.add(group.type, sb);
      sb.addEventListener("updateend", () => {
        this.opQueue_.shiftAndExecuteNext(group.type);
      });
    }
    const duration = Math.max(...event.groups.map(getGroupDuration));
    this.mediaSource_.duration = duration;
    this.player_.emit(Events.BUFFER_CREATED);
  };

  private onSegmentLoaded_ = (event: SegmentLoadedEvent) => {
    const { type } = event;
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

  private onBufferAppended_ = (event: BufferAppendedEvent) => {
    const { bufferBehind } = this.player_.getConfig();
    if (!Number.isFinite(bufferBehind)) {
      return;
    }
    const media = this.player_.getMedia();
    if (!media) {
      return;
    }
    const type = event.type;
    const sb = this.sourceBuffers_.get(type);
    if (!sb || sb.buffered.length === 0) {
      return;
    }
    const bufferedStart = sb.buffered.start(0);
    const evictEnd = media.currentTime - bufferBehind;
    if (bufferedStart >= evictEnd) {
      return;
    }
    this.opQueue_.enqueue(type, {
      execute: () => {
        sb.remove(bufferedStart, evictEnd);
      },
      onComplete: () => {},
    });
  };

  private onBufferEos_ = async () => {
    const blockers = [...this.sourceBuffers_.keys()].map((type) =>
      this.opQueue_.block(type),
    );
    await Promise.all(blockers);
    if (this.mediaSource_?.readyState === "open") {
      this.mediaSource_.endOfStream();
    }
  };
}

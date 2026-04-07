import type {
  BufferAppendedEvent,
  BufferAppendingEvent,
  BufferCodecsEvent,
  MediaAttachingEvent,
} from "../events";
import { Events } from "../events";
import type { Player } from "../player";
import type { InitSegment, MediaType } from "../types/manifest";
import { assertNotVoid } from "../utils/assert";
import { parseBaseMediaDecodeTime, parseTimescale } from "../utils/mp4";
import { OperationQueue } from "./operation_queue";

type InitSegmentInfo = {
  timescale: number;
};

export class BufferController {
  private sourceBuffers_ = new Map<MediaType, SourceBuffer>();
  private opQueue_ = new OperationQueue();
  private mediaSource_: MediaSource | null = null;
  private duration_ = 0;
  private initSegmentInfo_ = new Map<InitSegment, InitSegmentInfo>();

  constructor(private player_: Player) {
    this.player_.on(Events.MEDIA_ATTACHING, this.onMediaAttaching_);
    this.player_.on(Events.BUFFER_CODECS, this.onBufferCodecs_);
    this.player_.on(Events.BUFFER_APPENDING, this.onBufferAppending_);
    this.player_.on(Events.BUFFER_EOS, this.onBufferEos_);
    this.player_.on(Events.BUFFER_APPENDED, this.onBufferAppended_);
  }

  destroy() {
    this.player_.off(Events.MEDIA_ATTACHING, this.onMediaAttaching_);
    this.player_.off(Events.BUFFER_CODECS, this.onBufferCodecs_);
    this.player_.off(Events.BUFFER_APPENDING, this.onBufferAppending_);
    this.player_.off(Events.BUFFER_EOS, this.onBufferEos_);
    this.player_.off(Events.BUFFER_APPENDED, this.onBufferAppended_);
    this.opQueue_.destroy();
    this.sourceBuffers_.clear();
    this.mediaSource_ = null;
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

  private onBufferCodecs_ = (event: BufferCodecsEvent) => {
    if (!this.mediaSource_) {
      return;
    }
    for (const [type, { mimeType, codec }] of event.tracks) {
      if (this.sourceBuffers_.has(type)) {
        continue;
      }
      const mime = `${mimeType};codecs="${codec}"`;
      const sb = this.mediaSource_.addSourceBuffer(mime);
      this.sourceBuffers_.set(type, sb);
      this.opQueue_.add(type, sb);
      sb.addEventListener("updateend", () => {
        this.opQueue_.shiftAndExecuteNext(type);
      });
    }
    this.duration_ = event.duration;
    this.player_.emit(Events.BUFFER_CREATED);
    this.updateDuration_();
  };

  private onBufferAppending_ = (event: BufferAppendingEvent) => {
    const { type, initSegment, data, segment } = event;

    if (!segment) {
      this.initSegmentInfo_.set(initSegment, {
        timescale: parseTimescale(data),
      });
    }

    const timestampOffset = segment
      ? this.computeTimestampOffset_(initSegment, segment, data)
      : undefined;

    this.opQueue_.enqueue(type, {
      execute: () => {
        const sb = this.sourceBuffers_.get(type);
        if (!sb) {
          return;
        }
        if (
          timestampOffset !== undefined &&
          sb.timestampOffset !== timestampOffset
        ) {
          sb.timestampOffset = timestampOffset;
        }
        sb.appendBuffer(data);
      },
      onComplete: () => {
        this.player_.emit(Events.BUFFER_APPENDED, { type });
      },
    });
  };

  /**
   * Derive timestampOffset from mp4 container data.
   * Uses cached timescale from the init segment and
   * baseMediaDecodeTime from the media segment.
   */
  private computeTimestampOffset_(
    initSegment: InitSegment,
    segment: { start: number },
    data: ArrayBuffer,
  ): number {
    const info = this.initSegmentInfo_.get(initSegment);
    assertNotVoid(info, "Init segment not parsed");
    const mediaTime = parseBaseMediaDecodeTime(data) / info.timescale;
    return segment.start - mediaTime;
  }

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

  /**
   * Set mediaSource.duration through the operation
   * queue to avoid InvalidStateError when a
   * SourceBuffer is updating.
   */
  private updateDuration_() {
    if (!this.mediaSource_ || this.mediaSource_.readyState !== "open") {
      return;
    }
    const duration = this.duration_;
    if (this.mediaSource_.duration === duration) {
      return;
    }
    const types = [...this.sourceBuffers_.keys()];
    const blockers = types.map((type) => this.opQueue_.block(type));
    Promise.all(blockers).then(() => {
      if (
        this.mediaSource_ &&
        this.mediaSource_.readyState === "open" &&
        this.mediaSource_.duration !== duration
      ) {
        this.mediaSource_.duration = duration;
      }
    });
  }

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

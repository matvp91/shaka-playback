import type {
  BufferAppendedEvent,
  BufferAppendingEvent,
  BufferCodecsEvent,
  BufferErrorEvent,
  MediaAttachingEvent,
} from "../events";
import { Events } from "../events";
import type { Player } from "../player";
import type { InitSegment } from "../types/manifest";
import type { MediaType } from "../types/media";
import * as asserts from "../utils/asserts";
import * as Mp4BoxParser from "../utils/mp4_box_parser";
import { OperationQueue } from "./operation_queue";
import { SegmentTracker } from "./segment_tracker";

type InitSegmentInfo = {
  timescale: number;
};

export class BufferController {
  private sourceBuffers_ = new Map<MediaType, SourceBuffer>();
  private opQueue_ = new OperationQueue();
  private mediaSource_: MediaSource | null = null;
  private duration_ = 0;
  private initSegmentInfo_ = new Map<InitSegment, InitSegmentInfo>();
  private segmentTracker_ = new SegmentTracker();
  private quotaEvictionPending_ = new Set<MediaType>();

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
    this.segmentTracker_.destroy();
    this.quotaEvictionPending_.clear();
    this.sourceBuffers_.clear();
    this.mediaSource_ = null;
  }

  getBuffered(type: MediaType): TimeRanges {
    const sb = this.sourceBuffers_.get(type);
    asserts.assertExists(sb, `No SourceBuffer for ${type}`);
    return sb.buffered;
  }

  flush(type: MediaType) {
    const sb = this.sourceBuffers_.get(type);
    asserts.assertExists(sb, `No SourceBuffer for ${type}`);
    this.quotaEvictionPending_.delete(type);
    this.opQueue_.enqueue(type, {
      execute: () => {
        sb.remove(0, Infinity);
      },
    });
  }

  private onMediaAttaching_ = (event: MediaAttachingEvent) => {
    this.mediaSource_ = new MediaSource();

    this.mediaSource_.addEventListener(
      "sourceopen",
      () => {
        asserts.assertExists(this.mediaSource_, "No MediaSource");
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

    const { type, mimeType } = event;
    if (this.sourceBuffers_.has(type)) {
      return;
    }

    const sb = this.mediaSource_.addSourceBuffer(mimeType);
    this.sourceBuffers_.set(type, sb);
    this.opQueue_.add(type, sb);

    sb.addEventListener("updateend", () => {
      this.opQueue_.shiftAndExecuteNext(type);
    });

    this.duration_ = event.duration;
    this.updateDuration_();
  };

  private onBufferAppending_ = (event: BufferAppendingEvent) => {
    const { type, initSegment, data, segment } = event;

    if (!segment) {
      this.initSegmentInfo_.set(initSegment, {
        timescale: Mp4BoxParser.parseTimescale(data),
      });
    }

    const timestampOffset = segment
      ? this.computeTimestampOffset_(initSegment, segment, data)
      : undefined;

    const operation = {
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
        this.player_.emit(Events.BUFFER_APPENDED, event);
      },
      onError: (error: unknown) => {
        if (isQuotaExceededError(error)) {
          this.evictAndRetryAppend_(
            type,
            operation,
            data.byteLength,
            error,
          );
        }
      },
    };

    this.opQueue_.enqueue(type, operation);
  };

  /**
   * Derive timestampOffset from init segment timescale
   * and media segment baseMediaDecodeTime.
   */
  private computeTimestampOffset_(
    initSegment: InitSegment,
    segment: { start: number },
    data: ArrayBuffer,
  ): number {
    const info = this.initSegmentInfo_.get(initSegment);
    asserts.assertExists(info, "Init segment not parsed");
    const mediaTime =
      Mp4BoxParser.parseBaseMediaDecodeTime(data) / info.timescale;
    return segment.start - mediaTime;
  }

  private onBufferAppended_ = (event: BufferAppendedEvent) => {
    const { type, segment, data } = event;

    // Record byte size for quota-aware eviction decisions.
    if (segment) {
      this.segmentTracker_.trackAppend(
        type,
        segment.start,
        segment.end,
        data.byteLength,
      );
    }

    const sb = this.sourceBuffers_.get(type);
    asserts.assertExists(sb, `No SourceBuffer for ${type}`);
    if (sb.buffered.length > 0) {
      this.segmentTracker_.reconcile(type, sb.buffered);
    }

    const { backBufferLength } = this.player_.getConfig();
    if (!Number.isFinite(backBufferLength)) {
      return;
    }
    const media = this.player_.getMedia();
    if (!media) {
      return;
    }
    if (sb.buffered.length === 0) {
      return;
    }
    const bufferedStart = sb.buffered.start(0);
    const evictEnd = media.currentTime - backBufferLength;
    if (bufferedStart >= evictEnd) {
      return;
    }
    this.opQueue_.enqueue(type, {
      execute: () => {
        sb.remove(bufferedStart, evictEnd);
      },
    });
  };

  /**
   * Set mediaSource.duration through the operation queue
   * to avoid InvalidStateError when a SourceBuffer is updating.
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

  private evictAndRetryAppend_(
    type: MediaType,
    operation: {
      execute: () => void;
      onComplete?: () => void;
      onError?: (error: unknown) => void;
    },
    byteLength: number,
    error: DOMException,
  ) {
    const media = this.player_.getMedia();
    asserts.assertExists(media, "No media element");
    const sb = this.sourceBuffers_.get(type);
    asserts.assertExists(sb, `No SourceBuffer for ${type}`);

    // Nothing buffered, nothing to evict.
    if (sb.buffered.length === 0) {
      return;
    }

    const currentTime = media.currentTime;
    const bufferedStart = sb.buffered.start(0);

    if (!this.quotaEvictionPending_.has(type)) {
      if (
        this.evictTargetedBackBuffer_(
          type,
          operation,
          byteLength,
          currentTime,
          bufferedStart,
        )
      ) {
        return;
      }
    }

    this.player_.emit(Events.BUFFER_ERROR, {
      type,
      error,
    } satisfies BufferErrorEvent);

    this.evictAggressiveBackBuffer_(
      type,
      operation,
      currentTime,
      bufferedStart,
    );
  }

  /**
   * Tier 1: Evict minimum back buffer to fit the failed
   * segment, plus padding for headroom. Returns true when
   * eviction was queued, false when there is not enough
   * back buffer to evict.
   */
  private evictTargetedBackBuffer_(
    type: MediaType,
    operation: {
      execute: () => void;
      onComplete?: () => void;
      onError?: (error: unknown) => void;
    },
    byteLength: number,
    currentTime: number,
    bufferedStart: number,
  ): boolean {
    const { backBufferQuotaPadding } = this.player_.getConfig();
    let evictionEnd = this.segmentTracker_.getEvictionEnd(
      type,
      currentTime,
      byteLength,
    );
    evictionEnd = Math.min(
      evictionEnd + backBufferQuotaPadding,
      currentTime,
    );

    // Not enough back buffer to free the required bytes.
    if (evictionEnd <= bufferedStart) {
      return false;
    }

    this.quotaEvictionPending_.add(type);
    const sb = this.sourceBuffers_.get(type);
    asserts.assertExists(sb, `No SourceBuffer for ${type}`);

    const removeOp = {
      execute: () => {
        sb.remove(bufferedStart, evictionEnd);
      },
    };

    const clearOp = {
      execute: () => {
        this.quotaEvictionPending_.delete(type);
      },
    };

    this.opQueue_.insertNext(type, [removeOp, operation, clearOp]);
    return true;
  }

  /**
   * Tier 2: Aggressively trim back buffer to ~1 segment
   * behind playhead.
   */
  private evictAggressiveBackBuffer_(
    type: MediaType,
    operation: {
      execute: () => void;
      onComplete?: () => void;
      onError?: (error: unknown) => void;
    },
    currentTime: number,
    bufferedStart: number,
  ) {
    const minBackBuffer = Math.max(
      this.segmentTracker_.getLastSegmentDuration(type),
      2,
    );
    const evictionEnd = currentTime - minBackBuffer;

    // Back buffer is already smaller than the minimum
    // we want to keep. Nothing left to evict.
    if (evictionEnd <= bufferedStart) {
      this.quotaEvictionPending_.delete(type);
      return;
    }

    this.quotaEvictionPending_.delete(type);
    const sb = this.sourceBuffers_.get(type);
    asserts.assertExists(sb, `No SourceBuffer for ${type}`);

    const removeOp = {
      execute: () => {
        sb.remove(bufferedStart, evictionEnd);
      },
    };

    this.opQueue_.insertNext(type, [removeOp, operation]);
  }
}

function isQuotaExceededError(error: unknown): error is DOMException {
  if (!(error instanceof DOMException)) {
    return false;
  }
  return (
    error.name === "QuotaExceededError" ||
    error.code === DOMException.QUOTA_EXCEEDED_ERR
  );
}

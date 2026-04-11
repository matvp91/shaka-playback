import type {
  BufferAppendedEvent,
  BufferAppendingEvent,
  BufferCodecsEvent,
  MediaAttachingEvent,
} from "../events";
import { Events } from "../events";
import type { Player } from "../player";
import type { InitSegment, Segment } from "../types/manifest";
import type { MediaType } from "../types/media";
import * as asserts from "../utils/asserts";
import * as CodecUtils from "../utils/codec_utils";
import * as ManifestUtils from "../utils/manifest_utils";
import * as Mp4BoxParser from "../utils/mp4_box_parser";
import type { Operation } from "./operation_queue";
import { OperationQueue } from "./operation_queue";
import { SegmentTracker } from "./segment_tracker";

type InitSegmentInfo = {
  timescale: number;
};

export class BufferController {
  private sourceBuffers_ = new Map<MediaType, SourceBuffer>();
  private opQueue_ = new OperationQueue();
  private mediaSource_: MediaSource | null = null;
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

    const { type, codec } = event;
    const sb = this.sourceBuffers_.get(type);
    const mimeType = CodecUtils.getContentType(type, codec);

    if (sb) {
      this.opQueue_.enqueue(type, {
        execute: () => sb.changeType(mimeType),
      });
      return;
    }

    const newSb = this.mediaSource_.addSourceBuffer(mimeType);
    this.sourceBuffers_.set(type, newSb);
    this.opQueue_.add(type, newSb);

    newSb.addEventListener("updateend", () => {
      this.opQueue_.shiftAndExecuteNext(type);
    });

  };

  private onBufferAppending_ = (event: BufferAppendingEvent) => {
    const { type, data, segment } = event;

    if (ManifestUtils.isInitSegment(segment)) {
      // Handle init segment.
      this.initSegmentInfo_.set(segment, {
        timescale: Mp4BoxParser.parseTimescale(data),
      });
    }

    let timestampOffset: number | undefined;
    if (ManifestUtils.isMediaSegment(segment)) {
      // Handle media segment.
      timestampOffset = this.computeTimestampOffset_(segment, data);
    }

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
          this.evictAndRetryAppend_(type, operation, data.byteLength, error);
        }
      },
    };

    this.opQueue_.enqueue(type, operation);
  };

  /**
   * Derive timestampOffset from init segment timescale
   * and media segment baseMediaDecodeTime.
   */
  private computeTimestampOffset_(segment: Segment, data: ArrayBuffer): number {
    const info = this.initSegmentInfo_.get(segment.initSegment);
    asserts.assertExists(info, "Init segment not parsed");
    const mediaTime =
      Mp4BoxParser.parseBaseMediaDecodeTime(data) / info.timescale;
    return segment.start - mediaTime;
  }

  private onBufferAppended_ = (event: BufferAppendedEvent) => {
    const { type, segment, data } = event;

    // Record byte size for quota-aware eviction decisions.
    if (ManifestUtils.isMediaSegment(segment)) {
      this.segmentTracker_.trackAppend(
        type,
        segment.start,
        segment.end,
        data.byteLength,
      );
    }

    const sb = this.sourceBuffers_.get(type);
    asserts.assertExists(sb, `No SourceBuffer for ${type}`);
    this.segmentTracker_.reconcile(type, sb.buffered);

    const { backBufferLength } = this.player_.getConfig();
    if (Number.isFinite(backBufferLength)) {
      this.evictBackBuffer_(type, backBufferLength);
    }
  };

  /**
   * Evict back buffer that exceeds the configured
   * backBufferLength behind the playhead.
   */
  private evictBackBuffer_(type: MediaType, backBufferLength: number) {
    const media = this.player_.getMedia();
    if (!media) {
      return;
    }
    const sb = this.sourceBuffers_.get(type);
    asserts.assertExists(sb, `No SourceBuffer for ${type}`);
    const bufferedStart = sb.buffered.length > 0 ? sb.buffered.start(0) : null;
    if (bufferedStart === null) {
      return;
    }
    const evictEnd = media.currentTime - backBufferLength;
    if (bufferedStart >= evictEnd) {
      return;
    }
    this.opQueue_.enqueue(
      type,
      this.getFlushOperation_(type, bufferedStart, evictEnd),
    );
  }

  /**
   * Set mediaSource.duration through the operation queue
   * to avoid InvalidStateError when a SourceBuffer is updating.
   */
  private updateDuration_(duration: number) {
    if (this.mediaSource_?.readyState !== "open") {
      return;
    }
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
    operation: Operation,
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

    const bufferedStart = sb.buffered.start(0);
    const currentTime = media.currentTime;

    // Tier 1: evict minimum back buffer to fit the failed
    // segment, plus padding for headroom.
    if (!this.quotaEvictionPending_.has(type)) {
      const { backBufferQuotaPadding } = this.player_.getConfig();
      const evictionEnd = this.segmentTracker_.getEvictionEnd(
        type,
        currentTime,
        byteLength,
      );
      const minEvictionEnd = Math.min(
        evictionEnd + backBufferQuotaPadding,
        currentTime,
      );

      // Targeted eviction is possible when there is enough
      // back buffer to free the required bytes.
      if (minEvictionEnd > bufferedStart) {
        this.quotaEvictionPending_.add(type);
        this.opQueue_.insertNext(type, [
          this.getFlushOperation_(type, bufferedStart, minEvictionEnd),
          operation,
          this.getQuotaEvictedOperation_(type),
        ]);
        return;
      }
    }

    // Tier 2: aggressively trim back buffer to ~1 segment
    // behind playhead.
    this.player_.emit(Events.BUFFER_APPEND_ERROR, {
      type,
      error,
    });

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
    this.opQueue_.insertNext(type, [
      this.getFlushOperation_(type, bufferedStart, evictionEnd),
      operation,
    ]);
  }

  /**
   * Create a remove operation for a SourceBuffer range.
   */
  private getFlushOperation_(
    type: MediaType,
    start: number,
    end: number,
  ): Operation {
    const sb = this.sourceBuffers_.get(type);
    asserts.assertExists(sb, `No SourceBuffer for ${type}`);
    return {
      execute: () => {
        sb.remove(start, end);
      },
    };
  }

  /**
   * Create an operation that clears the quota eviction
   * pending flag for a given type.
   */
  private getQuotaEvictedOperation_(type: MediaType): Operation {
    return {
      execute: () => {
        this.quotaEvictionPending_.delete(type);
      },
    };
  }
}

function isQuotaExceededError(error: unknown): error is DOMException {
  return error instanceof DOMException && error.name === "QuotaExceededError";
}

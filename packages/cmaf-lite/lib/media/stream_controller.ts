import type {
  BufferFlushedEvent,
  ManifestParsedEvent,
  MediaAttachedEvent,
} from "../events";
import { Events } from "../events";
import type { NetworkRequest } from "../net/network_request";
import type { Player } from "../player";
import type { InitSegment, Segment, Track } from "../types/manifest";
import type { Stream, StreamPreference, TypeUnion } from "../types/media";
import { MediaType } from "../types/media";
import { ABORTED, NetworkRequestType } from "../types/net";
import * as ArrayUtils from "../utils/array_utils";
import * as asserts from "../utils/asserts";
import * as BufferUtils from "../utils/buffer_utils";
import { Log } from "../utils/log";
import * as ManifestUtils from "../utils/manifest_utils";
import * as StreamUtils from "../utils/stream_utils";
import { Timer } from "../utils/timer";

const log = Log.create("StreamController");

const TICK_INTERVAL = 0.1;

type MediaState<T extends MediaType = MediaType> = TypeUnion<
  {
    stream: Stream | null;
    lastSegment: Segment | null;
    lastInitSegment: InitSegment | null;
    request: NetworkRequest | null;
    ended: boolean;
    timer: Timer;
  },
  | {
      type: MediaType.VIDEO;
      stream: Stream<MediaType.VIDEO> | null;
    }
  | {
      type: MediaType.AUDIO;
      stream: Stream<MediaType.AUDIO> | null;
    }
  | {
      type: MediaType.TEXT;
      stream: Stream<MediaType.TEXT> | null;
    },
  T
>;

export class StreamController {
  private streamsMap_ = new Map<MediaType, Stream[]>();
  private media_: HTMLMediaElement | null = null;
  private mediaStates_ = new Map<MediaType, MediaState>();
  private preferences_ = new Map<MediaType, StreamPreference>();

  constructor(private player_: Player) {
    this.player_.on(Events.MANIFEST_PARSED, this.onManifestParsed_);
    this.player_.on(Events.MEDIA_ATTACHED, this.onMediaAttached_);
    this.player_.on(Events.MEDIA_DETACHED, this.onMediaDetached_);
    this.player_.on(Events.BUFFER_FLUSHED, this.onBufferFlushed_);
  }

  getStreams(type: MediaType) {
    const list = this.streamsMap_.get(type);
    asserts.assertExists(list, `No streams for ${type}`);
    return list;
  }

  getActiveStream(type: MediaType) {
    const mediaState = this.mediaStates_.get(type);
    return mediaState?.stream ?? null;
  }

  getActiveStreamPreference(type: MediaType) {
    const preference = this.preferences_.get(type);
    asserts.assertExists(preference, `No Preference for ${type}`);
    return preference;
  }

  destroy() {
    const networkService = this.player_.getNetworkService();
    for (const mediaState of this.mediaStates_.values()) {
      if (mediaState.request) {
        networkService.cancel(mediaState.request);
      }
      mediaState.timer.stop();
    }
    this.player_.off(Events.MANIFEST_PARSED, this.onManifestParsed_);
    this.player_.off(Events.MEDIA_ATTACHED, this.onMediaAttached_);
    this.player_.off(Events.MEDIA_DETACHED, this.onMediaDetached_);
    this.player_.off(Events.BUFFER_FLUSHED, this.onBufferFlushed_);
    this.mediaStates_.clear();
    this.preferences_.clear();
  }

  private onManifestParsed_ = (event: ManifestParsedEvent) => {
    this.streamsMap_ = StreamUtils.buildStreams(event.manifest);
    log.info("Streams", this.streamsMap_);
    this.player_.emit(Events.STREAMS_UPDATED, {
      streamsMap: this.streamsMap_,
    });
    this.tryStart_();
  };

  private onMediaAttached_ = (event: MediaAttachedEvent) => {
    this.media_ = event.media;
    this.media_.addEventListener("seeking", this.onSeeking_);
    this.tryStart_();
  };

  private onBufferFlushed_ = (event: BufferFlushedEvent) => {
    const mediaState = this.mediaStates_.get(event.type);
    if (mediaState) {
      mediaState.lastSegment = null;
      mediaState.lastInitSegment = null;
    }
  };

  setPreference(preference: StreamPreference, flushBuffer: boolean) {
    // We can set preferences before we load.
    this.preferences_.set(preference.type, preference);

    const mediaState = this.mediaStates_.get(preference.type);
    if (!mediaState) {
      return;
    }

    const streams = this.streamsMap_.get(preference.type);
    if (!streams) {
      return;
    }
    const stream = StreamUtils.selectStream(streams, preference);
    if (!this.switchStream_(mediaState, stream)) {
      return;
    }

    if (flushBuffer && isAV(mediaState.type)) {
      this.player_.emit(Events.BUFFER_FLUSHING, { type: mediaState.type });
    }

    this.update_(mediaState);
  }

  /**
   * Applies a stream change to a media state. Returns `false`
   * if the stream is already active (no-op).
   */
  private switchStream_(mediaState: MediaState, stream: Stream): boolean {
    const oldStream = mediaState.stream;
    if (stream === oldStream) {
      return false;
    }

    const networkService = this.player_.getNetworkService();
    if (mediaState.request) {
      networkService.cancel(mediaState.request);
    }

    if (
      !oldStream ||
      oldStream.hierarchy.switchingSet !== stream.hierarchy.switchingSet
    ) {
      if (isAV(mediaState.type)) {
        this.player_.emit(Events.BUFFER_CODECS, {
          type: mediaState.type,
          codec: stream.hierarchy.switchingSet.codec,
        });
      }
      // Non-AV types (e.g. text) do not use MSE SourceBuffers,
      // so no codec signalling is needed.
    }

    mediaState.stream = stream;
    mediaState.lastSegment = null;
    mediaState.lastInitSegment = null;

    log.info("Switched stream", stream);

    this.player_.emit(Events.STREAM_CHANGED, {
      oldStream,
      stream,
    });

    return true;
  }

  private onMediaDetached_ = () => {
    const networkService = this.player_.getNetworkService();
    for (const mediaState of this.mediaStates_.values()) {
      if (mediaState.request) {
        networkService.cancel(mediaState.request);
      }
      mediaState.timer.stop();
    }
    this.media_?.removeEventListener("seeking", this.onSeeking_);
    this.media_ = null;
  };

  private tryStart_() {
    if (!this.media_) {
      return;
    }

    for (const [type, streams] of this.streamsMap_) {
      const preference = this.preferences_.get(type) ?? { type };
      this.preferences_.set(type, preference);
      const stream = StreamUtils.selectStream(streams, preference);

      const mediaState: MediaState = {
        type,
        stream: null,
        ended: false,
        lastSegment: null,
        lastInitSegment: null,
        request: null,
        timer: new Timer(() => this.update_(mediaState)),
      };

      this.mediaStates_.set(type, mediaState);
      this.switchStream_(mediaState, stream);
    }

    for (const mediaState of this.mediaStates_.values()) {
      mediaState.timer.tickEvery(TICK_INTERVAL);
    }
  }

  /**
   * Core streaming tick. Finds the next segment to fetch
   * via sequential index or time-based lookup.
   */
  private update_(mediaState: MediaState) {
    if (!mediaState.stream) {
      return;
    }
    if (mediaState.ended || mediaState.request?.inFlight) {
      return;
    }
    if (!this.media_) {
      return;
    }

    const currentTime = this.media_.currentTime;
    const frontBufferLength = this.player_.getConfig().frontBufferLength;
    const bufferEnd = this.getBufferEnd_(mediaState.type, currentTime);

    if (bufferEnd !== null && bufferEnd - currentTime >= frontBufferLength) {
      return;
    }

    let segment = this.getNextSegment_(mediaState);
    if (!segment) {
      if (this.isEnded_(mediaState)) {
        mediaState.ended = true;
        this.checkEndOfStream_();
        return;
      }

      const lookupTime =
        bufferEnd ?? Math.max(0, currentTime - /* maybeSegmentSize= */ 4);
      segment = this.getSegmentForTime_(
        mediaState.stream.hierarchy.track,
        lookupTime,
      );
      log.debug(`Segment by time at ${lookupTime}`, segment);
    } else {
      log.debug(`Segment by index`, segment);
    }

    if (!segment) {
      mediaState.ended = true;
      this.checkEndOfStream_();
      return;
    }

    if (segment.initSegment !== mediaState.lastInitSegment) {
      this.loadSegment_(mediaState, segment.initSegment);
    } else {
      this.loadSegment_(mediaState, segment);
    }
  }

  private async loadSegment_(
    mediaState: MediaState,
    segment: Segment | InitSegment,
  ) {
    const networkService = this.player_.getNetworkService();
    const config = this.player_.getConfig();

    mediaState.request = networkService.request(
      NetworkRequestType.SEGMENT,
      segment.url,
      config.segmentRequestOptions,
    );

    const response = await mediaState.request.promise;
    if (response === ABORTED) {
      return;
    }

    // Update mediaState AFTER we fetched, it means that we
    // sent this segment to the buffer controller.
    if (ManifestUtils.isInitSegment(segment)) {
      mediaState.lastInitSegment = segment;
    }
    if (ManifestUtils.isMediaSegment(segment)) {
      mediaState.lastSegment = segment;
    }

    if (isAV(mediaState.type)) {
      // If audio or video, we can send it to the buffer controller.
      this.player_.emit(Events.BUFFER_APPENDING, {
        type: mediaState.type,
        segment,
        data: response.arrayBuffer,
      });
    }
  }

  private getBufferEnd_(type: MediaType, time: number): number | null {
    const { maxBufferHole } = this.player_.getConfig();
    const buffered = this.player_.getBuffered(type);
    return BufferUtils.getBufferedEnd(buffered, time, maxBufferHole);
  }

  private getNextSegment_(mediaState: MediaState): Segment | null {
    if (!mediaState.lastSegment) {
      return null;
    }
    asserts.assertExists(mediaState.stream, `No Stream for ${mediaState.type}`);
    const { segments } = mediaState.stream.hierarchy.track;
    const lastIndex = segments.indexOf(mediaState.lastSegment);
    return segments[lastIndex + 1] ?? null;
  }

  private getSegmentForTime_(track: Track, time: number): Segment | null {
    const { maxSegmentLookupTolerance } = this.player_.getConfig();
    return ArrayUtils.binarySearch(track.segments, (seg) => {
      if (time >= seg.start && time < seg.end) {
        return 0;
      }
      if (time < seg.start) {
        const tolerance = Math.min(
          maxSegmentLookupTolerance,
          seg.end - seg.start,
        );
        if (seg.start - tolerance > time && seg.start > 0) {
          return -1;
        }
        return 0;
      }
      return 1;
    });
  }

  private isEnded_(mediaState: MediaState): boolean {
    if (!mediaState.lastSegment) {
      return false;
    }
    asserts.assertExists(mediaState.stream, `No Stream for ${mediaState.type}`);
    const { segments } = mediaState.stream.hierarchy.track;
    return segments.indexOf(mediaState.lastSegment) === segments.length - 1;
  }

  private checkEndOfStream_() {
    const allDone = [...this.mediaStates_.values()].every((ms) => ms.ended);
    if (allDone) {
      this.player_.emit(Events.BUFFER_EOS);
    }
  }

  private onSeeking_ = () => {
    for (const mediaState of this.mediaStates_.values()) {
      mediaState.ended = false;
      if (mediaState.request) {
        const networkService = this.player_.getNetworkService();
        networkService.cancel(mediaState.request);
      }
      mediaState.lastSegment = null;
      this.update_(mediaState);
    }
  };
}

function isAV(type: MediaType) {
  return type === MediaType.AUDIO || type === MediaType.VIDEO;
}

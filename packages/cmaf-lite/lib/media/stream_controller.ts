import type {
  BufferFlushedEvent,
  ManifestParsedEvent,
  MediaAttachedEvent,
  StreamPreferenceChangedEvent,
} from "../events";
import { Events } from "../events";
import type { Player } from "../player";
import type { InitSegment, Segment, Track } from "../types/manifest";
import type { Stream, StreamPreference } from "../types/media";
import { MediaType } from "../types/media";
import type { NetworkRequest } from "../types/net";
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

type MediaState = {
  type: MediaType;
  stream: Stream;
  lastSegment: Segment | null;
  lastInitSegment: InitSegment | null;
  request: NetworkRequest | null;
  ended: boolean;
  timer: Timer;
};

export class StreamController {
  private streams_: Map<MediaType, Stream[]> | null = null;
  private media_: HTMLMediaElement | null = null;
  private mediaStates_ = new Map<MediaType, MediaState>();
  private preferences_ = new Map<MediaType, StreamPreference>();

  constructor(private player_: Player) {
    this.player_.on(Events.MANIFEST_PARSED, this.onManifestParsed_);
    this.player_.on(Events.MEDIA_ATTACHED, this.onMediaAttached_);
    this.player_.on(Events.MEDIA_DETACHED, this.onMediaDetached_);
    this.player_.on(
      Events.STREAM_PREFERENCE_CHANGED,
      this.onStreamPreferenceChanged_,
    );
    this.player_.on(Events.BUFFER_FLUSHED, this.onBufferFlushed_);
  }

  getStreams(type: MediaType) {
    asserts.assertExists(this.streams_, "No Streams");
    const list = this.streams_.get(type);
    asserts.assertExists(list, `No streams for ${type}`);
    return list;
  }

  getActiveStream(type: MediaType) {
    const mediaState = this.mediaStates_.get(type);
    asserts.assertExists(mediaState, `No Media State for ${type}`);
    return mediaState.stream;
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
    this.player_.off(
      Events.STREAM_PREFERENCE_CHANGED,
      this.onStreamPreferenceChanged_,
    );
    this.player_.off(Events.BUFFER_FLUSHED, this.onBufferFlushed_);
    this.streams_ = null;
    this.mediaStates_.clear();
    this.preferences_.clear();
  }

  private onManifestParsed_ = (event: ManifestParsedEvent) => {
    this.streams_ = StreamUtils.buildStreams(event.manifest);
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

  private onStreamPreferenceChanged_ = (
    event: StreamPreferenceChangedEvent,
  ) => {
    const { preference } = event;
    // We can set preferences before we load.
    this.preferences_.set(preference.type, preference);

    const mediaState = this.mediaStates_.get(preference.type);
    if (!mediaState || !this.streams_) {
      return;
    }

    const streams = this.streams_.get(preference.type);
    if (!streams) {
      return;
    }
    const stream = StreamUtils.selectStream(streams, preference);
    if (stream === mediaState.stream) {
      return;
    }

    const networkService = this.player_.getNetworkService();
    if (mediaState.request) {
      networkService.cancel(mediaState.request);
    }

    // NOTE: the codec-change check MUST run before `mediaState.stream = stream`.
    // Otherwise both sides resolve to the new stream's switching set and the
    // comparison collapses to equality, skipping BUFFER_CODECS / MSE changeType.
    if (
      stream.hierarchy.switchingSet !== mediaState.stream.hierarchy.switchingSet
    ) {
      if (isAV(mediaState.type)) {
        this.player_.emit(Events.BUFFER_CODECS, {
          type: mediaState.type,
          codec: stream.hierarchy.switchingSet.codec,
        });
      } else {
        // TODO(matvp): We shall figure out what to do with types
        // that do not rely on MSE. Such as text.
      }
    }

    log.info("Switched stream", stream);
    mediaState.stream = stream;
    mediaState.lastSegment = null;
    mediaState.lastInitSegment = null;

    if (event.flushBuffer && isAV(mediaState.type)) {
      this.player_.emit(Events.BUFFER_FLUSHING, { type: mediaState.type });
    }

    this.update_(mediaState);
  };

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
    if (!this.streams_ || !this.media_) {
      return;
    }

    for (const [type, streams] of this.streams_) {
      const preference = this.preferences_.get(type) ?? { type };
      this.preferences_.set(type, preference);
      const stream = StreamUtils.selectStream(streams, preference);

      const mediaState: MediaState = {
        type,
        stream,
        ended: false,
        lastSegment: null,
        lastInitSegment: null,
        request: null,
        timer: new Timer(() => this.update_(mediaState)),
      };
      log.info(`MediaState ${type}`, stream);

      this.mediaStates_.set(type, mediaState);

      if (isAV(type)) {
        this.player_.emit(Events.BUFFER_CODECS, {
          type,
          codec: stream.hierarchy.switchingSet.codec,
        });
      }
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
      const { maxSegmentLookupTolerance } = this.player_.getConfig();
      const lookupTime =
        bufferEnd ?? Math.max(0, currentTime - maxSegmentLookupTolerance);
      segment = this.getSegmentForTime_(
        mediaState.stream.hierarchy.track,
        lookupTime,
        maxSegmentLookupTolerance,
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

  /**
   * Fetch an init or media segment and emit
   * BUFFER_APPENDING. State is updated only after
   * the fetch resolves.
   */
  private async loadSegment_(
    mediaState: MediaState,
    segment: Segment | InitSegment,
  ) {
    const networkService = this.player_.getNetworkService();
    mediaState.request = networkService.request(
      NetworkRequestType.SEGMENT,
      segment.url,
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
    const { segments } = mediaState.stream.hierarchy.track;
    const lastIndex = segments.indexOf(mediaState.lastSegment);
    return segments[lastIndex + 1] ?? null;
  }

  /**
   * Binary search for the segment containing the given
   * time.
   */
  private getSegmentForTime_(
    track: Track,
    time: number,
    maxTolerance: number,
  ): Segment | null {
    return ArrayUtils.binarySearch(track.segments, (seg) => {
      if (time >= seg.start && time < seg.end) {
        return 0;
      }
      if (time < seg.start) {
        const tolerance = Math.min(maxTolerance, seg.end - seg.start);
        if (seg.start - tolerance > time && seg.start > 0) {
          return -1;
        }
        return 0;
      }
      return 1;
    });
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

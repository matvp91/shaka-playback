import type {
  ManifestParsedEvent,
  MediaAttachedEvent,
  StreamPreferenceChangedEvent,
} from "../events";
import { Events } from "../events";
import type { Player } from "../player";
import type {
  InitSegment,
  Manifest,
  Segment,
  SwitchingSet,
  Track,
} from "../types/manifest";
import type {
  ByType,
  MediaType,
  Stream,
  StreamPreference,
} from "../types/media";
import type { NetworkRequest } from "../types/net";
import { ABORTED, NetworkRequestType } from "../types/net";
import * as ArrayUtils from "../utils/array_utils";
import * as asserts from "../utils/asserts";
import * as BufferUtils from "../utils/buffer_utils";
import * as ManifestUtils from "../utils/manifest_utils";
import * as StreamUtils from "../utils/stream_utils";
import { Timer } from "../utils/timer";

const TICK_INTERVAL = 0.1;

type MediaState<T extends MediaType = MediaType> = {
  type: T;
  stream: ByType<Stream, T>;
  switchingSet: SwitchingSet;
  track: ByType<Track, T>;
  lastSegment: Segment | null;
  lastInitSegment: InitSegment | null;
  request: NetworkRequest | null;
  ended: boolean;
  timer: Timer;
};

/**
 * Remap a segment to the equivalent position in a
 * different track. CMAF guarantees aligned segments
 * within a SwitchingSet.
 */
function remapSegment(
  oldTrack: Track,
  newTrack: Track,
  lastSegment: Segment,
): Segment {
  const index = oldTrack.segments.indexOf(lastSegment);
  asserts.assert(index !== -1, "Segment not found in old track");
  const segment = newTrack.segments[index];
  asserts.assertExists(segment, "Segment index out of bounds in new track");
  return segment;
}

export class StreamController {
  private manifest_: Manifest | null = null;
  private streams_: Stream[] | null = null;
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
  }

  getStreams() {
    asserts.assertExists(this.streams_, "No Streams");
    return this.streams_;
  }

  getActiveStream(type: MediaType) {
    const mediaState = this.mediaStates_.get(type);
    asserts.assertExists(mediaState, `No Media State for ${type}`);
    return mediaState.stream;
  }

  destroy() {
    const networkService = this.player_.getNetworkService();
    for (const mediaState of this.mediaStates_.values()) {
      if (mediaState.request) {
        networkService.cancel(mediaState.request);
      }
      mediaState.timer.destroy();
    }
    this.player_.off(Events.MANIFEST_PARSED, this.onManifestParsed_);
    this.player_.off(Events.MEDIA_ATTACHED, this.onMediaAttached_);
    this.player_.off(Events.MEDIA_DETACHED, this.onMediaDetached_);
    this.player_.off(
      Events.STREAM_PREFERENCE_CHANGED,
      this.onStreamPreferenceChanged_,
    );
    this.manifest_ = null;
    this.streams_ = null;
    this.mediaStates_.clear();
    this.preferences_.clear();
  }

  private onManifestParsed_ = (event: ManifestParsedEvent) => {
    this.manifest_ = event.manifest;
    this.streams_ = StreamUtils.getStreams(this.manifest_);
    this.tryStart_();
  };

  private onMediaAttached_ = (event: MediaAttachedEvent) => {
    this.media_ = event.media;
    this.media_.addEventListener("seeking", this.onSeeking_);
    this.tryStart_();
  };

  private onStreamPreferenceChanged_ = (
    event: StreamPreferenceChangedEvent,
  ) => {
    const { preference } = event;
    // We can set preferences before we load.
    this.preferences_.set(preference.type, preference);

    const mediaState = this.mediaStates_.get(preference.type);
    if (!mediaState || !this.manifest_) {
      return;
    }

    const stream = StreamUtils.selectStream(this.getStreams(), preference);
    if (stream === mediaState.stream) {
      return;
    }

    const networkService = this.player_.getNetworkService();
    if (mediaState.request) {
      networkService.cancel(mediaState.request);
    }

    const oldTrack = mediaState.track;
    const [switchingSet, track] = StreamUtils.resolveHierarchy(
      this.manifest_,
      stream,
    );

    if (switchingSet !== mediaState.switchingSet) {
      this.player_.emit(Events.BUFFER_CODECS, {
        type: mediaState.type,
        codec: switchingSet.codec,
        duration: this.manifest_.duration,
      });
    }

    if (track !== oldTrack && mediaState.lastSegment) {
      if (switchingSet === mediaState.switchingSet) {
        mediaState.lastSegment = remapSegment(
          oldTrack,
          track,
          mediaState.lastSegment,
        );
      } else {
        // Codec switch: segments may not align across
        // SwitchingSets, use time-based lookup to find
        // position in new track.
        const lookupTime = mediaState.lastSegment.end;
        mediaState.lastSegment = this.getSegmentForTime_(track, lookupTime);
      }
    }

    mediaState.stream = stream;
    mediaState.switchingSet = switchingSet;
    mediaState.track = track;
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
    if (!this.manifest_ || !this.media_) {
      return;
    }

    const streams = this.getStreams();
    const types = new Set(streams.map((s) => s.type));

    for (const type of types) {
      const preference = this.preferences_.get(type) ?? { type };
      this.preferences_.set(type, preference);
      const stream = StreamUtils.selectStream(streams, preference);
      const [switchingSet, track] = StreamUtils.resolveHierarchy(
        this.manifest_,
        stream,
      );

      const mediaState: MediaState = {
        type,
        stream,
        switchingSet,
        track,
        ended: false,
        lastSegment: null,
        lastInitSegment: null,
        request: null,
        timer: new Timer(() => this.update_(mediaState)),
      };

      this.mediaStates_.set(type, mediaState);

      this.player_.emit(Events.BUFFER_CODECS, {
        type,
        codec: switchingSet.codec,
        duration: this.manifest_.duration,
      });
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
      const lookupTime = bufferEnd ?? currentTime;
      segment = this.getSegmentForTime_(mediaState.track, lookupTime);
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

    this.player_.emit(Events.BUFFER_APPENDING, {
      type: mediaState.type,
      segment,
      data: response.arrayBuffer,
    });
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
    const { segments } = mediaState.track;
    const lastIndex = segments.indexOf(mediaState.lastSegment);
    return segments[lastIndex + 1] ?? null;
  }

  /**
   * Binary search for the segment containing the given
   * time.
   */
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

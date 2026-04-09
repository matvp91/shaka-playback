import type {
  ManifestParsedEvent,
  MediaAttachedEvent,
  StreamPreferenceChangedEvent,
} from "../events";
import { Events } from "../events";
import type { NetworkService } from "../net/network_service";
import type { Player } from "../player";
import type {
  InitSegment,
  Manifest,
  MediaType,
  Presentation,
  Segment,
  Stream,
  StreamPreference,
  Track,
} from "../types";
import type { Request } from "../types/net";
import { ABORTED, RequestType } from "../types/net";
import { binarySearch } from "../utils/array";
import { assertNotVoid } from "../utils/assert";
import { getBufferedEnd } from "../utils/buffer";
import { getContentType } from "../utils/codec";
import {
  getStreams,
  resolveTrack,
  selectStream,
} from "../utils/stream_select";
import { Timer } from "../utils/timer";

const TICK_INTERVAL = 0.1;

type MediaState = {
  type: MediaType;
  stream: Stream;
  ended: boolean;
  presentation: Presentation;
  track: Track;
  lastSegment: Segment | null;
  lastInitSegment: InitSegment | null;
  lastRequest: Request<"arrayBuffer"> | null;
  timer: Timer;
};

export class StreamController {
  private manifest_: Manifest | null = null;
  private media_: HTMLMediaElement | null = null;
  private mediaStates_ = new Map<MediaType, MediaState>();
  private preferences_ = new Map<MediaType, StreamPreference>();

  constructor(
    private player_: Player,
    private networkService_: NetworkService,
  ) {
    this.player_.on(Events.MANIFEST_PARSED, this.onManifestParsed_);
    this.player_.on(Events.MEDIA_ATTACHED, this.onMediaAttached_);
    this.player_.on(Events.MEDIA_DETACHED, this.onMediaDetached_);
    this.player_.on(
      Events.STREAM_PREFERENCE_CHANGED,
      this.onStreamPreferenceChanged_,
    );
  }

  getStreams() {
    assertNotVoid(this.manifest_, "No Manifest");
    return getStreams(this.manifest_);
  }

  destroy() {
    for (const mediaState of this.mediaStates_.values()) {
      if (mediaState.lastRequest) {
        this.networkService_.cancel(mediaState.lastRequest);
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
    this.mediaStates_.clear();
    this.preferences_.clear();
  }

  private onManifestParsed_ = (event: ManifestParsedEvent) => {
    this.manifest_ = event.manifest;
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
    this.preferences_.set(preference.type, preference);

    const mediaState = this.mediaStates_.get(preference.type);
    if (!mediaState || !this.manifest_) {
      return;
    }

    if (mediaState.lastRequest) {
      this.networkService_.cancel(mediaState.lastRequest);
    }

    const { stream, action } = selectStream(
      this.getStreams(),
      mediaState.type,
      mediaState.stream,
      preference,
    );

    if (action === "none") {
      return;
    }

    if (action === "changeType") {
      this.player_.emit(Events.BUFFER_CODECS, {
        type: mediaState.type,
        mimeType: getContentType(mediaState.type, stream.codec),
      });
    }

    mediaState.stream = stream;
    mediaState.track = resolveTrack(
      mediaState.presentation,
      stream,
    );
    mediaState.lastSegment = null;
    mediaState.lastInitSegment = null;
  };

  private onMediaDetached_ = () => {
    for (const mediaState of this.mediaStates_.values()) {
      if (mediaState.lastRequest) {
        this.networkService_.cancel(mediaState.lastRequest);
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

    const presentation = this.manifest_.presentations[0];
    assertNotVoid(presentation, "No Presentation found");

    const streams = this.getStreams();
    const types = new Set(streams.map((s) => s.type));

    for (const type of types) {
      const preference = this.preferences_.get(type);
      const { stream } = selectStream(
        streams,
        type,
        undefined,
        preference,
      );
      const track = resolveTrack(presentation, stream);

      const mediaState: MediaState = {
        type,
        stream,
        ended: false,
        presentation,
        track,
        lastSegment: null,
        lastInitSegment: null,
        lastRequest: null,
        timer: new Timer(() => this.update_(mediaState)),
      };

      this.mediaStates_.set(type, mediaState);

      this.player_.emit(Events.BUFFER_CODECS, {
        type,
        mimeType: getContentType(type, stream.codec),
      });
    }

    for (const mediaState of this.mediaStates_.values()) {
      mediaState.timer.tickEvery(TICK_INTERVAL);
    }
  }

  /**
   * Core streaming decision for a single track. Runs every
   * 100ms tick — kicks off async fetch but does not await.
   */
  private update_(mediaState: MediaState) {
    if (mediaState.ended || mediaState.lastRequest?.inFlight) {
      return;
    }
    if (!this.media_) {
      return;
    }

    const currentTime = this.media_.currentTime;
    const bufferGoal = this.player_.getConfig().bufferGoal;
    const bufferEnd = this.getBufferEnd_(mediaState.type, currentTime);

    if (bufferEnd !== null && bufferEnd - currentTime >= bufferGoal) {
      return;
    }

    const lookupTime = bufferEnd ?? currentTime;

    const segment = mediaState.lastSegment
      ? this.getNextSegment_(mediaState)
      : this.getSegmentForTime_(mediaState.track, lookupTime);

    if (!segment) {
      this.advanceOrEnd_(mediaState, lookupTime);
      return;
    }

    if (mediaState.track.initSegment !== mediaState.lastInitSegment) {
      this.loadSegment_(mediaState, mediaState.track.initSegment, null);
      return;
    }

    this.loadSegment_(mediaState, mediaState.track.initSegment, segment);
  }

  /**
   * No segment found — advance to next presentation
   * or signal end of stream.
   */
  private advanceOrEnd_(mediaState: MediaState, lookupTime: number) {
    // Sequential path resolves at the presentation
    // boundary. Time-based path (seek or buffer-lost)
    // resolves at the lookup time.
    const time = mediaState.lastSegment
      ? mediaState.presentation.end
      : lookupTime;

    const presentation = this.getPresentationForTime_(time);
    if (!presentation) {
      mediaState.ended = true;
      this.checkEndOfStream_();
      return;
    }

    if (presentation !== mediaState.presentation) {
      mediaState.presentation = presentation;
      mediaState.track = resolveTrack(
        presentation,
        mediaState.stream,
      );
      mediaState.lastSegment = null;
      return;
    }

    // Same presentation, no segment — check EOS.
    // Float precision means bufferEnd may never
    // exactly reach the duration (Shaka v2).
    const duration = this.computeDuration_();
    if (lookupTime >= duration - 1e-6) {
      mediaState.ended = true;
      this.checkEndOfStream_();
    }
  }

  /**
   * Fetch an init or media segment and emit BUFFER_APPENDING.
   * State is updated only after the fetch resolves.
   */
  private async loadSegment_(
    mediaState: MediaState,
    initSegment: InitSegment,
    segment: Segment | null,
  ) {
    const url = segment?.url ?? initSegment.url;

    mediaState.lastRequest = this.networkService_.request(
      RequestType.SEGMENT,
      url,
      "arrayBuffer",
    );

    const result = await mediaState.lastRequest.promise;
    if (result === ABORTED) {
      return;
    }

    if (segment) {
      mediaState.lastSegment = segment;
    } else {
      mediaState.lastInitSegment = initSegment;
    }

    this.player_.emit(Events.BUFFER_APPENDING, {
      type: mediaState.type,
      initSegment,
      segment,
      data: result.data,
    });
  }

  /**
   * Returns the first presentation whose end is past the
   * given time, handling gaps and float-precision at boundaries.
   */
  private getPresentationForTime_(time: number): Presentation | null {
    if (!this.manifest_) {
      return null;
    }
    for (const p of this.manifest_.presentations) {
      if (time < p.end) {
        return p;
      }
    }
    return null;
  }

  private getBufferEnd_(type: MediaType, time: number): number | null {
    const { maxBufferHole } = this.player_.getConfig();
    const buffered = this.player_.getBuffered(type);
    return getBufferedEnd(buffered, time, maxBufferHole);
  }

  private getNextSegment_(mediaState: MediaState): Segment | null {
    const { segments } = mediaState.track;
    assertNotVoid(mediaState.lastSegment, "No last segment");
    const lastIndex = segments.indexOf(mediaState.lastSegment);
    return segments[lastIndex + 1] ?? null;
  }

  /**
   * Binary search for the segment containing the given time.
   */
  private getSegmentForTime_(track: Track, time: number): Segment | null {
    const { maxSegmentLookupTolerance } = this.player_.getConfig();
    return binarySearch(track.segments, (seg) => {
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

  private computeDuration_(): number {
    const end = this.manifest_?.presentations.at(-1)?.end;
    assertNotVoid(end, "Cannot compute duration");
    return end;
  }

  private onSeeking_ = () => {
    for (const mediaState of this.mediaStates_.values()) {
      mediaState.ended = false;
      if (mediaState.lastRequest) {
        this.networkService_.cancel(mediaState.lastRequest);
      }
      mediaState.lastSegment = null;
      this.update_(mediaState);
    }
  };
}

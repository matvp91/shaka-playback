import type {
  BufferAppendedEvent,
  BufferCreatedEvent,
  ManifestParsedEvent,
  MediaAttachedEvent,
} from "../events";
import { Events } from "../events";
import type { Player } from "../player";
import type {
  InitSegment,
  Manifest,
  MediaType,
  Presentation,
  Segment,
  SelectionSet,
  SwitchingSet,
  Track,
} from "../types/manifest";
import { binarySearch } from "../utils/array";
import { assertNotVoid } from "../utils/assert";
import { getBufferInfo } from "../utils/buffer";
import { Timer } from "../utils/timer";

const TICK_INTERVAL = 0.1;

enum State {
  STOPPED,
  IDLE,
  LOADING,
  ENDED,
}

type MediaState = {
  state: State;
  presentation: Presentation;
  selectionSet: SelectionSet;
  switchingSet: SwitchingSet;
  track: Track;
  lastSegment: Segment | null;
  lastInitSegment: InitSegment | null;
  timer: Timer;
};

export class StreamController {
  private manifest_: Manifest | null = null;
  private media_: HTMLMediaElement | null = null;
  private mediaStates_ = new Map<MediaType, MediaState>();
  private sourceBuffers_ = new Map<MediaType, SourceBuffer>();

  constructor(private player_: Player) {
    this.player_.on(Events.MANIFEST_PARSED, this.onManifestParsed_);
    this.player_.on(Events.MEDIA_ATTACHED, this.onMediaAttached_);
    this.player_.on(Events.MEDIA_DETACHED, this.onMediaDetached_);
    this.player_.on(Events.BUFFER_CREATED, this.onBufferCreated_);
    this.player_.on(Events.BUFFER_APPENDED, this.onBufferAppended_);
  }

  destroy() {
    for (const mediaState of this.mediaStates_.values()) {
      mediaState.timer.destroy();
    }
    this.player_.off(Events.MANIFEST_PARSED, this.onManifestParsed_);
    this.player_.off(Events.MEDIA_ATTACHED, this.onMediaAttached_);
    this.player_.off(Events.MEDIA_DETACHED, this.onMediaDetached_);
    this.player_.off(Events.BUFFER_CREATED, this.onBufferCreated_);
    this.player_.off(Events.BUFFER_APPENDED, this.onBufferAppended_);
    this.manifest_ = null;
    this.mediaStates_.clear();
    this.sourceBuffers_.clear();
  }

  private onManifestParsed_ = (event: ManifestParsedEvent) => {
    this.manifest_ = event.manifest;
    this.tryStart_();
  };

  private onMediaAttached_ = (event: MediaAttachedEvent) => {
    this.media_ = event.media;
    this.tryStart_();
  };

  private onBufferCreated_ = (event: BufferCreatedEvent) => {
    this.sourceBuffers_ = event.sourceBuffers;
  };

  private onBufferAppended_ = (event: BufferAppendedEvent) => {
    const mediaState = this.mediaStates_.get(event.type);
    if (mediaState?.state === State.LOADING) {
      mediaState.state = State.IDLE;
    }
  };

  private onMediaDetached_ = () => {
    for (const mediaState of this.mediaStates_.values()) {
      mediaState.state = State.STOPPED;
      mediaState.timer.stop();
    }
    this.media_ = null;
  };

  private tryStart_() {
    if (!this.manifest_ || !this.media_) {
      return;
    }

    const presentation = this.manifest_.presentations[0];
    assertNotVoid(presentation, "No Presentation found");

    const codecTracks = new Map<
      MediaType,
      { mimeType: string; codec: string }
    >();

    for (const selectionSet of presentation.selectionSets) {
      const switchingSet = selectionSet.switchingSets[0];
      assertNotVoid(switchingSet, "No SwitchingSet available");

      const track = switchingSet.tracks[0];
      assertNotVoid(track, "No Track available");

      const mediaState: MediaState = {
        state: State.IDLE,
        presentation,
        selectionSet,
        switchingSet,
        track,
        lastSegment: null,
        lastInitSegment: null,
        timer: new Timer(() => this.onUpdate_(mediaState)),
      };

      this.mediaStates_.set(selectionSet.type, mediaState);

      codecTracks.set(selectionSet.type, {
        mimeType: switchingSet.mimeType,
        codec: switchingSet.codec,
      });
    }

    this.player_.emit(Events.BUFFER_CODECS, {
      tracks: codecTracks,
      duration: this.computeDuration_(),
    });

    for (const mediaState of this.mediaStates_.values()) {
      mediaState.timer.tickEvery(TICK_INTERVAL);
    }
  }

  /**
   * Core streaming decision for a single track.
   * Runs every tick on a 100ms interval.
   */
  private update_(mediaState: MediaState) {
    if (mediaState.state !== State.IDLE) {
      return;
    }
    if (!this.media_) {
      return;
    }

    const type = mediaState.selectionSet.type;
    const currentTime = this.media_.currentTime;
    const bufferGoal = this.player_.getConfig().bufferGoal;
    const bufferEnd = this.getBufferEnd_(type, currentTime);

    if (bufferEnd !== null && bufferEnd - currentTime >= bufferGoal) {
      return;
    }

    if (bufferEnd === null) {
      mediaState.lastSegment = null;
    }

    const lookupTime = bufferEnd ?? currentTime;

    if (!this.resolvePresentation_(mediaState, lookupTime)) {
      return;
    }

    if (mediaState.track.initSegment !== mediaState.lastInitSegment) {
      this.loadInitSegment_(mediaState);
      return;
    }

    const segment = mediaState.lastSegment
      ? this.getNextSegment_(mediaState)
      : this.getSegmentForTime_(mediaState.track, lookupTime);

    if (segment) {
      this.loadSegment_(mediaState, segment);
      return;
    }

    this.checkEndOfStream_();
  }

  private onUpdate_(mediaState: MediaState) {
    this.update_(mediaState);
  }

  /**
   * Get the end of the buffered range containing
   * the given time for a specific media type.
   */
  private getBufferEnd_(type: MediaType, time: number): number | null {
    const sb = this.sourceBuffers_.get(type);
    if (!sb) {
      return null;
    }
    const { maxBufferHole } = this.player_.getConfig();
    const info = getBufferInfo(sb.buffered, time, maxBufferHole);
    return info ? info.end : null;
  }

  /**
   * Resolve the presentation chain for the given
   * time. Updates the full MediaState chain when
   * the presentation changes.
   */
  private resolvePresentation_(mediaState: MediaState, time: number): boolean {
    if (!this.manifest_) {
      return false;
    }

    const presentation = this.getPresentationForTime_(time);
    if (!presentation) {
      mediaState.state = State.ENDED;
      this.checkEndOfStream_();
      return false;
    }

    if (presentation === mediaState.presentation) {
      return true;
    }

    const type = mediaState.selectionSet.type;
    const selectionSet = presentation.selectionSets.find(
      (s) => s.type === type,
    );
    assertNotVoid(selectionSet, `No SelectionSet for ${type} in Presentation`);

    const switchingSet = selectionSet.switchingSets[0];
    assertNotVoid(switchingSet, "No SwitchingSet in Presentation");

    const track = switchingSet.tracks[0];
    assertNotVoid(track, "No Track in Presentation");

    mediaState.presentation = presentation;
    mediaState.selectionSet = selectionSet;
    mediaState.switchingSet = switchingSet;
    mediaState.track = track;
    mediaState.lastSegment = null;

    return true;
  }

  /**
   * Find the presentation that contains the
   * given time.
   */
  private getPresentationForTime_(time: number): Presentation | null {
    if (!this.manifest_) {
      return null;
    }
    for (const p of this.manifest_.presentations) {
      if (time >= p.start && time < p.end) {
        return p;
      }
    }
    return null;
  }

  /**
   * Find the next segment after lastSegment
   * in the current track.
   */
  private getNextSegment_(mediaState: MediaState): Segment | null {
    const { segments } = mediaState.track;
    assertNotVoid(mediaState.lastSegment, "No last segment");
    const lastIndex = segments.indexOf(mediaState.lastSegment);
    return segments[lastIndex + 1] ?? null;
  }

  /**
   * Binary search for the segment containing the
   * given time. Returns null if no segment matches.
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
    const allDone = [...this.mediaStates_.values()].every(
      (ms) => ms.state === State.ENDED,
    );
    if (allDone) {
      this.player_.emit(Events.BUFFER_EOS);
    }
  }

  /** Get total presentation duration. */
  private computeDuration_(): number {
    const end = this.manifest_?.presentations.at(-1)?.end;
    assertNotVoid(end, "Cannot compute duration");
    return end;
  }

  private async loadInitSegment_(mediaState: MediaState) {
    const { initSegment } = mediaState.track;

    if (mediaState.lastInitSegment === initSegment) {
      return;
    }

    mediaState.state = State.LOADING;

    const response = await fetch(initSegment.url);
    const data = await response.arrayBuffer();

    if (mediaState.state !== State.LOADING) {
      return;
    }

    mediaState.lastInitSegment = initSegment;

    this.player_.emit(Events.BUFFER_APPENDING, {
      type: mediaState.selectionSet.type,
      initSegment,
      data,
      segment: null,
    });
  }

  private async loadSegment_(mediaState: MediaState, segment: Segment) {
    mediaState.state = State.LOADING;
    mediaState.lastSegment = segment;

    const response = await fetch(segment.url);
    const data = await response.arrayBuffer();

    if (mediaState.state !== State.LOADING) {
      return;
    }

    this.player_.emit(Events.BUFFER_APPENDING, {
      type: mediaState.selectionSet.type,
      initSegment: mediaState.track.initSegment,
      segment,
      data,
    });
  }
}

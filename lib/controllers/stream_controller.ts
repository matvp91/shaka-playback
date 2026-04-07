import type {
  BufferAppendedEvent,
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
import { assertNotVoid } from "../utils/assert";
import { Timer } from "../utils/timer";

enum State {
  STOPPED,
  IDLE,
  LOADING_INIT,
  LOADING_SEGMENT,
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
  }

  private onManifestParsed_ = (event: ManifestParsedEvent) => {
    this.manifest_ = event.manifest;
    this.tryStart_();
  };

  private onMediaAttached_ = (event: MediaAttachedEvent) => {
    this.media_ = event.media;
    this.tryStart_();
  };

  private onMediaDetached_ = () => {
    this.stopMediaStates_();
    this.media_ = null;
  };

  private onBufferCreated_ = () => {
    for (const mediaState of this.mediaStates_.values()) {
      this.loadInitSegment_(mediaState);
    }
  };

  private onBufferAppended_ = (event: BufferAppendedEvent) => {
    const mediaState = this.mediaStates_.get(event.type);
    if (!mediaState) {
      return;
    }
    if (
      mediaState.state !== State.LOADING_INIT &&
      mediaState.state !== State.LOADING_SEGMENT
    ) {
      return;
    }
    mediaState.state = State.IDLE;
    this.update_(mediaState);
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
  }

  /**
   * Core streaming decision for a single track.
   * Returns seconds until next poll, or null
   * if no reschedule is needed.
   */
  private update_(mediaState: MediaState): number | null {
    if (mediaState.state !== State.IDLE) {
      return null;
    }

    const currentTime = this.player_.getMedia()?.currentTime ?? 0;
    const bufferGoal = this.player_.getConfig().bufferGoal;
    const bufferedEnd = this.player_.getBufferedEnd(
      mediaState.selectionSet.type,
    );

    if (bufferedEnd - currentTime >= bufferGoal) {
      return 1;
    }

    const nextSegment = this.getNextSegment_(mediaState);
    if (nextSegment) {
      mediaState.state = State.LOADING_SEGMENT;
      this.loadSegment_(mediaState, nextSegment);
      return null;
    }

    this.advancePresentation_(mediaState);
    return null;
  }

  private onUpdate_(mediaState: MediaState) {
    const delay = this.update_(mediaState);
    if (delay !== null) {
      mediaState.timer.tickAfter(delay);
    }
  }

  /**
   * Find the next segment to load.
   * Pure — no side effects.
   */
  private getNextSegment_(mediaState: MediaState): Segment | null {
    const { segments } = mediaState.track;
    if (!mediaState.lastSegment) {
      return segments[0] ?? null;
    }
    const lastIndex = segments.indexOf(mediaState.lastSegment);
    return segments[lastIndex + 1] ?? null;
  }

  /**
   * Advance to the next presentation. Throws on
   * CMAF inconsistency. Sets ENDED when no more
   * presentations are available.
   */
  private advancePresentation_(mediaState: MediaState) {
    if (!this.manifest_) {
      return;
    }

    const presentations = this.manifest_.presentations;
    const currentIndex = presentations.indexOf(mediaState.presentation);
    const nextPresentation = presentations[currentIndex + 1];

    if (!nextPresentation) {
      mediaState.state = State.ENDED;
      this.checkEndOfStream_();
      return;
    }

    const type = mediaState.selectionSet.type;
    const selectionSet = nextPresentation.selectionSets.find(
      (s) => s.type === type,
    );
    assertNotVoid(
      selectionSet,
      `No SelectionSet for ${type} in next Presentation`,
    );

    const switchingSet = selectionSet.switchingSets[0];
    assertNotVoid(switchingSet, "No SwitchingSet in next Presentation");

    const track = switchingSet.tracks[0];
    assertNotVoid(track, "No Track in next Presentation");

    mediaState.presentation = nextPresentation;
    mediaState.selectionSet = selectionSet;
    mediaState.switchingSet = switchingSet;
    mediaState.track = track;
    mediaState.lastSegment = null;

    this.loadInitSegment_(mediaState);
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
      mediaState.state = State.IDLE;
      this.update_(mediaState);
      return;
    }

    mediaState.state = State.LOADING_INIT;

    const response = await fetch(initSegment.url);
    const data = await response.arrayBuffer();

    if (mediaState.state !== State.LOADING_INIT) {
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
    const response = await fetch(segment.url);
    const data = await response.arrayBuffer();

    if (mediaState.state !== State.LOADING_SEGMENT) {
      return;
    }

    mediaState.lastSegment = segment;

    this.player_.emit(Events.BUFFER_APPENDING, {
      type: mediaState.selectionSet.type,
      initSegment: mediaState.track.initSegment,
      segment,
      data,
    });
  }

  private stopMediaStates_() {
    for (const mediaState of this.mediaStates_.values()) {
      mediaState.state = State.STOPPED;
      mediaState.timer.stop();
    }
  }
}

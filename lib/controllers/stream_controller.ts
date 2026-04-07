import type {
  BufferAppendedEvent,
  ManifestParsedEvent,
  MediaAttachedEvent,
} from "../events";
import { Events } from "../events";
import type { Player } from "../player";
import type {
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

type MediaState = {
  presentation: Presentation;
  selectionSet: SelectionSet;
  switchingSet: SwitchingSet;
  track: Track;
  lastSegment: Segment | null;
  lastInitSegment: string | null;
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
    this.scheduleUpdate_(mediaState, 0);
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

  private onUpdate_(mediaState: MediaState) {
    const delay = this.update_(mediaState);
    if (delay !== null) {
      this.scheduleUpdate_(mediaState, delay);
    }
  }

  /**
   * Core streaming logic for a single track.
   * Returns seconds until next update, or null
   * if no reschedule is needed.
   */
  private update_(mediaState: MediaState): number | null {
    const media = this.player_.getMedia();
    const currentTime = media?.currentTime ?? 0;
    const bufferGoal = this.player_.getConfig().bufferGoal;

    const bufferedEnd = this.player_.getBufferedEnd(
      mediaState.selectionSet.type,
    );

    if (bufferedEnd - currentTime >= bufferGoal) {
      return 1;
    }

    const segment = this.getNextSegment_(mediaState);
    if (!segment) {
      return null;
    }

    this.loadSegment_(mediaState, segment);
    return null;
  }

  private scheduleUpdate_(mediaState: MediaState, delay: number) {
    mediaState.timer.tickAfter(delay);
  }

  /**
   * Find the next segment to load. When the
   * current track is exhausted, transitions to
   * the next presentation if available.
   */
  private getNextSegment_(mediaState: MediaState): Segment | null {
    const { segments } = mediaState.track;

    if (!mediaState.lastSegment) {
      return segments[0] ?? null;
    }

    const lastIndex = segments.indexOf(mediaState.lastSegment);
    const next = segments[lastIndex + 1];
    if (next) {
      return next;
    }

    // Track exhausted — try next presentation.
    // Transition loads the init segment; the streaming
    // loop resumes when BUFFER_APPENDED fires.
    this.transitionToNextPresentation_(mediaState);

    return null;
  }

  /**
   * Transition to the next presentation. Updates
   * the media state and loads the new init segment.
   * The streaming loop resumes via BUFFER_APPENDED
   * after the init segment is appended.
   */
  private transitionToNextPresentation_(mediaState: MediaState) {
    if (!this.manifest_) {
      return;
    }

    const presentations = this.manifest_.presentations;
    const currentIndex = presentations.indexOf(mediaState.presentation);
    const nextPresentation = presentations[currentIndex + 1];
    if (!nextPresentation) {
      this.checkEndOfStream_();
      return;
    }

    const type = mediaState.selectionSet.type;
    const selectionSet = nextPresentation.selectionSets.find(
      (s) => s.type === type,
    );
    if (!selectionSet) {
      this.checkEndOfStream_();
      return;
    }

    const switchingSet = selectionSet.switchingSets[0];
    if (!switchingSet) {
      this.checkEndOfStream_();
      return;
    }

    const track = switchingSet.tracks[0];
    if (!track) {
      this.checkEndOfStream_();
      return;
    }

    mediaState.presentation = nextPresentation;
    mediaState.selectionSet = selectionSet;
    mediaState.switchingSet = switchingSet;
    mediaState.track = track;
    mediaState.lastSegment = null;

    this.loadInitSegment_(mediaState);
  }

  /**
   * Check if all media states are exhausted.
   * Pure check — no side effects on media state.
   */
  private checkEndOfStream_() {
    const allDone = [...this.mediaStates_.values()].every((ms) =>
      this.isTrackExhausted_(ms),
    );
    if (allDone) {
      this.player_.emit(Events.BUFFER_EOS);
    }
  }

  /**
   * Check if a media state has no more segments
   * and no more presentations to transition to.
   */
  private isTrackExhausted_(mediaState: MediaState): boolean {
    const { segments } = mediaState.track;
    if (!mediaState.lastSegment) {
      return segments.length === 0;
    }
    const lastIndex = segments.indexOf(mediaState.lastSegment);
    if (lastIndex + 1 < segments.length) {
      return false;
    }
    // Current track done — check for more presentations.
    if (!this.manifest_) {
      return true;
    }
    const presentations = this.manifest_.presentations;
    const currentIndex = presentations.indexOf(mediaState.presentation);
    return currentIndex + 1 >= presentations.length;
  }

  /**
   * Get total duration. Segment times are in
   * presentation time, so the last segment's
   * end in the first track is the duration.
   */
  private computeDuration_(): number {
    assertNotVoid(this.manifest_, "Manifest not set");
    const presentation = this.manifest_.presentations.at(-1);
    assertNotVoid(presentation, "No presentations");
    const selectionSet = presentation.selectionSets[0];
    assertNotVoid(selectionSet, "No selection sets");
    const switchingSet = selectionSet.switchingSets[0];
    assertNotVoid(switchingSet, "No switching sets");
    const track = switchingSet.tracks[0];
    assertNotVoid(track, "No tracks");
    const lastSeg = track.segments.at(-1);
    assertNotVoid(lastSeg, "No segments");
    return lastSeg.end;
  }

  private async loadInitSegment_(mediaState: MediaState) {
    const { initSegment } = mediaState.track;

    if (mediaState.lastInitSegment === initSegment.url) {
      return;
    }

    const response = await fetch(initSegment.url);
    const data = await response.arrayBuffer();

    mediaState.lastInitSegment = initSegment.url;

    this.player_.emit(Events.BUFFER_APPENDING, {
      type: mediaState.selectionSet.type,
      data,
      timestampOffset: this.getTimestampOffset_(mediaState),
    });
  }

  private async loadSegment_(mediaState: MediaState, segment: Segment) {
    const response = await fetch(segment.url);
    const data = await response.arrayBuffer();

    mediaState.lastSegment = segment;

    this.player_.emit(Events.BUFFER_APPENDING, {
      type: mediaState.selectionSet.type,
      data,
      timestampOffset: this.getTimestampOffset_(mediaState),
    });
  }

  private getTimestampOffset_(mediaState: MediaState): number {
    return mediaState.presentation.start - mediaState.switchingSet.timeOffset;
  }
}

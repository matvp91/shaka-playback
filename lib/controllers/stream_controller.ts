import type {
  BufferAppendedEvent,
  ManifestParsedEvent,
  MediaAttachedEvent,
} from "../events";
import { Events } from "../events";
import type { Player } from "../player";
import type {
  Manifest,
  MediaGroup,
  MediaType,
  Segment,
  Stream,
} from "../types/manifest";
import { Timer } from "../utils/timer";

type MediaState = {
  group: MediaGroup;
  stream: Stream;
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

    // Pick one MediaGroup per type — multiple of the same
    // type are alternatives (eg. languages), only one active.
    const seen = new Set<string>();
    const activeGroups: MediaGroup[] = [];

    for (const group of this.manifest_.groups) {
      if (seen.has(group.type)) {
        continue;
      }
      seen.add(group.type);

      const stream = group.streams[0];
      if (!stream) {
        throw new Error("No stream available");
      }

      const mediaState: MediaState = {
        group,
        stream,
        lastSegment: null,
        lastInitSegment: null,
        timer: new Timer(() => this.onUpdate_(mediaState)),
      };

      this.mediaStates_.set(group.type, mediaState);
      activeGroups.push(group);
    }

    this.player_.emit(Events.MEDIA_GROUPS_UPDATED, {
      groups: activeGroups,
    });
  }

  private onUpdate_(mediaState: MediaState) {
    const delay = this.update_(mediaState);
    if (delay !== null) {
      this.scheduleUpdate_(mediaState, delay);
    }
  }

  /**
   * Core streaming logic for a single stream.
   * Returns seconds until next update, or null
   * if no reschedule is needed.
   */
  private update_(mediaState: MediaState): number | null {
    const media = this.player_.getMedia();
    const currentTime = media?.currentTime ?? 0;
    const bufferGoal = this.player_.getConfig().bufferGoal;

    const bufferedEnd = this.player_.getBufferedEnd(mediaState.group.type);

    if (bufferedEnd - currentTime >= bufferGoal) {
      return 1;
    }

    const segment = this.getNextSegment_(mediaState);
    if (!segment) {
      this.checkEndOfStream_();
      return null;
    }

    this.loadSegment_(mediaState, segment);
    return null;
  }

  /** Schedule the next update for a media state. */
  private scheduleUpdate_(mediaState: MediaState, delay: number) {
    mediaState.timer.tickAfter(delay);
  }

  /**
   * Find the next segment to load. Uses lastSegment
   * to avoid float precision issues with buffer times.
   */
  private getNextSegment_(mediaState: MediaState): Segment | null {
    const { segments } = mediaState.stream;

    if (!mediaState.lastSegment) {
      return segments[0] ?? null;
    }

    const lastIndex = segments.indexOf(mediaState.lastSegment);
    return segments[lastIndex + 1] ?? null;
  }

  private checkEndOfStream_() {
    const allDone = [...this.mediaStates_.values()].every(
      (ms) => this.getNextSegment_(ms) === null,
    );
    if (allDone) {
      this.player_.emit(Events.BUFFER_EOS);
    }
  }

  private async loadInitSegment_(mediaState: MediaState) {
    const { initSegment } = mediaState.stream;
    const response = await fetch(initSegment.url);
    const data = await response.arrayBuffer();

    mediaState.lastInitSegment = initSegment.url;

    this.player_.emit(Events.SEGMENT_LOADED, {
      type: mediaState.group.type,
      segment: { url: initSegment.url, start: 0, end: 0 },
      data,
    });
  }

  private async loadSegment_(mediaState: MediaState, segment: Segment) {
    const response = await fetch(segment.url);
    const data = await response.arrayBuffer();

    mediaState.lastSegment = segment;

    this.player_.emit(Events.SEGMENT_LOADED, {
      type: mediaState.group.type,
      segment,
      data,
    });
  }
}

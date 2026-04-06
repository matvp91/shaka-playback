import type {
  BufferAppendedEvent,
  ManifestParsedEvent,
  MediaAttachedEvent,
} from "../events";
import { Events } from "../events";
import type { Player } from "../player";
import type {
  Manifest,
  SelectionSet,
  Track,
} from "../types/manifest";
import { TaskLoop } from "../utils/task_loop";

type StreamState = {
  selectionSet: SelectionSet;
  track: Track;
  segmentIndex: number;
  initLoaded: boolean;
};

export class StreamController {
  private taskLoop_: TaskLoop;
  private manifest_: Manifest | null = null;
  private mediaAttached_ = false;
  private streams_: StreamState[] = [];
  private loading_ = false;

  constructor(private player_: Player) {
    this.taskLoop_ = new TaskLoop(this.onTick_.bind(this));

    this.player_.on(Events.MANIFEST_PARSED, this.onManifestParsed_);
    this.player_.on(Events.MEDIA_ATTACHED, this.onMediaAttached_);
    this.player_.on(Events.BUFFER_APPENDED, this.onBufferAppended_);
  }

  destroy() {
    this.taskLoop_.destroy();
    this.player_.off(Events.MANIFEST_PARSED, this.onManifestParsed_);
    this.player_.off(Events.MEDIA_ATTACHED, this.onMediaAttached_);
    this.player_.off(Events.BUFFER_APPENDED, this.onBufferAppended_);
    this.manifest_ = null;
    this.streams_ = [];
  }

  private onManifestParsed_ = (event: ManifestParsedEvent) => {
    this.manifest_ = event.manifest;
    this.tryStart_();
  };

  private onMediaAttached_ = (_event: MediaAttachedEvent) => {
    this.mediaAttached_ = true;
    this.tryStart_();
  };

  private onBufferAppended_ = (_event: BufferAppendedEvent) => {
    this.loading_ = false;
    this.taskLoop_.tick();
  };

  private tryStart_() {
    if (!this.manifest_ || !this.mediaAttached_) {
      return;
    }

    const presentation = this.manifest_.presentations[0];
    if (!presentation) {
      return;
    }

    // Pick one SelectionSet per type — multiple of the same
    // type are alternatives (eg. languages), only one active.
    const seen = new Set<string>();
    this.streams_ = [];

    for (const selectionSet of presentation.selectionSets) {
      if (seen.has(selectionSet.type)) {
        continue;
      }
      seen.add(selectionSet.type);

      const track = selectionSet.switchingSets[0]?.tracks[0];
      if (!track) {
        throw new Error("No track available");
      }
      this.streams_.push({
        selectionSet,
        track,
        segmentIndex: 0,
        initLoaded: false,
      });
    }

    this.taskLoop_.tick();
  }

  private onTick_() {
    if (this.loading_) {
      return;
    }

    // Load init segments first.
    for (const stream of this.streams_) {
      if (!stream.initLoaded) {
        this.loadInitSegment_(stream);
        return;
      }
    }

    const media = this.player_.getMedia();
    const currentTime = media?.currentTime ?? 0;
    const bufferGoal = this.player_.getConfig().bufferGoal;

    // Load next segment for the stream that needs it.
    for (const stream of this.streams_) {
      const segment = stream.track.segments[stream.segmentIndex];
      if (!segment) {
        continue;
      }

      const bufferedEnd = this.player_.getBufferedEnd(
        stream.selectionSet,
      );
      if (bufferedEnd - currentTime >= bufferGoal) {
        continue;
      }

      this.loadSegment_(stream);
      return;
    }

    // Signal end of stream when all segments are loaded.
    const allDone = this.streams_.every(
      (s) => s.segmentIndex >= s.track.segments.length,
    );
    if (allDone) {
      this.player_.emit(Events.BUFFER_EOS);
    }
  }

  private async loadInitSegment_(stream: StreamState) {
    this.loading_ = true;
    const response = await fetch(stream.track.initSegmentUrl);
    const data = await response.arrayBuffer();

    stream.initLoaded = true;

    this.player_.emit(Events.SEGMENT_LOADED, {
      selectionSet: stream.selectionSet,
      track: stream.track,
      data,
      segmentIndex: -1,
    });
  }

  private async loadSegment_(stream: StreamState) {
    this.loading_ = true;
    const segment = stream.track.segments[stream.segmentIndex];
    if (!segment) {
      return;
    }

    const response = await fetch(segment.url);
    const data = await response.arrayBuffer();

    const segmentIndex = stream.segmentIndex;
    stream.segmentIndex++;

    this.player_.emit(Events.SEGMENT_LOADED, {
      selectionSet: stream.selectionSet,
      track: stream.track,
      data,
      segmentIndex,
    });
  }
}

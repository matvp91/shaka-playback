import { EventEmitter } from "@matvp91/eventemitter3";
import type { PlayerConfig } from "./config";
import { defaultConfig } from "./config";
import { BufferController } from "./controllers/buffer_controller";
import { ManifestController } from "./controllers/manifest_controller";
import { MediaController } from "./controllers/media_controller";
import { StreamController } from "./controllers/stream_controller";
import type { EventMap } from "./events";
import { Events } from "./events";
import type { SelectionSet } from "./types/manifest";

export class Player extends EventEmitter<EventMap> {
  private config_ = defaultConfig;
  private media_: HTMLMediaElement | null = null;
  private manifestController_: ManifestController;
  private mediaController_: MediaController;
  private bufferController_: BufferController;
  private streamController_: StreamController;

  constructor() {
    super();
    this.manifestController_ = new ManifestController(this);
    this.mediaController_ = new MediaController(this);
    this.bufferController_ = new BufferController(this);
    this.streamController_ = new StreamController(this);
  }

  load(url: string) {
    this.emit(Events.MANIFEST_LOADING, { url });
  }

  getMedia() {
    return this.media_;
  }

  setConfig(config: Partial<PlayerConfig>) {
    this.config_ = { ...this.config_, ...config };
  }

  getConfig() {
    return this.config_;
  }

  getBufferedEnd(selectionSet: SelectionSet): number {
    return this.bufferController_.getBufferedEnd(selectionSet);
  }

  attachMedia(media: HTMLMediaElement) {
    this.media_ = media;
    this.emit(Events.MEDIA_ATTACHING, { media });
  }

  detachMedia() {
    this.media_ = null;
    this.emit(Events.MEDIA_DETACHED);
  }

  destroy() {
    this.manifestController_.destroy();
    this.mediaController_.destroy();
    this.bufferController_.destroy();
    this.streamController_.destroy();
    this.removeAllListeners();
  }
}

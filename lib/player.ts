import { EventEmitter } from "@matvp91/eventemitter3";
import type { PlayerConfig } from "./config";
import { defaultConfig } from "./config";
import { BufferController } from "./controllers/buffer_controller";
import { GapController } from "./controllers/gap_controller";
import { ManifestController } from "./controllers/manifest_controller";
import { StreamController } from "./controllers/stream_controller";
import type { EventMap } from "./events";
import { Events } from "./events";
import { NetworkService } from "./net/network_service";
import type { StreamPreference } from "./types";

export class Player extends EventEmitter<EventMap> {
  private config_ = defaultConfig;
  private media_: HTMLMediaElement | null = null;
  private networkService_: NetworkService;
  private manifestController_: ManifestController;
  private bufferController_: BufferController;
  private gapController_: GapController;
  private streamController_: StreamController;

  constructor() {
    super();
    this.networkService_ = new NetworkService(this);
    this.manifestController_ = new ManifestController(
      this,
      this.networkService_,
    );
    this.bufferController_ = new BufferController(this);
    this.gapController_ = new GapController(this);
    this.streamController_ = new StreamController(this, this.networkService_);
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

  getStreams() {
    return this.streamController_.getStreams();
  }

  setPreference(preference: StreamPreference, flushBuffer?: boolean) {
    this.emit(Events.STREAM_PREFERENCE_CHANGED, { preference });
    if (flushBuffer) {
      this.bufferController_.flush(preference.type);
    }
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
    this.bufferController_.destroy();
    this.gapController_.destroy();
    this.streamController_.destroy();
    this.removeAllListeners();
  }
}

import { EventEmitter } from "@matvp91/eventemitter3";
import type { PlayerConfig } from "./config";
import { defaultConfig } from "./config";
import type { EventMap } from "./events";
import { Events } from "./events";
import { ManifestController } from "./manifest/manifest_controller";
import { BufferController } from "./media/buffer_controller";
import { GapController } from "./media/gap_controller";
import { StreamController } from "./media/stream_controller";
import { NetworkService } from "./net/network_service";
import type { MediaType, StreamPreference } from "./types";

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

    this.manifestController_ = new ManifestController(this);
    this.bufferController_ = new BufferController(this);
    this.gapController_ = new GapController(this);
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

  getBuffered(type: MediaType) {
    return this.bufferController_.getBuffered(type);
  }

  getStreams() {
    return this.streamController_.getStreams();
  }

  getNetworkService() {
    return this.networkService_;
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

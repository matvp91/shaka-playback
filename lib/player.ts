import { EventEmitter } from "@matvp91/eventemitter3";
import type { PlayerConfig } from "./config";
import { defaultConfig } from "./config";
import { ManifestController } from "./controllers/manifest_controller";
import type { EventMap } from "./events";
import { Events } from "./events";

export class Player extends EventEmitter<EventMap> {
  private config_ = defaultConfig;
  private media_: HTMLMediaElement | null = null;
  private manifestController_: ManifestController;

  constructor() {
    super();
    this.manifestController_ = new ManifestController(this);
  }

  destroy() {
    this.manifestController_.destroy();
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

  attachMedia(media: HTMLMediaElement) {
    this.media_ = media;
    this.emit(Events.MEDIA_ATTACHING, { media });
  }

  detachMedia() {
    this.media_ = null;
    this.emit(Events.MEDIA_DETACHED);
  }
}

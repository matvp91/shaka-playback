import { EventEmitter } from "@matvp91/eventemitter3";
import type { PlayerConfig } from "./config";
import { defaultConfig } from "./config";
import { fetchManifest } from "./dash/dash_parser";
import type { EventMap } from "./events";
import { Events } from "./events";

export class Player extends EventEmitter<EventMap> {
  private config_ = defaultConfig;

  private media_: HTMLMediaElement | null = null;

  async load(url: string) {
    const manifest = await fetchManifest(url);
    console.log(manifest);
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

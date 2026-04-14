import { EventEmitter } from "@matvp91/eventemitter3";
import type { ConfigPath, ConfigPathValue, PlayerConfig } from "./config";
import { DEFAULT_CONFIG } from "./config";
import type { EventMap } from "./events";
import { Events } from "./events";
import { ManifestController } from "./manifest/manifest_controller";
import { BufferController } from "./media/buffer_controller";
import { GapController } from "./media/gap_controller";
import { StreamController } from "./media/stream_controller";
import { NetworkService } from "./net/network_service";
import type { RegistryType } from "./registry";
import { Registry } from "./registry";
import type { DeepPartial } from "./types/helpers";
import type { StreamPreference } from "./types/media";
import { MediaType } from "./types/media";
import * as ObjectUtils from "./utils/object_utils";

/**
 * CMAF media player. Augments a `<video>` element with adaptive streaming
 * through MSE.
 *
 * @public
 */
export class Player extends EventEmitter<EventMap> {
  private config_ = DEFAULT_CONFIG;
  private media_: HTMLMediaElement | null = null;

  private registry_: Registry;
  private networkService_: NetworkService;

  private manifestController_: ManifestController;
  private bufferController_: BufferController;
  private gapController_: GapController;
  private streamController_: StreamController;

  constructor() {
    super();

    this.registry_ = new Registry(this);
    this.networkService_ = new NetworkService(this);

    this.manifestController_ = new ManifestController(this);
    this.bufferController_ = new BufferController(this);
    this.gapController_ = new GapController(this);
    this.streamController_ = new StreamController(this);
  }

  /**
   * Starts loading and parsing the manifest at the given URL, then begins
   * segment fetching.
   */
  load(url: string) {
    this.emit(Events.MANIFEST_LOADING, { url });
  }

  /**
   * Returns registered components for the given type.
   */
  getRegistry(type: RegistryType) {
    return this.registry_.get(type);
  }

  /**
   * Returns the attached media element, or null.
   */
  getMedia() {
    return this.media_;
  }

  /**
   * Merges the given config into the current config. Accepts either a
   * deep-partial object or a dot-notation path with a value.
   */
  setConfig(config: DeepPartial<PlayerConfig>): void;
  setConfig<P extends ConfigPath>(path: P, value: ConfigPathValue<P>): void;
  setConfig(
    pathOrConfig: string | DeepPartial<PlayerConfig>,
    value?: unknown,
  ): void {
    const partial =
      typeof pathOrConfig === "string"
        ? ObjectUtils.unflattenPath(pathOrConfig, value)
        : pathOrConfig;
    this.config_ = ObjectUtils.deepMerge(this.config_, partial);
  }

  /**
   * Returns the current player config.
   */
  getConfig() {
    return this.config_;
  }

  /**
   * Returns buffered time ranges for the given type.
   */
  getBuffered(type: MediaType) {
    if (type === MediaType.TEXT) {
      throw new Error(`getBuffered is not supported for type "${type}"`);
    }
    return this.bufferController_.getBuffered(type);
  }

  /**
   * Returns resolved streams for the given media type.
   */
  getStreams(type: MediaType) {
    return this.streamController_.getStreams(type);
  }

  /**
   * Returns the currently active stream for the given type.
   */
  getActiveStream(type: MediaType) {
    return this.streamController_.getActiveStream(type);
  }

  /**
   * Returns the network service instance.
   */
  getNetworkService() {
    return this.networkService_;
  }

  /**
   * Sets the preferred stream for a media type. Optionally flushes the
   * buffer to switch immediately.
   */
  setStreamPreference(preference: StreamPreference, flushBuffer = false) {
    this.streamController_.setPreference(preference, flushBuffer);
  }

  /**
   * Returns the currently active stream preference for the given type.
   */
  getStreamPreference(type: MediaType) {
    return this.streamController_.getActiveStreamPreference(type);
  }

  /**
   * Attaches a `<video>` or `<audio>` element. Required before playback
   * can begin.
   */
  attachMedia(media: HTMLMediaElement) {
    if (this.media_) {
      throw new Error("Already has a media element attached");
    }
    this.media_ = media;
    this.emit(Events.MEDIA_ATTACHING, { media });
  }

  /**
   * Detaches the current media element.
   */
  detachMedia() {
    if (!this.media_) {
      return;
    }
    this.emit(Events.MEDIA_DETACHING, { media: this.media_ });
    this.media_ = null;
    this.emit(Events.MEDIA_DETACHED);
  }

  /**
   * Destroys the player and releases all resources. The instance cannot
   * be reused after this call.
   */
  destroy() {
    this.manifestController_.destroy();
    this.bufferController_.destroy();
    this.gapController_.destroy();
    this.streamController_.destroy();
    this.removeAllListeners();
  }
}

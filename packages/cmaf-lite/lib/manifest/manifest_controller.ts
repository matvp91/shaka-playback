import type { ManifestLoadingEvent } from "../events";
import { Events } from "../events";
import type { Player } from "../player";
import { RegistryType } from "../registry";
import type { NetworkRequest } from "../types/net";
import { ABORTED, NetworkRequestType } from "../types/net";
import { Log } from "../utils/log";

const log = Log.create("ManifestController");

export class ManifestController {
  private request_: NetworkRequest | null = null;

  constructor(private player_: Player) {
    this.player_.on(Events.MANIFEST_LOADING, this.onManifestLoading_);
  }

  destroy() {
    const networkService = this.player_.getNetworkService();
    if (this.request_) {
      networkService.cancel(this.request_);
    }
    this.player_.off(Events.MANIFEST_LOADING, this.onManifestLoading_);
  }

  private onManifestLoading_ = async (event: ManifestLoadingEvent) => {
    const networkService = this.player_.getNetworkService();
    this.request_ = networkService.request(
      NetworkRequestType.MANIFEST,
      event.url,
    );

    const response = await this.request_.promise;
    if (response === ABORTED) {
      return;
    }

    const contentType = response.headers.get("content-type");
    if (!contentType) {
      throw new Error("Missing response header for manifest");
    }

    const parser = this.getParser_(contentType);
    const manifest = parser.parse(response);
    log.info("Manifest", manifest, parser);
    this.player_.emit(Events.MANIFEST_PARSED, { manifest });
  };

  private getParser_(contentType: string) {
    const parsers = this.player_.getRegistry(RegistryType.MANIFEST_PARSER);
    for (const parser of parsers) {
      if (parser.mimeTypes.includes(contentType)) {
        return parser;
      }
    }
    throw new Error(`Failed to find parser for ${contentType}`);
  }
}

import type { ManifestLoadingEvent, NetworkRequest, Player } from "..";
import { ABORTED, Events, NetworkRequestType } from "..";
import { assertNotVoid } from "../utils/assert";
import { ManifestParserRegistry } from "./manifest_parser";

export class ManifestController {
  private request_: NetworkRequest | null = null;

  private registry_: ManifestParserRegistry;

  constructor(private player_: Player) {
    this.registry_ = new ManifestParserRegistry(player_);
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

    const parser = this.registry_.getByMimeType(contentType);
    assertNotVoid(parser, `No parser found for ${contentType}`);
    const manifest = parser.parse(response);
    this.player_.emit(Events.MANIFEST_PARSED, { manifest });
  };
}

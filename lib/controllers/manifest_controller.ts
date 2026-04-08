import { parseManifest } from "../dash/dash_parser";
import type { ManifestLoadingEvent } from "../events";
import { Events } from "../events";
import type { NetworkService } from "../net/network_service";
import { RequestType } from "../net/network_service";
import { Request } from "../net/request";
import type { Player } from "../player";

export class ManifestController {
  private request_: Request | null = null;

  constructor(
    private player_: Player,
    private networkService_: NetworkService,
  ) {
    this.player_.on(Events.MANIFEST_LOADING, this.onManifestLoading_);
  }

  destroy() {
    this.request_?.cancel();
    this.request_ = null;
    this.player_.off(Events.MANIFEST_LOADING, this.onManifestLoading_);
  }

  private onManifestLoading_ = async (event: ManifestLoadingEvent) => {
    const { url } = event;

    this.request_ = this.networkService_.request(
      RequestType.MANIFEST,
      new Request(url),
    );

    const response = await this.request_.promise;
    this.request_ = null;

    if (!response) {
      return;
    }

    const manifest = await parseManifest(response.text(), url);
    this.player_.emit(Events.MANIFEST_PARSED, { manifest });
  };
}

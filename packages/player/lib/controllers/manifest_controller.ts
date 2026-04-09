import { parseManifest } from "../dash/dash_parser";
import type { ManifestLoadingEvent } from "../events";
import { Events } from "../events";
import type { NetworkService } from "../net/network_service";
import type { Player } from "../player";
import type { Request } from "../types/net";
import { ABORTED, RequestType } from "../types/net";

export class ManifestController {
  private request_: Request<"text"> | null = null;

  constructor(
    private player_: Player,
    private networkService_: NetworkService,
  ) {
    this.player_.on(Events.MANIFEST_LOADING, this.onManifestLoading_);
  }

  destroy() {
    if (this.request_) {
      this.networkService_.cancel(this.request_);
    }
    this.player_.off(Events.MANIFEST_LOADING, this.onManifestLoading_);
  }

  private onManifestLoading_ = async (event: ManifestLoadingEvent) => {
    this.request_ = this.networkService_.request(
      RequestType.MANIFEST,
      event.url,
      "text",
    );

    const result = await this.request_.promise;
    if (result === ABORTED) {
      return;
    }

    const manifest = await parseManifest(result.data, event.url);
    this.player_.emit(Events.MANIFEST_PARSED, { manifest });
  };
}

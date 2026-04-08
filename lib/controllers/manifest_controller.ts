import { parseManifest } from "../dash/dash_parser";
import type { ManifestLoadingEvent } from "../events";
import { Events } from "../events";
import type { NetworkService } from "../net/network_service";
import { RequestType } from "../net/network_service";
import type { Request } from "../net/types";
import { ABORTED } from "../net/types";
import type { Player } from "../player";

export class ManifestController {
  private lastRequest_: Request<"text"> | null = null;

  constructor(
    private player_: Player,
    private networkService_: NetworkService,
  ) {
    this.player_.on(Events.MANIFEST_LOADING, this.onManifestLoading_);
  }

  destroy() {
    if (this.lastRequest_) {
      this.networkService_.cancel(this.lastRequest_);
    }
    this.player_.off(Events.MANIFEST_LOADING, this.onManifestLoading_);
  }

  private onManifestLoading_ = async (event: ManifestLoadingEvent) => {
    this.lastRequest_ = this.networkService_.request(
      RequestType.MANIFEST,
      event.url,
      "text",
    );

    const response = await this.lastRequest_.promise;
    if (response === ABORTED) {
      return;
    }

    const manifest = await parseManifest(response.data, event.url);
    this.player_.emit(Events.MANIFEST_PARSED, { manifest });
  };
}

import { parseManifest } from "../dash/dash_parser";
import type { ManifestLoadingEvent } from "../events";
import { Events } from "../events";
import type { Player } from "../player";
import type { Request } from "../types/net";
import { ABORTED, RequestType } from "../types/net";

export class ManifestController {
  private request_: Request<"text"> | null = null;

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

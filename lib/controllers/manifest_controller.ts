import { fetchManifest } from "../dash/dash_parser";
import type { ManifestLoadingEvent } from "../events";
import { Events } from "../events";
import type { Player } from "../player";

export class ManifestController {
  constructor(private player_: Player) {
    this.player_.on(Events.MANIFEST_LOADING, this.onManifestLoading_);
  }

  destroy() {
    this.player_.off(Events.MANIFEST_LOADING, this.onManifestLoading_);
  }

  private onManifestLoading_ = async (event: ManifestLoadingEvent) => {
    const manifest = await fetchManifest(event.url);
    this.player_.emit(Events.MANIFEST_PARSED, { manifest });
  };
}

import { fetchManifest } from "../dash/dash_parser";
import type { ManifestLoadingEvent } from "../events";
import { Events } from "../events";
import type { Player } from "../player";
import { EventManager } from "../utils/event_manager";

export class ManifestController {
  private eventManager_ = new EventManager();

  constructor(private player_: Player) {
    this.eventManager_.listen(
      player_,
      Events.MANIFEST_LOADING,
      this.onManifestLoading_,
    );
  }

  destroy() {
    this.eventManager_.release();
  }

  private onManifestLoading_ = async (event: ManifestLoadingEvent) => {
    const manifest = await fetchManifest(event.url);
    this.player_.emit(Events.MANIFEST_PARSED, { manifest });
  };
}

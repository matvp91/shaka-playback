import { parseManifest } from "../dash/dash_parser";
import { ErrorCode } from "../errors";
import type { ManifestLoadingEvent } from "../events";
import { Events } from "../events";
import type { Player } from "../player";
import { Request } from "../utils/request";

export class ManifestController {
  private request_: Request<"text"> | null = null;

  constructor(private player_: Player) {
    this.player_.on(Events.MANIFEST_LOADING, this.onManifestLoading_);
  }

  destroy() {
    this.request_?.cancel();
    this.request_ = null;
    this.player_.off(Events.MANIFEST_LOADING, this.onManifestLoading_);
  }

  private onManifestLoading_ = async (event: ManifestLoadingEvent) => {
    const { url } = event;

    this.request_ = new Request(url, "text");

    try {
      const text = await this.request_.response;
      this.request_ = null;

      const manifest = await parseManifest(text, url);
      this.player_.emit(Events.MANIFEST_PARSED, { manifest });
    } catch (error) {
      this.request_ = null;

      if (error instanceof DOMException && error.name === "AbortError") {
        this.player_.emit(Events.ERROR, {
          error: {
            code: ErrorCode.MANIFEST_CANCELLED,
            fatal: false,
            data: { url },
          },
        });
        return;
      }

      this.player_.emit(Events.ERROR, {
        error: {
          code: ErrorCode.MANIFEST_LOAD_FAILED,
          fatal: true,
          data: {
            url,
            status: null,
          },
        },
      });
    }
  };
}

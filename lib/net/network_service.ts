import { Events } from "../events";
import type { Player } from "../player";
import { PendingRequest, REQUEST_CANCELLED } from "./pending_request";
import type { Request } from "./request";
import { Response } from "./response";

export enum RequestType {
  MANIFEST = "manifest",
  SEGMENT = "segment",
}

/**
 * Central service for all network requests.
 * Created by Player, passed to controllers.
 * Owns fetch execution and event emission.
 */
export class NetworkService {
  private player_: Player;

  constructor(player: Player) {
    this.player_ = player;
  }

  /**
   * Start a network request. Emits NETWORK_REQUEST
   * synchronously before the fetch fires, allowing
   * listeners to mutate the request. Returns a
   * PendingRequest handle for cancellation.
   */
  request(type: RequestType, request: Request): PendingRequest {
    this.player_.emit(Events.NETWORK_REQUEST, {
      type,
      request,
    });

    const controller = new AbortController();

    const promise = this.fetch_(request, controller).then(
      (response) => {
        this.player_.emit(Events.NETWORK_RESPONSE, {
          type,
          request,
          response,
        });
        return response;
      },
      (error): Response | typeof REQUEST_CANCELLED => {
        if (
          error instanceof DOMException &&
          error.name === "AbortError"
        ) {
          return REQUEST_CANCELLED;
        }
        throw error;
      },
    );

    return new PendingRequest(request, promise, controller);
  }

  private async fetch_(
    request: Request,
    controller: AbortController,
  ): Promise<Response> {
    const start = performance.now();

    const fetchResponse = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      signal: controller.signal,
    });

    const data = await fetchResponse.arrayBuffer();
    const timeElapsed = performance.now() - start;

    return new Response(
      fetchResponse.url,
      fetchResponse.status,
      fetchResponse.headers,
      data,
      timeElapsed,
    );
  }
}

import { Events } from "../events";
import type { Player } from "../player";
import { promiseResolversSymbol } from "./request";
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
   * listeners to mutate the request. Returns the
   * request handle for cancellation and awaiting.
   */
  request(type: RequestType, request: Request): Request {
    this.player_.emit(Events.NETWORK_REQUEST, {
      type,
      request,
    });

    this.fetch_(request).then(
      (response) => {
        this.player_.emit(Events.NETWORK_RESPONSE, {
          type,
          request,
          response,
        });
        request[promiseResolversSymbol].resolve(response);
      },
      (error) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          request[promiseResolversSymbol].resolve(null);
          return;
        }
        request[promiseResolversSymbol].reject(error);
      },
    );

    return request;
  }

  private async fetch_(request: Request): Promise<Response> {
    const start = performance.now();

    const fetchResponse = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      signal: request.signal,
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

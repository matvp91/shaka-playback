import { Events } from "../events";
import type { Player } from "../player";
import type { Request } from "./request";
import { Response } from "./response";
import { resolversSymbol } from "./types";

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
  constructor(private player_: Player) {}

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

    const promise = request[resolversSymbol];
    this.fetch_(request)
      .then((response) => {
        this.player_.emit(Events.NETWORK_RESPONSE, {
          type,
          request,
          response,
        });
        promise.resolve(response);
      })
      .catch((error) => {
        if (isAbortError(error)) {
          // On abort, we'll resolve to null. The caller can check
          // if the request is cancelled.
          promise.resolve(null);
        } else {
          promise.reject(error);
        }
      });

    return request;
  }

  private async fetch_(request: Request): Promise<Response> {
    const start = performance.now();

    const response = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      signal: request.signal,
    });

    const data = await response.arrayBuffer();
    const timeElapsed = performance.now() - start;

    return new Response(
      request,
      response.status,
      response.headers,
      data,
      timeElapsed,
    );
  }
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

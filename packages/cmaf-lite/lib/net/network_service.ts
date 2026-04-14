import { Events } from "../events";
import type { Player } from "../player";
import type { NetworkRequestType } from "../types/net";
import { ABORTED } from "../types/net";
import { ABORT_CONTROLLER, NetworkRequest } from "./network_request";
import { NetworkResponse } from "./network_response";

/**
 * Central service for all network requests. Owns request construction,
 * fetch execution, and cancellation.
 *
 * @public
 */
export class NetworkService {
  constructor(private player_: Player) {}

  /**
   * Creates and starts an HTTP request. Emits |NETWORK_REQUEST| before
   * fetch, allowing listeners to mutate the request (URL, headers,
   * method).
   */
  request(type: NetworkRequestType, url: string): NetworkRequest {
    const promise = Promise.withResolvers<NetworkResponse | typeof ABORTED>();
    const request = new NetworkRequest(url, promise.promise);

    this.player_.emit(Events.NETWORK_REQUEST, {
      type,
      request,
    });

    this.doFetch_(type, request).then(promise.resolve, promise.reject);

    return request;
  }

  /**
   * Aborts an in-flight request. No-op if already completed or
   * cancelled.
   */
  cancel(request: NetworkRequest) {
    if (!request.inFlight) {
      return;
    }

    request.inFlight = false;
    request[ABORT_CONTROLLER].abort();
  }

  private async doFetch_(
    type: NetworkRequestType,
    request: NetworkRequest,
  ): Promise<NetworkResponse | typeof ABORTED> {
    const signal = request[ABORT_CONTROLLER].signal;
    try {
      const response = await this.fetch_(request, signal);

      this.player_.emit(Events.NETWORK_RESPONSE, {
        type,
        response,
      });

      return response;
    } catch (error) {
      if (isAbortError(error)) {
        return ABORTED;
      }
      throw error;
    } finally {
      request.inFlight = false;
    }
  }

  private async fetch_(
    request: NetworkRequest,
    signal: AbortSignal,
  ): Promise<NetworkResponse> {
    const start = performance.now();

    const res = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      signal,
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }

    const data = await res.arrayBuffer();
    const timeElapsed = performance.now() - start;

    return new NetworkResponse(
      request,
      res.status,
      res.headers,
      timeElapsed,
      data,
    );
  }
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

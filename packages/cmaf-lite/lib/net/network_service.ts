import { Events } from "../events";
import type { Player } from "../player";
import type { NetworkRequest, NetworkRequestType } from "../types/net";
import { ABORTED } from "../types/net";
import { NetworkResponse } from "./network_response";

/**
 * Central service for all network requests. Owns request construction,
 * fetch execution, and cancellation.
 *
 * @public
 */
export class NetworkService {
  private controllers_ = new Map<NetworkRequest, AbortController>();

  constructor(private player_: Player) {}

  /**
   * Creates and starts an HTTP request. Emits |NETWORK_REQUEST| before
   * fetch, allowing listeners to mutate the request (URL, headers,
   * method).
   */
  request(type: NetworkRequestType, url: string): NetworkRequest {
    const controller = new AbortController();

    const request = {
      url,
      method: "GET",
      headers: new Headers(),
      inFlight: true,
      cancelled: false,
    } as NetworkRequest;

    this.controllers_.set(request, controller);

    this.player_.emit(Events.NETWORK_REQUEST, {
      type,
      request,
    });

    request.promise = this.doFetch_(type, request, controller.signal);

    return request;
  }

  /**
   * Aborts an in-flight request. No-op if already completed or
   * cancelled.
   */
  cancel(request: NetworkRequest) {
    const controller = this.controllers_.get(request);
    if (!controller) {
      return;
    }

    request.cancelled = true;
    request.inFlight = false;
    controller.abort();
    this.controllers_.delete(request);
  }

  private async doFetch_(
    type: NetworkRequestType,
    request: NetworkRequest,
    signal: AbortSignal,
  ): Promise<NetworkResponse | typeof ABORTED> {
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
      this.controllers_.delete(request);
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

import type { Player } from "..";
import { Events } from "..";
import { NetworkResponse } from "./network_response";
import type { NetworkRequest, NetworkRequestType } from "./types";
import { ABORTED } from "./types";

/**
 * Central service for all network requests. Owns request
 * construction, fetch execution, and cancellation.
 */
export class NetworkService {
  private controllers_ = new Map<NetworkRequest, AbortController>();

  constructor(private player_: Player) {}

  /**
   * Construct and start a request. Emits NETWORK_REQUEST
   * synchronously before fetch, allowing listener mutation.
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

  /**
   * Execute fetch, emit NETWORK_RESPONSE on success,
   * and clean up state in all cases.
   */
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

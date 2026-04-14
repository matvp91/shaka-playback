import { Events } from "../events";
import type { Player } from "../player";
import type { NetworkRequestType, NetworkResponsePromise } from "../types/net";
import { ABORTED } from "../types/net";
import type { NetworkRequestOptions } from "./network_request";
import { ABORT_CONTROLLER, NetworkRequest } from "./network_request";
import { NetworkResponse } from "./network_response";

/**
 * Central service for all network requests. Owns fetch execution,
 * retry logic, and cancellation.
 *
 * @public
 */
export class NetworkService {
  private requests_ = new Set<NetworkRequest>();

  constructor(private player_: Player) {}

  /**
   * Creates and starts an HTTP request. Emits |NETWORK_REQUEST|
   * before each attempt, allowing listeners to mutate the request.
   */
  request(
    type: NetworkRequestType,
    url: string,
    options?: NetworkRequestOptions,
  ): NetworkRequest {
    const promiseWithResolvers =
      Promise.withResolvers<Awaited<NetworkResponsePromise>>();

    const request = new NetworkRequest(
      url,
      promiseWithResolvers.promise,
      options,
    );

    this.requests_.add(request);
    this.doFetch_(type, request, promiseWithResolvers);

    return request;
  }

  /**
   * Aborts an in-flight request. No-op if already completed or
   * cancelled.
   */
  cancel(request: NetworkRequest) {
    request.inFlight = false;
    request[ABORT_CONTROLLER].abort();
    this.requests_.delete(request);
  }

  private async doFetch_(
    type: NetworkRequestType,
    request: NetworkRequest,
    promiseWithResolvers: PromiseWithResolvers<Awaited<NetworkResponsePromise>>,
  ) {
    try {
      while (request.attempt < request.options.maxAttempts) {
        this.nextAttempt_(request);

        this.player_.emit(Events.NETWORK_REQUEST, {
          type,
          request,
        });

        try {
          const response = await this.fetch_(request);

          this.player_.emit(Events.NETWORK_RESPONSE, {
            type,
            response,
          });

          promiseWithResolvers.resolve(response);
          return;
        } catch (error) {
          if (isAbortError(error)) {
            promiseWithResolvers.resolve(ABORTED);
            return;
          }

          if (request.attempt >= request.options.maxAttempts) {
            promiseWithResolvers.reject(error);
            return;
          }

          await delay(request.options.delay);
        }
      }
    } finally {
      request.inFlight = false;
      this.requests_.delete(request);
    }
  }

  /**
   * Prepares the request for its next attempt.
   */
  private nextAttempt_(request: NetworkRequest) {
    request.attempt += 1;
    request[ABORT_CONTROLLER] = new AbortController();
  }

  private async fetch_(request: NetworkRequest): Promise<NetworkResponse> {
    const start = performance.now();

    const res = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      signal: request[ABORT_CONTROLLER].signal,
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

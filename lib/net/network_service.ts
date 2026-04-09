import { Events } from "../events";
import type { Player } from "../player";
import type { Request, RequestPromise, Response, ResponseType } from "./types";
import { ABORTED } from "./types";

export enum RequestType {
  MANIFEST = "manifest",
  SEGMENT = "segment",
}

/**
 * Central service for all network requests. Owns request
 * construction, fetch execution, and cancellation.
 */
export class NetworkService {
  private controllers_ = new Map<Request, AbortController>();

  constructor(private player_: Player) {}

  /**
   * Construct and start a request. Emits NETWORK_REQUEST
   * synchronously before fetch, allowing listener mutation.
   */
  request<T extends ResponseType>(
    type: RequestType,
    url: string,
    responseType: T,
  ): Request<T> {
    const controller = new AbortController();

    const request = {
      url,
      method: "GET",
      headers: new Headers(),
      responseType,
      inFlight: true,
      cancelled: false,
    } as Request<T>;

    this.controllers_.set(request, controller);

    this.player_.emit(Events.NETWORK_REQUEST, {
      type,
      request,
    });

    request.promise = this.doFetch_(
      type,
      request,
      controller.signal,
    ) as RequestPromise<T>;

    return request;
  }

  cancel(request: Request) {
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
    type: RequestType,
    request: Request,
    signal: AbortSignal,
  ): Promise<Response | typeof ABORTED> {
    try {
      const response = await this.fetch_(request, signal);

      this.player_.emit(Events.NETWORK_RESPONSE, {
        type,
        request,
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
    request: Request,
    signal: AbortSignal,
  ): Promise<Response> {
    const start = performance.now();

    const res = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      signal,
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }

    const data =
      request.responseType === "text"
        ? await res.text()
        : await res.arrayBuffer();
    const timeElapsed = performance.now() - start;

    return {
      request,
      status: res.status,
      headers: res.headers,
      data,
      timeElapsed,
    };
  }
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

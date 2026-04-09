import { Events } from "../events";
import type { Player } from "../player";
import type { Request, RequestPromise, Response, ResponseType } from "./types";
import { ABORTED } from "./types";

export enum RequestType {
  MANIFEST = "manifest",
  SEGMENT = "segment",
}

/**
 * Central service for all network requests.
 * Created by Player, passed to controllers.
 * Owns request construction, fetch execution,
 * state management, and cancellation.
 */
export class NetworkService {
  private controllers_ = new Map<Request, AbortController>();

  constructor(private player_: Player) {}

  /**
   * Start a network request. Constructs the request
   * object, emits NETWORK_REQUEST synchronously
   * (allowing listeners to mutate url, headers,
   * method), then kicks off the fetch. Returns the
   * request handle for state inspection and
   * cancellation.
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
   * Fetch lifecycle orchestrator. Calls fetch_,
   * emits NETWORK_RESPONSE on success, and cleans
   * up state in all cases.
   */
  private async doFetch_(
    type: RequestType,
    request: Request,
    signal: AbortSignal,
  ): RequestPromise {
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

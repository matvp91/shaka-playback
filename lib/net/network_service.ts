import { Events } from "../events";
import type { Player } from "../player";
import {
  ABORTED,
  type Request,
  type Response,
  type ResponseType,
} from "./types";

export enum RequestType {
  MANIFEST = "manifest",
  SEGMENT = "segment",
}

type RequestEntry = {
  controller: AbortController;
  resolve: (value: Response<ResponseType> | typeof ABORTED) => void;
  reject: (reason: unknown) => void;
};

/**
 * Central service for all network requests.
 * Created by Player, passed to controllers.
 * Owns request construction, fetch execution,
 * state management, and cancellation.
 */
export class NetworkService {
  private entries_ = new Map<
    Request<ResponseType>,
    RequestEntry
  >();

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
    const { promise, resolve, reject } =
      Promise.withResolvers<Response<T> | typeof ABORTED>();

    const controller = new AbortController();

    const request: Request<T> = {
      url,
      method: "GET",
      headers: new Headers(),
      responseType,
      inFlight: true,
      cancelled: false,
      promise,
    };

    this.entries_.set(
      request,
      { controller, resolve, reject } as RequestEntry,
    );

    this.player_.emit(Events.NETWORK_REQUEST, {
      type,
      request,
    });

    this.fetch_(type, request, controller.signal)
      .then((response) => {
        request.inFlight = false;
        this.entries_.delete(request);

        this.player_.emit(Events.NETWORK_RESPONSE, {
          type,
          request,
          response,
        });

        resolve(response);
      })
      .catch((error) => {
        request.inFlight = false;
        this.entries_.delete(request);

        if (isAbortError(error)) {
          resolve(ABORTED);
        } else {
          reject(error);
        }
      });

    return request;
  }

  /** Cancel an in-flight request. */
  cancel(request: Request<ResponseType>) {
    const entry = this.entries_.get(request);
    if (!entry) {
      return;
    }

    request.cancelled = true;
    request.inFlight = false;
    entry.controller.abort();
    entry.resolve(ABORTED);
    this.entries_.delete(request);
  }

  private async fetch_<T extends ResponseType>(
    type: RequestType,
    request: Request<T>,
    signal: AbortSignal,
  ): Promise<Response<T>> {
    const start = performance.now();

    const res = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      signal,
    });

    if (!res.ok) {
      throw new Error(
        `HTTP ${res.status} ${res.statusText}`,
      );
    }

    const data = request.responseType === "text"
      ? await res.text()
      : await res.arrayBuffer();
    const timeElapsed = performance.now() - start;

    return {
      request,
      status: res.status,
      headers: res.headers,
      data: data as Response<T>["data"],
      timeElapsed,
    };
  }
}

function isAbortError(error: unknown) {
  return (
    error instanceof DOMException &&
    error.name === "AbortError"
  );
}

import type { NetworkResponse } from "../net/network_response";

/**
 * Categorizes a network request for event listeners.
 *
 * @public
 */
export enum NetworkRequestType {
  MANIFEST = "manifest",
  SEGMENT = "segment",
}

/**
 * Sentinel returned when a request is cancelled via
 * {@link NetworkService.cancel}.
 *
 * @public
 */
export const ABORTED: unique symbol = Symbol("ABORTED");

/**
 * Promise that resolves to a {@link NetworkResponse} or {@link ABORTED}
 * if the request was cancelled.
 *
 * @public
 */
export type NetworkResponsePromise = Promise<NetworkResponse | typeof ABORTED>;

/**
 * Mutable request descriptor. Listeners can modify `url`, `method`, and
 * `headers` before the fetch is sent.
 *
 * @public
 */
export type NetworkRequest = {
  /** Fully resolved request URL. Mutable before fetch. */
  url: string;
  /** HTTP method. Mutable before fetch. */
  method: "GET" | "POST";
  /** HTTP headers. Mutable before fetch. */
  headers: Headers;
  /** Whether the request is currently in flight. */
  inFlight: boolean;
  /** Whether the request was cancelled. */
  cancelled: boolean;
  /** Resolves when the request completes or is cancelled. */
  promise: NetworkResponsePromise;
};

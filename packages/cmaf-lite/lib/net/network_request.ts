import type { NetworkResponsePromise } from "../types/net";

/**
 * Symbol-keyed abort controller, hidden from external callers.
 *
 * @internal
 */
export const ABORT_CONTROLLER = Symbol("abortController");

/**
 * Options for a network request.
 *
 * @public
 */
export type NetworkRequestOptions = {
  /** Total number of attempts (1 = no retry). */
  maxAttempts: number;
  /** Delay in milliseconds between retry attempts. */
  delay: number;
};

/**
 * Mutable request descriptor. Listeners can modify `url`, `method`,
 * and `headers` before each fetch attempt.
 *
 * @public
 */
export class NetworkRequest {
  method: "GET" | "POST" = "GET";
  headers = new Headers();
  inFlight = true;
  attempt = 0;
  [ABORT_CONTROLLER] = new AbortController();

  constructor(
    public url: string,
    public readonly promise: NetworkResponsePromise,
    public readonly options: NetworkRequestOptions = {
      maxAttempts: 1,
      delay: 0,
    },
  ) {}
}

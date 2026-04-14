import type {
  AbortableNetworkResponse,
  NetworkRequestOptions,
} from "../types/net";

/**
 * Symbol-keyed abort controller, hidden from external callers.
 *
 * @internal
 */
export const ABORT_CONTROLLER = Symbol("abortController");

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
    public readonly promise: Promise<AbortableNetworkResponse>,
    public readonly options: NetworkRequestOptions = {
      maxAttempts: 1,
      delay: 0,
    },
  ) {}
}

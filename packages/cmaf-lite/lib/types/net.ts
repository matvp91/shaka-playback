export type { NetworkRequestOptions } from "../net/network_request";
export { NetworkRequest } from "../net/network_request";

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
 * A network response, either {@link NetworkResponse} or {@link ABORTED}
 * if the request was cancelled.
 *
 * @public
 */
export type AbortableNetworkResponse = NetworkResponse | typeof ABORTED;

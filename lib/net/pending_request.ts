import type { Request } from "./request";
import type { Response } from "./response";

export const REQUEST_CANCELLED = Symbol.for("REQUEST_CANCELLED");

/**
 * In-flight network operation handle. Created
 * only by NetworkService.request(). Wraps the
 * fetch promise and manages cancellation.
 */
export class PendingRequest {
  readonly request: Request;
  readonly promise: Promise<Response | typeof REQUEST_CANCELLED>;

  private controller_: AbortController;

  constructor(
    request: Request,
    promise: Promise<Response | typeof REQUEST_CANCELLED>,
    controller: AbortController,
  ) {
    this.request = request;
    this.promise = promise;
    this.controller_ = controller;
  }

  /** Abort the in-flight request. */
  cancel() {
    this.controller_.abort();
  }
}

import type { Request } from "./request";
import type { Response } from "./response";

/**
 * In-flight network operation handle. Created
 * only by NetworkService.request(). Wraps the
 * fetch promise and manages cancellation.
 */
export class PendingRequest {
  readonly request: Request;
  readonly promise: Promise<Response | null>;

  cancelled = false;

  private controller_: AbortController;

  constructor(
    request: Request,
    promise: Promise<Response | null>,
    controller: AbortController,
  ) {
    this.request = request;
    this.promise = promise;
    this.controller_ = controller;
  }

  /** Abort the in-flight request. */
  cancel() {
    this.cancelled = true;
    this.controller_.abort();
  }
}

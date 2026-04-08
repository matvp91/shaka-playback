import type { Response } from "./response";
import { resolversSymbol } from "./types";

export type HttpMethod = "GET" | "POST";

/**
 * Network request with built-in cancellation
 * and promise resolution. Mutable properties
 * allow event listeners to modify the request
 * before the fetch fires.
 */
export class Request {
  method: HttpMethod = "GET";
  headers = new Headers();
  cancelled = false;

  private controller_ = new AbortController();
  private resolvers_ = Promise.withResolvers<Response | null>();

  constructor(public url: string) {}

  get [resolversSymbol]() {
    return this.resolvers_;
  }

  get promise() {
    return this.resolvers_.promise;
  }

  get signal() {
    return this.controller_.signal;
  }

  /** Cancel the in-flight request. */
  cancel() {
    this.cancelled = true;
    this.controller_.abort();
  }
}

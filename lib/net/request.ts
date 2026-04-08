import type { Response } from "./response";

export type HttpMethod = "GET" | "POST";

export const promiseResolversSymbol = Symbol("promiseResolvers");

/**
 * Network request with built-in cancellation
 * and promise resolution. Mutable properties
 * allow event listeners to modify the request
 * before the fetch fires.
 */
export class Request {
  url: string;
  method: HttpMethod;
  headers: Headers;
  cancelled = false;
  readonly signal: AbortSignal;

  private controller_ = new AbortController();
  private promiseResolvers_ = Promise.withResolvers<Response | null>();

  get [promiseResolversSymbol]() {
    return this.promiseResolvers_;
  }

  get promise() {
    return this.promiseResolvers_.promise;
  }

  constructor(url: string) {
    this.url = url;
    this.method = "GET";
    this.headers = new Headers();
    this.signal = this.controller_.signal;
  }

  /** Cancel the in-flight request. */
  cancel() {
    this.cancelled = true;
    this.controller_.abort();
  }
}

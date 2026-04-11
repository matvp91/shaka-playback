import type { NetworkRequest } from "../types/net";

/**
 * Completed network response with access to the response body as raw
 * bytes or decoded text.
 *
 * @public
 */
export class NetworkResponse {
  /**
   * @param request - The originating request.
   * @param status - HTTP status code.
   * @param headers - Response headers.
   * @param timeElapsed - Round-trip time in milliseconds.
   * @param data_ - Raw response body.
   */
  constructor(
    public request: NetworkRequest,
    public status: number,
    public headers: Headers,
    public timeElapsed: number,
    private data_: ArrayBuffer,
  ) {}

  /**
   * Response body as raw bytes.
   */
  get arrayBuffer() {
    return this.data_;
  }

  /**
   * Response body decoded as UTF-8 text.
   */
  get text() {
    return NetworkResponse.decoder_.decode(this.data_);
  }

  private static decoder_ = new TextDecoder();
}

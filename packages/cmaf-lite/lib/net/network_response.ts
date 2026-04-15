import type { NetworkRequest } from "./network_request";

/**
 * Completed network response with access to the response body as raw
 * bytes or decoded text.
 *
 * @public
 */
export class NetworkResponse {
  public endTime: number;

  /**
   * @param request - The originating request.
   * @param status - HTTP status code.
   * @param headers - Response headers.
   * @param startTime - The start time of receiving the response, in milliseconds.
   * @param data_ - Raw response body.
   */
  constructor(
    public request: NetworkRequest,
    public status: number,
    public headers: Headers,
    public startTime: number,
    private data_: ArrayBuffer,
  ) {
    // When we create a network response, we have the data available
    // directly. It's safe to say this is the end time.
    this.endTime = performance.now();
  }

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

  /**
   * The duration in seconds that the response was in flight.
   */
  get durationSec() {
    return (this.endTime - this.startTime) / 1000;
  }

  private static decoder_ = new TextDecoder();
}

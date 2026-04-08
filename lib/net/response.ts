const decoder = new TextDecoder();

/**
 * Immutable network response. Data is always
 * fetched as ArrayBuffer — use text() to decode.
 */
export class Response {
  readonly url: string;
  readonly status: number;
  readonly headers: Headers;
  readonly data: ArrayBuffer;
  readonly timeElapsed: number;

  constructor(
    url: string,
    status: number,
    headers: Headers,
    data: ArrayBuffer,
    timeElapsed: number,
  ) {
    this.url = url;
    this.status = status;
    this.headers = headers;
    this.data = data;
    this.timeElapsed = timeElapsed;
  }

  /** Decode the ArrayBuffer as UTF-8 text. */
  text(): string {
    return decoder.decode(this.data);
  }
}

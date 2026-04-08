import type { Request } from "./request";

const decoder = new TextDecoder();

/**
 * Immutable network response. Data is always
 * fetched as ArrayBuffer — use text() to decode.
 */
export class Response {
  constructor(
    readonly request: Request,
    readonly status: number,
    readonly headers: Headers,
    readonly data: ArrayBuffer,
    readonly timeElapsed: number,
  ) {}

  /** Decode the ArrayBuffer as UTF-8 text. */
  text(): string {
    return decoder.decode(this.data);
  }
}

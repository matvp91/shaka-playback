import type { NetworkRequest } from "./types";

const decoder = new TextDecoder();

export class NetworkResponse {
  constructor(
    public request: NetworkRequest,
    public status: number,
    public headers: Headers,
    public timeElapsed: number,
    private data_: ArrayBuffer,
  ) {}

  get arrayBuffer() {
    return this.data_;
  }

  get text() {
    return decoder.decode(this.data_);
  }
}

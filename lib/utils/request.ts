type ResponseTypeMap = {
  text: string;
  arraybuffer: ArrayBuffer;
};

/**
 * Type-safe fetch wrapper with cancellation support.
 * Wraps the Fetch API with an AbortController for
 * cancelling in-flight network requests.
 */
export class Request<T extends keyof ResponseTypeMap> {
  readonly response: Promise<ResponseTypeMap[T]>;

  private controller_ = new AbortController();

  constructor(url: string, responseType: T) {
    this.response = this.fetch_(url, responseType);
  }

  cancel() {
    this.controller_.abort();
  }

  private async fetch_(
    url: string,
    responseType: T,
  ): Promise<ResponseTypeMap[T]> {
    const response = await fetch(url, {
      signal: this.controller_.signal,
    });
    if (responseType === "text") {
      return (await response.text()) as ResponseTypeMap[T];
    }
    return (await response.arrayBuffer()) as ResponseTypeMap[T];
  }
}

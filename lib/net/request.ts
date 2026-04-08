export type HttpMethod = "GET" | "POST";

/**
 * Mutable request descriptor. Event listeners
 * can modify properties before the fetch fires.
 */
export type Request = {
  url: string;
  method: HttpMethod;
  headers: Headers;
};

/**
 * Create a request with sensible defaults.
 * Method defaults to GET, headers to empty.
 */
export function makeRequest(url: string): Request {
  return {
    url,
    method: "GET",
    headers: new Headers(),
  };
}

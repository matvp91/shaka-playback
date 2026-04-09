export enum RequestType {
  MANIFEST = "manifest",
  SEGMENT = "segment",
}

export type HttpMethod = "GET" | "POST";

export type ResponseType = "arrayBuffer" | "text";

export const ABORTED: unique symbol = Symbol("ABORTED");

export type RequestPromise<T extends ResponseType = ResponseType> = Promise<
  Response<T> | typeof ABORTED
>;

export type Request<T extends ResponseType = ResponseType> = {
  url: string;
  method: HttpMethod;
  headers: Headers;
  responseType: T;
  inFlight: boolean;
  cancelled: boolean;
  promise: RequestPromise<T>;
};

export type Response<T extends ResponseType = ResponseType> = {
  request: Request<T>;
  status: number;
  headers: Headers;
  data: {
    arrayBuffer: ArrayBuffer;
    text: string;
  }[T];
  timeElapsed: number;
};

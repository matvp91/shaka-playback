export type HttpMethod = "GET" | "POST";

export type ResponseType = "arrayBuffer" | "text";

export const ABORTED: unique symbol = Symbol("ABORTED");

type ResponseData = {
  arrayBuffer: ArrayBuffer;
  text: string;
};

export type Request<T extends ResponseType = ResponseType> = {
  url: string;
  method: HttpMethod;
  headers: Headers;
  responseType: T;
  inFlight: boolean;
  cancelled: boolean;
  promise: Promise<Response<T> | typeof ABORTED>;
};

export type Response<T extends ResponseType = ResponseType> = {
  request: Request<T>;
  status: number;
  headers: Headers;
  data: ResponseData[T];
  timeElapsed: number;
};

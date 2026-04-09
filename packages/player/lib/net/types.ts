import type { NetworkResponse } from "./network_response";

export enum NetworkRequestType {
  MANIFEST = "manifest",
  SEGMENT = "segment",
}

export const ABORTED: unique symbol = Symbol("ABORTED");

export type NetworkResponsePromise = Promise<NetworkResponse | typeof ABORTED>;

export type NetworkRequest = {
  url: string;
  method: "GET" | "POST";
  headers: Headers;
  inFlight: boolean;
  cancelled: boolean;
  promise: NetworkResponsePromise;
};

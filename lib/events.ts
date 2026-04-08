import type { PlayerError } from "./errors";
import type {
  InitSegment,
  Manifest,
  MediaTrack,
  MediaType,
  Segment,
} from "./types";
import type { Request } from "./net/request";
import type { RequestType } from "./net/network_service";
import type { Response } from "./net/response";

export const Events = {
  MANIFEST_LOADING: "manifestLoading",
  MANIFEST_PARSED: "manifestParsed",
  MEDIA_ATTACHING: "mediaAttaching",
  MEDIA_ATTACHED: "mediaAttached",
  MEDIA_DETACHED: "mediaDetached",
  BUFFER_CODECS: "bufferCodecs",
  BUFFER_CREATED: "bufferCreated",
  BUFFER_APPENDING: "bufferAppending",
  BUFFER_APPENDED: "bufferAppended",
  BUFFER_EOS: "bufferEos",
  NETWORK_REQUEST: "networkRequest",
  NETWORK_RESPONSE: "networkResponse",
  ERROR: "error",
};

export type ManifestLoadingEvent = {
  url: string;
};

export type ManifestParsedEvent = {
  manifest: Manifest;
};

export type MediaAttachingEvent = {
  media: HTMLMediaElement;
};

export type MediaAttachedEvent = {
  media: HTMLMediaElement;
  mediaSource: MediaSource;
};

export type BufferCodecsEvent = {
  mediaTracks: Map<MediaType, MediaTrack>;
  duration: number;
};

export type BufferCreatedEvent = {
  sourceBuffers: Map<MediaType, SourceBuffer>;
};

export type BufferAppendingEvent = {
  type: MediaType;
  initSegment: InitSegment;
  data: ArrayBuffer;
  segment: Segment | null;
};

export type BufferAppendedEvent = {
  type: MediaType;
};

export type NetworkRequestEvent = {
  type: RequestType;
  request: Request;
};

export type NetworkResponseEvent = {
  type: RequestType;
  request: Request;
  response: Response;
};

export type ErrorEvent = {
  error: PlayerError;
};

export interface EventMap {
  [Events.MANIFEST_LOADING]: (event: ManifestLoadingEvent) => void;
  [Events.MANIFEST_PARSED]: (event: ManifestParsedEvent) => void;
  [Events.MEDIA_ATTACHING]: (event: MediaAttachingEvent) => void;
  [Events.MEDIA_ATTACHED]: (event: MediaAttachedEvent) => void;
  [Events.MEDIA_DETACHED]: undefined;
  [Events.BUFFER_CODECS]: (event: BufferCodecsEvent) => void;
  [Events.BUFFER_CREATED]: (event: BufferCreatedEvent) => void;
  [Events.BUFFER_APPENDING]: (event: BufferAppendingEvent) => void;
  [Events.BUFFER_APPENDED]: (event: BufferAppendedEvent) => void;
  [Events.BUFFER_EOS]: undefined;
  [Events.NETWORK_REQUEST]: (event: NetworkRequestEvent) => void;
  [Events.NETWORK_RESPONSE]: (event: NetworkResponseEvent) => void;
  [Events.ERROR]: (event: ErrorEvent) => void;
}

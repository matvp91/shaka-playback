import type {
  InitSegment,
  Manifest,
  MediaType,
  NetworkRequest,
  NetworkRequestType,
  NetworkResponse,
  Segment,
  StreamPreference,
} from ".";

export const Events = {
  MANIFEST_LOADING: "manifestLoading",
  MANIFEST_PARSED: "manifestParsed",
  MEDIA_ATTACHING: "mediaAttaching",
  MEDIA_ATTACHED: "mediaAttached",
  MEDIA_DETACHED: "mediaDetached",
  BUFFER_CODECS: "bufferCodecs",
  BUFFER_APPENDING: "bufferAppending",
  BUFFER_APPENDED: "bufferAppended",
  BUFFER_EOS: "bufferEos",
  NETWORK_REQUEST: "networkRequest",
  NETWORK_RESPONSE: "networkResponse",
  STREAM_PREFERENCE_CHANGED: "streamPreferenceChanged",
} as const;

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
  type: MediaType;
  mimeType: string;
  duration: number;
};

export type BufferAppendingEvent = {
  type: MediaType;
  initSegment: InitSegment;
  data: ArrayBuffer;
  segment: Segment | null;
};

export type BufferAppendedEvent = {
  type: MediaType;
  initSegment: InitSegment;
  data: ArrayBuffer;
  segment: Segment | null;
};

export type NetworkRequestEvent = {
  type: NetworkRequestType;
  request: NetworkRequest;
};

export type NetworkResponseEvent = {
  type: NetworkRequestType;
  response: NetworkResponse;
};

export type StreamPreferenceChangedEvent = {
  preference: StreamPreference;
};

export interface EventMap {
  [Events.MANIFEST_LOADING]: (event: ManifestLoadingEvent) => void;
  [Events.MANIFEST_PARSED]: (event: ManifestParsedEvent) => void;
  [Events.MEDIA_ATTACHING]: (event: MediaAttachingEvent) => void;
  [Events.MEDIA_ATTACHED]: (event: MediaAttachedEvent) => void;
  [Events.MEDIA_DETACHED]: undefined;
  [Events.BUFFER_CODECS]: (event: BufferCodecsEvent) => void;
  [Events.BUFFER_APPENDING]: (event: BufferAppendingEvent) => void;
  [Events.BUFFER_APPENDED]: (event: BufferAppendedEvent) => void;
  [Events.BUFFER_EOS]: undefined;
  [Events.NETWORK_REQUEST]: (event: NetworkRequestEvent) => void;
  [Events.NETWORK_RESPONSE]: (event: NetworkResponseEvent) => void;
  [Events.STREAM_PREFERENCE_CHANGED]: (
    event: StreamPreferenceChangedEvent,
  ) => void;
}

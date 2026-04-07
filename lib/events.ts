import type { Manifest, MediaType } from "./types/manifest";

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
  tracks: Map<MediaType, { mimeType: string; codec: string }>;
  duration: number;
};

export type BufferAppendingEvent = {
  type: MediaType;
  data: ArrayBuffer;
  timestampOffset?: number;
};

export type BufferAppendedEvent = {
  type: MediaType;
};

export interface EventMap {
  [Events.MANIFEST_LOADING]: (event: ManifestLoadingEvent) => void;
  [Events.MANIFEST_PARSED]: (event: ManifestParsedEvent) => void;
  [Events.MEDIA_ATTACHING]: (event: MediaAttachingEvent) => void;
  [Events.MEDIA_ATTACHED]: (event: MediaAttachedEvent) => void;
  [Events.MEDIA_DETACHED]: undefined;
  [Events.BUFFER_CODECS]: (event: BufferCodecsEvent) => void;
  [Events.BUFFER_CREATED]: undefined;
  [Events.BUFFER_APPENDING]: (event: BufferAppendingEvent) => void;
  [Events.BUFFER_APPENDED]: (event: BufferAppendedEvent) => void;
  [Events.BUFFER_EOS]: undefined;
}

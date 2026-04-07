import type {
  Manifest,
  MediaGroup,
  MediaType,
  Segment,
} from "./types/manifest";

export const Events = {
  MANIFEST_LOADING: "manifestLoading",
  MANIFEST_PARSED: "manifestParsed",
  MEDIA_ATTACHING: "mediaAttaching",
  MEDIA_ATTACHED: "mediaAttached",
  MEDIA_DETACHED: "mediaDetached",
  MEDIA_GROUPS_UPDATED: "mediaGroupsUpdated",
  BUFFER_CREATED: "bufferCreated",
  SEGMENT_LOADED: "segmentLoaded",
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

export type MediaGroupsUpdatedEvent = {
  groups: MediaGroup[];
};

export type SegmentLoadedEvent = {
  type: MediaType;
  segment: Segment;
  data: ArrayBuffer;
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
  [Events.MEDIA_GROUPS_UPDATED]: (event: MediaGroupsUpdatedEvent) => void;
  [Events.BUFFER_CREATED]: undefined;
  [Events.SEGMENT_LOADED]: (event: SegmentLoadedEvent) => void;
  [Events.BUFFER_APPENDED]: (event: BufferAppendedEvent) => void;
  [Events.BUFFER_EOS]: undefined;
}

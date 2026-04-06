import type { Manifest, Track, TrackType } from "./types/manifest";

export const Events = {
  MANIFEST_LOADING: "manifestLoading",
  MANIFEST_PARSED: "manifestParsed",
  MEDIA_ATTACHING: "mediaAttaching",
  MEDIA_ATTACHED: "mediaAttached",
  MEDIA_DETACHED: "mediaDetached",
  TRACKS_SELECTED: "tracksSelected",
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

export type TracksSelectedEvent = {
  tracks: Track[];
};

export type SegmentLoadedEvent = {
  track: Track;
  data: ArrayBuffer;
};

export type BufferAppendedEvent = {
  type: TrackType;
};

export interface EventMap {
  [Events.MANIFEST_LOADING]: (event: ManifestLoadingEvent) => void;
  [Events.MANIFEST_PARSED]: (event: ManifestParsedEvent) => void;
  [Events.MEDIA_ATTACHING]: (event: MediaAttachingEvent) => void;
  [Events.MEDIA_ATTACHED]: (event: MediaAttachedEvent) => void;
  [Events.MEDIA_DETACHED]: undefined;
  [Events.TRACKS_SELECTED]: (event: TracksSelectedEvent) => void;
  [Events.BUFFER_CREATED]: undefined;
  [Events.SEGMENT_LOADED]: (event: SegmentLoadedEvent) => void;
  [Events.BUFFER_APPENDED]: (event: BufferAppendedEvent) => void;
  [Events.BUFFER_EOS]: undefined;
}

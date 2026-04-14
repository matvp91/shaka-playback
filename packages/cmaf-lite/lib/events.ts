import type {
  InitSegment,
  Manifest,
  NetworkRequest,
  NetworkRequestType,
  NetworkResponse,
  Segment,
  SourceBufferMediaType,
  Stream,
} from ".";

/**
 * Event name constants emitted by the {@link Player}.
 *
 * @public
 */
export const Events = {
  MANIFEST_LOADING: "manifestLoading",
  MANIFEST_PARSED: "manifestParsed",
  MEDIA_ATTACHING: "mediaAttaching",
  MEDIA_ATTACHED: "mediaAttached",
  MEDIA_DETACHING: "mediaDetaching",
  MEDIA_DETACHED: "mediaDetached",
  BUFFER_CODECS: "bufferCodecs",
  BUFFER_APPENDING: "bufferAppending",
  BUFFER_APPENDED: "bufferAppended",
  BUFFER_EOS: "bufferEos",
  BUFFER_FLUSHING: "bufferFlushing",
  BUFFER_FLUSHED: "bufferFlushed",
  BUFFER_APPEND_ERROR: "bufferAppendError",
  STREAM_CHANGED: "streamChanged",
  NETWORK_REQUEST: "networkRequest",
  NETWORK_RESPONSE: "networkResponse",
} as const;

/**
 * Fired when {@link Player.load} started loading a manifest.
 *
 * @public
 */
export type ManifestLoadingEvent = {
  url: string;
};

/**
 * Fired when a manifest has been fetched and parsed.
 *
 * @public
 */
export type ManifestParsedEvent = {
  manifest: Manifest;
};

/**
 * Fired when {@link Player.attachMedia} is called and the media element
 * is being attached.
 *
 * @public
 */
export type MediaAttachingEvent = {
  media: HTMLMediaElement;
};

/**
 * Fired when the media element and MediaSource are ready for buffering.
 *
 * @public
 */
export type MediaAttachedEvent = {
  media: HTMLMediaElement;
  mediaSource: MediaSource;
};

/**
 * Fired when {@link Player.detachMedia} is called, before the media element
 * is detached. Listeners can perform detach-time cleanup that needs access
 * to the media element.
 *
 * @public
 */
export type MediaDetachingEvent = {
  media: HTMLMediaElement;
};

/**
 * Fired when a SourceBuffer is being created for a new media type.
 *
 * @public
 */
export type BufferCodecsEvent = {
  type: SourceBufferMediaType;
  codec: string;
};

/**
 * Fired before a segment is appended to a SourceBuffer.
 *
 * @public
 */
export type BufferAppendingEvent = {
  type: SourceBufferMediaType;
  segment: InitSegment | Segment;
  data: ArrayBuffer;
};

/**
 * Fired after a segment has been appended to a SourceBuffer.
 *
 * @public
 */
export type BufferAppendedEvent = {
  type: SourceBufferMediaType;
  segment: InitSegment | Segment;
  data: ArrayBuffer;
};

/**
 * Fired when a SourceBuffer append operation failed.
 *
 * @public
 */
export type BufferAppendErrorEvent = {
  type: SourceBufferMediaType;
  error: DOMException;
};

/**
 * Fired to request a SourceBuffer flush. Paired with
 * {@link BufferFlushedEvent}, which fires after the flush completes.
 *
 * @public
 */
export type BufferFlushingEvent = {
  type: SourceBufferMediaType;
};

/**
 * Fired when a SourceBuffer is flushed.
 *
 * @public
 */
export type BufferFlushedEvent = {
  type: SourceBufferMediaType;
};

/**
 * Fired when the active stream changes for a media type.
 * `oldStream` is `null` on initial stream selection.
 *
 * @public
 */
export type StreamChangedEvent = {
  oldStream: Stream | null;
  stream: Stream;
};

/**
 * Fired before a network request is sent. Listeners can mutate the request
 * URL, headers, and method.
 *
 * @public
 */
export type NetworkRequestEvent = {
  type: NetworkRequestType;
  request: NetworkRequest;
};

/**
 * Fired when a network response has been received.
 *
 * @public
 */
export type NetworkResponseEvent = {
  type: NetworkRequestType;
  response: NetworkResponse;
};

/**
 * Maps each event name to its listener signature.
 *
 * @public
 */
export interface EventMap {
  [Events.MANIFEST_LOADING]: (event: ManifestLoadingEvent) => void;
  [Events.MANIFEST_PARSED]: (event: ManifestParsedEvent) => void;
  [Events.MEDIA_ATTACHING]: (event: MediaAttachingEvent) => void;
  [Events.MEDIA_ATTACHED]: (event: MediaAttachedEvent) => void;
  [Events.MEDIA_DETACHING]: (event: MediaDetachingEvent) => void;
  [Events.MEDIA_DETACHED]: undefined;
  [Events.BUFFER_CODECS]: (event: BufferCodecsEvent) => void;
  [Events.BUFFER_APPENDING]: (event: BufferAppendingEvent) => void;
  [Events.BUFFER_APPENDED]: (event: BufferAppendedEvent) => void;
  [Events.BUFFER_EOS]: undefined;
  [Events.BUFFER_FLUSHING]: (event: BufferFlushingEvent) => void;
  [Events.BUFFER_APPEND_ERROR]: (event: BufferAppendErrorEvent) => void;
  [Events.BUFFER_FLUSHED]: (event: BufferFlushedEvent) => void;
  [Events.STREAM_CHANGED]: (event: StreamChangedEvent) => void;
  [Events.NETWORK_REQUEST]: (event: NetworkRequestEvent) => void;
  [Events.NETWORK_RESPONSE]: (event: NetworkResponseEvent) => void;
}

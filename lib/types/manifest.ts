export enum MediaType {
  VIDEO = "video",
  AUDIO = "audio",
  TEXT = "text",
}

export type Manifest = {
  groups: MediaGroup[];
};

/**
 * Group of streams sharing codec and MIME type,
 * maps 1:1 to a SourceBuffer.
 */
export type MediaGroup = {
  type: MediaType;
  mimeType: string;
  codec: string;
  streams: Stream[];
};

/**
 * Single quality level as a sequence of segments,
 * seamlessly switchable within a MediaGroup.
 */
export type Stream = {
  bandwidth: number;
  initSegment: InitSegment;
  segments: Segment[];
} & (
  | {
      type: MediaType.VIDEO;
      width: number;
      height: number;
    }
  | {
      type: MediaType.AUDIO;
    }
);

/** Initialization segment for a stream. */
export type InitSegment = {
  url: string;
};

/**
 * Addressable media chunk with precise timing.
 */
export type Segment = {
  url: string;
  start: number;
  end: number;
};

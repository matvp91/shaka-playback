export enum MediaType {
  VIDEO = "video",
  AUDIO = "audio",
  TEXT = "text",
}

export type Manifest = {
  presentations: Presentation[];
};

/**
 * Time-bounded content period,
 * maps to a DASH Period.
 */
export type Presentation = {
  start: number;
  selectionSets: SelectionSet[];
};

/**
 * Groups content by media type,
 * maps 1:1 to an MSE SourceBuffer.
 */
export type SelectionSet = {
  type: MediaType;
  switchingSets: SwitchingSet[];
};

/**
 * CMAF switching set — tracks that can be
 * seamlessly switched between (same codec).
 */
export type SwitchingSet = {
  mimeType: string;
  codec: string;
  timeOffset: number;
  tracks: Track[];
};

/**
 * Single quality level as a sequence of
 * segments, discriminated by media type.
 */
export type Track = {
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

/** Initialization segment for a track. */
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

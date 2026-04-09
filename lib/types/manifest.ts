import type { MediaType } from "./media";

export type Manifest = {
  presentations: Presentation[];
};

/**
 * Time-bounded content period, maps to a DASH Period.
 */
export type Presentation = {
  start: number;
  end: number;
  selectionSets: SelectionSet[];
};

/**
 * Groups content by media type, maps 1:1 to a SourceBuffer.
 */
export type SelectionSet = {
  type: MediaType;
  switchingSets: SwitchingSet[];
};

/**
 * CMAF switching set — tracks that can be seamlessly
 * switched between (same codec).
 */
export type SwitchingSet = {
  codec: string;
  tracks: Track[];
};

/**
 * Single quality level as a sequence of segments,
 * discriminated by media type.
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

export type InitSegment = {
  url: string;
};

export type Segment = {
  url: string;
  start: number;
  end: number;
};

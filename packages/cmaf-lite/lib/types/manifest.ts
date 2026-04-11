import type { MediaType } from "./media";

export type Manifest = {
  duration: number;
  switchingSets: SwitchingSet[];
};

/**
 * CMAF switching set — tracks that can be seamlessly
 * switched between (same codec, same type).
 */
export type SwitchingSet = {
  type: MediaType;
  codec: string;
  tracks: Track[];
};

/**
 * Single quality level as a sequence of segments,
 * discriminated by media type.
 */
export type Track = {
  bandwidth: number;
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
  initSegment: InitSegment;
};

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

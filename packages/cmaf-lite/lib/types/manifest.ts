import type { MediaType } from "./media";

/**
 * Parsed manifest representing a CMAF presentation.
 *
 * @public
 */
export type Manifest = {
  /** Total duration in seconds. */
  duration: number;
  /** Groups of switchable tracks. */
  switchingSets: SwitchingSet[];
};

/**
 * CMAF switching set — tracks that can be seamlessly
 * switched between (same codec, same type).
 *
 * @public
 */
export type SwitchingSet = {
  /** Media type shared by all tracks. */
  type: MediaType;
  /** Codec shared by all tracks. */
  codec: string;
  /** Seamlessly switchable tracks. */
  tracks: Track[];
};

/**
 * Single track with its segment list, discriminated
 * by {@link MediaType}.
 *
 * @public
 */
export type Track = {
  /** Bitrate in bits per second. */
  bandwidth: number;
  /** Ordered chunks on the presentation timeline. */
  segments: Segment[];
} & (
  | {
      /** Video type */
      type: MediaType.VIDEO;
      /** Video width */
      width: number;
      /** Video height */
      height: number;
    }
  | {
      /** Audio type */
      type: MediaType.AUDIO;
    }
  | {
      /** Text type */
      type: MediaType.TEXT;
    }
);

/**
 * CMAF initialization segment (moov box).
 *
 * @public
 */
export type InitSegment = {
  /** Fully resolved URL. */
  url: string;
};

/**
 * Addressable media chunk on the presentation timeline.
 *
 * @public
 */
export type Segment = {
  /** Fully resolved URL. */
  url: string;
  /** Start time in seconds on the presentation timeline. */
  start: number;
  /** End time in seconds on the presentation timeline. */
  end: number;
  /** Associated initialization segment. */
  initSegment: InitSegment;
};

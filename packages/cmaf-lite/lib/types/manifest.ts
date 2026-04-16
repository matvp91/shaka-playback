import type { Prettify } from "./helpers";
import type { ByType, MediaType } from "./media";

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
export type SwitchingSet = Prettify<
  {
    /** Codec */
    codec: string;
  } & (
    | {
        /** Video type */
        type: MediaType.VIDEO;
        /** Video tracks */
        tracks: VideoTrack[];
      }
    | {
        /** Audio type */
        type: MediaType.AUDIO;
        /** Audio tracks */
        tracks: AudioTrack[];
      }
    | {
        /** Text type */
        type: MediaType.TEXT;
        /** Text tracks */
        tracks: TextTrack[];
      }
  )
>;

export type VideoSwitchingSet = ByType<SwitchingSet, MediaType.VIDEO>;
export type AudioSwitchingSet = ByType<SwitchingSet, MediaType.AUDIO>;
export type TextSwitchingSet = ByType<SwitchingSet, MediaType.TEXT>;

/**
 * Single track with its segment list, discriminated
 * by {@link MediaType}.
 *
 * @public
 */
export type Track = Prettify<
  {
    /** Bitrate in bits per second. */
    bandwidth: number;
    /** Ordered chunks on the presentation timeline. */
    segments: Segment[];
    /** Longest segment duration in seconds. */
    maxSegmentDuration: number;
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
  )
>;

export type VideoTrack = ByType<Track, MediaType.VIDEO>;
export type AudioTrack = ByType<Track, MediaType.AUDIO>;
export type TextTrack = ByType<Track, MediaType.TEXT>;

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

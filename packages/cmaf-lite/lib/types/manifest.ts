import type { MediaType } from "./media";

/**
 * Parsed manifest representing a CMAF presentation.
 *
 * @public
 */
export interface Manifest {
  /** Total duration in seconds. */
  duration: number;
  /** Groups of switchable tracks. */
  switchingSets: SwitchingSet[];
}

/**
 * Shared fields across all switching set types.
 *
 * @public
 */
export interface BaseSwitchingSet {
  /** Codec string. */
  codec: string;
}

/**
 * Video switching set.
 *
 * @public
 */
export interface VideoSwitchingSet extends BaseSwitchingSet {
  type: MediaType.VIDEO;
  /** Video tracks. */
  tracks: VideoTrack[];
}

/**
 * Audio switching set.
 *
 * @public
 */
export interface AudioSwitchingSet extends BaseSwitchingSet {
  type: MediaType.AUDIO;
  /** Audio tracks. */
  tracks: AudioTrack[];
}

/**
 * Text switching set.
 *
 * @public
 */
export interface TextSwitchingSet extends BaseSwitchingSet {
  type: MediaType.TEXT;
  /** Text tracks. */
  tracks: TextTrack[];
}

/**
 * CMAF switching set — tracks that can be seamlessly
 * switched between (same codec, same type).
 *
 * @public
 */
export type SwitchingSet<T extends MediaType = MediaType> = Extract<
  VideoSwitchingSet | AudioSwitchingSet | TextSwitchingSet,
  {
    type: T;
  }
>;

/**
 * Shared fields across all track types.
 *
 * @public
 */
export interface BaseTrack {
  /** Bitrate in bits per second. */
  bandwidth: number;
  /** Ordered chunks on the presentation timeline. */
  segments: Segment[];
  /** Longest segment duration in seconds. */
  maxSegmentDuration: number;
}

/**
 * Video track with resolution.
 *
 * @public
 */
export interface VideoTrack extends BaseTrack {
  type: MediaType.VIDEO;
  /** Video width. */
  width: number;
  /** Video height. */
  height: number;
}

/**
 * Audio track.
 *
 * @public
 */
export interface AudioTrack extends BaseTrack {
  type: MediaType.AUDIO;
}

/**
 * Text track.
 *
 * @public
 */
export interface TextTrack extends BaseTrack {
  type: MediaType.TEXT;
}

/**
 * Single track with its segment list, discriminated
 * by {@link MediaType}.
 *
 * @public
 */
export type Track<T extends MediaType = MediaType> = Extract<
  VideoTrack | AudioTrack | TextTrack,
  {
    type: T;
  }
>;

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

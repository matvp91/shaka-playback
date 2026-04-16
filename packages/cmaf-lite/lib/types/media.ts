import type { SwitchingSet, Track } from "./manifest";

/**
 * Supported media types.
 *
 * @public
 */
export enum MediaType {
  VIDEO = "video",
  AUDIO = "audio",
  TEXT = "text",
}

/**
 * Media types backed by a SourceBuffer.
 *
 * @public
 */
export type SourceBufferMediaType = MediaType.VIDEO | MediaType.AUDIO;

/**
 * Reference into the manifest that a {@link Stream} is a view of.
 * `switchingSet` and `track` are the exact manifest objects — not
 * copies — so reference equality can be used to detect a switching-set
 * change (which drives MSE `changeType`).
 *
 * @public
 */
export interface StreamHierarchy<T extends MediaType> {
  switchingSet: SwitchingSet<T>;
  track: Track<T>;
}

/**
 * Shared fields across all stream types.
 *
 * @public
 */
export interface BaseStream {
  /** Normalized codec. */
  codec: string;
  /** Bitrate in bits per second. */
  bandwidth: number;
}

/**
 * Video stream with resolution and hierarchy.
 *
 * @public
 */
export interface VideoStream extends BaseStream {
  type: MediaType.VIDEO;
  /** Video width. */
  width: number;
  /** Video height. */
  height: number;
  hierarchy: StreamHierarchy<MediaType.VIDEO>;
}

/**
 * Audio stream with hierarchy.
 *
 * @public
 */
export interface AudioStream extends BaseStream {
  type: MediaType.AUDIO;
  hierarchy: StreamHierarchy<MediaType.AUDIO>;
}

/**
 * Text stream. No additional fields today; text streams
 * are part of the stream model but not yet wired through
 * the stream controller.
 *
 * @public
 */
export interface TextStream extends BaseStream {
  type: MediaType.TEXT;
  hierarchy: StreamHierarchy<MediaType.TEXT>;
}

/**
 * Set of compatible, switchable tracks sharing a codec
 * and media type. Discriminated by {@link MediaType}.
 *
 * @public
 */
export type Stream<T extends MediaType = MediaType> = Extract<
  VideoStream | AudioStream | TextStream,
  {
    type: T;
  }
>;

/**
 * Shared fields across all stream preference types.
 *
 * @public
 */
export interface BaseStreamPreference {
  codec?: string;
  bandwidth?: number;
}

/**
 * Video stream preference with optional resolution targets.
 *
 * @public
 */
export interface VideoStreamPreference extends BaseStreamPreference {
  type: MediaType.VIDEO;
  width?: number;
  height?: number;
}

/**
 * Audio stream preference.
 *
 * @public
 */
export interface AudioStreamPreference extends BaseStreamPreference {
  type: MediaType.AUDIO;
}

/**
 * Text stream preference.
 *
 * @public
 */
export interface TextStreamPreference extends BaseStreamPreference {
  type: MediaType.TEXT;
}

/**
 * Soft targets for stream selection, discriminated by
 * {@link MediaType}. All fields besides `type` are optional
 * — the closest available match is chosen.
 *
 * @public
 */
export type StreamPreference<T extends MediaType = MediaType> = Extract<
  VideoStreamPreference | AudioStreamPreference | TextStreamPreference,
  {
    type: T;
  }
>;

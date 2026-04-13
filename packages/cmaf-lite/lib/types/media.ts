import type { OptionalExcept } from "./helpers";
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
export type StreamHierarchy = {
  switchingSet: SwitchingSet;
  track: Track;
};

/**
 * Set of compatible, switchable tracks sharing a codec
 * and media type. Discriminated by {@link MediaType}.
 *
 * @public
 */
export type Stream = {
  /** Normalized codec */
  codec: string;
  /** Bandwidth */
  bandwidth: number;
  /** Manifest entry this stream is a view of. */
  hierarchy: StreamHierarchy;
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
      /** Text type. No additional fields today; text streams are part
       * of the stream model but not yet wired through the stream
       * controller. */
      type: MediaType.TEXT;
    }
);

/**
 * User preference for stream selection. Properties are
 * optional — only specified fields constrain selection.
 *
 * @public
 */
export type StreamPreference = OptionalExcept<Stream, "type">;

/**
 * Narrows a union to the given {@link MediaType}.
 *
 * @public
 */
export type ByType<K, T extends MediaType> = Extract<K, { type: T }>;

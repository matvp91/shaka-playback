import type { OptionalExcept } from "./helpers";

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

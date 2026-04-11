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
 * Set of compatible, switchable tracks sharing a codec
 * and media type. Discriminated by {@link MediaType}.
 *
 * @public
 */
export type Stream = {
  /** Normalized codec */
  codec: string;
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
export type StreamPreference = {
  [K in Stream as K["type"]]: { type: K["type"] } & Partial<Omit<K, "type">>;
}[Stream["type"]];

/**
 * Narrows a union to the given {@link MediaType}.
 *
 * @public
 */
export type ByType<K, T extends MediaType> = Extract<K, { type: T }>;

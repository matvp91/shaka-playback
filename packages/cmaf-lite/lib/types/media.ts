import type { Prettify } from "./helpers";
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
export type StreamHierarchy<T extends MediaType = MediaType> = {
  switchingSet: SwitchingSet<T>;
  track: Track<T>;
};

/**
 * Set of compatible, switchable tracks sharing a codec
 * and media type. Discriminated by {@link MediaType}.
 *
 * @public
 */
export type Stream<T extends MediaType = MediaType> = TypeUnion<
  {
    /** Normalized codec */
    codec: string;
    /** Bandwidth */
    bandwidth: number;
  },
  | {
      /** Video type */
      type: MediaType.VIDEO;
      /** Video width */
      width: number;
      /** Video height */
      height: number;
      hierarchy: StreamHierarchy<MediaType.VIDEO>;
    }
  | {
      /** Audio type */
      type: MediaType.AUDIO;
      hierarchy: StreamHierarchy<MediaType.AUDIO>;
    }
  | {
      /**
       * Text type. No additional fields today; text streams are part
       * of the stream model but not yet wired through the stream
       * controller.
       */
      type: MediaType.TEXT;
      hierarchy: StreamHierarchy<MediaType.TEXT>;
    },
  T
>;

/**
 * @public
 */
export type StreamPreference<T extends MediaType = MediaType> = TypeUnion<
  {
    codec?: string;
    bandwidth?: number;
  },
  | {
      type: MediaType.VIDEO;
      width?: number;
      height?: number;
    }
  | {
      type: MediaType.AUDIO;
    }
  | {
      type: MediaType.TEXT;
    },
  T
>;

export type TypeUnion<TBase, TVariants, T = unknown> = Prettify<
  Extract<TBase & TVariants, { type: T }>
>;

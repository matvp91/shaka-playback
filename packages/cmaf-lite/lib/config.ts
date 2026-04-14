import type { Path, PathValue, Prettify } from "./types/helpers";
import type { NetworkRequestOptions } from "./types/net";

/**
 * Dot-notation paths for PlayerConfig.
 *
 * @public
 */
export type ConfigPath = Prettify<Path<PlayerConfig>>;

/**
 * Value at a given config path.
 *
 * @public
 */
export type ConfigPathValue<P extends ConfigPath> = Prettify<
  PathValue<PlayerConfig, P>
>;

/**
 * Player configuration. Override defaults via
 * `Player.setConfig`.
 *
 * @public
 */
export type PlayerConfig = {
  /**
   * Maximum seconds of media to buffer ahead of the
   * playback position.
   */
  frontBufferLength: number;
  /**
   * Maximum seconds of media to retain behind the
   * playback position. Set to `Infinity` to keep all
   * played data.
   */
  backBufferLength: number;
  /**
   * Extra seconds added to {@link PlayerConfig.backBufferLength} when
   * evicting data under a QuotaExceededError.
   */
  backBufferQuotaPadding: number;
  /**
   * Maximum gap in seconds between buffered ranges that
   * the player will automatically skip over.
   */
  maxBufferHole: number;
  /**
   * Tolerance in seconds when matching the playback
   * position to a segment's time range.
   */
  maxSegmentLookupTolerance: number;
  /** Network options for manifest requests. */
  manifestRequestOptions: NetworkRequestOptions;
  /** Network options for segment requests. */
  segmentRequestOptions: NetworkRequestOptions;
};

/**
 * Default config.
 *
 * @public
 */
export const DEFAULT_CONFIG: PlayerConfig = {
  frontBufferLength: 30,
  backBufferLength: Infinity,
  backBufferQuotaPadding: 2,
  maxBufferHole: 0.1,
  maxSegmentLookupTolerance: 0.25,
  manifestRequestOptions: {
    maxAttempts: 3,
    delay: 1000,
  },
  segmentRequestOptions: {
    maxAttempts: 3,
    delay: 500,
  },
};

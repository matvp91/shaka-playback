import type { Path, PathValue, Prettify } from "./types/helpers";
import type { NetworkRequestOptions } from "./types/net";

/** Dot-notation paths for PlayerConfig. */
export type ConfigPath = Prettify<Path<PlayerConfig>>;

/** Value at a given config path. */
export type ConfigPathValue<P extends ConfigPath> = Prettify<
  PathValue<PlayerConfig, P>
>;

/**
 * Player configuration.
 *
 * @public
 */
export type PlayerConfig = {
  frontBufferLength: number;
  backBufferLength: number;
  backBufferQuotaPadding: number;
  maxBufferHole: number;
  maxSegmentLookupTolerance: number;
  manifestRequestOptions: NetworkRequestOptions;
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

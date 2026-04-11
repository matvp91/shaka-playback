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
};

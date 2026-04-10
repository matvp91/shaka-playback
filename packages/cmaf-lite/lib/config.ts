export type PlayerConfig = {
  frontBufferLength: number;
  backBufferLength: number;
  backBufferQuotaPadding: number;
  maxBufferHole: number;
  maxSegmentLookupTolerance: number;
};

export const defaultConfig: PlayerConfig = {
  frontBufferLength: 30,
  backBufferLength: Infinity,
  backBufferQuotaPadding: 2,
  maxBufferHole: 0.1,
  maxSegmentLookupTolerance: 0.25,
};

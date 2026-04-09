export type PlayerConfig = {
  bufferGoal: number;
  bufferBehind: number;
  maxBufferHole: number;
  maxSegmentLookupTolerance: number;
};

export const defaultConfig: PlayerConfig = {
  bufferGoal: 30,
  bufferBehind: Infinity,
  maxBufferHole: 0.1,
  maxSegmentLookupTolerance: 0.25,
};

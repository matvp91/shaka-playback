export type PlayerConfig = {
  bufferGoal: number;
  bufferBehind: number;
  maxBufferHole: number;
};

export const defaultConfig: PlayerConfig = {
  bufferGoal: 30,
  bufferBehind: Infinity,
  maxBufferHole: 0.1,
};

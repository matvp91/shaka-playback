export type PlayerConfig = {
  bufferGoal: number;
  bufferBehind: number;
};

export const defaultConfig: PlayerConfig = {
  bufferGoal: 30,
  bufferBehind: Infinity,
};

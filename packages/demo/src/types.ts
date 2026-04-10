export type TimeRange = {
  start: number;
  end: number;
};

export type BufferData = {
  currentTime: number;
  paused: boolean;
  seekable: TimeRange | null;
  buffered: TimeRange[];
  played: TimeRange[];
  video: TimeRange[];
  audio: TimeRange[];
  frontBufferLength: number;
  backBufferLength: number;
};

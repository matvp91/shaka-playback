import type { Player } from "@bap/player";
import { MediaType } from "@bap/player";

type TimeRange = {
  start: string;
  end: string;
};

type BufferData = {
  currentTime: string;
  paused: boolean;
  seekable: TimeRange | null;
  buffered: TimeRange[];
  played: TimeRange[];
  video: TimeRange[];
  audio: TimeRange[];
  bufferGoal: number;
  bufferBehind: number;
};

/**
 * Converts a native TimeRanges object to an array
 * of TimeRange with toFixed(3) values.
 */
function toTimeRanges(ranges: TimeRanges): TimeRange[] {
  const result: TimeRange[] = [];
  for (let i = 0; i < ranges.length; i++) {
    result.push({
      start: ranges.start(i).toFixed(3),
      end: ranges.end(i).toFixed(3),
    });
  }
  return result;
}

/**
 * Reads all buffer-related state from the player
 * and video element. Returns null if no media
 * is attached.
 */
function getData(player: Player): BufferData | null {
  const media = player.getMedia();
  if (!media) {
    return null;
  }

  const config = player.getConfig();
  const seekableRanges = toTimeRanges(media.seekable);

  return {
    currentTime: media.currentTime.toFixed(3),
    paused: media.paused,
    seekable: seekableRanges[0] ?? null,
    buffered: toTimeRanges(media.buffered),
    played: toTimeRanges(media.played),
    video: toTimeRanges(player.getBuffered(MediaType.VIDEO)),
    audio: toTimeRanges(player.getBuffered(MediaType.AUDIO)),
    bufferGoal: config.bufferGoal,
    bufferBehind: config.bufferBehind,
  };
}

/**
 * Converts a time value to a CSS percentage string
 * within the seekable range. Returns "0%" if seekable
 * is null.
 */
function toPosition(time: string, seekable: TimeRange | null): string {
  if (!seekable) {
    return "0%";
  }
  const start = Number(seekable.start);
  const end = Number(seekable.end);
  const duration = end - start;
  if (duration <= 0) {
    return "0%";
  }
  const pct = ((Number(time) - start) / duration) * 100;
  return `${Math.max(0, Math.min(100, pct))}%`;
}

/**
 * Converts a TimeRange to CSS left/width percentage
 * strings within the seekable range.
 */
function toBarStyle(
  range: TimeRange,
  seekable: TimeRange | null,
): { left: string; width: string } {
  if (!seekable) {
    return { left: "0%", width: "0%" };
  }
  const start = Number(seekable.start);
  const end = Number(seekable.end);
  const duration = end - start;
  if (duration <= 0) {
    return { left: "0%", width: "0%" };
  }
  const left = ((Number(range.start) - start) / duration) * 100;
  const width = ((Number(range.end) - Number(range.start)) / duration) * 100;
  return {
    left: `${Math.max(0, left)}%`,
    width: `${Math.min(100 - Math.max(0, left), width)}%`,
  };
}

/**
 * Finds the buffered range containing currentTime
 * and returns ahead/behind distances. Returns null
 * if currentTime is not inside any range.
 */
function getBufferStat(
  ranges: TimeRange[],
  currentTime: string,
): { ahead: string; behind: string } | null {
  const ct = Number(currentTime);
  for (const range of ranges) {
    const start = Number(range.start);
    const end = Number(range.end);
    if (ct >= start && ct <= end) {
      return {
        ahead: (end - ct).toFixed(3),
        behind: (ct - start).toFixed(3),
      };
    }
  }
  return null;
}

type AppProps = {
  player: Player;
};

export function App({ player }: AppProps) {
  const data = getData(player);
  if (!data) {
    return null;
  }

  return <pre>{JSON.stringify(data, null, 2)}</pre>;
}

import type { Player } from "@bap/player";
import { MediaType } from "@bap/player";
import { BufferGraph } from "./components/buffer-graph/BufferGraph";
import type { BufferData, TimeRange } from "./types";

/**
 * Converts a native TimeRanges object to an array
 * of TimeRange.
 */
function toTimeRanges(ranges: TimeRanges): TimeRange[] {
  const result: TimeRange[] = [];
  for (let i = 0; i < ranges.length; i++) {
    result.push({
      start: ranges.start(i),
      end: ranges.end(i),
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
    currentTime: media.currentTime,
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

type AppProps = {
  player: Player;
};

export function App({ player }: AppProps) {
  let data: BufferData | null;
  try {
    data = getData(player);
  } catch {
    // TODO(matvp): getData reads getBuffered but that throws an error.
    // We shall find a way to signal loadStatus.
    return null;
  }
  if (!data) {
    return null;
  }

  return <BufferGraph data={data} />;
}

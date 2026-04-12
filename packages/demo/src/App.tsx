import type { Player } from "cmaf-lite";
import { MediaType } from "cmaf-lite";
import { BufferGraph } from "./components/buffer-graph/BufferGraph";
import { Preferences } from "./components/preferences/Preferences";
import { StreamList } from "./components/stream-list/StreamList";
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
 * Safely reads buffered ranges for a media type.
 * Returns empty array if source buffer is not yet available.
 */
function getBufferedRanges(player: Player, type: MediaType): TimeRange[] {
  try {
    return toTimeRanges(player.getBuffered(type));
  } catch {
    return [];
  }
}

type AppProps = {
  player: Player;
};

export function App({ player }: AppProps) {
  const media = player.getMedia();
  if (!media) {
    return null;
  }

  const config = player.getConfig();
  const seekableRanges = toTimeRanges(media.seekable);

  const data: BufferData = {
    currentTime: media.currentTime,
    seekable: seekableRanges[0] ?? null,
    buffered: toTimeRanges(media.buffered),
    played: toTimeRanges(media.played),
    video: getBufferedRanges(player, MediaType.VIDEO),
    audio: getBufferedRanges(player, MediaType.AUDIO),
    frontBufferLength: config.frontBufferLength,
    backBufferLength: config.backBufferLength,
  };

  return (
    <>
      <div className="flex">
        <StreamList player={player} />
        <Preferences player={player} />
      </div>
      <BufferGraph data={data} />
    </>
  );
}

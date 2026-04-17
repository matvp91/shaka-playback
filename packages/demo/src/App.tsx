import type { Player } from "cmaf-lite";
import { MediaType } from "cmaf-lite";
import { BufferGraph } from "./components/buffer-graph/BufferGraph";
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
    video: toTimeRanges(player.getBuffered(MediaType.VIDEO)),
    audio: toTimeRanges(player.getBuffered(MediaType.AUDIO)),
    frontBufferLength: config.frontBufferLength,
    backBufferLength: config.backBufferLength,
  };

  return (
    <>
      <div className="flex">
        <StreamList player={player} />
      </div>
      <BufferGraph data={data} />
    </>
  );
}

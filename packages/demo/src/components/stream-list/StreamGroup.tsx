import type { Player, Stream } from "cmaf-lite";
import type { MediaType } from "cmaf-lite";
import { StreamItem } from "./StreamItem";
import { formatStream } from "../../utils/stream";

type StreamGroupProps = {
  label: string;
  streams: Stream[];
  player: Player;
  type: MediaType;
};

export function StreamGroup({ label, streams, player, type }: StreamGroupProps) {
  if (streams.length === 0) {
    return null;
  }

  let activeStream: Stream | null = null;
  try {
    activeStream = player.getActiveStream(type);
  } catch {
    // No active stream yet.
  }

  return (
    <div>
      <h3>{label}</h3>
      {streams.map((stream) => (
        <StreamItem
          key={formatStream(stream)}
          stream={stream}
          active={
            activeStream !== null &&
            formatStream(stream) === formatStream(activeStream)
          }
        />
      ))}
    </div>
  );
}

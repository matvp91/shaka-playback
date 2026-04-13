import type { MediaType, Player } from "cmaf-lite";
import { callSafe } from "../../utils/helpers";
import { formatStream } from "../../utils/stream";
import { StreamItem } from "./StreamItem";

type StreamGroupProps = {
  label: string;
  player: Player;
  type: MediaType;
};

export function StreamGroup({
  label,
  player,
  type,
}: StreamGroupProps) {
  const streams = callSafe(() => player.getStreams(type), []);
  const activeStream = callSafe(() => player.getActiveStream(type));

  return (
    <div>
      <h3>{label}</h3>
      {streams.map((stream) => (
        <StreamItem
          key={formatStream(stream)}
          stream={stream}
          active={stream === activeStream}
          onClick={() => player.setStreamPreference(stream, true)}
        />
      ))}
    </div>
  );
}

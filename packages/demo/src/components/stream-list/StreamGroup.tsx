import type { MediaType, Player } from "cmaf-lite";
import { formatStream } from "../../utils/stream";
import { StreamItem } from "./StreamItem";

type StreamGroupProps = {
  label: string;
  player: Player;
  type: MediaType;
};

export function StreamGroup({ label, player, type }: StreamGroupProps) {
  const streams = player.getStreams(type);
  const activeStream = player.getStream(type);

  return (
    <div>
      <h3>{label}</h3>
      {streams.map((stream) => (
        <StreamItem
          key={formatStream(stream)}
          stream={stream}
          active={stream === activeStream}
          onClick={() => {
            player.setStream(stream);
          }}
        />
      ))}
    </div>
  );
}

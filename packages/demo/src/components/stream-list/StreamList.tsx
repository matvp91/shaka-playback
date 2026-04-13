import type { Player, Stream } from "cmaf-lite";
import { MediaType } from "cmaf-lite";
import { groupByType } from "../../utils/stream";
import { StreamGroup } from "./StreamGroup";

type StreamListProps = {
  player: Player;
};

export function StreamList({ player }: StreamListProps) {
  let streams: Stream[];
  try {
    streams = player.getStreams();
  } catch {
    return null;
  }

  const grouped = groupByType(streams);

  return (
    <div>
      <StreamGroup
        label="video"
        streams={grouped.video}
        player={player}
        type={MediaType.VIDEO}
      />
      <StreamGroup
        label="audio"
        streams={grouped.audio}
        player={player}
        type={MediaType.AUDIO}
      />
    </div>
  );
}

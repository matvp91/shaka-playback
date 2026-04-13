import type { Player } from "cmaf-lite";
import { MediaType } from "cmaf-lite";
import { StreamGroup } from "./StreamGroup";

type StreamListProps = {
  player: Player;
};

export function StreamList({ player }: StreamListProps) {
  return (
    <div>
      <StreamGroup
        label="video"
        player={player}
        type={MediaType.VIDEO}
      />
      <StreamGroup
        label="audio"
        player={player}
        type={MediaType.AUDIO}
      />
    </div>
  );
}

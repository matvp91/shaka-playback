import type { Player } from "cmaf-lite";
import { AudioPreferenceForm } from "./AudioPreferenceForm";
import { VideoPreferenceForm } from "./VideoPreferenceForm";

type PreferencesProps = {
  player: Player;
};

export function Preferences({ player }: PreferencesProps) {
  return (
    <div>
      <VideoPreferenceForm player={player} />
      <AudioPreferenceForm player={player} />
    </div>
  );
}

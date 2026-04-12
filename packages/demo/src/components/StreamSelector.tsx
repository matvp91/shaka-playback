import type { Player, Stream } from "cmaf-lite";
import { MediaType } from "cmaf-lite";
import { formatStream, groupByType } from "../utils/stream";

type StreamSelectorProps = {
  player: Player;
};

/**
 * Returns the label of the currently active stream
 * for the given type, or empty string if none.
 */
function activeLabel(player: Player, type: MediaType): string {
  try {
    const stream = player.getActiveStream(type);
    return formatStream(stream);
  } catch {
    return "";
  }
}

function onSelect(player: Player, streams: Stream[], label: string) {
  const stream = streams.find((s) => formatStream(s) === label);
  if (!stream) {
    return;
  }

  if (stream.type === MediaType.VIDEO) {
    player.setStreamPreference(
      MediaType.VIDEO,
      {
        height: stream.height,
        width: stream.width,
        bandwidth: stream.bandwidth,
      },
      true,
    );
  } else if (stream.type === MediaType.AUDIO) {
    player.setStreamPreference(
      MediaType.AUDIO,
      {
        bandwidth: stream.bandwidth,
        codec: stream.codec,
      },
      true,
    );
  }
}

type GroupSelectProps = {
  label: string;
  labelClassName: string;
  streams: Stream[];
  value: string;
  onSelect: (label: string) => void;
};

function GroupSelect({
  label,
  labelClassName,
  streams,
  value,
  onSelect,
}: GroupSelectProps) {
  if (streams.length === 0) {
    return null;
  }

  return (
    <div className="flex items-center gap-2">
      <span className={`w-20 text-right ${labelClassName}`}>{label}</span>
      <select
        className="flex-1 bg-neutral-900 px-2 py-1 text-sm text-neutral-300 outline-none"
        value={value}
        onChange={(e) => onSelect(e.target.value)}
      >
        {streams.map((stream) => {
          const streamLabel = formatStream(stream);
          return (
            <option key={streamLabel} value={streamLabel}>
              {streamLabel}
            </option>
          );
        })}
      </select>
    </div>
  );
}

export function StreamSelector({ player }: StreamSelectorProps) {
  let streams: Stream[];
  try {
    streams = player.getStreams();
  } catch {
    return null;
  }

  const grouped = groupByType(streams);

  return (
    <div className="flex flex-col gap-1">
      <GroupSelect
        label="video"
        labelClassName="text-indigo-500"
        streams={grouped.video}
        value={activeLabel(player, MediaType.VIDEO)}
        onSelect={(label) => onSelect(player, grouped.video, label)}
      />
      <GroupSelect
        label="audio"
        labelClassName="text-emerald-400"
        streams={grouped.audio}
        value={activeLabel(player, MediaType.AUDIO)}
        onSelect={(label) => onSelect(player, grouped.audio, label)}
      />
    </div>
  );
}

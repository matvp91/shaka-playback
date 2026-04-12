import type { Stream } from "cmaf-lite";
import { MediaType } from "cmaf-lite";
import { formatBandwidth } from "../../utils/stream";

type StreamItemProps = {
  stream: Stream;
  active: boolean;
};

export function StreamItem({ stream, active }: StreamItemProps) {
  return (
    <div className="flex items-center gap-2">
      {active && <span>●</span>}
      {stream.type === MediaType.VIDEO ? (
        <span>
          {stream.width}x{stream.height} · {formatBandwidth(stream.bandwidth)} ·{" "}
          {stream.codec}
        </span>
      ) : (
        <span>
          {formatBandwidth(stream.bandwidth)} · {stream.codec}
        </span>
      )}
    </div>
  );
}

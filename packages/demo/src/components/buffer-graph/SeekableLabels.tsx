import type { TimeRange } from "../../types";
import { toPosition } from "./utils";

type SeekableLabelsProps = {
  seekable: TimeRange | null;
  currentTime: number;
};

export function SeekableLabels({ seekable, currentTime }: SeekableLabelsProps) {
  return (
    <div className="relative mb-0.5 ml-22 flex h-10">
      <span className="top-0">{seekable?.start.toFixed(3) ?? "-"}</span>
      <span
        className="absolute bottom-0 -translate-x-1/2"
        style={{ left: toPosition(currentTime, seekable) }}
      >
        {currentTime.toFixed(3)}
      </span>
      <span className="absolute right-0 top-0">
        {seekable?.end.toFixed(3) ?? "-"}
      </span>
    </div>
  );
}

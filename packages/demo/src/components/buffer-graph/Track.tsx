import type { TimeRange } from "../../types";
import { cn } from "../../utils";
import { toBarStyle, toPosition } from "./utils";

type TrackProps = {
  className?: string;
  rangeClassName?: string;
  ranges: TimeRange[];
  seekable: TimeRange | null;
  currentTime: number;
  bufferGoal: number;
  showMarkers?: boolean;
};

export function Track({
  className,
  rangeClassName,
  ranges,
  seekable,
  currentTime,
  bufferGoal,
  showMarkers = true,
}: TrackProps) {
  return (
    <div className={cn("relative flex-1 bg-neutral-800 h-4", className)}>
      {ranges.map((range) => {
        const style = toBarStyle(range, seekable);
        return (
          <div
            key={`${range.start}-${range.end}`}
            className={cn(
              "absolute top-0 h-full bg-neutral-600",
              rangeClassName,
            )}
            style={{ left: style.left, width: style.width }}
          />
        );
      })}
      {showMarkers && (
        <>
          <div
            className="absolute top-0 h-full w-0.5 bg-white"
            style={{ left: toPosition(currentTime, seekable) }}
          />
          <div
            className="absolute top-0 h-full border-l border-dashed border-neutral-600"
            style={{
              left: toPosition(currentTime + bufferGoal, seekable),
            }}
          />
        </>
      )}
    </div>
  );
}

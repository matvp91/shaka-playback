import type { TimeRange } from "../../types";
import { cn } from "../../utils/cn";
import { toBarStyle, toPosition } from "./utils";

type TrackProps = {
  className?: string;
  rangeClassName?: string;
  ranges: TimeRange[];
  seekable: TimeRange | null;
  currentTime: number;
  frontBufferLength: number;
  showMarkers?: boolean;
};

export function Track({
  className,
  rangeClassName,
  ranges,
  seekable,
  currentTime,
  frontBufferLength,
  showMarkers,
}: TrackProps) {
  return (
    <div className={cn("relative h-4 flex-1 bg-black", className)}>
      {ranges.map((range) => {
        const style = toBarStyle(range, seekable);
        return (
          <div
            key={`${range.start}-${range.end}`}
            className={cn("absolute top-0 h-full bg-muted", rangeClassName)}
            style={{ left: style.left, width: style.width }}
          />
        );
      })}
      {showMarkers ? (
        <>
          <div
            className="absolute top-0 h-full w-0.5 bg-white"
            style={{ left: toPosition(currentTime, seekable) }}
          />
          <div
            className="absolute top-0 h-full border-l border-dashed border-muted-foreground"
            style={{
              left: toPosition(currentTime + frontBufferLength, seekable),
            }}
          />
        </>
      ) : null}
    </div>
  );
}

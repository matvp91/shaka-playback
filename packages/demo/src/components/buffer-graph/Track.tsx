import type { TimeRange } from "../../types";
import { cn } from "../../utils/cn";
import { toBarStyle } from "./utils";

type TrackProps = {
  classNames?: {
    base?: string;
    range?: string;
  }
  ranges: TimeRange[];
  seekable: TimeRange | null;
};

export function Track({
  classNames,
  ranges,
  seekable,
}: TrackProps) {
  return (
    <div className={cn("relative h-4 flex-1", classNames?.base)}>
      {ranges.map((range) => {
        const style = toBarStyle(range, seekable);
        return (
          <div
            key={`${range.start}-${range.end}`}
            className={cn("absolute top-0 h-full", classNames?.range)}
            style={{ left: style.left, width: style.width }}
          />
        );
      })}
    </div>
  );
}

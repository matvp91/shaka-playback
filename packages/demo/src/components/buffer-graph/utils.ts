import type { TimeRange } from "../../types";

/**
 * Converts a time value to a CSS percentage string
 * within the seekable range.
 */
export function toPosition(time: number, seekable: TimeRange | null): string {
  if (!seekable) {
    return "0%";
  }
  const duration = seekable.end - seekable.start;
  if (duration <= 0) {
    return "0%";
  }
  const pct = ((time - seekable.start) / duration) * 100;
  return `${Math.max(0, Math.min(100, pct))}%`;
}

/**
 * Converts a TimeRange to CSS left/width percentage
 * strings within the seekable range.
 */
export function toBarStyle(
  range: TimeRange,
  seekable: TimeRange | null,
): { left: string; width: string } {
  if (!seekable) {
    return { left: "0%", width: "0%" };
  }
  const duration = seekable.end - seekable.start;
  if (duration <= 0) {
    return { left: "0%", width: "0%" };
  }
  const left = ((range.start - seekable.start) / duration) * 100;
  const width = ((range.end - range.start) / duration) * 100;
  return {
    left: `${Math.max(0, left)}%`,
    width: `${Math.min(100 - Math.max(0, left), width)}%`,
  };
}

/**
 * Finds the buffered range containing currentTime
 * and returns ahead/behind distances. Returns null
 * if currentTime is not inside any range.
 */
export function getBufferStat(
  ranges: TimeRange[],
  currentTime: number,
): { ahead: number; behind: number } | null {
  for (const range of ranges) {
    if (currentTime >= range.start && currentTime <= range.end) {
      return {
        ahead: range.end - currentTime,
        behind: currentTime - range.start,
      };
    }
  }
  return null;
}

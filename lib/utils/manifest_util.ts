import type { MediaGroup } from "../types/manifest";

/**
 * Returns the end time of the last segment
 * across all streams in the group.
 */
export function getGroupDuration(group: MediaGroup): number {
  let maxEnd = 0;
  for (const stream of group.streams) {
    const last = stream.segments[stream.segments.length - 1];
    if (last && last.end > maxEnd) {
      maxEnd = last.end;
    }
  }
  return maxEnd;
}

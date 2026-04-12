import type { InitSegment, Segment } from "../types/manifest";
import type { MediaType } from "../types/media";

export function isMediaSegment(
  segment: Segment | InitSegment,
): segment is Segment {
  return "initSegment" in segment;
}

export function isInitSegment(
  segment: Segment | InitSegment,
): segment is InitSegment {
  return !isMediaSegment(segment);
}

/**
 * Composite key for grouping tracks into switching sets.
 */
export function getSwitchingSetKey(type: MediaType, codec: string): string {
  return `${type}:${codec}`;
}

import type { InitSegment, Segment, Track } from "../types/manifest";
import { MediaType } from "../types/media";

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
 * Unique identity of a switching set: type + codec.
 */
export function getSwitchingSetId(type: MediaType, codec: string): string {
  return `${type}:${codec}`;
}

/**
 * Unique identity of a track within a switching set.
 * Video tracks are keyed by resolution, audio tracks
 * by type alone.
 */
export function getTrackId(track: Track): string {
  if (track.type === MediaType.VIDEO) {
    return `video:${track.width}:${track.height}:${track.bandwidth}`;
  }
  return `audio:${track.bandwidth}`;
}

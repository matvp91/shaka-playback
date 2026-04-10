import type { MediaType } from "../types/media";

type TrackedSegment = {
  start: number;
  end: number;
  byteLength: number;
};

export class SegmentTracker {
  private segments_ = new Map<MediaType, TrackedSegment[]>();

  /**
   * Record a successfully appended media segment.
   */
  trackAppend(type: MediaType, start: number, end: number, byteLength: number) {
    let list = this.segments_.get(type);
    if (!list) {
      list = [];
      this.segments_.set(type, list);
    }
    list.push({ start, end, byteLength });
  }

  /**
   * Walk tracked segments before currentTime oldest-first,
   * accumulating byte sizes until >= bytesNeeded. Returns the
   * eviction end time, or 0 if insufficient back buffer.
   */
  getEvictionEnd(
    type: MediaType,
    currentTime: number,
    bytesNeeded: number,
  ): number {
    const list = this.segments_.get(type);
    if (!list) {
      return 0;
    }
    let bytesFreed = 0;
    let evictionEnd = 0;
    for (const segment of list) {
      if (segment.end > currentTime) {
        continue;
      }
      bytesFreed += segment.byteLength;
      evictionEnd = Math.max(evictionEnd, segment.end);
      if (bytesFreed >= bytesNeeded) {
        return evictionEnd;
      }
    }
    return evictionEnd;
  }

  /**
   * Get the duration of the last tracked segment for the
   * given type, used to compute minBackBuffer.
   */
  getLastSegmentDuration(type: MediaType): number {
    const list = this.segments_.get(type);
    if (!list || list.length === 0) {
      return 0;
    }
    const last = list[list.length - 1];
    if (!last) {
      return 0;
    }
    return last.end - last.start;
  }

  /**
   * Reconcile tracked segments against SourceBuffer.buffered.
   * Discard entries whose time range is no longer in the buffer.
   */
  reconcile(type: MediaType, buffered: TimeRanges) {
    const list = this.segments_.get(type);
    if (!list) {
      return;
    }
    // TODO(matvp): We shall think about not alloc a new array each
    // time we reconcile.
    const filteredList = list.filter((segment) =>
      isTimeBuffered(segment.start, segment.end, buffered),
    );
    this.segments_.set(type, filteredList);
  }

  destroy() {
    this.segments_.clear();
  }
}

/**
 * Check if a time range is contained within any of the
 * buffered ranges, with a small tolerance for float precision.
 */
function isTimeBuffered(
  start: number,
  end: number,
  buffered: TimeRanges,
): boolean {
  const tolerance = 0.2;
  for (let i = 0; i < buffered.length; i++) {
    if (
      start >= buffered.start(i) - tolerance &&
      end <= buffered.end(i) + tolerance
    ) {
      return true;
    }
  }
  return false;
}

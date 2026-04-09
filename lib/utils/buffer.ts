export type BufferInfo = {
  start: number;
  end: number;
};

/**
 * Find the buffered range containing the given position.
 * Merges adjacent ranges with gaps smaller than maxHole and
 * tolerates the position being slightly before a range start.
 */
export function getBufferInfo(
  buffered: TimeRanges,
  pos: number,
  maxHole: number,
): BufferInfo | null {
  const ranges: BufferInfo[] = [];

  for (let i = 0; i < buffered.length; i++) {
    const start = buffered.start(i);
    const end = buffered.end(i);
    const last = ranges[ranges.length - 1];
    if (last && start - last.end < maxHole) {
      last.end = Math.max(last.end, end);
    } else {
      ranges.push({ start, end });
    }
  }

  for (const range of ranges) {
    if (pos + maxHole >= range.start && pos < range.end) {
      return range;
    }
  }

  return null;
}

/**
 * Find the start of the first buffered range after the
 * given position.
 */
export function getNextBufferedStart(
  buffered: TimeRanges,
  pos: number,
): number | null {
  for (let i = 0; i < buffered.length; i++) {
    const start = buffered.start(i);
    if (start > pos) {
      return start;
    }
  }
  return null;
}

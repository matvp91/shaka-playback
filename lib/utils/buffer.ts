type BufferInfo = {
  start: number;
  end: number;
};

/**
 * Find the buffered range containing the given
 * position, or null if the position is unbuffered.
 */
export function getBufferInfo(
  buffered: TimeRanges,
  pos: number,
): BufferInfo | null {
  for (let i = 0; i < buffered.length; i++) {
    const start = buffered.start(i);
    const end = buffered.end(i);
    if (pos >= start && pos < end) {
      return { start, end };
    }
  }
  return null;
}

export type { BufferInfo };

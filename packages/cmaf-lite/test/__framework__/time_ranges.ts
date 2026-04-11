/**
 * Creates a TimeRanges-compatible object from pairs.
 */
export function createTimeRanges(...ranges: [number, number][]): TimeRanges {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  return {
    length: sorted.length,
    start(i: number) {
      if (i < 0 || i >= sorted.length) {
        throw new DOMException("Index out of bounds");
      }
      return sorted[i]![0];
    },
    end(i: number) {
      if (i < 0 || i >= sorted.length) {
        throw new DOMException("Index out of bounds");
      }
      return sorted[i]![1];
    },
  };
}

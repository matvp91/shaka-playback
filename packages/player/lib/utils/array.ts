/**
 * Binary search over a sorted array.
 *
 * @param items - Sorted array to search.
 * @param compare - Returns negative if item is
 *   before target, positive if after, 0 if match.
 * @returns The matching item, or null if not found.
 */
export function binarySearch<T>(
  items: T[],
  compare: (item: T) => number,
): T | null {
  let lo = 0;
  let hi = items.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const item = items[mid] as T;
    const cmp = compare(item);
    if (cmp < 0) {
      hi = mid - 1;
    } else if (cmp > 0) {
      lo = mid + 1;
    } else {
      return item;
    }
  }
  return null;
}

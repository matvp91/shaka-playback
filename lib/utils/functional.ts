export function filterMap<T, U>(
  items: T[],
  fn: (item: T) => U | undefined | null,
): U[] {
  const result: U[] = [];
  for (const item of items) {
    const value = fn(item);
    if (value != null) {
      result.push(value);
    }
  }
  return result;
}

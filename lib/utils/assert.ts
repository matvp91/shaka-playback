export function assertNotVoid<T>(
  value: T,
  message: string,
): asserts value is NonNullable<T> {
  // Loose equality (==) catches both null and undefined.
  if (value == null) {
    throw new Error(message);
  }
}

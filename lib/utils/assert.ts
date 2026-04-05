export function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

export function assertNotVoid<T>(
  value: T,
  message: string,
): asserts value is NonNullable<T> {
  assert(value != null, message);
}

export function assertNumber(
  value: number,
  message: string,
): asserts value is number {
  assert(!Number.isNaN(value), message);
}

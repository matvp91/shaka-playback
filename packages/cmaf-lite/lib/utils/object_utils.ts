import type { UnknownRecord } from "../types/helpers";

/** Deep-merges `source` into `target`, returning a new object. */
export function deepMerge<T extends UnknownRecord>(
  target: T,
  source: unknown,
): T {
  if (
    source === null ||
    source === undefined ||
    typeof source !== "object" ||
    Array.isArray(source)
  ) {
    return target;
  }
  const src = source as UnknownRecord;
  const result: UnknownRecord = { ...target };
  for (const key in src) {
    const val = src[key];
    if (
      val !== null &&
      typeof val === "object" &&
      !Array.isArray(val) &&
      typeof result[key] === "object" &&
      result[key] !== null
    ) {
      result[key] = deepMerge(result[key] as UnknownRecord, val);
    } else {
      result[key] = val;
    }
  }
  return result as T;
}

/**
 * Expands a dot-notation path and value into a nested object.
 */
export function unflattenPath(path: string, value: unknown) {
  return path.split(".").reduceRight((acc, key) => ({ [key]: acc }), value);
}

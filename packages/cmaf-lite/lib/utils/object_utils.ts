import type { DeepPartial } from "../types/helpers";

/** Deep-merges `source` into `target`, returning a new object. */
export function deepMerge<T extends Record<string, unknown>>(
  target: T,
  source: DeepPartial<T>,
): T {
  const result = { ...target };
  for (const key in source) {
    const val = source[key];
    if (
      val !== null &&
      typeof val === "object" &&
      !Array.isArray(val) &&
      typeof result[key] === "object" &&
      result[key] !== null
    ) {
      result[key] = deepMerge(
        result[key] as Record<string, unknown>,
        val as DeepPartial<Record<string, unknown>>,
      ) as T[typeof key];
    } else {
      result[key] = val as T[typeof key];
    }
  }
  return result;
}

/**
 * Expands a dot-notation path and value into a nested object.
 */
export function unflattenPath(
  path: string,
  value: unknown,
): Record<string, unknown> {
  return path
    .split(".")
    .reduceRight<Record<string, unknown>>(
      (acc, key) => ({ [key]: acc }),
      value as Record<string, unknown>,
    );
}

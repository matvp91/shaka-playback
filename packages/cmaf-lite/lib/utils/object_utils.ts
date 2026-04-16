export function deepMerge<T extends object>(target: T, source: unknown): T {
  if (
    source === null ||
    source === undefined ||
    typeof source !== "object" ||
    Array.isArray(source)
  ) {
    return target;
  }
  const src = source as Record<string, unknown>;
  const result = { ...target } as unknown as Record<string, unknown>;
  for (const key in src) {
    const val = src[key];
    if (
      val !== null &&
      typeof val === "object" &&
      !Array.isArray(val) &&
      typeof result[key] === "object" &&
      result[key] !== null
    ) {
      result[key] = deepMerge(result[key] as object, val);
    } else {
      result[key] = val;
    }
  }
  return result as T;
}

export function unflattenPath(path: string, value: unknown) {
  return path.split(".").reduceRight((acc, key) => ({ [key]: acc }), value);
}

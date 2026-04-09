/**
 * Converts a string attribute value to a number.
 * Returns undefined for undefined input or NaN result.
 */
export function asNumber(value: string | undefined): number | undefined {
  if (value == null) {
    return undefined;
  }
  const n = Number(value);
  return Number.isNaN(n) ? undefined : n;
}

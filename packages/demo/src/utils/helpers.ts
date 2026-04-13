import type { ClassValue } from "clsx";
import clsx from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Invoke a function, returning its result or a fallback if it throws.
 * Useful for reading player state during render — many player getters
 * throw until the manifest / media is loaded, and render code wants a
 * fallback rather than a try / catch.
 *
 * @param fn - the function to invoke.
 * @param fallback - returned if `fn` throws. Defaults to `null`.
 */
export function callSafe<T>(fn: () => T): T | null;
export function callSafe<T, D>(fn: () => T, fallback: D): T | D;
export function callSafe<T, D>(
  fn: () => T,
  fallback: D | null = null,
): T | D | null {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

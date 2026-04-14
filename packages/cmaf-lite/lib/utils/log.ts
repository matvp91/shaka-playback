/**
 * Log severity threshold.
 *
 * @public
 */
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
}

/**
 * Log arguments.
 *
 * @public
 */
export type LogArgs = unknown[];

/**
 * Namespaced console logger with colored prefixes. Logging is
 * disabled by default — call {@link Log.setLevel} to enable.
 *
 * @example
 * ```ts
 * import { Log, LogLevel } from "cmaf-lite";
 * Log.setLevel(LogLevel.DEBUG);
 * ```
 *
 * @public
 */
export class Log {
  private static level: LogLevel | null = null;

  /**
   * Sets the minimum severity to log, or `null` to disable
   * all output.
   */
  static setLevel(level: LogLevel | null): void {
    Log.level = level;
  }

  /**
   * Creates a color-prefixed logger scoped to the given
   * namespace. Each namespace gets a deterministic HSL color.
   */
  static create(ns: string) {
    const prefix = `%c${ns}`;
    const style = `color: ${Log.toHsl_(ns)}`;

    return {
      info: (...args: LogArgs) => {
        if (Log.level !== null && Log.level <= LogLevel.INFO) {
          console.log(prefix, style, ...args);
        }
      },
      debug: (...args: LogArgs) => {
        if (Log.level !== null && Log.level <= LogLevel.DEBUG) {
          console.log(prefix, style, ...args);
        }
      },
    };
  }

  private static toHsl_(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
      hash = hash & hash;
    }
    const hue = Math.abs(hash * 137) % 360;
    const saturation = 50 + (Math.abs(hash) % 50);
    const lightness = 40 + (Math.abs(hash * 73) % 20);
    return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
  }
}

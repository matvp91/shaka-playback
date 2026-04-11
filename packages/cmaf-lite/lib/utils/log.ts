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
 * Namespaced console logger with colored prefixes.
 *
 * @public
 */
export class Log {
  private static level: LogLevel | null = null;

  /**
   * Set the active log level, or `null` to disable logging.
   */
  static setLevel(level: LogLevel | null): void {
    Log.level = level;
  }

  /**
   * Create a color-prefixed logger for the given namespace.
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

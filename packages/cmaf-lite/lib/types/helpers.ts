/**
 * Identity mapped type that flattens intersections into
 * a single object for cleaner IDE tooltips.
 *
 * @public
 */
export type Prettify<T> = {
  [K in keyof T]: T[K];
} & {};

/**
 * Generic string-keyed record.
 *
 * @public
 */
export type UnknownRecord = Record<string, unknown>;

/**
 * Makes all properties optional except those in `K`.
 *
 * @public
 */
export type OptionalExcept<T, K extends keyof T> = Partial<T> &
  Required<Pick<T, K>>;

/**
 * Recursively makes all properties optional.
 *
 * @public
 */
export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

/**
 * Dot-notation path utilities.
 * Adapted from dot-path-value.
 *
 * @internal
 */

/** @public */
export type Primitive =
  | null
  | undefined
  | string
  | number
  | boolean
  | symbol
  | bigint;

/** @public */
export type PathConcat<
  TKey extends string | number,
  TValue,
> = TValue extends Primitive
  ? `${TKey}`
  : `${TKey}` | `${TKey}.${Path<TValue>}`;

/**
 * Union of all dot-notation paths for an object.
 *
 * @public
 */
export type Path<T> = {
  [K in keyof T]-?: PathConcat<K & string, T[K]>;
}[keyof T];

/**
 * Resolves the value type at a dot-notation path. For object
 * values, returns `DeepPartial` since they are deep-merged.
 *
 * @public
 */
export type PathValue<
  T,
  TPath extends Path<T>,
> = TPath extends `${infer K}.${infer R}`
  ? K extends keyof T
    ? R extends Path<T[K]>
      ? PathValue<T[K], R>
      : never
    : never
  : TPath extends keyof T
    ? T[TPath] extends object
      ? DeepPartial<T[TPath]>
      : T[TPath]
    : never;

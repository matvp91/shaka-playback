import type { MediaType } from "./media";

export type ByType<K, T extends MediaType> = Extract<K, { type: T }>;

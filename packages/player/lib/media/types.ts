export enum MediaType {
  VIDEO = "video",
  AUDIO = "audio",
  TEXT = "text",
}

export type Stream = {
  codec: string;
} & (
  | { type: MediaType.VIDEO; width: number; height: number }
  | { type: MediaType.AUDIO }
);

export type StreamPreference = {
  [K in Stream as K["type"]]: { type: K["type"] } & Partial<Omit<K, "type">>;
}[Stream["type"]];

export type ByType<K, T extends MediaType> = Extract<K, { type: T }>;

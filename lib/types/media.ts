export enum MediaType {
  VIDEO = "video",
  AUDIO = "audio",
  TEXT = "text",
}

export type MediaTrack = {
  type: MediaType;
  mimeType: string;
};

import type { MediaType } from "..";

/**
 * Get MSE content type from MediaType and codec.
 * Assumes CMAF-compliant fMP4 container.
 */
export function getContentType(type: MediaType, codec: string) {
  return `${type}/mp4; codecs="${codec}"`;
}

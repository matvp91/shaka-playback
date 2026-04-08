export function getMimeType(mimeType: string, codec: string) {
  return `${mimeType};codecs="${codec}"`;
}

import { assert, assertNotVoid } from "./assert";

/**
 * Parse timescale from an init segment's
 * moov/trak/mdia/mdhd box.
 */
export function parseTimescale(data: ArrayBuffer): number {
  const mdhd = findBox(new DataView(data), ["moov", "trak", "mdia", "mdhd"]);
  assertNotVoid(mdhd, "mdhd box not found");
  const version = mdhd.getUint8(0);
  return mdhd.getUint32(version === 0 ? 12 : 20);
}

/**
 * Parse baseMediaDecodeTime from a media
 * segment's moof/traf/tfdt box.
 */
export function parseBaseMediaDecodeTime(data: ArrayBuffer): number {
  const tfdt = findBox(new DataView(data), ["moof", "traf", "tfdt"]);
  assertNotVoid(tfdt, "tfdt box not found");
  const version = tfdt.getUint8(0);
  if (version === 0) {
    return tfdt.getUint32(4);
  }
  const high = tfdt.getUint32(4);
  const low = tfdt.getUint32(8);
  return high * 2 ** 32 + low;
}

/**
 * Find a box by path, returning a DataView of
 * its payload (after the header).
 */
function findBox(view: DataView, path: string[]): DataView | null {
  const target = path[0];
  assert(target !== undefined, "Empty box path");

  let offset = 0;
  while (offset < view.byteLength) {
    const size = view.getUint32(offset);
    const type = String.fromCharCode(
      view.getUint8(offset + 4),
      view.getUint8(offset + 5),
      view.getUint8(offset + 6),
      view.getUint8(offset + 7),
    );

    const headerSize = 8;
    const payloadOffset = offset + headerSize;
    const payloadSize = size - headerSize;

    if (type === target) {
      const payload = new DataView(
        view.buffer,
        view.byteOffset + payloadOffset,
        payloadSize,
      );
      if (path.length === 1) {
        return payload;
      }
      return findBox(payload, path.slice(1));
    }

    offset += size;
  }

  return null;
}

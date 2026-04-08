import {
  findIsoBox,
  isIsoBoxType,
  readIsoBoxes,
  readMdhd,
  readTfdt,
} from "@svta/cml-iso-bmff";
import { assertNotVoid } from "./assert";

/**
 * Parse timescale from an init segment's
 * moov/trak/mdia/mdhd box.
 */
export function parseTimescale(data: ArrayBuffer): number {
  const boxes = readIsoBoxes(data, {
    readers: { mdhd: readMdhd },
  });
  const mdhd = findIsoBox(boxes, (box) => isIsoBoxType("mdhd", box));
  assertNotVoid(mdhd, "mdhd box not found");
  return mdhd.timescale;
}

/**
 * Parse baseMediaDecodeTime from a media
 * segment's moof/traf/tfdt box.
 */
export function parseBaseMediaDecodeTime(data: ArrayBuffer): number {
  const boxes = readIsoBoxes(data, {
    readers: { tfdt: readTfdt },
  });
  const tfdt = findIsoBox(boxes, (box) => isIsoBoxType("tfdt", box));
  assertNotVoid(tfdt, "tfdt box not found");
  return tfdt.baseMediaDecodeTime;
}

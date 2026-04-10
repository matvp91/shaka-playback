import {
  findIsoBox,
  isIsoBoxType,
  readIsoBoxes,
  readMdhd,
  readTfdt,
} from "@svta/cml-iso-bmff";
import * as asserts from "./asserts";

/**
 * Parse timescale from an init segment's moov/trak/mdia/mdhd.
 */
export function parseTimescale(data: ArrayBuffer): number {
  const boxes = readIsoBoxes(data, {
    readers: { mdhd: readMdhd },
  });
  const mdhd = findIsoBox(boxes, (box) => isIsoBoxType("mdhd", box));
  asserts.assertExists(mdhd, "mdhd box not found");
  return mdhd.timescale;
}

/**
 * Parse baseMediaDecodeTime from a segment's moof/traf/tfdt.
 */
export function parseBaseMediaDecodeTime(data: ArrayBuffer): number {
  const boxes = readIsoBoxes(data, {
    readers: { tfdt: readTfdt },
  });
  const tfdt = findIsoBox(boxes, (box) => isIsoBoxType("tfdt", box));
  asserts.assertExists(tfdt, "tfdt box not found");
  return tfdt.baseMediaDecodeTime;
}

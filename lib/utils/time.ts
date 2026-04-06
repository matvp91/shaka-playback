import { parse, pattern, toSeconds } from "iso8601-duration";
import { assert } from "./assert";

export function parseDuration(iso: string) {
  assert(pattern.test(iso), `Failed to parse ISO 8601 duration: ${iso}`);
  return toSeconds(parse(iso));
}

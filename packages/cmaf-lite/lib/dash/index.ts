import { ManifestParser } from "../manifest/manifest_parser";
import type { NetworkResponse } from "../net/network_response";
import type { Manifest } from "../types/manifest";
import { parseManifest } from "./dash_parser";

export class DashParser extends ManifestParser {
  mimeTypes = ["application/dash+xml"];

  parse(response: NetworkResponse): Manifest {
    return parseManifest(response.text, response.request.url);
  }
}

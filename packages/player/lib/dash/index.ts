import type { Manifest, ManifestParser, NetworkResponse } from "..";
import { parseManifest } from "./dash_parser";

export class DashParser implements ManifestParser {
  mimeTypes = ["application/dash+xml"];

  parse(response: NetworkResponse): Manifest {
    return parseManifest(response.text, response.request.url);
  }
}

import type { NetworkResponse } from "../net/network_response";
import type { Player } from "../player";
import type { Manifest } from "../types/manifest";

export abstract class ManifestParser {
  constructor(protected player_: Player) {}
  abstract mimeTypes: string[];
  abstract parse(response: NetworkResponse): Manifest;
}

import type { NetworkResponse } from "../net/network_response";
import type { Player } from "../player";
import type { Manifest } from "../types/manifest";

export interface ManifestParser {
  mimeTypes: string[];
  parse(response: NetworkResponse): Manifest;
}

export interface ManifestParserConstructor {
  new (player: Player): ManifestParser;
}

export class ManifestParserRegistry {
  private static registry_ = new Set<ManifestParserConstructor>();

  static add(Ctor: ManifestParserConstructor) {
    ManifestParserRegistry.registry_.add(Ctor);
  }

  private parsers_ = new Set<ManifestParser>();

  constructor(player: Player) {
    for (const Ctor of ManifestParserRegistry.registry_) {
      this.parsers_.add(new Ctor(player));
    }
  }

  getByMimeType(mimeType: string) {
    for (const parser of this.parsers_) {
      if (parser.mimeTypes.includes(mimeType)) {
        return parser;
      }
    }
    return null;
  }
}

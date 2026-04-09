import type { Player } from "../player";
import type { Manifest, Response } from "../types";

export interface ManifestParser {
  mimeTypes: string[];
  parse(response: Response): Manifest;
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

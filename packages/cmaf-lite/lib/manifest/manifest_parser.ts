import type { NetworkResponse } from "../net/network_response";
import type { Player } from "../player";
import type { Manifest } from "../types/manifest";

/**
 * Base class for manifest parsers. Subclasses implement format-specific
 * parsing (e.g. DASH, HLS).
 *
 * @public
 */
export abstract class ManifestParser {
  /**
   * @param player_ - The parent player instance.
   */
  constructor(protected player_: Player) {}

  /** Supported MIME types for this parser. */
  abstract mimeTypes: string[];

  /** Parses a network response into a {@link Manifest}. */
  abstract parse(response: NetworkResponse): Manifest;
}

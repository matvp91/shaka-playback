import type { ManifestParser } from "./manifest/manifest_parser";
import type { Player } from "./player";

/**
 * Available component types for registration.
 *
 * @public
 */
export enum RegistryType {
  MANIFEST_PARSER = "manifestParser",
}

/**
 * Constructor signature for registerable components.
 *
 * @public
 */
export type RegistoryComponentCtor<T> = new (player: Player) => T;

/**
 * Maps each {@link RegistryType} to its component interface.
 *
 * @public
 */
export interface RegistryTypeMap {
  [RegistryType.MANIFEST_PARSER]: ManifestParser;
}

/**
 * Extensible component registry. External code registers components
 * (e.g. a DASH parser) via {@link Registry.add}, the player resolves
 * them at runtime.
 *
 * @public
 */
export class Registry {
  private static entries_ = new Set<
    [RegistryType, RegistoryComponentCtor<object>]
  >();

  /**
   * Registers a component constructor globally.
   */
  static add<T extends RegistryType>(
    type: T,
    Ctor: RegistoryComponentCtor<RegistryTypeMap[T]>,
  ) {
    Registry.entries_.add([type, Ctor]);
  }

  private components_ = new Set<[RegistryType, object]>();

  constructor(player: Player) {
    for (const [type, Ctor] of Registry.entries_) {
      this.components_.add([type, new Ctor(player)]);
    }
  }

  /**
   * Returns all instances of the given component type.
   */
  get<T extends RegistryType>(type: T) {
    const instances = [];
    for (const [key, instance] of this.components_) {
      if (key === type) {
        instances.push(instance as RegistryTypeMap[T]);
      }
    }
    return instances;
  }
}

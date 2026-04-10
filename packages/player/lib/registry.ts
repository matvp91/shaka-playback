import type { ManifestParser } from "./manifest/manifest_parser";
import type { Player } from "./player";

export enum RegistryType {
  MANIFEST_PARSER,
}

export type RegistoryComponentCtor<T> = new (player: Player) => T;

interface RegistryTypeMap {
  [RegistryType.MANIFEST_PARSER]: ManifestParser;
}

export class Registry {
  private static entries_ = new Set<
    [RegistryType, RegistoryComponentCtor<object>]
  >();

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

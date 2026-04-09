import type { ManifestParser } from "./manifest/manifest_parser";
import type { Player } from "./player";
import type { ArrayMap } from "./types/helper";

type RegistryTypeMap = {
  [RegistryType.MANIFEST_PARSER]: ManifestParser;
};

type Factory<T> = new (player: Player) => T;

type FactoryMap = {
  [K in keyof RegistryTypeMap]: Factory<RegistryTypeMap[K]>[];
};

type InstanceMap = ArrayMap<RegistryTypeMap>;

export enum RegistryType {
  MANIFEST_PARSER = "manifestParser",
}

export class Registry {
  private static factories_: FactoryMap = {
    [RegistryType.MANIFEST_PARSER]: [],
  };

  static add<T extends RegistryType>(type: T, factory: Factory<RegistryTypeMap[T]>) {
    Registry.factories_[type].push(factory);
  }

  private instances_: InstanceMap = {
    [RegistryType.MANIFEST_PARSER]: [],
  };

  constructor(player: Player) {
    for (const type of Object.values(RegistryType)) {
      this.instances_[type] = Registry.factories_[type].map(
        (Ctor) => new Ctor(player),
      );
    }
  }

  get<T extends RegistryType>(type: T): InstanceMap[T] {
    return this.instances_[type];
  }
}

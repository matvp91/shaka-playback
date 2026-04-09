import type { ManifestParser } from "./manifest/manifest_parser";
import type { Player } from "./player";
import type { ArrayMap } from "./types/helper";

export enum RegistryType {
  MANIFEST_PARSER = "manifestParser",
}

type RegistryTypeMap = {
  [RegistryType.MANIFEST_PARSER]: ManifestParser;
};

export class Registry {
  private static components_: ComponentMap = {
    [RegistryType.MANIFEST_PARSER]: [],
  };

  static add<T extends RegistryType>(
    type: T,
    component: Component<RegistryTypeMap[T]>,
  ) {
    Registry.components_[type].push(component);
  }

  private instances_: InstanceMap = {
    [RegistryType.MANIFEST_PARSER]: [],
  };

  constructor(player: Player) {
    for (const type of Object.values(RegistryType)) {
      this.instances_[type] = Registry.components_[type].map(
        (Ctor) => new Ctor(player),
      );
    }
  }

  get<T extends RegistryType>(type: T): InstanceMap[T] {
    return this.instances_[type];
  }
}

type Component<T> = new (player: Player) => T;

type ComponentMap = {
  [K in keyof RegistryTypeMap]: Component<RegistryTypeMap[K]>[];
};

type InstanceMap = ArrayMap<RegistryTypeMap>;

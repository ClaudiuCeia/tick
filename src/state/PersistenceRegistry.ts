import {
  getPersistedType,
  normalizePersistedType,
  type PersistableClass,
} from "./PersistedType.ts";

/**
 * Factories execute in a quarantined runtime and must not mutate externally captured objects.
 * Closure side effects outside that runtime cannot be isolated or rolled back.
 */
export type PersistFactory<T = unknown> = (node: unknown) => T;

export class PersistenceRegistry {
  private readonly entities = new Map<string, PersistFactory>();
  private readonly components = new Map<string, PersistFactory>();

  public registerEntity(type: string, factory: PersistFactory): void;
  public registerEntity(klass: PersistableClass, factory: PersistFactory): void;
  public registerEntity(typeOrClass: string | PersistableClass, factory: PersistFactory): void {
    const type =
      typeof typeOrClass === "string"
        ? normalizePersistedType(typeOrClass, "entity")
        : getPersistedType(typeOrClass, "entity");

    if (this.entities.has(type)) {
      throw new Error(`Duplicate persisted entity type: ${type}`);
    }
    this.entities.set(type, factory);
  }

  public registerComponent(type: string, factory: PersistFactory): void;
  public registerComponent(klass: PersistableClass, factory: PersistFactory): void;
  public registerComponent(typeOrClass: string | PersistableClass, factory: PersistFactory): void {
    const type =
      typeof typeOrClass === "string"
        ? normalizePersistedType(typeOrClass, "component")
        : getPersistedType(typeOrClass, "component");

    if (this.components.has(type)) {
      throw new Error(`Duplicate persisted component type: ${type}`);
    }
    this.components.set(type, factory);
  }

  public getEntityFactory(type: string): PersistFactory | undefined {
    return this.entities.get(type);
  }

  public getComponentFactory(type: string): PersistFactory | undefined {
    return this.components.get(type);
  }

  public clear(): void {
    this.entities.clear();
    this.components.clear();
  }
}

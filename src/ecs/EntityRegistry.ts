import type { Entity } from "./Entity.ts";
import { EntityQuery, type EntityConstructor } from "./EntityQuery.ts";

export type EntityRegistryOptions = {
  captureCreationSites?: boolean;
};

/**
 * Registry that tracks active entities for a single ECS runtime.
 * Uses Maps internally for O(1) lookups by id and type.
 */
export class EntityRegistry {
  /** Map from entity ID to the entity instance */
  private entities = new Map<string, Entity>();
  /** Map from entity constructor to a set of instances of that type */
  private typeCache = new Map<Function, Set<Entity>>();
  /** Records which call site created each entity (for debugging) */
  private creationMap = new Map<string, string>();
  /** Monotonic version used by cached queries for change tracking */
  private _version = 0;
  private readonly captureCreationSites: boolean;
  private disposed = false;

  public constructor(options: EntityRegistryOptions = {}) {
    this.captureCreationSites = options.captureCreationSites ?? false;
  }

  public register(entity: Entity): void {
    if (this.disposed) throw new Error("Cannot register an entity in a disposed registry.");
    if (this.entities.has(entity.id)) {
      return; // already registered
    }

    if (this.captureCreationSites) {
      const stack = new Error().stack?.split("\n")[3]?.trim() ?? "";
      this.creationMap.set(entity.id, stack);
    }

    this.entities.set(entity.id, entity);

    const ctor = entity.constructor;
    let set = this.typeCache.get(ctor);
    if (!set) {
      set = new Set();
      this.typeCache.set(ctor, set);
    }
    set.add(entity);
    this.markDirty();
  }

  public getCreationSite(entityId: string): string | undefined {
    return this.creationMap.get(entityId);
  }

  public unregister(entity: Entity): void {
    const wasRegistered = this.entities.delete(entity.id);
    this.creationMap.delete(entity.id);
    if (!wasRegistered) {
      return;
    }

    const ctor = entity.constructor;
    const set = this.typeCache.get(ctor);
    if (set) {
      set.delete(entity);
      if (set.size === 0) {
        this.typeCache.delete(ctor);
      }
    }
    this.markDirty();
  }

  public getAllEntities(): Entity[] {
    return Array.from(this.entities.values());
  }

  public getEntitiesByType<T extends Entity>(type: new (...args: any[]) => T): T[] {
    return this.getAllEntities().filter((e) => e instanceof type) as T[];
  }

  public getFirstEntityByType<T extends Entity>(type: new (...args: any[]) => T): T | null {
    const found = this.getAllEntities().find((e) => e instanceof type);
    return found ? (found as T) : null;
  }

  public getEntityById(id: string): Entity | undefined {
    return this.entities.get(id);
  }

  public findEntities(predicate: (e: Entity) => boolean): Entity[] {
    return this.getAllEntities().filter(predicate);
  }

  public get count(): number {
    return this.entities.size;
  }

  public get version(): number {
    return this._version;
  }

  public markDirty(): void {
    this._version++;
  }

  public query<E extends Entity>(type?: EntityConstructor<E>): EntityQuery<E> {
    return new EntityQuery(this, type);
  }

  /** Clears the registry completely. Both maps are wiped. */
  public clear(): void {
    const hadEntities =
      this.entities.size > 0 || this.typeCache.size > 0 || this.creationMap.size > 0;
    this.entities.clear();
    this.typeCache.clear();
    this.creationMap.clear();
    if (hadEntities) {
      this.markDirty();
    }
  }

  /** Internal runtime teardown hook. Disposed registries cannot be reused. */
  public _dispose(): void {
    this.clear();
    this.disposed = true;
  }

  public dump(): void {
    console.log("EntityRegistry dump:");
    for (const [id, entity] of this.entities) {
      console.log(`  ${entity.constructor.name} (${id})`);
    }
  }
}

import { EntityRegistry } from "./EntityRegistry.ts";
import { Entity } from "./Entity.ts";
import { InputManager } from "../input/Input.ts";
import { AssetManager } from "../assets/AssetManager.ts";
import {
  getPersistedType,
  PersistenceLoader,
  PersistenceRegistry,
  StateStore,
} from "../state/index.ts";
import type {
  LoadOptions,
  LoadResult,
  PersistFactory,
  Snapshot,
  SnapshotEntityNode,
} from "../state/index.ts";
import type { PersistableClass } from "../state/PersistedType.ts";

export type RuntimeSnapshotOptions = {
  sceneId?: string;
  createdAt?: string;
  rootSid?: string;
  sid?: (entity: Entity) => string | undefined;
  params?: (entity: Entity) => Record<string, unknown> | undefined;
};

/**
 * Runtime context that scopes ECS global state.
 */
export class EcsRuntime {
  private static current = new EcsRuntime(new EntityRegistry());
  private disposed = false;
  private acceptingEntities = true;

  constructor(
    public readonly registry: EntityRegistry = new EntityRegistry(),
    public readonly input: InputManager = new InputManager(),
    public readonly assets: AssetManager = new AssetManager(),
    public readonly store: StateStore = new StateStore(),
    public readonly persistenceRegistry: PersistenceRegistry = new PersistenceRegistry(),
    public readonly persistenceLoader: PersistenceLoader = new PersistenceLoader(
      persistenceRegistry,
    ),
  ) {}

  /**
   * Factories run in a quarantined runtime. They must still be side-effect-free with respect to
   * externally captured objects; arbitrary closure mutations cannot be isolated or rolled back.
   */
  public registerPersistedEntity(type: string, factory: PersistFactory): void;
  public registerPersistedEntity(klass: PersistableClass, factory: PersistFactory): void;
  public registerPersistedEntity(
    typeOrClass: string | PersistableClass,
    factory: PersistFactory,
  ): void {
    this.assertActive();
    if (typeof typeOrClass === "string") {
      this.persistenceRegistry.registerEntity(typeOrClass, factory);
      return;
    }
    this.persistenceRegistry.registerEntity(typeOrClass, factory);
  }

  public registerPersistedComponent(type: string, factory: PersistFactory): void;
  public registerPersistedComponent(klass: PersistableClass, factory: PersistFactory): void;
  public registerPersistedComponent(
    typeOrClass: string | PersistableClass,
    factory: PersistFactory,
  ): void {
    this.assertActive();
    if (typeof typeOrClass === "string") {
      this.persistenceRegistry.registerComponent(typeOrClass, factory);
      return;
    }
    this.persistenceRegistry.registerComponent(typeOrClass, factory);
  }

  /**
   * Replaces the runtime graph after quarantined staging succeeds. Old destroy overrides run before
   * adoption/store commit and are followed by guaranteed base cleanup. The new root remains asleep
   * for its scene owner to awaken.
   */
  public loadSnapshot(snapshot: Snapshot, options: LoadOptions = {}): LoadResult {
    this.assertActive();
    return this.persistenceLoader.loadIntoRuntime(snapshot, this, options);
  }

  public snapshot(root: Entity, options: RuntimeSnapshotOptions = {}): Snapshot {
    this.assertActive();
    if (root.runtime !== this) throw new Error("Snapshot root belongs to a different runtime.");

    const entities: SnapshotEntityNode[] = [];
    const sidToRuntimeId = new Map<string, string>();
    const visited = new Set<Entity>();
    const walk = (entity: Entity, parentSid: string | null): void => {
      if (visited.has(entity)) throw new Error("Cannot snapshot an entity graph with a cycle.");
      visited.add(entity);

      const persistedSid = this.store._getSidForRuntimeId(entity.id);
      const sid =
        options.sid?.(entity) ??
        (entity === root && options.rootSid ? options.rootSid : (persistedSid ?? entity.id));
      this.assertPersistedId(sid, "entity sid");
      if (sidToRuntimeId.has(sid)) throw new Error(`Duplicate persisted entity sid '${sid}'.`);

      const type = getPersistedType(entity.constructor as Function & { type?: unknown }, "entity");
      const components: string[] = [];
      for (const component of entity.components) {
        const componentType = (component.constructor as Function & { type?: unknown }).type;
        if (componentType === undefined) continue;
        components.push(
          getPersistedType(component.constructor as Function & { type?: unknown }, "component"),
        );
      }
      if (new Set(components).size !== components.length) {
        throw new Error(`Entity '${sid}' has duplicate persisted component types.`);
      }

      sidToRuntimeId.set(sid, entity.id);
      const previousNode = this.store._getEntityNode(sid);
      const params = options.params?.(entity) ?? previousNode?.params;
      entities.push({
        sid,
        type,
        parentSid,
        ...(components.length > 0 ? { components } : {}),
        ...(params ? { params: { ...params } } : {}),
      });
      for (const child of entity.children) walk(child, sid);
    };

    walk(root, null);
    const rootSid = entities[0]!.sid;
    this.store._configureGraph(rootSid, entities, sidToRuntimeId, {
      sceneId: options.sceneId,
      createdAt: options.createdAt,
    });
    return this.store.snapshot();
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    this.acceptingEntities = false;
    try {
      this._destroyAllEntitiesGuaranteed();
    } catch {}
    try {
      this.registry._dispose();
    } catch {}
    try {
      this.input.dispose();
    } catch {}
    try {
      this.assets.clear();
    } catch {}
    try {
      this.store.clear();
    } catch {}
  }

  public get isDisposed(): boolean {
    return this.disposed;
  }

  /** Internal entity registration gate used by Entity construction and persistence adoption. */
  public _registerEntity(entity: Entity): void {
    if (this.disposed || !this.acceptingEntities) {
      throw new Error("Cannot register an entity in a disposed or tearing-down runtime.");
    }
    this.registry.register(entity);
  }

  /** Internal guaranteed cleanup used by disposal and persistence replacement. */
  public _destroyAllEntitiesGuaranteed(): void {
    const wasAcceptingEntities = this.acceptingEntities;
    this.acceptingEntities = false;
    const previous = EcsRuntime.current;
    EcsRuntime.current = this;
    try {
      for (const entity of this.registry.getAllEntities()) {
        try {
          entity.destroy();
        } catch {}
        try {
          Entity.forceDestroy(entity);
        } catch {}
        try {
          this.registry.unregister(entity);
        } catch {}
      }
      try {
        this.registry.clear();
      } catch {}
    } finally {
      EcsRuntime.current = previous;
      if (!this.disposed) this.acceptingEntities = wasAcceptingEntities;
    }
  }

  private assertPersistedId(value: string, kind: string): void {
    if (value.length === 0 || value.includes(":") || value.trim() !== value) {
      throw new Error(`Invalid persisted ${kind} '${value}'. IDs must be non-empty without ':'.`);
    }
  }

  public static getCurrent(): EcsRuntime {
    return this.current;
  }

  public static setCurrent(runtime: EcsRuntime): EcsRuntime {
    runtime.assertActive();
    const previous = this.current;
    this.current = runtime;
    return previous;
  }

  public static runWith<T>(runtime: EcsRuntime, fn: () => T): T {
    const previous = this.setCurrent(runtime);
    try {
      return fn();
    } finally {
      this.current = previous;
    }
  }

  /** Reset current runtime to a fresh, isolated runtime. */
  public static reset(): void {
    this.current.dispose();
    this.current = new EcsRuntime(new EntityRegistry());
  }

  private assertActive(): void {
    if (this.disposed) throw new Error("EcsRuntime has been disposed.");
  }
}

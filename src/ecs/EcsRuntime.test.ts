import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Entity } from "./Entity.ts";
import { EntityRegistry } from "./EntityRegistry.ts";
import { EcsRuntime } from "./EcsRuntime.ts";
import { Component } from "./Component.ts";
import { InputManager } from "../input/Input.ts";
import { AssetManager } from "../assets/AssetManager.ts";
import { BroadcastEventBus } from "../events/EventBus.ts";
import type { SnapshotEntityNode } from "../state/types.ts";

class Node extends Entity {}
class PersistedNode extends Entity {
  public static type = "persisted-node";
}
class PersistedHealth extends Component {
  public static type = "persisted-health";
  hp = this.atom("hp", 100);
}

class Targeter extends Component {
  public static type = "targeter";
  target = this.ref<Entity | null>("target", null);
}

class PersistedWithTarget extends Entity {
  public static type = "persisted-with-target";

  public constructor() {
    super();
    this.addComponent(new Targeter());
  }
}

class RefPair extends Component {
  public static type = "ref-pair";
  entityTarget = this.ref<Entity | null>("entityTarget", null);
  componentTarget = this.ref<Component | null>("componentTarget", null);
}

class PersistedWithRefPair extends Entity {
  public static type = "persisted-with-ref-pair";

  public constructor() {
    super();
    this.addComponent(new RefPair());
  }
}

class PersistedWithHealth extends Entity {
  public static type = "persisted-with-health";

  public constructor() {
    super();
    this.addComponent(new PersistedHealth());
  }
}

class ThrowingChild extends Entity {
  public static type = "throwing-child";
}

class LateHandleComponent extends Component {
  public static type = "late-handle";

  public createHandle() {
    return this.atom("late", 1);
  }
}

class StatelessComponent extends Component {
  public static type = "stateless";
}

class FreshOwner extends Entity {
  public static type = "fresh-owner";

  public constructor(withComponents = false) {
    super();
    if (withComponents) {
      this.addComponent(new RefPair());
      this.addComponent(new StatelessComponent());
    }
  }
}

class ThrowingDestroyEntity extends Entity {
  public static type = "throwing-destroy";

  public override destroy(): void {
    throw new Error("destroy failed");
  }
}

class TrackingInput extends InputManager {
  public disposeCount = 0;

  public override dispose(): void {
    this.disposeCount++;
    super.dispose();
  }
}

class TrackingAssets extends AssetManager {
  public clearCount = 0;

  public override clear(): void {
    this.clearCount++;
    super.clear();
  }
}

class ParameterizedEntity extends Entity {
  public static type = "parameterized";

  public constructor(public readonly key: string) {
    super();
  }
}

class CapturedNode extends Entity {
  public value = 0;
}

class ObservingDestroyEntity extends Entity {
  public sawStagedEntity = false;

  public override destroy(): void {
    this.sawStagedEntity = this.runtime.registry.getAllEntities().some((entity) => entity !== this);
    this.runtime.store.clear();
    super.destroy();
  }
}

class AdversarialComponent extends Component {
  public static type = "adversarial-component";
  public value = this.atom("value", 0);

  public _forceUnbindStoreHandles(): void {}
  public _bindStoreHandlesAfterAdoption(): void {}
  public forceUnbindStoreHandles(): void {}
  public bindStoreHandlesAfterAdoption(): void {}
}

class AdversarialEntity extends Entity {
  public static type = "adversarial-entity";

  public override destroy(): void {}
  public _forceDestroy(): void {}
  public _prepareRuntimeAdoption(): void {}
  public _adoptRuntime(_runtime: EcsRuntime): void {}
  public _rebindStoreHandles(): void {}
  public forceDestroy(): void {}
  public prepareRuntimeAdoption(): void {}
  public adoptRuntime(_runtime: EcsRuntime): void {}
  public rebindStoreHandles(): void {}
}

beforeEach(() => {
  EcsRuntime.reset();
});

afterEach(() => {
  EcsRuntime.reset();
});

describe("EcsRuntime", () => {
  test("default runtime starts with a fresh registry", () => {
    const e = new Node();
    expect(EcsRuntime.getCurrent().registry.getEntityById(e.id)).toBe(e);
  });

  test("runWith isolates entities to the selected runtime registry", () => {
    const runtimeA = new EcsRuntime(new EntityRegistry());
    const runtimeB = new EcsRuntime(new EntityRegistry());

    const a = EcsRuntime.runWith(runtimeA, () => new Node());
    const b = EcsRuntime.runWith(runtimeB, () => new Node());

    expect(runtimeA.registry.getEntityById(a.id)).toBe(a);
    expect(runtimeA.registry.getEntityById(b.id)).toBeUndefined();
    expect(runtimeB.registry.getEntityById(b.id)).toBe(b);
    expect(runtimeB.registry.getEntityById(a.id)).toBeUndefined();
    expect(EcsRuntime.getCurrent().registry.count).toBe(0);
  });

  test("entity unregisters from its creation runtime even after current runtime changes", () => {
    const runtimeA = new EcsRuntime(new EntityRegistry());
    const runtimeB = new EcsRuntime(new EntityRegistry());

    const a = EcsRuntime.runWith(runtimeA, () => new Node());
    EcsRuntime.setCurrent(runtimeB);

    a.destroy();

    expect(runtimeA.registry.getEntityById(a.id)).toBeUndefined();
  });

  test("addChild across different runtimes throws", () => {
    const runtimeA = new EcsRuntime(new EntityRegistry());
    const runtimeB = new EcsRuntime(new EntityRegistry());

    const parent = EcsRuntime.runWith(runtimeA, () => new Node());
    const child = EcsRuntime.runWith(runtimeB, () => new Node());

    expect(() => parent.addChild(child)).toThrow("across runtimes");
  });

  test("runtime has isolated store and persistence services", () => {
    const runtime = new EcsRuntime(new EntityRegistry());
    expect(runtime.store.snapshot().version).toBe(1);
    expect(runtime.persistenceRegistry).toBeDefined();
    expect(runtime.persistenceLoader).toBeDefined();
  });

  test("state handles cannot be created after component attachment", () => {
    const runtime = new EcsRuntime(new EntityRegistry());
    const entity = EcsRuntime.runWith(runtime, () => new Node());
    const component = new LateHandleComponent();
    entity.addComponent(component);

    expect(() => component.createHandle()).toThrow(
      "State handles must be created before component attachment.",
    );
  });

  test("registerPersistedEntity and registerPersistedComponent forward to runtime registry", () => {
    const runtime = new EcsRuntime(new EntityRegistry());
    const entityFactory = () => new PersistedNode();
    const componentFactory = () => new PersistedHealth();

    runtime.registerPersistedEntity(PersistedNode, entityFactory);
    runtime.registerPersistedComponent(PersistedHealth, componentFactory);

    expect(runtime.persistenceRegistry.getEntityFactory("persisted-node")).toBe(entityFactory);
    expect(runtime.persistenceRegistry.getComponentFactory("persisted-health")).toBe(
      componentFactory,
    );
  });

  test("loadSnapshot restores store and loads entities via registered factories", () => {
    const runtime = new EcsRuntime(new EntityRegistry());
    runtime.registerPersistedEntity(PersistedWithHealth, () => new PersistedWithHealth());

    const result = runtime.loadSnapshot({
      version: 1,
      rootSid: "e1",
      entities: [{ sid: "e1", type: "persisted-with-health", parentSid: null }],
      atoms: { "e1:persisted-health:hp": 80 },
    });

    expect(result).toEqual({ ok: true, errors: [] });
    const entities = runtime.registry.getEntitiesByType(PersistedWithHealth);
    expect(entities).toHaveLength(1);
    expect(entities[0]!.getComponent(PersistedHealth).hp.get()).toBe(80);
  });

  test("loadSnapshot hydrates entity refs end-to-end", () => {
    const runtime = new EcsRuntime(new EntityRegistry());
    runtime.registerPersistedEntity(PersistedWithTarget, () => new PersistedWithTarget());
    runtime.registerPersistedEntity(PersistedNode, () => new PersistedNode());

    const result = runtime.loadSnapshot({
      version: 1,
      rootSid: "e1",
      entities: [
        { sid: "e1", type: "persisted-with-target", parentSid: null },
        { sid: "e2", type: "persisted-node", parentSid: "e1" },
      ],
      atoms: {
        "e1:targeter:target": { $ref: { kind: "entity", sid: "e2" } },
      },
    });

    expect(result).toEqual({ ok: true, errors: [] });
    const owner = runtime.registry.getEntitiesByType(PersistedWithTarget)[0]!;
    const targetEntity = runtime.registry.getEntitiesByType(PersistedNode)[0]!;
    const targeter = owner.getComponent(Targeter);
    expect(targeter.target.get()).toBe(targetEntity);
  });

  test("loadSnapshot fails fast when store restore fails", () => {
    const runtime = new EcsRuntime(new EntityRegistry());
    const result = runtime.loadSnapshot({
      version: 2 as unknown as 1,
      rootSid: "e1",
      entities: [],
      atoms: {},
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe("unsupported_version");
    }
  });

  test("failed factory load rolls back the store and all newly registered entities", () => {
    const runtime = new EcsRuntime(new EntityRegistry());
    const existing = EcsRuntime.runWith(runtime, () => new Node());
    runtime.store.registerAtom("existing:state:value", 10);
    const before = runtime.store.snapshot();
    runtime.registerPersistedEntity(PersistedNode, () => new PersistedNode());
    runtime.registerPersistedEntity(ThrowingChild, () => {
      new ThrowingChild();
      throw new Error("factory failed");
    });

    const result = runtime.loadSnapshot({
      version: 1,
      rootSid: "root-stable",
      entities: [
        { sid: "root-stable", type: "persisted-node", parentSid: null },
        { sid: "child-stable", type: "throwing-child", parentSid: "root-stable" },
      ],
      atoms: {},
    });

    expect(result.ok).toBe(false);
    expect(runtime.registry.getAllEntities()).toEqual([existing]);
    expect(existing._markForGc).toBe(false);
    expect(runtime.store.snapshot()).toEqual(before);
  });

  test("snapshot factories execute in a quarantined current runtime", () => {
    const runtime = new EcsRuntime(new EntityRegistry());
    const existing = EcsRuntime.runWith(runtime, () => new Node());
    let factoryRuntime: EcsRuntime | null = null;
    runtime.registerPersistedEntity(PersistedNode, () => {
      factoryRuntime = EcsRuntime.getCurrent();
      expect(factoryRuntime).not.toBe(runtime);
      expect(factoryRuntime.registry.count).toBe(0);
      expect(runtime.registry.getAllEntities()).toEqual([existing]);
      return new PersistedNode();
    });

    expect(
      runtime.loadSnapshot({
        version: 1,
        rootSid: "new-root",
        entities: [{ sid: "new-root", type: "persisted-node", parentSid: null }],
        atoms: {},
      }),
    ).toEqual({ ok: true, errors: [] });
    expect(factoryRuntime).not.toBeNull();
    expect(runtime.registry.getEntitiesByType(PersistedNode)).toHaveLength(1);
  });

  test("captured external object mutations are outside factory rollback guarantees", () => {
    const runtime = new EcsRuntime(new EntityRegistry());
    const captured = EcsRuntime.runWith(runtime, () => new CapturedNode());
    runtime.store.registerAtom("captured:state:value", 1);
    runtime.registerPersistedEntity(PersistedNode, () => {
      captured.value = 9;
      runtime.store.setAtomValue("captured:state:value", 99);
      throw new Error("factory failed");
    });

    const result = runtime.loadSnapshot({
      version: 1,
      rootSid: "new-root",
      entities: [{ sid: "new-root", type: "persisted-node", parentSid: null }],
      atoms: {},
    });

    expect(result.ok).toBe(false);
    expect(captured.value).toBe(9);
    expect(runtime.store.getAtomValue<number>("captured:state:value")).toBe(1);
    expect(runtime.registry.getAllEntities()).toEqual([captured]);
  });

  test("successful load replaces a nonempty runtime graph", () => {
    const runtime = new EcsRuntime(new EntityRegistry());
    const existingRoot = EcsRuntime.runWith(runtime, () => new Node());
    const existingChild = EcsRuntime.runWith(runtime, () => new Node());
    existingRoot.addChild(existingChild);
    runtime.registerPersistedEntity(PersistedNode, () => new PersistedNode());

    const result = runtime.loadSnapshot({
      version: 1,
      rootSid: "loaded-root",
      entities: [{ sid: "loaded-root", type: "persisted-node", parentSid: null }],
      atoms: {},
    });

    expect(result).toEqual({ ok: true, errors: [] });
    expect(existingRoot._markForGc).toBe(true);
    expect(existingChild._markForGc).toBe(true);
    expect(runtime.registry.count).toBe(1);
    expect(runtime.registry.getEntitiesByType(PersistedNode)).toHaveLength(1);
  });

  test("load, snapshot, JSON roundtrip, and reload preserve graph metadata and refs", () => {
    const runtime = new EcsRuntime(new EntityRegistry());
    runtime.registerPersistedEntity(PersistedWithRefPair, () => new PersistedWithRefPair());
    runtime.registerPersistedEntity(PersistedWithHealth, () => new PersistedWithHealth());
    const original = {
      version: 1 as const,
      meta: { sceneId: "arena", createdAt: "2026-07-25T12:00:00.000Z" },
      rootSid: "owner-sid",
      entities: [
        {
          sid: "owner-sid",
          type: "persisted-with-ref-pair",
          parentSid: null,
          params: { team: "blue" },
        },
        { sid: "target-sid", type: "persisted-with-health", parentSid: "owner-sid" },
      ],
      atoms: {
        "owner-sid:ref-pair:entityTarget": {
          $ref: { kind: "entity" as const, sid: "target-sid" },
        },
        "owner-sid:ref-pair:componentTarget": {
          $ref: {
            kind: "component" as const,
            entitySid: "target-sid",
            componentType: "persisted-health",
          },
        },
        "target-sid:persisted-health:hp": 61,
      },
    };

    expect(runtime.loadSnapshot(original)).toEqual({ ok: true, errors: [] });
    const serialized = JSON.stringify(runtime.store.snapshot());
    const roundtripped = JSON.parse(serialized);
    expect(roundtripped).toEqual(original);
    expect(runtime.loadSnapshot(roundtripped)).toEqual({ ok: true, errors: [] });

    const owner = runtime.registry.getEntitiesByType(PersistedWithRefPair)[0]!;
    const target = runtime.registry.getEntitiesByType(PersistedWithHealth)[0]!;
    const refs = owner.getComponent(RefPair);
    expect(refs.entityTarget.get()).toBe(target);
    expect(refs.componentTarget.get()).toBe(target.getComponent(PersistedHealth));
    expect(runtime.store.snapshot()).toEqual(original);
  });

  test("first live-graph snapshot JSON-roundtrips refs and stateless components", () => {
    const runtime = new EcsRuntime(new EntityRegistry());
    runtime.registerPersistedEntity(FreshOwner, () => new FreshOwner(false));
    runtime.registerPersistedEntity(PersistedWithHealth, () => new PersistedWithHealth());
    runtime.registerPersistedComponent(RefPair, () => new RefPair());
    runtime.registerPersistedComponent(StatelessComponent, () => new StatelessComponent());

    const owner = EcsRuntime.runWith(runtime, () => new FreshOwner(true));
    const target = EcsRuntime.runWith(runtime, () => new PersistedWithHealth());
    owner.addChild(target);
    const refs = owner.getComponent(RefPair);
    refs.entityTarget.set(target);
    refs.componentTarget.set(target.getComponent(PersistedHealth));

    const first = runtime.snapshot(owner, { rootSid: "fresh-root", sceneId: "fresh" });
    expect(first.entities[0]?.components).toEqual(["ref-pair", "stateless"]);
    expect(first.atoms["fresh-root:ref-pair:entityTarget"]).toEqual({
      $ref: { kind: "entity", sid: target.id },
    });
    expect(first.atoms["fresh-root:ref-pair:componentTarget"]).toEqual({
      $ref: {
        kind: "component",
        entitySid: target.id,
        componentType: "persisted-health",
      },
    });

    const parsed = JSON.parse(JSON.stringify(first));
    expect(runtime.loadSnapshot(parsed, { strict: true })).toEqual({ ok: true, errors: [] });
    const loadedOwner = runtime.registry.getEntitiesByType(FreshOwner)[0]!;
    const loadedTarget = runtime.registry.getEntitiesByType(PersistedWithHealth)[0]!;
    expect(loadedOwner.isAwake).toBe(false);
    expect(loadedOwner.getComponent(StatelessComponent)).toBeInstanceOf(StatelessComponent);
    expect(loadedOwner.getComponent(RefPair).entityTarget.get()).toBe(loadedTarget);
    expect(loadedOwner.getComponent(RefPair).componentTarget.get()).toBe(
      loadedTarget.getComponent(PersistedHealth),
    );
    expect(runtime.snapshot(loadedOwner).rootSid).toBe("fresh-root");
  });

  test("cleanup restores store when a staged entity destroy throws", () => {
    const runtime = new EcsRuntime(new EntityRegistry());
    const existing = EcsRuntime.runWith(runtime, () => new Node());
    runtime.store.registerAtom("existing:state:value", 7);
    const before = runtime.store.snapshot();
    runtime.registerPersistedEntity(ThrowingDestroyEntity, () => new ThrowingDestroyEntity());

    const result = runtime.loadSnapshot({
      version: 1,
      rootSid: "bad-root",
      entities: [{ sid: "bad-root", type: "throwing-destroy", parentSid: null }],
      atoms: {
        "bad-root:missing:target": { $ref: { kind: "entity", sid: "missing" } },
      },
    });

    expect(result.ok).toBe(false);
    expect(runtime.store.snapshot()).toEqual(before);
    expect(runtime.registry.getAllEntities()).toEqual([existing]);
  });

  test("old graph destroy errors do not roll back a staged replacement", () => {
    const runtime = new EcsRuntime(new EntityRegistry());
    EcsRuntime.runWith(runtime, () => new ThrowingDestroyEntity());
    runtime.registerPersistedEntity(PersistedNode, () => new PersistedNode());

    const result = runtime.loadSnapshot({
      version: 1,
      rootSid: "replacement",
      entities: [{ sid: "replacement", type: "persisted-node", parentSid: null }],
      atoms: {},
    });

    expect(result).toEqual({ ok: true, errors: [] });
    expect(runtime.registry.getAllEntities()).toEqual([
      runtime.registry.getEntitiesByType(PersistedNode)[0]!,
    ]);
    expect(runtime.store.snapshot().rootSid).toBe("replacement");
  });

  test("old destroy hooks cannot observe staged entities or clear replacement state", () => {
    const runtime = new EcsRuntime(new EntityRegistry());
    const old = EcsRuntime.runWith(runtime, () => new ObservingDestroyEntity());
    runtime.store.registerAtom("old:state:value", 1);
    runtime.registerPersistedEntity(PersistedWithHealth, () => new PersistedWithHealth());

    const result = runtime.loadSnapshot({
      version: 1,
      rootSid: "replacement",
      entities: [{ sid: "replacement", type: "persisted-with-health", parentSid: null }],
      atoms: { "replacement:persisted-health:hp": 73 },
    });

    expect(result).toEqual({ ok: true, errors: [] });
    expect(old.sawStagedEntity).toBe(false);
    expect(runtime.store.snapshot().rootSid).toBe("replacement");
    expect(runtime.store.snapshot().atoms).toEqual({
      "replacement:persisted-health:hp": 73,
    });
  });

  test("guaranteed fallback cleans children, components, handles, and subscriptions", () => {
    type Events = { ping: Record<string, never> };
    const bus = new BroadcastEventBus<Events>();
    let calls = 0;
    let destroys = 0;
    class SubscribedComponent extends Component {
      public static type = "subscribed";
      public value = this.atom("value", 1);
      private subscription: string | null = null;

      public override awake(): void {
        this.subscription = bus.subscribe("ping", () => calls++);
      }

      public override destroy(): void {
        destroys++;
        if (this.subscription) bus.unsubscribe(this.subscription);
        throw new Error("component cleanup failed");
      }

      public override _unbindStoreHandles(): void {
        throw new Error("component unbind failed");
      }
    }

    const runtime = new EcsRuntime(new EntityRegistry());
    const parent = EcsRuntime.runWith(runtime, () => new ThrowingDestroyEntity());
    const child = EcsRuntime.runWith(runtime, () => new Node());
    const component = new SubscribedComponent();
    child.addComponent(component);
    parent.addChild(child);
    parent.awake();
    runtime.registerPersistedEntity(PersistedNode, () => new PersistedNode());

    expect(
      runtime.loadSnapshot({
        version: 1,
        rootSid: "replacement",
        entities: [{ sid: "replacement", type: "persisted-node", parentSid: null }],
        atoms: {},
      }),
    ).toEqual({ ok: true, errors: [] });
    bus.publish("ping", {});

    expect(parent._markForGc).toBe(true);
    expect(child._markForGc).toBe(true);
    expect(component.entity).toBeUndefined();
    expect(component.value._isBound).toBe(false);
    expect(destroys).toBe(1);
    expect(calls).toBe(0);
  });

  test("base static primitives ignore adversarial same-named instance hooks", () => {
    const runtime = new EcsRuntime(new EntityRegistry());
    runtime.registerPersistedEntity(AdversarialEntity, () => new AdversarialEntity());
    runtime.registerPersistedComponent(AdversarialComponent, () => new AdversarialComponent());

    expect(
      runtime.loadSnapshot(
        {
          version: 1,
          rootSid: "adversarial",
          entities: [
            {
              sid: "adversarial",
              type: "adversarial-entity",
              parentSid: null,
              components: ["adversarial-component"],
            },
          ],
          atoms: { "adversarial:adversarial-component:value": 41 },
        },
        { strict: true },
      ),
    ).toEqual({ ok: true, errors: [] });

    const entity = runtime.registry.getEntitiesByType(AdversarialEntity)[0]!;
    const component = entity.getComponent(AdversarialComponent);
    expect(entity.runtime).toBe(runtime);
    expect(component.value._isBound).toBe(true);
    expect(component.value.get()).toBe(41);

    runtime.dispose();

    expect(entity._markForGc).toBe(true);
    expect(component.entity).toBeUndefined();
    expect(component.value._isBound).toBe(false);
  });

  test("snapshot sid and params callbacks roundtrip parameterized factories", () => {
    const runtime = new EcsRuntime(new EntityRegistry());
    runtime.registerPersistedEntity(ParameterizedEntity, (rawNode) => {
      const node = rawNode as SnapshotEntityNode;
      return new ParameterizedEntity(String(node.params?.key));
    });
    const root = EcsRuntime.runWith(runtime, () => new ParameterizedEntity("root-key"));
    const child = EcsRuntime.runWith(runtime, () => new ParameterizedEntity("child-key"));
    root.addChild(child);

    const snapshot = runtime.snapshot(root, {
      sid: (entity) => (entity as ParameterizedEntity).key,
      params: (entity) => ({ key: (entity as ParameterizedEntity).key }),
    });
    expect(runtime.loadSnapshot(JSON.parse(JSON.stringify(snapshot)))).toEqual({
      ok: true,
      errors: [],
    });

    const loadedRoot = runtime.registry
      .getEntitiesByType(ParameterizedEntity)
      .find((entity) => entity.parent === null)!;
    expect(loadedRoot.key).toBe("root-key");
    expect(loadedRoot.children[0]).toBeInstanceOf(ParameterizedEntity);
    expect((loadedRoot.children[0] as ParameterizedEntity).key).toBe("child-key");
    expect(runtime.snapshot(loadedRoot)).toEqual(snapshot);
  });

  test("deterministic snapshot callbacks make equivalent graphs byte-equivalent", () => {
    const makeSnapshot = (): string => {
      const runtime = new EcsRuntime(new EntityRegistry());
      const root = EcsRuntime.runWith(runtime, () => new ParameterizedEntity("root"));
      const child = EcsRuntime.runWith(runtime, () => new ParameterizedEntity("child"));
      root.addChild(child);
      return JSON.stringify(
        runtime.snapshot(root, {
          sceneId: "deterministic",
          sid: (entity) => (entity as ParameterizedEntity).key,
          params: (entity) => ({ key: (entity as ParameterizedEntity).key }),
        }),
      );
    };

    expect(makeSnapshot()).toBe(makeSnapshot());
  });

  test("reset disposes the old current runtime and dispose is idempotent", () => {
    const input = new TrackingInput();
    const assets = new TrackingAssets();
    const runtime = new EcsRuntime(new EntityRegistry(), input, assets);
    const entity = EcsRuntime.runWith(runtime, () => new Node());
    const previous = EcsRuntime.setCurrent(runtime);
    previous.dispose();

    EcsRuntime.reset();
    runtime.dispose();

    expect(entity._markForGc).toBe(true);
    expect(runtime.registry.count).toBe(0);
    expect(input.disposeCount).toBe(1);
    expect(assets.clearCount).toBe(1);
    expect(EcsRuntime.getCurrent()).not.toBe(runtime);
  });

  test("dispose continues through entity destroy failures", () => {
    const input = new TrackingInput();
    const assets = new TrackingAssets();
    const runtime = new EcsRuntime(new EntityRegistry(), input, assets);
    const parent = EcsRuntime.runWith(runtime, () => new ThrowingDestroyEntity());
    const child = EcsRuntime.runWith(runtime, () => new Node());
    const component = new PersistedHealth();
    child.addComponent(component);
    parent.addChild(child);

    expect(() => runtime.dispose()).not.toThrow();
    expect(runtime.registry.count).toBe(0);
    expect(parent._markForGc).toBe(true);
    expect(child._markForGc).toBe(true);
    expect(component.entity).toBeUndefined();
    expect(component.hp._isBound).toBe(false);
    expect(input.disposeCount).toBe(1);
    expect(assets.clearCount).toBe(1);
  });

  test("disposed runtimes reject registration, construction, use, and reset safely", () => {
    const runtime = new EcsRuntime(new EntityRegistry());
    const entity = EcsRuntime.runWith(runtime, () => new Node());
    const previous = EcsRuntime.setCurrent(runtime);
    previous.dispose();
    runtime.dispose();

    expect(() => new Node()).toThrow("disposed or tearing-down runtime");
    expect(() => runtime.registry.register(entity)).toThrow("disposed registry");
    expect(() => runtime.registerPersistedEntity(PersistedNode, () => new PersistedNode())).toThrow(
      "EcsRuntime has been disposed",
    );
    expect(() =>
      runtime.loadSnapshot({ version: 1, rootSid: "", entities: [], atoms: {} }),
    ).toThrow("EcsRuntime has been disposed");
    expect(() => EcsRuntime.setCurrent(runtime)).toThrow("EcsRuntime has been disposed");
    expect(() => EcsRuntime.reset()).not.toThrow();
    expect(EcsRuntime.getCurrent().isDisposed).toBe(false);
  });
});

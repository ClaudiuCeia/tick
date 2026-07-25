import { describe, expect, test } from "bun:test";
import { EcsRuntime } from "../ecs/EcsRuntime.ts";
import { Entity } from "../ecs/Entity.ts";
import { Component } from "../ecs/Component.ts";
import { PersistenceLoader } from "./PersistenceLoader.ts";
import { PersistenceRegistry } from "./PersistenceRegistry.ts";
import type { Snapshot } from "./types.ts";

class RootEntity extends Entity {
  public static type = "root";
}

class ChildEntity extends Entity {
  public static type = "child";
}

class HealthComponent extends Component {
  public static type = "health";
  hp = this.atom("hp", 100);
}

class EntityWithHealth extends Entity {
  public static type = "with-health";

  public constructor() {
    super();
    this.addComponent(new HealthComponent());
  }
}

class EmptyHealthEntity extends Entity {
  public static type = "empty-health";
}

class MarkerComponent extends Component {
  public static type = "marker";
}

class MixedComponent extends Component {
  public static type = "mixed";
  count = this.atom("count", 0);
  target = this.ref<Entity | null>("target", null);
}

class EntityWithMixed extends Entity {
  public static type = "with-mixed";

  public constructor() {
    super();
    this.addComponent(new MixedComponent());
  }
}

class WrongEntity extends Entity {
  public static type = "wrong";
}

class AwakeEntity extends Entity {
  public static type = "awake";
}

function createRuntimeAndRegistry(): {
  runtime: EcsRuntime;
  registry: PersistenceRegistry;
  loader: PersistenceLoader;
} {
  const runtime = new EcsRuntime();
  const registry = new PersistenceRegistry();
  const loader = new PersistenceLoader(registry);
  return { runtime, registry, loader };
}

describe("PersistenceLoader", () => {
  test("loads entity graph and links parents", () => {
    const { runtime, registry, loader } = createRuntimeAndRegistry();
    registry.registerEntity(RootEntity, () => new RootEntity());
    registry.registerEntity(ChildEntity, () => new ChildEntity());

    const snapshot: Snapshot = {
      version: 1,
      rootSid: "e1",
      entities: [
        { sid: "e1", type: "root", parentSid: null },
        { sid: "e2", type: "child", parentSid: "e1" },
      ],
      atoms: {},
    };

    const result = loader.loadIntoRuntime(snapshot, runtime);

    expect(result).toEqual({ ok: true, errors: [] });
    const roots = runtime.registry.getEntitiesByType(RootEntity);
    const children = runtime.registry.getEntitiesByType(ChildEntity);
    expect(roots).toHaveLength(1);
    expect(children).toHaveLength(1);
    expect(roots[0]?.children).toContain(children[0]!);
  });

  test("fails with unknown_type when entity type is missing from registry", () => {
    const { runtime, loader } = createRuntimeAndRegistry();
    const result = loader.loadIntoRuntime(
      {
        version: 1,
        rootSid: "e1",
        entities: [{ sid: "e1", type: "missing", parentSid: null }],
        atoms: {},
      },
      runtime,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe("unknown_type");
    }
  });

  test("fails with duplicate_sid for duplicate entity ids", () => {
    const { runtime, registry, loader } = createRuntimeAndRegistry();
    registry.registerEntity(RootEntity, () => new RootEntity());

    const result = loader.loadIntoRuntime(
      {
        version: 1,
        rootSid: "e1",
        entities: [
          { sid: "e1", type: "root", parentSid: null },
          { sid: "e1", type: "root", parentSid: null },
        ],
        atoms: {},
      },
      runtime,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe("duplicate_sid");
    }
  });

  test("fails with missing_parent when parent sid does not exist", () => {
    const { runtime, registry, loader } = createRuntimeAndRegistry();
    registry.registerEntity(ChildEntity, () => new ChildEntity());

    const result = loader.loadIntoRuntime(
      {
        version: 1,
        rootSid: "e2",
        entities: [{ sid: "e2", type: "child", parentSid: "missing-parent" }],
        atoms: {},
      },
      runtime,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe("missing_parent");
    }
  });

  test("fails with parent_cycle when parent chain has a cycle", () => {
    const { runtime, registry, loader } = createRuntimeAndRegistry();
    registry.registerEntity(RootEntity, () => new RootEntity());
    registry.registerEntity(ChildEntity, () => new ChildEntity());

    const result = loader.loadIntoRuntime(
      {
        version: 1,
        rootSid: "e1",
        entities: [
          { sid: "e1", type: "root", parentSid: "e2" },
          { sid: "e2", type: "child", parentSid: "e1" },
        ],
        atoms: {},
      },
      runtime,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe("parent_cycle");
    }
  });

  test("fails with dangling_ref when entity ref target is missing", () => {
    const { runtime, registry, loader } = createRuntimeAndRegistry();
    registry.registerEntity(RootEntity, () => new RootEntity());

    const result = loader.loadIntoRuntime(
      {
        version: 1,
        rootSid: "e1",
        entities: [{ sid: "e1", type: "root", parentSid: null }],
        atoms: {
          "e1:Targeting:target": { $ref: { kind: "entity", sid: "e2" } },
        },
      },
      runtime,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe("dangling_ref");
    }
  });

  test("fails with dangling_ref when component ref target is missing", () => {
    const { runtime, registry, loader } = createRuntimeAndRegistry();
    registry.registerEntity(RootEntity, () => new RootEntity());

    const result = loader.loadIntoRuntime(
      {
        version: 1,
        rootSid: "e1",
        entities: [{ sid: "e1", type: "root", parentSid: null }],
        atoms: {
          "e1:Link:comp": {
            $ref: { kind: "component", entitySid: "e1", componentType: "health" },
          },
        },
      },
      runtime,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe("dangling_ref");
    }
  });

  test("accepts valid component refs", () => {
    const { runtime, registry, loader } = createRuntimeAndRegistry();
    registry.registerEntity(EntityWithHealth, () => new EntityWithHealth());

    const result = loader.loadIntoRuntime(
      {
        version: 1,
        rootSid: "e1",
        entities: [{ sid: "e1", type: "with-health", parentSid: null }],
        atoms: {
          "e1:Link:comp": {
            $ref: { kind: "component", entitySid: "e1", componentType: "health" },
          },
        },
      },
      runtime,
    );

    expect(result).toEqual({ ok: true, errors: [] });
  });

  test("reconstructs a persisted component through its component factory", () => {
    const { runtime, registry, loader } = createRuntimeAndRegistry();
    registry.registerEntity(EmptyHealthEntity, () => new EmptyHealthEntity());
    registry.registerComponent(HealthComponent, () => new HealthComponent());

    const result = loader.loadIntoRuntime(
      {
        version: 1,
        rootSid: "e1",
        entities: [{ sid: "e1", type: "empty-health", parentSid: null }],
        atoms: { "e1:health:hp": 27 },
      },
      runtime,
    );

    expect(result).toEqual({ ok: true, errors: [] });
    const entity = runtime.registry.getEntitiesByType(EmptyHealthEntity)[0]!;
    expect(entity.getComponent(HealthComponent).hp.get()).toBe(27);
  });

  test("strict mode rejects atom source components that cannot be reconstructed", () => {
    const permissive = createRuntimeAndRegistry();
    permissive.registry.registerEntity(RootEntity, () => new RootEntity());
    const snapshot: Snapshot = {
      version: 1,
      rootSid: "e1",
      entities: [{ sid: "e1", type: "root", parentSid: null }],
      atoms: { "e1:missing:value": 1 },
    };

    expect(permissive.loader.loadIntoRuntime(snapshot, permissive.runtime)).toEqual({
      ok: true,
      errors: [],
    });

    const strict = createRuntimeAndRegistry();
    strict.registry.registerEntity(RootEntity, () => new RootEntity());
    const result = strict.loader.loadIntoRuntime(snapshot, strict.runtime, { strict: true });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe("unknown_type");
  });

  test("rejects a graph whose rootSid is missing or whose nodes form a forest", () => {
    const missingRoot = createRuntimeAndRegistry();
    missingRoot.registry.registerEntity(RootEntity, () => new RootEntity());
    expect(
      missingRoot.loader.loadIntoRuntime(
        {
          version: 1,
          rootSid: "missing",
          entities: [{ sid: "e1", type: "root", parentSid: null }],
          atoms: {},
        },
        missingRoot.runtime,
      ).ok,
    ).toBe(false);

    const forest = createRuntimeAndRegistry();
    forest.registry.registerEntity(RootEntity, () => new RootEntity());
    forest.registry.registerEntity(ChildEntity, () => new ChildEntity());
    const result = forest.loader.loadIntoRuntime(
      {
        version: 1,
        rootSid: "e1",
        entities: [
          { sid: "e1", type: "root", parentSid: null },
          { sid: "e2", type: "child", parentSid: null },
        ],
        atoms: {},
      },
      forest.runtime,
    );
    expect(result.ok).toBe(false);
  });

  test("reconstructs stateless components declared by the entity node", () => {
    const { runtime, registry, loader } = createRuntimeAndRegistry();
    registry.registerEntity(EmptyHealthEntity, () => new EmptyHealthEntity());
    let componentRuntime: EcsRuntime | null = null;
    registry.registerComponent(MarkerComponent, () => {
      componentRuntime = EcsRuntime.getCurrent();
      return new MarkerComponent();
    });

    const result = loader.loadIntoRuntime(
      {
        version: 1,
        rootSid: "e1",
        entities: [
          {
            sid: "e1",
            type: "empty-health",
            parentSid: null,
            components: ["marker"],
          },
        ],
        atoms: {},
      },
      runtime,
    );

    expect(result).toEqual({ ok: true, errors: [] });
    expect(
      runtime.registry.getEntitiesByType(EmptyHealthEntity)[0]!.getComponent(MarkerComponent),
    ).toBeInstanceOf(MarkerComponent);
    expect(componentRuntime).not.toBe(runtime);
  });

  test("strict mode rejects typo atom names and handle kind mismatches", () => {
    const typo = createRuntimeAndRegistry();
    typo.registry.registerEntity(EntityWithMixed, () => new EntityWithMixed());
    const typoResult = typo.loader.loadIntoRuntime(
      {
        version: 1,
        rootSid: "e1",
        entities: [{ sid: "e1", type: "with-mixed", parentSid: null }],
        atoms: { "e1:mixed:coutn": 1 },
      },
      typo.runtime,
      { strict: true },
    );
    expect(typoResult.ok).toBe(false);
    if (!typoResult.ok) expect(typoResult.errors[0]?.message).toContain("Unknown atom");

    const wrongKind = createRuntimeAndRegistry();
    wrongKind.registry.registerEntity(EntityWithMixed, () => new EntityWithMixed());
    const kindResult = wrongKind.loader.loadIntoRuntime(
      {
        version: 1,
        rootSid: "e1",
        entities: [{ sid: "e1", type: "with-mixed", parentSid: null }],
        atoms: { "e1:mixed:target": 123 },
      },
      wrongKind.runtime,
      { strict: true },
    );
    expect(kindResult.ok).toBe(false);
    if (!kindResult.ok)
      expect(kindResult.errors[0]?.message).toContain("wrong persisted value kind");

    const scalarToken = createRuntimeAndRegistry();
    scalarToken.registry.registerEntity(EntityWithMixed, () => new EntityWithMixed());
    const scalarResult = scalarToken.loader.loadIntoRuntime(
      {
        version: 1,
        rootSid: "e1",
        entities: [{ sid: "e1", type: "with-mixed", parentSid: null }],
        atoms: { "e1:mixed:count": { $ref: { kind: "entity", sid: "e1" } } },
      },
      scalarToken.runtime,
      { strict: true },
    );
    expect(scalarResult.ok).toBe(false);
    if (!scalarResult.ok) {
      expect(scalarResult.errors[0]?.message).toContain("wrong persisted value kind");
    }
  });

  test("rejects entity and component factories with mismatched persisted types", () => {
    const wrongEntity = createRuntimeAndRegistry();
    wrongEntity.registry.registerEntity("root", () => new WrongEntity());
    const entityResult = wrongEntity.loader.loadIntoRuntime(
      {
        version: 1,
        rootSid: "e1",
        entities: [{ sid: "e1", type: "root", parentSid: null }],
        atoms: {},
      },
      wrongEntity.runtime,
    );
    expect(entityResult.ok).toBe(false);
    if (!entityResult.ok)
      expect(entityResult.errors[0]?.message).toContain("returned persisted type");

    const wrongComponent = createRuntimeAndRegistry();
    wrongComponent.registry.registerEntity(EmptyHealthEntity, () => new EmptyHealthEntity());
    wrongComponent.registry.registerComponent("marker", () => new HealthComponent());
    const componentResult = wrongComponent.loader.loadIntoRuntime(
      {
        version: 1,
        rootSid: "e1",
        entities: [
          {
            sid: "e1",
            type: "empty-health",
            parentSid: null,
            components: ["marker"],
          },
        ],
        atoms: {},
      },
      wrongComponent.runtime,
    );
    expect(componentResult.ok).toBe(false);
    if (!componentResult.ok) {
      expect(componentResult.errors[0]?.message).toContain("returned persisted type");
    }
  });

  test("rejects separator characters in snapshot identifiers", () => {
    const { runtime, registry, loader } = createRuntimeAndRegistry();
    registry.registerEntity(RootEntity, () => new RootEntity());

    const result = loader.loadIntoRuntime(
      {
        version: 1,
        rootSid: "bad:sid",
        entities: [{ sid: "bad:sid", type: "root", parentSid: null }],
        atoms: {},
      },
      runtime,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe("invalid_payload");
  });

  test("rejects entity factories that awaken staged products", () => {
    const { runtime, registry, loader } = createRuntimeAndRegistry();
    registry.registerEntity(AwakeEntity, () => {
      const entity = new AwakeEntity();
      entity.awake();
      return entity;
    });

    const result = loader.loadIntoRuntime(
      {
        version: 1,
        rootSid: "e1",
        entities: [{ sid: "e1", type: "awake", parentSid: null }],
        atoms: {},
      },
      runtime,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.message).toContain("awake Entity");
    expect(runtime.registry.count).toBe(0);
  });
});

import { describe, test, expect, beforeEach } from "bun:test";
import { Entity } from "../ecs/Entity.ts";
import { EcsRuntime } from "../ecs/EcsRuntime.ts";
import { CollisionEntity } from "../collision/CollisionEntity.ts";
import { RectangleCollisionShape } from "../collision/shapes/RectangleCollisionShape.ts";
import { TransformComponent } from "../transform/TransformComponent.ts";
import { Vector2D } from "../math/Vector2D.ts";
import { EntityProfiler } from "./EntityProfiler.ts";
import type { ICamera } from "../render/ICamera.ts";
import { RenderComponent } from "../render/RenderComponent.ts";
import { RenderLayer } from "../render/RenderLayer.ts";
import { Component } from "../ecs/Component.ts";
import { EntityRegistry } from "../ecs/EntityRegistry.ts";

class Node extends Entity {}

class CameraStub extends Entity implements ICamera {
  toCanvas(worldPos: Vector2D): Vector2D {
    return worldPos;
  }
}

beforeEach(() => {
  EntityProfiler.stop();
  EntityProfiler.clear();
  EcsRuntime.reset();
  (globalThis as unknown as { window: { innerWidth: number; innerHeight: number } }).window = {
    innerWidth: 100,
    innerHeight: 100,
  };
});

describe("EntityProfiler", () => {
  test("record + printTopSlow include slowest classes", () => {
    const logs: string[] = [];
    const oldGroup = console.group;
    const oldLog = console.log;
    const oldGroupEnd = console.groupEnd;

    console.group = () => {};
    console.log = (...args: unknown[]) => logs.push(args.join(" "));
    console.groupEnd = () => {};

    try {
      class A {}
      class B {}
      EntityProfiler.start();
      (EntityProfiler as any).record(A, "entity", "update", 20);
      (EntityProfiler as any).record(A, "entity", "update", 10);
      (EntityProfiler as any).record(B, "component", "update", 5);

      EntityProfiler.printTopSlow("update", 1);
      expect(logs.some((l) => l.includes("A"))).toBe(true);
      expect(logs.some((l) => l.includes("B"))).toBe(false);
    } finally {
      console.group = oldGroup;
      console.log = oldLog;
      console.groupEnd = oldGroupEnd;
    }
  });

  test("clear removes profile records", () => {
    class A {}
    EntityProfiler.start();
    (EntityProfiler as any).record(A, "entity", "awake", 1);

    EntityProfiler.clear();

    const records = (EntityProfiler as unknown as { records: Map<unknown, unknown> }).records;
    expect(records.size).toBe(0);
  });

  test("scanOffscreenCollision warns about offscreen collider", () => {
    const warns: unknown[][] = [];
    const oldWarn = console.warn;
    const oldGroup = console.group;
    const oldGroupEnd = console.groupEnd;
    console.warn = (...args: unknown[]) => warns.push(args);
    console.group = () => {};
    console.groupEnd = () => {};

    try {
      const owner = new Node();
      const collider = new CollisionEntity(new RectangleCollisionShape(10, 10), "top-left");
      owner.addChild(collider);
      owner.awake();

      collider.getComponent(TransformComponent).setPosition(500, 500);

      EntityProfiler.scanOffscreenCollision(new CameraStub());
      expect(warns.length).toBeGreaterThan(0);
    } finally {
      console.warn = oldWarn;
      console.group = oldGroup;
      console.groupEnd = oldGroupEnd;
    }
  });

  test("start-stop-start does not double-hook lifecycle methods", () => {
    class ProfiledNode extends Entity {}

    EntityProfiler.start();

    const first = new ProfiledNode();
    first.awake();

    const firstRecord = (EntityProfiler as any).records.get(ProfiledNode);
    const firstCount = firstRecord.samples.awake.count;

    EntityProfiler.stop();
    EntityProfiler.start();

    const second = new ProfiledNode();
    second.awake();

    const rec = (EntityProfiler as any).records.get(ProfiledNode);
    expect(rec.samples.awake.count - firstCount).toBe(firstCount);

    EntityProfiler.stop();
  });

  test("records one lifecycle sample for render components that call Component methods", () => {
    class ProfiledRender extends RenderComponent<Node> {
      constructor() {
        super(RenderLayer.HUD);
      }

      override doRender(): void {}
    }

    EntityProfiler.start();
    const node = new Node();
    node.addComponent(new ProfiledRender());
    node.awake();

    const record = (EntityProfiler as any).records.get(ProfiledRender);
    expect(record.kind).toBe("renderComponent");
    expect(record.samples.awake.count).toBe(1);
    EntityProfiler.stop();
  });

  test("stop unpatches lifecycle methods and avoids performance.now overhead", () => {
    const originalNow = performance.now;
    let nowCalls = 0;
    Object.defineProperty(performance, "now", {
      value: () => ++nowCalls,
      configurable: true,
    });

    try {
      EntityProfiler.start();
      new Node().awake();
      EntityProfiler.stop();
      const callsAtStop = nowCalls;

      new Node().awake();
      expect(nowCalls).toBe(callsAtStop);
    } finally {
      EntityProfiler.stop();
      Object.defineProperty(performance, "now", {
        value: originalNow,
        configurable: true,
      });
    }
  });

  test("measures full concrete overrides and removes instance instrumentation", () => {
    let clock = 0;
    class OverrideNode extends Entity {
      override update(deltaTime: number): void {
        clock += 2;
        super.update(deltaTime);
        clock += 3;
      }
    }

    const node = new OverrideNode();
    const originalNow = performance.now;
    Object.defineProperty(performance, "now", {
      value: () => clock,
      configurable: true,
    });

    try {
      EntityProfiler.start();
      node.update(0);

      const record = (EntityProfiler as any).records.get(OverrideNode);
      expect(record.samples.update.count).toBe(1);
      expect(record.samples.update.totalTime).toBe(5);
      expect(Object.hasOwn(node, "update")).toBe(true);

      EntityProfiler.stop();
      expect(Object.hasOwn(node, "update")).toBe(false);
    } finally {
      EntityProfiler.stop();
      Object.defineProperty(performance, "now", {
        value: originalNow,
        configurable: true,
      });
    }
  });

  test("automatically instruments entities and attached components created after start", () => {
    let clock = 0;
    class LateNode extends Entity {
      override update(deltaTime: number): void {
        clock += 2;
        super.update(deltaTime);
        clock += 3;
      }
    }
    class LateComponent extends Component<LateNode> {
      override update(deltaTime: number): void {
        clock += 7;
        super.update(deltaTime);
        clock += 11;
      }
    }

    const originalRegister = EntityRegistry.prototype.register;
    const originalAddComponent = Entity.prototype.addComponent;
    const originalNow = performance.now;
    Object.defineProperty(performance, "now", {
      value: () => clock,
      configurable: true,
    });

    try {
      EntityProfiler.start();
      expect(EntityRegistry.prototype.register).not.toBe(originalRegister);
      expect(Entity.prototype.addComponent).not.toBe(originalAddComponent);

      const node = new LateNode();
      const component = new LateComponent();
      node.addComponent(component);
      component.update(0);
      node.update(0);

      const nodeRecord = (EntityProfiler as any).records.get(LateNode);
      const componentRecord = (EntityProfiler as any).records.get(LateComponent);
      expect(nodeRecord.samples.update.count).toBe(1);
      expect(nodeRecord.samples.update.totalTime).toBe(23);
      expect(componentRecord.samples.update.count).toBe(2);
      expect(componentRecord.samples.update.totalTime).toBe(36);

      EntityProfiler.stop();
      expect(EntityRegistry.prototype.register).toBe(originalRegister);
      expect(Entity.prototype.addComponent).toBe(originalAddComponent);
      expect(Object.hasOwn(node, "update")).toBe(false);
      expect(Object.hasOwn(component, "update")).toBe(false);
    } finally {
      EntityProfiler.stop();
      Object.defineProperty(performance, "now", {
        value: originalNow,
        configurable: true,
      });
    }
  });

  test("explicitly instruments entity lifecycle class fields after construction", () => {
    let clock = 0;
    class FieldNode extends Entity {
      public override update = (deltaTime: number): void => {
        clock += 2;
        super.update(deltaTime);
        clock += 3;
      };
    }

    const originalNow = performance.now;
    Object.defineProperty(performance, "now", {
      value: () => clock,
      configurable: true,
    });

    try {
      EntityProfiler.start();
      const node = new FieldNode();
      const fieldUpdate = node.update;

      EntityProfiler.instrument(node);
      expect(node.update).not.toBe(fieldUpdate);
      node.update(0);

      const record = (EntityProfiler as any).records.get(FieldNode);
      expect(record.samples.update.count).toBe(1);
      expect(record.samples.update.totalTime).toBe(5);

      EntityProfiler.stop();
      expect(node.update).toBe(fieldUpdate);
    } finally {
      EntityProfiler.stop();
      Object.defineProperty(performance, "now", {
        value: originalNow,
        configurable: true,
      });
    }
  });
});

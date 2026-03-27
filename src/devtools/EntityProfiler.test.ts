import { describe, test, expect, beforeEach } from "bun:test";
import { Entity } from "../ecs/Entity.ts";
import { EcsRuntime } from "../ecs/EcsRuntime.ts";
import { CollisionEntity } from "../collision/CollisionEntity.ts";
import { RectangleCollisionShape } from "../collision/shapes/RectangleCollisionShape.ts";
import { TransformComponent } from "../transform/TransformComponent.ts";
import { Vector2D } from "../math/Vector2D.ts";
import { EntityProfiler } from "./EntityProfiler.ts";
import type { ICamera } from "../render/ICamera.ts";

class Node extends Entity {}

class CameraStub extends Entity implements ICamera {
  toCanvas(worldPos: Vector2D): Vector2D {
    return worldPos;
  }
}

beforeEach(() => {
  EcsRuntime.reset();
  (EntityProfiler as unknown as { records: Map<unknown, unknown> }).records = new Map();
  (EntityProfiler as unknown as { isRunning: boolean }).isRunning = false;
  (EntityProfiler as unknown as { isHooked: boolean }).isHooked = false;
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
});

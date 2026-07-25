import { describe, test, expect, beforeEach } from "bun:test";
import { Entity } from "../ecs/Entity.ts";
import { EntityRegistry } from "../ecs/EntityRegistry.ts";
import { EcsRuntime } from "../ecs/EcsRuntime.ts";
import { Vector2D } from "../math/Vector2D.ts";
import { TransformComponent } from "../transform/TransformComponent.ts";
import { CollisionEntity } from "../collision/CollisionEntity.ts";
import { RectangleCollisionShape } from "../collision/shapes/RectangleCollisionShape.ts";
import { RenderComponent } from "./RenderComponent.ts";
import { HudRenderComponent } from "./HudRenderComponent.ts";
import { HudViewport } from "./HudViewport.ts";
import { RenderLayer } from "./RenderLayer.ts";
import { RenderSystem } from "./RenderSystem.ts";
import type { ICamera } from "./ICamera.ts";
import { HudLayoutNodeComponent } from "../ui/HudLayoutNodeComponent.ts";

class Node extends Entity {}

class CameraEntity extends Entity implements ICamera {
  toCanvas(worldPos: Vector2D): Vector2D {
    return worldPos;
  }
}

abstract class LoggedRenderComponent extends RenderComponent<Node> {
  constructor(
    zIndex: RenderLayer,
    private label: string,
    private log: string[],
  ) {
    super(zIndex);
  }

  override doRender(): void {
    this.log.push(this.label);
  }
}

class WorldRenderComponent extends LoggedRenderComponent {
  constructor(zIndex: RenderLayer, label: string, log: string[]) {
    super(zIndex, label, log);
  }
}

class ForegroundRenderComponent extends LoggedRenderComponent {
  constructor(zIndex: RenderLayer, label: string, log: string[]) {
    super(zIndex, label, log);
  }
}

class BackgroundRenderComponent extends LoggedRenderComponent {
  constructor(zIndex: RenderLayer, label: string, log: string[]) {
    super(zIndex, label, log);
  }
}

class HudLoggedRenderComponent extends LoggedRenderComponent {
  constructor(zIndex: RenderLayer, label: string, log: string[]) {
    super(zIndex, label, log);
  }
}

class TestHudComponent extends HudRenderComponent<Node> {
  public rendered = 0;

  override doRender(): void {
    this.rendered++;
  }
}

class CanvasSizeProbeHudComponent extends HudRenderComponent<Node> {
  public seen: Vector2D | null = null;

  override doRender(_ctx: CanvasRenderingContext2D, _camera: ICamera, canvasSize: Vector2D): void {
    this.seen = canvasSize;
  }
}

class LayoutFrameProbeHudComponent extends HudRenderComponent<Node> {
  public seenFrame: { x: number; y: number; width: number; height: number } | null = null;

  override doRender(): void {
    const node = this.ent.getComponent(HudLayoutNodeComponent);
    this.seenFrame = node.getFrame();
  }
}

beforeEach(() => {
  EcsRuntime.reset();
  (RenderSystem as unknown as { renderables: RenderComponent[] }).renderables = [];
  (globalThis as unknown as { window: { innerWidth: number; innerHeight: number } }).window = {
    innerWidth: 1280,
    innerHeight: 720,
  };
});

const createCtx = () =>
  ({
    save: () => {},
    restore: () => {},
  }) as unknown as CanvasRenderingContext2D;

describe("RenderComponent visibility", () => {
  test("returns false when entity is not awake", () => {
    const e = new Node();
    const rc = new WorldRenderComponent(RenderLayer.World, "x", []);
    e.addComponent(rc);

    const camera = new CameraEntity();
    expect(rc.isVisible(camera)).toBe(false);
  });

  test("HUD-layer components are visible without colliders", () => {
    const e = new Node();
    const hud = new HudLoggedRenderComponent(RenderLayer.HUD, "hud", []);
    e.addComponent(hud);
    e.awake();

    const camera = new CameraEntity();
    expect(hud.isVisible(camera)).toBe(true);
  });

  test("world components use collider overlap against camera collider", () => {
    const camera = new CameraEntity();
    const camCollider = new CollisionEntity(new RectangleCollisionShape(100, 100), "top-left");
    camera.addChild(camCollider);
    camera.awake();

    const owner = new Node();
    const ownerCollider = new CollisionEntity(new RectangleCollisionShape(10, 10), "top-left");
    owner.addChild(ownerCollider);
    const rc = new WorldRenderComponent(RenderLayer.World, "world", []);
    owner.addComponent(rc);
    owner.awake();

    ownerCollider.getComponent(TransformComponent).setPosition(5, 5);
    expect(rc.isVisible(camera)).toBe(true);

    ownerCollider.getComponent(TransformComponent).setPosition(200, 200);
    expect(rc.isVisible(camera)).toBe(false);
  });
});

describe("RenderSystem ordering and registration", () => {
  test("renders world in z-order then HUD", () => {
    const camera = new CameraEntity();
    const camCollider = new CollisionEntity(new RectangleCollisionShape(500, 500), "top-left");
    camera.addChild(camCollider);
    camera.awake();

    const owner = new Node();
    const ownerCollider = new CollisionEntity(new RectangleCollisionShape(50, 50), "top-left");
    owner.addChild(ownerCollider);

    const log: string[] = [];
    owner.addComponent(new ForegroundRenderComponent(RenderLayer.Foreground, "foreground", log));
    owner.addComponent(new BackgroundRenderComponent(RenderLayer.Background, "background", log));
    owner.addComponent(new WorldRenderComponent(RenderLayer.World, "world", log));
    owner.addComponent(new HudLoggedRenderComponent(RenderLayer.HUD, "hud", log));

    owner.awake();
    ownerCollider.getComponent(TransformComponent).setPosition(10, 10);

    const system = new RenderSystem({ context: createCtx(), size: new Vector2D(1, 1) }, camera);
    system.render();

    expect(log).toEqual(["background", "world", "foreground", "hud"]);
  });

  test("destroy unregisters render components", () => {
    const owner = new Node();
    owner.addComponent(new WorldRenderComponent(RenderLayer.World, "world", []));
    owner.awake();

    owner.destroy();

    const renderables = (RenderSystem as unknown as { renderables: RenderComponent[] }).renderables;
    expect(renderables).toHaveLength(0);
  });

  test("HudRenderComponent rejects zIndex below HUD", () => {
    expect(() => new TestHudComponent(RenderLayer.Foreground)).toThrow(
      "must be >= RenderLayer.HUD",
    );
  });

  test("renderables are isolated per runtime", () => {
    const runtimeA = new EcsRuntime(new EntityRegistry());
    const runtimeB = new EcsRuntime(new EntityRegistry());

    const log: string[] = [];

    const setup = (runtime: EcsRuntime, label: string) =>
      EcsRuntime.runWith(runtime, () => {
        const camera = new CameraEntity();
        const camCollider = new CollisionEntity(new RectangleCollisionShape(500, 500), "top-left");
        camera.addChild(camCollider);
        camera.awake();

        const owner = new Node();
        const ownerCollider = new CollisionEntity(new RectangleCollisionShape(10, 10), "top-left");
        owner.addChild(ownerCollider);
        owner.addComponent(new WorldRenderComponent(RenderLayer.World, label, log));
        owner.awake();
        ownerCollider.getComponent(TransformComponent).setPosition(0, 0);
        return camera;
      });

    const cameraA = setup(runtimeA, "A");
    const cameraB = setup(runtimeB, "B");

    new RenderSystem(
      { context: createCtx(), size: new Vector2D(1, 1) },
      cameraA,
      runtimeA,
    ).render();
    expect(log).toEqual(["A"]);

    log.length = 0;
    new RenderSystem(
      { context: createCtx(), size: new Vector2D(1, 1) },
      cameraB,
      runtimeB,
    ).render();
    expect(log).toEqual(["B"]);
  });

  test("passes actual canvas size to render components", () => {
    const camera = new CameraEntity();
    camera.awake();

    const owner = new Node();
    const probe = new CanvasSizeProbeHudComponent(RenderLayer.HUD);
    owner.addComponent(probe);
    owner.awake();

    const system = new RenderSystem({ context: createCtx(), size: new Vector2D(321, 123) }, camera);
    system.render();

    expect(probe.seen).toEqual(new Vector2D(321, 123));
  });

  test("applies HudViewport only to HudRenderComponent instances", () => {
    const camera = new CameraEntity();
    camera.awake();

    const owner = new Node();
    const rawHud = new HudLoggedRenderComponent(RenderLayer.HUD, "raw-hud", []);
    const probe = new CanvasSizeProbeHudComponent(RenderLayer.HUD);
    owner.addComponent(rawHud);
    owner.addComponent(probe);
    owner.awake();

    const setTransformCalls: number[][] = [];
    let saveCount = 0;
    let restoreCount = 0;
    const ctx = {
      save: () => {
        saveCount++;
      },
      restore: () => {
        restoreCount++;
      },
      setTransform: (...args: number[]) => {
        setTransformCalls.push(args);
      },
    } as unknown as CanvasRenderingContext2D;

    const hudViewport = new HudViewport(new Vector2D(400, 200), "contain", false);
    const system = new RenderSystem(
      { context: ctx, size: new Vector2D(800, 600) },
      camera,
      EcsRuntime.getCurrent(),
      hudViewport,
    );
    system.render();

    expect(saveCount).toBe(3);
    expect(restoreCount).toBe(3);
    expect(setTransformCalls).toHaveLength(1);
    expect(setTransformCalls[0]?.[0]).toBeCloseTo(2);
    expect(setTransformCalls[0]?.[3]).toBeCloseTo(2);
    expect(setTransformCalls[0]?.[4]).toBeCloseTo(0);
    expect(setTransformCalls[0]?.[5]).toBeCloseTo(100);
    expect(probe.seen).toEqual(new Vector2D(400, 200));
  });

  test("recomputes HudViewport transform when canvas size changes", () => {
    const camera = new CameraEntity();
    camera.awake();

    const owner = new Node();
    const probe = new CanvasSizeProbeHudComponent(RenderLayer.HUD);
    owner.addComponent(probe);
    owner.awake();

    const setTransformCalls: number[][] = [];
    const ctx = {
      save: () => {},
      restore: () => {},
      setTransform: (...args: number[]) => {
        setTransformCalls.push(args);
      },
    } as unknown as CanvasRenderingContext2D;

    const canvas = { context: ctx, size: new Vector2D(800, 600) };
    const hudViewport = new HudViewport(new Vector2D(400, 200), "contain", false);
    const system = new RenderSystem(canvas, camera, EcsRuntime.getCurrent(), hudViewport);

    system.render();
    canvas.size = new Vector2D(1200, 600);
    system.render();

    expect(setTransformCalls).toHaveLength(2);
    expect(setTransformCalls[0]).toEqual([2, 0, 0, 2, 0, 100]);
    expect(setTransformCalls[1]).toEqual([3, 0, 0, 3, 0, 0]);
    expect(probe.seen).toEqual(new Vector2D(400, 200));
  });

  test("resolves hud layout before HUD component render", () => {
    const camera = new CameraEntity();
    camera.awake();

    const root = new Node();
    const rootLayout = new HudLayoutNodeComponent({ width: 400, height: 200, anchor: "center" });
    root.addComponent(rootLayout);

    const child = new Node();
    const childLayout = new HudLayoutNodeComponent({
      width: 100,
      height: 50,
      anchor: "bottom-right",
      offset: { x: -10, y: -10 },
    });
    child.addComponent(childLayout);

    const probe = new LayoutFrameProbeHudComponent(RenderLayer.HUD);
    child.addComponent(probe);

    root.addChild(child);
    root.awake();

    const ctx = {
      save: () => {},
      restore: () => {},
      setTransform: () => {},
    } as unknown as CanvasRenderingContext2D;

    const hudViewport = new HudViewport(new Vector2D(400, 200), "contain", false);
    const system = new RenderSystem(
      { context: ctx, size: new Vector2D(1000, 700) },
      camera,
      EcsRuntime.getCurrent(),
      hudViewport,
    );

    system.render();

    expect(probe.seenFrame).toEqual({ x: 290, y: 140, width: 100, height: 50 });
  });

  test("skips HUD render when layout node is hidden", () => {
    const camera = new CameraEntity();
    camera.awake();

    const owner = new Node();
    const layout = new HudLayoutNodeComponent({ width: 100, height: 50 });
    layout.visible = false;
    owner.addComponent(layout);

    const probe = new CanvasSizeProbeHudComponent(RenderLayer.HUD);
    owner.addComponent(probe);
    owner.awake();

    const system = new RenderSystem({ context: createCtx(), size: new Vector2D(321, 123) }, camera);
    system.render();

    expect(probe.seen).toBeNull();
  });

  test("keeps equal-z draw order stable and re-sorts zIndex mutations", () => {
    const camera = new CameraEntity();
    camera.awake();
    const log: string[] = [];

    const firstOwner = new Node();
    const first = new HudLoggedRenderComponent(RenderLayer.HUD, "first", log);
    firstOwner.addComponent(first);
    firstOwner.awake();

    const secondOwner = new Node();
    const second = new HudLoggedRenderComponent(RenderLayer.HUD, "second", log);
    secondOwner.addComponent(second);
    secondOwner.awake();

    const system = new RenderSystem({ context: createCtx(), size: new Vector2D(100, 100) }, camera);
    system.render();
    expect(log).toEqual(["first", "second"]);

    log.length = 0;
    first.zIndex = RenderLayer.HUD + 1;
    system.render();
    expect(log).toEqual(["second", "first"]);
  });

  test("keeps stable z-order across many registrations", () => {
    const camera = new CameraEntity();
    camera.awake();
    const log: string[] = [];
    const expected: Array<{ label: string; zIndex: number; order: number }> = [];

    for (let i = 0; i < 512; i++) {
      const zIndex = RenderLayer.HUD + ((i * 17) % 11);
      const label = `renderer-${i}`;
      const owner = new Node();
      owner.addComponent(new HudLoggedRenderComponent(zIndex, label, log));
      owner.awake();
      expected.push({ label, zIndex, order: i });
    }

    new RenderSystem({ context: createCtx(), size: new Vector2D(100, 100) }, camera).render();
    expect(log).toEqual(
      expected.sort((a, b) => a.zIndex - b.zIndex || a.order - b.order).map((entry) => entry.label),
    );
  });

  test("commits zIndex mutations made during rendering on the next frame", () => {
    let other: Node;
    let observedOrder: [number | null, number | null] | null = null;
    const log: string[] = [];

    class MutatingHud extends HudRenderComponent<Node> {
      private mutated = false;

      override doRender(): void {
        log.push("mutating");
        if (this.mutated) return;
        this.mutated = true;
        this.zIndex = RenderLayer.HUD + 10;
        observedOrder = [
          RenderSystem.getHudDrawOrder(this.ent, this.ent.runtime),
          RenderSystem.getHudDrawOrder(other, this.ent.runtime),
        ];
        expect(this.zIndex).toBe(RenderLayer.HUD);
      }
    }

    const camera = new CameraEntity();
    camera.awake();
    const first = new Node();
    first.addComponent(new MutatingHud());
    first.awake();
    other = new Node();
    other.addComponent(new HudLoggedRenderComponent(RenderLayer.HUD, "other", log));
    other.awake();
    const system = new RenderSystem({ context: createCtx(), size: new Vector2D(100, 100) }, camera);

    system.render();
    expect(log).toEqual(["mutating", "other"]);
    expect(observedOrder?.[0]).toBeLessThan(observedOrder?.[1] ?? -1);

    log.length = 0;
    system.render();
    expect(log).toEqual(["other", "mutating"]);
  });

  test("does not skip the next renderer when one unregisters itself", () => {
    class SelfDestroyingHud extends HudRenderComponent<Node> {
      constructor(private readonly log: string[]) {
        super();
      }

      override doRender(): void {
        this.log.push("self");
        this.ent.destroy();
      }
    }

    const camera = new CameraEntity();
    camera.awake();
    const log: string[] = [];

    const first = new Node();
    first.addComponent(new SelfDestroyingHud(log));
    first.awake();
    const second = new Node();
    second.addComponent(new HudLoggedRenderComponent(RenderLayer.HUD, "next", log));
    second.awake();

    new RenderSystem({ context: createCtx(), size: new Vector2D(100, 100) }, camera).render();
    expect(log).toEqual(["self", "next"]);
  });

  test("restores canvas state when a renderer throws", () => {
    class ThrowingHud extends HudRenderComponent<Node> {
      override doRender(): void {
        throw new Error("render failed");
      }
    }

    const owner = new Node();
    const component = new ThrowingHud();
    owner.addComponent(component);
    owner.awake();

    let saves = 0;
    let restores = 0;
    const ctx = {
      save: () => saves++,
      restore: () => restores++,
    } as unknown as CanvasRenderingContext2D;

    expect(() => component.render(ctx, new CameraEntity(), new Vector2D(100, 100))).toThrow(
      "render failed",
    );
    expect(saves).toBe(1);
    expect(restores).toBe(1);
  });

  test("inherits hidden layout state from ancestor containers", () => {
    const camera = new CameraEntity();
    camera.awake();
    const root = new Node();
    const rootLayout = new HudLayoutNodeComponent({ width: 100, height: 100 });
    rootLayout.visible = false;
    root.addComponent(rootLayout);
    const child = new Node();
    const probe = new CanvasSizeProbeHudComponent();
    child.addComponent(probe);
    root.addChild(child);
    root.awake();

    new RenderSystem({ context: createCtx(), size: new Vector2D(100, 100) }, camera).render();
    expect(probe.seen).toBeNull();
  });

  test("dispose detaches its owned HUD input router exactly once", () => {
    const originalCanvasClass = globalThis.HTMLCanvasElement;
    const originalWindow = globalThis.window;
    let removals = 0;

    class TestCanvas {
      public width = 100;
      public height = 100;
      public addEventListener(): void {}
      public removeEventListener(): void {
        removals++;
      }
      public getBoundingClientRect(): DOMRect {
        return { left: 0, top: 0, width: 100, height: 100 } as DOMRect;
      }
    }

    Object.defineProperty(globalThis, "HTMLCanvasElement", {
      value: TestCanvas,
      configurable: true,
    });
    Object.defineProperty(globalThis, "window", {
      value: { addEventListener() {}, removeEventListener() {} },
      configurable: true,
    });

    try {
      const camera = new CameraEntity();
      camera.awake();
      const canvas = new TestCanvas();
      const ctx = { ...createCtx(), canvas } as unknown as CanvasRenderingContext2D;
      const system = new RenderSystem({ context: ctx, size: new Vector2D(100, 100) }, camera);
      system.render();
      system.dispose();
      const firstRemovalCount = removals;
      system.dispose();

      expect(firstRemovalCount).toBe(8);
      expect(removals).toBe(firstRemovalCount);
    } finally {
      Object.defineProperty(globalThis, "HTMLCanvasElement", {
        value: originalCanvasClass,
        configurable: true,
      });
      Object.defineProperty(globalThis, "window", {
        value: originalWindow,
        configurable: true,
      });
    }
  });
});

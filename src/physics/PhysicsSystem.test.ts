import { beforeEach, describe, expect, test } from "bun:test";
import { Entity } from "../ecs/Entity.ts";
import { EcsRuntime } from "../ecs/EcsRuntime.ts";
import { TransformComponent } from "../transform/TransformComponent.ts";
import { World } from "../world/World.ts";
import { CollisionEntity } from "../collision/CollisionEntity.ts";
import { RectangleCollisionShape } from "../collision/shapes/RectangleCollisionShape.ts";
import { Vector2D } from "../math/Vector2D.ts";
import { PhysicsBodyComponent } from "./PhysicsBodyComponent.ts";
import { PhysicsBodyType } from "./PhysicsBodyType.ts";
import { PhysicsSystem } from "./PhysicsSystem.ts";

class PhysicsEntity extends Entity {
  private readonly collider: CollisionEntity;

  constructor(options: {
    position: Vector2D;
    width?: number;
    height?: number;
    layer?: number;
    mask?: number;
    bodyType?: PhysicsBodyType;
    mass?: number;
    restitution?: number;
    friction?: number;
    canSleep?: boolean;
  }) {
    super();
    this.addComponent(
      new TransformComponent({ position: options.position, rotation: 0, scale: 1 }),
    );
    this.addComponent(
      new PhysicsBodyComponent({
        type: options.bodyType,
        mass: options.mass,
        restitution: options.restitution,
        friction: options.friction,
        canSleep: options.canSleep,
      }),
    );
    this.collider = new CollisionEntity(
      new RectangleCollisionShape(options.width ?? 20, options.height ?? 20),
      "center",
      options.layer ?? 1,
      options.mask ?? 0xffffffff,
    );
    this.addChild(this.collider);
  }

  public override update(dt: number): void {
    super.update(dt);
  }

  public getBody(): PhysicsBodyComponent {
    return this.getComponent(PhysicsBodyComponent);
  }

  public getPosition(): Vector2D {
    return this.getComponent(TransformComponent).transform.position;
  }

  public getGlobalPosition(): Vector2D {
    return this.getComponent(TransformComponent).globalTransform.position;
  }
}

class PhysicsParent extends Entity {
  constructor(transform: TransformComponent) {
    super();
    this.addComponent(transform);
  }
}

const runFixedSteps = (world: World, steps: number, dt: number): void => {
  for (let i = 0; i < steps; i++) {
    world.step(dt);
  }
};

beforeEach(() => {
  EcsRuntime.reset();
});

describe("PhysicsSystem", () => {
  test("integrates gravity for dynamic bodies deterministically", () => {
    const world = new World({ fixedDeltaTime: 1 / 60 });
    const system = new PhysicsSystem({ gravity: new Vector2D(0, 1200) });
    world.addSystem(system);

    const body = new PhysicsEntity({ position: new Vector2D(0, 0) });
    body.awake();

    runFixedSteps(world, 5, 1 / 60);

    expect(body.getPosition().y).toBeGreaterThan(0);
    expect(body.getBody().getVelocity().y).toBeGreaterThan(0);
  });

  test("static body is not moved by integration", () => {
    const world = new World({ fixedDeltaTime: 1 / 60 });
    const system = new PhysicsSystem({ gravity: new Vector2D(0, 1200) });
    world.addSystem(system);

    const body = new PhysicsEntity({
      position: new Vector2D(10, 10),
      bodyType: PhysicsBodyType.Static,
    });
    body.awake();
    body.getBody().setVelocity(new Vector2D(200, 100));

    runFixedSteps(world, 5, 1 / 60);

    expect(body.getPosition().x).toBeCloseTo(10, 6);
    expect(body.getPosition().y).toBeCloseTo(10, 6);
  });

  test("kinematic body pushes dynamic body", () => {
    const world = new World({ fixedDeltaTime: 1 / 120 });
    const system = new PhysicsSystem({ gravity: Vector2D.zero, velocityIterations: 6 });
    world.addSystem(system);

    const kinematic = new PhysicsEntity({
      position: new Vector2D(-15, 0),
      bodyType: PhysicsBodyType.Kinematic,
      width: 20,
      height: 20,
    });
    const dynamic = new PhysicsEntity({ position: new Vector2D(0, 0), width: 20, height: 20 });
    kinematic.awake();
    dynamic.awake();

    kinematic.getBody().setVelocity(new Vector2D(120, 0));
    runFixedSteps(world, 6, 1 / 120);

    expect(Math.abs(dynamic.getPosition().x)).toBeGreaterThan(5);
  });

  test("positional correction separates overlapping dynamic bodies", () => {
    const world = new World({ fixedDeltaTime: 1 / 60 });
    const system = new PhysicsSystem({ gravity: Vector2D.zero });
    world.addSystem(system);

    const a = new PhysicsEntity({ position: new Vector2D(0, 0), width: 30, height: 30 });
    const b = new PhysicsEntity({ position: new Vector2D(10, 0), width: 30, height: 30 });
    a.awake();
    b.awake();

    runFixedSteps(world, 12, 1 / 60);

    const distance = Math.abs(a.getPosition().x - b.getPosition().x);
    expect(distance).toBeGreaterThan(18);
  });

  test("directional impact resolves correctly regardless of pair insertion order", () => {
    const runImpact = (dynamicFirst: boolean): number => {
      EcsRuntime.reset();
      const system = new PhysicsSystem({
        gravity: Vector2D.zero,
        velocityIterations: 4,
        positionIterations: 1,
      });
      let dynamic: PhysicsEntity;
      let wall: PhysicsEntity;
      if (dynamicFirst) {
        dynamic = new PhysicsEntity({
          position: new Vector2D(0, 0),
          restitution: 1,
        });
        wall = new PhysicsEntity({
          position: new Vector2D(15, 0),
          bodyType: PhysicsBodyType.Static,
          restitution: 1,
        });
      } else {
        wall = new PhysicsEntity({
          position: new Vector2D(15, 0),
          bodyType: PhysicsBodyType.Static,
          restitution: 1,
        });
        dynamic = new PhysicsEntity({
          position: new Vector2D(0, 0),
          restitution: 1,
        });
      }
      dynamic.awake();
      wall.awake();
      dynamic.getBody().setVelocity(new Vector2D(100, 0));

      system.update(0);
      return dynamic.getBody().getVelocity().x;
    };

    const dynamicFirst = runImpact(true);
    const staticFirst = runImpact(false);
    expect(dynamicFirst).toBeLessThan(0);
    expect(staticFirst).toBeLessThan(0);
    expect(dynamicFirst).toBeCloseTo(staticFirst, 8);
  });

  test("position iterations refresh penetration instead of reapplying a stale MTV", () => {
    const system = new PhysicsSystem({
      gravity: Vector2D.zero,
      positionIterations: 8,
      maxPenetrationCorrection: 100,
      penetrationSlop: 0,
    });
    const a = new PhysicsEntity({ position: new Vector2D(0, 0) });
    const b = new PhysicsEntity({ position: new Vector2D(10, 0) });
    a.awake();
    b.awake();

    system.update(0);

    const distance = Math.abs(a.getPosition().x - b.getPosition().x);
    expect(distance).toBeGreaterThan(19.9);
    expect(distance).toBeLessThanOrEqual(20);
  });

  test("exact-center static overlap resolves dynamic body consistently in either insertion order", () => {
    const runOverlap = (dynamicFirst: boolean): number => {
      EcsRuntime.reset();
      const system = new PhysicsSystem({
        gravity: Vector2D.zero,
        positionIterations: 1,
        maxPenetrationCorrection: 1,
      });
      let dynamic: PhysicsEntity;
      let fixed: PhysicsEntity;
      if (dynamicFirst) {
        dynamic = new PhysicsEntity({ position: Vector2D.zero });
        fixed = new PhysicsEntity({ position: Vector2D.zero, bodyType: PhysicsBodyType.Static });
      } else {
        fixed = new PhysicsEntity({ position: Vector2D.zero, bodyType: PhysicsBodyType.Static });
        dynamic = new PhysicsEntity({ position: Vector2D.zero });
      }
      dynamic.awake();
      fixed.awake();

      system.update(0);
      return dynamic.getPosition().y;
    };

    const dynamicFirst = runOverlap(true);
    const staticFirst = runOverlap(false);
    expect(dynamicFirst).toBeLessThan(0);
    expect(staticFirst).toBeLessThan(0);
    expect(dynamicFirst).toBeCloseTo(staticFirst, 8);
  });

  test("deeply overlapping body remains awake until positional correction finishes", () => {
    const system = new PhysicsSystem({
      gravity: Vector2D.zero,
      positionIterations: 1,
      maxPenetrationCorrection: 1,
      penetrationSlop: 0.01,
      sleepLinearThreshold: 1,
      sleepTimeThreshold: 0.02,
    });
    const fixed = new PhysicsEntity({
      position: Vector2D.zero,
      bodyType: PhysicsBodyType.Static,
    });
    const dynamic = new PhysicsEntity({ position: Vector2D.zero, canSleep: true });
    fixed.awake();
    dynamic.awake();

    for (let i = 0; i < 5; i++) system.update(0.02);
    expect(dynamic.getBody().isSleeping).toBe(false);
    expect(Math.abs(dynamic.getPosition().y)).toBeLessThan(20);

    for (let i = 0; i < 30; i++) system.update(0.02);
    expect(Math.abs(dynamic.getPosition().y)).toBeGreaterThanOrEqual(19.98);
    expect(dynamic.getBody().isSleeping).toBe(true);
  });

  test("friction reduces tangential velocity on contact", () => {
    const world = new World({ fixedDeltaTime: 1 / 120 });
    const system = new PhysicsSystem({ gravity: new Vector2D(0, 900), velocityIterations: 8 });
    world.addSystem(system);

    const floor = new PhysicsEntity({
      position: new Vector2D(0, 40),
      width: 140,
      height: 20,
      bodyType: PhysicsBodyType.Static,
      friction: 1,
    });
    const slider = new PhysicsEntity({
      position: new Vector2D(0, 20),
      width: 20,
      height: 20,
      friction: 1,
      restitution: 0,
    });
    floor.awake();
    slider.awake();
    slider.getBody().setVelocity(new Vector2D(200, 0));

    runFixedSteps(world, 60, 1 / 120);

    expect(Math.abs(slider.getBody().getVelocity().x)).toBeLessThan(200);
  });

  test("dynamic body sleeps when below threshold for enough time", () => {
    const world = new World({ fixedDeltaTime: 1 / 60 });
    const system = new PhysicsSystem({
      gravity: Vector2D.zero,
      sleepLinearThreshold: 2,
      sleepTimeThreshold: 0.12,
    });
    world.addSystem(system);

    const body = new PhysicsEntity({ position: new Vector2D(0, 0), canSleep: true });
    body.awake();

    runFixedSteps(world, 20, 1 / 60);

    expect(body.getBody().isSleeping).toBe(true);
  });

  test("resting contact can accumulate sleep time under gravity", () => {
    const world = new World({ fixedDeltaTime: 1 / 60 });
    const system = new PhysicsSystem({
      gravity: new Vector2D(0, 900),
      sleepLinearThreshold: 20,
      sleepTimeThreshold: 0.12,
      velocityIterations: 6,
    });
    world.addSystem(system);
    const floor = new PhysicsEntity({
      position: new Vector2D(0, 20),
      width: 100,
      bodyType: PhysicsBodyType.Static,
    });
    const body = new PhysicsEntity({
      position: new Vector2D(0, 0),
      canSleep: true,
    });
    floor.awake();
    body.awake();

    runFixedSteps(world, 30, 1 / 60);

    expect(body.getBody().isSleeping).toBe(true);
  });

  test("world velocity remains world-aligned for a parented transform", () => {
    const system = new PhysicsSystem({ gravity: Vector2D.zero });
    const parent = new PhysicsParent(
      new TransformComponent({
        position: Vector2D.zero,
        rotation: Math.PI / 2,
        scale: 2,
      }),
    );
    const body = new PhysicsEntity({
      position: Vector2D.zero,
      bodyType: PhysicsBodyType.Kinematic,
    });
    parent.addChild(body);
    parent.awake();
    body.getBody().setVelocity(new Vector2D(10, 0));

    system.update(1);

    expect(body.getGlobalPosition().x).toBeCloseTo(10);
    expect(body.getGlobalPosition().y).toBeCloseTo(0);
  });

  test("rejects invalid solver options and delta times", () => {
    expect(() => new PhysicsSystem({ broadphaseCellSize: 0 })).toThrow("cellSize");
    expect(() => new PhysicsSystem({ positionIterations: Number.NaN })).toThrow("iterations");
    expect(() => new PhysicsSystem({ gravity: new Vector2D(Infinity, 0) })).toThrow("gravity");
    expect(() => new PhysicsSystem().update(-1)).toThrow("delta time");
  });

  test("same initial state and dt sequence produce same final state", () => {
    const runScenario = (): { x: number; y: number; vx: number; vy: number } => {
      EcsRuntime.reset();
      const world = new World({ fixedDeltaTime: 1 / 120 });
      const system = new PhysicsSystem({ gravity: new Vector2D(0, 1000), velocityIterations: 6 });
      world.addSystem(system);

      const floor = new PhysicsEntity({
        position: new Vector2D(0, 120),
        width: 200,
        height: 20,
        bodyType: PhysicsBodyType.Static,
      });
      const body = new PhysicsEntity({
        position: new Vector2D(0, 20),
        width: 20,
        height: 20,
        restitution: 0.2,
        friction: 0.6,
      });
      floor.awake();
      body.awake();
      body.getBody().setVelocity(new Vector2D(70, -30));

      runFixedSteps(world, 180, 1 / 120);
      return {
        x: body.getPosition().x,
        y: body.getPosition().y,
        vx: body.getBody().getVelocity().x,
        vy: body.getBody().getVelocity().y,
      };
    };

    const a = runScenario();
    const b = runScenario();

    expect(a.x).toBeCloseTo(b.x, 6);
    expect(a.y).toBeCloseTo(b.y, 6);
    expect(a.vx).toBeCloseTo(b.vx, 6);
    expect(a.vy).toBeCloseTo(b.vy, 6);
  });
});
